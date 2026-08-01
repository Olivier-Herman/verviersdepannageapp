// src/lib/paie/fetch-mail.ts
//
// Récupère les mails mensuels EasyPay dans info@ (Graph app-only) et télécharge
// le ZIP de paie. Sujets : « … ( 438) Traitement mensuel - Période MM/AAAA »
// (Verviers Dépannage) et « … (3068) … » (DGJ VHU).

import { getAppToken } from '@/lib/emails'

const MAILBOX = 'info@verviersdepannage.com'

export interface PayslipMail {
  messageId: string; subject: string; companyCode: string; period: string; zipBuffer: Buffer
}

export async function fetchPayslipMails(): Promise<PayslipMail[]> {
  const token = await getAppToken()
  const H = { Authorization: `Bearer ${token}` }

  const url = `https://graph.microsoft.com/v1.0/users/${MAILBOX}/messages?$search="Traitement mensuel"&$select=id,subject,receivedDateTime,hasAttachments&$top=10`
  const r = await fetch(url, { headers: H })
  const j = await r.json()
  const msgs = (j.value || []).filter((m: any) => m.hasAttachments && /Traitement mensuel/i.test(m.subject))

  const out: PayslipMail[] = []
  for (const m of msgs) {
    const cc = (m.subject.match(/\(\s*(\d+)\s*\)/) || [])[1]      // 438 / 3068
    const pm = m.subject.match(/(\d{2})\/(\d{4})/)                 // 07/2026
    if (!cc || !pm) continue
    const period = `${pm[2]}-${pm[1]}`

    const ar = await fetch(`https://graph.microsoft.com/v1.0/users/${MAILBOX}/messages/${m.id}/attachments?$select=id,name,contentType,size`, { headers: H })
    const aj = await ar.json()
    const zip = (aj.value || []).find((a: any) => /\.zip$/i.test(a.name))
    if (!zip) continue

    const zr = await fetch(`https://graph.microsoft.com/v1.0/users/${MAILBOX}/messages/${m.id}/attachments/${zip.id}`, { headers: H })
    const zj = await zr.json()
    if (!zj.contentBytes) continue

    out.push({ messageId: m.id, subject: m.subject, companyCode: cc, period, zipBuffer: Buffer.from(zj.contentBytes, 'base64') })
  }
  return out
}
