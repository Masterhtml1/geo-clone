#!/usr/bin/env node
// Headless verification for Pulse Vector.
// Extracts the simulation core from index.html (between @@CORE_START / @@CORE_END),
// checks the cube "feel targets", then runs a beam-search bot over every level using
// the exact same physics code. A level passes if some input sequence, with decisions
// at the given granularity, reaches the finish line.
//
// Usage: node tools/verify.js [path/to/index.html] [--quick]
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const file = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || path.join(__dirname, '..', 'index.html');
const quick = process.argv.includes('--quick');
const onlyArg = process.argv.find(a => a.startsWith('--level='));
const only = onlyArg ? +onlyArg.split('=')[1] : null;
const src = fs.readFileSync(file, 'utf8');
const m = src.match(/\/\/ @@CORE_START([\s\S]*?)\/\/ @@CORE_END/);
if (!m) { console.error('core markers not found'); process.exit(2); }
const ctx = {};
vm.createContext(ctx);
vm.runInContext(m[1] + '\n;this.API={CONFIG,LEVELS,prepareLevel,createState,cloneState,stepSim,TICK};', ctx);
const { CONFIG, LEVELS, prepareLevel, createState, cloneState, stepSim, TICK } = ctx.API;

let failures = 0;
function check(name, ok, info) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
}

// ---------------------------------------------------------------- feel tests
function testLevel(objects, length = 60) {
  return prepareLevel({ id: 't', name: 't', bpm: 120, startSpeed: 1, startMode: 'cube', colors: { bg: '#000000', ground: '#000000' }, objects, length });
}
{
  const L = testLevel([]);
  const s = createState(L);
  let apex = 0;
  stepSim(L, s, true, true, null);
  for (let i = 0; i < 400 && !s.grounded; i++) { stepSim(L, s, false, false, null); apex = Math.max(apex, s.y - 0.5); }
  check('cube apex ≈ 2.1 blocks', Math.abs(apex - 2.1) < 0.08, apex.toFixed(3));
}
// can a cube reach the finish over obstacles (any single press timing)?
function canPass(objects, length) {
  const L = testLevel(objects, length);
  for (let jt = 0; jt < 240 * 2; jt++) {
    const s = createState(L);
    for (let t = 0; t < 240 * 6 && !s.dead && !s.done; t++) stepSim(L, s, t === jt, t === jt, null);
    if (s.done) return true;
  }
  return false;
}
check('cube clears 3 spikes in a row', canPass([0, 1, 2].map(i => ({ type: 'spike', x: 10 + i, y: 0 })), 16));
check('cube cannot clear 4 spikes in a row', !canPass([0, 1, 2, 3].map(i => ({ type: 'spike', x: 10 + i, y: 0 })), 17));
check('cube lands on a 2-block platform', canPass([{ type: 'block', x: 10, y: 0, extra: { w: 6, h: 2 } }], 15));
check('cube cannot land on a 3-block platform', !canPass([{ type: 'block', x: 10, y: 0, extra: { w: 6, h: 3 } }], 15));

// determinism across frame rates: same inputs at different frame pacing give identical states
{
  const L = prepareLevel(LEVELS[0]);
  const run = (fps) => {
    const s = createState(L); let acc = 0, ticks = 0;
    const frame = 1 / fps;
    for (let f = 0; f < fps * 3; f++) {
      acc += frame;
      while (acc >= TICK - 1e-9) { acc -= TICK; ticks++; const held = (ticks % 216) < 72; stepSim(L, s, held, held && (ticks % 216) === 1, null); }
    }
    return s;
  };
  const a = run(30), b = run(60), c = run(144);
  const same = (p, q) => p.x === q.x && p.y === q.y && p.vy === q.vy && p.dead === q.dead;
  check('fixed timestep: identical state after 3 s at 30 / 60 / 144 fps', same(a, b) && same(b, c), `x=${a.x.toFixed(4)} y=${a.y.toFixed(4)} dead=${a.dead}`);
}

