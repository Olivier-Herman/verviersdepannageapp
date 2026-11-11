// src/lib/saisies/retour-signe.ts
//
// Enregistre le retour signé du Parquet sur un état de frais : document rangé,
// état de frais et dossier « accepté » (ou « refusé »), remarque sur la fiche,
// dépôt JustInvoice si le robot est en mode envoi. Partagé par le dépôt manuel
// (validation-upload) et la file des retours non lus (P2, 11/11/2026).

import { autoDepositIfAuto } from '@/lib/justinvoice/deposit'

export async function enregistrerRetourSigne(sb: any, opts: {
  dossierId: string; efId: string | null; contenu: Uint8Array; nom: string; type?: string; refus: boolean; userId: string | null; origine: string
}): Promise<{ ok: true; deposit: any; numero: string | null } | { ok: false; status: number; error: string }> {
  const { data: d } = await sb.from('saisie_dossiers').select('id, mission_id, ef_number').eq('id', opts.dossierId).maybeSingle()
  if (!d) return { ok: false, status: 404, error: 'Dossier introuvable' }

  const safe = opts.nom.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'signe.pdf'
  const path = `saisie-validation/${d.id}/${Date.now()}_${safe}`
  const { error: upErr } = await sb.storage.from('mission-remarks').upload(path, opts.contenu, { contentType: opts.type || 'application/pdf', upsert: false })
  if (upErr) return { ok: false, status: 500, error: upErr.message }

  const now = new Date().toISOString()
  // Rattache à l'état de frais ciblé ou, à défaut, au plus ancien « envoyé ».
  const q = sb.from('saisie_etats_frais').select('id, numero').eq('dossier_id', d.id)
  const { data: efRow } = opts.efId
    ? await q.eq('id', opts.efId).maybeSingle()
    : await q.eq('status', 'envoye').order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (efRow) await sb.from('saisie_etats_frais').update({ status: opts.refus ? 'refuse' : 'accepte', validation_doc_path: path, validation_at: now }).eq('id', efRow.id)

  await sb.from('saisie_dossiers').update({
    validation_doc_path: path, validation_at: now, state: opts.refus ? 'refuse' : 'accepte',
    notes: `${opts.refus ? 'Refusé' : 'Accepté'} par le Parquet (${opts.origine}${efRow?.numero ? ' — ' + efRow.numero : ''}).`,
    updated_at: now,
  }).eq('id', d.id)

  if (d.mission_id) {
    await sb.from('mission_remarks')
      .insert({ mission_id: d.mission_id, text: `${opts.refus ? '❌ Refus' : '✅ Accord'} Parquet — état de frais ${efRow?.numero || d.ef_number || ''} (${opts.origine})`, created_by: opts.userId })
      .then(() => {}, () => {})
  }
  let deposit: any = null
  if (!opts.refus && efRow) deposit = await autoDepositIfAuto(sb, d.id, efRow.id)
  return { ok: true, deposit, numero: efRow?.numero || null }
}
