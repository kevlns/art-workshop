import {startHeartbeat} from './heartbeat.mjs';
import {processTransparentFiles} from './transparent-output.mjs';
import {processIdentity} from './process-identity.mjs';
import { existsSync, readdirSync, renameSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson, hash } from "./shared.mjs";
import { sha256File } from "./bl.mjs";
import { validatePlan } from "./plan.mjs";
import { externalPath } from "./settings.mjs";
import { ensureService } from "./service.mjs";
import { generate, generationRequest } from "./providers.mjs";
import { cancelPrompt } from "./comfyui.mjs";
import { validateImage } from "./images.mjs";

const file = process.argv[2],
  task = readJson(file);
const cancelled = () => {
  const requested =
    existsSync(file + ".cancel") ||
    existsSync(join(task.root, "shutdown.json"));
  if (
    requested &&
    !["succeeded", "failed", "cancelled", "unknown"].includes(task.status)
  )
    task.status = "cancelling";
  return requested;
};
const persist = () => {
  task.heartbeat = new Date().toISOString();
  writeJson(file, task);
};
task.workerPid = process.pid;
task.workerIdentity = processIdentity(process.pid);
task.status = "running";
persist();
const heartbeat = startHeartbeat(persist);
let manifest, manifestPath;
function saveManifest() {
  if (!manifest) return;
  manifest.summary = {
    expected: task.items.length,
    completed: manifest.items.filter((x) => x.status !== "running").length,
    ok: manifest.items.filter((x) => x.ok).length,
    failed: manifest.items.filter((x) => x.status === "failed").length,
    cancelled: manifest.items.filter((x) => x.status === "cancelled").length,
  };
  writeJson(manifestPath, manifest);
}
try {
  validatePlan(task.plan);
  externalPath(task.outputRoot, "输出目录");
  for (const ref of task.resumeOnly ? [] : task.plan.refs)
    if (sha256File(externalPath(ref.path)) !== ref.hash)
      throw new Error("原图/参考图已变化：" + ref.path);
  const runDir = join(task.outputRoot, task.plan.job + "-" + task.taskId);
  manifestPath = join(runDir, "manifest.json");
  task.manifestPath = manifestPath;
  manifest = task.resumeOnly
    ? readJson(manifestPath)
    : {
        schema: "art-workshop/run",
        runId: task.taskId,
        taskId: task.taskId,
        plan: task.plan,
        planHash: task.plan.planHash,
        provider: task.plan.backend?.provider ?? "bailian",
        startedAt: new Date().toISOString(),
        items: [],
      };
  if (
    manifest.taskId !== task.taskId ||
    manifest.planHash !== task.plan.planHash
  )
    throw new Error("原批次结果身份不匹配");
  if (task.resumeOnly) manifest.finishedAt = null;
  saveManifest();
  persist();
  const backend = task.plan.backend;
  if (backend?.provider === "comfyui" && !task.resumeOnly)
    task.endpoint = await ensureService(backend, task.root, { cancelled });
  for (const item of task.items) {
    if (cancelled()) break;
    if (
      task.resumeOnly &&
      !task.comfyPrompts?.[item.inputHash]?.length &&
      !["accepted", "completed"].includes(
        task.remoteExecutions?.[item.inputHash]?.state,
      )
    )
      continue;
    if (
      task.resumeOnly &&
      manifest.items.some((row) => row.inputHash === item.inputHash && row.ok)
    )
      continue;
    task.currentItem = { itemId: item.itemId, variantId: item.variantId };
    persist();
    const record = {
      ...structuredClone(item),
      ok: false,
      status: "running",
      files: [],
      urls: [],
      outputHashes: {},
    };
    const previousIndex = manifest.items.findIndex(
      (row) => row.inputHash === item.inputHash,
    );
    if (previousIndex >= 0) manifest.items[previousIndex] = record;
    else manifest.items.push(record);
    saveManifest();
    try {
      const before = new Set(readdirSync(runDir));
      const request = generationRequest(task.plan, item);
      record.request = request;
      saveManifest();
      const result = await generate(task.plan, item, {
        endpoint: task.endpoint,
        root: task.root,
        outputDir: runDir,
        prefix: `${item.itemId}--${item.variantId}`,
        cancelled,
        receipt: task.remoteExecutions?.[item.inputHash],
        resumeOnly: !!task.resumeOnly,
        promptIds: task.comfyPrompts?.[item.inputHash],
        onReceipt: (receipt) => {
          task.remoteExecutions ??= {};
          task.remoteExecutions[item.inputHash] = receipt;
          record.remote = receipt;
          const pending = Object.values(task.remoteExecutions).some((value) =>
            ["dispatching", "accepted"].includes(value.state),
          );
          task.unsettled = pending;
          if (!pending) task.remoteCancellation = null;
          persist();
          saveManifest();
        },
        onPrompt: (promptId, index) => {
          task.promptId = promptId;
          if (promptId && Number.isInteger(index)) {
            task.comfyPrompts ??= {};
            task.comfyPrompts[item.inputHash] ??= [];
            task.comfyPrompts[item.inputHash][index] = promptId;
          }
          persist();
        },
        onRemoteCancel: () => {
          task.remoteCancellation =
            "client-stopped; upstream execution cannot be confirmed";
          task.unsettled = true;
          persist();
        },
      });
      if (result.files) record.files = result.files;
      else {
        record.urls = result.urls ?? [];
        const fresh = readdirSync(runDir)
          .filter((f) => !before.has(f) && /\.(png|jpe?g|webp)$/i.test(f))
          .sort();
        for (const [index, source] of fresh.entries()) {
          const target = `${item.itemId}--${item.variantId}${index ? "--" + (index + 1) : ""}${source.slice(source.lastIndexOf("."))}`;
          if (source !== target) {
            if (existsSync(join(runDir, target))) throw new Error("产物已存在");
            renameSync(join(runDir, source), join(runDir, target));
          }
          record.files.push(target);
        }
      }
      if (
        record.files.length !== (item.execution ?? task.plan.execution).perValue
      )
        throw new Error("生成数量与计划不符");
      // Retained source images remain verifiable even if output processing fails.
      for(const image of record.files)record.outputHashes[image]=sha256File(join(runDir,image));
      if(item.output?.background==='transparent') {
        record.outputProcessing=await processTransparentFiles(runDir,record.files,{cancelled});
        record.files=record.outputProcessing.map(row=>row.file);
      }
      const expected = (item.execution ?? task.plan.execution).size
        .split("*")
        .map(Number);
      for (const image of record.files) {
        const path = join(runDir, image),
          info = await validateImage(readFileSync(path));
        if (info.width !== expected[0] || info.height !== expected[1])
          throw new Error("生成图片尺寸与冻结计划不符");
        record.outputHashes[image] = sha256File(path);
      }
      record.ok = true;
      record.status = "generated";
    } catch (error) {
      if (backend?.provider === "comfyui" && task.promptId && !task.resumeOnly)
        try {
          await cancelPrompt(task.endpoint, task.promptId);
          task.promptId = null;
        } catch (stopError) {
          error.unsettled = true;
          error.message += "；无法确认后端停止：" + stopError.message;
        }
      if (error.unsettled) task.unsettled = true;
      record.status = cancelled() && !error.unsettled ? "cancelled" : "failed";
      record.error = error.message;
      if (record.status === "failed") {
        task.error = error.message;
        if (error.diagnostic) {
          record.diagnostic = error.diagnostic;
          task.diagnostic = error.diagnostic;
        }
      }
    }
    saveManifest();
    if (task.unsettled) break;
  }
  if (task.resumeOnly && backend?.provider === "comfyui" && !task.promptId) task.unsettled = false;
  if (cancelled() || task.unsettled || task.resumeOnly)
    for (const item of task.items)
      if (!manifest.items.some((x) => x.inputHash === item.inputHash))
        manifest.items.push({
          ...structuredClone(item),
          ok: false,
          status: "cancelled",
          files: [],
          urls: [],
          outputHashes: {},
          error: "任务已取消，未执行",
        });
  manifest.finishedAt = new Date().toISOString();
  saveManifest();
  task.status = cancelled()
    ? "cancelled"
    : manifest.summary.failed
      ? "failed"
      : manifest.summary.cancelled
        ? "cancelled"
        : "succeeded";
} catch (error) {
  task.status = cancelled() ? "cancelled" : "failed";
  task.error = error.message;
  if (error.diagnostic) task.diagnostic = error.diagnostic;
  if (manifest) {
    manifest.error = error.message;
    manifest.diagnostic = error.diagnostic;
    manifest.finishedAt = new Date().toISOString();
    saveManifest();
  }
} finally {
  clearInterval(heartbeat);
  task.stopConfirmed =
    !task.unsettled && !task.promptId && !task.remoteCancellation;
  task.finishedAt = new Date().toISOString();
  persist();
}
