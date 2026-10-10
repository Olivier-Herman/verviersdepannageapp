'use client'
export default function Imprimer() {
  return (
    <div className="no-print" style={{ maxWidth: '210mm', margin: '0 auto 12px', display: 'flex', gap: 8 }}>
      <button className="btn btn-red" onClick={() => window.print()}>Imprimer</button>
      <button className="btn btn-ghost" onClick={() => window.close()}>Fermer</button>
    </div>
  )
}
