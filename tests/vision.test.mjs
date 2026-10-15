import test from 'node:test';
import assert from 'node:assert/strict';
import {callVision} from '../lib/vision.mjs';

for(const api of ['openai-completions','openai-responses','anthropic-messages','google-generative-ai'])test('vision '+api+' uses selected instance and assistant output only',async()=>{
 const previousConfig=process.env.ART_VISION_CONFIG,previousKey=process.env.ART_VISION_KEY;
 process.env.ART_VISION_CONFIG=JSON.stringify({baseUrl:'https://example.test/v1',api,providerId:'account-one',model:'one'});process.env.ART_VISION_KEY='PRIVATE';
 try{
  const value=await callVision(['text','chat','--model','one','--message','Read current style'],{transport:async(url,request)=>{
   assert.ok(!String(url).includes('PRIVATE'));assert.equal(request.redirect,'error');assert.ok(!request.body.includes('PRIVATE'));
   const body=JSON.parse(request.body);assert.equal(api==='openai-responses'?body.max_output_tokens:api==='google-generative-ai'?body.generationConfig.maxOutputTokens:body.max_tokens,16384);
   return new Response(JSON.stringify({choices:[{message:{content:'REPORT'}}],output:[{content:[{type:'output_text',text:'REPORT'}]}],content:[{type:'text',text:'REPORT'}],candidates:[{content:{parts:[{text:'REPORT'}]}}],metadata:'DO NOT USE THIS'}));
  }});
  assert.deepEqual(value,{text:'REPORT'});
  let requests=0;
  await assert.rejects(callVision(['text','chat','--model','other','--message','Read style'],{transport:async()=>{requests++;return new Response('{}');}}),/授权实例/);
  assert.equal(requests,0);
 }finally{if(previousConfig===undefined)delete process.env.ART_VISION_CONFIG;else process.env.ART_VISION_CONFIG=previousConfig;if(previousKey===undefined)delete process.env.ART_VISION_KEY;else process.env.ART_VISION_KEY=previousKey;}
});

test('a truncated report is never accepted as a complete analysis',async()=>{
 const previousConfig=process.env.ART_VISION_CONFIG,previousKey=process.env.ART_VISION_KEY;
 process.env.ART_VISION_CONFIG=JSON.stringify({baseUrl:'https://example.test/v1',api:'openai-completions',maxTokens:8192});process.env.ART_VISION_KEY='PRIVATE';
 try{await assert.rejects(callVision(['text','chat','--model','one','--message','Return JSON'],{transport:async(_url,request)=>{
  assert.equal(JSON.parse(request.body).max_tokens,8192);
  return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{"summary":"partial"}'}}]}));
 }}),/超出模型输出额度/);}finally{if(previousConfig===undefined)delete process.env.ART_VISION_CONFIG;else process.env.ART_VISION_CONFIG=previousConfig;if(previousKey===undefined)delete process.env.ART_VISION_KEY;else process.env.ART_VISION_KEY=previousKey;}
});
test('transport loss is uncertain, whereas rejection before dispatch is settled',async()=>{
 const previousConfig=process.env.ART_VISION_CONFIG,previousKey=process.env.ART_VISION_KEY;process.env.ART_VISION_CONFIG=JSON.stringify({baseUrl:'https://example.test/v1',api:'openai-completions'});process.env.ART_VISION_KEY='PRIVATE';
 try{let uncertain=0,requests=0;const options={onRemoteCancel:()=>uncertain++,transport:async()=>{requests++;throw new TypeError('transport lost');}};
 await assert.rejects(callVision(['text','chat','--model','one','--message','style'],{...options,cancelled:()=>true}),/分析已取消/);assert.equal(requests,0);assert.equal(uncertain,0);
 await assert.rejects(callVision(['text','chat','--model','one','--message','style'],options),/不会自动重发/);assert.equal(uncertain,1);
 }finally{if(previousConfig===undefined)delete process.env.ART_VISION_CONFIG;else process.env.ART_VISION_CONFIG=previousConfig;if(previousKey===undefined)delete process.env.ART_VISION_KEY;else process.env.ART_VISION_KEY=previousKey;}
});
