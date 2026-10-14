import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deploymentStatus,cancelDeployment,recoverDeployment,startDeployment,deploymentPlan,validateDeploymentPlan,LOCAL_RECIPE} from '../lib/deployment.mjs';
import {runtimeRoot} from '../lib/runtime.mjs';
import {writeJson,hash} from '../lib/shared.mjs';
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
 try{const target=join(root,'install');mkdirSync(join(target,'python_embeded'),{recursive:true});writeFileSync(join(target,'python_embeded/python.exe'),'not executed');const plan=deploymentPlan(settings,{directory:target});assert.equal(existsSync(runtimeRoot(settings)),false);
 const changed=structuredClone(plan);changed.recipe.models[0].url='https://untrusted.invalid/model';const {planHash,...body}=changed;changed.planHash=hash(body);assert.throws(()=>validateDeploymentPlan(changed,settings),/固定方案/);
 const model=join(target,'ComfyUI/models',LOCAL_RECIPE.models[0].path);mkdirSync(join(model,'..'),{recursive:true});writeFileSync(model,'user file');assert.throws(()=>validateDeploymentPlan(plan,settings),/环境已变化/);assert.equal(readFileSync(model,'utf8'),'user file');
 await assert.rejects(startDeployment(settings,plan,{operationId:'rejected-before-dispatch'}),/环境已变化/);
 const rejected=await recoverDeployment(settings,'rejected-before-dispatch');assert.equal(rejected.status,'failed');assert.equal(rejected.stopConfirmed,true);assert.equal(rejected.workerPid,undefined);
 }finally{rmSync(root,{recursive:true,force:true});}
});
