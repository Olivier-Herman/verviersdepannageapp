// src/lib/missions/anwb.ts — mails de l'alarmcentrale ANWB (Olivier 14/10/2026).
//
// Tout est dans un PDF ANWB en français ; la lecture IA en donne le type (document_kind). Règles :
//   • « Mission de transfert / remorquage » : avant de créer quoi que ce soit, on vérifie que la mission
//     n'existe pas déjà (Momo l'encode souvent à l'appel d'ANWB, et c'est souvent une REPRISE de dossier :
//     véhicule déjà chez nous, amené par la police ou Touring). Fiche trouvée → on la complète (n° ANWB,
//     forfait en tarif convenu HTVA), sans nouvelle fiche ni appel. Sinon → nouvelle fiche ; si le véhicule
//     est au parc, elle est rattachée au dossier du parc (reserveTowForParkedVehicle, côté processor) ; et le
//     dispatch reçoit un APPEL comme pour EBAC.
//   • « Prise en charge pour un dépannage » : ANWB reprend à sa charge une intervention déjà faite (20 cas
//     sur 27 : fiche police / Touring antérieure) → jamais de fiche, on le note sur la fiche et on prévient.
//   • Annulation : notée et signalée au dispatch (pas d'annulation automatique).
//   • Gardiennage, réparation, diagnostic, renseignement garage : rien (le mail reste dans info@ pour Momo).

import type { ParsedMission } from './parser'

export type AnwbDecision =
  | { action: 'create' }
  | { action: 'skip'; reason: string }

const ACTIF_EXCLU = ['ignored', 'cancelled', 'deleted', 'placeholder', 'parse_error']

async function prevenir(title: string, body: string, url: string) {
  try {
    const { sendPushToRole } = await import('@/lib/push')
    await sendPushToRole(['admin', 'superadmin', 'dispatcher'], { title, body, url, icon: '/icons/apple-touch-icon.png' }, 'dispatch_new_mission')
  } catch { /* la notification est un plus */ }
}

/** Fiche déjà connue pour ce dossier ANWB (n° de mission ou de dossier), quel que soit son état. */
async function parNumero(sb: any, p: ParsedMission, placeholderId?: string) {
  const nums = [p.external_id, p.dossier_number].filter(x => x && /^\d{8,}$/.test(String(x))) as string[]
  if (!nums.length) return null
  const or = nums.flatMap(n => [`external_id.eq.${n}`, `dossier_number.ilike.%${n}%`]).join(',')
  const { data } = await sb.from('incoming_missions').select('id, mission_number, status, source, special_tarif_htva, external_id, dossier_number')
    .or(or).not('status', 'in', `(${ACTIF_EXCLU.join(',')})`).neq('id', placeholderId || '00000000-0000-0000-0000-000000000000')
    .order('received_at', { ascending: false }).limit(1)
  return (data || [])[0] || null
}

/** Fiche récente du même véhicule (14 jours), hors fiches écartées. */
async function parPlaque(sb: any, plaque: string | null, placeholderId?: string) {
  const p = String(plaque || '').replace(/[^A-Z0-9]/gi, '').toUpperCase()
  if (p.length < 4) return null
  const { data } = await sb.from('incoming_missions').select('id, mission_number, status, source, special_tarif_htva, external_id, dossier_number, received_at')
    .eq('vehicle_plate', p).not('status', 'in', `(${ACTIF_EXCLU.join(',')})`).neq('id', placeholderId || '00000000-0000-0000-0000-000000000000')
    .gte('received_at', new Date(Date.now() - 14 * 864e5).toISOString())
    .order('received_at', { ascending: false }).limit(1)
  return (data || [])[0] || null
}

async function noter(sb: any, missionId: string, notes: string, metadata: any) {
  await sb.from('mission_logs').insert({ mission_id: missionId, action: 'anwb_mail', notes, metadata }).then(() => {}, () => {})
}

