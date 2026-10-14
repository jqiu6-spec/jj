// scenes/final.js — "Cyberpunk brutalist metropolis, shot on iPhone 17" — FINAL, refine round 4
// Round 4: sign hierarchy (SECTOR 9 / SORA cut and recoloured, glyph cores clamped per sign), train windows with irregular
// passenger profiles, foreground leaners rebuilt as silhouettes, mottled sky + sky-glow rim on the Z's upper block (moved right
// so sky shows in the V above the peak), stray parapet-halo hairline and torn window panes fixed, TRANSIT un-mirrored, roofline
// fixtures thinned + concrete nosing, soffit downlights on the cantilevers, dome coffers / cornice / tall voids / slit band,
// railing strip -> fixtures, under-deck specks removed, wet-landing reflection coarser and dimmer, EXIT pictograms.
// Round 2: night exposure (hemisphere/ground cut ~60%, one lateral key, warmer 1.6x window emissive, sign spill radii x0.6,
// haze cards x0.9 instead of x1.6 - the real cause of round 1's flat mid-grey), height fog + lifted fog colour, facade-scale
// designed billboards (border, icon, headline, barcode, dark backing) + stacked-kanji blades, crisp double-pass glyphs with an
// additive core that crosses the bloom threshold, dome rebuilt as a coffered planetarium with instanced recessed window boxes
// (shader-discarded holes, warm spill), a near landing with a planar-reflection wet floor and six 30 px coat figures, viaduct
// footpath + railing + walkers at eye level, longer train with roof + headlamp cone, under-deck magenta wash instead of
// hotspots, parapet cap/LED/lights fixed, PointLights converted to a saturating falloff, softer phone pipeline.
// Round 1: elevated-walkway viewpoint (dome + viaduct now match the sketch's proportions), right tower rebuilt as a thick Z with
// stepped cantilever soffits, centre tower crowned by one continuous chamfer facet, LED runs + beacons instead of edge strips,
// frame-scale concrete cues (lifts, panel joints, rain streaks, damp patches, less speckle), neutral grey, legible hologram cores,
// resolution-stable bloom, near-black floor, asymmetric walking figures with contact shadows.
// Kept from beta: interior-mapped facade recess shader (exact ray/box reveals, per-cell size/depth jitter, merged/blank
// cells, clustered lit interiors, sill streaks, edge grime), band-table vocabulary with dense/void alternation, instanced
// ledge rings, 82deg ultra-wide at eye height with 27deg tilt + 7deg Dutch roll, wet-plaza planar reflection, hologram
// colours fed into the facade/ground lighting.
// Grafted / fixed: wedge-peaked centre monolith with a flaring crown (sketch chamfer), zig-zag right tower moved into
// frame, concrete-ribbed dome with lit portal + figure queue and subtle ticker rings, viaduct with train / piers / under-glow,
// in-frame parapet, two-silhouette coat figures with hats + umbrellas, real IPAGothic Japanese on the holograms, projector
// beams + blade signs, view-angle falloff / ghosting / flicker on holograms, FBM haze cards + ground mist, triplanar
// weathered concrete on all standard-material pieces, edge-light strips on the massing, and a phone night-mode post
// (barrel + radial CA, unsharp, halation, lens ghosts, split tone, resolution-stable grain).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const MAXB = 40;   // max facade bands
const MAXL = 40;   // max hologram point lights fed to shaders (round 2: the kiosk lights were being dropped at 24)
const MAXC = 8;    // max polygon clip planes per facade
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------------------------
// GLSL chunks
// ---------------------------------------------------------------------------------------------
const GLSL_COMMON = /* glsl */`
#define MAXL ${MAXL}
uniform int uLightN;
uniform vec3 uLightPos[MAXL];
uniform vec3 uLightCol[MAXL];
uniform float uLightRad[MAXL];
uniform vec3 uSkyCol; uniform vec3 uGroundCol; uniform vec3 uKeyDir; uniform vec3 uKeyCol;
uniform vec3 uFogCol; uniform float uFogDen; uniform float uLightSat;
// round 3: per-material fog multiplier (0 = unset -> 1), one directional shadow map (packed RGBA depth, manual 9-tap PCF) for
// the custom shaders, and an "air glow" accumulator: sign colour tinting the haze within ~1.5 sign-widths of each hologram
uniform float uFogMul; uniform float uKeyMul; uniform float uAirMul;   // round 4: 0 = unset -> 1
uniform sampler2D tShadow; uniform mat4 uShadowMat; uniform float uShadowOn; uniform vec2 uShadowTexel;
#include <packing>
vec3 gAir = vec3(0.0);
float gShadow = 1.0;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float shadowAt(vec3 P, vec3 N){
  if (uShadowOn < 0.5) return 1.0;
  vec4 sc = uShadowMat * vec4(P + N * 0.12, 1.0);
  vec3 s = sc.xyz / sc.w;
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
  float sh = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
    float d = unpackRGBAToDepth(texture2D(tShadow, s.xy + vec2(float(i), float(j)) * uShadowTexel * 1.2));
    sh += step(s.z - 0.0004, d);
  }
  // only surfaces that face the key can be in a cast shadow (the far side of the dome is simply unlit, not double-darkened)
  float fac = smoothstep(-0.15, 0.2, dot(N, uKeyDir));
  return mix(1.0, sh / 9.0, fac);
}
vec3 lightingDiffuse(vec3 N, vec3 P){
  vec3 c = uSkyCol * (0.55 + 0.45 * N.y) + uGroundCol * (0.5 - 0.5 * N.y);
  c += uKeyCol * (uKeyMul <= 0.0 ? 1.0 : uKeyMul) * max(dot(N, uKeyDir), 0.0) * gShadow;
  for (int i = 0; i < MAXL; i++) {
    if (i >= uLightN) break;
    vec3 L = uLightPos[i] - P; float dd = dot(L, L); float dist = sqrt(dd); L /= dist;
    float r = uLightRad[i];
    float att = r * r / (r * r + dd); att *= att;
    float ndl = clamp(dot(N, L) * 0.85 + 0.15, 0.0, 1.0);
    vec3 lc = mix(vec3(dot(uLightCol[i], vec3(0.3333))), uLightCol[i], uLightSat);   // concrete takes the holo colour desaturated
    c += lc * ndl * att;
    gAir += uLightCol[i] * 0.010 * smoothstep(0.05, 0.6, att);
  }
  gAir = min(gAir, vec3(0.028)) * (uAirMul <= 0.0 ? 1.0 : uAirMul);
  // the cast shadow also knocks the hemisphere / spill terms down (sky occlusion) so the deck band on the dome and the figure
  // shadows on the landing read even where the local lights dominate the key
  return c * mix(0.35, 1.0, gShadow);
}
// round 2: distance fog + a height-fog term (tower tops lose contrast) and a fog colour that lifts toward the light-polluted
// sky with altitude. Round 3: height fog cut 0.38 -> 0.15 and the high fog colour darkened so tower tops keep >= 15-20/255
// separation from the (now darker, warmer) sky; the right tower gets a 1.25x multiplier so it recedes behind the centre peak.
float fogAmount(vec3 P){
  float dist = distance(P, cameraPosition);
  float fd = 1.0 - exp(-uFogDen * uFogDen * dist * dist);
  float fh = 0.15 * smoothstep(140.0, 720.0, P.y);
  float f = 1.0 - (1.0 - fd) * (1.0 - fh);
  float fm = uFogMul <= 0.0 ? 1.0 : uFogMul;
  return min(f * fm, 0.97);
}
vec3 fogColorAt(vec3 P){ return mix(uFogCol, vec3(0.014, 0.014, 0.022), smoothstep(150.0, 600.0, P.y)); }
vec3 applyFog(vec3 col, vec3 P){ float f = fogAmount(P); return mix(col, fogColorAt(P), f) + gAir * (0.35 + 0.65 * f); }
`;

const FACADE_VERT = /* glsl */`
varying vec3 vWorldPos; varying vec2 vUvM;
void main(){ vUvM = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWorldPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
`;

// Interior-mapped recessed windows (beta) + polygon clip planes so wedge / zig-zag faces keep solid margins along diagonals.
const FACADE_FRAG = /* glsl */`
#define MAXB ${MAXB}
#define MAXC ${MAXC}
${GLSL_COMMON}
uniform vec3 uU, uV, uN; uniform float uW, uH, uSeed, uEdge;
uniform sampler2D tConc; uniform sampler2D tNoise; uniform vec3 uTint; uniform float uTexScale;
uniform float uBandN; uniform vec4 uBandA[MAXB]; uniform vec4 uBandB[MAXB]; uniform vec4 uBandC[MAXB];
uniform int uClipN; uniform vec3 uClip[MAXC]; uniform vec3 uRimCol; uniform float uRimW;
varying vec3 vWorldPos; varying vec2 vUvM;

float clipDist(vec2 q){ float d = 1e9; for (int i = 0; i < MAXC; i++) { if (i >= uClipN) break; d = min(d, dot(uClip[i].xy, q) + uClip[i].z); } return d; }

// round 3: outer = 1 on the exposed wall, 0 inside window reveals (the damp / rain-streak terms were producing black blobs
// inside lit voids); fine joint contrast cut ~60%, plus 3-10 m soft tonal blotches so the surface varies like the dome shell
vec3 concreteAlbedo(vec2 p, float streak, float grime, float outer){
  vec3 t = texture2D(tConc, p / uTexScale).rgb;
  float damp = texture2D(tNoise, p / 173.0 + uSeed).b;          // 5-20 m damp patches
  float macro2 = texture2D(tNoise, p / 37.0 + uSeed * 3.0).r;
  float blot = texture2D(tNoise, p / 14.0 + uSeed * 1.7).g;    // 3-10 m blotches
  // pour lifts every ~3.4 m with a per-lift tone and a dark joint line; vertical panel joints every ~8.5 m (frame-scale concrete cues)
  float liftId = floor(p.y / 3.4); float liftF = fract(p.y / 3.4);
  float liftTone = 0.94 + 0.12 * hash12(vec2(liftId, uSeed));
  float liftLine = 1.0 - 0.14 * (1.0 - smoothstep(0.0, 0.05, liftF)) - 0.05 * (1.0 - smoothstep(0.0, 0.14, liftF));
  float pj = fract(p.x / 8.5 + hash12(vec2(liftId * 0.5, uSeed + 2.0)) * 0.3);
  float panelLine = 1.0 - 0.10 * (1.0 - smoothstep(0.0, 0.03, min(pj, 1.0 - pj)));
  // rain streaks: narrow, strongly stretched vertically, 2-30 m long
  float rs = texture2D(tNoise, vec2(p.x * 0.045 + uSeed * 0.7, p.y * 0.004 + uSeed)).r;
  rs = smoothstep(0.52, 0.9, rs) * (0.6 + 0.4 * macro2) * outer;
  vec3 a = uTint * t * (1.0 - 0.28 * outer * (0.5 - damp)) * (0.94 + 0.12 * macro2) * (0.90 + 0.20 * blot) * liftTone * liftLine * panelLine;
  a *= 1.0 - 0.5 * streak;
  a *= 1.0 - 0.2 * rs;
  a *= 1.0 - 0.35 * grime;
  return a;
}

void main(){
  vec2 p = vUvM;
  vec3 Vw = normalize(vWorldPos - cameraPosition);
  vec3 vd = vec3(dot(Vw, uU), dot(Vw, uV), dot(Vw, uN));
  vec4 A = vec4(0.0), B = vec4(0.0), C = vec4(0.0); bool found = false;
  for (int i = 0; i < MAXB; i++) {
    if (float(i) >= uBandN) break;
    if (p.y >= uBandA[i].x && p.y < uBandA[i].y) { A = uBandA[i]; B = uBandB[i]; C = uBandC[i]; found = true; break; }
  }
  float type = B.w;
  bool clipSolid = clipDist(p) < uEdge;
  bool solid = (!found) || (type > 3.5) || (p.x < uEdge) || (p.x > uW - uEdge) || (p.y < 0.0) || (p.y > uH) || clipSolid;
  float sN = texture2D(tNoise, vec2(p.x * 0.021 + uSeed * 0.3, p.y * 0.0011)).g;
  sN = smoothstep(0.3, 0.85, sN);
  float streak = 0.0;
  vec3 col = vec3(0.0);
  vec3 N = uN; vec3 P = vWorldPos;
  bool hitWindow = false;
  float edgeDark = 1.0;
  if (!solid) {
    vec2 cell = vec2(A.z, A.w);
    float innerW = uW - 2.0 * uEdge;
    float nCols = floor(innerW / cell.x);
    float margin = uEdge + 0.5 * (innerW - nCols * cell.x);
    vec2 q = vec2(p.x - margin, p.y - A.x);
    vec2 ci = floor(q / cell);
    if (ci.x < 0.0 || ci.x >= nCols) { solid = true; }
    else {
      float pair = floor(ci.x * 0.5);
      float mergeH = hash12(vec2(pair, ci.y) + uSeed * 13.1 + A.x);
      float merged = (mergeH < C.y && pair * 2.0 + 1.0 < nCols) ? 1.0 : 0.0;
      vec2 cellOrg = ci * cell; float cw = cell.x;
      if (merged > 0.5) { cellOrg.x = pair * 2.0 * cell.x; cw = 2.0 * cell.x; ci.x = pair * 2.0; }
      vec2 local = q - cellOrg;
      vec2 id = ci + vec2(uSeed * 7.0, A.x * 0.37);
      float h1 = hash12(id), h2 = hash12(id + 11.0), h3 = hash12(id + 23.0), h4 = hash12(id + 37.0), h5 = hash12(id + 51.0);
      bool blank = h4 < C.w;
      float ww = min(B.x * (merged > 0.5 ? 2.15 : 1.0) * (0.84 + 0.32 * h1), cw - 0.5);
      float wh = min(B.y * (0.84 + 0.32 * h2), cell.y - 0.45);
      float dep = B.z * (0.6 + 0.8 * h3);
      vec2 ws = vec2(ww, wh);
      vec2 wmin = vec2((cw - ww) * 0.5, (cell.y - wh) * 0.5);
      if (type > 2.5 && type < 3.5) { wmin.y = 0.0; ws.y = cell.y; }
      // whole window must sit inside the clipped polygon (with margin) else it becomes wall
      if (uClipN > 0) {
        vec2 w0 = vec2(margin, A.x) + cellOrg + wmin; vec2 w1 = w0 + ws;
        float cd = min(min(clipDist(w0), clipDist(w1)), min(clipDist(vec2(w0.x, w1.y)), clipDist(vec2(w1.x, w0.y))));
        if (cd < uEdge * 0.6) blank = true;
      }
      vec2 rel = local - wmin;
      float below = (local.y < wmin.y) ? smoothstep(0.0, wmin.y, local.y) : 0.0;
      float above = (local.y > wmin.y + ws.y) ? smoothstep(wmin.y + ws.y, cell.y, local.y) : 0.0;
      float xin = smoothstep(-1.2, 0.2, rel.x) * smoothstep(ws.x + 1.2, ws.x - 0.2, rel.x);
      streak = max(below, above) * sN * (blank ? 0.35 : 1.0) * (0.35 + 0.65 * xin);
      vec2 dEdge = max(vec2(wmin - local), vec2(local - wmin - ws));
      float de = max(dEdge.x, dEdge.y);
      edgeDark = blank ? 1.0 : mix(0.72, 1.0, smoothstep(0.0, 0.35, de));
      if (!blank && rel.x > 0.0 && rel.x < ws.x && rel.y > 0.0 && rel.y < ws.y && vd.z < -1e-4) {
        hitWindow = true;
        vec3 rd = vd; rd.x = (abs(rd.x) < 1e-4) ? 1e-4 : rd.x; rd.y = (abs(rd.y) < 1e-4) ? 1e-4 : rd.y;
        vec3 ro = vec3(rel, 0.0);
        float tz = -dep / rd.z;
        float tx = ((rd.x > 0.0 ? ws.x : 0.0) - ro.x) / rd.x;
        float ty = ((rd.y > 0.0 ? ws.y : 0.0) - ro.y) / rd.y;
        float t = min(tz, min(tx, ty));
        vec3 hp = ro + rd * t;
        P = vWorldPos + Vw * t;
        float depthF = clamp(-hp.z / dep, 0.0, 1.0);
        float ao = mix(1.0, 0.2, pow(depthF, 0.55));
        bool back = (t == tz);
        bool jambX = (!back) && (t == tx);
        bool glassy = type < 1.5;
        float kind = hash12(id + 77.0);
        // round 2: ~78% warm tungsten/sodium (2700-3500K, two tones), ~16% cool white, a few magenta
        // round 3: brightness 0.4-1.3 and colour temperature +/-15% per window, interior gradient with a bright ceiling line,
        // dark mullions on openings wider than 4 m, and a soft HDR knee so no interior clips to paper-white
        vec3 litCol = (kind < 0.78) ? mix(vec3(1.0, 0.66, 0.36), vec3(1.0, 0.84, 0.60), hash12(id + 131.0)) : (kind < 0.94 ? vec3(0.55, 0.80, 1.0) : vec3(1.0, 0.32, 0.58));
        float ctemp = hash12(id + 141.0) - 0.5; litCol *= vec3(1.0 + 0.3 * ctemp, 1.0, 1.0 - 0.3 * ctemp);
        vec2 wcen = vec2(margin, A.x) + cellOrg + wmin + ws * 0.5;   // round 4: sampled once per window (per-fragment sampling tore panes along the noise iso-contour)
        float cluster = 0.55 + 0.9 * texture2D(tNoise, wcen / 95.0 + uSeed).r;
        bool lit = (h5 < C.x * cluster);
        float litI = (0.4 + 0.9 * hash12(id + 91.0));
        // round 4: on a foreshortened face the jamb hides most of the lit pane and the remaining sliver aliases into a 1 px line
        // (the left tower's +x faces at the top of the frame); fade the interior light when that sliver is under ~1 px
        { float hid = dep * abs(rd.x / rd.z) / ws.x; float sliverPx = max(ws.x - dep * abs(rd.x / rd.z), 0.0) / max(fwidth(p.x), 1e-4);
          litI *= mix(1.0, smoothstep(0.6, 2.2, sliverPx), smoothstep(0.4, 0.8, hid)); }
        if (back) {
          N = uN;
          vec2 wuv = hp.xy / ws;
          float mull = 1.0;
          if (ws.x > 4.0) { float nm = max(2.0, floor(ws.x / 3.0 + 0.5)); float mf = abs(fract(wuv.x * nm) - 0.5); mull = 1.0 - 0.85 * smoothstep(0.40, 0.45, mf); }
          if (glassy) {
            vec3 glass = vec3(0.010, 0.013, 0.02);
            float fr = pow(1.0 - clamp(dot(-Vw, uN), 0.0, 1.0), 3.0);
            glass += uSkyCol * 0.12 * fr;
            vec3 emis = vec3(0.0);
            if (lit) {
              float pat = mix(0.58, 1.0, smoothstep(0.25, 0.8, wuv.y)) + 0.7 * smoothstep(0.82, 0.90, wuv.y) * (1.0 - smoothstep(0.95, 1.0, wuv.y));
              float blinds = hash12(id + 101.0) < 0.3 ? (0.55 + 0.45 * step(0.5, fract(wuv.y * ws.y * 2.2))) : 1.0;
              float occl = hash12(id + 111.0) < 0.25 ? smoothstep(0.1, 0.3, abs(wuv.x - 0.5)) * 0.6 + 0.4 : 1.0;
              emis = litCol * litI * pat * blinds * occl * mull;
              emis = emis * 0.9 / (0.9 + max(emis.r, max(emis.g, emis.b)));
            }
            col = glass * lightingDiffuse(uN, P) * ao + emis * mix(1.0, ao, 0.25);
          } else {
            vec3 alb = concreteAlbedo(vec2(hp.x + ci.x * 3.0, hp.y + A.x), 0.0, 0.0, 0.0) * ((type > 2.5 && type < 3.5) ? 0.55 : 0.9);
            col = alb * lightingDiffuse(uN, P) * ao;
            if (type > 1.5 && type < 2.5 && lit) col += alb * litCol * litI * 0.55 * (0.3 + 0.7 * wuv.y) * mull;
          }
        } else if (jambX) {
          N = (rd.x > 0.0) ? -uU : uU;
          vec3 alb = concreteAlbedo(vec2(hp.z * 1.7 + ci.x * 5.0, hp.y + A.x), 0.0, 0.0, 0.0) * 1.05;
          col = alb * lightingDiffuse(N, P) * ao;
          if (lit) col += alb * litCol * litI * (glassy ? 0.35 : 0.5) * pow(depthF, 1.5);
        } else {
          bool ceiling = rd.y > 0.0;
          N = ceiling ? -uV : uV;
          vec3 alb = concreteAlbedo(vec2(hp.x + ci.x * 3.0, hp.z * 1.7 + A.x), 0.0, 0.0, 0.0) * (ceiling ? 0.85 : 1.1);
          col = alb * lightingDiffuse(N, P) * ao;
          if (lit) {
            if (type > 1.5 && type < 2.5) { col += (ceiling ? litCol * litI * 0.7 : alb * litCol * litI * 0.6 * depthF); }
            else col += alb * litCol * litI * 0.35 * pow(depthF, 1.5);
          }
        }
      }
    }
  }
  if (!hitWindow) {
    float grime = smoothstep(7.0, 0.0, p.y) * 0.6;
    vec3 alb = concreteAlbedo(p, streak, grime, 1.0) * edgeDark;
    float tA = texture2D(tConc, (p + vec2(0.0, 0.07)) / uTexScale).r; float tB = texture2D(tConc, p / uTexScale).r;
    vec3 Np = normalize(uN + uV * (tB - tA) * 3.0);
    col = alb * lightingDiffuse(Np, vWorldPos);
    // round 4: the air-glow tint follows the concrete tone (pour lines / tie holes stay visible inside the sign spill)
    gAir *= clamp(dot(alb, vec3(0.333)) / 0.30, 0.3, 1.2);
  }
  col = applyFog(col, P);
  // round 4: faint sky-glow rim along the silhouette edges (the upper block of the Z separates from the sky)
  if (uRimW > 0.0) { float ed = min(min(p.x, uW - p.x), uH - p.y); if (uClipN > 0) ed = min(ed, clipDist(p)); col += uRimCol * exp(-ed / uRimW) * smoothstep(0.0, 40.0, p.y); }
  gl_FragColor = vec4(col, 1.0);
}
`;

