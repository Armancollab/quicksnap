const { ipcRenderer } = require("electron");
const Store = require("electron-store");
const { shell } = require("electron");
const { Menu } = require("electron");

const store = new Store();

// UI Elements
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");
const timer = document.getElementById("timer");
const notification = document.getElementById("notification");
const preview = document.getElementById("preview");
const countdownOverlay = document.getElementById("countdown-overlay");
const countdownNumber = document.querySelector(".countdown-number");
const decrementCountdown = document.getElementById("decrementCountdown");
const incrementCountdown = document.getElementById("incrementCountdown");
const countdownValue = document.getElementById("countdownValue");

// Settings Elements
const systemAudioToggle = document.getElementById("systemAudioToggle");
const microphoneToggle = document.getElementById("microphoneToggle");
const videoToggle = document.getElementById("videoToggle");
const navTabs = document.querySelectorAll(".nav-tab");
const recorderPanel = document.getElementById("recorder-panel");
const settingsPanel = document.getElementById("settings-panel");
const savePath = document.getElementById("savePath");
const choosePath = document.getElementById("choosePath");

// Additional UI Elements
const qualitySlider = document.getElementById("qualitySlider");
const qualityValue = document.getElementById("qualityValue");
const fpsSlider = document.getElementById("fpsSlider");
const fpsValue = document.getElementById("fpsValue");

// Add window control elements
const minimizeToTrayBtn = document.getElementById("minimize-to-tray");
const minimizeBtn = document.getElementById("minimize-window");
const maximizeBtn = document.getElementById("maximize-window");
const closeBtn = document.getElementById("close-window");

let mediaRecorder;
let recordedChunks = [];
let startTime;
let timerInterval;
let isPaused = false;
let stream;
let pauseTime = 0;
let totalPauseDuration = 0;
let countdownSeconds = 3; // Default countdown time

// Add at the top with other constants
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
const aboutDialog = document.getElementById("about-dialog");

// Add loading screen element
const loadingScreen = document.getElementById("loading-screen");

// Add recording mode elements
const recordingModeBtn = document.getElementById("recordingModeBtn");
const recordingModeText = document.getElementById("recordingModeText");
let recordingMode = null; // 'fullscreen' or 'window'

// Add region selection elements
// const regionSelectionOverlay = document.getElementById("region-selection-overlay");
// const regionSelectionBox = regionSelectionOverlay.querySelector(".region-selection-box");
// const regionSelectionSize = regionSelectionOverlay.querySelector(".region-selection-size");
let selectedRegion = null;
let isSelecting = false;
let startPoint = { x: 0, y: 0 };

// Add update progress handling
let updateProgressOverlay;

function createUpdateProgressOverlay() {
    updateProgressOverlay = document.createElement('div');
    updateProgressOverlay.className = 'update-progress-overlay';
    updateProgressOverlay.innerHTML = `
        <div class="update-progress-content">
            <div class="update-progress-spinner"></div>
            <div class="update-progress-text">
                <div>Installing update, please wait...</div>
                <div class="update-progress-percentage">0%</div>
            </div>
        </div>
    `;
    document.body.appendChild(updateProgressOverlay);
}

// Create the overlay when the app starts
document.addEventListener('DOMContentLoaded', () => {
    createUpdateProgressOverlay();
});

// Listen for update progress
ipcRenderer.on('update-progress', (event, percent) => {
    if (!updateProgressOverlay) {
        createUpdateProgressOverlay();
    }
    updateProgressOverlay.style.display = 'flex';
    const percentageElement = updateProgressOverlay.querySelector('.update-progress-percentage');
    if (percentageElement) {
        percentageElement.textContent = `${Math.round(percent)}%`;
    }
});

// Hide progress overlay when update is downloaded
ipcRenderer.on('update-downloaded', () => {
    if (updateProgressOverlay) {
        updateProgressOverlay.style.display = 'none';
    }
});

// Function to hide loading screen
function hideLoadingScreen() {
  loadingScreen.classList.add("fade-out");
  setTimeout(() => {
    loadingScreen.style.display = "none";
  }, 300); // Match the transition duration in CSS
}

