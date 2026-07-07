'use client'

// src/app/cmr/[id]/CmrPrintClient.tsx
//
// Surimpression CMR : affiche UNIQUEMENT les données, positionnées aux cases de la
// liasse CMR pré-imprimée. Réglage de calage (dx/dy en mm, mémorisé) pour aligner
// selon l'imprimante. Impression en N exemplaires (défaut 4, un par feuillet).

import { useEffect, useState } from 'react'

interface Fields {
  expediteur:    string
  destinataire:  string
  priseEnCharge: string
  livraison:     string
  marchandises:  string
  lieuDate:      string
  dossier:       string
}

// Position des cases sur A4 portrait (210×297mm), coin haut-gauche du texte.
// Valeurs de DÉPART (à affiner au 1er test d'impression via le calage dx/dy).
const TRANSPORTEUR = [
  'VERVIERS DÉPANNAGE',
  'Rue Lefin 12, 4860 Pepinster, Belgique',
  'Licence 184800',
  'info@verviersdepannage.be · +32 (0)87/35.18.20',
].join('\n')

const BOXES: Array<{ key: keyof Fields | 'transporteur' | 'transporteurSig'; x: number; y: number; w: number; size?: number; value?: string }> = [
  { key: 'expediteur',    x: 15,  y: 42,  w: 88 },   // 1
  { key: 'transporteur',  x: 112, y: 42,  w: 90, value: TRANSPORTEUR },   // 5
  { key: 'destinataire',  x: 15,  y: 70,  w: 88 },   // 2
  { key: 'priseEnCharge', x: 15,  y: 95,  w: 88 },   // 3
  { key: 'livraison',     x: 15,  y: 113, w: 88 },   // 4
  { key: 'marchandises',  x: 15,  y: 168, w: 180 },  // 10
  { key: 'lieuDate',      x: 15,  y: 250, w: 88 },   // 12
  { key: 'transporteurSig', x: 78, y: 276, w: 60, value: 'VERVIERS DÉPANNAGE\nRue Lefin 12, 4860 Pepinster\n+32 (0)87/35.18.20' }, // 15
]

export default function CmrPrintClient({ fields, label }: { fields: Fields; label: string }) {
  const [copies, setCopies] = useState(4)
  const [dx, setDx] = useState(0)
  const [dy, setDy] = useState(0)
  const [sx, setSx] = useState(1)   // échelle X (défaut 1)
  const [sy, setSy] = useState(1)   // échelle Y (corrige le décalage qui grandit vers le bas)

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem('cmr_calibration') || '{}')
      if (typeof s.dx === 'number') setDx(s.dx)
      if (typeof s.dy === 'number') setDy(s.dy)
      if (typeof s.sx === 'number') setSx(s.sx)
      if (typeof s.sy === 'number') setSy(s.sy)
    } catch { /* */ }
  }, [])

  function saveCal(patch: Partial<{ dx: number; dy: number; sx: number; sy: number }>) {
    const next = { dx, dy, sx, sy, ...patch }
    setDx(next.dx); setDy(next.dy); setSx(next.sx); setSy(next.sy)
    try { localStorage.setItem('cmr_calibration', JSON.stringify(next)) } catch { /* */ }
  }

  const pages = Array.from({ length: Math.max(1, Math.min(6, copies)) })

  return (
    <div>
      {/* Barre de contrôle — cachée à l'impression */}
      <div className="no-print" style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0f172a', color: '#fff', padding: '10px 16px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', fontFamily: 'system-ui' }}>
        <strong>CMR — {label}</strong>
        <label>Exemplaires : <input type="number" min={1} max={6} value={copies} onChange={e => setCopies(Number(e.target.value) || 1)} style={{ width: 48 }} /></label>
        <label>Calage X (mm) : <input type="number" value={dx} step={0.5} onChange={e => saveCal({ dx: Number(e.target.value) || 0 })} style={{ width: 60 }} /></label>
        <label>Calage Y (mm) : <input type="number" value={dy} step={0.5} onChange={e => saveCal({ dy: Number(e.target.value) || 0 })} style={{ width: 60 }} /></label>
        <label title="Corrige le décalage qui grandit vers le bas. Ex : 0,96 remonte proportionnellement les cases du bas.">Échelle Y : <input type="number" value={sy} step={0.01} onChange={e => saveCal({ sy: Number(e.target.value) || 1 })} style={{ width: 60 }} /></label>
        <button onClick={() => window.print()} style={{ background: '#2563eb', color: '#fff', border: 0, borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}>🖨️ Imprimer</button>
        <span style={{ fontSize: 13, background: '#b91c1c', padding: '4px 8px', borderRadius: 6, fontWeight: 600 }}>
          ⚠️ Dans la boîte d'impression : Échelle = <u>100 %</u> (PAS « Ajuster »), Marges = <u>Aucune</u>. Sinon tout se décale vers le bas.
        </span>
        <span style={{ fontSize: 12, opacity: 0.8 }}>Mets ta liasse CMR vierge dans l'imprimante. 1er essai : imprime 1 exemplaire, ajuste le calage, puis lance les {copies}.</span>
      </div>

      <style>{`
        @page { size: A4 portrait; margin: 0; }
        @media print { .no-print { display: none !important; } }
        .cmr-page { position: relative; width: 210mm; height: 297mm; page-break-after: always; overflow: hidden; background: #fff; }
        .cmr-field { position: absolute; font-family: Arial, sans-serif; font-size: 8pt; line-height: 1.2; color: #000; white-space: pre-line; }
        /* Aide visuelle à l'écran (cadres) — invisible à l'impression */
        @media screen { .cmr-page { box-shadow: 0 0 0 1px #ccc; margin: 16px auto; } .cmr-field { outline: 1px dashed rgba(37,99,235,.25); } }
      `}</style>

      {pages.map((_, i) => (
        <div className="cmr-page" key={i}>
          {BOXES.map((b, j) => {
            const text = b.value ?? (fields[b.key as keyof Fields] || '')
            if (!text) return null
            return (
              <div key={j} className="cmr-field" style={{
                left: `${b.x * sx + dx}mm`, top: `${b.y * sy + dy}mm`, width: `${b.w}mm`,
                fontSize: b.size ? `${b.size}pt` : undefined,
              }}>{text}</div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
