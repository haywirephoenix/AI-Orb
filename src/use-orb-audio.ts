import { useEffect, useRef, type MutableRefObject } from "react"

import { connectAudioLevel, type OrbAudioSource, type AudioLevelOptions } from "./audio"

export type { OrbAudioSource } from "./audio"
export type UseOrbAudioOptions = AudioLevelOptions

/**
 * Turns an audio source into a level ref the render loop can read.
 *
 * It returns a ref rather than state on purpose: a level updates ~60 times a
 * second, and routing that through React would re-render the tree on every
 * frame of every utterance. The orb reads `.current` inside its own loop.
 *
 * ```tsx
 * const agent = useOrbAudio(audioElement)
 * const mic = useOrbAudio(micStream)
 * <Orb outputLevelRef={agent} inputLevelRef={mic} />
 * ```
 */
export function useOrbAudio(
  source: OrbAudioSource,
  options: UseOrbAudioOptions = {},
): MutableRefObject<number> {
  const level = useRef(0)
  const { audioContext, bins, sensitivity, smoothing } = options

  useEffect(() => {
    if (!source) {
      level.current = 0
      return
    }
    const meter = connectAudioLevel(source, { audioContext, bins, sensitivity, smoothing })
    let raf = 0
    const tick = () => {
      level.current = meter.read()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      meter.disconnect()
      level.current = 0
    }
  }, [source, audioContext, bins, sensitivity, smoothing])

  return level
}
