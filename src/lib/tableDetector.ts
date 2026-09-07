import type { OcrWord } from "../types";

/**
 * Tesseract kelime koordinatlarını (X, Y) analiz ederek satır ve sütunlara ayırır.
 * Excel uyumlu TSV veya Markdown tablo formatına dönüştürür.
 */
export function formatWordsAsTable(words: OcrWord[], format: "tsv" | "markdown"): string {
  if (!words || words.length === 0) return "";

  // 1. Kelimeleri Y (dikey) ve X (yatay) konumuna göre sırala
  const sortedWords = [...words].sort((a, b) => a.y - b.y || a.x - b.x);

  // 2. Ortalama kelime yüksekliğini hesapla
  const avgHeight = words.reduce((sum, w) => sum + w.height, 0) / words.length;
  const rowThreshold = Math.max(8, avgHeight * 0.65);

  // 3. Yakın Y koordinatına sahip kelimeleri aynı satırda grupla
  const rows: OcrWord[][] = [];
  let currentRow: OcrWord[] = [];
  let currentY = sortedWords[0].y;

  for (const word of sortedWords) {
    if (Math.abs(word.y - currentY) <= rowThreshold) {
      currentRow.push(word);
    } else {
      if (currentRow.length > 0) {
        currentRow.sort((a, b) => a.x - b.x);
        rows.push(currentRow);
      }
      currentRow = [word];
      currentY = word.y;
    }
  }
  if (currentRow.length > 0) {
    currentRow.sort((a, b) => a.x - b.x);
    rows.push(currentRow);
  }

  // 4. Sütun boşluklarını tespit et (kelimeler arasındaki belirgin X farkı yeni sütunu belirtir)
  const columnGapThreshold = Math.max(20, avgHeight * 1.4);

  const tableRows: string[][] = rows.map((row) => {
    const cells: string[] = [];
    let currentCell = "";
    let lastRight = -1;

    for (const w of row) {
      if (lastRight !== -1 && w.x - lastRight > columnGapThreshold) {
        cells.push(currentCell.trim());
        currentCell = w.text;
      } else {
        currentCell = currentCell ? `${currentCell} ${w.text}` : w.text;
      }
      lastRight = w.x + w.width;
    }
    if (currentCell) cells.push(currentCell.trim());
    return cells;
  });

  // Maksimum sütun sayısını bul
  const maxCols = Math.max(...tableRows.map((r) => r.length), 1);

  if (format === "tsv") {
    // Excel / Google Sheets formatı (Tab ile ayrılmış)
    return tableRows
      .map((row) => {
        const padded = [...row];
        while (padded.length < maxCols) padded.push("");
        return padded.join("\t");
      })
      .join("\n");
  } else {
    // Markdown tablosu formatı
    if (tableRows.length === 0) return "";
    const header = tableRows[0];
    const paddedHeader = [...header];
    while (paddedHeader.length < maxCols) paddedHeader.push(`Sütun ${paddedHeader.length + 1}`);

    const divider = Array(maxCols).fill("---");
    const bodyRows = tableRows.slice(1).map((row) => {
      const padded = [...row];
      while (padded.length < maxCols) padded.push("");
      return `| ${padded.join(" | ")} |`;
    });

    return [
      `| ${paddedHeader.join(" | ")} |`,
      `| ${divider.join(" | ")} |`,
      ...bodyRows,
    ].join("\n");
  }
}
