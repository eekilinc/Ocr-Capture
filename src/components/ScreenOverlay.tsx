import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { sounds } from "../lib/soundEffects";
import type { Rect } from "../types";

interface ScreenOverlayProps {
  imageSrc: string;
  onConfirmSelection: (rect: Rect, displayWidth: number, displayHeight: number) => void;
  onCancel: () => void;
}

type Point = { x: number; y: number };

const MIN_REGION_PX = 8;

export const ScreenOverlay = ({
  imageSrc,
  onConfirmSelection,
  onCancel,
}: ScreenOverlayProps) => {
  const { t } = useTranslation();
  const [startPos, setStartPos] = useState<Point | null>(null);
  const [currentPos, setCurrentPos] = useState<Point | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

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

  const finishSelection = useCallback(() => {
    setIsDrawing(false);

    if (!startPos || !currentPos) {
      setStartPos(null);
      setCurrentPos(null);
      return;
    }

    const x = Math.min(startPos.x, currentPos.x);
    const y = Math.min(startPos.y, currentPos.y);
    const width = Math.abs(currentPos.x - startPos.x);
    const height = Math.abs(currentPos.y - startPos.y);

    setStartPos(null);
    setCurrentPos(null);

    if (width > MIN_REGION_PX && height > MIN_REGION_PX) {
      sounds.playShutter();
      onConfirmSelection({ x, y, width, height }, window.innerWidth, window.innerHeight);
    }
  }, [startPos, currentPos, onConfirmSelection]);

  // Drag tracking lives on the window while drawing. Releasing the button outside the
  // overlay -- or losing focus -- used to leave isDrawing stuck true, with no way to
  // start another selection.
  useEffect(() => {
    if (!isDrawing) return;

    const handleMove = (e: MouseEvent) => {
      if (!startPos) return;
      setCurrentPos({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", finishSelection);
    window.addEventListener("pointercancel", finishSelection);
    window.addEventListener("blur", finishSelection);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", finishSelection);
      window.removeEventListener("pointercancel", finishSelection);
      window.removeEventListener("blur", finishSelection);
    };
  }, [isDrawing, startPos, finishSelection]);

  const selX = startPos && currentPos ? Math.min(startPos.x, currentPos.x) : 0;
  const selY = startPos && currentPos ? Math.min(startPos.y, currentPos.y) : 0;
  const selW = startPos && currentPos ? Math.abs(currentPos.x - startPos.x) : 0;
  const selH = startPos && currentPos ? Math.abs(currentPos.y - startPos.y) : 0;

  return (
    <div
      className="screen-overlay-backdrop"
      onMouseDown={handleMouseDown}
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
          aria-label={t("close")}
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