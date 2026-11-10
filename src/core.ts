/**
 * The orb without a framework. `createOrb` owns everything the React component
 * used to: palette and per-state resolution, light/dark detection, reduced
 * motion, the show/hide animation and pausing while hidden. `<Orb>` is now a
 * thin wrapper over this, so the plain-JS build and the playground run the
 * same code.
 */

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

/**
 * Every visual setting, as plain data. This is what the playground exports and
 * what a build ships with: no functions, no live values, safe to JSON.
 */
export interface OrbConfig {
  /** Named palette from `orbPalettes`. Defaults to `spectrum`. */
  palette?: string
  /** Three explicit stops. Overrides `palette`. */
  colors?: [string, string, string]
  /** The non-chromatic mass behind the colour. Defaults to the palette's. */
  bodyColor?: string
  /** 0-1 opacity of the body colour between the coloured bodies. Default 1. */
  bodyOpacity?: number
  /** Force a light model. Defaults to following the page. */
  field?: OrbField
  /** 0-1 film grain. */
  grain?: number
  /** Decorrelates orbs shown together. */
  seed?: number
  /** Ambient time multiplier. Audio acceleration is separate. */
  speed?: number
  /** Outer ring position, colour, strength and input cap. */
  rim?: OrbRim
  /** Per-state level, response and colours, merged over `DEFAULT_STATE_STYLES`. */
  states?: OrbStateStyles
  /** Global multiplier on how much sound moves the bodies. Default 1. */
  audioResponse?: number
  /** Fade toward a warning palette above a level. */
  loudness?: OrbLoudness
  /** Grow animation length in ms; shrinking takes 75% of this. Default 420. */
  transitionMs?: number
  /** Width and height in px. Omit to fill the container. */
  size?: number
  /** Announced to assistive tech. Defaults to a description of the state. */
  label?: string
}

/** Config plus the live parts: current state, visibility and level sources. */
export interface OrbOptions extends OrbConfig {
  state?: OrbState
  /** Default true. The orb grows in on creation when visible. */
  visible?: boolean
  /** Microphone level, 0-1: a number, a getter, or a `{ current }` box. */
  inputLevel?: LevelSource
  /** Agent speech level, 0-1. */
  outputLevel?: LevelSource
  /** Class added to the orb element. */
  className?: string
}

export interface OrbHandle {
  /** The orb's own element, appended to the container. */
  readonly element: HTMLDivElement
  readonly state: OrbState
  readonly visible: boolean
  setState(state: OrbState): void
  /** A number to hold, or a getter read every frame. */
  setInputLevel(source: LevelSource): void
  setOutputLevel(source: LevelSource): void
  /** Grow in. Rendering resumes first. */
  show(): void
  /** Shrink out. Rendering pauses once it has finished. */
  hide(): void
  /** Merge new settings. Cheap: no WebGL teardown. */
  update(options: Partial<OrbOptions>): void
  /** Stop, release listeners and remove the element. */
  destroy(): void
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

/** Grow overshoots slightly and settles; shrink accelerates away. */
const EASE_IN = "cubic-bezier(0.34, 1.45, 0.64, 1)"
const EASE_OUT = "cubic-bezier(0.55, 0, 0.75, 0)"

function toGetter(source: LevelSource): () => number {
  if (typeof source === "function") return source
  if (typeof source === "number") return () => source
  if (source && typeof source === "object") return () => source.current ?? 0
  return () => 0
}

function media(query: string): MediaQueryList | null {
  return typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query) : null
}

// addListener for older embedded browsers (some TV Chromium builds).
function listen(q: MediaQueryList | null, fn: () => void): () => void {
  if (!q) return () => {}
  if (q.addEventListener) {
    q.addEventListener("change", fn)
    return () => q.removeEventListener("change", fn)
  }
  q.addListener(fn)
  return () => q.removeListener(fn)
}

function readPageField(darkQuery: MediaQueryList | null): OrbField {
  const root = document.documentElement
  const attr = root.getAttribute("data-theme")
  if (attr === "dark") return "dark"
  if (attr === "light") return "light"
  if (root.classList.contains("dark")) return "dark"
  return darkQuery?.matches ? "dark" : "light"
}