// Initialize app
async function initializeApp() {
  try {
    await loadSettings();
    resetControls();
    // Hide loading screen after initialization
    hideLoadingScreen();
  } catch (error) {
    console.error("Error initializing app:", error);
    // Still hide loading screen even if there's an error
    hideLoadingScreen();
  }
}

// Start initialization when DOM is ready
document.addEventListener("DOMContentLoaded", initializeApp);

// Add theme change listener
prefersDark.addListener((e) => {
  handleThemeChange(e.matches);
});

// Function to handle theme changes
function handleThemeChange(isDark) {
  console.log(`Theme changed to ${isDark ? "dark" : "light"} mode`);
}

// Call once on initial load
handleThemeChange(prefersDark.matches);

// Load saved settings
async function loadSettings() {
  systemAudioToggle.checked = store.get("systemAudio", false);
  microphoneToggle.checked = store.get("microphone", true);
  videoToggle.checked = store.get("video", true);
  qualitySlider.value = store.get("quality", 80);
  fpsSlider.value = store.get("fps", 30);
  updateQualityLabel();
  updateFPSLabel();
  countdownSeconds = store.get("countdownSeconds", 3);
  updateCountdownValue();

  // Load and display save path
  const savedPath = await ipcRenderer.invoke("get-save-path");
  if (savedPath) {
    savePath.value = savedPath;
  }
}

// Save settings
function saveSettings() {
  store.set("systemAudio", systemAudioToggle.checked);
  store.set("microphone", microphoneToggle.checked);
  store.set("video", videoToggle.checked);
  store.set("quality", qualitySlider.value);
  store.set("fps", fpsSlider.value);
}

// Update quality label
function updateQualityLabel() {
  qualityValue.textContent = `${qualitySlider.value}%`;
}

// Update FPS label
function updateFPSLabel() {
  fpsValue.textContent = `${fpsSlider.value} FPS`;
}

// Show notification
function showNotification(message, type = "success") {
  const icon = type === "success" ? "&#xE73E;" : "&#xE783;";
  notification.innerHTML = `
    <span class="segoe-icon">${icon}</span>
    ${message}
  `;
  notification.className = `notification show ${type}`;
  setTimeout(() => {
    notification.className = "notification";
  }, 3000);
}

// Update timer
function updateTimer() {
  if (isPaused) return; // Don't update timer when paused

  const currentTime = Date.now();
  const elapsed = Math.floor(
    (currentTime - startTime - totalPauseDuration) / 1000
  );
  const minutes = Math.floor(elapsed / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (elapsed % 60).toString().padStart(2, "0");
  timer.textContent = `${minutes}:${seconds}`;
}

// Add recording mode functions
function toggleDropdown() {
    recordingModeBtn.parentElement.classList.toggle("active");
}

function closeDropdown() {
    recordingModeBtn.parentElement.classList.remove("active");
}

// Get audio stream (microphone only)
async function getAudioStream() {
    if (!microphoneToggle.checked) return null;

    try {
        const constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100,
            },
            video: false,
        };

        return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
        console.error("Error getting audio stream:", error);
        return null;
    }
}

// Remove old region selection elements and functions since we're using a separate window
function showRegionSelection() {
    ipcRenderer.send('show-region-selector');
}

// Add region selection handler
ipcRenderer.on('region-selected', (event, region) => {
    selectedRegion = region;
    updateRecordingModeInfo();
});

