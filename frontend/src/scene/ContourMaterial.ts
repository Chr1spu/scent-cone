/**
 * Terrain shader: elevation ramp + soft hillshade + anti-aliased contour lines, with draped
 * overlays (land cover, probability, scent heat, alert zones) sampled from data textures
 * in world space, so every layer is drawn on the actual terrain surface.
 */
import * as THREE from 'three';
import { LANDCOVER_CLASSES } from '../config/constants';

const vert = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const lcColors = (() => {
  const arr: string[] = [];
  for (let i = 0; i < 8; i++) {
    const c = LANDCOVER_CLASSES.find((k) => k.id === i);
    const col = new THREE.Color(c ? c.color : '#000000');
    arr.push(`vec3(${col.r.toFixed(3)}, ${col.g.toFixed(3)}, ${col.b.toFixed(3)})`);
  }
  return arr;
})();

const frag = /* glsl */ `
uniform float uExag;
uniform float uMin;
uniform float uMax;
uniform float uInterval;
uniform vec3 uLight;
uniform vec4 uBounds;      // minX, minZ, width, height (scene units) of the overlay grid
uniform vec4 uHole;        // minX, minZ, maxX, maxZ : discard inside (overview under detail)
uniform float uHoleOn;
uniform vec4 uFocus;       // focus segment outline rect
uniform float uFocusOn;
uniform vec4 uPreview;     // focus preview rect (live mode)
uniform float uPreviewOn;
uniform sampler2D uLC;
uniform float uLCOn;
uniform sampler2D uProb;
uniform float uProbOn;
uniform sampler2D uHeat;
uniform float uHeatOn;
uniform sampler2D uZones;
uniform float uZonesOn;
uniform float uContoursOn;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uDim;
uniform vec3 uZoneColors[4];
varying vec3 vWorld;
varying vec3 vNormal;

vec3 lcColor(int k) {
  ${lcColors.map((c, i) => `if (k == ${i}) return ${c};`).join('\n  ')}
  return vec3(0.0);
}

vec3 ramp(float t) {
  vec3 c0 = vec3(0.078, 0.122, 0.133);
  vec3 c1 = vec3(0.137, 0.208, 0.192);
  vec3 c2 = vec3(0.263, 0.318, 0.255);
  vec3 c3 = vec3(0.459, 0.447, 0.357);
  vec3 c4 = vec3(0.741, 0.725, 0.659);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.5) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.78) return mix(c2, c3, (t - 0.5) / 0.28);
  return mix(c3, c4, (t - 0.78) / 0.22);
}

// inferno-like perceptual ramp
vec3 heatRamp(float t) {
  vec3 a = vec3(0.10, 0.03, 0.20);
  vec3 b = vec3(0.55, 0.10, 0.42);
  vec3 c = vec3(0.93, 0.35, 0.16);
  vec3 d = vec3(1.00, 0.75, 0.25);
  vec3 e = vec3(1.00, 0.97, 0.75);
  if (t < 0.25) return mix(a, b, t / 0.25);
  if (t < 0.5) return mix(b, c, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c, d, (t - 0.5) / 0.25);
  return mix(d, e, (t - 0.75) / 0.25);
}

float rectLine(vec4 r, vec2 p, float w) {
  float dx = min(abs(p.x - r.x), abs(p.x - r.z));
  float dz = min(abs(p.y - r.y), abs(p.y - r.w));
  bool inX = p.x > r.x - w && p.x < r.z + w;
  bool inZ = p.y > r.y - w && p.y < r.w + w;
  float l = 0.0;
  if (inZ && dx < w) l = 1.0 - dx / w;
  if (inX && dz < w) l = max(l, 1.0 - dz / w);
  return l;
}

void main() {
  vec2 p = vWorld.xz;
  if (uHoleOn > 0.5 && p.x > uHole.x && p.x < uHole.z && p.y > uHole.y && p.y < uHole.w) discard;
  float elev = vWorld.y / uExag;
  float t = clamp((elev - uMin) / max(uMax - uMin, 1.0), 0.0, 1.0);
  vec3 col = ramp(t);
  vec3 n = normalize(vNormal);
  float hs = clamp(dot(n, uLight), 0.0, 1.0);
  float sky = 0.5 + 0.5 * n.y;
  col *= 0.30 + 0.85 * hs + 0.15 * sky;

  vec2 uv = vec2((p.x - uBounds.x) / uBounds.z, (p.y - uBounds.y) / uBounds.w);
  bool inside = uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;

  if (uLCOn > 0.5 && inside) {
    int k = int(floor(texture2D(uLC, uv).r * 255.0 + 0.5));
    col = mix(col, lcColor(k) * (0.55 + 0.6 * hs), 0.45);
  }

  if (uContoursOn > 0.5) {
    float e = elev / uInterval;
    float fw = max(fwidth(e), 1e-4);
    float line = 1.0 - smoothstep(0.0, 1.2, abs(fract(e - 0.5) - 0.5) / fw);
    float em = elev / (uInterval * 5.0);
    float fwm = max(fwidth(em), 1e-4);
    float major = 1.0 - smoothstep(0.0, 1.5, abs(fract(em - 0.5) - 0.5) / fwm);
    float fade = 1.0 - smoothstep(0.25, 0.6, fw); // fade dense contours at distance
    col = mix(col, vec3(0.82, 0.88, 0.92), (line * 0.16 + major * 0.24) * fade);
  }

  if (uProbOn > 0.5 && inside) {
    float pr = texture2D(uProb, uv).r;
    float a = smoothstep(0.01, 1.0, pr);
    a = pow(a, 0.6);
    col = mix(col, vec3(0.20, 0.82, 0.90), a * 0.62);
    col += vec3(0.05, 0.25, 0.28) * a * a;
  }

  if (uHeatOn > 0.5 && inside) {
    float h = texture2D(uHeat, uv).r;
    float a = smoothstep(0.03, 0.45, h);
    col = mix(col, heatRamp(h), a * 0.88);
  }

  if (uZonesOn > 0.5 && inside) {
    vec4 z = texture2D(uZones, uv);
    for (int i = 0; i < 4; i++) {
      float v = i == 0 ? z.r : i == 1 ? z.g : i == 2 ? z.b : z.a;
      float a = smoothstep(0.05, 0.9, v);
      col = mix(col, uZoneColors[i], a * 0.42);
      // plume edge
      float edge = smoothstep(0.08, 0.12, v) - smoothstep(0.12, 0.16, v);
      col = mix(col, uZoneColors[i], edge * 0.8);
    }
  }

  if (uFocusOn > 0.5) {
    float l = rectLine(uFocus, p, 14.0);
    col = mix(col, vec3(1.0, 0.71, 0.28), l * 0.9);
  }
  if (uPreviewOn > 0.5) {
    float l = rectLine(uPreview, p, 18.0);
    col = mix(col, vec3(0.25, 0.82, 0.88), l);
  }

  col *= uDim;
  float d = distance(cameraPosition, vWorld);
  float fog = smoothstep(uFogNear, uFogFar, d);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function emptyTexture(format: THREE.PixelFormat = THREE.RedFormat): THREE.DataTexture {
  const size = format === THREE.RGBAFormat ? 4 : 1;
  const t = new THREE.DataTexture(new Uint8Array(size), 1, 1, format, THREE.UnsignedByteType);
  t.needsUpdate = true;
  return t;
}

/** Uint8 data texture (row 0 = north = v 0) with unpackAlignment 1 for odd widths. */
export function byteTexture(data: Uint8Array, cols: number, rows: number, format: THREE.PixelFormat, linear: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, cols, rows, format, THREE.UnsignedByteType);
  t.unpackAlignment = 1;
  t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.minFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

export function createTerrainMaterial(opts: { exag: number; min: number; max: number; interval: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uExag: { value: opts.exag },
      uMin: { value: opts.min },
      uMax: { value: opts.max },
      uInterval: { value: opts.interval },
      uLight: { value: new THREE.Vector3(-0.5, 0.75, -0.45).normalize() },
      uBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
      uHole: { value: new THREE.Vector4() },
      uHoleOn: { value: 0 },
      uFocus: { value: new THREE.Vector4() },
      uFocusOn: { value: 0 },
      uPreview: { value: new THREE.Vector4() },
      uPreviewOn: { value: 0 },
      uLC: { value: emptyTexture() },
      uLCOn: { value: 0 },
      uProb: { value: emptyTexture() },
      uProbOn: { value: 0 },
      uHeat: { value: emptyTexture() },
      uHeatOn: { value: 0 },
      uZones: { value: emptyTexture(THREE.RGBAFormat) },
      uZonesOn: { value: 0 },
      uContoursOn: { value: 1 },
      uFogColor: { value: new THREE.Color('#0a0f14') },
      uFogNear: { value: 9000 },
      uFogFar: { value: 26000 },
      uDim: { value: 1 },
      uZoneColors: { value: [new THREE.Color('#ff4fa3'), new THREE.Color('#b48cff'), new THREE.Color('#4fe3c1'), new THREE.Color('#c6ff4f')] },
    },
  });
}
