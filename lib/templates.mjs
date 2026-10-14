import {loadCore} from './core.mjs';
import {loadProject} from './project.mjs';
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
        background: { type: "solid", color: "#FFFFFF" },
      },
      allowedOverrides: {
        preset: ["centered"],
        view: ["正面", "等距视角", "俯视"],
        direction: ["无方向"],
        occupancy: { min: 0.1, max: 0.95 },
        effectIntensity: ["弱", "中", "强"],
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
 if(kind==='edit')return {project:projectId,kind:'edit',items:[{id:'asset-1',changes:[],preserve:[],mustRead:[]}]};
 if(kind!=='generate'||!core)throw new Error('生成草稿需要选择已冻结核心');
 const frozen=loadCore(projectId,core,root),domain=Object.keys(frozen.config.domains)[0];
 if(!domain)throw new Error('冻结核心缺少题材配置');
 return generateTemplate(projectId,core,domain);
}
