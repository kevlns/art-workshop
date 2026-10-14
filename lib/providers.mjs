import { generateComfy } from "./comfyui.mjs";
import { compileRemoteRequest } from "./generation-policy.mjs";
import { adapters } from "./adapters/index.mjs";
import { executeRemote } from "./execution/remote.mjs";
export function generationRequest(plan, item) {
  if (plan.backend?.provider !== "comfyui")
    return item.request ?? compileRemoteRequest(plan, item);
  const execution = item.execution ?? plan.execution;
  return {
    module: plan.module,
    prompt: item.prompt,
    negativePrompt: item.negativeBlock ?? "",
    model: execution.model,
    size: execution.size,
    seed: item.seed,
    count: execution.perValue,
    images: item.imageArgs,
    promptExtend: execution.promptExtend,
    watermark: execution.watermark,
  };
}
export async function generate(plan, item, context) {
  if (plan.backend?.provider === "comfyui")
    return generateComfy(plan, item, context);
  const request = generationRequest(plan, item);
  return executeRemote(request, adapters.get(request.adapter), {
    ...context,
    baseUrl: plan.backend?.credentialReference?.baseUrl ?? context.baseUrl,
  });
}
