import {comfyRecoveryPrompts} from './comfy-recovery.mjs';
import {workerAlive} from './worker-process.mjs';
import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { writeJson, hash } from "./shared.mjs";
import {
  runtimeRoot,
  taskFile,
  tasks,
  stateRead,
  terminal,
  sleep,
  locked,
  alive,
  http,
} from "./runtime.mjs";
import { closeService, healthy } from "./service.mjs";
import { cancelPrompt } from "./comfyui.mjs";
import { validatePlan } from "./plan.mjs";
import {assertExecutableStyle} from './style-contract.mjs';
import { executionSettled, executionLifecycle, analysisLocallyStopped } from "./lifecycle.mjs";
import { bindBackend } from "./backends.mjs";
import { assertPlanCurrent } from "./workspace.mjs";
import {
  validateRemotePlan,
  assertRemoteContract,
} from "./generation-policy.mjs";

export function taskItemStates(task) {
  if (!task.plan || !Array.isArray(task.items)) return [];
  const manifest = task.manifestPath ? stateRead(task.manifestPath) : null;
  const rows = manifest?.taskId === task.taskId && manifest?.planHash === task.plan.planHash ? manifest.items ?? [] : [];
  return task.items.map(item => {
    const row = rows.find(row => row.inputHash === item.inputHash);
    return { itemId: item.itemId, variantId: item.variantId, status: row?.status ?? 'queued',
      files: row?.files ?? [], expected: (item.execution ?? task.plan.execution)?.perValue ?? 1 };
  });
}

export function taskView(task) {
  const {
    schema,
    taskId,
    status,
    createdAt,
    heartbeat,
    finishedAt,
    workerPid,
    endpoint,
    promptId,
    manifestPath,
    error,
    diagnostic,
    remoteCancellation,
    unsettled,
    currentItem,
    logPath,
    remoteExecutions,
  } = task;
  const itemStates = taskItemStates(task);
  return {
    itemStates,
    resultVersion: hash(itemStates),
    canResume:
      terminal(task.status) &&
      task.status !== "succeeded" &&
      !workerAlive(task) &&
      (!!comfyRecoveryPrompts(task) || Object.values(task.remoteExecutions ?? {}).some((receipt) =>
        ["accepted", "completed"].includes(receipt.state),
      ) &&
      Object.values(task.remoteExecutions ?? {}).every(
        (receipt) => receipt.state !== "dispatching",
      )),
    operationId: task.operationId ?? null,
    project: task.plan?.project ?? task.project,
    job: task.plan?.job ?? (task.objectKind === "task" ? task.objectId : null),
    styleId: task.styleId ?? null,
    lifecycle: executionLifecycle(task),
    stopConfirmed: executionSettled(task),
    upstreamExecutionUnknown: analysisLocallyStopped(task) && !!task.remoteCancellation,
    schema,
    taskId,
    status,
    createdAt,
    heartbeat,
    finishedAt,
    workerPid,
    endpoint,
    promptId,
    manifestPath,
    error,
    diagnostic,
    remoteCancellation,
    remoteExecutions,
    unsettled,
    currentItem,
    logPath,
    backend:
      task.plan?.backend?.id ?? task.analysisProvider?.providerId ?? "bailian",
    configuration: task.plan?.snapshots?.job ?? null,
  };
}

