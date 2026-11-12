// ============================================================
// ZEROZEROTWO - LINE LIFF INTEGRATION & OFFICIAL ACCOUNT MODULE
// 負責 LINE LIFF 身分驗證、會員雲端社團同步、Profile 彈窗、官方帳號與分享
// ============================================================

import {
  ref,
  get,
  update
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { escapeHTML } from "./utils.js?v=20261112-12";

import {
  STATE,
  t,
  showToast,
  navigateTo,
  renderLiveUI
} from "./globals.js?v=20261112-12";

const LIFF_ID = (typeof window !== "undefined" && window.LIFF_ID) || "2012043789-KvKpHLCt";
const LIFF_URL = (typeof window !== "undefined" && window.LIFF_URL) || "https://liff.line.me/2012043789-KvKpHLCt";
const LINE_OA_URL = (typeof window !== "undefined" && window.LINE_OA_URL) || "https://line.me/R/ti/p/@451lupmp";
const LINE_OA_ID = (typeof window !== "undefined" && window.LINE_OA_ID) || "@451lupmp";
const RELOGIN_FLAG = "zz_line_relogin_tried"; // 憑證過期時自動重新登入只試一次（存在 sessionStorage，關掉分頁就清除）

// ============================================================
// LINE 登入除錯紀錄：網址加 ?debug=1 開啟，畫面下方即時列出登入流程每一步。
// 紀錄存在 sessionStorage（同一分頁跳轉後仍保留，關掉分頁就清除），不記錄使用者代號。
// ============================================================
const DEBUG_KEY = "zz_line_debug_log";
const DEBUG_ON_KEY = "zz_line_debug_on";

function isLineDebugOn() {
  try {
    const params = new URLSearchParams(window.location.search);
    const liffState = params.get("liff.state") || "";
    if (params.get("debug") === "1" || /(^|[?&])debug=1(&|$)/.test(decodeURIComponent(liffState))) {
      sessionStorage.setItem(DEBUG_ON_KEY, "1");
      return true;
    }
    return sessionStorage.getItem(DEBUG_ON_KEY) === "1";
  } catch (e) { return false; }
}

export function lineDebug(msg) {
  if (!isLineDebugOn()) return;
  let log = [];
  try { log = JSON.parse(sessionStorage.getItem(DEBUG_KEY) || "[]"); } catch (e) { }
  const now = new Date();
  const ts = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.${String(now.getMilliseconds()).padStart(3, "0").slice(0, 1)}`;
  log.push(`${ts} ${msg}`);
  log = log.slice(-40);
  try { sessionStorage.setItem(DEBUG_KEY, JSON.stringify(log)); } catch (e) { }
  renderLineDebugPanel(log);
}

function renderLineDebugPanel(log) {
  if (typeof document === "undefined" || !document.body) return;
  let panel = document.getElementById("zz-line-debug-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "zz-line-debug-panel";
    panel.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;max-height:45vh;overflow:auto;z-index:99999;background:rgba(15,22,19,.92);color:#e6eee9;font:11px/1.45 ui-monospace,Menlo,monospace;padding:8px 10px;border-radius:10px;white-space:pre-wrap;word-break:break-all;";
    document.body.appendChild(panel);
  }
  panel.textContent = "LINE 登入除錯（截圖給開發者）\n" + log.join("\n");
  panel.scrollTop = panel.scrollHeight;
}

// 去掉 LINE 登入回傳的參數，作為重新登入後要回來的網址
function cleanCurrentUrl() {
  const u = new URL(window.location.href);
  ["code", "state", "liffClientId", "liff.state", "liffRedirectUri"].forEach(k => u.searchParams.delete(k));
  return u.toString();
}

// ============================================================
// FIREBASE RTDB: USER PROFILE & CLUBS MODULE
// ============================================================
export async function syncUserProfileToFirebase(profile) {
  const STATE = window.STATE || {};
  if (!STATE.db || !profile || !profile.userId) return null;
  const userId = profile.userId;
  const userRef = ref(STATE.db, `users/${userId}`);

  try {
    const snap = await get(userRef);
    const existing = snap.exists() ? snap.val() : {};

    const updates = {
      displayName: profile.displayName || existing.displayName || "LINE 球友",
      pictureUrl: profile.pictureUrl || existing.pictureUrl || "",
      lastLoginAt: Date.now(),
    };

    if (!existing.myClubs) {
      updates.myClubs = {};
    }

    // 寫入在背景完成，不必等待
    update(userRef, updates).catch((e) => console.warn("[Firebase] syncUserProfile write failed:", e));

    return {
      ...existing,
      ...updates,
      myClubs: existing.myClubs || {},
    };
  } catch (err) {
    console.warn("[Firebase] syncUserProfile failed:", err);
    return null;
  }
}

export async function fetchUserClubsFromFirebase(userId) {
  const STATE = window.STATE || {};
  if (!STATE.db || !userId) return [];
  const clubsRef = ref(STATE.db, `users/${userId}/myClubs`);

  try {
    const snap = await get(clubsRef);
    if (!snap.exists()) return [];
    const rawClubs = snap.val() || {};
    return Object.keys(rawClubs).filter((k) => rawClubs[k]).map(c => decodeURIComponent(c));
  } catch (err) {
    console.warn("[Firebase] fetchUserClubs failed:", err);
    return [];
  }
}

export async function addUserClubToFirebase(clubName) {
  const STATE = window.STATE || {};
  if (!clubName || !clubName.trim()) return;
  await waitForLineReady();
  if (!STATE.lineReady || !STATE.lineUserId) return;
  const safeClub = clubName.trim();

  if (!STATE.myClubs) STATE.myClubs = [];
  if (!STATE.myClubs.includes(safeClub)) {
    STATE.myClubs.push(safeClub);
  }

  try {
    localStorage.setItem(`pb_my_clubs_${STATE.lineUserId}`, JSON.stringify(STATE.myClubs));
    localStorage.setItem("pb_last_club", safeClub);
  } catch (e) { }

  if (STATE.db && STATE.lineUserId) {
    try {
      const updates = {};
      updates[`users/${STATE.lineUserId}/myClubs/${encodeURIComponent(safeClub)}`] = true;
      updates[`users/${STATE.lineUserId}/lastClub`] = safeClub;
      await update(ref(STATE.db), updates);
    } catch (err) {
      console.warn("[Firebase] addUserClub failed:", err);
    }
  }

  if (typeof window.populateNavClubSelect === "function") {
    window.populateNavClubSelect();
  }
  if (typeof window.updateNavClubSelectValue === "function") {
    window.updateNavClubSelectValue();
  }
}

// ============================================================
// LINE LIFF INTEGRATION & USER STATUS (STRICT DUAL TRACK)
// ============================================================
// 網站一開啟會先沿用「上次登入的 LINE 帳號」讓畫面快速出現，但這只是暫時身分。
// 加入社團、綁定身分等會寫入帳號資料的動作，要等 LINE 登入確認完成（lineReady）才執行。
let resolveLineReady;
const lineReadyPromise = new Promise(resolve => { resolveLineReady = resolve; });

function markLineReady() {
  const STATE = window.STATE || {};
  STATE.lineReady = true;
  resolveLineReady();
}

// 等待 LINE 登入確認完成；逾時仍未完成回傳 false
export async function waitForLineReady(timeoutMs = 8000) {
  const STATE = window.STATE || {};
  if (STATE.lineReady) return true;
  await Promise.race([lineReadyPromise, new Promise(resolve => setTimeout(resolve, timeoutMs))]);
  return !!STATE.lineReady;
}

export async function initLiffAndUser() {
  const STATE = window.STATE || {};
  if (!Array.isArray(STATE.myClubs)) STATE.myClubs = [];

  if (!window.liff) {
    console.info("[LIFF] SDK not found, running in guest mode.");
    STATE.lineUserId = null;
    STATE.lineProfile = null;
    STATE.myClubs = [];
    try { localStorage.removeItem("pb_last_line_uid"); } catch (e) { }
    updateNavLineProfileUI();
    if (typeof window.populateNavClubSelect === "function") window.populateNavClubSelect();
    markLineReady();
    return;
  }

  try {
    lineDebug(`開始初始化｜網址 ${window.location.pathname}${window.location.search.slice(0, 80)}｜含Line字樣=${/Line\//i.test(navigator.userAgent || "")}`);
    await liff.init({ liffId: LIFF_ID });
    STATE.isLiff = true;
    lineDebug(`初始化完成｜網頁視窗內=${liff.isInClient()}｜已登入=${liff.isLoggedIn()}｜工具版本=${liff.getVersion ? liff.getVersion() : "?"}`);

    if (liff.isLoggedIn()) {
      closeLineLoginPromptModal();

      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has("code") || urlParams.has("state") || urlParams.has("liffClientId") || urlParams.has("liff.state")) {
        urlParams.delete("code");
        urlParams.delete("state");
        urlParams.delete("liffClientId");
        urlParams.delete("liff.state");
        const newSearch = urlParams.toString();
        const cleanUrl = window.location.pathname + (newSearch ? `?${newSearch}` : "");
        window.history.replaceState({}, document.title, cleanUrl);
      }

      let profile;
      try {
        profile = await liff.getProfile();
        try { sessionStorage.removeItem(RELOGIN_FLAG); } catch (e) { }
        lineDebug("取得暱稱成功 ✓");
      } catch (profileErr) {
        lineDebug(`取得暱稱失敗：${profileErr && profileErr.message}`);
        // LINE 工具存著過期的登入憑證：以為已登入，但取資料被拒（The access token expired）。
        // 清掉過期憑證；不在 LINE 網頁視窗時自動重新登入一次（同一個分頁只試一次，避免無限重試）。
        console.warn("[LIFF] getProfile failed, clearing stale token:", profileErr);
        try { liff.logout(); } catch (e) { }
        let alreadyTried = false;
        try { alreadyTried = sessionStorage.getItem(RELOGIN_FLAG) === "1"; } catch (e) { }
        if (!liff.isInClient() && !alreadyTried) {
          try { sessionStorage.setItem(RELOGIN_FLAG, "1"); } catch (e) { }
          lineDebug("已清除過期憑證 → 自動重新登入");
          liff.login({ redirectUri: cleanCurrentUrl() });
          return;
        }
        if (liff.isInClient() && !alreadyTried) {
          // LINE 網頁視窗內不能呼叫 liff.login()，重新開啟 LIFF 網址，讓 LINE 重新自動登入、換新憑證
          try { sessionStorage.setItem(RELOGIN_FLAG, "1"); } catch (e) { }
          lineDebug("網頁視窗內憑證過期 → 已清除，重新開啟讓 LINE 自動登入");
          const u = new URL(window.location.href);
          ["code", "state", "liffClientId", "liff.state", "liffRedirectUri"].forEach(k => u.searchParams.delete(k));
          window.location.replace(`https://liff.line.me/${LIFF_ID}${u.search}`);
          return;
        }
        lineDebug("已清除過期憑證；這個分頁已自動試過，不再重試");
        throw profileErr;
      }
      STATE.lineUserId = profile.userId;
      STATE.lineProfile = profile;
      try { localStorage.setItem("pb_last_line_uid", profile.userId); } catch (e) { }

      if (profile.displayName) {
        localStorage.setItem("pb_my_player_name", profile.displayName);
        if (STATE.tournamentData && STATE.tournamentData.status === "registering") {
          if (typeof window.renderLiveUI === "function") window.renderLiveUI(STATE.tournamentData);
        }
      }

      let waitCount = 0;
      while (!STATE.db && waitCount < 20) {
        await new Promise(r => setTimeout(r, 100));
        waitCount++;
      }

      const userData = await syncUserProfileToFirebase(profile);

      if (userData && userData.myClubs) {
        const cloudClubs = Object.keys(userData.myClubs).map(c => decodeURIComponent(c));
        STATE.myClubs = cloudClubs;
        try {
          localStorage.setItem(`pb_my_clubs_${STATE.lineUserId}`, JSON.stringify(STATE.myClubs));
        } catch (e) { }

        if (userData.lastClub && !STATE.currentClub) {
          if (Array.isArray(STATE.myClubs) && STATE.myClubs.includes(userData.lastClub)) {
            STATE.currentClub = userData.lastClub;
          } else {
            STATE.currentClub = (STATE.myClubs && STATE.myClubs.length > 0) ? STATE.myClubs[0] : null;
          }
        }
      } else {
        try {
          const cached = JSON.parse(localStorage.getItem(`pb_my_clubs_${STATE.lineUserId}`) || "[]");
          STATE.myClubs = Array.isArray(cached) ? cached : [];
        } catch (e) {
          STATE.myClubs = [];
        }
      }

      if (STATE.currentClub && Array.isArray(STATE.myClubs) && STATE.myClubs.includes(STATE.currentClub)) {
        addUserClubToFirebase(STATE.currentClub).catch(() => { });
      }

      console.info(`[LIFF] Logged in successfully: ${profile.displayName} (${profile.userId}), Clubs:`, STATE.myClubs);

      STATE.userBindings = STATE.userBindings || {};
      if (STATE.db && Array.isArray(STATE.myClubs) && STATE.myClubs.length > 0) {
        // 各社團的身分綁定同時查詢，不再一個一個排隊
        await Promise.all(STATE.myClubs.map(async (clubName) => {
          const safeClub = typeof window.encodeClubKey === "function" ? window.encodeClubKey(clubName) : encodeURIComponent(clubName.trim()).replace(/\./g, "%2E");
          try {
            const snap = await get(ref(STATE.db, `club_mappings/${safeClub}/${STATE.lineUserId}`));
            if (snap.exists() && snap.val()) {
              const bName = String(snap.val()).trim();
              STATE.userBindings[clubName] = bName;
              localStorage.setItem(`pb_bound_name_${clubName}`, bName);
              if (STATE.currentClub === clubName) {
                STATE.clubPlayerName = bName;
              }
            }
          } catch (e) { }
        }));
      }

      try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith("pb_bound_name_") && k !== "pb_bound_name___general__") {
            const cName = k.replace("pb_bound_name_", "");
            if (!Array.isArray(STATE.myClubs) || !STATE.myClubs.includes(cName)) {
              keysToRemove.push(k);
            }
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
      } catch (e) { }

      // ?page=hub 現在是獨立的「臨打賽事」頁，登入後保留原頁面；實際切換頁面由 initApp 統一處理

      if (typeof window.populateNavClubSelect === "function") {
        window.populateNavClubSelect();
      }

      if (STATE.currentClub && typeof window.checkAndPromptClubIdentityClaim === "function") {
        window.checkAndPromptClubIdentityClaim(STATE.currentClub);
      }
    } else {
      const isLineBrowser = /Line\//i.test(navigator.userAgent || "");
      let alreadyTried = false;
      try { alreadyTried = sessionStorage.getItem(RELOGIN_FLAG) === "1"; } catch (e) { }
      if ((liff.isInClient() || isLineBrowser) && !alreadyTried) {
        try { sessionStorage.setItem(RELOGIN_FLAG, "1"); } catch (e) { }
        if (liff.isInClient()) {
          // LINE 網頁視窗內不能呼叫 liff.login()，重新開啟 LIFF 網址讓 LINE 自動登入
          lineDebug("網頁視窗內未登入 → 重新開啟 LIFF 網址");
          const search = window.location.search || "";
          window.location.replace(`https://liff.line.me/${LIFF_ID}${search}`);
        } else {
          // LINE 內建瀏覽器：依 LINE 文件直接呼叫 liff.login()
          lineDebug("LINE 內建瀏覽器未登入 → 呼叫登入");
          liff.login({ redirectUri: cleanCurrentUrl() });
        }
        return;
      }
      if (alreadyTried) lineDebug("未登入；這個分頁已自動試過登入，不再重試（可按右上角手動登入）");

      const urlParams = new URLSearchParams(window.location.search);
      const hadOAuthParams = urlParams.has("code") || urlParams.has("state") || urlParams.has("liffClientId");
      if (hadOAuthParams) {
        urlParams.delete("code");
        urlParams.delete("state");
        urlParams.delete("liffClientId");
        urlParams.delete("liff.state");
        const newSearch = urlParams.toString();
        const cleanUrl = window.location.pathname + (newSearch ? `?${newSearch}` : "");
        window.history.replaceState({}, document.title, cleanUrl);

        const isZh = STATE.lang === "zh-TW";
        setTimeout(() => {
          showToast(
            isZh
              ? "⚠️ 私密/無痕瀏覽模式阻擋了 LINE 登入憑證儲存。請切換至一般分頁或在 LINE App 內開啟！"
              : "⚠️ Private browsing mode blocked LINE login credentials. Please use normal browsing mode or open in LINE App.",
            "error",
            8000
          );
        }, 600);
      }

      STATE.lineUserId = null;
      STATE.lineProfile = null;
      STATE.myClubs = [];
      try { localStorage.removeItem("pb_last_line_uid"); } catch (e) { }
      console.info("[LIFF] Not logged in, running in guest mode.");
      if (typeof window.populateNavClubSelect === "function") {
        window.populateNavClubSelect();
      }
    }
  } catch (err) {
    lineDebug(`發生錯誤：${err && (err.code ? err.code + " " : "") + (err.message || err)}`);
    console.warn("[LIFF] Initialization error (safe fallback enabled):", err);
    try { localStorage.removeItem("pb_last_line_uid"); } catch (e) { }
    STATE.lineUserId = null;
    STATE.lineProfile = null;
    STATE.myClubs = [];
  } finally {
    lineDebug(`結束｜右上角=${STATE.lineProfile ? "已登入" : "未登入"}`);
    updateNavLineProfileUI();
    if (typeof window.populateNavClubSelect === "function") {
      window.populateNavClubSelect();
    }
    markLineReady();
    checkOaFriendship();
  }
}

