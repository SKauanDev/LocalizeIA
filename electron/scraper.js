import { chromium } from 'playwright';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.184 Safari/537.36',
];

// Configurações otimizadas para o Render Free (512MB)
const MAX_RESULTS = 15; 
const MAX_SCROLL_STEPS = 10; 

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
      viewport: { width: 1280, height: 800 },
      userAgent: USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
    });

    const page = await context.newPage();

    // Bloqueio de RAM Safe (Imagens e CSS pesados)
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font'].includes(type)) {
        return route.abort().catch(() => {});
      }
      return route.continue().catch(() => {});
    });

    const query = encodeURIComponent(`${niche} em ${city}, ${uf}`);
    await page.goto(`https://www.google.com.br/maps/search/${query}`, {
      waitUntil: 'networkidle', 
      timeout: 30000
    });

    // --- PASSO 1: Scroll para carregar os resultados ---
    // Sem isso, o page.evaluate não encontrará nada além dos 2 ou 3 primeiros
    const feedSelector = 'div[role="feed"]';
    try {
      await page.waitForSelector(feedSelector, { timeout: 10000 });
      for (let i = 0; i < MAX_SCROLL_STEPS; i++) {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.scrollBy(0, 800);
        }, feedSelector);
        await page.waitForTimeout(500); // Espera curta para carregar
      }
    } catch (e) {
      console.log("Aviso: Feed de resultados não encontrado ou busca sem retorno.");
    }

    // --- PASSO 2: Extração dos Dados ---
    const leads = await page.evaluate(({ maxRes }) => {
      const results = [];
      const cards = document.querySelectorAll('div[role="article"]');
      
      for (const card of cards) {
        if (results.length >= maxRes) break;

        const nameElement = card.querySelector('.fontHeadlineSmall');
        const name = nameElement?.textContent?.trim() || 'Empresa sem nome';
        
        // Pegamos todos os textos dentro do card para filtrar
        const allTexts = Array.from(card.querySelectorAll('.fontBodyMedium span, .fontBodyMedium div'))
          .map(el => el.textContent.trim())
          .filter(t => t.length > 0);
        
        // 1. Identificar Telefone: Procuro por parênteses ou traço de número
        const phone = allTexts.find(t => 
          /\(\d{2}\)/.test(t) || // Tem DDD entre parênteses
          /\d{4,5}-\d{4}/.test(t) // Tem formato de telefone com traço
        ) || '-';

        // 2. Identificar Endereço: Geralmente é o texto longo que NÃO tem parênteses
        // e não é o nome da categoria (como "Restaurante")
        const address = allTexts.find(t => 
          t.length > 10 && 
          !t.includes('(') && 
          !t.includes('·') &&
          !t.includes('aberto') &&
          !t.includes('fechado') &&
          t !== name
        ) || '-';

        if (name !== 'Empresa sem nome') {
          results.push({
            companyName: name,
            phone: phone, // O seu front-end precisa disso para o WhatsApp
            address: address, // O seu front-end precisa disso para o campo endereço
            source: 'Google Maps'
          });
        }
      }
      return results;
    }, { maxRes: MAX_RESULTS });

    return leads;

  } finally {
    if (browser) await browser.close();
  }
}