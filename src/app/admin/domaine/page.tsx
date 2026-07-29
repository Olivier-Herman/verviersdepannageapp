// src/app/admin/domaine/page.tsx
// Module déplacé sous la Fourrière → redirection (préserve les anciens liens).
import { redirect } from 'next/navigation'
export const dynamic = 'force-dynamic'
export default function AdminDomaineRedirect() {
  redirect('/fourriere/domaine')
}
