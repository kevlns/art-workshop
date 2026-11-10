import { z } from "zod";
import { readFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { atomicJson } from "./atomic.mjs";
import { videoOutput } from "./contracts.mjs";
const scalar = z.union([z.string(), z.number().finite(), z.boolean()]);
const field = z.object({
  label: z.string().min(1),
  type: z.enum(["number", "integer", "string", "boolean"]),
  default: scalar,
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
  step: z.number().positive().optional(),
  enum: z.array(z.union([z.string(), z.number().finite()])).optional()
}).strict();
const workflow = z.object({
  first: z.boolean(),
  last: z.boolean(),
  middle: z.boolean(),
  references: z.boolean(),
  requireBoundary: z.boolean().optional(),
  template: z.string().min(1)
}).strict();
const model = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(1),
  adapter: z.literal("comfyui"),
  fields: z.record(z.string(), field),
  modes: z.object({
    text: workflow.optional(),
    boundary: workflow.optional(),
    reference: workflow.optional()
  }).strict(),
  frames: z.object({
    multiple: z.number().int().min(1),
    offset: z.number().int().min(1),
    maximum: z.number().int().min(1).max(1e5)
  }).strict(),
  maximumPixels: z.number().int().positive()
}).strict();
const node = z.object({
  class_type: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()),
  _meta: z.unknown().optional()
}).strict();
const binding = z.object({ node: z.string(), input: z.string() }).strict();
const template = z.object({
  imageBindings: z.object({
    first: binding.optional(),
    last: binding.optional(),
    references: z.array(binding).max(9).optional()
  }).strict().optional(),
  graph: z.record(z.string(), node),
  requiredModels: z.array(
    z.object({ node: z.string(), input: z.string(), value: z.string() }).strict()
  ).default([]),
  referencePrompt: z.enum(["minimax-tags"]).optional(),
  guides: z.object({
    node: node.optional(),
    conditioning: z.tuple([z.string(), z.number().int()]),
    latent: z.tuple([z.string(), z.number().int()]),
    vae: z.tuple([z.string(), z.number().int()]),
    targets: z.array(z.object({ node: z.string(), input: z.string() }).strict()).min(1)
  }).strict().optional()
}).strict();
const videoSettingsSchema = z.object({
  localEndpoint: z.string().url().refine((value) => {
    const u = new URL(value);
    return u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) && u.pathname === "/" && !u.username && !u.password && !u.search && !u.hash;
  }, "使用本机 ComfyUI HTTP 根地址").default("http://127.0.0.1:8188/"),
  localInstallRoot: z.string().default(""),
  ffmpegPath: z.string().default(""),
  models: z.array(model).max(100).default([]),
  templates: z.record(z.string(), template).default({})
}).strict();
export function validateVideoSettings(input) {
    const value = videoSettingsSchema.parse(input);
    if (new Set(value.models.map((m) => m.id)).size !== value.models.length)
      throw new Error("模型 ID 重复");
    for (const model2 of value.models) {
      for (const required of ["duration", "fps", "width", "height"])
        if (!model2.fields[required])
          throw new Error(`缺少输出参数：${required}`);
      for (const mode of Object.values(model2.modes)) {
        const template2 = value.templates[mode.template];
        if (!template2) throw new Error(`缺少工作流模板：${mode.template}`);
        if (mode.middle && !template2.guides)
          throw new Error("开放中间帧需要声明 guide 接线");
        const placeholders = Object.values(template2.graph).flatMap(
          (n) => Object.values(n.inputs)
        );
        if (mode.first && !template2.imageBindings?.first && !placeholders.includes("$first"))
          throw new Error("首帧能力没有绑定工作流输入");
        if (mode.last && !template2.imageBindings?.last && !placeholders.includes("$last"))
          throw new Error("尾帧能力没有绑定工作流输入");
        if (mode.references && !template2.imageBindings?.references?.length && !placeholders.includes("$reference1"))
          throw new Error("参考素材能力没有绑定工作流输入");
        const bindings = Object.values(template2.imageBindings ?? {}).flat();
        for (const binding2 of [
          ...bindings,
          ...template2.guides?.targets ?? []
        ])
          if (!template2.graph[binding2.node])
            throw new Error("工作流绑定目标不存在");
      }
    }
    return value;
}
class VideoModels {
  constructor(directory, fetcher = fetch, runtime, {settingsSnapshot} = {}) {
    this.directory = directory;
    this.settingsSnapshot = settingsSnapshot ? structuredClone(settingsSnapshot) : null;
    this.fetcher = fetcher;
    this.runtime = runtime;
  }
  directory;
  fetcher;
  runtime;
  catalogCache;
  async get() {
    if(this.settingsSnapshot)return structuredClone(this.settingsSnapshot.settings);
    try {
      const info=await stat(join(this.directory,"video.json"));if(!info.isFile()||info.size>32*1024*1024)throw new Error("视频设置文件无效或过大");
      return videoSettingsSchema.parse(
        JSON.parse(await readFile(join(this.directory, "video.json"), "utf8"))
      );
    } catch (e) {
      if (e.code === "ENOENT")
        return videoSettingsSchema.parse({});
      throw e;
    }
  }
  async save(input) {
    if(this.settingsSnapshot)throw Object.assign(new Error("全局视频配置只能从所有者的美术环境设置更新"),{code:"video-global-settings-required"});
    const value=validateVideoSettings(input);
    await mkdir(this.directory, { recursive: true });
    await atomicJson(join(this.directory, "video.json"), value);
    this.catalogCache = void 0;
    return value;
  }
  async ensure(config, modelId, signal, mode) {
    if (!this.runtime) return;
    await this.runtime.ensure(config, signal);
    const live = await this.loadCatalog(config, true);
    const model2 = live.find((m) => m.id === modelId);
    if (!model2?.available)
      throw new Error(model2?.reason || "本地方案运行校验失败");
    if (mode && !Object.hasOwn(model2.modes, mode))
      throw new Error("当前环境不支持所选生成方式");
    this.catalogCache = void 0;
  }
  async catalog(input) {
    const config = input ?? await this.get();
    if (!config.models.length) return [];
    const key = JSON.stringify(config);
    if (this.catalogCache?.key === key && this.catalogCache.until > Date.now())
      return structuredClone(await this.catalogCache.value);
    const value = this.loadCatalog(config);
    const entry = { key, until: Infinity, value };
    this.catalogCache = entry;
    try {
      const models = await value;
      entry.until = Date.now() + (models.some((m) => m.available) ? 3e4 : 3e3);
      return structuredClone(models);
    } catch (error) {
      if (this.catalogCache === entry) this.catalogCache = void 0;
      throw error;
    }
  }
  async loadCatalog(config, requireLive = false) {
    if (this.runtime) {
      const issues = await this.runtime.inspect(config);
      if (issues.length)
        return config.models.map((m) => ({
          ...m,
          available: false,
          reason: issues.join("；")
        }));
    }
    let nodes;
    try {
      const response = await this.fetcher(
        new URL("object_info", config.localEndpoint),
        { signal: AbortSignal.timeout(5e3) }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      nodes = await response.json();
    } catch {
      if (this.runtime && !requireLive)
        return config.models.map((m) => ({
          ...m,
          available: true,
          reason: "本地文件检查通过，生成时启动并校验服务"
        }));
      return config.models.map((m) => ({
        ...m,
        available: false,
        reason: "ComfyUI 不可连接"
      }));
    }
    return config.models.map((m) => {
      const reasons = [];
      const availableModes = {};
      for (const [modeId, mode] of Object.entries(m.modes)) {
        const before = reasons.length;
        const t = config.templates[mode.template];
        if (!t) {
          reasons.push("未配置工作流");
          continue;
        }
        for (const n of Object.values(t.graph)) {
          if (!nodes[n.class_type]) reasons.push(`缺少节点 ${n.class_type}`);
          for (const [key, value] of Object.entries(n.inputs)) {
            const choices = nodes[n.class_type]?.input?.required?.[key]?.[0] ?? nodes[n.class_type]?.input?.optional?.[key]?.[0];
            if (Array.isArray(choices) && typeof value === "string" && !value.startsWith("$") && !choices.includes(value))
              reasons.push(`节点 ${n.class_type} 缺少参数或权重 ${value}`);
          }
        }
        if ((mode.first || mode.last || mode.references) && !nodes.LoadImage)
          reasons.push("缺少图片加载节点");
        if (mode.middle && (!nodes[t.guides?.node?.class_type ?? "MiniMaxH3AddGuide"] || !nodes.LoadImage || !t.guides))
          reasons.push("中间帧节点或接线缺失");
        for (const r of t.requiredModels) {
          const n = t.graph[r.node];
          const choices = nodes[n?.class_type]?.input?.required?.[r.input]?.[0] ?? nodes[n?.class_type]?.input?.optional?.[r.input]?.[0];
          if (!Array.isArray(choices) || !choices.includes(r.value))
            reasons.push(`缺少权重 ${r.value}`);
        }
        if (before === reasons.length) availableModes[modeId] = mode;
      }
      return {
        ...m,
        modes: availableModes,
        available: Object.keys(availableModes).length > 0,
        reason: [...new Set(reasons)].join("；")
      };
    });
  }
}
function compileVideo(config, model2, settings, images) {
  const definition = settings.templates[model2.modes[config.mode].template];
  if (!definition) throw new Error("工作流模板不存在");
  const output = videoOutput(config, model2);
  const values = {
    ...config.parameters,
    prompt: config.prompt,
    frames: output.frames
  };
  for (const kind of ["first", "last"]) {
    const input = config.inputs.find((i) => i.kind === kind);
    if (input) values[kind] = images.get(input.assetId);
  }
  config.inputs.filter((i) => i.kind === "reference").forEach((i, index) => {
    values[`reference${index + 1}`] = images.get(i.assetId);
  });
  const refs = config.inputs.filter((i) => i.kind === "reference");
  if (refs.length && definition.referencePrompt === "minimax-tags")
    values.prompt = config.prompt + "\n" + refs.map(
      (i, n) => `<Picture ${n + 1}>: ${{ subject: "主体造型与身份", style: "绘制风格", motion: "动作参考", camera: "镜头构图" }[i.role ?? "subject"]}。`
    ).join("\n");
  const graph = structuredClone(definition.graph);
  for (const [kind, targets] of Object.entries(
    definition.imageBindings ?? {}
  )) {
    const bindings = Array.isArray(targets) ? targets : [targets];
    const selected = config.inputs.filter(
      (i) => i.kind === (kind === "references" ? "reference" : kind)
    );
    if (selected.length > bindings.length)
      throw new Error("参考图片数量超过模板接线范围");
    selected.forEach((input, index) => {
      const target = bindings[index], nodeId = `vant_bound_${kind}_${index}`;
      if (!graph[target.node] || graph[nodeId])
        throw new Error("图片输入接线无效");
      graph[nodeId] = {
        class_type: "LoadImage",
        inputs: { image: images.get(input.assetId) }
      };
      graph[target.node].inputs[target.input] = [nodeId, 0];
    });
  }
  for (const n of Object.values(graph))
    for (const [key, value] of Object.entries(n.inputs)) {
      if (typeof value === "string" && /^\$[a-zA-Z0-9_]+$/.test(value)) {
        if (value.slice(1) in values) n.inputs[key] = values[value.slice(1)];
        else if (["$first", "$last"].includes(value)) delete n.inputs[key];
        else throw new Error(`模板输入未绑定：${value}`);
      }
    }
  if (definition.guides) {
    let conditioning = definition.guides.conditioning;
    config.inputs.filter((i) => i.kind === "middle").sort((a, b) => a.frame - b.frame).forEach((input, index) => {
      const imageId = `vant_image_${index}`, guideId = `vant_guide_${index}`;
      if (graph[imageId] || graph[guideId])
        throw new Error("模板占用了关键帧节点 ID");
      graph[imageId] = {
        class_type: "LoadImage",
        inputs: { image: images.get(input.assetId) }
      };
      const guide = structuredClone(
        definition.guides.node ?? {
          class_type: "MiniMaxH3AddGuide",
          inputs: {
            positive: "$conditioning",
            latent: "$latent",
            vae: "$vae",
            image: "$image",
            frame_idx: "$frame"
          }
        }
      );
      const bindings = {
        $conditioning: conditioning,
        $latent: definition.guides.latent,
        $vae: definition.guides.vae,
        $image: [imageId, 0],
        $frame: input.frame
      };
      for (const [key, value] of Object.entries(guide.inputs))
        if (typeof value === "string" && value in bindings)
          guide.inputs[key] = bindings[value];
      graph[guideId] = guide;
      conditioning = [guideId, 0];
    });
    for (const target of definition.guides.targets) {
      if (!graph[target.node]) throw new Error("关键帧目标节点不存在");
      graph[target.node].inputs[target.input] = conditioning;
    }
  }
  return graph;
}
export {
  VideoModels,
  compileVideo,
  videoSettingsSchema
};
