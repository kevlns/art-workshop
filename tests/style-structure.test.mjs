import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {deriveObject,updateObject,readObject,objectFile} from '../lib/workspace.mjs';
import {analysisInput} from '../lib/style-lifecycle.mjs';
import {corePrompt,loadCore} from '../lib/core.mjs';
import {writeJson,hash} from '../lib/shared.mjs';

async function fixture(fn){
 const root=mkdtempSync(join(tmpdir(),'art-structure-'));
 cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});
 const settings={paths:{workspace:root,output:join(root,'output'),cache:join(root,'cache')}};
 try{await fn(root,settings);}finally{rmSync(root,{recursive:true,force:true});}
}
test('compiler groups topics and preserves conditional exclusions once without changing frozen bytes',()=>fixture(root=>{
 const file=join(root,'projects/cellgame/styles/cellgame/core.json'),bytes=readFileSync(file);
 const core=loadCore('cellgame','cellgame',root);
 core.config.rules.push({id:'no-lines',scope:'outline',strength:'avoid',instruction:'内部黑色分隔线',when:'切面物体'});
 core.config.rules.push({...core.config.rules.at(-1),id:'duplicate'});
 const prompt=corePrompt(core);
 assert.equal(prompt.split('内部黑色分隔线').length-1,1);
 assert.match(prompt,/【描边】/);assert.match(prompt,/必须避免（切面物体）/);
 assert.deepEqual(readFileSync(file),bytes);
}));
test('discussion rules save directly, preserve history and compile with conditions',()=>fixture(async(root,settings)=>{
 const file=join(root,'projects/cellgame/styles/cellgame/core.json'),bytes=readFileSync(file);
 const source=readObject(root,'cellgame','style','cellgame');
 const draft=await deriveObject(settings,'cellgame','style',source.id,source.revision);
 const rules=[...draft.config.rules,{id:'texture',scope:'brushwork',strength:'default',instruction:'减少绘画噪点，保留任务要求的纹理',when:'小尺寸图标'}];
 const saved=await updateObject(settings,'cellgame','style',draft.id,draft.revision,{config:{...draft.config,description:'讨论上下文',constraints:['保留原意'],rules}});
 assert.deepEqual(saved.report,draft.report);
 assert.deepEqual(loadCore('cellgame',saved.id,root).config.rules,rules);
 assert.match(corePrompt(loadCore('cellgame',saved.id,root)),/小尺寸图标/);
 assert.deepEqual(readFileSync(file),bytes);
 await assert.rejects(updateObject(settings,'cellgame','style',draft.id,draft.revision,{name:'stale'}),/版本/);
 const input=join(root,'rules.json');writeJson(input,{config:{...saved.config,rules:rules.slice(1)}});
 const result=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('../art-workshop.mjs',import.meta.url)),'style','update','--workspace',root,'--output-dir',settings.paths.output,'--cache-dir',settings.paths.cache,'--project','cellgame','--id',saved.id,'--revision',String(saved.revision),'--input',input],{encoding:'utf8'}));
 assert.deepEqual(result.config.rules,rules.slice(1));assert.deepEqual(result.report,draft.report);
}));
