// src/app/api/missions/[id]/touring-close/report/route.ts
//
// Bouton « Envoyer à Mobi » du modal de clôture : mail l'erreur (contexte + payload
// + réponse COMEX) pour diagnostic. Olivier 2026-08-06.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendEmail }         from '@/lib/emails'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

const MOBI_EMAIL = 'mobi@verviersdepannage.be'

const esc = (s: any) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: actor } = await sb.from('users').select('id, name, email').eq('email', session.user.email).maybeSingle()
  const { data: m } = await sb.from('incoming_missions')
    .select('id, mission_number, vehicle_plate, dossier_number, raw_content')
    .eq('id', params.id).maybeSingle()

  const body = await req.json().catch(() => ({}))
  const { error, attempted, comexResponse } = body || {}

  let cid = ''
  try { const c = JSON.parse((m as any)?.raw_content || '{}'); cid = `${c.CID_DOS || '?'} / seq ${c.CID_SEQ_ACTION || '?'}` } catch {}

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
      <h2 style="color:#c0392b">⚠️ Erreur de clôture Touring</h2>
      <p><b>Mission :</b> #${esc((m as any)?.mission_number)} — <b>${esc((m as any)?.vehicle_plate)}</b> — dossier ${esc((m as any)?.dossier_number)}</p>
      <p><b>COMEX :</b> ${esc(cid)}</p>
      <p><b>Signalé par :</b> ${esc((actor as any)?.name)} (${esc((actor as any)?.email)})</p>
      <p><b>Quand :</b> ${new Date().toISOString()}</p>
      <p><b>Message d'erreur :</b><br><span style="color:#c0392b">${esc(error)}</span></p>
      <p><b>Données envoyées :</b></p>
      <pre style="background:#f4f4f4;padding:10px;border-radius:6px;white-space:pre-wrap">${esc(JSON.stringify(attempted, null, 2))}</pre>
      <p><b>Réponse COMEX :</b></p>
      <pre style="background:#f4f4f4;padding:10px;border-radius:6px;white-space:pre-wrap">${esc(JSON.stringify(comexResponse, null, 2))}</pre>
    </div>`

  try {
    await sendEmail(MOBI_EMAIL, `⚠️ Erreur clôture Touring — ${esc((m as any)?.vehicle_plate) || (m as any)?.mission_number || ''}`, html)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Envoi impossible' }, { status: 502 })
  }
}
