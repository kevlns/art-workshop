import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hash, readJson, id, keys, text, texts, choice, writeJson } from './shared.mjs';
import { ROOT, loadProject, projectPath } from './project.mjs';
import { TOOL_ROOT } from './settings.mjs';
import {ownedPath} from './workspace.mjs';
import {EXAMPLE_CONFIG,STYLE_SCHEMA_VERSION,STYLE_BOUNDARY,OBSERVATION_SCOPES,RULE_TOPICS,RULE_LABELS} from './style-contract.mjs';
export {EXAMPLE_CONFIG} from './style-contract.mjs';

export function guidance() { return readJson(join(TOOL_ROOT, 'rules', 'core-guidance.json')); }

export {validateStyleConfig as validateCoreConfig} from './style-contract.mjs';
export {validateReport} from './style-report.mjs';
import {validateReport} from './style-report.mjs';
import {validateStyleConfig as validateCoreConfig,validateIssues,unresolvedIssues,resolvedRecommendation} from './style-review.mjs';

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
/** Publish a saved style while retaining every prior execution snapshot by hash. */
export function syncStyleCore(root, record) {
  if (!Array.isArray(record.config.rules) || ['discarded','cleanup-required'].includes(record.status)) return () => {};
  validateCoreConfig({rules:record.config.rules});
  const path=projectPath(root,record.project,'cores',record.id),previous=existsSync(path)?readJson(path):null;
  if(previous){const {coreHash,...body}=previous;if(hash(body)!==coreHash||previous.id!==record.id||previous.project!==record.project)throw new Error('风格核心身份或哈希校验失败');}
  const projectFile=join(root,'projects',record.project,'project.json'),previousProject=loadProject(record.project,root),project=structuredClone(previousProject);
  const body={schema:'art-workshop/core',schemaVersion:STYLE_SCHEMA_VERSION,project:record.project,id:record.id,
    revision:record.revision,guidance:guidance(),config:{rules:structuredClone(record.config.rules)},
    report:record.report?.data??previous?.report??null,approvedSamples:structuredClone(record.samples??[]),
    savedAt:record.updatedAt??record.createdAt};
  const core={...body,coreHash:hash(body)},history=ownedPath(dirname(path),'core-history');
  for(const snapshot of [previous,core].filter(Boolean)){
    const file=ownedPath(history,snapshot.coreHash+'.json');
    if(existsSync(file)){if(hash(readJson(file))!==hash(snapshot))throw new Error('历史风格快照完整性校验失败');}
    else {mkdirSync(history,{recursive:true});writeFileSync(file,JSON.stringify(snapshot,null,2)+'\n',{encoding:'utf8',flag:'wx'});}
  }
  const rollback=()=>{if(previous)writeJson(path,previous);else if(existsSync(path))unlinkSync(path);writeJson(projectFile,previousProject);};
  try{
    writeJson(path,core);
    if(!project.cores.includes(record.id)){project.cores.push(record.id);project.defaultCore??=record.id;project.revision=(project.revision??1)+1;writeJson(projectFile,project);}
  }catch(error){rollback();throw error;}
  record.status='frozen';record.coreHash=core.coreHash;
  return rollback;
}
export function loadCore(projectId, coreId, root = ROOT) {
  const project = loadProject(projectId, root);
  if (!project.cores.includes(coreId)) throw new Error(`核心 ${coreId} 不属于工程 ${projectId}`);
  const recordFile=join(dirname(projectPath(root,projectId,'cores',coreId)),'style.json'),record=existsSync(recordFile)?readJson(recordFile):null;
  if(record&&['discarded','cleanup-required'].includes(record.status))throw new Error('风格已归档或不可用，请选择有效风格');
  const core = readJson(projectPath(root, projectId, 'cores', coreId));
  const { coreHash, ...body } = core;
  if (core.schema !== 'art-workshop/core' || core.project !== projectId || core.id !== coreId || hash(body) !== coreHash) throw new Error('冻结核心身份或哈希校验失败');
  if(core.revision!==undefined&&record&&(record.revision!==core.revision||record.coreHash!==coreHash))throw new Error('风格保存尚未完成，请重新读取并保存；不能执行不匹配的版本');
  if(core.schemaVersion!==STYLE_SCHEMA_VERSION)throw new Error('旧风格核心需派生并重新分析采用，不能自动转换造型、材质或光照约束');
  validateCoreConfig(core.config); return core;
}
export function selectCore(project, job, requested, root = ROOT) {
  if (requested && job.core && requested !== job.core) throw new Error('指定核心与任务绑定冲突；请明确修改任务的 core');
  const selected = requested ?? job.core ?? project.defaultCore;
  if (!selected) throw new Error('未选定基础核心；请指定 core，不能猜测或跨工程回退');
  return { core: loadCore(project.id, selected, root), source: requested ? '显式选择' : job.core ? '任务绑定' : '工程默认' };
}

export function corePrompt(core) {
  validateCoreConfig(core.config);
  return [STYLE_BOUNDARY,'默认倾向可按任务调整；有适用条件的规则仅在条件成立时使用。',
    ...RULE_TOPICS.flatMap(topic=>{
      const seen=new Set();
      const rules=core.config.rules.filter(rule=>rule.scope===topic.id&&!(rule.strength==='avoid'&&!rule.when.trim()&&rule.negative?.length)).filter(rule=>{
        const key=JSON.stringify([rule.strength,rule.instruction.trim(),rule.when.trim(),rule.negative??[]]);
        if(seen.has(key))return false;seen.add(key);return true;
      });
      return rules.length?[`【${topic.label}】`,...rules.map(rule=>{
        const terms=(rule.negative??[]).filter(term=>!rule.instruction.includes(term));
        return `${RULE_LABELS[rule.strength]}${rule.when.trim()?'（'+rule.when+'）':''}：${rule.instruction}${terms.length?'；排除表达：'+[...new Set(terms)].join('、'):''}`;
      })]:[];
    })].join('\n');
}
/** Explicit unconditional terms only. Never infer negation or evaluate conditions. */
export function coreNegative(core){
  validateCoreConfig(core.config);
  const seen=new Set(),terms=[];
  for(const rule of core.config.rules){
    if(rule.strength!=='avoid'||rule.when.trim())continue;
    for(const value of rule.negative??[]){
      const term=value.trim(),key=term.normalize('NFKC').toLowerCase();
      if(!seen.has(key)){seen.add(key);terms.push(term);}
    }
  }
  return terms.join(', ');
}
