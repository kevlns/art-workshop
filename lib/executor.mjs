import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildArgs, validatePlan } from './plan.mjs';
import { hash, writeJson } from './shared.mjs';
export { validatePlan } from './plan.mjs';
export { writeJson } from './shared.mjs';
import { runBl, sha256File, resolveBlEntry } from './bl.mjs';
import {loadSettings,externalPath} from './settings.mjs';

function runtimeVersion() {
  try { return JSON.parse(readFileSync(join(dirname(dirname(resolveBlEntry())), 'package.json'), 'utf8')).version ?? 'unknown'; }
  catch { return 'unknown'; }
}
export function executePlan(plan, items, { outputRoot=loadSettings().paths.output, dry = false, runner = runBl, log = console.log } = {}) {
  validatePlan(plan);
  if (!items.length) throw new Error('没有选中任何计划项');
  for (const item of items) {
    const expected = plan.items.find(x => x.inputHash === item.inputHash);
    if (!expected || hash(item) !== hash(expected)) throw new Error('执行项不属于该计划或内容已改变');
  }
  for (const ref of plan.refs) { externalPath(ref.path,'原图/参考图'); if (!existsSync(ref.path) || sha256File(ref.path) !== ref.hash) throw new Error(`参考图已变化：${ref.path}`); }
  externalPath(outputRoot,'输出目录');
  if (dry) {
    const requests = items.map(item => ({ ...(item.design?{design:item.design,execution:item.execution}:{}),itemId: item.itemId, variantId: item.variantId, seed: item.seed,
      inputHash: item.inputHash, args: buildArgs(plan, item, join(outputRoot,'<runId>'), `${item.itemId}--${item.variantId}`) }));
    log(JSON.stringify({ dry: true, remoteCalls: 0, planHash: plan.planHash, requests }, null, 2));
    return { dry: true, requests };
  }
  const runId = `${plan.job.replaceAll('/', '-')}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const runDir = join(outputRoot, runId);
  mkdirSync(runDir, { recursive: true });
  const manifest = { schema: 'art-workshop/run', runId, plan, planHash: plan.planHash, blVersion: runner === runBl ? runtimeVersion() : 'injected',
    startedAt: new Date().toISOString(), items: [], review: [], selections: {} };
  const manifestPath = join(runDir, 'manifest.json');
  const persist = () => {
    manifest.summary = { completed: manifest.items.filter(x => x.status !== 'running').length, expected: items.length,
      ok: manifest.items.filter(x => x.ok).length, failed: manifest.items.filter(x => x.status === 'failed').length };
    writeJson(manifestPath, manifest);
  };
  persist();
  for (const item of items) {
    const prefix = `${item.itemId}--${item.variantId}`;
    const args = buildArgs(plan, item, runDir, prefix);
    const record = { ...structuredClone(item), args, ok: false, status: 'running', files: [], urls: [], outputHashes: {} };
    manifest.items.push(record); persist();
    const before = new Set(readdirSync(runDir));
    try {
      const response = runner(args);
      const fresh = readdirSync(runDir).filter(f => !before.has(f) && /\.(png|jpe?g|webp)$/i.test(f)).sort();
      fresh.forEach((file, index) => {
        const target = `${prefix}${index ? '--' + (index + 1) : ''}${file.slice(file.lastIndexOf('.'))}`;
        if (file !== target) {
          if (existsSync(join(runDir, target))) throw new Error(`输出文件已存在：${target}`);
          renameSync(join(runDir, file), join(runDir, target));
        }
        record.files.push(target); record.outputHashes[target] = sha256File(join(runDir, target));
      });
      record.urls = response.urls ?? [];
      const expectedCount = (item.execution??plan.execution).perValue;
      if (record.files.length !== expectedCount) throw new Error(`期望 ${expectedCount} 张，实际 ${record.files.length} 张`);
      record.ok = true; record.status = 'generated';
      log(`✔ ${item.itemId}/${item.variantId} seed=${item.seed} → ${record.files.join(', ')}`);
    } catch (e) {
      record.status = 'failed'; record.error = String(e.message ?? e).slice(0, 1000);
      log(`✗ ${item.itemId}/${item.variantId}：${record.error}`);
    }
    persist();
  }
  manifest.finishedAt = new Date().toISOString(); persist();
  log(`manifest → ${manifestPath}`);
  return { manifest, manifestPath, runDir };
}

export function outputPath(manifestPath, file) {
  const base = dirname(resolve(manifestPath));
  const path = resolve(base, file);
  const rel = relative(base, path);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../')) throw new Error('输出路径越界');
  return path;
}

export function checkRun(manifest, manifestPath, review = manifest.review ?? []) {
  validatePlan(manifest.plan);
  for (const item of manifest.items) {
    const expected = manifest.plan.items.find(x => x.itemId === item.itemId && x.variantId === item.variantId);
    if (!expected || expected.inputHash !== item.inputHash) throw new Error('执行记录不属于原始计划');
    for (const key of ['prompt', 'seed', 'checks', 'negativeBlock', 'imageArgs', 'execution', 'design']) {
      if (hash({value:item[key]}) !== hash({value:expected[key]})) throw new Error(`执行记录已改变：${item.itemId}.${key}`);
    }
  }
  if (!Array.isArray(review)) throw new Error('review 必须为数组');
  const keys = new Set();
  for (const row of review) {
    // check 导出的失败记录也可保留在人工模板中，但不能被批准。
    if (row.file === null && manifest.items.some(i => i.itemId === row.itemId && i.variantId === row.variantId && !i.files.length && !i.ok)) {
      if (row.accepted === true) throw new Error('无产物的失败项不能通过验收');
      continue;
    }
    const key = `${row.itemId}/${row.variantId}/${row.file}`;
    if (keys.has(key)) throw new Error(`重复 review：${key}`);
    keys.add(key);
    if (!manifest.items.some(i => i.itemId === row.itemId && i.variantId === row.variantId && i.files.includes(row.file))) throw new Error(`review 未匹配产物：${key}`);
    for (const dimension of ['content', 'style', 'asset']) {
      if (!['pass', 'fail', 'pending'].includes(row[dimension])) throw new Error(`review.${dimension} 必须为 pass/fail/pending`);
    }
  }
  return manifest.items.flatMap(item => item.files.length ? item.files.map(file => {
    const path = outputPath(manifestPath, file);
    const integrity = existsSync(path) && sha256File(path) === item.outputHashes[file];
    const row = review.find(r => r.itemId === item.itemId && r.variantId === item.variantId && r.file === file);
    return { itemId: item.itemId, variantId: item.variantId, file, path, integrity, generated: item.ok,
      checks: item.checks, content: row?.content ?? 'pending', style: row?.style ?? 'pending', asset: row?.asset ?? 'pending',
      reason: row?.reason ?? '', accepted: integrity && item.ok && ['content', 'style', 'asset'].every(k => row?.[k] === 'pass') };
  }) : [{ itemId: item.itemId, variantId: item.variantId, file: null, generated: false, accepted: false, error: item.error }]);
}
