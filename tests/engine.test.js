/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2026 Kevin Sint */
/* The sound engine of index.html, run in node with no browser: node tests/engine.test.js */
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const engine = page.match(/<script>\n\/\* SPDX[\s\S]*?<\/script>/)[0].replace(/<\/?script>/g, '');
const { makeCore, makeKickEngine, kickShare } = new Function(engine + '; return { makeCore, makeKickEngine, kickShare };')();
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
  kick.message({ set: { mode1: mode, type1: type, attack1: end, cattack1: end, cattack2: 127 - end, noise2: end, ccurve2: end, rattack1: end, drive1: end, rphase1: end, sweep1: end, sweep2: 127 - end, depth2: end, curve2: end, bmod: end ? 120 : 50, bpts: end ? 3 : 0, bend1: end, bend2: 127 - end, snap2: end, tune2: end, cmod: end ? 120 : 50, cpts: end ? 3 : 0, pitch1: end ? 60 : 0, pitch2: end ? 0 : 60, delay1: end, dfbk1: end, llevel1: end, ldark1: end, lper1: end ? 13 : 0, lphase1: end, tex1: 127, tattack1: end, tdecay1: end, tcurve1: end, topen1: end, tnoise1: end, trev1: end, tsize1: end, tlow1: end, thigh1: end, bpm: 200 }, run: true });
  kick.process(out);
  assert.ok(allFinite(out), `mode ${mode}, type ${type}, knobs at ${end}: a value is not a number`);
  assert.ok(peak(out) <= 1, `mode ${mode}, type ${type}, knobs at ${end}: the output is above full level`);
}

/* the three levels do not move each other */
{
  const full = hit({}, 1), noBody = hit({ level1: 0 }, 1), noClick = hit({ click1: 0 }, 1), noRumble = hit({ rumble1: 0 }, 1);
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
  const plain = hit({ attack1: 0, hpf1: 0, click1: 0, rumble1: 0 }, 0.5).body, cut = hit({ attack1: 90, hpf1: 0, click1: 0, rumble1: 0 }, 0.5).body;
  for (let i = from; i < plain.length; i++) assert.strictEqual(cut[i], plain[i], `the wave differs after the attack, at sample ${i}`);
  assert.ok(Math.abs(cut[Math.floor(from / 4)]) < 0.05, 'the body is low in the first quarter of the attack');
}

/* the body's pitch curve does not move the click */
assert.deepStrictEqual(hit({ curve1: 20 }, 0.25).click, hit({ curve1: 96 }, 0.25).click, 'the click changed with the body\'s PITCH CURVE');

/* the rumble ends on the clock: LENGTH is a part of a bar at the tempo, and it only closes the gate (SIZE at its top, so the tail is longer than each LENGTH) */
for (const [rlen, bpm, bars] of [[1, 120, 1 / 8], [2, 120, 1 / 4], [3, 120, 1 / 2], [2, 90, 1 / 4]]) {
  const seconds = bars * 240 / bpm, rumble = hit({ rlen1: rlen, bpm, rattack1: 0, size1: 127 }, seconds * 1.6 + 0.3).rumble, top = peak(rumble);
  let last = 0;
  rumble.forEach((v, i) => { if (Math.abs(v) > top / 1000) last = i; });
  assert.ok(last / RATE <= seconds * 1.02, `LENGTH ${bars} at ${bpm} BPM: the rumble goes on after ${seconds} s`);
  assert.ok(last / RATE >= seconds * 0.85, `LENGTH ${bars} at ${bpm} BPM: the rumble stops long before ${seconds} s`);
}

/* the TEMPO does not change the sound of a hit: the body and the click are the same, and the rumble is the same until its gate starts to close */
{
  const slow = hit({ bpm: 90, rlen1: 3 }, 0.6), fast = hit({ bpm: 180, rlen1: 3 }, 0.6), same = Math.floor(0.7 * (1 / 2 * 240 / 180) * RATE) - 1;
  assert.deepStrictEqual(fast.body, slow.body, 'the body changed with the TEMPO');
  assert.deepStrictEqual(fast.click, slow.click, 'the click changed with the TEMPO');
  assert.ok(peak(slow.rumble.subarray(0, same)) > 0.01, 'the rumble is silent');
  assert.deepStrictEqual(fast.rumble.subarray(0, same), slow.rumble.subarray(0, same), 'the rumble changed with the TEMPO before its gate closes');
}