export function taskStatus(root, taskId) {
  const file = taskFile(root, taskId),
    task = stateRead(file);
  if (!task) throw new Error("任务不存在 " + taskId);
  if (
    !terminal(task.status) &&
    Date.now() - Date.parse(task.heartbeat ?? task.createdAt) > 10000 &&
    !workerAlive(task)
  ) {
    task.status = "unknown";
    task.stopConfirmed = false;
    task.unsettled = true;
    task.error =
      "工作进程退出；后端任务可能仍在运行，请恢复原运行以查询并取回结果，或停止任务确认清理";
    writeJson(file, task);
  }
  return analysisLocallyStopped(task) ? { ...task, stopConfirmed: true } : task;
}
export function failedItems(root, runId, plan) {
  const original = taskStatus(root, runId);
  if (!executionSettled(original))
    throw new Error("原批次停止尚未确认，不能重试");
  if (original.plan?.planHash !== plan.planHash)
    throw new Error("重试必须使用原批次预案，配置已变化请创建新批次");
  if (!original.manifestPath)
    throw new Error("原批次没有逐项结果，不能猜测失败项");
  const manifest = stateRead(original.manifestPath);
  if (manifest?.taskId !== runId || manifest.planHash !== plan.planHash)
    throw new Error("原批次结果身份不匹配");
  const recovered = new Set();
  for (const retry of tasks(root).filter((task) => task.retryOf === runId)) {
    const state = taskStatus(root, retry.taskId);
    if (!executionSettled(state)) throw new Error("已有重试批次停止尚未确认");
    if (state.plan?.planHash !== plan.planHash || !state.manifestPath)
      throw new Error("已有重试批次证据不完整");
    const result = stateRead(state.manifestPath);
    if (result?.taskId !== state.taskId || result.planHash !== plan.planHash)
      throw new Error("重试批次结果身份不匹配");
    for (const row of result.items)
      if (row.ok && row.status === "generated") recovered.add(row.inputHash);
  }
  const failed = manifest.items.filter(
    (row) =>
      row.status === "failed" && !row.ok && !recovered.has(row.inputHash),
  );
  if (failed.some((row) => row.remote?.state === "completed"))
    throw new Error("上游已完成，请恢复原运行取回产物，不能重新提交生成");
  const items = failed.map((row) => {
    const item = plan.items.find((item) => item.inputHash === row.inputHash);
    if (!item) throw new Error("失败项不属于原预案");
    return item;
  });
  if (
    !items.length ||
    new Set(items.map((item) => item.inputHash)).size !== items.length
  )
    throw new Error("没有唯一可重试的失败项");
  return items;
}
export async function startTask(
  plan,
  items,
  settings,
  { operationId = null, retryRun = null } = {},
) {
  validatePlan(plan);
  assertExecutableStyle(plan);
  if (!items.length) throw new Error("没有选中任务");
  if (plan.backend?.provider !== "comfyui") {
    assertRemoteContract(plan);
    validateRemotePlan({ ...plan, items });
  }
  for (const item of items)
    if (!plan.items.some((x) => hash(x) === hash(item)))
      throw new Error("执行项不属于计划");
  const root = runtimeRoot(settings);
  return locked(root, "control", async () => {
    if (retryRun) items = failedItems(root, retryRun, plan);
    if (operationId) {
      if (!/^[a-z0-9-]{1,128}$/.test(operationId))
        throw new Error("操作身份非法");
      const existing = tasks(root).filter((t) => t.operationId === operationId);
      if (existing.length) {
        if (
          existing.length !== 1 ||
          existing[0].plan?.planHash !== plan.planHash ||
          hash(existing[0].items) !== hash(items)
        )
          throw new Error("操作身份已用于其他请求");
        return taskView(taskStatus(root, existing[0].taskId));
      }
    }
    assertPlanCurrent(plan, settings);
    if (
      plan.backend &&
      bindBackend(plan, settings, plan.backend.id).planHash !== plan.planHash
    )
      throw new Error("后端能力或工作流已变化，请重新编译");
    const blocked = tasks(root).filter(
      (t) =>
        (t.plan?.project ?? t.project) === plan.project &&
        (t.plan?.job === plan.job ||
          (t.objectKind === "task" && t.objectId === plan.job)) &&
        !executionSettled(taskStatus(root, t.taskId)),
    );
    if (blocked.length) throw new Error("同一任务已有运行中或停止未确认的执行");
    const gate = stateRead(join(root, "shutdown.json"));
    if (gate && alive(gate.pid))
      throw new Error("shutdown 正在执行，不能启动任务");
    if (gate) rmSync(join(root, "shutdown.json"), { force: true });
    const taskId = "task-" + randomUUID(),
      file = taskFile(root, taskId);
    const logPath = join(root, "tasks", taskId + ".log");
    const task = {
      schema: "art-workshop/task",
      operationId,
      retryOf: retryRun,
      taskId,
      status: "queued",
      stopConfirmed: false,
      createdAt: new Date().toISOString(),
      plan,
      items,
      outputRoot: settings.paths.output,
      root,
      config: settings.file,
      logPath,
    };
    writeJson(file, task);
    const fd = openSync(logPath, "a");
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("./task-worker.mjs", import.meta.url)), file],
      { detached: true, windowsHide: true, stdio: ["ignore", fd, fd] },
    );
    closeSync(fd);
    try {
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
    } catch (error) {
      task.status = "failed";
      task.error = "工作进程启动失败：" + error.message;
      task.stopConfirmed = true;
      task.finishedAt = new Date().toISOString();
      writeJson(file, task);
      throw error;
    }
    child.unref();
    return {
      taskId,
      status: "queued",
      project: plan.project,
      job: plan.job,
      logPath,
    };
  });
}
export async function waitTask(root, taskId, { timeoutSeconds = 3600 } = {}) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (true) {
    const state = taskStatus(root, taskId);
    if (terminal(state.status)) return state;
    if (Date.now() > deadline) throw new Error("等待超时；任务仍在后台运行");
    await sleep(250);
  }
}
export async function cancelTask(root, taskId, { wait = true } = {}) {
  const task = taskStatus(root, taskId),
    file = taskFile(root, taskId);
  if (executionSettled(task)) return task;
  // Only the worker writes a live run document. Cancellation is a separate request;
  // parent read-modify-write would race its heartbeat and lose prompt identities.
  writeJson(file + ".cancel", { requestedAt: new Date().toISOString() });
  if (terminal(task.status)) {
    if (['style-analysis', 'task-reference-analysis'].includes(task.kind) && task.finishedAt) {
      const deadline = Date.now() + 5000;
      while (workerAlive(task) && Date.now() < deadline) await sleep(50);
      const latest = taskStatus(root, taskId);
      if (executionSettled(latest)) return latest;
    }
    if (workerAlive(task))
      throw new Error("工作进程尚未退出，停止结果待确认");
    if (!task.endpoint || !task.promptId)
      throw new Error("没有可核验的后端任务身份，停止结果未知；保留资源");
    await cancelPrompt(task.endpoint, task.promptId);
    const latest = taskStatus(root, taskId);
    if (workerAlive(latest) || latest.promptId !== task.promptId)
      throw new Error("执行身份已变化，请重新查询");
    latest.promptId = null;
    latest.unsettled = false;
    latest.stopConfirmed = true;
    latest.status = "cancelled";
    latest.finishedAt = new Date().toISOString();
    writeJson(file, latest);
    return latest;
  }
  return wait
    ? waitTask(root, taskId, { timeoutSeconds: 60 })
    : { taskId, status: "cancelling", stopConfirmed: false };
}

