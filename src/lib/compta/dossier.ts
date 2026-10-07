// src/lib/compta/dossier.ts
//
// DOSSIERS COMPTABLES (Olivier 07/10/2026) : un listing annoté par la comptable devient une page
// à lien personnel (/compta/<jeton>), sans compte, qui répond à chacune de ses annotations, avec
// les pièces téléchargeables. Elle peut valider un point (« OK, c'est réglé », réversible) ou
// ajouter une remarque ; chaque action s'inscrit dans le fil du point et prévient Mobi sur
// Telegram en privé (règle du 07/10 : soucis et validations en privé).
// Règles de contenu : aucun compte de l'ERP, pas de téléphone, pas de mention d'automatisation.

import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase'
import { getBusinessNumber } from '@/lib/settings/business'
import { tgSend } from '@/lib/sam/telegram'

export const BUCKET = 'dossiers-comptables'
const SECRET = () => process.env.DOSSIER_LINK_SECRET || process.env.NEXTAUTH_SECRET || ''
const b64u = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Lien personnel : identifiant du dossier + signature HMAC (pas d'expiration : révocable en changeant le secret). */
export function signDossierToken(dossierId: string): string {
  const p = b64u(Buffer.from(dossierId, 'utf8'))
  return `${p}.${b64u(crypto.createHmac('sha256', SECRET()).update(p).digest()).slice(0, 32)}`
}

export function verifyDossierToken(token: string): string | null {
  const [p, s] = String(token || '').split('.')
  if (!p || !s || !SECRET()) return null
  const want = b64u(crypto.createHmac('sha256', SECRET()).update(p).digest()).slice(0, 32)
  if (want.length !== s.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(s))) return null
  const id = Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

export type Etat = 'regle' | 'fournisseur' | 'interne'
export interface PointVue {
  id: string; numero: number; compte: string; ligne: string | null; annotation: string; couleur: 'orange' | 'bleu'
  reponse: string; etat: Etat; suivi: string | null; valide_le: string | null; updated_at: string
  docs: { id: string; nom: string }[]
  fil: { auteur: 'comptable' | 'vd'; kind: string; texte: string | null; created_at: string }[]
}
export interface DossierVue {
  id: string; titre: string; sous_titre: string | null; destinataire: string | null; intro: string | null
  signature: string; pied: string | null; updated_at: string; points: PointVue[]
}

export async function loadDossier(dossierId: string): Promise<DossierVue | null> {
  const sb = createAdminClient()
  const { data: d } = await sb.from('dossiers_comptables').select('*').eq('id', dossierId).maybeSingle()
  if (!d) return null
  const { data: pts } = await sb.from('dossier_comptable_points').select('*').eq('dossier_id', dossierId).order('numero')
  const ids = (pts || []).map((p: any) => p.id)
  const [{ data: docs }, { data: evs }] = await Promise.all([
    sb.from('dossier_comptable_docs').select('id, point_id, nom').in('point_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).order('created_at'),
    sb.from('dossier_comptable_events').select('point_id, auteur, kind, texte, created_at').in('point_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).order('created_at'),
  ])
  const points: PointVue[] = (pts || []).map((p: any) => ({
    ...p,
    docs: (docs || []).filter((x: any) => x.point_id === p.id).map((x: any) => ({ id: x.id, nom: x.nom })),
    fil: (evs || []).filter((x: any) => x.point_id === p.id).map((x: any) => ({ auteur: x.auteur, kind: x.kind, texte: x.texte, created_at: x.created_at })),
  }))
  const last = [d.updated_at, ...points.map(p => p.updated_at)].sort().pop()!
  return { id: d.id, titre: d.titre, sous_titre: d.sous_titre, destinataire: d.destinataire, intro: d.intro, signature: d.signature, pied: d.pied, updated_at: last, points }
}

/** Action de la comptable sur un point. Retourne le point mis à jour. */
export async function comptableAction(dossierId: string, pointId: string, kind: 'ok' | 'reouvert' | 'remarque', texte?: string): Promise<{ ok: boolean; error?: string }> {
  const sb = createAdminClient()
  const { data: p } = await sb.from('dossier_comptable_points').select('id, numero, compte, valide_le, dossier_id').eq('id', pointId).maybeSingle()
  if (!p || p.dossier_id !== dossierId) return { ok: false, error: 'Point introuvable' }
  const t = String(texte || '').trim().slice(0, 4000)
  if (kind === 'remarque' && !t) return { ok: false, error: 'Remarque vide' }
  const now = new Date().toISOString()
  if (kind === 'ok') await sb.from('dossier_comptable_points').update({ valide_le: now, updated_at: now }).eq('id', pointId)
  if (kind === 'reouvert') await sb.from('dossier_comptable_points').update({ valide_le: null, updated_at: now }).eq('id', pointId)
  await sb.from('dossier_comptable_events').insert({ point_id: pointId, auteur: 'comptable', kind, texte: kind === 'remarque' ? t : null })
  await notifyMobi(dossierId, p, kind, t).catch(() => {})
  return { ok: true }
}

async function notifyMobi(dossierId: string, p: any, kind: string, t: string) {
  const chat = await getBusinessNumber('telegram_chat_mobi')
  const { data: d } = await createAdminClient().from('dossiers_comptables').select('titre, destinataire').eq('id', dossierId).maybeSingle()
  const qui = (d?.destinataire || 'La comptable').split('·')[0].trim()
  const quoi = kind === 'ok' ? '✅ a validé le point' : kind === 'reouvert' ? '↩️ a rouvert le point' : '💬 a ajouté une remarque sur le point'
  const corps = `${qui} ${quoi} n° ${p.numero} — ${p.compte}\n(${d?.titre || 'dossier comptable'})${kind === 'remarque' ? `\n\n« ${t} »` : ''}`
  await tgSend(chat, corps, [], 'Dossier comptable')
}

/** Mise à jour d'un point par VD (réponse, état, suivi) ; s'inscrit dans le fil. */
export async function updatePoint(pointId: string, patch: { reponse?: string; etat?: Etat; suivi?: string | null }, note?: string) {
  const sb = createAdminClient()
  await sb.from('dossier_comptable_points').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', pointId)
  if (note) await sb.from('dossier_comptable_events').insert({ point_id: pointId, auteur: 'vd', kind: 'maj', texte: note })
}

/** Ajoute une pièce à un point (stockée dans le bucket privé, servie par le lien personnel). */
export async function addDoc(pointId: string, nom: string, bytes: Buffer, mime = 'application/pdf'): Promise<string> {
  const sb = createAdminClient()
  // Clé de stockage sans accents ni espaces (refusés) ; le nom lisible reste dans la table.
  const ext = (nom.match(/\.[a-z0-9]{1,5}$/i)?.[0] || '').toLowerCase()
  const path = `${pointId}/${crypto.randomUUID()}${ext}`
  const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false })
  if (error) throw new Error(`Pièce « ${nom} » non enregistrée : ${error.message}`)
  const { data, error: e2 } = await sb.from('dossier_comptable_docs').insert({ point_id: pointId, nom, storage_path: path, mime }).select('id').single()
  if (e2) throw new Error(e2.message)
  return data.id
}
