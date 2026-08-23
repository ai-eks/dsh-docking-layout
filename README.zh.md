# @ai-eks/dsh-docking-layout

[English](README.md) | 中文

这是一个 DeepSeek Harness Web UI 插件，用编辑器式分组组织不限数量的对话 Tab。空间足够时可以继续拆分；窗格过小时会禁用拆分。

## 截图

![不限数量的对话 Tab](docs/images/unlimited-tabs.png)

| 双窗格 | 空间感知三窗格 |
| --- | --- |
| ![双对话分组](docs/images/two-groups.png) | ![空间感知三分组布局](docs/images/space-aware-grid.png) |

## 功能

- Tab 和分组数量不限，Tab 可以在分组之间移动。
- 把 Tab 拖到另一分组可直接移动，拖到边缘可拆分；工具栏支持向右或向下拆分。
- 桌面端只有拆分后两个窗格都能保持至少 320×280 像素时，才允许继续拆分。
- 宽度不超过 760 像素时，一次显示一个全宽分组，并通过分组切换栏导航。
- 关闭 Tab 只改变浏览器布局，不会删除对应的 DSH Session。

## 安装

从 Git 安装：

```sh
dsh plugin --profile web add github:ai-eks/dsh-docking-layout
```

从本地 checkout 安装：

```sh
git clone https://github.com/ai-eks/dsh-docking-layout.git
cd dsh-docking-layout
pnpm install
dsh plugin --profile web add .
```

卸载插件：

```sh
dsh plugin --profile web remove @ai-eks/dsh-docking-layout
```

在 DSH 侧栏底部启用 Docking Layout。通过分组菜单或 DSH 侧栏打开 Session，再拖动 Tab 或使用拆分按钮调整布局。

## 性能与限制

iframe 池会保留每个分组的活动 Tab，以及最近使用的 2 个非活动 Tab；被淘汰的 Tab 再次打开时会重新加载。分组越多，浏览器内存和 DSH Web 连接数越高。

全局详情面板和伴随插件仍跟随外层 DSH Session。已归档 Session 和子 Agent 路由使用原生对话视图；触屏布局使用拆分按钮和分组切换栏，不依赖 Tab 拖拽。

插件只在浏览器本地保存布局偏好，不复制 Session 日志、提示词、审批或文件；所有嵌入页面均为同源页面。插件不会增加模型可见的提示词、工具、消息或 Session 事件。

## 兼容性

支持 DeepSeek Harness `0.1.0-rc.8` 和 `0.1.1-rc.2`，并兼容 `dsh-better-sidebar`。

## 开发验证

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```
