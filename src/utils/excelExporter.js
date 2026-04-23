import * as XLSX from 'xlsx'

export function exportToXlsx(leads) {
  const rows = leads.map((lead) => ({
    Empresa: lead.companyName,
    Telefone: lead.phone,
    Instagram: lead.instagram,
    Website: lead.website,
    Endereco: lead.address,
    Fonte: lead.source,
  }))

  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads')
  XLSX.writeFile(workbook, `localizeia-leads-${Date.now()}.xlsx`)
}
