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
