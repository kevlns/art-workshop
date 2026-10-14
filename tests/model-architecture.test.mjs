import test from "node:test";
import assert from "node:assert/strict";
import {
  modelCatalog,
  createModelRegistry,
  contractHash,
  modelEligibility,
} from "../lib/model-registry.mjs";
import {
  compileRemoteRequest,
  assertRemoteContract,
} from "../lib/generation-policy.mjs";
import { createAdapterRegistry } from "../lib/adapters/index.mjs";
import { executeRemote } from "../lib/execution/remote.mjs";
import { requestJson } from "../lib/transport/http.mjs";
import { hash } from "../lib/shared.mjs";
const plan = () => ({
  module: "generate",
  execution: {
    model: "qwen-image-3.0-pro",
    size: "1024*1024",
    perValue: 1,
    promptExtend: false,
    watermark: false,
  },
  items: [{ prompt: "a cat", negativeBlock: "text", seed: 1, imageArgs: [] }],
});
test("a new model parameter is implemented by declarations; no policy or adapter edits", () => {
  const spec = modelCatalog()[0];
  spec.models = ["future-image"];
  spec.fields.quality = {
    type: "integer",
    min: 1,
    max: 5,
    default: 3,
    wire: "quality",
    cli: "--quality",
  };
  const registry = createModelRegistry([spec]),
    p = plan();
  p.execution.model = "future-image";
  p.execution.quality = 4;
  const request = compileRemoteRequest(p, p.items[0], { registry });
  assert.equal(request.parameters.quality, 4);
  p.execution.quality = 6;
  assert.throws(
    () => compileRemoteRequest(p, p.items[0], { registry }),
    /quality/,
  );
  assert.throws(() => createModelRegistry([spec, spec]), /重复/);
  const bad = structuredClone(spec);
  delete bad.dimensions.maxArea;
  assert.throws(() => createModelRegistry([bad]), /尺寸/);
});
test("presentation changes do not invalidate execution, whereas parameter rules do", () => {
  const a = modelCatalog()[0],
    b = structuredClone(a);
  b.notes = ["new wording"];
  b.source = "https://example.com/new";
  b.models.push("new-alias");
  assert.equal(contractHash(a), contractHash(b));
  b.maxCount = 2;
  assert.notEqual(contractHash(a), contractHash(b));
  assert.throws(() => assertRemoteContract(plan()), /缺少当前执行契约/);
});
test("UI eligibility and execution configuration share capability and protocol decisions", () => {
  const candidate = {
    available: true,
    enabled: true,
    credential: true,
    capabilitySource: "unknown",
    input: ["text"],
    output: ["text"],
    protocol: "dashscope",
    model: "wan2.7-image",
  };
  assert.equal(modelEligibility(candidate).generation, true);
  assert.equal(
    modelEligibility({ ...candidate, enabled: false }).generation,
    false,
  );
  assert.equal(
    modelEligibility({ ...candidate, model: "wanx-x-painting" }).generation,
    false,
  );
  assert.match(
    modelEligibility({ ...candidate, model: "wanx-x-painting" })
      .generationReason,
    /仅登记/,
  );
});
test("provider-neutral lifecycle persists acceptance before polling and resumes without submit", async () => {
  const request = compileRemoteRequest(plan(), plan().items[0]),
    states = [];
  let submitted = 0,
    queries = 0,
    saved;
  const adapter = {
    id: "test-protocol",
    version: 1,
    prepare: async () => ({ endpoint: "https://example.com" }),
    submit: async () => {
      submitted++;
      return { state: "accepted", taskId: "original" };
    },
    query: async (receipt) => {
      assert.equal(saved.taskId, "original");
      queries++;
      return { state: "completed", urls: ["https://example.com/image.png"] };
    },
  };
  const registry = createAdapterRegistry([adapter]);
  await executeRemote(request, registry.get(adapter.id), {
    onReceipt: (receipt) => {
      states.push(receipt.state);
      saved = receipt;
    },
  });
  assert.deepEqual(states, ["dispatching", "accepted", "completed"]);
  assert.equal(submitted, 1);
  assert.equal(queries, 1);
  const receipt = {
    schema: "art/remote-receipt-v1",
    adapter: adapter.id,
    adapterVersion: 1,
    baseUrl: "https://example.com",
    state: "accepted",
    taskId: "original",
    requestHash: hash(request),
  };
  await executeRemote(request, adapter, {
    receipt,
    onReceipt: (value) => {
      saved = value;
    },
  });
  assert.equal(submitted, 1);
  assert.equal(queries, 2);
  await assert.rejects(
    executeRemote(request, adapter, {
      receipt: { ...receipt, state: "dispatching" },
    }),
    /禁止重复提交/,
  );
  await assert.rejects(
    executeRemote(request, adapter, {
      receipt: { ...receipt, requestHash: "other" },
    }),
    /身份/,
  );
});
test("cancellation and uncertain responses never become a false completion or duplicate request", async () => {
  const p = plan(),
    request = compileRemoteRequest(p, p.items[0]);
  let saved,
    submitted = 0,
    cancelled = false;
  const adapter = {
    id: "test-protocol",
    version: 1,
    prepare: async () => ({ endpoint: "https://example.com" }),
    submit: async () => {
      submitted++;
      return { state: "accepted", taskId: "original" };
    },
    query: async () => {
      throw new Error("must not poll after cancellation");
    },
  };
  await assert.rejects(
    executeRemote(request, adapter, {
      cancelled: () => cancelled,
      onReceipt: (receipt) => {
        saved = receipt;
        if (receipt.state === "accepted") cancelled = true;
      },
    }),
    (error) => error.unsettled === true,
  );
  assert.equal(saved.taskId, "original");
  assert.equal(saved.state, "accepted");
  assert.equal(submitted, 1);
  await assert.rejects(
    requestJson("https://example.com", {
      transport: async () => new Response("not-json"),
    }),
    (error) => error.unsettled === true,
  );
  await assert.rejects(
    requestJson("https://example.com", {
      transport: async () => new Response("SECRET", { status: 500 }),
    }),
    (error) => error.unsettled && !error.message.includes("SECRET"),
  );
});
test("receipt persistence failure prevents network submission", async () => {
  const request = compileRemoteRequest(plan(), plan().items[0]);
  let submit = 0;
  const adapter = {
    id: "test",
    version: 1,
    prepare: async () => ({ endpoint: "https://example.com" }),
    submit: async () => {
      submit++;
      return {};
    },
    query: async () => {},
  };
  await assert.rejects(
    executeRemote(request, adapter, {
      onReceipt: () => {
        throw new Error("disk unavailable");
      },
    }),
    /disk unavailable/,
  );
  assert.equal(submit, 0);
});

