// ============================================================
// VERVIERS DÉPANNAGE — Cache des avis de paiement assureurs
// ============================================================
//
// Pourquoi ce fichier existe : lire la boîte mail à chaque affichage coûtait
// entre 30 et 90 secondes — une requête Graph par pièce jointe, et Claude sur
// chaque PDF AWP. Or un avis de paiement ne change JAMAIS une fois reçu. Le
// relire à chaque ouverture d'écran, c'est repayer le même travail.
//
// D'où la découpe :
//
//   1. Un cron (5 h et midi) liste les mails, ne lit que ceux qu'il n'a jamais
//      vus, et range le résultat dans `payment_advices`.
//   2. L'écran ne lit plus que cette table — instantané.
//   3. Au rapprochement, la pièce jointe part dans Odoo sur le virement, là où
//      un comptable ira la chercher, et on libère la place ici.
//
// L'idempotence tient sur `mail_id` : l'identifiant Graph d'un message. Deux
// crons qui se chevauchent produisent la même table.

import { createAdminClient } from '@/lib/supabase'
import {
  listAdviceMails, readAdviceMail,
  type PaymentAdvice, type AdviceDoc, type AdviceProvider,
} from '@/lib/payment-advices'

/** Colonnes d'affichage — jamais `doc_b64`, qui pèse des mégaoctets. */
const LIGHT_COLS =
  'provider,mail_id,subject,received_at,advice_date,reference,total,lines,checksum,warnings,' +
  'doc_name,doc_bytes,attached_move_id,attached_at,purged_at,parse_error,fetched_at'

/** Un avis est à relire tant qu'il n'a pas rendu une seule ligne exploitable. */
const needsRetry = (row: any) =>
  !!row.parse_error || !Array.isArray(row.lines) || row.lines.length === 0

function toAdvice(row: any): PaymentAdvice {
  return {
    provider:   row.provider as AdviceProvider,
    mailId:     row.mail_id,
    subject:    row.subject || '',
    receivedAt: new Date(row.received_at).toISOString(),
    adviceDate: row.advice_date ?? null,
    reference:  row.reference ?? null,
    total:      Number(row.total) || 0,
    lines:      Array.isArray(row.lines) ? row.lines : [],
    checksum:   row.checksum || { linesSum: 0, delta: 0, ok: false },
    warnings:   Array.isArray(row.warnings) ? row.warnings : [],
  }
}

export interface SyncResult {
  scanned: number       // mails vus dans la boîte
  read:    number       // mails effectivement ouverts (les nouveaux)
  cached:  number       // déjà connus, laissés tranquilles
  failed:  number
  errors:  string[]
}

/**
 * Met le cache à jour. Appelé par le cron, et à la demande depuis l'écran.
 *
 * `force` relit tout, y compris ce qui est déjà en cache — utile si un avis a
 * été mal extrait et qu'on a corrigé le prompt. Sans `force`, un mail déjà lu
 * n'est jamais rouvert : c'est tout l'intérêt.
 */
