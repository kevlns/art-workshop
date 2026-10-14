import { buildSources, resolveApiKey } from "bailian-cli-core";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { compileRemoteRequest } from "../generation-policy.mjs";
import { resolveModel } from "../model-registry.mjs";
import { requestJson, RemoteError } from "../transport/http.mjs";
export function buildRemoteArgs(plan, item, outDir, prefix) {
  const request = compileRemoteRequest(plan, item),
    spec = resolveModel(
      request.api,
      request.model,
      request.module,
      !!request.images.length,
    );
  return commandPreview(request, spec, outDir, prefix);
}
function commandPreview(request, spec, outDir, prefix) {
  const args = ["image", request.module === "edit" ? "edit" : "generate"];
  for (const image of request.images) args.push("--image", image);
  args.push(
    "--prompt",
    request.prompt,
    "--model",
    request.model,
    "--size",
    request.size,
    "--n",
    String(request.count),
    "--seed",
    String(request.seed),
  );
  for (const rule of Object.values(spec.fields))
    if (request.parameters[rule.wire] !== undefined)
      args.push(rule.cli, String(request.parameters[rule.wire]));
  if (request.negativePrompt)
    args.push("--negative-prompt", request.negativePrompt);
  args.push("--out-dir", outDir, "--out-prefix", prefix);
  return args;
}
export function serializeRequest(request, images = request.images) {
  return {
    model: request.model,
    input: {
      messages: [
        {
          role: "user",
          content: [
            ...images.map((image) => ({ image })),
            { text: request.prompt },
          ],
        },
      ],
    },
    parameters: request.parameters,
  };
}
function endpoint(value) {
  const base = new URL(value);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !(
      base.protocol === "https:" ||
      (base.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
    )
  )
    throw new Error("图片接口地址无效");
  return base;
}
function credentials(context) {
  let configured;
  if (process.env.ART_IMAGE_CONNECTION) {
    configured = JSON.parse(process.env.ART_IMAGE_CONNECTION);
    if (configured.api !== "dashscope" || !process.env.ART_IMAGE_KEY)
      throw new Error("图片连接与协议或凭据不匹配");
    if (
      context.baseUrl &&
      endpoint(context.baseUrl).href.replace(/\/$/, "") !==
        endpoint(configured.baseUrl).href.replace(/\/$/, "")
    )
      throw new Error("图片连接地址与冻结请求不同");
  }
  const credential = configured
    ? { token: process.env.ART_IMAGE_KEY, baseUrl: configured.baseUrl }
    : resolveApiKey(buildSources({}));
  const base = endpoint(context.baseUrl ?? credential.baseUrl),
    key = credential.token;
  if (!key) throw new Error("未配置图片服务凭据");
  return {
    base,
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
  };
}
async function inputImage(path, policy) {
  if (/^https?:\/\//.test(path) || path.startsWith("data:")) return path;
  const buffer = await readFile(path);
  if (buffer.length > policy.maxBytes)
    throw new Error("输入图片超过模型文件大小限制");
  const info = await sharp(buffer, {
    limitInputPixels: 64 * 1024 * 1024,
  }).metadata();
  if (!policy.formats.includes(info.format))
    throw new Error("输入图片格式不受模型支持");
  if (
    (policy.alpha === false && info.hasAlpha) ||
    info.width < (policy.minAxis ?? 1) ||
    info.height < (policy.minAxis ?? 1) ||
    info.width > (policy.maxAxis ?? Infinity) ||
    info.height > (policy.maxAxis ?? Infinity) ||
    info.width / info.height < (policy.minRatio ?? 0) ||
    info.width / info.height > (policy.maxRatio ?? Infinity)
  )
    throw new Error("输入图片透明通道、尺寸或比例不符合模型限制");
  return (
    "data:image/" +
    (info.format === "jpeg" ? "jpeg" : info.format) +
    ";base64," +
    buffer.toString("base64")
  );
}
function urls(body) {
  const list =
    body.output?.results?.map((entry) => entry.url) ??
    body.output?.choices?.flatMap((choice) =>
      (choice.message?.content ?? [])
        .filter((entry) => entry.image)
        .map((entry) => entry.image),
    );
  if (
    !Array.isArray(list) ||
    !list.length ||
    list.some((url) => {
      try {
        const u = new URL(url);
        return (
          !["https:", "http:"].includes(u.protocol) ||
          !!u.username ||
          !!u.password
        );
      } catch {
        return true;
      }
    })
  )
    throw new RemoteError("图片服务缺少有效的图片结果", { unsettled: true });
  return list;
}
export const dashscopeAdapter = {
  preview: (request) => serializeRequest(request),
  commandPreview: (request, outDir, prefix) =>
    commandPreview(
      request,
      resolveModel(
        request.api,
        request.model,
        request.module,
        !!request.images.length,
      ),
      outDir,
      prefix,
    ),
  id: "dashscope",
  label: "DashScope 图片生成（支持兼容网关）",
  version: 1,
  cancellation: "unsupported",
  async prepare(request, context) {
    const auth = credentials(context),
      images = await Promise.all(
        request.images.map((path) => inputImage(path, request.inputPolicy)),
      );
    return {
      ...auth,
      endpoint: auth.base.href.replace(/\/$/, ""),
      body: serializeRequest(request, images),
    };
  },
  async submit(request, context) {
    const prepared = context.prepared;
    const body = await requestJson(
      new URL(prepared.base.href.replace(/\/$/, "") + request.transport.path),
      {
        ...context,
        timeout: request.transport.timeoutMilliseconds ?? 1800000,
        method: "POST",
        headers: {
          ...prepared.headers,
          ...(request.transport.mode === "async"
            ? { "X-DashScope-Async": "enable" }
            : {}),
        },
        body: prepared.body,
      },
    );
    if (request.transport.mode === "sync")
      return { state: "completed", urls: urls(body) };
    const taskId = body.output?.task_id;
    if (
      typeof taskId !== "string" ||
      !taskId ||
      !/^[a-zA-Z0-9_-]+$/.test(taskId)
    )
      throw new RemoteError("异步响应缺少合法任务身份", { unsettled: true });
    return { state: "accepted", taskId };
  },
  async query(receipt, context) {
    const { base, headers } = credentials(context),
      body = await requestJson(
        new URL(
          base.href.replace(/\/$/, "") +
            "/api/v1/tasks/" +
            encodeURIComponent(receipt.taskId),
        ),
        { ...context, headers },
      );
    if (body.output?.task_id !== receipt.taskId)
      throw new RemoteError("上游返回了其他任务的结果", { unsettled: true });
    const status = body.output?.task_status;
    if (status === "SUCCEEDED") return { state: "completed", urls: urls(body) };
    if (status === "FAILED")
      return { state: "failed", message: "上游图片生成失败" };
    if (status === "CANCELED")
      return { state: "cancelled", message: "上游已取消" };
    if (["PENDING", "RUNNING"].includes(status)) return { state: "accepted" };
    throw new RemoteError("上游任务状态未知；保留原任务身份", {
      unsettled: true,
    });
  },
};
