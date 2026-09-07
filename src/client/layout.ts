/** Immutable editor-group operations for the browser-only Session layout. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Edge or center target used by tab drag-and-drop. */
export type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom'

/** One editor group with a visible active Session tab. */
export interface SessionTabGroup {
  readonly kind: 'group'
  readonly id: string
  readonly tabs: readonly SessionId[]
  readonly active: SessionId
}

/** A recursive horizontal or vertical division of editor groups. */
export interface SessionSplit {
  readonly kind: 'split'
  readonly axis: 'horizontal' | 'vertical'
  readonly first: SessionLayoutNode
  readonly second: SessionLayoutNode
}

/** Persisted editor-group tree. */
export type SessionLayoutNode = SessionTabGroup | SessionSplit

/** Result of an operation that may allocate a group id. */
export interface SessionLayoutResult {
  readonly layout: SessionLayoutNode | undefined
  readonly activeGroupId: string | undefined
  readonly nextGroup: number
}

const groupId = (value: number): string => `group-${value}`
const INITIAL_TAB_COUNT = 2

function hasItems<T>(values: T[]): values is [T, ...T[]] {
  return values.length > 0
}

/**
 * Return editor groups in visual tree order.
 * @param layout - current editor-group tree.
 * @returns leaf groups from first to second.
 */
export function collectGroups(layout: SessionLayoutNode | undefined): SessionTabGroup[] {
  if (layout === undefined) return []
  if (layout.kind === 'group') return [layout]
  return [...collectGroups(layout.first), ...collectGroups(layout.second)]
}

/**
 * Return unique open Session ids in visual tab order.
 * @param layout - current editor-group tree.
 * @returns all tabs from each leaf group.
 */
export function collectSessionIds(layout: SessionLayoutNode | undefined): SessionId[] {
  return collectGroups(layout).flatMap(group => [...group.tabs])
}

/**
 * Compare two editor-group trees structurally.
 * @param left - first tree.
 * @param right - second tree.
 * @returns whether both trees carry the same groups, tabs, and split axes.
 */
export function sameLayout(
  left: SessionLayoutNode | undefined,
  right: SessionLayoutNode | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right
  if (left.kind !== right.kind) return false
  if (left.kind === 'split' && right.kind === 'split') {
    return left.axis === right.axis
      && sameLayout(left.first, right.first)
      && sameLayout(left.second, right.second)
  }
  if (left.kind === 'group' && right.kind === 'group') {
    return left.id === right.id
      && left.active === right.active
      && left.tabs.length === right.tabs.length
      && left.tabs.every((id, index) => id === right.tabs[index])
  }
  return false
}

function findGroup(layout: SessionLayoutNode | undefined, id: string): SessionTabGroup | undefined {
  return collectGroups(layout).find(group => group.id === id)
}

function findSessionGroup(
  layout: SessionLayoutNode | undefined,
  sessionId: SessionId,
): SessionTabGroup | undefined {
  return collectGroups(layout).find(group => group.tabs.includes(sessionId))
}

function updateGroup(
  layout: SessionLayoutNode,
  id: string,
  update: (group: SessionTabGroup) => SessionLayoutNode,
): SessionLayoutNode {
  if (layout.kind === 'group') return layout.id === id ? update(layout) : layout
  return {
    ...layout,
    first: updateGroup(layout.first, id, update),
    second: updateGroup(layout.second, id, update),
  }
}

/** Replace one open Session id without changing its tab or group position. */
export function replaceTab(
  layout: SessionLayoutNode | undefined,
  previous: SessionId,
  next: SessionId,
): SessionLayoutNode | undefined {
  if (layout === undefined) return undefined
  if (layout.kind === 'split') {
    return {
      ...layout,
      first: replaceTab(layout.first, previous, next)!,
      second: replaceTab(layout.second, previous, next)!,
    }
  }
  if (!layout.tabs.includes(previous)) return layout
  return {
    ...layout,
    tabs: layout.tabs.map(id => id === previous ? next : id),
    active: layout.active === previous ? next : layout.active,
  }
}

function removeGroup(layout: SessionLayoutNode, id: string): SessionLayoutNode | undefined {
  if (layout.kind === 'group') return layout.id === id ? undefined : layout
  const first = removeGroup(layout.first, id)
  const second = removeGroup(layout.second, id)
  if (first === undefined) return second
  if (second === undefined) return first
  return { ...layout, first, second }
}

function removeTab(
  layout: SessionLayoutNode,
  groupIdValue: string,
  sessionId: SessionId,
): SessionLayoutNode | undefined {
  const group = findGroup(layout, groupIdValue)
  if (group === undefined || !group.tabs.includes(sessionId)) return layout
  const index = group.tabs.indexOf(sessionId)
  const tabs = group.tabs.filter(id => id !== sessionId)
  if (!hasItems(tabs)) return removeGroup(layout, groupIdValue)
  const active = group.active === sessionId
    ? tabs[Math.min(index, tabs.length - 1)] ?? tabs[0]
    : group.active
  return updateGroup(layout, groupIdValue, current => ({ ...current, tabs, active }))
}

