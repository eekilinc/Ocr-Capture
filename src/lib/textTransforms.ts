export function toUpperCaseTR(text: string): string {
  return text.toLocaleUpperCase("tr-TR");
}

export function toLowerCaseTR(text: string): string {
  return text.toLocaleLowerCase("tr-TR");
}

/**
 * Title-cases each line independently.
 *
 * Splitting the whole text on /\s+/ and rejoining with a single space destroyed every
 * line break, collapsing a whole OCR document into one paragraph.
 */
export function toTitleCaseTR(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => {
          const first = word.charAt(0).toLocaleUpperCase("tr-TR");
          const rest = word.slice(1).toLocaleLowerCase("tr-TR");
          return first + rest;
        })
        .join(" ")
    )
    .join("\n");
}

/**
 * Trims trailing/leading space per line and squeezes runs of spaces, while collapsing
 * runs of blank lines to a single paragraph break instead of deleting them.
 */
export function cleanExtraWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function joinIntoSingleParagraph(text: string): string {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
}

export function convertToBulletList(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
    .join("\n");
}

export function getTextStats(text: string) {
  const characters = text.length;
  const charactersNoSpaces = text.replace(/\s/g, "").length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const lines = text ? text.split("\n").length : 0;
  return { characters, charactersNoSpaces, words, lines };
}