// src/lib/courrier/actions.ts — exécution des gestes validés (« C'est ça » / « Faire ça »).
// Chaque geste rend un résultat lisible ; un geste en échec n'empêche pas les autres.

import { createAdminClient } from '@/lib/supabase'
import { sendNotification } from '@/lib/notifications/send'
import { sendEmail } from '@/lib/emails'
import { createDraftMail } from '@/lib/mail-agent/graph'
import { OUT_MAILBOX } from '@/lib/mail-agent/actions'
import { COMPANIES } from '@/lib/mail-agent/handlers/fournisseur'
import { ingestFineScan } from '@/lib/fines/ingest'
import type { PlanStep, StepResult } from './types'

type Page = { path: string; mime: string }
const ext = (mime: string) => mime === 'application/pdf' ? 'pdf' : mime.includes('png') ? 'png' : 'jpg'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function pageFiles(sb: any, pages: Page[]) {
  const out: { name: string; contentType: string; buf: Buffer }[] = []
  for (let i = 0; i < pages.length; i++) {
    const { data } = await sb.storage.from('courrier').download(pages[i].path)
    if (data) out.push({ name: `courrier-page-${i + 1}.${ext(pages[i].mime)}`, contentType: pages[i].mime, buf: Buffer.from(await data.arrayBuffer()) })
  }
  return out
}

