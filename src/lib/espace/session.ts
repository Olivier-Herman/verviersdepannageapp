// src/lib/espace/session.ts
//
// Session de l'espace client (Olivier 10/10/2026). Indépendante de la connexion de l'équipe :
// un cookie signé (HMAC, même secret que l'app) qui porte l'id du compte et sa version de session.
// Couper un accès = désactiver le compte ou incrémenter session_version : le cookie ne vaut plus rien.

import crypto from 'crypto'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase'

export const ESPACE_COOKIE = 'vd_espace'
const DUREE_S = 30 * 24 * 3600

export type EspaceRole = 'societe' | 'gestionnaire' | 'collaborateur'
export interface EspaceCompte {
  id: string; nom: string; emails: string[]; role: EspaceRole; societe_ids: string[]
  peut_inviter: boolean; invite_par: string | null; session_version: number; active: boolean; password_hash: string | null
}
export interface EspaceSociete { id: string; nom: string; odoo_partner_id: number; source_key: string; appel_audio: string | null; couleur: string | null }

const secret = () => {
  const s = process.env.NEXTAUTH_SECRET
  if (!s) throw new Error('Secret de session absent')
  return s
}
const b64 = (s: string) => Buffer.from(s).toString('base64url')
const mac = (p: string) => crypto.createHmac('sha256', secret()).update(`espace:${p}`).digest('base64url')

export function signSession(compte: Pick<EspaceCompte, 'id' | 'session_version'>): string {
  const p = b64(JSON.stringify({ c: compte.id, v: compte.session_version, e: Math.floor(Date.now() / 1000) + DUREE_S }))
  return `${p}.${mac(p)}`
}

function readToken(token: string | undefined | null): { c: string; v: number } | null {
  if (!token) return null
  const [p, sig] = token.split('.')
  if (!p || !sig) return null
  const want = mac(p)
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null
  try {
    const o = JSON.parse(Buffer.from(p, 'base64url').toString())
    if (!o?.c || typeof o.e !== 'number' || o.e < Date.now() / 1000) return null
    return { c: String(o.c), v: Number(o.v) }
  } catch { return null }
}

export const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: DUREE_S }

/** Compte connecté (ou null) + ses sociétés actives. */
export async function getEspaceSession(): Promise<{ compte: EspaceCompte; societes: EspaceSociete[] } | null> {
  const t = readToken(cookies().get(ESPACE_COOKIE)?.value)
  if (!t) return null
  const sb = createAdminClient()
  const { data: compte } = await sb.from('espace_comptes').select('*').eq('id', t.c).maybeSingle()
  if (!compte || !compte.active || Number(compte.session_version) !== t.v) return null
  const { data: societes } = compte.societe_ids?.length
    ? await sb.from('espace_societes').select('id, nom, odoo_partner_id, source_key, appel_audio, couleur').in('id', compte.societe_ids).eq('active', true).order('nom')
    : { data: [] as any[] }
  if (!societes?.length) return null
  return { compte: compte as EspaceCompte, societes: societes as EspaceSociete[] }
}

export const normEmail = (e: unknown) => String(e || '').trim().toLowerCase()

export async function compteParEmail(email: string): Promise<EspaceCompte | null> {
  const e = normEmail(email)
  if (!e || !e.includes('@')) return null
  const { data } = await createAdminClient().from('espace_comptes').select('*').contains('emails', [e]).eq('active', true).limit(1)
  return (data?.[0] as EspaceCompte) || null
}
