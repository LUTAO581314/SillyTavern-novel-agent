# 梦蝶 extension

该内置 extension 是梦蝶 Studio 的浏览器侧边界。它只通过固定同源 `novel-runtime-bridge` 与梦蝶 Runtime 通信；浏览器不能选择 Runtime URL、提升角色、提交数据库命令或携带模型凭据。

## 当前能力

- Story、World、Director 三工作面；
- project/branch/chapter/scene/POV/model-profile 绑定；
- inspiration -> World Guide -> World Bible review/lock -> opening -> Story 状态机；
- `act`、`speak`、`narrate` 和 author-only `direct`；
- turn create、SSE、cancel、retry、approval、commit 和 snapshot recovery；
- audience-aware Render Event dispatcher 与安全文本 fallback；
- Character Card/CHARX、World Info、chat、swipe 的预览和确认；
- release/session/share entry，分享 token 只保留在 URL/内存中；
- Context Pack、连续性和召回诊断的作者视图。

## 数据边界

Runtime snapshot 和 PostgreSQL 正史是恢复来源。SillyTavern chat、settings、World Info、localStorage 和向量扩展不能定义小说事实。

World Guide 和导入内容都是不可信提案。World Bible 必须由作者逐项确认并锁定；浏览器不能绕过 Runtime 直接提交 canon。普通 player 只能读取服务器投影后的 public 视图，不能读取作者真相、人物私有记忆、raw branch 或导入审计。

## 维护边界

- `workspace-state.js`：纯世界先行状态机；
- `workspace-client.js`：固定版本 Runtime API client；
- `workspace-actions.js`：用户动作到受控命令；
- `session.js` / `lifecycle.js`：绑定、恢复和可逆挂载；
- renderer/component registry：只接受版本化、allowlisted Render Event。

内部目录名 `novel-mode` 是 v0.1 兼容标识，公开名称为梦蝶。
