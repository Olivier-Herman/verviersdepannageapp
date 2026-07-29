// src/app/admin/domaine-in/page.tsx
// Module déplacé sous la Fourrière → redirection (préserve les anciens liens).
import { redirect } from 'next/navigation'
export const dynamic = 'force-dynamic'
export default function AdminDomaineInRedirect() {
  redirect('/fourriere/domaine/dates-in')
}