export function updateNavLineProfileUI() {
  const container = document.getElementById("nav-line-profile-container");
  if (!container) return;

  const STATE = window.STATE || {};
  const isZh = STATE.lang === "zh-TW";
  const profile = STATE.lineProfile;

  if (profile && profile.displayName) {
    const avatarHtml = profile.pictureUrl
      ? `<img src="${profile.pictureUrl}" alt="${escapeHTML(profile.displayName)}" class="w-5 h-5 sm:w-6 sm:h-6 rounded-full object-cover border border-[#06C755]" />`
      : `<span class="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-[#06C755] text-white flex items-center justify-center text-[10px] font-bold">L</span>`;

    container.innerHTML = `
      <button type="button" onclick="openLineProfileModal()"
        class="flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-1 rounded-xl card-inner border hover:border-[#06C755] transition shadow-sm active:scale-95 cursor-pointer max-w-[100px] sm:max-w-[150px] shrink-0"
        title="${isZh ? `LINE 已連動：${escapeHTML(profile.displayName)}` : `Logged in: ${escapeHTML(profile.displayName)}`}">
        <div class="relative shrink-0">
          ${avatarHtml}
          <span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#06C755] ring-1 ring-white dark:ring-slate-900"></span>
        </div>
        <span class="text-xs font-bold truncate text-stone-800 dark:text-stone-200">${escapeHTML(profile.displayName)}</span>
      </button>
    `;
  } else {
    container.innerHTML = `
      <button type="button" onclick="handleLineLoginClick()"
        class="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-xl bg-[#06C755]/10 hover:bg-[#06C755]/20 text-[#06C755] border border-[#06C755]/30 hover:border-[#06C755] transition shadow-sm active:scale-95 text-xs font-bold cursor-pointer shrink-0"
        title="${isZh ? '尚未連動 LINE，點擊查看與登入' : 'LINE Not Connected, click to login'}">
        <svg class="w-3.5 h-3.5 fill-current shrink-0" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 5.82 2 10.53c0 2.93 1.77 5.51 4.45 6.98-.19.7-.7 2.54-.8 2.92-.12.47.17.46.36.33.15-.1 2.37-1.61 3.33-2.27.87.16 1.76.24 2.66.24 5.52 0 10-3.82 10-8.53S17.52 2 12 2z"/>
        </svg>
        <span class="text-[11px] sm:text-xs whitespace-nowrap">${isZh ? "未登入 LINE" : "LINE Login"}</span>
      </button>
    `;
  }
}

