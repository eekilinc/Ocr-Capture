import { useRef, useState, useEffect, useCallback, memo } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { sounds } from "../lib/soundEffects";
import type { Rect } from "../types";

const PREVIEW_W = 220;
const PREVIEW_H = 140;
const PREVIEW_MARGIN = 16;

type ImageFilterMode = "normal" | "contrast" | "invert" | "grayscale";

interface SnippingAreaProps {
  imageSrc: string | null;
  onSelectionComplete: (selections: Rect[]) => void;
  onImageSelect?: (path: string) => void;
  onImageSize?: (width: number, height: number) => void;
  onScanAll?: () => void;
  isSnippingMode: boolean;
  loading: boolean;
}

export const SnippingArea = memo(({
  imageSrc,
  onSelectionComplete,
  onImageSelect,
  onImageSize,
  onScanAll,
  isSnippingMode,
  loading,
}: SnippingAreaProps) => {
  const { t } = useTranslation();
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null);
  const [localSelections, setLocalSelections] = useState<Rect[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewPos, setPreviewPos] = useState<{ x: number; y: number } | null>(null);
  const [imageFilter, setImageFilter] = useState<ImageFilterMode>("normal");
  
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const getPos = (e: React.MouseEvent | MouseEvent) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  // Compute letterbox offset/scale for object-fit:contain
  const getLetterboxParams = () => {
    const img = imgRef.current;
    if (!img) return { ox: 0, oy: 0, scaleX: 1, scaleY: 1 };
    const iw = img.clientWidth;
    const ih = img.clientHeight;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!iw || !ih || !nw || !nh) return { ox: 0, oy: 0, scaleX: 1, scaleY: 1 };
    const nAspect = nw / nh;
    const cAspect = iw / ih;
    let renderedW: number, renderedH: number, ox = 0, oy = 0;
    if (nAspect > cAspect) {
      renderedW = iw; renderedH = iw / nAspect;
      oy = (ih - renderedH) / 2;
    } else {
      renderedH = ih; renderedW = ih * nAspect;
      ox = (iw - renderedW) / 2;
    }
    return { ox, oy, scaleX: nw / renderedW, scaleY: nh / renderedH };
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

    const { ox, oy, scaleX, scaleY } = getLetterboxParams();
    const sx = Math.max(0, (rx - ox) * scaleX);
    const sy = Math.max(0, (ry - oy) * scaleY);
    const sw = rw * scaleX;
    const sh = rh * scaleY;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    
    // Apply filter in preview canvas
    if (imageFilter === "contrast") ctx.filter = "contrast(160%) brightness(105%)";
    else if (imageFilter === "invert") ctx.filter = "invert(100%) hue-rotate(180deg)";
    else if (imageFilter === "grayscale") ctx.filter = "grayscale(100%) contrast(140%)";
    else ctx.filter = "none";

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, PREVIEW_W, PREVIEW_H);
    ctx.filter = "none";
  }, [imageFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isSnippingMode || !imageSrc || loading) return;
    const pos = getPos(e);
    setStartPos(pos);
    setCurrentPos(pos);
    setPreviewPos({ x: pos.x, y: pos.y });
    sounds.playSnipStart();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!startPos) return;
    const pos = getPos(e);
    setCurrentPos(pos);
    setPreviewPos({ x: pos.x, y: pos.y });
    drawPreview(startPos, pos);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!startPos || !currentPos) return;

    const newRect: Rect = {
      x: Math.min(startPos.x, currentPos.x),
      y: Math.min(startPos.y, currentPos.y),
      width: Math.abs(currentPos.x - startPos.x),
      height: Math.abs(currentPos.y - startPos.y),
    };

    if (newRect.width > 5 && newRect.height > 5) {
      const updated = e.shiftKey ? [...localSelections, newRect] : [newRect];
      setLocalSelections(updated);
      onSelectionComplete(updated);
      sounds.playShutter();
    }

    setStartPos(null);
    setCurrentPos(null);
    setPreviewPos(null);
  };

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
  };

  // Calculate preview position so it stays within the container bounds
  const getPreviewStyle = (): React.CSSProperties => {
    if (!previewPos || !containerRef.current) return { display: "none" };
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    let px = previewPos.x + PREVIEW_MARGIN;
    let py = previewPos.y + PREVIEW_MARGIN;
    if (px + PREVIEW_W > cw) px = previewPos.x - PREVIEW_W - PREVIEW_MARGIN;
    if (py + PREVIEW_H > ch) py = previewPos.y - PREVIEW_H - PREVIEW_MARGIN;
    return {
      position: "absolute",
      left: px,
      top: py,
      width: PREVIEW_W,
      height: PREVIEW_H,
      zIndex: 200,
      borderRadius: 8,
      overflow: "hidden",
      border: "1.5px solid rgba(99,102,241,0.7)",
      boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
      pointerEvents: "none",
    };
  };

  const getImageFilterStyle = () => {
    switch (imageFilter) {
      case "contrast":
        return "contrast(160%) brightness(105%)";
      case "invert":
        return "invert(100%) hue-rotate(180deg)";
      case "grayscale":
        return "grayscale(100%) contrast(140%)";
      default:
        return "none";
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

        <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem', marginBottom: '1rem' }}>
          <button className="btn btn-primary" onClick={handleFileOpen}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            {t("hintDropFile")}
          </button>
        </div>

        <div className="capture-shortcut-hint">
          <span className="shortcut-label">{t("btnNewCapture")}</span>
          <div className="kbd-group">
            <kbd>Ctrl</kbd>
            <span className="kbd-sep">+</span>
            <kbd>Shift</kbd>
            <span className="kbd-sep">+</span>
            <kbd>X</kbd>
          </div>
        </div>
      </div>
    );
  }

  const { scaleX, scaleY } = getLetterboxParams();
  const currentSelW = startPos && currentPos ? Math.round(Math.abs(currentPos.x - startPos.x) * scaleX) : 0;
  const currentSelH = startPos && currentPos ? Math.round(Math.abs(currentPos.y - startPos.y) * scaleY) : 0;

  return (
    <div
      ref={containerRef}
      className={`capture-container ${imageSrc ? "has-image" : ""} ${isSnippingMode ? "snipping" : ""} ${isDragOver ? "drag-over" : ""}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
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
        <div className="image-filters-toolbar" onClick={(e) => e.stopPropagation()}>
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
              className="filter-pill-btn"
              onClick={onScanAll}
              disabled={loading}
              style={{
                marginLeft: "8px",
                background: "var(--primary-color)",
                color: "white",
                fontWeight: 600,
                border: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px"
              }}
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
      {startPos && previewPos && (
        <div style={getPreviewStyle()}>
          <canvas ref={previewCanvasRef} width={PREVIEW_W} height={PREVIEW_H} style={{ display: 'block' }} />
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            background: 'rgba(0,0,0,0.7)', padding: '3px 8px',
            fontSize: '0.68rem', color: '#fff', textAlign: 'center',
            fontFamily: 'monospace', letterSpacing: '0.04em', fontWeight: 600,
          }}>
            {currentSelW} × {currentSelH} px
          </div>
        </div>
      )}
    </div>
  );
});
