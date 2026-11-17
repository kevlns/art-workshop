import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {runSpine} from '../lib/spine.mjs';

test('masked repair, weighted rig, animation index and editable export round trip',async t=>{
  const root=await mkdtemp(join(tmpdir(),'art-spine-pennant-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const svg='<svg width="96" height="96"><rect x="14" y="8" width="4" height="82" fill="#345"/><path d="M18 10H82L65 29L82 49H18Z" fill="#c70"/></svg>';
  await sharp(Buffer.from(svg)).png().toFile(join(root,'prototype.png'));
  const rect={left:18,top:10,width:64,height:39};
  await sharp(join(root,'prototype.png')).extract(rect).png().toFile(join(root,'mask.png'));
  await sharp({create:{width:128,height:78,channels:4,background:'#008baa'}}).png().toFile(join(root,'repair.png'));
  await runSpine(root,'parts',{prototype:'prototype.png',out:'pieces',parts:[
    {name:'pole',rect:{left:14,top:8,width:4,height:82},pivot:[16,90],occludedBy:['flag']},
    {name:'flag',rect,pivot:[18,10],mask:'mask.png',replacement:'repair.png'}]});
  const pixel=async(file,left,top)=>[...await sharp(join(root,file)).extract({left,top,width:1,height:1}).ensureAlpha().raw().toBuffer()];
  assert.deepEqual(await pixel('pieces/patched.png',15,80),await pixel('prototype.png',15,80));
  assert.deepEqual(await pixel('pieces/patched.png',20,12),[0,139,170,255]);
  assert.equal((await pixel('pieces/patched.png',81,30))[3],0);
  const mesh={slot:'flag',uvs:[0,1,1,1,1,0,0,0],triangles:[0,1,2,2,3,0],points:[
    [['flag',0,-39,1]],[['flag',64,-39,0.2],['tip',0,-39,0.8]],[['tip',0,0,1]],[['flag',0,0,1]]]};
  const recipe={parts:'pieces/parts.json',out:'rig',name:'pennant',bones:[{name:'tip',parent:'flag',x:64}],
    meshes:[mesh],animations:{wave_001:{bones:{tip:{translate:[{time:0},{time:1,x:-20,y:-25}]}}}}};
  const result=await runSpine(root,'build',recipe);
  assert.equal(result.influences,5);assert.equal(result.vertices,4);assert.ok(result.runtimeBytes>0);
  assert.deepEqual(JSON.parse(await readFile(join(root,'rig/animations.json'))),{wave:['wave_001']});
  const ch=await runSpine(root,'build',{parts:recipe.parts,rig:'rig/pennant.json',out:'variant',name:'pennant',animations:{wave_002:{}}});
  assert.equal(ch.clips.length,2);assert.equal(ch.influences,5);
  await assert.rejects(runSpine(root,'build',recipe),/已存在/);
  await assert.rejects(runSpine(root,'build',{...recipe,out:'bad',animations:{Invalid:{}}}),/动作/);
  await assert.rejects(access(join(root,'bad')));
  if(process.env.SPINE_CAPTURE_TEST==='1') {
    const cap=await runSpine(root,'capture',{source:'rig/pennant.json',out:'review',clip:'wave_001',width:96,height:96,times:[0,.5,1],gif:true});
    const first=await readFile(join(root,'review',cap.files[0])),last=await readFile(join(root,'review',cap.files[2]));
    assert.notDeepEqual(first,last);assert.equal((await sharp(join(root,'review',cap.gif),{animated:true}).metadata()).pages,3);
    assert.equal((await sharp(join(root,'review',cap.comparison)).metadata()).width,192);
  }
});
