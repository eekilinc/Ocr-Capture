import jsQR from "jsqr";

/**
 * Scans a base64 image for a QR code.
 */
export async function scanQrCode(base64: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      // getImageData/jsQR can throw (tainted canvas, huge allocation, malformed
      // pixel data). Without this the promise never settles and every caller
      // awaiting it -- including the whole OCR pipeline -- hangs forever.
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        resolve(code ? code.data : null);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = base64;
  });
}
