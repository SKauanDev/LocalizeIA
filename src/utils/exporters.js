export function exportToCsv(leads) {
  const header = ['Empresa', 'Telefone', 'Instagram', 'Website', 'Endereco', 'Fonte']
  const rows = leads.map((lead) => [
    lead.companyName,
    lead.phone,
    lead.instagram,
    lead.website,
    lead.address,
    lead.source,
  ])

  const csvContent = [header, ...rows]
    .map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', `localizeia-leads-${Date.now()}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
