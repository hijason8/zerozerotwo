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

// 用於 inline onclick="fn('...')" 內的字串：先跳脫 JS 字串，再跳脫 HTML 屬性
export function escapeJsAttr(str) {
  const js = String(str == null ? '' : str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return escapeHTML(js);
}

export function safeSetLocal(key, value) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch (e) {
    // 空間不足時移除舊快取，避免留下過期資料；畫面照常以雲端資料顯示
    console.warn(`LocalStorage write failed for key "${key}":`, e);
    try { localStorage.removeItem(key); } catch (_) {}
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

export function parseTournamentDate(val) {
  if (!val) return null;
  let d = new Date(val);
  if (!isNaN(d.getTime())) return d;
  if (typeof val === "string") {
    const cleanStr = val.replace(/上午|下午/g, "").replace(/\//g, "-").trim();
    d = new Date(cleanStr);
    if (!isNaN(d.getTime())) return d;
    const match = val.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    if (match) {
      d = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

export function formatTournamentDate(val, lang = "zh-TW") {
  const d = parseTournamentDate(val);
  if (!d) return "";
  const currentLang = (typeof window !== "undefined" && window.STATE && window.STATE.lang) || lang;
  return d.toLocaleDateString(currentLang === "zh-TW" ? "zh-TW" : "en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function isTransientPlayer(name) {
  if (!name || typeof name !== "string") return false;
  const clean = name.trim();
  // 匹配前綴：臨打、臨時、補位、選手、隊伍、Guest、Player、Team + 編號/代號
  return /^(臨打|臨時|補位|選手|隊伍|Guest|Player|Team)(\s*[-_#]?[0-9A-Za-z]+)?$/i.test(clean);
}

if (typeof window !== "undefined") {
  window.parseTournamentDate = parseTournamentDate;
  window.formatTournamentDate = formatTournamentDate;
  window.isTransientPlayer = isTransientPlayer;
}

