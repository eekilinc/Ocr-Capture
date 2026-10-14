import { useRef, useState, useEffect, useCallback, memo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "../hooks/useTranslation";
import { sounds } from "../lib/soundEffects";
import { getLetterboxParams } from "../lib/letterbox";
import type { Rect } from "../types";

const PREVIEW_W = 220;
const PREVIEW_H = 140;
const PREVIEW_MARGIN = 16;

type ImageFilterMode = "normal" | "contrast" | "invert" | "grayscale";

/** Single source of truth: the canvas preview and the CSS-applied filter used the same strings. */
const FILTER_CSS: Record<ImageFilterMode, string> = {
  normal: "none",
  contrast: "contrast(160%) brightness(105%)",
  invert: "invert(100%) hue-rotate(180deg)",
  grayscale: "grayscale(100%) contrast(140%)",
};

interface SnippingAreaProps {
  imageSrc: string | null;
  onSelectionComplete: (selections: Rect[]) => void;
  onImageSelect?: (path: string) => void;
  onImageSize?: (width: number, height: number) => void;
  onScanAll?: () => void;
  onPasteClick?: () => void;
  isSnippingMode: boolean;
  loading: boolean;
  isTesseractMissing?: boolean;
  onRecheckTesseract?: () => Promise<boolean>;
}

export const SnippingArea = memo(({
  imageSrc,
  onSelectionComplete,
  onImageSelect,
  onImageSize,
  onScanAll,
  onPasteClick,
  isSnippingMode,
  loading,
  isTesseractMissing,
  onRecheckTesseract,
}: SnippingAreaProps) => {
  const { t } = useTranslation();
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null);
  const [localSelections, setLocalSelections] = useState<Rect[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [imageFilter, setImageFilter] = useState<ImageFilterMode>("normal");
  const [wingetCopied, setWingetCopied] = useState(false);
  const [isRechecking, setIsRechecking] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const wingetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drag endpoints are mirrored into refs so the window-level listeners can read them
  // without re-subscribing on every mousemove.
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const currentPosRef = useRef<{ x: number; y: number } | null>(null);
  const localSelectionsRef = useRef<Rect[]>([]);
  const onImageSizeRef = useRef(onImageSize);

  useEffect(() => { onImageSizeRef.current = onImageSize; }, [onImageSize]);
  useEffect(() => { localSelectionsRef.current = localSelections; }, [localSelections]);

  useEffect(() => () => {
    if (wingetTimerRef.current) clearTimeout(wingetTimerRef.current);
  }, []);

  const getPosFromClient = (clientX: number, clientY: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  // Compute letterbox offset/scale for object-fit:contain (shared with lib/image.ts)
  const getLetterbox = () => {
    const img = imgRef.current;
    if (!img) return { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
    return getLetterboxParams(img.naturalWidth, img.naturalHeight, img.clientWidth, img.clientHeight);
  };

  // Draw region preview on canvas
  const drawPreview = useCallback((start: { x: number; y: number }, curr: { x: number; y: number }) => {
    const canvas = previewCanvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.complete) return;

    const rx = Math.min(start.x, curr.x);
    const ry = Math.min(start.y, curr.y);
    const rw = Math.abs(curr.x - start.x);
    const rh = Math.abs(curr.y - start.y);
    if (rw < 2 || rh < 2) return;

    const { offsetX, offsetY, scaleX, scaleY } = getLetterbox();
    const sx = Math.max(0, (rx - offsetX) * scaleX);
    const sy = Math.max(0, (ry - offsetY) * scaleY);
    const sw = rw * scaleX;
    const sh = rh * scaleY;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    
    // Apply filter in preview canvas
    ctx.filter = FILTER_CSS[imageFilter];

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, PREVIEW_W, PREVIEW_H);
    ctx.filter = "none";
  }, [imageFilter, getLetterbox]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isSnippingMode || !imageSrc || loading) return;
    // Controls floating over the canvas must not start a selection: the pointer can
    // land on a filter button and, if it moves a few pixels before release, commit a
    // junk region that overwrites the current OCR result.
    if ((e.target as HTMLElement).closest?.(".image-filters-toolbar, .tesseract-compact-banner")) return;
    const pos = getPosFromClient(e.clientX, e.clientY);
    startPosRef.current = pos;
    currentPosRef.current = pos;
    setStartPos(pos);
    setCurrentPos(pos);
    sounds.playSnipStart();
  };

  /**
   * Ends the drag. Registered on the window while drawing, because releasing the button
   * over the header, outside the window, or on another monitor never reaches the
   * container -- which used to leave the dashed box and live preview stuck on screen and
   * made the next drag resume from the original start point.
   */
  const finishDrag = useCallback((shiftKey: boolean) => {
    const start = startPosRef.current;
    const current = currentPosRef.current;
    startPosRef.current = null;
    currentPosRef.current = null;
    setStartPos(null);
    setCurrentPos(null);

    if (!start || !current) return;

    const newRect: Rect = {
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y),
    };

    if (newRect.width > 5 && newRect.height > 5) {
      const updated = shiftKey ? [...localSelectionsRef.current, newRect] : [newRect];
      setLocalSelections(updated);
      onSelectionComplete(updated);
      sounds.playShutter();
    }
  }, [onSelectionComplete]);

  useEffect(() => {
    if (!startPos) return;
    const anchor = startPos;

    const handleMove = (e: MouseEvent) => {
      const pos = getPosFromClient(e.clientX, e.clientY);
      currentPosRef.current = pos;
      setCurrentPos(pos);
      drawPreview(anchor, pos);
    };
    const handleUp = (e: MouseEvent) => finishDrag(e.shiftKey);
    const handleCancel = () => finishDrag(false);

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("blur", handleCancel);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("blur", handleCancel);
    };
  }, [startPos, drawPreview, finishDrag]);

  // Leaving snipping mode (Escape, Clear, a new capture) has to drop an in-progress
  // drag, otherwise the dashed box and live preview stay on screen and the next drag
  // resumes from the original start point.
  useEffect(() => {
    if (isSnippingMode && !loading) return;
    startPosRef.current = null;
    currentPosRef.current = null;
    setStartPos(null);
    setCurrentPos(null);
  }, [isSnippingMode, loading]);

  // The parent feeds these dimensions into the crop maths. Reporting them only from the
  // <img> onLoad meant that resizing the window left them stale, so the next drag crop
  // ped pixels from the wrong letterbox offset and scale.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    // Zero dimensions would make getLetterboxParams fall back to identity scaling, which
    // crops the wrong pixels, so never report them.
    const report = () => {
      const w = img.clientWidth;
      const h = img.clientHeight;
      if (w > 0 && h > 0) onImageSizeRef.current?.(w, h);
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(img);
    return () => observer.disconnect();
  }, [imageSrc]);

  // Reset selections when new image loaded
  useEffect(() => {
    setLocalSelections([]);
  }, [imageSrc]);

  const handleFileOpen = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
      });
      if (selected && !Array.isArray(selected)) {
        onImageSelect?.(selected);
      }
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    // The drop target advertises itself, so it has to actually accept images.
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result;
      if (typeof dataUrl === "string") onImageSelect?.(dataUrl);
    };
    reader.onerror = () => console.error("Could not read the dropped file");
    reader.readAsDataURL(file);
  };

  // Calculate preview position so it stays within the container bounds
  const getPreviewStyle = (): React.CSSProperties => {
    if (!currentPos || !containerRef.current) return { display: "none" };
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    let px = currentPos.x + PREVIEW_MARGIN;
    let py = currentPos.y + PREVIEW_MARGIN;
    if (px + PREVIEW_W > cw) px = currentPos.x - PREVIEW_W - PREVIEW_MARGIN;
    if (py + PREVIEW_H > ch) py = currentPos.y - PREVIEW_H - PREVIEW_MARGIN;
    // Positioning only; the chrome around the canvas comes from CSS.
    return { left: px, top: py };
  };

  const getImageFilterStyle = () => FILTER_CSS[imageFilter];

  const handleDownloadTesseract = async () => {
    try {
      await openUrl("https://github.com/UB-Mannheim/tesseract/wiki");
    } catch {
      window.open("https://github.com/UB-Mannheim/tesseract/wiki", "_blank");
    }
  };

  const handleCopyWinget = () => {
    navigator.clipboard
      .writeText("winget install UB-Mannheim.TesseractOCR")
      .catch((err) => console.error("Could not copy the install command:", err));
    setWingetCopied(true);
    sounds.playSuccess();
    if (wingetTimerRef.current) clearTimeout(wingetTimerRef.current);
    wingetTimerRef.current = setTimeout(() => setWingetCopied(false), 2500);
  };

  const handleRecheck = async () => {
    if (!onRecheckTesseract || isRechecking) return;
    setIsRechecking(true);
    try {
      const ok = await onRecheckTesseract();
      if (ok) sounds.playSuccess();
    } finally {
      setIsRechecking(false);
    }
  };

  if (!imageSrc && !loading) {
    return (
      <div 
        className={`capture-empty-state ${isDragOver ? "drag-over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        {isTesseractMissing && (
          <div className="tesseract-alert-box">
            <div className="tesseract-alert-top">
              <span className="tesseract-alert-icon">⚠️</span>
              <div className="tesseract-alert-text">
                <strong>{t("tesseractInstallHelperTitle")}</strong>
                <p>{t("tesseractInstallHelperDesc")}</p>
              </div>
            </div>
            <div className="tesseract-alert-buttons">
              <button className="btn btn-sm btn-primary" onClick={handleDownloadTesseract}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                {t("tesseractDownloadBtn")}
              </button>
              <button className="btn btn-sm btn-secondary" onClick={handleCopyWinget} title="winget install UB-Mannheim.TesseractOCR">
                📋 {wingetCopied ? t("tesseractCopiedCmd") : "winget install UB-Mannheim.TesseractOCR"}
              </button>
              {onRecheckTesseract && (
                <button className="btn btn-sm btn-secondary" onClick={handleRecheck} disabled={isRechecking}>
                  🔄 {isRechecking ? "..." : t("tesseractRecheckBtn")}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="capture-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </div>
        <h3 className="capture-empty-title">{t("hintReady")}</h3>
        <p className="capture-empty-desc">{t("hintMainDesc")}</p>
        
        <div className="capture-steps">
          <div className="capture-step">
            <span className="step-number">1</span>
            <span className="step-label">{t("step1")}</span>
          </div>
          <div className="capture-step-arrow">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </div>
          <div className="capture-step">
            <span className="step-number">2</span>
            <span className="step-label">{t("step2")}</span>
          </div>
          <div className="capture-step-arrow">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </div>
          <div className="capture-step">
            <span className="step-number">3</span>
            <span className="step-label">{t("step3")}</span>
          </div>
        </div>

        <div className="capture-empty-actions">
          <button className="btn btn-primary" onClick={handleFileOpen}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            {t("hintDropFile")}
          </button>

          {onPasteClick && (
            <button className="btn btn-secondary btn-paste-glow" onClick={onPasteClick} title={`${t("btnPaste")} (Ctrl + V)`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
              </svg>
              <span>{t("btnPaste")}</span>
              <span className="kbd-badge-pill">Ctrl + V</span>
            </button>
          )}
        </div>

        <div className="capture-shortcut-hint">
          <span className="shortcut-label">{t("hintPasteOrDrop")}</span>
          <span className="shortcut-label">· {t("hintDropToOcr")}</span>
        </div>
      </div>
    );
  }

  const { scaleX, scaleY } = getLetterbox();
  const currentSelW = startPos && currentPos ? Math.round(Math.abs(currentPos.x - startPos.x) * scaleX) : 0;
  const currentSelH = startPos && currentPos ? Math.round(Math.abs(currentPos.y - startPos.y) * scaleY) : 0;

  return (
    <div
      ref={containerRef}
      className={`capture-container ${imageSrc ? "has-image" : ""} ${isSnippingMode ? "snipping" : ""} ${isDragOver ? "drag-over" : ""}`}
      onMouseDown={handleMouseDown}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {isTesseractMissing && (
        <div className="tesseract-compact-banner">
          <span className="compact-warn-text">⚠️ {t("tesseractInstallHelperTitle")}</span>
          <button className="compact-btn-action" onClick={handleDownloadTesseract}>
            {t("tesseractDownloadBtn")}
          </button>
          <button className="compact-btn-action" onClick={handleCopyWinget} title="winget install UB-Mannheim.TesseractOCR">
            {wingetCopied ? t("tesseractCopiedCmd") : "winget"}
          </button>
          {onRecheckTesseract && (
            <button className="compact-btn-action" onClick={handleRecheck} disabled={isRechecking}>
              {isRechecking ? "..." : t("tesseractRecheckBtn")}
            </button>
          )}
        </div>
      )}

      <img 
        ref={imgRef} 
        className="capture-image" 
        src={imageSrc || ""} 
        alt="capture" 
        draggable={false}
        style={{ filter: getImageFilterStyle() }}
        onLoad={(e) => {
          const el = e.currentTarget;
          onImageSize?.(el.clientWidth, el.clientHeight);
        }}
      />

      {/* Floating Image Pre-Filter Toolbar */}
      {imageSrc && (
        <div className="image-filters-toolbar">
          <button
            className={`filter-pill-btn ${imageFilter === "normal" ? "active" : ""}`}
            onClick={() => setImageFilter("normal")}
            title={t("filterNormal")}
          >
            {t("filterNormal")}
          </button>
          <button
            className={`filter-pill-btn ${imageFilter === "contrast" ? "active" : ""}`}
            onClick={() => setImageFilter("contrast")}
            title={t("filterContrast")}
          >
            {t("filterContrast")}
          </button>
          <button
            className={`filter-pill-btn ${imageFilter === "invert" ? "active" : ""}`}
            onClick={() => setImageFilter("invert")}
            title={t("filterInvert")}
          >
            {t("filterInvert")}
          </button>
          <button
            className={`filter-pill-btn ${imageFilter === "grayscale" ? "active" : ""}`}
            onClick={() => setImageFilter("grayscale")}
            title={t("filterGrayscale")}
          >
            {t("filterGrayscale")}
          </button>
          {onScanAll && (
            <button
              className="filter-pill-btn filter-pill-btn-primary"
              onClick={onScanAll}
              disabled={loading}
              title={t("btnScanAll")}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              {t("btnScanAll")}
            </button>
          )}
        </div>
      )}
      
      {loading && (
        <div className="capture-loading-overlay">
          <div className="loader-pill">
            <span className="loader-dot"></span>
            <span>{t("analyzing")}</span>
          </div>
        </div>
      )}
      
      <div className="selection-overlay">
        {localSelections.map((rect, i) => (
          <div
            key={i}
            className="selection-box"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              boxShadow: 'none'
            }}
          />
        ))}

        {startPos && currentPos && (
          <div
            className="selection-box active-snipping-box"
            style={{
              left: Math.min(startPos.x, currentPos.x),
              top: Math.min(startPos.y, currentPos.y),
              width: Math.abs(currentPos.x - startPos.x),
              height: Math.abs(currentPos.y - startPos.y),
            }}
          >
            {currentSelW > 25 && currentSelH > 15 && (
              <div className="selection-dimension-badge">
                {currentSelW} × {currentSelH} px
              </div>
            )}
          </div>
        )}
      </div>

      {/* Live crop preview panel */}
      {startPos && currentPos && (
        <div className="crop-preview-panel" style={getPreviewStyle()}>
          <canvas ref={previewCanvasRef} width={PREVIEW_W} height={PREVIEW_H} className="crop-preview-canvas" />
          <div className="crop-preview-badge">
            {currentSelW} × {currentSelH} px
          </div>
        </div>
      )}
    </div>
  );
});
