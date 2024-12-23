const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  desktopCapturer,
  Menu,
  shell,
  nativeTheme,
  Tray,
  session,
  screen,
} = require("electron");
const path = require("path");
const Store = require("electron-store");
const fs = require("fs");
const os = require("os");
const { autoUpdater } = require("electron-updater");

const store = new Store();
let mainWindow;
let tray = null;
let isRecording = false;
let regionWindow = null;
let updateDownloaded = false;

// Configure auto updater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function createTray() {
  try {
    const trayIconPath = path.resolve(__dirname, "build", "tray.ico");
    const trayRecordingIconPath = path.resolve(
      __dirname,
      "build",
      "tray-recording.ico"
    );

    // Verify that the icon files exist
    if (!fs.existsSync(trayIconPath) || !fs.existsSync(trayRecordingIconPath)) {
      console.error("Tray icons not found:", {
        trayIconPath,
        trayRecordingIconPath,
      });
      return;
    }

    tray = new Tray(trayIconPath);
    updateTrayIcon(false);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Open Recordings Folder",
        click: () => {
          const recordingsPath = store.get(
            "savePath",
            path.join(os.homedir(), "Videos")
          );
          shell.openPath(recordingsPath);
        },
      },
      {
        label: "Show/Hide Window",
        click: () => {
          mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => app.quit(),
      },
    ]);

    tray.setToolTip("QuickSnap Screen Recorder");
    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    });
  } catch (error) {
    console.error("Error creating tray:", error);
  }
}

function updateTrayIcon(recording) {
  try {
    isRecording = recording;
    if (tray) {
      const iconPath = path.resolve(
        __dirname,
        "build",
        recording ? "tray-recording.ico" : "tray.ico"
      );

      if (fs.existsSync(iconPath)) {
        tray.setImage(iconPath);
        tray.setToolTip(
          recording ? "Recording in progress..." : "QuickSnap Screen Recorder"
        );
      } else {
        console.error("Tray icon not found:", iconPath);
      }
    }
  } catch (error) {
    console.error("Error updating tray icon:", error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true,
      enableRemoteModule: true,
    },
    autoHideMenuBar: false,
    frame: false,
    backgroundColor: "#f3f3f3",
    icon: path.join(__dirname, "build/icon.ico"),
  });

  // Create menu template
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Open Recordings Folder",
          click: () => {
            const recordingsPath = store.get(
              "savePath",
              path.join(os.homedir(), "Videos")
            );
            shell.openPath(recordingsPath);
          },
        },
        { type: "separator" },
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => mainWindow.reload(),
        },
        { type: "separator" },
        {
          label: "Exit",
          accelerator: "Alt+F4",
          click: () => app.quit(),
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Check for Updates",
          click: () => {
            autoUpdater.checkForUpdatesAndNotify();
          },
        },
        { type: "separator" },
        {
          label: "About Developer",
          click: () => {
            mainWindow.webContents.send("show-about-dialog");
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  mainWindow.loadFile("src/index.html");

  // Handle window state events
  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window-maximized", true);
  });

  mainWindow.on("unmaximize", () => {
    mainWindow.webContents.send("window-maximized", false);
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  // Handle window close to tray
  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  // Add window control handlers
  ipcMain.on("minimize-window", () => {
    mainWindow.minimize();
  });

  ipcMain.on("minimize-to-tray", () => {
    mainWindow.hide();
  });

  ipcMain.on("maximize-window", () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.on("close-window", async () => {
    if (isRecording) {
      const choice = await dialog.showMessageBox(mainWindow, {
        type: "question",
        buttons: ["Yes", "No"],
        title: "Confirm",
        message: "Recording is in progress. Are you sure you want to quit?",
      });

      if (choice.response === 0) {
        app.isQuitting = true;
        mainWindow.webContents.send("force-stop-recording");
        mainWindow.close();
      }
    } else {
      app.isQuitting = true;
      mainWindow.close();
    }
  });
}

// Modify the app ready handler
app.whenReady().then(() => {
  // Configure session
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders } });
  });

  createWindow();
  createTray();

  // Check for updates silently
  checkForUpdates();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

function checkForUpdates() {
  autoUpdater.checkForUpdates().catch(err => {
    console.error('Error checking for updates:', err);
  });
}

// Add session cleanup on quit
app.on("quit", () => {
  try {
    // Clear session data
    session.defaultSession.clearCache().catch((error) => {
      console.error("Error clearing cache:", error);
    });
  } catch (error) {
    console.error("Error cleaning up session:", error);
  }
});

// Modify the app quit handler
app.on("before-quit", () => {
  app.isQuitting = true;
});

// Add IPC handlers for recording status
ipcMain.on("recording-status-changed", (event, recording) => {
  updateTrayIcon(recording);
  if (recording) {
    mainWindow.setTitle("QuickSnap - Recording...");
  } else {
    mainWindow.setTitle("QuickSnap");
  }
});

// Add handler to open last recording
ipcMain.handle("open-last-recording", async () => {
  const lastRecordingPath = store.get("lastRecordingPath");
  if (lastRecordingPath && fs.existsSync(lastRecordingPath)) {
    shell.showItemInFolder(lastRecordingPath);
    return true;
  }
  return false;
});

// Remove the old auto-updater events and replace with new ones
autoUpdater.on('checking-for-update', () => {
  console.log('Checking for updates...');
});

autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info.version);
});

autoUpdater.on('update-not-available', () => {
  console.log('No updates available');
});

autoUpdater.on('error', (err) => {
  console.error('Error in auto-updater:', err);
});

