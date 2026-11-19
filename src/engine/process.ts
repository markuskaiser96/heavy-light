/**
 * Entry point of the engine process (an Electron utility process).
 * Only glue: messages in → Engine, Engine → messages out.
 */
import type { ToEngine } from '@shared/types'
import { Engine } from './engine'
import { MidiInputs } from './midi'

const parent = process.parentPort

const engine = new Engine({ emit: (message) => parent.postMessage(message) })
const midi = new MidiInputs(
  (event) => engine.handleMidi(event),
  (port, kind, time) => engine.handleClock(port, kind, time)
)

engine.midiPorts = () => midi.ports
try {
  midi.start()
  engine.virtualPort = midi.virtualPort
} catch (err) {
  console.error('MIDI unavailable:', err)
}
// Development aid: start with Art-Net output switched off.
if (process.env.HEAVYLIGHT_NO_OUTPUT) engine.handle({ type: 'output', on: false })
engine.start()

parent.on('message', (e: { data: ToEngine }) => engine.handle(e.data))
