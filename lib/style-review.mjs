import {hash} from './shared.mjs';
import {STYLE_SCHEMA_VERSION} from './style-contract.mjs';
import {inspectStyleReport,unresolvedIssues,resolvedRecommendation} from './style-report.mjs';
export {validateStyleConfig} from './style-contract.mjs';
export {issueFingerprint,validateIssues,applyOption,unresolvedIssues,resolvedRecommendation} from './style-report.mjs';
export function styleSourceHash(record){return hash({config:record.config,references:record.references});}
export function styleEvidenceHash(record){return hash({references:record.references,analysis:record.config.analysis??null});}
export function styleReviewState(record){
  if(!record.report)return {ready:false,stale:false,openIssues:[],reason:'请先生成风格报告'};
  if(record.report.data?.schemaVersion!==STYLE_SCHEMA_VERSION)return {ready:false,stale:true,openIssues:[],reason:'历史报告已保留，请生成新版风格报告'};
  const validity=inspectStyleReport(record.report.data,{project:record.project,id:record.id});if(!validity.valid)return {ready:false,stale:true,openIssues:[],reason:validity.reason};
  const stale=record.report.sourceHash!==styleSourceHash(record),openIssues=unresolvedIssues(record.report.data).map(i=>i.id);
  return {ready:!stale&&!openIssues.length,stale,openIssues,recommendation:resolvedRecommendation(record.report.data),reason:stale?'草稿或参考已修改，请复核报告':openIssues.length?`还有 ${openIssues.length} 项待决定；确认取舍后即可采用`:'风格方案已就绪，可确认采用'};
}
