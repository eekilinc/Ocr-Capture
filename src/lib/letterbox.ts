import type { Rect } from "../types";

export type LetterboxParams = {
  /** Offset of the rendered image inside its container, in CSS pixels. */
  offsetX: number;
  offsetY: number;
  /** Scale factor from rendered CSS pixels to natural image pixels. */
  scaleX: number;
  scaleY: number;
  renderedWidth: number;
  renderedHeight: number;
};

const IDENTITY: LetterboxParams = {
  offsetX: 0,
  offsetY: 0,
  scaleX: 1,
  scaleY: 1,
  renderedWidth: 0,
  renderedHeight: 0,
};

/** Exported so callers can opt out of letterbox correction without rebuilding the shape. */
export const IDENTITY_LETTERBOX = IDENTITY;

/**
 * Geometry for an image letterboxed inside a container (`object-fit: contain`).
 *
 * This lived twice before -- once in SnippingArea for the drag preview and once in
 * image.ts for the crop -- and the two copies could drift apart and silently crop the
 * wrong pixels.
 */
export const getLetterboxParams = (
  naturalWidth: number,
  naturalHeight: number,
  containerWidth: number,
  containerHeight: number,
): LetterboxParams => {
  if (!naturalWidth || !naturalHeight || !containerWidth || !containerHeight) return IDENTITY;

  const naturalAspect = naturalWidth / naturalHeight;
  const containerAspect = containerWidth / containerHeight;

  if (naturalAspect > containerAspect) {
    // Wider than the container: letterboxed top and bottom.
    const renderedWidth = containerWidth;
    const renderedHeight = containerWidth / naturalAspect;
    return {
      offsetX: 0,
      offsetY: (containerHeight - renderedHeight) / 2,
      scaleX: naturalWidth / renderedWidth,
      scaleY: naturalHeight / renderedHeight,
      renderedWidth,
      renderedHeight,
    };
  }

  // Taller than the container: pillarboxed left and right.
  const renderedHeight = containerHeight;
  const renderedWidth = containerHeight * naturalAspect;
  return {
    offsetX: (containerWidth - renderedWidth) / 2,
    offsetY: 0,
    scaleX: naturalWidth / renderedWidth,
    scaleY: naturalHeight / renderedHeight,
    renderedWidth,
    renderedHeight,
  };
};

/** Converts a rect given in container CSS pixels into natural image pixels. */
export const rectToNaturalPixels = (rect: Rect, params: LetterboxParams): Rect => ({
  x: Math.max(0, Math.floor((rect.x - params.offsetX) * params.scaleX)),
  y: Math.max(0, Math.floor((rect.y - params.offsetY) * params.scaleY)),
  width: Math.max(1, Math.floor(rect.width * params.scaleX)),
  height: Math.max(1, Math.floor(rect.height * params.scaleY)),
});