import {execFileSync} from 'node:child_process';
export function processIdentity(pid) {
  if(!Number.isSafeInteger(pid)||pid<1)return null;
  try {
    if(process.platform==='win32') {
      const script=`$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if($p){[pscustomobject]@{pid=$p.ProcessId;exe=$p.ExecutablePath;created=$p.CreationDate.ToUniversalTime().ToString('o');command=$p.CommandLine}|ConvertTo-Json -Compress}`;
      const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true}).trim();
      return output?JSON.parse(output):null;
    }
    const created=execFileSync('ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8'}).trim();
    const command=execFileSync('ps',['-p',String(pid),'-o','args='],{encoding:'utf8'}).trim();
    return created?{pid,created,command}:null;
  }catch{return null;}
}
