// src/lib/espace/mails.ts
//
// Les deux seuls mails de l'espace client, déclenchés par le client lui-même (Olivier 10/10/2026 : aucune
// notification d'avancement) : le code de connexion et l'invitation d'un collaborateur.
// Design validé le 10/10/2026 (artifact « mails de l'espace client ») : même photo et mêmes couleurs que l'espace.
// Expéditeur : la boîte par défaut de l'app (administration@).

import { sendEmail } from '@/lib/emails'

const base = () => process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'
const esc = (s: string) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const prenom = (nom: string) => String(nom || '').trim().split(/\s+/)[0] || ''

function cadre(image: string, surTitre: string, titre: string, corps: string, sousMarque = 'Espace client') {
  return `<!doctype html><html><body style="margin:0;background:#f4efe9">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4efe9;padding:28px 10px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#151a2d">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 14px 34px rgba(21,26,45,.10)">
<tr><td style="padding:18px 26px;border-bottom:1px solid #f1e9e1">
  <table role="presentation" cellspacing="0" cellpadding="0"><tr>
    <td style="width:38px;height:38px;border-radius:12px;background:#d42a2a;text-align:center;vertical-align:middle;color:#ffffff;font-size:16px;font-weight:800">VD</td>
    <td style="padding-left:12px"><div style="font-size:15px;font-weight:800;color:#151a2d">Verviers Dépannage</div><div style="font-size:10px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:#d42a2a">${sousMarque}</div></td>
  </tr></table>
</td></tr>
<tr><td><img src="${base()}/noprecache/espace/${image}" width="560" alt="" style="display:block;width:100%;height:auto;border:0"></td></tr>
<tr><td style="padding:28px 30px 8px">
  <div style="font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#d42a2a">${surTitre}</div>
  <div style="font-size:26px;line-height:1.15;font-weight:800;margin-top:6px;color:#151a2d">${titre}</div>
</td></tr>
<tr><td style="padding:8px 30px 30px;font-size:15px;line-height:1.6;color:#3a4258">${corps}</td></tr>
<tr><td style="padding:18px 30px 24px;background:#faf7f3;border-top:1px solid #f1e9e1;font-size:12px;line-height:1.5;color:#6c7387">Verviers Dépannage · dépannage et remorquage 24 h/24, 7 j/7<br>Lefin 12, 4860 Pepinster</td></tr>
</table></td></tr></table></body></html>`
}

export async function envoyerCode(to: string, nom: string, code: string) {
  const cases = code.split('').map(d => `<td style="width:46px;height:58px;border-radius:12px;background:#fff4f2;border:2px solid #f6cfc9;text-align:center;vertical-align:middle;font-size:28px;font-weight:800;color:#a91c1c">${d}</td><td style="width:8px"></td>`).join('')
  await sendEmail(to, `${code} — votre code de connexion à l’espace client`, cadre('mail-route.jpg', 'Connexion', 'Votre code de connexion', `
<p style="margin:0 0 18px">Bonjour ${esc(prenom(nom))},<br>voici votre code pour ouvrir votre espace client :</p>
<table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto 18px"><tr>${cases}</tr></table>
<p style="margin:0;font-size:13px;color:#6c7387;text-align:center">Valable 15 minutes. Vous n’avez rien demandé ? Ignorez simplement ce message.</p>`))
}

