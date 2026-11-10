export { Orb, DEFAULT_STATE_STYLES } from "./orb"
export type { OrbProps } from "./orb"

export { createOrb } from "./core"
export type { OrbConfig, OrbHandle, OrbOptions } from "./core"

export { connectAudioLevel } from "./audio"
export type { AudioLevel, AudioLevelOptions } from "./audio"

export { useOrbAudio } from "./use-orb-audio"
export type { OrbAudioSource, UseOrbAudioOptions } from "./use-orb-audio"

export { orbPalettes, DEFAULT_PALETTE } from "./palettes"
export type { OrbPaletteName } from "./palettes"

export { OrbRenderer, DEFAULT_RIM, dbToLevel } from "./renderer"
export type { OrbRendererHooks } from "./renderer"

export type {
  OrbField,
  OrbFieldColors,
  OrbLoudness,
  OrbPalette,
  OrbRendererConfig,
  OrbRim,
  OrbState,
  OrbStateStyle,
  OrbStateStyles,
} from "./types"
