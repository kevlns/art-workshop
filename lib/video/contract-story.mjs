import {
  defaultVideoConfig,
  validateVideo,
  videoOutput
} from "./contract-video.mjs";
const emptyVideoScript = (model) => {
  const config = defaultVideoConfig(model);
  return {
    brief: "",
    modelId: config.modelId,
    mode: config.mode,
    parameters: config.parameters,
    inputs: [],
    shots: []
  };
};
const cutTransition = () => ({
  type: "cut",
  duration: 0,
  note: ""
});
function durationConfig(model, config, seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new Error("镜头时长必须为正数");
  if (seconds * Number(config.parameters.fps) < 1)
    throw new Error("镜头时长至少为一帧");
  const field = model.fields.duration;
  if (!field) throw new Error("当前模型未声明时长参数");
  const step = field.step ?? (field.type === "integer" ? 1 : 1e-3);
  const values = field.enum ? field.enum.filter((n) => typeof n === "number").sort((a, b) => a - b) : [
    Math.ceil((Math.max(seconds, field.minimum ?? step) - 1e-8) / step) * step
  ];
  for (const raw of values) {
    const n = Number(raw.toFixed(8));
    if (n < (field.minimum ?? 0) || n > (field.maximum ?? Infinity)) continue;
    const next = {
      ...config,
      parameters: { ...config.parameters, duration: n }
    };
    try {
      if (videoOutput(next, model).duration + 1e-6 >= seconds) return next;
    } catch {
    }
  }
  throw new Error("时长超出模型范围或帧数网格；请在自然动作边界拆分镜头");
}
function planVideoScript(script, model) {
  const errors = [], segments = [];
  if (!model || script.modelId !== model.id)
    return { segments, errors: ["请选择生成模型"], duration: 0 };
  if (!script.shots.length)
    return { segments, errors: ["请先编写镜头剧本"], duration: 0 };
  const base = {
    ...defaultVideoConfig(model),
    modelId: model.id,
    mode: script.mode,
    parameters: {
      ...defaultVideoConfig(model).parameters,
      ...script.parameters
    },
    prompt: "",
    inputs: []
  };
  const groups = [];
  for (const shot of script.shots) {
    if (!shot.prompt.trim()) errors.push(`${shot.name}：请填写画面与动作`);
    try {
      durationConfig(model, base, shot.duration);
    } catch (e) {
      errors.push(`${shot.name}：${e.message}`);
    }
    const last = groups.at(-1), previous = last?.at(-1);
    let combine = !!last && !shot.newClip && previous?.transition.type !== "dissolve" && (shot.mode ?? script.mode) === (previous?.mode ?? script.mode) && !shot.inputs.some((i) => i.kind === "first") && !previous?.inputs.some((i) => i.kind === "last");
    if (combine)
      try {
        durationConfig(
          model,
          base,
          last.reduce((n, s) => n + s.duration, 0) + shot.duration
        );
      } catch {
        combine = false;
      }
    if (combine) last.push(shot);
    else groups.push([shot]);
  }
  groups.forEach((shots, index) => {
    const duration = shots.reduce((n, s) => n + s.duration, 0);
    const dependency = index > 0 && groups[index - 1].at(-1).transition.type === "continue";
    const inputs = script.inputs.filter(
      (i) => i.kind === "reference" || i.kind === "first" && index === 0 || i.kind === "last" && index === groups.length - 1
    ).map((i) => ({ ...i }));
    let offset = 0;
    for (const shot of shots) {
      for (const input of shot.inputs)
        inputs.push({
          ...input,
          ...input.kind === "middle" ? {
            frame: (input.frame ?? 0) + Math.round(offset * Number(base.parameters.fps))
          } : {}
        });
      offset += shot.duration;
    }
    const unique = inputs.filter(
      (i, n) => i.kind !== "reference" || inputs.findIndex(
        (x) => x.kind === i.kind && x.assetId === i.assetId
      ) === n
    );
    if (dependency && unique.some((i) => i.kind === "first"))
      errors.push(`${shots[0].name}：前段尾帧与指定首帧冲突`);
    const preferred = shots[0].mode ?? script.mode;
    const mode = [preferred, ...Object.keys(model.modes)].find(
      (key) => {
        const m = model.modes[key];
        return m && (!dependency || m.first) && (!m.requireBoundary || dependency || unique.some((i) => i.kind === "first" || i.kind === "last")) && (key !== "reference" || unique.some((i) => i.kind === "reference")) && unique.every((i) => m[i.kind === "reference" ? "references" : i.kind]);
      }
    );
    if (!mode)
      errors.push(
        `${shots[0].name}：模型没有同时支持这些素材及衔接约束的工作方式，请调整引用或切镜`
      );
    let config = {
      ...base,
      mode: mode ?? preferred,
      inputs: unique,
      prompt: shots.map(
        (s, n) => `${shots.length > 1 ? `镜头${n + 1}：` : ""}${s.prompt}${s.transition.note ? `
衔接设计：${s.transition.note}` : ""}`
      ).join("\n\n")
    };
    try {
      config = durationConfig(model, config, duration);
      const checking = dependency ? {
        ...config,
        inputs: [
          ...config.inputs,
          { kind: "first", assetId: "pending-tail" }
        ]
      } : config;
      for (const error of validateVideo(checking, model))
        errors.push(`${shots[0].name}：${error}`);
      segments.push({
        id: shots.map((s) => s.id).join("."),
        shotIds: shots.map((s) => s.id),
        name: shots.length === 1 ? shots[0].name : `${shots[0].name} — ${shots.at(-1).name}`,
        config,
        duration,
        generatedDuration: videoOutput(config, model).duration,
        dependency,
        transition: { ...shots.at(-1).transition }
      });
    } catch (e) {
      errors.push(`${shots[0].name}：${e.message}`);
    }
  });
  for (let i = 0; i < segments.length - 1; i++) {
    const t = segments[i].transition;
    if (t.type === "dissolve" && (t.duration <= 0 || t.duration >= Math.min(segments[i].duration, segments[i + 1].duration)))
      errors.push(`${segments[i].name}：叠化时长应小于相邻两段时长`);
  }
  return {
    segments,
    errors: [...new Set(errors)],
    duration: segments.reduce(
      (n, s, i) => n + s.duration - (i < segments.length - 1 && s.transition.type === "dissolve" ? s.transition.duration : 0),
      0
    )
  };
}
function videoDependencyErrors(task, operationId) {
  const op = task.operations.find((o) => o.id === operationId), dep = op?.dependency;
  const errors = [];
  if (op?.refinementId) {
    const refinement = task.refinements?.find((r) => r.id === op.refinementId);
    let source = op, index = refinement?.operationIds.indexOf(source.id) ?? -1;
    const visited = /* @__PURE__ */ new Set();
    while (index < 0 && source.derivedFrom && !visited.has(source.id)) {
      visited.add(source.id);
      const previous = task.operations.find((o) => o.id === source.derivedFrom);
      if (!previous) break;
      source = previous;
      index = refinement?.operationIds.indexOf(source.id) ?? -1;
    }
    if (!refinement || index < 0) errors.push("精修操作不属于当前精修安排");
    else {
      if (index === 0 && !op.config.inputs.some(
        (i) => i.kind === "first" && i.assetId === refinement.firstAssetId
      ))
        errors.push("精修首帧必须保留原选区边界");
      if (index === refinement.operationIds.length - 1 && !op.config.inputs.some(
        (i) => i.kind === "last" && i.assetId === refinement.lastAssetId
      ))
        errors.push("精修尾帧必须保留原选区边界");
    }
  }
  if (!dep) return errors;
  const accepted = task.operations.find(
    (o) => o.id === dep.operationId
  )?.accepted;
  if (!accepted) return [...errors, "等待前段生成并采纳尾帧"];
  if (dep.runId !== accepted.runId || dep.assetId !== accepted.tailAssetId || !op.config.inputs.some(
    (i) => i.kind === "first" && i.assetId === dep.assetId
  ))
    errors.push("前段已变化，请重新绑定采纳的尾帧");
  return errors;
}
export {
  cutTransition,
  durationConfig,
  emptyVideoScript,
  planVideoScript,
  videoDependencyErrors
};