/* SIZE is the reverb's own time, not on the clock: a larger SIZE leaves more of the tail at the same LENGTH and TEMPO */
{
  const level = (wave) => Math.sqrt(wave.subarray(Math.floor(0.8 * RATE), Math.floor(1.2 * RATE)).reduce((sum, v) => sum + v * v, 0));
  const small = hit({ size1: 20, rlen1: 4, rattack1: 0 }, 1.3).rumble, large = hit({ size1: 120, rlen1: 4, rattack1: 0 }, 1.3).rumble;
  assert.ok(level(large) > 10 * level(small), 'SIZE does not change the length of the reverb\'s tail');
}

/* the texture is the body's second output: its LEVEL moves no other layer, and the body's LEVEL does not move it */
{
  const full = hit({}, 1), noTexture = hit({ tex1: 0 }, 1), noBody = hit({ level1: 0 }, 1);
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
  const dry = { trev1: 0, decay1: 127 };      /* a long body, so the gate ends the texture and not the body */
  const short = hit({ ...dry, tdecay1: 20 }, 2).texture, long = hit({ ...dry, tdecay1: 110 }, 2).texture;
  assert.ok(end(short) < 0.1, 'a short DECAY does not close the gate');
  assert.ok(end(long) > 3 * end(short), 'DECAY does not change the length of the texture');
  const late = hit({ ...dry, tattack1: 127 }, 0.3).texture, atOnce = hit({ ...dry, tattack1: 0 }, 0.3).texture;
  assert.ok(peak(late.subarray(0, Math.floor(0.01 * RATE))) < 0.2 * peak(atOnce.subarray(0, Math.floor(0.01 * RATE))), 'ATTACK does not cut the start of the texture');
  assert.ok(bright(hit({ ...dry, topen1: 127 }, 0.3).texture) > 10 * bright(hit({ ...dry, topen1: 0 }, 0.3).texture), 'OPEN does not change the brightness');
  assert.ok(bright(hit({ ...dry, tnoise1: 127 }, 0.3).texture) > 10 * bright(hit({ ...dry, tnoise1: 0 }, 0.3).texture), 'NOISE adds no noise');
}

/* the gate's DCY CURVE: at 0 the gate falls fast at the start, at 127 it stays open and falls at the end; at each curve the texture is closed after DECAY */
{
  const dry = { trev1: 0, decay1: 127, tdecay1: 80, tnoise1: 127 }, seconds = 0.02 * Math.pow(2, 80 / 127 * 6.64);
  const level = (wave, from, to) => Math.sqrt(wave.subarray(Math.floor(from * seconds * RATE), Math.floor(to * seconds * RATE)).reduce((sum, v) => sum + v * v, 0));
  const fast = hit({ ...dry, tcurve1: 0 }, seconds * 1.5).texture, line = hit({ ...dry, tcurve1: 42 }, seconds * 1.5).texture, held = hit({ ...dry, tcurve1: 127 }, seconds * 1.5).texture;
  assert.ok(level(line, 0.5, 0.8) > 3 * level(fast, 0.5, 0.8), 'DCY CURVE at 42 is not slower than at 0');
  assert.ok(level(held, 0.5, 0.8) > 1.5 * level(line, 0.5, 0.8), 'DCY CURVE at 127 does not keep the gate open');
  for (const wave of [fast, line, held]) assert.ok(level(wave, 1.1, 1.5) < 0.001 * level(wave, 0, 1), 'the texture goes on after DECAY');
}

