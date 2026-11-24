/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2026 Kevin Sint */
/* The sound engine of index.html, run in node with no browser: node tests/engine.test.js */
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const engine = page.match(/<script>\n\/\* SPDX[\s\S]*?<\/script>/)[0].replace(/<\/?script>/g, '');
const { makeCore, makeKickEngine } = new Function(engine + '; return { makeCore, makeKickEngine };')();
const RATE = 96000;

/* one hit from silence: the layers' samples for `seconds` */
function hit(values, seconds) {
  const core = makeCore(RATE), count = Math.floor(RATE * seconds);
  const shot = { all: new Float32Array(count), body: new Float32Array(count), click: new Float32Array(count), rumble: new Float32Array(count), texture: new Float32Array(count), lfo: new Float32Array(count) };
  core.message({ set: values }); core.message({ hit: 1 });
  for (let i = 0; i < count; i++) { core.tick(); for (const name in shot) shot[name][i] = core[name]; }
  return shot;
}
const peak = (wave) => wave.reduce((top, v) => Math.max(top, Math.abs(v)), 0);
const allFinite = (wave) => wave.every(Number.isFinite);

/* every click mode and drive type, at both ends of the knobs, through the output filter: no bad value, no overload */
for (const mode of [0, 1, 2]) for (const type of [0, 1, 2]) for (const end of [0, 127]) {
  const out = new Float32Array(48000), kick = makeKickEngine(48000);
  kick.message({ set: { mode, type, attack: end, cattack1: end, cattack2: 127 - end, noise2: end, ccurve2: end, rattack: end, drive: end, rphase: end, sweep1: end, sweep2: 127 - end, depth2: end, curve2: end, bmod: end ? 120 : 50, bpts: end ? 3 : 0, bend1: end, bend2: 127 - end, snap2: end, tune2: end, cmod: end ? 120 : 50, cpts: end ? 3 : 0, pitch1: end ? 60 : 0, pitch2: end ? 0 : 60, delay: end, dfbk: end, llevel: end, ldark: end, lper: end ? 13 : 0, lphase: end, tex: 127, tattack: end, tdecay: end, tcurve: end, topen: end, tnoise: end, trev: end, tsize: end, tlow: end, thigh: end, bpm: 200 }, run: true });
  kick.process(out);
  assert.ok(allFinite(out), `mode ${mode}, type ${type}, knobs at ${end}: a value is not a number`);
  assert.ok(peak(out) <= 1, `mode ${mode}, type ${type}, knobs at ${end}: the output is above full level`);
}

/* the three levels do not move each other */
{
  const full = hit({}, 1), noBody = hit({ level: 0 }, 1), noClick = hit({ click: 0 }, 1), noRumble = hit({ rumble: 0 }, 1);
  assert.strictEqual(peak(noBody.body), 0, 'the body is silent at LEVEL 0');
  assert.strictEqual(peak(noBody.click), peak(full.click), 'the click does not change with the body at 0');
  assert.strictEqual(peak(noBody.rumble), peak(full.rumble), 'the rumble does not change with the body at 0');
  assert.strictEqual(peak(noClick.click), 0, 'the click is silent at LEVEL 0');
  assert.strictEqual(peak(noClick.body), peak(full.body), 'the body does not change with the click at 0');
  assert.strictEqual(peak(noRumble.rumble), 0, 'the rumble is silent at LEVEL 0');
  assert.strictEqual(peak(noRumble.body), peak(full.body), 'the body does not change with the rumble at 0');
}

/* the body's ATTACK cuts only the start: after the attack time the wave is the wave with no attack (low cut off) */
{
  const attackSeconds = 0.001 * Math.pow(2, 90 / 127 * 8.64), from = Math.ceil(attackSeconds * RATE) + 1;
  const plain = hit({ attack: 0, hpf: 0, click: 0, rumble: 0 }, 0.5).body, cut = hit({ attack: 90, hpf: 0, click: 0, rumble: 0 }, 0.5).body;
  for (let i = from; i < plain.length; i++) assert.strictEqual(cut[i], plain[i], `the wave differs after the attack, at sample ${i}`);
  assert.ok(Math.abs(cut[Math.floor(from / 4)]) < 0.05, 'the body is low in the first quarter of the attack');
}

