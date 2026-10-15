import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hash, readJson, id, keys, text, texts, integer, choice, hex, writeJson } from './shared.mjs';
import { ROOT, loadProject, projectPath } from './project.mjs';
import { TOOL_ROOT } from './settings.mjs';
import {EXAMPLE_CONFIG,STYLE_SCHEMA_VERSION,STYLE_BOUNDARY,OBSERVATION_SCOPES} from './style-contract.mjs';
export {EXAMPLE_CONFIG} from './style-contract.mjs';

export function guidance() { return readJson(join(TOOL_ROOT, 'rules', 'core-guidance.json')); }

export function validateCoreConfig(config) {
  keys(config, ['medium', 'render', 'color'], 'core');
  choice(config.medium, ['illustration', 'painting', 'pixel-art', 'photography'], 'medium');
  const r = config.render;
  keys(r, ['shading', 'toneSteps', 'detail', 'outline', 'highlights', 'brushwork', 'valueContrast'], 'render');
  choice(r.shading, ['cel', 'flat', 'smooth', 'painterly', 'pixel'], 'render.shading');
  choice(r.highlights, ['hard-edge', 'soft', 'none'], 'render.highlights');
  choice(r.detail, ['low', 'medium', 'high'], 'render.detail');
  choice(r.brushwork, ['clean', 'visible'], 'render.brushwork');
  choice(r.valueContrast, ['low', 'medium', 'high'], 'render.valueContrast');
  keys(r.outline, ['enabled', 'color', 'width'], 'render.outline');
  if (typeof r.outline.enabled !== 'boolean') throw new Error('outline.enabled 必须为布尔值');
  hex(r.outline.color, 'outline.color');
  if (typeof r.outline.width !== 'number' || !Number.isFinite(r.outline.width) || r.outline.width < 0 || r.outline.width > 0.03
    || r.outline.enabled && r.outline.width === 0 || !r.outline.enabled && r.outline.width !== 0) throw new Error('描边开关与宽度矛盾');
  if (['cel', 'flat', 'pixel'].includes(r.shading)) integer(r.toneSteps, 'toneSteps', 1, 8);
  else if (r.toneSteps !== null) throw new Error('连续或笔触明暗不应同时冻结固定色阶数');
  if (r.shading === 'cel' && (r.toneSteps < 2 || r.highlights === 'soft' || r.brushwork !== 'clean')) throw new Error('赛璐璐与色阶、高光或笔触规则矛盾');
  if (r.shading === 'flat' && r.toneSteps !== 1) throw new Error('平涂只能定义一个主色阶');
  if (config.medium === 'pixel-art' && r.shading !== 'pixel' || config.medium !== 'pixel-art' && r.shading === 'pixel') throw new Error('像素媒介与渲染方式矛盾');
  if (config.medium === 'photography' && (r.shading !== 'smooth' || r.outline.enabled)) throw new Error('摄影媒介与渲染或轮廓描边矛盾');
  keys(config.color, ['saturation', 'contrast', 'shadowShift'], 'color');
  choice(config.color.saturation, ['low', 'medium', 'high'], 'color.saturation');
  choice(config.color.contrast, ['low', 'medium', 'high'], 'color.contrast');
  choice(config.color.shadowShift, ['cool', 'warm', 'neutral'], 'shadowShift');
  return config;
}

export function validateReport(report, projectId) {
  keys(report, ['schema', 'schemaVersion', 'project', 'id', 'summary', 'observations', 'recommendation', 'conflicts', 'uncertainties', 'provenance'], 'report');
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
  texts(report.conflicts, 'conflicts', { empty: true }); texts(report.uncertainties, 'uncertainties', { empty: true });
  validateCoreConfig(report.recommendation); return report;
}

export function freezeCore({ projectId, report, root = ROOT, note = '确认采用此报告推荐配置' }) {
  const project = loadProject(projectId, root); validateReport(report, projectId);
  if (report.conflicts.length || report.uncertainties.length) throw new Error('报告仍有冲突或未确定项；处理后再冻结');
  const body = { schema: 'art-workshop/core', schemaVersion:STYLE_SCHEMA_VERSION, project: projectId, id: report.id,
    guidance: guidance(root), config: report.recommendation, report, approvedAt: new Date().toISOString(), approvalNote: text(note, 'approvalNote') };
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

const labels = { illustration: '数字插画', painting: '绘画', 'pixel-art': '像素艺术', photography: '摄影',
  low: '低', medium: '中', high: '高', clean:'干净无明显笔触', visible:'可见笔触',
  cel: '赛璐璐硬边明暗', flat: '平涂', smooth: '连续明暗', painterly: '笔触塑形', pixel: '像素色块',
  'hard-edge': '硬边色块高光', soft: '柔和高光', none: '无', cool: '偏冷', warm: '偏暖', neutral: '中性' };
export function corePrompt(core) {
  const c = core.config, r = c.render;
  const lines = [STYLE_BOUNDARY,`媒介：${labels[c.medium]}。描绘细节密度：${labels[r.detail]}；结构与部件完整服从任务。`,
    `明暗：${labels[r.shading]}${r.toneSteps === null ? '' : `，${r.toneSteps} 个主色阶`}。高光画法：${labels[r.highlights]}；笔触：${labels[r.brushwork]}；明度对比：${labels[r.valueContrast]}。`,
    r.outline.enabled ? `轮廓描边：${r.outline.color}，粗细约画幅宽度的 ${r.outline.width * 100}%。` : '不使用轮廓描边。',
    `色彩饱和度倾向：${labels[c.color.saturation]}；色相对比倾向：${labels[c.color.contrast]}；阴影偏色：${labels[c.color.shadowShift]}。`,
    '主体身份色、造型、物理材质与实际光源按任务声明执行，不从参考作品继承。'];
  return lines.join('\n');
}
export function coreNegative(core) {
  const r = core.config.render;
  return [...(r.brushwork === 'clean' ? ['额外绘画笔触'] : []), ...(r.shading === 'cel' ? ['连续渐变式明暗', '软边高光画法'] : [])].join(', ');
}
