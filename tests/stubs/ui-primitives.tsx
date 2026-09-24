import type { ReactNode } from 'react'

interface IconProps {
  size?: number
}

const Icon = ({ size }: IconProps): ReactNode => <span aria-hidden="true" data-size={size} />

export const IconChevronDownOutlineMedium = Icon
export const IconChevronRightOutlineMedium = Icon
export const IconCloseFillMedium = Icon
export const IconCloseOutline16 = Icon
export const IconPanelLeftOutline16 = Icon
export const IconRefreshOutlineMedium = Icon
export const FileTypeIcon = Icon
export const classifyFileType = () => 'file'

export function StateDot({ state, size }: { state: string; size?: number }): ReactNode {
  return <span aria-hidden="true" data-state={state} data-size={size} />
}
