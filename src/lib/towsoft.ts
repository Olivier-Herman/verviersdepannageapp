// src/lib/towsoft.ts
// Automation TowSoft via Browserless.io

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN!
const TOWSOFT_URL        = process.env.TOWSOFT_URL || 'https://verviers.towsoft.ca'
const TOWSOFT_USER       = process.env.TOWSOFT_USER!
const TOWSOFT_PASS       = process.env.TOWSOFT_PASS!

export type TowsoftMissionType = 'accident' | 'saisie' | 'mal_garee' | 'snc'

export interface TowsoftMissionData {
  type:              TowsoftMissionType
  date:              string   // DD-MM-YYYY
  time:              string   // HH:MM
  plate?:            string
  vin?:              string
  brand?:            string
  model?:            string
  location:          string   // lieu d'intervention
  policeZone:        string   // Police Zone Vesdre ou Police Zone Fagnes
  officerName?:      string
  ownerFirstName?:   string
  ownerLastName?:    string
  ownerPhone?:       string
  remarks?:          string
  driverTowsoftName: string   // nom dans TowSoft
}

const TYPE_CONFIG: Record<TowsoftMissionType, {
  codeService: string
  parc:        string
  motif:       string
}> = {
  accident: {
    codeService: 'Appel Police - Accident',
    parc:        'K3 - TRANSIT - APPEL POLICE ACCIDENT',
    motif:       'ACCIDENT',
  },
  saisie: {
    codeService: 'Appel Police - Saisie (Cyclo, voiture, camionette)',
    parc:        'J - SAISIE - ZONE J',
    motif:       'SAISIE',
  },
  mal_garee: {
    codeService: 'Appel Police - Mal Garée',
    parc:        'L - FOURRIÈRE - ZONE L (MAL GARÉE)',
    motif:       'MAL GARÉE',
  },
  snc: {
    codeService: 'Siabis Non Couvert - Remorquage avec balisage',
    parc:        'K2 - SIABIS NON COUVERT',
    motif:       'SIABIS NON COUVERT',
  },
}

