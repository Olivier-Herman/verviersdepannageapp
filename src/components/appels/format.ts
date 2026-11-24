// Affichage commun des appels (écran « Appels à rattacher », encadré de la fiche).
export const dureeTxt = (s: number) => s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}` : `${s} s`
export function quandTxt(iso: string) {
  const d = new Date(iso), auj = new Date()
  const jour = (x: Date) => x.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' })
  const hier = new Date(+auj - 864e5)
  const h = d.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })
  return jour(d) === jour(auj) ? `Aujourd’hui ${h}` : jour(d) === jour(hier) ? `Hier ${h}` : `${d.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit' })} ${h}`
}
export const pastilleSens = (sens: string, perdu: boolean) => sens === 'note'
  ? { txt: 'Noté', cls: 'bg-amber-100 text-amber-900' } : sens === 'sortant'
  ? { txt: 'Émis', cls: 'bg-indigo-100 text-indigo-800' } : perdu ? { txt: 'Perdu', cls: 'bg-red-100 text-red-800' } : { txt: 'Reçu', cls: 'bg-green-100 text-green-800' }
