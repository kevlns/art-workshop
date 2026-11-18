# 美术制作通道

美术工坊提供图片、视频与 Spine 三个页签。三个通道的制作命令可单独运行。

## 调用

- 图片使用 `v-cli art image` 或 `art-workshop image` 管理风格、参考和制作任务。
- 视频使用 `v-cli art video` 或 `art-workshop video`。传入工程根目录和工程内请求文件，按任务身份保存剧本、镜头、运行记录和成片。
- Spine 使用 `v-cli art spine` 或 `art-workshop spine`。`describe` 返回配方，`parts` 从原型生成可配准的部件，`build` 导出骨架与动作索引，`capture` 实绘指定动作并输出 PNG 和对照图。SDK 入口为 `@kevlns/art-workshop/spine` 的 `spineContract` 与 `runSpine(root, action, input)`。

完整选项见[命令参考](commands.md)。

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
