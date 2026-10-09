import { join, resolve } from 'node:path';
import { loadSettings,externalPath } from './settings.mjs';
import { readJson, id, keys, text } from './shared.mjs';

export const ROOT = loadSettings().paths.workspace;
export function projectPath(root, projectId, folder, name) {
  id(projectId, 'project'); id(name, folder);
  return externalPath(join(root, 'projects', projectId, folder, name + '.json'));
}
export function loadProject(projectId, root = ROOT) {
  id(projectId, 'project');
  const project = readJson(externalPath(join(root, 'projects', projectId, 'project.json')));
  keys(project, ['id', 'name', 'analysisModel', 'execution', 'cores', 'defaultCore', 'refsDir'], 'project');
  if (project.id !== projectId) throw new Error('工程身份不匹配');
  text(project.name, 'project.name'); text(project.analysisModel, 'analysisModel');
  if (!Array.isArray(project.cores)) throw new Error('project.cores 必须为数组');
  project.cores.forEach(x => id(x, 'core'));
  if (new Set(project.cores).size !== project.cores.length) throw new Error('工程核心列表重复');
  if (project.defaultCore !== null && !project.cores.includes(project.defaultCore)) throw new Error('defaultCore 不属于该工程');
  return project;
}
export function loadJob(projectId, jobId, module, root = ROOT) {
  const job = readJson(projectPath(root, projectId, 'jobs', jobId));
  if (job.project !== projectId || job.kind !== module) throw new Error('任务工程或模块不匹配');
  return job;
}
export function sourcePath(root, path) {
  text(path, 'source.path', 1024);
  return externalPath(resolve(root, path),'资源');
}