/* the texture's reverb1: REVERB at 0 leaves no tail after the gate, and SIZE is the length of the tail */
{
  const tail = (wave) => Math.sqrt(wave.subarray(Math.floor(0.6 * RATE), Math.floor(0.9 * RATE)).reduce((sum, v) => sum + v * v, 0));
  const gate = { tdecay1: 20, decay1: 20 };
  assert.ok(tail(hit({ ...gate, trev1: 0 }, 1).texture) < 1e-6, 'the texture goes on with REVERB at 0');
  assert.ok(tail(hit({ ...gate, trev1: 127, tsize1: 127 }, 1).texture) > 100 * tail(hit({ ...gate, trev1: 127, tsize1: 20 }, 1).texture), 'SIZE does not change the length of the tail');
}

/* the two filters at the texture's end, after its reverb1: LOW CUT takes the lows out, HIGH CUT takes the highs out, and at their ends they are off */
{
  const size = (wave) => Math.sqrt(wave.reduce((sum, v) => sum + v * v, 0));
  const moves = (wave) => { let total = 0; for (let i = 1; i < wave.length; i++) total += (wave[i] - wave[i - 1]) ** 2; return Math.sqrt(total); };
  const lows = { tnoise1: 0, drive1: 0, topen1: 127 }, highs = { tnoise1: 127, topen1: 127, level1: 0 };      /* a texture of the body's sine only; a texture with much noise */
  assert.ok(size(hit({ ...lows, tlow1: 127 }, 0.5).texture) < 0.05 * size(hit({ ...lows, tlow1: 0 }, 0.5).texture), 'LOW CUT leaves the lows');
  assert.ok(moves(hit({ ...highs, thigh1: 0 }, 0.5).texture) < 0.05 * moves(hit({ ...highs, thigh1: 127 }, 0.5).texture), 'HIGH CUT leaves the highs');
  assert.ok(moves(hit({ ...highs, tlow1: 127 }, 0.5).texture) > 0.5 * moves(hit({ ...highs, tlow1: 0 }, 0.5).texture), 'LOW CUT takes the highs out too');
  assert.ok(size(hit({ ...lows, thigh1: 0 }, 0.5).texture) > 0.5 * size(hit({ ...lows, thigh1: 127 }, 0.5).texture), 'HIGH CUT takes the lows out too');
}

/* the rumble's LFO: LFO PER BAR is the number of its cycles in a bar at the tempo, and LFO PHASE is where in its cycle it starts */
{
  const ups = (wave) => { let count = 0; for (let i = 1; i < wave.length; i++) if (wave[i - 1] < 0 && wave[i] >= 0) count++; return count; };
  const almostBar = 0.99 * 240 / 100;
  for (const [lper, cycles] of [[2, 1], [4, 3], [5, 4], [9, 8]]) assert.strictEqual(ups(hit({ bpm: 100, lper1: lper }, almostBar).lfo), cycles - 1, `LFO PER BAR ${cycles}: not ${cycles} cycles in a bar`);
  const from0 = hit({ lper1: 3 }, 0.5).lfo, from180 = hit({ lper1: 3, lphase1: 64 }, 0.5).lfo, from90 = hit({ lper1: 3, lphase1: 32 }, 0.01).lfo;
  for (let i = 0; i < from0.length; i += 997) assert.ok(Math.abs(from0[i] + from180[i]) < 1e-6, 'LFO PHASE at 180 degrees is not the wave upside down');
  assert.ok(from90[100] > 0.99, 'LFO PHASE at 90 degrees does not start at the top');
}

