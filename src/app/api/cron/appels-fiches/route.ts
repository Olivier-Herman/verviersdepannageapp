// src/app/api/cron/appels-fiches/route.ts — toutes les 15 minutes : relève les appels Teams des 3 dernières heures
// (Microsoft les livre 25 à 35 minutes après la fin) et rattache tout seuls ceux dont le numéro désigne une seule
// fiche (Olivier 24/11/2026). Le résultat du dernier passage est gardé dans app_settings « appels_fiches_dernier » :
// l'écran « Appels à rattacher » l'affiche quand le relevé échoue ou s'arrête.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { lireConfig } from '@/lib/supervision'
import { releverAppels } from '@/lib/supervision/appels'
import { lierAppels, completerNotes } from '@/lib/appels-fiches'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const erreurs: string[] = []
  let releves = 0, lies = 0, restants = 0
  try {
    const cfg = await lireConfig(sb)
    const d2 = new Date().toISOString()
    const r = await releverAppels(sb, cfg, new Date(Date.now() - 3 * 3600e3).toISOString(), d2)
    releves = r.n; erreurs.push(...r.erreurs)
  } catch (e: any) { erreurs.push(`Relevé : ${String(e?.message || e).slice(0, 160)}`) }
  try { ({ lies, restants } = await lierAppels(sb)) } catch (e: any) { erreurs.push(`Rattachement : ${String(e?.message || e).slice(0, 160)}`) }
  // Notes « En appel » d'abord complétées : elles font foi sur le rattachement automatique.
  let notes = { completees: 0, en_attente: 0 }
  try { notes = await completerNotes(sb) } catch (e: any) { erreurs.push(`Notes d’appel : ${String(e?.message || e).slice(0, 160)}`) }
  const etat = { at: new Date().toISOString(), releves, lies, restants, notes, erreurs }
  await sb.from('app_settings').upsert({ key: 'appels_fiches_dernier', value: JSON.stringify(etat), updated_at: etat.at }, { onConflict: 'key' })
  return NextResponse.json({ ok: !erreurs.length, ...etat })
}
