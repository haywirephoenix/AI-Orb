"use client"

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"

import { DEFAULT_PALETTE, orbPalettes } from "./palettes"
import { OrbRenderer } from "./renderer"
import type {
  LevelSource,
  OrbField,
  OrbFieldColors,
  OrbRim,
  OrbState,
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

  className?: string
  style?: CSSProperties
  /** Announced to assistive tech. Defaults to a description of the state. */
  label?: string
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
  className,
  style,
  label,
}: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<OrbRenderer | null>(null)
  const [fallback, setFallback] = useState(false)

  const field = useResolvedField(fieldProp)
  const reduced = usePrefersReducedMotion()

  const resolved: OrbFieldColors = useMemo(() => {
    const base = (orbPalettes[palette ?? DEFAULT_PALETTE] ?? orbPalettes[DEFAULT_PALETTE])[field]
    return {
      stops: colors ?? base.stops,
      body: bodyColor ?? base.body,
    }
  }, [palette, colors, bodyColor, field])

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
    })
    if (reduced) renderer.renderStill()
  }, [field, resolved, state, grain, seed, speed, reduced, rim])

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
