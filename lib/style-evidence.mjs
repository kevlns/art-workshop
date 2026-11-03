import { hash } from "./shared.mjs";
export function readStyleEvidence(provenance) {
  const seen = new Set();
  let value = provenance;
  for (let depth = 0; depth < 32; depth++) {
    if (!value || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    if (
      Array.isArray(value.refs) &&
      value.refs.every(
        (r) => r && typeof r.hash === "string" && typeof r.scope === "string",
      )
    )
      return value;
    if (!["inherited-frozen", "user-rules"].includes(value.method)) return null;
    value = value.evidence;
  }
  return null;
}
export const referenceEvidenceHash = (refs) =>
  hash(
    refs.map((r) => ({
      hash: r.hash,
      scope: r.scope,
      note: r.note ?? "",
      ignore: r.ignore ?? "",
    })),
  );
export function sameStyleEvidence(previous, refs) {
  const evidence = readStyleEvidence(previous?.provenance);
  return (
    !!evidence &&
    referenceEvidenceHash(evidence.refs) === referenceEvidenceHash(refs)
  );
}
export function styleProvenance(previous, metadata) {
  const evidence = readStyleEvidence(previous);
  return { ...(evidence ? structuredClone(evidence) : {}), ...metadata };
}
