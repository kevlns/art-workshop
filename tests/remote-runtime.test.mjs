import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, cpSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { compileGenerate } from "../lib/generate.mjs";
import { bindBackend, backendDefaults } from "../lib/backends.mjs";
import { loadSettings } from "../lib/settings.mjs";
import { writeJson } from "../lib/shared.mjs";
import { runtimeRoot, sleep, alive } from "../lib/runtime.mjs";
import {
  startTask,
  taskStatus,
  waitTask,
  resumeTask,
  cancelTask,
} from "../lib/tasks.mjs";
async function until(fn) {
  for (let i = 0; i < 200; i++) {
    const value = fn();
    if (value) return value;
    await sleep(50);
  }
  throw new Error("condition timed out");
}
test("worker crash and cancellation resume the original upstream identity without new POSTs", async () => {
  const root = mkdtempSync(join(tmpdir(), "art-remote-runtime-")),
    states = new Map();
  let posts = 0;
  const png = await sharp({
    create: { width: 1280, height: 1280, channels: 3, background: "#ff00ff" },
  })
    .composite([{input:await sharp({create:{width:512,height:512,channels:3,background:"#808080"}}).png().toBuffer(),left:384,top:384}])
    .png()
    .toBuffer();
  const server = createServer(async (req, res) => {
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    if (req.url === "/result.png") {
      res.setHeader("Content-Type", "image/png");
      res.end(png);
      return;
    }
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      assert.equal(body.model, "wan2.6-t2i");
      const taskId = "remote-" + ++posts;
      states.set(taskId, false);
      res.end(
        JSON.stringify({ output: { task_id: taskId, task_status: "PENDING" } }),
      );
      return;
    }
    const id = req.url.split("/").at(-1);
    assert.ok(states.has(id));
    res.end(
      JSON.stringify({
        output: {
          task_id: id,
          task_status: states.get(id) ? "SUCCEEDED" : "RUNNING",
          ...(states.get(id)
            ? { results: [{ url: endpoint + "/result.png" }] }
            : {}),
        },
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`,
    previous = process.env.DASHSCOPE_API_KEY;
  process.env.DASHSCOPE_API_KEY = "test-only";
  let running;
  try {
    cpSync(
      new URL("./fixtures/projects/", import.meta.url),
      join(root, "projects"),
      { recursive: true },
    );
    const file = join(root, "settings.json");
    writeJson(file, {
      paths: {
        workspace: root,
        output: join(root, "output"),
        refs: join(root, "refs"),
        cache: join(root, "cache"),
      },
      generation: {
        defaultBackend: "remote",
        backends: {
          remote: {
            provider: "remote",
            model: "wan2.6-t2i",
            credentialReference: {
              api: "dashscope",
              baseUrl: endpoint,
              providerId: "test",
              revision: "1",
            },
          },
        },
      },
      autoSyncSkills: false,
    });
    const taskConfigPath=join(root,'projects/cellgame/tasks/skills/task.json');
    const taskConfig=JSON.parse(readFileSync(taskConfigPath));
    for(const item of taskConfig.config.items){item.composition??={};item.composition.background={type:'transparent'};}
    writeJson(taskConfigPath,taskConfig);
    const settings = loadSettings({ file }),
      runtime = runtimeRoot(settings),
      plan = bindBackend(
        compileGenerate({
          projectId: "cellgame",
          jobId: "skills",
          root,
          localExecution: backendDefaults(settings),
        }),
        settings,
      );
    const started = await startTask(plan, [plan.items[0]], settings);
    running = started.taskId;
    const accepted = await until(() => {
      const task = taskStatus(runtime, started.taskId);
      return task.remoteExecutions?.[plan.items[0].inputHash]?.state ===
        "accepted"
        ? task
        : null;
    });
    const receipt = accepted.remoteExecutions[plan.items[0].inputHash];
    assert.equal(receipt.taskId, "remote-1");
    process.kill(accepted.workerPid);
    await until(() => !alive(accepted.workerPid));
    const taskFile = join(runtime, "tasks", started.taskId + ".json"),
      stale = JSON.parse(readFileSync(taskFile));
    stale.heartbeat = "2000-01-01T00:00:00Z";
    writeJson(taskFile, stale);
    assert.equal(taskStatus(runtime, started.taskId).status, "unknown");
    states.set("remote-1", true);
    await resumeTask(runtime, started.taskId);
    const done = await waitTask(runtime, started.taskId, {
      timeoutSeconds: 20,
    });
    assert.equal(done.status, "succeeded", done.error);
    assert.equal(done.stopConfirmed, true);
    assert.equal(posts, 1);
    const manifest=JSON.parse(readFileSync(done.manifestPath));
    const completed=manifest.items[0];
    assert.match(completed.files[0],/--transparent\.png$/);
    assert.equal(completed.outputProcessing[0].method,'chroma-key-v2');
    const output=join(done.manifestPath,'..',completed.files[0]);
    assert.equal((await sharp(output).metadata()).hasAlpha,true);
    assert.equal((await sharp(output).stats()).channels[3].min,0);
    assert.equal((await sharp(output).stats()).channels[3].max,255);
    await until(() => !alive(done.workerPid));
    const cancelled = await startTask(plan, [plan.items[1]], settings);
    running = cancelled.taskId;
    await until(
      () =>
        taskStatus(runtime, cancelled.taskId).remoteExecutions?.[
          plan.items[1].inputHash
        ]?.state === "accepted",
    );
    const stopped = await cancelTask(runtime, cancelled.taskId);
    assert.equal(stopped.status, "cancelled");
    assert.equal(stopped.stopConfirmed, false);
    assert.equal(posts, 2);
    await until(() => !alive(stopped.workerPid));
    states.set("remote-2", true);
    await resumeTask(runtime, cancelled.taskId);
    const recovered = await waitTask(runtime, cancelled.taskId, {
      timeoutSeconds: 20,
    });
    assert.equal(recovered.status, "succeeded", recovered.error);
    assert.equal(recovered.stopConfirmed, true);
    assert.equal(posts, 2);
    await until(() => !alive(recovered.workerPid));
    running = null;
  } finally {
    if (running) {
      const directory = join(root, ".runtime", "tasks", running + ".json");
      try {
        const state = JSON.parse(readFileSync(directory));
        if (alive(state.workerPid)) process.kill(state.workerPid);
      } catch {}
    }
    previous === undefined
      ? delete process.env.DASHSCOPE_API_KEY
      : (process.env.DASHSCOPE_API_KEY = previous);
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
