'use client'

// src/components/profil/NavOrderEditor.tsx
//
// Editeur drag & drop pour personnaliser l'ordre du menu sidebar.
// Affiche les items autorises pour le user, drag pour reordonner,
// save sur drop (autosave). Bouton "Réinitialiser" pour revenir au
// default. Recharge la page apres save pour que la sidebar refresh.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, RotateCcw, Check } from 'lucide-react'
import { type NavItem } from '@/components/layout/nav-items'

interface Props {
  /** Items autorises pour le user (deja filtres par filterNavItems). */
  initialItems: NavItem[]
  /** Si l'ordre est custom, true (pour afficher le bouton reset). */
  hasCustomOrder: boolean
}

interface SortableRowProps {
  item: NavItem
}

function SortableRow({ item }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.href })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      className={`flex items-center gap-3 px-3 py-2.5 bg-surface-2 border rounded-xl select-none ${
        isDragging ? 'shadow-lg border-brand' : ''
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-ink-faint hover:text-ink-secondary touch-none"
        aria-label={`Glisser ${item.label}`}
      >
        <GripVertical size={16} />
      </button>
      <span className="text-base">{item.icon}</span>
      <span className="text-ink text-sm font-medium flex-1">{item.label}</span>
      <code className="text-ink-faint text-xs font-mono hidden sm:inline">{item.href}</code>
    </div>
  )
}

export default function NavOrderEditor({ initialItems, hasCustomOrder }: Props) {
  const router = useRouter()
  const { update: updateSession } = useSession()
  const [items, setItems] = useState<NavItem[]>(initialItems)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isCustom, setIsCustom] = useState(hasCustomOrder)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function persistOrder(order: string[] | null) {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/profil/nav-order', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ order }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Erreur ${res.status}`)
      }
      setSavedAt(Date.now())
      // 1. update() force useSession() a re-fetch /api/auth/session
      //    → AppShell / Sidebar lisent l'ordre fraichement sauve sans relogin
      // 2. router.refresh() re-render les server components au cas ou (defense)
      await updateSession()
      router.refresh()
    } catch (e: any) {
      setError(e.message || 'Erreur reseau')
    } finally {
      setSaving(false)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex(i => i.href === active.id)
    const newIndex = items.findIndex(i => i.href === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = [...items]
    const [moved] = reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, moved)
    setItems(reordered)
    setIsCustom(true)
    persistOrder(reordered.map(i => i.href))
  }

  function handleReset() {
    if (!confirm('Réinitialiser l\'ordre par défaut du menu ?')) return
    setIsCustom(false)
    persistOrder(null)
    // Pas besoin de muter items localement — le router.refresh recharge
    // avec l'ordre default.
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-ink-muted text-xs">
          Glisse les entrées pour les réorganiser. La sauvegarde est automatique.
        </p>
        <div className="flex items-center gap-2">
          {saving && <span className="text-ink-muted text-xs">⏳ Sauvegarde…</span>}
          {!saving && savedAt && (Date.now() - savedAt < 3000) && (
            <span className="text-success text-xs flex items-center gap-1">
              <Check size={12} /> Enregistré
            </span>
          )}
          {isCustom && (
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-surface-2 hover:bg-surface-hover border text-ink-secondary hover:text-ink rounded-lg text-xs transition disabled:opacity-50"
            >
              <RotateCcw size={12} /> Réinitialiser
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-critical-soft border border-critical rounded-xl p-3 text-critical text-sm">
          ⚠ {error}
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map(i => i.href)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {items.map(item => (
              <SortableRow key={item.href} item={item} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