/* the click's MOD LEVEL morphs SNAP, TUNE and SWEEP between 2 to 5 markers: a marker's place gives that marker, and between two markers the knobs' values are mixed */
{
  const click = (values) => hit({ rumble1: 0, tex1: 0, cpts: 0, ...values }, 0.2).click;      /* 2 markers, when the test does not give another number */
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
  const shot = (values) => hit({ rumble1: 0, tex1: 0, bpts: 0, ...values }, 0.2), body = (values) => shot(values).body;      /* 2 markers, when the test does not give another number */
  const one = { pitch1: 12, depth1: 20, sweep1: 30, curve1: 10 }, two = { pitch2: 36, depth2: 100, sweep2: 90, curve2: 120 }, three = { pitch3: 5, depth3: 127, sweep3: 0, curve3: 60 };
  const as1 = (marker, n) => Object.fromEntries(Object.entries(marker).map(([name, v]) => [name.replace(String(n), '1'), v]));      /* a marker's values, put at marker 1 */
  assert.notDeepStrictEqual(body(one), body(as1(two, 2)), 'the body\'s markers do not change the body');
  assert.deepStrictEqual(body({ ...one, ...two, bmod: 0 }), body(one), 'the body\'s MOD LEVEL at 0 is not marker 1');
  assert.deepStrictEqual(body({ ...one, ...two, bmod: 120 }), body(as1(two, 2)), 'the body\'s MOD LEVEL at its top is not the last of 2 markers');
  assert.deepStrictEqual(body({ ...one, ...two, ...three, bpts: 1, bmod: 60 }), body(as1(two, 2)), 'the body\'s MOD LEVEL at the middle is not marker 2 of 3');
  assert.deepStrictEqual(body({ ...one, ...two, ...three, bpts: 1, bmod: 120 }), body(as1(three, 3)), 'the body\'s MOD LEVEL at its top is not the last of 3 markers');
  assert.deepStrictEqual(body({ ...one, ...two, bmod: 60 }), body({ pitch1: 24, depth1: 60, sweep1: 60, curve1: 65 }), 'the body\'s MOD LEVEL between two markers does not mix their values');
  assert.deepStrictEqual(body({ ...one, ...two, bpts: -1, bmod: 90 }), body(one), 'with one marker the body is not marker 1 at each MOD LEVEL');
  assert.deepStrictEqual(hit({ rumble1: 0, tex1: 0, ...one, ...two, bmod: 90 }, 0.2).body, body(one), 'a kick with no number of body markers does not have one marker');
  assert.deepStrictEqual(shot({ ...one, ...two, bmod: 90 }).click, shot(one).click, 'the body\'s MOD LEVEL moves the click');
  assert.deepStrictEqual(shot({ tune2: 100, cpts: 0, cmod: 90 }).body, shot({}).body, 'the click\'s MOD LEVEL moves the body');
  const hz = (values) => { const core = makeCore(RATE); core.message({ set: { sweep1: 0, sweep2: 0, bpts: 0, ...values } }); core.message({ hit: 1 }); core.tick(); return core.hz; };
  assert.ok(Math.abs(hz({ pitch1: 12, pitch2: 36, bmod: 60 }) - 65.406) < 0.01, 'PITCH between C1 and C3 is not C2');
}