export function createOrb(container: HTMLElement, options: OrbOptions = {}): OrbHandle {
  let opts: OrbOptions = { ...options }
  let state: OrbState = opts.state ?? "idle"
  let visible = opts.visible ?? true
  let input = toGetter(opts.inputLevel)
  let output = toGetter(opts.outputLevel)

  // ---- environment ---------------------------------------------------------
  const darkQuery = media("(prefers-color-scheme: dark)")
  const motionQuery = media("(prefers-reduced-motion: reduce)")
  let pageField = readPageField(darkQuery)
  let reduced = !!motionQuery?.matches

  // ---- DOM -----------------------------------------------------------------
  const element = document.createElement("div")
  element.setAttribute("role", "img")
  const s = element.style
  s.position = "relative"
  s.borderRadius = "50%"
  s.overflow = "hidden"
  s.transform = "scale(0)"
  const canvas = document.createElement("canvas")
  canvas.setAttribute("aria-hidden", "true")
  canvas.style.display = "block"
  canvas.style.width = "100%"
  canvas.style.height = "100%"
  element.appendChild(canvas)
  container.appendChild(element)

  // ---- resolution ----------------------------------------------------------
  const field = (): OrbField => opts.field ?? pageField

  const resolve = () => {
    const style = { ...DEFAULT_STATE_STYLES[state], ...opts.states?.[state] }
    const name = style.palette ?? opts.palette ?? DEFAULT_PALETTE
    const base = (orbPalettes[name] ?? orbPalettes[DEFAULT_PALETTE])[field()]
    // Precedence: state colours, state palette, `colors`, `palette`, default.
    const colors: OrbFieldColors = {
      stops: style.colors ?? (style.palette ? base.stops : (opts.colors ?? base.stops)),
      body: opts.bodyColor ?? base.body,
    }
    return {
      field: field(),
      colors,
      state,
      grain: opts.grain ?? 0.05,
      seed: opts.seed ?? 0,
      speed: opts.speed ?? 1,
      still: reduced,
      rim: opts.rim,
      level: Math.min(1, Math.max(0, style.level ?? 0)),
      response: Math.max(0, (style.response ?? 0) * (opts.audioResponse ?? 1)),
      loudness: opts.loudness,
      bodyOpacity: opts.bodyOpacity ?? 1,
    }
  }

  const renderer = new OrbRenderer(canvas, resolve(), {
    getInputLevel: () => input(),
    getOutputLevel: () => output(),
  })
  const fallback = !renderer.supported
  if (fallback) canvas.remove()

  // ---- applying settings ---------------------------------------------------
  const applyStatic = () => {
    s.width = opts.size ? `${opts.size}px` : "100%"
    s.height = opts.size ? `${opts.size}px` : "100%"
    element.className = opts.className ?? ""
    element.setAttribute("aria-label", opts.label ?? STATE_LABEL[state])
  }

  const apply = () => {
    applyStatic()
    const config = resolve()
    if (fallback) {
      // No WebGL: a static approximation rather than an empty hole.
      const [c1, c2, c3] = config.colors.stops
      s.background = `radial-gradient(circle at 34% 30%, ${c3}, ${c2} 45%, ${c1} 100%)`
      return
    }
    renderer.update(config)
    if (reduced) renderer.renderStill()
  }

  // ---- show / hide ---------------------------------------------------------
  const animates = () => !reduced && (opts.transitionMs ?? 420) > 0
  let raf1 = 0
  let raf2 = 0

  const setScale = (on: boolean) => {
    const ms = opts.transitionMs ?? 420
    s.transition = animates()
      ? `transform ${on ? ms : Math.round(ms * 0.75)}ms ${on ? EASE_IN : EASE_OUT}`
      : "none"
    s.transform = `scale(${on ? 1 : 0})`
  }

  const run = () => {
    if (fallback || reduced || document.hidden) return
    renderer.start()
  }

  const applyVisibility = () => {
    cancelAnimationFrame(raf1)
    cancelAnimationFrame(raf2)
    s.pointerEvents = visible ? "" : "none"
    if (visible) element.removeAttribute("aria-hidden")
    else element.setAttribute("aria-hidden", "true")

    if (visible) {
      run()
      if (!animates()) return setScale(true)
      // Two frames: one to paint scale(0), one to start the transition from it.
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setScale(true))
      })
    } else {
      setScale(false)
      if (!animates()) renderer.stop()
    }
  }

  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target !== element || event.propertyName !== "transform") return
    if (!visible) renderer.stop()
  }
  element.addEventListener("transitionend", onTransitionEnd)

  // ---- environment listeners -----------------------------------------------
  const onField = () => {
    const next = readPageField(darkQuery)
    if (next === pageField) return
    pageField = next
    apply()
  }
  const unlistenDark = listen(darkQuery, onField)
  const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(onField) : null
  observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] })

  const unlistenMotion = listen(motionQuery, () => {
    reduced = !!motionQuery?.matches
    apply()
    if (reduced) renderer.stop()
    else if (visible) run()
  })

  const onDocVisibility = () => {
    if (document.hidden) renderer.stop()
    else if (visible) run()
  }
  document.addEventListener("visibilitychange", onDocVisibility)

  // ---- start ---------------------------------------------------------------
  apply()
  if (reduced && !fallback) renderer.renderStill()
  applyVisibility()

  return {
    element,
    get state() {
      return state
    },
    get visible() {
      return visible
    },
    setState(next) {
      if (next === state) return
      state = next
      apply()
    },
    setInputLevel(source) {
      input = toGetter(source)
    },
    setOutputLevel(source) {
      output = toGetter(source)
    },
    show() {
      if (visible) return
      visible = true
      applyVisibility()
    },
    hide() {
      if (!visible) return
      visible = false
      applyVisibility()
    },
    update(next) {
      if ("inputLevel" in next) input = toGetter(next.inputLevel)
      if ("outputLevel" in next) output = toGetter(next.outputLevel)
      if (next.state) state = next.state
      opts = { ...opts, ...next }
      apply()
      if (next.visible !== undefined && next.visible !== visible) {
        visible = next.visible
        applyVisibility()
      }
    },
    destroy() {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      element.removeEventListener("transitionend", onTransitionEnd)
      document.removeEventListener("visibilitychange", onDocVisibility)
      unlistenDark()
      unlistenMotion()
      observer?.disconnect()
      renderer.destroy()
      element.remove()
    },
  }
}
