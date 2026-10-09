import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hash, readJson, id, keys, text, texts, integer, choice, hex, writeJson } from './shared.mjs';
import { ROOT, loadProject, projectPath } from './project.mjs';
import { TOOL_ROOT } from './settings.mjs';

export const EXAMPLE_CONFIG = {
  medium: 'illustration',
  shape: { contour: 'rounded', detail: 'low' },
  render: { shading: 'cel', toneSteps: 2, outline: { enabled: true, color: '#34445C', width: 0.004 }, highlights: 'hard-edge', finish: 'matte', texture: 'none' },
  lighting: { direction: 'top-front', contrast: 'medium' },
  color: { preserveIdentity: true, shadowShift: 'cool' },
  domains: { cell: { treatment: 'organic', signature: '保留圆润生物轮廓，科幻点缀仅作用于自身表面。' } }
};
export function guidance() { return readJson(join(TOOL_ROOT, 'rules', 'core-guidance.json')); }

export function validateCoreConfig(config) {
  keys(config, ['medium', 'shape', 'render', 'lighting', 'color', 'domains'], 'core');
  choice(config.medium, ['illustration', 'painting', 'pixel-art', 'photography'], 'medium');
  keys(config.shape, ['contour', 'detail'], 'shape');
  choice(config.shape.contour, ['rounded', 'angular', 'mixed'], 'shape.contour');
  choice(config.shape.detail, ['low', 'medium', 'high'], 'shape.detail');
  const r = config.render;
  keys(r, ['shading', 'toneSteps', 'outline', 'highlights', 'finish', 'texture'], 'render');
  choice(r.shading, ['cel', 'flat', 'smooth', 'painterly', 'pixel'], 'render.shading');
  choice(r.highlights, ['hard-edge', 'soft', 'none'], 'render.highlights');
  choice(r.finish, ['matte', 'glossy'], 'render.finish');
  choice(r.texture, ['none', 'visible'], 'render.texture');
  keys(r.outline, ['enabled', 'color', 'width'], 'render.outline');
  if (typeof r.outline.enabled !== 'boolean') throw new Error('outline.enabled 必须为布尔值');
  hex(r.outline.color, 'outline.color');
  if (typeof r.outline.width !== 'number' || !Number.isFinite(r.outline.width) || r.outline.width < 0 || r.outline.width > 0.03
    || r.outline.enabled && r.outline.width === 0 || !r.outline.enabled && r.outline.width !== 0) throw new Error('描边开关与宽度矛盾');
  if (['cel', 'flat', 'pixel'].includes(r.shading)) integer(r.toneSteps, 'toneSteps', 1, 8);
  else if (r.toneSteps !== null) throw new Error('连续或笔触明暗不应同时冻结固定色阶数');
  if (r.shading === 'cel' && (r.toneSteps < 2 || r.highlights === 'soft' || r.texture !== 'none')) throw new Error('赛璐璐与色阶、高光或纹理规则矛盾');
  if (r.shading === 'flat' && r.toneSteps !== 1) throw new Error('平涂只能定义一个主色阶');
  if (config.medium === 'pixel-art' && r.shading !== 'pixel' || config.medium !== 'pixel-art' && r.shading === 'pixel') throw new Error('像素媒介与渲染方式矛盾');
  if (config.medium === 'photography' && (r.shading !== 'smooth' || r.outline.enabled)) throw new Error('摄影媒介与渲染或轮廓描边矛盾');
  keys(config.lighting, ['direction', 'contrast'], 'lighting');
  choice(config.lighting.direction, ['top-front', 'front', 'left', 'right', 'diffuse'], 'lighting.direction');
  choice(config.lighting.contrast, ['low', 'medium', 'high'], 'lighting.contrast');
  keys(config.color, ['preserveIdentity', 'shadowShift'], 'color');
  if (typeof config.color.preserveIdentity !== 'boolean') throw new Error('preserveIdentity 必须为布尔值');
  choice(config.color.shadowShift, ['cool', 'warm', 'neutral'], 'shadowShift');
  if (!config.domains || typeof config.domains !== 'object' || Array.isArray(config.domains)) throw new Error('domains 必须为对象');
  for (const [kind, domain] of Object.entries(config.domains)) {
    id(kind, 'domain kind'); keys(domain, ['treatment', 'signature'], `domains.${kind}`);
    choice(domain.treatment, ['organic', 'hard-surface', 'emissive', 'structure', 'symbol'], 'domain.treatment');
    text(domain.signature, 'domain.signature', 80);
    if (/背景|居中|留白|画幅|水印|seed|模型|分辨率|只能出现|唯一主体|不得出现第二|必须.*(?:红色|蓝色|绿色|白色|黑色)/i.test(domain.signature)) throw new Error('题材描述越过职责边界');
  }
  return config;
}

