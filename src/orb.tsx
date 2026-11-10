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
  /**
   * 0-1 opacity of that body colour. 1 is solid; lower lets the page show
   * through between the coloured bodies. The ring and highlights stay. Default 1.
   */
  bodyOpacity?: number
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

  /**
   * Grows from 0 to full size when it becomes true (including on mount) and
   * shrinks to 0 when it becomes false. Rendering pauses once fully hidden.
   * Default true.
   */
  visible?: boolean
  /** Length of the grow animation in ms; shrinking takes 75% of this. Default 420. */
  transitionMs?: number
}

/** Grow overshoots slightly and settles; shrink accelerates away. */
const EASE_IN = "cubic-bezier(0.34, 1.45, 0.64, 1)"
const EASE_OUT = "cubic-bezier(0.55, 0, 0.75, 0)"

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
  bodyOpacity = 1,
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
  visible = true,
  transitionMs = 420,
}: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<OrbRenderer | null>(null)
  const [fallback, setFallback] = useState(false)

  // `shown` drives the transform. It starts false and flips after a frame so
  // the grow plays on mount too, not just on later toggles.
  const [shown, setShown] = useState(false)
  const visibleRef = useRef(visible)
  visibleRef.current = visible

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
        bodyOpacity,
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
    else if (visibleRef.current) renderer.start()

    const onVisibility = () => {
      if (reduced) return
      if (document.hidden) renderer.stop()
      else if (visibleRef.current) renderer.start()
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
      bodyOpacity,
    })
    if (reduced) renderer.renderStill()
  }, [field, resolved, state, grain, seed, speed, reduced, rim, level, response, loudness, bodyOpacity])

  // Show/hide. Rendering starts before the grow so the first scaled-up frame is
  // live, and stops after the shrink (see onTransitionEnd) to free the GPU.
  const animate = !reduced && transitionMs > 0
  useEffect(() => {
    if (visible) {
      if (!reduced) rendererRef.current?.start()
      if (!animate) {
        setShown(true)
        return
      }
      // Two frames: one to paint scale(0), one to start the transition from it.
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setShown(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    setShown(false)
    if (!animate) rendererRef.current?.stop()
  }, [visible, animate, reduced])

  const onTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== "transform") return
    if (!visibleRef.current) rendererRef.current?.stop()
  }

  const motion: CSSProperties = {
    transform: `scale(${shown ? 1 : 0})`,
    transition: animate
      ? `transform ${shown ? transitionMs : Math.round(transitionMs * 0.75)}ms ${shown ? EASE_IN : EASE_OUT}`
      : "none",
    pointerEvents: visible ? undefined : "none",
  }

  // No WebGL: a static approximation rather than an empty hole.
  if (fallback) {
    return (
      <div
        className={className}
        style={{
          borderRadius: "50%",
          background: `radial-gradient(circle at 34% 30%, ${resolved.stops[2]}, ${resolved.stops[1]} 45%, ${resolved.stops[0]} 100%)`,
          ...style,
          ...motion,
        }}
        role="img"
        aria-label={label ?? STATE_LABEL[state]}
        aria-hidden={visible ? undefined : true}
      />
    )
  }

  return (
    <div
      className={className}
      style={{ position: "relative", borderRadius: "50%", overflow: "hidden", ...style, ...motion }}
      onTransitionEnd={onTransitionEnd}
      role="img"
      aria-label={label ?? STATE_LABEL[state]}
      aria-hidden={visible ? undefined : true}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
        aria-hidden="true"
      />
    </div>
  )
}