function makeSplit(
  existing: SessionLayoutNode,
  added: SessionLayoutNode,
  zone: Exclude<DropZone, 'center'>,
): SessionSplit {
  const axis = zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical'
  const addedFirst = zone === 'left' || zone === 'top'
  return {
    kind: 'split',
    axis,
    first: addedFirst ? added : existing,
    second: addedFirst ? existing : added,
  }
}

function setActiveTab(
  layout: SessionLayoutNode,
  groupIdValue: string,
  sessionId: SessionId,
): SessionLayoutNode {
  return updateGroup(layout, groupIdValue, group => (
    group.tabs.includes(sessionId) ? { ...group, active: sessionId } : group
  ))
}

/**
 * Reconcile persisted tabs with live non-blank Sessions and global navigation.
 * @param layout - persisted editor-group tree.
 * @param eligible - live selectable Session ids in sidebar order.
 * @param current - current global navigation Session.
 * @param activeGroupId - last focused editor group.
 * @param nextGroup - next persisted group number.
 * @param followCurrent - whether a changed external navigation selection takes focus.
 * @returns a live tree in which each Session appears in at most one group.
 */
export function reconcileSessionLayout(
  layout: SessionLayoutNode | undefined,
  eligible: readonly SessionId[],
  current: SessionId | undefined,
  activeGroupId: string | undefined,
  nextGroup: number,
  followCurrent = true,
): SessionLayoutResult {
  const allowed = new Set(eligible)
  const seen = new Set<SessionId>()
  const prune = (node: SessionLayoutNode): SessionLayoutNode | undefined => {
    if (node.kind === 'group') {
      const tabs = node.tabs.filter((id) => {
        if (!allowed.has(id) || seen.has(id)) return false
        seen.add(id)
        return true
      })
      if (!hasItems(tabs)) return undefined
      const active = tabs.includes(node.active) ? node.active : tabs[0]
      return { ...node, tabs, active }
    }
    const first = prune(node.first)
    const second = prune(node.second)
    if (first === undefined) return second
    if (second === undefined) return first
    return { ...node, first, second }
  }

  let reconciled = layout === undefined ? undefined : prune(layout)
  let next = nextGroup
  const firstEligible = eligible[0]
  if (reconciled === undefined && firstEligible !== undefined) {
    const id = groupId(next++)
    const tabs = eligible.slice(0, INITIAL_TAB_COUNT)
    if (current !== undefined && allowed.has(current) && !tabs.includes(current)) {
      tabs[tabs.length - 1] = current
    }
    reconciled = {
      kind: 'group',
      id,
      tabs,
      active: current !== undefined && allowed.has(current) ? current : firstEligible,
    }
    return { layout: reconciled, activeGroupId: id, nextGroup: next }
  }
  if (reconciled === undefined) {
    return { layout: undefined, activeGroupId: undefined, nextGroup: next }
  }

  const firstGroup = collectGroups(reconciled)[0]
  if (firstGroup === undefined) {
    return { layout: undefined, activeGroupId: undefined, nextGroup: next }
  }
  let activeId = findGroup(reconciled, activeGroupId ?? '')?.id ?? firstGroup.id
  if (followCurrent && current !== undefined && allowed.has(current)) {
    const owner = findSessionGroup(reconciled, current)
    if (owner === undefined) {
      reconciled = updateGroup(reconciled, activeId, group => ({
        ...group,
        tabs: [...group.tabs, current],
        active: current,
      }))
    } else {
      activeId = owner.id
      reconciled = setActiveTab(reconciled, owner.id, current)
    }
  }
  return { layout: reconciled, activeGroupId: activeId, nextGroup: next }
}

/**
 * Activate one tab already owned by a group.
 * @param layout - current tree.
 * @param groupIdValue - target group.
 * @param sessionId - target Session tab.
 * @param nextGroup - next persisted group number.
 * @returns the updated tree and focus owner.
 */
export function activateTab(
  layout: SessionLayoutNode,
  groupIdValue: string,
  sessionId: SessionId,
  nextGroup: number,
): SessionLayoutResult {
  return {
    layout: setActiveTab(layout, groupIdValue, sessionId),
    activeGroupId: groupIdValue,
    nextGroup,
  }
}

/**
 * Open or focus a Session tab in one group.
 * @param layout - current tree.
 * @param groupIdValue - target group.
 * @param sessionId - Session to open.
 * @param nextGroup - next persisted group number.
 * @returns the updated tree and focus owner.
 */
export function openTab(
  layout: SessionLayoutNode,
  groupIdValue: string,
  sessionId: SessionId,
  nextGroup: number,
): SessionLayoutResult {
  const owner = findSessionGroup(layout, sessionId)
  if (owner !== undefined) return activateTab(layout, owner.id, sessionId, nextGroup)
  return {
    layout: updateGroup(layout, groupIdValue, group => ({
      ...group,
      tabs: [...group.tabs, sessionId],
      active: sessionId,
    })),
    activeGroupId: groupIdValue,
    nextGroup,
  }
}

