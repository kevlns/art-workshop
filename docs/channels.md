# 图片与视频通道

`art-workshop` 是同一工具包，`image` 和 `video` 是独立二级通道。宿主可以把它们展示成相邻的“图片工坊”“视频工坊”，两者无需共用一个页面或一套任务状态。

## 调用与兼容

图片命令使用 `art-workshop image ...` 或 `v-cli art image ...`。原有 `art-workshop style ...`、`art-workshop generate ...` 及 `art.*` 结构化能力继续兼容；`art.image-*` 提供明确的图片通道能力。图片对象、计划和运行仍走原来的图片执行链路。

视频命令使用 `art-workshop video ...` 或 `v-cli art video ...`，对应结构化能力为 `art.video-*`。`--workspace` 指向工程绝对根目录。请求 JSON 通过工程内 `--input` 文件传入，不把整份剧本、图片或凭据拼入命令行。具体路径与参数以 [命令参考](commands.md) 为准。

视频通道处理任务、操作、剧本规划、素材、模型设置、运行时观察、成片和精修。读取、校验、规划与保存配置不会启动模型生成；只有显式运行操作才提交生成。运行继续使用原 `requestId`、`runId` 和 `upstreamId`，恢复只查询原队列或原结果。

## SDK 与宿主边界

```js
import { createVideoChannel } from '@kevlns/art-workshop/video';

const channel = createVideoChannel({ root: projectRoot, workspaceId });
try {
  const tasks = await channel.execute('task.list', {});
} finally {
  await channel.dispose();
}
```

SDK 的 `execute / snapshot / media / settingsRevision / dispose` 由同一包内的 VideoService、VideoModels、VideoWorkflow、VideoMedia 和本地运行时实现。宿主注入图片素材来源及覆盖范围；未注入来源时明确报告不可用，不扫描其他宿主的会话或资料。

DSH 负责自己的权限、项目与会话身份、原生附件准入及外层事务。工具包不反向依赖 DSH，不创建应用服务器、聊天会话或审批系统。DSH 的视频入口调用本 SDK，不维护第二份 VideoService 算法。

## 配置、状态与失败

| 内容 | 归属 |
| --- | --- |
| 图片全局默认配置 | `<VANT_HOME 或 ~/.vant>/tools/art-workshop/config.json` |
| 图片项目对象与批次 | 显式绑定的图片 workspace；DSH 通常绑定工程 `.vant/art` |
| 视频模型、工作流与 FFmpeg 配置 | 工程 `.vant/config/video.json` |
| 视频任务、操作、素材与成片 | 工程 `.vant/video`，真源为 `project.json` |
| 视频外层请求、意图与回执 | 工程 `.vant/state/video` |
| 跨进程视频资源锁 | 工程 `.vant/state/locks`，沿用规范路径的 SHA-256 SQLite 身份 |

图片和视频保持各自配置、版本和运行记录。视频设置按旧 revision 校验后保存，目录跳转、路径逃逸和损坏状态明确拒绝，不覆盖为默认值。请求及结果未知时保留原身份与未决索引，不能通过更换操作 ID 或入口再次提交。

视频需要 Node.js 22.13 及以上和可用 SQLite；不足时返回 `video-runtime-unsupported`，不改变图片通道的 Node.js 20.9 兼容范围。DSH 找不到带视频通道的工具包时返回 `video-core-unavailable`，不会回退到另一份内核。

视频队列取消仅删除原排队任务。共享运行中的 ComfyUI 没有安全的通用单任务中断接口时，返回 `video-running-cancel-unavailable`，不调用全局 interrupt。模型请求丢回执、下载损坏或结果写入失败均不能作为重新付费生成的依据。

## 验证边界

协议 fixture、真实 FFmpeg 媒体处理、包安装和 DSH 界面分别验证。fake HTTP 返回的生成结果只证明调用、恢复与产物处理机制，不代表真实 GPU 或远程模型完成生成。未发布的源码与本地开发链接不代表 npm 已更新。
