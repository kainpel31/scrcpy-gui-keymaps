import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import Sidebar from "./components/Sidebar";
import ControlPanel from "./components/ControlPanel";
import LogPanel from "./components/LogPanel";
import Header from "./components/Header";
import SessionBehavior from "./components/SessionBehavior";
import ShortcutsPanel from "./components/ShortcutsPanel";
import Footer from "./components/Footer";
import ErrorBoundary from "./components/ErrorBoundary";
import OnboardingModal from "./components/OnboardingModal";
import ThemedModal from "./components/ThemedModal";
import { useScrcpy } from "./hooks/useScrcpy";
import { getVersion } from "@tauri-apps/api/app";
import { useI18n } from "./i18n";

interface ScrcpyWindowRect {
  found: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

function App() {
  const { t } = useI18n();
  const {
    devices,
    deviceModels,
    deviceFriendlyNames,
    logs,
    activeDevice,
    setActiveDevice,
    refreshDevices,
    refreshDevicesUntilSettled,
    runScrcpy,
    stopScrcpy,
    downloadScrcpy,
    checkScrcpy,
    scrcpyStatus,
    setLogs,
    isDownloading,
    downloadProgress,
    pairDevice,
    connectDevice,
    listScrcpyOptions,
    runTerminalCommand,
    runningDevices,
    isRefreshing,
    sessionRunning,
    clearLogs,
    detectedCameras,
    renderDriverSupport,
    mdnsDevices,
    config,
    setConfig,
    theme,
    setTheme,
    colorMode,
    setColorMode,
    pushFile,
    installApk,
    historyDevices,
    clearHistory,
    isOnboardingOpen,
    setIsOnboardingOpen,
    completeOnboarding,
  } = useScrcpy();

  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    kind: "warning" | "error" | "info" | "success";
    actionLabel?: string;
    onAction?: () => void;
    showCancel?: boolean;
    cancelLabel?: string;
    onCancel?: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    kind: "info",
  });

  const [appVersion, setAppVersion] = useState("3.3.0");
  const [lastCheckedPath, setLastCheckedPath] = useState<string | undefined>(undefined);
  const [hasCheckedUpdate, setHasCheckedUpdate] = useState(false);

  const handleOpenScrcpyOverlay = async () => {
    try {
      const rect = await invoke<ScrcpyWindowRect>("get_scrcpy_window_rect", {
        serial: activeDevice ?? null,
      });

      const label = "scrcpy-keymap-overlay";
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        await existing.close();
      }

      const querySerial = activeDevice ? `&serial=${encodeURIComponent(activeDevice)}` : "";
      const overlayWin = new WebviewWindow(label, {
        url: `index.html?overlay=1${querySerial}`,
        title: "scrcpy Keymap Overlay",
        x: rect.found ? rect.x : 120,
        y: rect.found ? rect.y : 120,
        width: rect.found ? rect.width : 1100,
        height: rect.found ? rect.height : 650,
        decorations: false,
        alwaysOnTop: true,
        transparent: true,
        skipTaskbar: true,
        resizable: true,
      });

      overlayWin.once("tauri://error", (err) => {
        console.error("Failed to create overlay window:", err);
      });
    } catch (e) {
      console.error("Failed to open scrcpy overlay:", e);
    }
  };

  const showAlert = (
    title: string,
    message: string,
    kind: "warning" | "error" | "info" | "success" = "info",
    actionLabel = "OK",
    onAction?: () => void,
    showCancel = false,
    cancelLabel = "Cancel",
    onCancel?: () => void
  ) => {
    setAlertState({
      isOpen: true,
      title,
      message,
      kind,
      actionLabel,
      onAction,
      showCancel,
      cancelLabel,
      onCancel,
    });
  };

  useEffect(() => {
    const initApp = async () => {
      try {
        const v = await getVersion();
        setAppVersion(v);

        await invoke("close_splashscreen");
      } catch (e) {
        console.error("Initialization failed:", e);
      }
    };

    const timer = setTimeout(initApp, 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    checkScrcpy(config.scrcpyPath);
    refreshDevicesUntilSettled(config.scrcpyPath);
  }, []);

  useEffect(() => {
    if (
      scrcpyStatus.found &&
      (!hasCheckedUpdate || config.scrcpyPath !== lastCheckedPath) &&
      !isDownloading
    ) {
      setHasCheckedUpdate(true);
      setLastCheckedPath(config.scrcpyPath);

      const runCheck = async () => {
        try {
          const updateRes: any = await invoke("check_scrcpy_update", {
            customPath: config.scrcpyPath,
          });
          if (updateRes && updateRes.update_available) {
            showAlert(
              t("alerts.updateAvailableTitle"),
              t("alerts.updateAvailableMessage", {
                local: updateRes.local_version || "unknown",
                latest: updateRes.latest_version || "unknown",
              }),
              "info",
              t("alerts.updateBtn"),
              async () => {
                if (config.scrcpyPath) {
                  setConfig((prev) => ({ ...prev, scrcpyPath: undefined }));
                }
                await downloadScrcpy();
              },
              true,
              t("alerts.cancelBtn")
            );
          }
        } catch (e) {
          console.error("Failed to check for scrcpy updates:", e);
        }
      };
      runCheck();
    } else if (!scrcpyStatus.found) {
      setHasCheckedUpdate(false);
    }
  }, [
    scrcpyStatus.found,
    config.scrcpyPath,
    isDownloading,
    hasCheckedUpdate,
    lastCheckedPath,
    t,
  ]);

  useEffect(() => {
    const unlisten = getCurrentWindow().listen<{ paths: string[] }>(
      "tauri://drag-drop",
      (event) => {
        if (!activeDevice) {
          setLogs((prev) => [
            ...prev.slice(-100),
            t("logs.noDeviceForDragDrop"),
          ]);
          return;
        }

        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
          paths.forEach((path) => handleFileOperation(path));
        }
      }
    );

    return () => {
      unlisten.then((f) => f());
    };
  }, [activeDevice]);

  useEffect(() => {
    const device =
      activeDevice && runningDevices.includes(activeDevice) ? activeDevice : null;
    (async () => {
      await invoke("set_active_device", { device });
    })();
  }, [activeDevice, runningDevices]);

  useEffect(() => {
    if (activeDevice) {
      setConfig((prev) => ({ ...prev, device: activeDevice }));
    }
  }, [activeDevice]);

  const handleStart = async () => {
    if (!activeDevice) {
      showAlert(
        t("alerts.noDeviceSelectedTitle"),
        t("alerts.noDeviceSelectedMessage"),
        "warning"
      );
      return;
    }
    await runScrcpy(config);
  };

  const handleStop = async () => {
    if (!activeDevice) return;
    await stopScrcpy(activeDevice);
  };

  const handleRefresh = () => {
    refreshDevices();
  };

  const handleKillAdb = async () => {
    try {
      await invoke("kill_adb", { customPath: config.scrcpyPath });
      refreshDevices(config.scrcpyPath);
    } catch (e) {
      console.error(e);
    }
  };

  const handleFileOperation = async (path: string) => {
    if (!activeDevice) return;

    const isApk = path.toLowerCase().endsWith(".apk");
    if (isApk) {
      await installApk(activeDevice, path);
    } else {
      await pushFile(activeDevice, path);
    }
  };

  const handleFileBrowse = async () => {
    if (!activeDevice) return;
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "All Files",
            extensions: ["*"],
          },
          {
            name: "Android App (APK)",
            extensions: ["apk"],
          },
        ],
      });

      if (selected) {
        if (Array.isArray(selected)) {
          selected.forEach((path) => handleFileOperation(path));
        } else {
          handleFileOperation(selected);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSetPath = async () => {
    try {
      let startPath = config.scrcpyPath;
      if (!startPath) {
        startPath = await invoke<string>("get_scrcpy_bin_dir").catch(() => "");
      }
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: startPath || undefined,
      });
      if (selected && typeof selected === "string") {
        setConfig((prev) => ({ ...prev, scrcpyPath: selected }));
        setLogs((prev) => [
          ...prev.slice(-100),
          t("logs.customScrcpyPathSet", { path: selected }),
        ]);
        setTimeout(() => checkScrcpy(selected), 100);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleResetPath = async () => {
    setConfig((prev) => ({ ...prev, scrcpyPath: undefined }));
    setLogs((prev) => [
      ...prev.slice(-100),
      t("logs.customScrcpyPathCleared"),
    ]);
    setTimeout(() => checkScrcpy(undefined), 100);
  };

  return (
    <ErrorBoundary>
      <div
        className="min-h-screen font-sans selection:bg-primary selection:text-on-primary overflow-hidden flex flex-col transition-opacity duration-1000 ease-in-out"
        style={{
          backgroundColor: "var(--bg-base)",
          color: "var(--text-base)",
          opacity: 0,
          animation: "fadeIn 0.8s ease-out forwards",
        }}
      >
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(5px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
        <div className="fixed inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none z-0"></div>
        <div className="fixed top-[-50%] left-[-50%] w-[200%] h-[200%] bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-primary/30 via-transparent to-transparent pointer-events-none z-0"></div>

        <div className="relative z-10 flex flex-col h-screen transition-all duration-700">
          <Header
            onThemeChange={setTheme}
            currentTheme={theme}
            colorMode={colorMode}
            onColorModeChange={setColorMode}
            binaryStatus={scrcpyStatus}
            onDownload={downloadScrcpy}
            onSetPath={handleSetPath}
            onResetPath={handleResetPath}
            isDownloading={isDownloading}
            downloadProgress={downloadProgress}
            version={appVersion}
          />

          <div className="flex-1 overflow-y-auto flex flex-col pt-6 custom-scrollbar">
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 px-6 pb-6">
              <div className="lg:col-span-3 flex flex-col">
                <div className="transition-all duration-700">
                  <Sidebar
                    devices={devices}
                    deviceModels={deviceModels}
                    deviceFriendlyNames={deviceFriendlyNames}
                    runningDevices={runningDevices}
                    onRefresh={handleRefresh}
                    onKillAdb={handleKillAdb}
                    selectedDevice={activeDevice}
                    onSelectDevice={setActiveDevice}
                    onPair={pairDevice}
                    onConnect={connectDevice}
                    isRefreshing={isRefreshing}
                    onFilePush={handleFileBrowse}
                    historyDevices={historyDevices}
                    clearHistory={clearHistory}
                    mdnsDevices={mdnsDevices}
                  />
                </div>
              </div>

              <div className="lg:col-span-6 flex flex-col gap-6 relative z-20">
                <div className="relative z-30 space-y-2">
                  <ControlPanel
                    config={config}
                    setConfig={setConfig}
                    onStart={handleStart}
                    onStop={handleStop}
                    isRunning={sessionRunning}
                    detectedCameras={detectedCameras}
                    renderDriverSupport={renderDriverSupport}
                    onListOptions={(arg) => {
                      if (activeDevice) {
                        listScrcpyOptions(activeDevice, arg);
                      }
                    }}
                  />
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => void handleOpenScrcpyOverlay()}
                      className="px-3.5 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold shadow hover:opacity-90 transition"
                    >
                      Launch Overlay on scrcpy Window
                    </button>
                  </div>
                </div>
                <div className="relative z-10">
                  <LogPanel
                    logs={logs}
                    onClear={clearLogs}
                    onAddLog={(msg) =>
                      setLogs((prev: string[]) => [...prev.slice(-100), msg])
                    }
                    onRunCommand={runTerminalCommand}
                  />
                </div>
              </div>

              <div className="lg:col-span-3 flex flex-col gap-6">
                <SessionBehavior config={config} setConfig={setConfig} />
                <ShortcutsPanel />
              </div>
            </div>

            <Footer version={appVersion} />
          </div>
        </div>

        <OnboardingModal
          isOpen={isOnboardingOpen}
          onClose={() => setIsOnboardingOpen(false)}
          binaryStatus={scrcpyStatus}
          onDownload={downloadScrcpy}
          isDownloading={isDownloading}
          downloadProgress={downloadProgress}
          onComplete={completeOnboarding}
        />

        <ThemedModal
          isOpen={alertState.isOpen}
          onClose={() => setAlertState((prev) => ({ ...prev, isOpen: false }))}
          title={alertState.title}
          message={alertState.message}
          kind={alertState.kind}
          actionLabel={alertState.actionLabel}
          onAction={alertState.onAction}
          showCancel={alertState.showCancel}
          cancelLabel={alertState.cancelLabel}
          onCancel={alertState.onCancel}
        />
      </div>
    </ErrorBoundary>
  );
}

export default App;
