/**
 * Plain-JS entry: no React. This is what `npm run build:lib` bundles into
 * `dist/ai-orb.js` (a global `AIOrb`) and `dist/ai-orb.mjs`.
 */

export { createOrb, DEFAULT_STATE_STYLES } from "./core"
export type { OrbConfig, OrbHandle, OrbOptions } from "./core"

export { connectAudioLevel } from "./audio"
export type { AudioLevel, AudioLevelOptions, OrbAudioSource } from "./audio"

export { orbPalettes, DEFAULT_PALETTE } from "./palettes"
export { DEFAULT_RIM, dbToLevel } from "./renderer"

export type {
  LevelSource,
  OrbField,
  OrbLoudness,
  OrbRim,
  OrbState,
  OrbStateStyle,
  OrbStateStyles,
} from "./types"
