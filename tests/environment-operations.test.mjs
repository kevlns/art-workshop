import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deploymentGuide} from '../lib/deployment-guide.mjs';
import {verifyInstallation,registerInstallation,unregisterInstallation} from '../lib/environment-operations.mjs';
import {environmentRoot} from '../lib/environments.mjs';

test('deployment guide exposes source versions and model checksums without executing installation',()=>{
 const guide=deploymentGuide();
 assert.equal(guide.schema,'art-workshop/deployment-guide');
 assert.match(guide.instructions,/Pi/);
 assert.equal(guide.contract.models.length,3);
 for(const model of guide.contract.models)assert.match(model.sha256,/^[a-f0-9]{64}$/);
});

test('incomplete installation fails verification and cannot be registered',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'art-environment-'));
 try{
  const report=await verifyInstallation(directory,'http://127.0.0.1:1/');
  assert.equal(report.ok,false);
  assert.equal(report.sampleVerified,false);
  assert.ok(report.issues.some(x=>x.startsWith('Python 环境')));
  await assert.rejects(registerInstallation(directory,'http://127.0.0.1:1/'),/验收未通过/);
  assert.equal(existsSync(join(directory,'vant.art.config.json')),false);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('unregister removes only matching environment records and preserves installation files',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'art-environment-'));
 const registry=environmentRoot(directory);
 try{
  mkdirSync(registry,{recursive:true});
  writeFileSync(join(registry,'environment.json'),JSON.stringify({root:realpathSync(directory),environmentId:'test'}));
  writeFileSync(join(directory,'vant.art.config.json'),JSON.stringify({environmentId:'test'}));
  writeFileSync(join(directory,'model.gguf'),'user model');
  await unregisterInstallation(directory);
  assert.equal(existsSync(join(directory,'model.gguf')),true);
  assert.equal(existsSync(join(directory,'vant.art.config.json')),false);
  await assert.rejects(unregisterInstallation(directory),/未登记/);
 }finally{rmSync(directory,{recursive:true,force:true});rmSync(registry,{recursive:true,force:true});}
});
