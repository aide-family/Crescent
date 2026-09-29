import type { JSX } from 'react'
import whalePetAvatar from '@renderer/assets/whale-pet-avatar.png'

export function WhalePetPortrait({ className = 'size-6' }: { className?: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 overflow-hidden rounded-full border border-teal-200/50 bg-slate-950 shadow-sm ${className}`}
    >
      <img
        alt=""
        className="size-full object-cover"
        draggable={false}
        src={whalePetAvatar}
      />
    </span>
  )
}
