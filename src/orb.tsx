"use client"

import { useEffect, useRef, type CSSProperties } from "react"

import { createOrb, type OrbConfig, type OrbHandle } from "./core"
import type { LevelSource, OrbState } from "./types"

export { DEFAULT_STATE_STYLES } from "./core"

export interface OrbProps extends Omit<OrbConfig, "size"> {
  state?: OrbState
  /** Agent speech level, 0–1. Drives the body. Ref, getter, or constant. */
  outputLevelRef?: LevelSource
  /** Microphone level, 0–1. Drives the boundary. Ref, getter, or constant. */
  inputLevelRef?: LevelSource
  /**
   * Grows from 0 to full size when it becomes true (including on mount) and
   * shrinks to 0 when it becomes false. Rendering pauses once fully hidden.
   * Default true.
   */
  visible?: boolean

  /** Sizes the orb: the orb fills this element. */
  className?: string
  style?: CSSProperties
}

/**
 * React wrapper over `createOrb`. The host div takes `className`/`style` (so
 * size the orb there); the orb element inside fills it.
 */
export function Orb({
  state = "idle",
  outputLevelRef,
  inputLevelRef,
  visible = true,
  className,
  style,
  ...config
}: OrbProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<OrbHandle | null>(null)

  // Level sources change identity every render; read them through a ref so the
  // orb's per-frame getter always sees the latest without re-wiring.
  const levels = useRef({ input: inputLevelRef, output: outputLevelRef })
  levels.current = { input: inputLevelRef, output: outputLevelRef }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const read = (source: LevelSource): number => {
      if (typeof source === "function") return source()
      if (typeof source === "number") return source
      if (source && typeof source === "object") return source.current ?? 0
      return 0
    }
    const handle = createOrb(host, {
      ...config,
      state,
      visible,
      inputLevel: () => read(levels.current.input),
      outputLevel: () => read(levels.current.output),
    })
    handleRef.current = handle
    return () => {
      handle.destroy()
      handleRef.current = null
    }
    // Created once; everything after is `update`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cheap: uniform updates only. Runs every render so inline objects just work.
  useEffect(() => {
    handleRef.current?.update({ ...config, state, visible })
  })

  return <div ref={hostRef} className={className} style={{ position: "relative", ...style }} />
}
