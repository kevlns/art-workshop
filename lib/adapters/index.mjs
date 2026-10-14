import { dashscopeAdapter } from "./dashscope.mjs";
export function createAdapterRegistry(entries) {
  const registry = new Map();
  for (const adapter of entries) {
    if (
      !adapter.id ||
      registry.has(adapter.id) ||
      !["prepare", "submit", "query"].every(
        (key) => typeof adapter[key] === "function",
      )
    )
      throw new Error("协议适配器声明无效或重复");
    registry.set(adapter.id, Object.freeze(adapter));
  }
  return Object.freeze({
    list: () =>
      [...registry.values()].map((adapter) => ({
        id: adapter.id,
        label: adapter.label ?? adapter.id,
      })),
    get(id) {
      const adapter = registry.get(id);
      if (!adapter) throw new Error("图片协议尚未接入：" + id);
      return adapter;
    },
  });
}
export const adapters = createAdapterRegistry([dashscopeAdapter]);
