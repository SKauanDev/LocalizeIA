import { useEffect, useMemo, useState } from 'react'
import { Search, Building2, BellRing, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'
import { getCitiesByState, getStates } from './services/ibgeApi'
import { searchLeads } from './services/leadsService'

function buildWhatsAppLink(phone) {
  if (!phone || phone === '-') {
    return null
  }

  let digits = phone.replace(/\D/g, '')
  if (!digits) {
    return null
  }

  if (!digits.startsWith('55')) {
    digits = `55${digits}`
  }

  return `https://wa.me/${digits}`
}

function normalizeForSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function playCompletionBell() {
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) {
    return
  }

  const audioContext = new AudioContext()
  const gainNode = audioContext.createGain()
  gainNode.connect(audioContext.destination)
  gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime)
  gainNode.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.02)
  gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.75)

  ;[880, 1174].forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime + index * 0.12)
    oscillator.connect(gainNode)
    oscillator.start(audioContext.currentTime + index * 0.12)
    oscillator.stop(audioContext.currentTime + 0.65 + index * 0.12)
  })

  setTimeout(() => audioContext.close(), 900)
}

function App() {
  const [states, setStates] = useState([])
  const [cities, setCities] = useState([])
  const [selectedStateId, setSelectedStateId] = useState('')
  const [selectedUf, setSelectedUf] = useState('')
  const [selectedStateName, setSelectedStateName] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [statePopupOpen, setStatePopupOpen] = useState(false)
  const [, setSelectedCityId] = useState('')
  const [selectedCityName, setSelectedCityName] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [cityPopupOpen, setCityPopupOpen] = useState(false)
  const [niche, setNiche] = useState('')
  const [loadingFilters, setLoadingFilters] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchSeconds, setSearchSeconds] = useState(0)
  const [completionNotice, setCompletionNotice] = useState('')
  const [warning, setWarning] = useState('')
  const [error, setError] = useState('')
  const [leads, setLeads] = useState([])
  const [currentPage, setCurrentPage] = useState(1)

  const pageSize = 8

  useEffect(() => {
    async function loadStates() {
      try {
        setLoadingFilters(true)
        const response = await getStates()
        setStates(response)
      } catch {
        setError('Falha ao carregar estados do IBGE.')
      } finally {
        setLoadingFilters(false)
      }
    }

    loadStates()
  }, [])

  useEffect(() => {
    async function loadCities() {
      try {
        if (!selectedStateId) {
          setCities([])
          return
        }

        const response = await getCitiesByState(selectedStateId)
        setCities(response)
      } catch {
        setError('Falha ao carregar cidades do estado selecionado.')
      }
    }

    setSelectedCityId('')
    setSelectedCityName('')
    setCityFilter('')
    loadCities()
  }, [selectedStateId])

  const filteredCities = useMemo(() => {
    const term = normalizeForSearch(cityFilter)
    if (!term) {
      return cities.slice(0, 8)
    }

    return cities.filter((city) => normalizeForSearch(city.name).includes(term)).slice(0, 8)
  }, [cities, cityFilter])

  const filteredStates = useMemo(() => {
    const term = normalizeForSearch(stateFilter)
    if (!term) {
      return states.slice(0, 8)
    }

    return states
      .filter((state) => {
        const stateName = normalizeForSearch(state.name)
        const stateUf = normalizeForSearch(state.uf)
        return stateName.includes(term) || stateUf.includes(term)
      })
      .slice(0, 8)
  }, [states, stateFilter])

  const canSearch = useMemo(() => {
    return niche.trim() && selectedCityName && selectedUf
  }, [niche, selectedCityName, selectedUf])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(leads.length / pageSize)), [leads.length, pageSize])

  const paginatedLeads = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return leads.slice(start, start + pageSize)
  }, [currentPage, leads, pageSize])

  async function handleSearch(event) {
    event.preventDefault()

    if (!canSearch) {
      return
    }

    let notificationPermission = Promise.resolve('denied')
    if (!window.desktop?.notifySearchComplete && 'Notification' in window) {
      notificationPermission = Notification.permission === 'default' ? Notification.requestPermission() : Promise.resolve(Notification.permission)
    }

    try {
      setError('')
      setWarning('')
      setCompletionNotice('')
      setSearching(true)

      const { leads: results, warning: apiWarning } = await searchLeads({
        niche: niche.trim(),
        city: selectedCityName,
        uf: selectedUf,
      })

      setLeads(results)
      setCurrentPage(1)
      if (apiWarning) {
        setWarning(apiWarning)
      }

      const notice = `Busca completa: ${results.length} empresas encontradas.`
      setCompletionNotice(notice)
      playCompletionBell()

      if (window.desktop?.notifySearchComplete) {
        await window.desktop.notifySearchComplete(notice)
      } else if ('Notification' in window && (await notificationPermission) === 'granted') {
        new Notification('LocalizeIA', {
          body: notice,
          icon: new URL('logo.png', window.location.href).href,
        })
      }
    } catch (searchError) {
      const message = searchError instanceof Error ? searchError.message : 'Falha desconhecida no scraper.'
      setError(`Nao foi possivel buscar empresas no Google Maps: ${message}`)
    } finally {
      setSearching(false)
    }
  }

  useEffect(() => {
    if (!searching) {
      setSearchSeconds(0)
      return undefined
    }

    const start = Date.now()
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000)
      setSearchSeconds(elapsed)
    }, 1000)

    return () => clearInterval(timer)
  }, [searching])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  useEffect(() => {
    if (!completionNotice) {
      return undefined
    }

    const timer = setTimeout(() => setCompletionNotice(''), 4200)
    return () => clearTimeout(timer)
  }, [completionNotice])

  function handleCitySelect(city) {
    setSelectedCityId(String(city.id))
    setSelectedCityName(city.name)
    setCityFilter(city.name)
    setCityPopupOpen(false)
  }

  function handleStateSelect(state) {
    setSelectedStateId(String(state.id))
    setSelectedUf(state.uf)
    setSelectedStateName(state.name)
    setStateFilter(`${state.name} (${state.uf})`)
    setStatePopupOpen(false)
  }

  return (
    <div className="min-h-screen bg-base text-slate-200">
      {completionNotice && (
        <div className="fixed right-5 top-5 z-50 flex max-w-sm items-center gap-3 rounded-xl border border-cyan-500/40 bg-slate-950 px-4 py-3 text-sm text-slate-100 shadow-2xl shadow-cyan-950/50">
          <BellRing size={18} className="text-cyan-300" />
          <span>{completionNotice}</span>
        </div>
      )}

      <div className="mx-auto flex min-h-screen w-full max-w-[1800px] gap-6 p-6">
        <aside className="w-full max-w-sm rounded-2xl border border-slate-700/60 bg-panel/95 p-5 shadow-2xl shadow-cyan-900/20">
          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-xl bg-cyan-500/15 p-2 text-cyan-300">
              <Building2 size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-white">LocalizeIA</h1>
              <p className="text-xs text-slate-400">Buscador de Empresas</p>
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSearch}>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-300">Estado (UF)</span>
              <div className="relative">
                <input
                  value={stateFilter}
                  onChange={(event) => {
                    const value = event.target.value
                    setStateFilter(value)
                    setStatePopupOpen(Boolean(value.trim()))
                    if (value !== `${selectedStateName} (${selectedUf})`) {
                      setSelectedStateId('')
                      setSelectedUf('')
                      setSelectedStateName('')
                    }
                  }}
                  onFocus={() => setStatePopupOpen(Boolean(stateFilter.trim()) && !loadingFilters)}
                  onBlur={() => setTimeout(() => setStatePopupOpen(false), 120)}
                  placeholder="digite para filtrar estados..."
                  disabled={loadingFilters}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                />
                {statePopupOpen && !loadingFilters && (
                  <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-lg border border-slate-700 bg-slate-950 shadow-2xl shadow-cyan-950/40">
                    {filteredStates.length > 0 ? (
                      filteredStates.map((state) => (
                        <button
                          key={state.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleStateSelect(state)}
                          className="block w-full px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-cyan-500/15 hover:text-cyan-200"
                        >
                          {state.name} ({state.uf})
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-slate-500">Nenhum estado encontrado</div>
                    )}
                  </div>
                )}
                {selectedStateName && <p className="mt-1 text-xs text-cyan-300">Estado selecionado: {selectedStateName} ({selectedUf})</p>}
              </div>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-slate-300">Cidade</span>
              <div className="relative">
                <input
                  value={cityFilter}
                  onChange={(event) => {
                    const value = event.target.value
                    setCityFilter(value)
                    setCityPopupOpen(Boolean(value.trim()))
                    if (value !== selectedCityName) {
                      setSelectedCityId('')
                      setSelectedCityName('')
                    }
                  }}
                  onFocus={() => setCityPopupOpen(Boolean(cityFilter.trim()) && Boolean(selectedStateId))}
                  onBlur={() => setTimeout(() => setCityPopupOpen(false), 120)}
                  placeholder="digite para filtrar cidades..."
                  disabled={!selectedStateId}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                />
                {cityPopupOpen && selectedStateId && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-lg border border-slate-700 bg-slate-950 shadow-2xl shadow-cyan-950/40">
                    {filteredCities.length > 0 ? (
                      filteredCities.map((city) => (
                        <button
                          key={city.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleCitySelect(city)}
                          className="block w-full px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-cyan-500/15 hover:text-cyan-200"
                        >
                          {city.name}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-slate-500">Nenhuma cidade encontrada</div>
                    )}
                  </div>
                )}
                {selectedCityName && <p className="mt-1 text-xs text-cyan-300">Cidade selecionada: {selectedCityName}</p>}
              </div>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-slate-300">Nicho</span>
              <input
                value={niche}
                onChange={(event) => setNiche(event.target.value)}
                placeholder="Ex: Informatica, Clinica, Academia..."
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </label>

            <button
              type="submit"
              disabled={!canSearch || searching}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2.5 font-medium text-slate-900 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              <Search size={16} />
              {searching ? 'Buscando...' : 'Buscar'}
            </button>

            {searching && (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2">
                <LoaderCircle size={16} className="animate-spin text-cyan-300" />
                <span className="text-xs text-slate-300">Loading... {searchSeconds}s</span>
              </div>
            )}
          </form>
        </aside>

        <main className="flex-1 rounded-2xl border border-slate-700/50 bg-panel/70 p-5">
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Resultados</h2>
              <p className="text-sm text-slate-400">{leads.length} empresas encontradas</p>
            </div>
          </header>

          {warning && (
            <div className="mb-3 rounded-lg border border-amber-700 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">{warning}</div>
          )}

          {error && <div className="mb-3 rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">{error}</div>}

          <div className="overflow-hidden rounded-xl border border-slate-700">
            <table className="min-w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-slate-900 text-slate-300">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Empresa</th>
                  <th className="px-4 py-3 text-left font-medium">WhatsApp</th>
                  <th className="px-4 py-3 text-left font-medium">Instagram</th>
                  <th className="px-4 py-3 text-left font-medium">Site</th>
                  <th className="px-4 py-3 text-left font-medium">Endereço</th>
                  <th className="px-4 py-3 text-left font-medium">Fonte</th>
                </tr>
              </thead>
              <tbody>
                {leads.length === 0 && !searching ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      Faca uma busca para listar empresas B2B.
                    </td>
                  </tr>
                ) : (
                  paginatedLeads.map((lead, index) => (
                    <tr key={`${lead.companyName}-${index}`} className="border-t border-slate-800 bg-slate-950/40">
                      <td className="px-4 py-3 text-slate-100">{lead.companyName}</td>
                      <td className="px-4 py-3">
                        {buildWhatsAppLink(lead.phone) ? (
                          <a
                            href={buildWhatsAppLink(lead.phone)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-300 hover:text-emerald-200"
                          >
                            {lead.phone}
                          </a>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {lead.instagram !== '-' ? (
                          <a href={lead.instagram} target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-200">
                            Abrir Instagram
                          </a>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {lead.website !== '-' ? (
                          <a href={lead.website} target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-200">
                            Site
                          </a>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-300">{lead.address || '-'}</td>
                      <td className="px-4 py-3 text-slate-400">{lead.source}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {leads.length > 0 && (
            <div className="mt-3 flex justify-end">
              <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/95 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="rounded-md p-1.5 text-slate-300 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="min-w-16 text-center text-xs text-slate-400">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="rounded-md p-1.5 text-slate-300 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
