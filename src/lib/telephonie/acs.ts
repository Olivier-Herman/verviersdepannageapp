// src/lib/telephonie/acs.ts — appels REST au service d'appels Microsoft (Azure Communication Services, Call Automation)
// pour « Teams Phone extensibility » (Olivier 24/11/2026). Sans SDK : requêtes signées HMAC.
// Spec : azure-rest-api-specs, specification/communication/data-plane/CallAutomation/stable/2026-03-12.
// Variables d'environnement : ACS_ENDPOINT (https://<ressource>.communication.azure.com) et ACS_KEY (clé d'accès, base64).

import { createHash, createHmac } from 'crypto'

const VERSION = '2026-03-12'

function acsConfig() {
  const endpoint = (process.env.ACS_ENDPOINT || '').replace(/\/+$/, '')
  const key = process.env.ACS_KEY || ''
  if (!endpoint || !key) throw new Error('Service d’appels non configuré (ACS_ENDPOINT / ACS_KEY)')
  return { endpoint, key }
}

/** Requête signée vers le service d'appels. Renvoie le statut et le corps (JSON si présent). */
export async function acs(method: 'GET' | 'POST' | 'PUT' | 'DELETE', chemin: string, body?: unknown, version = VERSION): Promise<{ status: number; json: any }> {
  const { endpoint, key } = acsConfig()
  const url = new URL(`${endpoint}${chemin}${chemin.includes('?') ? '&' : '?'}api-version=${version}`)
  const raw = body === undefined ? '' : JSON.stringify(body)
  const date = new Date().toUTCString()
  const hash = createHash('sha256').update(raw, 'utf8').digest('base64')
  const sts = `${method}\n${url.pathname}${url.search}\n${date};${url.host};${hash}`
  const sig = createHmac('sha256', Buffer.from(key, 'base64')).update(sts, 'utf8').digest('base64')
  const r = await fetch(url.toString(), {
    method, cache: 'no-store', body: raw || undefined,
    headers: {
      'Content-Type': 'application/json', 'x-ms-date': date, 'x-ms-content-sha256': hash,
      Authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${sig}`,
      'Repeatability-Request-ID': crypto.randomUUID(), 'Repeatability-First-Sent': date,
    },
  })
  const txt = await r.text()
  let json: any = null; try { json = txt ? JSON.parse(txt) : null } catch { json = { brut: txt.slice(0, 300) } }
  return { status: r.status, json }
}

const erreur = (r: { status: number; json: any }) => `${r.status} ${r.json?.error?.message || r.json?.brut || ''}`.trim().slice(0, 200)

/** Renvoi sans décrocher (l'appelant n'entend rien de plus). */
export async function rediriger(incomingCallContext: string, cible: any): Promise<void> {
  const r = await acs('POST', '/calling/callConnections:redirect', { incomingCallContext, target: cible })
  if (r.status !== 204 && r.status !== 200) throw new Error(`Renvoi refusé : ${erreur(r)}`)
}

/** Décroche ; les événements de l'appel arrivent sur callbackUri. */
export async function decrocher(incomingCallContext: string, callbackUri: string, operationContext: string): Promise<string> {
  const r = await acs('POST', '/calling/callConnections:answer', { incomingCallContext, callbackUri, operationContext })
  if (r.status !== 200 && r.status !== 201) throw new Error(`Décroché refusé : ${erreur(r)}`)
  return r.json?.callConnectionId
}

/** Transfère un appel décroché ; le sujet (plaque, client) s'affiche dans la fenêtre d'appel Teams de l'agent. */
export async function transferer(connexionId: string, cible: any, ctx: { sujet?: string; numero?: string | null; nom?: string | null; operationContext?: string }): Promise<void> {
  const corps: any = { targetParticipant: cible, operationContext: ctx.operationContext }
  if (ctx.sujet && ctx.numero) {
    corps.customCallingContext = { teamsPhoneCallDetails: {
      callTopic: ctx.sujet.slice(0, 48),
      teamsPhoneCallerDetails: { caller: { phoneNumber: { value: ctx.numero } }, name: (ctx.nom || ctx.numero).slice(0, 64), phoneNumber: ctx.numero },
    } }
  }
  let r = await acs('POST', `/calling/callConnections/${encodeURIComponent(connexionId)}:transferToParticipant`, corps)
  // Contexte refusé : on retente sans (le transfert compte plus que l'affichage).
  if (r.status === 400 && corps.customCallingContext) { delete corps.customCallingContext; r = await acs('POST', `/calling/callConnections/${encodeURIComponent(connexionId)}:transferToParticipant`, corps) }
  if (r.status !== 202 && r.status !== 200) throw new Error(`Transfert refusé : ${erreur(r)}`)
}

/** Consentement serveur : autorise le service d'appels à recevoir les appels d'un compte de ressource Teams. */
export async function autoriserCompteRessource(tenantId: string, raObjectId: string): Promise<number> {
  const r = await acs('PUT', `/access/teamsExtension/tenants/${tenantId}/assignments/${raObjectId}`, { principalType: 'teamsResourceAccount' }, '2025-06-30')
  if (r.status >= 300) throw new Error(`Consentement refusé : ${erreur(r)}`)
  return r.status
}
