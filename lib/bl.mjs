/**
 * bl 调用封装 —— 全部通过 execFile 传数组参数，绝不经过 shell。
 * 背景：Windows 下 shell:true 会把带空格/中文的 prompt 拆散；git bash 会静默丢弃参数。
 * 唯一可靠的做法是直接 node 入口脚本 + 数组参数。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let BL_ENTRY = null;

/** 定位 bailian-cli 入口脚本（绕开 .ps1/.cmd shim 与 shell） */
export function resolveBlEntry() {
  if (BL_ENTRY) return BL_ENTRY;
  if (process.env.BL_BIN) return (BL_ENTRY = process.env.BL_BIN);
  // Windows 上先看 APPDATA 标准位置，避免为了找入口去 spawn npm（会触发 DEP0190 噪音）
  const cands = [];
  if (process.env.APPDATA) cands.push(join(process.env.APPDATA, "npm", "node_modules", "bailian-cli", "dist", "bailian.mjs"));
  for (const p of cands) if (existsSync(p)) return (BL_ENTRY = p);
  // 兜底：非标准安装位置才去问 npm
  try {
    const root = execFileSync("npm", ["root", "-g"], {
      encoding: "utf8", shell: process.platform === "win32", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const p = join(root, "bailian-cli", "dist", "bailian.mjs");
    if (existsSync(p)) return (BL_ENTRY = p);
  } catch { /* npm 不可用 */ }
  for (const p of cands) if (existsSync(p)) return (BL_ENTRY = p);
  throw new Error("找不到 bailian-cli 入口；请设置 BL_BIN 指向 bailian-cli/dist/bailian.mjs");
}

/**
 * 运行 bl。默认追加 --output json。
 * dry=true 追加 --dry-run（仅生成类命令有效；查询类命令会忽略它）。
 * parse=false 返回原始字符串（部分命令输出不是 JSON）。
 */
export function runBl(args, { dry = false, parse = true } = {}) {
  const full = [...args, "--output", "json"];
  if (dry) full.push("--dry-run");
  const out = execFileSync(process.execPath, [resolveBlEntry(), ...full], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  if (!parse) return out;
  try { return JSON.parse(out); } catch { return { _raw: out }; }
}

export function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

/** 内容寻址缓存：key = 文件内容哈希，保证同一张图只描述一次 */
export function cacheRead(cacheDir, key) {
  const f = join(cacheDir, key + ".json");
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
}

export function cacheWrite(cacheDir, key, value) {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, key + ".json"), JSON.stringify(value, null, 2), "utf8");
}

/** 从任意形状的响应里捞出所有文本（bl 输出结构可能随版本变化，保持防御性） */
export function extractText(node, acc = []) {
  if (node == null) return acc;
  if (typeof node === "string") { acc.push(node); return acc; }
  if (Array.isArray(node)) { for (const v of node) extractText(v, acc); return acc; }
  if (typeof node === "object") { for (const v of Object.values(node)) extractText(v, acc); return acc; }
  return acc;
}

/** 从模型回复里抠出第一个 JSON 对象（容忍代码块包裹与前后废话） */
export function extractJson(text) {
  const body = String(text).replace(/^[\s\S]*?```(?:json)?/m, "").replace(/```[\s\S]*$/, "");
  const src = body.includes("{") ? body : String(text);
  const start = src.indexOf("{");
  const end = src.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(src.slice(start, end + 1)); } catch { return null; }
}
