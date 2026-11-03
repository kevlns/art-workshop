import { hash, keys, id, text, texts, choice } from "./shared.mjs";
import { ContractError, AnalysisError } from "./errors.mjs";
import {
  STYLE_SCHEMA_VERSION,
  OBSERVATION_SCOPES,
  validateStyleConfig as validateCoreConfig,
} from "./style-contract.mjs";
const validateStyleConfig = validateCoreConfig;
export function validateReport(report, projectId) {
  keys(
    report,
    [
      "schema",
      "schemaVersion",
      "project",
      "id",
      "summary",
      "observations",
      "recommendation",
      "issues",
      "notes",
      "decisions",
      "provenance",
    ],
    "report",
  );
  if (report.schemaVersion !== STYLE_SCHEMA_VERSION)
    throw new ContractError(
      "风格报告职责版本已变化，请重新分析，不能采用旧报告",
    );
  if (
    report.schema !== "art-workshop/style-report" ||
    report.project !== projectId
  )
    throw new ContractError("风格报告身份不匹配");
  id(report.id, "report.id");
  text(report.summary, "report.summary", 300);
  if (!Array.isArray(report.observations))
    throw new ContractError("observations 必须为数组");
  for (const item of report.observations) {
    keys(
      item,
      ["source", "scope", "feature", "evidence", "confidence"],
      "observation",
    );
    text(item.source, "source", 1024);
    choice(item.scope, OBSERVATION_SCOPES, "scope");
    text(item.feature, "feature");
    text(item.evidence, "evidence");
    if (
      !Number.isFinite(item.confidence) ||
      item.confidence < 0 ||
      item.confidence > 1
    )
      throw new ContractError("confidence 必须在 0～1");
  }
  texts(report.notes, "notes", { empty: true });
  validateIssues(report);
  validateCoreConfig(report.recommendation);
  return report;
}

export const issueFingerprint = (issue) =>
  hash({ id: issue.id, question: issue.question, options: issue.options });
export function validateIssues(report) {
  if (!Array.isArray(report.issues) || report.issues.length > 30)
    throw new ContractError("问题列表非法");
  const ids = new Set();
  for (const issue of report.issues) {
    keys(issue, ["id", "question", "options", "reopenReason"], "issue");
    id(issue.id, "issue.id");
    if (ids.has(issue.id)) throw new ContractError("问题ID重复");
    ids.add(issue.id);
    text(issue.question, "issue.question", 2000);
    if (typeof issue.reopenReason !== "string")
      throw new ContractError("问题重新打开原因必须是文本");
    if (
      !Array.isArray(issue.options) ||
      issue.options.length < 2 ||
      issue.options.length > 5
    )
      throw new ContractError("每个问题需要2至5个具体可执行方案");
    const options = new Set();
    for (const option of issue.options) {
      keys(option, ["id", "label", "remove", "upsert"], "issue option");
      id(option.id, "option.id");
      if (options.has(option.id)) throw new ContractError("方案ID重复");
      options.add(option.id);
      text(option.label, "option.label", 1000);
      texts(option.remove, "option.remove", { empty: true });
      if (new Set(option.remove).size !== option.remove.length)
        throw new ContractError("删除规则重复");
      if (!Array.isArray(option.upsert))
        throw new ContractError("方案规则非法");
      if (option.upsert.length) validateStyleConfig({ rules: option.upsert });
      applyOption(report.recommendation, option);
    }
  }
  if (!Array.isArray(report.decisions))
    throw new ContractError("问题决定必须是数组");
  const decisions = new Set();
  for (const decision of report.decisions) {
    keys(
      decision,
      ["issueId", "fingerprint", "optionId", "note", "decidedAt"],
      "decision",
    );
    const issue = report.issues.find((i) => i.id === decision.issueId);
    if (
      !issue ||
      issueFingerprint(issue) !== decision.fingerprint ||
      !issue.options.some((o) => o.id === decision.optionId) ||
      decisions.has(issue.id)
    )
      throw new ContractError("问题决定与当前问题不匹配");
    decisions.add(issue.id);
    text(decision.note, "decision.note", 2000);
    text(decision.decidedAt, "decision.decidedAt");
  }
}
export function applyOption(config, option) {
  const rules = config.rules.filter((r) => !option.remove.includes(r.id));
  for (const rule of option.upsert) {
    const index = rules.findIndex((r) => r.id === rule.id);
    if (index < 0) rules.push(rule);
    else rules[index] = rule;
  }
  return validateStyleConfig({ rules });
}
export function unresolvedIssues(report) {
  return report.issues.filter(
    (issue) =>
      !report.decisions.some(
        (d) =>
          d.issueId === issue.id && d.fingerprint === issueFingerprint(issue),
      ),
  );
}
export function resolvedRecommendation(report) {
  return report.decisions.reduce((config, decision) => {
    const issue = report.issues.find((i) => i.id === decision.issueId);
    if (!issue || issueFingerprint(issue) !== decision.fingerprint)
      throw new ContractError("已确认问题发生变化，请重新决定");
    return applyOption(
      config,
      issue.options.find((o) => o.id === decision.optionId),
    );
  }, report.recommendation);
}

export function assertReportIdentity(report, expected) {
  if (report.project !== expected.project || report.id !== expected.id)
    throw new AnalysisError(
      "REPORT_IDENTITY_MISMATCH",
      "风格报告身份与当前对象不匹配",
      { recovery: "review-report" },
    );
}
export function inspectStyleReport(report, expected) {
  try {
    validateReport(report, expected.project);
    assertReportIdentity(report, expected);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      reason: error.message,
      code: error.code ?? "REPORT_FORMAT_INVALID",
    };
  }
}
export function modelStyleReport(value, expected, provenance) {
  if (!value) throw new ContractError("模型未返回有效风格报告 JSON");
  for (const [key, want] of Object.entries({
    schema: "art-workshop/style-report",
    schemaVersion: STYLE_SCHEMA_VERSION,
    project: expected.project,
    id: expected.id,
  }))
    if (value[key] !== undefined && value[key] !== want)
      throw new AnalysisError(
        "REPORT_IDENTITY_MISMATCH",
        "风格报告身份或职责版本与当前对象不匹配",
        { recovery: "review-report" },
      );
  if (value.decisions?.length)
    throw new AnalysisError(
      "REPORT_FORGED_DECISION",
      "模型不能代替用户确认风格取舍",
    );
  const report = {
    ...value,
    schema: "art-workshop/style-report",
    schemaVersion: STYLE_SCHEMA_VERSION,
    ...expected,
    provenance,
    decisions: [],
  };
  validateReport(report, expected.project);
  return report;
}
