// Lien et QR code d'un garage partenaire (/d/ebac) : ouvre VD Assistance avec ce garage présélectionné.
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function Page({ params }: { params: { slug: string } }) {
  redirect(`/assistance?garage=${encodeURIComponent(String(params.slug || '').toLowerCase())}`)
}
