import {keys,id,text,texts,integer,hash} from './shared.mjs';
import {ROOT,loadProject,loadJob,sourcePath} from './project.mjs';
import {loadCore,corePrompt,coreNegative} from './core.mjs';
import {execution,finishPlan} from './plan.mjs';
import {background} from './presentation.mjs';
import {sha256File} from './bl.mjs';
const targets=['background','style','shape','color','composition','content','detail','text'];
export function compileEdit({projectId,jobId,coreId,root=ROOT,localExecution={}}) {
  const project=loadProject(projectId,root),job=loadJob(projectId,jobId,'edit',root);
  keys(job,['project','kind','core','execution','items'],'edit job');
  if(coreId&&job.core&&coreId!==job.core) throw new Error('核心与编辑任务绑定冲突');
  const selected=coreId??job.core,core=selected?loadCore(projectId,selected,root):null,refs=[],items=[],ids=new Set();
  if(!Array.isArray(job.items)||!job.items.length) throw new Error('编辑 items 必须非空');
  for(const source of job.items) {
    keys(source,['id','source','changes','preserve','mustRead','seed'],'edit item');id(source.id);
    if(ids.has(source.id)) throw new Error('编辑 item ID 重复');ids.add(source.id);
    const path=sourcePath(root,source.source),fileHash=sha256File(path);refs.push({path,hash:fileHash});
    if(!source.changes?.length||!Array.isArray(source.preserve)) throw new Error('编辑必须明确 changes 和 preserve');
    const changed=new Set(),preserved=new Set();
    const render=(row,set,isChange)=>{
      keys(row,['target','instruction','value'],'edit scope'); if(!targets.includes(row.target)||set.has(row.target)) throw new Error('编辑范围非法或重复');set.add(row.target);
      if(isChange&&row.target==='background') {keys(row,['target','value'],'background change'); return background(row.value,true);}
      keys(row,['target','instruction'],'edit instruction');return `${row.target}：${text(row.instruction,'instruction')}。`;
    };
    const changes=source.changes.map(x=>render(x,changed,true)),preserve=source.preserve.map(x=>render(x,preserved,false));
    if([...changed].some(x=>preserved.has(x))) throw new Error('修改与保留范围冲突');
    if(core&&(changed.has('style')||preserved.has('style'))) throw new Error('绑定核心时，风格由核心负责，不能再声明修改或保留原风格');
    texts(source.mustRead,'mustRead');const seed=source.seed??parseInt(hash([projectId,jobId,source.id]).slice(0,7),16);integer(seed,'seed');
    items.push({itemId:source.id,variantId:'base',seed,brief:source,prompt:`基于输入原图编辑。未声明修改的部分保持原样。\n【修改】\n${changes.join('\n')}\n【保留】\n${preserve.join('\n')}${core?'\n【目标风格核心】\n'+corePrompt(core):''}`,negativeBlock:core?coreNegative(core):'',imageArgs:[path],checks:{content:source.mustRead,style:core?[corePrompt(core)]:['原图风格保持一致'],asset:changes.concat(preserve)}});
  }
  return finishPlan({module:'edit',project:projectId,job:jobId,execution:execution(project,job.execution,localExecution),sources:{core:core?.id??null,coreHash:core?.coreHash??null,selection:selected?'编辑显式绑定':'保留原图'},snapshots:{project,core,job},refs,items});
}
