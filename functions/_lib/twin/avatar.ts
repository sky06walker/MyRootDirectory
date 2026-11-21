import type { Env } from "../common";
import { cached } from "./cv";
import type { Checked } from "./settings";

// The avatar lives in KV as content-addressed binary blobs (`twin_avatar:<hash>`), with ONE small
// pointer key (`twin_avatar_hash`) naming the current one. It is deliberately separate from the
// settings record: changing the picture never touches the AI configuration. Only PNG and WebP
// are accepted (what a canvas produces; no SVG, and no JPEG so no EXIF/GPS metadata).

export const AVATAR_POINTER_KEY = "twin_avatar_hash";
export const AVATAR_PREFIX = "twin_avatar:";
export const AVATAR_MAX_BYTES = 100 * 1024;
export const AVATAR_MAX_DATA_URL_CHARS = Math.ceil((AVATAR_MAX_BYTES * 4) / 3) + 64;
export const AVATAR_MIN_DIMENSION = 16;
export const AVATAR_MAX_DIMENSION = 512;

export type AvatarType = "image/png" | "image/webp";

export interface AvatarImage {
  bytes: Uint8Array;
  type: AvatarType;
  width: number;
  height: number;
}

const bad = (message: string): { ok: false; message: string } => ({ ok: false, message });
const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(start, start + length));

/** Image type and size from the file's own header bytes (never from the declared data-URL type). */
export function sniffImage(bytes: Uint8Array): { type: AvatarType; width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length >= 24 && pngSignature.every((b, i) => bytes[i] === b) && ascii(bytes, 12, 4) === "IHDR") {
    return { type: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  }

  if (bytes.length >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return {
        type: "image/webp",
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return { type: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
      return {
        type: "image/webp",
        width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
        height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
      };
    }
  }
  return null;
}

export function parseAvatarDataUrl(input: unknown): Checked<AvatarImage> {
  if (typeof input !== "string" || input.length > AVATAR_MAX_DATA_URL_CHARS) {
    return bad(`Avatar must be an image of at most ${AVATAR_MAX_BYTES / 1024} KB.`);
  }
  const match = /^data:image\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input);
  if (!match) return bad("Avatar must be a PNG or WebP image.");

  let bytes: Uint8Array;
  try {
    const binary = atob(match[2]);
    bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return bad("Avatar data is not valid base64.");
  }
  if (bytes.length > AVATAR_MAX_BYTES) return bad(`Avatar must be at most ${AVATAR_MAX_BYTES / 1024} KB.`);

  const sniffed = sniffImage(bytes);
  if (!sniffed) return bad("The file is not a valid PNG or WebP image.");
  if (`image/${match[1]}` !== sniffed.type) return bad("The image type does not match its contents.");
  const { width, height } = sniffed;
  if (
    width < AVATAR_MIN_DIMENSION ||
    height < AVATAR_MIN_DIMENSION ||
    width > AVATAR_MAX_DIMENSION ||
    height > AVATAR_MAX_DIMENSION
  ) {
    return bad(`Avatar must be between ${AVATAR_MIN_DIMENSION} and ${AVATAR_MAX_DIMENSION} pixels in each direction.`);
  }
  return { ok: true, value: { bytes, type: sniffed.type, width, height } };
}

/** First 128 bits of SHA-256, hex: names the blob and busts caches (immutable URL per picture). */
export async function avatarHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const isAvatarHash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{32}$/.test(value);

/** Hash of the current custom avatar, or null (visitors then get the built-in picture). */
export const loadAvatarHash = (env: Env): Promise<string | null> =>
  cached("avatar", async () => {
    const value = await env.CV_DATA.get(AVATAR_POINTER_KEY);
    return isAvatarHash(value) ? value : null;
  });
