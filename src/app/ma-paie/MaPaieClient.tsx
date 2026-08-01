'use client'
// src/app/ma-paie/MaPaieClient.tsx
//
// Écran travailleur : mes fiches de paie (accès perso). Le PDF n'est servi que
// si l'utilisateur est bien le propriétaire (cf /api/paie/pdf). Olivier 2026-08-01.

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { FileText, Download, Wallet, Info, Eye, X } from 'lucide-react'

const COMPANIES: Record<string, string> = { '438': 'Verviers Dépannage', '3068': 'DGJ VHU' }
const MONTHS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const monthLabel = (p: string) => { const m = parseInt((p || '').split('-')[1]); return MONTHS[m] || p }
const TYPE_LABELS: Record<string, string> = { salaire: 'Salaire', prime: 'Prime', vacances: 'Pécule de vacances', conge: 'Congé', autre: 'Autre' }
export const ficheLabel = (s: any) => s.label || TYPE_LABELS[s.type] || (s.type ? s.type : 'Salaire')

export default function MaPaieClient({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [data, setData]   = useState<any>(null)
  const [loading, setLd]  = useState(true)
  const [preview, setPreview] = useState<any>(null)

  useEffect(() => {
    fetch('/api/paie/mine', { cache: 'no-store' }).then(r => r.json())
      .then(setData).catch(() => setData({ payslips: [], linked: false })).finally(() => setLd(false))
  }, [])

  const slips: any[] = data?.payslips || []
  const multiCompany = new Set(slips.map(s => s.company_code)).size > 1
  // Groupé par année (desc).
  const byYear: Record<string, any[]> = {}
  for (const s of slips) { const y = (s.period || '').split('-')[0]; (byYear[y] = byYear[y] || []).push(s) }
  const years = Object.keys(byYear).sort().reverse()

  return (
    <AppShell title="Mes fiches de paie" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-brand/10 text-brand flex items-center justify-center"><Wallet size={24} /></div>
          <div>
            <h1 className="text-xl font-bold text-ink leading-tight">Mes fiches de paie</h1>
            <p className="text-ink-muted text-sm">{data?.name || userName}</p>
          </div>
        </div>

        {loading && <p className="text-ink-muted text-sm">Chargement…</p>}

        {!loading && !data?.linked && (
          <div className="bg-info-soft border border-info rounded-2xl p-5 flex items-start gap-3">
            <Info size={20} className="text-info flex-shrink-0 mt-0.5" />
            <div className="text-sm text-ink">
              <p className="font-medium mb-1">Aucune fiche liée à ton compte pour l’instant.</p>
              <p className="text-ink-secondary">Tes fiches de paie apparaîtront ici dès qu’elles seront rattachées à ton compte. Contacte l’administration si besoin.</p>
            </div>
          </div>
        )}

        {!loading && data?.linked && slips.length === 0 && (
          <p className="text-ink-muted text-sm italic">Aucune fiche disponible pour le moment.</p>
        )}

        {!loading && slips.length > 0 && (
          <div className="flex flex-col gap-6">
            {years.map(year => (
              <div key={year}>
                <h2 className="text-ink-muted text-xs font-semibold uppercase tracking-wide mb-2">{year}</h2>
                <div className="flex flex-col gap-2">
                  {byYear[year].map((s: any) => (
                    <button key={s.id} onClick={() => setPreview(s)}
                      className="flex items-center gap-3 bg-surface border rounded-xl px-4 py-3 hover:border-brand/40 transition group text-left w-full">
                      <div className="w-9 h-9 rounded-lg bg-brand/10 text-brand flex items-center justify-center flex-shrink-0"><FileText size={18} /></div>
                      <div className="flex-1 min-w-0">
                        <div className="text-ink font-medium"><span className="capitalize">{monthLabel(s.period)}</span> {year}</div>
                        <div className="text-ink-muted text-xs">
                          {ficheLabel(s)}{multiCompany ? ` · ${COMPANIES[s.company_code] || s.company_code}` : ''}
                        </div>
                      </div>
                      <Eye size={18} className="text-ink-muted group-hover:text-brand flex-shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Prévisualisation in-app du PDF */}
      {preview && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex flex-col">
          <div className="flex items-center gap-2 px-4 py-3 bg-surface border-b">
            <FileText size={18} className="text-brand" />
            <div className="flex-1 min-w-0">
              <div className="text-ink font-medium text-sm"><span className="capitalize">{monthLabel(preview.period)}</span> {(preview.period || '').split('-')[0]}</div>
              <div className="text-ink-muted text-xs">{ficheLabel(preview)}</div>
            </div>
            <a href={`/api/paie/pdf?id=${preview.id}`} download target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm text-ink-secondary hover:text-brand"><Download size={15} /> Télécharger</a>
            <button onClick={() => setPreview(null)} className="p-1.5 text-ink-muted hover:text-ink"><X size={20} /></button>
          </div>
          <iframe src={`/api/paie/pdf?id=${preview.id}`} className="flex-1 w-full bg-white" title="Fiche de paie" />
        </div>
      )}
    </AppShell>
  )
}
