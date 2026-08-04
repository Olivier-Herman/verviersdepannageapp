// src/app/touring/check/[token]/page.tsx
// Page PUBLIQUE (lien token) où Touring tranche les dossiers hors comex.
// /touring n'est pas dans le matcher middleware → route publique.

import TouringCheckClient from './TouringCheckClient'

export const dynamic = 'force-dynamic'

export default function Page({ params }: { params: { token: string } }) {
  return <TouringCheckClient token={params.token} />
}
