import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const rcedit = require('rcedit')

const projectRoot = process.cwd()
const outputDir = process.env.LOCALIZEIA_OUTPUT_DIR || 'executavel_localizeia'
const exePath = path.join(projectRoot, outputDir, 'win-unpacked', 'LocalizeIA.exe')
const iconPath = path.join(projectRoot, 'build', 'icon.ico')
const packageJsonPath = path.join(projectRoot, 'package.json')

if (!fs.existsSync(exePath)) {
  console.error(`Executavel nao encontrado em: ${exePath}`)
  process.exit(1)
}

if (!fs.existsSync(iconPath)) {
  console.error(`Icone nao encontrado em: ${iconPath}`)
  process.exit(1)
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
const version = packageJson.version || '1.0.0'

await rcedit(exePath, {
  icon: iconPath,
  'file-version': version,
  'product-version': version,
  'version-string': {
    CompanyName: 'KSTech',
    FileDescription: 'LocalizeIA',
    ProductName: 'LocalizeIA',
    InternalName: 'LocalizeIA',
    OriginalFilename: 'LocalizeIA.exe',
    LegalCopyright: 'Copyright (c) KSTech',
  },
})

console.log(`Icone e metadados aplicados em: ${exePath}`)
