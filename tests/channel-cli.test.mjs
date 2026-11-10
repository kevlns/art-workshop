import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {actions} from '../lib/video.mjs';
const entry=fileURLToPath(new URL('../art-workshop.mjs',import.meta.url));
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'art-channels-'));t.after(()=>rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:50}));return root;}
const call=(root,args,env={})=>{const processResult=spawnSync(process.execPath,[entry,...args],{cwd:root,env:{...process.env,...env},encoding:'utf8',timeout:30000});let value;try{value=JSON.parse(processResult.stdout)}catch{}return {...processResult,value};};
const video=(root,args)=>call(root,['video',...args,'--workspace',root]);

test('image and video help/version do not load malformed image configuration or initialize a workspace',async t=>{
 const root=await fixture(t),config=join(root,'broken.json');await writeFile(config,'broken');
 for(const channel of ['image','video'])for(const suffix of [[],['--help'],['help'],['--version']]){const result=call(root,[channel,...suffix],{ART_WORKSHOP_CONFIG:config});assert.equal(result.status,0,result.stderr);assert.ok(result.stdout.trim());}
 await assert.rejects(access(join(root,'.vant')),{code:'ENOENT'});
});
test('explicit image paths dispatch the existing implementation and preserve legacy root output',async t=>{
 const root=await fixture(t);
 const legacy=call(root,['workflow','list']),image=call(root,['image','workflow','list']);
 assert.equal(legacy.status,0,legacy.stdout+legacy.stderr);assert.equal(image.status,0,image.stdout+image.stderr);assert.deepEqual(image.value,legacy.value);
 await assert.rejects(access(join(root,'.vant')),{code:'ENOENT'});
});
test('video reads expose real contracts without loading image settings or starting a runtime',async t=>{
 const root=await fixture(t),config=join(root,'broken.json');await writeFile(config,'broken');
 const result=call(root,['video','describe','--workspace',root],{ART_WORKSHOP_CONFIG:config});
 assert.equal(result.status,0,result.stdout+result.stderr);for(const action of actions)assert.ok(result.value.actions.includes(action),action);
 assert.equal(result.value.runtimePolicy.readNeverStartsService,true);
 const status=video(root,['runtime','status']);assert.equal(status.status,0,status.stdout+status.stderr);
 await assert.rejects(access(join(root,'.vant')),{code:'ENOENT'});
});
test('video task creation requires a durable operation identity and reuses the same original receipt',async t=>{
 const root=await fixture(t),input=join(root,'create.json');await writeFile(input,JSON.stringify({name:'CLI 视频任务'}));
 const absent=video(root,['task','create','--input','create.json']);assert.equal(absent.status,1);assert.equal(absent.value.code,'video-cli-operation-invalid');
 await assert.rejects(access(join(root,'.vant/video/project.json')),{code:'ENOENT'});
 const first=video(root,['task','create','--input','create.json','--operation','authorized-create-one']);assert.equal(first.status,0,first.stdout+first.stderr);assert.match(first.value.cliExecution.operationId,/^video-[a-f0-9-]{36}$/);
 const repeated=video(root,['task','create','--input','create.json','--operation','authorized-create-one']);assert.equal(repeated.status,0,repeated.stdout+repeated.stderr);assert.deepEqual(repeated.value,first.value);
 const list=video(root,['task','list']);assert.equal(list.status,0,list.stdout+list.stderr);assert.equal(list.value.length,1);
 const receipt=video(root,['execution','status','--operation','authorized-create-one']);assert.equal(receipt.status,0,receipt.stdout);assert.equal(receipt.value.status,'succeeded');assert.equal(receipt.value.origin,'cli');assert.equal(receipt.value.originOperationId,'authorized-create-one');
 await writeFile(input,JSON.stringify({name:'different intent'}));const conflict=video(root,['task','create','--input','create.json','--operation','authorized-create-one']);assert.equal(conflict.status,1);assert.equal(conflict.value.code,'video-operation-conflict');
 assert.equal(video(root,['task','list']).value.length,1);
});
test('video settings preserve CAS, safe project input paths, and structured stale-version failure',async t=>{
 const root=await fixture(t),before=video(root,['settings','get']);assert.equal(before.status,0,before.stdout);assert.equal(before.value.revision,'missing');
 const request={settings:before.value.settings,expectedRevision:'missing'};await writeFile(join(root,'save.json'),JSON.stringify(request));
 const saved=video(root,['settings','save','--input','save.json','--operation','settings-save-one']);assert.equal(saved.status,0,saved.stdout+saved.stderr);assert.match(saved.value.revision,/^[a-f0-9]{64}$/);
 const stale=video(root,['settings','save','--input','save.json','--operation','settings-save-stale']);assert.equal(stale.status,1);assert.equal(stale.value.code,'video-settings-conflict');assert.equal(stale.value.unknown,true);
 assert.equal(video(root,['settings','get']).value.revision,saved.value.revision);
 const outside=await fixture(t);await writeFile(join(outside,'request.json'),'{}');await symlink(outside,join(root,'escape'),process.platform==='win32'?'junction':'dir');
 const escaped=video(root,['task','create','--input','escape/request.json','--operation','escaped-one']);assert.equal(escaped.status,1);assert.equal(escaped.value.code,'path-outside-workspace');
 const unknown=video(root,['settings','get','--config',join(root,'anything')]);assert.equal(unknown.status,1);assert.equal(unknown.value.code,'video-cli-argument-invalid');
});
test('manifest advertises both nested channels while preserving all previous image command contracts',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../v-cli.plugin.json',import.meta.url),'utf8'));
 const legacy=manifest.agent.commands.filter(command=>!['image','video'].includes(command.path[0]));
 for(const command of legacy){const alias=manifest.agent.commands.find(row=>row.path.join(' ')==='image '+command.path.join(' '));assert.ok(alias,command.path.join(' '));assert.deepEqual(alias.options,command.options);assert.deepEqual(alias.output,command.output);}
 for(const action of actions){const command=manifest.agent.commands.find(row=>row.path.join(' ')==='video '+action.replaceAll('.',' '));assert.ok(command,action);assert.equal(command.capabilityId,'art.video-'+action.replaceAll('.','-'));assert.equal(command.output.format,'json');}
 assert.ok(manifest.agent.commands.some(row=>row.path.join(' ')==='video execution status'));
});
