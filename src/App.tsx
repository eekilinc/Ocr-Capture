import { useState, useEffect, useRef, useCallback } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { register, unregister, isRegistered } from "@tauri-apps/plugin-global-shortcut";
import type { Store } from "@tauri-apps/plugin-store";
import { getSettingsStore } from "./lib/settingsStore";
import { HeaderBar } from "./components/HeaderBar";
import { SnippingArea } from "./components/SnippingArea";
import { ResultPanel } from "./components/ResultPanel";
import { StatusToast } from "./components/StatusToast";
import { SettingsModal } from "./components/SettingsModal";
import { HistoryModal } from "./components/HistoryModal";
import { ScreenOverlay } from "./components/ScreenOverlay";
import { cropImageToBase64, createThumbnail } from "./lib/image";
import { scanQrCode } from "./lib/qr";
import { useTheme } from "./hooks/useTheme";
import { useTranslation } from "./hooks/useTranslation";
import { translations, type TranslationKeys } from "./i18n/translations";
import { sounds } from "./lib/soundEffects";
import type {
  CaptureResponse,
  OcrResponse,
  OcrWord,
  Rect,
  ToastState,
  MonitorInfo,
  HistoryItem,
  CroppedResponse,
  ClipboardImageResponse,
  TesseractStatus,
  OcrInput,
} from "./types";

