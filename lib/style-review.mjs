import {hash,keys,id,text,choice,texts} from './shared.mjs';
import {RULE_SCOPES,RULE_STRENGTHS,STYLE_SCHEMA_VERSION} from './style-contract.mjs';

export function validateStyleConfig(config){
  keys(config,['rules'],'style rules');
  if(!Array.isArray(config.rules)||!config.rules.length||config.rules.length>60)throw new Error('风格必须包含1至60条规则');
  const ids=new Set();
  for(const rule of config.rules){
    keys(rule,['id','scope','strength','instruction','when'],'style rule');
    id(rule.id,'rule.id');if(ids.has(rule.id))throw new Error('规则ID重复');ids.add(rule.id);
    choice(rule.scope,RULE_SCOPES,'rule.scope');choice(rule.strength,RULE_STRENGTHS,'rule.strength');
    text(rule.instruction,'rule.instruction',300);
    if(/本轮|上一[轮版]|上次|本次调整|已[经]?修改|为解决.*冲突/.test(rule.instruction))throw new Error('风格规则必须为独立成稿，不包含迭代过程描述');
    if(typeof rule.when!=='string'||rule.when.length>1000)throw new Error('规则适用条件非法');
  }
  return config;
}
export const issueFingerprint=issue=>hash({id:issue.id,question:issue.question,options:issue.options});
export function validateIssues(report){
  if(!Array.isArray(report.issues)||report.issues.length>30)throw new Error('问题列表非法');
  const ids=new Set();
  for(const issue of report.issues){
    keys(issue,['id','question','options','reopenReason'],'issue');id(issue.id,'issue.id');
    if(ids.has(issue.id))throw new Error('问题ID重复');ids.add(issue.id);text(issue.question,'issue.question',2000);
    if(typeof issue.reopenReason!=='string')throw new Error('问题重新打开原因必须是文本');
    if(!Array.isArray(issue.options)||issue.options.length<2||issue.options.length>5)throw new Error('每个问题需要2至5个具体可执行方案');
    const options=new Set();
    for(const option of issue.options){
      keys(option,['id','label','remove','upsert'],'issue option');id(option.id,'option.id');
      if(options.has(option.id))throw new Error('方案ID重复');options.add(option.id);text(option.label,'option.label',1000);
      texts(option.remove,'option.remove',{empty:true});if(new Set(option.remove).size!==option.remove.length)throw new Error('删除规则重复');
      if(!Array.isArray(option.upsert))throw new Error('方案规则非法');
      if(option.upsert.length)validateStyleConfig({rules:option.upsert});
      applyOption(report.recommendation,option);
    }
  }
  if(!Array.isArray(report.decisions))throw new Error('问题决定必须是数组');
  const decisions=new Set();
  for(const decision of report.decisions){
    keys(decision,['issueId','fingerprint','optionId','note','decidedAt'],'decision');
    const issue=report.issues.find(i=>i.id===decision.issueId);
    if(!issue||issueFingerprint(issue)!==decision.fingerprint||!issue.options.some(o=>o.id===decision.optionId)||decisions.has(issue.id))throw new Error('问题决定与当前问题不匹配');
    decisions.add(issue.id);text(decision.note,'decision.note',2000);text(decision.decidedAt,'decision.decidedAt');
  }
}
export function applyOption(config,option){
  const rules=config.rules.filter(r=>!option.remove.includes(r.id));
  for(const rule of option.upsert){const index=rules.findIndex(r=>r.id===rule.id);if(index<0)rules.push(rule);else rules[index]=rule;}
  return validateStyleConfig({rules});
}
export function unresolvedIssues(report){return report.issues.filter(issue=>!report.decisions.some(d=>d.issueId===issue.id&&d.fingerprint===issueFingerprint(issue)));}
export function styleSourceHash(record){return hash({config:record.config,references:record.references});}
export function styleReviewState(record){
  if(!record.report)return {ready:false,stale:false,openIssues:[],reason:'请先生成风格报告'};
  if(record.report.data.schemaVersion!==STYLE_SCHEMA_VERSION)return {ready:false,stale:true,openIssues:[],reason:'历史报告已保留，请生成新版风格报告'};
  const stale=record.report.sourceHash!==styleSourceHash(record),openIssues=unresolvedIssues(record.report.data).map(i=>i.id);
  return {ready:!stale&&!openIssues.length,stale,openIssues,recommendation:resolvedRecommendation(record.report.data),reason:stale?'草稿或参考已修改，请复核报告':openIssues.length?`还有 ${openIssues.length} 项待决定；确认取舍后即可采用`:'风格方案已就绪，可确认采用'};
}

export function resolvedRecommendation(report){
  return report.decisions.reduce((config,decision)=>{
    const issue=report.issues.find(i=>i.id===decision.issueId);
    if(!issue||issueFingerprint(issue)!==decision.fingerprint)throw new Error('已确认问题发生变化，请重新决定');
    return applyOption(config,issue.options.find(o=>o.id===decision.optionId));
  },report.recommendation);
}
