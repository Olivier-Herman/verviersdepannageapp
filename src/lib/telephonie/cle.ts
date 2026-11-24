// Clé des adresses appelées par Microsoft (?k=TELEPHONIE_WEBHOOK_SECRET), comparée à temps constant.
import type { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'

export function cleValide(req: NextRequest): boolean {
  const s = process.env.TELEPHONIE_WEBHOOK_SECRET || ''
  const k = req.nextUrl.searchParams.get('k') || ''
  if (!s || k.length !== s.length) return false
  return timingSafeEqual(Buffer.from(k), Buffer.from(s))
}
