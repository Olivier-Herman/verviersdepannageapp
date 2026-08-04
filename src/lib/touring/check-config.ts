// src/lib/touring/check-config.ts
//
// Réglages du module « Check Touring » stockés dans app_settings
// (RAPPEL : app_settings.value est du TEXTE JSON → toujours JSON.parse à la lecture).

import { randomUUID } from 'crypto'

const TOKEN_KEY = 'touring_check_token'
const EMAIL_KEY = 'touring_check_email'

// Destinataires du rappel mensuel (par défaut ; surchargeable via app_settings).
export const CHECK_EMAIL_DEFAULT = 'BKO.Comex@touring.be'
export const CHECK_EMAIL_CC = ['Andre.ANGELIQUE@touring.be']
export const CHECK_EMAIL_BCC = ['mobi@verviersdepannage.be']

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'

async function readSetting(sb: any, key: string): Promise<string | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle()
  if (!data?.value) return null
  try { return JSON.parse(data.value) } catch { return data.value }
}
async function writeSetting(sb: any, key: string, value: string): Promise<void> {
  await sb.from('app_settings').upsert({ key, value: JSON.stringify(value) }, { onConflict: 'key' })
}

/** Jeton stable du lien public Touring (créé si absent). */
export async function getCheckToken(sb: any): Promise<string> {
  let tok = await readSetting(sb, TOKEN_KEY)
  if (!tok) {
    tok = randomUUID().replace(/-/g, '')
    await writeSetting(sb, TOKEN_KEY, tok)
  }
  return tok
}

/** Régénère le jeton (invalide l'ancien lien). */
export async function rotateCheckToken(sb: any): Promise<string> {
  const tok = randomUUID().replace(/-/g, '')
  await writeSetting(sb, TOKEN_KEY, tok)
  return tok
}

/** Adresse mail de Touring pour le rappel mensuel (défaut BKO.Comex@touring.be). */
export async function getCheckEmail(sb: any): Promise<string> {
  return (await readSetting(sb, EMAIL_KEY)) || CHECK_EMAIL_DEFAULT
}
export async function setCheckEmail(sb: any, email: string): Promise<void> {
  await writeSetting(sb, EMAIL_KEY, email.trim())
}

export function checkLink(token: string): string {
  return `${APP_URL}/touring/check/${token}`
}
