/*
 * BridgeLine Health — hero scene
 * A tied-arch "bridge of light" (the logo silhouette, engineered in 3D):
 * twin glowing arch ribs, hanger cables, a node-built deck and pillars,
 * a water reflection, bloom, streaming particles, and a periodic match
 * pulse that travels the arc. Pauses off-screen / tab-hidden.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const COL = {
  teal: new THREE.Color('#5fd9c6'),
  tealHot: new THREE.Color('#a8f3e6'),
  tealSoft: new THREE.Color('#2fa392'),
  blue: new THREE.Color('#7fb3e0'),
  blueDim: new THREE.Color('#3c648f'),
};

const rand = (a, b) => a + Math.random() * (b - a);

// gentle counterclockwise yaw (~28°): depth and parallax without losing the arch silhouette
const BASE_YAW = 0.49;

/* ---------- generated textures ---------- */
function dotTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

function backgroundTexture() {
  const w = 1024, h = 1024;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(w * 0.78, h * 0.08, 0, w * 0.78, h * 0.08, w * 1.15);
  g.addColorStop(0, '#11355c');
  g.addColorStop(0.46, '#0a2540');
  g.addColorStop(1, '#071c33');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------- twinkle / flare point shader ---------- */
const POINT_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPR;
  uniform vec3 uPulse;
  uniform float uPulseStr;
  uniform float uPulseK;
  uniform vec3 uPointer;
  uniform float uPointerStr;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    float tw = 0.62 + 0.38 * sin(uTime * 1.7 + aPhase);
    float dp = distance(p, uPulse);
    float flare = uPulseStr * exp(-dp * dp * uPulseK);
    float dm = distance(p.xy, uPointer.xy);
    float hover = uPointerStr * exp(-dm * dm * 0.30);
    float boost = 1.0 + flare * 2.0 + hover * 1.0;
    vColor = aColor * (0.5 + tw * 0.8) * boost;
    vAlpha = clamp(0.22 + tw * 0.7 + flare + hover * 0.65, 0.0, 1.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float ps = aSize * uPR * (0.9 + 0.2 * tw + flare * 0.9 + hover * 0.35) * (160.0 / -mv.z);
    gl_PointSize = min(ps, 58.0 * uPR);
    gl_Position = projectionMatrix * mv;
  }
`;
const POINT_FRAG = /* glsl */ `
  uniform float uGlobalAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float halo = smoothstep(0.5, 0.04, d);
    float core = smoothstep(0.16, 0.0, d);
    gl_FragColor = vec4(vColor * (0.6 + core), vAlpha * halo * uGlobalAlpha);
  }
