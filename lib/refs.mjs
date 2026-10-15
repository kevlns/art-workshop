import {existsSync,mkdirSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {externalPath} from './settings.mjs';

import {REFERENCE_CATEGORIES} from './style-contract.mjs';
export {REFERENCE_CATEGORIES} from './style-contract.mjs';
export function referenceRoot({defaultRefsDir,refsDir}={}) {
  return externalPath(refsDir??defaultRefsDir,'素材导入目录');
}

export function ensureReferenceDirectories(root) {
  root=externalPath(root,'参考目录');
  const paths=[root,...REFERENCE_CATEGORIES.map(category=>externalPath(join(root,category.directory),'参考分类目录'))];
  for(const path of paths) if(existsSync(path)&&!statSync(path).isDirectory()) throw new Error(`参考目录位置被文件占用：${path}`);
  for(const path of paths) mkdirSync(path,{recursive:true});
  return root;
}

export function referenceGuide(root) {
  return ['# 美术工坊参考职责',`素材导入目录：${root}`,'',
    '| 风格目录 | 提炼范围 | 示例 |','| --- | --- | --- |',
    ...REFERENCE_CATEGORIES.map(x=>`| ${x.directory}/ | ${x.purpose} | ${x.recommended} |`),'',
    '风格静态参考归属 styleId，仅在分析中理解；生成读取冻结核心，不自动上传静态参考。',
    '任务动态参考归属 taskId：subject/composition/pose/identity-color/surface/scene-light/text；编辑底图单独保存在 sources。',
    'reference import 显式导入到对象私有目录。发现、配置与预演不创建参考目录，不自动识别、扫描或绑定素材。'].join('\n');
}
