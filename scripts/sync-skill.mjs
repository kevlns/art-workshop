import {autoSync} from '../lib/agent.mjs';
import {loadSettings} from '../lib/settings.mjs';
try {
  const result=process.env.npm_lifecycle_event==='postinstall'&&!loadSettings().autoSyncSkills?{skipped:true,reason:'autoSyncSkills=false'}:autoSync({cwd:process.env.INIT_CWD??process.cwd()});
  console.log(JSON.stringify(result,null,2));
} catch(error) {console.error(`美术工坊 skill 同步失败：${error.message}；可稍后运行 agent init 重试。`);process.exitCode=1;}
