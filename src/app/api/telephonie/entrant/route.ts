// src/app/api/telephonie/entrant/route.ts — sonnerie d'un appel sur un compte de ressource Teams relié à VD Soft
// (Teams Phone extensibility, Olivier 24/11/2026). Événement Event Grid « Microsoft.Communication.IncomingCall ».
// Ordre impératif : d'abord passer l'appel à la file Teams (l'appelant ne doit jamais attendre VD Soft), ensuite
// chercher la fiche et prévenir les agents. Si le renvoi direct échoue, VD Soft décroche puis transfère
// (../evenements). Adresse protégée par ?k=TELEPHONIE_WEBHOOK_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { cleValide } from '@/lib/telephonie/cle'
import { lireConfigTel, tracerAppel, prevenirAgents, alerterEchec } from '@/lib/telephonie/entrant'
import { rediriger, decrocher } from '@/lib/telephonie/acs'
import { fichesDuNumero, ficheEvidente } from '@/lib/appels-fiches'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  if (!cleValide(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const evts = await req.json().catch(() => [])
  const liste: any[] = Array.isArray(evts) ? evts : [evts]

  // Poignée de main de l'abonnement Event Grid.
  const val = liste.find(e => e?.eventType === 'Microsoft.EventGrid.SubscriptionValidationEvent')
  if (val) return NextResponse.json({ validationResponse: val.data?.validationCode })

  const sb = createAdminClient()
  const cfg = await lireConfigTel(sb)
  const base = (process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com').replace(/\/+$/, '')
  for (const e of liste) {
    if (e?.eventType !== 'Microsoft.Communication.IncomingCall') continue
    const t0 = Date.now()
    const d = e.data || {}
    const id = String(d.correlationId || d.serverCallId || e.id)
    const versRaw = String(d.to?.rawId || '').toLowerCase()
    const cle = Object.keys(cfg.files).find(k => cfg.files[k].ra_vdsoft && versRaw === `28:orgid:${String(cfg.files[k].ra_vdsoft).toLowerCase()}`)
    if (!cle) { console.warn('[telephonie] appel vers un compte inconnu', versRaw); continue }
    const f = cfg.files[cle]
    const numero: string | null = d.from?.phoneNumber?.value || (String(d.from?.rawId || '').startsWith('4:') ? String(d.from.rawId).slice(2) : null)

    // Microsoft livre « au moins une fois » : un seul traitement par appel.
    const { error: dup } = await sb.from('appels_entrants').insert({ id, numero, file: cle, statut: 'recu' })
    if (dup) { if ((dup as any).code === '23505') continue; console.error('[telephonie] trace :', dup.message) }
    if (!f.renvoi) { await tracerAppel(sb, { id, numero, file: cle, statut: 'echec', erreur: 'Aucune file de renvoi réglée' }); await alerterEchec(cfg, { numero, file: cle }, 'Aucune file de renvoi réglée'); continue }

    let ok = false, mode = f.mode || 'redirect', err = ''
    if (mode === 'redirect') {
      try { await rediriger(d.incomingCallContext, f.renvoi); ok = true }
      catch (x: any) { err = String(x?.message || x); mode = 'transfert' }
    }
    if (!ok) {
      // Décroché puis transfert (fait à l'événement « appel connecté »), avec la fiche affichée dans Teams.
      let sujet: string | null = null, nom: string | null = null
      try { const fiche = ficheEvidente(await fichesDuNumero(sb, numero)); if (fiche) { sujet = [fiche.vehicle_plate, fiche.client_name].filter(Boolean).join(' · ') || null; nom = fiche.client_name } } catch { /* sans contexte */ }
      try {
        const cx = await decrocher(d.incomingCallContext, `${base}/api/telephonie/evenements?k=${encodeURIComponent(process.env.TELEPHONIE_WEBHOOK_SECRET || '')}`, id)
        await sb.from('appels_entrants').update({ mode: 'transfert', connexion_id: cx, contexte: { cible: f.renvoi, sujet, nom }, erreur: err || null }).eq('id', id)
        ok = true
      } catch (x: any) { err = [err, String(x?.message || x)].filter(Boolean).join(' / ') }
    } else {
      await sb.from('appels_entrants').update({ mode: 'redirect', statut: 'renvoye', delai_ms: Date.now() - t0 }).eq('id', id)
    }
    if (!ok) { await tracerAppel(sb, { id, numero, file: cle, statut: 'echec', erreur: err }); await alerterEchec(cfg, { numero, file: cle }, err); continue }

    if (cfg.actif) await prevenirAgents(sb, { id, numero, file: cle }, cfg).catch(x => console.error('[telephonie] prévenir :', x?.message))
  }
  return NextResponse.json({ ok: true })
}
