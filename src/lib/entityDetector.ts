export type DetectedEntityType = "url" | "email" | "iban" | "phone" | "color";

export interface DetectedEntity {
  type: DetectedEntityType;
  value: string;
  display: string;
  raw: string;
}

export function detectEntities(text: string): DetectedEntity[] {
  if (!text || text.trim().length === 0) return [];

  const entities: DetectedEntity[] = [];
  const seenValues = new Set<string>();

  const addEntity = (type: DetectedEntityType, value: string, display?: string) => {
    const key = `${type}:${value.trim().toLowerCase()}`;
    if (!seenValues.has(key)) {
      seenValues.add(key);
      entities.push({
        type,
        value: value.trim(),
        display: (display || value).trim(),
        raw: value.trim(),
      });
    }
  };

  // 1. URLs
  const urlRegex = /(?:https?:\/\/|www\.)[a-zA-Z0-9][-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&//=]*)/gi;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    let url = match[0];
    if (url.startsWith("www.")) {
      url = "https://" + url;
    }
    // Clean trailing punctuation
    url = url.replace(/[.,;!?)]+$/, "");
    addEntity("url", url, url.length > 30 ? url.substring(0, 27) + "..." : url);
  }

  // 2. Emails
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  while ((match = emailRegex.exec(text)) !== null) {
    addEntity("email", match[0]);
  }

  // 3. IBAN (Turkey and general IBAN format)
  const ibanRegex = /\bTR\s*(?:\d\s*){24}\b/gi;
  while ((match = ibanRegex.exec(text)) !== null) {
    const rawIban = match[0].replace(/\s+/g, "").toUpperCase();
    if (rawIban.length === 26) {
      // Format with spaces: TRxx xxxx xxxx xxxx xxxx xxxx xx
      const formatted = rawIban.replace(/(.{4})/g, "$1 ").trim();
      addEntity("iban", rawIban, formatted);
    }
  }

  // 4. Phone Numbers (TR mobile & landline patterns)
  const phoneRegex = /(?:\+?90\s*|\b0\s*)?(?:5\d{2}|[2-4]\d{2})\s*(?:\d\s*){7}\b/g;
  while ((match = phoneRegex.exec(text)) !== null) {
    const digitsOnly = match[0].replace(/\D/g, "");
    if (digitsOnly.length >= 10 && digitsOnly.length <= 12) {
      addEntity("phone", match[0].trim());
    }
  }

  // 5. HEX Color Codes (#RGB, #RRGGBB, #RRGGBBAA)
  const hexColorRegex = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
  while ((match = hexColorRegex.exec(text)) !== null) {
    addEntity("color", match[0].toUpperCase());
  }

  return entities;
}
