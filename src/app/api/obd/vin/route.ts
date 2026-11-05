// /api/obd/vin?vin=…&plate=… — décodage d'un numéro de châssis (marque, modèle, motorisation, année) et interventions
// du même véhicule à proposer (Olivier 05/11/2026). Préversion : drapeau « obd_diagnostic ».
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { obdAccess, decodeVin } from '@/lib/obd/server'
import { checkVin, cleanVin } from '@/lib/obd/vin'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!(await obdAccess(session?.user))) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const u = new URL(req.url)
  const vin = cleanVin(u.searchParams.get('vin') || '')
  const c = checkVin(vin)
  if (!c.valid) return NextResponse.json({ ok: false, check: c })
  return NextResponse.json({ ok: true, check: c, vehicle: await decodeVin(vin) })
}

/** POST { image (base64), mime } — lit le VIN sur la photo de la plaque de châssis ou de la carte grise. */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!(await obdAccess(session?.user))) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const data = String(b.image || '').replace(/^data:[^,]+,/, '')
  const mime = /^image\/(jpeg|png|webp|gif)$/.test(String(b.mime)) ? String(b.mime) : 'image/jpeg'
  if (data.length < 1000) return NextResponse.json({ error: 'Photo manquante' }, { status: 400 })
  try {
    const { aiClient } = await import('@/lib/ai/usage')
    const { ANTHROPIC_MODEL } = await import('@/lib/anthropic-model')
    const client: any = aiClient('obd/vin-photo', { apiKey: process.env.ANTHROPIC_API_KEY! })
    const res = await client.messages.create({ model: ANTHROPIC_MODEL, max_tokens: 100, messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mime, data } },
      { type: 'text', text: 'Photo d’une plaque de châssis, d’un VIN gravé ou d’une carte grise (case E). Recopie le numéro de châssis (VIN, 17 caractères, jamais I, O ni Q). Réponds seulement par le VIN, ou par AUCUN si tu ne le lis pas avec certitude.' },
    ] }] })
    const txt = String(res.content.find((x: any) => x.type === 'text')?.text || '')
    const vin = cleanVin(txt.replace(/\s/g, ''))
    const c = checkVin(vin)
    if (!c.ok17) return NextResponse.json({ ok: false })
    return NextResponse.json({ ok: true, vin, check: c, vehicle: c.valid ? await decodeVin(vin) : null })
  } catch { return NextResponse.json({ ok: false }) }
}