export async function createTowsoftMission(data: TowsoftMissionData): Promise<{
  ok: boolean
  missionNumber?: string
  error?: string
}> {
  const config = TYPE_CONFIG[data.type]

  // Build script as JSON payload for Browserless
  const scriptData = {
    type: '${data.type}',
    url: TOWSOFT_URL,
    user: TOWSOFT_USER,
    pass: TOWSOFT_PASS,
    date: data.date,
    time: data.time,
    plate: data.plate || '',
    vin: data.vin || '',
    brand: data.brand || '',
    model: data.model || '',
    location: data.location,
    officerName: data.officerName || '',
    ownerFirstName: data.ownerFirstName || '',
    ownerLastName: data.ownerLastName || '',
    ownerPhone: data.ownerPhone || '',
    remarks: data.remarks || '',
    driverName: data.driverTowsoftName,
    codeService: config.codeService,
    parc: config.parc,
    motif: config.motif,
  }

  const script = `
    export default async function ({ page }) {
      const d = ${JSON.stringify(scriptData).replace(/\`/g, "'")}
      await page.setDefaultTimeout(30000)

      // Login
      await page.goto(d.url + '/auth/login', { waitUntil: 'networkidle0' })
      await page.type('#username', d.user)
      await page.type('#password', d.pass)
      await page.click('[type="submit"]')
      await page.waitForNavigation({ waitUntil: 'networkidle0' })

      // Nouvelle mission
      await page.goto(d.url + '/missions/create', { waitUntil: 'networkidle0' })

      // Date
      await page.evaluate((date, time) => {
        const di = document.querySelector('[name="rdv_date"]') || document.querySelector('#rdv_date')
        const ti = document.querySelector('[name="rdv_time"]') || document.querySelector('#rdv_time')
        if (di) { di.value = date; di.dispatchEvent(new Event('change', {bubbles:true})) }
        if (ti) { ti.value = time; ti.dispatchEvent(new Event('change', {bubbles:true})) }
      }, d.date, d.time)

      // Facturé à = Clients divers
      await page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input')]
        const fi = inputs.find(i => i.placeholder && i.placeholder.toLowerCase().includes('factur'))
        if (fi) { fi.value = 'Clients divers'; fi.dispatchEvent(new Event('input', {bubbles:true})) }
      })
      await page.waitForTimeout(800)
      await page.evaluate(() => {
        const s = [...document.querySelectorAll('[class*="suggestion"], .autocomplete-result, .dropdown-item, li')]
        const m = s.find(x => x.textContent && x.textContent.toLowerCase().includes('clients divers'))
        if (m) m.click()
      })

      // N° Dossier = Encodage automatique
      await page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input')]
        const di = inputs.find(i => i.placeholder && i.placeholder.toLowerCase().includes('dossier'))
        if (di) di.value = 'Encodage automatique'
      })

      // Bénéficiaire
      if (d.ownerFirstName) {
        await page.evaluate((fn, ln, phone) => {
          const inputs = [...document.querySelectorAll('input')]
          const pn = inputs.find(i => i.name && i.name.toLowerCase().includes('prenom'))
          const nm = inputs.find(i => i.name && i.name.toLowerCase().includes('nom') && !i.name.toLowerCase().includes('prenom'))
          const ph = inputs.find(i => i.name && i.name.toLowerCase().includes('tel'))
          if (pn) pn.value = fn
          if (nm) nm.value = ln
          if (ph) ph.value = phone
        }, d.ownerFirstName, d.ownerLastName, d.ownerPhone)
      }

      // Responsable (policier)
      if (d.officerName) {
        await page.evaluate((name) => {
          const inputs = [...document.querySelectorAll('input')]
          const ri = inputs.find(i => i.name && i.name.toLowerCase().includes('responsable'))
          if (ri) ri.value = name
        }, d.officerName)
      }

      // Code de service
      await page.evaluate((code) => {
        const sels = [...document.querySelectorAll('select')]
        for (const sel of sels) {
          const opt = [...sel.options].find(o => o.text.toLowerCase().includes(code.toLowerCase().substring(0,12)))
          if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change',{bubbles:true})); break }
        }
      }, d.codeService)

      // Nature = Remorquage
      await page.evaluate(() => {
        const sels = [...document.querySelectorAll('select')]
        for (const sel of sels) {
          const opt = [...sel.options].find(o => o.text.toLowerCase().includes('remorquage'))
          if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change',{bubbles:true})); break }
        }
      })

      // Lieu d'intervention
      await page.evaluate((lieu) => {
        const li = document.querySelector('[placeholder*="INDIQUEZ"]') || document.querySelector('#lieu_intervention')
        if (li) { li.value = lieu; li.dispatchEvent(new Event('input',{bubbles:true})) }
      }, d.location)
      await page.waitForTimeout(800)
      await page.keyboard.press('Escape')

      // Plaque
      if (d.plate) {
        await page.evaluate((p) => {
          const inputs = [...document.querySelectorAll('input')]
          const pi = inputs.find(i => i.name && i.name.toLowerCase().includes('immatriculation'))
          if (pi) pi.value = p
        }, d.plate)
      }

      // VIN
      if (d.vin) {
        await page.evaluate((v) => {
          const inputs = [...document.querySelectorAll('input')]
          const vi = inputs.find(i => i.name && (i.name.toLowerCase().includes('serie') || i.name.toLowerCase().includes('vin')))
          if (vi) vi.value = v
        }, d.vin)
      }

      // Remarques
      if (d.remarks) {
        await page.evaluate((r) => {
          const tas = [...document.querySelectorAll('textarea')]
          const ri = tas.find(t => t.name && t.name.toLowerCase().includes('remarque') && t.name.toLowerCase().includes('general'))
          if (ri) ri.value = r
        }, d.remarks)
      }

      // Conducteur
      await page.evaluate((name) => {
        const sels = [...document.querySelectorAll('select')]
        for (const sel of sels) {
          const lbl = sel.closest('[class*="form"]')?.querySelector('label')
          if (lbl && lbl.textContent.toLowerCase().includes('conducteur')) {
            const opt = [...sel.options].find(o => o.text.toLowerCase().includes(name.toLowerCase()))
            if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change',{bubbles:true})) }
            break
          }
        }
      }, d.driverName)

      // Dépanneuse = Balisage
      await page.evaluate(() => {
        const sels = [...document.querySelectorAll('select')]
        for (const sel of sels) {
          const lbl = sel.closest('[class*="form"]')?.querySelector('label')
          if (lbl && lbl.textContent.toLowerCase().includes('panneuse')) {
            const opt = [...sel.options].find(o => o.text.toLowerCase().includes('balisage'))
            if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change',{bubbles:true})) }
            break
          }
        }
      })

      // Confirmer la mission
      const confirmBtns = await page.$$('button, a')
      for (const btn of confirmBtns) {
        const txt = await btn.evaluate(el => el.textContent)
        if (txt && txt.toLowerCase().includes('confirmer')) {
          await btn.click()
          break
        }
      }
      await page.waitForTimeout(2500)

      // Numéro de mission
      const missionNumber = await page.evaluate(() => {
        const h = document.querySelector('h1, h2, .mission-number')
        const m = h?.textContent?.match(/\d{4,}/)
        return m ? m[0] : null
      })

      // Modal parc
      const modalOpen = await page.evaluate(() => !!document.querySelector('.modal.show, [role="dialog"]'))
      if (modalOpen) {
        await page.evaluate((parc, motif) => {
          const sels = [...document.querySelectorAll('.modal select, [role="dialog"] select')]
          for (const sel of sels) {
            const parcOpt = [...sel.options].find(o => o.text.includes(parc.substring(0,10)))
            if (parcOpt) { sel.value = parcOpt.value; sel.dispatchEvent(new Event('change',{bubbles:true})); continue }
            const motifOpt = [...sel.options].find(o => o.text.toUpperCase().includes(motif))
            if (motifOpt) { sel.value = motifOpt.value; sel.dispatchEvent(new Event('change',{bubbles:true})) }
          }
        }, d.parc, d.motif)
        await page.waitForTimeout(500)
        const modalBtns = await page.$$('.modal button, [role="dialog"] button')
        for (const btn of modalBtns) {
          const txt = await btn.evaluate(el => el.textContent)
          if (txt && (txt.toLowerCase().includes('parc') || txt.toLowerCase().includes('confirm'))) {
            await btn.click()
            break
          }
        }
        await page.waitForTimeout(1500)
      }

      return { ok: true, missionNumber }
    }
  `;

  try {
    const res = await fetch(`https://production-sfo.browserless.io/function?token=${BROWSERLESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/javascript' },
      body: script,
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Browserless error: ${res.status} ${err.slice(0, 200)}`)
    }

    const result = await res.json()
    return result?.ok ? result : { ok: false, error: result?.error || 'Erreur inconnue' }

  } catch (err: any) {
    console.error('[TowSoft] Erreur:', err.message)
    return { ok: false, error: err.message }
  }
}
