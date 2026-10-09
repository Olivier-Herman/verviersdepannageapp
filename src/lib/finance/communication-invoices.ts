// src/lib/finance/communication-invoices.ts
//
// NUMÉROS DE FACTURE DANS UNE COMMUNICATION BANCAIRE (Olivier 09/10/2026).
// Touring, 37 043,10 € le 02/10 : « 2026/08/200 2026/08/1832026/08/711 2026/08/7072026/08/708 2026/09/0362 026/08/695 »
// — la banque colle des numéros (« …/1832026/… ») ou coupe au mauvais endroit (« …/0362 026/… »). Lus mot à mot,
// la moitié des factures passaient inaperçues et le virement restait en attente.
//
// Méthode : on retire TOUS les espaces, puis on repère chaque début « AAAA/MM/ » ; les chiffres qui suivent, jusqu'au
// début suivant, forment le numéro. Comme un numéro peut faire 3 ou 4 chiffres, on rend les deux lectures possibles :
// seule celle qui existe dans les factures est retenue (vérification faite par l'appelant). Les notes de crédit
// « AAAA-NNNN » sont lues de la même façon.

export interface InvoiceMention {
  /** Lectures possibles, la plus probable d'abord (« 2026/09/036 », puis « 2026/09/0362 » si 4 chiffres). */
  candidates: string[]
}

/** La partie utile : après « Communication », sinon tout le libellé. */
function usefulPart(text: string): string {
  const s = String(text || '')
  const m = s.match(/communication\s*:?\s*([\s\S]*)$/i)
  return m ? m[1] : s
}

export function invoiceMentions(text: string): InvoiceMention[] {
  const s = usefulPart(text).replace(/\s+/g, '')
  const out: InvoiceMention[] = []
  const seen = new Set<string>()
  const push = (c: string[]) => {
    const k = c.join('|')
    if (!c.length || seen.has(k)) return
    seen.add(k); out.push({ candidates: c })
  }

  // Factures « AAAA/MM/NNN(N) ».
  const starts: number[] = []
  const re = /20\d{2}\/\d{2}\//g
  for (let m = re.exec(s); m; m = re.exec(s)) starts.push(m.index)
  starts.forEach((pos, i) => {
    const head = s.slice(pos, pos + 8)
    const end = i + 1 < starts.length ? starts[i + 1] : s.length
    const digits = (s.slice(pos + 8, end).match(/^\d+/) || [''])[0]
    if (digits.length === 3) push([head + digits])
    else if (digits.length === 4) push([head + digits.slice(0, 3), head + digits])
    else if (digits.length > 4) push([head + digits.slice(0, 3), head + digits.slice(0, 4)])
  })

  // Notes de crédit « AAAA-NNNN ».
  const nc = /20\d{2}-\d{4}(?!\d)/g
  for (let m = nc.exec(s); m; m = nc.exec(s)) push([m[0]])

  return out
}

/** Toutes les lectures possibles, pour une seule recherche dans les factures. */
export const allCandidates = (ms: InvoiceMention[]) => [...new Set(ms.flatMap(m => m.candidates))]
