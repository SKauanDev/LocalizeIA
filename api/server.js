import cors from 'cors';
import express from 'express';
import { scrapeGoogleMapsLeads } from '../electron/scraper.js';

const app = express();

// 1. CONFIGURAÇÃO GLOBAL DE CORS (Simples e direta)
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 2. MIDDLEWARE MANUAL PARA GARANTIR O PREFLIGHT (Sem usar '*')
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '1mb' }));

const port = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'online' });
});

app.post('/search-leads', async (req, res) => {
  const { niche, city, uf } = req.body || {};

  if (!niche || !city || !uf) {
    return res.status(400).json({ error: 'Parametros obrigatorios ausentes' });
  }

  try {
    // IMPORTANTE: Se o scraper demorar muito, o Back4App pode cortar a conexão
    console.log(`Iniciando busca: ${niche} em ${city}-${uf}`);
    const leads = await scrapeGoogleMapsLeads({ niche, city, uf });
    res.json({ leads });
  } catch (error) {
    console.error('Erro no Scraper:', error);
    res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Servidor ativo na porta ${port}`);
});