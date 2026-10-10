import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generationConfig} from '../lib/backends.mjs';
import {id} from '../lib/shared.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const manifest=JSON.parse(readFileSync(join(root,'v-cli.plugin.json'),'utf8'));
const commands=manifest.agent.commands.toSorted((a,b)=>b.path.length-a.path.length);
const flags=options=>new Set(options.flatMap(o=>o.flags.match(/--[a-z][a-z-]*/g)??[]));
const global=flags(manifest.agent.globalOptions);
export function checkInvocation(line){
  if(!line.startsWith('v-cli art '))return;
  const args=line.slice('v-cli art '.length).match(/"(?:[^"\\]|\\.)*"|'[^']*'|\S+/g)??[];
  if(args.length===1&&['--help','--version'].includes(args[0]))return;
  const command=commands.find(c=>c.path.every((p,i)=>p===args[i]));
  if(!command)throw new Error('未知命令：'+line);
  const allowed=new Set([...global,...flags(command.options)]),used=new Set();
  for(const token of args.slice(command.path.length))if(token.startsWith('--')){
    if(!allowed.has(token))throw new Error('命令不支持 '+token+'：'+line);
    if(used.has(token))throw new Error('参数重复 '+token+'：'+line);used.add(token);
  }
  if(used.has('--plan')&&['--backend','--project','--job','--core','--explore'].some(f=>used.has(f)))throw new Error('冻结计划覆盖来源：'+line);
  return command;
}
export function checkDocs(){
  const files=['README.md','AGENTS.md','skills/art-workshop/SKILL.md',...readdirSync(join(root,'docs')).filter(f=>f.endsWith('.md')).map(f=>'docs/'+f)];
  let invocations=0,jsonExamples=0;
  for(const file of files){
    const source=readFileSync(join(root,file),'utf8');
    for(const match of source.matchAll(/```([^\n]*)\n([\s\S]*?)```/g)){
      const language=match[1].trim(),body=match[2];
      if(language==='json'){
        const value=JSON.parse(body);jsonExamples++;
        if(value.generation)generationConfig(value.generation);
        else if(value.provider)generationConfig({backends:{example:value}});
        if(value.project)id(value.project,'文档 project');
        if(value.id)id(value.id,'文档 id');
      }
      for(const raw of body.split('\n')){const line=raw.trim();if(line.startsWith('v-cli art ')){checkInvocation(line);invocations++;}}
    }
    for(const link of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)){
      const target=link[1];if(/^[a-z]+:|^#|^\//i.test(target))continue;
      if(!existsSync(resolve(root,dirname(file),target.split('#')[0])))throw new Error(file+' 文档链接不存在：'+target);
    }
  }
  const reference=readFileSync(join(root,'docs/commands.md'),'utf8');
  for(const command of commands)if(!reference.includes(command.path.join(' ')))throw new Error('命令参考遗漏 '+command.path.join(' '));
  const modes=readFileSync(join(root,'docs/modes.md'),'utf8');
  for(const heading of ['远程文生图','本地内置文生图','本地自定义文生图','远程图编辑','本地 Qwen 2.1 图编辑','风格分析与核心冻结'])if(!modes.includes('## '+heading))throw new Error('缺少模式规范 '+heading);
  return {ok:true,files:files.length,invocations,jsonExamples};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log('docs:check '+JSON.stringify(checkDocs()));}
  catch(error){console.error('docs:check FAILED: '+error.message);process.exitCode=1;}
}
