import { app, BrowserWindow, Notification, ipcMain, nativeImage, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scrapeGoogleMapsLeads } from './scraper.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VITE_DEV_SERVER_URL = 'http://localhost:5173'
const APP_USER_MODEL_ID = 'com.localizeia.desktop'
const DEV_APP_USER_MODEL_ID = 'com.localizeia.desktop.dev'
const CURRENT_APP_USER_MODEL_ID = app.isPackaged ? APP_USER_MODEL_ID : DEV_APP_USER_MODEL_ID
const APP_ORIGINS = new Set([VITE_DEV_SERVER_URL])

app.setName('LocalizeIA')
if (process.platform === 'win32') {
  app.setAppUserModelId(CURRENT_APP_USER_MODEL_ID)
}

function resolveIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.ico')
  }

  return path.join(__dirname, '..', 'build', 'icon.ico')
}

function resolveNotificationIconPath() {
  const iconPath = app.isPackaged
    ? path.join(__dirname, '..', 'dist', 'favicon.ico')
    : path.join(__dirname, '..', 'public', 'favicon.ico')

  return existsSync(iconPath) ? iconPath : resolveIconPath()
}

function ensureWindowsAppShortcut() {
  if (process.platform !== 'win32') {
    return
  }

  const programsPath = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  const desktopPath = app.getPath('desktop')
  const shortcutName = app.isPackaged ? 'LocalizeIA.lnk' : 'LocalizeIA Dev.lnk'
  const shortcutPaths = [path.join(programsPath, shortcutName)]

  if (app.isPackaged) {
    shortcutPaths.push(path.join(desktopPath, shortcutName))
  }

  mkdirSync(programsPath, { recursive: true })

  shortcutPaths.forEach((shortcutPath) => {
    shell.writeShortcutLink(shortcutPath, 'create', {
      target: process.execPath,
      args: app.isPackaged ? '' : `"${app.getAppPath()}"`,
      appUserModelId: CURRENT_APP_USER_MODEL_ID,
      description: app.isPackaged ? 'LocalizeIA' : 'LocalizeIA Dev',
      icon: app.isPackaged ? process.execPath : resolveIconPath(),
      iconIndex: 0,
    })
  })
}

function isExternalUrl(url) {
  try {
    if (url.startsWith('file://')) {
      return false
    }

    const parsedUrl = new URL(url)
    return !APP_ORIGINS.has(parsedUrl.origin)
  } catch {
    return false
  }
}

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    icon: resolveIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } else {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }

    return { action: 'allow' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isExternalUrl(url)) {
      return
    }

    event.preventDefault()
    shell.openExternal(url)
  })
}

app.whenReady().then(() => {
  ensureWindowsAppShortcut()

  ipcMain.handle('scraper:search-leads', async (_event, payload) => {
    const leads = await scrapeGoogleMapsLeads(payload)
    return leads
  })

  ipcMain.handle('notification:search-complete', async (_event, message) => {
    if (!Notification.isSupported()) {
      return false
    }

    const icon = nativeImage.createFromPath(resolveNotificationIconPath())

    new Notification({
      title: 'LocalizeIA',
      body: message,
      icon,
    }).show()

    return true
  })

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
