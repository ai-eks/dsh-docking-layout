# @ai-eks/dsh-docking-layout

English | [中文](README.zh.md)

A Web UI plugin for DeepSeek Harness. Docking Layout organizes any number of conversation tabs across editor groups that can be split while space allows.

```text
┌─ Alpha ─┬─ Beta ─────┬─ split → ─┐
│         conversation │            │
│         group 1      │  group 2   │
├──────────────────────┼────────────┤
│         group 3      │  group N   │
└──────────────────────┴────────────┘
```

The plugin uses stock DSH client services and the public `shell.overlay` and `sidebar.footer.action` slots; no DeepSeek Harness source changes are required. Sessions are rendered by native DSH Web clients in a bounded pool of same-origin iframes, preserving the original transcript, composer, approvals, tool presentation, and Session persistence.

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

The plugin supports DeepSeek Harness `0.1.0-rc.8` and `0.1.1-rc.2`. It uses the public slot, Session, Workspace, locale, and layout services and does not depend on unpublished `conversation.layout`, multi-Session providers, or `ctx.sessions.watch()` APIs.

It is compatible with `dsh-better-sidebar`: Docking Layout follows the native center conversation column while the outer right and bottom panels remain visible. Changing a Docking Layout tab does not change the outer DSH selection, so it does not swap that plugin's per-Session panel state. Duplicate DSH sidebar and `dsh-better-sidebar` panels inside frames are hidden.

## Behavior

The initial group opens the current conversation and one nearby eligible conversation as tabs. The Open menu groups remaining conversations by Workspace and excludes archived, blank, current, and subagent Sessions. Selecting a supported Session in the DSH sidebar opens or focuses it in the active group; reselecting the unchanged outer Session does the same even if its docked tab was closed. Archived and subagent routes fall back to the native conversation view.

Dragging a tab to another group's center moves it there; dropping it at a left, right, top, or bottom edge creates an adjacent group. Toolbar buttons split the active tab right or down. Tab count and group count have no fixed limit; on desktop, splitting remains available only while both resulting panes can meet the target minimum size of 320×280 pixels. An unavailable edge split is rejected instead of being converted into a tab move. A group collapses automatically after its final tab moves or closes, so no separate Close Group action is needed.

Closing a tab changes browser layout only and never deletes its Session. Closing the final tab creates a blank conversation in the same tabbed layout. Switching Workspace for that blank conversation replaces the tab instead of opening unrelated history. The iframe pool keeps every group's active tab and the two most recently inactive tabs mounted; revisiting an evicted tab reloads its embedded client. Focusing an iframe also makes its group the target for the next sidebar selection.

The enable switch stays in the DSH sidebar footer in both expanded and rail modes. At widths up to 760 pixels, split groups collapse to one full-width active group with a numbered group switcher. This compact layout bypasses the 320×280 split-size guard because only one group is visible at a time. Touch users can switch groups and use the split buttons; native tab dragging remains desktop-oriented.

The split tree, tab groups, and enable switch are local browser preferences. The plugin does not copy Session logs, prompts, approvals, or files into its storage. Unloading the plugin closes the embedded DSH clients and releases their connections while leaving all Sessions unchanged.

## Security and lifecycle

The plugin has no Host-side runtime and opens no route, listener, process, or network port. Each mounted frame-pool entry is a same-origin iframe whose URL adds only the `dsh-docking-session` query parameter; it loads no third-party page. The iframe reuses the current DSH authentication state and establishes its own standard DSH Web connection. Embedded clients call `ctx.sessions.open()` only for Sessions selected by the outer layout.

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

- The global details panel and companion plugins remain bound to the outer DSH navigation selection, not the active Docking Layout tab.
- The iframe pool uses approximately one DSH Web connection per group plus two for recently inactive tabs; adding groups increases browser memory and connection usage.
- Mouse and trackpad users can drag tabs; touch layouts use split buttons and the group switcher.
- Archived Sessions and addressed subagent routes use the native conversation view.
- This is an early independent plugin with no stability promise.
