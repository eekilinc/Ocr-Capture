import { useState, useEffect, useRef, memo, useMemo, useDeferredValue, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { OcrWord, Rect } from "../types";
import { useTranslation } from "../hooks/useTranslation";
import { interpolate, type TranslationKeys } from "../i18n/translations";
import { detectEntities, DetectedEntity } from "../lib/entityDetector";
import {
  toUpperCaseTR,
  toLowerCaseTR,
  toTitleCaseTR,
  cleanExtraWhitespace,
  joinIntoSingleParagraph,
  convertToBulletList,
  getTextStats,
} from "../lib/textTransforms";
import { formatWordsAsTable, type ColumnLabelFn } from "../lib/tableDetector";
import { EntityChip } from "./EntityChip";
import { CopyIcon, SearchIcon, GridIcon, CollapseIcon } from "./icons";

import { sounds } from "../lib/soundEffects";

type CopyFormat = "plain" | "markdown" | "single" | "table_tsv" | "table_markdown";

/** Only used when the backend did not report the OCR'd image size. */
const LEGACY_SCALE = 2.5;

/** User input goes into a RegExp, so metacharacters have to be neutralised first. */
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type ResultPanelProps = {
  text: string;
  onTextChange?: (newText: string) => void;
  loading: boolean;
  onCopy: (formattedText: string) => void;
  engine: string;
  error: string;
  words: OcrWord[];
  /** Size of the preprocessed image the word coordinates refer to (from the backend). */
  ocrImageSize?: { w: number; h: number } | null;
  captureImage: string | null;
  capturePath?: string | null;
  selections: Rect[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  qrResult: string | null;
  onToast?: (kind: "success" | "error" | "info", message: TranslationKeys | string) => void;
};

function formatText(
  text: string,
  format: CopyFormat,
  words: OcrWord[] = [],
  columnLabel?: ColumnLabelFn,
): string {
  switch (format) {
    case "table_tsv":
      if (words && words.length > 0) {
        return formatWordsAsTable(words, "tsv", columnLabel);
      }
      return text;
    case "table_markdown":
      if (words && words.length > 0) {
        return formatWordsAsTable(words, "markdown", columnLabel);
      }
      return text;
    case "markdown":
      return text
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n");
    case "single":
      return joinIntoSingleParagraph(text);
    case "plain":
    default:
      return text;
  }
}

export const ResultPanel = memo(({
  text,
  onTextChange,
  loading,
  onCopy,
  engine,
  error,
  words,
  ocrImageSize,
  captureImage,
  capturePath,
  selections,
  isCollapsed,
  onToggleCollapse,
  qrResult,
  onToast,
}: ResultPanelProps) => {
  const { t, lang } = useTranslation();
  const [copyLabel, setCopyLabel] = useState("");
  const [copyFormat, setCopyFormat] = useState<CopyFormat>("plain");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showWordMap, setShowWordMap] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [hoveredWord, setHoveredWord] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgDisplaySize, setImgDisplaySize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    setCopyLabel(t("btnCopy"));
  }, [t]);

  useEffect(() => {
    if (copyLabel === t("btnCopied")) {
      const timer = setTimeout(() => setCopyLabel(t("btnCopy")), 2000);
      return () => clearTimeout(timer);
    }
  }, [copyLabel, t]);

  useEffect(() => {
    if (!showWordMap || !imgRef.current) return;
    const obs = new ResizeObserver(() => {
      if (imgRef.current) {
        setImgDisplaySize({
          w: imgRef.current.clientWidth,
          h: imgRef.current.clientHeight,
        });
      }
    });
    obs.observe(imgRef.current);
    return () => obs.disconnect();
  }, [showWordMap]);

  // The textarea is fully controlled, so without deferring these scans every keystroke
  // re-runs five entity regexes and four full text passes over the whole OCR output.
  // The panel stays responsive while the expensive derivations catch up.
  const deferredText = useDeferredValue(text);

  // Word coordinates are relative to the image Tesseract saw. When the app cropped in the
// browser, `captureImage` is still the full screenshot, so the words must be placed
// inside the selection rect instead of being stretched across the whole image.
const currentRect = selections[selections.length - 1];
const showWordsOverSelection = showWordMap && !!currentRect;

const wordFrame = useMemo(() => {
  if (!imgDisplaySize.w || !imgDisplaySize.h) return null;
  if (!showWordsOverSelection) {
    // The capture itself is the OCR'd image (full-screen / overlay flows).
    return { left: 0, top: 0, width: imgDisplaySize.w, height: imgDisplaySize.h };
  }
  return {
    left: currentRect.x,
    top: currentRect.y,
    width: currentRect.width,
    height: currentRect.height,
  };
}, [imgDisplaySize, currentRect, showWordsOverSelection]);

// Detect smart entities (URLs, Emails, IBANs, Colors, Phones)
  const detectedEntities = useMemo(() => {
    return detectEntities(deferredText);
  }, [deferredText]);

  // Calculate text statistics
  const stats = useMemo(() => {
    return getTextStats(deferredText);
  }, [deferredText]);

  // Search match count
  const searchMatchCount = useMemo(() => {
    if (!searchQuery.trim() || !text) return 0;
    try {
      const regex = new RegExp(escapeRegExp(searchQuery), "gi");
      const matches = text.match(regex);
      return matches ? matches.length : 0;
    } catch {
      return 0;
    }
  }, [text, searchQuery]);

  const columnLabel = useCallback<ColumnLabelFn>(
    (i) => interpolate(t("tableColumnLabel"), { index: i }),
    [t]
  );

  const handleCopyClick = () => {
    onCopy(formatText(text, copyFormat, words, columnLabel));
    setCopyLabel(t("btnCopied"));
    sounds.playSuccess();
  };

  const handleSearchWeb = () => {
    if (!text.trim()) return;
    const query = encodeURIComponent(text.slice(0, 300));
    const url = `https://www.google.com/search?q=${query}`;
    handleOpenUrl(url);
  };

  const handleReplaceOne = () => {
    if (!searchQuery || !onTextChange) return;
    try {
      // The match has to be located in the ORIGINAL string. Using
      // `text.toLowerCase().indexOf(...)` and slicing `text` with that index silently
      // corrupted Turkish text: "İ".toLowerCase() is two UTF-16 units ("i" + U+0307),
      // so every index after the first dotted capital İ was shifted.
      const regex = new RegExp(escapeRegExp(searchQuery), "i");
      const match = regex.exec(text);
      if (!match) return;
      const newText = text.slice(0, match.index) + replaceQuery + text.slice(match.index + match[0].length);
      onTextChange(newText);
      sounds.playTick();
    } catch (err) {
      console.error("Replace failed:", err);
    }
  };

  const handleReplaceAll = () => {
    if (!searchQuery || !onTextChange) return;
    try {
      const regex = new RegExp(escapeRegExp(searchQuery), "gi");
      const newText = text.replace(regex, replaceQuery);
      onTextChange(newText);
      sounds.playSuccess();
    } catch (err) {
      console.error("Replace all failed:", err);
    }
  };

  const handleSpeak = () => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    if (text.match(/[şŞıİçÇöÖüÜğĞ]/)) {
      utterance.lang = "tr-TR";
    } else {
      utterance.lang = "en-US";
    }
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  // Stop any in-flight narration when the panel goes away.
  useEffect(() => () => {
    window.speechSynthesis.cancel();
  }, []);

  const handleOpenUrl = async (url: string) => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  const handleCopyEntity = (entity: DetectedEntity) => {
    navigator.clipboard
      .writeText(entity.value)
      .then(() => onToast?.("success", `${entity.display} ${t("toastTextCopied")}`))
      .catch((err) => {
        console.error("Entity copy failed:", err);
        onToast?.("error", t("toastCopyFailed"));
      });
  };

  const handleCopyQr = () => {
    if (!qrResult) return;
    navigator.clipboard
      .writeText(qrResult)
      .then(() => {
        setCopyLabel(t("btnCopied"));
        sounds.playSuccess();
      })
      .catch((err) => {
        console.error("QR copy failed:", err);
        onToast?.("error", t("toastCopyFailed"));
      });
  };

  const handleTranslate = async () => {
    if (!text.trim()) return;
    const targetLang = lang === "tr" ? "en" : "tr";
    // encodeURIComponent expands each non-ASCII char to 9 bytes, so a few thousand
    // Turkish characters produced a ~36 KB URL that Windows ShellExecute rejects --
    // and the webview's window.open fallback is a no-op. Truncate like the web search
    // does and say so, instead of the button silently doing nothing.
    const MAX_CHARS = 1500;
    const payload = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text;
    handleOpenUrl(`https://translate.google.com/?sl=auto&tl=${targetLang}&text=${encodeURIComponent(payload)}&op=translate`);
  };

  const handleExportText = async () => {
    if (!text) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const filePath = await save({
        defaultPath: `ocr-metin-${new Date().toISOString().slice(0, 10)}.txt`,
        filters: [{ name: "Text File", extensions: ["txt", "md"] }],
      });
      if (!filePath) return;

      await invoke("save_text_file", {
        content: text,
        destinationPath: filePath,
      });
      onToast?.("success", t("toastFileSaved"));
    } catch (err) {
      console.error("Save text failed:", err);
      onToast?.("error", t("toastExportFailed"));
    }
  };

  const handleExportImage = async () => {
    if (!captureImage && !capturePath) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const filePath = await save({
        defaultPath: `ocr-gorsel-${new Date().toISOString().slice(0, 10)}.png`,
        filters: [{ name: "PNG Image", extensions: ["png", "jpg", "jpeg"] }],
      });
      if (!filePath) return;

      await invoke("save_file_to_disk", {
        sourcePath: capturePath || null,
        base64Data: captureImage && captureImage.startsWith("data:") ? captureImage : null,
        destinationPath: filePath,
      });
      onToast?.("success", t("toastFileSaved"));
    } catch (err) {
      console.error("Save image failed:", err);
      onToast?.("error", t("toastExportFailed"));
    }
  };

  const handleTransform = (transformer: (t: string) => string) => {
    if (!text) return;
    const updated = transformer(text);
    onTextChange?.(updated);
  };

  // Word coordinates come from the preprocessed image the backend actually OCR'd, so
  // normalising against its reported size is exact. The selection width is only a
  // fallback for responses that predate the imageWidth/imageHeight fields.
  const sourceW = ocrImageSize?.w || (currentRect ? currentRect.width * LEGACY_SCALE : 0);
  const sourceH = ocrImageSize?.h || (currentRect ? currentRect.height * LEGACY_SCALE : 0);
  const hasWords = words.length > 0;

  // Collapsed Sidebar View
  if (isCollapsed) {
    return (
      // The whole rail is the single click target; a nested button here would fire twice
      // and is not reachable by keyboard, so this is a role="button" instead.
      <article
        className="panel collapsed-clickable"
        onClick={onToggleCollapse}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleCollapse();
          }
        }}
        role="button"
        tabIndex={0}
        title={t("btnExpand")}
        aria-label={t("btnExpand")}
      >
        <div className="collapsed-rail">
          <CollapseIcon size={18} />
          <span className="collapsed-vertical-title">{t("panelTitle")}</span>
          {text && <span className="collapsed-dot-indicator" title={t("collapsedHasText")} />}
        </div>
      </article>
    );
  }

  return (
    <article className="panel result-panel-container">
      <div className="panel-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <h2 className="panel-title">{t("panelTitle")}</h2>
          {engine && (
            <span className="engine-badge">
              {engine.split(" ")[0]}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          {text && !loading && !error && (
            <button
              className={`btn-icon-sm ${showSearch ? "active" : ""}`}
              onClick={() => setShowSearch((v) => !v)}
              title={t("searchInResult")}
            >
              <SearchIcon />
            </button>
          )}

          {hasWords && !loading && !error && captureImage && (
            <button
              className={`btn btn-secondary btn-icon-sm ${showWordMap ? "active" : ""}`}
              onClick={() => setShowWordMap((v) => !v)}
              title={t("btnWordMap")}
            >
              <GridIcon />
            </button>
          )}

          {captureImage && (
            <button
              className="btn-icon-sm"
              onClick={handleExportImage}
              title={t("btnExportImage")}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
            </button>
          )}

          {text && (
            <button
              className="btn-icon-sm"
              onClick={handleExportText}
              title={t("btnExportText")}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            </button>
          )}

          <button className="btn-icon-sm" onClick={onToggleCollapse} title={t("btnCollapse")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
        </div>
      </div>

      <div className="panel-content result-panel-content">
        {loading ? (
          <div className="result-empty-state">
            <div className="result-empty-icon pulse">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
            </div>
            <p className="result-empty-title">{t("analyzing")}</p>
            <p className="result-empty-desc">{t("pleaseWait")}</p>
          </div>
        ) : error ? (
          <div className="result-empty-state" style={{ color: "var(--danger-color)" }}>
            <div className="result-empty-icon" style={{ borderColor: 'var(--danger-color)', color: 'var(--danger-color)' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            </div>
            <p className="result-empty-title">{t("toastOcrError")}</p>
            <p className="result-empty-desc">{error}</p>
          </div>
        ) : showWordMap && captureImage ? (
          <div className="word-map-container">
            <div className="word-map-image-wrapper">
              <img
                ref={imgRef}
                src={captureImage}
                alt="OCR"
                className="word-map-image"
                onLoad={() => {
                  if (imgRef.current) {
                    setImgDisplaySize({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight });
                  }
                }}
              />
              {imgDisplaySize.w > 0 && sourceW > 0 && wordFrame &&
                words.map((word, i) => {
                  // Normalise inside the frame the words actually belong to.
                  const px = wordFrame.left + (word.x / sourceW) * wordFrame.width;
                  const py = wordFrame.top + (word.y / sourceH) * wordFrame.height;
                  const pw = (word.width / sourceW) * wordFrame.width;
                  const ph = (word.height / sourceH) * wordFrame.height;
                  const isHovered = hoveredWord === `${i}`;
                  return (
                    <div
                      key={i}
                      className={`word-highlight ${isHovered ? "hovered" : ""} ${word.conf < 60 ? "low-conf" : ""}`}
                      style={{ left: px, top: py, width: pw, height: ph }}
                      onMouseEnter={() => setHoveredWord(`${i}`)}
                      onMouseLeave={() => setHoveredWord(null)}
                      title={`${word.text} (${Math.round(word.conf)}%)`}
                    />
                  );
                })
              }
            </div>
          </div>
        ) : (
          <div className="result-flow-layout">
            {/* QR Card */}
            {qrResult && (
              <div className="qr-result-card">
                <div className="qr-header">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
                  <span>{t("qrDetected")}</span>
                </div>
                <div className="qr-body">
                  <p>{qrResult}</p>
                  <button className="btn-icon-sm" onClick={handleCopyQr} title={t("btnCopyQr")} aria-label={t("btnCopyQr")}>
                    <CopyIcon />
                  </button>
                </div>
              </div>
            )}

            {/* Smart Entity Action Chips */}
            {detectedEntities.length > 0 && (
              <div className="entity-chips-container">
                <div className="entity-chips-title">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                  <span>{t("detectedEntities")}</span>
                </div>
                <div className="entity-chips-list">
                  {detectedEntities.map((entity, idx) => (
                    <EntityChip
                      key={`${entity.type}:${entity.value}:${idx}`}
                      entity={entity}
                      copyLabel={t("btnCopy")}
                      openLabel={t("btnOpenInBrowser")}
                      sendEmailLabel={t("btnSendEmail")}
                      onOpenUrl={handleOpenUrl}
                      onCopy={handleCopyEntity}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Text Transformation Toolbar */}
            {text && (
              <div className="text-transforms-toolbar">
                <button className="transform-pill-btn" onClick={() => handleTransform(toUpperCaseTR)} title={t("btnUppercase")}>
                  {t("btnUppercase")}
                </button>
                <button className="transform-pill-btn" onClick={() => handleTransform(toLowerCaseTR)} title={t("btnLowercase")}>
                  {t("btnLowercase")}
                </button>
                <button className="transform-pill-btn" onClick={() => handleTransform(toTitleCaseTR)} title={t("btnTitlecase")}>
                  {t("btnTitlecase")}
                </button>
                <button className="transform-pill-btn" onClick={() => handleTransform(cleanExtraWhitespace)} title={t("btnCleanWhitespace")}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10H3M21 6H3M21 14H3M21 18H3" /></svg>
                  <span>{t("btnCleanWhitespace")}</span>
                </button>
                <button className="transform-pill-btn" onClick={() => handleTransform(convertToBulletList)} title={t("btnBulletList")}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
                </button>
                <div style={{ flex: 1 }} />
                <button className="transform-pill-btn" onClick={handleSearchWeb} title={t("btnSearchWeb")}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  <span>{t("btnSearchWeb")}</span>
                </button>
                <button className="transform-pill-btn translate-btn" onClick={() => handleTranslate()} title={t("btnTranslate")}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                  <span>{t("btnTranslate")}</span>
                </button>
              </div>
            )}

            {/* In-Result Search & Replace Bar */}
            {showSearch && text && (
              <div className="result-search-bar-container">
                <div className="result-search-bar">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  <input
                    type="text"
                    className="result-search-input"
                    placeholder={t("searchInResult")}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                  />
                  {searchQuery && (
                    <span className="search-match-badge">
                      {interpolate(t("matchCount"), { count: searchMatchCount })}
                    </span>
                  )}
                  <button
                    className={`btn-icon-xs ${showReplace ? "active" : ""}`}
                    onClick={() => setShowReplace((v) => !v)}
                    title={t("btnFindReplace")}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
                  </button>
                  <button className="btn-icon-xs" onClick={() => { setSearchQuery(""); setShowSearch(false); setShowReplace(false); }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
                {showReplace && (
                  <div className="result-replace-bar">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.6 }}><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /></svg>
                    <input
                      type="text"
                      className="result-search-input"
                      placeholder={t("replaceWith")}
                      value={replaceQuery}
                      onChange={(e) => setReplaceQuery(e.target.value)}
                    />
                    <button
                      className="btn-replace-action"
                      onClick={handleReplaceOne}
                      disabled={!searchQuery}
                    >
                      {t("btnReplace")}
                    </button>
                    <button
                      className="btn-replace-action"
                      onClick={handleReplaceAll}
                      disabled={!searchQuery}
                    >
                      {t("btnReplaceAll")}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Textarea Area */}
            {text ? (
              <div className="result-textarea-wrapper">
                <textarea
                  className="result-textarea"
                  value={text}
                  onChange={(e) => onTextChange?.(e.target.value)}
                  spellCheck={false}
                  placeholder={t("waitingResult")}
                />
                <div className="result-stats-bar">
                  <span>{stats.characters} {t("statsChars")}</span>
                  <span>•</span>
                  <span>{stats.words} {t("statsWords")}</span>
                  <span>•</span>
                  <span>{stats.lines} {t("statsLines")}</span>
                </div>
              </div>
            ) : (
              <div className="result-empty-state">
                <div className="result-empty-icon">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
                </div>
                <p className="result-empty-title">{engine ? t("noTextFound") : t("waitingResult")}</p>
                <p className="result-empty-desc">{engine ? t("noTextDesc") : t("waitingDesc")}</p>
              </div>
            )}

            {/* Bottom Action Controls */}
            {text && (
              <div className="result-bottom-action-bar">
                <select
                  className="format-select"
                  value={copyFormat}
                  onChange={(e) => setCopyFormat(e.target.value as CopyFormat)}
                >
                  <option value="plain">{t("formatPlain")}</option>
                  <option value="markdown">{t("formatMarkdown")}</option>
                  <option value="single">{t("formatSingle")}</option>
                  {words && words.length > 0 && (
                    <>
                      <option value="table_tsv">{t("formatTable")}</option>
                      <option value="table_markdown">{t("formatMarkdownTable")}</option>
                    </>
                  )}
                </select>

                <button className="btn btn-secondary btn-icon-sm" onClick={handleSpeak} title={isSpeaking ? t("btnStop") : t("btnSpeak")}>
                  {isSpeaking ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
                  )}
                </button>

                <button className="btn btn-primary btn-copy-main" onClick={handleCopyClick}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  <span>{copyLabel}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
});
