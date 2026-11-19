import { Input } from '@julusian/midi'
import type { MidiEvent } from '@shared/types'

const VIRTUAL_PORT = 'HeavyLight'

/**
 * Listens on every MIDI input of the machine, plus (macOS/Linux) a virtual port named "HeavyLight"
 * that a DAW can send to directly. Windows has no virtual ports; use loopMIDI there.
 */
export class MidiInputs {
  private open: { name: string; input: Input }[] = []
  private names = ''
  private virtual: Input | null = null
  private timer: NodeJS.Timeout | null = null
  virtualPort: string | null = null

  constructor(
    private onEvent: (event: MidiEvent) => void,
    /** MIDI clock: 24 ticks per beat while the sender's transport runs, and a stop when it halts. */
    private onClock: (port: string, kind: 'tick' | 'stop', time: number) => void = () => {}
  ) {}

  get ports(): string[] {
    return this.open.map((p) => p.name)
  }

  start(): void {
    if (process.platform !== 'win32') {
      try {
        this.virtual = new Input()
        this.listen(this.virtual, VIRTUAL_PORT)
        this.virtual.openVirtualPort(VIRTUAL_PORT)
        this.virtualPort = VIRTUAL_PORT
      } catch {
        this.virtual = null
      }
    }
    this.scan()
    this.timer = setInterval(() => this.scan(), 2000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.closeAll()
    this.virtual?.destroy()
    this.virtual = null
  }

  private closeAll(): void {
    for (const p of this.open) {
      try {
        p.input.destroy()
      } catch {
        /* port already gone */
      }
    }
    this.open = []
  }

  /** Re-opens all ports whenever the set of connected devices changes. */
  private scan(): void {
    let names: string[]
    try {
      names = Input.getPortNames()
    } catch {
      return
    }
    const key = names.join('\n')
    if (key === this.names) return
    this.names = key
    this.closeAll()
    names.forEach((name, index) => {
      // Our own virtual port must not be opened a second time.
      if (name === VIRTUAL_PORT || name.endsWith(`:${VIRTUAL_PORT}`)) return
      try {
        const input = new Input()
        this.listen(input, name)
        input.openPort(index)
        this.open.push({ name, input })
      } catch {
        /* device busy or vanished between listing and opening */
      }
    })
  }

  private listen(input: Input, port: string): void {
    // Let MIDI clock through (the library drops it by default); system exclusive and active sensing stay out.
    input.ignoreTypes(true, false, true)
    input.on('message', (_delta, message) => {
      const time = performance.now()
      if (message[0] === 0xf8) return this.onClock(port, 'tick', time)
      if (message[0] === 0xfc) return this.onClock(port, 'stop', time)
      if (message[0] >= 0xf0) return
      const status = message[0] & 0xf0
      const channel = (message[0] & 0x0f) + 1
      const data1 = message[1] ?? 0
      const data2 = message[2] ?? 0
      if (status === 0x90 && data2 > 0) this.onEvent({ port, kind: 'noteon', channel, note: data1, velocity: data2, time })
      else if (status === 0x80 || status === 0x90) this.onEvent({ port, kind: 'noteoff', channel, note: data1, velocity: 0, time })
      else if (status === 0xb0) this.onEvent({ port, kind: 'cc', channel, note: data1, velocity: data2, time })
    })
  }
}
