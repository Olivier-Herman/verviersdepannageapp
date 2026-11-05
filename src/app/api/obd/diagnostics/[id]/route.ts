// /api/obd/diagnostics/[id] — suite d'une fiche de diagnostic OBD (Olivier 05/11/2026).
//   POST { action: 'analyse' }                    → avis de Sam (fr + sq, DSP ou REM), enregistré sur la fiche
//   POST { action: 'clear_authorize', pin }        → signature de l'effacement par le PIN du chauffeur (4 chiffres).
//        Pas de PIN valide, pas d'effacement. Les codes lus sont gardés avant (cleared_codes).
//   POST { action: 'clear_result', result }        → résultat renvoyé par la voiture (ok | refuse)
//   POST { action: 'decision', decision }          → dsp | rem, choisi par le chauffeur
//   POST { action: 'attach', mission_id }          → rattachement facultatif à une intervention
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import bcrypt from 'bcryptjs'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { obdAccess, analyse } from '@/lib/obd/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  if (!(await obdAccess(user))) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const sb = createAdminClient()
  const { data: d } = await sb.from('obd_diagnostics').select('*').eq('id', params.id).maybeSingle()
  if (!d) return NextResponse.json({ error: 'Diagnostic introuvable' }, { status: 404 })
  const now = new Date().toISOString()
  const log = (notes: string) => d.mission_id ? sb.from('mission_logs').insert({ mission_id: d.mission_id, actor_id: user.id, action: 'obd_diagnostic', notes, metadata: { diagnostic_id: d.id } }).then(() => {}, () => {}) : Promise.resolve()

  if (b.action === 'analyse') {
    try {
      const a = await analyse({ codes: d.codes || [], measures: d.measures || {}, vehicle: d.vehicle, vin: d.vin })
      await sb.from('obd_diagnostics').update({ analysis: a }).eq('id', d.id)
      await log(`Avis de Sam sur le diagnostic ${d.numero} : ${a.verdict === 'dsp' ? 'dépannage sur place possible' : a.verdict === 'rem' ? 'remorquage conseillé' : 'contrôle, rien d’anormal'} — ${a.fr?.pourquoi || ''}`)
      return NextResponse.json({ ok: true, analysis: a })
    } catch (e: any) { return NextResponse.json({ error: 'Sam ne répond pas : réessaie dans un instant.' }, { status: 502 }) }
  }

  if (b.action === 'clear_authorize') {
    if (!/^\d{4}$/.test(String(b.pin || ''))) return NextResponse.json({ error: 'Code à 4 chiffres requis' }, { status: 400 })
    const { data: me } = await sb.from('users').select('verify_pin_hash').eq('id', user.id).maybeSingle()
    if (!me?.verify_pin_hash) return NextResponse.json({ error: 'Tu n’as pas encore de code personnel : demande-le au bureau.', no_pin: true }, { status: 400 })
    if (!(await bcrypt.compare(String(b.pin), me.verify_pin_hash))) return NextResponse.json({ error: 'Code incorrect : rien n’est effacé.' }, { status: 403 })
    // Trace AVANT l'effacement : qui, quand, et les codes lus.
    await sb.from('obd_diagnostics').update({ cleared_by: user.id, cleared_at: now, cleared_codes: d.codes || [], clear_result: null }).eq('id', d.id)
    return NextResponse.json({ ok: true })
  }

  if (b.action === 'clear_result') {
    if (!d.cleared_by || d.cleared_by !== user.id) return NextResponse.json({ error: 'Effacement non signé' }, { status: 409 })
    const result = b.result === 'ok' ? 'ok' : 'refuse'
    await sb.from('obd_diagnostics').update({ clear_result: result, cleared_at: now }).eq('id', d.id)
    const codes = (d.codes || []).map((c: any) => c.code).join(', ') || 'aucun'
    await log(result === 'ok' ? `Codes de panne effacés (diagnostic ${d.numero}), signé par PIN : ${codes} — gardés sur la fiche` : `Effacement refusé par la voiture (diagnostic ${d.numero}) : codes ${codes} toujours présents`)
    return NextResponse.json({ ok: true })
  }

  if (b.action === 'decision') {
    if (!['dsp', 'rem'].includes(b.decision)) return NextResponse.json({ error: 'Décision inconnue' }, { status: 400 })
    await sb.from('obd_diagnostics').update({ decision: b.decision }).eq('id', d.id)
    await log(`Décision du chauffeur après le diagnostic ${d.numero} : ${b.decision === 'dsp' ? 'dépannage sur place' : 'remorquage'}`)
    return NextResponse.json({ ok: true })
  }

  if (b.action === 'attach') {
    if (typeof b.mission_id !== 'string') return NextResponse.json({ error: 'Intervention requise' }, { status: 400 })
    const { data: m } = await sb.from('incoming_missions').select('id, mission_number, vehicle_vin').eq('id', b.mission_id).maybeSingle()
    if (!m) return NextResponse.json({ error: 'Intervention introuvable' }, { status: 404 })
    await sb.from('obd_diagnostics').update({ mission_id: m.id, attached_at: now, attached_by: user.id }).eq('id', d.id)
    await sb.from('mission_logs').insert({ mission_id: m.id, actor_id: user.id, action: 'obd_diagnostic',
      notes: `Diagnostic OBD ${d.numero} rattaché : ${(d.codes || []).map((c: any) => c.code).join(', ') || 'aucun code de panne'}`, metadata: { diagnostic_id: d.id } }).then(() => {}, () => {})
    if (d.vin && !m.vehicle_vin) await sb.from('incoming_missions').update({ vehicle_vin: d.vin }).eq('id', m.id).then(() => {}, () => {})
    return NextResponse.json({ ok: true, mission_number: m.mission_number })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
