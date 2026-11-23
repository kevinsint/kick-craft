# Kick Craft

A kick drum to shape in the browser. It has three layers, and each one has its own level and its own attack:

- **Body**: a sine with a pitch sweep, a decay and a drive (fold, clip or crush).
- **Click**: a second, short oscillator with its own note, sweep and pitch curve, and a burst of noise. It plays beside the body, or bends it (FM), or multiplies it (ring).
- **Rumble**: the kick through a delay and a small dark reverb, with an LFO on its level and its low-pass. Its length, its delay and its LFO are parts of a bar at the tempo.

The picture is the engine's own output for one hit, and a playhead shows where the sound is. A small step pattern plays the kick, and a drone lets you hear the ducking.

It is the draft of the kick drum of BOURDON (before: DR1), a drone firmware for the FM-1. The text below the instrument says how the kick is built and where its controls go on the FM-1.

## Use it

Open `index.html` in a browser. It is one file, with no build step and no dependency. The fonts come from Google Fonts; without them the page uses the system's fonts.

For the most exact timing, serve the folder, so the browser runs the engine in its audio thread:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`. From a file, the engine runs in the page's own thread: the sound is the same, the timing is less exact. The line below the picture says which one runs.

The presets you save stay in your browser.

## Test it

```sh
node tests/engine.test.js
```

The test runs the sound engine of `index.html` in node, with no browser.

## Licence

Kick Craft is under the GNU General Public License, version 3 only (GPL-3.0-only): see [LICENSE](LICENSE).

The kick takes its controls from the manuals of the Shakmat Battering Ram and the Ohmforce Bohm. It has no code from them; the wave, the curves and the ranges are estimates.
