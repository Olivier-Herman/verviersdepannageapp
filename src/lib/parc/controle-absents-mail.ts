// src/lib/parc/controle-absents-mail.ts — mail « pas trouvés » à la fin d'un contrôle aléatoire du parc
// (Olivier 23/11/2026 : « chaque fois qu'il y a du pas trouvé par Jona, je veux recevoir un mail sur Mobi avec les infos
// et afin de pouvoir traiter »). Un mail par contrôle terminé qui compte au moins un « pas trouvé », aux adresses du
// réglage controle_parc_absents_emails. Pas de mail quand le contrôle a été fait par un responsable lui-même (réglage
// controle_parc_validateur_user_ids, Mobi). Pour chaque véhicule : photo, fiche, zone attendue, nuits au parc et les
// mêmes pistes que l'écran de recherche. Un contrôle fait trop vite (moins de 10 s par véhicule) est signalé.
import type { createAdminClient } from '@/lib/supabase'
import { nightsBetween } from '@/lib/parc/nights'
import { pistes } from '@/lib/parc/controle-aleatoire'

type Sb = ReturnType<typeof createAdminClient>
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const heure = (iso?: string | null) => iso ? new Date(iso).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const duree = (ms: number) => ms < 60_000 ? `${Math.round(ms / 1000)} secondes` : `${Math.round(ms / 60_000)} minutes`

