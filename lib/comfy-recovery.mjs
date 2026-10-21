/** Only recorded prompt identities may be queried; never infer a new submission. */
export function comfyRecoveryPrompts(task) {
  if (task.plan?.backend?.provider !== 'comfyui') return null;
  const prompts = structuredClone(task.comfyPrompts ?? {});
  // The original worker records a single current prompt before polling.
  if (task.promptId && task.currentItem) {
    const item = task.items?.find(i => i.itemId === task.currentItem.itemId && i.variantId === task.currentItem.variantId);
    if (item && (item.execution ?? task.plan.execution).perValue === 1 && !prompts[item.inputHash])
      prompts[item.inputHash] = [task.promptId];
  }
  const entries = Object.entries(prompts);
  if (!entries.length || entries.some(([key, ids]) => {
    const item = task.items?.find(i => i.inputHash === key);
    return !item || !Array.isArray(ids) || ids.length > (item.execution ?? task.plan.execution).perValue || !ids.length || ids.some(id => typeof id !== 'string' || !id.trim());
  })) return null;
  return prompts;
}
