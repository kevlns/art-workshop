import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createServer} from 'node:http';import {createHash} from 'node:crypto';
import {inspectPython,compatiblePython,downloadChecked} from '../lib/environment-runtime.mjs';
import {deploymentGuide} from '../lib/deployment-guide.mjs';
test('runtime selects a compatible interpreter rather than the first existing executable',()=>{
 const root=mkdtempSync(join(tmpdir(),'art-python-selection-'));const contract=deploymentGuide().contract;
 try {for(const relative of contract.pythonCandidates){const file=join(root,relative);mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,'preserve');}
 const inspected=inspectPython(root,contract,path=>path.includes('python_embeded')?[3,14,7]:[3,12,10]);
 assert.equal(inspected.python,'.venv/Scripts/python.exe');assert.equal(inspected.compatible,true);
 assert.equal(compatiblePython([3,14,7],contract),false);assert.equal(compatiblePython(null,contract),false);
 for(const relative of contract.pythonCandidates)assert.equal(readFileSync(join(root,relative),'utf8'),'preserve');
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('runtime downloads validate integrity before promotion and reuse only verified cache',async()=>{
 const root=mkdtempSync(join(tmpdir(),'art-runtime-cache-'));const data=Buffer.from('official fixture');let requests=0;
 const server=createServer((_req,res)=>{requests++;res.end(data);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const url='http://127.0.0.1:'+server.address().port;const file=join(root,'runtime.zip');
 await assert.rejects(downloadChecked(url,'0'.repeat(64),file),/SHA256/);assert.equal(existsSync(file),false);
 const hash=createHash('sha256').update(data).digest('hex');await downloadChecked(url,hash,file);await downloadChecked(url,hash,file);assert.equal(requests,2);
 writeFileSync(file,'corrupt');await downloadChecked(url,hash,file);assert.equal(requests,3);assert.deepEqual(readFileSync(file),data);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true});}
});
