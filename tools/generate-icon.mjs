import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import pngToIco from 'png-to-ico'

const inputPath = resolve('public/logo.png')
const outputPath = resolve('build/icon.ico')
const buildPngPath = resolve('build/logo.png')
const publicIcoPath = resolve('public/favicon.ico')

if (!existsSync(inputPath)) {
  console.error('Arquivo nao encontrado: public/logo.png')
  console.error('Salve o logo PNG nesse caminho e rode novamente: npm run icon:generate')
  process.exit(1)
}

async function run() {
  const pngBuffer = readFileSync(inputPath)
  const icoBuffer = await pngToIco(pngBuffer)

  mkdirSync(dirname(outputPath), { recursive: true })
  mkdirSync(dirname(buildPngPath), { recursive: true })

  writeFileSync(outputPath, icoBuffer)
  copyFileSync(inputPath, buildPngPath)
  writeFileSync(publicIcoPath, icoBuffer)

  console.log('Icone gerado com sucesso em build/icon.ico')
  console.log('Favicon atualizado em public/favicon.ico')
  console.log('Logo copiado para build/logo.png')
}

run().catch((error) => {
  console.error('Falha ao gerar icone:', error)
  process.exit(1)
})