export async function executePlan(courrier: { id: string; pages: Page[]; reading: any; created_at: string }, steps: PlanStep[], actorId: string, actorName: string): Promise<StepResult[]> {
  const sb = createAdminClient()
  const results: StepResult[] = []
  const day = new Date(courrier.created_at).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' })
  const sender = courrier.reading?.sender || 'expéditeur inconnu'
  let files: Awaited<ReturnType<typeof pageFiles>> | null = null
  const getFiles = async () => files || (files = await pageFiles(sb, courrier.pages))
  const attached = new Set<string>()

  const attach = async (missionId: string, kind: string) => {
    if (attached.has(missionId)) return
    const fs = await getFiles()
    for (const f of fs) {
      const path = `${missionId}/courrier/${Date.now()}_${f.name}`
      const up = await sb.storage.from('mission-documents').upload(path, f.buf, { contentType: f.contentType, upsert: false })
      if (up.error) throw new Error(`scan non rangé : ${up.error.message}`)
      await sb.from('mission_documents').insert({ mission_id: missionId, kind, file_path: path, file_name: f.name, mime_type: f.contentType, file_size: f.buf.length, uploaded_by: actorId })
    }
    attached.add(missionId)
  }

  for (const s of steps) {
    const p = s.params || {}
    try {
      switch (s.kind) {
        case 'attach_mission': {
          await attach(p.mission_id, 'courrier')
          await sb.from('mission_logs').insert({ mission_id: p.mission_id, actor_id: actorId, action: 'courrier_attached', notes: `Courrier de ${sender} (reçu le ${day}) rangé dans le dossier par ${actorName}.`, metadata: { courrier_id: courrier.id } })
          results.push({ kind: s.kind, ok: true, note: 'Scan rangé dans la fiche.' }); break
        }
        case 'requisitoire_received': {
          await attach(p.mission_id, 'requisitoire')
          const { data: m } = await sb.from('incoming_missions').select('requisitoire_at').eq('id', p.mission_id).maybeSingle()
          if (!m?.requisitoire_at) await sb.from('incoming_missions').update({ requisitoire_at: new Date().toISOString(), requisitoire_by: actorId, requisitoire_note: `Reçu par courrier (${sender}, ${day})`, updated_at: new Date().toISOString() }).eq('id', p.mission_id)
          await sb.from('mission_logs').insert({ mission_id: p.mission_id, actor_id: actorId, action: 'requisitoire_courrier', notes: `Réquisitoire reçu par courrier (${sender}, ${day}), rangé par ${actorName}${m?.requisitoire_at ? ' (déjà marqué reçu)' : ' : relances arrêtées'}.`, metadata: { courrier_id: courrier.id } })
          results.push({ kind: s.kind, ok: true, note: m?.requisitoire_at ? 'Scan rangé ; le réquisitoire était déjà marqué reçu.' : 'Réquisitoire marqué reçu, scan rangé dans la fiche.' }); break
        }
        case 'task': {
          const due = new Date(); due.setDate(due.getDate() + Math.max(0, Number(p.due_days) || 0)); due.setHours(18, 0, 0, 0)
          const { data: t } = await sb.from('courrier_tasks').insert({ courrier_id: courrier.id, assignee_id: p.assignee_id, title: String(p.title).slice(0, 300), due_at: due.toISOString(), created_by: actorId }).select('id').single()
          await sendNotification(p.assignee_id, 'courrier_task', { title: 'Courrier : tâche pour vous', body: String(p.title).slice(0, 180), action_url: `/courrier?c=${courrier.id}` } as any).catch(() => null)
          results.push({ kind: s.kind, ok: !!t, note: t ? 'Tâche créée et notifiée.' : 'Tâche non créée.' }); break
        }
        case 'notify': {
          const r: any = await sendNotification(p.user_id, 'courrier_task', { title: `Courrier de ${sender}`, body: String(p.message).slice(0, 200), action_url: `/courrier?c=${courrier.id}` } as any)
          results.push({ kind: s.kind, ok: !!r?.ok, note: r?.ok ? 'Personne prévenue.' : 'Notification non partie.' }); break
        }
        case 'draft_reply': {
          const fs = await getFiles()
          const html = `<div style="font-family:Arial,sans-serif;font-size:14px">${esc(String(p.body)).replace(/\n/g, '<br>')}</div>`
          const d = await createDraftMail(OUT_MAILBOX, { to: p.to_email || null, toName: p.to_name || null, subject: String(p.subject), html,
            attachments: fs.map(f => ({ name: f.name, contentType: f.contentType, contentBytes: f.buf.toString('base64') })) })
          results.push({ kind: s.kind, ok: d.ok, note: d.ok ? `Brouillon prêt dans ${OUT_MAILBOX}${p.to_email ? '' : ' (destinataire à compléter)'} : à relire avant envoi.` : `Brouillon non créé : ${d.error}` }); break
        }
        case 'supplier_invoice': {
          const co = COMPANIES[p.company as keyof typeof COMPANIES]
          const fs = await getFiles()
          await sendEmail(co.alias, `Facture fournisseur — ${sender}${courrier.reading?.reference ? ` — ${courrier.reading.reference}` : ''}`,
            `<p>Facture reçue par courrier le ${day}, transmise à l'encodage ${esc(co.label)}.</p>`, undefined, undefined,
            fs.map(f => ({ name: f.name, contentType: f.contentType, contentBytes: f.buf.toString('base64') })), OUT_MAILBOX)
          results.push({ kind: s.kind, ok: true, note: `Transmise à l’encodage des achats ${co.label}.` }); break
        }
        case 'fine': {
          // Module Amendes : même entrée que la capture par lot (lecture, anti-doublon,
          // chauffeur du jour, brouillon). Un PV = un fichier : on transmet la 1re page
          // (le PDF entier s'il s'agit d'un PDF).
          const fs = await getFiles()
          const f = fs[0]; if (!f) throw new Error('aucune page')
          const r = await ingestFineScan(sb, { buffer: f.buf, mime: f.contentType, ext: f.contentType.includes('pdf') ? 'pdf' : 'jpg', actorId })
          if (r.status === 'duplicate') { results.push({ kind: s.kind, ok: true, note: `Déjà dans le module Amendes (PV ${r.ref}) : rien créé en double.` }); break }
          let who = ''
          if (r.fine.driver_id) { const { data: u } = await sb.from('users').select('name').eq('id', r.fine.driver_id).maybeSingle(); if (u?.name) who = `, chauffeur du jour : ${u.name}` }
          results.push({ kind: s.kind, ok: true, note: `Transmise au module Amendes : PV ${r.fine.infraction_ref || 'sans numéro lu'}, plaque ${r.fine.plate}${who}. La suite se fait dans Amendes.` }); break
        }
        case 'file_only': results.push({ kind: s.kind, ok: true, note: 'Classé dans le registre.' }); break
      }
    } catch (e: any) { results.push({ kind: s.kind, ok: false, note: e?.message || 'échec' }) }
  }
  return results
}
