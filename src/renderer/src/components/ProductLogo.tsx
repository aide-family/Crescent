import type { JSX } from 'react'

import crescentLogo from '@renderer/assets/crescent-logo.png'

export function ProductLogo(): JSX.Element {
  return (
    <div
      className="relative flex size-7 items-center justify-center overflow-hidden rounded-md bg-[#0D1117] ring-1 ring-white/10"
      aria-hidden="true"
    >
      <img src={crescentLogo} alt="" width={24} height={24} className="size-6" draggable={false} />
    </div>
  )
}