export async function envoyerInvitation(to: string, nom: string, invitePar: string, societe: string) {
  const point = (t: string, s: string) => `<tr><td style="width:30px;vertical-align:top;padding-top:2px"><div style="width:22px;height:22px;border-radius:99px;background:#e5f6ee;color:#13704b;font-weight:800;text-align:center;line-height:22px;font-size:13px">✓</div></td><td style="padding:0 0 12px"><b style="color:#151a2d">${t}</b><br><span style="font-size:14px">${s}</span></td></tr>`
  const qui = invitePar === 'Verviers Dépannage' ? 'Verviers Dépannage' : prenom(invitePar)
  await sendEmail(to, `${invitePar} vous donne accès à l’espace client Verviers Dépannage`, cadre('mail-equipe.jpg', 'Invitation', `${esc(qui)} vous ouvre un accès`, `
<p style="margin:0 0 18px">Bonjour ${esc(prenom(nom))},<br><b>${esc(invitePar)}</b> vous donne accès à l’espace client de Verviers Dépannage pour <b>${esc(societe)}</b>.</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 20px">${point('Commandez en 30 secondes', 'Dépannage sur place ou remorquage, livraison au garage de votre choix.')}${point('Suivez en direct', 'Chaque étape de l’intervention, de la validation à la livraison.')}${point('Retrouvez vos documents', 'Rapport d’intervention avec photos, et factures.')}</table>
<table role="presentation" cellspacing="0" cellpadding="0" align="center"><tr><td style="border-radius:14px;background:#d42a2a"><a href="${base()}/espace/connexion?email=${encodeURIComponent(to)}" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:800;color:#ffffff;text-decoration:none">Ouvrir mon espace</a></td></tr></table>
<p style="margin:18px 0 0;font-size:13px;color:#6c7387;text-align:center">Connexion avec cette adresse mail : vous recevez un code à chaque connexion, ou vous choisissez un mot de passe une fois connecté.</p>`))
}

// ── Clients des garages (Olivier 10/10/2026) : le code d'inscription du client, et l'avis au garage. ──

export async function envoyerCodeClient(to: string, prenomClient: string, code: string) {
  const cases = code.split('').map(d => `<td style="width:46px;height:58px;border-radius:12px;background:#fff4f2;border:2px solid #f6cfc9;text-align:center;vertical-align:middle;font-size:28px;font-weight:800;color:#a91c1c">${d}</td><td style="width:8px"></td>`).join('')
  await sendEmail(to, `${code} — votre code Verviers Dépannage`, cadre('mail-route.jpg', 'Votre code', 'Confirmez votre adresse', `
<p style="margin:0 0 18px">Bonjour ${esc(prenomClient)},<br>voici votre code pour accéder à VD Assistance, le dépannage Verviers Dépannage de votre garage partenaire :</p>
<table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto 18px"><tr>${cases}</tr></table>
<p style="margin:0;font-size:13px;color:#6c7387;text-align:center">Valable 15 minutes. Vous n’avez rien demandé ? Ignorez simplement ce message.</p>`, 'VD Assistance'))
}

export async function avertirGarageNouveauClient(to: string[], garage: string, c: { prenom: string; nom: string; tel: string; email: string; adresse: string; plaque: string; marque: string | null; modele: string | null; garage?: string | null }) {
  const ligne = (k: string, v: string) => `<tr><td style="padding:6px 0;color:#6c7387;font-size:13px;width:110px;vertical-align:top">${k}</td><td style="padding:6px 0;font-weight:700;color:#151a2d">${esc(v)}</td></tr>`
  const html = cadre('mail-equipe.jpg', 'Nouveau client', `${esc(c.prenom)} ${esc(c.nom)} s’est inscrit`, `
<p style="margin:0 0 14px">Un de vos clients vient d’inscrire son véhicule chez vous dans VD Assistance, pour commander son dépannage.</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 18px;width:100%">${ligne('Client', `${c.prenom} ${c.nom}`)}${ligne('Téléphone', c.tel)}${ligne('Mail', c.email)}${ligne('Adresse', c.adresse)}${ligne('Véhicule', [c.marque, c.modele, c.plaque].filter(Boolean).join(' '))}${c.garage ? ligne('Son garage', c.garage) : ''}</table>
<p style="margin:0 0 18px">Vérifiez ce client. Si ce véhicule est couvert par votre assistance, cochez <b>« Assistance »</b> : ses dépannages vous seront facturés. Sinon, le client paie lui-même le chauffeur.</p>
<table role="presentation" cellspacing="0" cellpadding="0" align="center"><tr><td style="border-radius:14px;background:#d42a2a"><a href="${base()}/espace/clients" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:800;color:#ffffff;text-decoration:none">Voir mes clients</a></td></tr></table>`)
  for (const t of to) await sendEmail(t, `Nouveau véhicule inscrit pour le dépannage : ${c.prenom} ${c.nom} — ${c.plaque}`, html).catch(e => console.error('[clients garage] avis garage KO', t, e?.message))
}
