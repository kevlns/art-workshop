import { keys } from "./shared.mjs";
import { STYLE_SCHEMA_VERSION, STYLE_CATEGORIES } from "./style-contract.mjs";
import {
  GENERATION_FIELDS,
  EDIT_FIELDS,
  TASK_FIELDS,
} from "./task-contract.mjs";

/** Format recognition only. Missing content and absent optional fields are not deprecation. */
export function inspectObjectFormat(record, { core, dependency } = {}) {
  const reasons = [];
  if (
    record.readError ||
    (record.source?.kind === "migration" && !record.migration)
  )
    return {
      status: "unreadable",
      reasons: [record.readError ?? "迁移来源准备尚未完成，请从原对象重试派生"],
      canEdit: false,
      canDerive: false,
    };
  const kind = record.schema?.slice("art-workshop/".length);
  if (
    !record.config ||
    typeof record.config !== "object" ||
    Array.isArray(record.config)
  )
    return {
      status: "unreadable",
      reasons: ["配置数据无法读取"],
      canEdit: false,
      canDerive: false,
    };
  if (record.schemaVersion !== 2) reasons.push("对象格式已弃用");
  try {
    const c = record.config;
    if (kind === "style") {
      // Original frozen configs may use an earlier structured drawing contract.
      keys(
        c,
        ["description", "constraints", "rules", "analysis"],
        "style config",
      );
      if (c.rules !== undefined) {
        if (!Array.isArray(c.rules)) throw Error("风格规则结构已弃用");
        for (const rule of c.rules)
          keys(
            rule,
            ["id", "scope", "strength", "instruction", "when", "negative"],
            "style rule",
          );
      }
      if (
        record.report &&
        record.report.data?.schemaVersion !== STYLE_SCHEMA_VERSION
      )
        reasons.push("风格报告职责格式已弃用");
      if (
        (record.references ?? []).some(
          (r) => !STYLE_CATEGORIES.includes(r.category),
        )
      )
        reasons.push("风格参考分类已弃用");
      if (
        record.status === "frozen" &&
        (!core || core.schemaVersion !== STYLE_SCHEMA_VERSION)
      )
        reasons.push("冻结风格职责格式已弃用");
    } else if (kind === "task") {
      keys(c, TASK_FIELDS[c.kind] ?? [], "task config");
      if (!["generate", "edit"].includes(c.kind))
        reasons.push("任务类型格式已弃用");
      for (const item of c.items ?? []) {
        keys(
          item,
          c.kind === "edit" ? EDIT_FIELDS : GENERATION_FIELDS.item,
          "item",
        );
        if (c.kind === "generate")
          for (const [field, shape] of [
            ["entities", "entity"],
            ["effects", "effect"],
            ["relations", "relation"],
            ["variants", "variant"],
          ])
            for (const row of item[field] ?? [])
              keys(row, GENERATION_FIELDS[shape], shape);
      }
      if (c.core && (!dependency || dependency.status !== "current"))
        reasons.push("所用风格已弃用或不可用");
    } else reasons.push("对象类型格式已弃用");
  } catch (error) {
    reasons.push(error.message);
  }
  const status = reasons.length ? "deprecated" : "current";
  if (reasons.length) reasons[reasons.length - 1] += "，请派生迁移";
  return {
    status,
    reasons,
    canEdit: status === "current" && record.status !== "frozen",
    canDerive: !["discarded", "cleanup-required"].includes(record.status),
  };
}
export function assertSupportedObject(format) {
  if (format.status !== "current")
    throw Object.assign(
      new Error(
        "格式弃用：" + format.reasons.join("；") + "。请派生迁移为当前格式草稿",
      ),
      { code: "FORMAT_DEPRECATED" },
    );
}
