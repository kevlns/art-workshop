import {processIdentity} from './process-identity.mjs';
import {hash} from './shared.mjs';

// A recycled PID is not evidence that an old task is still running.
// Unreadable identities remain live: uncertainty never authorizes termination.
export function workerAlive(task, inspect = processIdentity) {
  const pid = task.workerPid;
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); } catch (error) { return error.code !== 'ESRCH'; }
  const current = inspect(pid);
  if (!current) return true;
  if (task.workerIdentity) return hash(current) === hash(task.workerIdentity);
  // Historical receipts have no identity. A process born after the completed
  // task cannot be its worker; allow one second for Unix ps time precision.
  const finished = Date.parse(task.finishedAt), created = Date.parse(current.created);
  return !(Number.isFinite(finished) && Number.isFinite(created) && created > finished + 1000);
}
