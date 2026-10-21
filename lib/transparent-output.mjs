import sharp from 'sharp';
import {readFile, writeFile} from 'node:fs/promises';
import {join, parse} from 'node:path';

export const TRANSPARENT_OUTPUT = Object.freeze({format:'png',background:'transparent',processor:'chroma-key-v2'});

/** Keep native transparency; otherwise remove the explicitly requested magenta matte.
 * Never infer a white background or erase arbitrary colours in an existing image.
 */
export async function transparentPng(input) {
  const {data,info}=await sharp(input,{limitInputPixels:64*1024*1024}).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let transparent=0,visible=0;
  for(let i=3;i<data.length;i+=4){if(data[i]===0)transparent++;if(data[i]>0)visible++;}
  if(!visible)throw new Error('透明输出失败：图片完全透明，没有可见主体');
  let method='native-alpha';
  if(!transparent){
    method='chroma-key-v2';
    // Infer only the requested magenta matte from border evidence. Near-opaque
    // alpha noise is not native transparency; models also shift the matte hue.
    let border=0;
    const samples=[[],[],[]];
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
      if(x&&y&&x!==info.width-1&&y!==info.height-1)continue;
      border++;
      const i=(y*info.width+x)*4,r=data[i],g=data[i+1],b=data[i+2];
      if(r>180&&b>120&&g<90&&r-g>140&&b-g>100){
        for(let c=0;c<3;c++)samples[c].push(data[i+c]);
      }
    }
    if(samples[0].length/border<0.5)throw new Error('透明输出失败：模型未生成约定的纯色背景，保留原图；请调整生成结果后重试，不能将不透明图当成透明 PNG');
    const matte=samples.map(values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)]);
    const key=i=>Math.min((data[i]-data[i+1])/(matte[0]-matte[1]),(data[i+2]-data[i+1])/(matte[2]-matte[1]));
    // Remove only matte connected to the outside, keeping enclosed same-colour
    // subject details. Include mixed edge pixels to remove coloured fringes.
    const pixels=info.width*info.height,seen=new Uint8Array(pixels),queue=new Uint32Array(pixels);
    let head=0,tail=0;
    const visit=p=>{if(!seen[p]){seen[p]=1;if(key(p*4)>0.05)queue[tail++]=p;}};
    for(let x=0;x<info.width;x++){visit(x);visit((info.height-1)*info.width+x);}
    for(let y=0;y<info.height;y++){visit(y*info.width);visit(y*info.width+info.width-1);}
    while(head<tail){
      const p=queue[head++],x=p%info.width;
      if(x)visit(p-1);if(x<info.width-1)visit(p+1);
      if(p>=info.width)visit(p-info.width);if(p<pixels-info.width)visit(p+info.width);
    }
    for(let p=0;p<tail;p++){
      const i=queue[p]*4,excess=key(i);
      const alpha=excess>=0.9?0:Math.min(1,1-excess);
      data[i+3]=Math.round(alpha*data[i+3]);
      if(alpha>0){
        // Unmix the magenta matte to avoid coloured fringes on antialiased edges.
        for(let c=0;c<3;c++)data[i+c]=Math.max(0,Math.min(255,(data[i+c]-matte[c]*(1-alpha))/alpha));
      }else{data[i]=data[i+1]=data[i+2]=0;}
    }
  }
  let clear=0,opaque=0;
  for(let i=3;i<data.length;i+=4){if(data[i]===0)clear++;if(data[i]>0)opaque++;}
  if(!clear||!opaque)throw new Error('透明输出失败：需要同时存在透明背景和可见主体，原图已保留');
  return {buffer:await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer(),method};
}

export async function processTransparentFiles(directory,files,{cancelled=()=>false}={}) {
  const result=[];
  for(const file of files){
    if(cancelled())throw new Error('透明输出处理已取消');
    if(file!==parse(file).base)throw new Error('产物路径非法');
    const {buffer,method}=await transparentPng(await readFile(join(directory,file)));
    if(cancelled())throw new Error('透明输出处理已取消');
    const name=parse(file).name+'--transparent.png';
    try{await writeFile(join(directory,name),buffer,{flag:'wx'});}
    catch(error){if(error.code!=='EEXIST'||!(await readFile(join(directory,name))).equals(buffer))throw error;}
    result.push({file:name,source:file,method});
  }
  return result;
}