// 是否在 LINE App 裡面（LIFF 瀏覽器或 LINE 內建瀏覽器）
// LINE 裡的登入由 LINE 自動完成，登出後可能無法自動登入回來，所以 LINE 裡不提供登出
function isInsideLineApp() {
  const inClient = !!(window.liff && typeof liff.isInClient === "function" && liff.isInClient());
  return inClient || /Line\//i.test(navigator.userAgent || "");
}

export function openLineProfileModal() {
  const modal = document.getElementById("modal-line-profile-info");
  if (!modal) return;
  const STATE = window.STATE || {};
  const profile = STATE.lineProfile;
  if (!profile) {
    openLineLoginPromptModal();
    return;
  }
  const avatarEl = document.getElementById("line-modal-profile-avatar");
  if (avatarEl) {
    if (profile.pictureUrl) {
      avatarEl.src = profile.pictureUrl;
      avatarEl.style.display = "block";
    } else {
      avatarEl.style.display = "none";
    }
  }
  const nameEl = document.getElementById("line-modal-profile-name");
  if (nameEl) nameEl.innerText = profile.displayName || "LINE 球友";
  const defNameEl = document.getElementById("line-modal-default-name");
  if (defNameEl) defNameEl.innerText = profile.displayName || "未設定";

  const logoutBtn = document.getElementById("btn-line-logout");
  if (logoutBtn) logoutBtn.classList.toggle("hidden", isInsideLineApp());

  modal.classList.remove("hidden");
  if (window.lucide) lucide.createIcons();
}

