import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.184 Safari/537.36',
];

const SEARCH_TIMEOUT_MS = 30000
const PANEL_TIMEOUT_MS = 12000
const MAX_RESULTS = 19
const MAX_SCROLL_STEPS = 28
const MAX_IDLE_SCROLLS = 5

function resolveBrowserLaunchOptions() {
  const base = {
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  }

  const customPath = process.env.LOCALIZEIA_CHROME_PATH
  if (customPath && existsSync(customPath)) {
    return { ...base, executablePath: customPath }
  }

  const windowsCandidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]

  const linuxCandidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ]

  const macCandidates = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']

  let candidates = windowsCandidates
  if (process.platform === 'linux') {
    candidates = linuxCandidates
  } else if (process.platform === 'darwin') {
    candidates = macCandidates
  }

  const installedBrowserPath = candidates.find((candidate) => existsSync(candidate))
  if (installedBrowserPath) {
    return { ...base, executablePath: installedBrowserPath }
  }

  return base
}

function pickRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

function isUsefulLead(lead) {
  return lead.companyName !== 'Empresa sem nome' || lead.phone !== '-' || lead.website !== '-' || lead.address !== '-'
}

function normalizeUrl(rawUrl) {
  if (!rawUrl || rawUrl === '-') {
    return '-'
  }

  try {
    const parsed = new URL(rawUrl)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return rawUrl
  }
}

