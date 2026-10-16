import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateTaskDraft,taskContract} from '../lib/task-contract.mjs';
import {createObject,updateObject,objectFile} from '../lib/workspace.mjs';

test('draft and compiler share effect fields, incomplete drafts remain editable',async()=>{
 const root=mkdtempSync(join(tmpdir(),'art-task-contract-'));
 cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});
 const settings={paths:{workspace:root}};
 try{
  const config={kind:'generate',items:[{id:'gem',intent:'',entities:[],effects:[]}]};
  const record=await createObject(settings,'cellgame','task',{name:'draft',config});
  const file=objectFile(root,'cellgame','task',record.id),original=readFileSync(file,'utf8');
  const bad={...record.config,items:[{...config.items[0],effects:[{description:'光束',target:'subject'}]}]};
  await assert.rejects(updateObject(settings,'cellgame','task',record.id,1,{config:bad}),/effects\[0\].*description/);
  assert.equal(readFileSync(file,'utf8'),original,'bad chat update must not replace user draft');
  const effect=taskContract('generate').effectExample;
  assert.doesNotThrow(()=>validateTaskDraft({...config,items:[{...config.items[0],effects:[effect]}]}));
  assert.throws(()=>validateTaskDraft({...config,items:[{...config.items[0],entities:[{invented:true}]}]}),/invented/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