export async function shutdown(settings, { closeServices = true } = {}) {
  const root = runtimeRoot(settings);
  return locked(root, "control", async () => {
    const gate = join(root, "shutdown.json");
    writeJson(gate, { pid: process.pid, startedAt: new Date().toISOString() });
    const failures = [],
      stopped = [];
    try {
      const active = tasks(root).filter(
        (t) => !executionSettled(taskStatus(root, t.taskId)),
      );
      for (const task of active)
        try {
          await cancelTask(root, task.taskId, { wait: false });
        } catch (e) {
          failures.push(task.taskId + ": " + e.message);
        }
      const backends = Object.entries(settings.generation?.backends ?? {})
        .filter(([, b]) => b.provider === "comfyui")
        .map(([id, b]) => ({ id, ...b }));
      // Frozen tasks may refer to backends removed from the current configuration.
      for (const task of tasks(root))
        if (task.plan?.backend?.provider === "comfyui")
          backends.push(task.plan.backend);
      const endpoints = new Map();
      for (const b of backends)
        for (const endpoint of b.endpoints) endpoints.set(endpoint, b);
      for (const task of active)
        try {
          await waitTask(root, task.taskId, { timeoutSeconds: 60 });
        } catch (e) {
          failures.push(task.taskId + ": " + e.message);
        }
      // A final heartbeat may precede worker exit by a few milliseconds.
      const exitDeadline = Date.now() + 5000;
      while (
        tasks(root).some((t) => workerAlive(t)) &&
        Date.now() < exitDeadline
      )
        await sleep(50);
      // Never close the service while a live art worker is still using it.
      const blockers = tasks(root).filter(
        (t) =>
          !executionSettled(taskStatus(root, t.taskId)) || workerAlive(t),
      );
      if (blockers.length)
        throw new Error(
          "任务尚未停止，保留服务：" +
            (failures.length
              ? failures.join("; ")
              : blockers
                  .map(
                    (t) =>
                      t.taskId + "(status=" + t.status + ", pid=" + t.workerPid + ")",
                  )
                  .join("; ")),
        );
      if (failures.length)
        throw new Error("任务停止尚未确认，保留服务：" + failures.join("; "));
      if (!closeServices)
        return {
          ok: true,
          cancelledTasks: active.map((t) => t.taskId),
          services: [],
        };
      // A shared ComfyUI can contain jobs outside this workspace. Never clear its
      // queue or interrupt them; owned workers cancel only their verified prompt.
      for (const [endpoint, backend] of endpoints)
        if (await healthy(endpoint, backend)) {
          const queue = await http(endpoint, "/queue");
          if (
            (queue.queue_running ?? []).length ||
            (queue.queue_pending ?? []).length
          )
            throw new Error("服务仍有其他任务，保留服务：" + endpoint);
        }
      for (const [endpoint, backend] of endpoints)
        try {
          stopped.push(await closeService(root, endpoint, backend));
        } catch (e) {
          failures.push(endpoint + ": " + e.message);
        }
      if (failures.length)
        throw new Error("shutdown 未完整完成：" + failures.join("; "));
      return {
        ok: true,
        cancelledTasks: active.map((t) => t.taskId),
        remoteCancellationUnconfirmed: active
          .filter((t) => taskStatus(root, t.taskId).remoteCancellation)
          .map((t) => t.taskId),
        services: stopped,
      };
    } finally {
      rmSync(gate, { force: true });
    }
  });
}

