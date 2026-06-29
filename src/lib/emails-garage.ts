// Templates email pour l espace client garages.
// Olivier 2026-06-02 — "très design et bien formé".

import { sendEmail } from '@/lib/emails'

interface WelcomeData {
  userEmail:    string
  userName:     string
  partners:     { name: string }[]
  magicLinkUrl: string
}

/**
 * Email de bienvenue envoye a un nouveau user garage.
 * Inclut : presentation, liste des entites liees, lien magic link pour
 * le premier acces, mode d emploi rapide.
 */
export async function sendGarageWelcomeEmail(data: WelcomeData): Promise<void> {
  const html = buildWelcomeHtml(data)
  await sendEmail(
    data.userEmail,
    `🚗 Bienvenue dans votre espace VD Soft — Verviers Dépannage`,
    html,
  )
}

function buildWelcomeHtml(d: WelcomeData): string {
  const partnersList = d.partners.length === 1
    ? `<strong>${escapeHtml(d.partners[0].name)}</strong>`
    : `<ul style="margin:6pt 0;padding-left:18pt;">${d.partners.map(p => `<li>${escapeHtml(p.name)}</li>`).join('')}</ul>`

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Bienvenue VD Soft</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

        <!-- Header rouge VD -->
        <tr><td style="background:linear-gradient(135deg,#b91c1c 0%,#7f1d1d 100%);padding:32px 24px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">VD Soft</h1>
          <p style="margin:6px 0 0 0;color:#fecaca;font-size:13px;font-weight:500;">Verviers Dépannage — Espace partenaire garage</p>
        </td></tr>

        <!-- Salutation -->
        <tr><td style="padding:32px 32px 16px 32px;">
          <h2 style="margin:0 0 12px 0;color:#1f2937;font-size:22px;font-weight:700;">Bonjour ${escapeHtml(d.userName)} 👋</h2>
          <p style="margin:0 0 14px 0;color:#374151;font-size:15px;line-height:1.6;">
            Un compte vient d'être créé pour vous sur <strong>VD Soft</strong>, la plateforme de gestion des interventions de Verviers Dépannage.
          </p>
          <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">
            Vous avez maintenant accès à votre espace dédié pour <strong>commander une intervention</strong> (dépannage ou remorquage) et <strong>suivre vos missions en direct</strong>.
          </p>
        </td></tr>

        <!-- Box entités -->
        <tr><td style="padding:8px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border-left:4px solid #b91c1c;border-radius:8px;padding:16px 18px;">
            <tr><td>
              <p style="margin:0 0 6px 0;color:#7f1d1d;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">📍 Entité${d.partners.length > 1 ? 's' : ''} liée${d.partners.length > 1 ? 's' : ''}</p>
              <div style="color:#1f2937;font-size:14px;">${partnersList}</div>
              ${d.partners.length > 1 ? `<p style="margin:8px 0 0 0;color:#7f1d1d;font-size:12px;">Vous pourrez basculer entre vos entités depuis votre espace.</p>` : ''}
            </td></tr>
          </table>
        </td></tr>

        <!-- CTA principal -->
        <tr><td style="padding:24px 32px 8px 32px;text-align:center;">
          <a href="${escapeHtml(d.magicLinkUrl)}" style="display:inline-block;background:#b91c1c;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:700;font-size:16px;box-shadow:0 4px 12px rgba(185,28,28,0.3);">
            🚀 Activer mon compte
          </a>
          <p style="margin:10px 0 0 0;color:#6b7280;font-size:12px;">Lien sécurisé valable 24h</p>
        </td></tr>

        <!-- Comment ça marche -->
        <tr><td style="padding:24px 32px 8px 32px;">
          <h3 style="margin:0 0 12px 0;color:#1f2937;font-size:16px;font-weight:700;">Comment ça marche ?</h3>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">
              <p style="margin:0;color:#374151;font-size:14px;line-height:1.5;"><strong>1. Vous activez votre compte</strong> en cliquant sur le bouton ci-dessus, puis définissez votre mot de passe.</p>
            </td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">
              <p style="margin:0;color:#374151;font-size:14px;line-height:1.5;"><strong>2. Vous demandez une intervention</strong> (DSP / REM) via le formulaire de votre espace. Notre équipe reçoit l'alerte immédiatement.</p>
            </td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">
              <p style="margin:0;color:#374151;font-size:14px;line-height:1.5;"><strong>3. Vous suivez le statut</strong> en direct : acceptée, chauffeur en route, mission terminée. Notifications par email à chaque étape.</p>
            </td></tr>
            <tr><td style="padding:8px 0;">
              <p style="margin:0;color:#374151;font-size:14px;line-height:1.5;"><strong>4. Vous êtes facturé</strong> selon les tarifs négociés avec Verviers Dépannage. Pas de saisie tarif côté votre espace.</p>
            </td></tr>
          </table>
        </td></tr>

        <!-- 2ème connexion -->
        <tr><td style="padding:16px 32px 8px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ecfdf5;border-left:4px solid #10b981;border-radius:8px;padding:12px 16px;">
            <tr><td>
              <p style="margin:0;color:#065f46;font-size:13px;line-height:1.5;">
                💡 <strong>Prochaines connexions</strong> : vous pourrez vous connecter directement sur <a href="https://app.verviersdepannage.com/garage" style="color:#065f46;font-weight:600;">app.verviersdepannage.com/garage</a> avec votre email et votre mot de passe — ou redemander un lien magique si oublié.
              </p>
            </td></tr>
          </table>
        </td></tr>

        <!-- Support -->
        <tr><td style="padding:16px 32px 24px 32px;">
          <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">
            <strong>Une question, un problème ?</strong> Contactez notre équipe au <a href="tel:+3287600835" style="color:#b91c1c;text-decoration:none;">+32 87 60 08 35</a> ou répondez à cet email.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9fafb;padding:18px 32px;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="margin:0;color:#9ca3af;font-size:12px;">Verviers Dépannage SA · Pepinster · Belgique</p>
          <p style="margin:4px 0 0 0;color:#d1d5db;font-size:11px;">Cet email a été envoyé suite à la création de votre compte. Si vous n'êtes pas concerné, ignorez-le.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}
