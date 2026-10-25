// src/lib/time/bxl-offset.ts — décalage horaire réel de Bruxelles (+01:00 en hiver, +02:00 en été).
// Changement d'heure du 25/10/2026 : les heures lues sans fuseau (COMEX, VAB, relevés…) étaient complétées par un
// « +02:00 » fixe et tombaient une heure trop tôt en hiver (missions Touring « reçues il y a une heure » à
// l'acceptation, Olivier 25/10/2026). Toujours passer par ici pour une heure locale belge sans fuseau.

const offsetAt = (d: Date): number => {
  const s = d.toLocaleString('en-US', { timeZone: 'Europe/Brussels', timeZoneName: 'shortOffset' })
  const m = s.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/)
  return m ? parseInt(m[1], 10) * 60 + (m[2] ? Math.sign(parseInt(m[1], 10)) * parseInt(m[2], 10) : 0) : 60
}

/** Décalage « +01:00 » / « +02:00 » d'une heure locale de Bruxelles « AAAA-MM-JJ[THH:mm[:ss]] ». */
export function brusselsOffset(local: string): string {
  const base = String(local).slice(0, 19)
  const iso = base.length <= 10 ? `${base}T12:00:00` : base.length === 16 ? `${base}:00` : base
  // Première estimation en hiver, puis correction avec le décalage réel à cet instant.
  let min = offsetAt(new Date(`${iso}+01:00`))
  min = offsetAt(new Date(Date.parse(`${iso}Z`) - min * 60e3))
  const h = Math.floor(Math.abs(min) / 60), mm = Math.abs(min) % 60
  return `${min < 0 ? '-' : '+'}${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** Heure locale de Bruxelles sans fuseau → ISO avec le bon décalage. */
export const withBrusselsOffset = (local: string): string => `${String(local).slice(0, 19)}${brusselsOffset(local)}`
