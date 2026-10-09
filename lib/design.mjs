import { keys, integer } from './shared.mjs';

// 设计基准归资产规格，单体尺寸与倍率归任务；出图尺寸由它们确定。
export function design(profile, override, explicitExecution = {}) {
  if (profile.design === undefined) {
    if (override !== undefined) throw new Error('单体 design 需要资产规格声明 design');
    return null;
  }
  const base = profile.design;
  keys(base, ['resolution', 'outputScale'], 'profile.design');
  keys(base.resolution, ['width', 'height'], 'design.resolution');
  integer(base.resolution.width, 'design.resolution.width', 1, 16384);
  integer(base.resolution.height, 'design.resolution.height', 1, 16384);
  integer(base.outputScale, 'design.outputScale', 1, 4);
  if (override !== undefined) keys(override, ['width', 'height', 'outputScale'], 'item.design');
  const size = override === undefined ? base.resolution : override;
  integer(size.width, 'design.width', 1, base.resolution.width);
  integer(size.height, 'design.height', 1, base.resolution.height);
  const outputScale = override?.outputScale ?? base.outputScale;
  integer(outputScale, 'design.outputScale', 1, 4);
  if (explicitExecution.size !== undefined) throw new Error('设计尺寸与任务 execution.size 不能同时指定');
  const outputSize = { width: size.width * outputScale, height: size.height * outputScale };
  for (const axis of ['width', 'height']) integer(outputSize[axis], `设计换算出图 ${axis}`, 256, 4096);
  return { resolution: { ...base.resolution }, size: { width: size.width, height: size.height }, outputScale, outputSize };
}

export function designPrompt(value) {
  return `UI 设计基准 ${value.resolution.width}×${value.resolution.height}；本单体设计尺寸 ${value.size.width}×${value.size.height}；出图倍率 ${value.outputScale}，画布 ${value.outputSize.width}×${value.outputSize.height} 像素。保持设计宽高比，完整展示并在画布内居中；描边、圆角与细节随同一倍率缩放。`;
}
