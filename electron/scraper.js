import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { existsSync } from 'node:fs'

chromium.use(StealthPlugin())

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.184 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
]

const SEARCH_TIMEOUT_MS = 30000
const PANEL_TIMEOUT_MS = 12000
const MAX_RESULTS = 25
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
    throw new Error('Parametros obrigatorios: niche, city, uf')
  }

  let browser
  try {
    browser = await chromium.launch(resolveBrowserLaunchOptions())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Nao foi possivel iniciar navegador para scraping. Instale o Google Chrome ou defina LOCALIZEIA_CHROME_PATH. Detalhe: ${message}`,
    )
  }

  const query = `${niche} em ${city}, ${uf}`
  const userAgent = pickRandomUserAgent()

  try {
    const context = await browser.newContext({
      userAgent,
      viewport: { width: 1366, height: 768 },
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
    })

    const listPage = await context.newPage()
    listPage.setDefaultTimeout(PANEL_TIMEOUT_MS)

    await listPage.goto('https://www.google.com/maps', {
      waitUntil: 'domcontentloaded',
      timeout: SEARCH_TIMEOUT_MS,
    })
    await acceptConsentIfPresent(listPage)

    const searchInput = listPage.locator('#searchboxinput')
    const inputVisible = await searchInput.isVisible({ timeout: 5000 }).catch(() => false)

    if (inputVisible) {
      await searchInput.fill(query)
      await searchInput.press('Enter')
    } else {
      const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`
      await listPage.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: SEARCH_TIMEOUT_MS,
      })
      await acceptConsentIfPresent(listPage)
    }

    const feed = listPage.locator('div[role="feed"]').first()
    await feed.waitFor({ timeout: SEARCH_TIMEOUT_MS })

    const placeLinks = await collectUniquePlaceLinks(listPage)

    if (placeLinks.length === 0) {
      await context.close()
      return []
    }

    const detailPage = await context.newPage()
    detailPage.setDefaultTimeout(PANEL_TIMEOUT_MS)

    const leads = []
    for (const placeLink of placeLinks) {
      try {
        await detailPage.goto(placeLink, {
          waitUntil: 'domcontentloaded',
          timeout: SEARCH_TIMEOUT_MS,
        })
        await detailPage.locator('h1').first().waitFor({ timeout: PANEL_TIMEOUT_MS })
        const lead = await extractLeadFromDetailPage(detailPage, `${city}/${uf}`)
        if (isUsefulLead(lead)) {
          leads.push(lead)
        }
      } catch {
        // Skip individual failures to keep scraper stable.
      }
    }

    await detailPage.close()
    await context.close()

    return dedupeLeads(leads).slice(0, MAX_RESULTS)
  } finally {
    if (browser) {
      await browser.close()
    }
  }

  const browser = await playwright.chromium.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // Usa /tmp em vez de memória compartilhada (Essencial!)
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process', // Roda tudo em um processo só para economizar RAM
      '--disable-gpu',
      '--disable-extensions'
    ]
  });
}

