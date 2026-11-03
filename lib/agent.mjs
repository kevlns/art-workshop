import {existsSync,lstatSync,statSync,readFileSync,mkdirSync,writeFileSync,readdirSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,dirname} from 'node:path';
import {homedir} from 'node:os';
import {loadProject} from './project.mjs';
import {TOOL_ROOT as ROOT,loadSettings} from './settings.mjs';
import {hash} from './shared.mjs';

export function exportSkill({directory,host,root=ROOT,dry=false}={}) {
  if(!['codex','claude'].includes(host)||!directory)throw new Error('导出必须显式指定 host 和 directory');
  const base=resolve(directory);if(!existsSync(base)||!statSync(base).isDirectory()||lstatSync(base).isSymbolicLink())throw new Error('导出目录必须是已有普通目录');
  const source=join(root,'skills/art-workshop'),target=join(base,'art-workshop'),plan=[];
  const walk=(from,to)=>{for(const e of readdirSync(from,{withFileTypes:true})){
    if(e.name==='__pycache__'||e.name.endsWith('.pyc'))continue;
    if(e.isSymbolicLink())throw new Error('导出来源不能包含链接');
    const dest=join(to,e.name);if(existsSync(dest)&&(lstatSync(dest).isSymbolicLink()||e.isDirectory()!==statSync(dest).isDirectory()))throw new Error('导出目标类型冲突');
    if(e.isDirectory())walk(join(from,e.name),dest);else plan.push([dest,readFileSync(join(from,e.name))]);
  }};
  if(existsSync(target)&&(!lstatSync(target).isDirectory()||lstatSync(target).isSymbolicLink()))throw new Error('导出目标不是普通目录');
  walk(source,target);
  if(host==='codex')walk(join(root,'adapters/codex'),target);
  if(!dry)for(const [file,bytes]of plan){mkdirSync(dirname(file),{recursive:true});writeFileSync(file,bytes);}
  return {skill:'art-workshop',host,target,dry,files:plan.length};
}
export function agentIndex(root=ROOT,workspace=loadSettings().paths.workspace) {
  const commands=JSON.parse(readFileSync(join(root,'v-cli.plugin.json'),'utf8')).agent.commands;
  const modules=['style','generate','edit','conversation','refs','agent'].map(name=>({name,actions:commands.filter(command=>command.path[0]===name&&command.path.length===2).map(command=>command.path[1])}));
  return {tool:'art-workshop',displayName:'美术工坊',root,workspace,config:loadSettings().file,entry:join(root,'art-workshop.mjs'),skill:{name:'art-workshop',source:join(root,'skills','art-workshop','SKILL.md'),automaticDiscovery:true},modules,utilities:['environment','project','job','reference','candidate','list','check','compare','task','shutdown','doctor','workflow','config'],projects:(directory(join(workspace,'projects'))?readdirSync(join(workspace,'projects')):[]).filter(id=>directory(join(workspace,'projects',id))).map(id=>{const p=loadProject(id,workspace);return {id:p.id,cores:p.cores,defaultCore:p.defaultCore,jobs:readdirSync(join(workspace,'projects',id,'tasks')).filter(x=>existsSync(join(workspace,'projects',id,'tasks',x,'task.json')))};})};
}
export const GUIDE_FILES=['README.md','docs/modes.md','docs/configuration.md','docs/data-formats.md','docs/commands.md','docs/deployment.md','docs/troubleshooting.md','docs/remote-models.md','docs/model-architecture.md','docs/core-guidance.md'];
export function agentDocs(root=ROOT) {return readFileSync(join(root,'skills/art-workshop/SKILL.md'),'utf8');}

function directory(path){return existsSync(path)&&statSync(path).isDirectory();}
