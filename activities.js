// ============================================================
// ZEROZEROTWO - ACTIVITIES & WAITING SIGNUP MODULE
// 負責【我的關注】：加入社團的球局＋關注的球局（報名中 → 比賽中 → 近期完賽）
// ============================================================

import {
  ref,
  onValue,
  query,
  orderByChild,
  startAt
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { escapeHTML, escapeJsAttr, safeSetLocal } from "./utils.js?v=20261113-29";
import { renderTournamentCard, renderCardWithRegistration, getFinishedTime } from "./hub.js?v=20261113-29";

import {
  STATE,
  t,
  navigateTo,
  enterTournament
} from "./globals.js?v=20261113-29";

let activitiesSearchKeyword = "";

export function onActivitiesSearchInput(keyword) {
  activitiesSearchKeyword = (keyword || "").trim().toLowerCase();
  const STATE = window.STATE || {};
  const localData = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
  const list = (Array.isArray(STATE.allTournamentsCache) && STATE.allTournamentsCache.length > 0)
    ? STATE.allTournamentsCache
    : Object.values(localData);
  displayActivitiesList(list);
}

// 是否在「我的關注」裡（users/{LINE ID}/following）
export function checkTournamentRegistrationStatus(tournament) {
  const following = typeof window.isFollowing === "function" && tournament && window.isFollowing(tournament.id);
  return { isRegistered: false, registeredName: null, isFollowing: !!following };
}

export function renderActivitiesPage() {
  const STATE = window.STATE || {};
  // 訪客未登入 LINE：仍可進入我的關注頁，畫面改為鼓勵登入（資料照常載入，用來列出活躍社團）

  // 1. 優先使用快取資料立即可見
  const localData = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
  const cached = Object.values(localData);
  if (cached.length > 0) {
    displayActivitiesList(cached);
  } else {
    const regContainer = document.getElementById("activities-registered-list");
    const availContainer = document.getElementById("activities-available-list");
    if (regContainer) {
      regContainer.innerHTML = `<div class="col-span-full text-center py-6 sub-text"><i data-lucide="loader-2" class="w-6 h-6 animate-spin mx-auto mb-1"></i>Loading...</div>`;
    }
    if (availContainer) {
      availContainer.innerHTML = `<div class="col-span-full text-center py-6 sub-text"><i data-lucide="loader-2" class="w-6 h-6 animate-spin mx-auto mb-1"></i>Loading...</div>`;
    }
    if (window.lucide) lucide.createIcons();
  }

  // 2. 逾時安全閥
  const loadingTimeout = setTimeout(() => {
    const regContainer = document.getElementById("activities-registered-list");
    if (regContainer && regContainer.innerHTML.includes("animate-spin")) {
      const fallback = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
      displayActivitiesList(Object.values(fallback));
    }
  }, 2000);

  // 3. 清除舊訂閱
  if (STATE.activitiesUnsubscribe) {
    STATE.activitiesUnsubscribe();
    STATE.activitiesUnsubscribe = null;
  }

  // 4. 即時監聽 Firebase
  const attachFirebaseListener = () => {
    if (!STATE.db) return false;
    if (STATE.activitiesUnsubscribe) return true;
    // 只下載最近 30 天建立的賽事（已完賽的畫面上只顯示 3 天內）
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const tournamentsRef = query(ref(STATE.db, "tournaments"), orderByChild("createdAt"), startAt(since));
    STATE.activitiesUnsubscribe = onValue(tournamentsRef, (snapshot) => {
      clearTimeout(loadingTimeout);
      let list = [];
      if (snapshot.exists()) {
        const data = snapshot.val();
        list = Object.values(data);
        safeSetLocal("pb_tournaments", JSON.stringify(data));
      } else {
        safeSetLocal("pb_tournaments", JSON.stringify({}));
      }
      displayActivitiesList(list);
    }, (error) => {
      clearTimeout(loadingTimeout);
      console.warn("[Activities] onValue error:", error);
      const fallback = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
      displayActivitiesList(Object.values(fallback));
    });
    return true;
  };

  if (!attachFirebaseListener()) {
    clearTimeout(loadingTimeout);
    let retries = 0;
    const checkInterval = setInterval(() => {
      retries++;
      if (attachFirebaseListener() || retries > 25 || (STATE.currentPage !== "activities" && STATE.currentPage !== "waiting")) {
        clearInterval(checkInterval);
      }
    }, 200);
  }
}

export function displayActivitiesList(list) {
  const STATE = window.STATE || {};
  STATE.allTournamentsCache = list || [];
  const isZh = STATE.lang === "zh-TW";
  const isLoggedIn = !!STATE.lineUserId;

  const isFinishedFn = typeof window.isTournamentFinished === "function" ? window.isTournamentFinished : (t) => t && t.status === "completed";
  const parseFn = typeof window.parseTournamentDate === "function" ? window.parseTournamentDate : (val) => new Date(val);
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  // 我的關注：我加入的社團的球局＋我關注的所有球局（臨打、社團、僅限連結都算）
  const myClubsList = (Array.isArray(STATE.myClubs) ? STATE.myClubs : []).map(c => (c || "").trim()).filter(Boolean);
  const followFn = typeof window.isFollowing === "function" ? window.isFollowing : () => false;
  const clubGames = isLoggedIn ? (list || []).filter(t => {
    if (!t) return false;
    const c = (t.clubName || "").trim();
    if (!followFn(t.id) && (!c || !myClubsList.includes(c))) return false;
    if (!activitiesSearchKeyword) return true;
    const kw = activitiesSearchKeyword;
    return (t.name || "").toLowerCase().includes(kw) || c.toLowerCase().includes(kw) || (t.venue || "").toLowerCase().includes(kw);
  }) : [];
  clubGames.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // 三個區塊：比賽中、報名中、近期完賽 (3日內)，與臨打活動頁相同
  const liveList = [];
  const signupList = [];
  const completedList = [];
  clubGames.forEach(t => {
    if (isFinishedFn(t)) {
      const d = getFinishedTime(t);
      if (d ? (nowMs - d.getTime()) <= THREE_DAYS_MS : true) completedList.push(t);
    } else if (t.status === "registering") {
      signupList.push(t);
    } else {
      liveList.push(t);
    }
  });

  const fillSection = (sectionId, listId, countId, items) => {
    const section = document.getElementById(sectionId);
    const container = document.getElementById(listId);
    const countEl = document.getElementById(countId);
    if (section) section.classList.toggle("hidden", items.length === 0);
    if (countEl) countEl.innerText = `${items.length}`;
    if (container) container.innerHTML = items.map(t => renderCardWithRegistration(t)).join("");
  };
  fillSection("activities-registered-section", "activities-registered-list", "activities-registered-count", liveList);
  fillSection("activities-available-section", "activities-available-list", "activities-available-count", signupList);
  completedList.sort((x, y) => (getFinishedTime(y)?.getTime() || 0) - (getFinishedTime(x)?.getTime() || 0));
  fillSection("activities-completed-section", "activities-completed-list", "activities-completed-count", completedList);

  // 沒有內容時（未登入／尚未加入社團／社團近期沒活動）：一句提示＋活躍社團
  const discoverSection = document.getElementById("activities-discover-section");
  const showDiscover = clubGames.length === 0;
  if (discoverSection) discoverSection.classList.toggle("hidden", !showDiscover);
  if (showDiscover) {
    const titleEl = document.getElementById("t-activities-empty-title");
    const hintEl = document.getElementById("t-activities-empty-hint");
    const loginBtn = document.getElementById("activities-login-btn");
    if (!isLoggedIn) {
      if (titleEl) titleEl.innerText = isZh ? "登入 LINE 後，可加入社團、關注賽事" : "Log in with LINE to join clubs and follow games";
    } else {
      if (titleEl) titleEl.innerText = isZh ? "目前沒有關注的球局" : "Nothing you follow right now";
      if (hintEl) hintEl.innerText = isZh ? "點選 ☆ 號，關注賽事" : "Tap ☆ to follow a game";
    }
    if (loginBtn) loginBtn.classList.toggle("hidden", isLoggedIn);
    // 未登入：只留一行粗體標題，不顯示灰字說明
    if (hintEl) hintEl.classList.toggle("hidden", !isLoggedIn);
    renderDiscover(list || [], { isZh });
  }

  if (window.lucide) lucide.createIcons();
}

// 自己沒有活動時：一句提示 ＋ 近 30 天最活躍的公開社團
function renderDiscover(list, ctx) {
  const STATE = window.STATE || {};
  const { isZh } = ctx;
  const isPrivateFn = typeof window.isClubPrivate === "function" ? window.isClubPrivate : () => false;
  const isPublic = t => {
    const c = (t.clubName || "").trim();
    return !c || !isPrivateFn(c);
  };
  const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
  const publicList = list.filter(t => t && t.id && isPublic(t)).sort(byNewest);

  // 活躍社團：近 30 天公開社團的賽事場數（排除自己已加入的）
  const myClubs = Array.isArray(STATE.myClubs) ? STATE.myClubs : [];
  const counts = {};
  publicList.forEach(t => {
    const c = (t.clubName || "").trim();
    if (c && !myClubs.includes(c)) counts[c] = (counts[c] || 0) + 1;
  });
  const clubs = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const clubsWrap = document.getElementById("activities-discover-clubs-wrap");
  const clubsEl = document.getElementById("activities-discover-clubs");
  if (clubsWrap) clubsWrap.classList.toggle("hidden", clubs.length === 0);
  if (clubsEl) {
    clubsEl.innerHTML = clubs.map(([c, n]) => `
      <button type="button" onclick="selectExploredClub('${escapeJsAttr(c)}')"
        class="p-3 rounded-xl card-inner border hover:border-emerald-500/50 transition flex items-center justify-between gap-2 text-left active:scale-95 shadow-sm">
        <span class="flex items-center gap-2 min-w-0">
          <span class="w-8 h-8 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
            <i data-lucide="shield" class="w-4 h-4"></i>
          </span>
          <span class="text-xs sm:text-sm font-bold truncate">${escapeHTML(c)}</span>
        </span>
        <span class="text-[11px] sub-text shrink-0">${isZh ? `近 30 天 ${n} 場` : `${n} games / 30d`}</span>
      </button>
    `).join("");
  }
}

// 掛載至全域 window，確保與 HTML 內嵌 onclick 事件及其他模組 100% 相容
if (typeof window !== "undefined") {
  window.onActivitiesSearchInput = onActivitiesSearchInput;
  window.checkTournamentRegistrationStatus = checkTournamentRegistrationStatus;
  window.renderActivitiesPage = renderActivitiesPage;
  window.displayActivitiesList = displayActivitiesList;
}
