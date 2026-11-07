// src/lib/obd/ble.ts — dialogue Bluetooth avec un boîtier OBD ELM327 (Vgate iCar Pro 2S…), dans l'app VD Soft.
// Diagnostic OBD (Olivier 05/11/2026). Côté navigateur seulement : le module natif BluetoothLe n'existe que dans la
// version de l'app qui l'embarque (test Mobi / Franck). Ailleurs, obdAvailable() est faux et rien ne s'affiche.
// Le service et les caractéristiques ne sont pas figés : on prend le premier couple « notification + écriture »
// trouvé (les boîtiers Vgate utilisent FFF0/FFF1/FFF2, d'autres E7810A71…).
'use client'

import * as E from './elm327'

type Ble = typeof import('@capacitor-community/bluetooth-le').BleClient

export interface ObdLink { deviceId: string; name: string; send: (cmd: string, timeoutMs?: number) => Promise<string>; close: () => Promise<void>; lost: () => boolean; initRaw: RawEntry[] }

export interface RawEntry { cmd: string; raw: string }
export type ObdCode = { code: string; type: 'memorise' | 'en_attente' | 'permanent'; ecu?: string }
export interface ObdMeasures {
  batterie_v: number | null; temp_moteur_c: number | null; regime_tr_min: number | null
  carburant?: string | null; carburant_source?: 'voiture' | 'allumage' | null
  temoin_moteur: boolean | null; nb_codes: number | null
  km_temoin_allume?: number | null; km_depuis_effacement?: number | null; demarrages_depuis_effacement?: number | null; minutes_depuis_effacement?: number | null
  calculateur_nom?: string | null; calibration?: string | null; calculateur_boite?: boolean
  kilometrage?: number | null; controles_total?: number | null; controles_non_prets?: number | null
}
export interface ObdFreeze { code: string; charge_pct: number | null; temp_moteur_c: number | null; regime_tr_min: number | null; vitesse_kmh: number | null }
export interface ObdReading {
  vin: string | null
  codes: ObdCode[]
  measures: ObdMeasures
  protocol: string | null
  lecture: E.Lecture
  freeze: ObdFreeze | null
  raw: RawEntry[]
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
const BOITIER_MEMO = 'vd-obd-boitier'

/** Recherche le boîtier (fenêtre de choix du système), s'y connecte et prépare le dialogue ELM327. */
export async function connectObd(onStatus?: (s: string) => void): Promise<ObdLink> {
  const ble = await client()
  await ble.initialize({ androidNeverForLocation: true })
  let perdu = false
  let surPerte: (() => void) | null = null
  const onDisconnect = () => { perdu = true; surPerte?.() }
  // Le téléphone retient son boîtier : la liste de tous les appareils Bluetooth autour (illisible, « Unknown »)
  // ne s'ouvre que la première fois ou si ce boîtier ne répond pas (Olivier 07/11/2026).
  let device: { deviceId: string; name?: string } | null = null
  let memo: string | null = null
  try { memo = localStorage.getItem(BOITIER_MEMO) } catch { memo = null }
  if (memo) {
    onStatus?.('connexion')
    try {
      const [connu] = await ble.getDevices([memo])
      if (connu) {
        await Promise.race([ble.connect(connu.deviceId, onDisconnect), new Promise((_, ko) => setTimeout(() => ko(new Error('délai')), 8000))])
        device = connu
      }
    } catch { await ble.disconnect(memo).catch(() => {}) }
  }
  if (!device) {
    onStatus?.('recherche')
    device = await ble.requestDevice({ optionalServices: ['0000fff0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '000018f0-0000-1000-8000-00805f9b34fb'] })
    onStatus?.('connexion')
    await ble.connect(device.deviceId, onDisconnect)
  }
  try { localStorage.setItem(BOITIER_MEMO, device.deviceId) } catch { /* sans mémoire : la liste s'ouvrira la prochaine fois */ }
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

  // Par paquets de 20 octets (taille minimale garantie en BLE). Faux si l'écriture échoue : jamais lu comme « pas de code ».
  const write = async (txt: string) => {
    const bytes = enc.encode(txt)
    try {
      for (let i = 0; i < bytes.length; i += 20) {
        const chunk = new DataView(bytes.slice(i, i + 20).buffer)
        if (writeNoResp) await ble.writeWithoutResponse(device.deviceId, svc, tx, chunk)
        else await ble.write(device.deviceId, svc, tx, chunk)
      }
      return true
    } catch { return false }
  }

  let queue = Promise.resolve('')
  const send = (cmd: string, timeoutMs = 4000) => {
    queue = queue.then(() => new Promise<string>((resolve) => {
      if (perdu) { resolve(E.LIEN_PERDU); return }
      buffer = ''
      let fini = false, t1: ReturnType<typeof setTimeout>, t2: ReturnType<typeof setTimeout>
      const finish = (s: string) => { if (fini) return; fini = true; clearTimeout(t1); clearTimeout(t2); waiter = null; surPerte = null; resolve(s) }
      surPerte = () => finish(E.LIEN_PERDU)
      // Trop long : on interrompt la commande et on attend l'invite, sinon sa réponse tardive serait prise pour la suivante.
      t1 = setTimeout(() => {
        waiter = () => finish(E.TIMEOUT)
        t2 = setTimeout(() => finish(E.TIMEOUT), 1500)
        write('\r')
      }, timeoutMs)
      waiter = finish
      write(cmd + '\r').then(ok => { if (!ok) finish(E.LIEN_PERDU) })
    }))
    return queue
  }
  const initRaw: RawEntry[] = []
  // ATH1 : chaque réponse dit quel calculateur parle. ATI, AT@1, AT@2 : identité du boîtier, gardée avec la lecture.
  for (const c of ['ATZ', 'ATE0', 'ATL0', 'ATS1', 'ATH1', 'ATSP0', 'ATI', 'AT@1', 'AT@2']) {
    const raw = await send(c, c === 'ATZ' ? 3000 : 2000)
    if (['ATZ', 'ATH1', 'ATI', 'AT@1', 'AT@2'].includes(c)) initRaw.push({ cmd: c, raw: raw.slice(0, 200) })
  }
  return { deviceId: device.deviceId, name: device.name || 'Boîtier OBD', send, lost: () => perdu, initRaw, close: async () => { await ble.stopNotifications(device.deviceId, svc, rx).catch(() => {}); await ble.disconnect(device.deviceId).catch(() => {}) } }
}

/** Lecture complète : codes, mesures disponibles, image figée. Rien n'est effacé ici. */
export async function readVehicle(link: ObdLink, onStatus?: (s: string) => void): Promise<ObdReading> {
  onStatus?.('lecture')
  const raw: RawEntry[] = [...link.initRaw]
  const log = async (cmd: string, timeoutMs?: number) => { const r = await link.send(cmd, timeoutMs); raw.push({ cmd, raw: r.slice(0, 1500) }); return r }
  let protocol: string | null = null
  const ask = async (cmd: string, mode: number, pid: number | null, timeoutMs = 4000, essais = 2): Promise<E.Reply> => {
    let r = E.parseReply(await log(cmd, timeoutMs), mode, pid, protocol)
    for (let i = 1; i < essais && r.status === 'erreur' && r.detail !== 'lien_perdu'; i++) r = E.parseReply(await log(cmd, timeoutMs), mode, pid, protocol)
    return r
  }

  const premierRaw = await log('0100', 10000)   // le boîtier cherche le protocole de la voiture (jusqu'à quelques secondes)
  const dpn = (await log('ATDPN', 2000)).replace(/[>\s]/g, '')
  protocol = /^A?[0-9A-C]$/i.test(dpn) ? dpn.toUpperCase() : null
  let premier = E.parseReply(premierRaw, 1, 0, protocol)
  if (premier.status !== 'ok') premier = await ask('0100', 1, 0, 10000, 1)
  const volt0 = E.parseAtVoltage(await log('ATRV', 2000))
  const vide: ObdMeasures = { batterie_v: volt0, temp_moteur_c: null, regime_tr_min: null, carburant: null, carburant_source: null, temoin_moteur: null, nb_codes: null }
  const refusVide = { status: 'pas_de_reponse' as const, messages: [] }
  if (premier.status !== 'ok') return { vin: null, codes: [], measures: vide, protocol, freeze: null, raw, lecture: E.lectureOf({ perdu: link.lost(), premier, monitor: null, stored: refusVide, pending: refusVide, nbStored: 0 }) }

  // Ce que cette voiture sait donner : « non disponible » n'est pas un échec.
  const sup = E.supportedOf(premier, 0)
  for (let base = 0x20; base <= 0xa0 && sup.has(base); base += 0x20) {
    const cmd = '01' + base.toString(16).toUpperCase().padStart(2, '0')
    E.supportedOf(await ask(cmd, 1, base), base).forEach(p => sup.add(p))
  }
  const mesure = async (pid: number) => sup.has(pid) ? ask('01' + pid.toString(16).toUpperCase().padStart(2, '0'), 1, pid) : null

  let vin = E.vinOf(await ask('0902', 9, 2, 6000))
  if (!vin && !link.lost()) vin = E.vinOf(await ask('0902', 9, 2, 8000))   // souvent lu au 2e essai (essai du 06/11/2026)
  // Nom et référence du calculateur : gardés sur la fiche, ils aideront à reconnaître le moteur (Olivier 07/11/2026).
  const nomsR = await ask('090A', 9, 0x0a, 3000, 1)
  const calculateur_nom = E.textOf(nomsR), calculateur_boite = E.hasGearboxEcu(nomsR), calibration = E.textOf(await ask('0904', 9, 4, 3000, 1))
  const monitor = E.monitorOf(await ask('0101', 1, 1))
  const storedR = await ask('03', 3, null, 6000), pendingR = await ask('07', 7, null, 6000), permR = await ask('0A', 0x0a, null, 6000)
  const stored = E.dtcsOf(storedR), pending = E.dtcsOf(pendingR), perm = E.dtcsOf(permR)
  const lecture = E.lectureOf({ perdu: link.lost(), premier, monitor, stored: storedR, pending: pendingR, nbStored: stored.length })

  const val = async <T,>(pid: number, f: (r: E.Reply) => T): Promise<T | null> => { const r = await mesure(pid); return r ? f(r) : null }
  const temp = await val(0x05, E.coolant), regime = await val(0x0c, E.rpm)
  // Carburant : ce que dit la voiture, sinon son type d'allumage ; jamais la fiche (Olivier 06/11/2026).
  let carburant = await val(0x51, E.fuelType), carburant_source: 'voiture' | 'allumage' | null = carburant ? 'voiture' : null
  if (!carburant && monitor?.allumage && sup.has(0x0c)) { carburant = monitor.allumage === 'compression' ? 'diesel' : 'essence'; carburant_source = 'allumage' }
  const volt = volt0 ?? await val(0x42, E.moduleVoltage)

  let freeze: ObdFreeze | null = null
  if (stored.length && !link.lost()) {
    const f = E.freezeValue(await ask('020200', 2, 2))
    const code = f.length >= 2 ? E.dtcFromBytes(f[0], f[1]) : null
    if (code) {
      const fz = async (pid: number) => { if (!sup.has(pid)) return [] as number[]; return E.freezeValue(await ask('02' + pid.toString(16).toUpperCase().padStart(2, '0') + '00', 2, pid)) }
      const charge = await fz(0x04), t = await fz(0x05), rp = await fz(0x0c), v = await fz(0x0d)
      freeze = { code, charge_pct: charge.length ? Math.round(charge[0] * 100 / 255) : null, temp_moteur_c: t.length ? t[0] - 40 : null, regime_tr_min: rp.length >= 2 ? Math.round((rp[0] * 256 + rp[1]) / 4) : null, vitesse_kmh: v.length ? v[0] : null }
    }
  }

  const vus = new Set<string>()
  const liste = (l: { code: string; ecu: string }[], type: ObdCode['type']): ObdCode[] => l.filter(c => !vus.has(c.code) && vus.add(c.code)).map(c => ({ code: c.code, type, ecu: c.ecu }))
  return {
    vin, protocol, lecture, freeze, raw,
    codes: [...liste(stored, 'memorise'), ...liste(pending, 'en_attente'), ...liste(perm, 'permanent')],
    measures: {
      batterie_v: volt, temp_moteur_c: temp, regime_tr_min: regime, carburant, carburant_source, calculateur_nom, calibration, calculateur_boite,
      temoin_moteur: monitor?.mil ?? null, nb_codes: monitor?.count ?? null,
      km_temoin_allume: await val(0x21, E.word), km_depuis_effacement: await val(0x31, E.word),
      demarrages_depuis_effacement: await val(0x30, r => E.valueOf(r)[0] ?? null), minutes_depuis_effacement: await val(0x4e, E.word),
      kilometrage: await val(0xa6, E.odometer), controles_total: monitor?.moniteurs ?? null, controles_non_prets: monitor?.non_prets ?? null,
    },
  }
}

/** Le moteur tourne-t-il ? Certaines voitures n'acceptent l'effacement que contact mis, moteur coupé. */
export async function moteurTourne(link: ObdLink, protocol: string | null): Promise<boolean> {
  const r = E.rpm(E.parseReply(await link.send('010C'), 1, 0x0c, protocol))
  return (r ?? 0) > 0
}

export type ClearResult = 'ok' | 'partiel' | 'refuse' | 'lien_perdu' | 'non_verifie'

/** Effacement (mode 04), après la signature par PIN validée par le serveur, puis relecture : « accepté » ne prouve pas « effacé ». */
export async function clearCodes(link: ObdLink, protocol: string | null): Promise<{ result: ClearResult; reste: string[]; raw: RawEntry[] }> {
  const raw: RawEntry[] = []
  const r04 = await link.send('04', 8000); raw.push({ cmd: '04', raw: r04.slice(0, 500) })
  if (r04.includes(E.LIEN_PERDU)) return { result: 'lien_perdu', reste: [], raw }
  if (!E.clearAccepted(r04, protocol)) return { result: 'refuse', reste: [], raw }
  const r03 = await link.send('03', 6000); raw.push({ cmd: '03', raw: r03.slice(0, 1500) })
  const rep = E.parseReply(r03, 3, null, protocol)
  if (rep.status === 'erreur' || rep.status === 'refus') return { result: 'non_verifie', reste: [], raw }
  const reste = E.dtcsOf(rep).map(c => c.code)
  return { result: reste.length ? 'partiel' : 'ok', reste, raw }
}
