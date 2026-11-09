export const maxBytes = 10 * 1024 * 1024;
export const mediaTypes: readonly string[] = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm"];

export function matchesMediaFormat(buffer: ArrayBuffer, mime: string) {
  const bytes = new Uint8Array(buffer);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
  const begins = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  switch (mime) {
    case "image/jpeg": return begins(0xff, 0xd8, 0xff);
    case "image/png": return begins(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/webp": return ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
    case "image/gif": return ["GIF87a", "GIF89a"].includes(ascii(0, 6));
    case "video/mp4": return ascii(4, 4) === "ftyp" && ascii(8, 4).length === 4 && ascii(8, 4) !== "qt  ";
    case "video/webm": return begins(0x1a, 0x45, 0xdf, 0xa3) && ascii(0, 128).includes("webm");
    default: return false;
  }
}
