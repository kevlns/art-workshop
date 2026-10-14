import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, link, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { hash } from "../shared.mjs";
import { boundedBody, RemoteError } from "../transport/http.mjs";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function download(receipt, context) {
  if (!context.outputDir) return { urls: receipt.urls };
  if (!/^[a-zA-Z0-9_.-]+$/.test(context.prefix))
    throw new Error("产物前缀无效");
  await mkdir(context.outputDir, { recursive: true });
  const files = [];
  for (const [index, url] of receipt.urls.entries()) {
    if (context.cancelled?.()) throw new Error("本地下载已取消，上游已完成");
    // A pre-signed download receives no model credential, including on redirects.
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 60000),
      timer = setInterval(() => {
        if (context.cancelled?.()) controller.abort();
      }, 100);
    let buffer;
    try {
      const response = await (context.transport ?? fetch)(url, {
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error("图片下载失败（HTTP " + response.status + "）");
      buffer = await boundedBody(response, 64 * 1024 * 1024);
    } finally {
      clearTimeout(timeout);
      clearInterval(timer);
    }
    const info = await sharp(buffer, {
      limitInputPixels: 64 * 1024 * 1024,
    }).metadata();
    if (!["png", "jpeg", "webp"].includes(info.format))
      throw new Error("生成产物不是可支持的图片格式");
    const file =
        context.prefix +
        (index ? "--" + (index + 1) : "") +
        "." +
        (info.format === "jpeg" ? "jpg" : info.format),
      path = join(context.outputDir, file);
    const temporary = path + ".tmp-" + randomUUID();
    try {
      await writeFile(temporary, buffer, { flag: "wx" });
      try {
        await link(temporary, path);
      } catch (error) {
        if (
          error.code !== "EEXIST" ||
          hash(await readFile(path)) !== hash(buffer)
        )
          throw error;
      }
    } finally {
      await rm(temporary, { force: true });
    }
    files.push(file);
  }
  return { files, urls: receipt.urls };
}
/** Provider-neutral lifecycle. Persist each transition before polling or downloading. */
export async function executeRemote(request, adapter, context = {}) {
  const cancelled = context.cancelled ?? (() => false),
    requestHash = hash(request);
  let receipt = context.receipt,
    baseUrl = context.baseUrl?.replace(/\/$/, "") ?? receipt?.baseUrl;
  const persist = async (value) => {
    receipt = { ...receipt, ...value };
    await context.onReceipt?.(structuredClone(receipt));
  };
  if (request.transport.version !== adapter.version)
    throw new Error("图片协议执行版本已变化，请重新预演");
  if (
    receipt &&
    (receipt.requestHash !== requestHash ||
      receipt.adapter !== adapter.id ||
      receipt.adapterVersion !== adapter.version ||
      receipt.baseUrl !== baseUrl)
  )
    throw new Error("上游任务与当前请求身份不一致；禁止重新提交");
  if (receipt?.state === "dispatching")
    throw new RemoteError("上次提交结果未知；禁止重复提交", {
      unsettled: true,
    });
  try {
    if (!receipt) {
      if (cancelled()) throw new Error("任务已取消，尚未提交");
      const prepared = await adapter.prepare(request, { ...context, baseUrl });
      baseUrl = prepared.endpoint ?? baseUrl;
      if (typeof baseUrl !== "string" || !baseUrl)
        throw new Error("协议适配器未提供执行地址");
      if (cancelled()) throw new Error("任务已取消，尚未提交");
      await persist({
        schema: "art/remote-receipt-v1",
        adapter: adapter.id,
        adapterVersion: adapter.version,
        requestHash,
        baseUrl,
        state: "dispatching",
        submittedAt: new Date().toISOString(),
      });
      if (cancelled()) {
        await persist({ state: "cancelled", message: "请求尚未发出，已取消" });
        throw new RemoteError("请求尚未发出，已取消", {
          code: "upstream_cancelled",
        });
      }
      const submitted = await adapter.submit(request, {
        ...context,
        baseUrl,
        prepared,
      });
      await persist(submitted);
    }
    while (receipt.state === "accepted") {
      if (cancelled())
        throw new RemoteError("本地等待已停止，上游停止未确认", {
          unsettled: true,
        });
      const next = await adapter.query(receipt, { ...context, baseUrl });
      await persist(next);
      if (receipt.state === "accepted")
        await pause(context.pollMilliseconds ?? 500);
    }
    if (receipt.state === "failed" || receipt.state === "cancelled")
      throw new RemoteError(receipt.message ?? "上游执行未成功", {
        code:
          receipt.state === "cancelled"
            ? "upstream_cancelled"
            : "upstream_failed",
      });
    if (
      receipt.state !== "completed" ||
      !Array.isArray(receipt.urls) ||
      !receipt.urls.length
    )
      throw new RemoteError("协议适配器返回无效完成结果", { unsettled: true });
    if (receipt.urls.length !== request.count)
      throw new RemoteError("上游产物数量与冻结请求不同");
    return await download(receipt, context);
  } catch (error) {
    if (receipt?.state === "dispatching" && !error.unsettled)
      await persist({ state: "failed", message: error.message });
    if (receipt?.state === "accepted" || receipt?.state === "dispatching") {
      error.unsettled = true;
      context.onRemoteCancel?.();
    }
    // A completed upstream job stays settled even if downloading its result fails.
    if (receipt?.state === "completed") error.unsettled = false;
    throw error;
  }
}
