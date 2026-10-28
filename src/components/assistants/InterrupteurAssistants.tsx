'use client'
// Interrupteur « Mes assistants » (Olivier 28/10/2026, maquette validée) — sur le tableau de bord, pour Olivier seul
// (l'API ne renvoie rien aux autres comptes). Un bouton général met tout en pause ; chaque bloc a aussi le sien
// (« chaque bloc est cliquable pour activer ou désactiver indépendamment »). Option : pause automatique en dehors de ses
// heures. Ce qu'on fait à la main, dans VD Soft ou en session, n'est jamais bloqué. Ancien interrupteur de la
// facturation automatique (26/10/2026) : c'est le même bouton, élargi.

import { useEffect, useState } from 'react'

interface Bloc { cle: string; nom: string; role: string; enPause: boolean; attente: string | null }
interface Ligne { id: number; action: 'suspension' | 'reprise' | 'refus'; par_nom: string | null; motif: string | null; at: string }
interface Rattrapage { at: string; factures: number; sel: number; relances: number; allianz: number; comex: number; erreurs: string[] }
interface Etat {
  visible: boolean; enMarche?: boolean; depuis?: string | null; par?: string | null; motif?: string | null
  horsHeures?: boolean; pauseHorsHeuresEnCours?: boolean; assistants?: Bloc[]; journal?: Ligne[]; rattrapage?: Rattrapage | null
}
type Demande = { enMarche: boolean; cle?: string; nom?: string }

const quand = (iso?: string | null) => iso ? new Date(iso).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

