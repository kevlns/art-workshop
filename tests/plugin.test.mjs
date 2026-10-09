import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

test('帮助和版本不加载用户配置，不触发资源目录或模型操作',()=>{
  const root=mkdtempSync(join(tmpdir(),'art-help-'));
  try{
    const config=join(root,'broken.json');writeFileSync(config,'invalid');
    for(const flag of ['--help','-h','help','--version']){
      const result=spawnSync(process.execPath,[fileURLToPath(new URL('../art-workshop.mjs',import.meta.url)),flag],{env:{...process.env,ART_WORKSHOP_CONFIG:config},encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
      assert.ok(result.stdout.trim());
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('v-cli 清单包含完整三模块及预演副作用说明',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../v-cli.plugin.json',import.meta.url),'utf8'));
  for(const command of ['style analyze','style validate','style freeze','style show','generate show','generate plan','generate run','edit show','edit plan','edit run','refs guide','config show','check','select','compare']){
    const meta=manifest.agent.commands.find(c=>c.path.join(' ')===command);
    assert.ok(meta,command);
    for(const key of ['usage','description','arguments','options','output','exitCodes','safety'])assert.ok(meta[key],command+'.'+key);
  }
  assert.ok(manifest.agent.commands.find(c=>c.path.join(' ')==='generate run').options.some(o=>o.flags==='--dry'));
  assert.ok(manifest.agent.commands.find(c=>c.path.join(' ')==='generate run').safety.some(s=>s.includes('费用')));
});
