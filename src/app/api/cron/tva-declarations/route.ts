// src/app/api/cron/tva-declarations/route.ts
//
// Cron : mails « … - DECLARATION TVA MM-AAAA » du cabinet comptable (info@, 7 derniers jours) → une proposition
// « Déclaration TVA encodée en facture » de Victor par mail, à valider par Mobi (Olivier 23/10/2026). Une fois validée,
// la facture apparaît dans les lots de paiement de Momo. DGJ ignorée (pas de relevés dans l'ERP). Protégé par CRON_SECRET.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { chercherDeclarations, lireDeclaration, factureExistante } from '@/lib/agents/tva-declaration'
import { submitProposal }    from '@/lib/agents/proposals'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const res = { mails: 0, proposees: 0, deja: 0, ignorees: 0, erreurs: [] as string[] }
  try {
    const { data: victor } = await sb.from('agent_accounts').select('id, name, role_label, companies, kinds, direct_kinds, validator_user_id, active').eq('name', 'Victor').maybeSingle()
    if (!victor?.active) throw new Error('Agent Victor introuvable ou inactif')
    const mails = await chercherDeclarations(new Date(Date.now() - 7 * 86400e3).toISOString())
    res.mails = mails.length
    for (const m of mails) {
      try {
        const { data: twin } = await sb.from('agent_proposals').select('id').eq('kind', 'declaration_tva').eq('payload->>message_id', m.id).limit(1).maybeSingle()
        if (twin) { res.deja++; continue }
        const { decl } = await lireDeclaration(m.id)
        if (decl.societe === 3) { res.ignorees++; continue }
        if (await factureExistante(decl)) { res.deja++; continue }
        await submitProposal(victor as any, { type: 'declaration_tva', societe: decl.societe, contenu: { message_id: m.id },
          pourquoi: `Mail du cabinet comptable du ${decl.recu_le.slice(0, 10).split('-').reverse().join('/')} « ${decl.sujet} » : ${decl.montant.toFixed(2)} € à payer au service TVA avant le ${decl.echeance.split('-').reverse().join('/')}, communication ${decl.communication}. À encoder en facture pour la présenter dans le lot de paiement (règle de Mobi du 23/10/2026).` })
        res.proposees++
      } catch (e: any) { res.erreurs.push(`${m.sujet} : ${e?.message || e}`) }
    }
    await sb.from('app_settings').upsert({ key: 'tva_declarations_last_run', value: JSON.stringify({ at: new Date().toISOString(), ...res }), updated_at: new Date().toISOString() }, { onConflict: 'key' }).then(() => {}, () => {})
    return NextResponse.json({ ok: res.erreurs.length === 0, ...res }, { status: res.erreurs.length ? 500 : 200 })
  } catch (err: any) {
    console.error('[cron tva-declarations] KO:', err?.message)
    return NextResponse.json({ error: err?.message || 'Erreur' }, { status: 500 })
  }
}
