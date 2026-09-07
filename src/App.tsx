import { useState, useEffect, useRef, useCallback } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { register, unregister, isRegistered } from "@tauri-apps/plugin-global-shortcut";
import { Store } from "@tauri-apps/plugin-store";
import { HeaderBar } from "./components/HeaderBar";
import { SnippingArea } from "./components/SnippingArea";
import { ResultPanel } from "./components/ResultPanel";
import { StatusToast } from "./components/StatusToast";
import { SettingsModal } from "./components/SettingsModal";
import { HistoryModal } from "./components/HistoryModal";
import { cropImageToBase64, createThumbnail } from "./lib/image";
import { scanQrCode } from "./lib/qr";
import { useTheme } from "./hooks/useTheme";
import { useTranslation } from "./hooks/useTranslation";
import { sounds } from "./lib/soundEffects";
import type { CaptureResponse, OcrResponse, OcrWord, Rect, ToastState, MonitorInfo, HistoryItem } from "./types";

export default function App() {
  const [theme, setTheme] = useTheme();
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [selectedMonitor, setSelectedMonitor] = useState<number | null>(null);
  
  const [currentShortcut, setCurrentShortcut] = useState("Control+Shift+F9");
  const [ocrLanguages, setOcrLanguages] = useState("tur+eng");
  const { t, lang: appLang } = useTranslation();

  const [captureImage, setCaptureImage] = useState<string | null>(null);
  const [selections, setSelections] = useState<Rect[]>([]);
  const [ocrText, setOcrText] = useState("");
  const [ocrEngine, setOcrEngine] = useState("");
  const [ocrWords, setOcrWords] = useState<OcrWord[]>([]);
  const [qrResult, setQrResult] = useState<string | null>(null);
  const [lastError, setLastError] = useState("");
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureDelay, setCaptureDelay] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [toast, setToast] = useState<ToastState>({ kind: "hidden", message: "" });
  
  const [isSnippingMode, setIsSnippingMode] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [autoCopy, setAutoCopy] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [lastCapturePath, setLastCapturePath] = useState<string | null>(null);
  const [imgDisplaySize, setImgDisplaySize] = useState<{ w: number; h: number } | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const storeRef = useRef<Store | null>(null);

  // Initialize App Settings
  useEffect(() => {
    const initSettings = async () => {
        try {
            const store = await Store.load("settings.json");
            storeRef.current = store;
            
            try {
                const ver = await getVersion();
                setAppVersion(ver);
            } catch {}
            const setupDone = await store.get<boolean>("setup-done");

            // Load Monitors
            try {
               const mons = await invoke<MonitorInfo[]>("get_monitors");
               setMonitors(mons);
            } catch {}

            if (!setupDone) {
                try {
                    const auto = await isEnabled();
                    if (!auto) await enable();
                } catch {}
                await store.set("minimize-to-tray", true);
                await store.set("setup-done", true);
                await store.save();
            } else {
                const savedShortcut = await store.get<string>("global-shortcut");
                if (savedShortcut) setCurrentShortcut(savedShortcut);

                const savedLangs = await store.get<string>("ocr-languages");
                if (savedLangs) setOcrLanguages(savedLangs);
                
                const savedHistory = await store.get<HistoryItem[]>("history");
                if (savedHistory) setHistory(savedHistory);

                const savedAutoCopy = await store.get<boolean>("auto-copy");
                if (savedAutoCopy !== undefined) setAutoCopy(savedAutoCopy);

                const savedAlwaysOnTop = await store.get<boolean>("always-on-top");
                if (savedAlwaysOnTop !== undefined) {
                    setAlwaysOnTop(savedAlwaysOnTop);
                    getCurrentWindow().setAlwaysOnTop(savedAlwaysOnTop).catch(() => {});
                }

                try {
                    const savedW = await store.get<number>("window-width");
                    const savedH = await store.get<number>("window-height");
                    const savedX = await store.get<number>("window-x");
                    const savedY = await store.get<number>("window-y");
                    const appWindow = getCurrentWindow();
                    if (savedW && savedH && savedW > 200 && savedH > 100) {
                        await appWindow.setSize(new PhysicalSize(savedW, savedH));
                    }
                    if (savedX !== null && savedY !== null && savedX !== undefined && savedY !== undefined) {
                        await appWindow.setPosition(new PhysicalPosition(savedX, savedY));
                    }
                } catch {}
            }
        } catch {}
    };
    initSettings();
  }, []);

  const showToast = useCallback((kind: "success" | "error" | "info", message: string, duration = 3000) => {
    setToast({ kind, message });
    setTimeout(() => setToast({ kind: "hidden", message: "" }), duration);
  }, []);

  const handleOcr = useCallback(async (rects: Rect[], overrideImagePath?: string) => {
    const targetPath = overrideImagePath || lastCapturePath;
    if (!captureImage && !overrideImagePath) return;
    if (ocrBusy) return;
    setOcrBusy(true);
    setLastError("");
    try {
      let resp: OcrResponse;

      if (rects.length > 0 && captureImage) {
        // Selection exists: crop in the browser (display coords → canvas → base64)
        // Pass display dims so letterbox offset/scale is correctly applied
        const croppedBase64 = await cropImageToBase64(
          captureImage, 
          rects[0], 
          undefined,
          imgDisplaySize?.w,
          imgDisplaySize?.h
        );
        resp = await invoke<OcrResponse>("run_ocr", {
          input: {
            imageBase64: croppedBase64.split(",")[1],
            languages: ocrLanguages,
          }
        });

        const qr = await scanQrCode(croppedBase64);
        setQrResult(qr);

        const newItem: HistoryItem = {
          id: crypto.randomUUID(),
          imageBase64: await createThumbnail(croppedBase64),
          text: resp.text,
          date: new Date().toISOString(),
        };
        setHistory(prev => {
          const newHistory = [newItem, ...prev].slice(0, 50);
          if (storeRef.current) {
            storeRef.current.set("history", newHistory).then(() => storeRef.current?.save());
          }
          return newHistory;
        });
      } else {
        // No selection: run OCR on full image using file path if available
        const input: Record<string, unknown> = { languages: ocrLanguages };
        if (targetPath) {
          input.imagePath = targetPath;
        } else if (captureImage) {
          input.imageBase64 = captureImage.startsWith("data:")
            ? captureImage.split(",")[1]
            : captureImage;
        }
        resp = await invoke<OcrResponse>("run_ocr", { input });
        setQrResult(null);

        const thumbSource = captureImage || (targetPath ? convertFileSrc(targetPath) : "");
        if (thumbSource) {
          const newItem: HistoryItem = {
            id: crypto.randomUUID(),
            imageBase64: await createThumbnail(thumbSource),
            text: resp.text,
            date: new Date().toISOString(),
          };
          setHistory(prev => {
            const newHistory = [newItem, ...prev].slice(0, 50);
            if (storeRef.current) {
              storeRef.current.set("history", newHistory).then(() => storeRef.current?.save());
            }
            return newHistory;
          });
        }
      }

      setOcrText(resp.text);
      setOcrEngine(resp.engine);
      setOcrWords(resp.words);

      if (autoCopy && resp.text) {
        try {
          await invoke("copy_to_clipboard", { text: resp.text });
        } catch {
          try {
            await navigator.clipboard.writeText(resp.text);
          } catch {}
        }
        showToast("success", "toastTextCopied");
      }
    } catch (e) {
      setLastError(String(e));
      showToast("error", "toastOcrError");
    } finally {
      setOcrBusy(false);
    }
  }, [autoCopy, captureImage, lastCapturePath, imgDisplaySize, ocrBusy, ocrLanguages, showToast]);

  const handleCancelCountdown = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdown(null);
    setCaptureBusy(false);
  }, []);

  useEffect(() => {
    if (countdown === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCancelCountdown();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [countdown, handleCancelCountdown]);

  const executeCapture = useCallback(async (mode: "area" | "fullscreen" = "area") => {
    setCaptureBusy(true);
    setQrResult(null);
    setLastError("");
    try {
      const appWindow = getCurrentWindow();
      // Hide the window so it is not in the screenshot
      await appWindow.hide();
      await new Promise((resolve) => setTimeout(resolve, 180));

      const resp = await invoke<CaptureResponse>("capture_screen", { monitorId: selectedMonitor });
      
      // Restore window
      await appWindow.show();
      await appWindow.unminimize();
      await appWindow.setFocus();

      setLastCapturePath(resp.imagePath);
      // Append timestamp to bypass browser cache for identical paths
      const imgSrc = convertFileSrc(resp.imagePath) + `?t=${Date.now()}`;
      setCaptureImage(imgSrc);
      setIsSnippingMode(true);
      setSelections([]);
      setOcrText("");
      setOcrWords([]);
      showToast("success", "toastCaptured");

      if (mode === "fullscreen") {
        // Run full OCR directly
        setTimeout(() => {
          handleOcr([], resp.imagePath);
        }, 50);
      }
    } catch (e) {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.show();
        await appWindow.unminimize();
        await appWindow.setFocus();
      } catch {}
      setLastError(String(e));
      showToast("error", "toastOcrError");
    } finally {
      setCaptureBusy(false);
    }
  }, [selectedMonitor, showToast, handleOcr]);

  const handleNewCapture = useCallback(async (mode: "area" | "fullscreen" = "area") => {
    if (captureBusy) return;

    if (captureDelay > 0) {
      setCaptureBusy(true);
      setCountdown(captureDelay);
      sounds.playTick();
      let remaining = captureDelay;

      countdownTimerRef.current = setInterval(async () => {
        remaining -= 1;
        if (remaining > 0) {
          setCountdown(remaining);
          sounds.playTick();
        } else {
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          setCountdown(null);
          sounds.playShutter();
          await executeCapture(mode);
        }
      }, 1000);
      return;
    }

    await executeCapture(mode);
  }, [captureBusy, captureDelay, executeCapture]);

  const handleClipboardOcr = useCallback(async () => {
    if (ocrBusy) return;
    setOcrBusy(true);
    setLastError("");
    setLastCapturePath(null); // Clear path as it is from memory
    try {
      const imageBase64 = await invoke<string>("read_clipboard_image");
      if (!imageBase64) {
        showToast("error", "toastClipboardEmpty");
        return;
      }

      const resp = await invoke<OcrResponse>("run_ocr", { 
        input: {
          imageBase64, 
          languages: ocrLanguages 
        }
      });

      setOcrText(resp.text);
      setOcrEngine(resp.engine);
      setOcrWords(resp.words);
      setCaptureImage(`data:image/png;base64,${imageBase64}`);
      setIsSnippingMode(true);
      setSelections([]);
      setQrResult(null);

      if (autoCopy && resp.text) {
        try {
          await invoke("copy_to_clipboard", { text: resp.text });
        } catch {
          try {
            await navigator.clipboard.writeText(resp.text);
          } catch {}
        }
        showToast("success", "toastTextCopied");
      }

      const newItem: HistoryItem = {
        id: crypto.randomUUID(),
        imageBase64: await createThumbnail(`data:image/png;base64,${imageBase64}`),
        text: resp.text,
        date: new Date().toISOString(),
      };
      
      setHistory(prev => {
        const newHistory = [newItem, ...prev].slice(0, 50);
        if (storeRef.current) {
          storeRef.current.set("history", newHistory).then(() => storeRef.current?.save());
        }
        return newHistory;
      });
    } catch (e) {
      setLastError(String(e));
      showToast("error", "toastOcrError");
    } finally {
      setOcrBusy(false);
    }
  }, [autoCopy, ocrBusy, ocrLanguages, showToast]);

  // Shortcut Management
  useEffect(() => {
    const setupShortcuts = async () => {
      try {
        const registered = await isRegistered(currentShortcut);
        if (registered) await unregister(currentShortcut);
        
        await register(currentShortcut, (event) => {
          if (event.state === "Pressed") {
            handleNewCapture();
          }
        });
      } catch {}
    };
    setupShortcuts();
    return () => { unregister(currentShortcut).catch(() => {}); };
  }, [currentShortcut, handleNewCapture]);

  const handleImageSelect = useCallback(async (path: string) => {
    setLastCapturePath(path);
    setCaptureImage(convertFileSrc(path));
    setIsSnippingMode(true);
    setSelections([]);
    setOcrText("");
    
    // Explicitly call handleOcr since it's now wrapped in a ref-stable way
    // But we need to be careful about closure over ocrLanguages etc.
    // Actually, calling handleOcr([]) here is fine as it's defined after
  }, []);



  const handleToggleStarHistory = useCallback(async (id: string) => {
    setHistory(prev => {
      const next = prev.map(item => item.id === id ? { ...item, starred: !item.starred } : item);
      if (storeRef.current) {
        storeRef.current.set("history", next).then(() => storeRef.current?.save());
      }
      return next;
    });
  }, []);

  const handleRestoreHistory = useCallback((item: HistoryItem) => {
    setOcrText(item.text);
    setCaptureImage(item.imageBase64);
    setSelections([]);
    setIsHistoryOpen(false);
    showToast("success", "toastItemRestored");
  }, [showToast]);

  const handleClear = useCallback(() => {
    setCaptureImage(null);
    setLastCapturePath(null);
    setSelections([]);
    setIsSnippingMode(false);
    setOcrText("");
    setOcrWords([]);
    setQrResult(null);
    setLastError("");
  }, []);

  const handleCopy = useCallback(async (formattedText: string) => {
    if (!formattedText) return;
    try {
      await invoke("copy_to_clipboard", { text: formattedText });
    } catch {
      try {
        await navigator.clipboard.writeText(formattedText);
      } catch {}
    }
    showToast("success", "toastTextCopied");
  }, [showToast]);

  const handleDeleteHistory = useCallback(async (id: string) => {
    setHistory(prev => {
        const next = prev.filter(item => item.id !== id);
        if (storeRef.current) {
            storeRef.current.set("history", next).then(() => storeRef.current?.save());
        }
        return next;
    });
  }, []);

  const handleClearHistory = useCallback(async () => {
    setHistory([]);
    if (storeRef.current) {
        await storeRef.current.set("history", []);
        await storeRef.current.save();
    }
    showToast("success", "toastHistoryCleared");
  }, [showToast]);

  const handleShortcutUpdate = useCallback(async (newShortcut: string) => {
    try {
      await unregister(currentShortcut);
      await register(newShortcut, (event) => {
        if (event.state === "Pressed") handleNewCapture();
      });
      setCurrentShortcut(newShortcut);
      if (storeRef.current) {
        await storeRef.current.set("global-shortcut", newShortcut);
        await storeRef.current.save();
      }
      showToast("success", "toastShortcutUpdated");
    } catch {
      showToast("error", "toastOcrError");
    }
  }, [currentShortcut, handleNewCapture, showToast]);

  // Global Keyboard shortcuts inside app window
  useEffect(() => {
    const handleWindowKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || "").toLowerCase();
      const isInput = activeTag === "input" || activeTag === "textarea";

      // Escape: Close modals or cancel snipping
      if (e.key === "Escape") {
        if (isSettingsOpen) setIsSettingsOpen(false);
        else if (isHistoryOpen) setIsHistoryOpen(false);
        else if (isSnippingMode && captureImage) setIsSnippingMode(false);
      }

      // Ctrl+C (when not editing text): Copy recognized OCR text
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && !isInput) {
        if (ocrText) {
          e.preventDefault();
          handleCopy(ocrText);
        }
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [isSettingsOpen, isHistoryOpen, isSnippingMode, captureImage, ocrText, handleCopy]);


  return (
    <div className={`app-shell ${isSidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <HeaderBar 
        isCaptureBusy={captureBusy}
        isOcrBusy={ocrBusy}
        canExtract={!!captureImage && selections.length > 0}
        onCapture={handleNewCapture}
        onExtract={() => handleOcr(selections)}
        onSettingsClick={() => setIsSettingsOpen(true)}
        onHistoryClick={() => setIsHistoryOpen(true)}
        onClear={handleClear}
        onClipboardOcr={handleClipboardOcr}
        monitors={monitors}
        selectedMonitor={selectedMonitor}
        onMonitorSelect={setSelectedMonitor}
        appVersion={appVersion}
        captureDelay={captureDelay}
        onDelayChange={setCaptureDelay}
      />

      <main className="workspace-grid">
        <section className="panel capture-panel">
          <SnippingArea 
            imageSrc={captureImage}
            onSelectionComplete={(rects) => {
              setSelections(rects);
              if (rects.length > 0) {
                handleOcr(rects);
              }
            }}
            onImageSelect={handleImageSelect}
            onImageSize={(w, h) => setImgDisplaySize({ w, h })}
            onScanAll={() => handleOcr([])}
            isSnippingMode={isSnippingMode}
            loading={ocrBusy}
          />
        </section>

        <ResultPanel 
          text={ocrText}
          onTextChange={setOcrText}
          loading={ocrBusy}
          onCopy={handleCopy}
          engine={ocrEngine}
          error={lastError}
          words={ocrWords}
          captureImage={captureImage}
          capturePath={lastCapturePath}
          selections={selections}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          qrResult={qrResult}
          onToast={(kind, msg) => showToast(kind, msg)}
        />
      </main>

      <HistoryModal 
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={history}
        onDelete={handleDeleteHistory}
        onClear={handleClearHistory}
        onCopy={handleCopy}
        onToggleStar={handleToggleStarHistory}
        onRestore={handleRestoreHistory}
      />

      <SettingsModal 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        theme={theme}
        onThemeChange={setTheme}
        appVersion={appVersion}
        currentShortcut={currentShortcut}
        onShortcutUpdate={handleShortcutUpdate}
        ocrLanguages={ocrLanguages.split("+")}
        onOcrLanguagesUpdate={async (langs) => {
          const joined = langs.join("+");
          setOcrLanguages(joined);
          if (storeRef.current) {
            await storeRef.current.set("ocr-languages", joined);
            await storeRef.current.save();
          }
        }}
        autoCopy={autoCopy}
        onAutoCopyUpdate={async (val) => {
          setAutoCopy(val);
          if (storeRef.current) {
            await storeRef.current.set("auto-copy", val);
            await storeRef.current.save();
          }
        }}
        alwaysOnTop={alwaysOnTop}
        onAlwaysOnTopUpdate={async (val) => {
          setAlwaysOnTop(val);
          await getCurrentWindow().setAlwaysOnTop(val);
          if (storeRef.current) {
            await storeRef.current.set("always-on-top", val);
            await storeRef.current.save();
          }
        }}
        appLang={appLang}
      />

      <StatusToast state={toast} />

      {countdown !== null && (
        <div className="countdown-pill-overlay">
          <div className="countdown-pill-content">
            <span className="countdown-pulse-circle">{countdown}</span>
            <div className="countdown-pill-texts">
              <span className="countdown-pill-title">{t("countdownText")} {countdown} {t("delaySeconds")}</span>
              <span className="countdown-pill-cancel">{t("cancelCountdown")}</span>
            </div>
            <button className="countdown-cancel-btn" onClick={handleCancelCountdown} title="Esc">
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
