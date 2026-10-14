import {keys,integer} from './shared.mjs';
export const DIMENSION_CAPABILITIES=Object.freeze({bailian:{min:256,max:4096,step:1,maxArea:4096*4096},comfyui:{min:256,max:4096,step:32,maxArea:4096*4096}});
/** Exhaustive finite grid; nearest pixel distance, then aspect ratio, then area/width. */
export function resolveDimensions(requested,capability){
 keys(requested,['width','height'],'requested dimensions');
 for(const axis of ['width','height'])if(!Number.isFinite(requested[axis])||requested[axis]<=0||requested[axis]>65536)throw new Error('请求尺寸超出有效范围');
 const {min,max,step,maxArea,minArea=1}=capability;
 integer(min,'min',1,16384);integer(max,'max',min,16384);integer(step,'step',1,512);integer(maxArea,'maxArea',1,16384*16384);
 let best;
 const ratio=requested.width/requested.height;
 for(let width=Math.ceil(min/step)*step;width<=max;width+=step){
  const upper=Math.min(max,Math.floor(maxArea/width),width/(capability.minRatio??Number.MIN_VALUE)),low=Math.ceil(Math.max(min,minArea/width,width/(capability.maxRatio??Infinity))/step)*step,high=Math.floor(upper/step)*step;if(high<low)continue;
  // Convex pixel-distance objective: only adjacent heights to the requested height can win.
  const nearest=requested.height/step;
  for(const height of new Set([Math.max(low,Math.min(high,Math.floor(nearest)*step)),Math.max(low,Math.min(high,Math.ceil(nearest)*step))])){
   const score=[(width-requested.width)**2+(height-requested.height)**2,Math.abs(width/height-ratio),width*height,width,height];
   if(!best||score.some((v,i)=>v<best.score[i]&&score.slice(0,i).every((p,k)=>p===best.score[k])))best={width,height,score};
  }
 }
 if(!best)throw new Error('后端没有合法分辨率');
 return {requested:{...requested},actual:{width:best.width,height:best.height},clamped:best.width!==requested.width||best.height!==requested.height,capability:{...capability}};
}
