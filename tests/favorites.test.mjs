import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {compileGenerate} from '../lib/generate.mjs';
import {executePlan} from '../lib/executor.mjs';
import {candidates,deleteCandidate} from '../lib/candidates.mjs';
import {favoriteList,setFavorite} from '../lib/favorites.mjs';
import {readObject,objectFile,updateObject} from '../lib/workspace.mjs';
import {writeJson,readJson} from '../lib/shared.mjs';
import {runtimeRoot,taskFile} from '../lib/runtime.mjs';

async function fixture(fn){
 const root=mkdtempSync(join(tmpdir(),'art-favorites-'));
 try{
  cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});
  const settings={paths:{workspace:root,output:join(root,'output')}};
  const image=await sharp({create:{width:8,height:8,channels:3,background:'#808080'}}).png().toBuffer();
  const plan=compileGenerate({root,projectId:'cellgame',jobId:'skills'});
  const run=executePlan(plan,plan.items.slice(0,2),{outputRoot:settings.paths.output,log:()=>{},runner:args=>{writeFileSync(join(args[args.indexOf('--out-dir')+1],'image.png'),image);return {};}});
  const receipt={schema:'art-workshop/task',taskId:'task-favorite-source',status:'succeeded',stopConfirmed:true,plan,manifestPath:run.manifestPath};
  writeJson(taskFile(runtimeRoot(settings),receipt.taskId),receipt);
  await fn({root,settings,receipt,run,rows:candidates(settings,'cellgame','skills',receipt.taskId)});
 }finally{rmSync(root,{recursive:true,force:true});}
}

test('favorites persist by image identity, update idempotently and merge concurrent changes without touching task configuration',()=>fixture(async({root,settings,receipt,rows})=>{
 assert.equal(favoriteList(settings,'cellgame').length,0);
 const file=objectFile(root,'cellgame','task','skills'),before=readFileSync(file);
 const args=rows.map(c=>({runId:receipt.taskId,candidateId:c.candidateId,value:true}));
 await Promise.all(args.map(a=>setFavorite(settings,'cellgame','skills',a)));
 const saved=favoriteList(settings,'cellgame');assert.equal(saved.length,2);
 await setFavorite(settings,'cellgame','skills',args[0]);
 assert.deepEqual(favoriteList(settings,'cellgame'),saved);
 assert.deepEqual(readFileSync(file),before);
 const record=readObject(root,'cellgame','task','skills');
 await updateObject(settings,'cellgame','task','skills',record.revision,{name:'renamed task'});
 assert.ok(favoriteList(settings,'cellgame').every(f=>f.taskName==='renamed task'&&f.taskId==='skills'&&f.itemId));
 await setFavorite(settings,'cellgame','skills',{...args[0],value:false});
 await setFavorite(settings,'cellgame','skills',{...args[0],value:false});
 assert.equal(favoriteList(settings,'cellgame').length,1);
}));

test('failed readable images and settled results can be favorited independently of acceptance; deleted or missing images disappear',()=>fixture(async({root,settings,receipt,run,rows})=>{
 const manifest=readJson(run.manifestPath);manifest.items[0].ok=false;manifest.items[0].status='failed';manifest.items[0].outputHashes={};writeJson(run.manifestPath,manifest);
 writeJson(taskFile(runtimeRoot(settings),receipt.taskId),{...receipt,status:'running',stopConfirmed:false});
 const args={runId:receipt.taskId,candidateId:rows[0].candidateId,value:true};
 const favorites=await setFavorite(settings,'cellgame','skills',args);
 assert.equal(favorites[0].accepted,false);assert.equal(favorites[0].candidateId,rows[0].candidateId);
 writeJson(taskFile(runtimeRoot(settings),receipt.taskId),receipt);
 const task=readObject(root,'cellgame','task','skills');
 await deleteCandidate(settings,'cellgame','skills',task.revision,{runId:receipt.taskId,candidateId:rows[0].candidateId,confirm:true,actor:'test'});
 assert.equal(favoriteList(settings,'cellgame').length,0);
 await assert.rejects(setFavorite(settings,'cellgame','skills',args),/不存在|删除/);
 await setFavorite(settings,'cellgame','skills',{...args,candidateId:rows[1].candidateId});
 rmSync(rows[1].path);assert.equal(favoriteList(settings,'cellgame').length,0);
 await setFavorite(settings,'cellgame','skills',{...args,value:false});
 await assert.rejects(setFavorite(settings,'cellgame','skills',{...args,value:'true'}),/布尔/);
}));
