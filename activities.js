// ============================================================
// ZEROZEROTWO - ACTIVITIES & WAITING SIGNUP MODULE
// 負責【比賽中/已報名】與【等待報名】社團活動總表、報名狀態比對、關鍵字搜尋
// ============================================================

import {
  ref,
  onValue,
  query,
  orderByChild,
  startAt
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { escapeHTML, escapeJsAttr, safeSetLocal } from "./utils.js?v=20261024-6";
import { renderTournamentCard } from "./hub.js?v=20261024-6";

import {
  STATE,
  t,
  navigateTo,
  enterTournament
} from "./globals.js?v=20261024-6";

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

export function checkTournamentRegistrationStatus(tournament) {
  const STATE = window.STATE || {};
  if (!tournament || !Array.isArray(tournament.players)) {
    return { isRegistered: false, registeredName: null };
  }
  // 嚴格雙軌：訪客未登入 LINE 無法綁定或預定個人活動
  if (!STATE.lineUserId) {
    return { isRegistered: false, registeredName: null };
  }

  const clubName = (tournament.clubName || "").trim();
  // 關鍵門禁：若為社團球局，但使用者根本未加入該社團，100% 絕不判定為本人已報名！
  if (clubName && (!Array.isArray(STATE.myClubs) || !STATE.myClubs.includes(clubName))) {
    return { isRegistered: false, registeredName: null };
  }

  let boundName = null;
  if (clubName) {
    // 嚴格僅查詢該賽事所屬社團之綁定身分，優先使用記憶體雲端快取，絕不跨社團污染比對
    if (STATE.userBindings && STATE.userBindings[clubName]) {
      boundName = STATE.userBindings[clubName];
    } else {
      boundName = localStorage.getItem(`pb_bound_name_${clubName}`);
    }
    if (!boundName && STATE.currentClub === clubName && STATE.clubPlayerName) {
      boundName = STATE.clubPlayerName;
    }
  } else {
    boundName = (STATE.userBindings && STATE.userBindings.__general__) || localStorage.getItem("pb_bound_name___general__") || null;
  }
  if (boundName) boundName = boundName.trim();

  const myDisplayName = (STATE.lineProfile && STATE.lineProfile.displayName)
    ? STATE.lineProfile.displayName.trim()
    : null;

  const isMyClubOrPublic = !clubName || (Array.isArray(STATE.myClubs) && STATE.myClubs.includes(clubName));

  for (const p of tournament.players) {
    let pName = "";
    let pLineId = "";
    if (typeof p === "string") {
      pName = p.trim();
    } else if (p && typeof p === "object") {
      pName = (p.name || "").trim();
      pLineId = (p.lineUserId || "").trim();
    }

    // 1. 若 LINE User ID 相符，100% 絕對確定為本人出賽 (判定為綁定出賽)
    if (pLineId && pLineId === STATE.lineUserId) {
      return { isRegistered: true, registeredName: pName || boundName || myDisplayName || "我", isBound: true };
    }

    // 2. 若為該賽事所屬社團的明確綁定身分相符 (僅本社團，絕不跨社團猜測) -> 綁定出賽
    if (boundName && pName === boundName) {
      return { isRegistered: true, registeredName: boundName, isBound: true };
    }

    // 3. 若為公開賽事或自己的社團，且球員名與 LINE 暱稱完全相符 -> 視是否已綁定區分
    if (isMyClubOrPublic && myDisplayName && pName === myDisplayName) {
      const isActuallyBound = Boolean(boundName && boundName === pName);
      return { isRegistered: true, registeredName: myDisplayName, isBound: isActuallyBound };
    }
  }

  return { isRegistered: false, registeredName: null, isBound: false };
}

export function renderActivitiesPage() {
  const STATE = window.STATE || {};
  // 訪客未登入 LINE 嚴格導回賽事大廳
  if (!STATE.lineUserId) {
    if (typeof window.navigateTo === "function") window.navigateTo("hub");
    return;
  }

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

  // 更新區塊標題與搜尋框中英文字串
  const regTextEl = document.getElementById("t-activities-reg-text");
  if (regTextEl) regTextEl.innerText = isZh ? "比賽中/已報名" : "In Progress / Registered";

  const waitingTitleEl = document.getElementById("t-waiting-title-text");
  if (waitingTitleEl) waitingTitleEl.innerText = isZh ? "等待報名" : "Waiting for Sign Up";

  const availTextEl = document.getElementById("t-activities-avail-text");
  if (availTextEl) availTextEl.innerText = isZh ? "等待報名" : "Waiting for Sign Up";

  const compTextEl = document.getElementById("t-activities-comp-text");
  if (compTextEl) compTextEl.innerText = isZh ? "近期完賽球局 (3日內)" : "Recent Completed Matches (3 Days)";

  // 1. 嚴格資格分流：
  // - 若本人已報名 (checkTournamentRegistrationStatus 為 true)：一律納入
  // - 若本人未報名：僅限「公開臨打球局 (!cName)」或「自己已加入的社團 (STATE.myClubs)」
  const myClubsList = (Array.isArray(STATE.myClubs) ? STATE.myClubs : []).map(c => (c || "").trim());
  const clubScopedList = (list || []).filter(t => {
    if (!t) return false;
    const regStatus = checkTournamentRegistrationStatus(t);
    if (regStatus.isRegistered) return true;

    const cName = (t.clubName || "").trim();
    // 1. 沒有社團建立的接龍活動 (公開臨打)
    if (!cName) return true;
    // 2. 該 LINE ID 帳號下的社團
    return myClubsList.includes(cName);
  });

  // 2. 搜尋關鍵字過濾
  let filtered = clubScopedList.filter(t => {
    if (!t) return false;
    if (!activitiesSearchKeyword) return true;
    const name = (t.name || "").toLowerCase();
    const club = (t.clubName || "").toLowerCase();
    const venue = (t.venue || "").toLowerCase();
    return name.includes(activitiesSearchKeyword) || club.includes(activitiesSearchKeyword) || venue.includes(activitiesSearchKeyword);
  });

  // 依建立時間倒序
  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // 三大分流清單：
  // 1. 上方：跟自己有關的報名與比賽中的球局
  const registeredActiveList = [];
  // 2. 中間：自己能報名但是未報名的活動接龍
  const availableSignUpList = [];
  // 3. 最下方：跟自己有關的近期完賽球局 (3日內)
  const registeredCompletedList = [];

  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  const parseFn = typeof window.parseTournamentDate === "function" ? window.parseTournamentDate : (val) => new Date(val);
  const formatFn = typeof window.formatTournamentDate === "function" ? window.formatTournamentDate : (val) => val;
  const isFinishedFn = typeof window.isTournamentFinished === "function" ? window.isTournamentFinished : (t) => t && t.status === "finished";

  filtered.forEach(tData => {
    const regStatus = checkTournamentRegistrationStatus(tData);
    const isFinished = isFinishedFn(tData);

    if (regStatus.isRegistered) {
      // 跟自己有關
      if (isFinished) {
        // 最下方：跟自己有關的近期完賽球局 (3日內)
        const tDate = parseFn(tData.createdAt);
        const isWithin3Days = tDate ? (nowMs - tDate.getTime()) <= THREE_DAYS_MS : true;
        if (isWithin3Days) {
          registeredCompletedList.push({
            ...tData,
            _registeredName: regStatus.registeredName,
            _isBound: regStatus.isBound
          });
        }
      } else {
        // 上方：跟自己有關的報名與比賽中的球局
        registeredActiveList.push({
          ...tData,
          _registeredName: regStatus.registeredName,
          _isBound: regStatus.isBound
        });
      }
    } else {
      // 自己未報名：中間放「自己能報名但是未報名的活動接龍」
      const cName = (tData.clubName || "").trim();
      const canSignUp = !cName || (Array.isArray(STATE.myClubs) && STATE.myClubs.includes(cName));
      const isRegistering = (tData.status === "registering");
      const isClosed = tData.registrationClosed === true || tData.isRegistrationClosed === true || tData.isClosed === true;
      if (canSignUp && isRegistering && !isClosed && !isFinished) {
        availableSignUpList.push(tData);
      }
    }
  });

  // 排序中間接龍清單
  availableSignUpList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // 更新徽章數字
  const totalActivitiesCount = registeredActiveList.length + availableSignUpList.length + registeredCompletedList.length;
  const totalBadge = document.getElementById("activities-total-badge");
  if (totalBadge) totalBadge.innerText = `${totalActivitiesCount} ${isZh ? '場' : 'matches'}`;

  const regCountEl = document.getElementById("activities-registered-count");
  if (regCountEl) regCountEl.innerText = `${registeredActiveList.length}`;

  const availCountEl = document.getElementById("activities-available-count");
  if (availCountEl) availCountEl.innerText = `${availableSignUpList.length}`;

  const compCountEl = document.getElementById("activities-completed-count");
  if (compCountEl) compCountEl.innerText = `${registeredCompletedList.length}`;

  // 卡片：與臨打賽事頁共用同一張卡片（呈現與操作一致），我的活動頁只多加「以誰的名字出賽」
  const renderActivityCard = (tData) => {
    if (!tData._registeredName) return renderTournamentCard(tData);
    const isBound = (tData._isBound !== false);
    const name = escapeHTML(tData._registeredName);
    const badge = isBound ? `
      <div><span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1">
        <i data-lucide="check" class="w-3 h-3 text-emerald-500"></i> ${isZh ? `綁定『${name}』出賽` : `Bound: ${name}`}
      </span></div>
    ` : `
      <div><span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 inline-flex items-center gap-1">
        <i data-lucide="alert-circle" class="w-3 h-3 text-amber-500"></i> ${isZh ? `未綁定『${name}』出賽` : `Unbound: ${name}`}
      </span></div>
    `;
    return renderTournamentCard(tData, { extraHTML: badge });
  };

  // 三個區塊：有資料才顯示
  const fillSection = (sectionId, listId, list, mode) => {
    const section = document.getElementById(sectionId);
    const container = document.getElementById(listId);
    if (section) section.classList.toggle("hidden", list.length === 0);
    if (container) container.innerHTML = list.map(t => renderActivityCard(t, mode)).join("");
  };
  fillSection("activities-registered-section", "activities-registered-list", registeredActiveList, "active_registered");
  fillSection("activities-available-section", "activities-available-list", availableSignUpList, "available_signup");
  fillSection("activities-completed-section", "activities-completed-list", registeredCompletedList, "completed_registered");

  // 4. 自己沒有進行中／可報名的活動時，顯示提示與活躍社團，避免首頁空白
  const discoverSection = document.getElementById("activities-discover-section");
  const showDiscover = registeredActiveList.length === 0 && availableSignUpList.length === 0;
  if (discoverSection) discoverSection.classList.toggle("hidden", !showDiscover);
  if (showDiscover) renderDiscover(list || [], { isZh, isFinishedFn, renderActivityCard });

  if (window.lucide) lucide.createIcons();
}

// 自己沒有活動時：一句提示 ＋ 近 30 天最活躍的公開社團
function renderDiscover(list, ctx) {
  const STATE = window.STATE || {};
  const { isZh, isFinishedFn, renderActivityCard } = ctx;
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
