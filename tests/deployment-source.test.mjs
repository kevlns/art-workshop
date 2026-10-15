import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,existsSync,statSync,mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {ensureDeploymentSource} from '../lib/deployment-source.mjs';
import {spawnDeploymentCommand,deploymentCommandError} from '../lib/deployment-process.mjs';

const git=(args,cwd)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
async function fixture(run){
 const root=mkdtempSync(join(tmpdir(),'art-source-'));
 try{
  const repository=join(root,'upstream');mkdirSync(repository);git(['init','--quiet'],repository);
  writeFileSync(join(repository,'main.py'),'fixture');git(['add','.'],repository);
  git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','fixture'],repository);
  const source={repository:repository.replaceAll('\\','/'),commit:git(['rev-parse','HEAD'],repository)},path=join(root,'install','ComfyUI'),control=join(root,'state','environment');
  const command=async(executable,args,cwd)=>{
   assert.ok(statSync(cwd).isDirectory());
   const child=spawnDeploymentCommand(executable,args,cwd);
   await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('command failed '+code)));});
  };
  await run({root,path,source,control,command,check:()=>{}});
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('first deployment clones and checks out fixed source from a newly created staging directory',()=>fixture(async f=>{
 assert.equal(existsSync(f.control),false);
 await ensureDeploymentSource(f.path,f.source,f);
 assert.equal(git(['rev-parse','HEAD'],f.path),f.source.commit);
 assert.equal(readFileSync(join(f.path,'main.py'),'utf8'),'fixture');
 await ensureDeploymentSource(f.path,f.source,{...f,command:()=>assert.fail('existing source must not clone')});
 writeFileSync(join(f.path,'main.py'),'user edit');
 await assert.rejects(ensureDeploymentSource(f.path,f.source,f),/保留用户环境/);
 assert.equal(readFileSync(join(f.path,'main.py'),'utf8'),'user edit');
}));
test('failed clone can retry without publishing partial source',()=>fixture(async f=>{
 await assert.rejects(ensureDeploymentSource(f.path,f.source,{...f,command:async(executable,args,cwd)=>{
  mkdirSync(args.at(-1));writeFileSync(join(args.at(-1),'partial'),'interrupted');throw new Error('clone interrupted');
 }}),/clone interrupted/);
 assert.equal(existsSync(f.path),false);
 await ensureDeploymentSource(f.path,f.source,f);
 assert.equal(git(['rev-parse','HEAD'],f.path),f.source.commit);
}));
test('cancellation after checkout never publishes source and concurrent destinations are preserved',()=>fixture(async f=>{
 let cancelled=false;
 await assert.rejects(ensureDeploymentSource(f.path,f.source,{...f,command:async(...args)=>{await f.command(...args);cancelled=true;},check:()=>{if(cancelled)throw new Error('cancelled');}}),/cancelled/);
 assert.equal(existsSync(f.path),false);
 await assert.rejects(ensureDeploymentSource(f.path,f.source,{...f,command:async(...args)=>{
  await f.command(...args);if(args[1].includes('checkout')){mkdirSync(f.path);writeFileSync(join(f.path,'user.txt'),'preserve');}
 }}),/禁止覆盖/);
 assert.equal(readFileSync(join(f.path,'user.txt'),'utf8'),'preserve');
}));
test('missing working directory and missing executable produce different diagnostics',()=>fixture(async f=>{
 assert.throws(()=>spawnDeploymentCommand('git',['--version'],join(f.root,'missing')),/工作目录不可用/);
 const child=spawnDeploymentCommand('vant-deliberately-missing-deployment-command',[],f.root);
 await new Promise(resolve=>child.once('error',error=>{
  assert.equal(error.code,'ENOENT');assert.match(deploymentCommandError('git',error).message,/安装 Git for Windows.*重新启动 Vant/);resolve();
 }));
}));
