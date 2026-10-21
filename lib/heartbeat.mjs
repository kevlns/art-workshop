/** Heartbeats are advisory. Durable transitions still use strict writes. */
export function heartbeatTick(persist, warn = console.warn) {
  try { persist(); return true; }
  catch (error) {
    warn(`心跳写入失败，下次重试；关键状态写入仍须成功：${error.code ?? ''} ${error.message}`);
    return false;
  }
}
export function startHeartbeat(persist, interval = 1000) {
  let failed = false;
  return setInterval(() => {
    const ok = heartbeatTick(persist, message => { if (!failed) console.warn(message); });
    if (ok && failed) console.warn('心跳写入已恢复');
    failed = !ok;
  }, interval);
}