export function recoverTask(root, projectId, operationId) {
  if (
    typeof operationId !== "string" ||
    !/^[a-z0-9-]{1,128}$/.test(operationId)
  )
    throw new Error("恢复操作身份非法");
  const matches = tasks(root).filter(
    (t) =>
      t.operationId === operationId &&
      (t.plan?.project ?? t.project) === projectId,
  );
  if (matches.length !== 1)
    throw new Error("没有唯一的原运行证据，停止状态未知；禁止重新启动");
  return taskView(taskStatus(root, matches[0].taskId));
}

/** Resume only durable original remote identities. This path never submits a new request. */
export async function resumeTask(root, taskId) {
  return locked(root, "control", async () => {
    const task = taskStatus(root, taskId),
      file = taskFile(root, taskId);
    if (workerAlive(task) || !terminal(task.status))
      throw new Error("原工作进程仍在执行，不能恢复");
    validatePlan(task.plan);
    if (executionSettled(task) && task.status === "succeeded")
      return taskView(task);
    const localPrompts = comfyRecoveryPrompts(task);
    const identities = Object.entries(task.remoteExecutions ?? {});
    if (
      !localPrompts && (!identities.length ||
      identities.some(
        ([key, receipt]) =>
          !["accepted", "completed", "failed", "cancelled"].includes(
            receipt.state,
          ) ||
          !task.items.some(
            (item) =>
              item.inputHash === key &&
              item.request &&
              hash(item.request) === receipt.requestHash,
          ),
      ))
    )
      throw new Error("缺少唯一可恢复的上游任务身份；禁止重新提交");
    if (
      !localPrompts && !identities.some(([, receipt]) =>
        ["accepted", "completed"].includes(receipt.state),
      )
    )
      throw new Error("没有可继续查询或取回的原任务");
    const gate = stateRead(join(root, "shutdown.json"));
    if (gate && alive(gate.pid)) throw new Error("shutdown 正在执行，不能恢复");
    task.error = null;
    task.diagnostic = null;
    if (localPrompts) task.comfyPrompts = localPrompts;
    task.resumeOnly = true;
    task.status = "queued";
    task.stopConfirmed = false;
    task.unsettled = true;
    task.finishedAt = null;
    task.heartbeat = new Date().toISOString();
    task.workerPid = null;
    task.workerIdentity = null;
    rmSync(file + ".cancel", { force: true });
    if (gate) rmSync(join(root, "shutdown.json"), { force: true });
    writeJson(file, task);
    const fd = openSync(task.logPath, "a"),
      child = spawn(
        process.execPath,
        [fileURLToPath(new URL("./task-worker.mjs", import.meta.url)), file],
        { detached: true, windowsHide: true, stdio: ["ignore", fd, fd] },
      );
    closeSync(fd);
    try {
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
    } catch (error) {
      task.status = "unknown";
      task.error = error.message;
      writeJson(file, task);
      throw error;
    }
    child.unref();
    return taskView(task);
  });
}
