import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {dirname,basename,join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJson,writeJson,keys,text,id} from './shared.mjs';
import {execution} from './plan.mjs';
export const TOOL_ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
export function downloadsDirectory({platform=process.platform,home=homedir(),env=process.env,knownFolder}={}) {
  if(platform==='win32') {
    try {
      const read=knownFolder??(()=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); $downloadPath = (Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders').'{374DE290-123F-4565-9164-39C4925E467B}'; $downloadPath | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true}).trim()));
      const value=read();if(typeof value==='string'&&value.trim()){const expanded=value.replace(/%([^%]+)%/g,(_,name)=>Object.entries(env).find(([key])=>key.toLowerCase()===name.toLowerCase())?.[1]??'%'+name+'%');if(!expanded.includes('%'))return expanded;}
    }catch{}
  }
  if(platform==='linux') {
    const file=join(env.XDG_CONFIG_HOME??join(home,'.config'),'user-dirs.dirs');
    if(existsSync(file)){const match=readFileSync(file,'utf8').match(/^XDG_DOWNLOAD_DIR="([^"]+)"/m);if(match){const value=match[1].replace(/\$\{HOME\}|\$HOME/g,home);if(!value.includes('$')&&isAbsolute(value))return resolve(value);}}
  }
  return join(home,'Downloads');
}
export function externalPath(value,label='路径') {
  text(value,label,2048);const path=resolve(value);
  let ancestor=path;const tail=[];while(!existsSync(ancestor)){const parent=dirname(ancestor);if(parent===ancestor)break;tail.unshift(basename(ancestor));ancestor=parent;}
  const actual=existsSync(ancestor)?join(realpathSync(ancestor),...tail):path;
  const rel=relative(realpathSync(TOOL_ROOT),actual);
  if(rel===''||!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..\\')&&!rel.startsWith('../'))throw new Error(`${label} 必须在工具目录之外：${path}`);
  return path;
}
export function configFile(env=process.env,home=homedir(),platform=process.platform) {
  const base=platform==='win32'?(env.APPDATA??join(home,'AppData','Roaming')):platform==='darwin'?join(home,'Library','Application Support'):(env.XDG_CONFIG_HOME??join(home,'.config'));
  return externalPath(env.ART_WORKSHOP_CONFIG??join(base,'art-workshop','config.json'),'本地配置');
}
export function loadSettings({file=configFile(),workspace,output,refs,cache}={}) {
  const base=join(downloadsDirectory(),'image.g');
  const local=existsSync(file)?readJson(file):{};
  keys(local,['paths','execution','analysisModel','defaultProject','autoSyncSkills'],'config');
  keys(local.paths??{},['workspace','output','refs','cache'],'config.paths');
  keys(local.execution??{},['model','size','promptExtend','perValue','watermark'],'config.execution');
  execution({execution:{}},{},local.execution??{});
  if(local.analysisModel!==undefined&&local.analysisModel!==null)text(local.analysisModel,'analysisModel');
  if(local.defaultProject!==undefined&&local.defaultProject!==null)id(local.defaultProject,'defaultProject');
  if(local.autoSyncSkills!==undefined&&typeof local.autoSyncSkills!=='boolean')throw new Error('autoSyncSkills 必须为布尔值');
  const overrides={workspace,output,refs,cache},defaults={workspace:base,output:base,refs:join(base,'refs'),cache:join(base,'.cache')};
  const paths=Object.fromEntries(Object.keys(defaults).map(key=>[key,externalPath(overrides[key]??local.paths?.[key]??defaults[key],key)]));
  return {file:externalPath(file,'本地配置'),paths,execution:local.execution??{},analysisModel:local.analysisModel??null,defaultProject:local.defaultProject??null,autoSyncSkills:local.autoSyncSkills??true};
}
export function initSettings(file=configFile()) {
  externalPath(file,'本地配置');if(existsSync(file))return loadSettings({file});
  const {file:ignored,...config}=loadSettings({file});writeJson(file,config);return loadSettings({file});
}
