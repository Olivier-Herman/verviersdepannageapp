// src/lib/justinvoice/otp.ts
//
// Lit le code OTP (6 chiffres) du mail « FOD Justitie Justinvoice account email
// verification code » (de msonlineservicesteam@microsoftonline.com) dans la boîte
// info@verviersdepannage.be, via Graph app-only. Poll ~60-90 s après l'envoi.
// Olivier 2026-08-09. Cf [[project_justinvoice_spf_justice]].

import { getAppOnlyToken } from '@/lib/graph-mail-search'

const OTP_MAILBOX = process.env.JUSTINGOV_EMAIL || 'info@verviersdepannage.be'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Attend et renvoie le code OTP reçu APRÈS `sinceIso`. null si rien trouvé. */
export async function readJustInvoiceOtp(sinceIso: string, opts?: { tries?: number; delayMs?: number }): Promise<string | null> {
  const tries = opts?.tries ?? 14
  const delayMs = opts?.delayMs ?? 6000
  for (let i = 0; i < tries; i++) {
    await sleep(i === 0 ? 4000 : delayMs)  // laisser le mail arriver
    const token = await getAppOnlyToken()
    if (!token) continue
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(OTP_MAILBOX)}/messages` +
      `?$top=10&$select=subject,receivedDateTime,body,from&$orderby=receivedDateTime desc`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }).catch(() => null)
    if (!res || !res.ok) continue
    const data = await res.json().catch(() => ({}))
    for (const m of (data.value || [])) {
      if (new Date(m.receivedDateTime).getTime() < new Date(sinceIso).getTime() - 30_000) continue
      const subj = String(m.subject || '').toLowerCase()
      if (!/verification code|verificatiecode|code de vérification|justinvoice/.test(subj)) continue
      const body = String(m.body?.content || '').replace(/<[^>]+>/g, ' ')
      const mm = body.match(/\b(\d{6})\b/)
      if (mm) return mm[1]
    }
  }
  return null
}
