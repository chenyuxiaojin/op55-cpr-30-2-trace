// 别慌,三十比二:这首歌的重拍就是 108 次/分的按压。一支红笔每拍压下 5–6 cm,
// 在向左流走的记录带上画出整段心肺复苏的深度曲线;镜头只在这条带子上推、拉、俯仰。
// 每帧只由时间决定:无实时计时、无 Math.random,随机性全部来自整数哈希。
export const W = 1920;
export const H = 1080;
export const FPS = 30;
const AUDIO_END = 27.0;
const TAIL = 0.7;
const CN = '"Noto Sans SC"';
const NUM = '"Inter Variable"';

const C = {
  bg: '#0C0E11',
  ink: '#F2EEE6',
  red: '#FF4632',
  blue: '#6CCBFF',
  gray: '#59606C',
  dim: '#8B929D',
};

// ---------- 数学 ----------
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, u) => a + (b - a) * u;
const R = (t, a, b) => clamp((t - a) / (b - a));
const eo3 = (p) => 1 - Math.pow(1 - clamp(p), 3);
const eo4 = (p) => 1 - Math.pow(1 - clamp(p), 4);
const ei3 = (p) => Math.pow(clamp(p), 3);
const eio = (p) => {
  p = clamp(p);
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
};
const eio5 = (p) => {
  p = clamp(p);
  return p < 0.5 ? 16 * p ** 5 : 1 - Math.pow(-2 * p + 2, 5) / 2;
};
const backOut = (p, s = 1.70158) => {
  p = clamp(p) - 1;
  return 1 + (s + 1) * p * p * p + s * p * p;
};
// 阻尼弹簧:快速到位、超调一次、回落
const spring = (p, k = 7, w = 9) => (p <= 0 ? 0 : p >= 1.6 ? 1 : 1 - Math.exp(-k * p) * Math.cos(w * p));
const TAU = Math.PI * 2;

