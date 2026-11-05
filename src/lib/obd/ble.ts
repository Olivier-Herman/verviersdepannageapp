// src/lib/obd/ble.ts — dialogue Bluetooth avec un boîtier OBD ELM327 (Vgate iCar Pro 2S…), dans l'app VD Soft.
// Diagnostic OBD (Olivier 05/11/2026). Côté navigateur seulement : le module natif BluetoothLe n'existe que dans la
// version de l'app qui l'embarque (test Mobi / Franck). Ailleurs, obdAvailable() est faux et rien ne s'affiche.
// Le service et les caractéristiques ne sont pas figés : on prend le premier couple « notification + écriture »
// trouvé (les boîtiers Vgate utilisent FFF0/FFF1/FFF2, d'autres E7810A71…).
'use client'

import * as E from './elm327'

type Ble = typeof import('@capacitor-community/bluetooth-le').BleClient

export interface ObdLink { deviceId: string; name: string; send: (cmd: string, timeoutMs?: number) => Promise<string>; close: () => Promise<void> }

export interface ObdReading {
  vin: string | null
  codes: { code: string; type: 'memorise' | 'en_attente' }[]
  measures: { batterie_v: number | null; temp_moteur_c: number | null; regime_tr_min: number | null; temoin_moteur: boolean | null; nb_codes: number | null }
  protocol: string | null
}

/** Le module Bluetooth est-il dans cette version de l'app ? (jamais d'await sur un proxy de plugin) */
export async function obdAvailable(): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('BluetoothLe')
  } catch { return false }
}

async function client(): Promise<Ble> {
  const m = await import('@capacitor-community/bluetooth-le')
  return m.BleClient
}

const enc = new TextEncoder(), dec = new TextDecoder()

/** Recherche le boîtier (fenêtre de choix du système), s'y connecte et prépare le dialogue ELM327. */
export async function connectObd(onStatus?: (s: string) => void): Promise<ObdLink> {
  const ble = await client()
  await ble.initialize({ androidNeverForLocation: true })
  onStatus?.('recherche')
  const device = await ble.requestDevice({ optionalServices: ['0000fff0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '000018f0-0000-1000-8000-00805f9b34fb'] })
  onStatus?.('connexion')
  await ble.connect(device.deviceId)
  const services = await ble.getServices(device.deviceId)
  let svc = '', rx = '', tx = ''
  for (const s of services) {
    const n = s.characteristics.find(c => c.properties.notify || c.properties.indicate)
    const w = s.characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse)
    if (n && w) { svc = s.uuid; rx = n.uuid; tx = w.uuid; if (/fff0|e7810a71|18f0/i.test(s.uuid)) break }
  }
  if (!svc) { await ble.disconnect(device.deviceId).catch(() => {}); throw new Error('Boîtier non reconnu (aucun canal de dialogue trouvé)') }
  const writeNoResp = !!services.find(s => s.uuid === svc)?.characteristics.find(c => c.uuid === tx)?.properties.writeWithoutResponse

  let buffer = '', waiter: ((s: string) => void) | null = null
  await ble.startNotifications(device.deviceId, svc, rx, (v: DataView) => {
    buffer += dec.decode(v)
    if (buffer.includes('>') && waiter) { const out = buffer; buffer = ''; const w = waiter; waiter = null; w(out) }
  })

  let queue = Promise.resolve('')
  const send = (cmd: string, timeoutMs = 4000) => {
    queue = queue.then(() => new Promise<string>(async (resolve) => {
      buffer = ''
      const timer = setTimeout(() => { waiter = null; resolve(buffer || 'NO DATA') }, timeoutMs)
      waiter = (s) => { clearTimeout(timer); resolve(s) }
      const bytes = enc.encode(cmd + '\r')
      // Par paquets de 20 octets (taille minimale garantie en BLE).
      for (let i = 0; i < bytes.length; i += 20) {
        const chunk = new DataView(bytes.slice(i, i + 20).buffer)
        if (writeNoResp) await ble.writeWithoutResponse(device.deviceId, svc, tx, chunk).catch(() => {})
        else await ble.write(device.deviceId, svc, tx, chunk).catch(() => {})
      }
    }))
    return queue
  }
  for (const c of ['ATZ', 'ATE0', 'ATL0', 'ATS1', 'ATH0', 'ATSP0']) await send(c, c === 'ATZ' ? 3000 : 2000)
  return { deviceId: device.deviceId, name: device.name || 'Boîtier OBD', send, close: async () => { await ble.stopNotifications(device.deviceId, svc, rx).catch(() => {}); await ble.disconnect(device.deviceId).catch(() => {}) } }
}

/** Lecture complète : VIN, codes mémorisés et en attente, mesures. Rien n'est effacé ici. */
export async function readVehicle(link: ObdLink, onStatus?: (s: string) => void): Promise<ObdReading> {
  onStatus?.('lecture')
  await link.send('0100', 10000)   // le boîtier cherche le protocole de la voiture (jusqu'à quelques secondes)
  const protocol = (await link.send('ATDPN', 2000)).replace(/[>\s]/g, '') || null
  const vin = E.parseVin(await link.send('0902', 6000))
  const status = E.parseMonitorStatus(await link.send('0101'))
  const stored = E.parseDtcs(await link.send('03', 6000), 3)
  const pending = E.parseDtcs(await link.send('07', 6000), 7)
  const temp = E.parseCoolant(await link.send('0105'))
  const rpm = E.parseRpm(await link.send('010C'))
  const volt = E.parseAtVoltage(await link.send('ATRV')) ?? E.parseModuleVoltage(await link.send('0142'))
  return {
    vin, protocol,
    codes: [...stored.map(code => ({ code, type: 'memorise' as const })), ...pending.filter(c => !stored.includes(c)).map(code => ({ code, type: 'en_attente' as const }))],
    measures: { batterie_v: volt, temp_moteur_c: temp, regime_tr_min: rpm, temoin_moteur: status?.mil ?? null, nb_codes: status?.count ?? null },
  }
}

/** Effacement (mode 04). Appelé seulement après la signature par PIN, validée par le serveur. */
export async function clearCodes(link: ObdLink): Promise<'ok' | 'refuse'> {
  const r = await link.send('04', 8000)
  return E.clearAccepted(r) ? 'ok' : 'refuse'
}
