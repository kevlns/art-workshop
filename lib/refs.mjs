import {existsSync,mkdirSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {externalPath} from './settings.mjs';

export const REFERENCE_CATEGORIES=[
  {directory:'style',purpose:'整体视觉语言：媒介、笔触、描边与统一画风',recommended:'同一画风的完整作品；轮廓清晰，主体与背景可区分，避免混合多种画风的拼图',scope:'style'},
  {directory:'palette',purpose:'配色关系：主色、辅色、点缀色与冷暖',recommended:'色板或配色明确的作品；避免强烈滤镜、偏色照片与无法区分固有色的复杂光照',scope:'palette'},
  {directory:'subject',purpose:'主体结构与辨识特征',recommended:'清晰的单主体、多角度或结构展示图；分析核心时只提取通用造型规律，具体身份写入单体需求',scope:'shape'},
  {directory:'composition',purpose:'布局、视角、占比与留白',recommended:'构图清楚的示例、剪影或布局草图；具体布局写入资产配置或单体计划',scope:null},
  {directory:'material',purpose:'表面材质、纹理、光泽与质感',recommended:'清晰的材质近景；光照适中，能分辨表面纹理与反射，避免过曝和重度压缩',scope:'render'},
  {directory:'text',purpose:'字形、排版与文字装饰',recommended:'清晰可读的字体或排版样张；实际文字内容与排版要求写入单体需求',scope:null},
  {directory:'pose',purpose:'动作、姿态与肢体关系',recommended:'完整主体的动作图或姿态草图；关节与接触关系清楚，具体动作写入单体需求',scope:null}
];

export function referenceRoot({workspace,defaultRefsDir,refsDir,project}={}) {
  return externalPath(refsDir??(project?.refsDir?resolve(workspace,project.refsDir):defaultRefsDir),'参考目录');
}

export function ensureReferenceDirectories(root) {
  root=externalPath(root,'参考目录');
  const paths=[root,...REFERENCE_CATEGORIES.map(category=>externalPath(join(root,category.directory),'参考分类目录'))];
  for(const path of paths) if(existsSync(path)&&!statSync(path).isDirectory()) throw new Error(`参考目录位置被文件占用：${path}`);
  for(const path of paths) mkdirSync(path,{recursive:true});
  return root;
}

export function referenceGuide(root) {
  return ['# 美术工坊参考图目录',`当前参考目录：${root}`,'',
    '| 目录 | 作用 | 推荐图片 | 分析 scope |','| --- | --- | --- | --- |',
    ...REFERENCE_CATEGORIES.map(x=>`| ${x.directory}/ | ${x.purpose} | ${x.recommended} | ${x.scope??'单体计划，不写入核心'} |`),'',
    '目录仅用于整理素材，不自动识别、扫描、绑定或传给生图模型。风格分析须在输入 refs 中显式声明 path、scope 和 note；scope 支持 style/palette/shape/render，目录名不替代 scope。',
    '相对参考路径从当前参考目录解析。工程可设置 refsDir；优先级为 --refs-dir → 工程 refsDir → 本地 paths.refs。',
    '每次 CLI 配置生效时检查并补齐分类目录，包括 --dry；只创建缺少的目录，不移动或覆盖图片。预演仍不调用远程模型、不产生图片。'].join('\n');
}
