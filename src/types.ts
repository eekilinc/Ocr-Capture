import { TranslationKeys } from "./i18n/translations";

export type ThemeMode = "light" | "dark" | "system";

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CaptureResponse = {
  imagePath: string;
  width: number;
  height: number;
  platformNote: string;
};

export type OcrWord = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  conf: number;
};

export type OcrResponse = {
  text: string;
  engine: string;
  words: OcrWord[];
};

export type MonitorInfo = {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isPrimary: boolean;
};

export type HistoryItem = {
  id: string;
  imageBase64: string;
  text: string;
  date: string;
  starred?: boolean;
};

export type ImageFilters = {
  invert: boolean;
  contrast: number; // 1.0 is neutral
};

export type ToastState = {
  kind: "hidden" | "success" | "error" | "info";
  message: TranslationKeys | string;
};

export type CroppedResponse = {
  imagePath: string;
  width: number;
  height: number;
};

export type ClipboardImageResponse = {
  base64: string;
  imagePath: string;
  width: number;
  height: number;
};

export type TesseractStatus = {
  installed: boolean;
  path?: string;
  version?: string;
};
