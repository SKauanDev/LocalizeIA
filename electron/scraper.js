import { chromium } from 'playwright';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.184 Safari/537.36',
];

// Configuracoes otimizadas para o Render Free (512MB)
const SEARCH_TIMEOUT_MS = 20000;
const PANEL_TIMEOUT_MS = 8000;
const DETAIL_TIMEOUT_MS = 8000;
const TOTAL_SCRAPE_BUDGET_MS = 90000;
const MAX_RESULTS = 15;
const MAX_SCROLL_STEPS = 10;
const MAX_DETAIL_RESULTS = 6;

async function safeText(locator) {
  try {
    const value = await locator.first().textContent({ timeout: 2000 });
    return value?.trim() || null;
  } catch {
    return null;
  }
}

async function safeAttribute(locator, attr) {
  try {
    const value = await locator.first().getAttribute(attr, { timeout: 2000 });
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export async function scrapeGoogleMapsLeads({ niche, city, uf }) {
  if (!niche || !city || !uf) throw new Error('Parametros invalidos');

  let browser;
  const startedAt = Date.now();
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--disable-gpu',
        '--no-zygote',
        '--disable-extensions'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
      userAgent: USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo'
    });

    const page = await context.newPage();
    page.setDefaultTimeout(PANEL_TIMEOUT_MS);

    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      const url = route.request().url();
      if (['image', 'media', 'font'].includes(type)) {
        return route.abort().catch(() => {});
      }
      if (url.includes('google-analytics') || url.includes('doubleclick') || url.includes('fonts.')) {
        return route.abort().catch(() => {});
      }
      return route.continue().catch(() => {});
    });

    const query = encodeURIComponent(`${niche} em ${city}, ${uf}`);
    await page.goto(`https://www.google.com.br/maps/search/${query}`, {
      waitUntil: 'domcontentloaded',
      timeout: SEARCH_TIMEOUT_MS
    });

    const feedSelector = 'div[role="feed"]';
    try {
      await page.waitForSelector(feedSelector, { timeout: PANEL_TIMEOUT_MS });
      for (let i = 0; i < MAX_SCROLL_STEPS; i++) {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.scrollBy(0, 800);
        }, feedSelector);
        await page.waitForTimeout(500);
      }
    } catch {
      console.log('Aviso: Feed de resultados nao encontrado ou busca sem retorno.');
    }

    const placeLinks = await page.evaluate(({ maxRes }) => {
      const links = [];
      const seen = new Set();
      const anchors = document.querySelectorAll('div[role="feed"] a[href*="/place/"]');

      for (const anchor of anchors) {
        if (links.length >= maxRes) break;

        const href = anchor.getAttribute('href');
        if (!href || seen.has(href)) {
          continue;
        }

        seen.add(href);
        links.push(href);
      }

      return links;
    }, { maxRes: MAX_RESULTS });

    if (placeLinks.length === 0) {
      return [];
    }

    const detailPage = await context.newPage();
    detailPage.setDefaultTimeout(PANEL_TIMEOUT_MS);
    await detailPage.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font'].includes(type)) {
        return route.abort().catch(() => {});
      }
      return route.continue().catch(() => {});
    });

    const leads = [];

    for (const placeLink of placeLinks.slice(0, MAX_DETAIL_RESULTS)) {
      if (Date.now() - startedAt >= TOTAL_SCRAPE_BUDGET_MS) {
        break;
      }

      try {
        await detailPage.goto(placeLink, {
          waitUntil: 'domcontentloaded',
          timeout: DETAIL_TIMEOUT_MS
        });

        await detailPage.locator('h1').first().waitFor({ timeout: PANEL_TIMEOUT_MS });

        const name =
          (await safeText(detailPage.locator('h1.DUwDvf'))) ||
          (await safeText(detailPage.locator('h1.fontHeadlineLarge'))) ||
          'Empresa sem nome';

        const phone =
          (await safeText(detailPage.locator('button[data-item-id^="phone:tel:"] div.fontBodyMedium'))) ||
          (await safeText(detailPage.locator('button[data-item-id*="phone"] div.fontBodyMedium'))) ||
          (await safeAttribute(detailPage.locator('button[data-item-id^="phone:tel:"]'), 'data-item-id'))?.replace(/^phone:tel:/, '') ||
          '-';

        const address =
          (await safeText(detailPage.locator('button[data-item-id="address"] div.fontBodyMedium'))) ||
          (await safeText(detailPage.locator('button[data-item-id*="address"] div.fontBodyMedium'))) ||
          '-';

        if (name !== 'Empresa sem nome') {
          leads.push({
            companyName: name,
            phone,
            address,
            source: 'Google Maps'
          });
        }
      } catch {
        // Ignora falhas individuais e segue.
      }
    }

    await detailPage.close();
    await page.close();
    await context.close();
    return leads;
  } finally {
    if (browser) await browser.close();
  }
}