export function validateReport(report, projectId) {
  keys(report, ['schema', 'project', 'id', 'summary', 'observations', 'recommendation', 'conflicts', 'uncertainties', 'provenance'], 'report');
  if (report.schema !== 'art-workshop/style-report' || report.project !== projectId) throw new Error('风格报告身份不匹配');
  id(report.id, 'report.id'); text(report.summary, 'report.summary', 300);
  if (!Array.isArray(report.observations)) throw new Error('observations 必须为数组');
  for (const item of report.observations) {
    keys(item, ['source', 'scope', 'feature', 'evidence', 'confidence'], 'observation');
    text(item.source, 'source', 1024); choice(item.scope, ['style', 'content', 'asset'], 'scope');
    text(item.feature, 'feature'); text(item.evidence, 'evidence');
    if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) throw new Error('confidence 必须在 0～1');
  }
  texts(report.conflicts, 'conflicts', { empty: true }); texts(report.uncertainties, 'uncertainties', { empty: true });
  validateCoreConfig(report.recommendation); return report;
}

export function freezeCore({ projectId, report, root = ROOT, note = '确认采用此报告推荐配置' }) {
  const project = loadProject(projectId, root); validateReport(report, projectId);
  if (report.conflicts.length || report.uncertainties.length) throw new Error('报告仍有冲突或未确定项；处理后再冻结');
  const body = { schema: 'art-workshop/core', project: projectId, id: report.id,
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
  validateCoreConfig(core.config); return core;
}
export function selectCore(project, job, requested, root = ROOT) {
  if (requested && job.core && requested !== job.core) throw new Error('指定核心与任务绑定冲突；请明确修改任务的 core');
  const selected = requested ?? job.core ?? project.defaultCore;
  if (!selected) throw new Error('未选定基础核心；请指定 core，不能猜测或跨工程回退');
  return { core: loadCore(project.id, selected, root), source: requested ? '显式选择' : job.core ? '任务绑定' : '工程默认' };
}

const labels = { illustration: '数字插画', painting: '绘画', 'pixel-art': '像素艺术', photography: '摄影',
  rounded: '圆润', angular: '棱角明确', mixed: '圆润与棱角结合', low: '低', medium: '中', high: '高',
  cel: '赛璐璐硬边明暗', flat: '平涂', smooth: '连续明暗', painterly: '笔触塑形', pixel: '像素色块',
  'hard-edge': '硬边色块高光', soft: '柔和高光', none: '无', matte: '哑光', glossy: '光泽', visible: '可见',
  'top-front': '顶偏前', front: '正前', left: '左侧', right: '右侧', diffuse: '漫射', cool: '偏冷', warm: '偏暖', neutral: '中性',
  organic: '有机表面', 'hard-surface': '硬表面', emissive: '发光形态', structure: '连接结构', symbol: '简洁符号' };
export function corePrompt(core, kinds = []) {
  const c = core.config, r = c.render;
  const lines = [`媒介：${labels[c.medium]}。轮廓：${labels[c.shape.contour]}；细节密度：${labels[c.shape.detail]}。`,
    `明暗：${labels[r.shading]}${r.toneSteps === null ? '' : `，${r.toneSteps} 个主色阶`}。${labels[r.highlights]}；表面${labels[r.finish]}；纹理${labels[r.texture]}。`,
    r.outline.enabled ? `轮廓描边：${r.outline.color}，粗细约画幅宽度的 ${r.outline.width * 100}%。` : '不使用轮廓描边。',
    `主光源：${labels[c.lighting.direction]}；明暗对比：${labels[c.lighting.contrast]}。阴影偏色：${labels[c.color.shadowShift]}。`,
    c.color.preserveIdentity ? '保留内容声明的身份色，色相分别按实体与效果声明执行。' : '色相按本张内容声明执行。'];
  for (const kind of new Set(kinds)) {
    const domain = c.domains[kind]; if (domain) lines.push(`${kind}：${labels[domain.treatment]}；${domain.signature}`);
  }
  return lines.join('\n');
}
export function coreNegative(core) {
  const r = core.config.render;
  return [...(r.texture === 'none' ? ['表面纹理堆砌'] : []), ...(r.shading === 'cel' ? ['平滑明暗过渡', '柔和高光', '写实反射'] : []),
    ...(core.config.shape.detail === 'low' ? ['繁复细节', '繁复纹样'] : [])].join(', ');
}