export function closeLineProfileModal() {
  const modal = document.getElementById("modal-line-profile-info");
  if (modal) modal.classList.add("hidden");
}

export function openLineLoginPromptModal() {
  const modal = document.getElementById("modal-line-login-prompt");
  if (modal) {
    modal.classList.remove("hidden");
    if (window.lucide) lucide.createIcons();
  }
}

export function closeLineLoginPromptModal() {
  const modal = document.getElementById("modal-line-login-prompt");
  if (modal) modal.classList.add("hidden");
}

// 按登入時，如果 LINE 工具自認已登入、網站卻沒拿到使用者資料，代表憑證已失效，先清掉才能重新登入
function clearStaleLineToken() {
  const STATE = window.STATE || {};
  if (window.liff && typeof liff.isLoggedIn === "function" && liff.isLoggedIn() && !STATE.lineProfile) {
    try { liff.logout(); } catch (e) { }
  }
  try { sessionStorage.removeItem(RELOGIN_FLAG); } catch (e) { }
}

export function handleLineLoginClick() {
  lineDebug(`按下登入｜已登入=${window.liff && liff.isLoggedIn ? liff.isLoggedIn() : "?"}`);
  clearStaleLineToken();
  if (window.liff && typeof liff.isLoggedIn === "function" && !liff.isLoggedIn()) {
    try {
      liff.login({ redirectUri: cleanCurrentUrl() });
      return;
    } catch (e) {
      console.warn("[LIFF] liff.login() error, fallback to LIFF URL:", e);
    }
  }
  const search = window.location.search || "";
  window.location.href = `https://liff.line.me/${LIFF_ID}${search}`;
}

