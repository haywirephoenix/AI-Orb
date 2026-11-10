import { FRAGMENT_SHADER, STATE_INDEX, VERTEX_SHADER } from "./shader"
import type { OrbField, OrbRendererConfig, OrbRim } from "./types"

const UNIFORMS = [
  "uTime", "uFlow", "uRing", "uState", "uDark", "uIn", "uOut",
  "uGrain", "uSeed", "uDetail", "uC1", "uC2", "uC3", "uBody", "uBodyAlpha",
  "uRimColor", "uRimInner", "uRimFade", "uRimStrength",
] as const

type UniformName = (typeof UNIFORMS)[number]

export interface OrbRendererHooks {
  /** Read once per frame. Returning a ref's `.current` here is the whole point. */
  getInputLevel?: () => number
  getOutputLevel?: () => number
}

const DPR_CAP = 2

/** Highest body energy. Above 1 the bodies push further out; the swell is capped in the shader. */
const MAX_ENERGY = 1.5

const WARNING_COLORS: [string, string, string] = ["#c8141e", "#ff3b30", "#ff8a80"]

/**
 * Meter-style dB to the 0-1 level scale: `floor` dB (default -60) is 0, 0 dB
 * is 1, linear in between.
 */
export function dbToLevel(db: number, floor = -60): number {
  return clamp01((db - floor) / -floor)
}

/** The outer ring as originally tuned. Strength and colour differ per field. */
export const DEFAULT_RIM: Record<OrbField, Required<OrbRim>> = {
  light: { color: "#8cc2f0", inner: 0.72, fade: 0.88, strength: 0.26, inputCap: 1 },
  dark: { color: "#85d6ff", inner: 0.72, fade: 0.88, strength: 0.64, inputCap: 1 },
}

type Rgb = [number, number, number]

const colorCache = new Map<string, Rgb>()

/** parseColor, memoised: it runs per frame now that colours are eased. */
function rgb(input: string): Rgb {
  let c = colorCache.get(input)
  if (!c) {
    c = parseColor(input)
    if (colorCache.size > 256) colorCache.clear()
    colorCache.set(input, c)
  }
  return c
}

/** #rgb, #rrggbb, or anything else the canvas can parse, to linear-ish 0-1 RGB. */
function parseColor(input: string): [number, number, number] {
  const hex = input.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex)
  if (short) {
    return [
      parseInt(short[1] + short[1], 16) / 255,
      parseInt(short[2] + short[2], 16) / 255,
      parseInt(short[3] + short[3], 16) / 255,
    ]
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (long) {
    return [
      parseInt(long[1], 16) / 255,
      parseInt(long[2], 16) / 255,
      parseInt(long[3], 16) / 255,
    ]
  }
  // Anything exotic (oklch, colour names, CSS vars already resolved): let the
  // platform do it. Falls back to mid grey if there is no 2D context.
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas")
    c.width = c.height = 1
    const ctx = c.getContext("2d")
    if (ctx) {
      ctx.fillStyle = "#808080"
      ctx.fillStyle = input
      ctx.fillRect(0, 0, 1, 1)
      const d = ctx.getImageData(0, 0, 1, 1).data
      return [d[0] / 255, d[1] / 255, d[2] / 255]
    }
  }
  return [0.5, 0.5, 0.5]
}

export class OrbRenderer {
  readonly supported: boolean

  private canvas: HTMLCanvasElement
  private gl: WebGLRenderingContext | null = null
  private program: WebGLProgram | null = null
  private loc = {} as Record<UniformName, WebGLUniformLocation | null>

  private config: OrbRendererConfig
  private hooks: OrbRendererHooks

  private raf = 0
  private running = false
  private visible = true
  private lastTs: number | null = null
  private startTs: number | null = null

  private flow = 0
  private ring = 0
  private inLevel = 0
  private outLevel = 0
  private stateLevel = 0
  private warn = 0

  // Colours actually drawn, eased toward the configured target on state change.
  private shown: { c1: Rgb; c2: Rgb; c3: Rgb; body: Rgb } | null = null

  private detail = 1

  private resizeObserver: ResizeObserver | null = null
  private intersectionObserver: IntersectionObserver | null = null

  constructor(
    canvas: HTMLCanvasElement,
    config: OrbRendererConfig,
    hooks: OrbRendererHooks = {},
  ) {
    this.canvas = canvas
    this.config = config
    this.hooks = hooks

    const gl =
      canvas.getContext("webgl", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: true,
      }) ||
      (canvas.getContext("experimental-webgl", {
        alpha: true,
        premultipliedAlpha: true,
      }) as WebGLRenderingContext | null)