// Update getScreenStream function to handle region recording properly
async function getScreenStream() {
    try {
        if (recordingMode === "window" && !selectedSource) {
            showWindowSelectionDialog();
            return null;
        }

        if (recordingMode === "region" && !selectedRegion) {
            showRegionSelection();
            return null;
        }

        let sourceId;
        if (recordingMode === "fullscreen") {
            const sources = await ipcRenderer.invoke("get-sources");
            const screen = sources.find(
                (source) => source.name === "Entire Screen" || source.id.startsWith("screen:")
            );
            if (!screen) throw new Error("No screen source found");
            sourceId = screen.id;
        } else if (recordingMode === "window") {
            sourceId = selectedSource.id;
        } else {
            // For region mode, capture the entire screen
            const sources = await ipcRenderer.invoke("get-sources");
            const screen = sources.find(
                (source) => source.name === "Entire Screen" || source.id.startsWith("screen:")
            );
            if (!screen) throw new Error("No screen source found");
            sourceId = screen.id;
        }

        const constraints = {
            audio: systemAudioToggle.checked
                ? {
                    mandatory: {
                        chromeMediaSource: "desktop",
                    },
                    optional: [],
                }
                : false,
            video: {
                mandatory: {
                    chromeMediaSource: "desktop",
                    chromeMediaSourceId: sourceId,
                    maxFrameRate: parseInt(fpsSlider.value),
                },
            },
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        // Apply region cropping if in region mode
        if (recordingMode === "region" && selectedRegion) {
            const canvas = document.createElement("canvas");
            canvas.width = selectedRegion.width;
            canvas.height = selectedRegion.height;
            const ctx = canvas.getContext("2d");

            const videoTrack = stream.getVideoTracks()[0];
            const settings = videoTrack.getSettings();
            const videoElement = document.createElement("video");
            videoElement.srcObject = new MediaStream([videoTrack]);
            await videoElement.play();

            // Get display metrics from main process
            const displayMetrics = await ipcRenderer.invoke("get-display-metrics");

            // Calculate scaling factors
            const scaleX = settings.width / displayMetrics.width;
            const scaleY = settings.height / displayMetrics.height;

            // Scale the region coordinates
            const scaledRegion = {
                x: selectedRegion.x * scaleX,
                y: selectedRegion.y * scaleY,
                width: selectedRegion.width * scaleX,
                height: selectedRegion.height * scaleY
            };

            const cropStream = canvas.captureStream(parseInt(fpsSlider.value));
            const cropTrack = cropStream.getVideoTracks()[0];

            // Draw the cropped region to the canvas
            function drawCroppedFrame() {
                ctx.drawImage(
                    videoElement,
                    scaledRegion.x,
                    scaledRegion.y,
                    scaledRegion.width,
                    scaledRegion.height,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );
                requestAnimationFrame(drawCroppedFrame);
            }
            drawCroppedFrame();

            // Create a new stream with the cropped video and original audio
            const tracks = [
                cropTrack,
                ...(stream.getAudioTracks() || [])
            ];
            return new MediaStream(tracks);
        }

        return stream;
    } catch (error) {
        console.error("Error getting screen stream:", error);
        throw error;
    }
}

// Modify startRecording to check for recording mode
async function startRecording() {
    if (!recordingMode) {
        showNotification("Please select a recording mode first", "error");
        return;
    }

    try {
        let screenStream = null;
        let micStream = null;

        if (videoToggle.checked || systemAudioToggle.checked) {
            if (recordingMode === "window" && !selectedSource) {
                showWindowSelectionDialog();
                return;
            }
            screenStream = await getScreenStream();
            if (!screenStream) return;
        }

        if (microphoneToggle.checked) {
            micStream = await getAudioStream();
        }

        if (!screenStream && !micStream) {
            throw new Error("No media sources selected");
        }

        // Show countdown if enabled
        if (countdownSeconds > 0) {
            await showCountdown();
        }

        const tracks = [
            ...(screenStream ? screenStream.getTracks() : []),
            ...(micStream ? micStream.getTracks() : []),
        ];

        stream = new MediaStream(tracks);
        preview.srcObject = stream;

        // Calculate bitrate based on quality setting
        const qualityMultiplier = parseInt(qualitySlider.value) / 100;
        const videoBitsPerSecond = Math.floor(2500000 * qualityMultiplier);
        const audioBitsPerSecond = Math.floor(192000 * qualityMultiplier);

        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream, {
            videoBitsPerSecond,
            audioBitsPerSecond,
        });

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                recordedChunks.push(e.data);
            }
        };

        mediaRecorder.onstart = () => {
            ipcRenderer.send("recording-status-changed", true);
            closeWindowSelectionDialog();
        };

        mediaRecorder.onstop = async () => {
            ipcRenderer.send("recording-status-changed", false);
            const blob = new Blob(recordedChunks, {
                type: "video/mp4",
            });

            const buffer = Buffer.from(await blob.arrayBuffer());
            const filePath = await ipcRenderer.invoke("save-file", buffer);

            if (filePath) {
                store.set("lastRecordingPath", filePath);
                showNotification("Recording saved successfully!");
            }

            stream.getTracks().forEach((track) => track.stop());
            preview.srcObject = null;
            recordedChunks = [];
            resetControls();
        };

        // Request data every 100ms when paused to ensure we don't lose frames
        mediaRecorder.onpause = () => {
            console.log("MediaRecorder paused");
            mediaRecorder.requestData();
        };

        mediaRecorder.onresume = () => {
            console.log("MediaRecorder resumed");
        };

        // Start recording
        mediaRecorder.start(100); // Capture every 100ms for smoother pause/resume
        startTime = Date.now();
        pauseTime = 0;
        totalPauseDuration = 0; // Reset total pause duration
        timerInterval = setInterval(updateTimer, 1000);

        startBtn.disabled = true;
        pauseBtn.disabled = false;
        stopBtn.disabled = false;
        showNotification("Recording started");
    } catch (error) {
        console.error("Error starting recording:", error);
        showNotification(`Error starting recording: ${error.message}`, "error");
        resetControls();
    }
}

