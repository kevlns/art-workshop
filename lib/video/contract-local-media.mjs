const localMediaModels = {
  image: [
    "diffusion_models/qwen-image-2.1-UC-Q4_K_M.gguf",
    "text_encoders/qwen3vl_8b_int8_convrot.safetensors",
    "vae/qwen_image_2.1_vae_bf16.safetensors"
  ],
  video: [
    "diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    "diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors",
    "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    "vae/minimax_h3_video_vae_int8_convrot.safetensors",
    "vae/minimax_h3_audio_vae_fp32.safetensors"
  ]
};
function localDeploymentSkill(kind, root, endpoint) {
  const image = kind === "image";
  return [
    `部署 Skill：${image ? "Qwen Image 2.1 · Q4" : "MiniMax H3 · INT8"}`,
    `环境目录：${root.trim() || "先确认安装目录"}`,
    `服务地址：${endpoint.trim() || "http://127.0.0.1:8188/"}`,
    "",
    "1. 检查本机环境",
    "- 检查 GPU、显存、磁盘、Python、PyTorch/CUDA、ComfyUI 及已有模型；优先复用已验证环境，不覆盖已有配置。",
    `- ${image ? "检查 ComfyUI-GGUF、Qwen Image 2.1 节点及分词器。" : "检查 MiniMax H3 原生节点、Qwen 分词器、comfy-kitchen 和 PyAV 音视频编码支持。"}`,
    "",
    "2. 实际安装部署",
    `- 仅补齐缺失或不兼容依赖；安装支持当前模型的 ComfyUI${image ? " 和 ComfyUI-GGUF" : ""}，复用其 Python 环境。`,
    "- 模型放入 ComfyUI/models 对应子目录；从模型发布源下载，核对文件大小及发布方校验值，勿仅重命名其他精度版本：",
    ...localMediaModels[kind].map((path) => "  " + path),
    `- ${image ? "使用 Vant 内置 Qwen Image 2.1 工作流；低显存时使用 CPU 文本编码、低显存模式和小画布。" : "使用 Vant 内置 H3 首尾帧及参考素材工作流，视频 VAE 选择 INT8 convrot。"}`,
    "- 启动本机 ComfyUI，将环境目录和服务地址保存到对应的 Vant 方案。",
    "",
    "3. 完成校验",
    "- 检查服务可达、节点与模型枚举齐全、无依赖导入错误。",
    `- ${image ? "实际完成一次小图生成与图片编辑，确认产物可读取。" : "按支持的帧数和分辨率网格，实际完成短视频及首尾帧、参考图生成，确认视频可播放、有声任务音轨正常。"}`,
    "- 重启后复测；记录版本、路径和产物。未通过的项目如实列出，不以文件存在代替生成验收。"
  ].join("\n");
}
export {
  localDeploymentSkill,
  localMediaModels
};
