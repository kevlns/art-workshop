import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,rmSync,readdirSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {readObject,objectDirectory,ownedPath,verifyReferences} from './workspace.mjs';
import {hash,id,readJson,writeJson} from './shared.mjs';
import {loadProject} from './project.mjs';
import {locked,runtimeRoot} from './runtime.mjs';

const bytesHash=b=>createHash('sha256').update(b).digest('hex');
const safe=(root,path)=>{if(typeof path!=='string'||!path||isAbsolute(path)||path.includes('\\')||path.split('/').some(x=>!x||x==='.'||x==='..'))throw new Error('风格包资源路径非法');return ownedPath(root,path);};
export function validateStyleBundle(bundle){
  if(bundle?.schema!=='art-workshop/style-bundle'||bundle.schemaVersion!==1)throw new Error('风格包格式不支持');
  const {bundleHash,...body}=bundle;if(hash(body)!==bundleHash)throw new Error('风格包完整性校验失败');
  const {coreHash,...core}=bundle.core??{};
  if(hash(core)!==coreHash||bundle.style?.status!=='frozen'||bundle.style.coreHash!==coreHash||bundle.style.id!==core.id||bundle.style.project!==core.project)throw new Error('冻结风格身份或核心校验失败');
  id(core.id);id(core.project);
  if(!Array.isArray(bundle.style.references)||!Array.isArray(bundle.files)||bundle.files.length>500)throw new Error('风格包参考非法');
  const seen=new Set();let total=0;
  for(const file of bundle.files){
    safe('/bundle',file.path);if(seen.has(file.path))throw new Error('风格包路径重复');seen.add(file.path);
    if(typeof file.data!=='string')throw new Error('风格包图片数据非法');
    const bytes=Buffer.from(file.data,'base64');total+=bytes.length;
    if(bytes.toString('base64')!==file.data||bytesHash(bytes)!==file.hash||total>100*1024*1024)throw new Error('风格包图片校验失败或超限');
  }
  for(const ref of bundle.style.references){safe('/bundle',ref.path);if(!bundle.files.some(file=>file.path===ref.path&&file.hash===ref.hash))throw new Error('风格包缺少参考依赖');}
  if(bundle.files.some(file=>!bundle.style.references.some(ref=>ref.path===file.path)))throw new Error('风格包包含未声明的参考资源');
  return bundle;
}
export function exportStyleBundle(root,project,styleId,destination){
  const style=readObject(root,project,'style',styleId);
  if(style.status!=='frozen')throw new Error('只可导出已冻结风格');
  const core=readJson(ownedPath(objectDirectory(root,project,'style',styleId),'core.json'));
  const references=verifyReferences(root,style);
  // Export only frozen evidence and explicitly owned reference bytes, never settings or runtime files.
  const files=references.map(ref=>({path:style.references.find(item=>item.id===ref.id).path,hash:ref.hash,data:readFileSync(ref.path).toString('base64')}));
  const portable={schema:style.schema,schemaVersion:style.schemaVersion,project:style.project,id:style.id,name:style.name,revision:style.revision,status:style.status,coreHash:style.coreHash,createdAt:style.createdAt,updatedAt:style.updatedAt,config:style.config,references:style.references,report:{data:core.report,sourceRevision:style.revision,path:null,runId:null,sourceHash:null},source:style.source??null};
  const body={schema:'art-workshop/style-bundle',schemaVersion:1,style:portable,core,files};
  const bundle=validateStyleBundle({...body,bundleHash:hash(body)});
  if(existsSync(destination))throw new Error('导出目标已存在，不覆盖共享风格');
  mkdirSync(resolve(destination,'..'),{recursive:true});writeFileSync(destination,JSON.stringify(bundle,null,2)+'\n',{flag:'wx'});
  return {path:destination,id:style.id,revision:style.revision,bundleHash:bundle.bundleHash};
}
export function listStyleSources(directories){
  const sources=directories.map(directory=>{
    const items=[],errors=[];
    try{for(const file of readdirSync(directory).filter(file=>file.endsWith('.style.json')).sort()){
      try{const path=ownedPath(directory,file),raw=readFileSync(path);if(raw.length>150*1024*1024)throw new Error('风格包超限');const bundle=validateStyleBundle(JSON.parse(raw));items.push({path,id:bundle.style.id,name:bundle.style.name,revision:bundle.style.revision,coreHash:bundle.core.coreHash,bundleHash:bundle.bundleHash,project:bundle.style.project});}
      catch(error){errors.push(file+'：'+error.message);}
    }}catch(error){errors.push(error.message);}
    return {directory,items,...(errors.length?{error:errors.join('；')}:{})};
  });
  for(const source of sources)for(const item of source.items){
    item.conflict=sources.flatMap(source=>source.items).some(other=>other.project===item.project&&other.id===item.id&&other.revision===item.revision&&other.coreHash!==item.coreHash);
  }
  return sources;
}
export async function importStyleBundle(settings,projectId,file,expectedHash){
  const raw=readFileSync(file);if(raw.length>150*1024*1024)throw new Error('风格包超限');
  const bundle=validateStyleBundle(JSON.parse(raw));
  if(expectedHash && bundle.bundleHash!==expectedHash)throw new Error("来源风格已变化，请刷新后重新选择");
  return locked(runtimeRoot(settings),'control',async()=>{
    const root=settings.paths.workspace,project=loadProject(projectId,root);
    const localId='shared-'+bundle.bundleHash.slice(0,32);
    const directory=objectDirectory(root,projectId,'style',localId);
    if(existsSync(directory)){
      const existing=readObject(root,projectId,'style',localId);
      if(existing.source?.bundleHash!==bundle.bundleHash)throw new Error('导入身份冲突');
      verifyReferences(root,existing);return existing;
    }
    const origin={id:bundle.style.id,project:bundle.style.project,revision:bundle.style.revision,coreHash:bundle.core.coreHash,bundleHash:bundle.bundleHash};
    const body={...bundle.core,project:projectId,id:localId,report:{...bundle.core.report,project:projectId,id:localId},origin};delete body.coreHash;
    const core={...body,coreHash:hash(body)};
    const style={...bundle.style,project:projectId,id:localId,source:origin,coreHash:core.coreHash,report:{...bundle.style.report,data:core.report}};
    const staging=objectDirectory(root,projectId,'style','import-'+randomUUID());
    try{
      mkdirSync(staging,{recursive:true});
      for(const item of bundle.files){const target=safe(staging,item.path);mkdirSync(resolve(target,'..'),{recursive:true});writeFileSync(target,Buffer.from(item.data,'base64'),{flag:'wx'});}
      writeJson(join(staging,'style.json'),style);writeJson(join(staging,'core.json'),core);
      renameSync(staging,directory);
      try{project.cores.push(localId);project.defaultCore??=localId;writeJson(ownedPath(root,'projects',projectId,'project.json'),project);}
      catch(error){rmSync(directory,{recursive:true,force:true});throw error;}
      return style;
    }finally{rmSync(staging,{recursive:true,force:true});}
  });
}
