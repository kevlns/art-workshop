# Getty AAT 查询契约

## 自动处理顺序

1. 从原始中文描述及作用对象中提炼简短英文专业检索词，优先术语而非整段直译。例如“晕涂法”可检索 sfumato；“版画感、双色、可见刻刀痕”可在同一批次检索 woodcut、linocut 等有依据的候选含义，不直接用 print feeling。术语不确定时保留为候选，不先确定画法。
2. 原文及约束保留在每项 context.original、target 等上下文中；英文词只用于召回，不替换用户原文。一次准备好相关候选，最多 10 项，不向用户逐项确认英译。
3. Vant 调用 art_getty，参数为下文的查询 JSON。宿主从受管工具包定位脚本，使用共享 Python，通过 stdin 传入请求。模型直接使用结构化入口。
4. 用返回的类别、说明、别名与原始上下文校验候选。英文词也可能召回无关概念；中文候选、第一名、serviceScore 或 serviceMatch 均不能代替语义判断。全部不合适时保留原表达，不为了得到命中继续扩词查询。
5. 本次核实完成或失败后继续主任务，不重试、更换路径或新增确认关卡。多候选本身不要求用户确认；真正影响主任务的设计取舍沿用已有交互，不另加 Getty 审批。

## Vant 执行结果

art_getty 的主状态只有 succeeded 或 failed，stop=true 表示本轮查询已结束。同一用户轮次只有一个查询批次，重复调用或改变检索词会复用原结果，不再次执行。新的用户需求可以开始新一轮查询。

- succeeded：适配器完整成功。data.status 为 candidates 或 no_match；零匹配是有效查询结果。
- failed：读取 error.code、stage、message。资源或解释器问题是明确的前置失败；执行、网络、响应或详情错误也属于失败。runnerAttempted 等执行信息区分是否已尝试适配器，不把前置失败说成已经访问 Getty。
- 核心详情（首选名、别名、概念说明）获取失败仍是 failed，data 可保留已取得的候选，不宣称概念说明已核实。层级单独获取，失败不撤销核心详情成功；查看 data.enrichment.hierarchy 的状态和错误。可继续用已取得的定义校验原意，不依赖缺失的层级作结论，也不重试。
- request 保留本批次的英文词与中文上下文。查询失败后不再用 shell、其他词或网页替代本次 Getty 核实；其余清楚内容继续处理。

缺少工具资源时由宿主报 TOOL_RESOURCE_MISSING，缺少共享 Python 报 PYTHON_UNAVAILABLE。宿主仅执行受管工具包内的脚本。

## 适配器入口

`scripts/getty.py` 使用 Python 3.9+ 标准库，接收 JSON 并输出 JSON。宿主负责提供解释器与受管资源。脚本只查询，不修改任务或风格配置。

```sh
python <SKILL_DIR>/scripts/getty.py --input <REQUEST.json>
```

## 输入

`--input` 接收 UTF-8 JSON 文件，省略或为 `-` 时从标准输入读取。一次请求包含 1～10 个查询，每项最多返回 limit 个候选，limit 默认 5、范围 1～10；更多查询分批提交。不截断用户原始美术描述。

```json
{
  "queries": [
    {
      "id": "medium",
      "query": "watercolors",
      "context": {"original": "采用水彩绘制语言", "target": "整体绘制风格"},
      "properties": {}
    }
  ],
  "limit": 5
}
```

`id` 可省略，由脚本生成批次内标识；显式 ID 必须唯一。`query` 原样传递，不自动翻译、改大小写、裁剪空格或扩展同义词。`context.original` 为必填原文，`context.target` 可指定作用对象；context 只回显到结果，不发送 Getty，也不改变上游查询。可选 `properties` 支持 `note`（概念说明）、`broaderExt`（上位概念）、`label`（其他名称），值为非空字符串，参与真实 Getty 查询与缓存键。仅在确有依据时填写，不为提高分数编造属性。