// Pause/Resume recording
function togglePause() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;

  try {
    if (isPaused) {
      // Resume recording
      mediaRecorder.resume();
      const pauseDuration = Date.now() - pauseTime;
      totalPauseDuration += pauseDuration;
      pauseBtn.innerHTML = '<span class="segoe-icon">&#xE769;</span>Pause';
      showNotification("Recording resumed");
      timerInterval = setInterval(updateTimer, 1000);
      ipcRenderer.send("recording-status-changed", true);
    } else {
      // Pause recording
      mediaRecorder.pause();
      pauseTime = Date.now();
      mediaRecorder.requestData();
      pauseBtn.innerHTML = '<span class="segoe-icon">&#xE768;</span>Resume';
      showNotification("Recording paused");
      clearInterval(timerInterval);
      ipcRenderer.send("recording-status-changed", false);
    }
    isPaused = !isPaused;
  } catch (error) {
    console.error("Error toggling pause:", error);
    showNotification("Error toggling pause/resume", "error");
  }
}

// Stop recording
function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.requestData(); // Request any pending data before stopping
    mediaRecorder.stop();
    clearInterval(timerInterval);
    resetControls();
    showNotification("Recording stopped");
  }
}

// Reset controls
function resetControls() {
  timer.textContent = "00:00";
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  stopBtn.disabled = true;
  pauseBtn.innerHTML = '<span class="segoe-icon">&#xE769;</span>Pause';
  isPaused = false;
  pauseTime = 0;
  totalPauseDuration = 0;
  selectedSource = null;
  selectedRegion = null;
  recordingMode = null;
  updateRecordingModeInfo();
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// Choose save path
async function chooseSavePath() {
  const path = await ipcRenderer.invoke("choose-save-path");
  if (path) {
    savePath.value = path;
    store.set("savePath", path); // Ensure path is saved in store
    console.log("Updated save path:", path); // Debug log
    showNotification("Save location updated!");
  }
}

// Handle tab switching
function switchTab(event) {
  const tab = event.target.closest(".nav-tab");
  if (!tab) return;

  const tabName = tab.dataset.tab;
  navTabs.forEach((t) => t.classList.remove("active"));
  tab.classList.add("active");

  if (tabName === "recorder") {
    recorderPanel.style.display = "block";
    settingsPanel.style.display = "none";
  } else {
    recorderPanel.style.display = "none";
    settingsPanel.style.display = "block";
  }
}

// Event listeners
startBtn.addEventListener("click", startRecording);
pauseBtn.addEventListener("click", togglePause);
stopBtn.addEventListener("click", stopRecording);
systemAudioToggle.addEventListener("change", saveSettings);
microphoneToggle.addEventListener("change", saveSettings);
videoToggle.addEventListener("change", saveSettings);
choosePath.addEventListener("click", chooseSavePath);
document.querySelector(".nav-tabs").addEventListener("click", switchTab);

// Additional event listeners for quality controls
qualitySlider.addEventListener("input", updateQualityLabel);
qualitySlider.addEventListener("change", saveSettings);
fpsSlider.addEventListener("input", updateFPSLabel);
fpsSlider.addEventListener("change", saveSettings);

function showAboutDialog() {
  aboutDialog.classList.add("show");
}

function closeAboutDialog() {
  aboutDialog.classList.remove("show");
}

function openGitHub() {
  shell.openExternal("https://github.com/Armancollab");
}

// Add click event listener to close dialog when clicking outside
aboutDialog.addEventListener("click", (e) => {
  if (e.target === aboutDialog) {
    closeAboutDialog();
  }
});

// Listen for about-dialog message from main process
ipcRenderer.on("show-about-dialog", () => {
  showAboutDialog();
});

// Add countdown control functions
function updateCountdownValue() {
  countdownValue.textContent = `${countdownSeconds}s`;
  store.set("countdownSeconds", countdownSeconds);
}

function incrementCountdownTime() {
  if (countdownSeconds < 10) {
    countdownSeconds++;
    updateCountdownValue();
  }
}

function decrementCountdownTime() {
  if (countdownSeconds > 0) {
    countdownSeconds--;
    updateCountdownValue();
  }
}

// Add countdown event listeners
decrementCountdown.addEventListener("click", decrementCountdownTime);
incrementCountdown.addEventListener("click", incrementCountdownTime);

// Add countdown function
function showCountdown() {
  return new Promise((resolve) => {
    let count = countdownSeconds;
    countdownOverlay.classList.add("show");
    countdownNumber.textContent = count;

    const countdownInterval = setInterval(() => {
      count--;
      if (count > 0) {
        countdownNumber.textContent = count;
      } else {
        clearInterval(countdownInterval);
        countdownOverlay.classList.remove("show");
        resolve();
      }
    }, 1000);
  });
}

// Add quick action to open last recording
async function openLastRecording() {
  const success = await ipcRenderer.invoke("open-last-recording");
  if (!success) {
    showNotification("No recent recording found", "error");
  }
}

// Add keyboard shortcuts
document.addEventListener("keydown", (e) => {
  // Don't handle shortcuts when typing in an input
  if (e.target.tagName === "INPUT") return;

  // Ctrl/Cmd + R to start/stop recording
  if ((e.ctrlKey || e.metaKey) && e.key === "r") {
    e.preventDefault();
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      startBtn.click();
    } else {
      stopBtn.click();
    }
  }

  // Space to pause/resume
  if (
    e.code === "Space" &&
    mediaRecorder &&
    mediaRecorder.state !== "inactive"
  ) {
    e.preventDefault();
    pauseBtn.click();
  }

  // Escape to stop recording
  if (
    e.code === "Escape" &&
    mediaRecorder &&
    mediaRecorder.state !== "inactive"
  ) {
    e.preventDefault();
    stopBtn.click();
  }

  // Ctrl/Cmd + O to open last recording
  if ((e.ctrlKey || e.metaKey) && e.key === "o") {
    e.preventDefault();
    openLastRecording();
  }
});

