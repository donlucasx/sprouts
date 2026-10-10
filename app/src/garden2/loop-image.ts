import { requireOptionalNativeModule } from 'expo'
import type { ComponentType } from 'react'

/**
 * R581: expo-image plays the idle loops (animated WebP with alpha). It is native: a dev build from before 10-09 lacks it, and importing
 * expo-image there throws, so it is required only when its native module is present. Null = no loops, every plant shows its still.
 */
type LoopImageProps = { source: number; style: object; autoplay?: boolean; contentFit?: 'fill'; cachePolicy?: 'memory'; placeholder?: number; placeholderContentFit?: 'fill'; transition?: number; onLoad?: () => void }
export const LoopImage: ComponentType<LoopImageProps> | null = (() => {
  if (!requireOptionalNativeModule('ExpoImage')) return null
  try {
    return (require('expo-image') as { Image: ComponentType<LoopImageProps> }).Image
  } catch {
    return null
  }
})()
