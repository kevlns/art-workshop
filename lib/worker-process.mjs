import {processIdentity} from './process-identity.mjs';
import {hash} from './shared.mjs';

// A recycled PID is not evidence that an old task is still running.
// Unreadable identities remain live: uncertainty never authorizes termination.
export function workerAlive(task, inspect = processIdentity) {
  const pid = task.workerPid;
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  // ESRCH：PID 已消失。其余错误（Windows 的 EPERM/EACCES）只说明该 PID 存在
  // 但不归我们管，通常是 PID 被复用；交给下面的身份比对判定。
  try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return false; }
  const current = inspect(pid);
  if (!current) return true;
  if (task.workerIdentity) return hash(current) === hash(task.workerIdentity);
  // Historical receipts have no identity. A process born after the completed
  // task cannot be its worker; allow one second for Unix ps time precision.
  const finished = Date.parse(task.finishedAt), created = Date.parse(current.created);
  return !(Number.isFinite(finished) && Number.isFinite(created) && created > finished + 1000);
}
