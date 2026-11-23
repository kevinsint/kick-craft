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
  const shot = { all: new Float32Array(count), body: new Float32Array(count), click: new Float32Array(count), rumble: new Float32Array(count) };
  core.message({ set: values }); core.message({ hit: 1 });
  for (let i = 0; i < count; i++) { core.tick(); for (const name in shot) shot[name][i] = core[name]; }
  return shot;
}
const peak = (wave) => wave.reduce((top, v) => Math.max(top, Math.abs(v)), 0);
const allFinite = (wave) => wave.every(Number.isFinite);

/* every click mode and drive type, at both ends of the knobs, through the output filter: no bad value, no overload */
for (const mode of [0, 1, 2]) for (const type of [0, 1, 2]) for (const end of [0, 127]) {
  const out = new Float32Array(48000), kick = makeKickEngine(48000);
  kick.message({ set: { mode, type, attack: end, cattack: end, rattack: end, drive: end, rphase: end, sweep: end, bend: end, pitch: end ? 60 : 0, delay: end, dfbk: end, llevel: end, ldark: end, bpm: 200 }, run: true, drone: true });
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
assert.deepStrictEqual(hit({ curve: 20 }, 0.25).click, hit({ curve: 96 }, 0.25).click, 'the click changed with the body\'s PITCH CURVE');

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

console.log('engine: all tests pass');
