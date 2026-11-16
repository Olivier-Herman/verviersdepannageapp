'use client'
// src/components/missions/ContratAssistance.tsx — encadré « Contrat » (Olivier 15/11/2026, maquette
// https://claude.ai/artifact/XiqZMLRThbQQXGmf3dcre7 validée). Chauffeur : le NOM du contrat et Couvert / Non couvert.
// Dispatch : tout (assureur, police, dossier, plafond, franchise, VR, couverture, consignes).
import type { AssistanceContrat } from '@/lib/assistance/contrat'
import { useT } from '@/lib/i18n/I18nProvider'

const LIB: Record<string, string> = { touring: 'Touring', vab: 'VAB', axa: 'AXA', allianz: 'Allianz (Mondial)', ima: 'IMA (Kaze)' }
const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`
const oui = (b: boolean | null | undefined) => b === true ? 'oui' : b === false ? 'non' : '?'

function Pastille({ couvert, t }: { couvert: boolean | null; t: (k: string) => string }) {
  if (couvert === null || couvert === undefined) return null
  return couvert
    ? <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800">{t('contrat.couvert')}</span>
    : <span className="text-xs font-bold px-3 py-1 rounded-full bg-red-100 text-red-800">{t('contrat.non_couvert')}</span>
}

export default function ContratAssistance({ contrat, vue }: { contrat: AssistanceContrat | null | undefined; vue: 'dispatch' | 'chauffeur' }) {
  const { t } = useT()
  if (!contrat) return null
  const c = contrat
  const rouge = c.couvert === false
  const cadre = `rounded-2xl p-4 bg-surface ${rouge ? 'border-2 border-red-300' : c.assistance === 'ima' ? 'border border-dashed' : 'border'}`

  if (vue === 'chauffeur') {
    if (!c.nom && c.couvert !== false) return null   // IMA : rien d'utile pour le chauffeur
    return (
      <div className={cadre}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-ink-muted text-xs uppercase tracking-widest font-medium">{t('contrat.titre')}</p>
          <Pastille couvert={c.couvert} t={t} />
        </div>
        <p className="text-ink font-bold text-lg leading-tight">{c.nom || '—'}</p>
        <p className="text-ink-secondary text-xs mt-0.5">{[LIB[c.assistance], c.police ? `police ${c.police}` : c.dossier ? `dossier ${c.dossier}` : null].filter(Boolean).join(' · ')}</p>
      </div>
    )
  }

  const lignes: string[] = []
  if (c.assureur && c.assureur !== c.nom) lignes.push(c.assistance === 'ima' ? `Payeur : ${c.assureur}` : `Assureur : ${c.assureur}`)
  const ids = [c.police ? `police ${c.police}` : null, c.dossier ? `dossier ${c.dossier}` : null, c.code && c.code !== c.nom ? `produit ${c.code}` : null].filter(Boolean)
  if (ids.length) lignes.push(ids.join(' · '))
  const montants = [c.preautorise_ttc != null ? `préautorisé ${eur(c.preautorise_ttc)}` : null, c.plafond_ttc != null ? `plafond ${eur(c.plafond_ttc)}` : null, c.franchise_ttc != null ? `franchise ${eur(c.franchise_ttc)}` : null].filter(Boolean)
  if (montants.length) lignes.push(`${montants.join(' · ')} (TVAC)`)
  if (c.couverture) lignes.push(`Dépannage ${oui(c.couverture.depannage)} · Remorquage ${oui(c.couverture.remorquage)} · Autoroute ${oui(c.couverture.autoroute)}${c.couverture.paiement ? ` · paiement : ${c.couverture.paiement}` : ''}`)
  if (c.vr != null) lignes.push(`Véhicule de remplacement : ${c.vr ? 'oui' : 'non'}`)
  return (
    <div className={cadre}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-ink-muted text-xs uppercase tracking-widest font-semibold">Contrat · {LIB[c.assistance] || c.assistance}</p>
        <Pastille couvert={c.couvert} t={t} />
      </div>
      <p className="text-ink font-bold text-base">{c.nom || (c.assistance === 'ima' ? 'Contrat non transmis par IMA' : '—')}</p>
      {lignes.map((l, i) => <p key={i} className="text-ink-secondary text-sm">{l}</p>)}
      {(c.consignes || []).map((l, i) => <p key={'c' + i} className={`text-sm font-medium ${rouge ? 'text-red-700' : 'text-amber-700'}`}>⚠ {l}</p>)}
    </div>
  )
}
