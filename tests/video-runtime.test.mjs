import test from 'node:test';
import assert from 'node:assert/strict';
import {closeOwnedService} from '../lib/service.mjs';
import {LocalVideoRuntime} from '../lib/video.mjs';
import {tmpdir} from 'node:os';
const endpoint='http://127.0.0.1:8188/',owner={application:'vant',instanceId:'fixture-video-owner'},identity={pid:4242,exe:'python.exe',created:'original'},external={pid:4343,exe:'python.exe',created:'external'};
function fixture(){let record={endpoint,owned:true,owner:structuredClone(owner),identity:structuredClone(identity)},current=identity;const stopped=[],written=[],locks=[];const dependencies={lock:async(_root,name,work)=>{locks.push(name);return work();},readRecord:()=>structuredClone(record),inspect:pid=>current?.pid===pid?structuredClone(current):null,health:async()=>false,queue:async()=>({queue_running:[],queue_pending:[]}),stop:async value=>{stopped.push(value);current=null;},portReleased:async()=>{},writeRecord:(_root,_endpoint,value)=>{written.push(value);record=value;}};return {dependencies,stopped,written,locks,get record(){return record;},set record(value){record=value;},set current(value){current=value;}};}

test('owned service close rechecks ownership after health and queue waits without stopping a replacement',async()=>{
 for(const phase of ['health','queue']){const f=fixture();f.dependencies.health=async()=>{if(phase==='health'){f.record={endpoint,owned:false,identity:external};f.current=external;}return true;};f.dependencies.queue=async()=>{f.record={endpoint,owned:true,owner:{...owner,instanceId:'new-owner'},identity:external};f.current=external;return {queue_running:[],queue_pending:[]};};await assert.rejects(closeOwnedService(tmpdir(),endpoint,{}, {owner,identity},f.dependencies),error=>error.code==='service-owner-mismatch');assert.deepEqual(f.stopped,[]);assert.deepEqual(f.written,[]);assert.deepEqual(f.locks,['queue-8188','services']);}
});

test('owned close retains the shared-queue guard and never falls back to an external process',async()=>{
 const f=fixture();f.dependencies.health=async()=>true;f.dependencies.queue=async()=>({queue_running:[[0,'other-task']],queue_pending:[]});await assert.rejects(closeOwnedService(tmpdir(),endpoint,{}, {owner,identity},f.dependencies),error=>error.code==='service-shared-busy');assert.deepEqual(f.stopped,[]);
 const missing=fixture();missing.current=external;await assert.rejects(closeOwnedService(tmpdir(),endpoint,{}, {owner,identity},missing.dependencies),error=>error.code==='service-owner-mismatch');assert.deepEqual(missing.stopped,[]);
});

test('a replacement listener after the original stop remains untouched and is reported unconfirmed',async()=>{
 const f=fixture();f.dependencies.stop=async value=>{f.stopped.push(value);f.current=external;};f.dependencies.portReleased=async()=>{throw Object.assign(new Error('Replacement external listener'),{code:'service-owned-stop-unconfirmed'});};await assert.rejects(closeOwnedService(tmpdir(),endpoint,{}, {owner,identity},f.dependencies),error=>error.code==='service-owned-stop-unconfirmed');assert.deepEqual(f.stopped,[identity]);assert.deepEqual(f.written,[]);
});

test('strict owned close persists only the original owner after its process and port are confirmed stopped',async()=>{
 const f=fixture(),result=await closeOwnedService(tmpdir(),endpoint,{}, {owner,identity},f.dependencies);assert.deepEqual(result,{endpoint,stopped:true,portReleased:true});assert.deepEqual(f.stopped,[identity]);assert.equal(f.written.length,1);assert.deepEqual(f.written[0].owner,owner);assert.deepEqual(f.written[0].identity,identity);assert.equal(f.written[0].owned,false);assert.equal(f.written[0].stopped,true);
});

test('default-port owned shutdown uses exactly the original shared queue lock key',async()=>{
 const f=fixture(),defaultEndpoint='http://127.0.0.1/';f.record={...f.record,endpoint:defaultEndpoint};await closeOwnedService(tmpdir(),defaultEndpoint,{}, {owner,identity},f.dependencies);assert.deepEqual(f.locks,['queue-','services']);
});

test('video runtime refuses legacy non-strict shutdown and passes exact owner/identity to the strict API',async()=>{
 const runtime=new LocalVideoRuntime({root:tmpdir()}),record={owned:true,owner:{application:'vant',instanceId:runtime.prefix+'original'},identity},calls=[];let closeOwnedService;
 runtime.sdk=async()=>({rememberedService:()=>structuredClone(record),processIdentity:()=>identity,closeService:()=>{assert.fail('legacy close must never be used');},get closeOwnedService(){return closeOwnedService;}});runtime.python=async()=>'/fake/python';const config={localInstallRoot:tmpdir(),localEndpoint:endpoint};await assert.rejects(runtime.stop(config),error=>error.code==='video-runtime-stop-unavailable');
 closeOwnedService=async(...args)=>{calls.push(args);return {stopped:true};};assert.deepEqual(await runtime.stop(config),{stopped:true});assert.deepEqual(calls[0][3],{owner:record.owner,identity});
});