export default function InterrupteurAssistants() {
  const [etat, setEtat] = useState<Etat | null>(null)
  const [demande, setDemande] = useState<Demande | null>(null)
  const [motif, setMotif] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [voirJournal, setVoirJournal] = useState(false)

  const load = async () => {
    const r = await fetch('/api/admin/facturation-auto', { cache: 'no-store' }).then(x => x.json()).catch(() => null)
    setEtat(r && !r.error ? r : { visible: false })
  }
  useEffect(() => { load() }, [])

  async function envoyer(body: Record<string, unknown>) {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/admin/facturation-auto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Échec'); return false }
      setEtat(j); return true
    } catch { setErr('Erreur réseau'); return false } finally { setBusy(false) }
  }

  async function confirmer() {
    if (!demande) return
    const ok = await envoyer({ enMarche: demande.enMarche, motif: motif.trim() || null, ...(demande.cle ? { cle: demande.cle } : {}) })
    if (ok) { setDemande(null); setMotif(''); if (demande.enMarche) setTimeout(load, 90_000) }   // rattrapage en fond : on relit son résumé
  }

  if (!etat || !etat.visible) return null
  const manuel = !etat.enMarche
  const pause = manuel || !!etat.pauseHorsHeuresEnCours
  const blocs = etat.assistants || []
  const vert = 'text-emerald-800', orange = 'text-orange-800'

  return (
    <div className="mb-6 space-y-3">
      {pause && (
        <div className="rounded-2xl border-2 border-orange-600 bg-orange-50 px-4 py-3 flex gap-3 items-start">
          <span aria-hidden="true" className="mt-0.5 text-orange-700 font-black">II</span>
          <div>
            <p className="font-bold text-orange-900">
              {manuel ? `Tes assistants sont en pause${etat.depuis ? ` depuis le ${quand(etat.depuis)}` : ''}` : 'Tes assistants sont en pause : tu es en dehors de tes heures'}
            </p>
            <p className="text-sm text-orange-900 mt-0.5">Rien ne part tout seul : ni facture, ni écriture, ni mail, ni notification. Ce qui arrive est gardé et traité à la reprise.{manuel && etat.motif ? ` Motif : ${etat.motif}` : ''}</p>
          </div>
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="min-w-0 flex-1 basis-72">
            <h2 className="font-display text-lg font-extrabold text-slate-900">Mes assistants</h2>
            <p className="text-sm text-slate-700 mt-0.5">
              État : <b className={pause ? orange : vert}>{pause ? 'en pause' : 'en marche'}</b>
              {' · '}{pause ? 'rien ne part tout seul' : etat.horsHeures ? 'pause automatique en dehors de tes heures' : 'en marche en continu'}
            </p>
          </div>
          <button type="button" disabled={busy} onClick={() => { setErr(null); setMotif(''); setDemande({ enMarche: manuel }) }}
            className={`min-h-[48px] px-5 rounded-xl font-bold text-white text-sm disabled:opacity-50 ${manuel ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-orange-700 hover:bg-orange-800'}`}>
            {manuel ? '▶ Tout reprendre' : 'II Tout mettre en pause'}
          </button>
        </div>

        {!manuel && etat.rattrapage && etat.depuis && etat.rattrapage.at >= etat.depuis && (
          <p className="text-sm text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
            Reprise du {quand(etat.rattrapage.at)} : {etat.rattrapage.factures} facture(s), {etat.rattrapage.sel} SEL, {etat.rattrapage.relances} relance(s), {etat.rattrapage.allianz} clôture(s) Allianz, {etat.rattrapage.comex} validation(s) Touring. Les autres blocs ont repris leur passage.
          </p>
        )}

        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {blocs.map(b => {
            const arret = pause || b.enPause
            return (
              <li key={b.cle}>
                <button type="button" disabled={busy || manuel} onClick={() => { setErr(null); setMotif(''); setDemande({ enMarche: b.enPause, cle: b.cle, nom: b.nom }) }}
                  aria-label={`${b.nom} : ${b.enPause ? 'relancer' : 'mettre en pause'}`}
                  className={`w-full text-left min-h-[64px] rounded-xl border px-3 py-2.5 flex gap-3 items-start transition-colors disabled:cursor-not-allowed ${arret ? 'bg-orange-50 border-orange-200' : 'bg-white border-slate-200 hover:border-slate-400'}`}>
                  <span aria-hidden="true" className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${arret ? 'bg-orange-500' : 'bg-emerald-500'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-900">{b.nom}</span>
                    <span className="block text-xs text-slate-700">{b.role}</span>
                    <span className={`block text-xs font-semibold mt-0.5 ${arret ? orange : vert}`}>
                      {b.enPause ? 'En pause (ce bloc seul)' : pause ? 'En pause' : 'En marche'}{arret && b.attente ? ` · ${b.attente}` : ''}
                    </span>
                  </span>
                  {!manuel && <span className="text-xs font-semibold text-slate-700 underline self-center">{b.enPause ? 'Relancer' : 'Pause'}</span>}
                </button>
              </li>
            )
          })}
        </ul>

        <div className="border-t border-slate-200 pt-3 flex flex-wrap gap-3 items-center justify-between">
          <label className="flex gap-3 items-center min-h-[44px] cursor-pointer">
            <input type="checkbox" checked={!!etat.horsHeures} disabled={busy} onChange={e => envoyer({ horsHeures: e.target.checked })} className="w-5 h-5 accent-blue-700" />
            <span>
              <span className="block text-sm font-semibold text-slate-900">Pause automatique en dehors de mes heures</span>
              <span className="block text-xs text-slate-700">Lundi au jeudi, 9 h – 18 h (ou tes créneaux « Verviers Dépannage » de l’agenda)</span>
            </span>
          </label>
          <button type="button" onClick={() => setVoirJournal(v => !v)} className="text-sm font-semibold text-blue-800 underline min-h-[44px]">
            {voirJournal ? 'Masquer le journal' : `Voir le journal${etat.journal?.length ? ` (${etat.journal.length})` : ''}`}
          </button>
        </div>
        {err && <p className="text-sm font-semibold text-red-800">⚠ {err}</p>}

        {voirJournal && (
          <ul className="border-t border-slate-200 pt-2 space-y-1.5">
            {(etat.journal || []).length === 0 && <li className="text-sm text-slate-700">Aucune bascule pour l’instant.</li>}
            {(etat.journal || []).map(l => (
              <li key={l.id} className="text-sm text-slate-800">
                <span className="tabular-nums text-slate-600">{quand(l.at)}</span>{' · '}
                <b className={l.action === 'refus' ? 'text-amber-800' : l.action === 'suspension' ? orange : vert}>
                  {l.action === 'suspension' ? 'Pause' : l.action === 'reprise' ? 'Reprise' : 'Tentative refusée'}
                </b>{l.par_nom ? ` par ${l.par_nom}` : ''}{l.motif && l.action !== 'refus' ? ` — ${l.motif}` : ''}
              </li>
            ))}
          </ul>
        )}

        <div className="bg-slate-50 rounded-xl px-3 py-2.5">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-700">Toujours en marche — outils de l’équipe</p>
          <p className="text-sm text-slate-800 mt-0.5">Sam et Sonic pour les chauffeurs · Max pour Jona · arrivée des missions des assistances · contrôle du parc. Ils ne dépendent pas de cet interrupteur.</p>
        </div>
      </section>

      {demande && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60">
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <p className="font-bold text-slate-900">
                {demande.cle ? `${demande.nom} : ${demande.enMarche ? 'relancer' : 'mettre en pause'} ?` : demande.enMarche ? 'Reprendre tes assistants ?' : 'Mettre tes assistants en pause ?'}
              </p>
              <button type="button" onClick={() => setDemande(null)} className="w-11 h-11 flex items-center justify-center text-slate-700 text-2xl" aria-label="Fermer">×</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-slate-800">
                {demande.enMarche
                  ? 'Ça repart tout de suite : ce qui a attendu est traité dans l’ordre, sans doublon, avec un résumé sur Telegram.'
                  : demande.cle
                    ? 'Ce bloc ne fait plus rien tout seul jusqu’à ce que tu le relances. Rien n’est perdu : tout est gardé.'
                    : 'Plus rien ne part tout seul : ni facture, ni écriture, ni mail, ni notification. Rien n’est perdu : tout est gardé jusqu’à la reprise. Les outils de l’équipe continuent.'}
              </p>
              <label className="block">
                <span className="text-xs font-semibold text-slate-800">Motif (facultatif)</span>
                <input value={motif} onChange={e => setMotif(e.target.value)} maxLength={250} placeholder={demande.enMarche ? 'Ex. retour de congé' : 'Ex. contrôle des tarifs'}
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm text-slate-900" />
              </label>
              {err && <p className="text-sm font-semibold text-red-800">⚠ {err}</p>}
            </div>
            <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button type="button" onClick={() => setDemande(null)} disabled={busy} className="min-h-[44px] px-4 rounded-xl border border-slate-300 bg-white text-slate-900 font-semibold">Annuler</button>
              <button type="button" onClick={confirmer} disabled={busy}
                className={`min-h-[44px] px-4 rounded-xl text-white font-bold disabled:opacity-50 ${demande.enMarche ? 'bg-emerald-700' : 'bg-orange-700'}`}>
                {busy ? '…' : demande.enMarche ? 'Reprendre' : 'Mettre en pause'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