autoUpdater.on('download-progress', (progressObj) => {
  let message = `Download speed: ${progressObj.bytesPerSecond}`;
  message = `${message} - Downloaded ${progressObj.percent}%`;
  message = `${message} (${progressObj.transferred}/${progressObj.total})`;
  mainWindow.webContents.send('update-progress', progressObj.percent);
});

autoUpdater.on('update-downloaded', () => {
  updateDownloaded = true;
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update Ready',
    message: 'A new version has been downloaded. Would you like to install it now?',
    buttons: ['Install Now', 'Install Later'],
    defaultId: 0
  }).then(result => {
    if (result.response === 0) {
      autoUpdater.quitAndInstall(false, true);
    }
  });
});

// Add update reminder on app launch
app.on('ready', () => {
  if (updateDownloaded) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Pending Update',
      message: 'An update is ready to be installed. Would you like to install it now?',
      buttons: ['Install Now', 'Install Later'],
      defaultId: 0
    }).then(result => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    });
  }
});

// Configure auto updater
autoUpdater.setFeedURL({
  provider: "github",
  owner: "Armancollab",
  repo: "quicksnap",
  private: false,
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Handle get sources
ipcMain.handle("get-sources", async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });
    return sources;
  } catch (error) {
    console.error("Error getting sources:", error);
    return [];
  }
});

// Handle choose save path
ipcMain.handle("choose-save-path", async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Choose Save Location",
      defaultPath: store.get("savePath", path.join(os.homedir(), "Videos")),
    });

    if (result.filePaths && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0];
      store.set("savePath", selectedPath);
      console.log("Save path set to:", selectedPath); // Debug log
      return selectedPath;
    }
    return null;
  } catch (error) {
    console.error("Error choosing save path:", error);
    return null;
  }
});

// Handle get save path
ipcMain.handle("get-save-path", () => {
  const savedPath = store.get("savePath", path.join(os.homedir(), "Videos"));
  console.log("Retrieved save path:", savedPath); // Debug log
  return savedPath;
});

// Handle save file
ipcMain.handle("save-file", async (event, buffer) => {
  try {
    const savePath = store.get("savePath", path.join(os.homedir(), "Videos"));
    console.log("Saving to path:", savePath); // Debug log

    // Create directory if it doesn't exist
    if (!fs.existsSync(savePath)) {
      fs.mkdirSync(savePath, { recursive: true });
    }

    const outputPath = path.join(savePath, `recording-${Date.now()}.mp4`);
    fs.writeFileSync(outputPath, Buffer.from(buffer));
    console.log("File saved successfully at:", outputPath); // Debug log
    return outputPath;
  } catch (error) {
    console.error("Error saving file:", error);
    return null;
  }
});

// Replace the menu template sending code with IPC handlers
ipcMain.on("show-menu", (event, menuId, x, y) => {
  let menuTemplate;

  if (menuId === "file") {
    menuTemplate = [
      {
        label: "Open Recordings Folder",
        click: () => {
          const recordingsPath = store.get(
            "savePath",
            path.join(os.homedir(), "Videos")
          );
          shell.openPath(recordingsPath);
        },
      },
      { type: "separator" },
      {
        label: "Reload",
        accelerator: "CmdOrCtrl+R",
        click: () => mainWindow.reload(),
      },
      { type: "separator" },
      {
        label: "Exit",
        accelerator: "Alt+F4",
        click: () => app.quit(),
      },
    ];
  } else if (menuId === "help") {
    menuTemplate = [
      {
        label: "Check for Updates",
        click: () => {
          autoUpdater.checkForUpdatesAndNotify();
        },
      },
      { type: "separator" },
      {
        label: "About Developer",
        click: () => {
          mainWindow.webContents.send("show-about-dialog");
        },
      },
    ];
  }

  if (menuTemplate) {
    const menu = Menu.buildFromTemplate(menuTemplate);
    menu.popup({ window: mainWindow, x, y });
  }
});

// Add region window creation function
function createRegionWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const displays = screen.getAllDisplays();
  let totalWidth = 0;
  let maxHeight = 0;

  // Calculate total width and maximum height of all displays
  displays.forEach(display => {
    totalWidth += display.bounds.width;
    maxHeight = Math.max(maxHeight, display.bounds.height);
  });

  regionWindow = new BrowserWindow({
    width: totalWidth,
    height: maxHeight,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreen: true,
    resizable: false, // Disable window resizing
    movable: false,  // Disable window moving
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    type: 'desktop', // This makes it appear above everything
  });

  // Prevent window resizing
  regionWindow.setMinimumSize(totalWidth, maxHeight);
  regionWindow.setMaximumSize(totalWidth, maxHeight);

  regionWindow.setIgnoreMouseEvents(false);
  regionWindow.setAlwaysOnTop(true, 'screen-saver'); // Highest level
  regionWindow.setVisibleOnAllWorkspaces(true);
  regionWindow.loadFile('src/region.html');

  regionWindow.on('closed', () => {
    regionWindow = null;
  });
}

// Add IPC handlers for region selection
ipcMain.on('show-region-selector', () => {
  if (!regionWindow) {
    createRegionWindow();
  }
});

ipcMain.on('region-selected', (event, region) => {
  mainWindow.webContents.send('region-selected', region);
  if (regionWindow) {
    regionWindow.close();
    regionWindow = null;
  }
});

ipcMain.on('cancel-region-selection', () => {
  if (regionWindow) {
    regionWindow.close();
    regionWindow = null;
  }
});

// Add display metrics handler
ipcMain.handle("get-display-metrics", () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  return {
    width: primaryDisplay.size.width,
    height: primaryDisplay.size.height
  };
});
