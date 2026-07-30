import type { JSX } from 'react'

import crescentLogo from '@renderer/assets/crescent-logo.svg'

export function ProductLogo(): JSX.Element {
  return (
    <div
      className="relative flex size-9 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-[#0D1117] shadow-sm shadow-cyan-500/10"
      aria-hidden="true"
    >
      <img src={crescentLogo} alt="" className="size-7" draggable={false} />
    </div>
  )
}
