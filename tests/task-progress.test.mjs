import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeJson} from '../lib/shared.mjs';
import {taskView} from '../lib/tasks.mjs';
test('running batches expose committed per-item progress and stable result versions',()=>{
 const root=mkdtempSync(join(tmpdir(),'art-progress-'));
 try {
  const task={taskId:'run',status:'running',plan:{planHash:'plan',execution:{perValue:1}},items:[{itemId:'a',variantId:'base',inputHash:'a'},{itemId:'b',variantId:'base',inputHash:'b'}],manifestPath:join(root,'manifest.json')};
  const before=taskView(task);
  assert.deepEqual(before.itemStates.map(i=>i.status),['queued','queued']);
  writeJson(task.manifestPath,{taskId:'run',planHash:'plan',items:[{inputHash:'a',status:'generated',files:['a.png']},{inputHash:'b',status:'running',files:[]}]});
  const partial=taskView(task);
  assert.equal(partial.status,'running');assert.deepEqual(partial.itemStates.map(i=>i.status),['generated','running']);
  assert.notEqual(partial.resultVersion,before.resultVersion);
  task.heartbeat=new Date().toISOString();assert.equal(taskView(task).resultVersion,partial.resultVersion);
  writeJson(task.manifestPath,{taskId:'foreign',planHash:'plan',items:[{inputHash:'a',status:'generated'}]});
  assert.deepEqual(taskView(task).itemStates.map(i=>i.status),['queued','queued']);
 }finally{rmSync(root,{recursive:true,force:true});}
});
