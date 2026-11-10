import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { z } from "zod";
import {
  cutTransition,
  defaultVideoConfig,
  durationConfig,
  planVideoScript,
  videoBusy,
  videoComplete,
  videoDependencyErrors
} from "./contracts.mjs";
import { projectPath } from "./path.mjs";
import { VideoMedia } from "./media.mjs";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const title = z.string().trim().min(1).max(160);
const storyInputSchema = z.object({
  assetId: id,
  kind: z.enum(["first", "last", "middle", "reference"]),
  frame: z.number().int().nonnegative().optional(),
  role: z.enum(["subject", "style", "motion", "camera"]).optional()
}).strict();
const transition = z.object({
  type: z.enum(["cut", "continue", "dissolve"]),
  duration: z.number().finite().min(0).max(30).default(0),
  note: z.string().max(4e3).default("")
}).strict();
const scriptSchema = z.object({
  brief: z.string().max(2e4),
  modelId: z.string().max(100),
  mode: z.enum(["text", "boundary", "reference"]),
  parameters: z.record(
    z.string(),
    z.union([z.string(), z.number().finite(), z.boolean()])
  ),
  inputs: z.array(storyInputSchema).max(128),
  shots: z.array(
    z.object({
      id,
      name: title,
      prompt: z.string().max(2e4),
      duration: z.number().positive().max(7200),
      newClip: z.boolean().default(false),
      mode: z.enum(["text", "boundary", "reference"]).optional(),
      inputs: z.array(storyInputSchema).max(32).default([]),
      transition: transition.default(cutTransition())
    }).strict()
  ).max(128)
}).strict();
const workflowActions = [
  "script.read",
  "script.update",
  "script.plan",
  "script.apply",
  "operation.accept",
  "operation.bind",
  "film.compose",
  "film.refine",
  "film.preview",
  "film.adopt",
  "film.undo",
  "media.status"
];
function conflict() {
  return Object.assign(new Error("任务已变化，请重新读取后再操作"), {
    status: 409
  });
}
function taskIn(state, taskId) {
  const task = state.tasks.find((t) => t.id === id.parse(taskId));
  if (!task) throw new Error("视频任务不存在");
  return task;
}
function operationIn(task, operationId) {
  const op = task.operations.find((o) => o.id === id.parse(operationId));
  if (!op) throw new Error("视频操作不存在");
  return op;
}
function writable(task, revision) {
  if (task.archived) throw new Error("任务已归档");
  if (task.revision !== revision) throw conflict();
}
function touch(task, op) {
  task.revision++;
  task.updatedAt = Date.now();
  if (op) {
    op.revision++;
    op.updatedAt = task.updatedAt;
  }
}
function newOperation(name, config) {
  return {
    id: randomUUID(),
    name,
    revision: 1,
    config,
    runs: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}
function bindTail(task, op) {
  if (!op.dependency) return;
  if (videoBusy(op) || videoComplete(op))
    throw new Error("已运行操作不能改绑，请派生新操作");
  const accepted = operationIn(task, op.dependency.operationId).accepted;
  if (!accepted) throw new Error("请先采纳前段视频");
  op.config.inputs = [
    ...op.config.inputs.filter((i) => i.kind !== "first"),
    { kind: "first", assetId: accepted.tailAssetId }
  ];
  op.dependency = {
    ...op.dependency,
    runId: accepted.runId,
    assetId: accepted.tailAssetId
  };
  touch(task, op);
}
class VideoWorkflow {
  constructor(host) {
    this.host = host;
    this.media = new VideoMedia(() => host.models.get(), host.signal);
  }
  host;
  media;
  async filename(w, file) {
    return projectPath(w.root, join(await this.host.root(w), file));
  }
  async acceptedMedia(w, task, op) {
    return op.accepted?.output ? { path: await this.filename(w, op.accepted.output) } : this.host.media(w, task.id, op.id, op.accepted.runId);
  }
  async filmMedia(w, taskId, filmId) {
    const task = await this.host.get(w, taskId), film = task.films?.find((f) => f.id === id.parse(filmId));
    if (!film) throw new Error("成片版本不存在");
    return {
      path: await this.filename(w, film.output),
      name: `${task.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")}.mp4`
    };
  }
  async execute(w, action, input) {
    if (action === "media.status") return this.media.status();
    if (action === "script.read") return this.host.get(w, input.taskId);
    if (action === "script.plan") {
      const task = await this.host.get(w, input.taskId), script = input.script ? scriptSchema.parse(input.script) : task.script;
      if (!script)
        return { segments: [], errors: ["请先保存剧本"], duration: 0 };
      const model = (await this.host.models.catalog()).find(
        (m) => m.id === script.modelId
      );
      return { ...planVideoScript(script, model), model };
    }
    if (action === "script.update") {
      const script = scriptSchema.parse(input.script);
      if (new Set(script.shots.map((s) => s.id)).size !== script.shots.length)
        throw new Error("镜头 ID 重复");
      if (script.inputs.some((i) => i.kind === "middle"))
        throw new Error("中间帧请绑定到具体镜头");
      return this.host.transaction(w, (state) => {
        const task = taskIn(state, input.taskId);
        writable(task, input.revision);
        for (const i of [
          ...script.inputs,
          ...script.shots.flatMap((s) => s.inputs)
        ])
          if (!state.assets.some((a) => a.id === i.assetId))
            throw new Error("引用素材不存在");
        task.script = { ...script, revision: (task.script?.revision ?? 0) + 1 };
        touch(task);
        return task;
      });
    }
    if (action === "script.apply") return this.apply(w, input);
    if (action === "operation.accept") return this.accept(w, input);
    if (action === "operation.bind")
      return this.host.transaction(w, (state) => {
        const task = taskIn(state, input.taskId), op = operationIn(task, input.operationId);
        if (task.archived || op.revision !== input.revision) throw conflict();
        bindTail(task, op);
        return task;
      });
    if (action === "film.compose") return this.compose(w, input);
    if (action === "film.refine") return this.refine(w, input);
    if (action === "film.preview") return this.preview(w, input);
    if (action === "film.adopt" || action === "film.undo")
      return this.host.transaction(w, (state) => {
        const task = taskIn(state, input.taskId);
        writable(task, input.revision);
        if (action === "film.undo") {
          const current = task.films?.find((f) => f.id === task.currentFilmId);
          if (!current?.parentId) throw new Error("没有可恢复的前一版本");
          task.currentFilmId = current.parentId;
        } else {
          const film = task.films?.find((f) => f.id === id.parse(input.filmId));
          if (!film?.refinementId || film.parentId !== task.currentFilmId)
            throw new Error("候选基于其他成片版本，请重新选择当前版本精修");
          task.currentFilmId = film.id;
        }
        touch(task);
        return task;
      });
    throw new Error("未知视频工作流动作");
  }
  async apply(w, input) {
    const catalog = await this.host.models.catalog();
    return this.host.transaction(w, (state) => {
      const task = taskIn(state, input.taskId);
      writable(task, input.revision);
      if (!task.script) throw new Error("请先保存剧本");
      const model = catalog.find((m) => m.id === task.script.modelId), result = planVideoScript(task.script, model);
      if (result.errors.length) throw new Error(result.errors.join("；"));
      const planId = randomUUID();
      for (let index = 0; index < result.segments.length; index++) {
        const seg = result.segments[index], old = task.plan?.segments.find((s) => s.id === seg.id), prior = old && task.operations.find((o) => o.id === old.operationId);
        const previous = index ? result.segments[index - 1].operationId : void 0;
        const config = structuredClone(seg.config);
        const before = prior ? structuredClone(prior.config) : void 0;
        if (before && prior?.dependency)
          before.inputs = before.inputs.filter(
            (i) => !(i.kind === "first" && i.assetId === prior.dependency.assetId)
          );
        const reusable = prior && JSON.stringify(before) === JSON.stringify(config) && prior.editDuration === seg.duration && (!seg.dependency ? !prior.dependency : prior.dependency?.operationId === previous);
        const op = reusable ? prior : newOperation(seg.name.slice(0, 160), config);
        if (!reusable) {
          op.scriptSegmentId = seg.id;
          op.editDuration = seg.duration;
          if (prior) op.derivedFrom = prior.id;
          if (seg.dependency) {
            op.dependency = { operationId: previous };
            if (task.operations.find((o) => o.id === previous)?.accepted)
              bindTail(task, op);
          }
          task.operations.push(op);
        }
        seg.operationId = op.id;
      }
      task.plan = {
        id: planId,
        scriptRevision: task.script.revision,
        model: structuredClone(model),
        segments: result.segments,
        duration: result.duration
      };
      touch(task);
      return task;
    });
  }
  async accept(w, input) {
    const snapshot = await this.host.get(w, input.taskId), op = operationIn(snapshot, input.operationId), run = op.runs.find((r) => r.id === id.parse(input.runId));
    if (op.accepted?.runId === run?.id && run) return snapshot;
    if (!run || run.status !== "succeeded")
      throw new Error("只能采纳已成功生成的视频");
    if (snapshot.archived || op.revision !== input.revision) throw conflict();
    const errors = videoDependencyErrors(snapshot, op.id);
    if (errors.length) throw new Error(errors.join("；"));
    const source = await this.host.media(w, snapshot.id, op.id, run.id), info = await this.media.probe(source.path), duration = op.editDuration ?? info.duration;
    if (duration > info.duration + 1 / info.fps)
      throw new Error("生成结果短于计划时长，请重新生成或调整剧本");
    const output = `accepted-${randomUUID()}.mp4`, normalized = await this.filename(w, output);
    await this.media.render(
      [
        {
          path: source.path,
          start: 0,
          duration,
          sourceDuration: info.duration
        }
      ],
      normalized,
      info
    );
    try {
      const bytes = await this.media.frame(
        normalized,
        Math.max(0, duration - 1 / info.fps),
        await this.host.root(w)
      );
      const asset = await this.host.putAsset(
        w,
        `${op.name} · 采纳尾帧`.slice(0, 160),
        bytes,
        "capture",
        { taskId: snapshot.id, operationId: op.id, runId: run.id }
      );
      return await this.host.transaction(w, (state) => {
        const task = taskIn(state, snapshot.id), current = operationIn(task, op.id);
        if (task.archived || current.revision !== input.revision)
          throw conflict();
        const changed = videoDependencyErrors(task, current.id);
        if (changed.length) throw new Error(changed.join("；"));
        current.accepted = {
          runId: run.id,
          tailAssetId: asset.id,
          duration,
          fps: info.fps,
          output
        };
        touch(task, current);
        let replaces = false;
        if (current.scriptSegmentId) {
          const seg = task.plan?.segments.find(
            (s) => s.id === current.scriptSegmentId
          );
          if (seg && current.derivedFrom === seg.operationId) {
            seg.operationId = current.id;
            replaces = true;
          }
        }
        if (current.refinementId) {
          const refinement = task.refinements?.find(
            (r) => r.id === current.refinementId
          );
          if (refinement?.operationIds.includes(current.derivedFrom ?? "")) {
            refinement.operationIds = refinement.operationIds.map(
              (id2) => id2 === current.derivedFrom ? current.id : id2
            );
            replaces = true;
          }
        }
        if (replaces)
          for (const dependent of task.operations.filter(
            (o) => o.dependency?.operationId === current.derivedFrom
          )) {
            dependent.dependency.operationId = current.id;
            touch(task, dependent);
          }
        for (const dependent of task.operations.filter(
          (o) => o.dependency?.operationId === current.id && !videoBusy(o) && !videoComplete(o)
        )) {
          const first = dependent.config.inputs.find((i) => i.kind === "first");
          if (!first || first.assetId === dependent.dependency?.assetId)
            bindTail(task, dependent);
        }
        return task;
      });
    } catch (error) {
      await rm(normalized, { force: true });
      throw error;
    }
  }
  async saveFilm(w, snapshot, film) {
    try {
      return await this.host.transaction(w, (state) => {
        const task = taskIn(state, snapshot.id);
        writable(task, snapshot.revision);
        (task.films ??= []).push(film);
        if (!film.refinementId) task.currentFilmId = film.id;
        touch(task);
        return task;
      });
    } catch (e) {
      await rm(await this.filename(w, film.output), { force: true });
      throw e;
    }
  }
  async compose(w, input) {
    const task = await this.host.get(w, input.taskId), requestId = id.parse(input.requestId);
    if (task.films?.some((f) => f.requestId === requestId)) return task;
    writable(task, input.revision);
    if (!task.plan?.segments.length) throw new Error("请先应用剧本到视频操作");
    if (task.plan.scriptRevision !== task.script?.revision)
      throw new Error("剧本有新修改，请先重新应用生成安排");
    const clips = [], parts = [];
    for (const seg of task.plan.segments) {
      const op = operationIn(task, seg.operationId), accepted = op.accepted;
      if (!accepted) throw new Error(`请先采纳 ${op.name}`);
      const errors = videoDependencyErrors(task, op.id);
      if (errors.length) throw new Error(`${op.name}：${errors.join("；")}`);
      const source = await this.acceptedMedia(w, task, op);
      clips.push({
        operationId: op.id,
        runId: accepted.runId,
        start: 0,
        duration: seg.duration,
        transition: seg.transition
      });
      parts.push({
        path: source.path,
        start: 0,
        duration: seg.duration,
        transition: seg.transition
      });
    }
    const first = await this.media.probe(parts[0].path), filmId = randomUUID(), output = `film-${filmId}.mp4`;
    const info = await this.media.render(
      parts,
      await this.filename(w, output),
      first
    );
    return this.saveFilm(w, task, {
      id: filmId,
      requestId,
      output,
      ...info,
      clips,
      createdAt: Date.now(),
      parentId: task.currentFilmId
    });
  }
  async refine(w, input) {
    const request = z.object({
      taskId: id,
      revision: z.number().int().positive(),
      requestId: id,
      filmId: id,
      start: z.number().finite().nonnegative(),
      end: z.number().finite().positive(),
      modelId: z.string(),
      prompt: z.string().trim().min(1).max(2e4),
      keepAudio: z.boolean().default(true),
      parameters: z.record(
        z.string(),
        z.union([z.string(), z.number().finite(), z.boolean()])
      ).optional(),
      sections: z.array(
        z.object({
          duration: z.number().positive(),
          prompt: z.string().min(1).max(2e4)
        }).strict()
      ).min(1).max(32).optional()
    }).strict().parse(input);
    const task = await this.host.get(w, request.taskId);
    if (task.refinements?.some((r) => r.requestId === request.requestId))
      return task;
    writable(task, request.revision);
    const film = task.films?.find((f) => f.id === request.filmId);
    if (!film || film.id !== task.currentFilmId)
      throw new Error("请选择当前成片版本");
    if (request.end <= request.start || request.end > film.duration)
      throw new Error("精修选区超出成片范围");
    const start = Math.round(request.start * film.fps) / film.fps, end = Math.round(request.end * film.fps) / film.fps;
    if (end - start < 1 / film.fps) throw new Error("精修范围至少为一帧");
    const model = (await this.host.models.catalog()).find(
      (m) => m.id === request.modelId
    );
    if (!model) throw new Error("请选择精修生成模型");
    const mode = Object.keys(model.modes).find((m) => model.modes[m]?.first && model.modes[m]?.last);
    if (!mode) throw new Error("当前模型不支持同时固定首尾帧，请更换模型");
    const sections = request.sections ?? [
      { duration: end - start, prompt: request.prompt }
    ];
    if (Math.abs(sections.reduce((n, s) => n + s.duration, 0) - (end - start)) > 1 / film.fps / 2)
      throw new Error("精修分段总时长应等于选区时长");
    const configs = sections.map(
      (s) => durationConfig(
        model,
        {
          ...defaultVideoConfig(model),
          mode,
          parameters: {
            ...defaultVideoConfig(model).parameters,
            ...request.parameters
          },
          prompt: s.prompt
        },
        s.duration
      )
    );
    const source = await this.filmMedia(w, task.id, film.id), root = await this.host.root(w);
    const first = await this.host.putAsset(
      w,
      "精修首帧",
      await this.media.frame(source.path, start, root),
      "capture",
      { filmId: film.id, time: String(start) }
    );
    const last = await this.host.putAsset(
      w,
      "精修尾帧",
      await this.media.frame(
        source.path,
        Math.min(film.duration - 1 / film.fps, end - 1 / film.fps),
        root
      ),
      "capture",
      { filmId: film.id, time: String(end - 1 / film.fps) }
    );
    return this.host.transaction(w, (state) => {
      const current = taskIn(state, task.id);
      writable(current, request.revision);
      const refinementId = randomUUID();
      let previous;
      const ops = configs.map((config, i) => {
        config.inputs = [];
        if (i === 0) config.inputs.push({ kind: "first", assetId: first.id });
        if (i === configs.length - 1)
          config.inputs.push({ kind: "last", assetId: last.id });
        const op = newOperation(
          `精修 ${start.toFixed(2)}–${end.toFixed(2)} · ${i + 1}`,
          config
        );
        op.refinementId = refinementId;
        op.editDuration = sections[i].duration;
        if (previous) op.dependency = { operationId: previous };
        previous = op.id;
        return op;
      });
      current.operations.push(...ops);
      (current.refinements ??= []).push({
        id: refinementId,
        requestId: request.requestId,
        filmId: film.id,
        start,
        end,
        keepAudio: request.keepAudio,
        operationIds: ops.map((o) => o.id),
        firstAssetId: first.id,
        lastAssetId: last.id
      });
      touch(current);
      return current;
    });
  }
  async preview(w, input) {
    const task = await this.host.get(w, input.taskId), requestId = id.parse(input.requestId);
    if (task.films?.some((f) => f.requestId === requestId)) return task;
    writable(task, input.revision);
    const refinement = task.refinements?.find(
      (r) => r.id === id.parse(input.refinementId)
    );
    if (!refinement || refinement.filmId !== task.currentFilmId)
      throw new Error("精修来源已变化，请基于当前成片重新选择");
    const film = task.films.find((f) => f.id === refinement.filmId), source = await this.filmMedia(w, task.id, film.id), parts = [];
    const clips = [];
    if (refinement.start > 0)
      parts.push({ path: source.path, start: 0, duration: refinement.start });
    for (const opId of refinement.operationIds) {
      const op = operationIn(task, opId);
      if (!op.accepted) throw new Error(`请先采纳 ${op.name}`);
      const errors = videoDependencyErrors(task, op.id);
      if (errors.length) throw new Error(errors.join("；"));
      const media = await this.acceptedMedia(w, task, op), duration = op.editDuration;
      parts.push({ path: media.path, start: 0, duration });
      clips.push({
        operationId: op.id,
        runId: op.accepted.runId,
        start: 0,
        duration,
        transition: cutTransition()
      });
    }
    if (refinement.end < film.duration - 1e-6)
      parts.push({
        path: source.path,
        start: refinement.end,
        duration: film.duration - refinement.end
      });
    const filmId = randomUUID(), output = `film-${filmId}.mp4`, info = await this.media.render(
      parts,
      await this.filename(w, output),
      film,
      refinement.keepAudio ? source.path : void 0
    );
    return this.saveFilm(w, task, {
      id: filmId,
      requestId,
      output,
      ...info,
      clips,
      createdAt: Date.now(),
      parentId: film.id,
      refinementId: refinement.id
    });
  }
}
export {
  VideoWorkflow,
  scriptSchema,
  storyInputSchema,
  workflowActions
};
