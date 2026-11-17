import {mkdir,mkdtemp,lstat,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {projectPath} from './video/path.mjs';
import {splitParts} from './spine/parts.mjs';
import {buildRig} from './spine/build.mjs';

export const spineContract={
  parts:{input:{prototype:'art/prototype.png',out:'work/parts-01',parts:[{name:'body',rect:{left:0,top:0,width:100,height:100},pivot:[50,75],occludedBy:[]}]},optional:'parts 的顺序为从后到前。mask 取透明通道或灰度，可传母版大小或局部大小。replacement 接受同比例补绘图。',outputs:['parts.json','images/','assembled.png']},
  build:{input:{parts:'work/parts-01/parts.json',name:'actor',out:'work/rig-01',animations:{wave_001:{bones:{body:{rotate:[{time:0,value:0},{time:0.5,value:22}]}}}}},meshExample:{slot:'body',uvs:[0,0,1,0,0,1],triangles:[0,1,2],points:[[['body',-50,75,1]],[['body',50,75,1]],[['body',-50,-25,1]]]},optional:'bones 按名增改骨骼；meshes 为网格配方列表，points 每项含 [骨名,骨局部x,y,正权重]，权重和为1。rig 可指定可编辑的 Spine 4.2 JSON，保留其骨骼、皮肤、约束、网格、权重及时间线；animations 按动作名合并。未传 rig 时使用 parts 中的轴心建立绑定。',outputs:['骨架 JSON','atlas','PNG 图集','images/','animations.json','report.json']},
  capture:{input:{source:'work/rig-01/actor.json',out:'work/frames-01',clip:'wave_001',width:384,height:384,frames:8,gif:true},optional:'times 可直接指定秒数。无头 Chromium 使用 Spine WebGL 4.2 捕获实际像素。',outputs:['逐帧 PNG','comparison.png','preview.gif（可选）','capture.json']}
};
export async function runSpine(root,action,input) {
  if(action==='describe')return spineContract;
  if(!Object.hasOwn(spineContract,action))throw Error('未知 Spine 操作：'+action);
  if(typeof input?.out!=='string'||!input.out.trim()) throw Error('指定新的项目内输出目录 out');
  const target=await projectPath(root,input.out);
  if(await lstat(target).then(()=>true,e=>{if(e.code!=='ENOENT')throw e;return false;}))throw Error('输出目录已存在，请为本次结果选择新目录');
  await mkdir(dirname(target),{recursive:true});
  const stage=await mkdtemp(join(dirname(target),'.spine-'));
  try {
    let result;
    if(action==='parts') result=await splitParts(root,input,stage);
    if(action==='build') result=await buildRig(root,input,stage);
    if(action==='capture') {
      const {captureFrames}=await import('./spine/capture.mjs');
      result=await captureFrames(root,input,stage);
      await writeFile(join(stage,'capture.json'),JSON.stringify(result,null,2));
    }
    await rename(stage,target);
    return {out:input.out,...result};
  } finally {await rm(stage,{recursive:true,force:true});}
}
export async function spineCli(args) {
  const [action,...rest]=args, options={};
  for(let i=0;i<rest.length;i+=2) {
    if(!['--workspace','--input'].includes(rest[i])||Object.hasOwn(options,rest[i])||!rest[i+1])throw Error('用法：spine <describe|parts|build|capture> [--workspace 工程] [--input 项目内配方.json]');
    options[rest[i]]=rest[i+1];
  }
  const root=resolve(options['--workspace']??process.cwd());
  const input=options['--input']?JSON.parse(await readFile(await projectPath(root,options['--input']),'utf8')):{};
  return runSpine(root,action,input);
}
