// Check camion par le chauffeur — côté serveur (Olivier 30/09/2026).
// Qui voit les rapports au bureau, envoi du mail, notification des téléphones.
import sharp from 'sharp'
import { createAdminClient } from '@/lib/supabase'
import { sendEmail, emailLayout } from '@/lib/emails'
import { getBusinessList } from '@/lib/settings/business'
import { sendPushToUser } from '@/lib/push'
import { LEVEL_LABEL_FR, levelEmoji } from './levels'

export const PHOTO_BUCKET = 'check-photos'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'

export function photoUrl(sb: any, path: string): string {
  return sb.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl
}

/** Responsables des contrôles (réglage du module Check Véhicule). */
async function checkResponsibles(sb: any): Promise<string[]> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'check_responsible_ids').maybeSingle()
  try { return data?.value ? (JSON.parse(data.value) as string[]) : [] } catch { return [] }
}

/** Voit les rapports (fenêtre au bureau, liste complète) : admins, dispatchers, responsables des contrôles. */
export async function isReportViewer(sb: any, user: { id: string; role?: string; roles?: string[] | null }): Promise<boolean> {
  const roles = [user.role, ...(user.roles || [])]
  if (roles.some(r => ['admin', 'superadmin', 'dispatcher'].includes(String(r)))) return true
  return (await checkResponsibles(sb)).includes(user.id)
}

async function officeUserIds(sb: any): Promise<string[]> {
  const [{ data }, resp] = await Promise.all([
    sb.from('users').select('id').eq('active', true).or('role.in.(admin,superadmin,dispatcher),roles.ov.{admin,superadmin,dispatcher}'),
    checkResponsibles(sb),
  ])
  return [...new Set([...(data || []).map((u: any) => u.id), ...resp])]
}

export async function loadCheck(sb: any, id: string) {
  const [{ data: c }, { data: an }] = await Promise.all([
    sb.from('truck_checks').select('*').eq('id', id).maybeSingle(),
    sb.from('truck_check_anomalies').select('*').eq('check_id', id).order('level', { ascending: false }).order('sort'),
  ])
  if (!c) return null
  return { ...c, anomalies: (an || []).map((a: any) => ({ ...a, photo_urls: (a.photos || []).map((p: string) => photoUrl(sb, p)) })) }
}

const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Mail du rapport (depuis administration@) + notification des téléphones du bureau. Jamais bloquant. */
export async function dispatchReport(checkId: string): Promise<void> {
  const sb = createAdminClient()
  const c = await loadCheck(sb, checkId)
  if (!c) return
  const when = new Date(c.created_at).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', dateStyle: 'short', timeStyle: 'short' })
  const counts = [5, 4, 3, 2, 1].map(l => ({ l, n: c.anomalies.filter((a: any) => a.level === l).length })).filter(x => x.n)
  const worst = c.anomalies.length ? `${levelEmoji(c.max_level)} ` : '✅ '
  const summary = c.anomalies.length
    ? `${c.anomalies.length} anomalie${c.anomalies.length > 1 ? 's' : ''}${c.max_level >= 4 ? ` dont ${counts[0].n} ${LEVEL_LABEL_FR[counts[0].l].toLowerCase()}` : ''}`
    : 'rien à signaler'
  const subject = `${worst}Check véhicule ${c.truck_plate} — ${summary} — ${c.driver_name || 'chauffeur'}`
  const link = `${APP_URL}/check-vehicule/rapport/${c.id}`

  // Mail : photos réduites en pièces jointes (plafond ~12 Mo).
  try {
    const to = await getBusinessList('check_camion_destinataires')
    const rows = c.anomalies.map((a: any) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;white-space:nowrap">${levelEmoji(a.level)} ${LEVEL_LABEL_FR[a.level]}</td><td style="padding:6px 8px;border-bottom:1px solid #eee"><b>${esc(a.title)}</b>${a.description ? `<br>${esc(a.description)}` : ''}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${(a.photos || []).length}</td></tr>`).join('')
    const html = emailLayout(`
<p><b>${esc(c.truck_name || '')} ${esc(c.truck_plate)}</b> · kilométrage <b>${Number(c.mileage).toLocaleString('fr-BE')} km</b> · check par ${esc(c.driver_name || '—')} le ${when}</p>
${c.comment ? `<p style="background:#f3f4f6;border-radius:8px;padding:8px 10px"><b>Commentaire du chauffeur :</b> ${esc(c.comment)}</p>` : ''}
${c.anomalies.length ? `<table style="border-collapse:collapse;width:100%;font-size:14px"><tr><th style="text-align:left;padding:6px 8px">Niveau</th><th style="text-align:left;padding:6px 8px">Anomalie</th><th style="padding:6px 8px">Photos</th></tr>${rows}</table>` : '<p>✅ Rien à signaler.</p>'}
<p><a href="${link}">Ouvrir le rapport dans VD Soft</a></p>`, 'Check véhicule')
    const attachments: { name: string; contentType: string; contentBytes: string }[] = []
    let bytes = 0
    for (const a of c.anomalies) {
      let k = 0
      for (const p of a.photos || []) {
        if (bytes > 12_000_000) break
        const { data: f } = await sb.storage.from(PHOTO_BUCKET).download(p)
        if (!f) continue
        const small = await sharp(Buffer.from(await f.arrayBuffer())).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer().catch(() => null)
        if (!small) continue
        bytes += small.length
        attachments.push({ name: `${c.truck_plate} - ${levelEmoji(a.level)} ${a.title.slice(0, 40).replace(/[\\/:*?"<>|]/g, '')} ${++k}.jpg`, contentType: 'image/jpeg', contentBytes: small.toString('base64') })
      }
    }
    await sendEmail(to[0], subject, html, undefined, to.slice(1), attachments)
    await sb.from('truck_checks').update({ mail_sent_at: new Date().toISOString(), mail_error: null }).eq('id', c.id)
  } catch (e: any) {
    await sb.from('truck_checks').update({ mail_error: String(e?.message || e).slice(0, 500) }).eq('id', c.id)
  }

  // Téléphones du bureau (la fenêtre s'ouvre aussi dans l'app, voir TruckCheckPopup).
  try {
    const ids = (await officeUserIds(sb)).filter(id => id !== c.driver_id)
    await Promise.all(ids.map(id => sendPushToUser(id, { title: `${worst}Check véhicule ${c.truck_plate}`, body: `${c.driver_name || 'Un chauffeur'} · ${summary}`, url: `/check-vehicule/rapport/${c.id}`, tag: `truck-check-${c.id}` }).catch(() => null)))
  } catch { /* confort */ }
}
