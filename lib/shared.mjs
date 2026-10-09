import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export function hash(value) {
  const ordered = v => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
}
export function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { throw new Error(`读取 ${path} 失败：${e.message}`); }
}
export function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + '.tmp-' + randomUUID();
  writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(temporary, path);
}
export function keys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须为对象`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label} 不支持字段 ${key}`);
}
export function text(value, label, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} 必须是 1～${max} 字的精炼文本`);
  if (/\bTODO\b|<[^>]+>|待填写/.test(value)) throw new Error(`${label} 有未完成的占位符`);
  return value;
}
export function id(value, label = 'id') {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(value)) throw new Error(`${label} 必须使用小写字母、数字、连字符`);
  return value;
}
export function integer(value, label, min = 0, max = 2147483647) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} 必须为 ${min}～${max} 的整数`);
  return value;
}
export function choice(value, values, label) {
  if (!values.includes(value)) throw new Error(`${label} 必须为 ${values.join('/')}`);
  return value;
}
export function texts(value, label, { empty = false, max = 160 } = {}) {
  if (!Array.isArray(value) || (!empty && !value.length)) throw new Error(`${label} 必须为${empty ? '' : '非空'}数组`);
  value.forEach(x => text(x, label, max)); return value;
}
export function hex(value, label) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${label} 必须为 #RRGGBB`);
  return value.toUpperCase();
}
