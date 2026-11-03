import {execFileSync} from 'node:child_process';
export function inspectProcess(pid, run = execFileSync, timeout = 5000) {
  if(!Number.isSafeInteger(pid)||pid<1)return {state:'missing'};
  try {
    const options={encoding:'utf8',windowsHide:true,timeout,stdio:['ignore','pipe','pipe']};
    if(process.platform==='win32') {
      const script=`$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if(!$p){'{"state":"missing"}'}elseif(!$p.CreationDate -or !$p.ExecutablePath -or !$p.CommandLine){'{"state":"unknown"}'}else{[pscustomobject]@{state='running';identity=[pscustomobject]@{pid=$p.ProcessId;exe=$p.ExecutablePath;created=$p.CreationDate.ToUniversalTime().ToString('o');command=$p.CommandLine}}|ConvertTo-Json -Compress}`;
      const value=JSON.parse(run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],options).trim());
      if(value.state==='missing')return value;
      if(value.state==='running' && value.identity?.pid===pid && value.identity.created && value.identity.command && value.identity.exe)return value;
      return {state:'unknown'};
    }
    const created=run('ps',['-p',String(pid),'-o','lstart='],options).trim();
    const command=run('ps',['-p',String(pid),'-o','args='],options).trim();
    return created&&command?{state:'running',identity:{pid,created,command}}:{state:'missing'};
  }catch(error){
    if(process.platform!=='win32' && error.status===1 && !String(error.stdout??'').trim() && !String(error.stderr??'').trim())return {state:'missing'};
    return {state:'unknown'};
  }
}
// 启动时系统查询可能冷启动；登记身份仍有总上限，退出探测保持短等待。
export function processIdentity(pid) { return inspectProcess(pid, execFileSync, 15000).identity ?? null; }
