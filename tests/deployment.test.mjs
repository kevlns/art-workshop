import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {deploymentStatus,cancelDeployment,recoverDeployment,startDeployment,deploymentPlan,validateDeploymentPlan,LOCAL_RECIPE} from '../lib/deployment.mjs';
import {runtimeRoot} from '../lib/runtime.mjs';
import {writeJson,hash} from '../lib/shared.mjs';
test('preflight rejects missing deployment commands before installation; start rechecks dependencies',{skip:process.platform!=='win32'},async()=>{
 const root=mkdtempSync(join(tmpdir(),'art-deploy-commands-')),settings={file:join(root,'settings.json'),paths:{workspace:root}},target=join(root,'install'),original=childProcess.execFileSync;
 let missing='git';const commands=[];
 childProcess.execFileSync=(command,...args)=>{
  commands.push(command);
  if(command===missing)throw Object.assign(new Error('missing fixture'),{code:'ENOENT'});
  if(command==='nvidia-smi')return 'NVIDIA fixture, 8192, 999.0\n';
  if(command==='git'||command==='curl.exe')return 'fixture version';
  return original(command,...args);
 };syncBuiltinESMExports();
 try{
  assert.throws(()=>deploymentPlan(settings,{directory:target}),/安装 Git for Windows/);
  assert.deepEqual(commands,['git']);assert.equal(existsSync(target),false);
  mkdirSync(join(target,'python_embeded'),{recursive:true});writeFileSync(join(target,'python_embeded/python.exe'),'not executed');
  missing='curl.exe';assert.throws(()=>deploymentPlan(settings,{directory:target}),/找不到部署命令 curl.exe/);
  assert.equal(existsSync(runtimeRoot(settings)),false);
  missing=null;const plan=deploymentPlan(settings,{directory:target});
  missing='git';await assert.rejects(startDeployment(settings,plan,{operationId:'missing-git-before-dispatch'}),/安装 Git for Windows/);
  const failed=await recoverDeployment(settings,'missing-git-before-dispatch');
  assert.equal(failed.status,'failed');assert.equal(failed.stopConfirmed,true);assert.equal(failed.workerPid,undefined);
  assert.equal(existsSync(join(target,'ComfyUI')),false);
 }finally{childProcess.execFileSync=original;syncBuiltinESMExports();rmSync(root,{recursive:true,force:true});}
});
test('lost deployment stays occupying; cancel only records a request and original identity recovers',async()=>{
 const root=mkdtempSync(join(tmpdir(),'art-deployment-'));const settings={file:join(root,'settings.json'),paths:{workspace:root}};
 try{const file=join(runtimeRoot(settings),'deployments/deploy-one.json');writeJson(file,{schema:'art-workshop/deployment',deploymentId:'deploy-one',operationId:'original',status:'running',stopConfirmed:false,createdAt:'2000-01-01T00:00:00Z',workerPid:2147483647,plan:{planHash:'fixed'}});
 assert.equal(deploymentStatus(settings,'deploy-one').status,'unknown');assert.equal(cancelDeployment(settings,'deploy-one').stopConfirmed,false);assert.ok(existsSync(file+'.cancel'));assert.equal((await recoverDeployment(settings,'original')).deploymentId,'deploy-one');
 const same=await startDeployment(settings,{planHash:'fixed'},{operationId:'original'});assert.equal(same.deploymentId,'deploy-one');
 await assert.rejects(startDeployment(settings,{planHash:'other'},{operationId:'original'}),/其他预案/);
 await assert.rejects(recoverDeployment(settings,'missing'),/禁止重新提交/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('deployment previews cannot authorize changed download sources or newly occupied model targets',{skip:process.platform!=='win32'},async()=>{
 const root=mkdtempSync(join(tmpdir(),'art-deploy-preflight-'));const settings={file:join(root,'settings.json'),paths:{workspace:root}};
 const original=childProcess.execFileSync;
 childProcess.execFileSync=(command,...args)=>command==='nvidia-smi'?'NVIDIA fixture, 8192, 999.0\n':original(command,...args);
 syncBuiltinESMExports();
 try{const target=join(root,'install');mkdirSync(join(target,'python_embeded'),{recursive:true});writeFileSync(join(target,'python_embeded/python.exe'),'not executed');const plan=deploymentPlan(settings,{directory:target});assert.equal(existsSync(runtimeRoot(settings)),false);
 const changed=structuredClone(plan);changed.recipe.models[0].url='https://untrusted.invalid/model';const {planHash,...body}=changed;changed.planHash=hash(body);assert.throws(()=>validateDeploymentPlan(changed,settings),/固定方案/);
 const model=join(target,'ComfyUI/models',LOCAL_RECIPE.models[0].path);mkdirSync(join(model,'..'),{recursive:true});writeFileSync(model,'user file');assert.throws(()=>validateDeploymentPlan(plan,settings),/环境已变化/);assert.equal(readFileSync(model,'utf8'),'user file');
 await assert.rejects(startDeployment(settings,plan,{operationId:'rejected-before-dispatch'}),/环境已变化/);
 const rejected=await recoverDeployment(settings,'rejected-before-dispatch');assert.equal(rejected.status,'failed');assert.equal(rejected.stopConfirmed,true);assert.equal(rejected.workerPid,undefined);
 }finally{childProcess.execFileSync=original;syncBuiltinESMExports();rmSync(root,{recursive:true,force:true});}
});
