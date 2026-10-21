import {keys,text,integer} from './shared.mjs';
import {background} from './presentation.mjs';

export const GENERATION_FIELDS = Object.freeze({
  item:['id','seed','intent','entities','effects','relations','composition','mustRead','variants','design'],
  entity:['id','kind','appearance','color','role','count','action'],
  effect:['id','kind','target','color','relation','count'],
  relation:['from','to','action'],
  variant:['id','composition','seed'],
});
export const TASK_MODEL_FIELDS = Object.freeze({analysis:['provider','model'],generation:['backend','remote','options'],remote:['provider','model'],options:['steps','cfg','sampler','scheduler']});
export const LOCAL_SAMPLING_DEFAULTS = Object.freeze({steps:25,cfg:3,sampler:'euler',scheduler:'simple'});
export function taskSamplingOptions(value){
  keys(value,['steps','cfg','sampler','scheduler'],'generation.options');
  if(value.steps!==undefined)integer(value.steps,'steps',1,10000);
  if(value.cfg!==undefined&&(!Number.isFinite(value.cfg)||value.cfg<0||value.cfg>100))throw new Error('cfg 必须为 0～100 的数值');
  for(const field of ['sampler','scheduler'])if(value[field]!==undefined)text(value[field],field,100);
  return value;
}
export function taskContract(kind){
  return kind==='generate'?{
    models:TASK_MODEL_FIELDS,
    fields:GENERATION_FIELDS,
    backgrounds:{transparent:{type:'transparent'},solid:{type:'solid',color:'#FFFFFF'},gradient:{type:'gradient',from:'#FFFFFF',to:'#000000'},scene:{type:'scene',description:'场景说明'}},
    effectExample:{id:'glow',kind:'放射光束',target:'subject',color:'橙黄',relation:'从主体裂纹向外辐射',count:1},
    rules:['动态需求描述不设字数上限，不截断或为通过校验删减内容；必填项仍须为非空文本。','effects 不支持 description；用 kind 描述效果类型，relation 描述位置和作用方式。','target、from、to 和 focalTarget 必须引用当前资产内的实体ID。','资产规格由 asset 配置；主体、身份色、材质、光效和构图属于任务需求。','草稿允许尚未填完；预案要求内容完整，不会发起生图。'],
  }:{models:TASK_MODEL_FIELDS,fields:{item:['id','source','changes','preserve','mustRead','seed'],instruction:['target','instruction'],backgroundChange:['target','value']},examples:{changes:[{target:'detail',instruction:'减少内部切面'},{target:'outline',instruction:'加粗外轮廓'}],preserve:[{target:'shape',instruction:'保持整体外形'}]},rules:['动态需求描述不设字数上限，不截断或为通过校验删减内容；必填项仍须为非空文本。','编辑任务使用 source、changes、preserve、mustRead；保留未修改范围。','target 是具体修改或保留的范围名称，例如 shape、outline、color、detail；同一范围可以修改局部并保留其他特征，不按名称机械判定矛盾。','修改背景使用 {target:background,value:{type:transparent}} 或 solid/color、gradient/from/to、scene/description。透明输出自动处理为带实际透明像素的 PNG。','绑定风格核心时由核心决定风格，不再声明 style 范围。']};
}
/** Drafts may be incomplete, but never accept fields the compiler will discard. */
export function validateTaskDraft(config){
  if(config.analysis!==undefined){keys(config.analysis,['provider','model'],'analysis');text(config.analysis.provider,'analysis.provider');text(config.analysis.model,'analysis.model');}
  if(config.generation!==undefined){keys(config.generation,['backend','remote','options'],'generation');text(config.generation.backend,'generation.backend');if(config.generation.remote){keys(config.generation.remote,['provider','model'],'generation.remote');text(config.generation.remote.provider,'generation.remote.provider');text(config.generation.remote.model,'generation.remote.model');}if(config.generation.options!==undefined){if(config.generation.backend==='bailian')throw new Error('远程后端不支持本地采样参数');taskSamplingOptions(config.generation.options);}}
  if(config.kind==='edit'){
    if(config.items!==undefined&&!Array.isArray(config.items))throw new Error('items 必须是数组');
    for(const [i,item] of (config.items??[]).entries()){
      keys(item,['id','source','changes','preserve','mustRead','seed'],`items[${i}]`);
      for(const scope of ['changes','preserve']){
        if(item[scope]!==undefined&&!Array.isArray(item[scope]))throw new Error(`items[${i}].${scope} 必须是数组`);
        for(const [j,row] of (item[scope]??[]).entries()){
          const path=`items[${i}].${scope}[${j}]`;
          keys(row,scope==='changes'&&row.target==='background'?['target','value']:['target','instruction'],path);
          if(row.target)text(row.target,path+'.target',100);
          if(scope==='changes'&&row.target==='background'&&row.value)background(row.value,true);
        }
      }
    }
    return config;
  }
  if(config.kind!=='generate')return config;
  if(config.items!==undefined&&!Array.isArray(config.items))throw new Error('items 必须是数组');
  for(const [index,item] of (config.items??[]).entries()){
    keys(item,GENERATION_FIELDS.item,`items[${index}]`);
    for(const [field,shape] of [['entities','entity'],['effects','effect'],['relations','relation'],['variants','variant']]){
      if(item[field]!==undefined&&!Array.isArray(item[field]))throw new Error(`items[${index}].${field} 必须是数组`);
      for(const [row,value] of (item[field]??[]).entries())keys(value,GENERATION_FIELDS[shape],`items[${index}].${field}[${row}]`);
    }
  }
  return config;
}
