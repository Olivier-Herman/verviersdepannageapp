// POST /api/assistance/compte — inscription et connexion à VD Assistance (Olivier 10/10/2026).
//   { etape: 'inscrire', prenom, nom, tel, email, adresse, vehicule: { plaque, marque, modele, garageId } } → code par mail
//   { etape: 'code', email }            → code par mail (client déjà inscrit, autre téléphone)
//   { etape: 'verifier', email, code }  → session ; à la première vérification, le garage du véhicule est averti
//   { etape: 'supprimer' }              → suppression du compte par le client (exigence Apple) : coordonnées et
//                                         véhicules effacés, les dépannages passés restent (factures)
// DELETE → déconnexion.
// Garage de démonstration (validation Apple) : une seule adresse, code fixe, aucun mail.
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase'
import { normEmail } from '@/lib/espace/session'
import { CLIENT_COOKIE, clientCookieOptions, signClient, getClientSession, lireVehicule, avertirGarage, vehiculesDuClient } from '@/lib/espace/clients'
import { envoyerCodeClient } from '@/lib/espace/mails'
import { getBusinessText } from '@/lib/settings/business'

export const dynamic = 'force-dynamic'

const hash = (id: string, code: string) => crypto.createHash('sha256').update(`${process.env.NEXTAUTH_SECRET}:client:${id}:${code}`).digest('hex')
const txt = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n)

async function envoyer(sb: ReturnType<typeof createAdminClient>, client: { id: string; prenom: string }, email: string) {
  const depuis = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count } = await sb.from('espace_client_codes').select('id', { count: 'exact', head: true }).eq('client_id', client.id).gte('created_at', depuis)
  if ((count || 0) >= 5) return
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  await sb.from('espace_client_codes').insert({ client_id: client.id, code_hash: hash(client.id, code), expires_at: new Date(Date.now() + 15 * 60_000).toISOString() })
  await envoyerCodeClient(email, client.prenom, code)
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  const email = normEmail(b?.email)
  const sb = createAdminClient()
  const demoEmail = normEmail(await getBusinessText('vd_assistance_demo_email').catch(() => ''))
  const estDemo = !!demoEmail && email === demoEmail
  const trouver = async () => (await sb.from('espace_clients').select('*').ilike('email', email).eq('active', true).maybeSingle()).data

  try {
    if (b?.etape === 'inscrire') {
      const f = { prenom: txt(b.prenom, 60), nom: txt(b.nom, 80), tel: txt(b.tel, 30), adresse: txt(b.adresse, 300) }
      if (!email.includes('@') || Object.values(f).some(v => !v)) return NextResponse.json({ error: 'Tous les champs sont obligatoires.' }, { status: 400 })
      const v = await lireVehicule(b.vehicule)
      if (typeof v === 'string') return NextResponse.json({ error: v }, { status: 400 })
      if (!!v.societe.demo !== estDemo) return NextResponse.json({ error: estDemo ? 'Ce compte de test ne s’inscrit qu’au garage de démonstration.' : 'Ce garage de démonstration n’accepte que le compte de test.' }, { status: 403 })
      let c = await trouver()
      if (c?.verifie_le) {
        // Déjà inscrit : on ne réécrit rien sans code ; il se connecte et ajoute ce véhicule depuis l'app.
        if (!estDemo) await envoyer(sb, c, email)
        return NextResponse.json({ ok: true, dejaInscrit: true })
      }
      if (!c) {
        const { data, error } = await sb.from('espace_clients').insert({ email, ...f }).select('*').single()
        if (error) throw error
        c = data
      } else {
        await sb.from('espace_clients').update({ ...f, updated_at: new Date().toISOString() }).eq('id', c.id)
        c = { ...c, ...f }
      }
      // Le véhicule en attente de confirmation : remplacé tant que le compte n'est pas confirmé.
      await sb.from('espace_vehicules').delete().eq('client_id', c.id)
      const { error: ve } = await sb.from('espace_vehicules').insert({ client_id: c.id, societe_id: v.societe.id, garage_id: v.garage.id, plaque: v.plaque, marque: v.marque, modele: v.modele })
      if (ve) throw ve
      if (!estDemo) await envoyer(sb, c, email)
      return NextResponse.json({ ok: true })
    }

    if (b?.etape === 'code') {
      const c = await trouver()
      if (c && !estDemo) await envoyer(sb, c, email)
      return NextResponse.json({ ok: true, inconnu: !c })
    }

    if (b?.etape === 'verifier') {
      const code = String(b?.code || '').replace(/\D/g, '')
      const c = await trouver()
      if (!c || code.length !== 6) return NextResponse.json({ error: 'Code incorrect.' }, { status: 400 })
      if (estDemo) {
        const fixe = await getBusinessText('vd_assistance_demo_code').catch(() => '')
        if (!fixe || code !== fixe) return NextResponse.json({ error: 'Code incorrect.' }, { status: 400 })
      } else {
        const { data: k } = await sb.from('espace_client_codes').select('*').eq('client_id', c.id).is('used_at', null).gte('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (!k || k.tentatives >= 5) return NextResponse.json({ error: 'Code expiré : demandez-en un nouveau.' }, { status: 400 })
        if (k.code_hash !== hash(c.id, code)) {
          await sb.from('espace_client_codes').update({ tentatives: k.tentatives + 1 }).eq('id', k.id)
          return NextResponse.json({ error: 'Code incorrect.' }, { status: 400 })
        }
        await sb.from('espace_client_codes').update({ used_at: new Date().toISOString() }).eq('id', k.id)
      }
      const now = new Date().toISOString()
      await sb.from('espace_clients').update({ verifie_le: c.verifie_le || now, derniere_connexion: now }).eq('id', c.id)
      if (!c.verifie_le) {
        // Première confirmation : le garage du véhicule est averti, pour vérifier le client et cocher l'assistance.
        for (const v of await vehiculesDuClient(c.id)) await avertirGarage(v.societe, c, v, v.garage.nom).catch(() => {})
      }
      const res = NextResponse.json({ ok: true })
      res.cookies.set(CLIENT_COOKIE, signClient(c), clientCookieOptions)
      return res
    }

    if (b?.etape === 'supprimer') {
      const s = await getClientSession()
      if (!s) return NextResponse.json({ error: 'Session expirée : reconnectez-vous.' }, { status: 401 })
      const now = new Date().toISOString()
      await sb.from('espace_vehicules').update({ active: false, plaque: '', marque: null, modele: null, updated_at: now }).eq('client_id', s.client.id)
      await sb.from('espace_clients').update({
        active: false, email: `supprime-${s.client.id}@invalid`, prenom: 'Compte', nom: 'supprimé', tel: '', adresse: '',
        session_version: s.client.session_version + 1, updated_at: now,
      }).eq('id', s.client.id)
      await sb.from('espace_client_codes').delete().eq('client_id', s.client.id)
      await sb.from('espace_client_push').delete().eq('client_id', s.client.id)
      const res = NextResponse.json({ ok: true })
      res.cookies.set(CLIENT_COOKIE, '', { ...clientCookieOptions, maxAge: 0 })
      return res
    }
  } catch (e: any) {
    console.error('[VD Assistance] compte KO', e?.message)
    return NextResponse.json({ error: 'Le mail n’a pas pu partir. Réessayez dans un instant.' }, { status: 502 })
  }
  return NextResponse.json({ error: 'Demande inconnue' }, { status: 400 })
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(CLIENT_COOKIE, '', { ...clientCookieOptions, maxAge: 0 })
  return res
}