export function triggerLineLoginAction() {
  closeLineLoginPromptModal();
  lineDebug(`按下登入（提示視窗）｜已登入=${window.liff && liff.isLoggedIn ? liff.isLoggedIn() : "?"}`);
  clearStaleLineToken();
  if (window.liff && typeof liff.isLoggedIn === "function" && !liff.isLoggedIn()) {
    try {
      liff.login({ redirectUri: cleanCurrentUrl() });
      return;
    } catch (e) {
      console.warn("[LIFF] triggerLineLoginAction error, fallback to LIFF URL:", e);
    }
  }
  const search = window.location.search || "";
  window.location.href = `https://liff.line.me/${LIFF_ID}${search}`;
}

export function handleLineLogoutOrSwitch() {
  const STATE = window.STATE || {};
  if (isInsideLineApp()) {
    showToast(STATE.lang === "zh-TW" ? "在 LINE 裡會自動使用目前的 LINE 帳號，無法登出" : "Inside LINE, your current LINE account is used automatically", "info");
    closeLineProfileModal();
    return;
  }
  if (window.liff && liff.isLoggedIn()) {
    const oldUserId = STATE.lineUserId;
    try {
      liff.logout();
    } catch (e) {
      console.warn("[LIFF] liff.logout error:", e);
    }

    STATE.lineProfile = null;
    STATE.lineUserId = null;
    STATE.myClubs = [];
    STATE.currentClub = null;
    STATE.clubPlayerName = null;

    localStorage.removeItem("pb_last_line_uid");
    localStorage.removeItem("pb_my_clubs");
    localStorage.removeItem("pb_last_club");
    localStorage.removeItem("pb_my_player_name");
    localStorage.removeItem("pb_custom_player_name");
    localStorage.removeItem("my_player_name");
    localStorage.removeItem("pb_tournaments");
    if (oldUserId) {
      localStorage.removeItem(`pb_my_clubs_${oldUserId}`);
    }
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("pb_bound_name_") || k.startsWith("pb_my_clubs_"))) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) { }

    STATE.hubView = "all";

    updateNavLineProfileUI();
    closeLineProfileModal();

    if (typeof window.populateNavClubSelect === "function") {
      window.populateNavClubSelect();
    }

    navigateTo("hub");
  } else {
    triggerLineLoginAction();
  }
}

