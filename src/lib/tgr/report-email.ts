// src/lib/tgr/report-email.ts
//
// Templates email de supervision TGR : bilan mensuel + mail de bienvenue.
// Réutilisés par le cron mensuel ET les boutons d'envoi manuel (/admin/tgr).
// Olivier 2026-07-11.

import { emailLayout, infoRow, button } from '@/lib/emails'
import type { TgrSupervData } from '@/lib/tgr/supervision'

export function buildTgrReportEmail(
  stats: TgrSupervData['stats'],
  monthLabel: string,
  link: string | null,
): { subject: string; html: string } {
  const content = `
    <h2 style="margin:0 0 16px">Bilan TGR — ${monthLabel}</h2>
    ${infoRow('Commandes reçues', String(stats.total))}
    ${infoRow('Acceptées', String(stats.accepted))}
    ${infoRow('Refusées', String(stats.refused))}
    ${infoRow('Reprises', String(stats.taken))}
    ${infoRow('Réalisées', String(stats.completed))}
    ${infoRow("Délai moyen d'acceptation", stats.avg_accept_hours != null ? `${stats.avg_accept_hours} h` : '—')}
    ${infoRow("Respect de l'échéance", stats.on_time_rate != null ? `${stats.on_time_rate} % (${stats.on_time} à temps · ${stats.late} en retard)` : '—')}
    <p style="color:#64748b;font-size:13px;margin-top:16px">Détail commande par commande (délais, dates de clôture) sur la page de supervision :</p>
    ${link ? button(link, '📊 Voir le détail en ligne') : '<p style="color:#b45309">Lien de supervision non configuré (voir /admin/tgr).</p>'}
  `
  return { subject: `Bilan TGR — ${monthLabel}`, html: emailLayout(content, 'Bilan TGR mensuel') }
}

export function buildTgrWelcomeEmail(link: string): { subject: string; html: string } {
  const content = `
    <h2 style="margin:0 0 16px">Accès supervision TGR — Verviers Dépannage</h2>
    <p>Bonjour,</p>
    <p>Vous avez désormais accès au suivi des commandes TGR confiées à Verviers Dépannage, en <b>temps réel</b> et en <b>lecture seule</b> (aucun compte à créer).</p>
    <p>Depuis votre lien personnel, vous pouvez consulter à tout moment :</p>
    <ul style="color:#334155;font-size:14px;line-height:1.7">
      <li>les <b>commandes reçues</b> et leur statut (acceptée / refusée / reprise / réalisée) ;</li>
      <li>le <b>délai d'acceptation</b> de chaque commande ;</li>
      <li>la <b>date de clôture</b> et le <b>respect de l'échéance</b> ;</li>
      <li>un <b>filtre par période</b> (mois en cours, mois dernier, année, tout).</li>
    </ul>
    ${button(link, '📊 Ouvrir mon accès supervision')}
    <p style="color:#64748b;font-size:13px;margin-top:16px">Vous recevrez également un <b>bilan par email chaque début de mois</b>. Conservez ce lien : il reste valable.</p>
  `
  return { subject: 'Votre accès supervision TGR — Verviers Dépannage', html: emailLayout(content, 'Accès supervision TGR') }
}
