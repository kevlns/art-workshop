import {assertLocalEndpoint} from './local-runtime.mjs';
import { atomicJson, atomicWrite, replaceFile } from "./atomic.mjs";
import sharp from "sharp";
import { createWriteStream, fstatSync } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { mkdir, readFile, stat, rm, lstat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import {
  defaultVideoConfig,
  validateVideo,
  videoBusy,
  videoComplete,
  videoDependencyErrors
} from "./contracts.mjs";
import { projectPath } from "./path.mjs";
import { withResource } from "./resource.mjs";
import { compileVideo } from "./models.mjs";
import {
  VideoWorkflow,
  workflowActions,
  scriptSchema
} from "./workflow.mjs";
const videoActions = [
  "describe",
  ...workflowActions,
  "material.list",
  "material.import",
  "material.import-file",
  "material.hide",
  "image",
  "task.list",
  "task.read",
  "task.create",
  "task.rename",
  "task.archive",
  "operation.create",
  "operation.update",
  "operation.rename",
  "operation.derive",
  "operation.validate",
  "operation.run",
  "operation.resume",
  "operation.cancel"
];
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const name = z.string().trim().min(1).max(160);
const inputSchema = z.object({
  assetId: id,
  kind: z.enum(["first", "last", "middle", "reference"]),
  frame: z.number().int().nonnegative().optional(),
  role: z.enum(["subject", "style", "motion", "camera"]).optional()
}).strict();
const configSchema = z.object({
  modelId: z.string(),
  mode: z.enum(["text", "boundary", "reference"]),
  prompt: z.string(),
  parameters: z.record(
    z.string(),
    z.union([z.string(), z.number().finite(), z.boolean()])
  ),
  inputs: z.array(inputSchema).max(128)
}).strict();
function conflict() {
  return Object.assign(new Error("操作已被其他入口修改，请重新读取后再保存"), {
    status: 409
  });
}
class VideoService {
  constructor(models, sources) {
    this.models = models;
    this.sources = sources;
    this.workflow = new VideoWorkflow({
      models,
      signal: this.shutdown.signal,
      root: (w) => this.root(w),
      get: (w, id2) => this.get(w, id2),
      transaction: (w, action) => this.transaction(w, action),
      putAsset: (w, label, bytes, source, origin) => this.putAsset(w, label, bytes, source, origin),
      media: (w, task, op, run) => this.media(w, task, op, run)
    });
  }
  models;
  sources;
  workflow;
  watches = /* @__PURE__ */ new Map();
  closing = false;
  shutdown = new AbortController();
  polls = /* @__PURE__ */ new Map();
  operations = /* @__PURE__ */ new Set();
  async root(w) {
    return projectPath(w.root, ".vant/video");
  }
  async read(w) {
    const file=await projectPath(w.root,join(await this.root(w),"project.json"));
    try{const info=await stat(file);if(!info.isFile()||info.size>64*1024*1024)throw new Error("视频状态超过容量或不是文件");const state=JSON.parse(await readFile(file,"utf8"));
      if(state.version!==1||!Array.isArray(state.tasks)||!Array.isArray(state.assets)||!Array.isArray(state.hiddenSources))throw new Error("视频状态格式无效");
      const seen=new Set(),runIds=new Set(),assetIds=new Set();for(const task of state.tasks){id.parse(task.id);if(seen.has(task.id)||!Array.isArray(task.operations)||!Number.isInteger(task.revision)||task.revision<1)throw new Error("视频任务索引无效");seen.add(task.id);const operations=new Set();for(const op of task.operations){id.parse(op.id);if(operations.has(op.id)||!Number.isInteger(op.revision)||op.revision<1||!Array.isArray(op.runs))throw new Error("视频操作索引无效");operations.add(op.id);configSchema.parse(op.config);for(const run of op.runs){id.parse(run.id);if(runIds.has(run.id))throw new Error("视频运行身份重复");runIds.add(run.id);id.parse(run.requestId);assertLocalEndpoint(run.endpoint);if(!["dispatching","running","unknown","succeeded","failed"].includes(run.status)||run.output&&!new RegExp("^"+run.id+"\\.(mp4|webm)$").test(run.output))throw new Error("视频运行索引无效");}if(op.accepted?.output&&!/^accepted-[a-f0-9-]{36}\.mp4$/.test(op.accepted.output))throw new Error("采纳视频路径无效");}for(const film of task.films||[])if(film.output!==`film-${id.parse(film.id)}.mp4`)throw new Error("成片路径无效");}
      for(const asset of state.assets){id.parse(asset.id);if(assetIds.has(asset.id))throw new Error("视频素材身份重复");assetIds.add(asset.id);if(!["image/png","image/jpeg","image/webp"].includes(asset.mime))throw new Error("视频素材格式无效");}
      return state;
    }catch(error){if(error.code==="ENOENT")return {version:1,tasks:[],assets:[],hiddenSources:[]};throw error;}
  }
  async snapshot(w){return this.read(w);}
  async transaction(w, action) {
    return withResource(w.root, ".vant/video", async () => {
      await mkdir(await this.root(w), { recursive: true });
      const state = await this.read(w);
      const before = JSON.stringify(state);
      const result = await action(state);
      if (JSON.stringify(state) !== before)
        await atomicJson(join(await this.root(w), "project.json"), state);
      return result;
    });
  }
  task(state, taskId) {
    const t = state.tasks.find((t2) => t2.id === id.parse(taskId));
    if (!t) throw new Error("视频任务不存在");
    return t;
  }
  operation(task, opId) {
    const op = task.operations.find((o) => o.id === id.parse(opId));
    if (!op) throw new Error("操作不存在");
    return op;
  }
  editable(task, op, revision) {
    if (task.archived) throw new Error("任务已归档");
    if (op.revision !== revision) throw conflict();
    if (videoBusy(op) || videoComplete(op))
      throw new Error("当前操作配置只读，请派生新操作");
  }
  touch(task, op) {
    task.revision++;
    task.updatedAt = Date.now();
    if (op) {
      op.revision++;
      op.updatedAt = task.updatedAt;
    }
  }
  async list(w) {
    const state = await this.read(w);
    return state.tasks.map(
      ({ operations, script, plan, films, refinements, ...task }) => ({
        ...task,
        operationCount: operations.length
      })
    );
  }
  async get(w, taskId) {
    return this.task(await this.read(w), taskId);
  }
  async execute(w, action, input = {}) {
    if (this.closing) throw new Error("视频服务正在关闭");
    const work = this.executeInternal(w, action, input);
    this.operations.add(work);
    try {
      return await work;
    } finally {
      this.operations.delete(work);
    }
  }
  async executeInternal(w, action, input) {
    if (workflowActions.includes(action))
      return this.workflow.execute(w, action, input);
    if (action === "material.list") return this.materials(w);
    if (action === "material.import")
      return this.importSource(w, z.string().parse(input.sourceId));
    if (action === "material.hide")
      return this.hide(w, z.string().parse(input.assetId));
    if (action === "material.import-file") {
      const path = await projectPath(w.root, z.string().parse(input.path)), info = await stat(path);
      if (!info.isFile() || info.size > 20 * 1024 * 1024)
        throw new Error("图片限20MB");
      return this.putAsset(w, name.parse(input.name), await readFile(path));
    }
    if (action === "describe")
      return {
        schemaVersion: 2,
        actions: videoActions,
        models: await this.models.catalog(),
        configSchema: z.toJSONSchema(configSchema),
        scriptSchema: z.toJSONSchema(scriptSchema),
        workflow: {
          "script.update": "input{taskId,revision:task.revision,script:complete scriptSchema}; saves text and references only",
          "script.plan": "input{taskId,script?:scriptSchema}; read-only model-aware grouping, constraints/errors and actual durations",
          "script.apply": "input{taskId,revision:task.revision}; creates/reuses operations from saved script; never generates",
          "operation.accept": "input{taskId,operationId,revision:operation.revision,runId}; accepts succeeded run, captures its planned tail, resolves dependent first frames",
          "operation.bind": "input{taskId,operationId,revision:operation.revision}; rebind editable operation to its dependency's accepted tail",
          "film.compose": "input{taskId,revision:task.revision,requestId}; renders accepted plan segments with cut/continue/dissolve transitions, preserves previous film",
          "film.refine": "input{taskId,revision:task.revision,requestId,filmId,start,end,modelId,prompt,keepAudio?:true,parameters?,sections?:[{duration,prompt}]}; captures boundary frames and creates fixed-boundary operations; sections sum to selected duration and fit model",
          "film.preview": "input{taskId,revision:task.revision,requestId,refinementId}; renders candidate from all accepted refinement operations; preserves current film and original audio by default",
          "film.adopt": "input{taskId,revision:task.revision,filmId}; adopts candidate only when its source is the current film",
          "film.undo": "input{taskId,revision:task.revision}; restores current film's parent",
          "media.status": "input{}; checks FFmpeg/ffprobe, required for acceptance, frame extraction and film editing",
          planning: "shots are semantic action units; group at model limits, split overlong shots in script instead of truncating prose; global inputs: reference/first/last; shot middle frame positions are relative to that shot"
        },
        inputContract: {
          taskId: "task.read/create returned id",
          operationId: "operation id within task",
          revision: "current operation.revision (task actions use task.revision)",
          config: "complete configuration matching configSchema",
          requestId: "stable unique id per authorized generation, reuse on uncertain response"
        },
        constraints: {
          revisionRequired: true,
          runRequestIdRequired: true,
          completedReadOnly: true,
          resumeNeverSubmits: true
        }
      };
    if (action === "task.list") return this.list(w);
    if (action === "task.read") return this.get(w, input.taskId);
    if (action === "operation.run") return this.start(w, input);
    if (action === "operation.resume") {
      if(input.runId!==undefined){const task=await this.get(w,input.taskId),op=this.operation(task,input.operationId);if(op.runs.at(-1)?.id!==input.runId)throw new Error("恢复请求不属于当前原运行身份");}
      await this.poll(w, id.parse(input.taskId), id.parse(input.operationId));
      const task = await this.get(w, input.taskId);
      if (videoBusy(this.operation(task, input.operationId)))
        this.watch(w, task.id, input.operationId);
      return task;
    }
    if (action === "operation.cancel") return this.cancel(w,input);
    if (action === "operation.validate") {
      const task = await this.get(w, input.taskId), op = this.operation(task, input.operationId);
      const m = (await this.models.catalog()).find(
        (m2) => m2.id === op.config.modelId
      );
      return {
        errors: m ? [
          ...validateVideo(op.config, m),
          ...videoDependencyErrors(task, op.id),
          ...m.available ? [] : [m.reason || "模型不可用"]
        ] : ["选择可用生成模型"]
      };
    }
    return this.transaction(w, async (state) => {
      if (action === "task.create") {
        const now = Date.now(), task2 = {
          id: randomUUID(),
          name: name.parse(input.name),
          revision: 1,
          archived: false,
          operations: [],
          createdAt: now,
          updatedAt: now
        };
        state.tasks.push(task2);
        return task2;
      }
      const task = this.task(state, input.taskId);
      if (action === "task.rename" || action === "task.archive") {
        if (task.revision !== input.revision) throw conflict();
        if (task.operations.some(videoBusy))
          throw new Error("运行尚未结束，不能修改任务状态");
        if (action === "task.rename") task.name = name.parse(input.name);
        else task.archived = z.boolean().parse(input.archived);
        this.touch(task);
        return task;
      }
      if (task.archived) throw new Error("任务已归档");
      if (action === "operation.create" || action === "operation.derive") {
        let config, derivedFrom;
        if (action === "operation.derive") {
          const source = this.operation(task, input.operationId);
          if (source.revision !== input.revision) throw conflict();
          if (videoBusy(source)) throw new Error("运行中操作不能派生");
          config = structuredClone(source.config);
          derivedFrom = source.id;
        } else {
          const model = (await this.models.catalog()).find(
            (m) => m.id === input.modelId && m.available
          );
          config = defaultVideoConfig(model);
        }
        const now = Date.now();
        task.operations.push({
          id: randomUUID(),
          name: name.parse(input.name ?? "新操作"),
          revision: 1,
          config,
          runs: [],
          createdAt: now,
          updatedAt: now,
          ...derivedFrom ? { derivedFrom } : {},
          ...derivedFrom ? (() => {
            const source = this.operation(task, derivedFrom);
            return {
              scriptSegmentId: source.scriptSegmentId,
              refinementId: source.refinementId,
              dependency: structuredClone(source.dependency),
              editDuration: source.editDuration
            };
          })() : {}
        });
        this.touch(task);
        return task;
      }
      const op = this.operation(task, input.operationId);
      if (op.revision !== input.revision) throw conflict();
      if (action === "operation.rename") {
        op.name = name.parse(input.name);
        this.touch(task, op);
        return task;
      }
      if (action === "operation.update") {
        this.editable(task, op, input.revision);
        const config = configSchema.parse(input.config);
        for (const i of config.inputs)
          if (!state.assets.some((a) => a.id === i.assetId))
            throw new Error("引用素材不存在");
        if (op.config.modelId !== config.modelId)
          op.profiles = {
            ...op.profiles,
            [op.config.modelId]: structuredClone(op.config)
          };
        op.config = config;
        this.touch(task, op);
        return task;
      }
      throw new Error("未知视频操作");
    });
  }
  async assets(w) {
    return (await this.read(w)).assets.filter((a) => !a.hidden);
  }
  async materials(w) {
    const state = await this.read(w), external = await this.sources?.list(w) ?? [];
    return {
      assets: state.assets.filter((a) => !a.hidden),
      sources: external.filter((s) => !state.hiddenSources.includes(s.id))
    };
  }
  async hide(w, assetId) {
    return this.transaction(w, (state) => {
      const a = state.assets.find((a2) => a2.id === assetId);
      if (a) a.hidden = true;
      else if (!state.hiddenSources.includes(assetId))
        state.hiddenSources.push(assetId);
      return { ok: true };
    });
  }
  async importSource(w, sourceId) {
    const source = (await this.sources?.list(w))?.find(
      (s) => s.id === sourceId
    );
    if (!source || !this.sources) throw new Error("来源图片不存在");
    const data = await this.sources.read(w, source);
    return this.putAsset(
      w,
      source.name,
      data.bytes,
      source.source,
      source.origin
    );
  }
  async putAsset(w, label, bytes, source = "import", origin) {
    if (!bytes.length || bytes.length > 20 * 1024 * 1024)
      throw new Error("图片限 20MB");
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png" : bytes[0] === 255 && bytes[1] === 216 ? "image/jpeg" : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : "";
    if (!mime) throw new Error("仅支持 PNG、JPEG、WebP 图片");
    const decoder = sharp(bytes, {
      limitInputPixels: 32 * 1024 * 1024,
      failOn: "error"
    });
    const metadata=await decoder.metadata();await decoder.stats();
    if (!metadata.width || !metadata.height) throw new Error("图片无法解码");
    const asset = {
      id: source === "capture" ? randomUUID() : source === 'conversation' ? createHash('sha256').update(`conversation\0${origin?.sessionId}\0${origin?.attachmentId}\0`).update(bytes).digest('hex') : createHash("sha256").update(bytes).digest("hex"),
      name: name.parse(label),
      mime,
      source,
      origin,
      hash: createHash("sha256").update(bytes).digest("hex"),
      createdAt: Date.now()
    };
    return this.transaction(w, async (state) => {
      const existing = state.assets.find((a) => a.id === asset.id);
      if (existing) {
        existing.hidden = false;
        return existing;
      }
      const path = await projectPath(
        w.root,
        join(await this.root(w), `${asset.id}.image`)
      );
      await atomicWrite(path, bytes);
      state.assets.push(asset);
      return asset;
    });
  }
  async asset(w,assetId){const asset=(await this.read(w)).assets.find(a=>a.id===id.parse(assetId));if(!asset)throw new Error("素材不存在");const file=await projectPath(w.root,join(await this.root(w),`${asset.id}.image`)),info=await stat(file);if(!info.isFile()||info.size>20*1024*1024)throw new Error("视频图片素材无效或超过20MB");const bytes=await readFile(file),expected=asset.hash||(/^[a-f0-9]{64}$/.test(asset.id)?asset.id:null);if(expected&&createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error("视频素材内容已变化");return {bytes,type:asset.mime};}
  async media(w, taskId, opId, runId) {
    const task = this.task(await this.read(w), taskId), op = this.operation(task, opId), run = runId ? op.runs.find((r) => r.id === id.parse(runId)) : op.runs.at(-1);
    if (run?.status !== "succeeded" || !run.output)
      throw new Error("视频尚未就绪");
    const path = await projectPath(
      w.root,
      join(await this.root(w), run.output)
    );
    await stat(path);
    return {
      path,
      name: op.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") + (run.output.endsWith(".webm") ? ".webm" : ".mp4")
    };
  }
  async start(w, input) {
    if (this.closing) throw new Error("服务正在关闭");
    const requestId = id.parse(input.requestId), settings = await this.models.get(), catalog = await this.models.catalog(settings);
    let duplicate = false;
    const run = await this.transaction(w, async (state) => {
      const task = this.task(state, input.taskId), op = this.operation(task, input.operationId);
      const prior = op.runs.find((r) => r.requestId === requestId);
      if (prior) {
        duplicate = true;
        return prior;
      }
      this.editable(task, op, input.revision);
      const model = catalog.find((m) => m.id === op.config.modelId);
      if (!model?.available) throw new Error(model?.reason || "生成模型不可用");
      const errors = validateVideo(op.config, model);
      errors.push(...videoDependencyErrors(task, op.id));
      if (errors.length) throw new Error(errors.join("；"));
      for (const i of op.config.inputs)
        if (!state.assets.some((a) => a.id === i.assetId))
          throw new Error("素材不存在");
      const run2 = {
        id: randomUUID(),
        requestId,
        status: "dispatching",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        config: structuredClone(op.config),
        model: structuredClone(model),
        endpoint: settings.localEndpoint
      };
      op.runs.push(run2);
      this.touch(task, op);
      return run2;
    });
    if (duplicate) return this.get(w, input.taskId);
    let submitted = false;
    try {
      await this.models.ensure(
        settings,
        run.model.id,
        this.shutdown.signal,
        run.config.mode
      );
      const images = /* @__PURE__ */ new Map();
      for (const i of run.config.inputs) {
        if (images.has(i.assetId)) continue;
        const data = await this.asset(w, i.assetId), form = new FormData();
        form.append(
          "image",
          new Blob([new Uint8Array(data.bytes)], { type: data.type }),
          `${i.assetId}.${data.type.split("/")[1]}`
        );
        const response2 = await this.models.fetcher(
          new URL("upload/image", run.endpoint),
          {
            method: "POST",
            body: form,
            signal: AbortSignal.any([
              this.shutdown.signal,
              AbortSignal.timeout(3e4)
            ])
          }
        );
        if (!response2.ok)
          throw new Error(`素材上传失败 HTTP ${response2.status}`);
        const uploaded = z.object({ name: z.string().min(1), subfolder: z.string().optional() }).parse(await response2.json());
        images.set(
          i.assetId,
          [uploaded.subfolder, uploaded.name].filter(Boolean).join("/")
        );
      }
      const prompt = compileVideo(run.config, run.model, settings, images);
      submitted = true;
      const response = await this.models.fetcher(
        new URL("prompt", run.endpoint),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            client_id: run.id,
            extra_data: { vantRunId: run.id }
          }),
          signal: AbortSignal.any([
            this.shutdown.signal,
            AbortSignal.timeout(3e4)
          ])
        }
      );
      if (response.status === 400) {
        submitted = false;
        throw new Error(
          `ComfyUI 拒绝工作流：${(await response.text()).slice(0, 1e3)}`
        );
      }
      if (!response.ok) throw new Error(`提交响应异常 HTTP ${response.status}`);
      const receipt = await response.json();
      if (typeof receipt.prompt_id !== "string")
        throw new Error("未收到上游运行身份");
      await this.updateRun(w, input.taskId, input.operationId, run.id, (r) => {
        r.upstreamId = receipt.prompt_id;
        r.status = "running";
      });
    } catch (e) {
      await this.updateRun(w, input.taskId, input.operationId, run.id, (r) => {
        r.status = submitted ? "unknown" : "failed";
        r.error = e.message;
      });
    }
    this.watch(w, input.taskId, input.operationId);
    return this.get(w, input.taskId);
  }
  updateRun(w, taskId, opId, runId, change) {
    return this.transaction(w, (state) => {
      const task = this.task(state, taskId), op = this.operation(task, opId), run = op.runs.find((candidate) => candidate.id === runId);
      if (!run) throw new Error("视频运行记录不存在");
      const before = JSON.stringify(run);
      change(run);
      if (JSON.stringify(run) === before) return;
      run.updatedAt = Date.now();
      this.touch(task, op);
    });
  }
  watch(w, taskId, opId) {
    const key = `${w.id}:${taskId}:${opId}`;
    if (this.closing || this.watches.has(key)) return;
    this.watches.set(
      key,
      setTimeout(async () => {
        try {
          await this.poll(w, taskId, opId);
        } catch {
        } finally {
          this.watches.delete(key);
          if (!this.closing) {
            try {
              const task = this.task(await this.read(w), taskId);
              if (videoBusy(this.operation(task, opId)))
                this.watch(w, taskId, opId);
            } catch {
            }
          }
        }
      }, 5e3)
    );
    this.watches.get(key).unref();
  }
  async poll(w, taskId, opId) {
    if (this.closing) return;
    const key = `${w.id}:${taskId}:${opId}`, current = this.polls.get(key);
    if (current) return current;
    const work = this.pollOnce(w, taskId, opId);
    this.polls.set(key, work);
    try {
      await work;
    } finally {
      if (this.polls.get(key) === work) this.polls.delete(key);
    }
  }
  async pollOnce(w, taskId, opId) {
    const op = this.operation(this.task(await this.read(w), taskId), opId), run = op.runs.at(-1);
    if (!run || !videoBusy(op)) return;
    if (!run.upstreamId) {
      if (run.status === "dispatching" && Date.now() - run.createdAt < 12e4)
        return;
      const matches = /* @__PURE__ */ new Set();
      for (const route of ["queue", "history?max_items=200"]) {
        const result = await this.models.fetcher(new URL(route, run.endpoint), {
          signal: AbortSignal.any([
            this.shutdown.signal,
            AbortSignal.timeout(15e3)
          ])
        });
        if (!result.ok) throw new Error("无法核对原运行");
        const data = await result.json();
        if (route === "queue") {
          for (const row of [
            ...data.queue_running ?? [],
            ...data.queue_pending ?? []
          ])
            if (row[3]?.vantRunId === run.id && typeof row[1] === "string")
              matches.add(row[1]);
        } else
          for (const [key, entry2] of Object.entries(data))
            if (entry2.prompt?.[3]?.vantRunId === run.id) matches.add(key);
      }
      if (matches.size === 1) {
        await this.updateRun(w, taskId, opId, run.id, (r) => {
          r.upstreamId = [...matches][0];
          r.status = "running";
          delete r.error;
        });
      } else
        await this.updateRun(w, taskId, opId, run.id, (r) => {
          r.status = "unknown";
          r.error = matches.size > 1 ? "发现多个原运行身份，需要人工核对" : "未找到唯一上游身份；不会自动重新生成";
        });
      return;
    }
    const response = await this.models.fetcher(
      new URL(`history/${encodeURIComponent(run.upstreamId)}`, run.endpoint),
      {
        signal: AbortSignal.any([
          this.shutdown.signal,
          AbortSignal.timeout(15e3)
        ])
      }
    );
    if (!response.ok) throw new Error("无法查询生成状态");
    const history = await response.json(), entry = history[run.upstreamId];
    if (!entry) return;
    if (entry.status?.status_str === "error") {
      await this.updateRun(w, taskId, opId, run.id, (r) => {
        r.status = "failed";
        r.error = "ComfyUI 执行失败，请查看该运行的上游日志";
      });
      return;
    }
    if (!entry.status?.completed) return;
    const files = Object.values(entry.outputs ?? {}).flatMap(
      (o) => [...o.videos ?? [], ...o.gifs ?? [], ...o.images ?? []]
    );
    const file = files.find((f) => /\.(mp4|webm)$/i.test(f.filename));
    if (!file) {
      await this.updateRun(w, taskId, opId, run.id, (r) => {
        r.status = "failed";
        r.error = "工作流完成但没有视频输出";
      });
      return;
    }
    const url = new URL("view", run.endpoint);
    for (const k of ["filename", "subfolder", "type"])
      if (file[k]) url.searchParams.set(k, file[k]);
    const media = await this.models.fetcher(url, {
      signal: AbortSignal.any([
        this.shutdown.signal,
        AbortSignal.timeout(12e4)
      ])
    });
    if (!media.ok || !media.body) throw new Error("视频取回失败");
    const filename = `${run.id}${/\.webm$/i.test(file.filename) ? ".webm" : ".mp4"}`;
    const output = await projectPath(
      w.root,
      join(await this.root(w), filename)
    ), temporary = await projectPath(w.root,`${output}.${randomUUID()}.part`);
    let temporaryOwner;
    let size = 0, header = Buffer.alloc(0);
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > 512 * 1024 * 1024)
          return callback(new Error("视频超过512MB接入上限"));
        if (header.length < 12)
          header = Buffer.concat([
            header,
            chunk.subarray(0, 12 - header.length)
          ]);
        callback(null, chunk);
      }
    });
    try {
      const writer=createWriteStream(await projectPath(w.root,temporary),{flags:'wx',mode:0o600});
      writer.once('open',fd=>{try{temporaryOwner=fstatSync(fd);}catch(error){writer.destroy(error);}});
      await pipeline(
        Readable.fromWeb(media.body),
        limiter,
        writer,
        { signal: this.shutdown.signal }
      );
      if (size < 12 || !(header.toString("ascii", 4, 8) === "ftyp" || header.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))))
        throw new Error("上游产物不是有效视频容器");
      const checkedTemporary=await projectPath(w.root,temporary),current=await lstat(checkedTemporary);
      if(!temporaryOwner||!current.isFile()||current.dev!==temporaryOwner.dev||current.ino!==temporaryOwner.ino)throw new Error('视频临时产物身份已变化');
      await replaceFile(checkedTemporary,await projectPath(w.root,output));
    } catch(error) {
      await this.updateRun(w,taskId,opId,run.id,value=>{value.status="unknown";value.error="原任务已返回，但视频产物取回/校验未完成；只查询原任务，不重新提交。";});
      throw error;
    } finally {
      if(temporaryOwner){let cleanup;try{const candidate=await projectPath(w.root,temporary),current=await lstat(candidate);if(current.isFile()&&current.dev===temporaryOwner.dev&&current.ino===temporaryOwner.ino)cleanup=candidate;}catch{}if(cleanup)await rm(cleanup,{force:true,maxRetries:5,retryDelay:25});}
    }
    await this.updateRun(w, taskId, opId, run.id, (r) => {
      r.output = filename;
      r.status = "succeeded";
      delete r.error;
    });
  }
  async restore(workspaces) {
    for (const w of workspaces) {
      try {
        const state = await this.read(w);
        for (const t of state.tasks)
          for (const op of t.operations)
            if (videoBusy(op)) this.watch(w, t.id, op.id);
      } catch (error) {
        console.warn("视频任务恢复失败", w.id, error.message);
      }
    }
  }
  async cancel(w,input){
    const task=await this.get(w,input.taskId),op=this.operation(task,input.operationId),run=op.runs.at(-1);
    if(!run||input.runId!==run.id)throw new Error("取消必须绑定原运行身份");
    if(run.cancelled&&run.stopConfirmed)return task;
    if(op.revision!==input.revision)throw conflict();
    if(!run.upstreamId)throw new Error("缺少上游身份；只能核对原运行，不能盲目取消");
    assertLocalEndpoint(run.endpoint);
    const readQueue=async()=>{const response=await this.models.fetcher(new URL('queue',run.endpoint),{signal:AbortSignal.any([this.shutdown.signal,AbortSignal.timeout(15000)])});if(!response.ok)throw new Error("无法核对上游队列");return response.json()};
    const queue=await readQueue();
    if((queue.queue_running||[]).some(row=>row[1]===run.upstreamId))throw Object.assign(new Error("此 ComfyUI 运行中的任务没有可核验的独立取消接口；不会中断全局共享任务"),{code:'video-running-cancel-unavailable'});
    if(!(queue.queue_pending||[]).some(row=>row[1]===run.upstreamId)){await this.poll(w,task.id,op.id);return this.get(w,task.id);}
    try { const response=await this.models.fetcher(new URL('queue',run.endpoint),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({delete:[run.upstreamId]}),signal:AbortSignal.any([this.shutdown.signal,AbortSignal.timeout(15000)])});if(!response.ok)throw Object.assign(new Error("上游未确认移除原排队任务"),{unknown:response.status!==400});const after=await readQueue();if([...(after.queue_running||[]),...(after.queue_pending||[])].some(row=>row[1]===run.upstreamId))throw Object.assign(new Error("原任务仍在上游队列中，停止未确认"),{unknown:true});const history=await this.models.fetcher(new URL('history/'+encodeURIComponent(run.upstreamId),run.endpoint),{signal:AbortSignal.any([this.shutdown.signal,AbortSignal.timeout(15000)])});if(!history.ok)throw Object.assign(new Error('无法核对取消后的原任务回执'),{unknown:true});const entry=(await history.json())[run.upstreamId];if(entry?.status?.completed||entry?.status?.status_str==='error'){await this.poll(w,task.id,op.id);return this.get(w,task.id);}
    await this.updateRun(w,task.id,op.id,run.id,value=>{value.status='failed';value.cancelled=true;value.stopConfirmed=true;value.error='已从上游队列移除原任务';});return await this.get(w,task.id); } catch(error) { throw Object.assign(error,{unknown:error.unknown!==false}); }
  }
  async close() {
    this.closing = true;
    for (const timer of this.watches.values()) clearTimeout(timer);
    this.watches.clear();
    this.shutdown.abort();
    await Promise.allSettled([...this.polls.values(), ...this.operations]);
  }
}
export {
  VideoService,
  configSchema,
  videoActions
};