// ============================================================
// LINE OFFICIAL ACCOUNT & USER GUIDE HELPERS
// ============================================================
export function openLineOAModal() {
  const modal = document.getElementById("modal-line-oa");
  if (!modal) return;
  const qrImg = document.getElementById("line-oa-qr-img");
  const idDisplay = document.getElementById("line-oa-id-display");
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(LINE_OA_URL)}`;
  }
  if (idDisplay) {
    idDisplay.textContent = LINE_OA_ID;
  }
  modal.classList.remove("hidden");
  if (window.lucide) lucide.createIcons();
}

export function closeLineOAModal() {
  const modal = document.getElementById("modal-line-oa");
  if (!modal) return;
  modal.classList.add("hidden");
}

export function openLineOAUrl() {
  if (window.liff && typeof liff.isInClient === "function" && liff.isInClient()) {
    liff.openWindow({ url: LINE_OA_URL, external: false });
  } else {
    window.open(LINE_OA_URL, "_blank");
  }
}

// 官方帳號好友提醒：沒登入的訪客、或已登入但還沒加官方帳號好友的人，在頁面上方顯示提醒條
// 網址加 ?oa_banner=1 可強制顯示（測試用，例如 PR 預覽網址無法使用 LINE 登入時）
let oaBannerDismissed = false;

export async function checkOaFriendship() {
  const STATE = window.STATE || {};
  const banner = document.getElementById("oa-friend-banner");
  if (!banner) return;

  const forceShow = new URLSearchParams(window.location.search).get("oa_banner") === "1";
  let show = forceShow;
  const isLoggedIn = !!(window.liff && typeof liff.isLoggedIn === "function" && liff.isLoggedIn());
  if (!forceShow && !isLoggedIn) {
    // 沒登入無法查詢好友狀態，一律提醒（訪客按 × 只在這次瀏覽有效，不留本地紀錄）
    show = true;
  } else if (!forceShow) {
    try {
      const friendship = await liff.getFriendship();
      STATE.isOaFriend = !!(friendship && friendship.friendFlag);
      show = !STATE.isOaFriend;
    } catch (e) {
      // 查詢失敗（例如登入頻道未連結官方帳號）就不提醒，避免誤報
      console.warn("[LIFF] getFriendship error:", e);
      show = false;
    }
  }
  if (oaBannerDismissed) show = false;

  const isZh = (STATE.lang === "zh-TW");
  const textEl = document.getElementById("t-oa-friend-banner-text");
  const btnEl = document.getElementById("t-oa-friend-banner-btn");
  if (textEl) textEl.textContent = isZh ? "加入 ZZTWO 官方帳號好友，在 LINE 裡就能查活動、收賽況" : "Add ZZTWO official account to check events and get updates in LINE";
  if (btnEl) btnEl.textContent = isZh ? "加入好友" : "Add Friend";

  banner.classList.toggle("hidden", !show);
  if (show && window.lucide) lucide.createIcons({ root: banner });
}

export function dismissOaFriendBanner() {
  oaBannerDismissed = true;
  const banner = document.getElementById("oa-friend-banner");
  if (banner) banner.classList.add("hidden");
}

// 使用者去加完好友回到頁面時，重新查詢，加了就自動收起提醒條
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    const banner = document.getElementById("oa-friend-banner");
    if (document.visibilityState === "visible" && banner && !banner.classList.contains("hidden")) {
      checkOaFriendship();
    }
  });
}

export function copyLineOAId() {
  const STATE = window.STATE || {};
  const isZh = (STATE.lang === "zh-TW");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(LINE_OA_ID).then(() => {
      showToast(isZh ? `✅ 已複製 LINE ID：${LINE_OA_ID}` : `✅ Copied LINE ID: ${LINE_OA_ID}`, "success");
    }).catch(() => {
      showToast(`LINE ID: ${LINE_OA_ID}`, "info");
    });
  } else {
    showToast(`LINE ID: ${LINE_OA_ID}`, "info");
  }
}

// ============================================================
// SHARE & QR CODE MODAL
// ============================================================
export function getTournamentShareUrl(tId) {
  if (!tId) return window.location.href;
  return `${LIFF_URL}?t=${tId}`;
}

export function openShareModal() {
  const modal = document.getElementById("modal-share");
  if (!modal) return;
  const urlInput = document.getElementById("share-url-input");
  const qrImg = document.getElementById("share-qr-img");
  const STATE = window.STATE || {};
  const tId = STATE.currentTournamentId;

  const shareUrl = getTournamentShareUrl(tId);
  if (urlInput) urlInput.value = shareUrl;
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shareUrl)}`;
  }

  modal.classList.remove("hidden");
}

