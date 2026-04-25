function normalizePhone(rawPhone) {
  if (!rawPhone) {
    return '-'
  }

  const onlyDigits = rawPhone.replace(/\D/g, '')

  if (onlyDigits.length === 11) {
    return onlyDigits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  }

  if (onlyDigits.length === 10) {
    return onlyDigits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
  }

  return rawPhone
}

function sanitizeLead(lead) {
  const website = lead.website || '-'
  return {
    companyName: lead.companyName || 'Empresa sem nome',
    phone: normalizePhone(lead.phone || '-'),
    website,
    address: lead.address || '-',
    instagram: website.includes('instagram.com') ? website : '-',
    source: lead.source || 'Google Maps Scraper',
  }
}

function getLeadsApiUrl() {
  const configuredUrl = import.meta.env.VITE_LEADS_API_URL?.trim()
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, '')
  }

  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:3030'
  }

  return window.location.origin
}

async function searchLeadsFromApi({ niche, city, uf }) {
  const response = await fetch(`${getLeadsApiUrl()}/search-leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ niche, city, uf }),
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.error || 'Falha ao buscar empresas na API.')
  }

  return payload.leads
}

export async function searchLeads({ niche, city, uf }) {
  const rawLeads = window.desktop?.searchLeads
    ? await window.desktop.searchLeads({ niche, city, uf })
    : await searchLeadsFromApi({ niche, city, uf })

  const leads = Array.isArray(rawLeads) ? rawLeads.map(sanitizeLead) : []

  return {
    warning: leads.length === 0 ? 'Nenhum resultado encontrado para essa busca.' : null,
    leads,
  }
}