const HOLO_VERT = /* glsl */`
varying vec2 vUv; varying vec3 vWorldPos; varying vec3 vN;
void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWorldPos = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }
`;
// Additive hologram: scanlines, per-row glitch (per-sign probability), RGB split, two ghost taps, low-frequency band
// brightness, view-angle falloff (fades edge-on like a projected plane), fog attenuation.
const HOLO_FRAG = /* glsl */`
${GLSL_COMMON}
uniform sampler2D tMap; uniform vec3 uCol; uniform vec3 uCol2; uniform float uInt, uSeed, uAspect, uScan, uGlitch, uCore;
varying vec2 vUv; varying vec3 vWorldPos; varying vec3 vN;
void main(){
  vec2 uv = vUv;
  float band = floor(uv.y * 48.0 + uSeed * 10.0);
  float g = hash12(vec2(band, uSeed));
  if (g > 1.0 - uGlitch) uv.x += (hash12(vec2(band * 3.3, uSeed)) - 0.5) * 0.06;
  float slip = step(0.985, hash12(vec2(floor(uv.y * 160.0), uSeed + 3.0)));
  uv.x += slip * 0.02;
  float ca = 0.0045;
  float r = texture2D(tMap, uv + vec2(ca, 0.0)).r;
  float gg = texture2D(tMap, uv).g;
  float b = texture2D(tMap, uv - vec2(ca, 0.0)).b;
  vec3 tex = vec3(r, gg, b);
  tex += texture2D(tMap, uv + vec2(0.010, 0.016)).rgb * 0.22;
  tex += texture2D(tMap, uv - vec2(0.006, 0.010)).rgb * 0.12;
  float scan = 0.72 + 0.28 * sin(uv.y * uScan);
  float scan2 = 0.9 + 0.1 * sin(uv.y * uScan * 0.173 + uSeed);
  // flicker bands: a few horizontal bands dip or brighten (per-sign phase)
  float bandL = 0.84 + 0.16 * sin(vUv.y * 7.0 + uSeed * 20.0 + vUv.x * 2.0);
  float fb = hash12(vec2(floor(vUv.y * 9.0 + uSeed), uSeed * 2.0)); bandL *= (fb < 0.12) ? 0.55 : ((fb > 0.9) ? 1.2 : 1.0);
  float edge = smoothstep(0.0, 0.04, uv.x) * smoothstep(1.0, 0.96, uv.x) * smoothstep(0.0, 0.05, uv.y) * smoothstep(1.0, 0.95, uv.y);
  float frame = (1.0 - smoothstep(0.012, 0.02, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y) * uAspect))) * 0.5;
  // round 3: a slow vertical shimmer band (per-sign phase) so the planes read as projected light, not printed boards
  float shimY = fract(uSeed * 0.61 + 0.23); float shim = exp(-pow((vUv.y - shimY) * 9.0, 2.0));
  bandL *= 1.0 + 0.22 * shim;
  vec3 tint = mix(uCol, uCol2, uv.y);
  vec3 Vv = normalize(cameraPosition - vWorldPos);
  float fac = abs(dot(normalize(vN), Vv));
  // round 2: the glyph cores get a crisp additive term so they cross the bloom threshold (legible glowing text on a dark panel)
  float core = smoothstep(0.5, 1.0, max(tex.r, max(tex.g, tex.b)));
  vec3 col = (tex * tint + tint * 0.02 + frame * tint) * scan * scan2 * bandL * edge * uInt * mix(0.25, 1.0, fac);
  col += min(tex, 1.0) * (tint * 0.7 + 0.3) * core * uInt * uCore * scan * edge * mix(0.4, 1.0, fac);   // round 4: core keeps the glyph colour; uCore 0.9, 0.5 on the two brightest signs
  col = min(col, vec3(1.8));   // keep sign cores coloured-on-dark (iPhone HDR keeps neon legible, it does not white it out)
  col *= 1.0 - fogAmount(vWorldPos) * 0.78;   // emissives punch through haze more than concrete does (ref 3's far billboards)
  gl_FragColor = vec4(col, 1.0);
}
`;
const GLOW_FRAG = /* glsl */`
${GLSL_COMMON}
uniform vec3 uCol; uniform float uInt;
varying vec2 vUv; varying vec3 vWorldPos; varying vec3 vN;
void main(){
  vec2 c = vUv - 0.5; float r = length(c) * 2.0;
  float a = pow(max(1.0 - r, 0.0), 2.2);
  vec3 col = uCol * a * uInt * (1.0 - fogAmount(vWorldPos));
  gl_FragColor = vec4(col, 1.0);
}
`;
// Projector cone: rim-weighted additive open cylinder from a small emitter box to the hologram (gamma)
const BEAM_FRAG = /* glsl */`
${GLSL_COMMON}
uniform vec3 uCol; uniform float uInt;
varying vec2 vUv; varying vec3 vWorldPos; varying vec3 vN;
void main(){
  vec3 Vv = normalize(cameraPosition - vWorldPos);
  float rim = pow(1.0 - abs(dot(normalize(vN), Vv)), 1.3);
  float along = smoothstep(0.0, 0.25, vUv.y) * (0.3 + 0.7 * vUv.y);
  vec3 col = uCol * uInt * (0.2 + 0.8 * rim) * along * (1.0 - fogAmount(vWorldPos));
  gl_FragColor = vec4(col, 1.0);
}
`;

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const SKY_FRAG = /* glsl */`
uniform sampler2D tNoise; uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uGlow; uniform vec3 uGlow2;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHor, uTop, pow(h, 0.45));
  // low-frequency light pollution: brighter and warmer toward the horizon, more behind the right-hand holo cluster
  // round 3: the zenith is much darker and warmer (mauve-grey, not blue-violet); the pollution terms stay near the horizon and
  // are strongest/warmest at the lower right, so the sky is a gradient the towers can silhouette against
  float pol = pow(1.0 - h, 2.8);
  col += vec3(0.050, 0.034, 0.046) * pol;
  col += vec3(0.03, 0.038, 0.052) * pow(max(0.0, 1.0 - h), 6.0) * (0.6 + 0.4 * clamp(d.x, 0.0, 1.0));
  col += vec3(0.07, 0.036, 0.055) * pow(max(0.0, 1.0 - h), 2.2) * smoothstep(-0.2, 0.9, d.x) * smoothstep(-0.6, 0.2, d.z * -1.0);
  // haze streaks: stretched horizontally, lit from below (warm) on the right where the sign cluster is
  vec2 cuv = d.xz / (abs(d.y) + 0.12) * 0.22;
  float c1 = texture2D(tNoise, cuv * vec2(0.22, 0.9) + 0.1).b;
  float c2 = texture2D(tNoise, cuv * vec2(0.8, 2.6) + 0.3).r;
  float c3 = texture2D(tNoise, cuv * 4.0 + 0.6).g;
  float cl = smoothstep(0.36, 0.85, c1 * 0.65 + c2 * 0.25 + c3 * 0.1) * smoothstep(0.0, 0.2, d.y) * (1.0 - 0.45 * smoothstep(0.3, 1.0, d.y));
  vec3 glow = mix(uGlow, uGlow2, clamp(d.x * 0.5 + 0.5, 0.0, 1.0));
  glow += vec3(0.05, 0.024, 0.02) * smoothstep(0.0, 0.8, d.x) * pow(max(0.0, 1.0 - h), 1.5);
  col = mix(col, glow, cl * 0.6);
  // round 4: 2-octave cloud / haze mottling (~15-25% of the frame, +/-20% luminance) lit warmer at the lower right by the city
  // glow, plus two soft diagonal haze bands, so the top third is not a flat gradient
  vec2 muv = d.xz / (abs(d.y) + 0.25);
  float m1 = texture2D(tNoise, muv * 0.6 + 0.17).b;
  float m2 = texture2D(tNoise, muv * 0.35 + 0.52).r;
  float mot = (m1 * 0.6 + m2 * 0.4) - 0.5;
  float litR = 0.7 + 0.7 * smoothstep(-0.4, 0.9, d.x) * (1.0 - h);
  col *= 1.0 + 0.42 * mot * litR;
  float bandA = exp(-pow((d.y - 0.50 + 0.30 * d.x) * 4.5, 2.0));
  float bandB = exp(-pow((d.y - 0.78 + 0.18 * d.x) * 6.0, 2.0));
  col += vec3(0.026, 0.018, 0.021) * (bandA * 0.7 + bandB * 0.45) * litR * (0.7 + 0.5 * mot);
  gl_FragColor = vec4(col, 1.0);
}
`;

const DOME_VERT = /* glsl */`
varying vec3 vWorldPos; varying vec3 vN; varying vec2 vUv;
void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWorldPos = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }
`;
// Concrete-dominant gridded dome: lat-long concrete ribs (also built as real tori), mostly concrete panels, a few lit
// glass panels, faint lit grooves along the seams (toned down from beta's wire look).
// Round 2: brutalist planetarium shell. Lat-long concrete ribs, recessed 3.7 m coffers between them (fake bevel: the sill
// reveal catches the key, the head reveal is dark), board-form at frame scale (8x4 repeat) with pour-lift bands and damp
// patches, dark rain streaks under every rib ring, and real recessed window boxes (InstancedMesh) sitting in holes the shader
// discards, with a warm spill on the concrete around the lit ones.
const DOME_FRAG = /* glsl */`
${GLSL_COMMON}
#define MAXW 32
uniform vec3 uGridCol; uniform sampler2D tConc; uniform sampler2D tNoise; uniform float uR;
uniform int uWinN; uniform vec4 uWin[MAXW];
varying vec3 vWorldPos; varying vec3 vN; varying vec2 vUv;
void main(){
  float lon = vUv.x * 12.0; float lat = vUv.y * 6.0;
  float fl = min(fract(lon), 1.0 - fract(lon)); float fa = min(fract(lat), 1.0 - fract(lat));
  float ribW = 0.06; float aa = fwidth(lon) * 0.8;
  float rib = max(1.0 - smoothstep(ribW - aa, ribW + aa, fl), 1.0 - smoothstep(ribW - aa, ribW + aa, fa));
  float seam = max(1.0 - smoothstep(0.0, 0.010 + aa, fl), 1.0 - smoothstep(0.0, 0.010 + aa, fa));
  float lon2 = lon * 4.0, lat2 = lat * 4.0;
  vec2 pid = floor(vec2(lon2, lat2));
  vec2 cf = fract(vec2(lon2, lat2));
  vec3 spill = vec3(0.0);
  for (int i = 0; i < MAXW; i++) {
    if (i >= uWinN) break;
    vec4 w = uWin[i];
    // round 4: w.z = kind + 10 * span (0 single, 1 double-height void, 2 two-cell horizontal slit band)
    float sp = floor(w.z / 10.0 + 0.001); float kd = w.z - sp * 10.0;
    vec2 span = (sp > 1.5) ? vec2(2.0, 1.0) : ((sp > 0.5) ? vec2(1.0, 2.0) : vec2(1.0, 1.0));
    vec2 rel = vec2(lon2, lat2) - w.xy;
    vec2 lo = vec2(0.2, 0.2), hi = span - 0.2;
    if (sp > 1.5) { lo.y = 0.34; hi.y = 0.66; }
    if (rel.x > lo.x && rel.x < hi.x && rel.y > lo.y && rel.y < hi.y) discard;
    float d = length(vec2(lon2, lat2) - (w.xy + span * 0.5));
    vec3 wc = (kd < 0.5) ? vec3(1.0, 0.68, 0.40) : ((kd < 1.5) ? vec3(0.45, 0.80, 1.0) : vec3(0.0));
    spill += wc * w.w * smoothstep(1.15 + 0.3 * (span.x + span.y - 2.0), 0.38, d);
  }
  // coffers: one 7 m recessed panel per window cell (bold, not tile-like)
  vec2 c3 = cf;
  vec2 din = min(c3, 1.0 - c3) - 0.11;
  float dmin = min(din.x, din.y);
  float inside = smoothstep(-0.012, 0.012, dmin);
  float aoC = 1.0 - 0.55 * inside * (1.0 - smoothstep(0.0, 0.16, dmin));
  float bev = smoothstep(0.0, 0.02, din.y) * (1.0 - smoothstep(0.02, 0.075, din.y)) * step(0.0, din.x);
  float cofShade = mix(1.0, 0.74, inside) * aoC * (1.0 + 0.9 * bev * step(c3.y, 0.5)) * (1.0 - 0.8 * bev * step(0.5, c3.y));   // round 4: coffer shading doubled
  vec3 N = normalize(vN);
  gShadow = shadowAt(vWorldPos, N);   // round 3: the viaduct deck's cast shadow bands the lower shell
  vec3 L = lightingDiffuse(N, vWorldPos);
  vec3 t = texture2D(tConc, vec2(vUv.x * 8.0, vUv.y * 4.0)).rgb;
  float macro = texture2D(tNoise, vUv * vec2(6.0, 3.0)).b;
  float damp = texture2D(tNoise, vUv * vec2(2.5, 1.2) + 0.3).b;
  float liftId = floor(vWorldPos.y / 3.4); float liftF = fract(vWorldPos.y / 3.4);
  float liftTone = 0.94 + 0.12 * hash12(vec2(liftId, 3.0));
  float liftLine = 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.08, liftF));
  float sn = texture2D(tNoise, vec2(vUv.x * 40.0, vUv.y * 0.5)).g;
  float ribStreak = smoothstep(0.78, 1.0, fract(lat)) * smoothstep(0.35, 0.8, sn) * 0.55;
  float grime = smoothstep(0.42, 0.30, vUv.y) * 0.4;   // the base of the shell is dirtier
  vec3 base = t * (0.80 + 0.40 * macro) * (0.86 + 0.28 * damp) * liftTone * liftLine;
  vec3 conc = base * vec3(0.40, 0.405, 0.415) * (1.0 - ribStreak) * (1.0 - grime) * cofShade;
  vec3 ribCol = base * vec3(0.44, 0.445, 0.455) * (1.0 - 0.5 * grime);
  vec3 col = mix(conc, ribCol, rib) * (L + spill * 0.7);
  col += uGridCol * seam * 0.04;
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;
// instanced recessed window boxes for the dome: concrete reveal walls (lit from the back plane) + lit back plane with mullions
const BOXWIN_VERT = /* glsl */`
varying vec2 vUv; varying vec3 vCol; varying vec3 vWP; varying vec3 vNw;
void main(){
  vUv = uv; vCol = vec3(1.0);
#ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
#endif
  vec4 mp = vec4(position, 1.0); vec3 nn = normal;
#ifdef USE_INSTANCING
  mp = instanceMatrix * mp; nn = mat3(instanceMatrix) * nn;
#endif
  vec4 wp = modelMatrix * mp; vWP = wp.xyz; vNw = normalize(mat3(modelMatrix) * nn);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const REVEAL_FRAG = /* glsl */`
${GLSL_COMMON}
uniform sampler2D tConc; varying vec2 vUv; varying vec3 vCol; varying vec3 vWP; varying vec3 vNw;
void main(){
  vec3 alb = texture2D(tConc, vec2(vUv.x * 0.5, vUv.y * 0.15)).rgb * vec3(0.36, 0.365, 0.375);
  vec3 L = lightingDiffuse(normalize(vNw), vWP) * 0.6;
  float depthF = vUv.y;
  vec3 col = alb * (L * (1.0 - 0.5 * depthF) + vCol * 0.55 * pow(depthF, 1.4));
  col = applyFog(col, vWP);
  gl_FragColor = vec4(col, 1.0);
}
`;
const BACKPANE_FRAG = /* glsl */`
${GLSL_COMMON}
varying vec2 vUv; varying vec3 vCol; varying vec3 vWP; varying vec3 vNw;
void main(){
  float mull = step(0.035, abs(vUv.x - 0.34)) * step(0.035, abs(vUv.x - 0.67));
  float trans = step(0.04, abs(vUv.y - 0.74));
  float frameB = step(0.03, vUv.x) * step(vUv.x, 0.97) * step(0.03, vUv.y) * step(vUv.y, 0.97);
  float bars = mull * trans * frameB;
  vec3 Vv = normalize(cameraPosition - vWP);
  float fr = pow(1.0 - clamp(dot(normalize(vNw), Vv), 0.0, 1.0), 3.0);
  vec3 glass = vec3(0.012, 0.015, 0.022) + uSkyCol * 0.5 * fr;
  // round 3: warm-to-pale vertical gradient with a bright ceiling line, soft knee so the panes do not clip to paper
  vec3 lc = vCol * mix(vec3(1.0, 0.92, 0.84), vec3(0.95, 1.0, 1.12), vUv.y);
  vec3 emis = lc * (mix(0.5, 1.0, smoothstep(0.2, 0.8, vUv.y)) + 0.6 * smoothstep(0.84, 0.92, vUv.y) * (1.0 - smoothstep(0.96, 1.0, vUv.y)));
  emis = emis * 1.4 / (1.4 + max(emis.r, max(emis.g, emis.b)));
  vec3 col = (emis + glass) * bars + vec3(0.004) * (1.0 - bars);
  col = applyFog(col, vWP);
  gl_FragColor = vec4(col, 1.0);
}
`;

const GROUND_VERT = /* glsl */`
uniform mat4 textureMatrix; varying vec4 vUv4; varying vec3 vWorldPos;
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorldPos = wp.xyz; vUv4 = textureMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * viewMatrix * wp; }
`;
// Wet plaza: puddle mask, ripple perturbation, 5-tap roughness blur (sharper in puddles), fresnel, paver joints.
const GROUND_FRAG = /* glsl */`
${GLSL_COMMON}
uniform sampler2D tDiffuse; uniform sampler2D tNoise; uniform vec3 color;
varying vec4 vUv4; varying vec3 vWorldPos;
void main(){
  vec2 wxz = vWorldPos.xz;
  float puddle = texture2D(tNoise, wxz * 0.004 + 0.37).b;
  float wet = smoothstep(0.40, 0.62, puddle);
  vec2 rip = (texture2D(tNoise, wxz * 0.06).rg - 0.5);
  vec4 uv4 = vUv4; uv4.xy += rip * uv4.w * mix(0.022, 0.005, wet);
  // round 3: the reflection is blurred mostly along screen-v (9 taps) and modulated by a roughness map so point sources
  // break into stretched vertical streaks instead of hard chips; reflection weight ~0.5
  float rough = texture2D(tNoise, vec2(wxz.x * 0.022, wxz.y * 0.003) + 0.5).r;   // round 4: 4x coarser (no 0.1 m mosaic)
  float blur = mix(0.010, 0.0025, wet) * uv4.w * (0.6 + 0.9 * rough);
  float blurV = blur * 4.0;
  vec3 refl = texture2DProj(tDiffuse, uv4).rgb * 0.20;
  refl += texture2DProj(tDiffuse, uv4 + vec4(blur, 0.0, 0.0, 0.0)).rgb * 0.10;
  refl += texture2DProj(tDiffuse, uv4 - vec4(blur, 0.0, 0.0, 0.0)).rgb * 0.10;
  refl += texture2DProj(tDiffuse, uv4 + vec4(0.0, blurV * 0.33, 0.0, 0.0)).rgb * 0.13;
  refl += texture2DProj(tDiffuse, uv4 - vec4(0.0, blurV * 0.33, 0.0, 0.0)).rgb * 0.13;
  refl += texture2DProj(tDiffuse, uv4 + vec4(0.0, blurV * 0.66, 0.0, 0.0)).rgb * 0.10;
  refl += texture2DProj(tDiffuse, uv4 - vec4(0.0, blurV * 0.66, 0.0, 0.0)).rgb * 0.10;
  refl += texture2DProj(tDiffuse, uv4 + vec4(0.0, blurV, 0.0, 0.0)).rgb * 0.07;
  refl += texture2DProj(tDiffuse, uv4 - vec4(0.0, blurV, 0.0, 0.0)).rgb * 0.07;
  float pav = texture2D(tNoise, wxz * 0.11).r; float pav2 = texture2D(tNoise, wxz * 0.45 + 0.2).g;
  vec2 g = abs(fract(wxz / 3.0) - 0.5); float line = smoothstep(0.46, 0.5, max(g.x, g.y));
  // round 2: lighter, wetter plaza (pale pavers with a sheen) so the distant coat figures read as silhouettes (ref 2)
  vec3 alb = vec3(0.22, 0.225, 0.235) * (0.7 + 0.5 * pav) * (0.85 + 0.3 * pav2) * (1.0 - 0.45 * line);
  alb *= mix(1.0, 0.55, wet);
  vec3 Vv = normalize(cameraPosition - vWorldPos);
  float fres = pow(1.0 - max(Vv.y, 0.0), 2.2);
  float reflAmt = mix(0.11, 0.42, wet) * mix(0.3, 1.0, fres) * (0.75 + 0.25 * rough);   // round 4: 0.6 -> 0.42
  gShadow = shadowAt(vWorldPos, vec3(0.0, 1.0, 0.0));   // round 3: figures / parapets / viaduct cast onto the wet floors
  vec3 col = alb * lightingDiffuse(vec3(0.0, 1.0, 0.0), vWorldPos) * 1.25 + refl * reflAmt;
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

// iPhone night-mode look: barrel distortion + radial CA, unsharp mask, warm halation, point-mirrored lens ghosts,
// night S-curve, shadow desaturation with blue shift, cool/warm split tone, vignette, resolution-stable two-octave grain.
const PHONE_FRAG = /* glsl */`
uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uSeed;
varying vec2 vUv;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 q){ vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y); }
vec3 fetch(vec2 uv){ return texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb; }
void main(){
  float asp = uRes.x / uRes.y;
  vec2 c = vUv - 0.5; c.x *= asp; float r2 = dot(c, c);
  float k = 0.06; float maxr2 = 0.25 * asp * asp + 0.25; float s = 1.0 / (1.0 + k * maxr2);
  vec2 cd = c * (1.0 + k * r2) * s;
  vec2 dir = c / max(length(c), 1e-4);
  // round 3: CA halved and weighted by local luminance (a dark near parapet edge no longer shows colour fringes)
  float ca = 0.0036 * r2 * 0.3;
  vec2 uv0 = vec2(cd.x / asp, cd.y) + 0.5;
  vec3 c0 = fetch(uv0);
  ca *= 0.35 + 0.65 * smoothstep(0.05, 0.5, dot(c0, vec3(0.333)));
  vec2 uvr = vec2((cd.x + dir.x * ca) / asp, cd.y + dir.y * ca) + 0.5;
  vec2 uvb = vec2((cd.x - dir.x * ca) / asp, cd.y - dir.y * ca) + 0.5;
  vec3 col = vec3(fetch(uvr).r, c0.g, fetch(uvb).b);
  vec2 px = 1.0 / uRes;
  // final: the lens / night-mode denoise softness is a FRAME-relative radius (1 px at 1024 tall, ~4 px at 4032), sampled as a
  // 12-tap disc (two rings + half-radius axis taps) so a 4 px kernel softens edges instead of echoing them
  float bs = uRes.y / 1024.0; vec2 bp = px * bs;
  vec3 nb = fetch(uv0 + vec2(bp.x, 0.0)) + fetch(uv0 - vec2(bp.x, 0.0)) + fetch(uv0 + vec2(0.0, bp.y)) + fetch(uv0 - vec2(0.0, bp.y));
  nb += fetch(uv0 + bp * 0.707) + fetch(uv0 - bp * 0.707) + fetch(uv0 + vec2(bp.x, -bp.y) * 0.707) + fetch(uv0 + vec2(-bp.x, bp.y) * 0.707);
  nb += fetch(uv0 + vec2(bp.x * 0.5, 0.0)) + fetch(uv0 - vec2(bp.x * 0.5, 0.0)) + fetch(uv0 + vec2(0.0, bp.y * 0.5)) + fetch(uv0 - vec2(0.0, bp.y * 0.5));
  nb /= 12.0;
  // round 2: lens + night-mode denoise softness and a much gentler unsharp mask
  col = mix(col, nb, 0.3);
  col += (col - nb) * 0.12;
  // round 3: wider, stronger warm halation (10 px radius, two rings) so bright windows / signs get soft halos
  vec3 hal = vec3(0.0); float rad = 10.0 * (uRes.y / 1024.0);
  for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398; vec2 o = vec2(cos(a), sin(a)) * rad * px; hal += max(fetch(uv0 + o) - 0.70, 0.0); hal += max(fetch(uv0 + o * 0.5) - 0.70, 0.0) * 0.7; }
  hal /= 13.6; col += hal * vec3(1.0, 0.55, 0.35) * 0.8;
  vec3 g1 = max(fetch(1.0 - uv0) - 0.92, 0.0); vec3 g2 = max(fetch(0.5 - (uv0 - 0.5) * 0.55) - 0.85, 0.0);
  col += g1 * vec3(0.55, 1.0, 0.65) * 0.16 + g2 * vec3(0.7, 0.9, 1.0) * 0.10;
  col = col * 1.06 - 0.015;
  col = mix(col, smoothstep(0.0, 1.0, col), 0.18);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum), 0.10 * (1.0 - smoothstep(0.0, 0.35, lum)));
  // cool shadows / warm highlights split tone
  col += vec3(-0.003, 0.0, 0.008) * (1.0 - smoothstep(0.0, 0.4, lum));
  col *= mix(vec3(0.96, 0.99, 1.06), vec3(1.035, 1.0, 0.96), smoothstep(0.1, 0.8, lum));
  // night-mode floor lift: the deep shadows only (below lum 0.08, smooth rolloff), then a highlight rolloff so nothing but
  // true clips (headlamp, beacons, sign cores) reaches 255
  col = col * 0.97 + 0.006 + 0.010 * (1.0 - smoothstep(0.0, 0.08, lum));
  col -= 0.05 * pow(smoothstep(0.72, 1.0, col), vec3(2.0));
  col *= 1.0 - 0.36 * smoothstep(0.12, 0.95, r2 * 1.5);
  // grain: per-pixel + smoothly interpolated value noise at 4 px and 12 px (no 4x4 checkerboard) + soft chroma blotches,
  // 1.5x denser in the lifted shadows where night mode amplifies it
  float gs = max(uRes.y / 1024.0 * 0.75, 1.0); vec2 gp = floor(vUv * uRes / gs);
  float n1 = hash12(gp + uSeed * 13.0) - 0.5; float n2 = hash12(gp + uSeed * 29.0 + 101.0) - 0.5; float n3 = hash12(gp + uSeed * 47.0 + 202.0) - 0.5;
  float nb4 = vnoise(gp * 0.25 + uSeed * 7.0) - 0.5;
  float nb12 = vnoise(gp / 12.0 + uSeed * 3.0 + 50.0) - 0.5;
  float cR = vnoise(gp / 12.0 + uSeed * 5.0 + 90.0) - 0.5; float cB = vnoise(gp / 14.0 + uSeed * 9.0 + 130.0) - 0.5;
  float ga = 0.040 * (1.0 - 0.75 * smoothstep(0.0, 0.8, lum)) * (1.0 + 0.5 * (1.0 - smoothstep(0.0, 0.08, lum)));
  col += vec3(n1 * 0.5 + nb4 * 0.35 + nb12 * 0.25) * ga + vec3(n2, n3, -n2) * ga * 0.2 + vec3(cR, 0.0, cB) * ga * 0.4;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------------------------
