import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, link, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { hash } from "../shared.mjs";
import { boundedBody, RemoteError } from "../transport/http.mjs";
const imageDigest = buffer => createHash("sha256").update(buffer).digest("hex");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function writeImage(buffer,index,context) {
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
          imageDigest(await readFile(path)) !== imageDigest(buffer)
        )
          throw error;
      }
    } finally {
      await rm(temporary, { force: true });
    }
    return file;
}
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
    files.push(await writeImage(buffer,index,context));

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
      if (submitted.inline) {
        if (!context.outputDir || !/^[a-zA-Z0-9_.-]+$/.test(context.prefix) || submitted.inline.length !== request.count)
          throw new RemoteError("同步图片交付参数或数量无效", {unsettled:true});
        try {
          await mkdir(context.outputDir,{recursive:true});
          const localImages = [];
          for (const [index,buffer] of submitted.inline.entries())
            localImages.push({file:await writeImage(buffer,index,context),sha256:imageDigest(buffer)});
          await persist({state:"completed",localImages});
        } catch {
          throw new RemoteError("图片服务已返回，原请求的本地文件或回执未能保存",{unsettled:true});
        }
      } else await persist(submitted);
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
    if (receipt.state === "completed" && receipt.localImages) {
      if (!context.outputDir || !/^[a-zA-Z0-9_.-]+$/.test(context.prefix) || receipt.localImages.length !== request.count) throw new Error("本地图片回执无效");
      const files = [];
      for (const [index,image] of receipt.localImages.entries()) {
        const prefix = context.prefix + (index ? "--" + (index + 1) : "");
        if (!["png","jpg","webp"].some(ext=>image.file === prefix+"."+ext) ||
            imageDigest(await readFile(join(context.outputDir,image.file))) !== image.sha256) throw new Error("本地图片完整性校验失败");
        files.push(image.file);
      }
      return {files,urls:[]};
    }
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
