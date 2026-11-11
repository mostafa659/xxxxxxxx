/* ───────────── Image helpers ─────────────
   Camera photos can be 5–10 MB. We decode them off the main thread when possible (createImageBitmap)
   and avoid the slow FileReader → base64 → <img> round trip. */

function drawToJpeg(source, w0, h0, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("تعذّر قراءة الصورة"));
    img.onload = () => resolve(img);
    img.src = src;
  });
}

export async function resizeDataUrl(src, maxSide, quality) {
  const img = await loadImage(src);
  return drawToJpeg(img, img.width, img.height, maxSide, quality);
}

export async function fileToCompressedDataUrl(file, maxSide = 1600, quality = 0.76) {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      const out = drawToJpeg(bmp, bmp.width, bmp.height, maxSide, quality);
      if (bmp.close) bmp.close();
      return out;
    } catch (e) { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return drawToJpeg(img, img.width, img.height, maxSide, quality);
  } finally { URL.revokeObjectURL(url); }
}
