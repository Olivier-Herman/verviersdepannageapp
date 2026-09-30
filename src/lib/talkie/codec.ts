// src/lib/talkie/codec.ts — audio du talkie (côté navigateur) : 16 kHz mono, loi µ
// (G.711) pour la voix en direct, WAV 16 bits pour l'enregistrement. Olivier 30/09/2026.

export const RATE = 16000
export const MAX_TALK_MS = 60_000

// ── Loi µ (G.711) ─────────────────────────────────────────────────────────────
export function muEncode(f32: Float32Array): Uint8Array {
  const out = new Uint8Array(f32.length)
  for (let i = 0; i < f32.length; i++) {
    let s = Math.max(-1, Math.min(1, f32[i])) * 32767
    const sign = s < 0 ? 0x80 : 0
    if (s < 0) s = -s
    s = Math.min(32635, s + 132)
    let exp = 7
    for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1) { /* cherche l'exposant */ }
    const mant = (s >> (exp + 3)) & 0x0f
    out[i] = ~(sign | (exp << 4) | mant) & 0xff
  }
  return out
}
export function muDecode(u8: Uint8Array): Float32Array {
  const out = new Float32Array(u8.length)
  for (let i = 0; i < u8.length; i++) {
    const u = ~u8[i] & 0xff
    const sign = u & 0x80, exp = (u >> 4) & 0x07, mant = u & 0x0f
    let s = ((mant << 3) + 132) << exp
    s -= 132
    out[i] = (sign ? -s : s) / 32768
  }
  return out
}
export function downsample(input: Float32Array, inRate: number): Float32Array {
  const ratio = inRate / RATE
  const len = Math.floor(input.length / ratio)
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const start = Math.floor(i * ratio), end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0; for (let j = start; j < end; j++) sum += input[j]
    out[i] = sum / Math.max(1, end - start)
  }
  return out
}
export const toB64 = (u8: Uint8Array) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s) }
export const fromB64 = (b: string) => { const s = atob(b); const u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); return u8 }
export function wav(chunks: Float32Array[]): Blob {
  const n = chunks.reduce((a, c) => a + c.length, 0)
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true)
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true)
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true)
  let o = 44
  for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, c[i])) * 32767, true)
  return new Blob([buf], { type: 'audio/wav' })
}

