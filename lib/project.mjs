import { join, resolve } from 'node:path';
import { loadSettings,externalPath } from './settings.mjs';
import { readJson, id, keys, text } from './shared.mjs';
import {ownedPath,readObject} from './workspace.mjs';
import {existsSync} from 'node:fs';

export const ROOT = loadSettings().paths.workspace;
export function projectPath(root, projectId, folder, name) {
  id(projectId, 'project'); id(name, folder);
  return folder==='cores'?ownedPath(root,'projects',projectId,'styles',name,'core.json'):ownedPath(root,'projects',projectId,folder,name+'.json');
}
export function loadProject(projectId, root = ROOT) {
  id(projectId, 'project');
  if(existsSync(ownedPath(root,'.runtime/upgrades',projectId+'.json')))throw new Error('工程升级事务未完成，请显式 project upgrade 恢复');
  const project = readJson(externalPath(join(root, 'projects', projectId, 'project.json')));
  return validateProject(project,projectId);
}
export function validateProject(project,projectId){
  id(projectId,'project');
  keys(project, ['schemaVersion','revision','id', 'name', 'analysisModel', 'execution', 'cores', 'defaultCore'], 'project');
  if(project.schemaVersion!==2)throw new Error('工程格式需显式升级，不能读取旧结构');
  if (project.id !== projectId) throw new Error('工程身份不匹配');
  text(project.name, 'project.name'); text(project.analysisModel, 'analysisModel');
  if (!Array.isArray(project.cores)) throw new Error('project.cores 必须为数组');
  project.cores.forEach(x => id(x, 'core'));
  if (new Set(project.cores).size !== project.cores.length) throw new Error('工程核心列表重复');
  if (project.defaultCore !== null && !project.cores.includes(project.defaultCore)) throw new Error('defaultCore 不属于该工程');
  return project;
}
export function loadJob(projectId, jobId, module, root = ROOT) {
  const record=readObject(root,projectId,'task',jobId),job=record.config;
  if(record.status==='discarded'||job.project!==projectId||job.kind!==module)throw new Error('任务工程或模块不匹配');
  return job;
}

export function sourcePath(root, path) {
  text(path, 'source.path', 1024);
  return externalPath(resolve(root, path),'资源');
}
