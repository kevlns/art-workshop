import {loadCore} from './core.mjs';
import {loadProject} from './project.mjs';
import {LOCAL_SAMPLING_DEFAULTS} from './task-contract.mjs';
function generateTemplate(projectId,core,kind) {
  return {
    project: projectId,
    kind: "generate",
    core,
    asset: {
      project: projectId,
      id: "custom",
      name: "自定义画布",
      constraints: {
        text: false,
        frame: false,
        scene: false,
        crop: false,
        shadow: false,
      },
      defaults: {
        preset: "centered",
        view: "正面",
        direction: "无方向",
        occupancy: 0.7,
        effectIntensity: "中",
        lightDirection: "左上方",
        lightQuality: "柔和",
        background: { type: "solid", color: "#FFFFFF" },
      },
      allowedOverrides: {
        preset: ["centered"],
        view: ["正面", "等距视角", "俯视"],
        direction: ["无方向"],
        occupancy: { min: 0.1, max: 0.95 },
        effectIntensity: ["弱", "中", "强"],
        lightDirection: ["左上方", "右上方", "正面", "顶部", "背面"],
        lightQuality: ["柔和", "硬朗", "均匀棚光", "戏剧性对比"],
      },
      presets: { centered: "主体居中，完整展示，四周保留安全空间" },
      checks: ["主体完整", "需求明确"],
      design: { resolution: { width: 512, height: 512 }, outputScale: 1 },
    },
    items: [
      {
        id: "asset-1",
        intent: "",
        entities: [
          {
            id: "subject",
            kind,
            appearance: "",
            color: "保持需求所述身份色",
            role: "primary",
            count: 1,
          },
        ],
        effects: [],
        composition: { focalTarget: "subject" },
        mustRead: [],
        variants: [{ id: "base" }],
      },
    ],
  };
}


export function jobTemplate(root,projectId,{kind='generate',core}={}){
 loadProject(projectId,root);
 const generation={backend:'local-qwen',options:{...LOCAL_SAMPLING_DEFAULTS}};
 if(kind==='edit')return {project:projectId,kind:'edit',generation,items:[{id:'asset-1',changes:[],preserve:[],mustRead:[]}]};
 if(kind!=='generate'||!core)throw new Error('生成草稿需要选择已冻结核心');
 loadCore(projectId,core,root);
 return {...generateTemplate(projectId,core,'subject'),generation};
}