/* the texture's MOD LEVEL morphs all its knobs but LEVEL between 2 to 5 markers, and the rumble's does the same; no MOD LEVEL moves another layer */
{
  const shot = (values) => hit({ tpts: 0, rpts: 0, ...values }, 0.3);      /* 2 markers, when the test does not give another number */
  const as1 = (marker, n) => Object.fromEntries(Object.entries(marker).map(([name, v]) => [name.replace(new RegExp(n + '$'), '1'), v]));      /* a marker's values, put at marker 1 */
  const sets = {
    texture: { g: 't', one: { tattack1: 0, tdecay1: 30, tcurve1: 0, topen1: 40, tnoise1: 20, trev1: 0, tsize1: 30, tlow1: 0, thigh1: 127 },
      two: { tattack2: 60, tdecay2: 100, tcurve2: 80, topen2: 120, tnoise2: 100, trev2: 100, tsize2: 90, tlow2: 40, thigh2: 87 },
      mix: { tattack1: 30, tdecay1: 65, tcurve1: 40, topen1: 80, tnoise1: 60, trev1: 50, tsize1: 60, tlow1: 20, thigh1: 107 } },
    rumble: { g: 'r', one: { rattack1: 20, dark1: 30, grit1: 10, rphase1: 0, reverb1: 127, size1: 30, rlen1: 2, delay1: 0, ddiv1: 3, dfbk1: 20, lper1: 3, lphase1: 0, lshape1: 0, llevel1: 0, ldark1: 0 },
      two: { rattack2: 60, dark2: 90, grit2: 110, rphase2: 64, reverb2: 67, size2: 90, rlen2: 4, delay2: 100, ddiv2: 7, dfbk2: 80, lper2: 7, lphase2: 64, lshape2: 2, llevel2: 100, ldark2: 60 },
      mix: { rattack1: 40, dark1: 60, grit1: 60, rphase1: 32, reverb1: 97, size1: 60, rlen1: 3, delay1: 50, ddiv1: 5, dfbk1: 50, lper1: 5, lphase1: 32, lshape1: 1, llevel1: 50, ldark1: 30 } }
  };
  for (const layer in sets) {
    const { g, one, two, mix } = sets[layer], three = Object.fromEntries(Object.entries(one).map(([name, v]) => [name.replace(/1$/, '3'), v])), wave = (values) => shot(values)[layer], mod = g + 'mod', pts = g + 'pts';
    assert.notDeepStrictEqual(wave(one), wave(as1(two, 2)), `the ${layer}'s markers do not change the ${layer}`);
    assert.deepStrictEqual(wave({ ...one, ...two, [mod]: 0 }), wave(one), `the ${layer}'s MOD LEVEL at 0 is not marker 1`);
    assert.deepStrictEqual(wave({ ...one, ...two, [mod]: 120 }), wave(as1(two, 2)), `the ${layer}'s MOD LEVEL at its top is not the last of 2 markers`);
    assert.deepStrictEqual(wave({ ...one, ...two, ...three, [pts]: 1, [mod]: 60 }), wave(as1(two, 2)), `the ${layer}'s MOD LEVEL at the middle is not marker 2 of 3`);
    assert.deepStrictEqual(wave({ ...one, ...two, [mod]: 60 }), wave(mix), `the ${layer}'s MOD LEVEL between two markers does not mix their values`);
    assert.deepStrictEqual(wave({ ...one, ...two, [pts]: -1, [mod]: 90 }), wave(one), `with one marker the ${layer} is not marker 1 at each MOD LEVEL`);
    assert.deepStrictEqual(hit({ ...one, ...two, [mod]: 90 }, 0.3)[layer], hit(one, 0.3)[layer], `a kick with no number of ${layer} markers does not have one marker`);
    for (const other of ['body', 'click', 'texture', 'rumble']) if (other !== layer)
      assert.deepStrictEqual(shot({ ...one, ...two, [mod]: 90 })[other], shot(one)[other], `the ${layer}'s MOD LEVEL moves the ${other}`);
  }
  /* a knob with a list of values (LENGTH, DLY TIME, LFO PER BAR, LFO SHAPE) goes to the nearest value of the list between two markers */
  assert.deepStrictEqual(shot({ rlen1: 1, rlen2: 4, rmod: 50 }).rumble, shot({ rlen1: 2 }).rumble, 'LENGTH between two markers is not the nearest length');
}

/* every knob of a layer is in its markers: the LEVEL and the knobs with a list of values too */
{
  const shot = (values) => hit({ bpts: 0, cpts: 0, tpts: 0, rpts: 0, ...values }, 0.3);
  assert.deepStrictEqual(shot({ level1: 20, level2: 100, bmod: 60 }).body, shot({ level1: 60 }).body, 'the body\'s LEVEL is not mixed between two markers');
  assert.deepStrictEqual(shot({ decay1: 20, decay2: 100, drive1: 0, drive2: 100, attack1: 0, attack2: 60, bmod: 120 }).body, shot({ decay1: 100, drive1: 100, attack1: 60 }).body, 'the body\'s DECAY, DRIVE and ATTACK are not in its markers');
  assert.deepStrictEqual(shot({ type1: 0, type2: 2, bmod: 50 }).body, shot({ type1: 1 }).body, 'DRIVE TYPE between two markers is not the nearest type');
  assert.deepStrictEqual(shot({ click1: 20, click2: 100, cmod: 60 }).click, shot({ click1: 60 }).click, 'the click\'s LEVEL is not mixed between two markers');
  assert.deepStrictEqual(shot({ mode1: 0, mode2: 2, tone1: 20, tone2: 100, cmod: 120 }).all, shot({ mode1: 2, tone1: 100 }).all, 'CLICK MODE and TONE are not in the click\'s markers');
  assert.deepStrictEqual(shot({ tex1: 20, tex2: 100, tmod: 60 }).texture, shot({ tex1: 60 }).texture, 'the texture\'s LEVEL is not mixed between two markers');
  assert.deepStrictEqual(shot({ rumble1: 20, rumble2: 100, rmod: 60 }).rumble, shot({ rumble1: 60 }).rumble, 'the rumble\'s LEVEL is not mixed between two markers');
}

