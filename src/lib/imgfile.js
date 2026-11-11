/* Saving a picture as a file on the device (share sheet on a phone, download on a computer).
   Shared by the chat picture and the image gallery. An SVG drawing is saved as a PNG (opens everywhere, shares well from a phone);
   the student's pen marks, if any, are merged into the file. */
import { inkOnBlob } from "../components/ImageInk.jsx";

export function svgToPngBlob(src) {
  return new Promise((resolve, reject) => {
    let url = src, w = 1200, h = 800;
    try {   // render from the viewBox at 2400 px (the <img> natural size of an SVG is tiny → blurry PNG)
      const txt = decodeURIComponent(escape(atob(src.split(",")[1])));
      const m = txt.match(/viewBox="\s*[\d.]+[\s,]+[\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
      if (m) { w = +m[1]; h = +m[2]; }
      const k = 2400 / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k);
      const fixed = txt.replace(/<svg\b([^>]*)>/, (a, at) => `<svg${at.replace(/\s(width|height)="[^"]*"/g, "")} width="${w}" height="${h}">`);
      url = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(fixed)));
    } catch (e) { /* keep the original */ }
    const im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
      g.drawImage(im, 0, 0, w, h);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("png"))), "image/png");
    };
    im.onerror = () => reject(new Error("img"));
    im.src = url;
  });
}

/* img: { mime, data(base64) } · marks: array of ink strokes (may be empty) */
export async function saveImageFile(img, marks = []) {
  const src = `data:${img.mime};base64,${img.data}`;
  const svg = img.mime === "image/svg+xml";
  const png = marks.length > 0 || svg;
  const ext = png ? "png" : (img.mime.split("/")[1] || "png").replace("jpeg", "jpg");
  const name = `clinix-${Date.now()}.${ext}`;
  try {
    let blob = svg ? await svgToPngBlob(src) : await (await fetch(src)).blob();
    if (marks.length) blob = await inkOnBlob(blob, marks);
    const file = new File([blob], name, { type: png ? "image/png" : img.mime });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) { await navigator.share({ files: [file] }); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) { /* the student cancelled the share sheet */ }
}
