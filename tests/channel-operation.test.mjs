import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {executeChannelOperation,readChannelOperation,videoExecutionId} from '../lib/channel-operation.mjs';
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'art-channel-journal-'));t.after(()=>rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:50}));return root;}
test('CLI video identity mapping is stable and rejects path/device identities',()=>{assert.equal(videoExecutionId('origin-one'),videoExecutionId('origin-one'));assert.notEqual(videoExecutionId('origin-one'),videoExecutionId('origin-two'));const id='video-'+randomUUID();assert.equal(videoExecutionId(id),id);for(const value of ['../outside','CON','..','a/../b','trailing.'])assert.throws(()=>videoExecutionId(value));});
test('a lost video receipt blocks same-ID and new-ID dispatch while retaining DSH-compatible shared intent',async t=>{
 const root=await fixture(t),operationId='cli-receipt-loss',action='task.create',input={name:'original'},options={root,workspaceId:'project',operationId,action,input};let executions=0;
 await assert.rejects(executeChannelOperation({...options,execute:async()=>({id:'actual-task-'+(++executions)}),writeReceipt:async()=>{throw Error('simulated receipt disk failure')}}),error=>error.unknown&&error.operationId===videoExecutionId(operationId));
 assert.equal(executions,1);const status=await readChannelOperation({root,operationId});assert.equal(status.status,'unknown');assert.equal(status.unknown,true);assert.equal(status.origin,'cli');
 await assert.rejects(executeChannelOperation({...options,execute:async()=>{executions++;return {}}}),error=>error.unknown);
 await assert.rejects(executeChannelOperation({...options,operationId:'new-nonce',execute:async()=>{executions++;return {}}}),error=>error.code==='business-intent-unresolved'&&error.operationId===videoExecutionId(operationId));assert.equal(executions,1);
 const semanticDigest=createHash('sha256').update(canonical({action,input})).digest('hex');const claim=JSON.parse(await readFile(join(root,'.vant/state/video/unresolved',semanticDigest+'.json'),'utf8'));assert.equal(claim.semanticDigest,semanticDigest);assert.equal(claim.version,1);assert.equal(claim.operationId,videoExecutionId(operationId));
});
test('a DSH-format unresolved original claim blocks CLI across a new identity and reordered input',async t=>{
 const root=await fixture(t),operationId='video-'+randomUUID(),request={action:'task.create',input:{name:'shared',metadata:'source'}},semanticDigest=createHash('sha256').update(canonical(request)).digest('hex');
 for(const [relative,value] of [[`.vant/state/video/unresolved/${semanticDigest}.json`,{version:1,operationId,semanticDigest,action:request.action,createdAt:new Date().toISOString()}],[`.vant/state/video/operations/${operationId}.json`,{version:1,operationId,status:'executing',workspaceId:'project',origin:'native-session'}]]){const file=join(root,relative);await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify(value));}
 let executions=0;await assert.rejects(executeChannelOperation({root,workspaceId:'project',operationId:'cli-new',action:request.action,input:{metadata:'source',name:'shared'},execute:async()=>{executions++;return {}}}),error=>error.code==='business-intent-unresolved'&&error.operationId===operationId);assert.equal(executions,0);
});
test('execute errors remain unknown and same-ID replay never reruns a partial effect',async t=>{
 const root=await fixture(t),options={root,workspaceId:'project',operationId:'partial-effect',action:'task.create',input:{name:'partial'}};let effects=0;
 await assert.rejects(executeChannelOperation({...options,execute:async()=>{effects++;throw Error('after write')}}),error=>error.unknown);
 await assert.rejects(executeChannelOperation({...options,execute:async()=>{effects++;return {}}}),error=>error.unknown);assert.equal(effects,1);
});
