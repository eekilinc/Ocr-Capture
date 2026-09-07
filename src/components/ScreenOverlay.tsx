import { useState, useRef, useEffect } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { sounds } from "../lib/soundEffects";
import type { Rect } from "../types";

interface ScreenOverlayProps {
  imageSrc: string;
  onConfirmSelection: (rect: Rect, displayWidth: number, displayHeight: number) => void;
  onCancel: () => void;
}

export const ScreenOverlay = ({
  imageSrc,
  onConfirmSelection,
  onCancel,
}: ScreenOverlayProps) => {
  const { t } = useTranslation();
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // ESC to cancel interactive overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left click only
    e.preventDefault();
    setStartPos({ x: e.clientX, y: e.clientY });
    setCurrentPos({ x: e.clientX, y: e.clientY });
    setIsDrawing(true);
    sounds.playSnipStart();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || !startPos) return;
    setCurrentPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => {
    if (!isDrawing || !startPos || !currentPos) {
      setIsDrawing(false);
      setStartPos(null);
      setCurrentPos(null);
      return;
    }

    const x = Math.min(startPos.x, currentPos.x);
    const y = Math.min(startPos.y, currentPos.y);
    const width = Math.abs(currentPos.x - startPos.x);
    const height = Math.abs(currentPos.y - startPos.y);

    setIsDrawing(false);
    setStartPos(null);
    setCurrentPos(null);

    // Minimum region threshold
    if (width > 8 && height > 8) {
      sounds.playShutter();
      onConfirmSelection(
        { x, y, width, height },
        window.innerWidth,
        window.innerHeight
      );
    }
  };

  const selX = startPos && currentPos ? Math.min(startPos.x, currentPos.x) : 0;
  const selY = startPos && currentPos ? Math.min(startPos.y, currentPos.y) : 0;
  const selW = startPos && currentPos ? Math.abs(currentPos.x - startPos.x) : 0;
  const selH = startPos && currentPos ? Math.abs(currentPos.y - startPos.y) : 0;

  return (
    <div
      ref={containerRef}
      className="screen-overlay-backdrop"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{
        backgroundImage: `url(${imageSrc})`,
      }}
    >
      {/* Dark mask when not drawing */}
      {!isDrawing && <div className="screen-overlay-dim-mask" />}

      {/* Floating instruction pill */}
      <div className="screen-overlay-instruction-pill">
        <span className="overlay-pill-icon">✂️</span>
        <span className="overlay-pill-text">{t("hintDragToSelect")}</span>
        <button
          className="overlay-close-btn"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          title="Esc"
        >
          ✕
        </button>
      </div>

      {/* Active Selection Box with 9999px cutout shadow */}
      {isDrawing && startPos && currentPos && selW > 2 && selH > 2 && (
        <div
          className="screen-overlay-selection-box"
          style={{
            left: selX,
            top: selY,
            width: selW,
            height: selH,
          }}
        >
          {/* Dimension badge */}
          {selW > 30 && selH > 18 && (
            <div className="screen-overlay-dimension-badge">
              {selW} × {selH} px
            </div>
          )}
        </div>
      )}
    </div>
  );
};
