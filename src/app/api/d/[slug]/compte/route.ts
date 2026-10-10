// POST /api/d/[slug]/compte — inscription et connexion d'un client du garage (Olivier 10/10/2026).
//   { etape: 'inscrire', prenom, nom, tel, email, adresse, plaque, marque, modele } → code par mail
//   { etape: 'code', email }            → code par mail (client déjà inscrit, autre téléphone)
//   { etape: 'verifier', email, code }  → session ; à la première vérification, le garage est averti
// DELETE → déconnexion.
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase'
import { normEmail } from '@/lib/espace/session'
import { societeParSlug, clientCookie, clientCookieOptions, signClient } from '@/lib/espace/clients'
import { envoyerCodeClient, avertirGarageNouveauClient } from '@/lib/espace/mails'

export const dynamic = 'force-dynamic'

const hash = (id: string, code: string) => crypto.createHash('sha256').update(`${process.env.NEXTAUTH_SECRET}:client:${id}:${code}`).digest('hex')
const txt = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n)

async function envoyer(sb: ReturnType<typeof createAdminClient>, client: { id: string; prenom: string }, email: string, garage: string) {
  const depuis = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count } = await sb.from('espace_client_codes').select('id', { count: 'exact', head: true }).eq('client_id', client.id).gte('created_at', depuis)
  if ((count || 0) >= 5) return
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  await sb.from('espace_client_codes').insert({ client_id: client.id, code_hash: hash(client.id, code), expires_at: new Date(Date.now() + 15 * 60_000).toISOString() })
  await envoyerCodeClient(email, client.prenom, code, garage)
}

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const societe = await societeParSlug(params.slug)
  if (!societe?.clients_actif) return NextResponse.json({ error: 'Ce service n’est pas activé par votre garage.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const email = normEmail(b?.email)
  const sb = createAdminClient()
  const trouver = async () => (await sb.from('espace_clients').select('*').eq('societe_id', societe.id).eq('email', email).eq('active', true).maybeSingle()).data

  try {
    if (b?.etape === 'inscrire') {
      const f = {
        prenom: txt(b.prenom, 60), nom: txt(b.nom, 80), tel: txt(b.tel, 30), adresse: txt(b.adresse, 300),
        plaque: String(b.plaque || '').replace(/[\s.-]/g, '').toUpperCase().slice(0, 15), marque: txt(b.marque, 40), modele: txt(b.modele, 60),
      }
      if (!email.includes('@') || Object.values(f).some(v => !v)) return NextResponse.json({ error: 'Tous les champs sont obligatoires.' }, { status: 400 })
      let c = await trouver()
      if (!c) {
        const { data, error } = await sb.from('espace_clients').insert({ societe_id: societe.id, email, ...f }).select('*').single()
        if (error) throw error
        c = data
      } else if (!c.verifie_le) {
        // Pas encore confirmé : on reprend ce qu'il vient de taper. Un compte confirmé ne se réécrit pas sans code.
        await sb.from('espace_clients').update({ ...f, updated_at: new Date().toISOString() }).eq('id', c.id)
        c = { ...c, ...f }
      }
      await envoyer(sb, c, email, societe.nom)
      return NextResponse.json({ ok: true })
    }

    if (b?.etape === 'code') {
      const c = await trouver()
      if (c) await envoyer(sb, c, email, societe.nom)
      return NextResponse.json({ ok: true, inconnu: !c })
    }

    if (b?.etape === 'verifier') {
      const code = String(b?.code || '').replace(/\D/g, '')
      const c = await trouver()
      if (!c || code.length !== 6) return NextResponse.json({ error: 'Code incorrect.' }, { status: 400 })
      const { data: k } = await sb.from('espace_client_codes').select('*').eq('client_id', c.id).is('used_at', null).gte('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (!k || k.tentatives >= 5) return NextResponse.json({ error: 'Code expiré : demandez-en un nouveau.' }, { status: 400 })
      if (k.code_hash !== hash(c.id, code)) {
        await sb.from('espace_client_codes').update({ tentatives: k.tentatives + 1 }).eq('id', k.id)
        return NextResponse.json({ error: 'Code incorrect.' }, { status: 400 })
      }
      const now = new Date().toISOString()
      await sb.from('espace_client_codes').update({ used_at: now }).eq('id', k.id)
      await sb.from('espace_clients').update({ verifie_le: c.verifie_le || now, derniere_connexion: now }).eq('id', c.id)
      if (!c.verifie_le) {
        // Le garage est averti à la première confirmation, pour vérifier le client et cocher son assistance.
        const { data: comptes } = await sb.from('espace_comptes').select('emails, role').contains('societe_ids', [societe.id]).eq('active', true).in('role', ['societe', 'gestionnaire'])
        const to = Array.from(new Set((comptes || []).map((x: any) => x.emails?.[0]).filter(Boolean)))
        await avertirGarageNouveauClient(to, societe.nom, c)
      }
      const res = NextResponse.json({ ok: true })
      res.cookies.set(clientCookie(societe.clients_slug!), signClient(c), clientCookieOptions)
      return res
    }
  } catch (e: any) {
    console.error('[clients garage] compte KO', e?.message)
    return NextResponse.json({ error: 'Le mail n’a pas pu partir. Réessayez dans un instant.' }, { status: 502 })
  }
  return NextResponse.json({ error: 'Demande inconnue' }, { status: 400 })
}

export async function DELETE(_req: Request, { params }: { params: { slug: string } }) {
  const societe = await societeParSlug(params.slug)
  const res = NextResponse.json({ ok: true })
  if (societe?.clients_slug) res.cookies.set(clientCookie(societe.clients_slug), '', { ...clientCookieOptions, maxAge: 0 })
  return res
}
