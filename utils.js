// ============================================================
// ZEROZEROTWO UTILITIES & SECURITY HELPERS
// ============================================================

export function escapeHTML(str) {
  if (typeof str !== 'string') return str == null ? '' : String(str);
  return str.replace(/[&<>"']/g, function (match) {
    const escapeMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return escapeMap[match];
  });
}

export function safeSetLocal(key, value) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch (e) {
    console.warn(`LocalStorage write failed for key "${key}":`, e);
  }
}

export function safeGetLocalJSON(key, fallback = {}) {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch (e) {
    console.error(`Error parsing LocalStorage key "${key}":`, e);
    return fallback;
  }
}

export async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str || ''));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
