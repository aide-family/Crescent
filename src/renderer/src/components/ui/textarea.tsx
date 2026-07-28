import * as React from 'react'

import { cn } from '@renderer/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-card/70 px-3 py-2 text-base shadow-xs transition-[background-color,color,box-shadow,border-color] outline-none placeholder:text-muted-foreground hover:bg-card focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/20 dark:hover:bg-input/30 dark:aria-invalid:ring-destructive/40',
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
