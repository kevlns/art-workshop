export class RemoteError extends Error {
  constructor(message, { unsettled = false, code = "remote_error" } = {}) {
    super(message);
    this.name = "RemoteError";
    this.unsettled = unsettled;
    this.code = code;
  }
}
export async function boundedBody(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw new RemoteError("远程响应为空", { unsettled: true });
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit)
        throw new RemoteError("远程响应超过大小限制", { unsettled: true });
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks);
}
/** Authentication is sent only to the configured origin; redirects never forward it. */
export async function requestJson(
  url,
  {
    method = "GET",
    headers = {},
    body,
    cancelled = () => false,
    transport = fetch,
    timeout = 60000,
  } = {},
) {
  const controller = new AbortController(),
    deadline = setTimeout(() => controller.abort(), timeout),
    timer = setInterval(() => {
      if (cancelled()) controller.abort();
    }, 100);
  try {
    const response = await transport(url, {
      method,
      headers,
      redirect: "error",
      signal: controller.signal,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw new RemoteError(
        "图片服务请求失败（HTTP " + response.status + "）",
        { unsettled: response.status >= 500, code: "http_" + response.status },
      );
    let result;
    try {
      result = JSON.parse(
        (await boundedBody(response, 4 * 1024 * 1024)).toString("utf8"),
      );
    } catch (error) {
      if (error instanceof RemoteError) throw error;
      throw new RemoteError("图片服务返回无效 JSON", { unsettled: true });
    }
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new RemoteError("图片服务响应结构无效", { unsettled: true });
    if (result.code)
      throw new RemoteError("图片服务拒绝请求", { code: "provider_rejected" });
    return result;
  } catch (error) {
    if (error instanceof RemoteError) throw error;
    throw new RemoteError("图片服务连接中断或超时，不能确认上游执行结果", {
      unsettled: true,
    });
  } finally {
    clearTimeout(deadline);
    clearInterval(timer);
  }
}