/**
 * Close one browser tab without deleting its Host Session.
 * @param layout - current tree.
 * @param groupIdValue - owning group.
 * @param sessionId - Session tab to close.
 * @param activeGroupId - currently focused group to preserve when it survives.
 * @param nextGroup - next persisted group number.
 * @returns the collapsed tree and its next focus owner.
 */
export function closeTab(
  layout: SessionLayoutNode,
  groupIdValue: string,
  sessionId: SessionId,
  activeGroupId: string | undefined,
  nextGroup: number,
): SessionLayoutResult {
  const updated = removeTab(layout, groupIdValue, sessionId)
  const groups = collectGroups(updated)
  const active = findGroup(updated, activeGroupId ?? groupIdValue)?.id ?? groups[0]?.id
  return { layout: updated, activeGroupId: active, nextGroup }
}

/**
 * Move the active tab into a new adjacent editor group.
 * @param layout - current tree.
 * @param groupIdValue - source group.
 * @param sessionId - tab to split out.
 * @param zone - requested edge.
 * @param nextGroup - next persisted group number.
 * @returns the split tree, or the unchanged tree when splitting is unavailable.
 */
export function splitTab(
  layout: SessionLayoutNode,
  groupIdValue: string,
  sessionId: SessionId,
  zone: Exclude<DropZone, 'center'>,
  nextGroup: number,
): SessionLayoutResult {
  const source = findGroup(layout, groupIdValue)
  if (
    source === undefined
    || source.tabs.length <= 1
    || !source.tabs.includes(sessionId)
  ) {
    return { layout, activeGroupId: groupIdValue, nextGroup }
  }
  const index = source.tabs.indexOf(sessionId)
  const tabs = source.tabs.filter(id => id !== sessionId)
  if (!hasItems(tabs)) return { layout, activeGroupId: groupIdValue, nextGroup }
  const remaining: SessionTabGroup = {
    ...source,
    tabs,
    active: source.active === sessionId
      ? tabs[Math.min(index, tabs.length - 1)] ?? tabs[0]
      : source.active,
  }
  const id = groupId(nextGroup)
  const added: SessionTabGroup = { kind: 'group', id, tabs: [sessionId], active: sessionId }
  return {
    layout: updateGroup(layout, groupIdValue, () => makeSplit(remaining, added, zone)),
    activeGroupId: id,
    nextGroup: nextGroup + 1,
  }
}

/**
 * Move a dragged tab into another group or split it at a target edge.
 * @param layout - current tree.
 * @param sourceGroupId - drag source group.
 * @param sessionId - dragged Session tab.
 * @param targetGroupId - drop target group.
 * @param zone - center move or edge split.
 * @param nextGroup - next persisted group number.
 * @returns the moved tree and resulting focus owner.
 */
export function moveTab(
  layout: SessionLayoutNode,
  sourceGroupId: string,
  sessionId: SessionId,
  targetGroupId: string,
  zone: DropZone,
  nextGroup: number,
): SessionLayoutResult {
  const source = findGroup(layout, sourceGroupId)
  const target = findGroup(layout, targetGroupId)
  if (source === undefined || target === undefined || !source.tabs.includes(sessionId)) {
    return { layout, activeGroupId: sourceGroupId, nextGroup }
  }
  if (sourceGroupId === targetGroupId) {
    return zone === 'center'
      ? activateTab(layout, sourceGroupId, sessionId, nextGroup)
      : splitTab(layout, sourceGroupId, sessionId, zone, nextGroup)
  }

  const removed = removeTab(layout, sourceGroupId, sessionId)
  if (removed === undefined || findGroup(removed, targetGroupId) === undefined) {
    return { layout, activeGroupId: sourceGroupId, nextGroup }
  }
  if (zone === 'center') return openTab(removed, targetGroupId, sessionId, nextGroup)

  const id = groupId(nextGroup)
  const added: SessionTabGroup = { kind: 'group', id, tabs: [sessionId], active: sessionId }
  return {
    layout: updateGroup(removed, targetGroupId, group => makeSplit(group, added, zone)),
    activeGroupId: id,
    nextGroup: nextGroup + 1,
  }
}

const DROP_EDGE_FRACTION = 0.24

/**
 * Resolve the nearest edge drop zone, leaving the center as a move target.
 * @param clientX - pointer viewport x-coordinate.
 * @param clientY - pointer viewport y-coordinate.
 * @param rect - target group bounds.
 * @returns the center or nearest eligible edge.
 */
export function resolveDropZone(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): DropZone {
  if (rect.width <= 0 || rect.height <= 0) return 'center'
  const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
  const edges = [
    ['left', x],
    ['right', 1 - x],
    ['top', y],
    ['bottom', 1 - y],
  ] as const
  const nearest = edges.reduce((best, candidate) => candidate[1] < best[1] ? candidate : best)
  return nearest[1] < DROP_EDGE_FRACTION ? nearest[0] : 'center'
}
