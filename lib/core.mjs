import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hash, readJson, id, keys, text, texts, choice, writeJson } from './shared.mjs';
import { ROOT, loadProject, projectPath } from './project.mjs';
import { TOOL_ROOT } from './settings.mjs';
import {EXAMPLE_CONFIG,STYLE_SCHEMA_VERSION,STYLE_BOUNDARY,OBSERVATION_SCOPES} from './style-contract.mjs';
export {EXAMPLE_CONFIG} from './style-contract.mjs';

export function guidance() { return readJson(join(TOOL_ROOT, 'rules', 'core-guidance.json')); }

export {validateStyleConfig as validateCoreConfig} from './style-review.mjs';
import {validateStyleConfig as validateCoreConfig,validateIssues,unresolvedIssues,resolvedRecommendation} from './style-review.mjs';

export function validateReport(report, projectId) {
  keys(report, ['schema', 'schemaVersion', 'project', 'id', 'summary', 'observations', 'recommendation', 'issues', 'notes', 'decisions', 'provenance'], 'report');
  if(report.schemaVersion!==STYLE_SCHEMA_VERSION)throw new Error('风格报告职责版本已变化，请重新分析，不能采用旧报告');
  if (report.schema !== 'art-workshop/style-report' || report.project !== projectId) throw new Error('风格报告身份不匹配');
  id(report.id, 'report.id'); text(report.summary, 'report.summary', 300);
  if (!Array.isArray(report.observations)) throw new Error('observations 必须为数组');
  for (const item of report.observations) {
    keys(item, ['source', 'scope', 'feature', 'evidence', 'confidence'], 'observation');
    text(item.source, 'source', 1024); choice(item.scope, OBSERVATION_SCOPES, 'scope');
    text(item.feature, 'feature'); text(item.evidence, 'evidence');
    if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) throw new Error('confidence 必须在 0～1');
  }
  texts(report.notes, 'notes', { empty: true }); validateIssues(report);
  validateCoreConfig(report.recommendation); return report;
}

export function freezeCore({ projectId, report, root = ROOT, note = '确认采用此报告推荐配置', history=[] }) {
  const project = loadProject(projectId, root); validateReport(report, projectId);
  if (unresolvedIssues(report).length) throw new Error('仍有待决定的问题；记录取舍后再采用');
  const body = { schema: 'art-workshop/core', schemaVersion:STYLE_SCHEMA_VERSION, project: projectId, id: report.id,
    guidance: guidance(root), config: resolvedRecommendation(report), report, approvedAt: new Date().toISOString(), approvalNote: text(note, 'approvalNote'), decisionHistory: history };
  const core = { ...body, coreHash: hash(body) };
  const path = projectPath(root, projectId, 'cores', report.id);
  if (existsSync(path)) throw new Error('核心已冻结，不能覆写；新风格请使用新身份');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(core, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  if (!project.cores.includes(report.id)) project.cores.push(report.id);
  if (!project.defaultCore) project.defaultCore = report.id;
  try { writeJson(join(root, 'projects', projectId, 'project.json'), project); }
  catch (error) { unlinkSync(path); throw error; }
  return core;
}
export function loadCore(projectId, coreId, root = ROOT) {
  const project = loadProject(projectId, root);
  if (!project.cores.includes(coreId)) throw new Error(`核心 ${coreId} 不属于工程 ${projectId}`);
  const core = readJson(projectPath(root, projectId, 'cores', coreId));
  const { coreHash, ...body } = core;
  if (core.schema !== 'art-workshop/core' || core.project !== projectId || core.id !== coreId || hash(body) !== coreHash) throw new Error('冻结核心身份或哈希校验失败');
  if(core.schemaVersion!==STYLE_SCHEMA_VERSION)throw new Error('旧风格核心需派生并重新分析采用，不能自动转换造型、材质或光照约束');
  validateCoreConfig(core.config); return core;
}
export function selectCore(project, job, requested, root = ROOT) {
  if (requested && job.core && requested !== job.core) throw new Error('指定核心与任务绑定冲突；请明确修改任务的 core');
  const selected = requested ?? job.core ?? project.defaultCore;
  if (!selected) throw new Error('未选定基础核心；请指定 core，不能猜测或跨工程回退');
  return { core: loadCore(project.id, selected, root), source: requested ? '显式选择' : job.core ? '任务绑定' : '工程默认' };
}

const strengths={required:'必须',default:'默认倾向',avoid:'避免'};
export function corePrompt(core) {
  validateCoreConfig(core.config);
  return [STYLE_BOUNDARY,'默认倾向可按任务调整；有适用条件的规则仅在条件成立时使用。',
    ...core.config.rules.map(rule=>`${strengths[rule.strength]}${rule.when?'（'+rule.when+'）':''}：${rule.instruction}`)].join('\n');
}
export function coreNegative(core) {
  // Conditional exclusions stay in the positive contract; flattening them into
  // unconditional negatives would erase the explicitly approved exceptions.
  return core.config.rules.filter(rule=>rule.strength==='avoid'&&!rule.when).map(rule=>rule.instruction).join(', ');
}
