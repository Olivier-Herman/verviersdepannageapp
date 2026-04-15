const puppeteer = require('puppeteer');

const TOWSOFT_URL = process.env.TOWSOFT_URL;
const QUEUE_ID    = process.env.QUEUE_ID;

const payload = JSON.parse(process.env.PAYLOAD_DATA || '{}');

// Config types police/saisie/etc.
const TYPE_CONFIG = {
  accident:    { codeService: 'Appel Police - Accident',                       parc: 'K3',                         motif: 'ACCIDENT',          dispatch: '3' },
  saisie:      { codeService: 'Appel Police - Saisie',                         parc: 'J',                          motif: 'SAISIE',            dispatch: '3' },
  mal_garee:   { codeService: 'Appel Police - Mal Garée',                       parc: 'L - Fourrière - Zone L Mal Garée', motif: 'MAL GARÉE', dispatch: '3' },
  snc:         { codeService: 'Siabis Non Couvert - Remorquage avec balisage', parc: 'K2',                         motif: 'SIABIS NON COUVERT', dispatch: '3' },
  appel_prive: { codeService: 'Appel Police - Accident',                       parc: 'K3',                         motif: 'APPEL PRIVE',        dispatch: '3' },
};

// Config compagnies assistance
const ASSISTANCE_COMPANY = {
  touring: { client: 'Touring SA',                       dsp: 'TOURING - DEPANNAGE',                    rem: 'TOUREM TOURING - REMORQUAGE' },
  vab:     { client: 'VAB NV',                           dsp: 'VAB - DEPANNAGE SURPLACE (APD 07/2024)', rem: 'VAB - REMORQUAGE (APD 07/2024)' },
  ima:     { client: 'IMA BENELUX',                      dsp: 'IMA BENELUX - DEPANNAGE SURPLACE',       rem: 'IMA BENELUX - REMORQUAGE' },
  mondial: { client: 'AWP Automatique Dispatch',         dsp: 'MONDIAL - DSP',                          rem: 'MONDIAL - REMORQUAGE' },
  ipa:     { client: 'Inter Partner Assistance (007928)',dsp: 'IPA - DEPANNAGE SURPLACE',               rem: 'IPA - REMORQUAGE' },
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

(async () => {
  const missionType     = payload.mission_type;
  const company         = payload.company;
  const interventionType = payload.intervention_type; // 'dsp' | 'rem' | 'rem_parc'
  const isAssistance    = missionType === 'assistance';

  // Résoudre la config
  let towsoftClient, codeService, dispatchValue, useParc, parc, motif;

  if (isAssistance) {
    const companyConfig = ASSISTANCE_COMPANY[company];
    if (!companyConfig) {
      await updateQueue('error', null, `Compagnie inconnue: ${company}`);
      process.exit(1);
    }
    towsoftClient  = companyConfig.client;
    codeService    = interventionType === 'dsp' ? companyConfig.dsp : companyConfig.rem;
    dispatchValue  = interventionType === 'rem_parc' ? '3' : '2'; // En parc ou Mission passée
    useParc        = interventionType === 'rem_parc';
    parc           = 'K - Relivraison - Zone K';
    motif          = 'A Relivrer';
  } else {
    const config = TYPE_CONFIG[missionType];
    if (!config) {
      await updateQueue('error', null, `Type inconnu: ${missionType}`);
      process.exit(1);
    }
    towsoftClient  = 'Clients divers';
    codeService    = config.codeService;
    dispatchValue  = config.dispatch;
    useParc        = true;
    parc           = config.parc;
    motif          = config.motif;
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
    await page.select('#dispatch', dispatchValue);
    console.log('✓ Dispatch sélectionné:', dispatchValue);
    await wait(500);

    // Facturé à
    console.log('→ Clic recherche_client...');
    await page.click('#recherche_client');
    console.log('→ Saisie client:', towsoftClient);
    await page.type('#recherche_client', towsoftClient);
    await wait(3000);
    const c = await page.$('.ui-autocomplete li.ui-menu-item:first-child');
    console.log('→ Autocomplete client trouvé:', !!c);
    if (c) {
      await page.evaluate(() => {
        const item = document.querySelector('.ui-autocomplete li.ui-menu-item');
        if (item) item.click();
      });
      console.log('✓ Client sélectionné');
    } else {
      console.log('⚠️ Client non trouvé en autocomplete');
    }

    console.log('→ N° dossier...');
    const dossierValue = payload.dossier_number || 'Encodage automatique';
    await page.evaluate((d) => { document.querySelector('#numero_dossier').value = d; }, dossierValue);
    console.log('✓ Dossier:', dossierValue);
    console.log('→ Nom responsable...');

    // Nom responsable (police uniquement)
    if (payload.officer_name) {
      await page.evaluate((n) => { document.querySelector('#nom_responsable').value = n; }, payload.officer_name);
    }
    console.log('→ Code service:', codeService);

    // Code service — via evaluate uniquement (évite les problèmes de clickabilité)
    await page.evaluate((service) => {
      const el = document.querySelector('#nom_service');
      if (el) {
        el.value = service;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      }
    }, codeService);
    await wait(3000);
    const s = await page.$('.ui-autocomplete li.ui-menu-item');
    console.log('→ Autocomplete service trouvé:', !!s);
    if (s) {
      await page.evaluate(() => {
        const item = document.querySelector('.ui-autocomplete li.ui-menu-item');
        if (item) item.click();
      });
      console.log('✓ Service sélectionné');
    } else {
      console.log('⚠️ Pas de suggestion, on continue sans cliquer');
    }

    // Nature intervention selon type
    const natureValue = (isAssistance && interventionType === 'dsp') ? 'DEPANNAGE_SUR_PLACE' : 'REMORQUAGE_RELIVRAISON';
    await page.evaluate((val) => {
      const el = document.querySelector('#natureIntervention');
      if (el) { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); }
    }, natureValue);
    console.log('✓ Nature:', natureValue);

    // Lieu d'intervention
    console.log('→ Lieu intervention...');
    await page.evaluate((loc) => {
      const el = document.querySelector('#origine');
      if (el) { el.value = loc; el.dispatchEvent(new Event('input', { bubbles: true })); }
    }, payload.location);
    await wait(500);
    console.log('✓ Lieu:', payload.location);

    console.log('→ Destination...');
    // Destination (REM / REM+Parc assistance)
    if (payload.destination) {
      await wait(500);
      await page.evaluate((dest) => {
        const el = document.querySelector('#destination');
        if (el) {
          el.focus();
          el.value = dest;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        }
      }, payload.destination);
      await wait(500);
      console.log('✓ Destination:', payload.destination);
    }

    console.log('→ Véhicule...');
    // Véhicule
    await page.evaluate((plate, brand, model, vin) => {
      if (plate) document.querySelector('#plaque').value = plate;
      if (brand) document.querySelector('#marque').value = brand;
      if (model) document.querySelector('#modele').value = model;
      if (vin)   document.querySelector('#serie').value  = vin;
    }, payload.plate, payload.brand, payload.model, payload.vin);

    console.log('✓ Véhicule rempli');
    // Propriétaire
    if (payload.owner_first || payload.owner_last) {
      await page.evaluate((fn, ln, ph) => {
        if (fn) document.querySelector('#prenom_beneficiaire').value   = fn;
        if (ln) document.querySelector('#nom_beneficiaire').value      = ln;
        if (ph) document.querySelector('#beneficiaireTelephone').value = ph;
      }, payload.owner_first, payload.owner_last, payload.owner_phone);
    }

    console.log('→ Remarques...');
    // Remarques
    const remarksText = payload.remarks || '';
    if (remarksText) {
      await page.evaluate((r) => { document.querySelector('#remarques').value = r; }, remarksText);
    }

    console.log('→ Dépanneuse...');
    // Dépanneuse = Balisage (value 13)
    await page.evaluate(() => {
      const el = document.querySelector('#remorque');
      if (el) { el.value = '13'; el.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    console.log('✓ Dépanneuse sélectionnée');

    // Conducteur
    console.log('→ Conducteur...');
    await page.evaluate((dn) => {
      const sel = document.querySelector('#chauffeur');
      const opt = [...sel.options].find(o => o.text.toLowerCase().includes(dn.toLowerCase()));
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }, payload.driver_name);
    console.log('✓ Conducteur sélectionné');

    // Soumettre
    console.log('→ Soumission...');
    // Ne pas attendre le retour du evaluate car la page va naviguer
    page.evaluate(() => {
      const btn = document.querySelector('#triggerSubmitAppelAjouterForm');
      if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }).catch(() => {});
    // Attendre la navigation
    try {
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 });
    } catch (e) {
      await wait(5000); // fallback si pas de navigation
    }
    console.log('✓ Formulaire soumis');
    console.log('URL après soumission:', page.url());

    // Modal parc (uniquement si useParc)
    if (useParc) {
      const modalVisible = await page.$('#modal');
      if (modalVisible) {
        await wait(1500);

        // Parc — 1er select
        await page.evaluate((parcValue) => {
          const selects = [...document.querySelectorAll('#formRemise select, #modal select')];
          const parcSelect = selects[0];
          if (parcSelect) {
            const opt = [...parcSelect.options].find(o => o.text.includes(parcValue) || o.value.toUpperCase().includes(parcValue));
            if (opt) { parcSelect.value = opt.value; parcSelect.dispatchEvent(new Event('change', { bubbles: true })); console.log('Parc:', opt.text); }
          }
        }, parc);
        await wait(1000);

        // Motif — 2ème select
        await page.evaluate((motifValue) => {
          const selects = [...document.querySelectorAll('#formRemise select, #modal select')];
          const motifSelect = selects[1];
          if (motifSelect) {
            const opt = [...motifSelect.options].find(o => o.text.toUpperCase().includes(motifValue));
            if (opt) { motifSelect.value = opt.value; motifSelect.dispatchEvent(new Event('change', { bubbles: true })); console.log('Motif:', opt.text); }
          }
        }, motif);
        await wait(500);

        await page.click('#remiserSubmitButton');
        await wait(3000);
        console.log('✓ Mise en parc effectuée');
      }
    }

    // Récupérer le numéro de mission
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

    // Callback Odoo (avec impression étiquette seulement pour rem_parc)
    if (missionNumber && process.env.SUPABASE_URL) {
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
