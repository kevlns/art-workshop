import { hash } from "./shared.mjs";
import {
  resolveModel,
  contractHash,
  modelRegistry,
} from "./model-registry.mjs";
export function remotePrompt(item, compatibility) {
  return compatibility.negativeInPrompt && item.negativeBlock
    ? item.prompt +
        "\n\n必须避免以下内容（由负向约束并入主提示词）：\n" +
        item.negativeBlock
    : item.prompt;
}
export function validateRemotePlan(plan, registry = modelRegistry) {
  const model = plan.backend?.model ?? plan.execution.model;
  const compatibility = registry.resolve(
    plan.backend?.credentialReference?.api ?? "dashscope",
    model,
    plan.module,
  );
  if (!compatibility.supported)
    throw new Error(model + "：" + compatibility.reason);
  if (!compatibility.modes.includes(plan.module))
    throw new Error(
      model +
        " 不支持当前任务类型（支持：" +
        compatibility.modes
          .map((mode) => (mode === "generate" ? "生成" : "编辑"))
          .join(" / ") +
        "）",
    );
  for (const item of plan.items) {
    const e = item.execution ?? plan.execution;
    if (e.model !== model) throw new Error("计划执行模型与适配模型不一致");
    const [w, h] = String(e.size).split("*").map(Number),
      d = registry.resolve(
        compatibility.api,
        model,
        plan.module,
        !!item.imageArgs?.length,
      ).dimensions;
    if (
      !Number.isInteger(w) ||
      !Number.isInteger(h) ||
      w < d.min ||
      h < d.min ||
      w > d.max ||
      h > d.max ||
      w % d.step ||
      h % d.step ||
      w * h < d.minArea ||
      w * h > d.maxArea ||
      w / h < (d.minRatio ?? 0) ||
      w / h > (d.maxRatio ?? Infinity)
    )
      throw new Error(model + " 分辨率超出适配范围，请重新编译预案");
    if (
      !Number.isInteger(e.perValue) ||
      e.perValue < 1 ||
      e.perValue > compatibility.maxCount
    )
      throw new Error("生成数量超出工具适配范围");
    if (
      !Number.isInteger(item.seed) ||
      item.seed < 0 ||
      item.seed > compatibility.maxSeed
    )
      throw new Error("seed 超出模型范围");
    if ((item.imageArgs ?? []).length > compatibility.maxImages)
      throw new Error("参考输入图片超过模型上限");
    if (plan.module === "edit" && !(item.imageArgs ?? []).length)
      throw new Error("编辑模型需要输入底图");
    if (!compatibility.fields?.promptExtend && e.promptExtend)
      throw new Error(
        model + " 不支持提示词扩写，请关闭 promptExtend 后重新预演",
      );
    if (!compatibility.fields?.watermark && e.watermark)
      throw new Error(model + " 不支持水印参数");
    if (
      compatibility.maxNegativeCharacters &&
      [...(item.negativeBlock ?? "")].length >
        compatibility.maxNegativeCharacters
    )
      throw new Error(
        "负向提示词超过 " + compatibility.maxNegativeCharacters + " 字符",
      );
    if (
      compatibility.maxPromptCharacters &&
      [...remotePrompt(item, compatibility)].length >
        compatibility.maxPromptCharacters
    )
      throw new Error(
        "主提示词与负向约束合计超过 " +
          compatibility.maxPromptCharacters +
          " 字符",
      );
  }
  return compatibility;
}

export function compileRemoteRequest(
  plan,
  item,
  { registry = modelRegistry } = {},
) {
  const e = item.execution ?? plan.execution,
    api = plan.backend?.credentialReference?.api ?? "dashscope";
  const spec = registry.resolve(
    api,
    e.model,
    plan.module,
    !!item.imageArgs?.length,
  );
  validateRemotePlan({ ...plan, items: [item] }, registry);
  const parameters = { size: e.size, n: e.perValue, seed: item.seed },
    adjustments = [];
  const reserved = new Set([
    "model",
    "size",
    "perValue",
    "promptExtend",
    "watermark",
  ]);
  for (const key of Object.keys(e))
    if (!reserved.has(key) && !spec.fields?.[key])
      throw new Error("模型不支持参数 " + key);
  for (const [key, rule] of Object.entries(spec.fields ?? {})) {
    const value = e[key] ?? rule.default;
    if (value === undefined) continue;
    if (
      rule.type === "integer"
        ? !Number.isSafeInteger(value) ||
          value < (rule.min ?? -Infinity) ||
          value > (rule.max ?? Infinity)
        : typeof value !== rule.type
    )
      throw new Error("模型参数类型或范围错误：" + key);
    if (rule.enum && !rule.enum.includes(value))
      throw new Error("模型参数取值无效：" + key);
    parameters[rule.wire] = value;
  }
  if (item.dimensionAdjustment)
    adjustments.push({
      parameter: "size",
      action: "resolve-dimensions",
      ...item.dimensionAdjustment,
      message: "尺寸已解析到当前模型的合法范围",
    });
  const prompt = remotePrompt(item, spec);
  if (prompt !== item.prompt)
    adjustments.push({
      parameter: "negativePrompt",
      action: "append-to-prompt",
      message: "负向约束已明确并入主提示词",
    });
  if (item.negativeBlock && !spec.negativeInPrompt)
    parameters.negative_prompt = item.negativeBlock;
  return {
    schema: "art/image-request-v1",
    api,
    adapter: spec.transport.adapter,
    transport: spec.transport,
    inputPolicy: spec.inputPolicy,
    contractHash: contractHash(spec),
    module: plan.module,
    model: e.model,
    prompt,
    negativePrompt: spec.negativeInPrompt ? "" : (item.negativeBlock ?? ""),
    images: [...(item.imageArgs ?? [])],
    parameters,
    size: e.size,
    seed: item.seed,
    count: e.perValue,
    adjustments,
  };
}
export function freezeRemotePlan(plan) {
  const requests = plan.items.map((item) => compileRemoteRequest(plan, item));
  return {
    requests,
    contract: {
      schema: "art/execution-contract-v1",
      hash: hash(requests.map((r) => r.contractHash)),
    },
  };
}
export function assertRemoteContract(plan) {
  if (!plan.executionContract || !plan.items.every((item) => item.request))
    throw new Error("预案缺少当前执行契约，请重新预演");
  const current = freezeRemotePlan(plan);
  if (
    hash(current.contract) !== hash(plan.executionContract) ||
    plan.items.some(
      (item, index) => hash(item.request) !== hash(current.requests[index]),
    )
  )
    throw new Error("模型执行契约已变化，请重新预演");
}
