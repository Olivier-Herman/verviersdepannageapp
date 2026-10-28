'use client'
// Relevé des dossiers ouverts — affichage et téléchargements (PDF par facture, ZIP, Excel). Couleurs Verviers Dépannage.
import { useMemo, useState } from 'react'
import type { Releve } from '@/lib/facturation/releves'

const eur = (n: number) => n.toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' })
const fr = (d: string | null) => d ? d.split('-').reverse().join('/') : '—'

export default function ReleveClient({ token, releve, date }: { token: string; releve: Releve; date: string }) {
  const [q, setQ] = useState('')
  const lignes = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? releve.lignes.filter(l => `${l.facture} ${l.dossier || ''} ${l.plaque || ''}`.toLowerCase().includes(s)) : releve.lignes
  }, [q, releve.lignes])
  const base = `/api/releve/${encodeURIComponent(token)}`

  return (
    <div className="min-h-screen bg-[#F4F5F7] text-slate-900">
      <header className="bg-white border-b-[5px] border-[#CC2222] px-4 py-3">
        <div className="max-w-6xl mx-auto flex flex-wrap gap-2 justify-between items-center">
          <img src="/vd-logo.png" alt="Verviers Dépannage 24/7" className="h-14 w-auto" />
          <span className="text-sm font-semibold text-slate-800">Service Facturation · 087/35.18.20 · administration@verviersdepannage.com</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-7 space-y-5">
        <div className="flex flex-wrap gap-4 justify-between items-end">
          <div>
            <p className="text-sm font-semibold text-slate-700">Relevé des dossiers ouverts au {fr(date)} —</p>
            <h1 className="text-2xl font-extrabold text-slate-900">{releve.partner}</h1>
            <p className="text-sm text-slate-800">{releve.lignes.length} dossier{releve.lignes.length > 1 ? 's' : ''} en attente de règlement · total <b>{eur(releve.total)}</b></p>
          </div>
          {releve.lignes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <a href={`${base}/zip`} className="min-h-[44px] inline-flex items-center px-4 rounded-xl bg-[#CC2222] hover:bg-[#A31B1B] text-white font-bold text-sm">Télécharger toutes les factures (ZIP)</a>
              <a href={`${base}/excel`} className="min-h-[44px] inline-flex items-center px-4 rounded-xl border border-slate-300 bg-white text-slate-900 font-semibold text-sm">Exporter la liste (Excel)</a>
            </div>
          )}
        </div>

        {releve.lignes.length === 0 ? (
          <p className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-emerald-900">Toutes les factures de ce relevé sont réglées. Merci !</p>
        ) : (
          <>
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher un dossier, une plaque, une facture…" aria-label="Rechercher"
              className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900" />
            <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-[#F5F5F5] text-[11px] uppercase tracking-wide text-slate-700">
                  <tr>
                    <th className="text-left px-4 py-3">Facture</th><th className="text-left px-4 py-3">Votre dossier</th><th className="text-left px-4 py-3">Véhicule</th>
                    <th className="text-left px-4 py-3">Intervention</th><th className="text-left px-4 py-3">Échéance</th><th className="text-right px-4 py-3">Montant</th>
                    <th className="text-right px-4 py-3">Reste dû</th><th className="text-right px-4 py-3">Document</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map(l => (
                    <tr key={l.id} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-bold">{l.facture}</td>
                      <td className="px-4 py-3">{l.dossier || '—'}</td>
                      <td className="px-4 py-3 font-mono text-[13px]">{l.plaque || '—'}</td>
                      <td className="px-4 py-3">{fr(l.date)}{l.prestation && <span className="block text-xs text-slate-700">{l.prestation}</span>}</td>
                      <td className="px-4 py-3">{fr(l.echeance)}{l.retard > 0 && <span className="block text-xs font-semibold text-orange-800">{l.retard} jour{l.retard > 1 ? 's' : ''} de retard</span>}</td>
                      <td className="px-4 py-3 text-right">{eur(l.montant)}</td>
                      <td className="px-4 py-3 text-right font-bold">{eur(l.reste)}</td>
                      <td className="px-4 py-3 text-right">
                        <a href={`${base}/pdf/${l.id}`} aria-label={`Télécharger la facture ${l.facture}`} className="inline-flex items-center min-h-[40px] px-3 rounded-lg border border-slate-300 text-[#CC2222] font-bold">PDF</a>
                      </td>
                    </tr>
                  ))}
                  {lignes.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-700">Aucune facture ne correspond à votre recherche.</td></tr>}
                </tbody>
                <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50"><td colSpan={6} className="px-4 py-3 text-right">Total en attente</td><td className="px-4 py-3 text-right font-extrabold text-[#B71C1C] text-base">{eur(releve.total)}</td><td /></tr></tfoot>
              </table>
            </div>
          </>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-700">Paiement</p>
            <p className="text-sm text-slate-800 mt-1">Virement sur le compte indiqué dans le mail, avec le numéro de chaque facture en communication.</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-700">Une question sur un dossier ?</p>
            <p className="text-sm text-slate-800 mt-1">Répondez simplement au mail du relevé, ou écrivez à administration@verviersdepannage.com en citant le numéro de facture.</p>
          </div>
        </div>
        <p className="text-xs text-slate-700">Les factures réglées disparaissent de ce relevé dès réception du paiement. Lien personnel et confidentiel.</p>
      </main>
    </div>
  )
}
