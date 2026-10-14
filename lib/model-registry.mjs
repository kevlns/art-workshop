import { hash } from "./shared.mjs";
import { modelDefinitions } from "./model-catalog.mjs";
const modes = new Set(["generate", "edit"]);
/** Boot-time validation prevents incomplete declarations from silently relaxing limits. */
export function createModelRegistry(definitions) {
  const index = new Map(),
    entries = structuredClone(definitions);
  for (const entry of entries) {
    const allowed = new Set([
      "id",
      "api",
      "input",
      "output",
      "inputPolicy",
      "transport",
      "fields",
      "models",
      "modes",
      "maxImages",
      "maxCount",
      "maxSeed",
      "maxNegativeCharacters",
      "maxPromptCharacters",
      "dimensions",
      "editDimensions",
      "negativeInPrompt",
      "notes",
      "source",
      "supported",
      "reason",
      "registered",
      "status",
    ]);
    if (Object.keys(entry).some((key) => !allowed.has(key)))
      throw new Error("模型声明包含未知字段");
    if (
      !entry.api ||
      !Array.isArray(entry.models) ||
      !entry.models.length ||
      !entry.modes?.length ||
      entry.modes.some((mode) => !modes.has(mode)) ||
      !Array.isArray(entry.input) ||
      !Array.isArray(entry.output) ||
      !Array.isArray(entry.notes) ||
      !entry.source
    )
      throw new Error("模型声明缺少必要字段");
    if (entry.supported) {
      if (
        !entry.id ||
        !entry.transport?.adapter ||
        !Number.isSafeInteger(entry.transport.version) ||
        entry.transport.version < 1 ||
        typeof entry.transport.mode !== "string" ||
        (entry.transport.path &&
          (!entry.transport.path.startsWith("/") ||
            entry.transport.path.startsWith("//")))
      )
        throw new Error("模型协议声明无效");
      for (const field of ["maxCount", "maxSeed", "maxImages"])
        if (
          !Number.isSafeInteger(entry[field]) ||
          entry[field] < (field === "maxCount" ? 1 : 0)
        )
          throw new Error("模型限制无效：" + field);
      const d = entry.dimensions;
      if (
        !d ||
        !["min", "max", "step", "minArea", "maxArea"].every(
          (key) => Number.isSafeInteger(d[key]) && d[key] > 0,
        ) ||
        d.min > d.max ||
        d.minArea > d.maxArea
      )
        throw new Error("模型尺寸声明无效");
      if (
        entry.maxImages > 0 &&
        (!Number.isSafeInteger(entry.inputPolicy?.maxBytes) ||
          entry.inputPolicy.maxBytes <= 0 ||
          !entry.inputPolicy.formats?.length)
      )
        throw new Error("输入图片限制声明无效");
      if (
        d.minRatio !== undefined &&
        (!(d.minRatio > 0) || !(d.maxRatio >= d.minRatio))
      )
        throw new Error("模型比例声明无效");
      const wires = new Set(["size", "n", "seed", "negative_prompt"]);
      for (const [key, rule] of Object.entries(entry.fields ?? {})) {
        if (
          !["boolean", "integer", "string"].includes(rule.type) ||
          !/^[a-z][a-z0-9_]*$/.test(rule.wire ?? "") ||
          !key ||
          wires.has(rule.wire)
        )
          throw new Error("模型参数声明无效或协议字段重复");
        wires.add(rule.wire);
        if (
          rule.default !== undefined &&
          (rule.type === "integer"
            ? !Number.isSafeInteger(rule.default) ||
              rule.default < (rule.min ?? -Infinity) ||
              rule.default > (rule.max ?? Infinity)
            : typeof rule.default !== rule.type)
        )
          throw new Error("模型参数默认值无效");
        if (
          rule.enum &&
          (!Array.isArray(rule.enum) ||
            !rule.enum.length ||
            (rule.default !== undefined && !rule.enum.includes(rule.default)))
        )
          throw new Error("模型参数枚举无效");
      }
    } else if (!entry.reason) throw new Error("未接入型号必须声明原因");
    for (const model of entry.models) {
      const key = entry.api + ":" + model;
      if (typeof model !== "string" || !model || index.has(key))
        throw new Error("重复或无效的模型标识：" + model);
      index.set(key, entry);
    }
  }
  const resolve = (api, model, mode = "generate", hasImages = false) => {
    const value = index.get(api + ":" + model);
    if (!value)
      return {
        supported: false,
        registered: false,
        reason: "该协议下的模型尚未适配参数与调用流程",
      };
    const result = structuredClone(value);
    if (result.supported && (mode === "edit" || hasImages))
      Object.assign(result.dimensions, result.editDimensions);
    return {
      ...result,
      registered: true,
      status: result.supported ? "adapted" : "recorded",
    };
  };
  return Object.freeze({
    resolve,
    catalog: () =>
      entries.map((entry) => ({
        ...structuredClone(entry),
        registered: true,
        status: entry.supported ? "adapted" : "recorded",
      })),
  });
}
export const modelRegistry = createModelRegistry(modelDefinitions);
export const resolveModel = (...args) => modelRegistry.resolve(...args);
export const modelCatalog = () => modelRegistry.catalog();
export function executionContract(spec) {
  const {
    models,
    notes,
    source,
    reason,
    registered,
    status,
    supported,
    ...execution
  } = spec;
  return {
    schema: "art/model-contract-v1",
    ...execution,
    fields: Object.fromEntries(
      Object.entries(execution.fields ?? {}).map(([key, { cli, ...rule }]) => [
        key,
        rule,
      ]),
    ),
  };
}
export const contractHash = (spec) => hash(executionContract(spec));
/** Shared by UI selection and execution configuration; no credential values required. */
export function modelEligibility(
  {
    providerEnabled = true,
    available,
    enabled,
    credential,
    capabilitySource,
    input = [],
    output = [],
    protocol,
    protocolError = "",
    model,
  },
  registry = modelRegistry,
) {
  const profile = protocol ? registry.resolve(protocol, model) : null;
  const image =
    output.includes("image") ||
    (capabilitySource === "unknown" && profile?.supported);
  const reason = !providerEnabled
    ? "实例未启用"
    : !available
      ? "目录中不可用"
      : !enabled
        ? "模型未启用"
        : !credential
          ? "尚未保存凭据"
          : protocolError ||
            (!protocol
              ? "请配置图片生成接口"
              : profile?.registered && !profile.supported
                ? profile.reason
                : capabilitySource === "unknown" && !profile?.supported
                  ? "能力待确认"
                  : !image
                    ? "不支持图片输出"
                    : !profile?.supported
                      ? profile?.reason
                      : "");
  return {
    generation: !reason,
    generationReason: reason || "",
    vision: !!(
      available &&
      enabled &&
      credential &&
      capabilitySource !== "unknown" &&
      input.includes("image") &&
      output.includes("text")
    ),
    imageCandidate: !!(
      output.includes("image") ||
      capabilitySource === "unknown" ||
      profile?.registered
    ),
    compatibility: profile,
  };
}
