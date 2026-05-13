# LocalizeIA

Software desktop para Windows focado em mineracao de leads B2B por localidade.

## Stack
- React + Vite
- Electron
- Tailwind CSS (dark mode)
- Playwright + playwright-extra + stealth plugin
- Express (API local para mobile)

## Requisitos
- Node.js 20+
- NPM 10+

## Instalacao
```bash
npm install
npm run playwright:install
```

## Execucao Desktop
```bash
npm run electron:dev
```

## API local (dev)
```bash
npm run api:dev
```

Endpoints:
- `GET /health`
- `POST /search-leads`

Payload de busca:
```json
{
  "niche": "mecanica",
  "city": "Canoas",
  "uf": "RS"
}
```

## Execucao completa (desktop + API)
```bash
npm run dev:full
```

## Build desktop Windows
```bash
npm run electron:build
```

## Deploy Docker / Back4App
O container foi configurado para rodar apenas a API usada pelo mobile:

```bash
docker build -t localizeia-api .
docker run --rm -p 3030:3030 localizeia-api
```

No Back4App, use o `Dockerfile` da raiz do projeto. A aplicacao escuta em `0.0.0.0` e usa a variavel `PORT` quando a plataforma definir uma porta automaticamente.

Endpoint de saude:
```text
GET /health
```
