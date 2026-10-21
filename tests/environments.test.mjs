import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readMarker,writeMarker,inspectInstallation,defaultInstallRoot,environmentRoot} from '../lib/environments.mjs';
test('unmanaged installation inspection is read-only and lists missing dependencies',async()=>{
 const root=mkdtempSync(join(tmpdir(),'art-unmanaged-'));
 try{mkdirSync(join(root,'ComfyUI'),{recursive:true});writeFileSync(join(root,'ComfyUI/main.py'),'# user source');const report=await inspectInstallation(root,'http://127.0.0.1:1/');assert.equal(report.managed,false);assert.equal(report.reusable,false);assert.ok(report.missing.some(x=>x.startsWith('Python 环境')));assert.equal(existsSync(join(root,'vant.art.config.json')),false);}finally{rmSync(root,{recursive:true,force:true});}
});
test('environment marker has no executable instructions and refuses a remote endpoint',()=>{
 const root=mkdtempSync(join(tmpdir(),'art-env-marker-'));
 try{const marker=writeMarker(root,{python:'python_embeded/python.exe',endpoint:'http://127.0.0.1:8188/'});assert.equal(readMarker(root).schema,'vant/art-environment-v1');assert.equal(marker.command,undefined);assert.ok(!environmentRoot(root).startsWith(root));assert.ok(defaultInstallRoot().endsWith('art-env'));writeFileSync(join(root,'vant.art.config.json'),JSON.stringify({...marker,endpoint:'https://example.com/'}));assert.throws(()=>readMarker(root),/本机/);}finally{rmSync(root,{recursive:true,force:true});}
});
