import {EDIT_FIELDS,textSpecs,textSpecLine,textFidelityNegative} from './task-contract.mjs';
import {description,descriptions} from './shared.mjs';
import {editingPrompt,COMPILER_VERSION} from './prompt-structure.mjs';
import {TRANSPARENT_OUTPUT} from './transparent-output.mjs';
import {taskReferencePrompt} from './task-references.mjs';
import {readObject,verifyReferences} from './workspace.mjs';
import {keys,id,text,integer,hash} from './shared.mjs';
import {ROOT,loadProject,loadJob,sourcePath} from './project.mjs';
import {loadCore,corePrompt,coreNegative} from './core.mjs';
import {execution,finishPlan} from './plan.mjs';
import {background} from './presentation.mjs';
import {sha256File} from './bl.mjs';
export function compileEdit({projectId,jobId,coreId,root=ROOT,localExecution={}}) {
  const taskRecord=readObject(root,projectId,'task',jobId);const dynamicRefs=verifyReferences(root,taskRecord);
  const project=loadProject(projectId,root),job=loadJob(projectId,jobId,'edit',root);
  keys(job,['project','kind','core','execution','analysis','generation','items'],'edit job');
  if(job.generation&&localExecution.model)job.execution={...job.execution,model:localExecution.model};
  if(coreId&&job.core&&coreId!==job.core) throw new Error('核心与编辑任务绑定冲突');
  const selected=coreId??job.core,core=selected?loadCore(projectId,selected,root):null,refs=dynamicRefs.map(r=>({path:r.path,hash:r.hash})),items=[],ids=new Set();
  if(!Array.isArray(job.items)||!job.items.length) throw new Error('编辑 items 必须非空');
  for(const [sourceIndex,source] of job.items.entries()) {
    keys(source,EDIT_FIELDS,'edit item');
    const readable=textSpecs(source.textSpecs,`items[${sourceIndex}].textSpecs`);id(source.id);
    if(ids.has(source.id)) throw new Error('编辑 item ID 重复');ids.add(source.id);
    const path=sourcePath(root,source.source),fileHash=sha256File(path);refs.push({path,hash:fileHash});
    if(!source.changes?.length||!Array.isArray(source.preserve)) throw new Error('编辑必须明确 changes 和 preserve');
    const changed=new Set(),preserved=new Set();
    const render=(row,set,isChange)=>{
      keys(row,['target','instruction','value'],`编辑对象 ${source.id} 范围`); text(row.target,`编辑对象 ${source.id} 的 target`,100);set.add(row.target);
      if(isChange&&row.target==='background') {keys(row,['target','value'],'background change'); return background(row.value,true);}
      keys(row,['target','instruction'],'edit instruction');return `${row.target}：${description(row.instruction,'instruction')}。`;
    };
    const changes=source.changes.map(x=>render(x,changed,true)),preserve=source.preserve.map(x=>render(x,preserved,false));
    if(source.changes.filter(x=>x.target==='background').length>1) throw new Error(`编辑对象 ${source.id} 只能设置一个最终背景，请合并 changes 中的 background`);
    if(core&&(changed.has('style')||preserved.has('style'))) throw new Error('绑定核心时，风格由核心负责，不能再声明修改或保留原风格');
    descriptions(source.mustRead,'mustRead');const seed=source.seed??parseInt(hash([projectId,jobId,source.id]).slice(0,7),16);integer(seed,'seed');
    items.push({...(source.changes.some(x=>x.target==='background'&&x.value?.type==='transparent')?{output:TRANSPARENT_OUTPUT}:{}),itemId:source.id,variantId:'base',seed,brief:source,prompt:editingPrompt({changes,preserve,frozen:core?corePrompt(core):'',references:taskReferencePrompt(taskRecord,source.id),mustRead:source.mustRead,textSpecs:readable}),negativeBlock:textFidelityNegative(core?coreNegative(core):'',readable),imageArgs:[path],checks:{content:readable.length?[...source.mustRead,...readable.map(textSpecLine)]:source.mustRead,style:core?[corePrompt(core)]:['原图风格保持一致'],asset:changes.concat(preserve)}});
  }
  return finishPlan({compilerVersion:COMPILER_VERSION,module:'edit',project:projectId,job:jobId,execution:execution(project,job.execution,localExecution),sources:{taskRevision:taskRecord.revision,taskConfigHash:hash(taskRecord.config),core:core?.id??null,coreHash:core?.coreHash??null,selection:selected?'编辑显式绑定':'保留原图'},snapshots:{project,core,job},refs,items});
}
