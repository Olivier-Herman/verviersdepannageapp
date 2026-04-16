const puppeteer = require('puppeteer');

const TOWSOFT_URL = process.env.TOWSOFT_URL;
const QUEUE_ID    = process.env.QUEUE_ID;

const payload = JSON.parse(process.env.PAYLOAD_DATA || '{}');

const TYPE_CONFIG = {
  accident:    { codeService: 'Appel Police - Accident',                        parc: 'K3',                               motif: 'ACCIDENT',           dispatch: '3' },
  saisie:      { codeService: 'Appel Police - Saisie',                          parc: 'J',                                motif: 'SAISIE',             dispatch: '3' },
  mal_garee:   { codeService: 'Appel Police - Mal Garée',                        parc: 'L - Fourrière - Zone L Mal Garée', motif: 'MAL GARÉE',          dispatch: '3' },
  snc:         { codeService: 'Siabis Non Couvert - Remorquage avec balisage',  parc: 'K2',                               motif: 'SIABIS NON COUVERT', dispatch: '3' },
  appel_prive: { codeService: 'Appel Police - Accident',                        parc: 'K3',                               motif: 'APPEL PRIVE',         dispatch: '3' },
};

const ASSISTANCE_COMPANY = {
  touring: { client: 'Touring SA',                        dsp: 'TOURING - DEPANNAGE',                    rem: 'TOUREM TOURING - REMORQUAGE' },
  vab:     { client: 'VAB NV',                            dsp: 'VAB - DEPANNAGE SURPLACE (APD 07/2024)', rem: 'VAB - REMORQUAGE (APD 07/2024)' },
  ima:     { client: 'IMA BENELUX',                       dsp: 'IMA BENELUX - DEPANNAGE SURPLACE',       rem: 'IMA BENELUX - REMORQUAGE' },
  mondial: { client: 'AWP Automatique Dispatch',          dsp: 'MONDIAL - DSP',                          rem: 'MONDIAL - REMORQUAGE' },
  ipa:     { client: 'Inter Partner Assistance (007928)', dsp: 'IPA - DEPANNAGE SURPLACE',               rem: 'IPA - REMORQUAGE' },
};

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function updateQueue(status, missionNumber, error) {
  const body = { status, processed_at: new Date().toISOString() };
  if (missionNumber) body.towsoft_mission_number = missionNumber;
  if (error)         body.error_message = error;
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/towsoft_queue?id=eq.${QUEUE_ID}`, {
    method: 'PATCH',
    headers: {
      'Content-Type':  'application/json',
      'apikey':         process.env.SUPABASE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

// Taper dans un champ lettre par lettre (simule un vrai utilisateur)
async function typeInField(page, selector, value) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) { el.value = ''; el.focus(); }
  }, selector);
  await page.type(selector, value, { delay: 50 });
}

// Sélectionner dans un autocomplete jQuery UI
async function selectAutocomplete(page, inputSelector, value) {
  await typeInField(page, inputSelector, value);
  await wait(2500);
  const clicked = await page.evaluate(() => {
    const item = document.querySelector('.ui-autocomplete li.ui-menu-item');
    if (item) { item.click(); return true; }
    return false;
  });
  console.log(`Autocomplete ${inputSelector}: ${clicked ? '✓' : '⚠️ non trouvé'}`);
  return clicked;
}

// Sélectionner dans un Select2
async function selectSelect2(page, containerId, value) {
  // Ouvrir le dropdown en cliquant le SPAN à l'intérieur
  await page.evaluate((id) => {
    const container = document.getElementById(id);
    if (container) {
      const span = container.querySelector('span');
      if (span) span.click();
      else container.click();
    }
  }, containerId);
  await wait(800);
  // Chercher et cliquer l'option
  const clicked = await page.evaluate((val) => {
    const results = document.querySelector('.select2-results__options, .select2-dropdown ul');
    if (!results) return false;
    const opts = [...results.querySelectorAll('li')];
    const opt = opts.find(o => o.textContent.toLowerCase().includes(val.toLowerCase()));
    if (opt) { opt.click(); return true; }
    return false;
  }, value);
  console.log(`Select2 ${containerId}: ${clicked ? '✓' : '⚠️ non trouvé'}`);
  return clicked;
}

(async () => {
  const missionType      = payload.mission_type;
  const company          = payload.company;
  const interventionType = payload.intervention_type;
  const isAssistance     = missionType === 'assistance';

  let towsoftClient, codeService, dispatchValue, useParc, parc, motif;

  if (isAssistance) {
    const cc = ASSISTANCE_COMPANY[company];
    if (!cc) { await updateQueue('error', null, `Compagnie inconnue: ${company}`); process.exit(1); }
    towsoftClient = cc.client;
    codeService   = interventionType === 'dsp' ? cc.dsp : cc.rem;
    dispatchValue = interventionType === 'rem_parc' ? '3' : '2';
    useParc       = interventionType === 'rem_parc';
    parc          = 'K - Relivraison - Zone K';
    motif         = 'A Relivrer';
  } else {
    const config = TYPE_CONFIG[missionType];
    if (!config) { await updateQueue('error', null, `Type inconnu: ${missionType}`); process.exit(1); }
    towsoftClient = 'Clients divers';
    codeService   = config.codeService;
    dispatchValue = config.dispatch;
    useParc       = true;
    parc          = config.parc;
    motif         = config.motif;
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    protocolTimeout: 120000,
  });
  const page = await browser.newPage();
  await page.setDefaultTimeout(60000);

  try {
    // Login
    await page.goto(`${TOWSOFT_URL}/auth/login`, { waitUntil: 'networkidle0' });
    await page.type('#nomusager', process.env.TOWSOFT_USER);
    await page.type('#passusager', process.env.TOWSOFT_PASS);
    await page.click('[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle0' });
    console.log('✓ Connecté');

    await page.goto(`${TOWSOFT_URL}/appel-ajouter5.php`, { waitUntil: 'networkidle0' });
    console.log('✓ Page formulaire chargée');

    // Répartir
    await page.evaluate((val) => {
      const el = document.querySelector('#dispatch');
      if (el) { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); }
    }, dispatchValue);
    console.log('✓ Dispatch:', dispatchValue);
    await wait(500);

    // Client (autocomplete)
    await selectAutocomplete(page, '#recherche_client', towsoftClient);
    await wait(500);

    // N° dossier → champ #po (pas #numero_dossier !)
    const dossierValue = payload.dossier_number || 'Encodage automatique';
    await page.evaluate((val) => {
      const el = document.querySelector('#po');
      if (el) { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); }
    }, dossierValue);
    console.log('✓ Dossier (#po):', dossierValue);

    // Prénom bénéficiaire
    if (payload.owner_first) {
      await typeInField(page, '#prenom_beneficiaire', payload.owner_first);
    }

    // Nom bénéficiaire
    if (payload.owner_last) {
      await typeInField(page, '#nom_beneficiaire', payload.owner_last);
    }

    // Téléphone bénéficiaire
    if (payload.owner_phone) {
      await typeInField(page, '#beneficiaireTelephone', payload.owner_phone);
    }

    // Dépanneuse — via le select natif #remorque + trigger Select2
    await page.evaluate(() => {
      const el = document.querySelector('#remorque');
      if (el) {
        el.value = '13'; // Balisage 01
        el.dispatchEvent(new Event('change', { bubbles: true }));
        // Trigger Select2 update
        if (window.$ && $(el).data('select2')) $(el).trigger('change');
      }
    });
    console.log('✓ Dépanneuse (Balisage)');
    await wait(300);

    // Conducteur — via le select natif #chauffeur
    await page.evaluate((dn) => {
      const sel = document.querySelector('#chauffeur');
      if (sel) {
        const opt = [...sel.options].find(o => o.text.toLowerCase().includes(dn.toLowerCase()));
        if (opt) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          if (window.$ && $(sel).data('select2')) $(sel).trigger('change');
          console.log('Conducteur:', opt.text);
        }
      }
    }, payload.driver_name);
    console.log('✓ Conducteur sélectionné');
    await wait(300);

    // Code service (autocomplete)
    await selectAutocomplete(page, '#nom_service', codeService);
    await wait(500);

    // Nature intervention
    const natureValue = (isAssistance && interventionType === 'dsp') ? 'DEPANNAGE_SUR_PLACE' : 'REMORQUAGE_RELIVRAISON';
    await page.evaluate((val) => {
      const el = document.querySelector('#natureIntervention');
      if (el) { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); }
    }, natureValue);
    console.log('✓ Nature:', natureValue);

    // Lieu d'intervention (type lettre par lettre + clic suggestion)
    await typeInField(page, '#origine', payload.location);
    await wait(2500);
    await page.evaluate(() => {
      const suggestion = document.querySelector('.tt-suggestion, .tomtom-suggestion, [class*="suggestion"]');
      if (suggestion) suggestion.click();
      // Fallback: simuler Enter
    });
    await page.keyboard.press('Enter');
    await wait(1000);
    console.log('✓ Lieu:', payload.location);

    // Destination (REM / REM+Parc)
    if (payload.destination) {
      await typeInField(page, '#destination', payload.destination);
      await wait(2500);
      await page.evaluate(() => {
        const suggestion = document.querySelector('.tt-suggestion, .tomtom-suggestion, [class*="suggestion"]');
        if (suggestion) suggestion.click();
      });
      await page.keyboard.press('Enter');
      await wait(1000);
      console.log('✓ Destination:', payload.destination);
    }

    // Véhicule
    await page.evaluate((plate, brand, model, vin) => {
      if (plate) document.querySelector('#plaque').value  = plate;
      if (brand) document.querySelector('#marque').value  = brand;
      if (model) document.querySelector('#modele').value  = model;
      if (vin)   document.querySelector('#serie').value   = vin;
    }, payload.plate, payload.brand, payload.model, payload.vin);
    console.log('✓ Véhicule');

    // Remarques (TEXTAREA)
    if (payload.remarks) {
      await page.evaluate((r) => {
        const el = document.querySelector('#remarques');
        if (el) { el.value = r; el.dispatchEvent(new Event('change', { bubbles: true })); }
      }, payload.remarks);
      console.log('✓ Remarques');
    }

    // Nom responsable (police uniquement)
    if (payload.officer_name) {
      await page.evaluate((n) => {
        const el = document.querySelector('#nom_responsable');
        if (el) el.value = n;
      }, payload.officer_name);
    }

    // Soumettre — d'abord submitAppelAjouterForm puis triggerSubmitAppelAjouterForm
    console.log('→ Soumission...');
    await wait(1000);
    await page.evaluate(() => {
      const btn1 = document.getElementById('submitAppelAjouterForm');
      if (btn1) btn1.click();
    });
    await wait(300);
    // Déclencher la navigation et attendre
    const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => null);
    await page.evaluate(() => {
      const btn2 = document.getElementById('triggerSubmitAppelAjouterForm');
      if (btn2) btn2.click();
    });
    await navigationPromise;
    await wait(2000);
    console.log('✓ Formulaire soumis');
    console.log('URL:', page.url());

    // Modal parc (uniquement si useParc)
    if (useParc) {
      const modalVisible = await page.$('#modal, #formRemise');
      if (modalVisible) {
        await wait(1500);
        // Parc
        await page.evaluate((parcValue) => {
          const selects = [...document.querySelectorAll('#formRemise select, #modal select')];
          const parcSelect = selects[0];
          if (parcSelect) {
            const opt = [...parcSelect.options].find(o => o.text.includes(parcValue) || o.value.toUpperCase().includes(parcValue));
            if (opt) { parcSelect.value = opt.value; parcSelect.dispatchEvent(new Event('change', { bubbles: true })); console.log('Parc:', opt.text); }
          }
        }, parc);
        await wait(1000);
        // Motif
        await page.evaluate((motifValue) => {
          const selects = [...document.querySelectorAll('#formRemise select, #modal select')];
          const motifSelect = selects[1];
          if (motifSelect) {
            const opt = [...motifSelect.options].find(o => o.text.toUpperCase().includes(motifValue));
            if (opt) { motifSelect.value = opt.value; motifSelect.dispatchEvent(new Event('change', { bubbles: true })); console.log('Motif:', opt.text); }
          }
        }, motif);
        await wait(500);
        await page.evaluate(() => {
          const btn = document.getElementById('remiserSubmitButton');
          if (btn) btn.click();
        });
        await wait(3000);
        console.log('✓ Mise en parc effectuée');
      }
    }

    // Numéro de mission
    const missionNumber = await page.evaluate(() => {
      const urlMatch = window.location.href.match(/num=(\d+)/);
      if (urlMatch) return urlMatch[1];
      const missionMatch = document.body.innerText.match(/de mission[^\d]*(\d{4,6})/i);
      if (missionMatch) return missionMatch[1];
      const livraisonMatch = document.body.innerText.match(/de livraison[^\d]*(\d{4,6})/i);
      if (livraisonMatch) return livraisonMatch[1];
      return null;
    });
    console.log('✓ Mission TowSoft:', missionNumber);

    await updateQueue('done', missionNumber, null);
    console.log('✓ Queue mise à jour');

    // Callback Odoo
    if (missionNumber) {
      try {
        const appUrl = 'https://app.verviersdepannage.com';
        const cbRes = await fetch(`${appUrl}/api/towsoft/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            queue_id:       process.env.QUEUE_ID,
            mission_number: missionNumber,
            secret:         process.env.TOWSOFT_CALLBACK_SECRET,
            print_label:    isAssistance ? interventionType === 'rem_parc' : true,
          }),
        });
        const cbData = await cbRes.json();
        console.log('✓ Callback Odoo:', cbData.ok ? 'OK' : cbData.error);
      } catch (e) {
        console.error('❌ Callback Odoo échec:', e.message);
      }
    }

  } catch (err) {
    console.error('❌ Erreur:', err.message);
    await updateQueue('error', null, err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
