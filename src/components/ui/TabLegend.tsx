'use client'
// Légende des onglets « qui a la main » (Olivier 16/09/2026 : « une petite
// légende pour les onglets »). Une ligne discrète sous les onglets, chaque
// pastille avec sa couleur et un mot d'explication ; aussi posée en `title`
// sur l'onglet correspondant par l'appelant.

export interface LegendItem { dot?: string; label: string; text: string }

export default function TabLegend({ items }: { items: LegendItem[] }) {
  return (
    <p className="text-[11px] text-ink-muted flex flex-wrap gap-x-4 gap-y-0.5 px-0.5">
      {items.map(i => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.dot && <span className={`inline-block w-2 h-2 rounded-full ${i.dot}`} />}
          <b className="text-ink-secondary font-semibold">{i.label}</b> {i.text}
        </span>
      ))}
    </p>
  )
}
