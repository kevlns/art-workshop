import test from "node:test";
import assert from "node:assert/strict";
import { resolveModel, modelCatalog } from "../lib/model-registry.mjs";
import { validateRemotePlan } from "../lib/generation-policy.mjs";
import { buildRemoteArgs } from "../lib/adapters/dashscope.mjs";
import { resolveDimensions } from "../lib/dimensions.mjs";
const plan = () => ({
  module: "generate",
  execution: { model: "qwen-image-3.0-pro", size: "1024*1024", perValue: 1 },
  items: [{ seed: 42, imageArgs: [] }],
});
test("unknown model/protocol combinations never use the CLI default route", () => {
  assert.equal(resolveModel("dashscope", "gpt-image-1").supported, false);
  assert.equal(
    resolveModel("openai-images", "qwen-image-3.0-pro").supported,
    false,
  );
  assert.throws(
    () =>
      validateRemotePlan({
        ...plan(),
        execution: { ...plan().execution, model: "unknown-image" },
      }),
    /尚未适配/,
  );
});
test("remote model limits validate size, seed, count and editing inputs before submission", () => {
  assert.equal(validateRemotePlan(plan()).supported, true);
  for (const execution of [
    { size: "4096*4096" },
    { size: "256*256" },
    { perValue: 5 },
  ])
    assert.throws(
      () =>
        validateRemotePlan({
          ...plan(),
          execution: { ...plan().execution, ...execution },
        }),
      /范围/,
    );
  assert.throws(
    () =>
      validateRemotePlan({
        ...plan(),
        items: [{ seed: 2147483648, imageArgs: [] }],
      }),
    /seed/,
  );
  assert.throws(
    () => validateRemotePlan({ ...plan(), module: "edit" }),
    /底图/,
  );
  assert.throws(
    () =>
      validateRemotePlan({
        ...plan(),
        module: "edit",
        items: [{ seed: 1, imageArgs: ["1", "2", "3", "4"] }],
      }),
    /图片/,
  );
});
test("model-specific dimension clamping respects both minimum and maximum pixel counts", () => {
  const c = resolveModel("dashscope", "qwen-image-3.0-pro").dimensions;
  for (const size of [
    { width: 256, height: 256 },
    { width: 4096, height: 4096 },
  ]) {
    const result = resolveDimensions(size, c);
    const area = result.actual.width * result.actual.height;
    assert.ok(area >= c.minArea && area <= c.maxArea);
    assert.equal(result.clamped, true);
  }
});

