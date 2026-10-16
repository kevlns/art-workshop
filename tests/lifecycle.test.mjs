import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverTask} from '../lib/tasks.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {executionSettled,executionLifecycle,assertIdle} from '../lib/lifecycle.mjs';
import {writeJson} from '../lib/shared.mjs';
import {taskFile,stateRead} from '../lib/runtime.mjs';
import {taskStatus,taskView,cancelTask,shutdown} from '../lib/tasks.mjs';
import {workerAlive} from '../lib/worker-process.mjs';

test('recycled worker PID cannot block shutdown or erase remote uncertainty',async()=>{
 const root=mkdtempSync(join(tmpdir(),'art-recycled-worker-'));
 try {
  const settings={paths:{workspace:root}},runtime=join(root,'.runtime');
  const task={schema:'art-workshop/task',taskId:'task-recycled',kind:'style-analysis',status:'failed',workerPid:process.pid,finishedAt:'2000-01-01T00:00:00Z',stopConfirmed:false,unsettled:true,remoteCancellation:'upstream unknown'};
  writeJson(taskFile(runtime,task.taskId),task);
  assert.equal(workerAlive(task),false);
  assert.equal(taskView(task).upstreamExecutionUnknown,true);
  await shutdown(settings,{closeServices:false});
  assert.deepEqual(stateRead(taskFile(runtime,task.taskId)),task);
  assert.equal(workerAlive(task,()=>null),true,'unreadable identity fails closed');
  const identity={pid:process.pid,created:'2020-01-01',command:'worker'};
  assert.equal(workerAlive({...task,workerIdentity:identity},()=>identity),true);
  assert.equal(workerAlive({...task,workerIdentity:identity},()=>({...identity,created:'2021-01-01'})),false);
  assert.equal(executionSettled({...task,kind:'generation'}),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('different configuration files cannot hide runs from the same workspace',async()=>{
 const root=mkdtempSync(join(tmpdir(),'art-shared-owner-'));try{
  const {runtimeRoot}=await import('../lib/runtime.mjs');
  const first={file:join(root,'one/config.json'),paths:{workspace:root}},second={file:join(root,'two/config.json'),paths:{workspace:root}};
  assert.equal(runtimeRoot(first),runtimeRoot(second));
  writeJson(taskFile(runtimeRoot(first),'task-original'),{schema:'art-workshop/task',taskId:'task-original',operationId:'art-owned',project:'P',status:'unknown',stopConfirmed:false});
  assert.equal(recoverTask(runtimeRoot(second),'P','art-owned').taskId,'task-original');
  assert.throws(()=>assertIdle([taskStatus(runtimeRoot(second),'task-original')]),/停止未确认/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('local completion and remote uncertainty have distinct lifecycle evidence',()=>{
  const stopped={taskId:'task-1',status:'cancelled',stopConfirmed:true};
  assert.equal(executionSettled(stopped),true);
  assert.equal(executionLifecycle(stopped),'cancelled');
  const remote={...stopped,remoteCancellation:'upstream unknown'};
  assert.equal(taskView(remote).lifecycle,'unknown');
  assert.equal(taskView(remote).stopConfirmed,false);
  assert.throws(()=>assertIdle([remote]),/停止未确认/);
  assert.equal(executionSettled({...stopped,status:'failed',unsettled:true}),false);
  assert.equal(executionSettled({...stopped,promptId:'still-running'}),false);
  assert.equal(executionSettled({status:'succeeded'}),false);
});

test('worker loss is unknown, never inferred cancelled; repeated cancel preserves evidence',async()=>{
  const root=mkdtempSync(join(tmpdir(),'art-lifecycle-'));
  try{
    const file=taskFile(root,'task-lost');
    writeJson(file,{schema:'art-workshop/task',taskId:'task-lost',status:'running',createdAt:'2000-01-01T00:00:00Z',workerPid:2147483647,stopConfirmed:false});
    const state=taskStatus(root,'task-lost');
    assert.equal(state.status,'unknown');assert.equal(state.unsettled,true);
    await assert.rejects(cancelTask(root,'task-lost'),/停止结果未知/);
    assert.equal(stateRead(file).status,'unknown');
    assert.equal(stateRead(file+'.cancel').requestedAt.length>0,true);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('shutdown cannot release an uncertain remote execution or claim it stopped',async()=>{
  const root=mkdtempSync(join(tmpdir(),'art-shutdown-'));
  try{
    const settings={file:join(root,'config.json'),paths:{workspace:root},generation:{backends:{}}};
    const {runtimeRoot}=await import('../lib/runtime.mjs');
    const runtime=runtimeRoot(settings);
    writeJson(taskFile(runtime,'task-remote'),{schema:'art-workshop/task',taskId:'task-remote',status:'cancelled',stopConfirmed:false,remoteCancellation:'upstream unknown'});
    await assert.rejects(shutdown(settings),/尚未停止/);
    assert.equal(stateRead(taskFile(runtime,'task-remote')).stopConfirmed,false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('finalized read-only analysis releases local ownership without erasing upstream uncertainty',async()=>{
 const root=mkdtempSync(join(tmpdir(),'art-analysis-stop-'));
 try {
  const settings={paths:{workspace:root}},runtime=join(root,'.runtime');
  const task={schema:'art-workshop/task',taskId:'task-analysis',kind:'style-analysis',status:'failed',workerPid:2147483647,finishedAt:new Date().toISOString(),stopConfirmed:false,unsettled:true,remoteCancellation:'upstream unknown'};
  writeJson(taskFile(runtime,task.taskId),task);
  assert.equal(taskStatus(runtime,task.taskId).stopConfirmed,true);
  assert.equal(taskView(task).upstreamExecutionUnknown,true);
  assert.equal(taskView(task).lifecycle,'failed');
  assert.doesNotThrow(()=>assertIdle([task]));
  await shutdown(settings,{closeServices:false});
  assert.equal(stateRead(taskFile(runtime,task.taskId)).stopConfirmed,false,'historical evidence remains unchanged');
  for(const unsafe of [{...task,workerPid:process.pid},{...task,finishedAt:undefined},{...task,status:'unknown'},{...task,kind:'generation'},{...task,promptId:'prompt'},{...task,remoteExecutions:{one:{state:'accepted'}}}])assert.equal(executionSettled(unsafe),false);
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('recovery requires one exact original receipt and never chooses a recent task',()=>{
 const root=mkdtempSync(join(tmpdir(),'art-receipt-'));
 try{
  writeJson(taskFile(root,'task-receipt'),{schema:'art-workshop/task',taskId:'task-receipt',operationId:'art-original',project:'P',status:'cancelled',stopConfirmed:false,remoteCancellation:'unknown'});
  assert.equal(recoverTask(root,'P','art-original').taskId,'task-receipt');
  assert.equal(recoverTask(root,'P','art-original').lifecycle,'unknown');
  assert.throws(()=>recoverTask(root,'other','art-original'),/唯一/);
  assert.throws(()=>recoverTask(root,'P','art-missing'),/唯一/);
  writeJson(taskFile(root,'task-duplicate'),{schema:'art-workshop/task',taskId:'task-duplicate',operationId:'art-original',project:'P',status:'succeeded',stopConfirmed:true});
  assert.throws(()=>recoverTask(root,'P','art-original'),/唯一/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
