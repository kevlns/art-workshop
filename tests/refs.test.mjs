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

test('配置与参考指南只读，不生成共享分类目录',()=>fixture(root=>{
  const config=join(root,'config.json');writeJson(config,{paths:{workspace:root,refs:join(root,'imports')},autoSyncSkills:false});
  const result=cli('refs','guide','--config',config,'--dry');assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/shape-language/);assert.match(result.stdout,/scene-light/);
  assert.equal(existsSync(join(root,'imports')),false);
  assert.equal(cli('config','show','--config',config).status,0);assert.equal(existsSync(join(root,'imports')),false);
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