/* the body's pitch curve does not move the click */
assert.deepStrictEqual(hit({ curve1: 20 }, 0.25).click, hit({ curve1: 96 }, 0.25).click, 'the click changed with the body\'s PITCH CURVE');

/* the rumble ends on the clock: LENGTH is a part of a bar at the tempo, and it only closes the gate (SIZE at its top, so the tail is longer than each LENGTH) */
for (const [rlen, bpm, bars] of [[1, 120, 1 / 8], [2, 120, 1 / 4], [3, 120, 1 / 2], [2, 90, 1 / 4]]) {
  const seconds = bars * 240 / bpm, rumble = hit({ rlen, bpm, rattack: 0, size: 127 }, seconds * 1.6 + 0.3).rumble, top = peak(rumble);
  let last = 0;
  rumble.forEach((v, i) => { if (Math.abs(v) > top / 1000) last = i; });
  assert.ok(last / RATE <= seconds * 1.02, `LENGTH ${bars} at ${bpm} BPM: the rumble goes on after ${seconds} s`);
  assert.ok(last / RATE >= seconds * 0.85, `LENGTH ${bars} at ${bpm} BPM: the rumble stops long before ${seconds} s`);
}

/* the TEMPO does not change the sound of a hit: the body and the click are the same, and the rumble is the same until its gate starts to close */
{
  const slow = hit({ bpm: 90, rlen: 3 }, 0.6), fast = hit({ bpm: 180, rlen: 3 }, 0.6), same = Math.floor(0.7 * (1 / 2 * 240 / 180) * RATE) - 1;
  assert.deepStrictEqual(fast.body, slow.body, 'the body changed with the TEMPO');
  assert.deepStrictEqual(fast.click, slow.click, 'the click changed with the TEMPO');
  assert.ok(peak(slow.rumble.subarray(0, same)) > 0.01, 'the rumble is silent');
  assert.deepStrictEqual(fast.rumble.subarray(0, same), slow.rumble.subarray(0, same), 'the rumble changed with the TEMPO before its gate closes');
}

/* SIZE is the reverb's own time, not on the clock: a larger SIZE leaves more of the tail at the same LENGTH and TEMPO */
{
  const level = (wave) => Math.sqrt(wave.subarray(Math.floor(0.8 * RATE), Math.floor(1.2 * RATE)).reduce((sum, v) => sum + v * v, 0));
  const small = hit({ size: 20, rlen: 4, rattack: 0 }, 1.3).rumble, large = hit({ size: 120, rlen: 4, rattack: 0 }, 1.3).rumble;
  assert.ok(level(large) > 10 * level(small), 'SIZE does not change the length of the reverb\'s tail');
}

/* the texture is the body's second output: its LEVEL moves no other layer, and the body's LEVEL does not move it */
{
  const full = hit({}, 1), noTexture = hit({ tex: 0 }, 1), noBody = hit({ level: 0 }, 1);
  assert.ok(peak(full.texture) > 0.05, 'the texture is silent');
  assert.strictEqual(peak(noTexture.texture), 0, 'the texture is silent at LEVEL 0');
  for (const name of ['body', 'click', 'rumble']) assert.deepStrictEqual(noTexture[name], full[name], `the ${name} changed with the texture at 0`);
  assert.deepStrictEqual(noBody.texture, full.texture, 'the texture changed with the body at 0');
  assert.deepStrictEqual(hit({}, 1).texture, full.texture, 'two hits from silence do not give the same texture');
}

