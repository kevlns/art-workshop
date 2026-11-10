import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {inspectProcess} from '../lib/process-identity.mjs';
import {stopIdentity} from '../lib/service.mjs';

test('process probe separates absence from permission, timeout and malformed results',async()=>{
  // 并发集成测试会挤占 PowerShell 启动时间；未知不是退出证据，等待后重新查询。
  async function confirmed(pid){
    let result;
    for(let n=0;n<3;n++){
      result=inspectProcess(pid);if(result.state!=='unknown')return result;
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    return result;
  }
  assert.equal((await confirmed(process.pid)).state,'running');
  const child=spawn(process.execPath,['-e',''],{stdio:'ignore',windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  assert.equal((await confirmed(child.pid)).state,'missing');
  for(const code of ['EPERM','ETIMEDOUT'])assert.equal(inspectProcess(4242,()=>{throw Object.assign(new Error(code),{code});}).state,'unknown');
  if(process.platform==='win32'){
    assert.equal(inspectProcess(4242,()=>'bad json').state,'unknown');
    assert.equal(inspectProcess(4242,()=>'{"state":"missing"}').state,'missing');
    assert.equal(inspectProcess(4242,()=>'{"state":"running","identity":{"pid":4242}}').state,'unknown');
  }
});

test('service stop requires identity evidence and never signals an unknown or recycled PID',async()=>{
  const original=process.kill;
  process.kill=()=>{throw new Error('must not signal');};
  const identity={pid:4242,created:'old'};
  try{
    await stopIdentity(identity,{inspect:()=>({state:'missing'})});
    await assert.rejects(stopIdentity(identity,{inspect:()=>({state:'unknown'})}),/身份未知/);
    await assert.rejects(stopIdentity(identity,{inspect:()=>({state:'running',identity:{...identity,created:'new'}})}),/身份已变化/);
  }finally{process.kill=original;}
});