export function closeShareModal() {
  const modal = document.getElementById("modal-share");
  if (modal) modal.classList.add("hidden");
}

export async function shareToLine() {
  const STATE = window.STATE || {};
  const tData = STATE.tournamentData;
  const tId = STATE.currentTournamentId || (tData ? tData.id : null);
  if (!tId) return;

  const title = (tData && tData.name) ? tData.name : ((tData && tData.title) ? tData.title : "匹克球排賽");
  const liffUrl = `${LIFF_URL}?t=${tId}`;
  const isZh = (STATE.lang === "zh-TW");
  const shareText = isZh
    ? `🏓 匹克球【${title}】大廳已開啟！\n立即點擊報名/觀戰：\n${liffUrl}`
    : `🏓 Pickleball [${title}] Lobby is open!\nJoin / Watch now:\n${liffUrl}`;

  if (window.liff && liff.isApiAvailable && liff.isApiAvailable("shareTargetPicker")) {
    try {
      const res = await liff.shareTargetPicker([
        {
          type: "text",
          text: shareText
        }
      ]);
      if (res) {
        showToast(t("liffSharedToast"), "success");
        return;
      }
    } catch (err) {
      console.warn("[LIFF] shareTargetPicker fallback:", err);
    }
  }

  const lineShareUrl = `https://line.me/R/msg/text/?${encodeURIComponent(shareText)}`;
  window.open(lineShareUrl, "_blank");
}

