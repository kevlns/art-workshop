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
export const EXAMPLE_CONFIG={rules:[
  {id:'medium',scope:'medium',strength:'required',instruction:'采用数字卡通插画表现',when:''},
  {id:'outline',scope:'outline',strength:'default',instruction:'深色粗壮硬描边，具体颜色与粗细随画幅调整',when:''},
  {id:'shading',scope:'shading',strength:'default',instruction:'以有限硬边色阶塑形，层次随体量调整',when:''},
  {id:'crystal-highlights',scope:'highlights',strength:'default',instruction:'允许白色锐利高光和局部柔和发光',when:'任务指定透明或发光物体时'}
]};
export const STYLE_BOUNDARY='风格只定义如何绘制：媒介、刻画密度、明暗方式、描边、高光画法、笔触和色彩关系。具体主体、轮廓、比例、结构、部件、姿态、身份色、物理材质、光源位置方向、构图、背景和资产规格属于任务，不能冻结到风格中。刻画密度不删减任务要求的结构或部件；笔触不是物体表面纹理，高光画法不是统一材质。';
export function assertExecutableStyle(plan){
  if(plan.sources?.core&&plan.snapshots?.core?.schemaVersion!==STYLE_SCHEMA_VERSION)
    throw new Error('旧风格计划需派生风格并重新分析采用、重新编译；历史证据仍可只读查看');
}
