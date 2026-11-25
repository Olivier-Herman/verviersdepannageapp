// src/lib/telephonie/entrant.ts — VD Soft dans l'appel, palier 1 (Olivier 24/11/2026).
// Partie commune, quel que soit le branchement Microsoft : à la sonnerie d'un appel d'une file suivie, retrouver la
// fiche du numéro, prévenir les agents de la file (notification VD Soft : PC et GSM) et tracer l'appel. Le renvoi
// vers la file Teams est fait par le branchement (src/app/api/telephonie/…) AVANT d'appeler ceci : l'appelant ne
// doit jamais attendre VD Soft.
//
// Réglage telephonie_config (app_settings) :
//   actif    : faux = rien ne se passe ;
//   files    : clé → { nom, prevenir: [comptes VD Soft], renvoi: cible Microsoft de la file Teams } ;
//   alerte   : adresses prévenues quand un renvoi échoue.

import type { createAdminClient } from '@/lib/supabase'
import { fichesDuNumero, ficheEvidente, libelleFiche, numeroLisible, motifNumero } from '@/lib/appels-fiches'

type Sb = ReturnType<typeof createAdminClient>

export interface FileTel { nom: string; prevenir: string[]; ra_vdsoft: string | null; renvoi: any; mode?: 'redirect' | 'transfert' }
export interface ConfigTel { actif: boolean; files: Record<string, FileTel>; alerte: string[] }

export async function lireConfigTel(sb: Sb): Promise<ConfigTel> {
  const { data, error } = await sb.from('app_settings').select('value').eq('key', 'telephonie_config').maybeSingle()
  if (error) throw new Error(`Réglage téléphonie : ${error.message}`)
  const c = data?.value ? JSON.parse(data.value as any) : {}
  return { actif: !!c.actif, files: c.files || {}, alerte: c.alerte || [] }
}

/** Trace l'appel et son renvoi (idempotent : Microsoft peut renvoyer le même événement). */
export async function tracerAppel(sb: Sb, a: { id: string; numero: string | null; file: string; statut: 'recu' | 'renvoye' | 'echec'; erreur?: string | null; delai_ms?: number | null }) {
  await sb.from('appels_entrants').upsert({ id: a.id, numero: a.numero, file: a.file, statut: a.statut, erreur: a.erreur || null, delai_ms: a.delai_ms ?? null }, { onConflict: 'id' })
}

/** Après le renvoi : fiche du numéro + notification aux agents de la file. */
export async function prevenirAgents(sb: Sb, a: { id: string; numero: string | null; file: string }, cfg: ConfigTel): Promise<void> {
  const f = cfg.files[a.file]
  if (!f) return
  const lisible = motifNumero(a.numero) ? numeroLisible(a.numero) : 'Numéro masqué'
  let titre = `📞 ${f.nom} : ${lisible}`, corps = 'Numéro sur aucune fiche : touchez pour chercher ou créer la fiche.'
  let url = a.numero && motifNumero(a.numero) ? `/appel?tel=${encodeURIComponent(a.numero)}` : '/appels'
  let missionId: string | undefined, nb = 0
  try {
    const fiches = await fichesDuNumero(sb, a.numero)
    nb = fiches.length
    const ev = ficheEvidente(fiches)
    await sb.from('appels_entrants').update({ fiches: fiches.length, mission_id: ev?.id || null }).eq('id', a.id)
    if (ev) {
      const l = libelleFiche(ev)
      corps = `${l.titre} · ${l.detail}`; url = `/dispatch/${ev.id}`; missionId = ev.id
    } else if (fiches.length) {
      corps = `${fiches.length} fiches avec ce numéro : touchez pour choisir.`
    }
  } catch (e: any) { corps = `Fiche non cherchée (${String(e?.message || e).slice(0, 80)}).` }
  const { sendNotification } = await import('@/lib/notifications/send')
  await Promise.all(f.prevenir.map(uid => sendNotification(uid, 'appel_entrant', { title: titre, body: corps, action_url: url, mission_id: missionId, data: { numero: a.numero, file: a.file, fiches: nb } }).catch(() => null)))
}

/** Un renvoi qui échoue : mail d'alerte (l'appelant risque d'être perdu). */
export async function alerterEchec(cfg: ConfigTel, a: { numero: string | null; file: string }, erreur: string) {
  const { sendEmail } = await import('@/lib/emails')
  const nom = cfg.files[a.file]?.nom || a.file
  for (const to of cfg.alerte) await sendEmail(to, `⚠️ Téléphone : appel ${nom} non renvoyé vers la file`,
    `<p>Un appel de <b>${numeroLisible(a.numero)}</b> sur « ${nom} » n'a pas pu être renvoyé vers la file d'attente.</p><p>Erreur : ${erreur}</p><p>Si cela se répète, remettre l'option du standard directement sur la file Teams.</p>`).catch(() => null)
}
