# @ai-eks/dsh-docking-layout

[English](README.md) | 中文

这是一个独立维护的 DeepSeek Harness Web UI 插件。Docking Layout 把已有且非空的会话组织成一至四个编辑器分组中的标签。项目归属 `ai-eks`，与 DeepSeek AI 没有关联。

```text
┌─ Alpha ─┬─ Beta ─────┬─ 向右拆分 ─┐
│         对话          │             │
│         分组 1        │   分组 2    │
├───────────────────────┼─────────────┤
│         分组 3        │   分组 4    │
└───────────────────────┴─────────────┘
```

插件只使用原版 DSH 已有的 `shell.overlay` 和 `sidebar.footer.action` 插槽，不修改 DeepSeek Harness 源码。每个标签在同源 iframe 中运行一个指定会话的原生 DSH Web 客户端；消息记录、输入框、审批、工具展示与会话持久化仍由 DeepSeek Harness 负责。

## 安装

直接从 Git 安装：

```sh
dsh plugin --profile web add github:ai-eks/dsh-docking-layout
```

安装本地 checkout：

```sh
git clone https://github.com/ai-eks/dsh-docking-layout.git
cd dsh-docking-layout
pnpm install
dsh plugin --profile web add .
```

卸载命令：

```sh
dsh plugin --profile web remove @ai-eks/dsh-docking-layout
```

## 兼容性

插件面向 DeepSeek Harness `0.1.0-rc.8`，只依赖其公开的 `shell.overlay`、`sidebar.footer.action`、会话列表和 `ctx.sessions.open()`。不要求修改 DSH，也不依赖 `conversation.layout`、多会话 Session provider 或 `ctx.sessions.watch()` 等未发布接口。

插件兼容 `dsh-better-sidebar`：停靠布局覆盖范围会跟随原生对话中心列，外层右侧栏和下边栏继续显示；切换停靠标签不会改变外层 DSH 的当前会话，因此不会反复切换该插件按会话保存的面板状态。iframe 内重复加载的 DSH 侧栏和 `dsh-better-sidebar` 面板会被隐藏。

## 行为

初始分组把当前会话和一个相邻的未归档会话作为标签打开。已归档会话不会出现在分组或“打开”菜单中。通过 DSH 侧栏选择会话时，插件会在活动分组中打开或聚焦该会话。把标签拖到另一分组中央会将其移入该组；拖到左、右、上、下边缘会建立相邻分组。工具栏按钮可以把活动标签向右或向下拆分、关闭分组，或者返回原生单栏布局。布局关闭时，打开操作固定显示在 DSH 侧栏底部，并同时适配展开和图标栏模式。

最多同时显示四个分组，每组可以包含多个标签。关闭标签或分组只改变浏览器布局，绝不会删除 Host 会话。所有打开的 iframe 都会保持挂载，因此切换标签后仍保留原生草稿和视图状态。停靠布局内部的标签与分组焦点只在布局内变化，不会替换外层 DSH 的全局导航选择，也不会切换其他插件按会话保存的状态。

宽度不超过 760 像素时，桌面分屏会折叠为一个全宽分组和一条分组切换栏。浏览器原生标签拖拽主要面向桌面输入，因此触屏用户使用拆分按钮。新选择的空白会话会暂时显示原生空白对话界面；发送第一条消息后，它即可加入标签分组。

分屏树、标签分组和启用开关只是当前浏览器的本地偏好。插件不会把会话日志、提示词、审批或文件复制到自己的存储。卸载插件会关闭嵌入的 DSH 客户端并释放其连接，不会修改任何会话。

## 安全与生命周期

Host 端为空。插件不创建路由、Host 监听器、进程或网络端口。每个打开的标签创建一个同源 iframe，地址只增加 `dsh-docking-session` 查询参数，不加载第三方页面；iframe 复用当前 DSH 的认证状态，并建立自己的标准 DSH Web 连接。嵌入客户端只对会话列表中已有且未归档的 ID 调用 `ctx.sessions.open()`。

插槽注册、本地化文本、偏好 store、iframe 外观和会话列表订阅都由 effect 管理，在插件卸载或 HMR 时自动撤销。

## 模型体验

### Docking Layout

#### 模型可见内容

无。插件只改变浏览器布局，不增加提示词、工具、消息或会话事件。

#### Token 影响

无。每个会话继续使用自己独立的模型请求和消息记录。

#### KV Cache 影响

无。插件不改变模型可见的请求前缀。

## 已知限制

- 全局详情面板和其他插件仍跟随 DSH 导航选择，而不是停靠布局中局部聚焦的标签。
- 每个打开的标签运行一个 DSH Web 客户端并占用独立连接；同时打开较多标签会增加浏览器内存和连接数。
- 窄屏一次只显示一个已选分组，不会并排显示多列。
- 鼠标和触控板可以拖动标签；触屏布局使用按钮和分组切换栏。
- 标签只包含非空的根会话，不包含带地址的子 Agent 路由。
- 这是早期独立插件，不承诺稳定性。
