// scripts/build-scan-agent-zip.mjs
//
// Regenere le paquet de l'agent Scan (infra/scan-agent) en base64 dans
// src/app/api/scan-agent/agent-zip.ts, servi par /api/scan-agent.
// À relancer après CHAQUE modification des fichiers de l'agent :
//   node scripts/build-scan-agent-zip.mjs

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SRC  = 'infra/scan-agent'
const DEST = 'src/app/api/scan-agent/agent-zip.ts'
const NAME = 'scan-agent-vdsoft.zip'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-agent-'))
const staging = path.join(tmp, 'vdsoft-scan-agent')
fs.mkdirSync(staging)
for (const f of fs.readdirSync(SRC)) fs.copyFileSync(path.join(SRC, f), path.join(staging, f))

const zipPath = path.join(tmp, NAME)
execFileSync('zip', ['-r', '-X', '-q', zipPath, 'vdsoft-scan-agent'], { cwd: tmp })

const b64 = fs.readFileSync(zipPath).toString('base64')
fs.mkdirSync(path.dirname(DEST), { recursive: true })
fs.writeFileSync(DEST, `// Paquet agent Scan (infra/scan-agent) en base64. Version PowerShell pure (SANS Node).
// GENERE — ne pas editer a la main : node scripts/build-scan-agent-zip.mjs
export const AGENT_ZIP_NAME = '${NAME}'
export const AGENT_ZIP_B64 = '${b64}'
`)
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`${DEST} régénéré (${Math.round(b64.length / 1024)} Ko base64)`)