export function copyShareUrl() {
  const STATE = window.STATE || {};
  const shareUrl = getTournamentShareUrl(STATE.currentTournamentId);
  const urlInput = document.getElementById("share-url-input");
  if (urlInput) urlInput.value = shareUrl;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast(t("copiedLinkToast"), "success");
    }).catch(() => {
      if (urlInput) {
        urlInput.select();
        document.execCommand("copy");
        showToast(t("copiedLinkToast"), "success");
      }
    });
  } else if (urlInput) {
    urlInput.select();
    document.execCommand("copy");
    showToast(t("copiedLinkToast"), "success");
  }
}

// 掛載至全域 window，保證與 HTML onclick 及全域代碼 100% 相容
if (typeof window !== "undefined") {
  window.syncUserProfileToFirebase = syncUserProfileToFirebase;
  window.fetchUserClubsFromFirebase = fetchUserClubsFromFirebase;
  window.addUserClubToFirebase = addUserClubToFirebase;
  window.initLiffAndUser = initLiffAndUser;
  window.lineDebug = lineDebug;
  window.waitForLineReady = waitForLineReady;
  window.initLiff = initLiffAndUser;
  window.updateNavLineProfileUI = updateNavLineProfileUI;
  window.openLineProfileModal = openLineProfileModal;
  window.closeLineProfileModal = closeLineProfileModal;
  window.openLineLoginPromptModal = openLineLoginPromptModal;
  window.showLineLoginModal = openLineLoginPromptModal;
  window.closeLineLoginPromptModal = closeLineLoginPromptModal;
  window.handleLineLoginClick = handleLineLoginClick;
  window.triggerLineLoginAction = triggerLineLoginAction;
  window.handleLineLogoutOrSwitch = handleLineLogoutOrSwitch;
  window.openLineOAModal = openLineOAModal;
  window.closeLineOAModal = closeLineOAModal;
  window.openLineOAUrl = openLineOAUrl;
  window.checkOaFriendship = checkOaFriendship;
  window.dismissOaFriendBanner = dismissOaFriendBanner;
  window.copyLineOAId = copyLineOAId;
  window.getTournamentShareUrl = getTournamentShareUrl;
  window.openShareModal = openShareModal;
  window.closeShareModal = closeShareModal;
  window.shareToLine = shareToLine;
  window.copyShareUrl = copyShareUrl;
}
