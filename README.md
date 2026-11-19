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
  Stage objects (musicians with their instruments, risers, monitors, truss) make the 3D view easier to read;
  they are scenery only. The selection moves with handles or keys: arrows on the floor (following the camera),
  Alt+Up/Down for height, Q/E to turn, Shift for big steps, G/R for move/rotate handles, Delete, Cmd/Ctrl+D.
- **Looks**: a look is one or more layers; each layer puts an effect on some fixtures.
  A MIDI note plays a look ("Learn from MIDI" assigns it). The list can be searched (name or note, Cmd/Ctrl+F)
  and sorted into folders by drag and drop.
  The Image effect lays a picture over the fixtures and can move, spin and zoom it.
- **Effects**: build your own effects. Draw a curve and let it drive brightness or colour (through a gradient),
  over time or along the pixels, in seconds or in beats of the MIDI clock. Own effects appear next to the built-in
  ones in every layer.
- **Chasers**: run looks one after the other in tempo (beats and bpm), started by a MIDI note. A chaser can follow
  the MIDI clock of the DAW instead of a fixed tempo; switch on sending clock for the HeavyLight output there.
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
