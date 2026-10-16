# Vant 远程图片适配与筛选

## 定位

远程图片适配与筛选，适用于当前随包实现。

## 前置条件

先按包的环境要求准备工程与工具，使用实际配置和命令帮助核对目标。

## 字段与示例

型号、能力、参数与支持状态的唯一事实源是工具内部 lib/model-catalog.mjs；lib/model-registry.mjs 提供准确查找和统一资格判断。Vant 展示登记目录，不维护第二份模型清单。

### 已适配范围

| 模型 | 模式 | 总像素范围 | 输入与主要限制 |
| --- | --- | --- | --- |
| Qwen Image 2.0 / Pro | generate、edit | 512²–2048² | 编辑 1–3 图；编辑尺寸 16 对齐；负向词最多 500 字符；正向词官方上限 1300 Token |
| Qwen Image 3.0 / Pro | generate、edit | 512²–2048² | 编辑 1–3 图；负向词最多 500 字符 |
| Wan 2.7 | generate、edit | 768²–2048² | 编辑 1–9 图；比例 1:8–8:1 |
| Wan 2.7 Pro | generate、edit | 无图生成 768²–4096²；带图最高 2048² | 编辑 1–9 图；比例 1:8–8:1 |
| wan2.6-t2i | 仅 generate | 1280²–1440² | 无输入图；比例 1:4–4:1；16 对齐；异步任务 |
| wan2.6-image | 仅 edit | 768²–2048² | 1–4 图；比例 1:4–4:1；16 对齐；不开放流式图文混排 |

准确标识包括 qwen-image-2.0、qwen-image-2.0-pro、qwen-image-3.0、qwen-image-3.0-pro、wan2.7-image、wan2.7-image-pro，以及 2.0-2026-03-03、2.0-pro-2026-03-03/04-22/06-22 快照。快照使用完整 qwen-image- 前缀，不靠前缀通配放行未来型号。

工具共同边界为单边 256–4096、每项 1–4 张、seed 0–2147483647；各模型额外限制取交集。尺寸在计划阶段选择最近合法值，记录请求、实际值和调整原因；设计任务保留设计基准。Token 数由服务端计算，不用字符数冒充。

Wan 2.7 不支持独立负向参数和提示词扩写开关：负向约束明确并入主提示词，合并后最多 5000 字符；显式开启 promptExtend 被拒绝。Wan 2.6 支持负向参数与扩写，主提示词最多 2000 字符、负向词最多 500 字符。不能把 2.7 限制推广到所有万相。

预演与实际执行使用同一规范化请求。组图、框选、调色板和流式混排等未声明能力不自动开放，工具不承诺请求尺寸与服务端输出逐像素一致。

### 仅登记与未知型号

早期 Qwen Image/Max/Plus/Edit、Wan 2.5/2.2/2.1/2.0/V1 和 ImageEdit/Sketch/X-Painting 记录官方来源、支持状态及限制，不套用新型号协议执行。未精确登记的型号拒绝，不因名字相似自动推断支持。

modelCatalog() 返回工具登记，不是账号可用模型列表；resolveModel(api, model) 返回精确支持状态。注册不注入账号目录、不自动启用、不推定权限。

### 统一筛选

modelEligibility 共用于界面与配置保存，按实例启用、目录可用、模型启用、已保存凭据、图片协议、图片输出能力和准确型号支持状态给出原因。只有 ID 的未知元数据可从已适配型号补能力；显式用户能力配置受到尊重，不能因此跳过协议和模型策略。

视觉分析要求图片输入和文字输出，与图片生成筛选分开。具体执行还要校验 generate/edit 模式、输入数量、参数和尺寸；实例能够选中不保证每个任务都合法。

### 协议、渠道与恢复

Token Plan 是订阅渠道，DashScope 是 API 协议。按量与订阅共用适配目录，但始终保留所选实例原地址及密钥，不切换站点，不推定套餐提供同等权限。请求采用 native DashScope 适配器，CLI 只是可选诊断示例。

异步模型保存上游 taskId 后查询；同步模型保存完成 URL 后下载。取消只停止本地等待，恢复仅查询原身份和取回原结果。[生命周期](model-architecture.md) · [异常处理](troubleshooting.md)

登记依据链接：[Qwen 2 生成](https://help.aliyun.com/zh/model-studio/qwen-image-api)、[Qwen 2 编辑](https://help.aliyun.com/zh/model-studio/qwen-image-edit-api)、[Wan 2.7](https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference)、[Wan 2.6 文生图](https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference)、[Wan 2.6 编辑](https://help.aliyun.com/zh/model-studio/wan-image-generation-api-reference)。本文说明当前代码登记范围，不声称远端账号已开通或本轮已真实付费出图。

## 执行边界

字段、路径与权限以当前 schema、运行时校验和明确授权为准；配置有效不等于外部服务已执行成功。

## 结果验证

结合原始错误、结构化结果和实际产物核验；测试与真实平台执行分别记录。

## 参考资料

[使用说明](../README.md)
