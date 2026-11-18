import { app, BrowserWindow, dialog, ipcMain, utilityProcess, type UtilityProcess } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { FromEngine, ToEngine } from '@shared/types'

const SHOW_FILTER = [{ name: 'HeavyLight show', extensions: ['heavylight', 'json'] }]

let window: BrowserWindow | null = null
let engine: UtilityProcess | null = null
let dirty = false
let closing = false
let quitting = false

const configPath = () => join(app.getPath('userData'), 'config.json')

async function readConfig(): Promise<{ lastShow?: string }> {
  try {
    return JSON.parse(await readFile(configPath(), 'utf8'))
  } catch {
    return {}
  }
}

async function rememberShow(path: string | null): Promise<void> {
  await mkdir(dirname(configPath()), { recursive: true })
  await writeFile(configPath(), JSON.stringify({ lastShow: path ?? undefined }))
}

function startEngine(): void {
  engine = utilityProcess.fork(join(__dirname, 'engine.js'), [], { serviceName: 'HeavyLight Engine' })
  engine.on('message', (message: FromEngine) => {
    if (window && !window.isDestroyed()) window.webContents.send('engine:message', message)
  })
  engine.on('exit', () => {
    engine = null
    if (quitting) return
    // The engine must never stay down during a show: restart and ask the UI to send the show again.
    startEngine()
    window?.webContents.send('engine:restarted')
  })
}

function createWindow(): void {
  const mac = process.platform === 'darwin'
  window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#0d0e14',
    title: 'HeavyLight',
    titleBarStyle: mac ? 'hiddenInset' : 'default',
    trafficLightPosition: mac ? { x: 16, y: 18 } : undefined,
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true }
  })

  window.on('close', (event) => {
    if (!dirty || closing || !window) return
    event.preventDefault()
    const choice = dialog.showMessageBoxSync(window, {
      type: 'question',
      message: 'Save changes to this show?',
      detail: 'Your changes are lost if you close without saving.',
      buttons: ['Save', 'Discard changes', 'Cancel'],
      defaultId: 0,
      cancelId: 2
    })
    if (choice === 0) window.webContents.send('app:save-and-close')
    else if (choice === 1) {
      closing = true
      window.close()
    }
  })
  window.on('closed', () => (window = null))

  const view = process.env.HEAVYLIGHT_VIEW ? `?view=${process.env.HEAVYLIGHT_VIEW}` : ''
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL + view)
  else window.loadFile(join(__dirname, '../renderer/index.html'), { search: view })

  // Development aid: HEAVYLIGHT_SHOT=/path/shot.png saves a screenshot after start-up and quits.
  const shot = process.env.HEAVYLIGHT_SHOT
  if (shot) {
    window.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const image = await window!.webContents.capturePage()
        await writeFile(shot, image.toPNG())
        closing = true
        app.quit()
      }, Number(process.env.HEAVYLIGHT_SHOT_DELAY ?? 3500))
    })
  }
}

ipcMain.on('engine:send', (_e, message: ToEngine) => engine?.postMessage(message))

ipcMain.on('app:dirty', (_e, value: boolean, title: string) => {
  dirty = value
  if (!window) return
  window.setDocumentEdited(value)
  window.setTitle(`${title}${value ? ' (edited)' : ''} – HeavyLight`)
})

ipcMain.on('app:close', () => {
  closing = true
  window?.close()
})

ipcMain.handle('file:last', async () => {
  if (process.env.HEAVYLIGHT_FRESH) return null
  const { lastShow } = await readConfig()
  if (!lastShow) return null
  try {
    return { path: lastShow, text: await readFile(lastShow, 'utf8') }
  } catch {
    return null
  }
})

ipcMain.handle('file:open', async () => {
  const result = await dialog.showOpenDialog(window!, { properties: ['openFile'], filters: SHOW_FILTER })
  if (result.canceled || !result.filePaths[0]) return null
  const path = result.filePaths[0]
  const text = await readFile(path, 'utf8')
  await rememberShow(path)
  return { path, text }
})

ipcMain.handle('file:save', async (_e, args: { path: string | null; text: string; name: string }) => {
  let path = args.path
  if (!path) {
    const result = await dialog.showSaveDialog(window!, { defaultPath: `${args.name}.heavylight`, filters: SHOW_FILTER })
    if (result.canceled || !result.filePath) return null
    path = result.filePath
  }
  await writeFile(path, args.text, 'utf8')
  await rememberShow(path)
  return path
})

ipcMain.handle('file:forget', () => rememberShow(null))

ipcMain.handle('file:import-fixtures', async () => {
  const result = await dialog.showOpenDialog(window!, {
    title: 'Import Open Fixture Library files',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'OFL fixture', extensions: ['json'] }]
  })
  if (result.canceled) return []
  return Promise.all(result.filePaths.map(async (path) => ({ name: basename(path, '.json'), text: await readFile(path, 'utf8') })))
})

app.whenReady().then(() => {
  startEngine()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => (quitting = true))
app.on('window-all-closed', () => {
  quitting = true
  engine?.kill()
  app.quit()
})
