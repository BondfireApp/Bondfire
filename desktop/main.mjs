import { app, BrowserWindow, Menu, shell } from 'electron'

const BONDFIRE_URL = 'https://bondfireapp.org'

let mainWindow = null

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Bondfire',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'services' } : null,
        { role: 'quit' },
      ].filter(Boolean),
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ])
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 360,
    minHeight: 600,
    title: 'Bondfire',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)

      if (target.origin !== BONDFIRE_URL) {
        shell.openExternal(url)
        return { action: 'deny' }
      }
    } catch {
      return { action: 'deny' }
    }

    return { action: 'allow' }
  })

  await mainWindow.loadURL(BONDFIRE_URL)
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(buildMenu())
  await createMainWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
