// src/app/fourriere/inventaire/page.tsx
// L'ancien inventaire est remplacé par le Contrôle du parc (Olivier 21/10/2026) :
// les anciens liens et favoris y mènent directement.

import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function InventairePage() {
  redirect('/fourriere/controle')
}
