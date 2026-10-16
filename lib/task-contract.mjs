import {keys} from './shared.mjs';

export const GENERATION_FIELDS = Object.freeze({
  item:['id','seed','intent','entities','effects','relations','composition','mustRead','variants','design'],
  entity:['id','kind','appearance','color','role','count','action'],
  effect:['id','kind','target','color','relation','count'],
  relation:['from','to','action'],
  variant:['id','composition','seed'],
});
export function taskContract(kind){
  return kind==='generate'?{
    fields:GENERATION_FIELDS,
    effectExample:{id:'glow',kind:'放射光束',target:'subject',color:'橙黄',relation:'从主体裂纹向外辐射',count:1},
    rules:['effects 不支持 description；用 kind 描述效果类型，relation 描述位置和作用方式。','target、from、to 和 focalTarget 必须引用当前资产内的实体ID。','资产规格由 asset 配置；主体、身份色、材质、光效和构图属于任务需求。','草稿允许尚未填完；预案要求内容完整，不会发起生图。'],
  }:{rules:['编辑任务使用 source、changes、preserve、mustRead；保留未修改范围。']};
}
/** Drafts may be incomplete, but never accept fields the compiler will discard. */
export function validateTaskDraft(config){
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