export async function syncAdvices(
  sinceIso: string,
  opts: { force?: boolean; max?: number } = {},
): Promise<SyncResult> {
  const sb   = createAdminClient()
  const refs = await listAdviceMails(sinceIso)
  const res: SyncResult = { scanned: refs.length, read: 0, cached: 0, failed: 0, errors: [] }
  if (!refs.length) return res

  const { data: known, error } = await sb
    .from('payment_advices')
    .select('mail_id,lines,parse_error')
    .in('mail_id', refs.map(r => r.id))
  if (error) throw new Error(`Cache des avis illisible : ${error.message}`)

  const byMail = new Map((known || []).map(r => [String(r.mail_id), r]))

  const todo = refs.filter(r => {
    const row = byMail.get(r.id)
    if (!row) return true
    if (opts.force) return true
    return needsRetry(row)
  })
  res.cached = refs.length - todo.length

  for (const ref of todo.slice(0, opts.max ?? 40)) {
    let advice: PaymentAdvice
    try {
      advice = await readAdviceMail(ref)
    } catch (e: any) {
      res.failed++
      res.errors.push(`${ref.subject.slice(0, 60)} : ${e?.message || e}`)
      continue
    }

    // Une lecture qui ne rend aucune ligne est notée comme telle : le prochain
    // passage la retentera, sans qu'elle bloque l'affichage entre-temps.
    const failed = advice.lines.length === 0
    if (failed) res.failed++
    else        res.read++

    const { error: upErr } = await sb.from('payment_advices').upsert({
      provider:    advice.provider,
      mail_id:     advice.mailId,
      subject:     advice.subject,
      received_at: advice.receivedAt,
      advice_date: advice.adviceDate,
      reference:   advice.reference,
      total:       advice.total,
      lines:       advice.lines,
      checksum:    advice.checksum,
      warnings:    advice.warnings,
      doc_name:    advice.doc?.name  ?? null,
      doc_mime:    advice.doc?.mime  ?? null,
      doc_bytes:   advice.doc?.bytes ?? null,
      doc_b64:     advice.doc?.b64   ?? null,
      parse_error: failed ? (advice.warnings.join(' · ') || 'Aucune ligne extraite') : null,
      fetched_at:  new Date().toISOString(),
    }, { onConflict: 'mail_id' })

    if (upErr) {
      res.errors.push(`${advice.subject.slice(0, 60)} : ${upErr.message}`)
    }
  }

  return res
}

export interface CachedAdvices {
  advices:   PaymentAdvice[]
  /** Date de la lecture la plus ancienne du lot — « avis à jour au … ». */
  fetchedAt: string | null
  /** Avis dont l'extraction n'a rien donné : signalés, pas masqués. */
  failed:    { subject: string; error: string }[]
}

/** Les avis en cache depuis `sinceIso`, du plus récent au plus ancien. */
export async function cachedAdvices(sinceIso: string): Promise<CachedAdvices> {
  const sb = createAdminClient()
  const { data, error } = await sb
    .from('payment_advices')
    .select(LIGHT_COLS)
    .gte('received_at', sinceIso)
    .order('received_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(500)
  if (error) throw new Error(`Cache des avis illisible : ${error.message}`)

  const rows = (data || []) as any[]
  const ok   = rows.filter(r => !needsRetry(r))

  return {
    advices:   ok.map(toAdvice),
    fetchedAt: rows.length
      ? rows.map(r => String(r.fetched_at)).sort()[0]
      : null,
    failed: rows.filter(needsRetry).map(r => ({
      subject: String(r.subject || ''),
      error:   String(r.parse_error || 'Aucune ligne extraite'),
    })),
  }
}

/** La pièce jointe d'un avis, tant qu'elle n'a pas été libérée. */
export async function adviceDoc(mailId: string): Promise<AdviceDoc | null> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('payment_advices')
    .select('doc_name,doc_mime,doc_bytes,doc_b64')
    .eq('mail_id', mailId)
    .maybeSingle()
  if (!data?.doc_b64) return null
  return {
    name:  String(data.doc_name || 'avis.pdf'),
    mime:  String(data.doc_mime || 'application/pdf'),
    bytes: Number(data.doc_bytes) || 0,
    b64:   String(data.doc_b64),
  }
}

/**
 * Le document est arrivé dans Odoo : on note où, et on libère la place ici.
 * Odoo devient l'archive ; nous ne gardons que la trace.
 */
export async function releaseAdviceDoc(mailId: string, odooMoveId: number): Promise<void> {
  const sb = createAdminClient()
  await sb.from('payment_advices').update({
    attached_move_id: odooMoveId,
    attached_at:      new Date().toISOString(),
    purged_at:        new Date().toISOString(),
    doc_b64:          null,
  }).eq('mail_id', mailId)
}