test("CLI transport rejects malformed success output and never persists raw stderr", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { callBailian } = await import("../lib/transport/cli.mjs");
  const root = await mkdtemp(join(tmpdir(), "art-cli-contract-")),
    file = join(root, "mock.mjs"),
    previous = process.env.BL_BIN;
  process.env.BL_BIN = file;
  try {
    await writeFile(file, "console.log('invalid json');");
    await assert.rejects(callBailian([]), /无效 JSON/);
    await writeFile(
      file,
      "console.error('PRIVATE_KEY_VALUE');process.exit(1);",
    );
    await assert.rejects(
      callBailian([]),
      (error) =>
        !error.message.includes("PRIVATE_KEY_VALUE") &&
        error.message.includes("退出码"),
    );
  } finally {
    previous === undefined
      ? delete process.env.BL_BIN
      : (process.env.BL_BIN = previous);
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit generic credentials preserve gateway prefixes and never fall back to another key", async () => {
  const { dashscopeAdapter } = await import("../lib/adapters/dashscope.mjs");
  const previous = Object.fromEntries(
    ["ART_IMAGE_KEY", "ART_IMAGE_CONNECTION", "DASHSCOPE_API_KEY"].map(
      (key) => [key, process.env[key]],
    ),
  );
  process.env.ART_IMAGE_KEY = "GENERIC_PRIVATE";
  process.env.ART_IMAGE_CONNECTION = JSON.stringify({
    api: "dashscope",
    baseUrl: "https://gateway.example/proxy/",
  });
  process.env.DASHSCOPE_API_KEY = "UNRELATED_PRIVATE";
  try {
    const request = compileRemoteRequest(plan(), plan().items[0]);
    let posted = 0,
      receipt;
    const transport = async (url, options) => {
      posted++;
      assert.equal(
        String(url),
        "https://gateway.example/proxy/api/v1/services/aigc/multimodal-generation/generation",
      );
      assert.equal(options.headers.Authorization, "Bearer GENERIC_PRIVATE");
      return new Response(
        JSON.stringify({
          output: {
            choices: [
              {
                message: {
                  content: [{ image: "https://result.example/image.png" }],
                },
              },
            ],
          },
        }),
      );
    };
    await executeRemote(request, dashscopeAdapter, {
      baseUrl: "https://gateway.example/proxy/",
      transport,
      onReceipt: (value) => {
        receipt = value;
      },
    });
    assert.equal(receipt.baseUrl, "https://gateway.example/proxy");
    assert.ok(!JSON.stringify(receipt).includes("PRIVATE"));
    await executeRemote(request, dashscopeAdapter, {
      baseUrl: "https://gateway.example/proxy/",
      transport,
      receipt,
    });
    assert.equal(posted, 1);
    await assert.rejects(
      dashscopeAdapter.prepare(request, { baseUrl: "https://other.example" }),
      /地址/,
    );
    delete process.env.ART_IMAGE_KEY;
    await assert.rejects(dashscopeAdapter.prepare(request, {}), /凭据/);
  } finally {
    for (const [key, value] of Object.entries(previous))
      value === undefined
        ? delete process.env[key]
        : (process.env[key] = value);
  }
});
