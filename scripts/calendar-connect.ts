// Connexion d'un agenda Outlook par code d'appareil (Olivier 28/10/2026).
// npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/calendar-connect.ts <boîte>
import { demarrerCode, attendreConnexion } from '@/lib/calendar/device'
;(async () => {
  const box = process.argv[2]
  if (!box) { console.log('usage : calendar-connect.ts <boîte>'); process.exit(1) }
  const c = await demarrerCode()
  console.log(`CODE ${c.user_code} — ouvrir ${c.verification_uri} et se connecter avec ${box}`)
  const r = await attendreConnexion(box, c.device_code, c.interval, c.expires_in)
  console.log(r.ok ? `CONNECTÉ ${r.compte}` : `ÉCHEC ${r.error}`)
})()
