import {existsSync,lstatSync,statSync,readFileSync,mkdirSync,writeFileSync,readdirSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,dirname} from 'node:path';
import {homedir} from 'node:os';
import {loadProject} from './project.mjs';
import {TOOL_ROOT as ROOT,loadSettings} from './settings.mjs';
import {hash} from './shared.mjs';

export const AGENT_DIRS=['.codex/skills','.agents/skills','.claude/skills','.claude/skill','.cursor/skills','.gemini/skills','.agent/skills','.agent/skill','AgentHome/skills','.windsurf/skills','.trae/skills','.kilocode/skills','.roo/skills','.opencode/skills','.augment/skills','.kiro/skills','.amazonq/skills','.continue/skills'];
const files=['SKILL.md','agents/openai.yaml'];
function directory(path) {return existsSync(path)&&statSync(path).isDirectory();}
function regular(path) {if(existsSync(path)&&!lstatSync(path).isFile()) throw new Error(`同步目标不是普通文件：${path}`);}
export function syncSkill({directory:base,root=ROOT,dry=false,skillDirs}={}) {
  if(!skillDirs&&(!base||!directory(resolve(base)))) throw new Error('技能同步目标目录不存在');
  const source=join(root,'skills','art-workshop');
  const content=Object.fromEntries(files.map(file=>[file,readFileSync(join(source,file),'utf8')]));
  const runtime=JSON.stringify({entry:join(root,'art-workshop.mjs'),root},null,2)+'\n';
  const targets=skillDirs??AGENT_DIRS.map(dir=>join(resolve(base),dir)).filter(directory);
  const result={skill:'art-workshop',source,sourceHash:hash(content),dry,targets:[]};
  for(const dir of [...new Set(targets.map(x=>resolve(x)))]) {
    if(!directory(dir)) continue;
    const target=join(dir,'art-workshop'),rel=relative(dir,target);
    if(isAbsolute(rel)||rel.startsWith('..')) throw new Error('技能同步路径越界');
    if(existsSync(target)&&(lstatSync(target).isSymbolicLink()||!lstatSync(target).isDirectory())) throw new Error(`技能目录不是普通目录：${target}`);
    const destinations={...content,'runtime.json':runtime};
    for(const file of Object.keys(destinations)) {
      const parent=dirname(join(target,file));
      if(existsSync(parent)&&lstatSync(parent).isSymbolicLink()) throw new Error(`技能子目录不能是链接：${parent}`);
      regular(join(target,file));
    }
    const changed=Object.entries(destinations).some(([file,data])=>!existsSync(join(target,file))||readFileSync(join(target,file),'utf8')!==data);
    result.targets.push({directory:dir,target,action:changed?(dry?'would-update':'updated'):'current'});
    if(!dry&&changed) for(const [file,data] of Object.entries(destinations)){const path=join(target,file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,data,'utf8');}
  }
  return result;
}
export function autoSync({root=ROOT,cwd=process.cwd(),home=homedir(),env=process.env}={}) {
  const dirs=[...new Set([cwd,home].flatMap(base=>AGENT_DIRS.map(dir=>join(base,dir))))];
  if(env.CODEX_HOME) dirs.push(join(env.CODEX_HOME,'skills'));
  return syncSkill({root,skillDirs:dirs});
}
export function agentIndex(root=ROOT,workspace=loadSettings().paths.workspace) {
  return {tool:'art-workshop',displayName:'美术工坊',root,workspace,config:loadSettings().file,entry:join(root,'art-workshop.mjs'),skill:{name:'art-workshop',source:join(root,'skills','art-workshop','SKILL.md'),automaticDiscovery:true},modules:[{name:'style',actions:['analyze','validate','freeze','show']},{name:'generate',actions:['show','plan','run']},{name:'edit',actions:['show','plan','run']},{name:'refs',actions:['guide']},{name:'agent',actions:['index','docs','init']}],utilities:['list','check','select','compare'],projects:(directory(join(workspace,'projects'))?readdirSync(join(workspace,'projects')):[]).filter(id=>directory(join(workspace,'projects',id))).map(id=>{const p=loadProject(id,workspace);return {id:p.id,cores:p.cores,defaultCore:p.defaultCore,jobs:readdirSync(join(workspace,'projects',id,'jobs')).filter(x=>x.endsWith('.json')).map(x=>x.slice(0,-5))};})};
}
export function agentDocs(root=ROOT) {return readFileSync(join(root,'README.md'),'utf8')+'\n'+readFileSync(join(root,'docs','core-guidance.md'),'utf8');}
