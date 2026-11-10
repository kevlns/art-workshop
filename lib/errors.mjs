/** Expected contract failures are distinct from transport and programming errors. */
export class ContractError extends Error {
  constructor(message, { code = "INPUT_INVALID", fieldPath } = {}) {
    super(message);
    this.name = "ContractError";
    this.code = code;
    this.fieldPath = fieldPath;
  }
}
export class AnalysisError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "AnalysisError";
    this.code = code;
    Object.assign(this, detail);
  }
}
export function errorDetail(error, stage) {
  return {
    code: error.code ?? "INTERNAL_ERROR",
    stage,
    message: error.message ?? String(error),
    ...(error.fieldPath ? { fieldPath: error.fieldPath } : {}),
    ...(error.upstream ? { upstream: error.upstream } : {}),
    ...(error.effectiveMaxTokens
      ? { effectiveMaxTokens: error.effectiveMaxTokens }
      : {}),
    recovery:
      error.recovery ??
      (error instanceof ContractError ? "fix-input" : "check-original-run"),
  };
}
