// src/lib/espace/mails.ts
//
// Mails de l'espace client : code de connexion et invitation d'un collaborateur.
// Expéditeur : la boîte par défaut de l'app (administration@).

import { sendEmail } from '@/lib/emails'

const base = () => process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'

function cadre(titre: string, corps: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f1ee;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ee;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.08)">
<tr><td style="background:linear-gradient(135deg,#111827 0%,#7f1d1d 55%,#cc2222 100%);padding:28px 32px;color:#fff">
<div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.8">Verviers Dépannage · Espace client</div>
<div style="font-size:24px;font-weight:700;margin-top:6px">${titre}</div></td></tr>
<tr><td style="padding:28px 32px;font-size:15px;line-height:1.6">${corps}</td></tr>
<tr><td style="padding:18px 32px 26px;font-size:12px;color:#6b7280;border-top:1px solid #f1f5f9">Verviers Dépannage — dépannage &amp; remorquage 24 h/24, 7 j/7</td></tr>
</table></td></tr></table></body></html>`
}

export async function envoyerCode(to: string, nom: string, code: string) {
  await sendEmail(to, `${code} — votre code de connexion à l’espace client`, cadre('Votre code de connexion', `
<p>Bonjour ${esc(nom)},</p>
<p>Voici votre code pour vous connecter à votre espace client :</p>
<div style="margin:22px 0;text-align:center"><span style="display:inline-block;font-size:34px;font-weight:800;letter-spacing:.32em;padding:14px 22px;border-radius:14px;background:#fef2f2;color:#991b1b">${code}</span></div>
<p style="color:#6b7280;font-size:13px">Il est valable 15 minutes. Si vous n’avez rien demandé, ignorez simplement ce message.</p>`))
}

export async function envoyerInvitation(to: string, nom: string, invitePar: string, societe: string) {
  await sendEmail(to, `${invitePar} vous donne accès à l’espace client Verviers Dépannage`, cadre('Bienvenue dans votre espace client', `
<p>Bonjour ${esc(nom)},</p>
<p>${esc(invitePar)} vous a ouvert un accès à l’espace client de Verviers Dépannage pour <b>${esc(societe)}</b>.</p>
<p>Vous pourrez y commander un dépannage ou un remorquage, et suivre en direct chacune de vos demandes jusqu’à la fin de l’intervention.</p>
<div style="margin:24px 0;text-align:center"><a href="${base()}/espace/connexion?email=${encodeURIComponent(to)}" style="display:inline-block;background:#cc2222;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:12px">Ouvrir mon espace</a></div>
<p style="color:#6b7280;font-size:13px">Connexion avec cette adresse : un code vous est envoyé par mail à chaque connexion, ou vous choisissez un mot de passe une fois connecté.</p>`))
}

const esc = (s: string) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
