# HeavyLight

Lighting control with a modern interface: MIDI notes in (for example from Reaper), Art-Net out,
with a 3D stage that shows what the rig is doing. Runs on macOS, Windows and Linux (Electron).

Status: proof of concept.

## Run

```
npm install
npm run dev        # start with hot reload
npm run build && npm start
npm test           # engine, Art-Net, fixture and effect tests
npm run typecheck
```

On macOS start it from a terminal app that has the "Local Network" permission, otherwise
unicast Art-Net is blocked by the system.

## How it works

- **Stage**: add fixtures (RGB pixel strips and matrices, or any Open Fixture Library JSON),
  set IP, universe and start address, and place them in 3D.
- **Looks**: a look is one or more layers; each layer puts an effect on some fixtures.
  A MIDI note plays a look ("Learn from MIDI" assigns it).
  The Image effect lays a picture over the fixtures and can move, spin and zoom it.
- **Chasers**: run looks one after the other in tempo (beats and bpm), started by a MIDI note.
- **Live**: pads for every look, master, blackout, MIDI monitor and timing measurements.

On macOS and Linux the app opens a virtual MIDI port named `HeavyLight`; pick it as MIDI output
in the DAW. On Windows use a loopback port such as loopMIDI.

## Layout

| Path | Purpose |
| --- | --- |
| `src/shared` | Show model, OFL fixture resolver, effects, patch (used by engine and UI) |
| `src/engine` | Real-time core in its own process: MIDI in, rendering, Art-Net out |
| `src/main`, `src/preload` | Electron window, files, message relay |
| `src/renderer` | React UI and three.js stage |

Fixture definitions use the [Open Fixture Library](https://open-fixture-library.org) format (MIT).

## Licence

GPL-3.0, see `LICENSE`. Bundled fixture definitions come from the Open Fixture Library (MIT),
see `src/shared/library/README.md`.