/* VOLUME, one for each layer, is the last thing before the mix: at 0 the layer is silent, no other layer moves, and it is not the layer's LEVEL */
{
  const full = hit({}, 0.5), layers = { body: 'bvol', texture: 'tvol', click: 'cvol', rumble: 'rvol' };
  for (const layer in layers) {
    const none = hit({ [layers[layer]]: 0 }, 0.5), half = hit({ [layers[layer]]: 64 }, 0.5);
    assert.strictEqual(peak(none[layer]), 0, `the ${layer} is not silent at VOLUME 0`);
    assert.ok(peak(half[layer]) > 0.2 * peak(full[layer]) && peak(half[layer]) < peak(full[layer]), `the ${layer}'s VOLUME at the middle is not between silence and full`);
    for (const other in layers) if (other !== layer) assert.deepStrictEqual(none[other], full[other], `the ${layer}'s VOLUME moves the ${other}`);
    assert.notDeepStrictEqual(none.all, full.all, `the ${layer}'s VOLUME does not change the mix`);
  }
  assert.deepStrictEqual(hit({ bvol: 127, tvol: 127, cvol: 127, rvol: 127 }, 0.5).all, full.all, 'a kick with no VOLUME is not at full volume');
  assert.deepStrictEqual(hit({ mode1: 1, cvol: 0 }, 0.5).body, hit({ mode1: 1 }, 0.5).body, 'in FM the click\'s VOLUME changes how much the click bends the body');
}

/* the sequencer: each step that is on in `pat` (step 1 is its lowest bit) hits the kick, over STEPS steps, and DIVISION is the number of steps in a bar */
{
  const played = (values, seconds) => {      /* the steps that hit, in order */
    const core = makeCore(RATE), steps = []; let hits = 0;
    core.message({ set: { rumble1: 0, tex1: 0, bpm: 120, ...values }, run: true });
    for (let i = 0; i < RATE * seconds; i++) { core.tick(); if (core.hits !== hits) { hits = core.hits; steps.push(core.step); } }
    return steps;
  };
  assert.deepStrictEqual(played({}, 1.99), [0, 4, 8, 12], 'a new kick does not play 4 hits in a bar');
  assert.strictEqual(played({ pat: 0xffff, div: 0 }, 0.99).length, 2, 'DIVISION 1/4: not 4 steps in a bar');
  assert.strictEqual(played({ pat: 0xffff, div: 3 }, 0.99).length, 8, 'DIVISION 1/16: not 16 steps in a bar');
  assert.strictEqual(played({ pat: 0xffff, div: 4 }, 0.99).length, 12, 'DIVISION 1/16T: not 24 steps in a bar');
  assert.strictEqual(played({ pat: 0xffff, div: 5 }, 0.99).length, 16, 'DIVISION 1/32: not 32 steps in a bar');
  const burst = [0, 1, 2, 7, 8, 9, 12, 13].reduce((bits, step) => bits + 2 ** step, 0);      /* ...____...__.. */
  assert.deepStrictEqual(played({ pat: burst, steps: 14, div: 5 }, 14 * 0.0625 - 0.01), [0, 1, 2, 7, 8, 9, 12, 13], 'the bursts of the pattern do not play as they are drawn');
  assert.deepStrictEqual(played({ pat: burst, steps: 8, div: 5 }, 16 * 0.0625 - 0.01), [0, 1, 2, 7, 0, 1, 2, 7], 'STEPS does not set the length of the pattern');
  assert.deepStrictEqual(played({ pat: 2 ** 31, steps: 32, div: 5 }, 1.99), [31], 'step 32 does not play');
}

