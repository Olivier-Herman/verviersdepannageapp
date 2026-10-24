// Surveillance du PC d'impression de Pepinster (Olivier 18/10/2026) : après une coupure de courant, les étiquettes
// sont restées en attente toute la matinée sans que personne le sache. Appelé par le cron print-queue (toutes les 2 min) :
// PC injoignable depuis 10 min, ou étiquette en attente depuis 10 min → message privé à Mobi sur Telegram ;
// retour à la normale → second message. Un seul message par panne.
import { createAdminClient } from '@/lib/supabase'
import { notifierTelegram } from '@/lib/notif/heures-mobi'

const KEY = 'zebra_health'
const SEUIL_MS = 10 * 60 * 1000

type Etat = { down_since: string | null; alerted: boolean; last_error?: string | null }

async function pcRepond(): Promise<{ ok: boolean; error?: string }> {
  const url = (process.env.ZEBRA_REMOTE || '').replace(/\/$/, '')
  if (!url) return { ok: false, error: 'adresse du PC d’impression non configurée' }
  try {
    const r = await fetch(`${url}/`, { headers: { 'ngrok-skip-browser-warning': 'true' }, cache: 'no-store', signal: AbortSignal.timeout(10000) })
    if (r.ok) return { ok: true }
    return { ok: false, error: r.headers.get('ngrok-error-code') === 'ERR_NGROK_3200' ? 'PC hors ligne (éteint, en veille ou sans internet)' : `réponse ${r.status}` }
  } catch (e: any) { return { ok: false, error: e?.message || 'injoignable' } }
}

export async function surveillerImprimante(): Promise<{ ok: boolean; alerte?: string }> {
  const sb = createAdminClient()
  const { data: row } = await sb.from('app_settings').select('value').eq('key', KEY).maybeSingle()
  let etat: Etat = { down_since: null, alerted: false }
  try { if (row?.value) etat = { ...etat, ...JSON.parse(row.value) } } catch { /* valeur illisible : on repart de zéro */ }

  const pc = await pcRepond()
  // Étiquettes en attente depuis plus de 10 min (le PC peut répondre alors que l'impression échoue)
  const { data: vieilles } = await sb.from('print_queue').select('id, created_at, last_error').eq('status', 'pending')
    .lt('created_at', new Date(Date.now() - SEUIL_MS).toISOString()).order('created_at').limit(50)
  const panne = !pc.ok || (vieilles || []).length > 0
  const now = new Date()
  let alerte: string | undefined

  const envoyer = async (text: string) => {
    try {
      const { getBusinessNumber } = await import('@/lib/settings/business')
      const { tgSend } = await import('@/lib/sam/telegram')
      await notifierTelegram(await getBusinessNumber('telegram_chat_mobi'), text, [], 'Imprimante', { urgent: true })   // panne = urgence, à toute heure (Olivier 24/10/2026)
    } catch (e: any) { console.error('[zebra-health] telegram', e?.message) }
  }

  if (panne) {
    if (!etat.down_since) etat = { down_since: now.toISOString(), alerted: false }
    const depuis = new Date(etat.down_since!)
    if (!etat.alerted && now.getTime() - depuis.getTime() >= SEUIL_MS) {
      const h = depuis.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })
      const n = (vieilles || []).length
      alerte = `🖨️ Étiquettes bloquées à Pepinster depuis ${h}\n`
        + (!pc.ok ? `Le PC d’impression ne répond plus : ${pc.error}.\n` : `Le PC répond, mais ${n} étiquette${n > 1 ? 's' : ''} n’arrive${n > 1 ? 'nt' : ''} pas à sortir (${(vieilles || [])[0]?.last_error || '?'}).\n`)
        + (n ? `${n} étiquette${n > 1 ? 's' : ''} en attente : elles sortiront d’elles-mêmes au retour.\n` : '')
        + `À vérifier sur place : courant, imprimante allumée (voyant vert), PC allumé avec la session ouverte et les deux fenêtres noires.`
      await envoyer(alerte)
      etat.alerted = true
    }
    etat.last_error = pc.ok ? (vieilles || [])[0]?.last_error || null : pc.error || null
  } else if (etat.down_since) {
    if (etat.alerted) {
      const d = Math.round((now.getTime() - new Date(etat.down_since).getTime()) / 60000)
      await envoyer(`✅ Impression rétablie à Pepinster (panne d’environ ${d >= 60 ? `${Math.floor(d / 60)} h ${String(d % 60).padStart(2, '0')}` : `${d} min`}). Vérifie que les étiquettes en attente sont bien sorties.`)
    }
    etat = { down_since: null, alerted: false, last_error: null }
  }
  await sb.from('app_settings').upsert({ key: KEY, value: JSON.stringify(etat) }, { onConflict: 'key' })
  return { ok: !panne, alerte }
}
