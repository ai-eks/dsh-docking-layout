# @ai-eks/dsh-docking-layout

English | [中文](README.zh.md)

A DeepSeek Harness Web UI plugin for organizing unlimited conversation tabs into editor-style groups. Split freely, then close or move tabs whenever a pane becomes too small.

## Preview

![Unlimited conversation tabs](docs/images/unlimited-tabs.png)

| Two groups | Three groups |
| --- | --- |
| ![Two conversation groups](docs/images/two-groups.png) | ![Three conversation groups](docs/images/three-groups.png) |

## Features

- Unlimited tabs and groups, with no fixed pane-size guard.
- Drag a tab to another group to move it, or to an edge to split; toolbar buttons split right or down.
- At widths up to 760 pixels, one full-width group is shown at a time with a group switcher.
- Switching to single-column mode or another main panel hides the docked panes; returning restores the groups.
- Closing a tab changes only the browser layout and never deletes its DSH Session. Closing the final tab opens a blank Session, reusing an existing blank Session when DSH selects one.

## Install

From npm:

```sh
dsh plugin --profile web add @ai-eks/dsh-docking-layout@latest
```

From Git:

```sh
dsh plugin --profile web add github:ai-eks/dsh-docking-layout
```

From a local checkout:

```sh
git clone https://github.com/ai-eks/dsh-docking-layout.git
cd dsh-docking-layout
pnpm install
dsh plugin --profile web add .
```

Remove the plugin with:

```sh
dsh plugin --profile web remove @ai-eks/dsh-docking-layout
```

Enable Docking Layout from the DSH sidebar footer. Open Sessions from the group menu or the DSH sidebar, then drag tabs or use the split buttons to arrange them.

## Performance and limitations

The iframe pool keeps every group's active tab plus the two most recently used inactive tabs mounted. Revisiting an evicted tab reloads its embedded client. The shared preview lazily keeps one additional iframe mounted per workspace visited through its selector, preserving each workspace's native tabs until page reload. More groups therefore use more browser memory and DSH Web connections.

A shared right sidebar keeps native file-preview tabs open independently of Session and group selection. File links from any conversation open in that same sidebar; collapsing it preserves its contents. The Files tab lists every Workspace as an independent root, loaded on expansion, so multiple projects can be browsed together. Session switches leave the file tree and open previews unchanged. File-tree and preview state last for the current page and are reset on reload. The right-sidebar workspace selector explicitly chooses the owner for session-scoped tools such as terminals and Git; changing the active conversation leaves this selection unchanged. Switching the selector restores that workspace's native tabs. Conversation bottom panels remain scoped to their own Session. Archived Sessions and subagent routes use the native conversation view. Touch layouts use split buttons and the group switcher instead of tab dragging.

Only layout preferences are stored locally. The plugin does not copy Session logs, prompts, approvals, or files, and all embedded pages are same-origin. It adds no model-visible prompts, tools, messages, or Session events.

## Compatibility

Requires DeepSeek Harness `^0.1.5-rc.1` and Cordis `^4.0.2`. This version uses the main-panel navigation and layout contracts introduced in DSH 0.1.5. For DSH 0.1.2, use plugin `0.1.2-rc.1`.

Tested with `dsh-better-sidebar@0.19.0`: the shared Files tab retains multiple workspace roots, right-sidebar terminals and Git use the explicitly selected workspace, and the bottom workbench remains available inside each conversation.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```
