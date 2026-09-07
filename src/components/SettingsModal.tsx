import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { Store } from "@tauri-apps/plugin-store";
import { useTranslation } from "../hooks/useTranslation";
import { Language } from "../i18n/translations";
import { relaunch } from "@tauri-apps/plugin-process";
import { sounds } from "../lib/soundEffects";

type Tab = "general" | "shortcut" | "ocr" | "appearance" | "about";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
  appVersion: string;
  currentShortcut: string;
  onShortcutUpdate?: (newShortcut: string) => void;
  ocrLanguages: string[];
  onOcrLanguagesUpdate: (langs: string[]) => void;
  autoCopy: boolean;
  onAutoCopyUpdate: (val: boolean) => void;
  alwaysOnTop: boolean;
  onAlwaysOnTopUpdate: (val: boolean) => void;
  appLang: Language;
}

const shortcutToKeys = (shortcut: string) => {
  return shortcut.split("+").map((s) => (s === "Control" ? "Ctrl" : s));
};

export const SettingsModal = ({
  isOpen,
  onClose,
  theme,
  onThemeChange,
  appVersion,
  currentShortcut,
  onShortcutUpdate,
  ocrLanguages,
  onOcrLanguagesUpdate,
  autoCopy,
  onAutoCopyUpdate,
  alwaysOnTop,
  onAlwaysOnTopUpdate,
  appLang,
}: SettingsModalProps) => {
  const { t, setLang: onAppLangChange } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(sounds.isEnabled());
  const [isRecording, setIsRecording] = useState(false);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const [recordError, setRecordError] = useState("");
  const storeRef = useRef<Store | null>(null);
  const [availableLangs, setAvailableLangs] = useState<string[]>(["tur", "eng"]);
  const [tesseractStatus, setTesseractStatus] = useState<{ installed: boolean; path?: string; version?: string } | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const store = await Store.load("settings.json");
        storeRef.current = store;
        const tray = await store.get<boolean>("minimize-to-tray");
        if (tray !== null && tray !== undefined) setMinimizeToTray(tray);
        
        const isAuto = await isEnabled();
        setAutostartEnabled(isAuto);

        try {
          const status = await invoke<{ installed: boolean; path?: string; version?: string }>("check_tesseract_installed");
          setTesseractStatus(status);
        } catch {}

        try {
          const langs = await invoke<string[]>("list_ocr_languages");
          if (langs && langs.length > 0) setAvailableLangs(langs);
        } catch (e) {
          console.error("Failed to fetch languages:", e);
        }
      } catch (e) {
        console.error("Settings initialization failed:", e);
      }
    };
    if (isOpen) init();
  }, [isOpen]);

  const handleAutostartToggle = async (val: boolean) => {
    setAutostartEnabled(val);
    try {
      if (val) await enable();
      else await disable();
    } catch {}
  };

  const handleMinimizeToggle = async (val: boolean) => {
    setMinimizeToTray(val);
    if (storeRef.current) {
      await storeRef.current.set("minimize-to-tray", val);
      await storeRef.current.save();
    }
  };

  const startRecording = () => {
    setIsRecording(true);
    setRecordedKeys([]);
    setRecordError("");
  };

  const cancelRecording = () => {
    setIsRecording(false);
    setRecordedKeys([]);
    setRecordError("");
  };

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        cancelRecording();
        return;
      }

      const mods = [];
      if (e.ctrlKey) mods.push("Control");
      if (e.shiftKey) mods.push("Shift");
      if (e.altKey) mods.push("Alt");
      if (e.metaKey) mods.push("Command");

      const key = e.key === " " ? "Space" : 
                  e.key.length === 1 ? e.key.toUpperCase() : e.key;
      
      const isModifier = ["Control", "Shift", "Alt", "Meta", "OS"].includes(e.key);
      
      if (!isModifier) {
        if (mods.length === 0) {
            setRecordError(t("tipModifierRequired"));
            setRecordedKeys([key]);
            return;
        }

        const newShortcut = [...mods, key].join("+");
        onShortcutUpdate?.(newShortcut);
        setIsRecording(false);
        return;
      }

      setRecordedKeys([...mods]);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isRecording, onShortcutUpdate, t]);

  if (!isOpen) return null;

  const displayKeys = isRecording 
    ? recordedKeys.map(k => k === "Control" ? "Ctrl" : k)
    : shortcutToKeys(currentShortcut);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content settings-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t("settings")}</h3>
          <button className="btn-icon-sm" onClick={onClose} title={t("close")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="sidebar">
            <button className={`sidebar-item ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
              <span>{t("general")}</span>
            </button>
            <button className={`sidebar-item ${activeTab === 'shortcut' ? 'active' : ''}`} onClick={() => setActiveTab('shortcut')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><line x1="6" y1="8" x2="6" y2="8"/><line x1="10" y1="8" x2="10" y2="8"/><line x1="14" y1="8" x2="14" y2="8"/><line x1="18" y1="8" x2="18" y2="8"/><line x1="6" y1="12" x2="6" y2="12"/><line x1="10" y1="12" x2="10" y2="12"/><line x1="14" y1="12" x2="14" y2="12"/><line x1="18" y1="12" x2="18" y2="12"/><line x1="7" y1="16" x2="17" y2="16"/></svg>
              <span>{t("shortcut")}</span>
            </button>
            <button className={`sidebar-item ${activeTab === 'ocr' ? 'active' : ''}`} onClick={() => setActiveTab('ocr')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7V4a2 2 0 0 1 2-2h2"/><path d="M20 7V4a2 2 0 0 0-2-2h-2"/><path d="M4 17v3a2 2 0 0 0 2 2h2"/><path d="M20 17v3a2 2 0 0 1-2 2h-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>
              <span>{t("ocrLang")}</span>
            </button>
            <button className={`sidebar-item ${activeTab === 'appearance' ? 'active' : ''}`} onClick={() => setActiveTab('appearance')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20v-20Z"/></svg>
              <span>{t("appearance")}</span>
            </button>
            <button className={`sidebar-item ${activeTab === 'about' ? 'active' : ''}`} onClick={() => setActiveTab('about')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              <span>{t("about")}</span>
            </button>
          </div>

          <div className="tab-content">
            {activeTab === "general" && (
              <div className="settings-group">
                <div className="setting-item">
                  <div className="setting-label">
                    <div className="setting-label-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6" />
                      </svg>
                    </div>
                    <div>
                      <span>{t("language")}</span>
                      <small>{t("languageDesc")}</small>
                    </div>
                  </div>
                  <select
                    className="format-select"
                    value={appLang}
                    onChange={(e) => onAppLangChange(e.target.value as Language)}
                    style={{ minWidth: '120px' }}
                  >
                    <option value="tr">{t("langTurkish")}</option>
                    <option value="en">{t("langEnglish")}</option>
                  </select>
                </div>

                <div className="setting-item restart-box">
                  <div className="setting-label">
                    <div className="setting-label-icon" style={{ color: 'var(--primary-color)' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                      </svg>
                    </div>
                    <div>
                      <span>{t("restartApp")}</span>
                      <small>{t("restartDesc")}</small>
                    </div>
                  </div>
                  <button className="btn btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.78rem' }} onClick={() => relaunch()}>
                    {t("btnRestart")}
                  </button>
                </div>

                <div className="setting-item">
                  <div className="setting-label">
                    <div className="setting-label-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2v20M2 12h20" />
                      </svg>
                    </div>
                    <div>
                      <span>{t("autostart")}</span>
                      <small>{t("autostartDesc")}</small>
                    </div>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={autostartEnabled} onChange={(e) => handleAutostartToggle(e.target.checked)} />
                    <span className="slider round"></span>
                  </label>
                </div>

                <div className="setting-item">
                  <div className="setting-label">
                    <div className="setting-label-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                        <line x1="7" y1="2" x2="7" y2="22" />
                      </svg>
                    </div>
                    <div>
                      <span>{t("minimizeToTray")}</span>
                      <small>{t("minimizeToTrayDesc")}</small>
                    </div>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={minimizeToTray} onChange={(e) => handleMinimizeToggle(e.target.checked)} />
                    <span className="slider round"></span>
                  </label>
                </div>

                <div className="setting-item">
                  <div className="setting-label">
                    <div className="setting-label-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </div>
                    <div>
                      <span>{t("autoCopy")}</span>
                      <small>{t("autoCopyDesc")}</small>
                    </div>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={autoCopy} onChange={(e) => onAutoCopyUpdate(e.target.checked)} />
                    <span className="slider round"></span>
                  </label>
                </div>

                <div className="setting-item">
                  <div className="setting-label">
                    <div className="setting-label-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="2" width="20" height="20" rx="2" />
                        <path d="M2 12h20M12 2v20" />
                      </svg>
                    </div>
                    <div>
                      <span>{t("alwaysOnTop")}</span>
                      <small>{t("alwaysOnTopDesc")}</small>
                    </div>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={alwaysOnTop} onChange={(e) => onAlwaysOnTopUpdate(e.target.checked)} />
                    <span className="slider round"></span>
                  </label>
                </div>

                <div className="setting-item">
                  <div className="setting-label">
                    <div className="setting-label-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                      </svg>
                    </div>
                    <div>
                      <span>{t("soundEffects")}</span>
                      <small>{t("soundEffectsDesc")}</small>
                    </div>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={soundEnabled}
                      onChange={(e) => {
                        setSoundEnabled(e.target.checked);
                        sounds.setEnabled(e.target.checked);
                        if (e.target.checked) sounds.playSuccess();
                      }}
                    />
                    <span className="slider round"></span>
                  </label>
                </div>
              </div>
            )}

            {activeTab === "appearance" && (
              <div className="settings-group">
                <div className="setting-item" style={{ borderBottom: "none", flexDirection: "column", alignItems: "flex-start", gap: "1rem" }}>
                  <div className="setting-label">
                    <div className="setting-label-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                      </svg>
                    </div>
                    <div>
                      <span>{t("theme")}</span>
                      <small>{t("themeDesc")}</small>
                    </div>
                  </div>
                  <div className="theme-toggle-group">
                    <button className={`theme-btn ${theme === "light" ? "active" : ""}`} onClick={() => onThemeChange("light")}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                      </svg>
                      {t("themeLight")}
                    </button>
                    <button className={`theme-btn ${theme === "dark" ? "active" : ""}`} onClick={() => onThemeChange("dark")}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                      </svg>
                      {t("themeDark")}
                    </button>
                    <button className={`theme-btn ${theme === "system" ? "active" : ""}`} onClick={() => onThemeChange("system")}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                        <line x1="8" y1="21" x2="16" y2="21"></line>
                        <line x1="12" y1="17" x2="12" y2="21"></line>
                      </svg>
                      {t("themeSystem")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "ocr" && (
              <div className="settings-group">
                {tesseractStatus && !tesseractStatus.installed && (
                  <div style={{
                    background: "rgba(244, 63, 94, 0.1)",
                    border: "1px solid var(--danger-color)",
                    borderRadius: "var(--radius-sm)",
                    padding: "0.85rem",
                    marginBottom: "1rem"
                  }}>
                    <div style={{ fontWeight: 600, color: "var(--danger-color)", marginBottom: "0.3rem" }}>
                      {t("tesseractMissingTitle")}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.6rem" }}>
                      {t("tesseractMissingDesc")}
                    </div>
                    <div style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", background: "rgba(0,0,0,0.2)", padding: "0.4rem 0.6rem", borderRadius: "6px" }}>
                      winget install UB-Mannheim.TesseractOCR
                    </div>
                  </div>
                )}
                {tesseractStatus && tesseractStatus.installed && (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    fontSize: "0.8rem",
                    color: "var(--success-color)",
                    marginBottom: "1rem",
                    background: "rgba(16, 185, 129, 0.1)",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "var(--radius-sm)"
                  }}>
                    <span>✓ {tesseractStatus.version || "Tesseract OCR"} ({tesseractStatus.path})</span>
                  </div>
                )}
                <div className="setting-item" style={{ borderBottom: "none", flexDirection: "column", alignItems: "flex-start", gap: "1rem" }}>
                  <div className="setting-label">
                    <div className="setting-label-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 7V4a2 2 0 0 1 2-2h2" /><path d="M20 7V4a2 2 0 0 0-2-2h-2" /><path d="M4 17v3a2 2 0 0 0 2 2h2" /><path d="M20 17v3a2 2 0 0 1-2 2h-2" /><line x1="7" y1="12" x2="17" y2="12" />
                      </svg>
                    </div>
                    <div>
                      <span>{t("ocrLang")}</span>
                      <small>{t("ocrLangDesc")}</small>
                    </div>
                  </div>
                  <div className="lang-chips">
                    {availableLangs.map((lang) => (
                      <button
                        key={lang}
                        className={`lang-chip ${ocrLanguages.includes(lang) ? "active" : ""}`}
                        onClick={() => {
                          const next = ocrLanguages.includes(lang)
                            ? ocrLanguages.filter((l) => l !== lang)
                            : [...ocrLanguages, lang];
                          onOcrLanguagesUpdate(next);
                        }}
                      >
                        {lang}
                      </button>
                    ))}
                  </div>
                  {ocrLanguages.length > 0 && (
                     <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
                        {t("active")}: <code>{ocrLanguages.join("+")}</code>
                     </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "shortcut" && (
              <div className="shortcut-tab-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div className="shortcut-tab-header">
                  <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>{t("globalShortcut")}</h3>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t("globalShortcutDesc")}</p>
                </div>
                
                <div className="shortcut-recorder">
                   <button 
                    className={`shortcut-btn ${isRecording ? 'recording' : ''}`}
                    onClick={isRecording ? cancelRecording : startRecording}
                   >
                     {isRecording ? t("recording") : displayKeys.join(" + ")}
                   </button>
                   {isRecording && (
                     <div className="recording-overlay">
                       {t("cancelRecordingTip")} <kbd>Esc</kbd>
                     </div>
                   )}
                </div>

                {recordError && <p className="shortcut-error" style={{ color: 'var(--danger-color)', fontSize: '0.8rem', margin: 0 }}>{recordError}</p>}
                
                <div className="shortcut-tips" style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                   <div className="shortcut-tip-item" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                    <span className="tip-dot" style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'currentColor' }}></span>
                    <span>{t("tipModifierRequired")}</span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "about" && (
              <div className="about-content">
                <div className="app-logo-large">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="13" r="4"/><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/></svg>
                </div>
                <h2>{t("appName")}</h2>
                <div className="version">v{appVersion}</div>
                <p className="description">{t("appDescription")}</p>
                
                <div className="tech-stack-section">
                  <h4>{t("techStack")}</h4>
                  <div className="tech-grid-premium">
                    <div className="tech-card">
                      <div className="tech-icon" style={{ backgroundColor: "#00d8ff" }}></div>
                      <div className="tech-info">
                        <span className="tech-name">React</span>
                        <span className="tech-role">UI</span>
                      </div>
                    </div>
                    <div className="tech-card">
                      <div className="tech-icon" style={{ backgroundColor: "#2496ed" }}></div>
                      <div className="tech-info">
                        <span className="tech-name">Tauri</span>
                        <span className="tech-role">Core</span>
                      </div>
                    </div>
                    <div className="tech-card">
                      <div className="tech-icon" style={{ backgroundColor: "#3178c6" }}></div>
                      <div className="tech-info">
                        <span className="tech-name">TS</span>
                        <span className="tech-role">Logic</span>
                      </div>
                    </div>
                    <div className="tech-card">
                      <div className="tech-icon" style={{ backgroundColor: "#de5d43" }}></div>
                      <div className="tech-info">
                        <span className="tech-name">Rust</span>
                        <span className="tech-role">Engine</span>
                      </div>
                    </div>
                    <div className="tech-card">
                        <div className="tech-icon" style={{ backgroundColor: "#ff9900" }}></div>
                        <div className="tech-info">
                          <span className="tech-name">Tesseract</span>
                          <span className="tech-role">OCR</span>
                        </div>
                    </div>
                    <div className="tech-card">
                        <div className="tech-icon" style={{ backgroundColor: "#61dafb" }}></div>
                        <div className="tech-info">
                          <span className="tech-name">Vite</span>
                          <span className="tech-role">Tooling</span>
                        </div>
                    </div>
                  </div>
                </div>

                <div className="about-links">
                    <a href="https://github.com/eekilinc/ocr-capture" target="_blank" rel="noreferrer" className="btn btn-secondary">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
                        <span>{t("githubRepo")}</span>
                    </a>
                </div>

                <div className="credits">
                   Developed by Ekrem Kılınç
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
