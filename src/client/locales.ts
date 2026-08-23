/** Simplified Chinese copy for Docking Layout. */
export const zh = {
  'action.open': '打开停靠布局',
  'action.single': '返回单栏模式',
  'action.openSession': '在此分组打开会话',
  'action.openShort': '打开',
  'open.ungrouped': '未分组',
  'action.closeTab': '关闭标签',
  'action.splitRight': '将当前标签拆分到右侧',
  'action.splitDown': '将当前标签拆分到下方',
  'group.label': '会话分组 {index}',
  'group.tabs': '第 {index} 组会话标签',
  'group.actions': '会话分组操作',
  'group.switcher': '切换会话分组',
  'group.switch': '显示第 {index} 组',
  'tab.dragHint': '拖到分组边缘可拆分',
  'empty.title': '至少需要一个已有对话',
  'empty.hint': '先在侧栏创建并发送一条消息，再打开会话工作台。',
} satisfies Record<string, string>

/** Docking Layout dictionary key union. */
export type DockingLayoutKey = keyof typeof zh

/** English copy checked against the Chinese key set. */
export const en = {
  'action.open': 'Open Docking Layout',
  'action.single': 'Return to single column',
  'action.openSession': 'Open a session in this group',
  'action.openShort': 'Open',
  'open.ungrouped': 'Ungrouped',
  'action.closeTab': 'Close tab',
  'action.splitRight': 'Split active tab right',
  'action.splitDown': 'Split active tab down',
  'group.label': 'Session group {index}',
  'group.tabs': 'Session tabs in group {index}',
  'group.actions': 'Session group actions',
  'group.switcher': 'Switch session group',
  'group.switch': 'Show group {index}',
  'tab.dragHint': 'Drag to a group edge to split',
  'empty.title': 'At least one existing conversation is required',
  'empty.hint': 'Create a session in the sidebar and send a message before opening the workbench.',
} satisfies Record<DockingLayoutKey, string>
