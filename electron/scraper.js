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
  if (!niche || !city || !uf) throw new Error('Parâmetros inválidos');

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--disable-gpu',
        '--no-zygote'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 }, // Viewport desktop para forçar exibição de telefones
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    // Bloqueio agressivo de recursos (RAM Safe)
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
        return route.abort().catch(() => {});
      }
      return route.continue().catch(() => {});
    });

    const query = encodeURIComponent(`${niche} em ${city}, ${uf}`);
    await page.goto(`https://www.google.com.br/maps/search/${query}`, {
      waitUntil: 'networkidle', 
      timeout: 30000
    });

    const leads = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('div[role="article"]');
      
      cards.forEach((card) => {
        const name = card.querySelector('.fontHeadlineSmall')?.textContent || 'Empresa sem nome';
        
        // Coleta todos os textos do card para caçar o telefone
        const allTexts = Array.from(card.querySelectorAll('span, div'))
          .map(el => el.textContent.trim());
        
        // Busca o Telefone (padrão brasileiro com DDD)
        const phone = allTexts.find(t => /\(\d{2}\)\s\d/.test(t)) || '-';

        // Lógica simplificada: se achou telefone, cria link de Zap
        let whatsapp = '-';
        if (phone !== '-') {
          const onlyNums = phone.replace(/\D/g, '');
          if (onlyNums.length >= 10) {
            whatsapp = `https://wa.me/55${onlyNums}`;
          }
        }

        if (name !== 'Empresa sem nome' && whatsapp !== '-') {
          results.push({
            companyName: name,
            phone: phone,
            whatsapp: whatsapp,
            source: 'Google Maps (Foco WhatsApp)'
          });
        }
      });
      return results;
    });

    return leads;
  } finally {
    if (browser) await browser.close();
  }
}