function makeLattice(rnd, n) { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; }
function latticeSample(a, n, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y); const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % n) + n) % n, x1 = (x0 + 1) % n, y0 = ((yi % n) + n) % n, y1 = (y0 + 1) % n;
  const v00 = a[y0 * n + x0], v10 = a[y0 * n + x1], v01 = a[y1 * n + x0], v11 = a[y1 * n + x1];
  return (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
}
function fbm(L, u, v, persist) { let s = 0, wsum = 0, w = 1; for (let o = 0; o < L.length; o++) { s += w * latticeSample(L[o].a, L[o].n, u * L[o].n, v * L[o].n); wsum += w; w *= persist; } return s / wsum; }

function makeNoiseTexture(rnd, size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size); const d = img.data;
  const L = [8, 16, 32, 64, 128].map(n => ({ n, a: makeLattice(rnd, n) }));
  const L2 = [8, 16, 32, 64, 128].map(n => ({ n, a: makeLattice(rnd, n) }));
  const LB = [4, 8, 16].map(n => ({ n, a: makeLattice(rnd, n) }));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const r = fbm(L, u, v, 0.55), g = fbm(L2, u, v, 0.55), b = fbm(LB, u, v, 0.5);
    const i = (y * size + x) * 4;
    d[i] = Math.round(255 * Math.min(1, Math.max(0, (r - 0.5) * 1.6 + 0.5)));
    d[i + 1] = Math.round(255 * Math.min(1, Math.max(0, (g - 0.5) * 1.6 + 0.5)));
    d[i + 2] = Math.round(255 * Math.min(1, Math.max(0, (b - 0.5) * 1.8 + 0.5)));
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

// Board-formed concrete tile (10 m): 5-octave aggregate noise, boards with per-board tone/wobble, panel joints, tie holes,
// stretched weathering streaks, damp blotches. Cold grey.
function makeConcreteTexture(rnd, size = 1024) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size); const d = img.data;
  const L = [16, 32, 64, 128, 256].map(n => ({ n, a: makeLattice(rnd, n) }));
  const streakL = { n: 128, a: makeLattice(rnd, 128) };
  const boards = 34; const boardH = size / boards;
  const boardTone = new Float32Array(boards + 1); for (let i = 0; i <= boards; i++) boardTone[i] = 0.91 + 0.18 * rnd();
  const boardOff = new Float32Array(boards + 1); for (let i = 0; i <= boards; i++) boardOff[i] = (rnd() - 0.5) * 2.0;
  const joints = 5; const jointW = size / joints;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const n = fbm(L, u, v, 0.36);
    let val = 0.62 + (n - 0.5) * 0.17;
    const by = y / boardH; const bi = Math.floor(by); const bf = by - bi;
    val *= boardTone[bi];
    const wob = boardOff[bi] * 0.004 * Math.sin(u * 31.0 + bi);
    const bfw = bf + wob;
    // round 3: joint contrast cut ~60% (the 1 m tie-hole / joint grid read as masonry); boards stay 0.3 m x long, tie holes 2.5 m apart
    if (bfw < 0.045) val *= 0.8; else if (bfw < 0.09) val *= 0.92; else if (bfw > 0.94) val *= 1.04;
    val *= 1.0 + 0.02 * Math.sin((u * 220.0 + bi * 7.0) + 4.0 * latticeSample(L[2].a, 64, u * 64, v * 64));
    const jx = (x % jointW) / jointW;
    if (jx < 0.010 || jx > 0.990) val *= 0.78;
    const hx = ((x + jointW * 0.625) % (jointW * 1.25)) - jointW * 0.625; const hy = ((y + boardH * 4.25) % (boardH * 8.5)) - boardH * 4.25;
    const hr = Math.sqrt(hx * hx + hy * hy);
    if (hr < size * 0.005) val *= 0.62; else if (hr < size * 0.008) val *= 0.9;
    const s = latticeSample(streakL.a, 128, u * 128 * 0.5, v * 2.0);
    const s2 = latticeSample(streakL.a, 128, u * 128 * 1.5 + 7, v * 6.0);
    const streak = Math.max(0, (s * 0.7 + s2 * 0.3) - 0.52) * 1.6;
    val *= 1.0 - 0.30 * streak;
    const bl = latticeSample(L[0].a, 16, u * 16 + 3, v * 16 + 5);
    val *= 1.0 - 0.18 * Math.max(0, bl - 0.6) * 2.5;
    val = Math.min(1, Math.max(0, val));
    const i = (y * size + x) * 4;
    const tintB = 1.0 + 0.03 * (n - 0.5);
    d[i] = Math.round(255 * val * 0.98); d[i + 1] = Math.round(255 * val * 0.985); d[i + 2] = Math.round(255 * Math.min(1, val * tintB)); d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}

// FBM-alpha haze card (gamma): broken, cloudy alpha times a radial falloff
function makeHazeTexture(rnd, S = 512) {
  const L = [2, 4, 8, 16].map(n => ({ n, a: makeLattice(rnd, n) }));
  const c = document.createElement('canvas'); c.width = c.height = S; const ctx = c.getContext('2d'); const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const k = (y * S + x) * 4; const n = fbm(L, x / S, y / S, 0.55);
    const dx = x / S - 0.5, dy = y / S - 0.5; const rad = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2.1);
    const a = Math.pow(Math.max(0, (n - 0.3) / 0.7), 1.3) * rad * rad;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = Math.min(255, a * 300);
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
}
function makeGlowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.10)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
}