function hash3(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x3c6ef372, 0x165667b1) ^ Math.imul((c | 0) + 0x5bd1e995, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, s, k) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash3(i, s, k), hash3(i + 1, s, k), u);
}
const hexRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
function rgba(hex, a) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${clamp(a)})`;
}
function mix(a, b, u, al = 1) {
  const A = hexRgb(a), B = hexRgb(b);
  u = clamp(u);
  return `rgba(${Math.round(lerp(A[0], B[0], u))},${Math.round(lerp(A[1], B[1], u))},${Math.round(lerp(A[2], B[2], u))},${clamp(al)})`;
}

// ---------- 节拍与按压 ----------
// 原音能量峰实测:重拍 B(k) = 0.536 + k · 60/108 秒
const P = 60 / 108;
const B0 = 0.536;
const Bk = (k) => B0 + P * k;
const V = 380; // 记录带速度 px/s(镜头 sx = 1 时)
const CMPX = 30; // 1 cm 的像素(sy = 1 时)
const isStroke = (k) => (k >= 1 && k <= 30) || (k >= 42 && k <= 47);
const isLean = (k) => k === 21 || k === 22;
const restOf = (k) => (isLean(k) ? 1.3 : 0);
const depthOf = (k) => 5.45 + 0.22 * Math.sin(k * 2.3) + 0.08 * Math.sin(k * 5.1);
const PAUSE_A = Bk(30); // 最后一次按压
const PAUSE_B = Bk(42); // 恢复按压
const BREATHS = [[17.62, 18.6], [18.66, 19.64]];

function strokeVal(k, u) {
  const d = depthOf(k);
  const b0 = isStroke(k - 1) ? restOf(k - 1) : 0;
  const r = restOf(k);
  if (u < -0.13) return b0 - 0.14 * eo3(R(u, -0.2, -0.13)); // 预备:先微微上提
  if (u < 0) {
    const p = R(u, -0.13, 0);
    return lerp(b0 - 0.14, d, p * p * (1.6 - 0.6 * p)); // 加速压下
  }
  if (u < 0.06) return d + 0.12 * Math.sin((Math.PI * u) / 0.06); // 到底的一下顿挫
  return r + (d - r) * (1 - backOut(R(u, 0.06, 0.34), 0.9)); // 回弹,轻微超调
}
function hump(t, a, b) {
  const p = R(t, a, b);
  if (p <= 0 || p >= 1) return 0;
  return p < 0.45 ? eio(p / 0.45) : 1 - eio((p - 0.45) / 0.55);
}
const jitterAmp = (t) => 0.34 * eo3(R(t, 22.32, 22.56)) * (1 - eio(R(t, 22.72, 23.12)));
function depth(t) {
  let v = 0;
  let found = false;
  const k = Math.round((t - B0) / P);
  for (const kk of [k, k + 1]) {
    if (!isStroke(kk)) continue;
    const u = t - Bk(kk);
    if (u >= -0.2 && u <= 0.34) {
      v = strokeVal(kk, u);
      found = true;
      break;
    }
  }
  if (!found) {
    const kl = Math.floor((t - B0) / P);
    v = isStroke(kl) ? restOf(kl) : 0;
  }
  for (const [a, b] of BREATHS) v -= 1.7 * hump(t, a, b);
  const ja = jitterAmp(t);
  if (ja > 0) v += ja * (vnoise(t * 26, 3, 1) - 0.5) * 2 + ja * 0.5 * (vnoise(t * 61, 4, 1) - 0.5) * 2;
  return v;
}
// 记录时间:最后一拍回弹后,记录带减速停住
const REC_END = 27.02;
const REC_D = 0.7;
const rec = (t) => {
  const a = REC_END - REC_D / 2;
  if (t < a) return t;
  const p = R(t, a, a + REC_D);
  return a + REC_D * (p - (p * p) / 2); // 速度从 1 线性降到 0
};
const strokesDone = (t) => {
  let n = 0;
  for (let k = 1; k <= 30; k++) if (Bk(k) <= t) n++;
  return n;
};

// ---------- 镜头 ----------
// screenX(wx) = (wx − 笔的世界 x)·sx + ox ; screenY(cm) = oy + (cm − cy)·CMPX·sy
const CAM = [
  { t: 0, ox: 1180, oy: 532, sx: 1.1, sy: 1.1, cy: 0 },
  { t: 1.0, ox: 1180, oy: 528, sx: 1.06, sy: 1.1, cy: 0, e: eio },
  { t: 4.55, ox: 1160, oy: 520, sx: 1.0, sy: 1.1, cy: 0, e: eio },
  { t: 5.45, ox: 1150, oy: 540, sx: 1.0, sy: 2.0, cy: 5.5, e: eio5 },
  { t: 9.15, ox: 1150, oy: 552, sx: 0.96, sy: 2.0, cy: 5.5, e: eio },
  { t: 9.95, ox: 1180, oy: 600, sx: 1.0, sy: 1.3, cy: 0, e: (p) => spring(p * 1.25, 6, 8) },
  { t: 13.2, ox: 1180, oy: 592, sx: 1.08, sy: 1.3, cy: 0, e: eio },
  { t: 17.15, ox: 1250, oy: 610, sx: 0.42, sy: 0.95, cy: 0, e: eio },
  { t: 17.8, ox: 1400, oy: 600, sx: 0.2, sy: 0.95, cy: 0, e: eo4 },
  { t: 19.45, ox: 1410, oy: 600, sx: 0.205, sy: 0.95, cy: 0, e: eio },
  { t: 20.2, ox: 1150, oy: 600, sx: 0.85, sy: 1.25, cy: 0, e: eio5 },
  { t: 21.05, ox: 1140, oy: 600, sx: 0.9, sy: 1.25, cy: 0, e: eio },
  { t: 21.75, ox: 640, oy: 600, sx: 0.26, sy: 1.1, cy: 0, e: eio5 },
  { t: 22.35, ox: 630, oy: 600, sx: 0.255, sy: 1.1, cy: 0, e: eio },
  { t: 22.85, ox: 1000, oy: 600, sx: 0.62, sy: 1.4, cy: 0, e: eio5 },
  { t: 23.5, ox: 1010, oy: 598, sx: 0.64, sy: 1.4, cy: 0, e: eio },
  { t: 26.5, ox: 1760, oy: 650, sx: 0.165, sy: 0.8, cy: 0, e: eio },
  { t: 28.0, ox: 1764, oy: 652, sx: 0.162, sy: 0.8, cy: 0, e: eio },
];
function camera(t) {
  let i = 1;
  while (i < CAM.length - 1 && t > CAM[i].t) i++;
  const a = CAM[i - 1], b = CAM[i];
  const p = t <= a.t ? 0 : b.e(R(t, a.t, b.t));
  const c = {};
  for (const key of ['ox', 'oy', 'sx', 'sy', 'cy']) c[key] = lerp(a[key], b[key], p);
  // 开场:笔从左侧拖着线冲进来,超调后落位
  const ip = R(t, -0.32, 0.95);
  c.ox = lerp(-260, c.ox, ip >= 1 ? 1 : backOut(eo3(ip), 1.25) * 0.4 + eo4(ip) * 0.6);
  // 手持感:很慢的漂移
  c.ox += 5 * Math.sin(t * 0.61) + 3 * Math.sin(t * 1.37 + 1);
  c.oy += 4 * Math.sin(t * 0.83 + 2) + 2 * Math.sin(t * 1.91);
  // 第一个"别慌":镜头跟着抖
  const sh = jitterAmp(t) * 18;
  if (sh > 0) {
    c.ox += sh * (vnoise(t * 19, 7, 1) - 0.5);
    c.oy += sh * (vnoise(t * 23, 8, 1) - 0.5);
  }
  c.pen = rec(t) * V;
  c.X = (wx) => (wx - c.pen) * c.sx + c.ox;
  c.Y = (cm) => c.oy + (cm - c.cy) * CMPX * c.sy;
  c.T = (ts) => c.X(ts * V);
  return c;
}

// ---------- 字 ----------
// 每个 run 是一段原文;parts 决定字号/字重/颜色;times 是每个字(含标点)的登场时刻。
const RUNS = [
  { id: 'a1', cue: 0, x: 140, y: 262, parts: [{ s: '每分钟', size: 58, w: 500, col: 'dim' }], times: [1.36, 1.64, 1.89], exit: 'sink', ex: 4.6 },
  {
    id: 'a2', cue: 0, x: 128, y: 418,
    parts: [{ s: '一百', size: 132, w: 900, col: 'ink' }, { s: '到', size: 132, w: 300, col: 'dim' }, { s: '一百二十', size: 132, w: 900, col: 'ink' }, { s: '次，', size: 66, w: 700, col: 'ink' }],
    times: [2.19, 2.55, 2.86, 3.17, 3.48, 3.84, 4.04, 4.42, 4.47], exit: 'sink', ex: 4.64, pulse: true,
  },
  { id: 'b', cue: 1, x: 1300, anchor: 'b5', parts: [{ s: '至少', size: 60, w: 500, col: 'dim' }, { s: '五', size: 210, w: 900, col: 'red' }, { s: '厘米，', size: 60, w: 500, col: 'ink' }], times: [5.48, 5.71, 5.96, 6.2, 6.37, 6.42], exit: 'up', ex: 9.2 },
  { id: 'c', cue: 2, x: 1300, anchor: 'b6', parts: [{ s: '不超过', size: 60, w: 500, col: 'dim' }, { s: '六', size: 210, w: 900, col: 'red' }, { s: '厘米，', size: 60, w: 500, col: 'ink' }], times: [7.48, 7.67, 8.03, 8.16, 8.31, 8.59, 8.64], exit: 'down', ex: 9.24 },
  { id: 'd1', cue: 3, x: 140, anchor: 'zero', parts: [{ s: '胸廓充', size: 92, w: 700, col: 'ink' }], times: [9.58, 9.95, 10.12], exit: 'toss', ex: 11.5 },
  { id: 'd2', cue: 4, x: 140 + 92 * 3, anchor: 'zero', parts: [{ s: '分', size: 92, w: 700, col: 'ink' }, { s: '回弹', size: 184, w: 900, col: 'ink' }, { s: '，', size: 92, w: 700, col: 'ink' }], times: [10.84, 10.95, 11.09, 11.13], exit: 'toss', ex: 11.56, bounce: true },
  {
    id: 'e1', cue: 5, x: 140, y: 440,
    parts: [{ s: '别', size: 120, w: 700, col: 'ink' }, { s: '依靠', size: 120, w: 900, col: 'red' }, { s: '胸壁，', size: 120, w: 700, col: 'ink' }],
    times: [11.92, 12.2, 12.45, 12.75, 13.03, 13.08], exit: 'up', ex: 17.66, lean: true, shrink: [13.22, 0.5, 140, 170],
  },
  { id: 'e2', cue: 5, x: 132, y: 372, parts: [{ s: '三十', size: 200, w: 900, col: 'red' }, { s: '次按压', size: 96, w: 700, col: 'ink' }], times: [13.31, 13.71, 14.15, 14.57, 14.96], exit: 'up', ex: 17.7, pulse: true },
  { id: 'e3', cue: 5, x: 140, y: 494, parts: [{ s: '两次', size: 96, w: 700, col: 'ink' }, { s: '人工呼吸', size: 96, w: 700, col: 'blue' }, { s: '，', size: 96, w: 700, col: 'ink' }], times: [15.26, 15.68, 16.09, 16.49, 16.92, 17.3, 17.34], exit: 'up', ex: 17.74 },
  { id: 'f1', cue: 6, x: 140, y: 330, parts: [{ s: '中断', size: 180, w: 900, col: 'ink' }, { s: '尽量少，', size: 90, w: 700, col: 'dim' }], times: [19.67, 19.97, 20.2, 20.53, 20.8, 20.84], exit: 'up', ex: 23.2, shrink: [20.86, 0.36, 140, 150] },
  { id: 'f2', cue: 6, x: 140, y: 346, parts: [{ s: '控制', size: 90, w: 700, col: 'dim' }, { s: '十秒', size: 200, w: 900, col: 'ink' }, { s: '以内，', size: 90, w: 700, col: 'dim' }], times: [20.95, 21.2, 21.36, 21.64, 21.92, 22.2, 22.24], exit: 'up', ex: 23.26 },
  { id: 'f3', cue: 6, x: 140, y: 476, parts: [{ s: '别慌', size: 104, w: 900, col: 'ink' }, { s: '别慌，', size: 104, w: 900, col: 'ink' }], times: [22.48, 22.61, 22.75, 23.03, 23.07], exit: 'up', ex: 23.32, shaky: true },
  { id: 'g1', cue: 7, x: 128, y: 300, parts: [{ s: '把动', size: 150, w: 900, col: 'ink' }], times: [24.14, 24.25] },
  { id: 'g2', cue: 8, x: 128 + 300, y: 300, parts: [{ s: '作练', size: 150, w: 900, col: 'ink' }, { s: '明白', size: 150, w: 900, col: 'red' }, { s: '。', size: 150, w: 900, col: 'ink' }], times: [26.09, 26.22, 26.37, 26.5, 26.56] },
];

const layoutCache = new Map();
function layoutRun(g, run) {
  if (layoutCache.has(run.id)) return layoutCache.get(run.id);
  const chars = [];
  let x = 0, k = 0;
  for (const part of run.parts) {
    g.font = `${part.w} ${part.size}px ${CN}`;
    for (const ch of [...part.s]) {
      const adv = g.measureText(ch).width;
      chars.push({ ch, dx: x, adv, part, t: run.times[k], k, punct: /[，。]/.test(ch) });
      x += adv;
      k++;
    }
  }
  const out = { chars, width: x };
  layoutCache.set(run.id, out);
  return out;
}
const colOf = (name) => C[name];

// run 的基线:固定屏幕坐标,或贴在某条世界刻度线上(跟着镜头走)
function runBase(run, cam) {
  if (run.anchor === 'b5') return cam.Y(5) - 18;
  if (run.anchor === 'b6') return cam.Y(6) + 196;
  if (run.anchor === 'zero') return cam.Y(0) - 26;
  return run.y;
}

function drawRun(g, run, t, cam) {
  const L = layoutRun(g, run);
  if (t < run.times[0] - 0.05) return;
  if (run.ex && t > run.ex + 1.2) return;
  let x0 = run.x, y0 = runBase(run, cam), sc = 1;
  if (run.shrink) {
    const [ts, s1, x1, y1] = run.shrink;
    const p = eo4(R(t, ts, ts + 0.42));
    sc = lerp(1, s1, p);
    x0 = lerp(x0, x1, p);
    y0 = lerp(y0, y1, p);
  }
  // 轻微的呼吸漂移(文字层视差)
  x0 += 3 * Math.sin(t * 0.7 + run.x * 0.01);
  y0 += 2.5 * Math.sin(t * 0.9 + 1.3);
  const beatPulse = run.pulse ? pulseAt(t) : 0;
  g.save();
  g.translate(x0, y0);
  g.scale(sc, sc);
  g.shadowColor = 'rgba(8,9,11,0.85)';
  g.shadowBlur = 28;
  for (const c of L.chars) {
    const sz = c.part.size;
    const tin = c.t;
    const pin = R(t, tin, tin + (sz > 150 ? 0.42 : 0.34));
    if (pin <= 0) continue;
    let dy = 0, dx = 0, rot = 0, al = 1, sx = 1, sy = 1, clipTop = -sz * 1.1, clipBot = sz * 0.32;
    // 登场:遮罩内从下往上冒出,弹性落位;大字带一点压扁回弹
    const rise = 1 - backOut(eo3(pin), 1.2);
    dy += rise * sz * 0.5;
    if (sz > 150) {
      // 大字:从基线遮罩里顶出来,带一点放大后回落
      const s = spring(R(t, tin, tin + 0.7) * 1.2, 7, 10);
      sx = sy = lerp(1.12, 1, s);
    }
    // 跟拍:大字在每次按压时被压一下
    if (beatPulse > 0 && !c.punct && sz > 100) {
      sy *= 1 - 0.05 * beatPulse;
      sx *= 1 + 0.02 * beatPulse;
    }
    if (run.bounce && c.part.s === '回弹') {
      // 每次回弹把"回弹"顶起来
      let hop = 0;
      for (const k of [19, 20]) {
        const u = t - (Bk(k) + 0.1) - c.k * 0.04;
        if (u > 0 && u < 0.6) hop += Math.sin(Math.min(1, u / 0.42) * Math.PI) * (1 - u / 0.6) * 46;
      }
      dy -= hop;
      rot += (c.k % 2 ? 1 : -1) * hop * 0.0016;
    }
    if (run.lean && c.part.s === '依靠') {
      // "靠着没起来":第 21、22 拍往下塌,第 23 拍弹回
      const sag = eo3(R(t, Bk(21) - 0.05, Bk(21) + 0.25)) * 0.6 + eo3(R(t, Bk(22) - 0.05, Bk(22) + 0.25)) * 0.4;
      const back = spring(R(t, Bk(23), Bk(23) + 0.7) * 1.3, 6, 10);
      const s = sag * (1 - back);
      dy += s * 38 + c.k * 0;
      rot += s * (c.k === 1 ? 0.06 : 0.1);
      sy *= 1 - 0.12 * s;
    }
    if (run.shaky) {
      const first = c.k < 2;
      const a = first ? 1 - eio(R(t, 22.66, 23.0)) : 0.25 * (1 - eio(R(t, 23.03, 23.2)));
      dx += a * 7 * (vnoise(t * 30 + c.k * 7, 11, c.k) - 0.5) * 2;
      dy += a * 7 * (vnoise(t * 33 + c.k * 5, 12, c.k) - 0.5) * 2;
      rot += a * 0.04 * (vnoise(t * 21 + c.k, 13, c.k) - 0.5);
    }
    // 退场
    if (run.ex && t > run.ex) {
      const d = 0.035 * c.k;
      const pe = R(t, run.ex + d, run.ex + d + 0.5);
      if (run.exit === 'sink') {
        // 压进 0 线以下
        dy += ei3(pe) * sz * 1.3 + backOut(pe, 2) * 0;
        clipBot = Math.min(clipBot, cam.Y(0) - y0 - 4);
      } else if (run.exit === 'up') {
        dy -= eo4(pe) * sz * 1.05 * (1 - 0.5 * ei3(pe));
        clipTop = -sz * 1.1;
        al = 1 - ei3(R(pe, 0.2, 1));
        if (eo4(pe) > 0) clipBot = Math.min(clipBot, sz * 0.32 - eo4(pe) * sz * 1.4);
      } else if (run.exit === 'down') {
        dy += eo4(pe) * sz * 1.1;
        clipTop = Math.max(clipTop, -sz * 1.1 + eo4(pe) * sz * 1.4);
      } else if (run.exit === 'toss') {
        const u = pe;
        dy -= (Math.sin(u * Math.PI * 0.8) * 120 + u * u * 40) * (sz / 120);
        rot += (c.k % 2 ? 0.3 : -0.25) * u;
        al = 1 - ei3(u);
      }
      if (pe >= 1) continue;
    }
    g.save();
    g.globalAlpha *= al;
    g.beginPath();
    g.rect(c.dx - 14 - c.adv * 0.1, clipTop - 30, c.adv * 1.2 + 28, clipBot - clipTop + 30);
    g.clip();
    g.translate(c.dx + c.adv / 2 + dx, dy);
    g.rotate(rot);
    g.scale(sx, sy);
    g.font = `${c.part.w} ${sz}px ${CN}`;
    g.fillStyle = c.punct ? C.dim : colOf(c.part.col);
    g.fillText(c.ch, -c.adv / 2, 0);
    g.restore();
  }
  g.restore();
}
// 每拍的压感:到底时最强,0.25 秒内回落
function pulseAt(t) {
  const k = Math.round((t - B0) / P);
  if (!isStroke(k)) return 0;
  const u = t - Bk(k);
  if (u < -0.08 || u > 0.3) return 0;
  return u < 0 ? eo3(R(u, -0.08, 0)) : 1 - eo3(R(u, 0, 0.3));
}

// ---------- 数字(Inter,等宽格) ----------
function numText(g, s, x, y, size, w, color, opts = {}) {
  g.font = `${w} ${size}px ${NUM}`;
  g.fillStyle = color;
  const cell = size * 0.62;
  let cx = x;
  for (const ch of s) {
    const isDigit = /[0-9]/.test(ch);
    const adv = isDigit ? cell : g.measureText(ch).width;
    const off = isDigit ? (cell - g.measureText(ch).width) / 2 : 0;
    g.fillText(ch, cx + off, y);
    cx += adv + (opts.track ?? 0);
  }
  return cx - x;
}
function numWidth(g, s, size, w, track = 0) {
  g.font = `${w} ${size}px ${NUM}`;
  let a = 0;
  for (const ch of s) a += (/[0-9]/.test(ch) ? size * 0.62 : g.measureText(ch).width) + track;
  return a;
}

// ---------- 画布与纹理 ----------
let cues = [];
let totalFrames = 1;
let sub, subG, acc, accG, grainTiles = [], grainPats = null;
function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function makeGrain(k) {
  const S = 256;
  const c = mk(S, S);
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const d = img.data;
  for (let i = 0; i < S * S; i++) {
    const v = 128 + (hash3(i, k, 100) - 0.5) * 120;
    d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function init(parsed) {
  cues = parsed;
  for (let ci = 0; ci < cues.length; ci++) {
    const joined = RUNS.filter((r) => r.cue === ci).map((r) => r.parts.map((p) => p.s).join('')).join('');
    if (joined !== cues[ci].text.replace(/\s+/g, '')) throw new Error(`字幕 ${ci + 1} 与排版不一致: ${joined} ≠ ${cues[ci].text}`);
    for (const r of RUNS.filter((x) => x.cue === ci)) {
      const n = r.parts.reduce((a, p) => a + [...p.s].length, 0);
      if (r.times.length !== n) throw new Error(`${r.id} 时刻数 ${r.times.length} ≠ 字数 ${n}`);
      if (r.times[0] < cues[ci].startMs / 1000 - 1e-6 || r.times[0] > cues[ci].endMs / 1000) throw new Error(`${r.id} 不在字幕 ${ci + 1} 的时间内`);
    }
  }
  const lastEnd = cues.length ? cues[cues.length - 1].endMs / 1000 : AUDIO_END;
  totalFrames = Math.ceil((Math.max(lastEnd, AUDIO_END) + TAIL) * FPS);
  sub = mk(W, H);
  subG = sub.getContext('2d');
  acc = mk(W, H);
  accG = acc.getContext('2d');
  grainTiles = [0, 1, 2, 3].map(makeGrain);
  return { totalFrames, cues: cues.length };
}
export function allText() {
  return cues.map((c) => c.text).join('');
}
export const NUM_TEXT = '0123456789.–:/<> mincs';

// ---------- 场景各层 ----------
// 光色随段落变化:按压红 → 呼吸冰蓝 → 中断冷灰 → 收尾暖白
function moodColor(t) {
  const blue = R(t, 17.3, 17.9) * (1 - R(t, 19.5, 20.2));
  const gray = R(t, 19.6, 20.3) * (1 - R(t, 23.7, 24.3));
  const warm = R(t, 25.6, 26.8);
  return { blue, gray, warm };
}
function drawBackground(g, t, cam) {
  g.fillStyle = C.bg;
  g.fillRect(0, 0, W, H);
  const m = moodColor(t);
  const px = clamp(cam.ox, 200, 1800), py = cam.Y(2.5);
  const lerp3 = (A, Bc, u) => A.map((v, i) => lerp(v, Bc[i], u));
  let col = lerp3(hexRgb(C.red), hexRgb(C.blue), m.blue);
  col = lerp3(col, hexRgb(C.gray), m.gray);
  const breathe = 0.85 + 0.15 * Math.sin(t * 1.4);
  const kick = pulseAt(t);
  const a = (0.17 + 0.06 * kick) * breathe * (1 - 0.4 * m.gray) * (1 - 0.6 * m.warm);
  const rg = g.createRadialGradient(px, py, 0, px, py, 820);
  rg.addColorStop(0, `rgba(${col.map(Math.round).join(',')},${a})`);
  rg.addColorStop(1, 'rgba(12,14,17,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, W, H);
  // 收尾的暖白天光,从左上缓慢扫入
  if (m.warm > 0) {
    const wg = g.createRadialGradient(300, 160, 0, 300, 160, 1400);
    wg.addColorStop(0, rgba('#F2E6D4', 0.09 * m.warm));
    wg.addColorStop(1, 'rgba(12,14,17,0)');
    g.fillStyle = wg;
    g.fillRect(0, 0, W, H);
  }
  // 点阵网格:半速视差
  const step = 54;
  const offX = ((-(cam.pen * cam.sx * 0.35)) % step + step) % step;
  const offY = ((cam.oy * 0.4) % step + step) % step;
  g.fillStyle = rgba(C.ink, 0.055);
  for (let y = offY - step; y < H + step; y += step) {
    for (let x = offX - step; x < W + step; x += step) g.fillRect(x - 1, y - 1, 2, 2);
  }
}

// 时间刻度:记录带下沿,每秒一格、每 5 秒标数
function drawTimeRuler(g, t, cam) {
  const zoomOut = clamp(1 - (cam.sx - 0.2) / 0.6);
  const a = 0.18 + 0.35 * zoomOut;
  const y = cam.Y(8.6);
  g.save();
  g.strokeStyle = rgba(C.ink, a * 0.6);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, y);
  g.lineTo(cam.ox, y);
  g.stroke();
  const t0 = Math.max(0, Math.floor(rec(t) - (cam.ox + 40) / (cam.sx * V)));
  for (let s = t0; s <= rec(t); s++) {
    const x = cam.T(s);
    if (x < -40) continue;
    const big = s % 5 === 0;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y + (big ? 12 : 6));
    g.stroke();
    if (big && s > 0) {
      g.fillStyle = rgba(C.ink, a);
      numText(g, `${s} s`, x + 6, y + 30, 20, 500, rgba(C.ink, a));
    }
  }
  g.restore();
}

// 刻度线:0 线贯穿全片;5 cm / 6 cm 线从深度尺向左扫出
function drawGuides(g, t, cam) {
  const y0 = cam.Y(0);
  // 0 线向右延伸(未来),虚线
  g.save();
  g.setLineDash([2, 10]);
  g.strokeStyle = rgba(C.ink, 0.22);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cam.ox + 20, y0);
  g.lineTo(W + 20, y0);
  g.stroke();
  g.setLineDash([]);
  // 0 线历史段的高亮(回弹段)
  const zg = R(t, 9.55, 9.9) * (1 - R(t, 11.6, 12.2));
  if (zg > 0) {
    const grd = g.createLinearGradient(0, 0, cam.ox, 0);
    grd.addColorStop(0, rgba(C.ink, 0));
    grd.addColorStop(1, rgba(C.ink, 0.65 * zg));
    g.strokeStyle = grd;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, y0);
    g.lineTo(cam.ox, y0);
    g.stroke();
  }
  // 5–6 cm
  const rx = cam.ox + 46;
  const p5 = eo4(R(t, 5.5, 6.4));
  const p6 = eo4(R(t, 7.5, 8.4));
  const fill = eo3(R(t, 7.9, 8.8));
  const yy5 = cam.Y(5), yy6 = cam.Y(6);
  if (fill > 0) {
    const grd = g.createLinearGradient(0, 0, rx, 0);
    grd.addColorStop(0, rgba(C.red, 0.0));
    grd.addColorStop(0.35, rgba(C.red, 0.1 * fill));
    grd.addColorStop(1, rgba(C.red, 0.2 * fill));
    g.fillStyle = grd;
    const x0 = rx - fill * (rx + 40);
    g.fillRect(x0, yy5, rx - x0, yy6 - yy5);
  }
  for (const [p, yy] of [[p5, yy5], [p6, yy6]]) {
    if (p <= 0) continue;
    g.strokeStyle = rgba(C.red, 0.75);
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(rx, yy);
    g.lineTo(rx - p * (rx + 40), yy);
    g.stroke();
  }
  g.restore();
}

// 记录线:历史段从屏幕左缘采样到笔
function tracePath(g, t, cam, from, to) {
  const sxv = cam.sx * V;
  const dt = Math.min(1.4 / sxv, 1 / 150);
  g.beginPath();
  let first = true;
  for (let s = from; s <= to + 1e-9; s += dt) {
    const tt = Math.min(s, to);
    const x = cam.T(tt), y = cam.Y(depth(tt));
    if (first) g.moveTo(x, y), (first = false);
    else g.lineTo(x, y);
    if (tt >= to) break;
  }
}
function drawTrace(g, t, cam) {
  const now = rec(t);
  const from = Math.max(-6, now - (cam.ox + 30) / (cam.sx * V));
  const lw = clamp(2.2 + cam.sx * 1.6, 2.4, 4);
  // 未回弹:21–22 拍,红色斜线填满空隙
  const leanA = Bk(21) + 0.06, leanB = Math.min(now, Bk(23) - 0.05);
  if (leanB > leanA) {
    g.save();
    tracePath(g, t, cam, leanA, leanB);
    g.lineTo(cam.T(leanB), cam.Y(0));
    g.lineTo(cam.T(leanA), cam.Y(0));
    g.closePath();
    g.clip();
    g.fillStyle = rgba(C.red, 0.2);
    g.fillRect(0, 0, W, H);
    g.strokeStyle = rgba(C.red, 0.75);
    g.lineWidth = 2;
    const x0 = cam.T(leanA) - 200;
    for (let x = x0; x < cam.T(leanB) + 200; x += 12) {
      g.beginPath();
      g.moveTo(x, cam.Y(-1));
      g.lineTo(x + 60, cam.Y(3));
      g.stroke();
    }
    g.restore();
  }
  // 主线
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  tracePath(g, t, cam, from, now);
  g.strokeStyle = rgba(C.ink, 0.16);
  g.lineWidth = lw + 7;
  g.stroke();
  g.strokeStyle = C.ink;
  g.lineWidth = lw;
  g.stroke();
  // 落在 5 cm 以下的部分染红(5–6 cm 出现后)
  const redOn = eo3(R(t, 5.4, 6.2));
  if (redOn > 0) {
    g.save();
    g.beginPath();
    g.rect(0, cam.Y(4.85), W, H);
    g.clip();
    tracePath(g, t, cam, from, now);
    g.strokeStyle = rgba(C.red, redOn);
    g.lineWidth = lw + 1;
    g.shadowColor = rgba(C.red, 0.8 * redOn);
    g.shadowBlur = 14;
    g.stroke();
    g.restore();
  }
  // 0 线以上的呼吸鼓包染冰蓝
  if (now > BREATHS[0][0]) {
    g.save();
    g.beginPath();
    g.rect(0, 0, W, cam.Y(-0.32));
    g.clip();
    tracePath(g, t, cam, Math.max(from, BREATHS[0][0] - 0.05), Math.min(now, BREATHS[1][1] + 0.05));
    g.strokeStyle = C.blue;
    g.lineWidth = lw + 1.5;
    g.shadowColor = rgba(C.blue, 0.9);
    g.shadowBlur = 18;
    g.stroke();
    g.restore();
  }
  g.restore();
}

// 笔(播放头)
function drawPen(g, t, cam) {
  const now = rec(t);
  const x = cam.ox, y = cam.Y(depth(now));
  const m = moodColor(t);
  const col = m.blue > 0.5 && t < 19.8 ? C.blue : C.red;
  // 竖向播放头
  const lg = g.createLinearGradient(0, cam.Y(-5), 0, cam.Y(9));
  lg.addColorStop(0, rgba(C.ink, 0));
  lg.addColorStop(0.45, rgba(C.ink, 0.22));
  lg.addColorStop(1, rgba(C.ink, 0));
  g.fillStyle = lg;
  g.fillRect(x - 0.75, cam.Y(-5), 1.5, cam.Y(9) - cam.Y(-5));
  // 每次压到底:一圈冲击波;落进 5–6 cm 带时迸火花
  for (let k = 1; k <= 47; k++) {
    if (!isStroke(k)) continue;
    const u = t - Bk(k);
    if (u < 0 || u > 0.5) continue;
    const ex = cam.T(Bk(k)), ey = cam.Y(depth(Bk(k)));
    const p = eo3(u / 0.5);
    g.strokeStyle = rgba(col, 0.55 * (1 - p));
    g.lineWidth = 2;
    g.beginPath();
    g.arc(ex, ey, 10 + p * 46, 0, TAU);
    g.stroke();
    if (t > 5.5 && u < 0.3) {
      const q = eo3(u / 0.3);
      g.strokeStyle = rgba(C.red, 0.9 * (1 - q));
      g.lineWidth = 2;
      for (let i = 0; i < 7; i++) {
        const ang = Math.PI * (0.15 + 0.7 * (i / 6)) + (hash3(k, i, 5) - 0.5) * 0.3;
        const r0 = 14 + q * 20, r1 = 14 + q * (44 + hash3(k, i, 6) * 24);
        g.beginPath();
        g.moveTo(ex + Math.cos(ang) * r0, ey + Math.sin(ang) * r0 * 0.6);
        g.lineTo(ex + Math.cos(ang) * r1, ey + Math.sin(ang) * r1 * 0.6);
        g.stroke();
      }
    }
  }
  // 回弹顶到 0 线时的一圈(回弹段)
  const zg = R(t, 9.55, 9.9) * (1 - R(t, 11.6, 12.2));
  if (zg > 0) {
    for (let k = 15; k <= 21; k++) {
      const u = t - (Bk(k) + 0.2);
      if (u < 0 || u > 0.45) continue;
      const p = eo3(u / 0.45);
      g.strokeStyle = rgba(C.ink, 0.7 * (1 - p) * zg);
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(cam.T(Bk(k) + 0.2), cam.Y(0), 12 + p * 80, 4 + p * 16, 0, 0, TAU);
      g.stroke();
    }
  }
  const glowR = 70 + 20 * pulseAt(t);
  const rg = g.createRadialGradient(x, y, 0, x, y, glowR);
  rg.addColorStop(0, rgba(col, 0.55));
  rg.addColorStop(1, rgba(col, 0));
  g.fillStyle = rg;
  g.fillRect(x - glowR, y - glowR, glowR * 2, glowR * 2);
  g.fillStyle = col;
  g.beginPath();
  g.arc(x, y, 12, 0, TAU);
  g.fill();
  g.fillStyle = C.ink;
  g.beginPath();
  g.arc(x, y, 4.2, 0, TAU);
  g.fill();
}

// 速率尺(横)→ 旋转 90° → 深度尺上的 5–6 cm 区间
function drawGauges(g, t, cam) {
  const appear = R(t, 1.2, 1.9);
  if (appear <= 0) return;
  const morph = eio5(R(t, 4.62, 5.42));
  // 横向速率尺的几何
  const gx0 = cam.ox + 150, gx1 = 1820, gy = 330;
  const vx = (v) => lerp(gx0, gx1, (v - 90) / 40);
  const fadeH = 1 - eo3(R(t, 4.55, 4.95));
  if (fadeH > 0) {
    g.save();
    g.globalAlpha = fadeH;
    const draw = eo4(appear);
    g.strokeStyle = rgba(C.ink, 0.5);
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(gx0, gy);
    g.lineTo(lerp(gx0, gx1, draw), gy);
    g.stroke();
    for (let v = 90; v <= 130; v += 2) {
      const p = eo4(R(t, 1.3 + (v - 90) * 0.012, 1.6 + (v - 90) * 0.012));
      if (p <= 0) continue;
      const big = v % 10 === 0;
      const x = vx(v) + (1 - fadeH) * (v - 110) * 1.2;
      g.strokeStyle = rgba(C.ink, big ? 0.6 : 0.3);
      g.beginPath();
      g.moveTo(x, gy);
      g.lineTo(x, gy + (big ? 16 : 8) * p);
      g.stroke();
      if (big) numText(g, String(v), x - numWidth(g, String(v), 22, 500) / 2, gy + 44, 22, 500, rgba(C.ink, (v === 100 || v === 120 ? 0.85 : 0.4) * p));
    }
    // 读数 108,随每拍轻跳
    const rp = eo4(R(t, 3.82, 4.2));
    if (rp > 0) {
      const kick = pulseAt(t);
      const nx = vx(108 + 0.6 * Math.sin(t * 9.1) * kick);
      g.fillStyle = C.ink;
      g.beginPath();
      g.moveTo(nx, gy - 10 - (1 - backOut(rp, 2)) * 60);
      g.lineTo(nx - 9, gy - 26 - (1 - backOut(rp, 2)) * 60);
      g.lineTo(nx + 9, gy - 26 - (1 - backOut(rp, 2)) * 60);
      g.closePath();
      g.globalAlpha = fadeH * rp;
      g.fill();
      const val = Math.round(lerp(90, 108, eo3(R(t, 3.82, 4.3))));
      numText(g, String(val), nx - 110, gy - 54 - kick * 3, 104, 750, C.ink);
      numText(g, '/min', nx + 84, gy - 56, 30, 500, C.dim);
    }
    g.restore();
  }
  // 红色区间:横向 100→120 跟着唱词拉开,随后旋转成竖向 5→6 cm
  const bandStart = eo4(R(t, 2.15, 2.5));
  if (bandStart > 0) {
    const grow = lerp(0.04, 1, eo4(R(t, 3.1, 3.95)));
    const hx = vx(100), hy = gy - 7;
    const hL = (vx(120) - vx(100)) * grow, hT = 14;
    const rx = cam.ox + 46;
    const vxp = rx - 7, vyp = cam.Y(5);
    const vL = cam.Y(6) - cam.Y(5), vT = 14;
    const px = lerp(hx, vxp, morph), py = lerp(hy, vyp, morph);
    const ang = lerp(0, Math.PI / 2, morph);
    const L = lerp(hL, vL, morph), T = lerp(hT, vT, morph);
    g.save();
    g.translate(px + (morph > 0 ? 0 : 0), py);
    g.rotate(ang);
    g.fillStyle = C.red;
    g.shadowColor = rgba(C.red, 0.7);
    g.shadowBlur = 16;
    g.fillRect(0, morph > 0.5 ? -T : 0, L * bandStart, T);
    g.restore();
  }
  // 竖向深度尺
  const dp = R(t, 4.95, 5.7);
  if (dp > 0) {
    const rx = cam.ox + 46;
    const fadeLate = 1 - 0.45 * R(t, 19.5, 20.3) * (1 - R(t, 23.5, 24.2));
    g.save();
    g.globalAlpha = fadeLate;
    g.strokeStyle = rgba(C.ink, 0.55);
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(rx, cam.Y(0));
    g.lineTo(rx, lerp(cam.Y(0), cam.Y(7), eo4(dp)));
    g.stroke();
    for (let cm = 0; cm <= 7; cm++) {
      const p = eo4(R(t, 5.05 + cm * 0.05, 5.4 + cm * 0.05));
      if (p <= 0) continue;
      const y = cam.Y(cm);
      const key = cm === 5 || cm === 6 || cm === 0;
      g.strokeStyle = rgba(C.ink, key ? 0.8 : 0.35);
      g.beginPath();
      g.moveTo(rx, y);
      g.lineTo(rx - (key ? 16 : 9) * p, y);
      g.stroke();
      const showLbl = key || cam.sy > 1.5;
      if (showLbl) numText(g, String(cm), rx + 10, y + 7, 20, 600, rgba(cm === 5 || cm === 6 ? C.red : C.ink, (key ? 0.9 : 0.4) * p));
    }
    numText(g, 'cm', rx + 8, cam.Y(7) + 30, 18, 500, rgba(C.dim, eo3(dp)));
    g.restore();
  }
}

// 计数器:小号 → 主角(21→30)→ 飞到 30 个波谷上方变成标注 "30 : 2"
function drawCounter(g, t, cam) {
  const a0 = eo3(R(t, Bk(1) - 0.1, Bk(1) + 0.3));
  if (a0 <= 0) return;
  const n = strokesDone(t);
  const hero = eio5(R(t, 13.25, 14.1));
  const fly = eio5(R(t, 17.8, 18.4));
  // 三个锚点
  const sA = { x: 1640, y: 150, s: 72 };
  const sB = { x: 1330, y: cam.Y(0) - 120, s: 290 };
  const wx = cam.T((Bk(1) + Bk(30)) / 2);
  const sC = { x: wx - 150, y: cam.Y(-2.4) - 30, s: clamp(220 * (cam.sx / 0.2), 120, 230) };
  let x = lerp(sA.x, sB.x, hero), y = lerp(sA.y, sB.y, hero), size = lerp(sA.s, sB.s, hero);
  x = lerp(x, sC.x, fly);
  y = lerp(y, sC.y, fly);
  size = lerp(size, sC.s, fly);
  if (x > W + 400 || x < -900) return;
  // 镜头推进中断段时,"30 : 2" 标注先让位,收尾海报再回来
  const away = eo3(R(t, 19.45, 19.8)) * (1 - eo3(R(t, 24.6, 25.2)));
  if (away >= 1) return;
  // 30 那一下的重击
  const hit = t > Bk(30) ? 1 - eo3(R(t, Bk(30), Bk(30) + 0.5)) : 0;
  const sc = 1 + 0.14 * hit;
  g.save();
  g.globalAlpha = 1 - away;
  g.translate(x, y);
  g.scale(sc, sc);
  // 数字滚动:新数字从上方被"压"下来
  const k = n;
  const tk = k >= 1 ? Bk(k) : 0;
  const roll = k >= 1 ? backOut(R(t, tk - 0.04, tk + 0.16), 1.6) : 1;
  const cell = size * 0.62;
  const ndig = 2;
  const cur = String(k).padStart(2, ' ');
  const prev = String(Math.max(0, k - 1)).padStart(2, ' ');
  const colN = hit > 0 ? mix(C.ink, C.red, hit) : k === 30 ? C.red : C.ink;
  g.save();
  g.beginPath();
  g.rect(-10, -size * 0.92, cell * ndig + 20, size * 1.05);
  g.clip();
  for (let i = 0; i < ndig; i++) {
    const changed = cur[i] !== prev[i];
    const off = changed ? (1 - roll) * size : 0;
    if (cur[i] !== ' ') numText(g, cur[i], i * cell, off - (changed ? 0 : 0), size, 780, colN);
    if (changed && prev[i] !== ' ' && roll < 1) numText(g, prev[i], i * cell, off + size * 0.98, size, 780, rgba(C.ink, 0.6));
  }
  g.restore();
  // 分母 / 30,或呼吸 : 2
  const breathMode = eo4(R(t, 17.5, 17.9));
  const slashA = (1 - breathMode) * a0;
  if (slashA > 0) numText(g, '/30', cell * 2 + size * 0.08, -size * 0.02, size * 0.3, 500, rgba(C.dim, slashA));
  if (breathMode > 0) {
    const nb = t >= 19.12 ? 2 : t >= 18.1 ? 1 : 0;
    const colB = C.blue;
    numText(g, ':', cell * 2 + size * 0.12, -size * 0.05, size, 600, rgba(colB, breathMode));
    const bx = cell * 2 + size * 0.48;
    if (nb > 0) {
      const tb = nb === 2 ? 19.12 : 18.1;
      const rp = backOut(R(t, tb - 0.04, tb + 0.24), 1.4);
      g.save();
      g.beginPath();
      g.rect(bx - 10, -size * 0.92, cell + 20, size * 1.05);
      g.clip();
      numText(g, String(nb), bx, (1 - rp) * -size, size, 780, colB);
      if (nb === 2 && rp < 1) numText(g, '1', bx, (1 - rp) * -size + size, size, 780, rgba(colB, 0.6));
      g.restore();
    }
  }
  g.restore();
  // 波谷编号:拉远看到 30 次时
  const lab = R(t, 17.45, 17.95);
  if (lab > 0) {
    const fade = 1 - R(t, 19.4, 19.9);
    for (const kk of [1, 5, 10, 15, 20, 25, 30]) {
      const p = eo3(R(t, 17.45 + kk * 0.012, 17.75 + kk * 0.012));
      const xx = cam.T(Bk(kk));
      if (xx < -40 || xx > W + 40) continue;
      const s = String(kk);
      numText(g, s, xx - numWidth(g, s, 20, 600) / 2, cam.Y(depthOf(kk)) + 34 + (1 - p) * 14, 20, 600, rgba(kk === 30 ? C.red : C.dim, p * clamp(fade)));
    }
  }
}

// 中断:括号从第 30 拍开始长,读秒;10 s 处立一道墙
function drawPause(g, t, cam) {
  const now = rec(t);
  if (now < PAUSE_A + 0.05) return;
  const end = Math.min(now, PAUSE_B);
  const y = cam.Y(7.6);
  const xa = cam.T(PAUSE_A), xb = cam.T(end);
  const closed = now >= PAUSE_B;
  const col = rgba(C.ink, 0.8);
  g.save();
  g.strokeStyle = col;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(xa, y - 16);
  g.lineTo(xa, y);
  g.lineTo(xb, y);
  if (closed) g.lineTo(xb, y - 16 * eo4(R(now, PAUSE_B, PAUSE_B + 0.25)));
  g.stroke();
  // 剩余到 10 s 的虚线 + 墙
  const wallA = eo4(R(t, 20.95, 21.5)) * (1 - eo3(R(t, 24.0, 24.6)));
  if (wallA > 0) {
    const xw = cam.T(PAUSE_A + 10);
    g.setLineDash([3, 9]);
    g.strokeStyle = rgba(C.dim, 0.7 * wallA);
    g.beginPath();
    g.moveTo(xb, y);
    g.lineTo(xw, y);
    g.stroke();
    g.setLineDash([]);
    const top = cam.Y(-4.2), bot = cam.Y(9.4);
    const grow = eo4(R(t, 21.0, 21.6));
    g.strokeStyle = rgba(C.red, 0.95 * wallA);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(xw, bot);
    g.lineTo(xw, lerp(bot, top, grow));
    g.stroke();
    g.save();
    g.beginPath();
    g.rect(xw, lerp(bot, top, grow), 90, bot - lerp(bot, top, grow));
    g.clip();
    g.strokeStyle = rgba(C.red, 0.35 * wallA);
    g.lineWidth = 1.5;
    for (let yy = top - 90; yy < bot; yy += 14) {
      g.beginPath();
      g.moveTo(xw, yy + 60);
      g.lineTo(xw + 60, yy);
      g.stroke();
    }
    g.restore();
    numText(g, '10 s', xw + 14, top + 34, 40, 700, rgba(C.red, wallA * grow));
  }
  g.restore();
  // 读秒
  const el = Math.max(0, end - PAUSE_A);
  const hero = eio5(R(t, 19.5, 20.2)) * (1 - eio5(R(t, 23.9, 24.5)));
  const small = { x: xb + 16, y: y + 40, s: 26 };
  const big = { x: cam.ox + 80, y: cam.Y(0) - 70, s: 128 };
  const ann = eio5(R(t, 24.0, 24.75));
  let x = lerp(small.x, big.x, hero), yy = lerp(small.y, big.y, hero), s = lerp(small.s, big.s, hero);
  if (ann > 0) {
    // 读秒缩小、落到括号右端下方,变成标注
    const tw = numWidth(g, '6.7 s', 46, 720) + 46 * 0.4 + numWidth(g, '< 10 s', 46 * 0.62, 600);
    x = lerp(x, cam.T(PAUSE_B) - tw, ann);
    yy = lerp(yy, y - 20, ann);
    s = lerp(s, 46, ann);
  }
  const txt = `${el.toFixed(1)} s`;
  const okA = closed ? eo3(R(now, PAUSE_B, PAUSE_B + 0.3)) : 0;
  numText(g, txt, x, yy, s, 720, closed ? mix(C.ink, C.ink, 1) : C.ink);
  if (hero > 0.3 && !closed) {
    // 读秒下面的 10 s 进度条
    const bw = s * 2.6;
    g.fillStyle = rgba(C.ink, 0.15 * hero);
    g.fillRect(x, yy + 22, bw, 6);
    g.fillStyle = rgba(C.ink, 0.85 * hero);
    g.fillRect(x, yy + 22, bw * clamp(el / 10), 6);
    numText(g, '/ 10 s', x + bw + 14, yy + 30, 22, 500, rgba(C.dim, hero));
  }
  if (okA > 0) numText(g, '< 10 s', x + numWidth(g, txt, s, 720) + s * 0.4, yy, s * 0.62, 600, rgba(C.red, okA));
}

// 收尾海报标注
function drawPoster(g, t, cam) {
  const a1 = eo4(R(t, 24.55, 25.1));
  const a2 = eo4(R(t, 24.85, 25.4));
  if (a1 > 0) {
    const x = cam.T(Bk(1)) - 4, y = cam.Y(-2.4);
    numText(g, '100–120', x, y + (1 - a1) * 20, 40, 720, rgba(C.ink, a1));
    numText(g, '/min', x + numWidth(g, '100–120', 40, 720) + 10, y + (1 - a1) * 20, 24, 500, rgba(C.dim, a1));
  }
  if (a2 > 0) {
    const x = cam.T(Bk(2)) - 4, y = cam.Y(6) + 54;
    numText(g, '5–6', x, y + (1 - a2) * 20, 40, 720, rgba(C.red, a2));
    numText(g, 'cm', x + numWidth(g, '5–6', 40, 720) + 10, y + (1 - a2) * 20, 24, 500, rgba(C.dim, a2));
  }
}

function renderScene(g, t) {
  const cam = camera(t);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.shadowBlur = 0;
  drawBackground(g, t, cam);
  drawTimeRuler(g, t, cam);
  drawGuides(g, t, cam);
  drawGauges(g, t, cam);
  drawTrace(g, t, cam);
  drawPause(g, t, cam);
  drawPen(g, t, cam);
  drawPoster(g, t, cam);
  drawCounter(g, t, cam);
  g.shadowBlur = 0;
  for (const run of RUNS) drawRun(g, run, t, cam);
}

// 镜头快速运动处加子帧
const FAST = [[0, 1.0], [4.6, 5.5], [9.15, 10.1], [17.15, 17.9], [19.45, 20.3], [21.05, 21.8], [22.3, 22.9]];
export function drawFrame(ctx, frame) {
  const t0 = frame / FPS;
  const fast = FAST.some(([a, b]) => t0 >= a && t0 <= b);
  const n = fast ? 12 : 6;
  for (let s = 0; s < n; s++) {
    const tt = (frame + ((s + 0.5) / n - 0.5) * 0.5) / FPS;
    renderScene(subG, tt);
    accG.globalAlpha = 1 / (s + 1);
    accG.drawImage(sub, 0, 0);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(acc, 0, 0);
  const vg = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.45, W / 2, H / 2, H * 1.05);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  if (!grainPats) grainPats = grainTiles.map((c) => ctx.createPattern(c, 'repeat'));
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.09;
  ctx.fillStyle = grainPats[frame % 4];
  ctx.translate(-((frame * 37) % 256), -((frame * 91) % 256));
  ctx.fillRect(0, 0, W + 256, H + 256);
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
}