`properties` 是缩小检索范围的属性约束，不是指定返回字段。首选名、别名、说明与层级会自动取回；只想取得概念说明时保持 `properties` 为空，不填写“返回说明”“want scope note”等指令。

## 输出与处理

独立脚本标准输出为单个 UTF-8 JSON 对象，`schema` 固定为 `art-workshop/getty-v1`。正常检索与无匹配退出 0；输入、检索或核心详情获取失败退出 1。层级作为补充信息，失败时保留警告，核心详情成功仍退出 0。Vant 将此协议放在 data 中，并用上文 succeeded/failed 表达整体结果。固定顺序为候选检索、核心详情、层级补充，各最多请求一次；无候选或核心详情失败时不请求层级。总共最多 3 个请求，无重试、拆批或替代路径。

- `status=candidates`、`ok=true`：返回候选及已取回的概念信息，仍需模型根据上下文进行语义校验。
- `status=no_match`、`ok=true`：真实查询成功但没有候选，保留原表达。
- `status=partial`、`ok=false`：候选可用但核心详情请求失败；保留候选、error 和警告，不宣称概念说明已验证。
- `status=error`、`ok=false`：读取 `error.code/message`，本次无法完成查询，不将其解释为零匹配。

每个 query 回显原文查询、context、properties，并返回 `candidates`。每个候选包含真实 `id/uri/label`、上游 `serviceScore/serviceMatch`、`preferredTerms/variantTerms/scopeNotes/hierarchy`。`detailsAvailable` 表示核心详情已验证，`hierarchyAvailable` 单独表示层级已验证；可用且为空与请求失败不同。`enrichment.hierarchy.status` 为 succeeded、failed 或 not_requested；失败时附 error，HTTP 错误含 httpStatus 及最多 4096 字节的上游 details，按外部诊断文本读取。`cache.search/details/hierarchy` 分别记录精确缓存命中。说明及名称按原语言保留，不自动翻译或推断缺失内容。候选按同一查询的 serviceScore 降序排列；该分数不是概率，不跨查询比较，不据此直接自动回填。全部候选都可能不符合原意；多项合理候选交宿主决策入口处理。

## 缓存和边界

默认缓存位于 `<VANT_HOME>/tools/art-workshop/cache/getty`；未设置 VANT_HOME 时为 `~/.vant/tools/art-workshop/cache/getty`。宿主可用 `--cache-dir` 指定已有工程的缓存位置。`--cache-ttl` 为秒，默认 86400，0 禁用缓存；`--refresh` 绕过已有缓存。过期缓存不作为失败回退，缓存写入失败不丢弃真实查询结果。

缓存键包含适配器版本、完整端点、请求方法和全部实际请求参数；仅对象键顺序被固定，查询字符串完整保留。相同关键词但不同属性、limit 均重新检索；不复用语义相似描述的结果。context 不参与上游查询缓存，但每次基于当前 context 重新消歧，不缓存模型的对齐结论。

`--timeout` 设置单次网络请求超时，默认 15 秒、最高 60 秒；失败即返回，不自行循环、更换服务或修改系统网络配置。输入错误、非 JSON 响应、HTTP 错误、网络失败和超时均返回结构化错误。脚本查询 AAT，词语提炼与语义判断由模型完成，配置保存由业务工具执行。

## 数据来源

直接调用 Getty 的 Reconciliation Service，并通过同一服务的扩展接口取回 AAT 首选名称、别名、说明与层级；使用其 HTTP 协议无需 OpenRefine 客户端。数据遵循 ODC-By 1.0，输出保留来源及候选 URI。

- [Getty 数据服务与许可](https://www.getty.edu/research-conservation/tools-databases/vocabularies/data-services/)
- [Getty Reconciliation 服务教程](https://www.getty.edu/research/tools/vocabularies/obtain/getty_vocabularies_openrefine_tutorial.pdf)
