import { localMediaModels } from "./contracts.mjs";
function h3Preset() {
  const graph = {
    "1": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: localMediaModels.video[0].split("/").at(-1),
        weight_dtype: "default"
      }
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: localMediaModels.video[2].split("/").at(-1),
        type: "minimax",
        device: "default"
      }
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: localMediaModels.video[3].split("/").at(-1) }
    },
    "4": {
      class_type: "VAELoader",
      inputs: { vae_name: localMediaModels.video[4].split("/").at(-1) }
    },
    "5": {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: {
        clip: ["2", 0],
        vae: ["3", 0],
        prompt: "$prompt",
        width: "$width",
        height: "$height",
        length: "$frames"
      }
    },
    "6": {
      class_type: "BasicGuider",
      inputs: { model: ["1", 0], conditioning: ["5", 0] }
    },
    "7": { class_type: "KSamplerSelect", inputs: { sampler_name: "$sampler" } },
    "8": {
      class_type: "BasicScheduler",
      inputs: {
        model: ["1", 0],
        scheduler: "$scheduler",
        steps: "$steps",
        denoise: 1
      }
    },
    "9": { class_type: "RandomNoise", inputs: { noise_seed: "$seed" } },
    "10": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["9", 0],
        guider: ["6", 0],
        sampler: ["7", 0],
        sigmas: ["8", 0],
        latent_image: ["5", 1]
      }
    },
    "11": {
      class_type: "VAEDecode",
      inputs: { samples: ["10", 0], vae: ["3", 0] }
    },
    "12": {
      class_type: "VAEDecodeAudio",
      inputs: { samples: ["10", 0], vae: ["4", 0] }
    },
    "13": {
      class_type: "CreateVideo",
      inputs: {
        images: ["11", 0],
        audio: ["12", 0],
        fps: "$fps",
        bit_depth: 8,
        color_space: "sRGB"
      }
    },
    "14": {
      class_type: "SaveVideo",
      inputs: {
        video: ["13", 0],
        filename_prefix: "vant/video",
        format: "mp4",
        "format.codec": "h264"
      }
    }
  };
  const requiredModels = [
    { node: "1", input: "unet_name", value: graph["1"].inputs.unet_name },
    { node: "2", input: "clip_name", value: graph["2"].inputs.clip_name },
    { node: "3", input: "vae_name", value: graph["3"].inputs.vae_name },
    { node: "4", input: "vae_name", value: graph["4"].inputs.vae_name }
  ];
  const reference = structuredClone(graph);
  reference["1"].inputs.unet_name = localMediaModels.video[1].split("/").at(-1);
  reference["5"] = {
    class_type: "MiniMaxH3ReferenceToVideo",
    inputs: {
      clip: ["2", 0],
      vae: ["3", 0],
      audio_vae: ["4", 0],
      prompt: "$prompt",
      width: "$width",
      height: "$height",
      length: "$frames",
      ref_image_size: "match"
    }
  };
  return {
    models: [
      {
        id: "minimax-h3",
        name: "MiniMax H3 · 本地 ComfyUI",
        adapter: "comfyui",
        fields: {
          duration: {
            label: "期望时长 / 秒",
            type: "number",
            default: 8,
            minimum: 0.2,
            maximum: 30,
            step: 0.01
          },
          fps: { label: "帧率", type: "integer", default: 24, enum: [24] },
          width: {
            label: "宽度",
            type: "integer",
            default: 864,
            enum: [768, 864, 1024],
            step: 32
          },
          height: {
            label: "高度",
            type: "integer",
            default: 480,
            enum: [480, 512, 576],
            step: 32
          },
          seed: {
            label: "随机种子",
            type: "integer",
            default: 1,
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER,
            step: 1
          },
          steps: {
            label: "采样步数",
            type: "integer",
            default: 20,
            minimum: 1,
            maximum: 60,
            step: 1
          },
          sampler: {
            label: "采样器",
            type: "string",
            default: "res_multistep",
            enum: ["res_multistep"]
          },
          scheduler: {
            label: "调度器",
            type: "string",
            default: "simple",
            enum: ["simple"]
          }
        },
        modes: {
          text: {
            first: false,
            last: false,
            middle: true,
            references: false,
            template: "h3-fl2va"
          },
          boundary: {
            first: true,
            last: true,
            middle: true,
            references: false,
            requireBoundary: true,
            template: "h3-fl2va"
          },
          reference: {
            first: false,
            last: false,
            middle: false,
            references: true,
            template: "h3-ref2va"
          }
        },
        frames: { multiple: 17, offset: 5, maximum: 736 },
        maximumPixels: 589824
      }
    ],
    templates: {
      "h3-fl2va": {
        graph,
        requiredModels,
        imageBindings: {
          first: { node: "5", input: "first_frame" },
          last: { node: "5", input: "last_frame" }
        },
        guides: {
          conditioning: ["5", 0],
          latent: ["5", 1],
          vae: ["3", 0],
          targets: [{ node: "6", input: "conditioning" }]
        }
      },
      "h3-ref2va": {
        referencePrompt: "minimax-tags",
        graph: reference,
        requiredModels: requiredModels.map(
          (r) => r.node === "1" ? { ...r, value: String(reference["1"].inputs.unet_name) } : r
        ),
        imageBindings: {
          references: Array.from({ length: 9 }, (_, n) => ({
            node: "5",
            input: `ref_images.ref_image_${n}`
          }))
        }
      }
    }
  };
}
export {
  h3Preset
};
