# @ai-eks/dsh-docking-layout

English | [中文](README.zh.md)

An independent Web UI plugin for DeepSeek Harness. Docking Layout organizes existing non-blank Sessions as tabs in one to four editor groups. It is maintained under `ai-eks` and is not affiliated with DeepSeek AI.

```text
┌─ Alpha ─┬─ Beta ─────┬─ split → ─┐
│         conversation │            │
│         group 1      │  group 2   │
├──────────────────────┼────────────┤
│         group 3      │  group 4   │
└──────────────────────┴────────────┘
```

The plugin uses only the stock DSH `shell.overlay` and `sidebar.footer.action` slots and does not modify DeepSeek Harness source. Each tab runs a native DSH Web client addressed to one Session in a same-origin iframe. Transcript, composer, approvals, tool presentation, and Session persistence remain owned by DeepSeek Harness.

## Install

Install directly from Git:

```sh
dsh plugin --profile web add github:ai-eks/dsh-docking-layout
```

For a local checkout:

```sh
git clone https://github.com/ai-eks/dsh-docking-layout.git
cd dsh-docking-layout
pnpm install
dsh plugin --profile web add .
```

Remove it with:

```sh
dsh plugin --profile web remove @ai-eks/dsh-docking-layout
```

## Compatibility

The plugin targets DeepSeek Harness `0.1.0-rc.8` and depends only on its public `shell.overlay`, `sidebar.footer.action`, Session list, and `ctx.sessions.open()` APIs. It requires no DSH source changes and does not depend on unpublished `conversation.layout`, multi-Session providers, or `ctx.sessions.watch()` APIs.

It is compatible with `dsh-better-sidebar`: Docking Layout follows the native center conversation column while the outer right and bottom panels remain visible. Changing a Docking Layout tab does not change the outer DSH selection, so it does not swap that plugin's per-Session panel state. Duplicate DSH sidebar and `dsh-better-sidebar` panels inside frames are hidden.

## Behavior

The initial group opens the current Session and one nearby unarchived Session as tabs. Archived Sessions do not appear in groups or the Open menu. Selecting a Session in the DSH sidebar opens or focuses it in the active group. Dragging a tab to another group's center moves it there; dropping it at a left, right, top, or bottom edge creates an adjacent group. Toolbar buttons can split the active tab right or down, close a group, or return to the native single-column layout. While the layout is disabled, its open action stays in the DSH sidebar footer in both expanded and rail modes.

At most four groups are visible, while each group may contain multiple tabs. Closing a tab or group changes browser layout only and never deletes a Host Session. Open frames remain mounted so their native drafts and view state survive tab switches. Internal tab and group focus stays local to Docking Layout; it does not replace the outer DSH navigation selection or per-session state owned by other plugins.

At widths up to 760 pixels, desktop splits collapse into one full-width group and a group switcher. Touch users use the split buttons because native browser tab dragging is desktop-oriented. A newly selected blank Session temporarily uses the native blank conversation screen; after its first message, it becomes eligible for a tab group.

The split tree, tab groups, and enable switch are local browser preferences. The plugin does not copy Session logs, prompts, approvals, or files into its storage. Unloading the plugin closes the embedded DSH clients and releases their connections while leaving all Sessions unchanged.

## Security and lifecycle

The Host half is empty. The plugin opens no route, Host listener, process, or network port. Every open tab creates a same-origin iframe whose URL adds only the `dsh-docking-session` query parameter; it loads no third-party page. The iframe reuses the current DSH authentication state and establishes its own standard DSH Web connection. Embedded clients call `ctx.sessions.open()` only for listed, unarchived Session ids.

Slot registration, locale text, the preference store, frame presentation, and Session-list subscriptions are effect-owned and unwind on plugin disposal or HMR.

## Model Experience

### Docking Layout

#### What the model sees

Nothing. The plugin changes browser layout only and adds no prompts, tools, messages, or Session events.

#### Token effect

None. Each Session keeps its independent model request and transcript.

#### KV Cache effect

None. The plugin does not change model-visible request prefixes.

## Known limitations

- The global details panel and companion plugins remain bound to the DSH navigation selection, not the locally focused Docking Layout tab.
- Every open tab runs a DSH Web client and consumes a separate connection; opening many tabs increases browser memory and connection usage.
- Narrow screens display one selected group at a time instead of simultaneous columns.
- Mouse and trackpad users can drag tabs; touch layouts use buttons and the group switcher.
- Tabs include only non-blank root Sessions, not addressed subagent routes.
- This is an early independent plugin with no stability promise.