export async function envoyerMailAbsents(sb: Sb, controleId: string): Promise<{ ok: boolean; skipped?: string; envoye_a?: string[]; absents?: number }> {
  const { getBusinessList } = await import('@/lib/settings/business')
  const { data: c } = await sb.from('parc_controles_aleatoires').select('*').eq('id', controleId).maybeSingle()
  if (!c || c.status !== 'termine') return { ok: false, skipped: 'contrôle pas terminé' }
  if (c.absents_mail_at) return { ok: true, skipped: 'déjà envoyé' }
  const responsables = await getBusinessList('controle_parc_validateur_user_ids').catch(() => [] as string[])
  if (c.started_by && responsables.includes(c.started_by)) return { ok: true, skipped: 'fait par un responsable' }
  const { data: items } = await sb.from('parc_aleatoire_items').select('*').eq('controle_id', controleId).order('ordre')
  const absents = (items || []).filter((i: any) => i.resultat === 'absent')
  if (!absents.length) return { ok: true, skipped: 'aucun pas trouvé' }
  const dest = await getBusinessList('controle_parc_absents_emails').catch(() => [] as string[])
  if (!dest.length) return { ok: false, skipped: 'aucune adresse dans le réglage controle_parc_absents_emails' }
  // Réservé avant l'envoi : un seul mail même si deux fins de contrôle arrivent en même temps.
  const { data: pris } = await sb.from('parc_controles_aleatoires').update({ absents_mail_at: new Date().toISOString() }).eq('id', controleId).is('absents_mail_at', null).select('id')
  if (!pris?.length) return { ok: true, skipped: 'déjà envoyé' }

  // Pas de colonne « couleur » dans incoming_missions : la demander faisait échouer la requête et le mail partait
  // sans plaque ni n° de fiche (24/11/2026). Une erreur de lecture se voit désormais dans les journaux.
  const { data: ms, error: msErr } = await sb.from('incoming_missions').select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, source, parked_at, created_at, driver_photos').in('id', absents.map((a: any) => a.mission_id))
  if (msErr) console.error('[contrôle du parc] lecture des fiches pour le mail :', msErr.message)
  const fiche = new Map((ms || []).map((m: any) => [m.id, m]))
  const qui = c.started_by_name || 'Le bureau'
  const presents = (items || []).filter((i: any) => i.resultat === 'present').length
  const ailleurs = (items || []).filter((i: any) => i.resultat === 'autre_zone').length
  const reps = (items || []).map((i: any) => Date.parse(i.repondu_at)).filter(Boolean).sort((a, b) => a - b)
  const total = reps.length ? reps[reps.length - 1] - (c.started_at ? Date.parse(c.started_at) : reps[0]) : 0
  const tropVite = reps.length >= 3 && (reps[reps.length - 1] - reps[0]) / (reps.length - 1) < 10_000
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'
  const lien = `${base}/fourriere/controle-aleatoire/${controleId}`

  const blocs: string[] = []
  for (const a of absents) {
    const m: any = fiche.get(a.mission_id) || {}
    const ps = await pistes(sb, a.id).catch(() => [])
    const photo = Array.isArray(m.driver_photos) ? m.driver_photos.find((u: any) => /^https?:\/\//.test(String(u))) : null
    blocs.push(`
      <tr><td style="padding:12px 0;border-top:1px solid #e2e8f0">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
          ${photo ? `<td width="120" valign="top" style="padding-right:12px"><a href="${esc(photo)}"><img src="${esc(photo)}" width="110" style="border-radius:8px;display:block" alt=""></a></td>` : ''}
          <td valign="top" style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a">
            <div style="font-size:16px;font-weight:bold">${esc(m.vehicle_plate || 'sans plaque')} <span style="font-weight:normal;color:#334155">${esc([m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' '))}</span></div>
            <div style="color:#334155;margin:2px 0 6px">Fiche n° ${esc(m.mission_number)} · doit être en zone <b>${esc(a.zone_attendue || '?')}</b> · ${nightsBetween(m.parked_at || m.created_at)} nuits au parc${m.source ? ` · ${esc(m.source)}` : ''}</div>
            ${ps.map(p => `<div style="color:#1e293b;margin:2px 0">${esc(p.icone)} ${esc(p.texte)}</div>`).join('')}
            <div style="margin-top:6px"><a href="${base}/dispatch/${esc(m.id)}" style="color:#0369a1">Ouvrir la fiche</a></div>
          </td>
        </tr></table>
      </td></tr>`)
  }

  const html = `<div style="font-family:Arial,sans-serif;max-width:680px;color:#0f172a">
    <p style="font-size:15px">${esc(qui)} a terminé le contrôle aléatoire du parc le ${heure(c.termine_at)} : <b>${absents.length} véhicule${absents.length > 1 ? 's' : ''} pas trouvé${absents.length > 1 ? 's' : ''}</b>, ${presents} présent${presents > 1 ? 's' : ''}${ailleurs ? `, ${ailleurs} trouvé${ailleurs > 1 ? 's' : ''} dans une autre zone` : ''} (sur ${(items || []).length}, en ${duree(total)}).</p>
    ${tropVite ? `<p style="background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;border-radius:8px;padding:10px;font-weight:bold">⚠️ ${reps.length} réponses en ${duree(reps[reps.length - 1] - reps[0])} : le contrôle n’a probablement pas été fait sur place.</p>` : ''}
    <p><a href="${lien}" style="display:inline-block;background:#0369a1;color:#fff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:10px">Traiter les pas trouvés</a></p>
    <p style="color:#334155;font-size:13px">Pour chacun : retrouvé (dans quelle zone), restitué, parti chez un épaviste, remis au Domaine, ou « on cherche encore ».</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${blocs.join('')}</table>
  </div>`
  const { sendEmail } = await import('@/lib/emails')
  const sujet = `${tropVite ? '⚠️ ' : ''}Contrôle du parc : ${absents.length} pas trouvé${absents.length > 1 ? 's' : ''} par ${qui}`
  try {
    await sendEmail(dest[0], sujet, html, undefined, dest.slice(1))
  } catch (e: any) {
    await sb.from('parc_controles_aleatoires').update({ absents_mail_at: null }).eq('id', controleId)   // pour pouvoir le renvoyer
    throw e
  }
  return { ok: true, envoye_a: dest, absents: absents.length }
}
