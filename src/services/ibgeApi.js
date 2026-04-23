import axios from 'axios'

export const ibgeApi = axios.create({
  baseURL: 'https://servicodados.ibge.gov.br/api/v1/localidades',
  timeout: 10000,
})

export async function getStates() {
  const { data } = await ibgeApi.get('/estados?orderBy=nome')
  return data.map((state) => ({
    id: state.id,
    name: state.nome,
    uf: state.sigla,
  }))
}

export async function getCitiesByState(stateId) {
  if (!stateId) {
    return []
  }

  const { data } = await ibgeApi.get(`/estados/${stateId}/municipios`)
  return data.map((city) => ({
    id: city.id,
    name: city.nome,
  }))
}
