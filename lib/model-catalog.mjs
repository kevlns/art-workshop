// Explicit tool contracts: model names alone never choose a fallback API.
const common = {
  api: "dashscope",
  inputPolicy: {
    maxBytes: 10 * 1024 * 1024,
    formats: ["jpeg", "png", "webp", "bmp", "tiff", "gif"],
  },
  input: ["text", "image"],
  output: ["image"],
  transport: {
    adapter: "dashscope",
    version: 1,
    timeoutMilliseconds: 1800000,
    mode: "sync",
    path: "/api/v1/services/aigc/multimodal-generation/generation",
  },
  fields: {
    promptExtend: {
      type: "boolean",
      default: false,
      wire: "prompt_extend",
      cli: "--prompt-extend",
    },
    watermark: {
      type: "boolean",
      default: false,
      wire: "watermark",
      cli: "--watermark",
    },
  },
  modes: ["generate", "edit"],
  maxCount: 4,
  maxSeed: 2147483647,
};
const qwen = {
  ...common,
  maxImages: 3,
  maxNegativeCharacters: 500,
  dimensions: {
    min: 256,
    max: 4096,
    step: 1,
    minArea: 512 ** 2,
    maxArea: 2048 ** 2,
  },
};
const cancellation = "取消仅停止本地等待；远端停止未确认时保留执行记录";
const qwenNotes = [
  "支持文生图与底图编辑；编辑最多 3 张输入图",
  "总像素 512²–2048²；每项 1–4 张（工具当前上限）",
  "负向提示词最多 500 字符；支持提示词扩写、seed 与水印",
];
const profiles = [
  {
    ...qwen,
    id: "dashscope-qwen-image-3.0-v1",
    models: ["qwen-image-3.0", "qwen-image-3.0-pro"],
    notes: [...qwenNotes, cancellation],
    source:
      "https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference",
  },
  {
    ...qwen,
    id: "dashscope-qwen-image-2.0-v1",
    models: [
      "qwen-image-2.0",
      "qwen-image-2.0-pro",
      "qwen-image-2.0-2026-03-03",
      "qwen-image-2.0-pro-2026-03-03",
      "qwen-image-2.0-pro-2026-04-22",
      "qwen-image-2.0-pro-2026-06-22",
    ],
    editDimensions: { step: 16 },
    notes: [
      ...qwenNotes,
      "编辑尺寸按 16 像素对齐；正向提示词上限 1300 Token，由服务端计算",
      cancellation,
    ],
    source: "https://help.aliyun.com/zh/model-studio/qwen-image-edit-api",
  },
  {
    ...common,
    id: "dashscope-wan2.6-t2i-v1",
    models: ["wan2.6-t2i"],
    input: ["text"],
    transport: {
      adapter: "dashscope",
      version: 1,
      mode: "async",
      path: "/api/v1/services/aigc/image-generation/generation",
    },
    modes: ["generate"],
    maxImages: 0,
    maxPromptCharacters: 2000,
    maxNegativeCharacters: 500,
    dimensions: {
      min: 256,
      max: 4096,
      step: 16,
      minArea: 1280 ** 2,
      maxArea: 1440 ** 2,
      minRatio: 1 / 4,
      maxRatio: 4,
    },
    notes: [
      "仅文生图，不接收输入图；编辑请选择 wan2.6-image",
      "总像素 1280²–1440²；比例 1:4–4:1；工具按 16 像素对齐",
      "正向词最多 2000 字符，负向词最多 500 字符；每项 1–4 张",
      "异步提交并轮询原任务；不自动重提",
      cancellation,
    ],
    source:
      "https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference",
  },
  {
    ...common,
    id: "dashscope-wan2.6-image-v1",
    models: ["wan2.6-image"],
    modes: ["edit"],
    maxImages: 4,
    inputPolicy: {
      maxBytes: 10 * 1024 * 1024,
      formats: ["jpeg", "png", "webp", "bmp"],
      minAxis: 240,
      maxAxis: 8000,
      alpha: false,
    },
    maxPromptCharacters: 2000,
    maxNegativeCharacters: 500,
    dimensions: {
      min: 256,
      max: 4096,
      step: 16,
      minArea: 768 ** 2,
      maxArea: 2048 ** 2,
      minRatio: 1 / 4,
      maxRatio: 4,
    },
    notes: [
      "仅图像编辑，必须提供 1–4 张底图；不开放流式图文混排",
      "总像素 768²–2048²；比例 1:4–4:1；工具按 16 像素对齐",
      "正向词最多 2000 字符，负向词最多 500 字符；每项 1–4 张",
      cancellation,
    ],
    source:
      "https://help.aliyun.com/zh/model-studio/wan-image-generation-api-reference",
  },
  ...[false, true].map((pro) => ({
    ...common,
    id: `dashscope-wan2.7-image${pro ? "-pro" : ""}-v1`,
    models: [`wan2.7-image${pro ? "-pro" : ""}`],
    maxImages: 9,
    inputPolicy: {
      maxBytes: 20 * 1024 * 1024,
      formats: ["jpeg", "png", "webp", "bmp"],
      minAxis: 240,
      maxAxis: 8000,
      minRatio: 1 / 8,
      maxRatio: 8,
      alpha: false,
    },
    maxPromptCharacters: 5000,
    negativeInPrompt: true,
    fields: { watermark: common.fields.watermark },
    dimensions: {
      min: 256,
      max: 4096,
      step: 1,
      minArea: 768 ** 2,
      maxArea: (pro ? 4096 : 2048) ** 2,
      minRatio: 1 / 8,
      maxRatio: 8,
    },
    editDimensions: { maxArea: 2048 ** 2 },
    notes: [
      "支持文生图与编辑；编辑最多 9 张输入图",
      pro
        ? "纯文生图总像素 768²–4096²；带图生成和编辑最高 2048²"
        : "总像素 768²–2048²",
      "宽高比 1:8–8:1；单边 256–4096（工具范围）；每项 1–4 张",
      "负向约束会标明并入主提示词；合并后最多 5000 字符；不支持提示词扩写开关",
      "当前不开放组图、框选编辑与调色板；沿用服务端默认思考模式；输出尺寸可能有微小差异",
      cancellation,
    ],
    source:
      "https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference",
  })),
];
const recorded = [
  {
    models: [
      "qwen-image",
      "qwen-image-max",
      "qwen-image-max-2025-12-30",
      "qwen-image-plus",
      "qwen-image-plus-2026-01-09",
    ],
    modes: ["generate"],
    reason: "早期 Qwen 图片生成模型，仅登记；固定尺寸与独立调用规格尚未接入",
    notes: [
      "仅文生图；使用旧版固定分辨率及输出数量规范，不复用 Qwen 2/3 的自由尺寸",
    ],
    source: "https://help.aliyun.com/zh/model-studio/image-model/",
  },
  {
    models: [
      "qwen-image-edit",
      "qwen-image-edit-max",
      "qwen-image-edit-max-2026-01-16",
      "qwen-image-edit-plus",
      "qwen-image-edit-plus-2025-12-15",
      "qwen-image-edit-plus-2025-10-30",
    ],
    modes: ["edit"],
    reason: "早期 Qwen 编辑模型，仅登记；旧版尺寸与输出数量规范尚未接入",
    notes: ["仅编辑；不同版本输出数量与分辨率不同，不能按 Qwen 2/3 参数提交"],
    source: "https://help.aliyun.com/zh/model-studio/image-model/",
  },
  {
    models: [
      "wan2.5-t2i-preview",
      "wan2.2-t2i-plus",
      "wan2.2-t2i-flash",
      "wanx2.1-t2i-plus",
      "wanx2.1-t2i-turbo",
      "wan2.1-t2i-plus",
      "wan2.1-t2i-turbo",
      "wanx2.0-t2i-turbo",
    ],
    modes: ["generate"],
    reason: "早期万相文生图模型，仅登记；旧版异步接口与尺寸规范尚未接入",
    notes: [
      "2.5 为像素面积与比例限制；2.2 及更早为单边尺寸限制；不能套用 2.6/2.7 参数",
    ],
    source:
      "https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference",
  },
  {
    models: ["wan2.5-i2i-preview"],
    modes: ["edit"],
    reason: "早期万相 2.5 编辑模型，仅登记；独立输入结构与尺寸规范尚未接入",
    notes: ["使用 input.images 与旧版图编辑接口，不套用多模态 messages 请求"],
    source:
      "https://help.aliyun.com/zh/model-studio/wan2-5-image-edit-api-reference",
  },
  {
    models: ["wanx2.1-imageedit"],
    modes: ["edit"],
    reason: "专用图像编辑模型，仅登记；需要 function、底图及功能专属参数",
    notes: ["换背景、扩图、超分等功能参数不同；当前通用任务未提供对应配置"],
    source:
      "https://help.aliyun.com/zh/model-studio/wanx-image-edit-api-reference",
  },
  {
    models: ["wanx-v1"],
    modes: ["generate"],
    reason: "早期万相 V1 模型，仅登记；旧版风格及参考图工作流尚未接入",
    notes: ["使用旧版异步接口，风格与参考图语义不同"],
    source:
      "https://help.aliyun.com/zh/model-studio/text-to-image-api-reference",
  },
  {
    models: ["wanx-sketch-to-image-lite"],
    modes: ["edit"],
    reason: "涂鸦专用模型，仅登记；需要线稿输入与专属控制参数",
    notes: ["通用编辑底图不能替代线稿角色与控制参数"],
    source:
      "https://help.aliyun.com/zh/model-studio/wanx-sketch-to-image-api-reference",
  },
  {
    models: ["wanx-x-painting"],
    modes: ["edit"],
    reason: "局部重绘专用模型，仅登记；需要独立蒙版与底图",
    notes: ["需要 mask_image_url 和 base_image_url；当前任务没有蒙版工作流"],
    source: "https://help.aliyun.com/zh/model-studio/vary-region-api-reference",
  },
];

export const modelDefinitions = [
  ...profiles.map((p) => ({ ...p, supported: true })),
  ...recorded.map((p) => ({
    ...p,
    api: "dashscope",
    input: p.modes.includes("edit") ? ["text", "image"] : ["text"],
    output: ["image"],
    supported: false,
  })),
];
