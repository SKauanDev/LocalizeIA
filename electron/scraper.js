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
const MAX_RESULTS = 24;
const MAX_SCROLL_STEPS = 14;
const MAX_DETAIL_RESULTS = 8;

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

function normalizePhone(rawPhone) {
  if (!rawPhone || rawPhone === '-') {
    return '-';
  }

  const onlyDigits = rawPhone.replace(/\D/g, '');
  if (onlyDigits.length === 11) {
    return onlyDigits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  }

  if (onlyDigits.length === 10) {
    return onlyDigits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  }

  return rawPhone;
}

function buildWhatsAppUrl(rawPhone) {
  if (!rawPhone || rawPhone === '-') {
    return '-';
  }

  let digits = rawPhone.replace(/\D/g, '');
  if (!digits) {
    return '-';
  }

  if (!digits.startsWith('55')) {
    digits = `55${digits}`;
  }

  return `https://wa.me/${digits}`;
}

async function extractPhoneFromDetailPage(detailPage, fallbackPhone = '-') {
  const directPhone =
    (await safeText(detailPage.locator('button[data-item-id^="phone:tel:"] div.fontBodyMedium'))) ||
    (await safeText(detailPage.locator('button[data-item-id*="phone"] div.fontBodyMedium'))) ||
    (await safeText(detailPage.locator('a[href^="tel:"]'))) ||
    (await safeAttribute(detailPage.locator('button[data-item-id^="phone:tel:"]'), 'data-item-id'))?.replace(/^phone:tel:/, '') ||
    (await safeAttribute(detailPage.locator('a[href^="tel:"]'), 'href'))?.replace(/^tel:/, '');

  if (directPhone && directPhone !== '-') {
    return normalizePhone(directPhone);
  }

  const extractedPhone = await detailPage.evaluate(() => {
    const phonePattern = /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}-?\d{4}/;
    const candidates = [];

    const selectors = [
      '[data-item-id*="phone"]',
      'button[aria-label*="telefone" i]',
      'button[aria-label*="phone" i]',
      'a[href^="tel:"]',
      '[aria-label*="telefone" i]',
      '[aria-label*="phone" i]',
    ];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        candidates.push(
          element.getAttribute('data-item-id') || '',
          element.getAttribute('aria-label') || '',
          element.getAttribute('href') || '',
          element.textContent || ''
        );
      }
    }

    candidates.push(document.body?.innerText || '');

    for (const candidate of candidates) {
      const match = candidate.match(phonePattern);
      if (match) {
        return match[0];
      }
    }

    return null;
  }).catch(() => null);

  return normalizePhone(extractedPhone || fallbackPhone);
}

async function extractContactLinkFromDetailPage(detailPage, fallbackPhone = '-') {
  const telHref =
    (await safeAttribute(detailPage.locator('a[href^="tel:"]'), 'href')) ||
    (await safeAttribute(detailPage.locator('button[data-item-id^="phone:tel:"]'), 'data-item-id')) ||
    (await safeAttribute(detailPage.locator('[data-item-id*="phone"]'), 'data-item-id'));

  if (telHref) {
    const normalizedHref = telHref
      .replace(/^phone:tel:/, '')
      .replace(/^tel:/, '');
    const waLink = buildWhatsAppUrl(normalizedHref);
    if (waLink !== '-') {
      return waLink;
    }
  }

  const phone = await extractPhoneFromDetailPage(detailPage, fallbackPhone);
  return buildWhatsAppUrl(phone);
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

    const listEntries = await page.evaluate(({ maxRes }) => {
      const entries = [];
      const seen = new Set();
      const cards = document.querySelectorAll('div[role="article"]');

      for (const card of cards) {
        if (entries.length >= maxRes) break;

        const anchor = card.querySelector('a[href*="/place/"]');
        const href = anchor?.getAttribute('href');
        if (!href || seen.has(href)) {
          continue;
        }

        seen.add(href);

        const name =
          card.querySelector('.fontHeadlineSmall')?.textContent?.trim() ||
          card.querySelector('.fontHeadlineLarge')?.textContent?.trim() ||
          'Empresa sem nome';

        const rawText = card.innerText || '';
        const phoneMatch = rawText.match(/\(?\d{2}\)?\s?\d{4,5}-?\d{4}/);
        const phone = phoneMatch ? normalizePhone(phoneMatch[0]) : '-';

        const textParts = Array.from(card.querySelectorAll('.fontBodyMedium span, .fontBodyMedium div'))
          .map((element) => element.textContent?.trim())
          .filter(Boolean);

        const address = textParts.find((text) =>
          text.length > 10 &&
          !text.includes('·') &&
          !text.includes('aberto') &&
          !text.includes('fechado') &&
          text !== name
        ) || '-';

        entries.push({
          href,
          companyName: name,
          phone,
          address,
          source: 'Google Maps'
        });
      }

      return entries;
    }, { maxRes: MAX_RESULTS });

    if (listEntries.length === 0) {
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

    for (const entry of listEntries.slice(0, MAX_DETAIL_RESULTS)) {
      if (Date.now() - startedAt >= TOTAL_SCRAPE_BUDGET_MS) {
        break;
      }

      try {
        await detailPage.goto(entry.href, {
          waitUntil: 'domcontentloaded',
          timeout: DETAIL_TIMEOUT_MS
        });

        await detailPage.locator('h1').first().waitFor({ timeout: PANEL_TIMEOUT_MS });

        const name =
          (await safeText(detailPage.locator('h1.DUwDvf'))) ||
          (await safeText(detailPage.locator('h1.fontHeadlineLarge'))) ||
          'Empresa sem nome';

        const phone = await extractPhoneFromDetailPage(detailPage, entry.phone);
        const contactLink = await extractContactLinkFromDetailPage(detailPage, phone);

        const address =
          (await safeText(detailPage.locator('button[data-item-id="address"] div.fontBodyMedium'))) ||
          (await safeText(detailPage.locator('button[data-item-id*="address"] div.fontBodyMedium'))) ||
          entry.address;

        if (name !== 'Empresa sem nome') {
          leads.push({
            companyName: name,
            phone: contactLink !== '-' ? contactLink : phone,
            address,
            source: 'Google Maps'
          });
        }
      } catch {
        if (entry.companyName !== 'Empresa sem nome') {
          leads.push({
            companyName: entry.companyName,
            phone: buildWhatsAppUrl(entry.phone) !== '-' ? buildWhatsAppUrl(entry.phone) : entry.phone,
            address: entry.address,
            source: entry.source
          });
        }
      }
    }

    if (leads.length < MAX_DETAIL_RESULTS) {
      const seenNames = new Set(leads.map((lead) => `${lead.companyName}|${lead.address}`));
      for (const entry of listEntries) {
        if (leads.length >= MAX_DETAIL_RESULTS) {
          break;
        }

        const key = `${entry.companyName}|${entry.address}`;
        if (seenNames.has(key) || entry.companyName === 'Empresa sem nome') {
          continue;
        }

        seenNames.add(key);
        leads.push({
          companyName: entry.companyName,
          phone: buildWhatsAppUrl(entry.phone) !== '-' ? buildWhatsAppUrl(entry.phone) : entry.phone,
          address: entry.address,
          source: entry.source
        });
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