// ---------------------------------------------------------------- level bot
function solve(L, dec, cap) {
  let beam = [{ s: createState(L), held: false, parent: null }];
  let maxX = 0, steps = 0, minBeam = Infinity, minBeamX = 0;
  const maxSteps = Math.ceil((L.length / CONFIG.SPEEDS[0]) * CONFIG.PHYSICS_HZ / dec) + 10;
  while (beam.length && steps < maxSteps) {
    steps++;
    const next = new Map();
    for (const node of beam) {
      for (const choice of [false, true]) {
        const s = cloneState(node.s);
        for (let k = 0; k < dec && !s.dead && !s.done; k++) stepSim(L, s, choice, k === 0 && choice && !node.held, null);
        if (s.dead) { maxX = Math.max(maxX, s.x); continue; }
        if (s.done) {
          const inputs = [choice]; for (let n = node; n && n.parent; n = n.parent) inputs.push(n.held);
          return { ok: true, steps, minBeam, minBeamX, inputs: inputs.reverse() };
        }
        const key = `${s.mode}|${s.grav}|${s.mini}|${s.speedIdx}|${Math.round(s.x * 4)}|${Math.round(s.y * 30)}|${Math.round(s.vy * 3)}|${choice}|${s.grounded}|${s.robotT > 0}|${s.used.length}`;
        if (!next.has(key)) next.set(key, { s, held: choice, parent: node });
      }
    }
    beam = [...next.values()];
    if (beam.length) { const x = beam[0].s.x; maxX = Math.max(maxX, x); if (beam.length < minBeam && x > 6) { minBeam = beam.length; minBeamX = x; } }
    if (beam.length > cap) {
      beam.sort((a, b) => a.s.y - b.s.y || a.s.vy - b.s.vy);
      const out = []; const step = beam.length / cap;
      for (let i = 0; i < cap; i++) out.push(beam[Math.floor(i * step)]);
      beam = out;
    }
  }
  return { ok: false, maxX, steps };
}

const grains = quick ? [4] : [4, 8, 12];
const emitArg = process.argv.find(a => a.startsWith('--emit='));
const solutions = {};
LEVELS.forEach((def, i) => {
  if (only != null && only !== i + 1) return;
  const L = prepareLevel(def);
  const secs = estimateSeconds(def);
  check(`level ${i + 1} "${def.name}" length 45–90 s`, secs >= 45 && secs <= 90, `${secs.toFixed(1)} s, ${def.length.toFixed(0)} blocks, ${def.objects.length} objects`);
  for (const dec of grains) {
    const t0 = Date.now();
    const r = solve(L, dec, 400);
    const ms = Date.now() - t0;
    const hz = (CONFIG.PHYSICS_HZ / dec).toFixed(0);
    if (r.ok && dec === 4) solutions[i] = { dec, inputs: r.inputs.map(Number).join('') };
    if (r.ok) check(`level ${i + 1} completable with ${hz} Hz inputs`, true, `${ms} ms, narrowest beam ${r.minBeam} @x=${r.minBeamX.toFixed(1)}`);
    else check(`level ${i + 1} completable with ${hz} Hz inputs`, dec !== 4 ? true : false, `${dec !== 4 ? '(informational) ' : ''}stuck at x=${r.maxX.toFixed(2)} / ${def.length.toFixed(1)} in section "${sectionAt(def, r.maxX)}"`);
    if (!r.ok) break;
  }
});

function sectionAt(def, x) { let n = 'start'; for (const [mx, name] of def.marks || []) if (mx <= x) n = name; return n; }

function estimateSeconds(def) {
  // walk speed portals in order
  const portals = def.objects.filter(o => o.type === 'portal' && o.extra.kind === 'speed').sort((a, b) => a.x - b.x);
  let x = 0, si = def.startSpeed, t = 0;
  for (const p of portals) { t += (p.x - x) / CONFIG.SPEEDS[si]; x = p.x; si = p.extra.speed; }
  return t + (def.length - x) / CONFIG.SPEEDS[si];
}

if (emitArg) fs.writeFileSync(emitArg.split('=')[1], JSON.stringify(solutions));
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
