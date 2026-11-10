import {realpath,lstat} from 'node:fs/promises';
import {realpathSync,statSync} from 'node:fs';
import {dirname,basename,join,isAbsolute,relative,resolve} from 'node:path';

const failure=message=>Object.assign(new Error(message),{code:'path-outside-workspace',status:422});
export function canonicalVideoRoot(root){if(typeof root!=='string'||!isAbsolute(root))throw failure('视频工程根目录无效');const actual=realpathSync.native(root);if(!statSync(actual).isDirectory())throw failure('视频工程根目录不是文件夹');return actual;}

/** Resolve existing and not-yet-created project files without following an escaping ancestor. */
export async function projectPath(root,path){
 if(typeof root!=='string'||!isAbsolute(root)||typeof path!=='string'||path.includes('\0'))throw failure('视频路径或工程根目录无效');
 const base=await realpath(root),target=resolve(base,path),delta=relative(base,target),lexicallyInside=!delta.startsWith('..')&&!isAbsolute(delta);
 if(!isAbsolute(path)&&!lexicallyInside)throw failure('路径超出 workspace');
 let ancestor=target;const missing=[];
 for(;;){
  try{const actual=join(await realpath(ancestor),...missing),inside=relative(base,actual);if(inside.startsWith('..')||isAbsolute(inside))throw failure('真实路径超出 workspace');return lexicallyInside?target:actual;}
  catch(error){if(error.code!=='ENOENT')throw error;const existing=await lstat(ancestor).catch(cause=>{if(cause.code==='ENOENT')return null;throw cause;});if(existing?.isSymbolicLink())throw failure('视频路径包含不可解析的链接');const parent=dirname(ancestor);if(parent===ancestor)throw error;missing.unshift(basename(ancestor));ancestor=parent;}
 }
}