`;

export function createHeroScene(canvas, { reducedMotion = false, onReady } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  } catch {
    return null;
  }

  const disposables = [];
  const pointMats = []; // every twinkle-shader material (incl. reflection clones)

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a2540, 20, 46);
  renderer.setClearColor(0x071c33, 1);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
  camera.position.set(0, 0.8, 16.5);

  // gradient backdrop rendered as a plain plane (avoids the background-texture
  // sampler-bias warnings some ANGLE drivers emit)
  {
    const bgTex = backgroundTexture();
    const bgMat = new THREE.MeshBasicMaterial({ map: bgTex, fog: false, depthTest: false, depthWrite: false });
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(90, 40), bgMat);
    bg.position.set(0, 0, -16);
    bg.renderOrder = -1;
    scene.add(bg);
    disposables.push(bgTex, bgMat, bg.geometry);
  }

  const dotTex = dotTexture();
  disposables.push(dotTex);

  const root = new THREE.Group();   // sway + parallax
  const bridge = new THREE.Group(); // everything that reflects
  root.add(bridge);
  scene.add(root);

  /* ============================================================
     Bridge geometry — tied arch, logo silhouette
     ============================================================ */
  const X0 = -7, X1 = 7;          // deck extents
  const PX = 6.55;                // pillar |x|
  const ARCH_H = 2.45;            // arch apex
  const DECK_Y = -1.05, DECK_RISE = 0.42;
  const RIB_Z = 0.5;

  const deckY = (x) => DECK_Y + DECK_RISE * (1 - Math.pow(x / X1, 2));
  // quadratic arch through (±PX, deck) with apex ARCH_H
  const archSpring = deckY(PX) + 0.12;
  const archY = (x) => {
    const t = x / PX;
    return archSpring + (ARCH_H - archSpring) * (1 - t * t);
  };

  const lineMats = [];
  const lineMat = (color, opacity) => {
    const m = new THREE.LineBasicMaterial({
      color, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    m.userData.base = opacity;
    disposables.push(m);
    lineMats.push(m);
    return m;
  };

  function curveLine(points, material) {
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    disposables.push(geo);
    const line = new THREE.Line(geo, material);
    bridge.add(line);
    return line;
  }

  function sampled(fn, x0, x1, z, n = 90) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      pts.push(new THREE.Vector3(x, fn(x), z));
    }
    return pts;
  }

  /* arch ribs + deck edges */
  const archRibMats = [lineMat(COL.tealSoft, 0.62), lineMat(COL.tealSoft, 0.62)];
  curveLine(sampled(archY, -PX, PX, RIB_Z), archRibMats[0]);
  curveLine(sampled(archY, -PX, PX, -RIB_Z), archRibMats[1]);
  curveLine(sampled(deckY, X0, X1, RIB_Z), lineMat(COL.blueDim, 0.5));
  curveLine(sampled(deckY, X0, X1, -RIB_Z), lineMat(COL.blueDim, 0.5));

  /* echo arcs (depth) */
  const echo1 = (x) => archSpring + (3.3 - archSpring) * (1 - Math.pow(x / (PX + 1.1), 2));
  const echo2 = (x) => archSpring + (1.7 - archSpring) * (1 - Math.pow(x / (PX + 2.2), 2));
  curveLine(sampled(echo1, -(PX + 1.1), PX + 1.1, -1.9), lineMat(COL.blueDim, 0.16));
  curveLine(sampled(echo2, -(PX + 2.2), PX + 2.2, 1.7), lineMat(COL.blueDim, 0.12));

  /* hangers, deck crossbars, arch bracing, pillars — one LineSegments each */
  function segments(pairs, material) {
    const arr = new Float32Array(pairs.length * 3);
    pairs.forEach((v, i) => { arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z; });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    disposables.push(geo);
    const seg = new THREE.LineSegments(geo, material);
    bridge.add(seg);
    return seg;
  }

  /* hangers — no crossbars or bracing; one material per station so the
     passing beam can bleed light down them */
  const hangerXs = [];
  for (let x = -5.7; x <= 5.71; x += 0.82) hangerXs.push(x);

  const hangerBleed = [];
  hangerXs.forEach((x, i) => {
    const m = lineMat(COL.blue, 0.17);
    m.vertexColors = true; // additive blending: darker vertex = more transparent
    const pos = [];
    const col = [];
    const ramp = (v) => col.push(v, v, v);
    [RIB_Z, -RIB_Z].forEach((z) => {
      const yTop = archY(x);
      const yBot = deckY(x);
      const yMid = yBot + (yTop - yBot) * 0.45;
      pos.push(new THREE.Vector3(x, yTop, z), new THREE.Vector3(x, yMid, z));
      ramp(1); ramp(0.45);
      pos.push(new THREE.Vector3(x, yMid, z), new THREE.Vector3(x, yBot, z));
      ramp(0.45); ramp(0.08);
    });
    const geo = new THREE.BufferGeometry().setFromPoints(pos);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    disposables.push(geo);
    bridge.add(new THREE.LineSegments(geo, m));
    hangerBleed.push({ x, m, e: 0, phase: i * 0.9 });
  });

  /* pillars — clean tapered posts (the logo's vertical bars) */
  const pillarJoints = [];
  {
    const frame = []; // posts + deck collar

    [-PX, PX].forEach((px) => {
      const levels = [
        { y: DECK_Y - 0.7, w: 0.32, d: 0.66 },
        { y: deckY(px), w: 0.28, d: 0.58 },
        { y: (deckY(px) + archY(px)) / 2 + 0.35, w: 0.2, d: 0.52 },
        { y: archY(px) + 0.55, w: 0.13, d: RIB_Z - 0.04 },
      ];
      const S = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const corner = (lv, sx, sz) => new THREE.Vector3(px + sx * lv.w, lv.y, sz * lv.d);

      // tapered corner posts
      for (let i = 0; i < levels.length - 1; i++) {
        S.forEach(([sx, sz]) => frame.push(corner(levels[i], sx, sz), corner(levels[i + 1], sx, sz)));
      }
      // single collar at deck level — the posts top out as clean vertical bars
      [levels[1]].forEach((lv) => {
        for (let i = 0; i < 4; i++) {
          frame.push(corner(lv, S[i][0], S[i][1]), corner(lv, S[(i + 1) % 4][0], S[(i + 1) % 4][1]));
        }
      });

      levels.forEach((lv, li) => S.forEach(([sx, sz]) => pillarJoints.push({ p: corner(lv, sx, sz), top: li === 3 })));
    });

    segments(frame, lineMat(COL.blue, 0.42));
  }

  /* ============================================================
     Points — nodes, ambient field, flows, pulse trail
     ============================================================ */
  function pointsMaterial(globalAlpha = 1) {
    const m = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPR: { value: 1 },
        uPulse: { value: new THREE.Vector3(0, -50, 0) },
        uPulseStr: { value: 0 },
        uPulseK: { value: 0.55 },
        uPointer: { value: new THREE.Vector3(0, -50, 0) },
        uPointerStr: { value: 0 },
        uGlobalAlpha: { value: globalAlpha },
      },
    });
    m.userData.baseAlpha = globalAlpha;
    disposables.push(m);
    pointMats.push(m);
    return m;
  }

  function buildPoints(list, parent = bridge) {
    const n = list.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    list.forEach((it, i) => {
      pos.set([it.p.x, it.p.y, it.p.z], i * 3);
      col.set([it.c.r, it.c.g, it.c.b], i * 3);
      size[i] = it.s;
      phase[i] = rand(0, Math.PI * 2);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    disposables.push(geo);
    const pts = new THREE.Points(geo, pointsMaterial());
    parent.add(pts);
    return pts;
  }

  /* structural nodes */
  {
    const nodes = [];
    hangerXs.forEach((x, i) => {
      [RIB_Z, -RIB_Z].forEach((z) => {
        nodes.push({ p: new THREE.Vector3(x, archY(x), z), c: i % 3 === 0 ? COL.teal : COL.tealSoft, s: i % 3 === 0 ? 2.6 : 1.9 });
        nodes.push({ p: new THREE.Vector3(x, deckY(x), z), c: COL.blue, s: 1.7 });
      });
    });
    pillarJoints.forEach((j) => {
      nodes.push({
        p: j.p,
        c: j.apex ? COL.tealHot : j.top ? COL.teal : COL.blue,
        s: j.apex ? 3.2 : j.top ? 2.2 : 1.4,
      });
    });
    nodes.push({ p: new THREE.Vector3(0, ARCH_H, RIB_Z), c: COL.tealHot, s: 3.4 });
    nodes.push({ p: new THREE.Vector3(0, ARCH_H, -RIB_Z), c: COL.tealHot, s: 3.4 });
    buildPoints(nodes);
  }

  /* ambient constellation (doesn't reflect) */
  {
    const amb = [];
    for (let i = 0; i < 128; i++) {
      amb.push({
        p: new THREE.Vector3(rand(-13, 13), rand(-3.2, 6.5), rand(-9, 2.5)),
        c: Math.random() > 0.75 ? COL.tealSoft : COL.blueDim,
        s: rand(0.7, 1.7),
      });
    }
    buildPoints(amb, root);
  }

  /* hub glows */
  function hub(x, y, z, scale, color, opacity) {
    const m = new THREE.SpriteMaterial({
      map: dotTex, color, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    disposables.push(m);
    const s = new THREE.Sprite(m);
    s.position.set(x, y, z);
    s.scale.setScalar(scale);
    bridge.add(s);
    return s;
  }
  const hubL = hub(-PX, archY(PX) + 0.62, 0, 1.25, COL.teal, 0.42);
  const hubR = hub(PX, archY(PX) + 0.62, 0, 1.25, COL.teal, 0.42);
  hub(0, ARCH_H + 0.05, 0, 1.0, COL.teal, 0.32);

  /* flow paths */
  const mkCurve = (fn, x0, x1, z) =>
    new THREE.CatmullRomCurve3(sampled(fn, x0, x1, z, 24));
  const flowCurves = [
    { c: mkCurve(archY, -PX, PX, RIB_Z), w: 3 },
    { c: mkCurve(archY, -PX, PX, -RIB_Z), w: 3 },
    { c: mkCurve(deckY, X0, X1, RIB_Z), w: 2.4 },
    { c: mkCurve(deckY, X0, X1, -RIB_Z), w: 2.4 },
    { c: mkCurve(echo1, -(PX + 1.1), PX + 1.1, -1.9), w: 1 },
    { c: mkCurve(echo2, -(PX + 2.2), PX + 2.2, 1.7), w: 0.8 },
  ];
  const weightSum = flowCurves.reduce((s, f) => s + f.w, 0);

  const FLOWS = 230;
  const flows = [];
  let flowAttr;
  {
    const list = [];
    for (let i = 0; i < FLOWS; i++) {
      let r = Math.random() * weightSum, ci = 0;
      while (r > flowCurves[ci].w) { r -= flowCurves[ci].w; ci++; }
      flows.push({
        curve: flowCurves[ci].c,
        t: Math.random(),
        speed: rand(0.035, 0.11) * (Math.random() > 0.5 ? 1 : -1),
      });
      const onArch = ci < 2;
      list.push({
        p: new THREE.Vector3(),
        c: onArch ? COL.teal : Math.random() > 0.5 ? COL.blue : COL.tealSoft,
        s: rand(1.2, onArch ? 2.4 : 1.9),
      });
    }
    const pts = buildPoints(list);
    flowAttr = pts.geometry.getAttribute('position');
    flowAttr.setUsage(THREE.DynamicDrawUsage);
  }

  /* match pulse rides the visible rib lines, alternating rib and direction */
  const pulseCurves = [mkCurve(archY, -PX, PX, RIB_Z), mkCurve(archY, -PX, PX, -RIB_Z)];
  let pulseRib = 0;
  const TRAIL = 14;
  let trailAttr;
  {
    const list = [];
    for (let i = 0; i < TRAIL; i++) {
      list.push({
        p: new THREE.Vector3(0, -50, 0),
        c: COL.tealHot,
        s: 4.6 * (1 - i / TRAIL) + 0.8,
      });
    }
    const pts = buildPoints(list);
    trailAttr = pts.geometry.getAttribute('position');
    trailAttr.setUsage(THREE.DynamicDrawUsage);
  }

  /* atmosphere glow behind the arch */
  {
    const m = new THREE.SpriteMaterial({
      map: dotTex, color: new THREE.Color('#1d5e63'), transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    disposables.push(m);
    const glow = new THREE.Sprite(m);
    glow.position.set(2.5, 0.4, -5);
    glow.scale.set(16, 11, 1);
    scene.add(glow);
  }

  /* ============================================================
     Water reflection — shared geometry, dimmed cloned materials
     ============================================================ */
  const WATER_Y = DECK_Y - 0.62;
  {
    const refl = bridge.clone();
    refl.traverse((o) => {
      if (o.name === 'no-reflect') { o.visible = false; return; }
      if (o.material) {
        const m = o.material.clone();
        disposables.push(m);
        if (m.isShaderMaterial) {
          m.uniforms.uGlobalAlpha.value = 0.16;
          m.userData.baseAlpha = 0.16;
          pointMats.push(m);
        } else {
          m.opacity *= 0.15;
          m.userData.base = m.opacity;
          if (m.isLineBasicMaterial) lineMats.push(m);
        }
        o.material = m;
      }
    });
    refl.scale.y = -1;
    refl.position.y = 2 * WATER_Y;
    root.add(refl);

    // faint waterline
    curveLine(
      [new THREE.Vector3(-14, WATER_Y, 0), new THREE.Vector3(14, WATER_Y, 0)],
      lineMat(COL.blueDim, 0.1)
    );

    // surface shimmer just under the waterline grounds the reflection
    const shimmer = [];
    for (let i = 0; i < 70; i++) {
      shimmer.push({
        p: new THREE.Vector3(rand(-12, 13), WATER_Y - rand(-0.08, 0.38), rand(-2.6, 2.6)),
        c: Math.random() > 0.6 ? COL.tealSoft : COL.blueDim,
        s: rand(0.4, 0.95),
      });
    }
    buildPoints(shimmer, root);
  }

  /* ============================================================
     Post-processing
     ============================================================ */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.5, 0.18);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // FXAA samples with a -100 mip bias; render targets have no mips, so the
  // bias is inert — zero it to silence ANGLE driver warnings.
  const fxaa = new ShaderPass({
    ...FXAAShader,
    fragmentShader: FXAAShader.fragmentShader.replace(/-100\.0/g, '0.0'),
  });
  composer.addPass(fxaa);

  /* Adaptive quality: start in the middle, promote only after measuring
     fast frames, demote on slow ones — integrated GPUs never see the heavy
     path, discrete GPUs reach full quality within ~2s of the fade-in.
     2 = dpr 1.5, half-res bloom, FXAA · 1 = dpr 1.15, quarter-res bloom ·
     0 = dpr 1, no post-processing. */
  let quality = 1;
  let canUpgrade = true;
  let viewW = 1, viewH = 1;
  let glowComp = 1, glowCompTarget = 1;   // brightness compensation when bloom is off
  let pointComp = 1, pointCompTarget = 1; // (eased between tiers so switches don't pop)
  let compSnap = true;
  const QUALITY_DPR = [1, 1.15, 1.5];

  function applyComp() {
    lineMats.forEach((m) => { m.opacity = Math.min(1, m.userData.base * glowComp); });
    pointMats.forEach((m) => {
      m.uniforms.uGlobalAlpha.value = Math.min(1, m.userData.baseAlpha * pointComp);
    });
  }

  function applyQuality() {
    if (!viewW || !viewH) return;
    const dpr = Math.min(window.devicePixelRatio || 1, QUALITY_DPR[quality]);
    renderer.setPixelRatio(dpr);
    renderer.setSize(viewW, viewH, false);
    composer.setPixelRatio(dpr);
    composer.setSize(viewW, viewH);
    const dw = Math.max(1, Math.round(viewW * dpr));
    const dh = Math.max(1, Math.round(viewH * dpr));
    bloom.setSize(dw / (quality === 2 ? 2 : 4), dh / (quality === 2 ? 2 : 4));
    bloom.enabled = quality > 0;
    fxaa.enabled = quality === 2;
    fxaa.material.uniforms.resolution.value.set(1 / dw, 1 / dh);
    setPointUniform('uPR', (u) => { u.value = dpr; });

    glowCompTarget = quality === 0 ? 1.5 : 1;
    pointCompTarget = quality === 0 ? 1.25 : 1;
    if (compSnap) {
      glowComp = glowCompTarget;
      pointComp = pointCompTarget;
      compSnap = false;
    }
    applyComp();
    canvas.dataset.q = quality;
  }

  /* ============================================================
     Motion
     ============================================================ */
  const tmp = new THREE.Vector3();
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const pointerWorld = new THREE.Vector3(0, -50, 0);
  const pointerLocal = new THREE.Vector3(0, -50, 0);
  let pointerStr = 0, pointerStrTarget = 0;
  const ray = new THREE.Raycaster();
  const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ndc = new THREE.Vector2();

  const clock = new THREE.Clock();
  let running = false, inView = true, rafId = 0;
  let pulseClock = rand(0, 5), pulseDir = -1; // first run starts at the right pillar
  const PULSE_TRAVEL = 2.1, PULSE_FADE = 1.1, PULSE_IDLE = 10.6;
  const PULSE_TOTAL = PULSE_TRAVEL + PULSE_FADE + PULSE_IDLE;
  let hubBoostL = 0, hubBoostR = 0;

  let readyFired = false;
  function markReady() {
    if (readyFired) return;
    readyFired = true;
    if (typeof onReady === 'function') onReady();
  }
  const pulsePos = new THREE.Vector3(0, -50, 0);
  let heroH = 1;

  function hideTrail() {
    for (let i = 0; i < TRAIL; i++) trailAttr.array[i * 3 + 1] = -50;
    trailAttr.needsUpdate = true;
  }

  function onPointerMove(e) {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
    ndc.set(pointer.tx, -(pointer.ty));
    pointerStrTarget = 1;
  }
  function onPointerLeave() { pointerStrTarget = 0; }

  function setPointUniform(name, fn) {
    for (let i = 0; i < pointMats.length; i++) fn(pointMats[i].uniforms[name]);
  }

  function layout() {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth;
    const h = canvas.clientHeight || canvas.parentElement.clientHeight;
    if (!w || !h) return;
    heroH = h;
    viewW = w;
    viewH = h;
    applyQuality();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const aspect = w / h;
    // keep the structure low-right so the headline stays clear of it
    if (aspect > 1.5) {
      root.position.set(8.3, -1.55, 0);
      root.scale.setScalar(2.04);
    } else if (aspect > 1.1) {
      root.position.set(5.3, -1.4, 0);
      root.scale.setScalar(1.8);
    } else {
      root.position.set(1.6, -0.9, 0);
      root.scale.setScalar(1.5);
    }
  }

  function updatePulse(dt, t) {
    pulseClock += dt;
    if (pulseClock >= PULSE_TOTAL) {
      pulseClock -= PULSE_TOTAL;
      pulseDir *= -1;
      pulseRib = 1 - pulseRib;
    }
    let str = 0;
    let kWidth = 0.55;
    if (pulseClock < PULSE_TRAVEL) {
      const k = pulseClock / PULSE_TRAVEL;
      const eased = k * k * (3 - 2 * k); // smoothstep pacing
      const tt = pulseDir > 0 ? eased : 1 - eased;
      pulseCurves[pulseRib].getPoint(tt, pulsePos);
      str = Math.sin(Math.min(k * 4, 1) * Math.PI * 0.5); // quick fade-in
      // head + trail
      for (let i = 0; i < TRAIL; i++) {
        const back = Math.max(0, Math.min(1, tt - pulseDir * i * 0.016));
        pulseCurves[pulseRib].getPoint(back, tmp);
        trailAttr.array[i * 3] = tmp.x;
        trailAttr.array[i * 3 + 1] = tmp.y;
        trailAttr.array[i * 3 + 2] = tmp.z;
      }
      trailAttr.needsUpdate = true;
    } else if (pulseClock < PULSE_TRAVEL + PULSE_FADE) {
      // arrival: the light spreads across the pylon and dissolves
      const k = (pulseClock - PULSE_TRAVEL) / PULSE_FADE;
      const x = pulseDir > 0 ? PX : -PX;
      pulsePos.set(x, archY(PX), pulseRib === 0 ? RIB_Z : -RIB_Z);
      str = Math.pow(1 - k, 1.6) * 0.9;
      kWidth = 0.55 - 0.45 * k; // gaussian widens → glow washes over the H

      // the comet collapses into the pillar, tail points merging one by one
      const endT = pulseDir > 0 ? 1 : 0;
      for (let i = 0; i < TRAIL; i++) {
        const off = pulseDir * i * 0.016 * (1 - k);
        if (i > 0 && Math.abs(off) < 0.0009) {
          trailAttr.array[i * 3 + 1] = -50;
          continue;
        }
        const back = Math.max(0, Math.min(1, endT - off));
        pulseCurves[pulseRib].getPoint(back, tmp);
        trailAttr.array[i * 3] = tmp.x;
        trailAttr.array[i * 3 + 1] = tmp.y;
        trailAttr.array[i * 3 + 2] = tmp.z;
      }
      trailAttr.needsUpdate = true;

      // destination beacon takes the light: one soft swell, then settles
      const swell = Math.sin(Math.min(k * 2.5, 1) * Math.PI) * 0.35;
      if (pulseDir > 0) hubBoostR = Math.max(hubBoostR, swell);
      else hubBoostL = Math.max(hubBoostL, swell);
    } else {
      str = 0;
      pulsePos.set(0, -50, 0);
      hideTrail();
    }
    hubBoostL *= Math.exp(-dt * 2.6);
    hubBoostR *= Math.exp(-dt * 2.6);
    setPointUniform('uPulse', (u) => u.value.copy(pulsePos));
    setPointUniform('uPulseStr', (u) => { u.value = str; });
    setPointUniform('uPulseK', (u) => { u.value = kWidth; });
  }

  function update(dt, t) {
    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;
    pointerStr += (pointerStrTarget - pointerStr) * 0.06;

    // base yaw turns the span diagonally into the scene; sway + parallax ride on top
    root.rotation.y = BASE_YAW + Math.sin(t * 0.06) * 0.05 + pointer.x * 0.07;
    root.rotation.x = Math.sin(t * 0.045) * 0.018 + pointer.y * 0.035;

    // scroll parallax
    const sc = Math.min(1.4, (window.scrollY || 0) / heroH);
    camera.position.y = 0.8 + sc * 2.1;
    camera.lookAt(root.position.x * 0.5, -0.15 - sc * 0.6, 0);

    // arch breathing
    const breathe = (0.6 + 0.1 * Math.sin(t * 0.55)) * glowComp;
    archRibMats[0].opacity = Math.min(1, breathe);
    archRibMats[1].opacity = Math.min(1, breathe);

    // flows
    for (let i = 0; i < FLOWS; i++) {
      const f = flows[i];
      f.t += f.speed * dt;
      if (f.t > 1) f.t -= 1;
      if (f.t < 0) f.t += 1;
      f.curve.getPoint(f.t, tmp);
      flowAttr.array[i * 3] = tmp.x;
      flowAttr.array[i * 3 + 1] = tmp.y;
      flowAttr.array[i * 3 + 2] = tmp.z;
    }
    flowAttr.needsUpdate = true;

    updatePulse(dt, t);

    // ease brightness compensation between quality tiers
    if (Math.abs(glowComp - glowCompTarget) > 0.003 || Math.abs(pointComp - pointCompTarget) > 0.003) {
      const f = Math.min(1, dt * 3.2);
      glowComp += (glowCompTarget - glowComp) * f;
      pointComp += (pointCompTarget - pointComp) * f;
      applyComp();
    }

    // light bleeds down the hangers as the beam passes, then decays
    const pulseActive = pulsePos.y > -10;
    for (let i = 0; i < hangerBleed.length; i++) {
      const h = hangerBleed[i];
      if (pulseActive) {
        const d = pulsePos.x - h.x;
        h.e = Math.max(h.e, Math.exp(-d * d * 2.2));
      }
      h.e *= Math.exp(-dt * 1.8);
      if (h.e < 0.003) h.e = 0;
      const breathe = 0.8 + 0.25 * Math.sin(t * 0.5 + h.phase);
      h.m.opacity = Math.min(1, (h.m.userData.base * breathe + h.e * 0.5) * glowComp);
    }

    // pointer flare position (bridge-local)
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(planeZ, pointerWorld)) {
      pointerLocal.copy(pointerWorld);
      bridge.worldToLocal(pointerLocal);
      setPointUniform('uPointer', (u) => u.value.copy(pointerLocal));
    }
    setPointUniform('uPointerStr', (u) => { u.value = pointerStr * 0.9; });
    setPointUniform('uTime', (u) => { u.value = t; });

    // hub shimmer (+ arrival swell when the beam lands)
    hubL.material.opacity = Math.min(1, 0.42 + 0.12 * Math.sin(t * 1.1) + hubBoostL);
    hubR.material.opacity = Math.min(1, 0.42 + 0.12 * Math.sin(t * 1.1 + 2.2) + hubBoostR);
  }

  let statT = 0, statN = 0, badStreak = 0, goodStreak = 0, warmup = 0;
  let firstDecisionDone = false;

  function frame() {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    update(dt, clock.elapsedTime);
    if (quality > 0) composer.render();
    else renderer.render(scene, camera);

    // performance governor: a fast first decision lands while the canvas is
    // still hidden, then demote after two slow windows / promote after two
    // clearly-fast ones (never re-promote once demoted)
    if (warmup < 8) { warmup++; return; }
    statT += dt;
    statN++;
    const winT = firstDecisionDone ? 0.9 : 0.6;
    const winN = firstDecisionDone ? 18 : 12;
    if (statT >= winT && statN >= winN) {
      const avg = statT / statN;
      if (!firstDecisionDone) {
        if (avg > 0.055) { quality = 0; canUpgrade = false; }
        else if (avg > 0.028) { quality = Math.max(0, quality - 1); canUpgrade = false; }
        else if (avg < 0.016 && quality < 2) { quality = 2; }
        applyQuality();
        firstDecisionDone = true;
        markReady();
      } else if (avg > 0.028) {
        goodStreak = 0;
        if (++badStreak >= 2 && quality > 0) {
          quality--;
          canUpgrade = false;
          applyQuality();
          badStreak = 0;
        }
      } else if (avg < 0.015 && canUpgrade && quality < 2) {
        badStreak = 0;
        if (++goodStreak >= 2) {
          quality++;
          applyQuality();
          goodStreak = 0;
        }
      } else {
        badStreak = 0;
        goodStreak = 0;
      }
      statT = 0;
      statN = 0;
    }
  }

  function start() {
    if (running || reducedMotion) return;
    running = true;
    clock.start();
    rafId = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  /* ---------- wiring ---------- */
  const ro = new ResizeObserver(() => {
    layout();
    if (!running) composer.render();
  });
  ro.observe(canvas.parentElement);

  const io = new IntersectionObserver(
    ([entry]) => {
      inView = entry.isIntersecting;
      if (inView && !document.hidden) start();
      else stop();
    },
    { threshold: 0.02 }
  );
  io.observe(canvas);

  function onVisibility() {
    if (document.hidden) stop();
    else if (inView) start();
  }
  document.addEventListener('visibilitychange', onVisibility);

  const finePointer = window.matchMedia('(pointer: fine)').matches;
  if (finePointer && !reducedMotion) {
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onPointerLeave);
  }

  // never leave the canvas hidden: if the governor can't decide (hidden tab,
  // paused loop), reveal after a wall-clock fallback anyway
  const readyTimer = setTimeout(markReady, 2600);

  layout();
  update(0, 0.001);
  composer.render();
  if (reducedMotion) markReady();
  else start();

  return {
    dispose() {
      stop();
      clearTimeout(readyTimer);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onPointerMove);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
      composer.dispose();
      disposables.forEach((d) => d.dispose && d.dispose());
      renderer.dispose();
    },
  };
}
