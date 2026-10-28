// src/app/api/cron/tri-mails-info/route.ts — rangement des mails PUREMENT automatiques d'info@ (Olivier 28/10/2026,
// point 4 des optimisations). La boîte de réception d'info@ est celle de Momo : on ne range que ce qui ne demande
// d'action à personne (codes de connexion, avis de livraison, plannings, sondages, publicités), selon les règles du
// réglage tri_mails_info_regles : [{ "de": "<expéditeur>", "sujet"?: "<regex>", "dossier": "<nom>", "apresJours"?: n }].
// Le dossier est cherché sous la boîte de réception, puis à la racine. Toutes les heures ; bloc « Tri des mails
// d'info@ » de « Mes assistants ».
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getAppOnlyToken } from '@/lib/graph-mail-search'
import { MAIL_AGENT_MAILBOX } from '@/lib/mail-agent'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BOITE = MAIL_AGENT_MAILBOX   // info@
type Regle = { de: string; sujet?: string; dossier: string; apresJours?: number }

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  { const { assistantEnPause, SKIP_PAUSE } = await import('@/lib/facturation/suspension'); if (await assistantEnPause(sb, 'tri_mails')) return NextResponse.json(SKIP_PAUSE) }
  const { data: r } = await sb.from('app_settings').select('value').eq('key', 'tri_mails_info_regles').maybeSingle()
  let regles: Regle[] = []
  try { regles = typeof r?.value === 'string' ? JSON.parse(r.value) : (r?.value || []) } catch { /* illisible */ }
  if (!regles.length) return NextResponse.json({ ok: true, ranges: 0, raison: 'aucune règle' })

  const tok = await getAppOnlyToken()
  if (!tok) return NextResponse.json({ ok: false, error: 'Graph indisponible' }, { status: 500 })
  const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }
  const g = async (u: string) => (await fetch(`https://graph.microsoft.com/v1.0/users/${BOITE}${u}`, { headers: H, cache: 'no-store' })).json()
  const dossiers = new Map<string, string>()
  for (const base of ['/mailFolders/inbox/childFolders', '/mailFolders/msgfolderroot/childFolders']) {
    const j: any = await g(`${base}?$top=250&$select=id,displayName`)
    for (const f of j.value || []) if (!dossiers.has(String(f.displayName).toLowerCase())) dossiers.set(String(f.displayName).toLowerCase(), f.id)
  }
  const ranges: string[] = [], erreurs: string[] = []
  for (const rg of regles) {
    const dest = dossiers.get(rg.dossier.toLowerCase())
    if (!dest) { erreurs.push(`dossier introuvable : ${rg.dossier}`); continue }
    const avant = new Date(Date.now() - (rg.apresJours || 0) * 86_400_000).toISOString()
    const j: any = await g(`/mailFolders/inbox/messages?$top=50&$select=id,subject,receivedDateTime&$filter=${encodeURIComponent(`from/emailAddress/address eq '${rg.de.replace(/'/g, "''")}' and receivedDateTime le ${avant}`)}`)
    if (j.error) { erreurs.push(`${rg.de} : ${j.error.message}`); continue }
    for (const m of j.value || []) {
      if (rg.sujet && !new RegExp(rg.sujet, 'i').test(m.subject || '')) continue
      const res = await fetch(`https://graph.microsoft.com/v1.0/users/${BOITE}/messages/${m.id}/move`, { method: 'POST', headers: H, body: JSON.stringify({ destinationId: dest }) })
      if (res.ok) ranges.push(`${rg.de} → ${rg.dossier} : ${String(m.subject || '').slice(0, 60)}`); else erreurs.push(`${rg.de} : déplacement ${res.status}`)
    }
  }
  await sb.from('app_settings').upsert({ key: 'tri_mails_info_last_run', value: JSON.stringify({ at: new Date().toISOString(), ranges: ranges.length, erreurs }) }, { onConflict: 'key' }).then(() => {}, () => {})
  return NextResponse.json({ ok: !erreurs.length, ranges, erreurs })
}
