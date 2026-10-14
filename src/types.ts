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
};

export type OcrWord = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  conf: number;
};

/** Mirrors the Rust `OcrInput` payload (ocr.rs), all fields optional. */
export type OcrInput = {
  imageBase64?: string;
  imagePath?: string;
  languages?: string;
  enhance?: boolean;
  crop?: Rect;
};

export type OcrResponse = {
  text: string;
  engine: string;
  words: OcrWord[];
  /** Size of the preprocessed image the word coordinates refer to. */
  imageWidth: number;
  imageHeight: number;
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
  /** Already resolved to display text by showToast. */
  message: string;
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
