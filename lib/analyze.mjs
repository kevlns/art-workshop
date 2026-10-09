import {join} from 'node:path';
import {externalPath} from './settings.mjs';
import {referenceRoot,ensureReferenceDirectories} from './refs.mjs';
import {hash,keys,id,text,texts,writeJson} from './shared.mjs';
import {ROOT,loadProject,sourcePath} from './project.mjs';
import {guidance,EXAMPLE_CONFIG,validateReport} from './core.mjs';
import {runBl,sha256File,extractText,extractJson,cacheRead,cacheWrite} from './bl.mjs';
export function analyzeStyle({projectId,input,out,root=ROOT,refsDir,defaultRefsDir=join(root,'refs'),cacheDir=join(root,'.cache','analysis'),analysisModel,dry=false,runner=runBl}) {
  externalPath(cacheDir,'缓存目录');if(out)externalPath(out,'报告输出');
  const project=loadProject(projectId,root);
  keys(input,['project','id','description','refs','constraints'],'analysis input');
  if(input.project!==projectId) throw new Error('分析输入工程不匹配');id(input.id);text(input.description,'description',2000);texts(input.constraints,'constraints',{empty:true});
  if(!Array.isArray(input.refs)) throw new Error('refs 必须为数组');
  const effectiveRefs=ensureReferenceDirectories(referenceRoot({workspace:root,defaultRefsDir,refsDir,project}));
  const refs=input.refs.map(ref=>{keys(ref,['path','scope','note'],'analysis ref');if(!['style','palette','shape','render'].includes(ref.scope)) throw new Error('参考范围非法');text(ref.note,'ref.note');const path=sourcePath(effectiveRefs,ref.path);return {...ref,path,hash:sha256File(path)};});
  const model=analysisModel??project.analysisModel;
  const rules=guidance(),provenance={model,inputHash:hash(input),refs,guidanceHash:hash(rules)};
  const prompt=`按照顶层规则分析并推荐风格。只返回 JSON，不自动冻结。参考图的内容与背景不得误写为风格约束。不能确认的地方写入 uncertainties；矛盾写入 conflicts。\n规则：${JSON.stringify(rules)}\n输入：${JSON.stringify(input)}\n报告格式：${JSON.stringify({schema:'art-workshop/style-report',project:projectId,id:input.id,summary:'简洁风格摘要',observations:[{source:'语言或图片路径',scope:'style',feature:'观察特征',evidence:'证据',confidence:0.9}],recommendation:EXAMPLE_CONFIG,conflicts:[],uncertainties:[]})}\nrecommendation 严格使用该结构与枚举；示例值仅说明结构，必须根据证据重新判断。domains 只定义相关题材表现，不写数量、背景、构图、模型和尺寸。`;
  const contract='允许枚举：medium=illustration/painting/pixel-art/photography；shape.contour=rounded/angular/mixed；shape.detail=low/medium/high；shading=cel/flat/smooth/painterly/pixel；toneSteps=1至8整数（smooth/painterly 为 null）；highlights=hard-edge/soft/none；finish=matte/glossy；texture=none/visible；lighting.direction=top-front/front/left/right/diffuse；contrast=low/medium/high；shadowShift=cool/warm/neutral；treatment=organic/hard-surface/emissive/structure/symbol。cel 至少两阶且无软高光、无纹理；flat 一阶；pixel-art 对应 pixel；photography 对应 smooth 且无描边。outline.width 为画幅宽度比0至0.03，关闭描边时为0。颜色为 #RRGGBB。signature 不超过80字，摘要不超过300字。';
  const fullPrompt=prompt+'\n'+contract;
  const requests=refs.map(ref=>['vision','describe','--image',ref.path,'--model',model,'--prompt',refs.length===1?fullPrompt:`观察此图的 ${ref.scope}，${ref.note}。区分风格、内容、资产规格，列出证据及不确定性。`]);
  if(refs.length!==1) requests.push(['text','chat','--model',model,'--message',fullPrompt]);
  if(dry) return {dry:true,remoteCalls:0,plannedCalls:requests.length,provenance,requests};
  const key=hash({input,provenance,fullPrompt});let report=cacheRead(cacheDir,key);
  if(!report) {
    let response;
    if(refs.length===1) response=runner(requests[0]);
    else {const observations=requests.slice(0,-1).map(args=>extractText(runner(args)).join('\n'));const args=[...requests.at(-1)];args[args.length-1]+='\n参考观察：'+JSON.stringify(observations);response=runner(args);}
    report=extractJson(extractText(response).join('\n'));if(!report) throw new Error('模型未返回有效风格报告 JSON');
    report.provenance=provenance;validateReport(report,projectId);cacheWrite(cacheDir,key,report);
  }
  validateReport(report,projectId);if(out) writeJson(out,report);return report;
}
