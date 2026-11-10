/** Agent presence states. Each must be distinguishable in a still frame (P8). */
export type OrbState = "idle" | "listening" | "thinking" | "speaking"

/** Which value structure the orb is drawn in. Not a palette — a light model (P4). */
export type OrbField = "light" | "dark"

export interface OrbFieldColors {
  /** Three gradient stops, any CSS colour the canvas can parse. */
  stops: [string, string, string]
  /** The non-chromatic interior ground the coloured bodies sit in. */
  body: string
}

/**
 * A palette declares both fields. Dark mode swaps the whole model, so the two
 * halves are authored independently rather than derived from one another.
 */
export interface OrbPalette {
  light: OrbFieldColors
  dark: OrbFieldColors
}

/**
 * Anything ref-like. Deliberately structural rather than React's `RefObject`,
 * so a plain `{ current }` box works and `useRef` returns of either mutability
 * are accepted. `null` reads as silence.
 */
export type LevelRef = { readonly current: number | null }

/** A level source read once per frame. Never a prop — see P10 and the README. */
export type LevelSource = LevelRef | (() => number) | number | undefined

/**
 * The vessel's outer ring: a radial band that rises from `inner` and fades back
 * to nothing between `fade` and the edge of the glass. Radii are 0 (centre) to
 * 1 (edge). Any field left out uses the default for the current light/dark field.
 */
export interface OrbRim {
  color?: string
  /** Radius where the ring starts to rise. Default 0.72. */
  inner?: number
  /** Radius where it starts fading out toward the edge. Default 0.88. */
  fade?: number
  /** Brightness added at the ring's peak. Default 0.26 light, 0.64 dark. */
  strength?: number
}

export interface OrbRendererConfig {
  field: OrbField
  colors: OrbFieldColors
  state: OrbState
  /** 0–1. Film grain opacity. Defaults on; 0 flattens the orb (P6). */
  grain: number
  /** Decorrelates two orbs on the same screen. */
  seed: number
  /** Multiplies ambient time only. Audio-driven acceleration is separate. */
  speed: number
  /** Render a single frame and stop. */
  still: boolean
  /** Overrides for the outer ring. */
  rim?: OrbRim
}
