/** Versioned drawing contract. Content and physical properties belong to each task. */
export const STYLE_SCHEMA_VERSION=3;
export const REFERENCE_CATEGORIES=[
  {directory:'style',purpose:'媒介与整体绘制气质',recommended:'只提炼如何绘制，不继承主体轮廓、比例、结构或姿态',scope:'style'},
  {directory:'palette',purpose:'可复用色彩关系',recommended:'色彩饱和度、色相对比与阴影偏色；不冻结主体身份色',scope:'palette'},
  {directory:'rendering',purpose:'描绘、明暗、描边与笔触',recommended:'色阶、高光画法、描边、笔触与刻画密度；不固定材质或光源方向',scope:'rendering'}
];
export const STYLE_CATEGORIES=REFERENCE_CATEGORIES.map(category=>category.directory);
export const OBSERVATION_SCOPES=[...STYLE_CATEGORIES,'content','asset'];
export const RULE_SCOPES=['medium','shading','outline','highlights','brushwork','detail','palette'];
export const RULE_STRENGTHS=['required','default','avoid'];
export const RULE_TOPICS=[
  {id:'medium',label:'媒介与整体语言'},
  {id:'outline',label:'描边'},
  {id:'shading',label:'明暗与形体表现'},
  {id:'highlights',label:'高光'},
  {id:'brushwork',label:'笔触'},
  {id:'detail',label:'刻画密度'},
  {id:'palette',label:'色彩关系'}
];
export const RULE_LABELS={required:'必须遵守',default:'默认倾向',avoid:'必须避免'};
export const RULE_GUIDE='每条规则只表达一个绘制主题。required 是必须遵守，avoid 是必须避免；只是少用、优先或通常避免时使用 default，并在 instruction 写清倾向。when 只记录适用条件，不猜测任务是否满足；条件规则不展开为全局禁止。各主题按需要填写，不要求填满；不重复同一要求，不增加主体、背景、尺寸或模型限制。';
export const STYLE_NEGATIVE_GUIDE='风格负向只排除跨主体复用的绘制语言，例如混杂渲染语言、照片级写实表现、杂乱的绘画笔触；不得排除具体主体、部件、身份色、物体纹理、材质、光源方向、构图或交付规格。不要把参考图中未出现的内容推断为禁止。avoid 规则可填写 negative 字符串数组，直接写被排除的抽象视觉特征，不加“避免、不要、禁止、no、without”等否定前缀，不混入正向要求或局部例外。instruction 是同一规则的阅读说明；适用条件和例外必须写入 when。只有无条件且明确填写的 negative 进入独立负向参数；有 when 的规则及 negative 表达完整保留在正向条件段，不猜测条件成立，不展开为全局禁止。未填写 negative 的文字排除条款仍完整保留，不机械转换。default 只是倾向，不进入负向参数。';
export const EXAMPLE_CONFIG={rules:[
  {id:'medium',scope:'medium',strength:'required',instruction:'采用数字卡通插画表现',when:''},
  {id:'outline',scope:'outline',strength:'default',instruction:'深色粗壮硬描边，具体颜色与粗细随画幅调整',when:''},
  {id:'shading',scope:'shading',strength:'default',instruction:'以有限硬边色阶塑形，层次随体量调整',when:''},
  {id:'crystal-highlights',scope:'highlights',strength:'default',instruction:'允许白色锐利高光和局部柔和发光',when:'任务指定透明或发光物体时'},
  {id:'consistent-language',scope:'medium',strength:'avoid',instruction:'排除同一资产内混杂的绘制语言',negative:['混杂的绘制语言'],when:''}
]};
export const STYLE_BOUNDARY='风格只定义如何绘制：媒介、刻画密度、明暗方式、描边、高光画法、笔触和色彩关系。具体主体、轮廓、比例、结构、部件、姿态、身份色、物理材质、光源位置方向、构图、背景和资产规格属于任务，不能冻结到风格中。刻画密度不删减任务要求的结构或部件；笔触不是物体表面纹理，高光画法不是统一材质。';
export function assertExecutableStyle(plan){
  if(plan.sources?.core&&plan.snapshots?.core?.schemaVersion!==STYLE_SCHEMA_VERSION)
    throw new Error('旧风格计划需派生风格并重新分析采用、重新编译；历史证据仍可只读查看');
}
