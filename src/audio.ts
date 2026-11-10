export type OrbAudioSource =
  | HTMLMediaElement
  | MediaStream
  | AnalyserNode
  | null
  | undefined

export interface AudioLevelOptions {
  /** Supply your own context to share one across several orbs. */
  audioContext?: AudioContext
  /** Number of low bins averaged. Speech energy lives at the bottom. */
  bins?: number
  /** Divisor applied to the RMS. Lower makes the orb more sensitive. */
  sensitivity?: number
  /** AnalyserNode smoothing. The renderer smooths again over time. */
  smoothing?: number
}

export interface AudioLevel {
  /** Current 0-1 level. Cheap; call it every frame (e.g. as `inputLevel`). */
  read(): number
  /** Detach from the source and close the context if this created it. */
  disconnect(): void
}

/**
 * Framework-free audio meter. Pass `meter.read` straight to the orb:
 *
 * ```js
 * const mic = connectAudioLevel(await navigator.mediaDevices.getUserMedia({ audio: true }))
 * orb.setInputLevel(mic.read)
 * ```
 */
export function connectAudioLevel(source: Exclude<OrbAudioSource, null | undefined>, options: AudioLevelOptions = {}): AudioLevel {
  const { audioContext, bins = 160, sensitivity = 96, smoothing = 0.6 } = options

  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return { read: () => 0, disconnect: () => {} }

  const ctx = audioContext ?? new Ctor()
  const ownsContext = !audioContext

  let analyser: AnalyserNode
  let node: AudioNode | null = null

  if (source instanceof AnalyserNode) {
    analyser = source
  } else {
    analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = smoothing

    if (typeof MediaStream !== "undefined" && source instanceof MediaStream) {
      node = ctx.createMediaStreamSource(source)
    } else {
      node = ctx.createMediaElementSource(source as HTMLMediaElement)
      // A media element source is taken off the default output when tapped,
      // so route it onward or playback goes silent.
      node.connect(ctx.destination)
    }
    node.connect(analyser)
  }

  const buffer = new Uint8Array(analyser.frequencyBinCount)
  const count = Math.min(buffer.length, bins)

  // Browsers start contexts suspended until a gesture; resume on the first one.
  const resume = () => void ctx.resume()
  if (ctx.state === "suspended") {
    window.addEventListener("pointerdown", resume, { once: true })
    window.addEventListener("keydown", resume, { once: true })
  }

  let disconnected = false

  return {
    read() {
      if (disconnected) return 0
      analyser.getByteFrequencyData(buffer)
      let sum = 0
      for (let i = 0; i < count; i++) sum += buffer[i] * buffer[i]
      return Math.min(1, Math.sqrt(sum / count) / sensitivity)
    },
    disconnect() {
      if (disconnected) return
      disconnected = true
      window.removeEventListener("pointerdown", resume)
      window.removeEventListener("keydown", resume)
      try {
        node?.disconnect()
        if (!(source instanceof AnalyserNode)) analyser.disconnect()
      } catch {
        /* already torn down */
      }
      if (ownsContext) void ctx.close()
    },
  }
}
