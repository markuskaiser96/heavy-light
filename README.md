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
- **Scenes**: a scene is one or more layers; each layer puts an effect on some fixtures.
  A MIDI note plays a scene ("Learn from MIDI" assigns it). The list can be searched (name or note, Cmd/Ctrl+F)
  and sorted into folders by drag and drop.
  The lists of fixtures, effects and chasers have the same search field and folders.
- **Tempo**: lengths that follow the beat are chosen as note values (1/4, 1/8T, 1 bar …, counted in 4/4) or typed in
  beats. A chaser has a speed factor (×¼ to ×4). A curve of a custom effect can run once per MIDI note instead of looping.
- **Random**: a curve over position can jump to a random place on every pass, and a layer can play on randomly drawn
  fixtures instead of all its targets. Both follow the beat, so preview and output always agree.
- **MIDI tab**: all scenes and chasers in one table with their notes; play them, see what is active, learn or type
  notes in place (applies right away).
- **Saving edits**: what you change in an editor (a fixture or stage object, a scene, an effect, a chaser) is a
  draft. The 3D stage and the preview show it, but MIDI, the Live view and the show file keep the saved state
  until you press "Save" at the bottom of the editor (Cmd/Ctrl+Enter); "Discard" goes back. Entries with
  unsaved changes carry a dot in their list. Adding, duplicating, deleting, sorting and show settings apply right away.
  The Image effect lays a picture over the fixtures and can move, spin and zoom it.
- **Effects**: build your own effects. Draw a curve and let it drive brightness or colour (through a gradient),
  over time or along the pixels, in seconds or in beats of the MIDI clock. Own effects appear next to the built-in
  ones in every layer.
- **Chasers**: run scenes one after the other in tempo (beats and bpm), started by a MIDI note. A chaser can follow
  the MIDI clock of the DAW instead of a fixed tempo; switch on sending clock for the HeavyLight output there.
- **Live**: pads for every scene, master, blackout, MIDI monitor and timing measurements.

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
