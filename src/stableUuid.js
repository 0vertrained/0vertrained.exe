// FNV-1a, four ways, as one 128-bit id written like a UUID: the same run on
// the same day always gets the same id, and any change to it a new one.
export function stableUuid(text) {
  const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((seed, lane) => {
    let hash = (seed ^ (lane * 0x27d4eb2d)) >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i) + lane;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  });
  const hex = words.join("");
  // Version 4 and variant bits, so the result parses as a UUID anywhere.
  const version = `4${hex.slice(13, 16)}`;
  const variant = `${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${version}-${variant}-${hex.slice(20, 32)}`;
}