    if (!gl) {
      this.supported = false
      return
    }

    this.gl = gl
    this.supported = this.build()
    if (!this.supported) return

    canvas.addEventListener("webglcontextlost", this.onContextLost)
    canvas.addEventListener("webglcontextrestored", this.onContextRestored)
    this.observe()
  }

  private onContextLost = (event: Event) => {
    // Default behaviour is to never fire `restored`; preventing it opts in.
    event.preventDefault()
    this.stop()
  }

  private onContextRestored = () => {
    if (this.build()) this.start()
  }

  private build(): boolean {
    const gl = this.gl!
    const vs = this.compile(gl.VERTEX_SHADER, VERTEX_SHADER)
    const fs = this.compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    if (!vs || !fs) return false

    const program = gl.createProgram()
    if (!program) return false
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("[AI-Orb] link failed:", gl.getProgramInfoLog(program))
      return false
    }

    gl.useProgram(program)
    this.program = program

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    // One oversized triangle covers the viewport with no seam down the middle.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const attr = gl.getAttribLocation(program, "aPos")
    gl.enableVertexAttribArray(attr)
    gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0)

    for (const name of UNIFORMS) {
      this.loc[name] = gl.getUniformLocation(program, name)
    }

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    return true
  }

  private compile(type: number, source: string): WebGLShader | null {
    const gl = this.gl!
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("[AI-Orb] shader compile failed:", gl.getShaderInfoLog(shader))
      return null
    }
    return shader
  }

  private observe() {
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(this.canvas)
    }
    if (typeof IntersectionObserver !== "undefined") {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => {
          this.visible = entries[0].isIntersecting
        },
        { rootMargin: "120px" },
      )
      this.intersectionObserver.observe(this.canvas)
    }
  }

  private resize() {
    const gl = this.gl
    if (!gl) return
    const rect = this.canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    // Detail is a function of CSS size, not device pixels: a 32px avatar on a
    // 3x screen is still a 32px avatar to the eye. Grain, striations and thin
    // filaments below this become dither rather than texture.
    this.detail = Math.min(1, Math.max(0, (Math.min(rect.width, rect.height) - 28) / 68))
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
    const w = Math.round(rect.width * dpr)
    const h = Math.round(rect.height * dpr)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
      gl.viewport(0, 0, w, h)
    }
  }

  /** Merge a partial config. Cheap; safe to call on every React render. */
  update(next: Partial<OrbRendererConfig>) {
    this.config = { ...this.config, ...next }
  }

  setHooks(hooks: OrbRendererHooks) {
    this.hooks = hooks
  }

  start() {
    if (!this.supported || this.running) return
    this.running = true
    this.lastTs = null
    this.startTs = null
    const tick = (ts: number) => {
      if (!this.running) return
      this.frame(ts)
      if (this.config.still) {
        this.running = false
        return
      }
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  stop() {
    this.running = false
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  /** Draw exactly one frame — the poster used for reduced motion. */
  renderStill(atSeconds = 6) {
    if (!this.supported) return
    this.resize()
    // No easing in a still: jump straight to the state's look.
    this.shown = null
    this.ease(1)
    this.stateLevel = this.config.level
    this.draw(atSeconds, atSeconds, 0, 0, this.config.level)
  }

  /** Move the drawn colours a fraction `k` of the way to the configured ones. */
  private ease(k: number) {
    const { stops, body } = this.config.colors
    const target = { c1: rgb(stops[0]), c2: rgb(stops[1]), c3: rgb(stops[2]), body: rgb(body) }
    if (!this.shown) {
      this.shown = {
        c1: [...target.c1], c2: [...target.c2], c3: [...target.c3], body: [...target.body],
      }
      return
    }
    for (const key of ["c1", "c2", "c3", "body"] as const) {
      const s = this.shown[key], t = target[key]
      for (let i = 0; i < 3; i++) s[i] += (t[i] - s[i]) * k
    }
  }

  private frame(ts: number) {
    if (this.startTs === null) {
      this.startTs = ts
      this.lastTs = ts
    }
    const t = (ts - this.startTs) / 1000
    const dt = Math.min((ts - (this.lastTs ?? ts)) / 1000, 0.05)
    this.lastTs = ts

    const rawIn = clamp01(read(this.hooks.getInputLevel))
    const rawOut = clamp01(read(this.hooks.getOutputLevel))

    // Smoothing lives here, not in the consumer: an unsmoothed analyser reads
    // as a jitter, and every caller would otherwise reimplement this.
    const k = Math.min(1, dt * 11)
    this.inLevel += (rawIn - this.inLevel) * k
    this.outLevel += (rawOut - this.outLevel) * k

    // State changes ease over ~0.3s for colour and ~0.4s for level, so a
    // switch reads as a transition rather than a cut.
    this.ease(Math.min(1, dt * 7))
    this.stateLevel += (this.config.level - this.stateLevel) * Math.min(1, dt * 5)

    // The state sets a resting energy; sound adds to it, scaled by the state's
    // response. Either voice counts: the mic while listening, the agent while speaking.
    const amplitude = Math.max(this.inLevel, this.outLevel)
    const energy = Math.min(MAX_ENERGY, this.stateLevel + amplitude * this.config.response)

    // Too loud: ease toward the warning stops while over the threshold.
    const loud = this.config.loudness
    let warnTarget = 0
    if (loud) {
      const soft = Math.max(0.001, loud.softness ?? 0.08)
      warnTarget = clamp01((amplitude - loud.threshold) / soft)
    }
    this.warn += (warnTarget - this.warn) * Math.min(1, dt * 8)

    // Cumulative, so speech accelerates the interior instead of just brightening
    // it — motion gains inertia the way the ElevenLabs shader does.
    this.flow += dt * this.config.speed * (1 + energy * 3.2)
    this.ring += dt * (0.42 + this.inLevel * 0.5)

    if (!this.visible) return
    this.resize()
    this.draw(t, this.flow, this.ring, this.inLevel, energy)
  }

  private draw(time: number, flow: number, ring: number, input: number, output: number) {
    const gl = this.gl
    if (!gl || !this.program) return

    const { state, field, grain, seed } = this.config
    if (!this.shown) this.ease(1)
    let { c1, c2, c3 } = this.shown!
    const body = this.shown!.body
    if (this.warn > 0.001) {
      const w = (this.config.loudness?.colors ?? WARNING_COLORS).map(rgb)
      const k = this.warn
      const mix = (a: Rgb, b: Rgb): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
      c1 = mix(c1, w[0]); c2 = mix(c2, w[1]); c3 = mix(c3, w[2])
    }
    const rim = { ...DEFAULT_RIM[field], ...this.config.rim }
    const rc = rgb(rim.color)

    gl.uniform1f(this.loc.uTime, time)
    gl.uniform1f(this.loc.uFlow, flow)
    gl.uniform1f(this.loc.uRing, ring)
    gl.uniform1i(this.loc.uState, STATE_INDEX[state] ?? 0)
    gl.uniform1f(this.loc.uDark, field === "dark" ? 1 : 0)
    // uIn only drives the boundary (ring pulse and the slight contraction), so
    // capping it here tames the ring without touching the bodies.
    gl.uniform1f(this.loc.uIn, Math.min(input, clamp01(rim.inputCap)))
    gl.uniform1f(this.loc.uOut, output)
    gl.uniform1f(this.loc.uGrain, grain)
    gl.uniform1f(this.loc.uSeed, seed)
    gl.uniform1f(this.loc.uDetail, this.detail)
    gl.uniform3f(this.loc.uC1, c1[0], c1[1], c1[2])
    gl.uniform3f(this.loc.uC2, c2[0], c2[1], c2[2])
    gl.uniform3f(this.loc.uC3, c3[0], c3[1], c3[2])
    gl.uniform3f(this.loc.uBody, body[0], body[1], body[2])
    gl.uniform1f(this.loc.uBodyAlpha, clamp01(this.config.bodyOpacity))
    gl.uniform3f(this.loc.uRimColor, rc[0], rc[1], rc[2])
    gl.uniform1f(this.loc.uRimInner, rim.inner)
    gl.uniform1f(this.loc.uRimFade, rim.fade)
    gl.uniform1f(this.loc.uRimStrength, rim.strength)

    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  destroy() {
    this.stop()
    this.resizeObserver?.disconnect()
    this.intersectionObserver?.disconnect()
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost)
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored)

    // Deliberately not calling WEBGL_lose_context.loseContext(). A canvas hands
    // back the same context object on every getContext call, so killing it here
    // would poison any renderer built on this canvas afterwards — which is
    // exactly what StrictMode's mount/unmount/remount does. Dropping the
    // program and our references is enough; the context goes with the canvas.
    if (this.gl && this.program) this.gl.deleteProgram(this.program)
    this.gl = null
    this.program = null
  }
}

function read(source: (() => number) | undefined): number {
  return typeof source === "function" ? source() : 0
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
}