/* the gate: DECAY is where the texture ends (no reverb), ATTACK cuts its start, OPEN is how bright it is */
{
  const end = (wave) => { const top = peak(wave); let last = 0; wave.forEach((v, i) => { if (Math.abs(v) > top / 100) last = i; }); return last / RATE; };
  const bright = (wave) => { let moves = 0, size = 0; for (let i = 1; i < wave.length; i++) { moves += (wave[i] - wave[i - 1]) ** 2; size += wave[i] ** 2; } return moves / size; };
  const dry = { trev: 0, decay: 127 };      /* a long body, so the gate ends the texture and not the body */
  const short = hit({ ...dry, tdecay: 20 }, 2).texture, long = hit({ ...dry, tdecay: 110 }, 2).texture;
  assert.ok(end(short) < 0.1, 'a short DECAY does not close the gate');
  assert.ok(end(long) > 3 * end(short), 'DECAY does not change the length of the texture');
  const late = hit({ ...dry, tattack: 127 }, 0.3).texture, atOnce = hit({ ...dry, tattack: 0 }, 0.3).texture;
  assert.ok(peak(late.subarray(0, Math.floor(0.01 * RATE))) < 0.2 * peak(atOnce.subarray(0, Math.floor(0.01 * RATE))), 'ATTACK does not cut the start of the texture');
  assert.ok(bright(hit({ ...dry, topen: 127 }, 0.3).texture) > 10 * bright(hit({ ...dry, topen: 0 }, 0.3).texture), 'OPEN does not change the brightness');
  assert.ok(bright(hit({ ...dry, tnoise: 127 }, 0.3).texture) > 10 * bright(hit({ ...dry, tnoise: 0 }, 0.3).texture), 'NOISE adds no noise');
}

/* the gate's DCY CURVE: at 0 the gate falls fast at the start, at 127 it stays open and falls at the end; at each curve the texture is closed after DECAY */
{
  const dry = { trev: 0, decay: 127, tdecay: 80, tnoise: 127 }, seconds = 0.02 * Math.pow(2, 80 / 127 * 6.64);
  const level = (wave, from, to) => Math.sqrt(wave.subarray(Math.floor(from * seconds * RATE), Math.floor(to * seconds * RATE)).reduce((sum, v) => sum + v * v, 0));
  const fast = hit({ ...dry, tcurve: 0 }, seconds * 1.5).texture, line = hit({ ...dry, tcurve: 42 }, seconds * 1.5).texture, held = hit({ ...dry, tcurve: 127 }, seconds * 1.5).texture;
  assert.ok(level(line, 0.5, 0.8) > 3 * level(fast, 0.5, 0.8), 'DCY CURVE at 42 is not slower than at 0');
  assert.ok(level(held, 0.5, 0.8) > 1.5 * level(line, 0.5, 0.8), 'DCY CURVE at 127 does not keep the gate open');
  for (const wave of [fast, line, held]) assert.ok(level(wave, 1.1, 1.5) < 0.001 * level(wave, 0, 1), 'the texture goes on after DECAY');
}

/* the texture's reverb: REVERB at 0 leaves no tail after the gate, and SIZE is the length of the tail */
{
  const tail = (wave) => Math.sqrt(wave.subarray(Math.floor(0.6 * RATE), Math.floor(0.9 * RATE)).reduce((sum, v) => sum + v * v, 0));
  const gate = { tdecay: 20, decay: 20 };
  assert.ok(tail(hit({ ...gate, trev: 0 }, 1).texture) < 1e-6, 'the texture goes on with REVERB at 0');
  assert.ok(tail(hit({ ...gate, trev: 127, tsize: 127 }, 1).texture) > 100 * tail(hit({ ...gate, trev: 127, tsize: 20 }, 1).texture), 'SIZE does not change the length of the tail');
}