/* SOLO: the output is the parts that are solo, mixed as in the kick; one part alone is that part's own wave, and no solo or all four is the whole kick */
{
  const out = (solo) => {
    const core = makeCore(RATE), count = Math.floor(RATE * 0.3), shot = { out: new Float32Array(count), all: new Float32Array(count), body: new Float32Array(count), click: new Float32Array(count), texture: new Float32Array(count), rumble: new Float32Array(count) };
    core.message({ set: { tex1: 64, rumble1: 64 } }); if (solo) core.message({ solo }); core.message({ hit: 1 });
    for (let i = 0; i < count; i++) { core.tick(); for (const name in shot) shot[name][i] = core[name]; }
    return shot;
  };
  const whole = out();
  for (const part of ['body', 'click', 'texture', 'rumble']) {
    assert.ok(peak(whole[part]) > 0.01, `the ${part} is silent in the test of SOLO`);
    assert.deepStrictEqual(out([part]).out, whole[part], `SOLO of the ${part} is not the ${part} alone`);
  }
  assert.deepStrictEqual(whole.out, whole.all, 'with no SOLO the output is not the whole kick');
  assert.deepStrictEqual(out('all').out, whole.all, 'SOLO "all" is not the whole kick');
  assert.deepStrictEqual(out([]).out, whole.all, 'SOLO of no part is not the whole kick');
  assert.deepStrictEqual(out(['body', 'click', 'texture', 'rumble']).out, whole.all, 'SOLO of the four parts is not the whole kick');
  const two = out(['click', 'rumble']).out;
  assert.notDeepStrictEqual(two, whole.click, 'SOLO of the click and the rumble is the click alone');
  assert.notDeepStrictEqual(two, whole.rumble, 'SOLO of the click and the rumble is the rumble alone');
  assert.ok(two.every((v, i) => Math.abs(v - whole.click[i] - whole.rumble[i]) < 1e-6), 'SOLO of the click and the rumble is not their sum');
  assert.notDeepStrictEqual(out(['body', 'texture']).out, whole.all, 'SOLO of the body and the texture is the whole kick');
}

/* Share: the link holds the kick as it plays now, one value for each knob at its MOD LEVEL, with no marker; and only numbers come back from a link */
{
  const share = kickShare(), groups = { b: ['level', 'pitch'], c: ['click', 'mode'] };
  const values = { bpm: 128, bvol: 100, pat: 2 ** 31, bpts: 1, bmod: 30, level: 5, level1: 0, level2: 100, level3: 50, pitch: 9, pitch1: 24, pitch2: 30, pitch3: 36, cpts: -1, cmod: 0, click: 1, click1: 71, click2: 9, mode: 0, mode1: 2, mode2: 0 };
  const flat = share.flat(values, groups);
  assert.deepStrictEqual(flat, { bpm: 128, bvol: 100, pat: 2 ** 31, level: 50, pitch: 27, click: 71, mode: 2 }, 'the shared kick is not the values at the MOD LEVEL, with no marker');
  assert.deepStrictEqual(share.unpack(share.pack(flat, 64)), { draft: 64, values: flat }, 'a link does not give back the kick it was made from');
  assert.match(share.pack(flat, 64), /^[A-Za-z0-9_-]+$/, 'a link has a character that a URL changes');
  const code = (thing) => Buffer.from(JSON.stringify(thing)).toString('base64url');
  for (const bad of ['', '%%%', code(5), code({ d: 64 }), code({ d: 64, v: [1] }), code({ d: 64, v: { level: '<b>' } }), code({ d: 64, v: { level: null } }), 'A'.repeat(9000)])
    assert.strictEqual(share.unpack(bad), null, 'a link that is not a kick is taken: ' + bad.slice(0, 20));
}

console.log('engine: all tests pass');
