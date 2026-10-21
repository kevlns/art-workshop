import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {corePrompt,coreNegative,validateCoreConfig} from '../lib/core.mjs';
import {compileGenerate} from '../lib/generate.mjs';
import {compileEdit} from '../lib/edit.mjs';
import {compileRemoteRequest} from '../lib/generation-policy.mjs';
import {bindBackend,buildComfyRequest} from '../lib/backends.mjs';
import {analyzeStyle} from '../lib/analyze.mjs';
import {readJson,writeJson,hash} from '../lib/shared.mjs';
const rule={id:'mixed-medium',scope:'medium',strength:'avoid',instruction:'排除混杂的绘制语言',negative:['混杂的绘制语言'],when:''};
const conditional={id:'conditional-glow',scope:'highlights',strength:'avoid',instruction:'保持当前绘制语言的克制高光',negative:['过度柔光渲染'],when:'任务未要求发光表现时'};
const config={rules:[{id:'medium',scope:'medium',strength:'required',instruction:'数字卡通语言',when:''},rule,conditional]};
async function fixture(fn){const root=mkdtempSync(join(tmpdir(),'art-negative-'));try{cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});await fn(root);}finally{rmSync(root,{recursive:true,force:true});}}
test('explicit global terms and conditional exclusions are compiled separately without guessing',()=>{
 const core={config:{rules:[...config.rules,{...rule,id:'duplicate',negative:[' 混杂的绘制语言 ' ]},{id:'literal',scope:'detail',strength:'avoid',instruction:'保持整体绘制规范，避免多套刻画语言',when:''},{id:'soft',scope:'brushwork',strength:'default',instruction:'默认减少绘画噪点',when:''}]}};
 assert.equal(coreNegative(core),'混杂的绘制语言');
 const positive=corePrompt(core);
 assert.doesNotMatch(positive,/排除混杂的绘制语言/);assert.match(positive,/任务未要求发光表现时/);assert.match(positive,/过度柔光渲染/);assert.match(positive,/避免多套刻画语言/);assert.match(positive,/默认减少绘画噪点/);
 assert.equal(coreNegative({config:{rules:[conditional]}}),'');
 for(const term of ['不要照片写实','避免笔触混乱','no photorealism'])assert.throws(()=>validateCoreConfig({rules:[{...rule,negative:[term]}]}),/否定前缀/);
 assert.throws(()=>validateCoreConfig({rules:[{...rule,strength:'default'}]}),/仅 avoid/);
});
test('native negative API, embedded exclusion API and ComfyUI preserve the same rules',()=>{
 const item={prompt:corePrompt({config}),negativeBlock:coreNegative({config}),seed:1,imageArgs:[]};
 const plan={module:'generate',execution:{model:'qwen-image-3.0-pro',size:'1024*1024',perValue:1,promptExtend:false,watermark:false},items:[item]};
 const native=compileRemoteRequest(plan,item);
 assert.equal(native.negativePrompt,'混杂的绘制语言');assert.equal(native.parameters.negative_prompt,native.negativePrompt);assert.match(native.prompt,/任务未要求发光表现时/);
 const merged=compileRemoteRequest({...plan,execution:{...plan.execution,model:'wan2.7-image'}},item);
 assert.equal(merged.negativePrompt,'');assert.equal(merged.parameters.negative_prompt,undefined);assert.match(merged.prompt,/混杂的绘制语言/);assert.match(merged.prompt,/过度柔光渲染/);
 assert.equal(merged.prompt.split('混杂的绘制语言').length-1,1);
 const long={...item,negativeBlock:'绘制语言'.repeat(150)};
 assert.throws(()=>compileRemoteRequest(plan,long),/负向/);
 assert.doesNotThrow(()=>compileRemoteRequest({...plan,execution:{...plan.execution,model:'wan2.7-image'}},long));
 const localPlan=bindBackend(plan,{generation:{defaultBackend:'local',backends:{local:{provider:'comfyui',model:'qwen-image-2.1-UC-Q4_K_M.gguf',endpoints:['http://127.0.0.1:8188/']}}}});
 const graph=buildComfyRequest(localPlan,localPlan.items[0]),binding=localPlan.backend.bindings.negativePrompt;
 assert.equal(graph.prompt[binding.node].inputs[binding.input],'混杂的绘制语言');
});
test('generation and editing bind the negative terms into each immutable plan',()=>fixture(root=>{
 const file=join(root,'projects/cellgame/styles/cellgame/core.json'),core=readJson(file);core.config=config;delete core.coreHash;core.coreHash=hash(core);writeJson(file,core);
 const generated=compileGenerate({projectId:'cellgame',jobId:'white-cell',root});
 assert.match(generated.items[0].negativeBlock,/混杂的绘制语言/);assert.doesNotMatch(generated.items[0].negativeBlock,/过度柔光/);assert.match(generated.items[0].prompt,/任务未要求发光表现时/);
 const editFile=join(root,'projects/cellgame/tasks/edit-white-background/task.json'),edit=readJson(editFile);
 const source=join(root,'source.png');writeFileSync(source,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));
 edit.config.core='cellgame';edit.config.items[0].source=source;edit.config.items[0].preserve=edit.config.items[0].preserve.filter(x=>x.target!=='style');writeJson(editFile,edit);
 const edited=compileEdit({projectId:'cellgame',jobId:edit.id,root});assert.equal(edited.items[0].negativeBlock,'混杂的绘制语言');
 core.config.rules[1].negative=['不一致的绘制语言'];delete core.coreHash;core.coreHash=hash(core);writeJson(file,core);
 const next=compileGenerate({projectId:'cellgame',jobId:'white-cell',root});assert.notEqual(next.planHash,generated.planHash);assert.notEqual(next.items[0].inputHash,generated.items[0].inputHash);
}));
test('both visual observations and final report synthesis receive abstract negative authorship rules',()=>fixture(async root=>{
 writeFileSync(join(root,'reference.png'),'fixture');
 const result=await analyzeStyle({projectId:'cellgame',root,refsDir:root,dry:true,input:{project:'cellgame',id:'negative-analysis',description:'绘制语言',constraints:[],refs:[{path:'reference.png',scope:'rendering',note:'观察绘制语言'}]}});
 assert.equal(result.remoteCalls,0);assert.equal(result.requests.length,2);
 for(const request of result.requests){assert.match(request.at(-1),/风格负向只排除跨主体复用的绘制语言/);assert.match(request.at(-1),/不得排除具体主体、部件/);assert.match(request.at(-1),/不展开为全局禁止/);}
 assert.match(result.requests.at(-1).at(-1),/negative 为 avoid 规则可选/);
}));
