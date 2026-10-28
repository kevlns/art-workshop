import {readJson,keys,descriptions} from './shared.mjs';
import {projectPath} from './project.mjs';
import {validateLightProfile} from './presentation.mjs';

/** 编译与只读投影共用规格解析，不把默认值写回任务。 */
export function resolveAssetProfile(root,projectId,job){
  if(Boolean(job.asset)===Boolean(job.profile))throw new Error('任务必须指定一份内联资产规格或一个资产规格模板');
  const profile=job.asset??readJson(projectPath(root,projectId,'profiles',job.profile));
  keys(profile,['project','id','name','constraints','defaults','allowedOverrides','presets','checks','design'],'profile');
  if(profile.project!==projectId||job.profile&&profile.id!==job.profile)throw new Error('资产配置工程身份不匹配');
  keys(profile.constraints,['text','frame','scene','crop','shadow'],'constraints');
  for(const v of Object.values(profile.constraints))if(typeof v!=='boolean')throw new Error('资产约束必须为布尔值');
  descriptions(profile.checks,'profile.checks');
  validateLightProfile(profile);
  return profile;
}
export function taskObjectView(root,record){
  if(record.config.kind!=='generate')return record;
  try{return {...record,resolvedAsset:resolveAssetProfile(root,record.project,record.config)};}
  catch(error){return {...record,assetError:error.message};}
}
