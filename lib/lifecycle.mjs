/** Execution completion is separate from proof that all side effects have stopped. */
export const RUN_STATES = Object.freeze([
  "queued",
  "running",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
]);
export const terminal = (status) =>
  ["succeeded", "failed", "cancelled", "unknown"].includes(status);
export function executionSettled(task) {
  return (
    terminal(task.status) &&
    task.status !== "unknown" &&
    task.stopConfirmed === true &&
    !task.unsettled &&
    !task.promptId &&
    !task.remoteCancellation &&
    !Object.values(task.remoteExecutions ?? {}).some((receipt) =>
      ["dispatching", "accepted"].includes(receipt.state),
    )
  );
}
export function executionLifecycle(task) {
  if (task.status === "queued") return "accepted";
  if (["running", "cancelling"].includes(task.status)) return "running";
  if (!executionSettled(task)) return "unknown";
  return { succeeded: "completed", failed: "failed", cancelled: "cancelled" }[
    task.status
  ];
}
export function assertIdle(runs, label = "对象") {
  const blocked = runs.filter((run) => !executionSettled(run));
  if (blocked.length)
    throw new Error(
      `${label}存在运行中或停止未确认的执行：${blocked.map((run) => run.taskId).join(", ")}`,
    );
}