/* the two filters at the texture's end, after its reverb: LOW CUT takes the lows out, HIGH CUT takes the highs out, and at their ends they are off */
{
  const size = (wave) => Math.sqrt(wave.reduce((sum, v) => sum + v * v, 0));
  const moves = (wave) => { let total = 0; for (let i = 1; i < wave.length; i++) total += (wave[i] - wave[i - 1]) ** 2; return Math.sqrt(total); };
  const lows = { tnoise: 0, drive: 0, topen: 127 }, highs = { tnoise: 127, topen: 127, level: 0 };      /* a texture of the body's sine only; a texture with much noise */
  assert.ok(size(hit({ ...lows, tlow: 127 }, 0.5).texture) < 0.05 * size(hit({ ...lows, tlow: 0 }, 0.5).texture), 'LOW CUT leaves the lows');
  assert.ok(moves(hit({ ...highs, thigh: 0 }, 0.5).texture) < 0.05 * moves(hit({ ...highs, thigh: 127 }, 0.5).texture), 'HIGH CUT leaves the highs');
  assert.ok(moves(hit({ ...highs, tlow: 127 }, 0.5).texture) > 0.5 * moves(hit({ ...highs, tlow: 0 }, 0.5).texture), 'LOW CUT takes the highs out too');
  assert.ok(size(hit({ ...lows, thigh: 0 }, 0.5).texture) > 0.5 * size(hit({ ...lows, thigh: 127 }, 0.5).texture), 'HIGH CUT takes the lows out too');
}

/* the rumble's LFO: LFO PER BAR is the number of its cycles in a bar at the tempo, and LFO PHASE is where in its cycle it starts */
{
  const ups = (wave) => { let count = 0; for (let i = 1; i < wave.length; i++) if (wave[i - 1] < 0 && wave[i] >= 0) count++; return count; };
  const almostBar = 0.99 * 240 / 100;
  for (const [lper, cycles] of [[2, 1], [4, 3], [5, 4], [9, 8]]) assert.strictEqual(ups(hit({ bpm: 100, lper }, almostBar).lfo), cycles - 1, `LFO PER BAR ${cycles}: not ${cycles} cycles in a bar`);
  const from0 = hit({ lper: 3 }, 0.5).lfo, from180 = hit({ lper: 3, lphase: 64 }, 0.5).lfo, from90 = hit({ lper: 3, lphase: 32 }, 0.01).lfo;
  for (let i = 0; i < from0.length; i += 997) assert.ok(Math.abs(from0[i] + from180[i]) < 1e-6, 'LFO PHASE at 180 degrees is not the wave upside down');
  assert.ok(from90[100] > 0.99, 'LFO PHASE at 90 degrees does not start at the top');
}

/* the click's MOD LEVEL morphs SNAP, TUNE and SWEEP between 2 to 5 markers: a marker's place gives that marker, and between two markers the knobs' values are mixed */
{
  const click = (values) => hit({ rumble: 0, tex: 0, cpts: 0, ...values }, 0.2).click;      /* 2 markers, when the test does not give another number */
  const one = { tune1: 10, snap1: 20, bend1: 30 }, two = { tune2: 110, snap2: 90, bend2: 100 }, three = { tune3: 60, snap3: 127, bend3: 0 };
  const as1 = (marker, n) => Object.fromEntries(Object.entries(marker).map(([name, v]) => [name.replace(String(n), '1'), v]));      /* a marker's values, put at marker 1 */
  assert.deepStrictEqual(click({ ...one, ...two, cmod: 0 }), click(one), 'MOD LEVEL at 0 is not marker 1');
  assert.deepStrictEqual(click({ ...one, ...two, cmod: 120 }), click(as1(two, 2)), 'MOD LEVEL at its top is not the last of 2 markers');
  assert.deepStrictEqual(click({ ...one, ...two, ...three, cpts: 1, cmod: 120 }), click(as1(three, 3)), 'MOD LEVEL at its top is not the last of 3 markers');
  assert.deepStrictEqual(click({ ...one, ...two, ...three, cpts: 1, cmod: 60 }), click(as1(two, 2)), 'MOD LEVEL at the middle is not marker 2 of 3');
  assert.deepStrictEqual(click({ ...one, ...two, cmod: 60 }), click({ tune1: 60, snap1: 55, bend1: 65 }), 'MOD LEVEL between two markers does not mix their values');
  assert.deepStrictEqual(click({ ...one, ...two, cpts: -1, cmod: 90 }), click(one), 'with one marker the click is not marker 1 at each MOD LEVEL');
  assert.deepStrictEqual(hit({ ...one, ...two, cmod: 90 }, 0.2).click, hit(one, 0.2).click, 'a kick with no number of markers does not have one marker');
  for (const [name, low, high] of [['cattack', 0, 100], ['ccurve', 10, 120], ['noise', 0, 127]]) {      /* ATTACK, PITCH CURVE and NOISE are in the markers too */
    assert.deepStrictEqual(click({ [name + 1]: low, [name + 2]: high, cmod: 120 }), click({ [name + 1]: high }), `MOD LEVEL at its top does not give marker 2's ${name}`);
    assert.notDeepStrictEqual(click({ [name + 1]: low, [name + 2]: high, cmod: 0 }), click({ [name + 1]: high }), `${name} does not change the click`);
  }
  assert.notDeepStrictEqual(click({ ...one, ...two, cmod: 0 }), click({ ...one, ...two, cmod: 40 }), 'MOD LEVEL does not change the click');
  assert.deepStrictEqual(click({ cmod: 90, cpts: 3 }), click({}), 'MOD LEVEL changes the click when all the markers are the same');
}