export async function decisionAnwb(sb: any, p: ParsedMission, ctx: { subject: string; placeholderId?: string }): Promise<AnwbDecision> {
  const kind = String((p as any).document_kind || '').toLowerCase()
  const montant = Number(p.amount_guaranteed) > 0 ? Number(p.amount_guaranteed) : null
  const ref = [p.external_id, p.dossier_number].filter(Boolean).join(' / ')

  if (kind === 'transfert') {
    const f = await parNumero(sb, p, ctx.placeholderId) || await (async () => {
      const x = await parPlaque(sb, p.vehicle_plate, ctx.placeholderId)
      return x && !['parked', 'gardiennage'].includes(String(x.status)) ? x : null   // au parc = reprise → nouvelle mission
    })()
    if (f) {
      const upd: Record<string, any> = { updated_at: new Date().toISOString() }
      if (montant && f.special_tarif_htva == null && !['to_invoice', 'invoiced'].includes(String(f.status))) upd.special_tarif_htva = montant
      if (!f.dossier_number && p.dossier_number) upd.dossier_number = p.dossier_number
      await sb.from('incoming_missions').update(upd).eq('id', f.id)
      await noter(sb, f.id, `Mail ANWB « mission de transfert / remorquage » (${ref}${montant ? `, prise en charge ${montant} € HTVA` : ''}) rattaché à cette fiche — pas de nouvelle mission.${upd.special_tarif_htva ? ' Tarif convenu HTVA complété.' : ''}`, { anwb: ref, montant, kind })
      return { action: 'skip', reason: `ANWB transfert déjà connu → fiche #${f.mission_number}` }
    }
    return { action: 'create' }
  }

  if (kind === 'depannage_pec') {
    const f = await parNumero(sb, p, ctx.placeholderId) || await parPlaque(sb, p.vehicle_plate, ctx.placeholderId)
    if (f) {
      await noter(sb, f.id, `ANWB prend en charge ${montant ? `${montant} € HTVA` : 'cette intervention'} (prise en charge pour un dépannage, ${ref}). À facturer à ANWB en mentionnant le n° de mission.`, { anwb: ref, montant, kind })
      await prevenir(`💶 ANWB prend en charge ${p.vehicle_plate || ''}`, `Fiche #${f.mission_number} : ${montant ? `${montant} € HTVA` : 'prise en charge'} (${ref}).`, `/dispatch/${f.id}`)
      return { action: 'skip', reason: `ANWB prise en charge → fiche #${f.mission_number}` }
    }
    await prevenir(`💶 ANWB : prise en charge sans fiche`, `${p.vehicle_plate || '?'} — ${montant ? `${montant} € HTVA` : ''} (${ref}). Aucune fiche trouvée : à vérifier (mail dans info@).`, '/dispatch')
    return { action: 'skip', reason: 'ANWB prise en charge sans fiche' }
  }

  if (kind === 'annulation') {
    const f = await parNumero(sb, p, ctx.placeholderId) || await parPlaque(sb, p.vehicle_plate, ctx.placeholderId)
    if (f) await noter(sb, f.id, `⚠️ ANWB annule la mission (${ref}) — à confirmer avec le dispatch.`, { anwb: ref, kind })
    await prevenir(`⚠️ ANWB annule ${p.vehicle_plate || ''}`, f ? `Fiche #${f.mission_number} (${ref}) : ANWB annule — à vérifier.` : `Mission ${ref} annulée par ANWB (aucune fiche trouvée).`, f ? `/dispatch/${f.id}` : '/dispatch')
    return { action: 'skip', reason: 'ANWB annulation signalée' }
  }

  return { action: 'skip', reason: `ANWB « ${kind || 'autre'} » : pas une mission (reste dans info@)` }
}

/** Appel du dispatch, comme pour une demande EBAC : message « nouvelle mission ANWB ». */
export async function appelerDispatchAnwb(missionId: string): Promise<void> {
  const { appelerDepannage } = await import('@/lib/espace/demande')
  await appelerDepannage(missionId, { appel_audio: 'espace-demande-anwb.wav' } as any)
}
