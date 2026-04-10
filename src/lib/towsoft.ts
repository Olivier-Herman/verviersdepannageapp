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

  const script = `
    const puppeteer = require('puppeteer-core');

    module.exports = async ({ page }) => {
    try {
      await page.setDefaultTimeout(30000);
      // Login
      await page.goto('${TOWSOFT_URL}/auth/login', { waitUntil: 'networkidle0' });
      await page.type('#username', '${TOWSOFT_USER}');
      await page.type('#password', '${TOWSOFT_PASS}');
      await page.click('[type="submit"]');
      await page.waitForNavigation({ waitUntil: 'networkidle0' });

      // Nouvelle mission
      await page.goto('${TOWSOFT_URL}/missions/create', { waitUntil: 'networkidle0' });

      // Date et heure
      await page.evaluate((date, time) => {
        const dateInput = document.querySelector('#rdv_date') || document.querySelector('[name="rdv_date"]');
        const timeInput = document.querySelector('#rdv_time') || document.querySelector('[name="rdv_time"]');
        if (dateInput) { dateInput.value = date; dateInput.dispatchEvent(new Event('change', {bubbles:true})); }
        if (timeInput) { timeInput.value = time; timeInput.dispatchEvent(new Event('change', {bubbles:true})); }
      }, '${data.date}', '${data.time}');

      // Facturé à — Clients divers
      await page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input')];
        const factureInput = inputs.find(i => i.placeholder && i.placeholder.toLowerCase().includes('factur'));
        if (factureInput) { factureInput.value = 'Clients divers'; factureInput.dispatchEvent(new Event('input', {bubbles:true})); }
      });
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const suggestions = [...document.querySelectorAll('[class*="suggestion"], [class*="dropdown"] li, [class*="autocomplete"] li')];
        const match = suggestions.find(s => s.textContent.toLowerCase().includes('clients divers'));
        if (match) match.click();
      });

      // N° dossier
      await page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input')];
        const dossierInput = inputs.find(i => i.placeholder && i.placeholder.toLowerCase().includes('dossier'));
        if (dossierInput) dossierInput.value = 'Encodage automatique';
      });

      // Bénéficiaire
      ${data.ownerFirstName ? `
      await page.evaluate((fn, ln, phone) => {
        const fnInput = document.querySelector('#beneficiaire_prenom') || document.querySelector('[name*="prenom"]');
        const lnInput = document.querySelector('#beneficiaire_nom') || document.querySelector('[name*="nom_ben"]');
        const phInput = document.querySelector('#telephone_beneficiaire') || document.querySelector('[name*="tel_ben"]');
        if (fnInput) fnInput.value = fn;
        if (lnInput) lnInput.value = ln;
        if (phInput) phInput.value = phone;
      }, '${data.ownerFirstName}', '${data.ownerLastName || ''}', '${data.ownerPhone || ''}');
      ` : ''}

      // Nom du responsable (policier)
      ${data.officerName ? `
      await page.evaluate((name) => {
        const inputs = [...document.querySelectorAll('input')];
        const respInput = inputs.find(i => i.name && i.name.toLowerCase().includes('responsable'));
        if (respInput) respInput.value = name;
      }, '${data.officerName}');
      ` : ''}

      // Code de service
      await page.evaluate((code) => {
        const selects = [...document.querySelectorAll('select')];
        const codeSelect = selects.find(s => {
          const opts = [...s.options];
          return opts.some(o => o.text.toLowerCase().includes(code.toLowerCase().substring(0, 10)));
        });
        if (codeSelect) {
          const opt = [...codeSelect.options].find(o => o.text.toLowerCase().includes(code.toLowerCase().substring(0, 10)));
          if (opt) { codeSelect.value = opt.value; codeSelect.dispatchEvent(new Event('change', {bubbles:true})); }
        }
      }, '${config.codeService}');

      // Nature de l'intervention = Remorquage
      await page.evaluate(() => {
        const selects = [...document.querySelectorAll('select')];
        const natSelect = selects.find(s => {
          const label = s.closest('.form-group')?.querySelector('label');
          return label && label.textContent.toLowerCase().includes('nature');
        });
        if (natSelect) {
          const opt = [...natSelect.options].find(o => o.text.toLowerCase().includes('remorquage'));
          if (opt) { natSelect.value = opt.value; natSelect.dispatchEvent(new Event('change', {bubbles:true})); }
        }
      });

      // Lieu d'intervention
      await page.evaluate((lieu) => {
        const locationInput = document.querySelector('#lieu_intervention') || document.querySelector('[placeholder*="INDIQUEZ UN LIEU"]');
        if (locationInput) {
          locationInput.value = lieu;
          locationInput.dispatchEvent(new Event('input', {bubbles:true}));
        }
      }, '${data.location}');
      await page.waitForTimeout(1000);
      // Fermer autocomplete si ouvert
      await page.keyboard.press('Escape');

      // Véhicule — immatriculation
      ${data.plate ? `
      await page.evaluate((plate) => {
        const inputs = [...document.querySelectorAll('input')];
        const plateInput = inputs.find(i => i.name && i.name.toLowerCase().includes('immatriculation'));
        if (plateInput) plateInput.value = plate;
      }, '${data.plate}');
      ` : ''}

      // VIN
      ${data.vin ? `
      await page.evaluate((vin) => {
        const inputs = [...document.querySelectorAll('input')];
        const vinInput = inputs.find(i => i.name && (i.name.toLowerCase().includes('serie') || i.name.toLowerCase().includes('vin')));
        if (vinInput) vinInput.value = vin;
      }, '${data.vin}');
      ` : ''}

      // Remarques générales
      ${data.remarks ? `
      await page.evaluate((remarks) => {
        const textareas = [...document.querySelectorAll('textarea')];
        const remarksTA = textareas.find(t => t.name && t.name.toLowerCase().includes('remarque') && t.name.toLowerCase().includes('general'));
        if (remarksTA) remarksTA.value = remarks;
      }, '${data.remarks.replace(/'/g, "\\'")}');
      ` : ''}

      // Répartition — Conducteur
      await page.evaluate((driverName) => {
        const selects = [...document.querySelectorAll('select')];
        const conducteurSelect = selects.find(s => {
          const label = s.closest('.form-group')?.querySelector('label');
          return label && label.textContent.toLowerCase().includes('conducteur');
        });
        if (conducteurSelect) {
          const opt = [...conducteurSelect.options].find(o => o.text.toLowerCase().includes(driverName.toLowerCase()));
          if (opt) { conducteurSelect.value = opt.value; conducteurSelect.dispatchEvent(new Event('change', {bubbles:true})); }
        }
      }, '${data.driverTowsoftName}');

      // Dépanneuse = Balisage
      await page.evaluate(() => {
        const selects = [...document.querySelectorAll('select')];
        const depSelect = selects.find(s => {
          const label = s.closest('.form-group')?.querySelector('label');
          return label && label.textContent.toLowerCase().includes('dépanneuse');
        });
        if (depSelect) {
          const opt = [...depSelect.options].find(o => o.text.toLowerCase().includes('balisage'));
          if (opt) { depSelect.value = opt.value; depSelect.dispatchEvent(new Event('change', {bubbles:true})); }
        }
      });

      // Confirmer la mission
      await page.click('[onclick*="confirmer"], button[class*="confirm"], a[class*="confirm"]');
      await page.waitForTimeout(2000);

      // Récupérer le numéro de mission
      const missionNumber = await page.evaluate(() => {
        const heading = document.querySelector('h1, h2, h3');
        const match = heading?.textContent?.match(/\\d{4,}/);
        return match ? match[0] : null;
      });

      // Modal parc — sélectionner le parc et le motif
      const modalVisible = await page.evaluate(() => {
        return !!document.querySelector('.modal.show, .modal[style*="display: block"]');
      });

      if (modalVisible) {
        // Sélectionner le parc
        await page.evaluate((parcName) => {
          const selects = [...document.querySelectorAll('.modal select, #modal select')];
          for (const sel of selects) {
            const opt = [...sel.options].find(o => o.text.includes(parcName.substring(0, 15)));
            if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', {bubbles:true})); break; }
          }
        }, '${config.parc}');

        await page.waitForTimeout(500);

        // Sélectionner le motif
        await page.evaluate((motif) => {
          const selects = [...document.querySelectorAll('.modal select, #modal select')];
          for (const sel of selects) {
            const opt = [...sel.options].find(o => o.text.toUpperCase().includes(motif.toUpperCase()));
            if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', {bubbles:true})); break; }
          }
        }, '${config.motif}');

        await page.waitForTimeout(500);

        // Cliquer Mise en parc
        await page.evaluate(() => {
          const btns = [...document.querySelectorAll('.modal button, .modal a')];
          const btn = btns.find(b => b.textContent.toLowerCase().includes('mise en parc') || b.textContent.toLowerCase().includes('confirmer'));
          if (btn) btn.click();
        });

        await page.waitForTimeout(2000);
      }

      return { ok: true, missionNumber };

    } catch (err) {
      return { ok: false, error: err.message };
    }
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
