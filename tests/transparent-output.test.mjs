import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {transparentPng,processTransparentFiles} from '../lib/transparent-output.mjs';
import {background} from '../lib/presentation.mjs';
import {validateTaskDraft,taskContract} from '../lib/task-contract.mjs';

async function fixture(){return sharp({create:{width:16,height:16,channels:3,background:'#ff00ff'}}).composite([{input:await sharp({create:{width:8,height:8,channels:3,background:'#808080'}}).png().toBuffer(),left:4,top:4}]).png().toBuffer();}
test('transparent contract and meaningful edit scopes remain editable',()=>{
  assert.match(background({type:'transparent'}),/透明 PNG/);
  assert.throws(()=>background({type:'transparent',color:'#ffffff'}));
  const config={kind:'edit',items:[{id:'one',changes:[{target:'shape',instruction:'减少切面'},{target:'outline',instruction:'加粗描边'}],preserve:[{target:'shape',instruction:'保留整体外形'}]}]};
  assert.equal(validateTaskDraft(config),config);
  assert.ok(taskContract('edit').fields.backgroundChange.includes('value'));
  assert.throws(()=>validateTaskDraft({kind:'edit',items:[{changes:[{target:'outline',description:'wrong'}]}]}),/items\[0\].changes\[0\]/);
});
test('opaque key image produces genuine transparent PNG with visible unchanged subject',async()=>{
  const result=await transparentPng(await fixture());
  const meta=await sharp(result.buffer).metadata();
  assert.equal(meta.format,'png');assert.equal(meta.hasAlpha,true);assert.equal(meta.width,16);
  const raw=await sharp(result.buffer).raw().toBuffer();
  assert.equal(raw[3],0);assert.deepEqual([...raw.subarray((8*16+8)*4,(8*16+8)*4+4)],[128,128,128,255]);
  const native=await transparentPng(result.buffer);assert.equal(native.method,'native-alpha');assert.deepEqual(await sharp(native.buffer).raw().toBuffer(),raw);
});
test('does not report opaque white or empty transparent output as success',async()=>{
  for(const bg of ['#ffffff','#ff00ff','#00000000'])await assert.rejects(transparentPng(await sharp({create:{width:16,height:16,channels:4,background:bg}}).png().toBuffer()),/透明输出失败/);
});

test('shifted magenta matte with near-opaque alpha noise is removed without erasing enclosed details',async()=>{
  const pixels=Buffer.alloc(16*16*4);
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    const outside=x<4||x>11||y<4||y>11;
    const detail=x>=7&&x<=8&&y>=7&&y<=8;
    pixels.set(outside||detail?[255,2,183,(x+y)%2?250:255]:[90,90,90,255],(y*16+x)*4);
  }
  const original=await sharp(pixels,{raw:{width:16,height:16,channels:4}}).png().toBuffer();
  const result=await transparentPng(original),raw=await sharp(result.buffer).raw().toBuffer();
  assert.equal(result.method,'chroma-key-v2');
  assert.equal(raw[3],0);
  assert.deepEqual([...raw.subarray((5*16+5)*4,(5*16+5)*4+4)],[90,90,90,255]);
  assert.deepEqual([...raw.subarray((7*16+7)*4,(7*16+7)*4+4)],[255,2,183,255]);
  const partial=await transparentPng(result.buffer);
  assert.equal(partial.method,'native-alpha');
  assert.deepEqual(await sharp(partial.buffer).raw().toBuffer(),raw);
});

test('near-opaque alpha noise alone does not make a white image transparent',async()=>{
  const image=await sharp({create:{width:16,height:16,channels:4,background:{r:255,g:255,b:255,alpha:0.98}}}).png().toBuffer();
  await assert.rejects(transparentPng(image),/模型未生成约定/);
});
test('file processing preserves originals, is retry-safe, checks cancellation and collisions',async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),'art-transparent-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const original=await fixture();await writeFile(join(dir,'source.png'),original);
  const result=await processTransparentFiles(dir,['source.png']);assert.equal(result[0].file,'source--transparent.png');
  assert.deepEqual(await readFile(join(dir,'source.png')),original);
  assert.deepEqual(await processTransparentFiles(dir,['source.png']),result);
  await assert.rejects(processTransparentFiles(dir,['source.png'],{cancelled:()=>true}),/取消/);
  await writeFile(join(dir,result[0].file),'different');await assert.rejects(processTransparentFiles(dir,['source.png']));
});
