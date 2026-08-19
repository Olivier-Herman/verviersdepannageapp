// scripts/check-ps-51.mjs
//
// Windows PowerShell 5.1 termine l'instruction au saut de ligne : un `catch`,
// `else`, `elseif` ou `finally` en DEBUT de ligne y est un jeton orphelin, et
// tout le fichier casse. PowerShell 7 (macOS/Linux) l'accepte sans broncher —
// une verification de syntaxe sur Mac ne voit donc rien, et l'agent ne demarre
// pas sur le PC du bureau. C'est arrive le 19/08/2026.
//
//   node scripts/check-ps-51.mjs
import fs from 'node:fs'
import path from 'node:path'

const DIR = 'infra/scan-agent'
let bad = 0
for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.ps1'))) {
  const lines = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')
  lines.forEach((l, i) => {
    if (/^\s*(catch|else|elseif|finally)\b/.test(l)) {
      console.error(`${DIR}/${f}:${i + 1} — « ${l.trim().split(' ')[0]} » en debut de ligne : invalide en PowerShell 5.1`)
      bad++
    }
  })
}
if (bad) { console.error(`\n${bad} probleme(s) — recolle le mot-cle a l'accolade fermante de la ligne precedente.`); process.exit(1) }
console.log('PowerShell 5.1 : OK')
