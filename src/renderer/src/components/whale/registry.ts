/** This registry is evaluated only when the Whale surface is opened. */
export interface WhaleMotionAsset {
  id: string
  category: string
  load: () => Promise<string>
}

const modules = import.meta.glob<string>('../../assets/whale-motions/**/*.webm', {
  import: 'default',
  query: '?url'
})

export const whaleMotionAssets: WhaleMotionAsset[] = Object.entries(modules).map(([path, load]) => {
  const parts = path.split('/')
  const category = parts.at(-2) ?? 'other'
  const name = (parts.at(-1) ?? path).replace(/\.webm$/, '')
  return { id: `${category}/${name}`, category, load }
})

export const staticIdleMotion: WhaleMotionAsset = {
  id: 'idle/static',
  category: 'idle',
  load: async () => ''
}
export const idleMotion =
  whaleMotionAssets.find((motion) => motion.id === 'idle/breathing') ?? staticIdleMotion
