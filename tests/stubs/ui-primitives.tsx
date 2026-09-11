import type { ReactNode } from 'react'

interface IconProps {
  size?: number
}

const Icon = ({ size }: IconProps): ReactNode => <span aria-hidden="true" data-size={size} />

export const IconChevronDownOutline14 = Icon
export const IconChevronRightOutline14 = Icon
export const IconCloseFill14 = Icon
export const IconCloseOutline16 = Icon
export const IconPanelLeftOutline16 = Icon
export const IconRefreshOutline16 = Icon
export const FileTypeIcon = Icon
export const classifyFileType = () => 'file'

export function StateDot({ state, size }: { state: string; size?: number }): ReactNode {
  return <span aria-hidden="true" data-state={state} data-size={size} />
}
