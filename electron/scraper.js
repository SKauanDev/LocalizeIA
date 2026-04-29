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
      ]
    });

    // CORREÇÃO DO ERRO DE NOTIFICAÇÃO: Concede permissão falsa para o Maps não tentar criar notificações
    const context = await browser.newContext({
      viewport: { width: 1000, height: 800 },
      permissions: ['notifications'] 
    });

    const page = await context.newPage();

    // Bloqueio de peso (Mantido para economizar RAM)
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media'].includes(type)) return route.abort().catch(() => {});
      return route.continue().catch(() => {});
    });

    const query = encodeURIComponent(`${niche} em ${city}, ${uf}`);
    await page.goto(`https://www.google.com.br/maps/search/${query}`, {
      waitUntil: 'networkidle', // Espera um pouco mais para os dados carregarem
      timeout: 30000
    });

    // Rola um pouco o feed para carregar mais dados
    const feedSelector = 'div[role="feed"]';
    try {
      await page.waitForSelector(feedSelector, { timeout: 10000 });
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.scrollBy(0, 1000);
      }, feedSelector);
      await page.waitForTimeout(1000);
    } catch (e) {}

    // EXTRAÇÃO COM SELETORES MELHORADOS
    const leads = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('div[role="article"]');
      
      cards.forEach((card) => {
        const name = card.querySelector('.fontHeadlineSmall')?.textContent || 'Empresa sem nome';
        const allDivs = Array.from(card.querySelectorAll('.fontBodyMedium div')).map(el => el.textContent);
        
        // 1. Captura o Telefone (Busca por padrão de números)
        const phone = allDivs.find(t => /\(\d{2}\)/.test(t)) || '-';

        // 2. Captura o Site/Link que estiver no card
        const website = card.querySelector('a[aria-label*="website"], a[href^="http"]')?.getAttribute('href') || '-';

        // 3. Lógica para gerar Link do WhatsApp
        let whatsapp = '-';
        
        // Se o site for um link direto de WhatsApp, usamos ele
        if (website.includes('wa.me') || website.includes('api.whatsapp.com')) {
          whatsapp = website;
        } 
        // Se tivermos um telefone, tentamos converter para link de WhatsApp
        else if (phone !== '-') {
          const onlyNums = phone.replace(/\D/g, ''); // Remove ( ) - e espaços
          // Verifica se tem cara de celular brasileiro (9 dígitos após o DDD)
          if (onlyNums.length >= 10) {
            whatsapp = `https://wa.me/55${onlyNums}`;
          }
        }

        if (name !== 'Empresa sem nome') {
          results.push({
            companyName: name,
            phone: phone,
            whatsapp: whatsapp, // Novo campo!
            website: website,
            address: allDivs.find(t => t.length > 10 && !t.includes('(')) || '-',
            source: 'Google Maps (Extração Direta)'
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