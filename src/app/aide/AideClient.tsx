'use client'

import { useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { BookOpen, Download, ExternalLink } from 'lucide-react'

interface Guide {
  id:          string
  title:       string
  file:        string
  description: string
}

export default function AideClient({ guides, userName }: { guides: Guide[]; userName: string }) {
  // Par defaut, ouvre le premier guide disponible
  const [activeId, setActiveId] = useState<string>(guides[0]?.id || '')
  const activeGuide = guides.find(g => g.id === activeId)

  return (
    <AppShell title="Aide & Mode d'emploi" userName={userName}>
      <div className="flex h-[calc(100vh-4rem)] overflow-hidden">

        {/* Sidebar : liste des guides disponibles */}
        <aside className="w-72 border-r border bg-surface overflow-y-auto flex-shrink-0">
          <div className="p-4 border-b">
            <h2 className="text-ink text-lg font-bold flex items-center gap-2">
              <BookOpen size={20} />
              Mode d&apos;emploi
            </h2>
            <p className="text-ink-muted text-xs mt-1">
              Documents disponibles selon ton profil. Cliquer pour consulter.
            </p>
          </div>

          <nav className="p-2 space-y-1">
            {guides.length === 0 && (
              <div className="p-4 text-ink-muted text-sm text-center">
                Aucun mode d&apos;emploi disponible pour ton profil actuel.
                Contacte un admin.
              </div>
            )}
            {guides.map(g => (
              <button
                key={g.id}
                onClick={() => setActiveId(g.id)}
                className={`w-full text-left px-3 py-3 rounded-xl transition ${
                  activeId === g.id
                    ? 'bg-brand text-white shadow-md'
                    : 'hover:bg-surface-hover text-ink'
                }`}
              >
                <p className={`text-sm font-bold ${activeId === g.id ? 'text-white' : 'text-ink'}`}>
                  {g.title}
                </p>
                <p className={`text-xs mt-0.5 leading-tight ${
                  activeId === g.id ? 'text-white/80' : 'text-ink-muted'
                }`}>
                  {g.description}
                </p>
              </button>
            ))}
          </nav>

          {/* Actions globales */}
          {activeGuide && (
            <div className="p-3 mt-2 border-t space-y-2">
              <a
                href={activeGuide.file}
                target="_blank"
                rel="noopener"
                className="flex items-center gap-2 text-xs px-3 py-2 bg-surface-hover hover:bg-surface text-ink-secondary rounded-lg transition"
              >
                <ExternalLink size={14} />
                Ouvrir en plein écran
              </a>
              <a
                href={activeGuide.file}
                download
                className="flex items-center gap-2 text-xs px-3 py-2 bg-surface-hover hover:bg-surface text-ink-secondary rounded-lg transition"
              >
                <Download size={14} />
                Télécharger (HTML)
              </a>
              <p className="text-ink-faint text-[10px] pt-2 leading-tight">
                💡 Pour imprimer en PDF : ouvre en plein écran, puis Cmd+P → Enregistrer au format PDF.
              </p>
            </div>
          )}
        </aside>

        {/* Contenu principal : iframe vers le HTML */}
        <main className="flex-1 overflow-hidden">
          {activeGuide ? (
            <iframe
              key={activeGuide.id}
              src={activeGuide.file}
              className="w-full h-full border-none"
              title={activeGuide.title}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-ink-muted text-sm">
              Sélectionne un mode d&apos;emploi à gauche
            </div>
          )}
        </main>

      </div>
    </AppShell>
  )
}
