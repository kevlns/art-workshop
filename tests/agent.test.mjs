import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {TOOL_ROOT as ROOT} from '../lib/settings.mjs';
import {exportSkill,agentIndex} from '../lib/agent.mjs';
import {skillDocs} from '../scripts/command-docs.mjs';

test('distributed skill and discovery index use the current authority',()=>fixture(base=>{
 assert.equal(readFileSync(join(ROOT,'skills/art-workshop/SKILL.md'),'utf8'),skillDocs());
 const manifest=JSON.parse(readFileSync(join(ROOT,'v-cli.plugin.json'),'utf8'));
 const index=agentIndex(ROOT,base);
 for(const module of index.modules)assert.deepEqual(module.actions,manifest.agent.commands.filter(command=>command.path[0]===module.name&&command.path.length===2).map(command=>command.path[1]));
 for(const action of ['revise','export','import','sources'])assert.ok(index.modules.find(module=>module.name==='style').actions.includes(action));
}));
function fixture(fn){const root=mkdtempSync(join(tmpdir(),'art-workshop-agent-'));try{return fn(root);}finally{rmSync(root,{recursive:true,force:true});}}
test('显式导出保留完整脚本和宿主适配，默认不探测目录',()=>fixture(base=>{
 assert.throws(()=>exportSkill({directory:base}),/显式/);
 assert.throws(()=>exportSkill({host:'codex'}),/显式/);
 const dry=exportSkill({directory:base,host:'codex',dry:true});assert.equal(existsSync(dry.target),false);
 exportSkill({directory:base,host:'codex'});const target=join(base,'art-workshop');
 assert.ok(existsSync(join(target,'scripts/getty.py')));assert.ok(existsSync(join(target,'agents/openai.yaml')));
 assert.equal(existsSync(join(target,'runtime.json')),false);assert.equal(existsSync(join(base,'.codex')),false);
 writeFileSync(join(target,'PROJECT.md'),'project notes');exportSkill({directory:base,host:'claude'});
 assert.equal(readFileSync(join(target,'PROJECT.md'),'utf8'),'project notes');
}));
test('能力索引包含三个模块、实际工程及任务',()=>fixture(base=>{cpSync(join(ROOT,'tests/fixtures/projects'),join(base,'projects'),{recursive:true});const index=agentIndex(ROOT,base);assert.equal(index.projects[0].id,'cellgame');assert.ok(index.projects[0].jobs.includes('skills'));assert.deepEqual(index.modules.slice(0,3).map(x=>x.name),['style','generate','edit']);}));
test('CLI发现和技能导出预演只读，运行规范从声明的SKILL读取',()=>fixture(base=>{
 const run=args=>spawnSync(process.execPath,[join(ROOT,'art-workshop.mjs'),...args,'--workspace',base],{cwd:base,encoding:'utf8'});
 const index=run(['agent','index']);assert.equal(index.status,0,index.stderr);
 const dry=run(['agent','export','--directory',base,'--host','codex','--dry']);assert.equal(dry.status,0,dry.stdout+dry.stderr);
 assert.equal(existsSync(join(base,'art-workshop')),false);
 const docs=run(['agent','docs']);assert.equal(docs.status,0,docs.stderr);assert.equal(docs.stdout.trim(),skillDocs().trim());
}));
test('非法目标不会覆写其他文件',()=>fixture(base=>{
 writeFileSync(join(base,'art-workshop'),'keep');assert.throws(()=>exportSkill({directory:base,host:'codex'}),/不是普通目录/);
 assert.equal(readFileSync(join(base,'art-workshop'),'utf8'),'keep');
}));
test('安装包没有默认同步脚本或外部Agent配置，适配单独保存',()=>{
 const pkg=JSON.parse(readFileSync(join(ROOT,'package.json'),'utf8'));
 assert.equal(pkg.scripts.postinstall,undefined);assert.equal(existsSync(join(ROOT,'skills/art-workshop/agents')),false);
 assert.ok(existsSync(join(ROOT,'adapters/codex/agents/openai.yaml')));
});