/** Vertical breathing room between stacked regions in the confidence map. */
const REGION_STACK_GAP = 24;

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
  const [ocrImageSize, setOcrImageSize] = useState<{ w: number; h: number } | null>(null);
  const [qrResult, setQrResult] = useState<string | null>(null);
  const [lastError, setLastError] = useState("");
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureDelay, setCaptureDelay] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [overlayImage, setOverlayImage] = useState<string | null>(null);
  const savedWindowSize = useRef<PhysicalSize | null>(null);
  const savedWindowPos = useRef<PhysicalPosition | null>(null);
  const rawCapturePathRef = useRef<string | null>(null);
  const rawCaptureDimRef = useRef<{ width: number; height: number } | null>(null);
  // Mirrors lastCapturePath so resetCaptureState can free the file it replaces without
  // depending on state.
  const lastCapturePathRef = useRef<string | null>(null);
  // Incremented per QR scan so a slow one cannot overwrite a newer capture's result.
  const qrScanTokenRef = useRef(0);
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
  const [tesseractInstalled, setTesseractInstalled] = useState<boolean>(true);
  const storeRef = useRef<Store | null>(null);
  const isPastingRef = useRef(false);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  /** setTimeout that is tracked so it can be cancelled on unmount. */
  const setManagedTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
    return id;
  }, []);

  // Clear every pending timer on unmount; none of them should outlive the app.
  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current.clear();
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
  }, []);

  const checkTesseract = useCallback(async () => {
    try {
      const status = await invoke<TesseractStatus>("check_tesseract_installed");
      setTesseractInstalled(status.installed);
      return status.installed;
    } catch {
      setTesseractInstalled(false);
      return false;
    }
  }, []);

  const showToast = useCallback((kind: "success" | "error" | "info", message: TranslationKeys | string, duration = 3000) => {
    // Accepts a translation key or a literal string (entity chips interpolate text), and
    // resolves it here so StatusToast never has to guess.
    const text = message in translations.tr ? t(message as TranslationKeys) : message;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ kind, message: text });
    toastTimerRef.current = setManagedTimeout(() => setToast({ kind: "hidden", message: "" }), duration);
  }, [t, setManagedTimeout]);

  /** Resets every piece of per-capture state so a new image never inherits the previous one's results. */
  const resetCaptureState = useCallback((src: string | null, path: string | null) => {
    // Capture/crop PNGs are 5-10 MB each and were only ever removed by the start-up
    // sweep, so a tray app left running all day filled %TEMP% with them.
    const previous = lastCapturePathRef.current;
    if (previous && previous !== path) {
      invoke("delete_temp_file", { path: previous }).catch(() => {});
    }
    lastCapturePathRef.current = path;

    // Invalidate any QR scan still in flight from the previous image.
    qrScanTokenRef.current += 1;

    setCaptureImage(src);
    setLastCapturePath(path);
    setIsSnippingMode(true);
    setSelections([]);
    setOcrText("");
    setOcrEngine("");
    setOcrWords([]);
    setOcrImageSize(null);
    setQrResult(null);
    setLastError("");
  }, []);

  /** Prepends a capture to the capped history and persists it through the settings store. */
  const pushHistory = useCallback(async (text: string, thumbnailSource: string) => {
    const item: HistoryItem = {
      id: crypto.randomUUID(),
      imageBase64: await createThumbnail(thumbnailSource),
      text,
      date: new Date().toISOString(),
    };
    setHistory(prev => {
      const next = [item, ...prev].slice(0, 50);
      storeRef.current?.set("history", next).then(() => storeRef.current?.save());
      return next;
    });
  }, []);

  // Initialize App Settings
  useEffect(() => {
    const initSettings = async () => {
        try {
            const store = await getSettingsStore();
            storeRef.current = store;

            try {
                const ver = await getVersion();
                setAppVersion(ver);
            } catch (e) {
                console.error("Could not read the app version:", e);
            }

            await checkTesseract();

            const setupDone = await store.get<boolean>("setup-done");

            // Load Monitors
            try {
               const mons = await invoke<MonitorInfo[]>("get_monitors");
               setMonitors(mons);
            } catch (e) {
               console.error("Could not list monitors:", e);
               showToast("error", "toastMonitorsFailed");
            }

            if (!setupDone) {
                try {
                    const auto = await isEnabled();
                    if (!auto) await enable();
                } catch (e) {
                    console.error("Could not enable autostart:", e);
                }
                await store.set("minimize-to-tray", true);
                await store.set("setup-done", true);
                await store.save();
            }

            // Mirror the tray preference into the Rust close handler, which cannot
            // read the settings store synchronously itself.
            const savedTray = (await store.get<boolean>("minimize-to-tray")) ?? true;
            invoke("set_minimize_to_tray", { enabled: savedTray }).catch((e) =>
                console.error("Could not apply the tray preference:", e)
            );

            if (setupDone) {
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
                } catch (e) {
                    console.error("Could not restore the window geometry:", e);
                }
            }
        } catch (e) {
            // Without the store every preference is lost, so tell the user instead of
            // failing silently into a half-configured app.
            console.error("Settings initialisation failed:", e);
            showToast("error", "toastInitFailed");
        }
    };
    initSettings();
  }, [showToast]);

  // Window geometry persistence. The restore path above reads window-width/height/x/y,
  // but nothing ever wrote them, so the window always reopened at its default size and
  // position. Saves are debounced because onMoved fires continuously while dragging.
  const geometryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressGeometrySaveRef = useRef(false);

  const saveWindowGeometry = useCallback(async () => {
    const store = storeRef.current;
    if (!store || suppressGeometrySaveRef.current) return;
    try {
      const appWindow = getCurrentWindow();
      const size = await appWindow.outerSize();
      const pos = await appWindow.outerPosition();
      await store.set("window-width", size.width);
      await store.set("window-height", size.height);
      await store.set("window-x", pos.x);
      await store.set("window-y", pos.y);
      await store.save();
    } catch (e) {
      console.error("Could not persist the window geometry:", e);
    }
  }, []);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const scheduleSave = () => {
      if (geometryTimerRef.current) clearTimeout(geometryTimerRef.current);
      geometryTimerRef.current = setManagedTimeout(() => { void saveWindowGeometry(); }, 500);
    };

    // onResized/onMoved resolve asynchronously, so guard against an unmount landing first.
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];
    void Promise.all([appWindow.onResized(scheduleSave), appWindow.onMoved(scheduleSave)])
      .then((fns) => {
        if (cancelled) fns.forEach((fn) => fn());
        else unlisteners.push(...fns);
      });

    return () => {
      cancelled = true;
      if (geometryTimerRef.current) clearTimeout(geometryTimerRef.current);
      unlisteners.forEach((fn) => fn());
    };
  }, [saveWindowGeometry, setManagedTimeout]);

  const handleOcr = useCallback(async (rects: Rect[], overrideImagePath?: string, overrideImageBase64?: string) => {
    const targetPath = overrideImagePath || lastCapturePath;
    if (!captureImage && !overrideImagePath && !overrideImageBase64) return;
    if (ocrBusy) return;
    setOcrBusy(true);
    setLastError("");

    // Accumulates a run so that every selected region contributes, not just the first.
    const acc = {
      texts: [] as string[],
      words: [] as OcrWord[],
      engine: "",
      qr: null as string | null,
      qrSource: null as string | null,
      thumb: null as string | null,
      size: null as { w: number; h: number } | null,
    };
    // Running vertical offset used to stack multiple regions in the confidence map.
    let nextRegionY = 0;

    const runRegion = async (dataUrl: string) => {
      const resp = await invoke<OcrResponse>("run_ocr", {
        input: {
          imageBase64: dataUrl.split(",")[1] ?? dataUrl,
          languages: ocrLanguages,
        }
      });
      acc.texts.push(resp.text);
      if (!acc.engine) acc.engine = resp.engine;
      if (!acc.size) acc.size = { w: resp.imageWidth, h: resp.imageHeight };
      // Remember the first region's image for a QR scan, but do not run it here:
      // jsQR is synchronous and blocks the main thread for a large region, which
      // delayed the text the user was already waiting for.
      if (!acc.qrSource) acc.qrSource = dataUrl;

      // Word coordinates are relative to each region's own crop. Rescale into the first
      // region's coordinate space and stack downwards, so the confidence map stays
      // dimensionally correct instead of drawing regions on top of one another.
      const base = acc.size ?? { w: resp.imageWidth, h: resp.imageHeight };
      const scaleX = base.w > 0 ? base.w / resp.imageWidth : 1;
      const scaleY = base.h > 0 ? base.h / resp.imageHeight : 1;
      const placed = resp.words.map((w) => ({
        ...w,
        x: Math.round(w.x * scaleX),
        y: Math.round(w.y * scaleY) + nextRegionY,
        width: Math.round(w.width * scaleX),
        height: Math.round(w.height * scaleY),
      }));
      acc.words.push(...placed);
      nextRegionY = placed.reduce((m, w) => Math.max(m, w.y + w.height), 0) + REGION_STACK_GAP;
      return resp;
    };

    try {
      if (overrideImageBase64) {
        acc.thumb = overrideImageBase64;
        await runRegion(overrideImageBase64);
      } else if (rects.length > 0 && captureImage) {
        // Selection exists: crop in the browser (display coords → canvas → base64)
        // Pass display dims so letterbox offset/scale is correctly applied.
        for (const rect of rects) {
          const croppedBase64 = await cropImageToBase64(
            captureImage,
            rect,
            {
              displayWidth: imgDisplaySize?.w,
              displayHeight: imgDisplaySize?.h,
            }
          );
          if (!acc.thumb) acc.thumb = croppedBase64;
          await runRegion(croppedBase64);
        }
      } else {
        // No selection: run OCR on full image using file path if available
        const input: OcrInput = { languages: ocrLanguages };
        if (targetPath) {
          input.imagePath = targetPath;
        } else if (captureImage) {
          input.imageBase64 = captureImage.startsWith("data:")
            ? captureImage.split(",")[1]
            : captureImage;
        }
        const resp = await invoke<OcrResponse>("run_ocr", { input });
        acc.texts.push(resp.text);
        acc.engine = resp.engine;
        acc.words.push(...resp.words);
        acc.size = { w: resp.imageWidth, h: resp.imageHeight };
        acc.thumb = captureImage || (targetPath ? convertFileSrc(targetPath) : null);
      }

      const combinedText = acc.texts.filter(Boolean).join("\n");

      setOcrText(combinedText);
      setOcrEngine(acc.engine);
      setOcrWords(acc.words);
      setOcrImageSize(acc.size);

      // QR scan happens after the text is on screen, and the token guards against a
      // slow scan landing on top of a newer capture.
      setQrResult(null);
      if (acc.qrSource) {
        const token = ++qrScanTokenRef.current;
        void scanQrCode(acc.qrSource).then((qr) => {
          if (token === qrScanTokenRef.current) setQrResult(qr);
        });
      }

      if (acc.thumb) {
        await pushHistory(combinedText, acc.thumb);
      }

      if (autoCopy && combinedText) {
        try {
          await invoke("copy_to_clipboard", { text: combinedText });
        } catch {
          try {
            await navigator.clipboard.writeText(combinedText);
          } catch {}
        }
        showToast("success", "toastTextCopied");
      }
    } catch (e) {
      setLastError(String(e));
      showToast("error", "toastOcrError");
    } finally {
      setOcrBusy(false);
      // Sweep anything abandoned by an earlier session or a crash.
      invoke("cleanup_temp_files", { maxAgeSecs: 3600 }).catch(() => {});
    }
  }, [autoCopy, captureImage, lastCapturePath, imgDisplaySize, ocrBusy, ocrLanguages, showToast, pushHistory]);

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

  const handleOverlayCancel = useCallback(async () => {
    setOverlayImage(null);
    try {
      const appWindow = getCurrentWindow();
      await appWindow.setFullscreen(false);
      await appWindow.setAlwaysOnTop(alwaysOnTop);
      if (savedWindowSize.current) {
        await appWindow.setSize(savedWindowSize.current);
      }
      if (savedWindowPos.current) {
        await appWindow.setPosition(savedWindowPos.current);
      }
      await appWindow.show();
      await appWindow.setFocus();
    } catch {}
  }, [alwaysOnTop]);

  const handleOverlayConfirm = useCallback(async (rect: Rect, displayWidth: number, displayHeight: number) => {
    setOverlayImage(null);
    const appWindow = getCurrentWindow();
    try {
      await appWindow.setFullscreen(false);
      await appWindow.setAlwaysOnTop(alwaysOnTop);
      if (savedWindowSize.current) {
        await appWindow.setSize(savedWindowSize.current);
      }
      if (savedWindowPos.current) {
        await appWindow.setPosition(savedWindowPos.current);
      }
      await appWindow.show();
      await appWindow.setFocus();
    } catch {}

    if (!rawCapturePathRef.current) return;

    try {
      // Ekran yakalama görselinin doğal boyutlarına oranlama
      const origW = rawCaptureDimRef.current?.width || displayWidth;
      const origH = rawCaptureDimRef.current?.height || displayHeight;
      const scaleX = origW / displayWidth;
      const scaleY = origH / displayHeight;

      const cropX = Math.max(0, Math.round(rect.x * scaleX));
      const cropY = Math.max(0, Math.round(rect.y * scaleY));
      const cropW = Math.max(1, Math.round(rect.width * scaleX));
      const cropH = Math.max(1, Math.round(rect.height * scaleY));

      // 1. Rust yerel kırpma (IPC üzerinden megabaytlarca Base64 taşımadan ışık hızında)
      try {
        const cropped = await invoke<CroppedResponse>("crop_image_file", {
          sourcePath: rawCapturePathRef.current,
          x: cropX,
          y: cropY,
          width: cropW,
          height: cropH,
        });

        const croppedSrc = convertFileSrc(cropped.imagePath) + `?t=${Date.now()}`;
        resetCaptureState(croppedSrc, cropped.imagePath);
        setSelections([rect]);

        await handleOcr([], cropped.imagePath);
        return;
      } catch (rustErr) {
        console.warn("Rust native crop failed, falling back to canvas:", rustErr);
      }

      // 2. Tarayıcı Canvas yedekleme (Fallback)
      const rawSrc = convertFileSrc(rawCapturePathRef.current);
      const croppedBase64 = await cropImageToBase64(
        rawSrc,
        rect,
        { displayWidth, displayHeight }
      );

      resetCaptureState(croppedBase64, null);
      setSelections([rect]);

      await handleOcr([rect], undefined, croppedBase64);
    } catch (err) {
      setLastError(String(err));
      showToast("error", "toastOcrError");
    }
  }, [alwaysOnTop, handleOcr, showToast, resetCaptureState]);

  const executeCapture = useCallback(async (mode: "area" | "fullscreen" = "area") => {
    setCaptureBusy(true);
    setQrResult(null);
    setLastError("");
    // The window is about to be resized to fullscreen for the overlay; persisting that
    // geometry would restore the app to fullscreen on next launch.
    suppressGeometrySaveRef.current = true;
    try {
      const appWindow = getCurrentWindow();

      // Save current window size and position for restoring later
      try {
        savedWindowSize.current = await appWindow.outerSize();
        savedWindowPos.current = await appWindow.outerPosition();
      } catch {}

      // Hide the window so it is not in the screenshot
      await appWindow.hide();
      await new Promise((resolve) => setTimeout(resolve, 180));

      const resp = await invoke<CaptureResponse>("capture_screen", { monitorId: selectedMonitor });
      rawCapturePathRef.current = resp.imagePath;
      rawCaptureDimRef.current = { width: resp.width, height: resp.height };
      const imgSrc = convertFileSrc(resp.imagePath) + `?t=${Date.now()}`;

      if (mode === "area") {
        // --- INTERACTIVE SCREEN OVERLAY MODE ---
        // Enter fullscreen overlay over the user's desktop
        setOverlayImage(imgSrc);
        await appWindow.setFullscreen(true);
        await appWindow.setAlwaysOnTop(true);
        await appWindow.show();
        await appWindow.unminimize();
        await appWindow.setFocus();
      } else {
        // --- FULL SCREEN OCR MODE ---
        // Restore normal window
        await appWindow.show();
        await appWindow.unminimize();
        await appWindow.setFocus();

        resetCaptureState(imgSrc, resp.imagePath);
        showToast("success", "toastCaptured");

        // Run full OCR directly, after the captured image has had a frame to paint.
        setManagedTimeout(() => {
          handleOcr([], resp.imagePath);
        }, 50);
      }
    } catch (e) {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.setFullscreen(false);
        await appWindow.show();
        await appWindow.unminimize();
        await appWindow.setFocus();
      } catch {}
      setLastError(String(e));
      showToast("error", "toastOcrError");
    } finally {
      setCaptureBusy(false);
      suppressGeometrySaveRef.current = false;
    }
  }, [selectedMonitor, showToast, handleOcr, resetCaptureState, setManagedTimeout]);

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

  const handlePasteFromClipboard = useCallback(async (pasteEvent?: ClipboardEvent) => {
    if (ocrBusy || isPastingRef.current) return;
    isPastingRef.current = true;
    setLastError("");

    // 1. Tarayıcı paste olayından gelen görsel verisini kontrol et (Web sayfası, Snipping tool vb.)
    const items = pasteEvent?.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            sounds.playShutter();
            const reader = new FileReader();
            reader.onload = async (e) => {
              const dataUrl = e.target?.result as string;
              if (dataUrl) {
                resetCaptureState(dataUrl, null);
                await handleOcr([], undefined, dataUrl);
                sounds.playSuccess();
                showToast("success", "toastPastedAndAnalyzed");
              }
              isPastingRef.current = false;
            };
            reader.onerror = () => {
              isPastingRef.current = false;
            };
            reader.readAsDataURL(file);
            return;
          }
        }
      }
    }

    // 2. İşletim sistemi panosundan (Rust / arboard) görseli doğrudan oku
    try {
      sounds.playShutter();
      const resp = await invoke<ClipboardImageResponse>("paste_clipboard_image");
      if (resp && resp.imagePath) {
        const imgSrc = convertFileSrc(resp.imagePath) + `?t=${Date.now()}`;
        resetCaptureState(imgSrc, resp.imagePath);
        await handleOcr([], resp.imagePath);
        sounds.playSuccess();
        showToast("success", "toastPastedAndAnalyzed");
        isPastingRef.current = false;
        return;
      }
    } catch {
      // 3. İkincil yedek: read_clipboard_image (Base64)
      try {
        const b64 = await invoke<string>("read_clipboard_image");
        if (b64) {
          const dataUrl = `data:image/png;base64,${b64}`;
          resetCaptureState(dataUrl, null);
          await handleOcr([], undefined, dataUrl);
          sounds.playSuccess();
          showToast("success", "toastPastedAndAnalyzed");
          isPastingRef.current = false;
          return;
        }
      } catch {}
    }

    isPastingRef.current = false;
    showToast("info", "toastClipboardEmpty");
  }, [ocrBusy, handleOcr, showToast, resetCaptureState]);

  const handleClipboardOcr = handlePasteFromClipboard;

  // Shortcut Management
  // handleNewCapture gets a new identity whenever capture/OCR state changes. Reading it
  // through a ref keeps this effect dependent on `currentShortcut` alone, so the global
  // shortcut is registered once instead of being torn down and re-registered on every
  // keystroke in the result panel.
  const handleNewCaptureRef = useRef(handleNewCapture);
  handleNewCaptureRef.current = handleNewCapture;

  useEffect(() => {
    const setupShortcuts = async () => {
      try {
        if (await isRegistered(currentShortcut)) await unregister(currentShortcut);

        await register(currentShortcut, (event) => {
          if (event.state === "Pressed") {
            handleNewCaptureRef.current();
          }
        });
      } catch (e) {
        console.error("Global shortcut registration failed:", e);
        showToast("error", "toastShortcutFailed");
      }
    };
    setupShortcuts();
    return () => { unregister(currentShortcut).catch(() => {}); };
  }, [currentShortcut, showToast]);

  /** Accepts either a filesystem path (file dialog) or a data URL (drag & drop). */
  const handleImageSelect = useCallback((src: string) => {
    if (src.startsWith("data:")) {
      resetCaptureState(src, null);
    } else {
      resetCaptureState(convertFileSrc(src), src);
    }
  }, [resetCaptureState]);



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
    // The restored thumbnail is a data URL, so the previous capture's *file path* must
    // be cleared -- otherwise a later "scan all" OCRs the old image while showing this one.
    resetCaptureState(item.imageBase64, null);
    setOcrText(item.text);
    setIsHistoryOpen(false);
    showToast("success", "toastItemRestored");
  }, [resetCaptureState, showToast]);

  const handleClear = useCallback(() => {
    resetCaptureState(null, null);
    setIsSnippingMode(false);
    rawCapturePathRef.current = null;
  }, [resetCaptureState]);

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
  // Everything the listeners need is read through `liveRef`, so both listeners below are
  // registered exactly once instead of being torn down and re-added on every keystroke
  // in the result panel or on every OCR state change.
  const liveRef = useRef({
    ocrText,
    isSettingsOpen,
    isHistoryOpen,
    isSnippingMode,
    captureImage,
    handleCopy,
    handlePasteFromClipboard,
  });
  liveRef.current = {
    ocrText,
    isSettingsOpen,
    isHistoryOpen,
    isSnippingMode,
    captureImage,
    handleCopy,
    handlePasteFromClipboard,
  };

  useEffect(() => {
    const handleWindowKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || "").toLowerCase();
      const isInput = activeTag === "input" || activeTag === "textarea";
      const live = liveRef.current;

      // Escape: Close modals or cancel snipping
      if (e.key === "Escape") {
        if (live.isSettingsOpen) setIsSettingsOpen(false);
        else if (live.isHistoryOpen) setIsHistoryOpen(false);
        else if (live.isSnippingMode && live.captureImage) setIsSnippingMode(false);
      }

      // Ctrl+C (when not editing text): Copy recognized OCR text
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && !isInput) {
        if (live.ocrText) {
          e.preventDefault();
          live.handleCopy(live.ocrText);
        }
      }

      // Ctrl+V (when not editing text): Paste and analyze copied image
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && !isInput) {
        e.preventDefault();
        live.handlePasteFromClipboard();
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, []);

  // Global window paste event listener (supports right click paste, Ctrl+V, image drop/paste from anywhere)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const activeTag = (document.activeElement?.tagName || "").toLowerCase();
      const isInput = activeTag === "input" || activeTag === "textarea";

      const items = e.clipboardData?.items;
      let hasImage = false;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith("image/")) {
            hasImage = true;
            break;
          }
        }
      }

      // If typing in input/textarea and pasting normal text, do not intercept
      if (isInput && !hasImage) {
        return;
      }

      e.preventDefault();
      liveRef.current.handlePasteFromClipboard(e);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  // Stable callbacks: SnippingArea and ResultPanel are memo'd, so inline arrows here
  // would invalidate their props on every render and defeat the memoisation.
  const handleExtract = useCallback(() => handleOcr(selections), [handleOcr, selections]);
  const handleScanAll = useCallback(() => handleOcr([]), [handleOcr]);
  const handleSelectionComplete = useCallback((rects: Rect[]) => {
    setSelections(rects);
    if (rects.length > 0) handleOcr(rects);
  }, [handleOcr]);
  const handleImageSize = useCallback((w: number, h: number) => setImgDisplaySize({ w, h }), []);
  const handleToggleCollapse = useCallback(() => setIsSidebarCollapsed((v) => !v), []);
  const handleOpenSettings = useCallback(() => setIsSettingsOpen(true), []);
  const handleCloseSettings = useCallback(() => setIsSettingsOpen(false), []);
  const handleOpenHistory = useCallback(() => setIsHistoryOpen(true), []);
  const handleCloseHistory = useCallback(() => setIsHistoryOpen(false), []);
  const handlePasteClick = useCallback(() => handlePasteFromClipboard(), [handlePasteFromClipboard]);
  const handleOcrLanguagesUpdate = useCallback(async (langs: string[]) => {
    const joined = langs.join("+");
    setOcrLanguages(joined);
    if (storeRef.current) {
      await storeRef.current.set("ocr-languages", joined);
      await storeRef.current.save();
    }
  }, []);
  const handleAutoCopyUpdate = useCallback(async (val: boolean) => {
    setAutoCopy(val);
    if (storeRef.current) {
      await storeRef.current.set("auto-copy", val);
      await storeRef.current.save();
    }
  }, []);
  const handleAlwaysOnTopUpdate = useCallback(async (val: boolean) => {
    setAlwaysOnTop(val);
    await getCurrentWindow().setAlwaysOnTop(val);
    if (storeRef.current) {
      await storeRef.current.set("always-on-top", val);
      await storeRef.current.save();
    }
  }, []);

  return (
    <div className={`app-shell ${isSidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <HeaderBar 
        isCaptureBusy={captureBusy}
        isOcrBusy={ocrBusy}
        canExtract={!!captureImage && selections.length > 0}
        onCapture={handleNewCapture}
        onExtract={handleExtract}
        onSettingsClick={handleOpenSettings}
        onHistoryClick={handleOpenHistory}
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
            onSelectionComplete={handleSelectionComplete}
            onImageSelect={handleImageSelect}
            onImageSize={handleImageSize}
            onScanAll={handleScanAll}
            onPasteClick={handlePasteClick}
            isSnippingMode={isSnippingMode}
            loading={ocrBusy}
            isTesseractMissing={!tesseractInstalled}
            onRecheckTesseract={checkTesseract}
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
          ocrImageSize={ocrImageSize}
          captureImage={captureImage}
          capturePath={lastCapturePath}
          selections={selections}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={handleToggleCollapse}
          qrResult={qrResult}
          onToast={showToast}
        />
      </main>

      <HistoryModal 
        isOpen={isHistoryOpen}
        onClose={handleCloseHistory}
        history={history}
        onDelete={handleDeleteHistory}
        onClear={handleClearHistory}
        onCopy={handleCopy}
        onToggleStar={handleToggleStarHistory}
        onRestore={handleRestoreHistory}
      />

      <SettingsModal 
        isOpen={isSettingsOpen}
        onClose={handleCloseSettings}
        theme={theme}
        onThemeChange={setTheme}
        appVersion={appVersion}
        currentShortcut={currentShortcut}
        onShortcutUpdate={handleShortcutUpdate}
        ocrLanguages={ocrLanguages.split("+")}
        onOcrLanguagesUpdate={handleOcrLanguagesUpdate}
        autoCopy={autoCopy}
        onAutoCopyUpdate={handleAutoCopyUpdate}
        alwaysOnTop={alwaysOnTop}
        onAlwaysOnTopUpdate={handleAlwaysOnTopUpdate}
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

      {overlayImage && (
        <ScreenOverlay
          imageSrc={overlayImage}
          onConfirmSelection={handleOverlayConfirm}
          onCancel={handleOverlayCancel}
        />
      )}
    </div>
  );
}
