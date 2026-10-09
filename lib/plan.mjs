import { hash, keys, integer, text } from './shared.mjs';
export function execution(project, overrides = {},local = {}) {
  keys(overrides, ['model','size','promptExtend','perValue','watermark'], 'execution');
  const e = {model:'qwen-image-3.0-pro',size:'1024*1024',promptExtend:false,perValue:1,watermark:false,...project.execution,...local,...overrides};
  keys(e, ['model','size','promptExtend','perValue','watermark'], 'execution');
  text(e.model,'model'); if (!/^\d+\*\d+$/.test(e.size)) throw new Error('size 必须是明确像素尺寸');
  const [w,h] = e.size.split('*').map(Number); integer(w,'width',256,4096); integer(h,'height',256,4096);
  integer(e.perValue,'perValue',1,4);
  for (const k of ['promptExtend','watermark']) if(typeof e[k] !== 'boolean') throw new Error(`${k} 必须为布尔值`);
  return e;
}
export function finishPlan(body) {
  const items = body.items.map(x => ({...x,inputHash:hash({...x,execution:x.execution??body.execution})}));
  const plan = {schema:'art-workshop/plan',...body,items}; return {...plan,planHash:hash(plan)};
}
export function validatePlan(plan) {
  if(plan.schema !== 'art-workshop/plan' || !['generate','edit'].includes(plan.module) || !plan.items?.length) throw new Error('不是有效的当前计划');
  const {planHash,...body} = plan; if(hash(body)!==planHash) throw new Error('计划已改变；请修改任务后重新预演');
  for(const {inputHash,...item} of plan.items) {
    execution({},item.execution??plan.execution);
    if(hash({...item,execution:item.execution??plan.execution})!==inputHash) throw new Error('计划项校验失败');
  }
}
export function selectItems(plan,{item,variant,offset=0,limit}={}) {
  integer(offset,'offset'); if(limit!==undefined) integer(limit,'limit',1);
  let result=plan.items.filter(x=>(!item||x.itemId===item)&&(!variant||x.variantId===variant));
  if(!result.length) throw new Error('没有匹配的计划项');
  const ids=[...new Set(result.map(x=>x.itemId))].slice(offset,limit===undefined?undefined:offset+limit);
  return result.filter(x=>ids.includes(x.itemId));
}
export function buildArgs(plan,item,outDir,prefix) {
  const e=item.execution??plan.execution, args=['image',plan.module==='edit'?'edit':'generate'];
  for(const path of item.imageArgs) args.push('--image',path);
  args.push('--prompt',item.prompt,'--model',e.model,'--size',e.size,'--n',String(e.perValue));
  if(item.negativeBlock) args.push('--negative-prompt',item.negativeBlock);
  args.push('--seed',String(item.seed),'--prompt-extend',String(e.promptExtend),'--watermark',String(e.watermark),'--out-dir',outDir,'--out-prefix',prefix);
  return args;
}
