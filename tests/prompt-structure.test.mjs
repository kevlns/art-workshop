import test from 'node:test';
import assert from 'node:assert/strict';
import {generationPrompt,editingPrompt} from '../lib/prompt-structure.mjs';
test('prompt leads with purpose and preserves frozen rules verbatim apart from dynamic content',()=>{
  const frozen='描边：粗黑外轮廓。\n材质按任务表达。',intent='用于场景交互的灰色石块';
  const prompt=generationPrompt({intent,frozen,details:['主体为石块','少量大切面'],composition:'居中，完整轮廓',delivery:'1024×1024',asset:'无文字',mustRead:['切面少','切面少'],references:''});
  assert.ok(prompt.indexOf(intent)<prompt.indexOf(frozen));assert.equal(prompt.split(frozen).length,2);assert.equal(prompt.match(/- 切面少/g).length,1);assert.match(prompt,/动态需求/);assert.match(prompt,/交付规格/);
  const edited=editingPrompt({changes:['加粗描边','减少切面'],preserve:['保留整体外形'],frozen,mustRead:['轮廓完整']});
  assert.ok(edited.includes(frozen));assert.match(edited,/加粗描边/);assert.match(edited,/保留整体外形/);
});
