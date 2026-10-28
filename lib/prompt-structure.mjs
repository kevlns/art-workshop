import {textSpecLine} from './task-contract.mjs';
export const COMPILER_VERSION = 4;
const textSection=entries=>entries?.length?`【画面文字规格】\n仅将「」内的内容作为画面文字，其余为布局要求。\n${entries.map(entry=>'- '+textSpecLine(entry)).join('\n')}`:'';
export function generationPrompt({intent,frozen,details,composition,delivery,asset,references,mustRead,textSpecs}){
  return [
    `【本次用途与主体】\n${intent}。`,
    `【静态冻结风格】\n${frozen}`,
    `【动态需求：主体、细节与关系】\n${details.join('\n')}`,
    `【动态构图与背景】\n${composition}`,
    `【交付规格与约束】\n${[delivery,asset].filter(Boolean).join('\n')}`,
    mustRead?.length?`【必须可读的特征】\n${[...new Set(mustRead)].map(x=>'- '+x).join('\n')}`:'',
    textSection(textSpecs),
    references,
  ].filter(Boolean).join('\n');
}
export function editingPrompt({changes,preserve,frozen,references,mustRead,textSpecs}){
  return [
    '【本次任务】\n基于输入原图编辑。未声明修改的部分保持原样。',
    `【动态修改要求】\n${changes.join('\n')}`,
    `【动态保留要求】\n${preserve.join('\n')}`,
    frozen?`【静态冻结风格】\n${frozen}`:'',
    mustRead?.length?`【必须可读的特征】\n${[...new Set(mustRead)].map(x=>'- '+x).join('\n')}`:'',
    textSection(textSpecs),
    references,
  ].filter(Boolean).join('\n');
}