// Add window control event listeners
minimizeToTrayBtn.addEventListener("click", () => {
  ipcRenderer.send("minimize-to-tray");
});

minimizeBtn.addEventListener("click", () => {
  ipcRenderer.send("minimize-window");
});

maximizeBtn.addEventListener("click", () => {
  ipcRenderer.send("maximize-window");
});

closeBtn.addEventListener("click", () => {
  ipcRenderer.send("close-window");
});

// Handle force stop recording
ipcRenderer.on("force-stop-recording", () => {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    stopRecording();
  }
});

// Update maximize button icon when window state changes
ipcRenderer.on("window-maximized", (event, isMaximized) => {
  document.body.classList.toggle("window-maximized", isMaximized);
  maximizeBtn.querySelector(".segoe-icon").innerHTML = isMaximized
    ? "&#xE923;"
    : "&#xE922;";
});

// Remove the old menu handling code
function handleMenuClick(menuId, event) {
  const rect = event.target.getBoundingClientRect();
  ipcRenderer.send(
    "show-menu",
    menuId,
    Math.round(rect.left),
    Math.round(rect.bottom)
  );
}

const windowSelectionDialog = document.getElementById("window-selection-dialog");
const windowList = document.getElementById("window-list");
let selectedSource = null;

// Add window selection functions
function showWindowSelectionDialog() {
  windowSelectionDialog.classList.add("show");
  populateWindowList();
}

