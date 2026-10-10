// POST /api/espace/connexion — connexion à l'espace client (Olivier 10/10/2026).
//   { etape: 'code', email }                 → envoie un code à 6 chiffres (15 min)
//   { etape: 'verifier', email, code }       → ouvre la session
//   { etape: 'mot-de-passe', email, motDePasse } → ouvre la session
// Réponse identique que l'adresse existe ou non (pas de recherche d'adresses possible).
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { ESPACE_COOKIE, cookieOptions, compteParEmail, normEmail, signSession } from '@/lib/espace/session'
import { envoyerCode } from '@/lib/espace/mails'

export const dynamic = 'force-dynamic'

const hash = (compteId: string, code: string) => crypto.createHash('sha256').update(`${process.env.NEXTAUTH_SECRET}:${compteId}:${code}`).digest('hex')

async function ouvrir(compte: { id: string; session_version: number }) {
  await createAdminClient().from('espace_comptes').update({ derniere_connexion: new Date().toISOString() }).eq('id', compte.id)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(ESPACE_COOKIE, signSession(compte), cookieOptions)
  return res
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  const email = normEmail(b?.email)
  const sb = createAdminClient()

  if (b?.etape === 'code') {
    const compte = await compteParEmail(email)
    if (compte) {
      const depuis = new Date(Date.now() - 15 * 60_000).toISOString()
      const { count } = await sb.from('espace_codes').select('id', { count: 'exact', head: true }).eq('compte_id', compte.id).gte('created_at', depuis)
      if ((count || 0) < 5) {
        const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
        await sb.from('espace_codes').insert({ compte_id: compte.id, code_hash: hash(compte.id, code), expires_at: new Date(Date.now() + 15 * 60_000).toISOString() })
        try { await envoyerCode(email, compte.nom, code) } catch (e: any) { console.error('[espace] code KO', e?.message); return NextResponse.json({ error: 'Le mail n’a pas pu partir. Réessayez dans un instant.' }, { status: 502 }) }
      }
    }
    return NextResponse.json({ ok: true })
  }

  if (b?.etape === 'verifier') {
    const code = String(b?.code || '').replace(/\D/g, '')
    const compte = await compteParEmail(email)
    if (!compte || code.length !== 6) return NextResponse.json({ error: 'Code incorrect.' }, { status: 400 })
    const { data: c } = await sb.from('espace_codes').select('*').eq('compte_id', compte.id).is('used_at', null).gte('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!c || c.tentatives >= 5) return NextResponse.json({ error: 'Code expiré : demandez-en un nouveau.' }, { status: 400 })
    if (c.code_hash !== hash(compte.id, code)) {
      await sb.from('espace_codes').update({ tentatives: c.tentatives + 1 }).eq('id', c.id)
      return NextResponse.json({ error: 'Code incorrect.' }, { status: 400 })
    }
    await sb.from('espace_codes').update({ used_at: new Date().toISOString() }).eq('id', c.id)
    return ouvrir(compte)
  }

  if (b?.etape === 'mot-de-passe') {
    const compte = await compteParEmail(email)
    const ok = !!compte?.password_hash && await bcrypt.compare(String(b?.motDePasse || ''), compte.password_hash)
    if (!ok) return NextResponse.json({ error: 'Adresse ou mot de passe incorrect.' }, { status: 400 })
    return ouvrir(compte!)
  }

  return NextResponse.json({ error: 'Demande inconnue' }, { status: 400 })
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(ESPACE_COOKIE, '', { ...cookieOptions, maxAge: 0 })
  return res
}
