/**
 * The vessel finish: a fixed glass shell holding three coloured bodies that
 * drift and merge. Output pushes the bodies toward the glass; input lives on
 * the boundary as an outward pulse.
 *
 * WebGL 1 / GLSL ES 1.00 for reach. No textures: the grain is generated here so
 * the component never fetches anything at runtime.
 */

export const VERTEX_SHADER = /* glsl */ `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

export const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform float uTime;    // wall clock, for grain
uniform float uFlow;    // accumulated interior time, accelerated by output level
uniform float uRing;    // accumulated ring phase, advanced by input level
uniform int   uState;   // 0 idle · 1 listening · 2 thinking · 3 speaking
uniform float uDark;    // 0 light field, 1 dark field
uniform float uIn;      // 0-1 microphone level
uniform float uOut;     // body energy: state level + audio, 0-1.5
uniform float uGrain;
uniform float uSeed;
uniform float uDetail;  // 0 at avatar sizes, 1 at hero sizes
uniform vec3  uC1;
uniform vec3  uC2;
uniform vec3  uC3;
uniform vec3  uBody;

// Outer ring: a radial band that rises from uRimInner and fades out from
// uRimFade to the edge of the glass (radius 1).
uniform vec3  uRimColor;
uniform float uRimInner;    // radius where the ring starts to rise
uniform float uRimFade;     // radius where it starts falling back to 0 at the edge
uniform float uRimStrength;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  // Output swells the orb, input contracts it very slightly. Budget is ±2% (P2).
  float grow = 1.0 + 0.020 * min(uOut, 1.0) - 0.008 * uIn;
  vec2 p = (vUv - 0.5) * 2.0 / grow;
  float r = length(p);

  float fl = uFlow + uSeed * 13.77;

  float bulge = sqrt(max(1.0 - min(dot(p, p), 1.0), 0.0));
  vec3 n = vec3(p, bulge);

  float alpha = 1.0 - smoothstep(0.982, 1.0, r);

  // ---- Contents: three bodies that drift and merge --------------------------
  vec3 acc = vec3(0.0);
  float field = 0.0;
  // Contents pressed against the glass read as attention; drawn to the centre
  // they read as idle. Output drives that ratio, which is the whole signal.
  float spread = 0.26 + 0.16 * uOut + 0.04 * sin(fl * 0.3);
  float mass = 0.150 + 0.055 * uOut;

  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float orbit = spread + 0.05 * sin(fl * 0.37 + fi * 1.7);
    vec2 c = vec2(cos(fl * 0.42 + fi * 2.094), sin(fl * 0.35 + fi * 2.094)) * orbit;
    float w = mass / (dot(p - c, p - c) + 0.034);
    vec3 lc = fi < 0.5 ? uC1 : (fi < 1.5 ? uC2 : uC3);
    field += w;
    acc += w * lc;
  }

  vec3 inner = acc / max(field, 0.0001);
  float body = smoothstep(0.80, 2.10, field);
  vec3 col = mix(uBody, inner, body * 0.96);

  // ---- Shell: outer ring, edge sheen, one specular peak ---------------------
  float rim = smoothstep(uRimInner, 0.99, r) * smoothstep(1.0, uRimFade, r);
  col += uRimColor * rim * uRimStrength;
  col += vec3(1.0) * pow(1.0 - bulge, 8.0) * 0.14;

  vec3 L = normalize(vec3(-0.40, 0.60, 0.69));
  col += vec3(1.0) * pow(max(dot(normalize(n), L), 0.0), 46.0) * 0.45;

  // ---- Thinking: an orbiting sweep, distinct in form from either voice (P8) --
  if (uState == 2) {
    float ang = atan(p.y, p.x);
    float sweep = 0.5 + 0.5 * cos(ang - fl * 1.5);
    col += mix(uC2, uC3, 0.5) * pow(sweep, 7.0) * 0.40 * smoothstep(0.05, 0.85, r);
  }

  // ---- Input lives on the boundary, never in the body (P10) -----------------
  if (uIn > 0.004) {
    float pd = fract(r * 1.35 - uRing);
    float pulse = smoothstep(0.0, 0.30, pd) - smoothstep(0.30, 0.62, pd);
    vec3 pc = mix(uC3, vec3(0.42, 0.92, 0.99), 0.35 + 0.3 * uDark);
    col += pc * pulse * uIn * 1.15 * smoothstep(0.10, 0.95, r);
    float rim2 = smoothstep(0.74, 0.995, r) * smoothstep(1.0, 0.90, r);
    col += pc * rim2 * uIn * 1.5;
  }

  // ---- Grain: defeats banding and gives the eye something to resolve (P6) ---
  float g = hash21(vUv * 780.0 + fract(uTime) * 91.0);
  col *= 1.0 - uGrain * uDetail * (g - 0.5) * 2.0;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0) * alpha, alpha);
}
`

export const STATE_INDEX: Record<string, number> = {
  idle: 0,
  listening: 1,
  thinking: 2,
  speaking: 3,
}
