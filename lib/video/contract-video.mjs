const videoModeLabels = {
  text: "纯文本创作",
  boundary: "固定首/尾帧",
  reference: "参考素材创作"
};
const videoBusy = (op) => ["dispatching", "running", "unknown"].includes(op.runs.at(-1)?.status ?? "");
const videoComplete = (op) => op.runs.at(-1)?.status === "succeeded";
function defaultVideoConfig(model) {
  return {
    modelId: model?.id ?? "",
    mode: Object.keys(model?.modes ?? { text: {} })[0],
    prompt: "",
    parameters: Object.fromEntries(
      Object.entries(model?.fields ?? {}).map(([key, field]) => [
        key,
        field.default
      ])
    ),
    inputs: []
  };
}
function videoOutput(config, model) {
  const fps = Number(config.parameters.fps), duration = Number(config.parameters.duration);
  const { multiple, offset, maximum } = model.frames;
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(duration) || duration <= 0 || !Number.isInteger(multiple) || multiple < 1)
    throw new Error("时长或帧率无效");
  const frames = Math.max(
    offset,
    Math.ceil((Math.round(fps * duration) - offset) / multiple) * multiple + offset
  );
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > maximum)
    throw new Error("总帧数超出模型范围");
  return {
    fps,
    frames,
    duration: frames / fps,
    width: Number(config.parameters.width),
    height: Number(config.parameters.height)
  };
}
function validateVideo(config, model) {
  const errors = [];
  if (config.modelId !== model.id) errors.push("模型身份不匹配");
  if (!config.prompt.trim()) errors.push("请填写本次内容");
  const mode = model.modes[config.mode];
  if (!mode) errors.push("模型不支持此工作方式");
  for (const key of Object.keys(config.parameters))
    if (!model.fields[key]) errors.push(`不支持的参数：${key}`);
  for (const [key, field] of Object.entries(model.fields)) {
    const value = config.parameters[key];
    const numeric = field.type === "number" || field.type === "integer";
    if (typeof value !== (numeric ? "number" : field.type) || numeric && (!Number.isFinite(value) || field.type === "integer" && !Number.isSafeInteger(value))) {
      errors.push(`${field.label}类型无效`);
      continue;
    }
    if (field.enum && !field.enum.includes(value))
      errors.push(`${field.label}不在允许值中`);
    if (numeric) {
      const n = value;
      if (field.minimum !== void 0 && n < field.minimum || field.maximum !== void 0 && n > field.maximum)
        errors.push(`${field.label}超出范围`);
      if (field.step && Math.abs(n / field.step - Math.round(n / field.step)) > 1e-6)
        errors.push(`${field.label}步长无效`);
    }
  }
  try {
    const output = videoOutput(config, model);
    if (!Number.isInteger(output.width) || !Number.isInteger(output.height) || output.width <= 0 || output.height <= 0 || output.width * output.height > model.maximumPixels)
      errors.push("分辨率超出模型范围");
    const occupied = /* @__PURE__ */ new Set();
    for (const input of config.inputs) {
      if (!mode?.[input.kind === "reference" ? "references" : input.kind])
        errors.push("当前工作方式不支持已引入的约束");
      if (input.kind === "middle" && (!Number.isInteger(input.frame) || input.frame <= 0 || input.frame >= output.frames - 1))
        errors.push("中间帧位置超出范围");
      const key = input.kind === "reference" ? `reference:${input.assetId}` : input.kind === "middle" ? `middle:${input.frame}` : input.kind;
      if (occupied.has(key)) errors.push("同一位置不能重复引入画面");
      occupied.add(key);
    }
  } catch (e) {
    errors.push(e.message);
  }
  if (mode?.requireBoundary && !config.inputs.some((i) => i.kind === "first" || i.kind === "last"))
    errors.push("至少引入首帧或尾帧");
  if (mode?.references && !config.inputs.some((i) => i.kind === "reference"))
    errors.push("请添加参考素材");
  return [...new Set(errors)];
}
function timelinePosition(value, unit, fps, frames) {
  let n;
  if (unit === "frame") {
    if (!/^F?\d+$/i.test(value.trim())) throw new Error("请输入整数帧号");
    n = Number(value.trim().replace(/^F/i, ""));
  } else {
    const raw = value.trim().replace(/(?:s|秒)$/i, "");
    if (!/^(?:\d+:){0,2}\d+(?:\.\d+)?$/.test(raw))
      throw new Error("请输入秒数或时分秒");
    const parts = raw.split(":").map(Number);
    if (parts.length > 1 && parts.slice(1).some((x) => x >= 60))
      throw new Error("时分秒格式无效");
    const seconds = parts.reduce((total, part) => total * 60 + part, 0);
    if (seconds > frames / fps + 5e-4) throw new Error("时间超出范围");
    n = Math.min(frames - 1, Math.round(seconds * fps));
  }
  if (!Number.isSafeInteger(n) || n < 0 || n >= frames)
    throw new Error("位置超出范围");
  return n;
}
export {
  defaultVideoConfig,
  timelinePosition,
  validateVideo,
  videoBusy,
  videoComplete,
  videoModeLabels,
  videoOutput
};
