import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {TOOL_ROOT} from '../lib/settings.mjs';
import {ensureReferenceDirectories,REFERENCE_CATEGORIES} from '../lib/refs.mjs';
import {writeJson} from '../lib/shared.mjs';

function fixture(fn){const root=mkdtempSync(join(tmpdir(),'art-workshop-refs-'));try{fn(root);}finally{rmSync(root,{recursive:true,force:true});}}
const cli=(...args)=>spawnSync(process.execPath,[join(TOOL_ROOT,'art-workshop.mjs'),...args],{encoding:'utf8'});

test('配置生效补齐分类，删除后下次恢复，现有素材保持原样',()=>fixture(root=>{
  const refs=join(root,'refs'),config=join(root,'config.json');
  writeJson(config,{paths:{refs},autoSyncSkills:false});
  let result=cli('config','show','--config',config);assert.equal(result.status,0,result.stderr);
  for(const category of REFERENCE_CATEGORIES) assert.ok(existsSync(join(refs,category.directory)));
  writeFileSync(join(refs,'style','keep.png'),'original');rmSync(join(refs,'pose'),{recursive:true});
  result=cli('config','show','--config',config);assert.equal(result.status,0,result.stderr);
  assert.ok(existsSync(join(refs,'pose')));assert.equal(readFileSync(join(refs,'style','keep.png'),'utf8'),'original');
}));

test('guide 使用工程参考目录，CLI 覆盖优先且不调用模型',()=>fixture(root=>{
  cpSync(join(TOOL_ROOT,'tests/fixtures/projects'),join(root,'projects'),{recursive:true});
  const projectFile=join(root,'projects','cellgame','project.json');
  const project=JSON.parse(readFileSync(projectFile,'utf8'));project.refsDir='project-refs';writeJson(projectFile,project);
  const config=join(root,'config.json');writeJson(config,{paths:{workspace:root,refs:join(root,'global-refs')},autoSyncSkills:false});
  let result=cli('refs','guide','--config',config,'--project','cellgame');assert.equal(result.status,0,result.stderr);
  assert.ok(result.stdout.includes(join(root,'project-refs')));assert.ok(result.stdout.includes('不自动识别'));
  assert.ok(existsSync(join(root,'project-refs','material')));
  const override=join(root,'override');result=cli('refs','guide','--config',config,'--project','cellgame','--refs-dir',override,'--dry');
  assert.equal(result.status,0,result.stderr);assert.ok(result.stdout.includes(override));assert.ok(existsSync(join(override,'pose')));
}));

test('分类位置被文件占用时拒绝初始化，保留原文件',()=>fixture(root=>{
  writeFileSync(join(root,'palette'),'keep');assert.throws(()=>ensureReferenceDirectories(root),/被文件占用/);
  assert.equal(readFileSync(join(root,'palette'),'utf8'),'keep');assert.equal(existsSync(join(root,'style')),false);
}));

test('分类目录不能通过链接指向工具安装目录',()=>fixture(root=>{
  // Windows junction avoids requiring symlink privileges.
  const result=spawnSync(process.execPath,['--input-type=module','-e','import fs from "node:fs";fs.symlinkSync(process.argv[1],process.argv[2],"junction")',TOOL_ROOT,join(root,'style')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.throws(()=>ensureReferenceDirectories(root),/工具目录之外/);
}));
