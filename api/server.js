import cors from 'cors'
import express from 'express'
import { scrapeGoogleMapsLeads } from '../electron/scraper.js'

const app = express()
const port = Number(process.env.LEADS_API_PORT || 3030)

app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'localizeia-leads-api' })
})

app.post('/search-leads', async (req, res) => {
  const niche = String(req.body?.niche || '').trim()
  const city = String(req.body?.city || '').trim()
  const uf = String(req.body?.uf || '').trim()

  if (!niche || !city || !uf) {
    return res.status(400).json({
      error: 'Parametros obrigatorios: niche, city, uf',
    })
  }

  try {
    const leads = await scrapeGoogleMapsLeads({ niche, city, uf })
    return res.json({ leads })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha inesperada no scraper.'
    return res.status(500).json({ error: message })
  }
})

app.listen(port, '0.0.0.0', () => {
  console.log(`LocalizeIA Leads API online em http://0.0.0.0:${port}`)
})
