import { spawn } from "node:child_process";
import { resolveBlEntry } from "../bl.mjs";
/** Shared subprocess transport; a malformed success response is still a failure. */
export function callBailian(
  args,
  { cancelled = () => false, onRemoteCancel = () => {} } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [resolveBlEntry(), ...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      err = "",
      overflow = false,
      stopping = false;
    const uncertain = () => {
      if (!stopping) {
        stopping = true;
        onRemoteCancel();
      }
    };
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.length > 64 * 1024 * 1024) {
        overflow = true;
        uncertain();
        child.kill();
      }
    });
    child.stderr.on("data", (chunk) => {
      err = (err + chunk).slice(-4000);
    });
    const timer = setInterval(() => {
      if (cancelled()) {
        uncertain();
        child.kill();
      }
    }, 100);
    child.once("error", (error) => {
      clearInterval(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearInterval(timer);
      if (cancelled() || overflow || code !== 0) {
        uncertain();
        return reject(
          new Error(
            cancelled()
              ? "任务已取消"
              : overflow
                ? "远程响应过大"
                : "bl 调用失败（退出码 " + code + "）",
          ),
        );
      }
      try {
        const value = JSON.parse(out);
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error();
        resolve(value);
      } catch {
        uncertain();
        reject(new Error("远程客户端返回无效 JSON；执行结果未确认"));
      }
    });
  });
}
