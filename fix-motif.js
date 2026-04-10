const puppeteer = require('puppeteer');
const TOWSOFT_URL = 'https://verviers.towsoft.ca';

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.launch({ headless: false, slowMo: 80, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  // Login et aller sur une mission existante en attente
  await page.goto(`${TOWSOFT_URL}/auth/login`, { waitUntil: 'networkidle0' });
  await page.type('#nomusager', 'VDBot');
  await page.type('#passusager', '!Verviers4800');
  await page.click('[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle0' });

  // Ouvrir la mission de test et cliquer "Confirmer"
  // Pour tester le modal uniquement — remplacer par l'URL de la mission test
  // exemple: await page.goto(`${TOWSOFT_URL}/en-attente.php`);

  // Lister les selects dans le modal pour voir leurs IDs
  await page.evaluate(() => {
    // Simuler l'ouverture du modal si disponible
    const btn = [...document.querySelectorAll('button,a')].find(b => b.textContent.includes('Remiser') || b.textContent.includes('Parc'));
    if (btn) btn.click();
  });
  await wait(1000);

  const modalSelects = await page.evaluate(() => {
    return [...document.querySelectorAll('.modal select, [id*="modal"] select')].map(s => ({
      id: s.id, name: s.name,
      options: [...s.options].map(o => ({ v: o.value, t: o.text }))
    }));
  });
  console.log('Selects dans modal:', JSON.stringify(modalSelects, null, 2));

  await browser.close();
})();