import { runBl } from "../lib/bl.mjs";
import { generationRequest } from "../lib/providers.mjs";
import { buildArgs } from "../lib/plan.mjs";
const modelPlan = (model, module = "generate") => ({
  module,
  execution: {
    model,
    size: "1024*1024",
    perValue: 1,
    promptExtend: false,
    watermark: false,
  },
  items: [
    {
      seed: 42,
      prompt: "画一只猫",
      negativeBlock: "不要文字",
      imageArgs: module === "edit" ? ["https://example.com/input.png"] : [],
    },
  ],
});
test("all four new models use synchronous native requests in preview and execution", () => {
  for (const model of [
    "qwen-image-2.0",
    "qwen-image-2.0-pro",
    "wan2.7-image",
    "wan2.7-image-pro",
  ])
    for (const mode of ["generate", "edit"]) {
      const p = modelPlan(model, mode),
        item = p.items[0];
      const args = buildRemoteArgs(p, item, "output", "test");
      assert.deepEqual(buildArgs(p, item, "output", "test"), args);
      const result = runBl(args, { dry: true });
      assert.equal(result.mode, "sync");
      assert.equal(
        result.path,
        "/api/v1/services/aigc/multimodal-generation/generation",
      );
      const { parameters, input } = result.request;
      assert.equal(parameters.seed, 42);
      assert.equal(parameters.watermark, false);
      assert.equal(parameters.n, 1);
      assert.equal(
        input.messages[0].content.at(-1).text,
        generationRequest(p, item).prompt,
      );
      if (model.startsWith("wan")) {
        assert.ok(!("negative_prompt" in parameters));
        assert.ok(!("prompt_extend" in parameters));
        assert.match(input.messages[0].content.at(-1).text, /负向约束并入/);
      } else {
        assert.equal(parameters.negative_prompt, "不要文字");
        assert.equal(parameters.prompt_extend, false);
      }
    }
});
test("Wan Pro 4K is restricted to generation without image inputs; ratios and prompt limits fail before execution", () => {
  const p = modelPlan("wan2.7-image-pro");
  p.execution.size = "4096*4096";
  assert.equal(validateRemotePlan(p).dimensions.maxArea, 4096 ** 2);
  for (const other of ["wan2.7-image", "qwen-image-2.0", "qwen-image-2.0-pro"])
    assert.throws(
      () =>
        validateRemotePlan({
          ...p,
          execution: { ...p.execution, model: other },
        }),
      /范围/,
    );
  assert.throws(
    () =>
      validateRemotePlan({
        ...p,
        module: "edit",
        items: [{ ...p.items[0], imageArgs: ["a"] }],
      }),
    /范围/,
  );
  assert.throws(
    () =>
      validateRemotePlan({
        ...p,
        items: [{ ...p.items[0], imageArgs: ["a"] }],
      }),
    /范围/,
  );
  p.execution.size = "4096*256";
  assert.throws(() => validateRemotePlan(p), /范围/);
  p.execution.size = "1024*1024";
  p.execution.promptExtend = true;
  assert.throws(() => validateRemotePlan(p), /不支持提示词扩写/);
  p.execution.promptExtend = false;
  assert.throws(
    () =>
      validateRemotePlan({
        ...p,
        items: [{ ...p.items[0], imageArgs: Array(10).fill("a") }],
      }),
    /图片/,
  );
  assert.throws(
    () =>
      validateRemotePlan({
        ...p,
        items: [{ ...p.items[0], prompt: "猫".repeat(5000) }],
      }),
    /5000/,
  );
  const c = resolveModel("dashscope", "wan2.7-image-pro", "edit").dimensions;
  const r = resolveDimensions({ width: 4096, height: 256 }, c).actual;
  assert.ok(r.width / r.height <= 8 && r.width * r.height <= 2048 ** 2);
});
test("Qwen 2 editing alignment and negative text limits are enforced", () => {
  const p = modelPlan("qwen-image-2.0-pro", "edit");
  p.execution.size = "1033*1032";
  assert.throws(() => validateRemotePlan(p), /范围/);
  const r = resolveDimensions(
    { width: 1033, height: 1032 },
    resolveModel("dashscope", "qwen-image-2.0-pro", "edit").dimensions,
  ).actual;
  assert.equal(r.width % 16, 0);
  assert.equal(r.height % 16, 0);
  p.execution.size = "1024*1024";
  assert.throws(
    () =>
      validateRemotePlan({
        ...p,
        items: [{ ...p.items[0], negativeBlock: "猫".repeat(501) }],
      }),
    /500/,
  );
  p.items[0].negativeBlock = "猫".repeat(500);
  assert.equal(validateRemotePlan(p).supported, true);
});

