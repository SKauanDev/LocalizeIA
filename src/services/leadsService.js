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

export async function searchLeads({ niche, city, uf }) {
  if (!window.desktop?.searchLeads) {
    return {
      warning:
        'Busca local indisponivel neste contexto. Abra a janela do Electron (nao a aba http://localhost:5173 no navegador).',
      leads: [],
    }
  }

  const rawLeads = await window.desktop.searchLeads({ niche, city, uf })
  const leads = Array.isArray(rawLeads) ? rawLeads.map(sanitizeLead) : []

  return {
    warning: leads.length === 0 ? 'Nenhum resultado encontrado para essa busca.' : null,
    leads,
  }
}
