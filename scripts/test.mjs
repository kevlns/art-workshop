import {readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const directory=new URL('../tests/',import.meta.url);
const files=readdirSync(directory).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>fileURLToPath(new URL(name,directory)));
if(!files.length)throw new Error('No test files');
const testHome=mkdtempSync(join(tmpdir(),'art-test-home-'));
// 进程与本地服务用例串行执行，避免系统查询被并发启动拖至超时。
let result;try{result=spawnSync(process.execPath,['--test','--test-concurrency=1',...files],{stdio:'inherit',env:{...process.env,VANT_HOME:testHome}});}finally{rmSync(testHome,{recursive:true,force:true});}
process.exitCode=result.status??1;