// ---------------------------------------------------------------------------------------------
// Hologram ad content: white-on-black canvas (tinted in the shader). Real Japanese (IPAGothic) + latin + UI chrome.
// ---------------------------------------------------------------------------------------------
const JP = '"IPAGothic","IPAPGothic","Noto Sans CJK JP","Unifont-JP",sans-serif';
const EN = '"DejaVu Sans","Liberation Sans",Helvetica,Arial,sans-serif';
const WORDS = ['NEON', 'ARCO', 'SECTOR 9', 'MIDNIGHT', 'KAZE', 'ORBITAL', 'DRIFT', 'CORE', 'HELIX', 'ZEN', 'TOKYO-3', 'NOVA', 'ULTRA', 'SYNTH', 'VOLT', 'ONI', 'GHOST', 'NEXUS', 'LIVE', 'SORA', 'TRANSIT', 'MIRAI', 'AXIS'];
const JWORDS = ['未来都市', '電脳街', '深夜食堂', 'ようこそ', '警告', '立入禁止', '次の駅', '中央広場', '新宿第七区', '生きろ', '接続中', '営業中', '上昇', '出口', '危険', '合成皮膚', '全てを見ている', '信号喪失', '遅延', '夜市', '空港線', '記憶', '再起動'];
// round 2: every word is drawn twice - a soft halo pass at alpha 0.3, then a crisp pass with a tiny blur - so glyph cores stay
// legible and hard-edged (the old single blurred pass smeared them into cellophane)
let INK = '#fff';   // round 4: current glyph colour (the coloured-palette billboards draw cyan / magenta ink on black)
function glowText(ctx, txt, x, y, font, blur, align = 'center', base = 'middle', alpha = 1) {
  ctx.font = font; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillStyle = INK;
  ctx.globalAlpha = 0.3 * alpha; ctx.shadowColor = INK; ctx.shadowBlur = blur; ctx.fillText(txt, x, y);
  ctx.globalAlpha = alpha; ctx.shadowBlur = Math.min(blur * 0.2, 2.5); ctx.fillText(txt, x, y); ctx.fillText(txt, x, y);
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
}
// simple vector icons for the designed ads (eye, cup, rising arrow, target, bottle)
function drawIcon(ctx, kind, cx, cy, s, ink = '#fff') {
  ctx.save(); ctx.translate(cx, cy); ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = s * 0.09; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (kind === 0) { ctx.beginPath(); ctx.moveTo(-s * 0.5, 0); ctx.quadraticCurveTo(0, -s * 0.55, s * 0.5, 0); ctx.quadraticCurveTo(0, s * 0.55, -s * 0.5, 0); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, s * 0.17, 0, Math.PI * 2); ctx.fill(); }
  else if (kind === 1) { ctx.beginPath(); ctx.moveTo(-s * 0.35, -s * 0.25); ctx.lineTo(-s * 0.28, s * 0.35); ctx.lineTo(s * 0.22, s * 0.35); ctx.lineTo(s * 0.3, -s * 0.25); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.arc(s * 0.38, 0, s * 0.14, -Math.PI / 2, Math.PI / 2); ctx.stroke(); for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * s * 0.13, -s * 0.35); ctx.quadraticCurveTo(i * s * 0.13 + s * 0.08, -s * 0.45, i * s * 0.13, -s * 0.55); ctx.stroke(); } }
  else if (kind === 2) { ctx.beginPath(); ctx.moveTo(-s * 0.45, s * 0.4); ctx.lineTo(-s * 0.1, 0); ctx.lineTo(s * 0.1, s * 0.15); ctx.lineTo(s * 0.45, -s * 0.4); ctx.stroke(); ctx.beginPath(); ctx.moveTo(s * 0.2, -s * 0.4); ctx.lineTo(s * 0.45, -s * 0.4); ctx.lineTo(s * 0.45, -s * 0.15); ctx.stroke(); }
  else if (kind === 3) { ctx.beginPath(); ctx.arc(0, 0, s * 0.45, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, s * 0.25, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, s * 0.07, 0, Math.PI * 2); ctx.fill(); }
  else { ctx.beginPath(); ctx.moveTo(-s * 0.18, -s * 0.5); ctx.lineTo(s * 0.18, -s * 0.5); ctx.lineTo(s * 0.18, -s * 0.3); ctx.lineTo(s * 0.3, -s * 0.1); ctx.lineTo(s * 0.3, s * 0.5); ctx.lineTo(-s * 0.3, s * 0.5); ctx.lineTo(-s * 0.3, -s * 0.1); ctx.lineTo(-s * 0.18, -s * 0.3); ctx.closePath(); ctx.stroke(); ctx.fillRect(-s * 0.22, s * 0.05, s * 0.44, s * 0.22); }
  ctx.restore();
}
function fitFont(ctx, txt, maxW, size, font) { let fs = size; ctx.font = `bold ${Math.round(fs)}px ${font}`; while (ctx.measureText(txt).width > maxW && fs > 8) { fs *= 0.92; ctx.font = `bold ${Math.round(fs)}px ${font}`; } return ctx.font; }
function makeHoloTexture(rnd, w, h, kind, o = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  const ink = o.ink || {}; const inkB = ink.border || '#fff', inkT = ink.text || '#fff', inkI = ink.icon || '#fff', inkS = ink.sub || '#fff';
  ctx.fillStyle = inkB; ctx.strokeStyle = inkB; INK = '#fff';
  const word = o.word || WORDS[Math.floor(rnd() * WORDS.length)];
  const jword = o.jword || JWORDS[Math.floor(rnd() * JWORDS.length)];
  const m = Math.min(w, h);
  ctx.lineWidth = m * 0.012; ctx.globalAlpha = 0.7; ctx.strokeRect(m * 0.04, m * 0.04, w - m * 0.08, h - m * 0.08); ctx.globalAlpha = 1;
  ctx.lineWidth = m * 0.02;
  for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const px = cx ? w - m * 0.1 : m * 0.1, py = cy ? h - m * 0.1 : m * 0.1; ctx.beginPath(); ctx.moveTo(px, py + (cy ? -1 : 1) * m * 0.06); ctx.lineTo(px, py); ctx.lineTo(px + (cx ? -1 : 1) * m * 0.06, py); ctx.stroke(); }
  if (kind === 'billboard') {
    // facade-scale designed ad (ref 1): heavy border, an icon in a roundel, a headline >= 1/4 of the panel height, a kanji
    // line, a price / tagline strip and a barcode block. Drawn crisp.
    ctx.lineWidth = h * 0.022; ctx.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1);
    ctx.lineWidth = h * 0.008; ctx.strokeRect(h * 0.085, h * 0.085, w - h * 0.17, h - h * 0.17);
    const icon = o.icon !== undefined ? o.icon : Math.floor(rnd() * 5);
    ctx.strokeStyle = inkI; ctx.lineWidth = h * 0.012; ctx.beginPath(); ctx.arc(h * 0.33, h * 0.36, h * 0.2, 0, Math.PI * 2); ctx.stroke();
    drawIcon(ctx, icon, h * 0.33, h * 0.36, h * 0.3, inkI);
    INK = inkT; const f = fitFont(ctx, word, w - h * 0.75, h * 0.34, EN); glowText(ctx, word, h * 0.6, h * 0.36, f, h * 0.06, 'left');
    INK = inkS; const f2 = fitFont(ctx, jword, w * 0.6, h * 0.19, JP); glowText(ctx, jword, h * 0.6, h * 0.66, f2, h * 0.05, 'left');
    ctx.fillStyle = inkS; ctx.globalAlpha = 0.85; ctx.fillRect(h * 0.6, h * 0.79, w - h * 1.3, h * 0.012); ctx.globalAlpha = 1;
    ctx.font = `${Math.round(h * 0.085)}px ${EN}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText((rnd() < 0.5 ? '● LIVE  ' : '▶ NOW  ') + `SEC-${Math.floor(rnd() * 90 + 10)}   ¥${120 + Math.floor(rnd() * 8800)}`, h * 0.6, h * 0.87);
    let bx = w - h * 0.62; while (bx < w - h * 0.14) { const bw = h * (0.006 + 0.016 * rnd()); ctx.globalAlpha = rnd() < 0.5 ? 1 : 0.45; ctx.fillRect(bx, h * 0.80, bw, h * 0.13); bx += bw + h * (0.006 + 0.012 * rnd()); } ctx.globalAlpha = 1;
    ctx.font = `bold ${Math.round(h * 0.07)}px ${EN}`; ctx.textAlign = 'right'; ctx.fillText('AD', w - h * 0.14, h * 0.17);
  } else if (kind === 'exit') {
    // round 4: legible wayfinding sign - running-man pictogram, door, arrow, EXIT below, 出口 above
    ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    glowText(ctx, '出口', w * 0.5, h * 0.12, `bold ${Math.round(w * 0.30)}px ${JP}`, w * 0.03);
    ctx.lineWidth = w * 0.075;
    ctx.beginPath(); ctx.arc(w * 0.40, h * 0.30, w * 0.075, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w * 0.42, h * 0.37); ctx.lineTo(w * 0.34, h * 0.49); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w * 0.41, h * 0.40); ctx.lineTo(w * 0.26, h * 0.45); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w * 0.41, h * 0.40); ctx.lineTo(w * 0.56, h * 0.36); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w * 0.34, h * 0.49); ctx.lineTo(w * 0.22, h * 0.55); ctx.lineTo(w * 0.27, h * 0.62); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w * 0.34, h * 0.49); ctx.lineTo(w * 0.50, h * 0.54); ctx.lineTo(w * 0.52, h * 0.64); ctx.stroke();
    ctx.lineWidth = w * 0.05; ctx.strokeRect(w * 0.62, h * 0.27, w * 0.24, h * 0.38);
    ctx.lineWidth = w * 0.07; ctx.beginPath(); ctx.moveTo(w * 0.30, h * 0.74); ctx.lineTo(w * 0.72, h * 0.74); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w * 0.62, h * 0.70); ctx.lineTo(w * 0.74, h * 0.74); ctx.lineTo(w * 0.62, h * 0.78); ctx.stroke();
    const f = fitFont(ctx, word, w * 0.86, h * 0.13, EN); glowText(ctx, word, w * 0.5, h * 0.88, f, w * 0.03);
  } else if (kind === 'blade') {
    // stacked kanji blade sign: one glyph per cell, each in its own box, a small latin word at the foot
    const n = Math.min(jword.length, 6); const cellH = (h * 0.84) / n; const gs = Math.min(w * 0.78, cellH * 0.8);
    for (let i = 0; i < n; i++) {
      const cy = h * 0.06 + cellH * (i + 0.5);
      ctx.lineWidth = m * 0.02; ctx.globalAlpha = 0.5; ctx.strokeRect(w * 0.1, cy - cellH * 0.47, w * 0.8, cellH * 0.94); ctx.globalAlpha = 1;
      glowText(ctx, jword[i], w * 0.5, cy, `bold ${Math.round(gs)}px ${JP}`, gs * 0.1);
    }
    ctx.save(); ctx.translate(w * 0.5, h * 0.96); const f = fitFont(ctx, word, w * 0.9, w * 0.2, EN); glowText(ctx, word, 0, 0, f, w * 0.03); ctx.restore();
  } else if (kind === 'banner') {
    ctx.lineWidth = m * 0.05; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.11, m * 0.2, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.11 - m * 0.12); ctx.lineTo(w * 0.5 + m * 0.1, h * 0.11 + m * 0.07); ctx.lineTo(w * 0.5 - m * 0.1, h * 0.11 + m * 0.07); ctx.closePath(); ctx.fill();
    const gs = w * 0.62; let y = h * 0.21 + gs * 0.5;
    for (const ch of jword) { if (y > h * 0.74) break; glowText(ctx, ch, w * 0.5, y, `bold ${Math.round(gs)}px ${JP}`, gs * 0.12); y += gs * 1.08; }
    ctx.save(); ctx.translate(w * 0.5, h * 0.93); ctx.rotate(-Math.PI / 2);
    const f = fitFont(ctx, word, h * 0.17, w * 0.4, EN); glowText(ctx, word, 0, 0, f, w * 0.05, 'left');
    ctx.restore();
    for (let i = 0; i < 6; i++) { ctx.globalAlpha = 0.5 + 0.5 * rnd(); ctx.fillRect(w * 0.1, h * (0.80 + i * 0.011), w * (0.1 + 0.3 * rnd()), h * 0.004); } ctx.globalAlpha = 1;
  } else if (kind === 'portrait') {
    // round 3: facade-scale translucent vertical hologram (ref 1's whole-facade ads): a head-and-shoulders silhouette filled
    // at half alpha inside a halo ring, a visor line, stacked kanji down the right edge, a word and data lines at the foot
    const cx = w * 0.42, cy = h * 0.27, hr = w * 0.19;
    ctx.globalAlpha = 0.3; ctx.lineWidth = w * 0.02; ctx.beginPath(); ctx.arc(cx, cy + hr * 0.3, hr * 2.1, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.ellipse(cx, cy, hr * 0.78, hr, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx - hr * 0.35, cy + hr * 0.95); ctx.lineTo(cx + hr * 0.35, cy + hr * 0.95); ctx.lineTo(cx + hr * 2.0, cy + hr * 2.4); ctx.lineTo(cx + hr * 2.2, h * 0.60); ctx.lineTo(cx - hr * 2.2, h * 0.60); ctx.lineTo(cx - hr * 2.0, cy + hr * 2.4); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillRect(cx - hr * 0.62, cy - hr * 0.12, hr * 1.24, hr * 0.14);
    const gs = w * 0.17; let y = h * 0.10 + gs * 0.5;
    for (const ch of jword) { if (y > h * 0.84) break; glowText(ctx, ch, w * 0.86, y, `bold ${Math.round(gs)}px ${JP}`, gs * 0.12); y += gs * 1.12; }
    const f = fitFont(ctx, word, w * 0.66, h * 0.065, EN); glowText(ctx, word, w * 0.42, h * 0.70, f, h * 0.02);
    for (let i = 0; i < 9; i++) { ctx.globalAlpha = 0.35 + 0.5 * rnd(); ctx.fillRect(w * 0.1, h * (0.77 + i * 0.019), w * (0.1 + 0.5 * rnd()), h * 0.006); } ctx.globalAlpha = 1;
  } else if (kind === 'wide') {
    const f = fitFont(ctx, word, w * 0.78, h * 0.40, EN); glowText(ctx, word, w * 0.5, h * 0.36, f, h * 0.06);
    const f2 = fitFont(ctx, jword, w * 0.8, h * 0.26, JP); glowText(ctx, jword, w * 0.5, h * 0.68, f2, h * 0.05);
    let bx = w * 0.08; while (bx < w * 0.35) { const bw = w * (0.004 + 0.012 * rnd()); ctx.globalAlpha = rnd() < 0.5 ? 1 : 0.4; ctx.fillRect(bx, h * 0.11, bw, h * 0.09); bx += bw + w * (0.004 + 0.01 * rnd()); } ctx.globalAlpha = 1;
    ctx.font = `${Math.round(h * 0.09)}px ${EN}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText('¥' + (120 + Math.floor(rnd() * 8800)), w * 0.92, h * 0.155);
    ctx.lineWidth = h * 0.03; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.155, h * 0.06, 0, Math.PI * 2); ctx.stroke();
    ctx.font = `${Math.round(h * 0.075)}px ${EN}`; ctx.textAlign = 'left'; ctx.globalAlpha = 0.8; ctx.fillText((rnd() < 0.5 ? '● LIVE  ' : '▶ NOW  ') + `SEC-${Math.floor(rnd() * 90 + 10)}`, w * 0.08, h * 0.87); ctx.globalAlpha = 1;
  } else { // ticker
    let x = h * 0.3; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    while (x < w - h) {
      const t = rnd();
      if (t < 0.3) { ctx.font = `bold ${Math.round(h * 0.6)}px ${EN}`; const s = (rnd() < 0.5 ? '▲' : '▼') + (rnd() * 99).toFixed(2) + '%'; ctx.fillText(s, x, h * 0.5); x += ctx.measureText(s).width + h * 0.5; }
      else if (t < 0.65) { ctx.font = `bold ${Math.round(h * 0.66)}px ${JP}`; const s = JWORDS[Math.floor(rnd() * JWORDS.length)]; ctx.fillText(s, x, h * 0.5); x += ctx.measureText(s).width + h * 0.5; }
      else if (t < 0.85) { ctx.font = `bold ${Math.round(h * 0.6)}px ${EN}`; const s = WORDS[Math.floor(rnd() * WORDS.length)]; ctx.fillText(s, x, h * 0.5); x += ctx.measureText(s).width + h * 0.5; }
      else { ctx.fillRect(x, h * 0.3, h * 0.12, h * 0.4); ctx.fillRect(x + h * 0.2, h * 0.45, h * 0.6, h * 0.1); x += h * 1.1; }
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------------------------
// Facade band styles (beta): dense small bands alternate with big voids / bays; ledges on void/arcade/bay bands
// ---------------------------------------------------------------------------------------------
function makeStyle(rnd, H, profile, startY = 0, litMul = 1, forced = []) {
  forced = forced.slice();   // [{y, kind}] - when the band cursor passes y, the next band is of that kind (round 2: big voids mid-facet)
  const R = (a, b) => a + (b - a) * rnd();
  const kinds = {
    grid: () => { const colW = R(3.6, 5.2), rowH = R(3.6, 4.4); return { type: 0, colW, rowH, winW: colW * R(0.42, 0.6), winH: rowH * R(0.5, 0.64), depth: R(1.0, 2.4), lit: R(0.15, 0.42), merge: R(0, 0.3), blank: R(0.02, 0.12), rows: Math.round(R(3, 9)) }; },
    squares: () => { const colW = R(2.4, 3.2), rowH = colW; return { type: 0, colW, rowH, winW: colW * R(0.48, 0.58), winH: rowH * R(0.48, 0.58), depth: R(0.7, 1.4), lit: R(0.2, 0.5), merge: 0, blank: R(0, 0.08), rows: Math.round(R(4, 12)) }; },
    slits: () => { const colW = R(1.5, 2.2), rowH = R(3.6, 4.2); return { type: 1, colW, rowH, winW: colW * R(0.22, 0.32), winH: rowH * R(0.7, 0.84), depth: R(0.5, 1.3), lit: R(0.08, 0.3), merge: 0, blank: R(0, 0.05), rows: Math.round(R(2, 7)) }; },
    bays: () => { const colW = R(5.5, 8.5), rowH = R(9, 14); return { type: 0, colW, rowH, winW: colW * R(0.5, 0.64), winH: rowH * R(0.74, 0.86), depth: R(1.8, 3.4), lit: R(0.3, 0.6), merge: R(0, 0.15), blank: R(0, 0.08), rows: Math.round(R(1, 3)) }; },
    voids: () => { const colW = R(12, 20), rowH = R(8, 13); return { type: 2, colW, rowH, winW: colW * R(0.7, 0.84), winH: rowH * R(0.68, 0.8), depth: R(4, 7), lit: R(0.5, 0.9), merge: R(0, 0.2), blank: R(0, 0.12), rows: Math.round(R(1, 2)) }; },
    ribs: () => { const colW = R(1.2, 1.9), rowH = R(12, 28); return { type: 3, colW, rowH, winW: colW * R(0.3, 0.42), winH: rowH, depth: R(0.9, 1.8), lit: 0, merge: 0, blank: 0, rows: 1 }; },
    blank: () => ({ type: 4, colW: 4, rowH: R(3, 9), winW: 0, winH: 0, depth: 0, lit: 0, merge: 0, blank: 0, rows: 1 }),
    deepbays: () => { const colW = R(7, 10), rowH = R(12, 18); return { type: 0, colW, rowH, winW: colW * R(0.55, 0.68), winH: rowH * R(0.72, 0.84), depth: R(3.5, 6.0), lit: R(0.3, 0.55), merge: R(0, 0.1), blank: R(0, 0.06), rows: Math.round(R(1, 3)) }; },
    arcade: () => { const colW = R(16, 24), rowH = R(18, 26); return { type: 2, colW, rowH, winW: colW * R(0.6, 0.75), winH: rowH * R(0.7, 0.8), depth: R(7, 11), lit: R(0.35, 0.6), merge: 0, blank: R(0, 0.1), rows: 1 }; },
    matrix: () => { const colW = R(2.6, 3.6), rowH = R(2.8, 3.6); return { type: 0, colW, rowH, winW: colW * R(0.5, 0.62), winH: rowH * R(0.5, 0.62), depth: R(0.6, 1.2), lit: R(0.45, 0.75), merge: 0, blank: R(0, 0.05), rows: Math.round(R(10, 40)) }; },
  };
  const weights = profile === 'bg'
    ? { matrix: 5, grid: 2, slits: 1, blank: 0.5, bays: 1 }
    : profile === 'podium' ? { arcade: 4, slits: 2, voids: 2, ribs: 1, blank: 1 }
    : profile === 'facet' ? { slits: 3, ribs: 3, squares: 1.5, blank: 1 }
    // round 3: the facet is rows of large deep bays + ribbed fins, mostly dark; the centre body and the right lower block use the
    // left tower's 'leftface' recipe (deep bays / voids / arcades, minimum opening ~4x5 m, no slits / small grids)
    : profile === 'facetBig' ? { deepbays: 2.5, arcade: 1.2, ribs: 3, blank: 3 }
    : profile === 'leftface' ? { deepbays: 3.5, voids: 1.5, blank: 1.5, ribs: 1.2, slits: 0.5 }
    : profile === 'quiet' ? { slits: 3, squares: 2, grid: 2, ribs: 1.5, blank: 2, bays: 1 }
    : profile === 'crown' ? { bays: 2.5, voids: 2, ribs: 2, blank: 2.2, grid: 1, slits: 0.8 }
    : profile === 'ribs' ? { ribs: 3, blank: 1 }
    : profile === 'zlower' ? { voids: 3, deepbays: 2.5, bays: 2, blank: 1.5, arcade: 1, ribs: 0.8 }
    : profile === 'body' ? { deepbays: 3.5, voids: 2, arcade: 1, blank: 1.5, bays: 1.5, ribs: 1 }
      : { grid: 3, squares: 2.5, slits: 3, bays: 2, voids: 2.5, ribs: 1.5, blank: 1.2 };
  const names = Object.keys(weights);
  const pick = (prev) => {
    let tot = 0; const ws = names.map(n => { let w = weights[n]; if (n === prev) w *= 0.15; if ((prev === 'slits' || prev === 'squares' || prev === 'matrix') && (n === 'voids' || n === 'bays')) w *= 2.2; if ((prev === 'voids' || prev === 'bays') && (n === 'slits' || n === 'squares')) w *= 2.0; tot += w; return w; });
    let r = rnd() * tot; for (let i = 0; i < names.length; i++) { r -= ws[i]; if (r <= 0) return names[i]; } return names[names.length - 1];
  };
  const bands = []; let y = startY; let prev = null;
  if (profile === 'main') { const b = kinds.arcade(); b.name = 'arcade'; b.y0 = y; b.y1 = y + b.rowH; b.ledge = true; bands.push(b); y = b.y1; prev = 'arcade'; }
  while (y < H && bands.length < MAXB - 1) {
    let name = pick(prev);
    if (forced.length && y >= forced[0].y) name = forced.shift().kind;
    const b = kinds[name](); b.name = name;
    b.y0 = y; b.y1 = Math.min(H + 50, y + b.rows * b.rowH); y = b.y1; prev = name;
    b.ledge = (name === 'voids' || name === 'arcade' || name === 'bays') ? rnd() < 0.8 : rnd() < 0.3;
    b.cool = R(0.15, 0.4); b.lit *= litMul;
    // round 2: lit/dark ratio varies per band (some bands 60% lit, some nearly dark) so facades are not uniform sieves
    const lr = rnd(); b.lit *= lr < 0.2 ? 0.15 : (lr < 0.4 ? 1.8 : 1.0);
    bands.push(b);
  }
  const A = new Float32Array(MAXB * 4), B = new Float32Array(MAXB * 4), C = new Float32Array(MAXB * 4);
  bands.forEach((b, i) => { A.set([b.y0, b.y1, b.colW, b.rowH], i * 4); B.set([b.winW, b.winH, b.depth, b.type], i * 4); C.set([b.lit, b.merge, b.cool, b.blank], i * 4); });
  return { bands, A, B, C, n: bands.length };
}

// ---------------------------------------------------------------------------------------------
// World-space triplanar board-formed concrete with weathering streaks (delta) for every MeshStandardMaterial piece
// ---------------------------------------------------------------------------------------------
function makeConcreteMaterial(map, noise, opt = {}) {
  const m = new THREE.MeshStandardMaterial({ color: opt.color || 0x8f9094, roughness: opt.roughness ?? 0.94, metalness: 0.0, map, bumpMap: map, bumpScale: opt.bumpScale ?? 0.35 });
  const triScale = 1 / (opt.tile || 10);
  m.onBeforeCompile = (s) => {
    s.uniforms.triScale = { value: triScale };
    s.uniforms.weatherAmt = { value: opt.weather ?? 0.45 };
    s.uniforms.tWeather = { value: noise };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 twp = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          twp = instanceMatrix * twp;
        #endif
        twp = modelMatrix * twp; vWP = twp.xyz;
        vWN = normalize( ( vec4( transformedNormal, 0.0 ) * viewMatrix ).xyz );`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP; varying vec3 vWN; uniform float triScale; uniform float weatherAmt; uniform sampler2D tWeather;
        vec3 triW( vec3 n ){ vec3 w = abs( n ); w = w * w * w * w; return w / ( w.x + w.y + w.z + 1e-5 ); }
        vec4 triSample( sampler2D t, vec3 p, vec3 w ){ return texture2D( t, p.yz ) * w.x + texture2D( t, p.xz ) * w.y + texture2D( t, p.xy ) * w.z; }`)
      .replace('#include <bumpmap_pars_fragment>', `
        uniform sampler2D bumpMap; uniform float bumpScale;
        float triH( vec3 p, vec3 w ){ return triSample( bumpMap, p, w ).r; }
        vec2 dHdxy_fwd() {
          vec3 tw = triW( vWN ); vec3 tp = vWP * triScale;
          vec3 dx = dFdx( tp ); vec3 dy = dFdy( tp );
          float Hll = bumpScale * triH( tp, tw );
          float dBx = bumpScale * triH( tp + dx, tw ) - Hll;
          float dBy = bumpScale * triH( tp + dy, tw ) - Hll;
          return vec2( dBx, dBy );
        }
        vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
          vec3 vSigmaX = normalize( dFdx( surf_pos ) ); vec3 vSigmaY = normalize( dFdy( surf_pos ) ); vec3 vN = surf_norm;
          vec3 R1 = cross( vSigmaY, vN ); vec3 R2 = cross( vN, vSigmaX );
          float fDet = dot( vSigmaX, R1 ) * faceDirection;
          vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
          return normalize( abs( fDet ) * surf_norm - vGrad );
        }`)
      .replace('#include <map_fragment>', `
        vec3 tw = triW( vWN ); vec3 tp = vWP * triScale;
        vec4 sampledDiffuseColor = triSample( map, tp, tw );
        float stk = texture2D( tWeather, vec2( ( vWP.x * 0.71 + vWP.z * 0.43 ) * 0.019, vWP.y * 0.0021 ) ).g;
        float big = texture2D( tWeather, vec2( vWP.x * 0.0031 + vWP.y * 0.0009, vWP.z * 0.0031 + vWP.y * 0.0014 ) ).b;
        float weather = 1.0 - weatherAmt * smoothstep( 0.50, 0.80, stk ) * ( 0.4 + 0.6 * big );
        weather *= 0.84 + 0.32 * big;
        diffuseColor.rgb *= sampledDiffuseColor.rgb * weather;`);
  };
  return m;
}

// =============================================================================================
export default async function (canvas, opts) {
  const { width, height, seed, quality, log } = opts;
  const PARAMS = opts.params || {};
  const SHDBG = !!PARAMS.shadowdebug;
  const t0 = performance.now();
  const rnd = mulberry32(seed);
  const isFinal = quality === 'final';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
  // round 3: one 2048 PCFSoft shadow map on the key (rendered once; the two reflectors reuse it)
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  const fogCol = new THREE.Color(0.036, 0.042, 0.056);
  const fogDen = 0.0015;   // round 3: 0.0018 -> 0.0015 so tower tops keep some of their own darkness against the haze-lit sky
  scene.background = fogCol.clone();
  scene.fog = new THREE.FogExp2(fogCol.getHex(), fogDen);

  // ---- key light (the only directional source; lateral from the upper left so every mass has a lit side and a dark side) with
  // the cast-shadow map fitted to dome + mid viaduct + near landing + walkway (x -150..70, y -6..100, z -240..5). The map is
  // allocated here so the custom shaders can sample it (packed RGBA depth) with the same matrix three uses.
  const SHADOW_RES = 2048;
  const KEYPOS = V3(-900, 440, 300), KEYTGT = V3(0, 0, -150);
  const keyDir = KEYPOS.clone().sub(KEYTGT).normalize();
  const key = new THREE.DirectionalLight(0x62708c, 0.5); key.position.copy(KEYPOS); key.target.position.copy(KEYTGT); scene.add(key); scene.add(key.target);
  key.castShadow = true; key.shadow.mapSize.set(SHADOW_RES, SHADOW_RES); key.shadow.bias = -0.0002; key.shadow.normalBias = 0.15; key.shadow.radius = 2;
  {
    const sc = key.shadow.camera; sc.position.copy(KEYPOS); sc.lookAt(KEYTGT); sc.updateMatrixWorld(true);
    const mn = V3(1e9, 1e9, 1e9), mx = V3(-1e9, -1e9, -1e9);
    for (const x of [-150, 70]) for (const y of [-6, 100]) for (const z of [-240, 5]) { const q = V3(x, y, z).applyMatrix4(sc.matrixWorldInverse); mn.min(q); mx.max(q); }
    sc.left = mn.x; sc.right = mx.x; sc.bottom = mn.y; sc.top = mx.y; sc.near = -mx.z - 5; sc.far = -mn.z + 5; sc.updateProjectionMatrix();
    key.shadow.map = new THREE.WebGLRenderTarget(SHADOW_RES, SHADOW_RES, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    key.shadow.map.texture.name = 'key.shadowMap';
    scene.updateMatrixWorld(true); key.shadow.updateMatrices(key);
    log('shadow frustum', (mx.x - mn.x).toFixed(0), 'x', (mx.y - mn.y).toFixed(0), 'm, depth', (sc.far - sc.near).toFixed(0), 'm');
  }

  // Camera: 13mm-ish ultra-wide in portrait, tilted up hard, Dutch roll (beta). The photographer stands on an elevated walkway
  // 20 m above the plaza (the sketch's dome spanning 55-93% of the frame and its viaduct diagonal descending to the lower-right
  // are only consistent with a viewpoint above the plaza); the towers still loom from a low angle.
  const CAMY = 22, WALKY = CAMY - 2;
  const camera = new THREE.PerspectiveCamera(82, width / height, 0.5, 6000);
  camera.position.set(0, CAMY, 0); camera.rotation.order = 'YXZ';
  const D2R = THREE.MathUtils.degToRad;
  camera.rotation.set(D2R(27), D2R(-2.5), D2R(7));   // round 3: 2.5 deg yaw right so the left slab's edge enters the top-left corner
  camera.updateMatrixWorld();
  // the walkway parapet line (world xz; y added where placed) and its right-hand (camera) side
  const pA = new THREE.Vector3(-1.2, 0, -5.0), pB = new THREE.Vector3(-52, 0, -78);
  const parDir = new THREE.Vector3().subVectors(pB, pA).normalize();
  const parRight = new THREE.Vector3(-parDir.z, 0, parDir.x);   // toward the plaza drop
  const parLeft = parRight.clone().negate();                         // the walkway (camera) side
  const proj = (p) => { const q = p.clone().project(camera); return `(${(50 + q.x * 50).toFixed(0)}%,${(50 - q.y * 50).toFixed(0)}%top)`; };

  // ---- textures
  const tNoise = makeNoiseTexture(mulberry32(seed * 7 + 1), 512);
  const tConc = makeConcreteTexture(mulberry32(seed * 11 + 3), 1024);
  const tHaze = makeHazeTexture(mulberry32(seed * 5 + 9), 512);
  const tGlow = makeGlowTexture();
  tConc.anisotropy = maxAniso; tNoise.anisotropy = Math.min(4, maxAniso);
  log('textures ok', (performance.now() - t0).toFixed(0) + 'ms');

  // ---- shared lighting uniforms
  const lightUniforms = {
    uLightN: { value: 0 },
    uLightPos: { value: Array.from({ length: MAXL }, () => new THREE.Vector3()) },
    uLightCol: { value: Array.from({ length: MAXL }, () => new THREE.Vector3()) },
    uLightRad: { value: new Float32Array(MAXL).fill(1) },
    // round 2: night exposure - hemisphere/ground cut ~60% so unlit concrete sits near black; ONE lateral key from the upper
    // left (-x) so every tower has a lit side and a shadow side (the left tower's +x face falls into shadow, rim-lit by holos)
    // round 3: chiaroscuro - uniform ambient 0.042 -> 0.025 and key 0.13 -> 0.08 (concrete away from signs at ~18-28/255 with
    // grain); the colour lives in the local sign spill
    uSkyCol: { value: new THREE.Vector3(0.025, 0.030, 0.040) },
    uGroundCol: { value: new THREE.Vector3(0.012, 0.010, 0.009) },
    uKeyDir: { value: keyDir.clone() },
    uKeyCol: { value: new THREE.Vector3(0.08, 0.088, 0.102) },
    uFogCol: { value: new THREE.Vector3(fogCol.r, fogCol.g, fogCol.b) },
    uFogDen: { value: fogDen },
    uLightSat: { value: 1.0 },
    tShadow: { value: key.shadow.map.texture },
    uShadowMat: { value: key.shadow.matrix },
    uShadowOn: { value: 1.0 },
    uShadowTexel: { value: new THREE.Vector2(1 / SHADOW_RES, 1 / SHADOW_RES) },
  };
  const holoLights = [];
  function addLight(pos, col, rad) { if (holoLights.length < MAXL) holoLights.push({ pos, col, rad }); }

  // ---- facade system: planar convex polygon faces (CCW from outside) with the recess shader; clip planes for N > 4
  const facadeGroup = new THREE.Group(); scene.add(facadeGroup);
  let facadeCount = 0;
  const emptyStyle = { n: 0, A: new Float32Array(MAXB * 4), B: new Float32Array(MAXB * 4), C: new Float32Array(MAXB * 4), bands: [] };
  function addFacade(pts, style, o = {}) {
    const N = pts.length; const pa = pts[0];
    const n = new THREE.Vector3().subVectors(pts[1], pa).cross(new THREE.Vector3().subVectors(pts[N - 1], pa)).normalize();
    let U = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), n);
    if (U.length() < 0.01) U = new THREE.Vector3(1, 0, 0); U.normalize();
    const V = new THREE.Vector3().crossVectors(n, U).normalize();
    const uv = pts.map(p => { const r = new THREE.Vector3().subVectors(p, pa); return [r.dot(U), r.dot(V)]; });
    const uMin = Math.min(...uv.map(x => x[0])), uMax = Math.max(...uv.map(x => x[0]));
    const vMin = Math.min(...uv.map(x => x[1])), vMax = Math.max(...uv.map(x => x[1])) - vMin;
    const uvs = uv.map(x => [x[0] - uMin, x[1] - vMin]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap(p => [p.x, p.y, p.z]), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
    const idx = []; for (let i = 1; i < N - 1; i++) idx.push(0, i, i + 1); geo.setIndex(idx);
    const clips = Array.from({ length: MAXC }, () => new THREE.Vector3()); let clipN = 0;
    if (N > 4 || o.clip) {
      for (let i = 0; i < N && clipN < MAXC; i++) {
        const a = uvs[i], b = uvs[(i + 1) % N]; const ex = b[0] - a[0], ey = b[1] - a[1]; const L = Math.hypot(ex, ey) || 1;
        const nx = -ey / L, ny = ex / L; clips[clipN++].set(nx, ny, -(nx * a[0] + ny * a[1]));
      }
    }
    const st = style || emptyStyle;
    const mat = new THREE.ShaderMaterial({
      vertexShader: FACADE_VERT, fragmentShader: FACADE_FRAG,
      uniforms: {
        ...lightUniforms, uLightSat: { value: 0.45 }, uFogMul: { value: o.fogMul || 1.0 },
        uU: { value: U }, uV: { value: V }, uN: { value: n },
        uW: { value: uMax - uMin }, uH: { value: vMax }, uSeed: { value: o.seed !== undefined ? o.seed : rnd() * 100 }, uEdge: { value: o.edge !== undefined ? o.edge : 4 },
        tConc: { value: tConc }, tNoise: { value: tNoise }, uTint: { value: o.tint || new THREE.Vector3(0.50, 0.505, 0.515) }, uTexScale: { value: o.texScale || 10 },
        uBandN: { value: st.n }, uBandA: { value: st.A }, uBandB: { value: st.B }, uBandC: { value: st.C },
        uClipN: { value: clipN }, uClip: { value: clips }, uAirMul: { value: 0.7 },
        uRimCol: { value: o.rim ? o.rim.col : new THREE.Vector3() }, uRimW: { value: o.rim ? o.rim.w : 0 },
      },
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = true;
    facadeGroup.add(mesh); facadeCount++;
    return { mesh, n, U, V };
  }
  function addPrism(b, t, style, o = {}) {
    const faces = o.faces || ['front', 'right', 'back', 'left', 'top', 'bottom'];
    const out = {};
    if (faces.includes('front')) out.front = addFacade([b[0], b[1], t[1], t[0]], style, o);
    if (faces.includes('right')) out.right = addFacade([b[1], b[2], t[2], t[1]], o.rightStyle || style, o);
    if (faces.includes('back')) out.back = addFacade([b[2], b[3], t[3], t[2]], style, o);
    if (faces.includes('left')) out.left = addFacade([b[3], b[0], t[0], t[3]], o.leftStyle || style, o);
    if (faces.includes('top')) out.top = addFacade([t[0], t[1], t[2], t[3]], o.topStyle || emptyStyle, o);
    if (faces.includes('bottom')) out.bottom = addFacade([b[1], b[0], b[3], b[2]], o.topStyle || emptyStyle, o);
    return out;
  }
  function boxRings(x0, x1, y0, y1, z0, z1) {
    return [[V3(x0, y0, z1), V3(x1, y0, z1), V3(x1, y0, z0), V3(x0, y0, z0)], [V3(x0, y1, z1), V3(x1, y1, z1), V3(x1, y1, z0), V3(x0, y1, z0)]];
  }
  // prism from a CCW (x,y) polygon at z1 (front) extruded to z0 (back). edgeStyles[i] overrides the style of side i; null = plain concrete
  function addPolyPrism(poly, z1, z0, style, o = {}) {
    const F = poly.map(([x, y]) => V3(x, y, z1)), Bk = poly.map(([x, y]) => V3(x, y, z0));
    const out = { front: addFacade(F, style, o), sides: [] };
    const N = poly.length;
    for (let i = 0; i < N; i++) {
      if (o.skipEdges && o.skipEdges.includes(i)) continue;
      const q = [F[i], Bk[i], Bk[(i + 1) % N], F[(i + 1) % N]];
      const ex = poly[(i + 1) % N][0] - poly[i][0], ey = poly[(i + 1) % N][1] - poly[i][1]; const L = Math.hypot(ex, ey);
      const ny = ex / L; // outward normal y component of this side (CCW polygon)
      let st = (o.edgeStyles && o.edgeStyles[i] !== undefined) ? o.edgeStyles[i] : (Math.abs(ny) > 0.35 ? null : style);
      out.sides[i] = addFacade(q, st || emptyStyle, o);
    }
    if (o.back) out.back = addFacade(Bk.slice().reverse(), emptyStyle, o);
    return out;
  }

  // ---- standard materials: triplanar weathered concrete
  const concMat = makeConcreteMaterial(tConc, tNoise, { color: 0x909191, tile: 10, weather: 0.45 });
  const concMat2 = makeConcreteMaterial(tConc, tNoise, { color: 0x868788, tile: 8, weather: 0.5 });
  const concDark = makeConcreteMaterial(tConc, tNoise, { color: 0x5f6062, tile: 6, weather: 0.55 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.8, metalness: 0.1 });

  const ledgeInst = [];
  function addLedgeRing(x0, x1, z0, z1, y, proj = 3, thick = 2.5) {
    ledgeInst.push({ x: (x0 + x1) / 2, y, z: z1 + proj / 2, sx: x1 - x0 + proj * 2, sy: thick, sz: proj });
    ledgeInst.push({ x: x1 + proj / 2, y, z: (z0 + z1) / 2, sx: proj, sy: thick, sz: z1 - z0 + proj * 2 });
    ledgeInst.push({ x: x0 - proj / 2, y, z: (z0 + z1) / 2, sx: proj, sy: thick, sz: z1 - z0 + proj * 2 });
  }
  function ledgesForStyle(style, x0, x1, z0, z1, maxY, xRightAt) {
    for (const b of style.bands) if (b.ledge && b.y1 < maxY) addLedgeRing(x0, xRightAt ? xRightAt(b.y1) : x1, z0, z1, b.y1, 2.5 + rnd() * 2.5, 2 + rnd() * 1.5);
  }
  // segmented LED runs (6 m lit / 4 m gap, dim) and red aviation beacons replace the continuous edge strips of earlier rounds:
  // a photo never shows a 1-px bright line along a building edge
  const edgeCyan = new THREE.Color(0.30, 1.05, 1.35), edgeAmber = new THREE.Color(1.45, 0.92, 0.48), edgeDim = new THREE.Color(0.18, 0.62, 0.85);
  // round 3: optional jitter (spacing +/- jit*gap, 20% dark, brightness 0.6-1.3) so fixture rows are not perfectly regular dotted lines
  // round 4: X = { priv, dark, brMin, brMax, sizeVar, len } - extra variation from a private PRNG (the main sequence is untouched);
  // priv: true draws everything from the private PRNG (new runs added this round do not shift the layout of what follows)
  function ledRun(a, b, th, col, lit = 6, gap = 4, bright = 0.4, jit = 0, X = null) {
    const d = b.clone().sub(a); const L = d.length(); d.normalize(); const n = Math.max(1, Math.floor((L + gap) / (lit + gap)));
    const pr = mulberry32(((seed * 7919 + Math.round(a.x * 3 + a.y * 5 + a.z * 7 + b.y * 11)) | 0) ^ 0x5bd1e995);
    const R = (X && X.priv) ? pr : rnd;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(th, th, X && X.len ? X.len : lit), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(bright) }), n);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(a, b, Math.abs(d.y) > 0.95 ? V3(1, 0, 0) : V3(0, 1, 0)));
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const off = jit > 0 ? (R() - 0.5) * 2 * jit * gap : 0; let dark = jit > 0 && R() < 0.2; let s = dark ? 0.001 : 1;
      let bri = jit > 0 ? 0.6 + 0.7 * R() : 1.0;
      if (X) { if (X.dark !== undefined) dark = pr() < X.dark; if (X.brMin !== undefined) bri = X.brMin + (X.brMax - X.brMin) * pr(); s = dark ? 0.001 : (1 + (pr() - 0.5) * 2 * (X.sizeVar || 0)); }
      const c = a.clone().addScaledVector(d, i * (lit + gap) + lit / 2 + off); m.compose(c, q, new THREE.Vector3(s, s, s)); im.setMatrixAt(i, m);
      if (jit > 0 || X) im.setColorAt(i, new THREE.Color().setScalar(bri));
    }
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.frustumCulled = false; scene.add(im); return im;
  }
  const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.08, 0.05).multiplyScalar(5) });
  const beaconGlow = new THREE.ShaderMaterial({ vertexShader: HOLO_VERT, fragmentShader: GLOW_FRAG, uniforms: { ...lightUniforms, uCol: { value: new THREE.Vector3(1.0, 0.12, 0.08) }, uInt: { value: 1.2 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  function beacon(p, r = 1.0) { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), beaconMat); s.position.copy(p); scene.add(s); const g = new THREE.Mesh(new THREE.PlaneGeometry(r * 14, r * 14), beaconGlow); g.position.copy(p); g.lookAt(camera.position); scene.add(g); }

  // =============================================================================================
  // TOWERS
  // =============================================================================================
  // ---- CENTER: podium + wedge-peaked body (right edge leans out to a prow at the true peak) + ONE big chamfer facet rising
  // straight off the body's top edge (no setback, no crown trays), leaning back and shearing left so it exits the frame top at
  // ~30% width; the facet carries a lighter haze-lit tone so the plane change reads.
  const CZ1 = -230, CZ0 = -400;
  const PEAK = [80, 330], CREASE = [-60, 280];
  {
    const podium = makeStyle(rnd, 70, 'podium');
    const px0 = -90, px1 = 150, pz0 = -380, pz1 = -222, ph = 72;
    const [pb, pt] = boxRings(px0, px1, 0, ph, pz0, pz1);
    addPrism(pb, pt, podium, { faces: ['front'], edge: 6, seed: 3 });
    ledgesForStyle(podium, px0, px1, pz0, pz1, ph); addLedgeRing(px0, px1, pz0, pz1, ph, 4, 3);
    // body polygon (x,y) CCW at z=-230: base 70..; right edge vertical to 190, then leans out to the peak; top edge back to the crease
    const body = [[-60, 70], [45, 70], [45, 190], PEAK, CREASE];
    // round 3: body = the left tower's deep-opening recipe with two forced 20-26 m arcades (lit ceilings, visible jambs)
    const bodyStyle = makeStyle(rnd, 240, 'body', 0, 1, [{ y: 118, kind: 'arcade' }, { y: 205, kind: 'arcade' }]);
    const leanStyle = makeStyle(rnd, 130, 'facet');
    addPolyPrism(body, CZ1, CZ0, bodyStyle, { edge: 6, seed: 5, skipEdges: [0, 1, 3, 4], edgeStyles: { 2: leanStyle }, tint: new THREE.Vector3(0.49, 0.495, 0.505) });
    ledgesForStyle(bodyStyle, -60, 45, CZ0, CZ1, 215, (y) => y < 120 ? 45 : 45 + 35 * Math.min(1, (y - 120) / 210));
    // the chamfer facet: parallelogram from the front top edge (crease -> peak) back to z=-400, rising 720 m and shearing 240 m left
    const FS = [-240, 720, CZ0 - CZ1];
    const fA = V3(CREASE[0], CREASE[1], CZ1), fB = V3(PEAK[0], PEAK[1], CZ1), fC = V3(PEAK[0] + FS[0], PEAK[1] + FS[1], CZ1 + FS[2]), fD = V3(CREASE[0] + FS[0], CREASE[1] + FS[1], CZ1 + FS[2]);
    // round 3: rows of large deep bays + ribbed fins, mostly dark (it is the top of the tower), two forced arcades mid-facet
    const facetStyle = makeStyle(rnd, 900, 'facetBig', 0, 0.28, [{ y: 115, kind: 'arcade' }, { y: 235, kind: 'arcade' }]);
    addFacade([fA, fB, fC, fD], facetStyle, { edge: 8, seed: 7, tint: new THREE.Vector3(0.50, 0.505, 0.515), clip: true });   // round 4: clip planes - no windows sliced by the sloped edges
    // closure under the facet's left edge (overhang soffit, dark); the right closure and the back face away from the camera
    addFacade([fA, fD, V3(CREASE[0], CREASE[1], CZ0)], emptyStyle, { edge: 4, seed: 8, clip: true, tint: new THREE.Vector3(0.40, 0.405, 0.415) });
    addLight(V3(-110, 430, -275), new THREE.Vector3(1.0, 0.62, 0.28).multiplyScalar(0.8), 130);
    addLight(V3(-20, 230, -300), new THREE.Vector3(0.35, 0.8, 1.0).multiplyScalar(0.6), 100);
    // segmented LED runs along the front top edge and the prow edge (dim) + a red aviation beacon at the peak
    // round 2: spaced amber fixtures (small hot cubes that bloom) along the crease and the prow edge instead of a dashed line
    // round 3: bigger / brighter / jittered fixtures so the sketch's V roofline (crease -> peak -> prow) is drawn by lights, and a
    // third run up the facet's right edge (peak -> top of frame), the sketch's strongest diagonal
    // round 4: 0.6 m fixtures (round bloom, not 30 px squares), ~35% dark so the mean spacing is ~14 m, brightness 0.4-1.3; the
    // roofline itself is recovered by a 1 m lighter concrete nosing that catches the key (below) rather than by the lights
    const FX = { dark: 0.35, brMin: 0.4, brMax: 1.3, sizeVar: 0.25 };
    ledRun(V3(CREASE[0], CREASE[1] + 1.4, CZ1 + 1.0), V3(PEAK[0], PEAK[1] + 1.4, CZ1 + 1.0), 0.6, edgeAmber, 1.8, 9, 2.5, 0.3, { ...FX, len: 0.6 });
    ledRun(V3(45.8, 190, CZ1 + 1.0), V3(PEAK[0] + 1.0, PEAK[1], CZ1 + 1.0), 0.6, edgeAmber, 1.7, 9, 2.4, 0.3, { ...FX, len: 0.6 });
    ledRun(fB.clone().add(V3(1.2, 1.0, 1.0)), fC.clone().add(V3(1.2, 1.0, 1.0)), 0.7, edgeAmber, 2.2, 13, 2.6, 0.3, { ...FX, len: 0.7 });
    { const nose = new THREE.MeshStandardMaterial({ color: 0xb4b6ba, roughness: 0.85, metalness: 0.0 });
      const bar = (p, q, t) => { const d = q.clone().sub(p); const L = d.length(); const mm = new THREE.Mesh(new THREE.BoxGeometry(t, t, L), nose); mm.position.copy(p).add(q).multiplyScalar(0.5); mm.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(p, q, V3(0, 1, 0))); scene.add(mm); };
      bar(V3(CREASE[0], CREASE[1] + 0.5, CZ1 + 0.3), V3(PEAK[0], PEAK[1] + 0.5, CZ1 + 0.3), 1.0);
      bar(V3(45.3, 190, CZ1 + 0.3), V3(PEAK[0] + 0.5, PEAK[1], CZ1 + 0.3), 1.0);
      bar(fB.clone().add(V3(0.5, 0.3, 0.3)), fC.clone().add(V3(0.5, 0.3, 0.3)), 1.1); }
    beacon(V3(PEAK[0], PEAK[1] + 2.5, CZ1 - 2), 1.1);
    // (round 2: the ten vertical fins on the lower body front were removed - lit cyan by the billboard they read as a glass pavilion)
    for (let fx = -52; fx < 42; fx += 9.0) { rnd(); rnd(); }   // keep the PRNG sequence stable for the rest of the scene
    log('center peak', proj(fB), 'crease', proj(fA), 'facet top', proj(fD), proj(fC));
  }

  // ---- LEFT tower: one monolithic slab (just the sketch's single strong band + the crown ledge), crown bowing out to the left,
  // big double-height bays with deep reveals on its right face
  {
    const st = makeStyle(rnd, 760, 'main', 0, 0.45);
    const bigBays = makeStyle(rnd, 760, 'leftface', 0, 0.5);
    const x0 = -200, x1 = -92, z0 = -310, z1 = -178, H = 760;   // round 3: 142 -> 108 m wide and 18 m right: its left edge converges into the top-left corner and its inner edge meets the centre crease as in the sketch
    const BOW = 8;   // round 2: the slab's left edge leans out 20 m by y=600 (the sketch's leftward bow), the crown flares further
    const [b, t] = boxRings(x0, x1, 0, 600, z0, z1);
    t[0].x = x0 - BOW; t[3].x = x0 - BOW;
    addPrism(b, t, st, { faces: ['front', 'right'], edge: 7, seed: 9, rightStyle: bigBays, clip: true });
    // round 3: crown flare narrowed (78 -> 46 m) so the slab's left silhouette shows against sky in the top-left corner
    const cb = [V3(x0 - BOW - 12, 600, z1 + 4), V3(x1 + 4, 600, z1 + 4), V3(x1 + 4, 600, z0 - 4), V3(x0 - BOW - 12, 600, z0 - 4)];
    const ct = [V3(x0 - BOW - 46, H, z1 + 4), V3(x1 + 4, H, z1 + 4), V3(x1 + 4, H, z0 - 4), V3(x0 - BOW - 46, H, z0 - 4)];
    const crownStyle = makeStyle(rnd, 170, 'main');
    for (const st2 of [bigBays, crownStyle]) st2.bands.forEach((b, i) => { if (b.name === 'slits' && b.winW < 0.8) { b.winW = 0.8; st2.B.set([b.winW, b.winH, b.depth, b.type], i * 4); } });   // round 4: no sub-pixel slits on the foreshortened +x faces
    addPrism(cb, ct, crownStyle, { faces: ['front', 'right', 'bottom'], edge: 5, seed: 10, clip: true });
    addLedgeRing(x0 - BOW - 12, x1 + 4, z0 - 4, z1 + 4, 600, 6, 5);
    addLedgeRing(x0 - BOW * 0.5, x1, z0, z1, 300, 9, 5);   // the sketch's band near the top-left: a 9 m projecting ledge (round 3)
    ledRun(V3(x0 - BOW * 0.5, 303.0, z1 + 9.4), V3(x1 + 9, 303.0, z1 + 9.4), 1.4, edgeAmber, 1.4, 10, 1.6, 0.3, { dark: 0.3, brMin: 0.5, brMax: 1.3, sizeVar: 0.4 });   // round 4: not a bokeh string
    // warm downlights under the band (lit soffit + shadow below it) and a cyan rim light low on the +x face
    addLight(V3(x0 + 40, 295, z1 + 6), new THREE.Vector3(1.0, 0.72, 0.42).multiplyScalar(0.8), 34);
    addLight(V3(x1 - 30, 295, z1 + 6), new THREE.Vector3(1.0, 0.72, 0.42).multiplyScalar(0.75), 32);
    beacon(V3(x1 + 2, H + 2, z1 + 2), 1.0);
    for (let fz = z0 + 8; fz < z1 - 6; fz += 9.0) { if (rnd() < 0.2) continue; const fh = 60 + rnd() * 50; ledgeInst.push({ x: x1 + 0.7, y: 130 + fh / 2, z: fz, sx: 1.4, sy: fh, sz: 1.2 }); }
    log('left right-face', proj(V3(x1, 100, z1)), proj(V3(x1, 300, z1)), 'left edge', proj(V3(x0 - BOW, 600, z1)), proj(V3(x0 - BOW - 46, H, z1 + 4)), proj(V3(x0, 300, z1)));
  }

  // ---- RIGHT tower: one thick mass with the sketch's zig-zag silhouette. Lower block whose outer face runs off the right
  // edge, a V-notch, then three stacked cantilever slabs stepping OUT going up (each with a dark downward soffit), and the
  // upper block whose outer face slopes back in as it runs off the top-right. The Z reads by light on the soffits, not by lines.
  const RZ1 = -395, RZ0 = -520;
  {
    const RT = new THREE.Vector3(0.50, 0.505, 0.515);
    const sideL = makeStyle(rnd, 1000, 'quiet');
    // round 2: deeper V-notch (sky shows between the lower jut and the first cantilever), lower block gets double-height
    // voids / bays / blank panels (zlower), soffit downlights pool under each cantilever
    // round 3: wider V-notch (the lower block's top edge ends at x=192, the first slab at 240) so background shows through it;
    // the whole right tower gets a 1.25x fog multiplier so it sits behind the centre peak; the upper block steps back 70 m and
    // 20 m right so haze separates it from the centre tower's dark prow face; soffit pools dimmer and more local
    const lower = [[35, 0], [310, 0], [310, 215], [192, 340], [35, 340]];
    addPolyPrism(lower, RZ1, RZ0, makeStyle(rnd, 340, 'zlower', 0, 1, [{ y: 150, kind: 'arcade' }, { y: 250, kind: 'arcade' }]), { edge: 6, seed: 14, skipEdges: [0, 1, 2, 3], edgeStyles: { 4: sideL }, tint: RT, fogMul: 1.25 });
    const slabs = [[240, 340, 403], [288, 403, 466], [330, 466, 530]];
    for (const [xr, y0, y1] of slabs) {
      const [b, t] = boxRings(35, xr, y0, y1, RZ0, RZ1); addPrism(b, t, makeStyle(rnd, y1 - y0, 'quiet'), { faces: ['front', 'left', 'bottom'], edge: 5, seed: 16 + xr, tint: RT, fogMul: 1.25 });
      addLight(V3(xr - 22, y0 - 3, RZ1 - 8), new THREE.Vector3(1.0, 0.70, 0.40).multiplyScalar(0.55), 26);
      // round 4: warm soffit downlights every ~20 m along the underside of each cantilever (the Z reads by its lit soffits)
      ledRun(V3(xr - 3, y0 - 0.7, RZ1 + 1.2), V3(40, y0 - 0.7, RZ1 + 1.2), 0.9, edgeAmber, 0.9, 19, 2.2, 0.3, { priv: true, dark: 0.15, brMin: 0.6, brMax: 1.2, sizeVar: 0.2 });
    }
    const UZ = -70, UX = 20, ULX = 92, ULX2 = 82;   // round 4: the upper block's left edge moved 37 m right so a sliver of sky shows in the V above the centre peak
    const upper = [[ULX, 530], [330 + UX, 530], [185 + UX, 1000], [ULX2, 1000]];
    // round 4: tint 0.30 -> 0.34, 3x the lit ratio with three forced 10-20 m lit voids, a faint sky-glow rim along its silhouette
    addPolyPrism(upper, RZ1 + UZ, RZ0 + UZ, makeStyle(rnd, 470, 'main', 0, 6.0, [{ y: 110, kind: 'voids' }, { y: 240, kind: 'voids' }, { y: 360, kind: 'voids' }]), { edge: 6, seed: 15, skipEdges: [1, 2], edgeStyles: { 3: sideL }, tint: new THREE.Vector3(0.34, 0.345, 0.355), fogMul: 1.15, clip: true, rim: { col: new THREE.Vector3(0.030, 0.026, 0.036), w: 9 } });
    addLight(V3(205, 538, RZ1 + UZ + 12), new THREE.Vector3(1.0, 0.72, 0.42).multiplyScalar(0.5), 48);   // round 4: dim warm uplight from the terrace at the base of the upper block
    addLedgeRing(35, 192, RZ0, RZ1, 340, 3, 2.5);
    ledRun(V3(38, 341.6, RZ1 + 4.2), V3(190, 341.6, RZ1 + 4.2), 1.1, edgeDim, 1.1, 12, 2.0, 0.3);   // round 4: cool LED nosing on the lower block's top edge
    beacon(V3(327, 532.5, RZ1 + 1.5), 1.1);
    log('right outer corner', proj(V3(330, 530, RZ1)), 'notch', proj(V3(240, 340, RZ1)), 'jut', proj(V3(310, 215, RZ1)), 'top', proj(V3(185 + UX, 1000, RZ1 + UZ)), 'upper base', proj(V3(330 + UX, 530, RZ1 + UZ)));
  }

  // ---- Background towers (dense matrix windows, fogged)
  {
    for (let i = 0; i < 22; i++) {
      const st = makeStyle(rnd, 600, 'bg');
      const w = 40 + rnd() * 110, d = 40 + rnd() * 110, h = 140 + rnd() * 460;
      const side = i % 3;
      const cx = side === 0 ? -600 + rnd() * 330 : side === 1 ? -250 + rnd() * 500 : 260 + rnd() * 420;
      const cz = side === 1 ? -700 - rnd() * 900 : -450 - rnd() * 900;
      const [b, t] = boxRings(cx - w / 2, cx + w / 2, 0, h, cz - d / 2, cz + d / 2);
      addPrism(b, t, st, { faces: ['front', 'right', 'left', 'top'], edge: 3, seed: 20 + i, tint: new THREE.Vector3(0.44, 0.45, 0.47) });
      if (rnd() < 0.5) addLedgeRing(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, h * (0.5 + 0.4 * rnd()), 3, 3);
    }
  }
  // canyon fillers: a fogged mid-distance block seen through the gap left of the centre body, and far mega-towers top-right
  {
    const st = makeStyle(rnd, 560, 'bg');
    const [b, t] = boxRings(-205, -92, 0, 560, -610, -520);
    addPrism(b, t, st, { faces: ['front', 'right', 'top'], edge: 3, seed: 60, tint: new THREE.Vector3(0.44, 0.45, 0.47) });
    addLedgeRing(-205, -92, -610, -520, 330, 3, 3);
    for (const [cx, cz, w, h] of [[420, -770, 120, 840], [565, -900, 140, 720], [-380, -780, 110, 700]]) {
      const st2 = makeStyle(rnd, h, 'bg');
      const [b2, t2] = boxRings(cx - w / 2, cx + w / 2, 0, h, cz - w / 2, cz + w / 2);
      addPrism(b2, t2, st2, { faces: ['front', 'right', 'left', 'top'], edge: 3, seed: 70 + cx, tint: new THREE.Vector3(0.44, 0.45, 0.47) });
    }
  }
  log('facades', facadeCount);

  // ---- ledges + fins as one InstancedMesh
  {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), concMat, ledgeInst.length);
    const m = new THREE.Matrix4();
    ledgeInst.forEach((l, i) => { m.compose(new THREE.Vector3(l.x, l.y, l.z), new THREE.Quaternion(), new THREE.Vector3(l.sx, l.sy, l.sz)); im.setMatrixAt(i, m); });
    im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; scene.add(im);
    log('ledges/fins', ledgeInst.length);
  }

  // =============================================================================================
  // DOME: concrete-ribbed sphere hall sunk into the plaza in front of the center base (77% of the sphere above ground, no
  // drum), lit entrance portal with a lintel + mullions and a queue, faint ticker rings
  // =============================================================================================
  const domeR = 56, domeC = new THREE.Vector3(8, 30, -172), domeRot = 0.4;
  const portalZ = domeC.z + Math.sqrt(domeR * domeR - (domeC.y - 5) ** 2) - 2;
  {
    const geo = new THREE.SphereGeometry(domeR, 72, 48);
    const mat = new THREE.ShaderMaterial({ vertexShader: DOME_VERT, fragmentShader: SHDBG ? DOME_FRAG.replace('col = applyFog(col, vWorldPos);', 'col = vec3(gShadow);') : DOME_FRAG, uniforms: { ...lightUniforms, uLightSat: { value: 0.5 }, uKeyMul: { value: 1.8 }, uAirMul: { value: 0.5 }, uGridCol: { value: new THREE.Vector3(0.25, 0.85, 1.0) }, tConc: { value: tConc }, tNoise: { value: tNoise }, uR: { value: domeR }, uWinN: { value: 0 }, uWin: { value: Array.from({ length: 32 }, () => new THREE.Vector4()) } } });
    const m = new THREE.Mesh(geo, mat); m.position.copy(domeC); m.rotation.y = domeRot; m.castShadow = true; scene.add(m);
    // real concrete ribs matching the shader grid (12 longitudes / 6 latitudes)
    const ribs = new THREE.Group(); ribs.position.copy(domeC); ribs.rotation.y = domeRot;
    for (let k = 1; k < 6; k++) { const phi = Math.PI * (1 - k / 6); const rr = domeR * Math.sin(phi), yy = domeR * Math.cos(phi); if (domeC.y + yy < -1) continue; const eq = k === 3; const t = new THREE.Mesh(new THREE.TorusGeometry(rr + (eq ? 1.4 : 0.4), eq ? 2.1 : 1.0, 8, 128), concMat2); t.rotation.x = Math.PI / 2; t.position.y = yy; t.castShadow = t.receiveShadow = true; ribs.add(t); }   // round 4: the equator ring is a 2 m cornice
    for (let i = 0; i < 6; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(domeR + 0.4, 1.0, 8, 160), concMat2); t.rotation.y = i * Math.PI / 6; t.castShadow = t.receiveShadow = true; ribs.add(t); }
    scene.add(ribs);
    // round 2: recessed window boxes in the shader's lon2/lat2 cells. One intentional warm row just above the equator on the
    // camera side, a few cool / dark-glass ones scattered on the rows above and below; cells touching a rib are skipped.
    const wins = []; const camTmp = new THREE.Vector3();
    const cellInfo = (i, j, ox = 0.5, oy = 0.5) => {
      const u = (i + ox) / 48, uvy = (j + oy) / 24; const theta = (1 - uvy) * Math.PI, phi = u * Math.PI * 2;
      const local = new THREE.Vector3(-domeR * Math.cos(phi) * Math.sin(theta), domeR * Math.cos(theta), domeR * Math.sin(phi) * Math.sin(theta));
      const world = local.clone().applyAxisAngle(V3(0, 1, 0), domeRot).add(domeC);
      const facing = world.clone().sub(domeC).normalize().dot(camTmp.subVectors(camera.position, world).normalize());
      return { i, j, local, world, facing, cw: domeR * Math.sin(theta) * Math.PI * 2 / 48, ch: domeR * Math.PI / 24 };
    };
    let warmLow = 0;   // round 3: three of the lower-row windows glow warm (interior light through the lower hemisphere)
    // round 4: two double-height voids on the window row (rows 13-14), one two-cell horizontal slit band and one dark hatch low
    // on the shell (rows 10-11), for the same opening variety the towers have. The main PRNG draws are unchanged.
    const tallSet = new Set(), slitAt = new Set(), hatchAt = new Set();
    { let cnt = 0; for (let i = 0; i < 48; i++) { if (i % 4 === 0 || i % 4 === 3) continue; if (cellInfo(i, 13).facing > 0.4) { cnt++; if (cnt === 2 || cnt === 6) tallSet.add(i); } } }
    { let cnt = 0; for (let i = 0; i < 48; i++) { if (i % 4 !== 1) continue; if (cellInfo(i, 10).facing > 0.5) { cnt++; if (cnt === 1) slitAt.add(i); if (cnt === 3) hatchAt.add(i + 1); } } }
    for (let i = 0; i < 48; i++) {
      if (i % 4 === 0 || i % 4 === 3) continue;
      const a = cellInfo(i, 13);
      if (a.facing > 0.12) { const inten = 0.85 + 0.3 * rnd(); if (tallSet.has(i)) wins.push({ ...cellInfo(i, 13, 0.5, 1.0), kind: 10, inten: inten + 0.1, sx: 0.6, sy: 1.6 }); else wins.push({ ...a, kind: 0, inten, sx: 0.6, sy: 0.6 }); }
      const b2 = cellInfo(i, 14); if (b2.facing > 0.2) { const r = rnd(); if (r < 0.55) { const kind = rnd() < 0.4 ? 1 : 2, inten = 0.5 + 0.4 * rnd(); if (!tallSet.has(i)) wins.push({ ...b2, kind, inten, sx: 0.6, sy: 0.6 }); } }
      const c = cellInfo(i, 10);
      if (c.facing > 0.3 && rnd() < 0.6) { const warm = warmLow < 3 && c.facing > 0.55; if (warm) warmLow++; const kind = warm ? 0 : (rnd() < 0.3 ? 0 : 2), inten = warm ? 1.1 : 0.6 + 0.4 * rnd();
        if (slitAt.has(i)) wins.push({ ...cellInfo(i, 10, 1.0, 0.5), kind: 21, inten: 0.55, sx: 1.6, sy: 0.32 });
        else if (slitAt.has(i - 1)) { /* covered by the slit */ }
        else if (hatchAt.has(i)) wins.push({ ...cellInfo(i, 10, 0.5, 1.0), kind: 12, inten: 0, sx: 0.6, sy: 1.6 });
        else wins.push({ ...c, kind, inten, sx: 0.6, sy: 0.6 }); }
      else if (slitAt.has(i) && c.facing > 0.3) wins.push({ ...cellInfo(i, 10, 1.0, 0.5), kind: 21, inten: 0.55, sx: 1.6, sy: 0.32 });
      else if (hatchAt.has(i) && c.facing > 0.3) wins.push({ ...cellInfo(i, 10, 0.5, 1.0), kind: 12, inten: 0, sx: 0.6, sy: 1.6 });
      const d = cellInfo(i, 17); if (d.facing > 0.3 && rnd() < 0.5) wins.push({ ...d, kind: rnd() < 0.25 ? 1 : 2, inten: 0.4, sx: 0.6, sy: 0.6 });
    }
    wins.length = Math.min(wins.length, 32);
    mat.uniforms.uWinN.value = wins.length; wins.forEach((w, k) => mat.uniforms.uWin.value[k].set(w.i, w.j, w.kind, w.inten));
    const revealGeo = (() => {
      const P = [], N = [], UV = [], I = []; const D = 1.5, O = 0.12;
      const q = (pts, n) => { const s = P.length / 3; for (const p of pts) P.push(...p); for (let k = 0; k < 4; k++) N.push(...n); UV.push(0, 0, 1, 0, 1, 1, 0, 1); I.push(s, s + 1, s + 2, s, s + 2, s + 3); };
      q([[-0.5, -0.5, O], [-0.5, 0.5, O], [-0.5, 0.5, -D], [-0.5, -0.5, -D]], [1, 0, 0]);
      q([[0.5, -0.5, O], [0.5, 0.5, O], [0.5, 0.5, -D], [0.5, -0.5, -D]], [-1, 0, 0]);
      q([[-0.5, -0.5, O], [0.5, -0.5, O], [0.5, -0.5, -D], [-0.5, -0.5, -D]], [0, 1, 0]);
      q([[-0.5, 0.5, O], [0.5, 0.5, O], [0.5, 0.5, -D], [-0.5, 0.5, -D]], [0, -1, 0]);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I); return g;
    })();
    const backGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0, -1.5);
    const revealMat = new THREE.ShaderMaterial({ vertexShader: BOXWIN_VERT, fragmentShader: REVEAL_FRAG, uniforms: { ...lightUniforms, uLightSat: { value: 0.5 }, tConc: { value: tConc } }, side: THREE.DoubleSide });
    const backMat = new THREE.ShaderMaterial({ vertexShader: BOXWIN_VERT, fragmentShader: BACKPANE_FRAG, uniforms: { ...lightUniforms }, side: THREE.DoubleSide });
    const revealIM = new THREE.InstancedMesh(revealGeo, revealMat, wins.length), backIM = new THREE.InstancedMesh(backGeo, backMat, wins.length);
    const wm = new THREE.Matrix4(), wq = new THREE.Quaternion(), lookM = new THREE.Matrix4();
    wins.forEach((w, k) => {
      const n = w.local.clone().normalize();
      lookM.lookAt(w.local.clone().add(n), w.local, V3(0, 1, 0)); wq.setFromRotationMatrix(lookM);
      wm.compose(w.local, wq, new THREE.Vector3(w.cw * w.sx, w.ch * w.sy, 1)); revealIM.setMatrixAt(k, wm); backIM.setMatrixAt(k, wm);
      const kd = w.kind % 10;
      const col = kd === 0 ? new THREE.Color(1.0, 0.68, 0.40).multiplyScalar(w.inten * 1.7) : (kd === 1 ? new THREE.Color(0.45, 0.80, 1.0).multiplyScalar(w.inten * 1.3) : new THREE.Color(0, 0, 0));
      revealIM.setColorAt(k, col); backIM.setColorAt(k, col);
    });
    revealIM.instanceMatrix.needsUpdate = backIM.instanceMatrix.needsUpdate = true; revealIM.instanceColor.needsUpdate = backIM.instanceColor.needsUpdate = true;
    revealIM.frustumCulled = backIM.frustumCulled = false; ribs.add(revealIM); ribs.add(backIM);
    log('dome windows', wins.length, 'row13 at', proj(wins[0] ? wins[0].world : domeC));
    // entrance portal at the sphere's front base: concrete box, warm void behind a lintel + mullions (a lit lobby, not a light box)
    const portal = new THREE.Mesh(new THREE.BoxGeometry(16, 10, 12), concMat); portal.position.set(domeC.x - 2, 5, portalZ); portal.castShadow = portal.receiveShadow = true; scene.add(portal);
    const portalVoid = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 6.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.66, 0.36).multiplyScalar(0.75) })); portalVoid.position.set(domeC.x - 2, 3.4, portalZ + 6.02); scene.add(portalVoid);
    { const pg = new THREE.Mesh(new THREE.PlaneGeometry(26, 13), new THREE.MeshBasicMaterial({ map: tGlow, color: new THREE.Color(1.0, 0.62, 0.32).multiplyScalar(0.35), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); pg.position.set(domeC.x - 2, 4.5, portalZ + 7.5); scene.add(pg); }   // round 3: entrance glow at the base
    const pdark = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.8 });
    for (const ox of [-2.1, 0.0, 2.1]) { const mu = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6.5, 0.3), pdark); mu.position.set(domeC.x - 2 + ox, 3.4, portalZ + 6.2); scene.add(mu); }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(9.0, 0.7, 0.4), pdark); lintel.position.set(domeC.x - 2, 6.4, portalZ + 6.2); scene.add(lintel);
    const pl = new THREE.PointLight(0xffb070, 110, 55, 2); pl.position.set(domeC.x - 2, 4.5, portalZ + 10); scene.add(pl);
    addLight(new THREE.Vector3(domeC.x - 2, 4.0, portalZ + 9), new THREE.Vector3(1.0, 0.62, 0.32).multiplyScalar(1.0), 28);
    addLight(new THREE.Vector3(domeC.x, domeC.y + 30, domeC.z + domeR + 20), new THREE.Vector3(0.25, 0.75, 1.0).multiplyScalar(0.15), 80);   // round 2: generic fill cut to 0.15 -> terminator
  }

  // =============================================================================================
  // VIADUCT: elevated expressway sweeping from high far-left down to the lower-right foreground
  // =============================================================================================
  const vA = new THREE.Vector3(-235, 95, -265), vB = new THREE.Vector3(70, 6, -55);
  {
    const dir = new THREE.Vector3().subVectors(vB, vA); const len = dir.length(); dir.normalize();
    const yaw = Math.atan2(dir.x, dir.z); const pitch = Math.asin(dir.y);
    const grp = new THREE.Group(); grp.position.copy(vA).add(vB).multiplyScalar(0.5);
    grp.rotation.order = 'YXZ'; grp.rotation.set(-pitch, yaw, 0);
    const deckW = 10.5, deckT = 2.0;
    grp.add(new THREE.Mesh(new THREE.BoxGeometry(deckW, deckT, len), concMat2));
    const girder = new THREE.Mesh(new THREE.BoxGeometry(5, 1.8, len), concDark); girder.position.y = -deckT / 2 - 0.9; grp.add(girder);
    const asphalt = new THREE.Mesh(new THREE.BoxGeometry(deckW - 2.4, 0.3, len), new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.55, metalness: 0.05 })); asphalt.position.y = deckT / 2 + 0.1; grp.add(asphalt);
    const lane = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, len), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.75, 0.3).multiplyScalar(1.1) })); lane.position.y = deckT / 2 + 0.28; grp.add(lane);
    // far-side parapet 1.3 m; camera side (local -x) is now a kerb + a 3 m cantilevered footpath with a 1.1 m railing (round 2)
    { const par = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.3, len), concMat2); par.position.set(deckW / 2 - 0.3, deckT / 2 + 0.65, 0); grp.add(par); }
    { const kerb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, len), concMat2); kerb.position.set(-(deckW / 2 - 0.2), deckT / 2 + 0.25, 0); grp.add(kerb); }
    const FPX = -(deckW / 2 + 1.5), FPY = deckT / 2 + 0.3;   // footpath centre x, footpath top y
    { const fp = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.6, len), concMat2); fp.position.set(FPX, FPY - 0.3, 0); grp.add(fp); }
    { const fpTop = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.04, len), new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.3, metalness: 0.05 })); fpTop.position.set(FPX, FPY, 0); grp.add(fpTop); }
    const railX = FPX - 1.42;
    for (const [ry, rt] of [[1.1, 0.08], [0.62, 0.05]]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(rt, rt, len), darkMat); rail.position.set(railX, FPY + ry, 0); grp.add(rail); }
    { const postN = Math.floor(len / 3); const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 1.12, 0.09), darkMat, postN); const pm = new THREE.Matrix4(); for (let i = 0; i < postN; i++) { pm.makeTranslation(railX, FPY + 0.56, -len / 2 + (i + 0.5) * 3); posts.setMatrixAt(i, pm); } posts.instanceMatrix.needsUpdate = true; grp.add(posts); }
    { const postN = Math.floor(len / 10); const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 1.6, 0.14), darkMat, postN); const pm = new THREE.Matrix4(); for (let i = 0; i < postN; i++) { pm.makeTranslation(deckW / 2 - 0.3, deckT / 2 + 1.3 + 0.8, -len / 2 + (i + 0.5) * 10); posts.setMatrixAt(i, pm); } posts.instanceMatrix.needsUpdate = true; grp.add(posts); }
    const stripC = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.9, 1.0).multiplyScalar(1.5) }), stripA = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.6, 0.25).multiplyScalar(1.4) });
    { const st = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, len), stripA); st.position.set(deckW / 2 - 0.3, deckT / 2 + 1.33, 0); grp.add(st); }
    // (round 4: the continuous 0.06 m railing strip - a 1 px aliased line across every train window - is now spaced fixtures, added in world space below)
    // under-glow lamps along the soffit (magenta), every 9 m
    // (round 4: the magenta under-deck lamp meshes are gone - isolated pink specks under the dark deck; the magenta wash stays)
    const mm = new THREE.Matrix4();
    // lamp posts
    const lampGeo = mergeGeometries([new THREE.CylinderGeometry(0.12, 0.16, 9, 6).translate(0, 4.5, 0), new THREE.BoxGeometry(2.2, 0.25, 0.3).translate(-1.0, 9, 0)]);
    const lampCount = Math.floor(len / 22);
    const lamps = new THREE.InstancedMesh(lampGeo, darkMat, lampCount);
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 6, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.62, 0.25).multiplyScalar(2.5) }), lampCount);
    for (let i = 0; i < lampCount; i++) {
      const zz = -len / 2 + (i + 0.5) * 22; const side = (i % 2 === 0 ? 1 : -1) * (deckW / 2 - 0.3);
      mm.makeTranslation(side, deckT / 2 + 1.3, zz); lamps.setMatrixAt(i, mm);
      mm.makeTranslation(side - 1.9 * Math.sign(side), deckT / 2 + 1.3 + 9, zz); bulbs.setMatrixAt(i, mm);
    }
    lamps.instanceMatrix.needsUpdate = true; bulbs.instanceMatrix.needsUpdate = true; grp.add(lamps); grp.add(bulbs);
    // train on the far lane: dark cars with lit window boxes (delta)
    const carN = 9, carL = 18;   // round 2: longer, brighter, warmer train with a roof and a headlamp cone
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.4, metalness: 0.6 });
    const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(3.0, 3.3, carL - 0.8), bodyMat, carN);
    const roofs = new THREE.InstancedMesh(new THREE.BoxGeometry(2.7, 0.3, carL - 1.4), new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.5, metalness: 0.4 }), carN);
    const WPC = 8;
    // round 3: passenger silhouettes (dark bars) inside the lit windows via a small canvas map; the brightest 30% cross the bloom threshold
    // round 4: 128x80 LinearFilter window maps in four variants (empty, 1, 2, 3 irregular head-and-shoulders profiles at random x,
    // some cut by the window edge, alpha ~0.55) - the old 64x40 map with two symmetric blobs read as cartoon faces at 1:1.
    // ~30% of windows are empty; tone varies (warm, dimmer, cooler); the end windows of each car are darker door glass.
    const wpr = mulberry32(seed * 101 + 5);
    const winTexVar = (nFig) => {
      const W = 128, H = 80; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 0, W, 3); g.fillRect(0, H - 4, W, 4);
      for (let f = 0; f < nFig; f++) {
        const hx = (f + 0.5 + (wpr() - 0.5) * 0.9) / nFig * W * 1.1 - W * 0.05; const hw = (0.3 + 0.3 * wpr()) * 98;   // shoulder width 0.3-0.6 m at 98 px/m
        const hr = 7 + 5 * wpr(); const hy = H * (0.30 + 0.16 * wpr()); const lean = (wpr() - 0.5) * 6;
        g.fillStyle = `rgba(16,13,12,${0.5 + 0.12 * wpr()})`;
        g.beginPath(); g.ellipse(hx, hy, hr * 0.85, hr, 0, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo(hx - hr * 0.45, hy + hr * 0.6); g.lineTo(hx + hr * 0.45, hy + hr * 0.6); g.lineTo(hx + hw * 0.5 + lean, hy + hr * 1.6); g.lineTo(hx + hw * 0.56 + lean, H); g.lineTo(hx - hw * 0.56 + lean, H); g.lineTo(hx - hw * 0.5 + lean, hy + hr * 1.6); g.closePath(); g.fill();
      }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; return t;
    };
    const winGeo = new THREE.BoxGeometry(3.1, 0.8, 1.3);
    const winLists = [[], [], [], []];
    const trainX = -3.1, tz0 = -len / 2 + len * 0.50;
    for (let i = 0; i < carN; i++) {
      const zz = tz0 + i * carL + carL / 2;
      mm.makeTranslation(trainX, deckT / 2 + 0.3 + 1.65, zz); bodies.setMatrixAt(i, mm);
      mm.makeTranslation(trainX, deckT / 2 + 0.3 + 3.4, zz); roofs.setMatrixAt(i, mm);
      for (let k = 0; k < WPC; k++) {
        const dark = rnd() < 0.18; const sc = dark ? 0.001 : 1.0; const door = (k === 0 || k === WPC - 1);
        const pos = new THREE.Vector3(trainX, deckT / 2 + 0.3 + (door ? 2.0 : 2.2), zz - carL / 2 + 2.2 + k * 2.0 + (rnd() - 0.5) * 0.7);
        const br = rnd(); const b0 = br < 0.3 ? 1.0 + 0.3 * rnd() : 0.4 + 0.5 * rnd();
        const tone = wpr(); let col = tone < 0.62 ? new THREE.Color(1.0, 0.78, 0.52) : (tone < 0.85 ? new THREE.Color(0.95, 0.72, 0.50).multiplyScalar(0.5) : new THREE.Color(0.72, 0.84, 1.0).multiplyScalar(0.7));
        if (door) col.multiplyScalar(0.3);
        col.multiplyScalar(b0);
        const v = door ? 0 : (wpr() < 0.3 ? 0 : 1 + Math.floor(wpr() * 3));
        winLists[v].push({ m: new THREE.Matrix4().compose(pos, new THREE.Quaternion(), new THREE.Vector3(sc, door ? sc * 1.5 : sc, door ? sc * 0.7 : sc)), col });
      }
    }
    for (let v = 0; v < 4; v++) {
      const L = winLists[v]; if (!L.length) continue;
      const im = new THREE.InstancedMesh(winGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.4, 1.4), map: winTexVar(v) }), L.length);
      L.forEach((w, q) => { im.setMatrixAt(q, w.m); im.setColorAt(q, w.col); });
      im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; grp.add(im);
    }
    bodies.instanceMatrix.needsUpdate = true; roofs.instanceMatrix.needsUpdate = true; grp.add(bodies); grp.add(roofs);
    const headT = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.15), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.95, 0.85).multiplyScalar(2.5) })); headT.position.set(trainX, deckT / 2 + 1.4, tz0 + carN * carL + 0.1); grp.add(headT);
    { const cone = new THREE.Mesh(new THREE.PlaneGeometry(14, 5), new THREE.ShaderMaterial({ vertexShader: HOLO_VERT, fragmentShader: GLOW_FRAG, uniforms: { ...lightUniforms, uCol: { value: new THREE.Vector3(1.0, 0.92, 0.78) }, uInt: { value: 1.4 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); cone.position.set(trainX, deckT / 2 + 1.6, tz0 + carN * carL + 4.5); grp.add(cone); }
    // cars with headlight / taillight glow planes
    const carBody = new THREE.BoxGeometry(2.0, 1.4, 4.6);
    const carMat = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.4, metalness: 0.5 });
    const cN = 7;
    const cars = new THREE.InstancedMesh(carBody, carMat, cN);
    const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.95, 0.85).multiplyScalar(3) });
    const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.1, 0.08).multiplyScalar(2.5) });
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 0.4, 0.12), headMat, cN);
    const tails = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 0.3, 0.12), tailMat, cN);
    const carGlowMat = new THREE.ShaderMaterial({ vertexShader: HOLO_VERT, fragmentShader: GLOW_FRAG, uniforms: { ...lightUniforms, uCol: { value: new THREE.Vector3(1.0, 0.9, 0.75) }, uInt: { value: 1.6 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const tailGlowMat = carGlowMat.clone(); tailGlowMat.uniforms.uCol.value = new THREE.Vector3(1.0, 0.15, 0.1); tailGlowMat.uniforms.uInt.value = 0.9;
    for (let i = 0; i < cN; i++) {
      const zz = -len / 2 + 12 + rnd() * (len - 24); const laneX = 1.4 + rnd() * 3.2;
      const toward = rnd() < 0.5;
      mm.makeTranslation(laneX, deckT / 2 + 0.95, zz); cars.setMatrixAt(i, mm);
      mm.makeTranslation(laneX, deckT / 2 + 0.8, zz + (toward ? 2.3 : -2.3)); heads.setMatrixAt(i, mm);
      mm.makeTranslation(laneX, deckT / 2 + 0.9, zz + (toward ? -2.3 : 2.3)); tails.setMatrixAt(i, mm);
      const hg = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.2), toward ? carGlowMat : tailGlowMat); hg.position.set(laneX, deckT / 2 + 1.3, zz + 2.5); grp.add(hg);
      const tg = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 1.6), toward ? tailGlowMat : carGlowMat); tg.position.set(laneX, deckT / 2 + 0.9, zz - 2.5); grp.add(tg);
    }
    cars.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true; tails.instanceMatrix.needsUpdate = true;
    grp.add(cars); grp.add(heads); grp.add(tails);
    grp.traverse(o => { if (o.isMesh && o.material.isMeshStandardMaterial) { o.castShadow = true; o.receiveShadow = true; } });   // round 3: the deck shadows the dome
    scene.add(grp); grp.updateMatrixWorld(true);
    // round 4: the footpath railing light is spaced 0.3 m fixtures every ~6 m (bloom softens them) instead of a 1 px line
    { const ra = grp.localToWorld(V3(railX, FPY + 1.15, -len / 2)), rb = grp.localToWorld(V3(railX, FPY + 1.15, len / 2)); ledRun(ra, rb, 0.08, new THREE.Color(0.25, 0.9, 1.0), 0.3, 6, 0.7, 0.3, { priv: true, dark: 0.3, brMin: 0.5, brMax: 1.2 }); }
    // piers: 4-sided tapered concrete with caps (delta)
    const pierN = Math.floor(len / 34);
    const piers = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.6, 2.6, 1, 4), concMat2, pierN);
    const caps = new THREE.InstancedMesh(new THREE.BoxGeometry(15, 2.2, 5), concMat2, pierN);
    const qDeck = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
    for (let i = 0; i < pierN; i++) {
      const tt = (i + 0.5) / pierN; const p = new THREE.Vector3().lerpVectors(vA, vB, tt); const h = p.y - deckT / 2 - 1.8;
      mm.compose(new THREE.Vector3(p.x, h / 2, p.z), new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), yaw + Math.PI / 4), new THREE.Vector3(1.4, Math.max(h, 0.1), 1.4)); piers.setMatrixAt(i, mm);
      mm.compose(new THREE.Vector3(p.x, p.y - deckT / 2 - 2.9, p.z), qDeck, new THREE.Vector3(1, 1, 1)); caps.setMatrixAt(i, mm);
    }
    piers.instanceMatrix.needsUpdate = true; caps.instanceMatrix.needsUpdate = true; piers.frustumCulled = caps.frustumCulled = false; piers.castShadow = caps.castShadow = piers.receiveShadow = caps.receiveShadow = true; scene.add(piers); scene.add(caps);
    for (const tt of [0.5, 0.66, 0.82, 0.95]) addLight(new THREE.Vector3().lerpVectors(vA, vB, tt).add(new THREE.Vector3(0, 10.5, 0)), new THREE.Vector3(1.0, 0.58, 0.22).multiplyScalar(1.4), 34);
    // round 2: the magenta under-glow lights sit below the girder (no hotspots on the caps), dimmer and wider; two soft
    // magenta point lights wash the soffit / girder / pier caps for the standard materials
    for (const tt of [0.6, 0.78]) addLight(new THREE.Vector3().lerpVectors(vA, vB, tt).add(new THREE.Vector3(0, -9, 0)), new THREE.Vector3(1.0, 0.3, 0.9).multiplyScalar(0.35), 30);
    for (const tt of [0.66, 0.82]) { const pl = new THREE.PointLight(0x8a2a9a, 38, 20, 2); pl.position.lerpVectors(vA, vB, tt).add(new THREE.Vector3(0, -2.5, 0)); scene.add(pl); }
  }

  // =============================================================================================
  // WALKWAY: the camera stands on an elevated concrete walkway 20 m above the plaza (the sketch's lower-left diagonal is its
  // parapet). 2.2 m wide, parapet on the left, low curb on the right, a deep beam underneath. Continues toward the left tower.
  // =============================================================================================
  {
    const wlen = 170, wd0 = -12;
    const walkMat = makeConcreteMaterial(tConc, tNoise, { color: 0x3a3b3e, tile: 6, weather: 0.6, roughness: 0.3 });   // wet sheen
    const concCap = makeConcreteMaterial(tConc, tNoise, { color: 0x6c6d70, tile: 6, weather: 0.55, roughness: 0.42 });   // the cap: dark but not black, wet sheen (round 3)
    const yaw = Math.atan2(parDir.x, parDir.z);
    const wmid = pA.clone().addScaledVector(parDir, wd0 + wlen / 2);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.6, wlen), walkMat); slab.position.copy(wmid).addScaledVector(parLeft, 1.0).setY(WALKY - 0.8); slab.rotation.y = yaw; scene.add(slab);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.4, WALKY - 1.6, wlen), concDark); beam.position.copy(wmid).addScaledVector(parLeft, 1.0).setY((WALKY - 1.6) / 2); beam.rotation.y = yaw; scene.add(beam);
    const par = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, wlen), concMat2); par.position.copy(wmid).setY(WALKY + 0.6); par.rotation.y = yaw; scene.add(par);
    // round 2: dark cap (no flat tan ribbon), the near light raking the parapet's inner face from the walkway side
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, wlen), concCap); cap.position.copy(wmid).setY(WALKY + 1.26); cap.rotation.y = yaw; scene.add(cap);
    const curb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, wlen), concMat2); curb.position.copy(wmid).addScaledVector(parLeft, 2.4).setY(WALKY + 0.125); curb.rotation.y = yaw; scene.add(curb);
    for (const o of [slab, beam, par, cap, curb]) { o.castShadow = true; o.receiveShadow = true; }
    // round 3: the parapet LED is a LIGHT, not a vector: spaced 2.5 m fixtures (0.06 m, emissive 1.8 -> bloom) with 1 m gaps,
    // a 0.4 m additive halo strip behind them, and warm point lights every 3 m so the cap top and inner face are lit by it
    const ledA = pA.clone().addScaledVector(parDir, wd0).addScaledVector(parLeft, 0.6).setY(WALKY + 1.34), ledB = pA.clone().addScaledVector(parDir, wd0 + wlen).addScaledVector(parLeft, 0.6).setY(WALKY + 1.34);
    ledRun(ledA, ledB, 0.03, new THREE.Color(1.0, 0.6, 0.25), 1.8, 1.2, 1.0, 0.15);
    { const halo = new THREE.Mesh(new THREE.PlaneGeometry(wlen, 0.4), new THREE.MeshBasicMaterial({ map: tGlow, color: new THREE.Color(1.0, 0.6, 0.28).multiplyScalar(0.26), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })); halo.position.copy(wmid).addScaledVector(parLeft, 0.55).setY(WALKY + 1.36); halo.rotation.y = yaw + Math.PI / 2; scene.add(halo); }   // round 4: the plane's length is along local X (the parapet boxes' is along Z) - it stood across the frame as a hairline
    for (let d = 1.0; d < 40; d += 3) { const pl = new THREE.PointLight(0xffb878, 1.2, 6, 1.5); pl.position.copy(pA).addScaledVector(parDir, d).addScaledVector(parLeft, 0.7).setY(WALKY + 1.5); scene.add(pl); }
    // lit slots in the parapet face every 7 m (warm)
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 2.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.48, 0.28) }));
    for (let d = 5; d < wlen + wd0 - 3; d += 7) { const s = slot.clone(); s.position.copy(pA).addScaledVector(parDir, d).addScaledVector(parLeft, 0.52).setY(WALKY + 0.45); s.rotation.y = yaw; scene.add(s); }
    // round 3: the near warm light 3.5 -> 6 cd / 28 m (decay 1.5) and a cool fill from the landing's EXIT kiosk direction so the
    // foreground wedge sits at 14-22/255 with readable board-form concrete instead of crushed black
    const near = new THREE.PointLight(0xffb878, 3.8, 28, 1.5); near.position.set(-2.5, WALKY + 2.2, -4); scene.add(near);
    const fill = new THREE.PointLight(0x6f86b0, 1.0, 12, 2); fill.position.set(-2.5, WALKY + 1.0, -8); scene.add(fill);
    const fillK = new THREE.PointLight(0x5fa0b8, 1.5, 25, 2); fillK.position.set(7, WALKY + 3.0, -14); scene.add(fillK);
    addLight(V3(-2.5, WALKY + 2.2, -4), new THREE.Vector3(1.0, 0.7, 0.45).multiplyScalar(0.3), 9);
    addLight(V3(7, WALKY + 3.0, -14), new THREE.Vector3(0.37, 0.63, 0.72).multiplyScalar(0.25), 12);
    log('parapet', proj(pA.clone().setY(WALKY + 1.2)), proj(pA.clone().addScaledVector(parDir, 14).setY(WALKY + 1.2)));
  }

  // =============================================================================================
  // NEAR LANDING (round 2): a second skybridge ~11 m below the camera and 37-47 m out, in the lower-right of the frame. A lit
  // wet slab (planar reflection) with a 1.1 m parapet on its far edge, a cyan EXIT kiosk at its end and six coat figures at
  // 1.8 m (~30 px in the preview) standing against the lit floor - the scale cue the plaza dots could not give.
  // =============================================================================================
  const LANDY = 14.5, landFig = [];
  {
    const lx0 = 2, lx1 = 60, lz0 = -62, lz1 = -50;
    const cx = (lx0 + lx1) / 2, cz = (lz0 + lz1) / 2;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(lx1 - lx0, 1.6, lz1 - lz0), concMat2); slab.position.set(cx, LANDY - 0.8, cz); scene.add(slab);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(lx1 - lx0, 2.0, 2.0), concDark); beam.position.set(cx, LANDY - 2.6, cz); scene.add(beam);
    for (const colX of [cx - 18, cx + 18]) { const colm = new THREE.Mesh(new THREE.BoxGeometry(2.6, LANDY - 1.6, 2.6), concDark); colm.position.set(colX, (LANDY - 1.6) / 2, cz); colm.castShadow = colm.receiveShadow = true; scene.add(colm); }
    const par = new THREE.Mesh(new THREE.BoxGeometry(lx1 - lx0, 1.1, 0.4), concMat2); par.position.set(cx, LANDY + 0.55, lz0 + 0.2); scene.add(par);
    for (const o of [slab, beam, par]) { o.castShadow = true; o.receiveShadow = true; }
    const pled = new THREE.Mesh(new THREE.BoxGeometry(lx1 - lx0, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.9, 1.0).multiplyScalar(2.0) })); pled.position.set(cx, LANDY + 1.115, lz0 + 0.42); scene.add(pled);
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(lx1 - lx0, 0.3, 0.35), concMat2); kerb.position.set(cx, LANDY + 0.15, lz1 - 0.18); scene.add(kerb);
    const rw = Math.round(width * 0.4), rh = Math.round(height * 0.4);
    const sh = { name: 'WetLanding', uniforms: { ...lightUniforms, color: { value: new THREE.Color(0x111111) }, tDiffuse: { value: null }, textureMatrix: { value: new THREE.Matrix4() }, tNoise: { value: tNoise } }, vertexShader: GROUND_VERT, fragmentShader: SHDBG ? GROUND_FRAG.replace('col = applyFog(col, vWorldPos);', 'col = vec3(gShadow);') : GROUND_FRAG };
    const floor = new Reflector(new THREE.PlaneGeometry(lx1 - lx0 - 0.2, lz1 - lz0 - 0.6), { textureWidth: rw, textureHeight: rh, clipBias: 0.01, shader: sh, multisample: 0 });
    floor.rotation.x = -Math.PI / 2; floor.position.set(cx, LANDY + 0.02, cz); scene.add(floor);
    for (const k of Object.keys(lightUniforms)) floor.material.uniforms[k] = lightUniforms[k];
    floor.material.uniforms.tNoise.value = tNoise;
    const lampP = new THREE.PointLight(0xffc088, 18, 24, 2); lampP.position.set(cx - 6, LANDY + 3.2, lz0 + 1.2); scene.add(lampP);
    addLight(V3(cx - 6, LANDY + 3.2, lz0 + 1.2), new THREE.Vector3(1.0, 0.72, 0.45).multiplyScalar(0.7), 16);
    // a mast floodlight over the landing so the wet floor is LIT and the coats read as silhouettes against it
    addLight(V3(cx + 6, LANDY + 8, cz - 1), new THREE.Vector3(1.0, 0.80, 0.58).multiplyScalar(1.5), 30);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 8.2, 6), darkMat); mast.position.set(cx + 6, LANDY + 4.1, lz0 + 0.6); scene.add(mast);
    const mastArm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 2.2), darkMat); mastArm.position.set(cx + 6, LANDY + 8.1, lz0 + 1.6); scene.add(mastArm);
    const mastBulb = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.25, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.85, 0.62).multiplyScalar(2.4) })); mastBulb.position.set(cx + 6, LANDY + 7.95, lz0 + 2.6); scene.add(mastBulb);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.2, 6), darkMat); post.position.set(cx - 6, LANDY + 1.6, lz0 + 0.9); scene.add(post);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.75, 0.45).multiplyScalar(2.6) })); bulb.position.set(cx - 6, LANDY + 3.25, lz0 + 0.9); scene.add(bulb);
    // round 3: heights 1.6-1.9 m, three of them turned to walk along the landing, staggered off the straight line
    for (const [x, z, yaw, h] of [[8, -55.5, 1.45, 0.92], [14, -58.6, -0.5, 1.04], [16.5, -56.0, 1.65, 0.89], [25, -54.2, 1.3, 1.0], [31, -59.0, -1.5, 0.95], [38, -55.8, -0.9, 1.05]]) landFig.push({ x, z, y: LANDY, yaw, h });
    log('landing', proj(V3(lx0, LANDY, lz1)), proj(V3(lx1, LANDY, lz1)), proj(V3(lx0, LANDY, lz0)), proj(V3(lx1, LANDY, lz0)), 'fig', proj(V3(25, LANDY + 1.0, -54.5)));
  }

  // =============================================================================================
  // FIGURES: long black coats (elliptical section, flared split hem with legs, one shoulder higher, arms clear of the body,
  // forward lean), walking pairs with a shared heading, contact shadows, umbrellas on some. A few stand on the walkway at
  // 13-45 m (30-50 px), the rest are tiny on the plaza 20 m below (95-320 m), a queue at the dome portal, walkers on the viaduct.
  // =============================================================================================
  {
    const mk = (hat, swing) => {
      const prof = [[0.0, 0.30], [0.33, 0.30], [0.32, 0.44], [0.27, 0.78], [0.235, 1.15], [0.25, 1.33], [0.31, 1.42], [0.29, 1.46], [0.085, 1.50], [0.095, 1.55], [0.115, 1.62], [0.12, 1.69], [0.1, 1.77], [0.0, 1.81]].map(([r, y]) => new THREE.Vector2(r, y));
      const coat = new THREE.LatheGeometry(prof, 14); coat.scale(1.0, 1.0, 0.72);
      const legA = new THREE.CylinderGeometry(0.07, 0.085, 0.46, 6).translate(-0.10, 0.22, swing * 0.09);
      const legB = new THREE.CylinderGeometry(0.07, 0.085, 0.46, 6).translate(0.10, 0.22, -swing * 0.11);
      const armA = new THREE.CylinderGeometry(0.05, 0.065, 0.62, 6).rotateZ(0.10).rotateX(swing * 0.30).translate(-0.37, 1.12, 0.02);
      const armB = new THREE.CylinderGeometry(0.05, 0.065, 0.62, 6).rotateZ(-0.10).rotateX(-swing * 0.22).translate(0.37, 1.12, 0.0);
      const shA = new THREE.SphereGeometry(0.10, 7, 5).translate(-0.27, 1.43, 0.0);
      const shB = new THREE.SphereGeometry(0.10, 7, 5).translate(0.27, 1.47, 0.0);
      const parts = [coat, legA, legB, armA, armB, shA, shB];
      if (hat) { parts.push(new THREE.CylinderGeometry(0.23, 0.23, 0.03, 10).translate(0.02, 1.74, 0.03)); parts.push(new THREE.CylinderGeometry(0.1, 0.125, 0.14, 8).translate(0.02, 1.81, 0.03)); }
      return mergeGeometries(parts);
    };
    const figMat = new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.6, metalness: 0.0 });
    const spots = [];
    const lineDist = (x, z) => Math.abs((pB.x - pA.x) * (z - pA.z) - (pB.z - pA.z) * (x - pA.x)) / pA.distanceTo(pB);
    const alongPar = (x, z) => (x - pA.x) * parDir.x + (z - pA.z) * parDir.z;
    const pair = (x, z, y, yaw) => { const d = 0.9 + rnd() * 0.5; spots.push({ x: x + Math.cos(yaw) * d, z: z - Math.sin(yaw) * d, y, yaw: yaw + (rnd() - 0.5) * 0.3 }); };
    let tries = 0;
    const plazaN = isFinal ? 96 : 84;
    while (spots.length < plazaN && tries++ < 8000) {
      const z = -(90 + Math.pow(rnd(), 1.9) * 230); const x = (rnd() - 0.42) * (-z) * 1.1;
      if (Math.hypot(x - domeC.x, z - domeC.z) < domeR + 4) continue;
      if (lineDist(x, z) < 8 && alongPar(x, z) < 165) continue;   // not under the walkway
      if (x > 18 && x < 48 && z > -135 && z < -103 && rnd() < 0.85) continue;   // round 2: not hidden behind the pier
      if (!((x > -15 && x < 15) || (x > 50 && x < 80)) && rnd() < 0.45) continue;   // bias toward the two open strips
      if (spots.some(s => Math.hypot(s.x - x, s.z - z) < 2.0)) continue;
      const yaw = rnd() * Math.PI * 2;
      spots.push({ x, z, y: 0, yaw });
      if (rnd() < 0.5) pair(x, z, 0, yaw);
    }
    // queue silhouetted against the portal
    for (let i = 0; i < 16; i++) spots.push({ x: domeC.x - 10 + rnd() * 16, z: portalZ + 9 + rnd() * 10, y: 0, yaw: Math.PI + (rnd() - 0.5) * 0.7 });
    // walkers on the viaduct's camera-side footpath (round 3: t=0.86-0.92, 15 m closer -> >= 10 px silhouettes against the lit
    // train) plus two leaning on the footpath railing
    const vdir = new THREE.Vector3().subVectors(vB, vA); const vside = new THREE.Vector3(vdir.z, 0, -vdir.x).normalize(); const vyaw = Math.atan2(vdir.x, vdir.z);
    // round 4: t 0.78-0.84 (the train windows sit behind them), 10 walkers + 4 pair partners, uneven spacing (partners from a private PRNG)
    const wkr = mulberry32(seed * 41 + 9);
    for (let i = 0; i < 10; i++) { const tt = 0.78 + rnd() * 0.06; const p = new THREE.Vector3().lerpVectors(vA, vB, tt); const sxz = vside.clone().multiplyScalar(-(6.3 + rnd() * 1.2)); const yw = vyaw + (rnd() < 0.5 ? 0 : Math.PI); spots.push({ x: p.x + sxz.x, z: p.z + sxz.z, y: p.y + 1.27, yaw: yw }); if (i === 0) log('viaduct walker', proj(V3(p.x + sxz.x, p.y + 2.2, p.z + sxz.z)));
      if (i % 3 === 1 || i === 6) { const dd = 0.8 + 0.5 * wkr(); spots.push({ x: p.x + sxz.x + Math.cos(yw) * dd, z: p.z + sxz.z - Math.sin(yw) * dd, y: p.y + 1.27, yaw: yw + (wkr() - 0.5) * 0.3 }); } }
    for (const tt of [0.815, 0.85]) { const p = new THREE.Vector3().lerpVectors(vA, vB, tt); const sxz = vside.clone().multiplyScalar(-7.35); spots.push({ x: p.x + sxz.x, z: p.z + sxz.z, y: p.y + 1.27, yaw: vyaw - Math.PI / 2, lean: 0.28, h: 0.98 }); }
    // round 3: two figures on the camera's own walkway - one leaning on the parapet 4 m away (cropped by the left edge is fine,
    // ref 1's foreground figure), one walking away at 7.5 m - the foreground scale anchor
    const parYaw = Math.atan2(parRight.x, parRight.z);
    // (the walkway floor is out of frame left of the parapet, so the figure stands at the parapet's inner face, 3.4 m away, and
    // leans 0.42 rad over the cap: its head and shoulders enter the frame over the parapet, ref 1's cropped foreground figure)
    // round 4: rebuilt as true silhouettes (albedo 0.02, roughness 1): coat + head + forearms resting on the cap, lean 0.08, at
    // 5.5 and 8.0 m along the parapet so hat / head and shoulders stand over the cap against the EXIT kiosk glow
    // (only one: the walkway floor is outside the frame, so a figure shows only where its head / shoulders / forearms come over
    // the cap; it stands against the parapet's inner face 3.2 m away, leaning 0.28 rad, cropped by the left edge like ref 1)
    { const p = pA.clone().addScaledVector(parDir, 3.2).addScaledVector(parLeft, 0.40); spots.push({ x: p.x, z: p.z, y: WALKY, yaw: parYaw, lean: 0.28, h: 1.0, near: true, hat: true, armY: 1.50 }); log('near leaner', proj(p.clone().addScaledVector(parRight, 0.05).setY(WALKY + 1.45)), proj(p.clone().addScaledVector(parRight, 0.1).setY(WALKY + 1.72))); }
    for (const f of landFig) spots.push(f);
    const lists = [[], [], [], [], []]; spots.forEach(s => lists[s.near ? 4 : (rnd() < 0.35 ? 2 : 0) + (rnd() < 0.5 ? 1 : 0)].push(s));
    const nearMat = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 1.0, metalness: 0.0 });   // round 4: the foreground coats are silhouettes (albedo 0.02, no specular)
    const mkNear = (hat, armY = 1.36) => {
      const prof = [[0.0, 0.30], [0.34, 0.30], [0.33, 0.44], [0.28, 0.78], [0.24, 1.15], [0.25, 1.33], [0.31, 1.42], [0.29, 1.47], [0.085, 1.51], [0.095, 1.56], [0.10, 1.59]].map(([r, y]) => new THREE.Vector2(r, y));
      const coat = new THREE.LatheGeometry(prof, 16); coat.scale(1.0, 1.0, 0.72);
      const head = new THREE.SphereGeometry(0.105, 10, 8).scale(1, 1.15, 1).translate(0, 1.68, 0.02);
      const shA = new THREE.SphereGeometry(0.11, 8, 6).translate(-0.27, 1.43, 0.0), shB = new THREE.SphereGeometry(0.11, 8, 6).translate(0.27, 1.45, 0.0);
      const upA = new THREE.CylinderGeometry(0.055, 0.06, 0.34, 6).rotateX(0.6).translate(-0.29, armY - 0.07, 0.10), upB = new THREE.CylinderGeometry(0.055, 0.06, 0.34, 6).rotateX(0.6).translate(0.29, armY - 0.06, 0.10);
      const foreA = new THREE.CylinderGeometry(0.045, 0.05, 0.5, 6).rotateX(Math.PI / 2).translate(-0.22, armY, 0.42), foreB = new THREE.CylinderGeometry(0.045, 0.05, 0.5, 6).rotateX(Math.PI / 2).translate(0.21, armY, 0.40);
      const parts = [coat, head, shA, shB, upA, upB, foreA, foreB];
      if (hat) { parts.push(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 12).translate(0.0, 1.77, 0.03)); parts.push(new THREE.CylinderGeometry(0.085, 0.10, 0.10, 10).translate(0.0, 1.82, 0.03)); }
      return mergeGeometries(parts);
    };
    const mm = new THREE.Matrix4();
    [[mk(false, 1), lists[0]], [mk(false, -1), lists[1]], [mk(true, 1), lists[2]], [mk(true, -1), lists[3]], [null, lists[4]]].forEach(([geo, list], li) => {
      if (!list.length) return;
      if (li === 4) { for (const s of list) { const o = new THREE.Mesh(mkNear(!!s.hat, s.armY), nearMat); o.position.set(s.x, s.y, s.z); o.rotation.order = 'YXZ'; o.rotation.set(s.lean, s.yaw, 0); o.scale.set(s.h, s.h, s.h); o.castShadow = true; scene.add(o); } return; }
      const im = new THREE.InstancedMesh(geo, li === 4 ? nearMat : figMat, list.length);
      list.forEach((s, i) => { const sc = s.h || (0.92 + rnd() * 0.16); mm.compose(new THREE.Vector3(s.x, s.y, s.z), new THREE.Quaternion().setFromEuler(new THREE.Euler((s.lean !== undefined ? s.lean : 0.05 + rnd() * 0.06), s.yaw, (rnd() - 0.5) * 0.05, 'YXZ')), new THREE.Vector3(sc, sc * (0.96 + rnd() * 0.1), sc)); im.setMatrixAt(i, mm); });
      im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; scene.add(im);
    });
    const umbPick = []; for (let i = 0; i < Math.floor(spots.length * 0.16); i++) { const s = spots[Math.floor(rnd() * spots.length)]; if (!s.near) umbPick.push(s); } umbPick.push(landFig[1], landFig[4]);
    const umbN = umbPick.length;
    const umb = new THREE.InstancedMesh(new THREE.ConeGeometry(0.58, 0.22, 8), figMat, umbN);
    umbPick.forEach((s, i) => { mm.makeTranslation(s.x + 0.1, s.y + 2.05 * (s.h || 1), s.z + 0.1); umb.setMatrixAt(i, mm); });
    umb.instanceMatrix.needsUpdate = true; umb.frustumCulled = false; umb.castShadow = true; scene.add(umb);
    // (round 3: the flat contact discs are gone - the figures now cast real shadows from the key)
    log('figures', spots.length, 'umbrellas', umbN);
  }

  // =============================================================================================
  // HOLOGRAMS
  // =============================================================================================
  const holoGroup = new THREE.Group(); scene.add(holoGroup);
  let holoSeed = 1;
  function addBeam(A, B, rA, rB, col, intensity) {
    const dir = A.clone().sub(B); const len = dir.length(); dir.normalize();
    const g = new THREE.CylinderGeometry(rA, rB, len, 24, 1, true);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { ...lightUniforms, uCol: { value: col }, uInt: { value: intensity } }, vertexShader: HOLO_VERT, fragmentShader: BEAM_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(V3(0, 1, 0), dir); holoGroup.add(m);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 1.4), new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.5, metalness: 0.5 })); box.position.copy(A); scene.add(box);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(col.x, col.y, col.z).multiplyScalar(5) })); lens.position.copy(A).add(B.clone().sub(A).normalize().multiplyScalar(0.9)); scene.add(lens);
  }
  function addHolo(pos, w, h, yaw, col, col2, opt = {}) {
    const kind = opt.kind || (w > h * 1.3 ? 'wide' : (h > w * 1.3 ? 'banner' : 'wide'));
    const K = isFinal ? 2 : 1;
    const sizes = { banner: [512, 1536], ticker: [2048, 256], billboard: [1536, 768], blade: [384, 1920], wide: [1024, 512], portrait: [384, 1536], exit: [512, 1024] };
    const [tw0, th0] = sizes[kind] || sizes.wide; const tw = tw0 * K, th = th0 * K;
    const tex = makeHoloTexture(mulberry32(seed * 31 + holoSeed * 17), tw, th, kind, opt);
    const flick = opt.flick !== undefined ? opt.flick : (rnd() < 0.25 ? 0.55 + rnd() * 0.25 : 0.9 + rnd() * 0.15);
    const inten = (opt.intensity || 2.4) * flick;
    // scan-line period in metres chosen from the sign's distance so it lands at ~3 px in the preview (~12 px at 3024 px)
    const scanM = opt.scanM || Math.max(0.3, pos.distanceTo(camera.position) / 200);
    const tcol = opt.ink ? new THREE.Vector3(1, 1, 1) : col, tcol2 = opt.ink ? new THREE.Vector3(1, 1, 1) : (col2 || col);
    const mkMat = (intMul, seedOff) => new THREE.ShaderMaterial({
      vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG, uniforms: { ...lightUniforms, tMap: { value: tex }, uCol: { value: tcol }, uCol2: { value: tcol2 }, uInt: { value: inten * intMul }, uCore: { value: opt.coreMul !== undefined ? opt.coreMul : 0.9 }, uSeed: { value: holoSeed * 1.37 + seedOff }, uAspect: { value: w / h }, uScan: { value: Math.PI * 2 * h / scanM }, uGlitch: { value: opt.glitch !== undefined ? opt.glitch : (flick < 0.85 ? 0.18 : 0.07) } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const mat = mkMat(1, 0);
    const geo = new THREE.PlaneGeometry(w, h);
    const m = new THREE.Mesh(geo, mat); m.position.copy(pos); m.rotation.order = 'YXZ'; m.rotation.y = yaw; if (opt.tilt) m.rotation.x = opt.tilt;
    holoGroup.add(m);
    const nrm = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    // round 2: the facade-scale designed ads get a dark translucent backing panel so their glyphs sit on a darkened field
    // round 3: backing 0.62 -> 0.4 (the facade shows through), plus a 2-3 m offset ghost copy at 25% for the big signs
    if (kind === 'billboard' || opt.backing) { const bk = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.97, h * 0.95), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: opt.backing || 0.4, depthWrite: false })); bk.position.copy(pos).add(nrm.clone().multiplyScalar(-0.6)); bk.rotation.copy(m.rotation); bk.renderOrder = -1; scene.add(bk); }
    if (opt.ghost !== false && (kind === 'billboard' || kind === 'banner' || kind === 'blade' || kind === 'portrait') && opt.light !== false) {
      const gh = new THREE.Mesh(geo, mkMat(0.25, 0.5)); gh.position.copy(pos).add(nrm.clone().multiplyScalar(2.6)).add(V3(w * 0.025 + 0.8, h * 0.015 + 1.0, 0)); gh.rotation.copy(m.rotation); holoGroup.add(gh);
    }
    const gm = new THREE.ShaderMaterial({ vertexShader: HOLO_VERT, fragmentShader: GLOW_FRAG, uniforms: { ...lightUniforms, uCol: { value: col }, uInt: { value: (opt.glow !== undefined ? opt.glow : 0.32) * flick } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const g = new THREE.Mesh(new THREE.PlaneGeometry(w * 2.2, h * 1.6), gm); g.position.copy(pos); g.rotation.copy(m.rotation); holoGroup.add(g);
    // volumetric halo for the big signs: a much larger, dimmer glow quad so the hologram lights the fog around it (round 3: 1.4x bigger)
    if (opt.halo) { const hm = new THREE.ShaderMaterial({ vertexShader: HOLO_VERT, fragmentShader: GLOW_FRAG, uniforms: { ...lightUniforms, uCol: { value: col }, uInt: { value: opt.halo * flick } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }); const hq = new THREE.Mesh(new THREE.PlaneGeometry(w * 6.0, h * 4.6), hm); hq.position.copy(pos).add(nrm.clone().multiplyScalar(2.5)); hq.rotation.copy(m.rotation); holoGroup.add(hq); }
    // round 2: sign spill reaches ~1.2 sign-widths, not 4 (r x0.6, I x0.8): concrete far from a sign stays dark
    if (opt.light !== false) addLight(pos.clone().add(nrm.clone().multiplyScalar(opt.lightOff || 12)), col.clone().multiplyScalar((opt.lightI || 2.0) * flick * 0.8), (opt.lightR || Math.max(w, h) * 2.2) * 0.6);
    if (opt.beam) { const from = opt.beam.from || pos.clone().add(nrm.clone().multiplyScalar(-(opt.beam.back || 8))).add(V3(0, -h * 0.62, 0)); addBeam(from, pos.clone(), 0.4, Math.min(w, h) * 0.42, col, (opt.beam.int || 0.22) * flick); }
    holoSeed++;
    return m;
  }
  const CYAN = new THREE.Vector3(0.25, 0.85, 1.0), MAG = new THREE.Vector3(1.0, 0.25, 0.75), AMB = new THREE.Vector3(1.0, 0.70, 0.28), RED = new THREE.Vector3(1.0, 0.18, 0.12), VIO = new THREE.Vector3(0.55, 0.35, 1.0), WHT = new THREE.Vector3(0.85, 0.92, 1.0);
  // centre body (round 2): ONE facade-scale designed billboard (cyan/magenta, 90x45 m) on the lower face; the SORA banner pulled
  // 30 m clear of the face with no projector beam (its beam/halo quads cut through the ledges and read as a glass pavilion);
  // MIRAI removed; a crisp amber ticker under the top edge
  // round 3: SECTOR 9's spill trimmed (lightI 1.25 -> 0.7, r 170 -> 120) so the centre body sits ~70-80 not 124; halo 0.06 -> 0.16
  // round 4: SECTOR 9 rebuilt like NOVA - a saturated cyan headline on the dark backing with a magenta border / icon, intensity 1.5 -> 0.9,
  // core 0.9 -> 0.5, halo 0.16 -> 0.10, spill 0.55 -> 0.35 at r 92 (no more pink-white slab; the board-form stays visible around it)
  addHolo(new THREE.Vector3(-18, 190, CZ1 + 9), 90, 45, 0, CYAN, MAG, { kind: 'billboard', intensity: 0.9, glow: 0.10, lightI: 0.35, lightR: 92, word: 'SECTOR 9', jword: '第九区 — 深夜営業', flick: 1.0, halo: 0.10, icon: 0, coreMul: 0.5, ink: { border: '#ff3cc0', icon: '#ff3cc0', text: '#3ad8ff', sub: '#8fd2e6' } });
  addHolo(new THREE.Vector3(-54, 118, CZ1 + 30), 16, 80, 0.12, CYAN, VIO, { kind: 'banner', intensity: 0.65, glow: 0.08, lightI: 0.5, lightR: 80, word: 'SORA', jword: '未来都市', flick: 1.0, halo: 0.03, coreMul: 0.5 });   // round 4: was the brightest thing in the frame
  addHolo(new THREE.Vector3(-8, 262, CZ1 + 5), 84, 5, 0, AMB, AMB, { kind: 'ticker', intensity: 1.6, glow: 0.1, light: false });
  // (round 3: ALWAYS WATCHING deleted - an unreadable smudge at the top left; the facet stays mostly dark as the top of the tower)
  // facade-scale translucent portrait hologram over the dome's left shoulder (between the viaduct and the SORA banner)
  addHolo(new THREE.Vector3(-46, 74, -150), 16, 50, 0.28, VIO, CYAN, { kind: 'portrait', intensity: 0.9, glow: 0.10, lightI: 0.6, lightR: 50, word: 'KAZE', jword: '合成皮膚', halo: 0.05, flick: 1.0 });
  log('portrait L', proj(V3(-46, 49, -150)), proj(V3(-46, 99, -150)));
  // left tower right face (faces +x): tall amber banner (projected, no beam) + ticker; two stacked-kanji blade signs standing off the wall
  addHolo(new THREE.Vector3(-88, 150, -250), 26, 80, Math.PI / 2, AMB, RED, { kind: 'banner', intensity: 1.3, glow: 0.14, lightI: 1.8, lightR: 150, word: 'LIVE', jword: '横浜重工', flick: 1.0 });
  addHolo(new THREE.Vector3(-88, 70, -240), 90, 8, Math.PI / 2, CYAN, CYAN, { kind: 'ticker', intensity: 1.6, lightI: 1.0, lightR: 90 });
  addHolo(new THREE.Vector3(-92 + 4.5, 122, -205), 8, 40, 0, CYAN, MAG, { kind: 'blade', intensity: 1.6, glow: 0.3, lightI: 1.4, lightR: 80, word: 'KAZE', jword: '合成皮膚研究', lightOff: 5, halo: 0.04 });
  addHolo(new THREE.Vector3(-92 + 4.5, 178, -215), 8, 40, 0, AMB, WHT, { kind: 'blade', intensity: 1.6, glow: 0.25, lightI: 1.2, lightR: 80, word: 'ULTRA', jword: '上昇気流', lightOff: 5, halo: 0.04 });
  log('blades', proj(V3(-87.5, 122, -205)), proj(V3(-87.5, 178, -215)), 'billboard', proj(V3(-18, 190, CZ1 + 9)));
  // right tower: MIDNIGHT as a 120x60 m amber/red designed panel on the lower block (cup icon), a second red/amber billboard on
  // the cantilever stack (its light spills onto the soffits), banner on the shaft's left face, a blade off the shaft
  addHolo(new THREE.Vector3(182, 118, RZ1 + 8), 110, 55, 0, AMB, RED, { kind: 'billboard', intensity: 1.2, glow: 0.12, lightI: 1.2, lightR: 150, word: 'MIDNIGHT', jword: '深夜食堂 二十四時間', flick: 1.0, halo: 0.16, icon: 1 });
  addHolo(new THREE.Vector3(150, 398, RZ1 + 10), 96, 44, 0, RED, AMB, { kind: 'billboard', intensity: 1.5, glow: 0.14, lightI: 1.3, lightR: 130, word: 'NOVA', jword: '新星重工', halo: 0.16, icon: 3, flick: 1.0 });
  log('midnight', proj(V3(182, 118, RZ1 + 8)), 'nova', proj(V3(150, 398, RZ1 + 10)));
  // round 3: a 40x140 m translucent portrait hologram floating off the lower block's upper right (by the notch)
  addHolo(new THREE.Vector3(226, 240, RZ1 + 26), 40, 140, -0.12, MAG, AMB, { kind: 'portrait', intensity: 0.95, glow: 0.12, lightI: 0.9, lightR: 110, word: 'SYNTH', jword: '合成皮膚研究所', halo: 0.10, flick: 1.0 });
  log('portrait R', proj(V3(226, 170, RZ1 + 26)), proj(V3(226, 310, RZ1 + 26)));
  // the upper block (stepped back): a blade sign + its lit windows so the mass reads as a building against the sky
  addHolo(new THREE.Vector3(245, 800, RZ1 - 70 + 9), 22, 90, 0, AMB, RED, { kind: 'blade', intensity: 1.5, glow: 0.22, lightI: 1.3, lightR: 110, word: 'AXIS', jword: '空港線', lightOff: 7 });
  log('axis blade', proj(V3(245, 800, RZ1 - 61)));
  addHolo(new THREE.Vector3(53, 580, -520), 24, 70, -Math.PI / 2, CYAN, MAG, { kind: 'banner', intensity: 1.6, lightI: 1.4, lightR: 130, word: 'NEXUS', jword: '新宿第七区' });
  addHolo(new THREE.Vector3(35 - 6.5, 430, -425), 13, 38, 0, MAG, VIO, { kind: 'blade', intensity: 1.5, glow: 0.25, lightI: 1.2, lightR: 90, word: 'VOID', jword: '記憶倉庫', lightOff: 6 });
  // floating panels between the towers
  addHolo(new THREE.Vector3(62, 338, -300), 40, 18, 0.25, VIO, CYAN, { kind: 'wide', intensity: 1.5, glow: 0.25, lightI: 1.0, lightR: 120 });
  addHolo(new THREE.Vector3(40, 420, -330), 26, 54, -0.3, MAG, VIO, { kind: 'banner', intensity: 1.5, glow: 0.22, light: false });
  // (round 3: the 56x24 panel at (-170,330,-174) deleted too - it was the 'TRANSIT'/'ULTRA' bar on the left tower's band)
  // (round 3: the 40x18 panel at (-150,420,-140) deleted - it sat on the left tower's band as a flat bar at the top-left)
  addHolo(new THREE.Vector3(72, 250, -205), 26, 12, -0.15, CYAN, CYAN, { kind: 'wide', intensity: 1.6, glow: 0.3, light: false });
  // big dim billboards far behind the towers so silhouettes read against light (ref 3); the one behind the right tower is huge
  // (round 4: the 220x110 m far billboard at (620,620,-950) deleted - only its empty frame peeked past the upper block's right edge)
  addHolo(new THREE.Vector3(380, 250, -760), 150, 70, -0.3, AMB, RED, { kind: 'wide', intensity: 1.0, glow: 0.35, light: false });
  addHolo(new THREE.Vector3(-420, 560, -950), 200, 100, 0.3, MAG, AMB, { kind: 'wide', intensity: 0.9, glow: 0.35, light: false });
  addHolo(new THREE.Vector3(-150, 390, -640), 90, 45, 0.15, VIO, CYAN, { kind: 'wide', intensity: 1.0, glow: 0.45, light: false });
  addHolo(new THREE.Vector3(430, 760, -760), 110, 55, -0.2, CYAN, MAG, { kind: 'wide', intensity: 0.9, glow: 0.4, light: false });
  // round 3: TRANSIT is a small lit station nameboard standing on the viaduct's far parapet at t=0.26, not a bar on the left tower
  { const tp = new THREE.Vector3().lerpVectors(vA, vB, 0.49); const vd = new THREE.Vector3().subVectors(vB, vA); const vs = new THREE.Vector3(vd.z, 0, -vd.x).normalize(); const sp = tp.clone().addScaledVector(vs, 4.6).add(V3(0, 6.2, 0));
    addHolo(sp, 16, 4.5, Math.atan2(vd.x, vd.z) - Math.PI / 2, CYAN, WHT, { kind: 'wide', intensity: 1.5, glow: 0.2, light: false, word: 'TRANSIT', jword: '次の駅', flick: 1.0 }); log('transit board', proj(sp)); }
  addHolo(new THREE.Vector3(60, 150, -190), 10, 22, -0.6, AMB, RED, { kind: 'banner', intensity: 1.5, glow: 0.3, light: false });
  // plaza kiosks (light the figures), legible: cores no longer clip
  addHolo(new THREE.Vector3(34, 6, -96), 9, 5, -0.5, MAG, CYAN, { kind: 'wide', intensity: 1.2, glow: 0.35, lightI: 1.4, lightR: 45, lightOff: 4, word: 'RAMEN', jword: '深夜食堂' });
  addHolo(new THREE.Vector3(-30, 12, -95), 10, 16, 0.6, CYAN, CYAN, { kind: 'exit', intensity: 1.0, glow: 0.3, lightI: 1.3, lightR: 50, lightOff: 4, word: 'EXIT', jword: '出口' });
  // the near landing's kiosk: cyan EXIT blade at its far end -> cyan rim on the near figures
  addHolo(new THREE.Vector3(50, LANDY + 4.6, -57.5), 4, 8, -0.7, CYAN, CYAN, { kind: 'exit', intensity: 0.9, glow: 0.22, lightI: 1.6, lightR: 30, lightOff: 3, word: 'EXIT', jword: '出口' });   // round 4: legible running-man EXIT, ~30% dimmer
  // (round 2: the dome ticker rings were deleted - they read as lens artefacts cut by the dome silhouette)
  for (let i = 0; i < 8; i++) {
    const x = -700 + rnd() * 1400, z = -700 - rnd() * 700, y = 80 + rnd() * 320; const w = 30 + rnd() * 50, h = 15 + rnd() * 40;
    addHolo(new THREE.Vector3(x, y, z), w, h, (rnd() - 0.5) * 0.8, [CYAN, MAG, AMB, RED, VIO][i % 5], [CYAN, MAG, AMB, RED, VIO][(i + 2) % 5], { intensity: 1.5, glow: 0.2, light: false });
  }
  lightUniforms.uLightN.value = holoLights.length;
  holoLights.forEach((l, i) => { lightUniforms.uLightPos.value[i].copy(l.pos); lightUniforms.uLightCol.value[i].copy(l.col); lightUniforms.uLightRad.value[i] = l.rad; });
  log('holo lights', holoLights.length);
  if (PARAMS.noshadow) { lightUniforms.uShadowOn.value = 0; key.castShadow = false; log('DEBUG: shadows off'); }

  // standard-material lights (ledges, dome ribs, viaduct, figures)
  // round 2: night exposure for the standard materials too (hemisphere 1.5 -> 0.6, key 0.9 -> 0.65 from the same upper-left
  // direction as the facade key); small-radius lights (kiosks, under-deck) get 0.10 r^2 instead of 0.35 r^2 so they do not hotspot
  // round 3: hemisphere 0.6 -> 0.4 (the key with its shadow map was created up top, next to the shader lighting uniforms)
  scene.add(new THREE.HemisphereLight(0x1e2a3e, 0x120f0b, 0.4));
  // The shader lights saturate near the emitter (att -> 1); an inverse-square PointLight does not, which is what blew the
  // fins / ledges / pier caps next to every sign into hot blobs. Big sign lights: decay 0 inside 1.6 r (flat, matching the
  // shader's plateau, the cutoff curve fades them); small lights: decay 1.
  for (const l of holoLights) {
    const mx = Math.max(l.col.x, l.col.y, l.col.z, 1e-3); const g = (l.col.x + l.col.y + l.col.z) / (3 * mx);
    const c = new THREE.Color(l.col.x / mx, l.col.y / mx, l.col.z / mx).lerp(new THREE.Color(g, g, g), 0.45);   // concrete takes the holo colour desaturated (as the facade shader does)
    const pl = l.rad > 40 ? new THREE.PointLight(c, mx * 0.85, l.rad * 1.6, 0) : new THREE.PointLight(c, mx * 0.45 * l.rad, l.rad * 2.2, 1);
    pl.position.copy(l.pos); scene.add(pl);
  }

  // =============================================================================================
  // SKY, HAZE, wet ground (planar reflection)
  // =============================================================================================
  {
    const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: { tNoise: { value: tNoise }, uTop: { value: new THREE.Vector3(0.029, 0.026, 0.034) }, uHor: { value: new THREE.Vector3(0.056, 0.049, 0.066) }, uGlow: { value: new THREE.Vector3(0.070, 0.050, 0.082) }, uGlow2: { value: new THREE.Vector3(0.050, 0.068, 0.095) } }, side: THREE.BackSide, depthWrite: false, fog: false });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), skyMat); sky.renderOrder = -10; scene.add(sky);
  }
  {
    // round 2: three more haze cards between the dome and the centre tower, cards above y=250 at x2.0 opacity (aerial
    // perspective on the upper reaches), and a kiosk-lit ground-mist layer over the plaza (y 0-8)
    const cards = [[-10, 30, -106, 260, 90, 0.10], [0, 165, -221, 420, 270, 0.26], [-150, 210, -176, 300, 240, 0.2], [150, 300, -391, 420, 320, 0.22], [-40, 430, -600, 900, 520, 0.30], [-100, 350, -820, 1300, 650, 0.30], [220, 90, -330, 300, 160, 0.22], [-125, 250, -445, 240, 420, 0.42], [430, 560, -700, 500, 500, 0.3], [150, 420, -520, 520, 420, 0.26],
      [-30, 95, -250, 220, 110, 0.14], [60, 135, -290, 260, 120, 0.16], [-95, 75, -238, 180, 90, 0.13]];
    const mist = [[45, 4, -118, 170, 12, 0.32], [80, 5, -165, 220, 14, 0.26], [15, 3, -96, 120, 9, 0.24]];
    const mkCard = (x, y, z, w, h, op, col) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tHaze, color: col, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      m.position.set(x, y, z); m.lookAt(camera.position.x, y, camera.position.z); m.renderOrder = -2; scene.add(m);
    };
    // (the cards are a big part of why round 1 sat at a flat mid-grey: 1.6x opacity lifted everything; now 0.9x / 1.15x high up)
    for (const [x, y, z, w, h, op] of cards) mkCard(x, y, z, w, h, op * (y > 250 ? 1.15 : 0.9), new THREE.Color(0.11, 0.13, 0.20));
    for (const [x, y, z, w, h, op] of mist) mkCard(x, y, z, w, h, op * 0.7, new THREE.Color(0.16, 0.15, 0.21));
    for (let i = 0; i < 4; i++) {
      const ms = new THREE.Mesh(new THREE.PlaneGeometry(420, 70), new THREE.MeshBasicMaterial({ map: tGlow, color: new THREE.Color(0.35, 0.42, 0.6).multiplyScalar(0.05), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      ms.position.set(-20 + i * 25, 14 + i * 12, -120 - i * 45); scene.add(ms);
    }
  }
  {
    const rw = isFinal ? Math.round(width * 0.6) : Math.round(width * 0.5), rh = isFinal ? Math.round(height * 0.6) : Math.round(height * 0.5);
    const groundShader = { name: 'WetGround', uniforms: { ...lightUniforms, color: { value: new THREE.Color(0x111111) }, tDiffuse: { value: null }, textureMatrix: { value: new THREE.Matrix4() }, tNoise: { value: tNoise } }, vertexShader: GROUND_VERT, fragmentShader: SHDBG ? GROUND_FRAG.replace('col = applyFog(col, vWorldPos);', 'col = vec3(gShadow);') : GROUND_FRAG };
    const ground = new Reflector(new THREE.PlaneGeometry(4000, 4000), { textureWidth: rw, textureHeight: rh, clipBias: 0.02, shader: groundShader, multisample: 0 });
    ground.rotation.x = -Math.PI / 2; ground.position.y = 0.0; scene.add(ground);
    for (const k of Object.keys(lightUniforms)) ground.material.uniforms[k] = lightUniforms[k];
    ground.material.uniforms.tNoise.value = tNoise;
  }

  // =============================================================================================
  // RENDER: bloom on hot pixels only, output (ACES + sRGB), then the phone look pass
  // =============================================================================================
  // final: 4x MSAA on the scene buffer (readBuffer = renderTarget2 takes the RenderPass and the bloom composite); the other buffer
  // only ever receives full-screen quads, so it stays single-sampled. --msaa=0 disables it.
  const SAMPLES = PARAMS.msaa !== undefined ? Math.max(0, parseInt(PARAMS.msaa) || 0) : 4;
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: SAMPLES }));
  if (SAMPLES > 0) { composer.renderTarget1.dispose(); composer.renderTarget1 = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType }); composer.writeBuffer = composer.renderTarget1; }
  log('msaa', SAMPLES);
  composer.addPass(new RenderPass(scene, camera));
  // bloom mips pinned to a fixed internal resolution so the blur radius (in frame fraction) is the same at preview and final size
  const bloom = new UnrealBloomPass(new THREE.Vector2(756, 1008), 0.52, 0.5, 0.9);   // round 2: glyph cores (1.2-1.8) now cross the threshold
  composer.addPass(bloom);
  bloom.setSize(756, 1008);
  composer.addPass(new OutputPass());
  const look = new ShaderPass(new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(width, height) }, uSeed: { value: seed * 0.731 } }, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: PHONE_FRAG }));
  composer.addPass(look);
  log('build', (performance.now() - t0).toFixed(0) + 'ms; rendering...');
  const t1 = performance.now();
  composer.render();
  log('render', (performance.now() - t1).toFixed(0) + 'ms', 'tris', renderer.info.render.triangles, 'calls', renderer.info.render.calls);
  if (SHDBG) {
    const px = new Uint8Array(SHADOW_RES * SHADOW_RES * 4);
    renderer.readRenderTargetPixels(key.shadow.map, 0, 0, SHADOW_RES, SHADOW_RES, px);
    const unpack = (i) => (px[i] / 255) + (px[i + 1] / 255) / 255 + (px[i + 2] / 255) / 65025 + (px[i + 3] / 255) / 16581375;
    let covered = 0; for (let i = 0; i < px.length; i += 4) if (unpack(i) < 0.999) covered++;
    log('shadow map covered texels', covered, 'of', SHADOW_RES * SHADOW_RES);
    for (const [lab, P] of [['landing fig feet', V3(25, 14.6, -54.2)], ['landing fig head', V3(25, 16.2, -54.2)], ['landing floor R', V3(29, 14.6, -55.0)], ['dome lower-left', V3(-30, 20, -140)]]) {
      const q = P.clone().applyMatrix4(key.shadow.matrix); const tx = Math.floor(q.x * SHADOW_RES), ty = Math.floor(q.y * SHADOW_RES);
      let row = ''; for (let dy = -2; dy <= 2; dy++) { for (let dx = -2; dx <= 2; dx++) { const i = ((ty + dy) * SHADOW_RES + (tx + dx)) * 4; row += unpack(i).toFixed(4) + ' '; } row += '| '; }
      log(lab, 'uv', q.x.toFixed(4), q.y.toFixed(4), 'z', q.z.toFixed(4), 'map:', row);
    }
  }
}
