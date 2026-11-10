import { StrictMode, useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"

import { Orb, useOrbAudio } from "../src"
import type { OrbState } from "../src"
import "./styles.css"

const STATES: OrbState[] = ["idle", "listening", "thinking", "speaking"]
// "ember","moss", "porcelain", "discharge", 
// const PALETTES = [ "iris", "spectrum"]  // restore with the Palette fieldset below

/** A voiced source shaped into syllables, so the orb reacts to a real waveform. */
function useSynthesisedSpeech() {
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const [speaking, setSpeaking] = useState(false)

  const speak = () => {
    if (speaking) return
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = ctxRef.current ?? new Ctor()
    ctxRef.current = ctx
    void ctx.resume()
    setSpeaking(true)

    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = "sawtooth"

    const vib = ctx.createOscillator()
    const vibGain = ctx.createGain()
    vib.frequency.value = 4.6
    vibGain.gain.value = 3.2
    vib.connect(vibGain).connect(osc.frequency)

    const formant = ctx.createBiquadFilter()
    formant.type = "bandpass"
    formant.frequency.value = 780
    formant.Q.value = 3.2

    const tone = ctx.createBiquadFilter()
    tone.type = "lowpass"
    tone.frequency.value = 2400

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.55
    analyserRef.current = analyser

    const out = ctx.createGain()
    out.gain.value = 0.5

    osc.connect(formant).connect(tone).connect(gain)
    gain.connect(analyser)
    gain.connect(out).connect(ctx.destination)

    const syllables: Array<[number, number]> = [
      [0.16, 0.85], [0.13, 0.62], [0.2, 0.95], [0.11, 0.55], [0.17, 0.78],
      [0.26, 0.4],
      [0.14, 0.7], [0.19, 0.92], [0.12, 0.58], [0.22, 0.86], [0.13, 0.64],
      [0.3, 0.3],
      [0.18, 0.8], [0.15, 0.66], [0.24, 0.98], [0.13, 0.52], [0.2, 0.74],
    ]

    let t = now + 0.04
    osc.frequency.setValueAtTime(118, t)

    syllables.forEach(([dur, amp], i) => {
      const pause = amp < 0.45
      const peak = pause ? 0.004 : 0.1 * amp
      gain.gain.linearRampToValueAtTime(peak, t + dur * 0.32)
      gain.gain.linearRampToValueAtTime(peak * 0.72, t + dur * 0.7)
      gain.gain.linearRampToValueAtTime(pause ? 0.0008 : 0.006, t + dur)
      osc.frequency.linearRampToValueAtTime(96 + Math.sin(i * 1.31) * 26 + (pause ? -14 : 0), t + dur)
      formant.frequency.linearRampToValueAtTime(560 + Math.abs(Math.sin(i * 0.9)) * 620, t + dur)
      t += dur
    })

    gain.gain.linearRampToValueAtTime(0.0001, t + 0.22)
    osc.start(now)
    vib.start(now)
    osc.stop(t + 0.4)
    vib.stop(t + 0.4)

    osc.onended = () => {
      setSpeaking(false)
      analyserRef.current = null
    }
  }

  return { speak, speaking, analyserRef }
}

function App() {
  const [palette] = useState("iris") // setPalette: restore with the Palette fieldset
  const [state, setState] = useState<OrbState>("idle")
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  // Holding a level steady is the only way to actually inspect the reaction.
  const [heldOut, setHeldOut] = useState(0)
  const [heldIn, setHeldIn] = useState(0)
  const [heroScale, setHeroScale] = useState(155)//89
  // Outer ring. Starts at the dark-field defaults from DEFAULT_RIM.
  const [rimInner, setRimInner] = useState(0.55)//0.72
  const [rimFade, setRimFade] = useState(0.99)//0.88
  const [rimStrength, setRimStrength] = useState(0.10)//0.64

  const { speak, speaking, analyserRef } = useSynthesisedSpeech()

  // The agent analyser is created per utterance, so bridge it through a ref.
  const outputLevel = useRef(0)
  useEffect(() => {
    let raf = 0
    const buffer = new Uint8Array(256)
    const tick = () => {
      const analyser = analyserRef.current
      if (analyser) {
        analyser.getByteFrequencyData(buffer)
        let sum = 0
        for (let i = 0; i < 160; i++) sum += buffer[i] * buffer[i]
        outputLevel.current = Math.min(1, Math.sqrt(sum / 160) / 96)
      } else {
        outputLevel.current = 0
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [analyserRef])

  const inputLevel = useOrbAudio(micStream)

  useEffect(() => {
    if (speaking) setState("speaking")
    else if (micStream) setState("listening")
    else setState((s) => (s === "speaking" ? "idle" : s))
  }, [speaking, micStream])

  const toggleMic = async () => {
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop())
      setMicStream(null)
      return
    }
    try {
      setMicStream(await navigator.mediaDevices.getUserMedia({ audio: true }))
    } catch {
      /* declined or unavailable */
    }
  }

  return (
    <main>
      <section className="stage">
        <Orb
          palette={palette}
          state={state}
          outputLevelRef={() => Math.max(heldOut, outputLevel.current)}
          inputLevelRef={() => Math.max(heldIn, inputLevel.current)}
          className="orb-hero"
          style={{ width: heroScale, height: heroScale }}
          rim={{ inner: rimInner, fade: rimFade, strength: rimStrength }}
        />
        <p className="readout" data-testid="readout">
          {state} 
          {/* {palette} ·  */}
        </p>
      </section>

      <section className="controls">
        {/* <fieldset>
          <legend>Palette</legend>
          {PALETTES.map((p) => (
            <button key={p} onClick={() => setPalette(p)} aria-pressed={palette === p}>
              {p}
            </button>
          ))}
        </fieldset> */}

        <fieldset>
          <legend>Background</legend>
          <button>Off</button>
          <button>On</button>
        </fieldset>

        <fieldset>
          <legend>State</legend>
          {STATES.map((s) => (
            <button key={s} onClick={() => setState(s)} aria-pressed={state === s}>
              {s}
            </button>
          ))}
        </fieldset>

        <fieldset>
          <legend>Audio</legend>
          <button onClick={speak} disabled={speaking}>
            {speaking ? "speaking…" : "speak a reply"}
          </button>
          <button onClick={toggleMic} aria-pressed={!!micStream}>
            {micStream ? "stop mic" : "use my mic"}
          </button>
        </fieldset>

        <fieldset className="holds">
          <legend>Hold a level</legend>
          <label>
            <span>output {heldOut.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={heldOut}
              data-testid="held-out"
              onChange={(e) => setHeldOut(Number(e.target.value))}
            />
          </label>
          <label>
            <span>input {heldIn.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={0.23}
              step={0.01}
              value={heldIn}
              data-testid="held-in"
              onChange={(e) => setHeldIn(Number(e.target.value))}
            />
          </label>
        </fieldset>

        <fieldset className="holds">
          <legend>Scale</legend>
          <label>
            <span>scale {heroScale}px</span>
            <input
              type="range"
              min={24}
              max={240}
              step={1}
              value={heroScale}
              data-testid="heroScale"
              onChange={(e) => setHeroScale(Number(e.target.value))}
            />
          </label>
        </fieldset>

        <fieldset className="holds">
          <legend>Outer ring</legend>
          {(
            [
              ["inner", rimInner, setRimInner, 0, 1],
              ["fade", rimFade, setRimFade, 0, 1],
              ["strength", rimStrength, setRimStrength, 0, 2],
            ] as const
          ).map(([name, value, set, min, max]) => (
            <label key={name}>
              <span>
                {name} {value.toFixed(2)}
              </span>
              <input
                type="range"
                min={min}
                max={max}
                step={0.01}
                value={value}
                data-testid={`rim-${name}`}
                onChange={(e) => set(Number(e.target.value))}
              />
            </label>
          ))}
        </fieldset>

      </section>

      


    </main>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
