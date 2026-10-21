import test from 'node:test';
import assert from 'node:assert/strict';
import {heartbeatTick} from '../lib/heartbeat.mjs';
import {comfyRecoveryPrompts} from '../lib/comfy-recovery.mjs';
test('heartbeat write denial is diagnostic and the next write can recover',()=>{
 let writes=0;const warnings=[];
 const persist=()=>{if(++writes===1)throw Object.assign(new Error('locked'),{code:'EPERM'});};
 assert.equal(heartbeatTick(persist,m=>warnings.push(m)),false);
 assert.match(warnings[0],/EPERM/);
 assert.equal(heartbeatTick(persist,m=>warnings.push(m)),true);
 assert.equal(warnings.length,1);
});
test('local recovery requires recorded prompt identity and respects sampling count',()=>{
 const task={plan:{backend:{provider:'comfyui'},execution:{perValue:1}},items:[{inputHash:'hash',itemId:'asset',variantId:'base'}],currentItem:{itemId:'asset',variantId:'base'},promptId:'original'};
 assert.deepEqual(comfyRecoveryPrompts(task),{hash:['original']});
 task.plan.execution.perValue=2;
 assert.equal(comfyRecoveryPrompts(task),null);
 task.comfyPrompts={hash:['first','second']};
 assert.deepEqual(comfyRecoveryPrompts(task),task.comfyPrompts);
 task.comfyPrompts={wrong:['id']};assert.equal(comfyRecoveryPrompts(task),null);
});
