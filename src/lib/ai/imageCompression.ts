/**
 * Client-side image compression utilities for offline-first Firestore persistence
 * and fast local Gemini Nano multimodal tokenization.
 * Targets maxWidth 512px, JPEG quality <= 0.65, strictly under 150KB.
 */

const MAX_BYTES = 150 * 1024;
const MAX_WIDTH = 512;

export async function compressImageToBase64(file: File): Promise<string> {
  console.log("[Image Pipeline] 1. Raw file received:", {
    name: file.name,
    sizeKB: Number((file.size / 1024).toFixed(2)),
    mimeType: file.type || "unknown",
  });

  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadHtmlImage(dataUrl);

  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;

  if (width > MAX_WIDTH) {
    height = Math.round((height * MAX_WIDTH) / width);
    width = MAX_WIDTH;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable for image compression.");
  }

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // Step down JPEG quality from 0.65 until strictly under 150KB
  let quality = 0.65;
  let result = canvas.toDataURL("image/jpeg", quality);

  while (estimateBase64Bytes(result) > MAX_BYTES && quality > 0.35) {
    quality = Number((quality - 0.1).toFixed(2));
    result = canvas.toDataURL("image/jpeg", quality);
  }

  // If still above 150KB on unusually complex textures, scale dimensions down further
  if (estimateBase64Bytes(result) > MAX_BYTES) {
    const scale = 0.7;
    canvas.width = Math.max(1, Math.round(canvas.width * scale));
    canvas.height = Math.max(1, Math.round(canvas.height * scale));
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    result = canvas.toDataURL("image/jpeg", 0.55);
  }

  const finalBytes = estimateBase64Bytes(result);
  console.log("[Image Pipeline] 2. Canvas compressed base64 ready:", {
    finalBytes,
    finalKB: Number((finalBytes / 1024).toFixed(2)),
    mimeType: "image/jpeg",
    dimensions: `${canvas.width}x${canvas.height}`,
    base64Length: result.length,
  });

  return result;
}

export type SupportedImageMimeType = "image/jpeg" | "image/png";

export async function normalizeImageForInlineData(
  imageSource: string
): Promise<{ data: string; mimeType: SupportedImageMimeType } | null> {
  if (!imageSource) return null;

  if (imageSource.startsWith("data:")) {
    const match = imageSource.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const rawMime = (match[1] || "image/jpeg").toLowerCase();
    if (rawMime === "image/jpeg" || rawMime === "image/png") {
      return { mimeType: rawMime, data: match[2] };
    }
    // Re-encode unsupported image formats (e.g., webp/gif/avif) to JPEG <= 800px
    if (typeof window !== "undefined") {
      try {
        const res = await fetch(imageSource);
        const blob = await res.blob();
        const file = new File([blob], "capture.jpg", { type: blob.type || "image/jpeg" });
        const compressed = await compressImageToBase64(file);
        return normalizeImageForInlineData(compressed);
      } catch {
        return { mimeType: "image/jpeg", data: match[2] };
      }
    }
    return { mimeType: "image/jpeg", data: match[2] };
  }

  // Convert local sample public asset URL (e.g., /images/agri-field-blight.jpg) into JPEG base64
  if (typeof window !== "undefined" && imageSource.startsWith("/")) {
    try {
      const response = await fetch(imageSource);
      if (!response.ok) return null;
      const blob = await response.blob();
      const file = new File([blob], "sample.jpg", { type: blob.type || "image/jpeg" });
      const compressed = await compressImageToBase64(file);
      return normalizeImageForInlineData(compressed);
    } catch {
      return null;
    }
  }

  return null;
}

export function estimateBase64Bytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(",");
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  return Math.ceil((base64.length * 3) / 4);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read file as Data URL."));
      }
    };
    reader.onerror = () => reject(new Error("FileReader error while loading image."));
    reader.readAsDataURL(file);
  });
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image for compression."));
    img.src = src;
  });
}
