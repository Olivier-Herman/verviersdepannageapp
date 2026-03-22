import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

// Cron déclenché tous les jours ouvrables à 8h (lun-ven)
// Configuré dans vercel.json

async function getAppToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.AZURE_AD_CLIENT_ID!,
        client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      })
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(`Token error: ${JSON.stringify(data)}`)
  return data.access_token
}

function isWeekday(date: Date): boolean {
  const day = date.getDay()
  return day !== 0 && day !== 6
}

function getPreviousWorkingDay(): Date {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  while (!isWeekday(date)) date.setDate(date.getDate() - 1)
  return date
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Espèces',
  terminal: 'SumUp Terminal',
  qr: 'QR Code SumUp',
  tap: 'Tap to Pay',
  email: 'Lien Email SumUp',
  sumup_manual: 'SumUp Manuel',
  bancontact: 'Bancontact Bureau',
  unpaid: 'Non payé — À facturer',
}

export async function GET(req: NextRequest) {
  // Vérifier le secret Vercel cron
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  // Ne pas envoyer le week-end
  const today = new Date()
  if (!isWeekday(today)) {
    return NextResponse.json({ skipped: 'weekend' })
  }

  const supabase = createAdminClient()
  const prevWorkDay = getPreviousWorkingDay()

  // Récupérer les interventions depuis le dernier jour ouvrable
  const { data: interventions } = await supabase
    .from('interventions')
    .select(`*, driver:users(name, email)`)
    .gte('created_at', prevWorkDay.toISOString().split('T')[0] + 'T00:00:00')
    .order('created_at', { ascending: true })

  if (!interventions || interventions.length === 0) {
    console.log('[Cron] Aucune intervention à envoyer')
    return NextResponse.json({ sent: false, reason: 'no interventions' })
  }

  const today_str = today.toLocaleDateString('fr-BE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
  const prevDay_str = prevWorkDay.toLocaleDateString('fr-BE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })

  const totalAmount = interventions.reduce((s, i) => s + (i.amount || 0), 0)
  const paidCount = interventions.filter(i => i.payment_mode !== 'unpaid').length
  const unpaidCount = interventions.filter(i => i.payment_mode === 'unpaid').length

  // Générer le HTML du rapport
  const rows = interventions.map(i => `
    <tr style="border-bottom:1px solid #eee;">
      <td style="padding:8px 10px;font-size:12px;color:#333;">${i.reference}</td>
      <td style="padding:8px 10px;font-size:12px;color:#333;">${new Date(i.created_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}</td>
      <td style="padding:8px 10px;font-size:12px;color:#333;">${i.driver?.name || '-'}</td>
      <td style="padding:8px 10px;font-size:12px;color:#333;">${i.plate || '-'}</td>
      <td style="padding:8px 10px;font-size:12px;color:#333;">${i.client_name || '-'}</td>
      <td style="padding:8px 10px;font-size:12px;color:#333;">${i.motif_text || '-'}</td>
      <td style="padding:8px 10px;font-size:12px;color:#333;text-align:right;font-weight:bold;">${(i.amount || 0).toFixed(2)} €</td>
      <td style="padding:8px 10px;font-size:12px;color:${i.payment_mode === 'unpaid' ? '#cc2222' : '#2e7d32'};">
        ${PAYMENT_LABELS[i.payment_mode] || i.payment_mode}
      </td>
      <td style="padding:8px 10px;font-size:12px;color:${i.synced_to_odoo ? '#2e7d32' : '#f57f17'};">
        ${i.synced_to_odoo ? '✓ Sync' : '⏳ En attente'}
      </td>
    </tr>
  `).join('')

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:20px 0;">
    <tr><td align="center">
      <table width="800" cellpadding="0" cellspacing="0" style="max-width:800px;background:#fff;border-radius:8px;overflow:hidden;">

        <tr><td style="background:#CC2222;padding:20px 30px;">
          <h1 style="color:white;margin:0;font-size:20px;">VERVIERS DÉPANNAGE — Rapport Encaissements</h1>
          <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">Généré le ${today_str} · Interventions du ${prevDay_str}</p>
        </td></tr>

        <tr><td style="padding:20px 30px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="25%" style="background:#f9f9f9;border-radius:6px;padding:15px;text-align:center;">
                <p style="margin:0;font-size:24px;font-weight:bold;color:#CC2222;">${interventions.length}</p>
                <p style="margin:4px 0 0;font-size:12px;color:#666;">Interventions</p>
              </td>
              <td width="5%"></td>
              <td width="25%" style="background:#f9f9f9;border-radius:6px;padding:15px;text-align:center;">
                <p style="margin:0;font-size:24px;font-weight:bold;color:#2e7d32;">${totalAmount.toFixed(2)} €</p>
                <p style="margin:4px 0 0;font-size:12px;color:#666;">Total TVAC</p>
              </td>
              <td width="5%"></td>
              <td width="25%" style="background:#f9f9f9;border-radius:6px;padding:15px;text-align:center;">
                <p style="margin:0;font-size:24px;font-weight:bold;color:#2e7d32;">${paidCount}</p>
                <p style="margin:4px 0 0;font-size:12px;color:#666;">Payées</p>
              </td>
              <td width="5%"></td>
              <td width="25%" style="background:#fff3cd;border-radius:6px;padding:15px;text-align:center;border:1px solid #ffc107;">
                <p style="margin:0;font-size:24px;font-weight:bold;color:#856404;">${unpaidCount}</p>
                <p style="margin:4px 0 0;font-size:12px;color:#856404;">Non payées</p>
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 30px 30px;">
          <table width="100%" style="border-collapse:collapse;border:1px solid #eee;border-radius:6px;overflow:hidden;">
            <thead>
              <tr style="background:#CC2222;">
                <th style="padding:10px;font-size:12px;color:white;text-align:left;">Référence</th>
                <th style="padding:10px;font-size:12px;color:white;text-align:left;">Heure</th>
                <th style="padding:10px;font-size:12px;color:white;text-align:left;">Chauffeur</th>
                <th style="padding:10px;font-size:12px;color:white;text-align:left;">Plaque</th>
                <th style="padding:10px;font-size:12px;color:white;text-align:left;">Client</th>
                <th style="padding:10px;font-size:12px;color:white;text-align:left;">Motif</th>
                <th style="padding:10px;font-size:12px;color:white;text-align:right;">Montant</th>
                <th style="padding:10px;font-size:12px;color:white;text-align:left;">Paiement</th>
                <th style="padding:10px;font-size:12px;color:white;text-align:left;">Odoo</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr style="background:#f9f9f9;">
                <td colspan="6" style="padding:10px;font-size:13px;font-weight:bold;color:#333;">TOTAL</td>
                <td style="padding:10px;font-size:13px;font-weight:bold;color:#CC2222;text-align:right;">${totalAmount.toFixed(2)} €</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          </table>
        </td></tr>

        <tr><td style="background:#f5f5f5;padding:15px 30px;text-align:center;border-top:1px solid #eee;">
          <p style="margin:0;font-size:11px;color:#999;">
            Verviers Dépannage SA · Rapport généré automatiquement par l'application chauffeurs
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  try {
    const token = await getAppToken()
    const FROM_EMAIL = 'administration@verviersdepannage.com'
    const TO_EMAIL = 'encaissement@verviers-depannage.odoo.com'

    await fetch(`https://graph.microsoft.com/v1.0/users/${FROM_EMAIL}/sendMail`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: `Rapport encaissements du ${prevDay_str} — ${interventions.length} intervention(s) — ${totalAmount.toFixed(2)} €`,
          body: { contentType: 'HTML', content: html },
          toRecipients: [{ emailAddress: { address: TO_EMAIL } }],
        },
        saveToSentItems: true,
      })
    })

    console.log(`[Cron] Rapport envoyé — ${interventions.length} interventions — ${totalAmount.toFixed(2)} €`)
    return NextResponse.json({
      sent: true,
      count: interventions.length,
      total: totalAmount.toFixed(2),
    })
  } catch (err: any) {
    console.error('[Cron] Erreur envoi rapport:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