/* the body's MOD LEVEL morphs PITCH, DEPTH, SWEEP and PITCH CURVE between 2 to 5 markers, as the click's does, and the two MOD LEVELs do not move each other */
{
  const shot = (values) => hit({ rumble: 0, tex: 0, bpts: 0, ...values }, 0.2), body = (values) => shot(values).body;      /* 2 markers, when the test does not give another number */
  const one = { pitch1: 12, depth1: 20, sweep1: 30, curve1: 10 }, two = { pitch2: 36, depth2: 100, sweep2: 90, curve2: 120 }, three = { pitch3: 5, depth3: 127, sweep3: 0, curve3: 60 };
  const as1 = (marker, n) => Object.fromEntries(Object.entries(marker).map(([name, v]) => [name.replace(String(n), '1'), v]));      /* a marker's values, put at marker 1 */
  assert.notDeepStrictEqual(body(one), body(as1(two, 2)), 'the body\'s markers do not change the body');
  assert.deepStrictEqual(body({ ...one, ...two, bmod: 0 }), body(one), 'the body\'s MOD LEVEL at 0 is not marker 1');
  assert.deepStrictEqual(body({ ...one, ...two, bmod: 120 }), body(as1(two, 2)), 'the body\'s MOD LEVEL at its top is not the last of 2 markers');
  assert.deepStrictEqual(body({ ...one, ...two, ...three, bpts: 1, bmod: 60 }), body(as1(two, 2)), 'the body\'s MOD LEVEL at the middle is not marker 2 of 3');
  assert.deepStrictEqual(body({ ...one, ...two, ...three, bpts: 1, bmod: 120 }), body(as1(three, 3)), 'the body\'s MOD LEVEL at its top is not the last of 3 markers');
  assert.deepStrictEqual(body({ ...one, ...two, bmod: 60 }), body({ pitch1: 24, depth1: 60, sweep1: 60, curve1: 65 }), 'the body\'s MOD LEVEL between two markers does not mix their values');
  assert.deepStrictEqual(body({ ...one, ...two, bpts: -1, bmod: 90 }), body(one), 'with one marker the body is not marker 1 at each MOD LEVEL');
  assert.deepStrictEqual(hit({ rumble: 0, tex: 0, ...one, ...two, bmod: 90 }, 0.2).body, body(one), 'a kick with no number of body markers does not have one marker');
  assert.deepStrictEqual(shot({ ...one, ...two, bmod: 90 }).click, shot(one).click, 'the body\'s MOD LEVEL moves the click');
  assert.deepStrictEqual(shot({ tune2: 100, cpts: 0, cmod: 90 }).body, shot({}).body, 'the click\'s MOD LEVEL moves the body');
  const hz = (values) => { const core = makeCore(RATE); core.message({ set: { sweep1: 0, sweep2: 0, bpts: 0, ...values } }); core.message({ hit: 1 }); core.tick(); return core.hz; };
  assert.ok(Math.abs(hz({ pitch1: 12, pitch2: 36, bmod: 60 }) - 65.406) < 0.01, 'PITCH between C1 and C3 is not C2');
}

console.log('engine: all tests pass');
