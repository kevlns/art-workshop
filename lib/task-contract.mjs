import {keys,text,integer,description} from './shared.mjs';
import {background} from './presentation.mjs';

export const GENERATION_FIELDS = Object.freeze({
  item:['id','seed','intent','entities','effects','relations','composition','mustRead','textSpecs','variants','design'],
  entity:['id','kind','appearance','color','role','count','action','material'],
  effect:['id','kind','target','color','relation','count'],
  relation:['from','to','action'],
  variant:['id','composition','seed'],
});
export const EDIT_FIELDS = Object.freeze(['id','source','changes','preserve','mustRead','textSpecs','seed']);
export const TEXT_SPEC_FIELDS = Object.freeze(['content','hierarchy','zone','fontHint']);
export const TEXT_SPEC_EXAMPLE = Object.freeze({content:'开始游戏',hierarchy:'主标题',zone:'底部居中',fontHint:'粗体无衬线'});
const TEXT_SPEC_RULE = 'mustRead 是必须看清的视觉特征，不是画面文字；画面文字单独使用 textSpecs 数组，每项 content/hierarchy/zone 必填、fontHint 可选，均为不限制字数的描述。草稿允许未填完，预案要求完整；不自动转换旧条目或开启文字权限。';
export function textSpecs(value,path='textSpecs',{draft=false}={}){
  if(value===undefined)return [];
  if(!Array.isArray(value))throw new Error(path+' 必须是数组');
  for(const [index,entry] of value.entries()){
    const at=`${path}[${index}]`;
    keys(entry,TEXT_SPEC_FIELDS,at);
    for(const field of TEXT_SPEC_FIELDS){
      if(draft){if(entry[field]!==undefined&&typeof entry[field]!=='string')throw new Error(at+'.'+field+' 必须是字符串');}
      else if(field!=='fontHint'||entry[field]!==undefined)description(entry[field],at+'.'+field);
    }
  }
  const seen=new Set();
  return value.filter(entry=>{const key=JSON.stringify(TEXT_SPEC_FIELDS.map(field=>entry[field]));if(seen.has(key))return false;seen.add(key);return true;});
}
export function textSpecLine(entry){return `文字：「${entry.content}」｜层级：${entry.hierarchy}｜位置：${entry.zone}${entry.fontHint!==undefined?'｜字形：'+entry.fontHint:''}`;}
export function textFidelityNegative(original,entries){return entries.length?[original,'文字扭曲, 笔画错乱, 模糊小字'].filter(Boolean).join(', '):original;}
function draftComposition(value,path){
  if(value===undefined)return;
  keys(value,['preset','view','direction','occupancy','effectIntensity','background','focalTarget','lightDirection','lightQuality'],path);
  for(const field of ['lightDirection','lightQuality'])if(value[field]!==undefined&&typeof value[field]!=='string')throw new Error(path+'.'+field+' 必须是字符串');
}
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
    textSpecs:{fields:TEXT_SPEC_FIELDS,required:['content','hierarchy','zone'],example:TEXT_SPEC_EXAMPLE},
    composition:{lightDirection:'可选，须由资产规格开放词表；可单项覆盖默认值',lightQuality:'可选，须由资产规格开放词表；可单项覆盖默认值'},
    backgrounds:{transparent:{type:'transparent'},solid:{type:'solid',color:'#FFFFFF'},gradient:{type:'gradient',from:'#FFFFFF',to:'#000000'},scene:{type:'scene',description:'场景说明'}},
    effectExample:{id:'glow',kind:'放射光束',target:'subject',color:'橙黄',relation:'从主体裂纹向外辐射',count:1},
    rules:[TEXT_SPEC_RULE,'material 可选，使用具体名词说明主体物理材质，不设字数上限。','光照词表和默认值由资产规格成对声明；未开放能力时携带光照字段会报错。','动态需求描述不设字数上限，不截断或为通过校验删减内容；必填项仍须为非空文本。','effects 不支持 description；用 kind 描述效果类型，relation 描述位置和作用方式。','target、from、to 和 focalTarget 必须引用当前资产内的实体ID。','资产规格由 asset 配置；主体、身份色、材质、光效和构图属于任务需求。','草稿允许尚未填完；预案要求内容完整，不会发起生图。'],
  }:{models:TASK_MODEL_FIELDS,textSpecs:{fields:TEXT_SPEC_FIELDS,required:['content','hierarchy','zone'],example:TEXT_SPEC_EXAMPLE},fields:{item:EDIT_FIELDS,instruction:['target','instruction'],backgroundChange:['target','value']},examples:{changes:[{target:'detail',instruction:'减少内部切面'},{target:'outline',instruction:'加粗外轮廓'},{target:'light',instruction:'光源改为右上方暖光'}],preserve:[{target:'shape',instruction:'保持整体外形'}]},rules:[TEXT_SPEC_RULE,'动态需求描述不设字数上限，不截断或为通过校验删减内容；必填项仍须为非空文本。','编辑任务使用 source、changes、preserve、mustRead；保留未修改范围。','target 是具体修改或保留的范围名称，例如 shape、outline、color、detail；同一范围可以修改局部并保留其他特征，不按名称机械判定矛盾。','修改背景使用 {target:background,value:{type:transparent}} 或 solid/color、gradient/from/to、scene/description。透明输出自动处理为带实际透明像素的 PNG。','绑定风格核心时由核心决定风格，不再声明 style 范围。']};
}
/** Drafts may be incomplete, but never accept fields the compiler will discard. */
export function validateTaskDraft(config){
  if(config.analysis!==undefined){keys(config.analysis,['provider','model'],'analysis');text(config.analysis.provider,'analysis.provider');text(config.analysis.model,'analysis.model');}
  if(config.generation!==undefined){keys(config.generation,['backend','remote','options'],'generation');text(config.generation.backend,'generation.backend');if(config.generation.remote){keys(config.generation.remote,['provider','model'],'generation.remote');text(config.generation.remote.provider,'generation.remote.provider');text(config.generation.remote.model,'generation.remote.model');}if(config.generation.options!==undefined){if(config.generation.backend==='bailian')throw new Error('远程后端不支持本地采样参数');taskSamplingOptions(config.generation.options);}}
  if(config.kind==='edit'){
    if(config.items!==undefined&&!Array.isArray(config.items))throw new Error('items 必须是数组');
    for(const [i,item] of (config.items??[]).entries()){
      keys(item,EDIT_FIELDS,`items[${i}]`);
      textSpecs(item.textSpecs,`items[${i}].textSpecs`,{draft:true});
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
    textSpecs(item.textSpecs,`items[${index}].textSpecs`,{draft:true});
    draftComposition(item.composition,`items[${index}].composition`);
    for(const [field,shape] of [['entities','entity'],['effects','effect'],['relations','relation'],['variants','variant']]){
      if(item[field]!==undefined&&!Array.isArray(item[field]))throw new Error(`items[${index}].${field} 必须是数组`);
      for(const [row,value] of (item[field]??[]).entries())keys(value,GENERATION_FIELDS[shape],`items[${index}].${field}[${row}]`);
    }
    for(const [row,entity] of (item.entities??[]).entries())if(entity.material!==undefined&&typeof entity.material!=='string')throw new Error(`items[${index}].entities[${row}].material 必须是字符串`);
    for(const [row,variant] of (item.variants??[]).entries())draftComposition(variant.composition,`items[${index}].variants[${row}].composition`);
  }
  return config;
}
