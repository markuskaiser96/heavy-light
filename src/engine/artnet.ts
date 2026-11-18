/**
 * ArtDmx packet (Art-Net 4 specification, "ArtDmx" packet definition):
 *   0–7   ID "Art-Net\0"
 *   8–9   OpCode 0x5000, low byte first
 *   10–11 protocol version 14, high byte first
 *   12    sequence (1–255, 0 disables re-ordering on the receiver)
 *   13    physical input port (informational)
 *   14    SubUni – low 8 bits of the 15-bit port address
 *   15    Net    – high 7 bits of the port address
 *   16–17 data length, high byte first; even, 2–512
 *   18…   DMX data
 */
export const ARTNET_HEADER = 18

export function createArtDmx(universe: number): Buffer {
  const packet = Buffer.alloc(ARTNET_HEADER + 512)
  packet.write('Art-Net\0', 0, 'ascii')
  packet.writeUInt16LE(0x5000, 8)
  packet.writeUInt16BE(14, 10)
  packet[14] = universe & 0xff
  packet[15] = (universe >> 8) & 0x7f
  return packet
}

/** Sets sequence and length in place and returns the number of bytes to send. */
export function finishArtDmx(packet: Buffer, sequence: number, channels: number): number {
  const length = Math.min(512, Math.max(2, channels + (channels & 1)))
  packet[12] = sequence
  packet.writeUInt16BE(length, 16)
  return ARTNET_HEADER + length
}