function normalizeKeyPart(value) {
  return (value || '-')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function buildLeadKey(lead) {
  return [normalizeKeyPart(lead.companyName), normalizeKeyPart(lead.phone), normalizeKeyPart(lead.address)].join('|')
}

function dedupeLeads(leads) {
  const seen = new Set()
  const output = []

  for (const lead of leads) {
    const key = buildLeadKey(lead)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    output.push(lead)
  }

  return output
}

async function safeText(locator) {
  try {
    const value = await locator.first().textContent({ timeout: 2000 })
    return value?.trim() || null
  } catch {
    return null
  }
}

async function safeAttribute(locator, attr) {
  try {
    const value = await locator.first().getAttribute(attr, { timeout: 2000 })
    return value?.trim() || null
  } catch {
    return null
  }
}

async function acceptConsentIfPresent(page) {
  const selectors = [
    'button:has-text("Aceitar tudo")',
    'button:has-text("Aceito")',
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
  ]

  for (const selector of selectors) {
    try {
      const button = page.locator(selector).first()
      if (await button.isVisible({ timeout: 1200 })) {
        await button.click({ timeout: 3000 })
        await page.waitForTimeout(800)
        return true
      }
    } catch {
      // Ignore and try next selector.
    }
  }

  return false
}

async function collectUniquePlaceLinks(listPage) {
  const feed = listPage.locator('div[role="feed"]').first()
  const uniqueLinks = new Set()
  let idleRounds = 0

  for (let step = 0; step < MAX_SCROLL_STEPS; step += 1) {
    const links = await listPage
      .locator('div[role="feed"] a[href*="/place/"]')
      .evaluateAll((elements) => elements.map((el) => el.getAttribute('href')).filter(Boolean))
      .catch(() => [])

    for (const href of links) {
      const normalized = normalizeUrl(href)
      if (normalized.includes('/place/')) {
        uniqueLinks.add(normalized)
      }
    }

    const beforeScrollCount = uniqueLinks.size

    await feed.evaluate((element) => {
      element.scrollBy(0, 1800)
    })
    await listPage.waitForTimeout(450)

    const currentCount = uniqueLinks.size
    if (currentCount === beforeScrollCount) {
      idleRounds += 1
      if (idleRounds >= MAX_IDLE_SCROLLS) {
        break
      }
    } else {
      idleRounds = 0
    }

    if (uniqueLinks.size >= MAX_RESULTS * 2) {
      break
    }
  }

  return [...uniqueLinks].slice(0, MAX_RESULTS)
}

async function extractLeadFromDetailPage(detailPage, queryLabel) {
  const name =
    (await safeText(detailPage.locator('h1.DUwDvf'))) ||
    (await safeText(detailPage.locator('h1.fontHeadlineLarge'))) ||
    'Empresa sem nome'

  const phone =
    (await safeText(detailPage.locator('button[data-item-id^="phone:tel:"] div.fontBodyMedium'))) ||
    (await safeText(detailPage.locator('button[data-item-id*="phone"] div.fontBodyMedium'))) ||
    '-'

  const websiteHref =
    (await safeAttribute(detailPage.locator('a[data-item-id="authority"]'), 'href')) ||
    (await safeAttribute(detailPage.locator('a[data-tooltip="Abrir site"]'), 'href')) ||
    '-'

  const address =
    (await safeText(detailPage.locator('button[data-item-id="address"] div.fontBodyMedium'))) ||
    (await safeText(detailPage.locator('button[data-item-id*="address"] div.fontBodyMedium'))) ||
    '-'

  return {
    companyName: name,
    phone,
    website: websiteHref,
    address,
    instagram: websiteHref.includes('instagram.com') ? websiteHref : '-',
    source: `Google Maps Scraper (${queryLabel})`,
  }
}

export async function scrapeGoogleMapsLeads({ niche, city, uf }) {
  if (!niche || !city || !uf) {
    throw new Error('Parametros obrigatorios: niche, city, uf');
  }

  // 1. DECLARAR A VARIÁVEL APENAS UMA VEZ
  let browser;

  try {
    // 2. INICIALIZAR COM ARGUMENTOS DE ECONOMIA DE MEMÓRIA
    // Usei os argumentos que cabem nos 512MB do Render
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--disable-gpu',
        '--no-zygote'
      ]
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Erro ao iniciar navegador: ${message}`);
  }

  const query = `${niche} em ${city}, ${uf}`;
  const userAgent = pickRandomUserAgent();

  try {
    const context = await browser.newContext({
      userAgent,
      viewport: { width: 1366, height: 768 },
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
    });

    const listPage = await context.newPage();
    
    // BLOQUEADOR DE IMAGENS (Essencial para não estourar a RAM no Render)
    await listPage.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font'].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    listPage.setDefaultTimeout(PANEL_TIMEOUT_MS);

    await listPage.goto('https://www.google.com.br/maps', {
      waitUntil: 'domcontentloaded',
      timeout: SEARCH_TIMEOUT_MS,
    });

    await acceptConsentIfPresent(listPage);

    const searchInput = listPage.locator('#searchboxinput');
    const inputVisible = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (inputVisible) {
      await searchInput.fill(query);
      await searchInput.press('Enter');
    } else {
      const searchUrl = `https://www.google.com.br/maps/search/${encodeURIComponent(query)}`;
      await listPage.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: SEARCH_TIMEOUT_MS,
      });
      await acceptConsentIfPresent(listPage);
    }

    const feed = listPage.locator('div[role="feed"]').first();
    await feed.waitFor({ timeout: SEARCH_TIMEOUT_MS });

    const placeLinks = await collectUniquePlaceLinks(listPage);

    if (placeLinks.length === 0) {
      await context.close();
      return [];
    }

    const detailPage = await context.newPage();
    
    // Bloquear imagens na página de detalhes também
    await detailPage.route('**/*', (route) => {
      if (['image', 'media', 'font'].includes(route.request().resourceType())) {
        route.abort();
      } else {
        route.continue();
      }
    });

    detailPage.setDefaultTimeout(PANEL_TIMEOUT_MS);

    const leads = [];
    // Limitar para no máximo 10 leads no plano FREE para não travar
    const limitedLinks = placeLinks.slice(0, 10);

    for (const placeLink of limitedLinks) {
      try {
        await detailPage.goto(placeLink, {
          waitUntil: 'domcontentloaded',
          timeout: SEARCH_TIMEOUT_MS,
        });
        await detailPage.locator('h1').first().waitFor({ timeout: PANEL_TIMEOUT_MS });
        const lead = await extractLeadFromDetailPage(detailPage, `${city}/${uf}`);
        if (isUsefulLead(lead)) {
          leads.push(lead);
        }
      } catch {
        // Ignora falhas individuais
      }
    }

    await detailPage.close();
    await context.close();

    return dedupeLeads(leads);
  } finally {
    // 3. FECHAR O NAVEGADOR SEMPRE
    if (browser) {
      await browser.close();
    }
  }
}