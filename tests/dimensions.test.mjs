import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveDimensions} from '../lib/dimensions.mjs';
test('nearest legal resolution is deterministic and preserves the requested dimensions',()=>{
 const caps={min:256,max:1024,step:32,maxArea:512*512},request={width:497,height:321};
 const result=resolveDimensions(request,caps);assert.deepEqual(result.requested,request);assert.equal(result.actual.width%32,0);assert.equal(result.actual.height%32,0);assert.ok(result.actual.width*result.actual.height<=caps.maxArea);
 const distance=v=>(v.width-request.width)**2+(v.height-request.height)**2;
 for(let width=256;width<=1024;width+=32)for(let height=256;height<=1024;height+=32)if(width*height<=caps.maxArea)assert.ok(distance(result.actual)<=distance({width,height}));
 assert.deepEqual(resolveDimensions(request,caps),result);
});
test('unfulfillable capabilities reject; tiny and oversized requests clamp without changing design',()=>{
 assert.throws(()=>resolveDimensions({width:512,height:512},{min:256,max:512,step:32,maxArea:1}),/合法/);
 assert.deepEqual(resolveDimensions({width:10,height:10},{min:256,max:512,step:32,maxArea:512*512}).actual,{width:256,height:256});
 assert.deepEqual(resolveDimensions({width:5000,height:5000},{min:256,max:512,step:32,maxArea:512*512}).actual,{width:512,height:512});
});