function closeWindowSelectionDialog() {
  windowSelectionDialog.classList.remove("show");
  updateRecordingModeInfo();
}

async function populateWindowList() {
  try {
    const sources = await ipcRenderer.invoke("get-sources");
    windowList.innerHTML = "";

    // Filter out screen sources and sort by name
    const windowSources = sources
      .filter(source => !source.id.startsWith("screen:") && source.name !== "Entire Screen")
      .sort((a, b) => a.name.localeCompare(b.name));

    windowSources.forEach((source) => {
      const windowItem = document.createElement("div");
      windowItem.className = "window-item";
      windowItem.dataset.sourceId = source.id;

      const thumbnail = document.createElement("img");
      thumbnail.className = "window-thumbnail";
      thumbnail.src = source.thumbnail.toDataURL();

      const title = document.createElement("div");
      title.className = "window-title";
      title.textContent = source.name;

      windowItem.appendChild(thumbnail);
      windowItem.appendChild(title);

      windowItem.addEventListener("click", () => {
        document.querySelectorAll(".window-item").forEach(item => item.classList.remove("selected"));
        windowItem.classList.add("selected");
        selectedSource = source;
        closeWindowSelectionDialog();
      });

      windowList.appendChild(windowItem);
    });

    if (windowSources.length === 0) {
      const noWindows = document.createElement("div");
      noWindows.className = "no-windows";
      noWindows.textContent = "No windows available for recording";
      windowList.appendChild(noWindows);
    }
  } catch (error) {
    console.error("Error populating window list:", error);
    showNotification("Error loading windows", "error");
  }
}

// Add window selection dialog event listeners
windowSelectionDialog.addEventListener("click", (e) => {
  if (e.target === windowSelectionDialog) {
    closeWindowSelectionDialog();
  }
});

// Add event listeners for recording mode
recordingModeBtn.addEventListener("click", toggleDropdown);

document.addEventListener("click", (e) => {
    if (!recordingModeBtn.parentElement.contains(e.target)) {
        closeDropdown();
    }
});

document.querySelectorAll(".dropdown-item").forEach((item) => {
    item.addEventListener("click", () => {
        recordingMode = item.dataset.mode;
        closeDropdown();
        
        if (recordingMode === "window") {
            showWindowSelectionDialog();
        } else if (recordingMode === "region") {
            showRegionSelection();
        }
        
        updateRecordingModeInfo();
    });
});

// Add back the updateRecordingModeInfo function
function updateRecordingModeInfo() {
    if (!recordingMode) {
        recordingModeText.textContent = "Select recording mode";
        recordingModeBtn.innerHTML = `
            <span class="segoe-icon">&#xE7C4;</span>
            Choose Recording Screen
            <span class="segoe-icon dropdown-arrow">&#xE70D;</span>
        `;
        return;
    }

    if (recordingMode === "fullscreen") {
        recordingModeText.textContent = "Full Screen";
        recordingModeBtn.innerHTML = `
            <span class="segoe-icon">&#xE740;</span>
            Full Screen
            <span class="segoe-icon dropdown-arrow">&#xE70D;</span>
        `;
    } else if (recordingMode === "window" && selectedSource) {
        recordingModeText.textContent = `Window: ${selectedSource.name}`;
        recordingModeBtn.innerHTML = `
            <span class="segoe-icon">&#xE714;</span>
            ${selectedSource.name}
            <span class="segoe-icon dropdown-arrow">&#xE70D;</span>
        `;
    } else if (recordingMode === "region" && selectedRegion) {
        recordingModeText.textContent = `Region: ${selectedRegion.width}×${selectedRegion.height}`;
        recordingModeBtn.innerHTML = `
            <span class="segoe-icon">&#xE7C8;</span>
            Selected Region
            <span class="segoe-icon dropdown-arrow">&#xE70D;</span>
        `;
    } else {
        recordingModeText.textContent = recordingMode === "region" ? "Select a region" : "Specific Window";
        recordingModeBtn.innerHTML = `
            <span class="segoe-icon">${recordingMode === "region" ? "&#xE7C8;" : "&#xE714;"}</span>
            ${recordingMode === "region" ? "Select Region" : "Specific Window"}
            <span class="segoe-icon dropdown-arrow">&#xE70D;</span>
        `;
    }
}
