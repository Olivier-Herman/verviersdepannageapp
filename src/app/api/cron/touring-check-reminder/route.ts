// src/app/api/cron/touring-check-reminder/route.ts
//
// Cron mensuel (le 5 à 13h) : rapproche d'abord via les accords, reconstruit la
// liste des dossiers Touring hors comex restants, puis envoie un mail à Touring
// avec le lien pour trancher. N'envoie rien s'il n'y a aucun dossier.
// Auth : Bearer CRON_SECRET.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { reconcileHorsComexWithAccords } from '@/lib/touring/accord-reconcile'
import { buildTouringCheckList } from '@/lib/touring/check-list'
import { persistCheckList } from '@/lib/touring/check-persist'
import { getCheckToken, getCheckEmail, checkLink, CHECK_EMAIL_CC, CHECK_EMAIL_BCC } from '@/lib/touring/check-config'
import { sendEmail, emailLayout } from '@/lib/emails'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

function buildHtml(count: number, link: string): string {
  const now = new Date()
  const mois = `${MONTHS_FR[now.getMonth()]} ${now.getFullYear()}`
  return emailLayout(`
    <h1 style="margin:0 0 6px;font-size:20px;color:#16181d;">Dossiers à vérifier</h1>
    <p style="margin:0 0 14px;font-size:14.5px;color:#3d4250;">Bonjour,</p>
    <p style="margin:0 0 14px;font-size:14.5px;color:#3d4250;">Voici notre relevé (${mois}) des dossiers Touring <b>hors COMEX</b> en attente de votre décision (déjà facturé, à facturer hors comex, contrat 105 non couvert, …).</p>
    <div style="display:flex;align-items:center;gap:14px;background:#f6f7f9;border:1px solid #e3e6ea;border-radius:12px;padding:16px 18px;margin:18px 0;">
      <div style="font-size:34px;font-weight:800;color:#d6002a;font-family:monospace;line-height:1;">${count}</div>
      <div style="font-size:13.5px;color:#3d4250;"><b>dossier${count > 1 ? 's' : ''}</b> attend${count > 1 ? 'ent' : ''} votre retour.<br>Cliquez ci-dessous pour les traiter directement en ligne — plus besoin de renvoyer un Excel.</div>
    </div>
    <p style="font-size:12.5px;color:#0a7d4f;background:#e6f5ec;border-radius:8px;padding:8px 12px;margin:0 0 18px;">✓ Nous avons déjà rapproché de notre côté les dossiers présents dans vos accords — cette liste ne contient que les dossiers restants.</p>
    <a href="${link}" style="display:inline-block;background:#d6002a;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 26px;border-radius:10px;">Ouvrir la liste des dossiers →</a>
    <p style="font-size:12px;color:#9aa1ac;margin-top:18px;">Ce lien reste toujours à jour : vous pouvez l'ouvrir quand vous voulez, il affichera à chaque fois les dossiers restants. Merci !</p>
  `, `Dossiers Touring à vérifier — ${mois}`)
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient()
  try {
    const reconcile = await reconcileHorsComexWithAccords(sb, null)
    const items = await buildTouringCheckList(sb)
    await persistCheckList(sb, items)

    if (!items.length) {
      return NextResponse.json({ ok: true, reconciled: reconcile.reconciled, count: 0, mailed: false, reason: 'aucun dossier' })
    }

    const [token, email] = await Promise.all([getCheckToken(sb), getCheckEmail(sb)])
    const now = new Date()
    const mois = `${MONTHS_FR[now.getMonth()]} ${now.getFullYear()}`
    await sendEmail(email, `Dossiers Touring à vérifier — ${mois}`, buildHtml(items.length, checkLink(token)), 'Touring BKO', CHECK_EMAIL_CC, undefined, undefined, CHECK_EMAIL_BCC)

    return NextResponse.json({ ok: true, reconciled: reconcile.reconciled, count: items.length, mailed: true, to: email })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'échec' }, { status: 502 })
  }
}
