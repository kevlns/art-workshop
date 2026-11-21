// Copyright © 2026 Vant <sl_kevln@163.com>
import { readFile } from 'node:fs/promises';

async function json(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

try {
  const [skeletonPath, indexPath] = process.argv.slice(2);
  if (!skeletonPath || !indexPath) throw Error('用法：node check-variants.mjs <骨架.json> <animations.json>');
  const [skeleton, groups] = await Promise.all([json(skeletonPath), json(indexPath)]);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(skeleton?.animations) || !object(groups)) throw Error('骨架 animations 和动作索引须为对象。');
  const remaining = new Set(Object.keys(skeleton.animations));
  if (!remaining.size) throw Error('骨架中没有可交付动作。');
  for (const [group, variants] of Object.entries(groups)) {
    if (!/^[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)*$/.test(group) || !Array.isArray(variants) || !variants.length)
      throw Error('无效类别或空变体列表：' + group);
    let previous = 0;
    for (const clip of variants) {
      const match = typeof clip === 'string' && /^(.*)_([0-9]{3})$/.exec(clip);
      if (!match || match[1] !== group || Number(match[2]) <= previous)
        throw Error('变体须按组内三位正编号升序且唯一：' + clip);
      if (!remaining.delete(clip)) throw Error('索引动作没有匹配的骨架动作：' + clip);
      previous = Number(match[2]);
    }
  }
  if (remaining.size) throw Error('骨架动作未入索引：' + [...remaining].join('、'));
  console.log('动作索引一致，共 ' + Object.keys(skeleton.animations).length + ' 个变体。');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
