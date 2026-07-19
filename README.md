# 梦蝶 Studio

> 入梦为人，醒来成书。

梦蝶 Studio 是梦蝶的默认沉浸式小说客户端，基于 [SillyTavern](https://github.com/SillyTavern/SillyTavern) `1.18.0` 修改。它保留角色卡、World Info、聊天、Swipe、编辑、重试、媒体、主题和扩展生态，并通过隔离的梦蝶 extension 与 server bridge 连接独立的梦蝶 Runtime。

本仓库不是 SillyTavern 官方发行版。所有上游代码、商标和许可证归属继续遵循原项目；梦蝶修改部分同样在 AGPL-3.0 边界内发布。

<p align="center">
  <img src="assets/mengdie-icon.png" alt="梦蝶 Mengdie 品牌图标" width="220">
</p>

## 品牌图标

图标把蝶翼、展开的书页与流动的墨线合成一个符号：蝶翼代表进入人物与世界，书页代表可持续的长篇正史，环绕的线条代表灵感、记忆与创作回环。它表达的是“入梦为人，醒来成书”，而不是普通的蝴蝶装饰。

## 梦蝶增加了什么

- Story、World、Director 三个 Runtime 驱动的创作工作面；
- 从灵感、World Guide、World Bible、opening route 到 Story 的世界先行流程；
- `act`、`speak`、`narrate`、`direct` 四种创作语义；
- SSE 正文流、停止、重试、审批、提交和断线恢复；
- Character Card/CHARX、World Info、聊天和 Swipe 的预览/确认式导入；
- release、session、分享与 player-safe 视图；
- 固定同源 `novel-runtime-bridge`，负责鉴权、路由 allowlist、响应上限和 Runtime 健康检查。

## 权责边界

梦蝶 Studio：

- 不直接访问 PostgreSQL；
- 不持有模型 API key；
- 不调用 MiroFish；
- 不编译最终 Context Pack；
- 不决定哪些状态变化成为正史；
- 不依赖本地聊天记录恢复小说。

PostgreSQL 是唯一事实源，梦蝶 Runtime 是唯一模型编排者和正史写入者。Studio 的消息只是显示缓存。

## 兼容性

`0.1.0 Personal Preview` 必须使用同一 Release 中的梦蝶 Runtime 和 Studio 来源。发布包通过 `SOURCE-MANIFEST.json` 固定本仓库 commit、完整文件集合、大小和 SHA-256；不要把任意上游 checkout 与不同版本 Runtime 混用。

内部标识 `novel-mode`、`novel-runtime-bridge`、`NOVEL_*`、API 路径和事件类型在 v0.1 保持不变，避免破坏跨仓协议。

## 本地开发

要求 Node.js 20+ 与 npm：

```bash
npm ci
npm run test:novel
npm run lint
npm start
```

普通 SillyTavern 模式仍可使用原生 provider。梦蝶模式需要单独运行并配置梦蝶 Runtime；模型调用始终从 Runtime 发出。

## 目录

```text
public/scripts/extensions/novel-mode   梦蝶工作面、状态机和 renderer
plugins/novel-runtime-bridge           server-owned Runtime bridge
novel-tests                            梦蝶纯逻辑与跨边界测试
tests/novel-mode-*.e2e.js              浏览器工作流测试
novel-upstream-baseline.json           固定上游来源与兼容基线
```

## 上游同步

1. 固定并记录上游 SillyTavern commit。
2. 在隔离分支合并或重放上游变化。
3. 运行官方测试、`test:novel`、lint 和梦蝶浏览器测试。
4. 重新生成跨仓合同和 `SOURCE-MANIFEST.json`。
5. 在真实 Runtime/PostgreSQL 环境完成一轮创建、SSE、审批、提交和恢复。

不得把梦蝶逻辑散落进上游聊天存储或模型调用主路径。正式修改应尽量留在 extension、plugin 和最小通用 provider hook 中。

## 上游资源

- SillyTavern：<https://github.com/SillyTavern/SillyTavern>
- 文档：<https://docs.sillytavern.app/>
- 上游许可证：AGPL-3.0
