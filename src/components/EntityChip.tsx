import type { ReactNode } from "react";
import type { DetectedEntity, DetectedEntityType } from "../lib/entityDetector";
import { CopyIcon } from "./icons";

type ChipAction = { label: string; icon: ReactNode; run: (value: string) => void };

type EntityChipProps = {
  entity: DetectedEntity;
  copyLabel: string;
  openLabel: string;
  sendEmailLabel: string;
  onOpenUrl: (url: string) => void;
  onCopy: (entity: DetectedEntity) => void;
};

const TYPE_ICON: Record<DetectedEntityType, ReactNode> = {
  url: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  email: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  iban: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  ),
  phone: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  color: null,
};

const OpenIcon = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const MailIcon = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

/**
 * One chip renders every entity type: the per-type icon and the optional primary
 * action come from the tables above, while the label and copy button are shared.
 */
export const EntityChip = ({
  entity,
  copyLabel,
  openLabel,
  sendEmailLabel,
  onOpenUrl,
  onCopy,
}: EntityChipProps) => {
  const isColor = entity.type === "color";

  const action: ChipAction | null =
    entity.type === "url"
      ? { label: openLabel, icon: OpenIcon, run: (v) => onOpenUrl(v) }
      : entity.type === "email"
        ? { label: sendEmailLabel, icon: MailIcon, run: (v) => onOpenUrl(`mailto:${v}`) }
        : null;

  return (
    <div className={`entity-chip entity-chip-${entity.type}`}>
      {isColor ? (
        <span className="color-preview-box" style={{ backgroundColor: entity.value }} />
      ) : (
        TYPE_ICON[entity.type]
      )}
      <span className={`entity-text ${isColor ? "font-mono" : ""}`} title={entity.value}>
        {isColor ? entity.value : entity.display}
      </span>
      {action && (
        <button className="chip-action-btn" onClick={() => action.run(entity.value)} title={action.label}>
          {action.icon}
        </button>
      )}
      <button className="chip-action-btn" onClick={() => onCopy(entity)} title={copyLabel}>
        <CopyIcon size={10} />
      </button>
    </div>
  );
};