import {description} from './shared.mjs';
import { keys, choice, text, hex } from './shared.mjs';
export function validateLightProfile(profile){
  const fields=['lightDirection','lightQuality'];
  const declared=fields.some(k=>profile.allowedOverrides?.[k]!==undefined||profile.defaults?.[k]!==undefined);
  if(!declared)return false;
  for(const k of fields){
    const allowed=profile.allowedOverrides?.[k];
    if(!Array.isArray(allowed)||!allowed.length||allowed.some(v=>typeof v!=='string'||!v.trim()))throw new Error('光照方向与质感必须成对声明非空词表：'+k);
    choice(profile.defaults?.[k],allowed,'defaults.'+k);
  }
  return true;
}
export function background(value,allowScene=false) {
  keys(value,['type','color','from','to','description'],'background');
  if(value.type==='transparent') { keys(value,['type'],'transparent background'); return '最终交付透明 PNG。中间图使用均匀纯洋红 #FF00FF 背景供自动去背景；主体不得含洋红背景色、背景投影、渐变或棋盘格；保留完整主体和边缘。'; }
  if(value.type==='solid') { keys(value,['type','color'],'background'); return `纯色背景 ${hex(value.color,'background.color')}，整张背景颜色均匀，无渐变、光晕或纹理。`; }
  if(value.type==='gradient') { keys(value,['type','from','to'],'background'); return `渐变背景，从 ${hex(value.from,'from')} 到 ${hex(value.to,'to')}。`; }
  if(value.type==='scene'&&allowScene) { keys(value,['type','description'],'background'); return `场景背景：${description(value.description,'scene')}。`; }
  throw new Error('背景类型不支持或资产不允许场景');
}
export function presentation(profile,overrides={},design=null) {
  keys(overrides,['preset','view','direction','occupancy','effectIntensity','background','focalTarget','lightDirection','lightQuality'],'composition');
  const light=validateLightProfile(profile);
  for(const k of ['lightDirection','lightQuality']){
    if(!light&&Object.hasOwn(overrides,k))throw new Error('当前资产规格未开放光照词汇：'+k);
  }
  const c={...profile.defaults,...overrides};
  if(light)for(const k of ['lightDirection','lightQuality'])choice(c[k],profile.allowedOverrides[k],k);
  for(const k of ['preset','view','direction','effectIntensity']) choice(c[k],profile.allowedOverrides[k],k);
  const range=profile.allowedOverrides.occupancy;
  if(!Number.isFinite(c.occupancy)||c.occupancy<range.min||c.occupancy>range.max) throw new Error('主体占比越界');
  const bg=background(c.background,profile.constraints.scene);
  return {value:c,prompt:`${profile.presets[c.preset]}。视角：${c.view}；方向：${c.direction}；${design?'保持设计宽高比与四周安全留白':'整体占画幅约 '+c.occupancy*100+'%'}；效果强度：${c.effectIntensity}${light?'；光照：'+c.lightDirection+'，'+c.lightQuality:''}。\n${bg}`,background:bg};
}
export function assetPrompt(profile) {
  const c=profile.constraints;
  return [profile.name,c.text?'允许需求声明的文字':'无文字',c.frame?'允许需求声明的外框':'画幅无装饰外框',c.crop?'允许裁切':'主体和效果边缘完整，四周留出空间',c.shadow?'主体正下方简洁投影':'不添加地面投影'].join('；')+'。';
}
