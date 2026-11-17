import {chromium} from 'playwright-core';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile} from 'node:fs/promises';
import {TextureAtlas} from '@esotericsoftware/spine-webgl';
import sharp from 'sharp';
import {projectPath} from '../video/path.mjs';
import {sheet} from './parts.mjs';

async function openBrowser() {
  const options={headless:true,args:['--enable-unsafe-swiftshader']};
  if(process.env.SPINE_CHROMIUM_PATH) return chromium.launch({...options,executablePath:process.env.SPINE_CHROMIUM_PATH});
  const channels=process.platform==='win32'?['msedge','chrome',undefined]:['chrome',undefined];
  for(const channel of channels) {
    try { return await chromium.launch({...options,channel}); } catch(error) { if(!/not found|doesn't exist|distribution/i.test(error.message)) throw error; }
  }
  throw Error('取帧需要 Chromium、Chrome 或 Edge，可用 SPINE_CHROMIUM_PATH 指向浏览器。');
}
export async function captureFrames(root,recipe,out) {
  const {clip,source,width=384,height=384,frames=8}=recipe;
  if(![width,height,frames].every(Number.isSafeInteger)||Math.min(width,height,frames)<1||Math.max(width,height)>2048||frames>120||width*height*frames>32e6) throw Error('取帧尺寸或帧数超出范围');
  const file=await projectPath(root,source);
  if(!/\.json$/i.test(file)) throw Error('指定 Spine 4.2 JSON 导出');
  const rig=JSON.parse(await readFile(file,'utf8'));
  if(!rig.skeleton?.spine?.startsWith('4.2.') || !Object.hasOwn(rig.animations??{},clip)) throw Error('骨架版本或所选动作无效');
  let atlasFile=await projectPath(root,source.slice(0,-5)+'.atlas');
  const atlas=await readFile(atlasFile,'utf8').catch(async e=>{
    if(e.code!=='ENOENT') throw e;
    return readFile(await projectPath(root,source.slice(0,-5)+'.atlas.txt'),'utf8');
  });
  const textures=[];
  for(const page of new TextureAtlas(atlas).pages) {
    const png=await readFile(await projectPath(root,join(dirname(file),page.name)));
    textures.push('data:image/png;base64,'+png.toString('base64'));
  }
  const browser=await openBrowser();
  try {
    const page=await browser.newPage({viewport:{width,height}});
    await page.setContent('<canvas></canvas>');
    await page.addScriptTag({path:join(dirname(fileURLToPath(import.meta.resolve('@esotericsoftware/spine-webgl'))),'iife/spine-webgl.js')});
    const duration=await page.evaluate(async ({rig,atlas,textures,clip,width,height})=>{
      const canvas=document.querySelector('canvas');canvas.width=width;canvas.height=height;
      const context=new spine.ManagedWebGLRenderingContext(canvas,{alpha:true,preserveDrawingBuffer:true});
      const pages=new spine.TextureAtlas(atlas);
      for(let i=0;i<pages.pages.length;i++) {
        const image=await createImageBitmap(await (await fetch(textures[i])).blob(),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
        pages.pages[i].setTexture(new spine.GLTexture(context,image));
      }
      const data=new spine.SkeletonJson(new spine.AtlasAttachmentLoader(pages)).readSkeletonData(rig);
      const skeleton=new spine.Skeleton(data); skeleton.updateWorldTransform(spine.Physics.reset);
      const bounds=data.width && data.height ? data : skeleton.getBoundsRect();
      if(!(bounds.width>0 && bounds.height>0)) throw Error('骨架缺少可见范围');
      const scene=new spine.SceneRenderer(canvas,context);
      const scale=Math.max(bounds.width/width,bounds.height/height);
      scene.camera.position.set((bounds.x??0)+bounds.width/2,(bounds.y??0)+bounds.height/2,0);
      scene.camera.setViewport(width*scale,height*scale);scene.camera.update();
      const state=new spine.AnimationState(new spine.AnimationStateData(data));
      window.renderFrame=time=>{
        state.clearTracks();skeleton.setToSetupPose();state.setAnimation(0,clip,false).trackTime=time;
        state.apply(skeleton);skeleton.updateWorldTransform(spine.Physics.reset);
        const gl=context.gl;gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
        scene.begin();scene.drawSkeleton(skeleton,pages.pages[0].pma);scene.end();return canvas.toDataURL('image/png').split(',')[1];
      };
      return data.findAnimation(clip).duration;
    },{rig,atlas,textures,clip,width,height});
    const times=recipe.times ?? Array.from({length:frames},(_,i)=>duration*i/frames);
    if(!Array.isArray(times)||!times.length||times.length>120||width*height*times.length>32e6||times.some(t=>!Number.isFinite(t)||t<0||t>duration+1e-5)) throw Error('时间点必须位于动作时长内');
    const columns=Math.ceil(Math.sqrt(times.length)),layers=[],raw=[],files=[];
    for(const [i,time] of times.entries()) {
      const png=Buffer.from(await page.evaluate(t=>window.renderFrame(t),time),'base64');
      const name='frame-'+String(i+1).padStart(3,'0')+'.png';
      await writeFile(join(out,name),png);files.push(name);
      layers.push({input:png,left:i%columns*width,top:Math.floor(i/columns)*height});
      if(recipe.gif) raw.push(await sharp(png).ensureAlpha().raw().toBuffer());
    }
    await sheet(width*columns,height*Math.ceil(times.length/columns)).composite(layers).png().toFile(join(out,'comparison.png'));
    if(recipe.gif) {
      const delay=times.map((t,i)=>Math.max(20,Math.round(1000*((times[i+1]??duration)-t))));
      await sharp(Buffer.concat(raw),{raw:{width,height:height*raw.length,channels:4,pageHeight:height}}).gif({delay,loop:0}).toFile(join(out,'preview.gif'));
    }
    return {clip,duration,width,height,times,files,comparison:'comparison.png',...(recipe.gif?{gif:'preview.gif'}:{})};
  } finally {await browser.close();}
}
