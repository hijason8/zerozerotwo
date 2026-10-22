// ============================================================
// ZEROZEROTWO - LINE LIFF INTEGRATION & OFFICIAL ACCOUNT MODULE
// 負責 LINE LIFF 身分驗證、會員雲端社團同步、Profile 彈窗、官方帳號與分享
// ============================================================

import {
  ref,
  get,
  update
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { escapeHTML } from "./utils.js?v=20261022-1";

import {
  STATE,
  t,
  showToast,
  navigateTo,
  renderLiveUI
} from "./globals.js?v=20261022-1";

const LIFF_ID = (typeof window !== "undefined" && window.LIFF_ID) || "2012043789-KvKpHLCt";
const LIFF_URL = (typeof window !== "undefined" && window.LIFF_URL) || "https://liff.line.me/2012043789-KvKpHLCt";
const LINE_OA_URL = (typeof window !== "undefined" && window.LINE_OA_URL) || "https://line.me/R/ti/p/@451lupmp";
const LINE_OA_ID = (typeof window !== "undefined" && window.LINE_OA_ID) || "@451lupmp";

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

    await update(userRef, updates);

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
  if (!STATE.lineUserId) return;
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
export async function initLiffAndUser() {
  const STATE = window.STATE || {};
  STATE.myClubs = [];

  if (!window.liff) {
    console.info("[LIFF] SDK not found, running in guest mode.");
    updateNavLineProfileUI();
    if (typeof window.populateNavClubSelect === "function") window.populateNavClubSelect();
    return;
  }

  try {
    await liff.init({ liffId: LIFF_ID });
    STATE.isLiff = true;

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

      const profile = await liff.getProfile();
      STATE.lineUserId = profile.userId;
      STATE.lineProfile = profile;

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
        await addUserClubToFirebase(STATE.currentClub);
      }

      console.info(`[LIFF] Logged in successfully: ${profile.displayName} (${profile.userId}), Clubs:`, STATE.myClubs);

      STATE.userBindings = STATE.userBindings || {};
      if (STATE.db && Array.isArray(STATE.myClubs) && STATE.myClubs.length > 0) {
        for (const clubName of STATE.myClubs) {
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
        }
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

      const currentParams = new URLSearchParams(window.location.search);
      const pageParam = currentParams.get("page");
      const isNeutralPage = !pageParam || pageParam === "activities" || pageParam === "hub" || pageParam === "waiting";
      if (!currentParams.get("t") && !currentParams.get("club") && isNeutralPage) {
        if (pageParam === "hub") {
          currentParams.delete("page");
          const newSearch = currentParams.toString();
          const cleanUrl = window.location.pathname + (newSearch ? `?${newSearch}` : "");
          window.history.replaceState({}, document.title, cleanUrl);
        }
        if (pageParam === "waiting") {
          navigateTo("waiting", false);
        } else {
          navigateTo("activities", false);
        }
      }

      if (typeof window.populateNavClubSelect === "function") {
        window.populateNavClubSelect();
      }

      if (STATE.currentClub && typeof window.checkAndPromptClubIdentityClaim === "function") {
        window.checkAndPromptClubIdentityClaim(STATE.currentClub);
      }
    } else {
      const isLineBrowser = /Line\//i.test(navigator.userAgent || "");
      if (liff.isInClient() || isLineBrowser) {
        console.info("[LIFF] Inside LINE client/browser, auto upgrading to LIFF URL...");
        const search = window.location.search || "";
        window.location.replace(`https://liff.line.me/${LIFF_ID}${search}`);
        return;
      }

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
      console.info("[LIFF] Not logged in, running in guest mode.");
      if (typeof window.populateNavClubSelect === "function") {
        window.populateNavClubSelect();
      }
    }
  } catch (err) {
    console.warn("[LIFF] Initialization error (safe fallback enabled):", err);
    STATE.lineUserId = null;
    STATE.lineProfile = null;
    STATE.myClubs = [];
  } finally {
    updateNavLineProfileUI();
    if (typeof window.populateNavClubSelect === "function") {
      window.populateNavClubSelect();
    }
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

export function handleLineLoginClick() {
  if (window.liff && typeof liff.isLoggedIn === "function" && !liff.isLoggedIn()) {
    try {
      liff.login({ redirectUri: window.location.href });
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
  if (window.liff && typeof liff.isLoggedIn === "function" && !liff.isLoggedIn()) {
    try {
      liff.login({ redirectUri: window.location.href });
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
  window.copyLineOAId = copyLineOAId;
  window.getTournamentShareUrl = getTournamentShareUrl;
  window.openShareModal = openShareModal;
  window.closeShareModal = closeShareModal;
  window.shareToLine = shareToLine;
  window.copyShareUrl = copyShareUrl;
}
