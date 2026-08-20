// src/app/api/ventes/confirm/route.ts
//
// GET /api/ventes/confirm?token=…  → l'auteur d'une offre clique le lien reçu
// par e-mail : l'offre passe de 'pending' à 'confirmed' et compte enfin.
//
// Réponse en HTML, pas en JSON : c'est un lien qu'on ouvre dans un navigateur.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function page(title: string, body: string, ok: boolean) {
  return new NextResponse(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${title}</title>
     <style>
       body{margin:0;background:#F1F1F0;color:#0A0D0F;font-family:system-ui,-apple-system,sans-serif;
            display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
       .c{background:#fff;border:1px solid #D6D6D4;border-radius:18px;padding:32px;max-width:460px;text-align:center}
       h1{font-size:1.35rem;margin:0 0 12px;color:${ok ? '#1E7A4A' : '#D92132'}}
       p{margin:0 0 10px;line-height:1.6;color:#3B4045}
       b{color:#0A0D0F}
     </style></head>
     <body><div class="c"><h1>${title}</h1>${body}</div></body></html>`,
    { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') || ''
  if (!token) return page('Lien incomplet', '<p>Ce lien ne contient pas de jeton de confirmation.</p>', false)

  const sb = createAdminClient()
  const { data: bid } = await sb.from('vehicle_sale_bids')
    .select('id, sale_id, amount, confirmed_at, status').eq('confirm_token', token).maybeSingle()

  if (!bid) return page('Lien inconnu', '<p>Cette offre n’existe plus, ou le lien a déjà été utilisé.</p>', false)

  if (bid.confirmed_at) {
    return page('Offre déjà confirmée',
      `<p>Votre offre de <b>${Number(bid.amount).toLocaleString('fr-BE')} €</b> est bien enregistrée.</p>
       <p>Vous serez prévenu à la clôture.</p>`, true)
  }

  const { data: sale } = await sb.from('vehicle_sales')
    .select('title, status, closes_at').eq('id', bid.sale_id).maybeSingle()

  if (!sale || sale.status !== 'published') {
    return page('Vente terminée',
      '<p>Ce véhicule n’accepte plus d’offres. Appelez le <b>087 35 18 20</b> si vous êtes toujours intéressé.</p>', false)
  }
  if (sale.closes_at && new Date(sale.closes_at) <= new Date()) {
    return page('Clôture dépassée',
      '<p>La date de clôture est passée avant la confirmation. Appelez le <b>087 35 18 20</b>.</p>', false)
  }

  await sb.from('vehicle_sale_bids')
    .update({ confirmed_at: new Date().toISOString(), status: 'confirmed', confirm_token: null })
    .eq('id', bid.id)

  return page('Offre confirmée',
    `<p>Votre offre de <b>${Number(bid.amount).toLocaleString('fr-BE')} €</b> sur <b>${sale.title}</b> est enregistrée.</p>
     <p>Vous serez prévenu à la clôture, qu’elle soit retenue ou non.</p>
     <p>Verviers Dépannage — 087 35 18 20</p>`, true)
}
