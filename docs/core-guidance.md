# Vant 风格核心职责与问题决策

## 定位

风格核心职责与问题决策，适用于当前随包实现。

## 前置条件

先按包的环境要求准备工程与工具，使用实际配置和命令帮助核对目标。

## 操作流程

风格定义如何绘制。主体轮廓、比例、部件、姿态、身份色、物理材质、光源、构图与资产尺寸由任务决定。

### 最终规范

报告和核心使用 schemaVersion=3，项目与对象存储版本仍为2。recommendation 只含 rules：每条具有稳定 id、scope、strength、instruction、when。

- scope：medium、shading、outline、highlights、brushwork、detail、palette。
- strength：required 必须、default 默认倾向、avoid 避免。
- instruction：300字以内的独立、准确、精炼绘制要求；不能出现本轮、上一版、修改经过等迭代描述。
- when：适用条件，无条件时为空。局部例外与默认倾向可以共存，不强制精确色值、线宽或色阶。

生成提示保留条件与强度。带条件的避免规则不会被展开为全局负面提示。最终核心只使用规则，不把聊天记录、问题解释或证据局限混入生成规范。

### 报告与取舍

summary 概述当前方案，observations 保存分类证据，notes 保存不影响执行的提醒。issues 只表达真正需要用户选择的矛盾，每项有稳定 id、question、reopenReason 与2至5个 options。选项含 id、label、remove 规则ID和 upsert 规则。

style resolve 校验 revision、报告来源和选项，记录 issueId、问题指纹、optionId、用户依据和时间。选择应用于候选规范，不改变原始模型响应；reviewHistory 记录历次选择。覆盖已有决定涉及的规则时，相关已记录决定重新打开，不静默覆盖。采用要求当前来源匹配、所有问题已有有效决定；notes 非空仍可采用。

修改草稿或参考保留报告并标记需复核。复核提供上一版方案和决定；同一证据、问题与选项不变时保留决定，新证据或明确重新打开理由要求重新确认。逐图观察按内容和分类契约缓存，未改变的图不重复请求。



## 结果验证

结合原始错误、结构化结果和实际产物核验；测试与真实平台执行分别记录。

## 参考资料

[使用说明](../README.md)
