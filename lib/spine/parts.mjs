import sharp from 'sharp';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {projectPath} from '../video/path.mjs';

export function identifier(value) {
  if (typeof value !== 'string' || !/^[\p{L}\p{N}_-]{1,96}$/u.test(value) || /^(con|prn|aux|nul|(?:com|lpt)\d)$/i.test(value)) throw Error('无效部件或资源名：'+value);
  return value;
}
const transparent = {r:0,g:0,b:0,alpha:0};
export function sheet(width,height) { return sharp({create:{width,height,channels:4,background:transparent}}); }
function dimensions(actual, expected, label) {
  if(actual.width !== expected.width || actual.height !== expected.height) throw Error(label+' 尺寸与定位矩形不一致');
}
export async function splitParts(root, recipe, out) {
  const source = await projectPath(root,recipe.sourceImage ?? recipe.prototype);
  const {width,height} = await sharp(source).metadata();
  if(width*height>32e6 || !Array.isArray(recipe.parts) || !recipe.parts.length || recipe.parts.length>256) throw Error('需要原型和 1–256 个有序部件');
  const images = join(out,'images');
  await mkdir(images);
  const names = new Set(), layers=[], parts=[];
  let pixels=0, patched;
  for (const part of recipe.parts) {
    const name=identifier(part.name), key=name.toLowerCase();
    if(names.has(key)) throw Error('部件名重复：'+name);
    names.add(key);
    const {left,top,width:w,height:h}=part.rect ?? {};
    if(![left,top,w,h].every(Number.isSafeInteger)||left<0||top<0||w<1||h<1||left+w>width||top+h>height) throw Error(name+' 超出母版');
    pixels+=w*h;
    if(pixels>64e6) throw Error('部件总像素过大');
    const pivot=part.pivot ?? [left+w/2,top+h/2];
    if(!Array.isArray(pivot)||pivot.length!==2||!pivot.every(Number.isFinite)) throw Error('轴心使用母版像素坐标 [x,y]');
    let fullSize, textureWidth=w, textureHeight=h;
    let image=sharp(source).extract(part.rect).ensureAlpha();
    if(part.replacement) {
      const replacement=await projectPath(root,part.replacement);
      const size=await sharp(replacement).metadata();
      if(size.width*h!==size.height*w) throw Error(name+' 补绘图与部件矩形宽高比不一致');
      textureWidth=size.width; textureHeight=size.height; pixels+=Math.max(0,size.width*size.height-w*h);
      if(pixels>64e6) throw Error('部件总像素过大');
      fullSize=sharp(replacement).ensureAlpha();
      image=fullSize.clone().resize(w,h);
    }
    let coverage;
    if(part.mask) {
      const mask=await projectPath(root,part.mask), size=await sharp(mask).metadata();
      // The alpha channel carries coverage; an opaque grayscale mask uses luminance.
      let pipeline=sharp(mask);
      if(size.width===width && size.height===height) pipeline=pipeline.extract(part.rect);
      else dimensions(size,{width:w,height:h},name+' 蒙版');
      coverage=await (size.hasAlpha ? pipeline.extractChannel('alpha') : pipeline.greyscale()).raw().toBuffer();
    }
    if(part.replacement) {
      patched ??= await sharp(source).toColourspace('srgb').ensureAlpha().raw().toBuffer();
      const replacement=await image.clone().toColourspace('srgb').ensureAlpha().raw().toBuffer();
      for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
        const local=y*w+x, origin=((y+top)*width+x+left)*4;
        const mix=coverage ? coverage[local]/255 : 1;
        if(mix===0) continue;
        const a=patched[origin+3]*(1-mix), b=replacement[local*4+3]*mix;
        for(let c=0;c<3;c++) patched[origin+c]=a+b ? Math.round((patched[origin+c]*a+replacement[local*4+c]*b)/(a+b)) : 0;
        patched[origin+3]=Math.round(a+b);
      }
    }
    if(coverage) {
      const alpha=await sharp(coverage,{raw:{width:w,height:h,channels:1}}).toColourspace('srgb').joinChannel(coverage,{raw:{width:w,height:h,channels:1}}).png().toBuffer();
      image=image.composite([{input:alpha,blend:'dest-in'}]);
      if(fullSize) {
        const textureMask=await sharp(alpha).resize(textureWidth,textureHeight).png().toBuffer();
        fullSize=fullSize.composite([{input:textureMask,blend:'dest-in'}]);
      }
    }
    const bytes=await image.png().toBuffer();
    await writeFile(join(images,name+'.png'),fullSize ? await fullSize.png().toBuffer() : bytes);
    layers.push({input:bytes,left,top});
    parts.push({name,textureWidth,textureHeight,rect:part.rect,pivot,occludedBy:part.occludedBy ?? [],image:'images/'+name+'.png'});
  }
  for(const part of parts) if(!Array.isArray(part.occludedBy)||part.occludedBy.some(id=>!parts.some(p=>p.name===id) || id===part.name)) throw Error('遮挡关系引用了无效部件：'+part.name);
  await sheet(width,height).composite(layers).png().toFile(join(out,'assembled.png'));
  if(patched) await sharp(patched,{raw:{width,height,channels:4}}).png().toFile(join(out,'patched.png'));
  const metadata={width,height,sourceImage:recipe.sourceImage ?? recipe.prototype,parts,...(patched?{patched:"patched.png"}:{})};
  await writeFile(join(out,'parts.json'),JSON.stringify(metadata,null,2));
  return metadata;
}
