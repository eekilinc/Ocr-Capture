import { useState, useMemo, useRef, useEffect } from "react";
import type { HistoryItem } from "../types";
import { useTranslation } from "../hooks/useTranslation";
import { interpolate } from "../i18n/translations";
import { CopyIcon, StarIcon, CloseIcon, SearchIcon } from "./icons";

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: HistoryItem[];
  onDelete: (id: string) => void;
  onClear: () => void;
  onCopy: (text: string) => void;
  onToggleStar?: (id: string) => void;
  onRestore?: (item: HistoryItem) => void;
}

const NO_DATE_LABEL = "—";

function getRelativeTime(dateStr: string, currentLang: string) {
  const langTag = currentLang === 'tr' ? 'tr-TR' : 'en-US';
  const rtf = new Intl.RelativeTimeFormat(langTag, { numeric: 'auto' });
  const date = new Date(dateStr);

  // A corrupt or missing timestamp used to produce "Invalid Date" / "NaN seconds ago".
  if (Number.isNaN(date.getTime())) return NO_DATE_LABEL;

  const diffInDays = (date.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (Math.abs(diffInDays) > 7) {
     return date.toLocaleDateString(langTag, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  if (Math.abs(diffInDays) >= 1) {
     return rtf.format(Math.round(diffInDays), 'day');
  }
  const diffInHours = (date.getTime() - Date.now()) / (1000 * 60 * 60);
  if (Math.abs(diffInHours) >= 1) {
     return rtf.format(Math.round(diffInHours), 'hour');
  }
  const diffInMinutes = (date.getTime() - Date.now()) / (1000 * 60);
  if (Math.abs(diffInMinutes) >= 1) {
     return rtf.format(Math.round(diffInMinutes), 'minute');
  }
  return rtf.format(Math.round((date.getTime() - Date.now()) / 1000), 'second');
}

export const HistoryModal = ({
  isOpen,
  onClose,
  history,
  onDelete,
  onClear,
  onCopy,
  onToggleStar,
  onRestore,
}: HistoryModalProps) => {
  const { t, lang } = useTranslation();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "starred">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchCopySuccess, setIsBatchCopySuccess] = useState(false);

  const starredCount = useMemo(() => {
    return history.filter(i => i.starred).length;
  }, [history]);

  const filteredHistory = useMemo(() => {
    let list = history;
    if (activeFilter === "starred") {
      list = list.filter((item) => item.starred);
    }
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((item) => item.text.toLowerCase().includes(q));
  }, [history, activeFilter, searchQuery]);

  // How many of the currently visible rows are ticked; batch copy joins exactly these.
  const visibleSelectedCount = useMemo(() => {
    return filteredHistory.reduce((n, item) => n + (selectedIds.has(item.id) ? 1 : 0), 0);
  }, [filteredHistory, selectedIds]);

  // Checked ids were never pruned against the list. Deleting an item left it counted
  // (the header said "copy 3" while only 2 were joined), switching to the Starred tab
  // made the counter disagree with what batch-copy produced, and "Clear all" left a
  // phantom batch button pointing at ids that no longer existed.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(history.map((item) => item.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [history]);

  // Search and filter state outlived a close because `isOpen` only unmounts the DOM.
  useEffect(() => {
    if (isOpen) return;
    setSearchQuery("");
    setActiveFilter("all");
    setSelectedIds(new Set());
    setCopiedId(null);
  }, [isOpen]);

  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
  }, []);

  const handleCopy = (id: string, text: string) => {
    onCopy(text);
    setCopiedId(id);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedId(null), 2000);
  };

  const handleBatchCopy = () => {
    const selectedText = filteredHistory
        .filter(item => selectedIds.has(item.id))
        .map(item => item.text)
        .join('\n\n---\n\n');

    if (selectedText) {
        onCopy(selectedText);
        setIsBatchCopySuccess(true);
        if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
        batchTimerRef.current = setTimeout(() => setIsBatchCopySuccess(false), 2000);
    }
  };

  const toggleSelect = (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectedIds(next);
  };

  const toggleSelectAll = () => {
      const visible = new Set(filteredHistory.map((i) => i.id));
      const allVisibleSelected = visible.size > 0 && [...visible].every((id) => selectedIds.has(id));
      setSelectedIds(allVisibleSelected ? new Set() : visible);
  };

  /** Exports the whole history, not the current filter/search subset. */
  const handleExportHistory = () => {
    const exportData = history.map(item => ({
      date: item.date,
      text: item.text,
      starred: !!item.starred,
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ocr-gecmis-${new Date().toISOString().slice(0, 10)}.json`;
    // The anchor has to be in the document for the click to register, and the object
    // URL can only be revoked after the download has actually started.
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content history-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("history")}
      >
        <div className="modal-header">
          <div className="history-header-row">
            <h3>{t("history")} ({filteredHistory.length}/{history.length})</h3>
            <div className="history-tab-group">
              <button 
                className={`history-tab-btn ${activeFilter === "all" ? "active" : ""}`}
                onClick={() => setActiveFilter("all")}
              >
                {t("filterAll")}
              </button>
              <button 
                className={`history-tab-btn ${activeFilter === "starred" ? "active" : ""}`}
                onClick={() => setActiveFilter("starred")}
              >
                ★ {t("filterStarred")} ({starredCount})
              </button>
            </div>
          </div>

          <div className="header-actions">
            {visibleSelectedCount > 0 && (
              <button
                className={`btn btn-secondary btn-sm ${isBatchCopySuccess ? "success" : ""}`}
                onClick={handleBatchCopy}
              >
                <CopyIcon size={14} strokeWidth={2.5} className="icon-gap" />
                {isBatchCopySuccess ? t("btnCopied") : interpolate(t("copyNItems"), { count: visibleSelectedCount })}
              </button>
            )}

            {history.length > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={handleExportHistory} title={t("btnExportHistory")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </button>
            )}

            {history.length > 0 && (
              <button className="btn-text-danger" onClick={onClear}>
                {t("clearAll")}
              </button>
            )}
            <button className="btn-icon-sm" onClick={onClose} title={t("close")} aria-label={t("close")}>
              <CloseIcon size={20} strokeWidth={2} />
            </button>
          </div>
        </div>

        {history.length > 0 && (
          <div className="history-toolbar">
            <div className="history-search">
              <SearchIcon size={15} className="history-search-icon" />
              <input
                type="text"
                placeholder={t("searchInTexts")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
            </div>
            <button className="btn btn-secondary btn-sm" onClick={toggleSelectAll}>
                {selectedIds.size === filteredHistory.length && filteredHistory.length > 0 ? t("deselectAll") : t("selectAll")}
            </button>
          </div>
        )}

        <div className="history-list">
          {history.length === 0 ? (
            <div className="history-empty-state">
              <div className="history-empty-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </div>
              <p className="history-empty-title">{t("historyEmptyTitle")}</p>
              <p className="history-empty-desc">{t("historyEmptyDesc")}</p>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="history-empty-state">
              <div className="history-empty-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </div>
              <p className="history-empty-title">{t("noResultsFoundTitle")}</p>
              <p className="history-empty-desc">{interpolate(t("noResultsFoundDesc"), { query: searchQuery })}</p>
            </div>
          ) : (
            filteredHistory.map((item) => (
              <div 
                key={item.id} 
                className={`history-item ${selectedIds.has(item.id) ? 'selected' : ''}`}
                onClick={() => toggleSelect(item.id)}
              >
                <div className="history-checkbox" onClick={(e) => e.stopPropagation()}>
                    <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleSelect(item.id)}
                    />
                </div>
                <div className="history-image">
                  <img src={item.imageBase64} alt="capture" />
                </div>
                <div className="history-content">
                  <div className="history-meta">
                    <div className="history-meta-row">
                      <button
                        className={`star-btn ${item.starred ? "starred" : ""}`}
                        onClick={(e) => { e.stopPropagation(); onToggleStar?.(item.id); }}
                        title={t("btnStar")}
                        aria-label={t("btnStar")}
                        aria-pressed={!!item.starred}
                      >
                        <StarIcon size={14} filled={!!item.starred} />
                      </button>
                      <span className="date" title={new Date(item.date).toLocaleString()}>
                        {getRelativeTime(item.date, lang)}
                      </span>
                    </div>
                    <button className="btn-icon-sm danger" onClick={(e) => { e.stopPropagation(); onDelete(item.id); }} title={t("btnDelete")}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  </div>
                  <div className="history-text">
                    <p>{item.text || t("noTextFound")}</p>
                  </div>
                  <div className="history-actions">
                    {onRestore && (
                      <button 
                        className="btn-sm secondary" 
                        onClick={(e) => { e.stopPropagation(); onRestore(item); }}
                        title={t("btnRestore")}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                        <span>{t("btnRestore")}</span>
                      </button>
                    )}
                    <button className={`btn-sm ${copiedId === item.id ? "success" : "secondary"}`} onClick={(e) => { e.stopPropagation(); handleCopy(item.id, item.text); }} disabled={!item.text}>
                      {copiedId === item.id ? t("btnCopied") : t("btnCopyText")}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
