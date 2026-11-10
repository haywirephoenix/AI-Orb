"use client"

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"

import { DEFAULT_PALETTE, orbPalettes } from "./palettes"
import { OrbRenderer } from "./renderer"
import type {
  LevelSource,
  OrbField,
  OrbFieldColors,
  OrbLoudness,
  OrbRim,
  OrbState,
  OrbStateStyles,
} from "./types"

export interface OrbProps {
  /** Named palette from `orbPalettes`. Defaults to `spectrum`. */
  palette?: string
  /** Three explicit stops. Overrides `palette`. */
  colors?: [string, string, string]
  /** The non-chromatic mass behind the colour. Defaults to the palette's. */
  bodyColor?: string
  /** Force a light model. Defaults to following the page. */
  field?: OrbField

  state?: OrbState
  /** Agent speech level, 0–1. Drives the body. Ref, getter, or constant. */
  outputLevelRef?: LevelSource
  /** Microphone level, 0–1. Drives the boundary. Ref, getter, or constant. */
  inputLevelRef?: LevelSource

  /** 0–1 film grain. Leave on unless you have a reason (P6). */
  grain?: number
  /** Decorrelates orbs shown together. */
  seed?: number
  /** Ambient time multiplier. Audio acceleration is separate. */
  speed?: number
  /** Outer ring position, colour and strength. Unset fields use the defaults. */
  rim?: OrbRim
  /**
   * Per-state resting level and colours, merged over `DEFAULT_STATE_STYLES`.
   * e.g. `{ listening: { level: 0.3, palette: "iris" } }`.
   */
  states?: OrbStateStyles
  /**
   * Global multiplier on how much sound amplitude moves the bodies. Applied on
   * top of each state's `response`. Default 1.
   */
  audioResponse?: number
  /** Fade toward a warning palette when the level goes over a threshold. */
  loudness?: OrbLoudness

  className?: string
  style?: CSSProperties
  /** Announced to assistive tech. Defaults to a description of the state. */
  label?: string
}

/**
 * Levels and audio response only: every state uses the base palette until
 * `states` says otherwise. Only listening and speaking react to sound.
 */
export const DEFAULT_STATE_STYLES: Record<OrbState, { level: number; response: number }> = {
  idle: { level: 0.22, response: 0 },
  listening: { level: 0.43, response: 1 },
  thinking: { level: 0.55, response: 0 },
  speaking: { level: 0.8, response: 1 },
}

const STATE_LABEL: Record<OrbState, string> = {
  idle: "Assistant idle",
  listening: "Assistant listening",
  thinking: "Assistant thinking",
  speaking: "Assistant speaking",
}

function toGetter(source: LevelSource): () => number {
  if (typeof source === "function") return source
  if (typeof source === "number") return () => source
  if (source && typeof source === "object") return () => source.current ?? 0
  return () => 0
}

type LevelGetters = { input: () => number; output: () => number }

/** Follows the page unless `field` is given. Re-reads on OS and class changes. */
function useResolvedField(explicit?: OrbField): OrbField {
  const [field, setField] = useState<OrbField>(explicit ?? "light")

  useEffect(() => {
    if (explicit) {
      setField(explicit)
      return
    }
    if (typeof window === "undefined") return

    const query = window.matchMedia("(prefers-color-scheme: dark)")
    const read = (): OrbField => {
      const attr = document.documentElement.getAttribute("data-theme")
      if (attr === "dark") return "dark"
      if (attr === "light") return "light"
      if (document.documentElement.classList.contains("dark")) return "dark"
      return query.matches ? "dark" : "light"
    }

    setField(read())
    const onChange = () => setField(read())
    query.addEventListener("change", onChange)

    const observer = new MutationObserver(onChange)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    })

    return () => {
      query.removeEventListener("change", onChange)
      observer.disconnect()
    }
  }, [explicit])

  return field
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined") return
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduced(query.matches)
    const onChange = () => setReduced(query.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])
  return reduced
}

export function Orb({
  palette,
  colors,
  bodyColor,
  field: fieldProp,
  state = "idle",
  outputLevelRef,
  inputLevelRef,
  grain = 0.05,
  seed = 0,
  speed = 1,
  rim,
  states,
  audioResponse = 1,
  loudness,
  className,
  style,
  label,
}: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<OrbRenderer | null>(null)
  const [fallback, setFallback] = useState(false)

  const field = useResolvedField(fieldProp)
  const reduced = usePrefersReducedMotion()

  const stateStyle = { ...DEFAULT_STATE_STYLES[state], ...states?.[state] }
  const level = Math.min(1, Math.max(0, stateStyle.level ?? 0))
  const response = Math.max(0, (stateStyle.response ?? 0) * audioResponse)
  const statePalette = stateStyle.palette
  const stateColors = stateStyle.colors
  const stateColorsKey = stateColors?.join()

  // Precedence: state colours, state palette, `colors`, `palette`, default.
  const resolved: OrbFieldColors = useMemo(() => {
    const name = statePalette ?? palette ?? DEFAULT_PALETTE
    const base = (orbPalettes[name] ?? orbPalettes[DEFAULT_PALETTE])[field]
    return {
      stops: stateColors ?? (statePalette ? base.stops : (colors ?? base.stops)),
      body: bodyColor ?? base.body,
    }
    // stateColors is compared by content so an inline array does not churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette, colors, bodyColor, field, statePalette, stateColorsKey])

  // Kept in a ref so changing the source never re-creates the WebGL context.
  const levels = useRef<LevelGetters>({ input: () => 0, output: () => 0 })
  levels.current.input = toGetter(inputLevelRef)
  levels.current.output = toGetter(outputLevelRef)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new OrbRenderer(
      canvas,
      {
        field,
        colors: resolved,
        state,
        grain,
        seed,
        speed,
        still: reduced,
        rim,
        level,
        response,
        loudness,
      },
      {
        getInputLevel: () => levels.current.input(),
        getOutputLevel: () => levels.current.output(),
      },
    )

    if (!renderer.supported) {
      setFallback(true)
      return
    }

    rendererRef.current = renderer
    if (reduced) renderer.renderStill()
    else renderer.start()

    const onVisibility = () => {
      if (reduced) return
      if (document.hidden) renderer.stop()
      else renderer.start()
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      renderer.destroy()
      rendererRef.current = null
    }
    // Recreated only when the drawing surface's own lifecycle changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced])

  // Everything else is a cheap uniform update, not a teardown.
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    renderer.update({
      field,
      colors: resolved,
      state,
      grain,
      seed,
      speed,
      still: reduced,
      rim,
      level,
      response,
      loudness,
    })
    if (reduced) renderer.renderStill()
  }, [field, resolved, state, grain, seed, speed, reduced, rim, level, response, loudness])

  // No WebGL: a static approximation rather than an empty hole.
  if (fallback) {
    return (
      <div
        className={className}
        style={{
          borderRadius: "50%",
          background: `radial-gradient(circle at 34% 30%, ${resolved.stops[2]}, ${resolved.stops[1]} 45%, ${resolved.stops[0]} 100%)`,
          ...style,
        }}
        role="img"
        aria-label={label ?? STATE_LABEL[state]}
      />
    )
  }

  return (
    <div
      className={className}
      style={{ position: "relative", borderRadius: "50%", overflow: "hidden", ...style }}
      role="img"
      aria-label={label ?? STATE_LABEL[state]}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
        aria-hidden="true"
      />
    </div>
  )
}
