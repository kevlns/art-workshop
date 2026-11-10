import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Getty adapter contract, exact caching and bounded failure behavior',()=>{
 const python=process.env.ART_WORKSHOP_PYTHON??(process.platform==='win32'?'python':'python3');
 const result=spawnSync(python,['-X','utf8',fileURLToPath(new URL('getty_test.py',import.meta.url))],{encoding:'utf8',timeout:30000});
 assert.equal(result.error,undefined,String(result.error));
 assert.equal(result.status,0,result.stdout+result.stderr);
});