import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "../lib/providers.mjs";
test("native protocol transport keeps the configured origin and only submits supported fields", async () => {
  const received = [];
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=",
    "base64",
  );
  const server = createServer(async (req, res) => {
    if (req.url === "/result.png") {
      assert.equal(req.headers.authorization, undefined);
      res.setHeader("Content-Type", "image/png");
      res.end(png);
      return;
    }
    if (req.url === "/api/v1/tasks/mock-task") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          output: {
            task_id: "mock-task",
            task_status: "SUCCEEDED",
            results: [
              { url: `http://127.0.0.1:${server.address().port}/result.png` },
            ],
          },
        }),
      );
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    received.push({ path: req.url, body: JSON.parse(body) });
    if (JSON.parse(body).model === "wan2.6-t2i") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          output: { task_id: "mock-task", task_status: "PENDING" },
        }),
      );
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        output: {
          choices: [
            {
              message: {
                role: "assistant",
                content: [
                  {
                    image: `http://127.0.0.1:${server.address().port}/result.png`,
                  },
                ],
              },
            },
          ],
        },
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const directory = await mkdtemp(join(tmpdir(), "art-remote-wire-"));
  const previous = {
    DASHSCOPE_BASE_URL: process.env.DASHSCOPE_BASE_URL,
    DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY,
  };
  process.env.DASHSCOPE_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.DASHSCOPE_API_KEY = "test-only";
  try {
    for (const model of [
      "qwen-image-2.0",
      "qwen-image-2.0-pro",
      "wan2.7-image",
      "wan2.7-image-pro",
    ]) {
      const p = modelPlan(model);
      await generate(p, p.items[0], {
        outputDir: directory,
        prefix: model,
        cancelled: () => false,
      });
    }
    for (const [model, mode] of [
      ["wan2.6-t2i", "generate"],
      ["wan2.6-image", "edit"],
    ]) {
      const p = modelPlan(model, mode);
      p.execution.size = "1280*1280";
      await generate(p, p.items[0], {
        outputDir: directory,
        prefix: model,
        cancelled: () => false,
      });
    }
    assert.equal(received.length, 6);
    for (const entry of received) {
      assert.equal(
        entry.path,
        entry.body.model === "wan2.6-t2i"
          ? "/api/v1/services/aigc/image-generation/generation"
          : "/api/v1/services/aigc/multimodal-generation/generation",
      );
      assert.equal(entry.body.parameters.seed, 42);
      if (entry.body.model.startsWith("wan2.7"))
        assert.deepEqual(Object.keys(entry.body.parameters).sort(), [
          "n",
          "seed",
          "size",
          "watermark",
        ]);
      else assert.equal(entry.body.parameters.negative_prompt, "不要文字");
    }
  } finally {
    for (const [key, value] of Object.entries(previous))
      value === undefined
        ? delete process.env[key]
        : (process.env[key] = value);
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("catalog covers exact official snapshots and records early/specialized models without enabling them", () => {
  const catalog = modelCatalog(),
    names = catalog.flatMap((p) => p.models);
  assert.equal(new Set(names).size, names.length);
  for (const model of [
    "qwen-image-2.0-2026-03-03",
    "qwen-image-2.0-pro-2026-03-03",
    "qwen-image-2.0-pro-2026-04-22",
    "qwen-image-2.0-pro-2026-06-22",
  ]) {
    const p = modelPlan(model, "edit");
    assert.equal(validateRemotePlan(p).supported, true);
    const request = runBl(
      buildRemoteArgs(p, p.items[0], "output", "snapshot"),
      { dry: true },
    );
    assert.equal(request.request.model, model);
    assert.equal(request.mode, "sync");
  }
  for (const model of [
    "wanx2.1-imageedit",
    "wanx-sketch-to-image-lite",
    "wanx-x-painting",
    "qwen-image-edit",
    "wan2.5-t2i-preview",
  ]) {
    const profile = resolveModel("dashscope", model);
    assert.equal(profile.supported, false);
    assert.equal(profile.registered, true);
    assert.ok(profile.reason);
    assert.ok(profile.source);
    assert.throws(() => validateRemotePlan(modelPlan(model)), /仅登记/);
  }
  assert.equal(
    resolveModel("dashscope", "qwen-image-2.0-pro-2099-01-01").registered,
    false,
  );
  catalog[0].models.push("mutation");
  assert.equal(resolveModel("dashscope", "mutation").supported, false);
});
test("Wan 2.6 generation and editing have independent input, dimensions and mode limits", () => {
  const generation = modelPlan("wan2.6-t2i");
  generation.execution.size = "1280*1280";
  assert.equal(validateRemotePlan(generation).supported, true);
  assert.throws(
    () => validateRemotePlan({ ...generation, module: "edit" }),
    /任务类型/,
  );
  assert.throws(
    () =>
      validateRemotePlan({
        ...generation,
        items: [{ ...generation.items[0], imageArgs: ["a"] }],
      }),
    /图片/,
  );
  generation.execution.size = "1024*1024";
  assert.throws(() => validateRemotePlan(generation), /范围/);
  generation.execution.size = "1456*1456";
  assert.throws(() => validateRemotePlan(generation), /范围/);
  const editing = modelPlan("wan2.6-image", "edit");
  assert.equal(validateRemotePlan(editing).supported, true);
  assert.throws(
    () => validateRemotePlan({ ...editing, module: "generate" }),
    /任务类型/,
  );
  assert.throws(
    () =>
      validateRemotePlan({
        ...editing,
        items: [{ ...editing.items[0], imageArgs: Array(5).fill("a") }],
      }),
    /图片/,
  );
  editing.execution.size = "2048*256";
  assert.throws(() => validateRemotePlan(editing), /范围/);
  editing.execution.size = "1024*1024";
  editing.items[0].prompt = "猫".repeat(2001);
  assert.throws(() => validateRemotePlan(editing), /2000/);
});
