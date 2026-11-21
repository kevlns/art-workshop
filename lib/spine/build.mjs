// Copyright © 2026 Vant <sl_kevln@163.com>
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import sharp from 'sharp';
import {SkeletonJson,AtlasAttachmentLoader,TextureAtlas,Skeleton,Physics} from '@esotericsoftware/spine-webgl';
import {projectPath} from '../video/path.mjs';
import {applyBinding} from './binding.mjs';
import {identifier,sheet} from './parts.mjs';

export function variantIndex(animations) {
  const groups=Object.create(null);
  for(const name of Object.keys(animations).sort()) {
    const match=/^([a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)*)_(\d{3})$/.exec(name);
    if(!match || match[2]==='000') throw Error('动作须使用 <类别>_<三位正编号>：'+name);
    (groups[match[1]]??=[]).push(name);
  }
  return groups;
}
function setup(parts) {
  const bones=[{name:'root'}],slots=[],attachments=Object.create(null);
  for(const {name,pivot:[px,py],rect} of parts.parts) {
    bones.push({name,parent:'root',x:px,y:parts.height-py});
    slots.push({name,bone:name,attachment:name});
    attachments[name]={[name]:{x:rect.left+rect.width/2-px,y:py-rect.top-rect.height/2,width:rect.width,height:rect.height}};
  }
  return {skeleton:{spine:'4.2.0',x:0,y:0,width:parts.width,height:parts.height,images:'./images/'},bones,slots,skins:[{name:'default',attachments}],animations:{}};
}

async function makeAtlas(root,folder,parts,out,name) {
  const blocks=[],pages=[];
  let x=0,y=0,row=0,width=0,layers=[],regions=[];
  async function flush() {
    if(!regions.length)return;
    const filename=name+'-'+(pages.length+1)+'.png',height=y+row;
    const info=await sheet(width,height).composite(layers).png().toFile(join(out,filename));
    pages.push({filename,width,height,bytes:info.size,rgbaBytes:width*height*4});
    blocks.push([filename,'size:'+width+','+height,'filter:Linear,Linear','pma:false',...regions].join('\n'));
    x=y=row=width=0;layers=[];regions=[];
  }
  const names=new Set();
  for(const part of parts) {
    const id=identifier(part.name);
    if(names.has(id.toLowerCase())) throw Error('部件名重复：'+id);
    names.add(id.toLowerCase());
    const img=await projectPath(root,join(folder,part.image)),data=await readFile(img);
    const {width:w,height:h,format}=await sharp(data).metadata();
    if(format!=='png'||w!== (part.textureWidth??part.rect.width)||h!== (part.textureHeight??part.rect.height)||w+4>4096||h+4>4096) throw Error(id+' 的 PNG 尺寸无法打包');
    if(x+w+4>4096) {y+=row;x=0;row=0;}
    if(y+h+4>4096) await flush();
    const padded=await sharp(data).extend({top:2,left:2,right:2,bottom:2,extendWith:'copy'}).png().toBuffer();
    layers.push({input:padded,left:x,top:y});
    regions.push(id,'bounds:'+[x+2,y+2,w,h].join(','));
    x+=w+4;row=Math.max(row,h+4);width=Math.max(width,x);
    await writeFile(join(out,'images',id+'.png'),data);
  }
  await flush();
  const text=blocks.join('\n\n')+'\n';
  await writeFile(join(out,name+'.atlas'),text);
  return {text,pages};
}
export async function buildRig(root,recipe,out) {
  const name=identifier(recipe.name),file=await projectPath(root,recipe.parts);
  const parts=JSON.parse(await readFile(file,'utf8'));
  if(!Array.isArray(parts.parts)||!parts.parts.length||parts.parts.length>256) throw Error('拆件清单无效');
  const rig=recipe.rig ? JSON.parse(await readFile(await projectPath(root,recipe.rig),'utf8')) : setup(parts);
  if(!rig.skeleton?.spine?.startsWith('4.2.')) throw Error('需要 Spine 4.2 JSON');
  applyBinding(rig,recipe);
  rig.skeleton.images='./images/';
  Object.assign(rig.animations??={},recipe.animations??{});
  const groups=variantIndex(rig.animations);
  await mkdir(join(out,'images'));
  const {text,pages}=await makeAtlas(root,dirname(file),parts.parts,out,name);
  const atlas=new TextureAtlas(text),data=new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(rig);
  const skeleton=new Skeleton(data);
  skeleton.updateWorldTransform(Physics.reset);
  let vertices=0,influences=0;
  for(const skin of data.skins) for(const {attachment} of skin.getAttachments()) {
    if(!attachment.worldVerticesLength) continue;
    vertices+=attachment.worldVerticesLength/2;
    if(attachment.bones) {
      for(let i=0;i<attachment.bones.length;) {
        const count=attachment.bones[i++];
        if(!Number.isInteger(count)||count<1||i+count>attachment.bones.length) throw Error('无效的顶点骨骼权重');
        for(const index of attachment.bones.slice(i,i+count)) if(!data.bones[index]) throw Error('权重引用不存在的骨骼');
        influences+=count;i+=count;
      }
      for(let v=2;v<attachment.vertices.length;v+=3) if(!Number.isFinite(attachment.vertices[v])||attachment.vertices[v]<0) throw Error('无效的顶点权重');
    }
  }
  const source=name+'.json';
  await writeFile(join(out,source),JSON.stringify(rig));await writeFile(join(out,'animations.json'),JSON.stringify(groups,null,2));
  const runtimeBytes=pages.reduce((n,p)=>n+p.bytes,0)+(await stat(join(out,source))).size+Buffer.byteLength(text)+(await stat(join(out,'animations.json'))).size;
  const report={source,pages,runtimeBytes,rgbaBytes:pages.reduce((n,p)=>n+p.rgbaBytes,0),bones:data.bones.length,slots:data.slots.length,vertices,influences,clips:data.animations.map(a=>({name:a.name,duration:a.duration}))};
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));
  return report;
}
