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
import { escapeHTML, escapeJsAttr, safeSetLocal } from "./utils.js?v=20261023-5";

import {
  STATE,
  t,
  navigateTo,
  enterTournament
} from "./globals.js?v=20261023-5";

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

  // 卡片渲染函式
  const renderActivityCard = (tData, mode) => {
    const isRegistering = (tData.status === "registering");
    const dateStr = formatFn(tData.createdAt);
    const pCount = tData.players ? tData.players.length : 0;
    const maxPlayers = tData.maxPlayers ? Number(tData.maxPlayers) : null;
    const isFull = maxPlayers ? pCount >= maxPlayers : false;

    const clubBadge = tData.clubName && tData.clubName.trim() ? `
      <span class="text-[10px] px-2 py-0.5 rounded-md font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
        <i data-lucide="shield" class="w-2.5 h-2.5"></i> ${escapeHTML(tData.clubName.trim())}
      </span>
    ` : `
      <span class="text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 flex items-center gap-0.5">
        <i data-lucide="zap" class="w-2.5 h-2.5"></i> ${isZh ? '公開球局' : 'Public'}
      </span>
    `;

    const isBound = (tData._isBound !== false);
    const regNameBadge = tData._registeredName ? (
      isBound ? `
        <span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
          <i data-lucide="check" class="w-3 h-3 text-emerald-500"></i> ${isZh ? `綁定『${escapeHTML(tData._registeredName)}』出賽` : `Bound: ${escapeHTML(tData._registeredName)}`}
        </span>
      ` : `
        <span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 flex items-center gap-1">
          <i data-lucide="alert-circle" class="w-3 h-3 text-amber-500"></i> ${isZh ? `未綁定『${escapeHTML(tData._registeredName)}』出賽` : `Unbound: ${escapeHTML(tData._registeredName)}`}
        </span>
      `
    ) : '';

    const quotaInfo = maxPlayers ? `
      <span class="font-mono ${isFull ? 'text-rose-500 font-bold' : ''}">👥 ${pCount}/${maxPlayers} ${isFull ? (isZh ? '(已滿額)' : '(Full)') : ''}</span>
    ` : `
      <span class="font-mono">👥 ${pCount} ${isZh ? '人' : 'players'}</span>
    `;

    let actionBtn = "";
    if (mode === "active_registered") {
      actionBtn = `
        <button onclick="enterTournament('${escapeJsAttr(tData.id)}')"
          class="w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition shadow-sm active:scale-95 cursor-pointer card-inner border hover:border-emerald-500/50 text-stone-800 dark:text-white">
          <i data-lucide="${isRegistering ? 'clipboard-check' : 'play'}" class="w-3.5 h-3.5"></i>
          <span>${isRegistering ? (isZh ? '進入活動接龍' : 'View Signup') : (isZh ? '進入即時比分' : 'View Live')}</span>
        </button>
      `;
    } else if (mode === "available_signup") {
      actionBtn = `
        <button onclick="enterTournament('${escapeJsAttr(tData.id)}')"
          class="w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition shadow-sm active:scale-95 cursor-pointer bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white">
          <i data-lucide="plus-circle" class="w-3.5 h-3.5"></i>
          <span>${isZh ? '前往報名接龍' : 'Sign Up'}</span>
        </button>
      `;
    } else {
      actionBtn = `
        <button onclick="enterTournament('${escapeJsAttr(tData.id)}')"
          class="w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition shadow-sm active:scale-95 cursor-pointer card-inner border hover:border-emerald-500/50 text-stone-800 dark:text-white">
          <i data-lucide="award" class="w-3.5 h-3.5 text-amber-500"></i>
          <span>${isZh ? '查看賽事戰果' : 'View Results'}</span>
        </button>
      `;
    }

    return `
      <div class="glass-card hover-lift rounded-2xl p-4 sm:p-5 space-y-3 border flex flex-col justify-between shadow-sm relative overflow-hidden group ${mode === 'active_registered' ? 'border-emerald-500/30 bg-emerald-500/[0.02]' : ''}">
        <div class="space-y-2.5">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold font-mono card-inner text-emerald-600 dark:text-emerald-400 border">${escapeHTML(tData.id)}</span>
            ${clubBadge}
          </div>

          <div>
            <h3 class="text-base sm:text-lg font-bold font-display line-clamp-1 group-hover:text-emerald-500 transition-colors">
              ${escapeHTML(tData.name || '未命名賽事')}
            </h3>
          </div>

          <div class="space-y-1.5 text-xs sub-text">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <span class="flex items-center gap-1">
                <i data-lucide="calendar" class="w-3 h-3 text-stone-400"></i> ${dateStr}
              </span>
              ${quotaInfo}
            </div>
            ${regNameBadge ? `<div class="pt-1">${regNameBadge}</div>` : ''}
          </div>

          ${(() => {
            if (!tData.notes || !tData.notes.trim()) return '';
            const firstLine = tData.notes.trim().split('\n')[0].trim();
            if (!firstLine) return '';
            return `
              <div class="px-2 py-1 rounded-lg card-inner border text-[11px] sub-text flex items-center gap-1.5 bg-stone-500/5 overflow-hidden">
                <i data-lucide="file-text" class="w-3 h-3 text-emerald-500 shrink-0"></i>
                <span class="truncate font-medium">${escapeHTML(firstLine)}</span>
              </div>
            `;
          })()}
        </div>

        <div class="pt-2">
          ${actionBtn}
        </div>
      </div>
    `;
  };

  // 1. 渲染上方區塊：報名與比賽中
  const regContainer = document.getElementById("activities-registered-list");
  if (regContainer) {
    if (registeredActiveList.length === 0) {
      regContainer.innerHTML = `
        <div class="col-span-full glass-card rounded-2xl p-6 sm:p-8 text-center space-y-2 border">
          <p class="text-xs sm:text-sm font-semibold sub-text">
            ${isZh ? '目前沒有進行中或已報名的活動' : 'No active or registered activities'}
          </p>
          <p class="text-[11px] sub-text opacity-80">
            ${isZh ? '可切換至「等待報名」查看開放接龍報名的活動加入！' : 'Switch to "Waiting for Sign Up" to join open games!'}
          </p>
        </div>
      `;
    } else {
      regContainer.innerHTML = registeredActiveList.map(t => renderActivityCard(t, 'active_registered')).join("");
    }
  }

  // 2. 渲染等待報名區塊
  const availContainer = document.getElementById("activities-available-list");
  if (availContainer) {
    if (availableSignUpList.length === 0) {
      availContainer.innerHTML = `
        <div class="col-span-full glass-card rounded-2xl p-6 text-center space-y-1.5 border">
          <p class="text-xs font-semibold sub-text">
            ${isZh ? '目前沒有臨打及已參與社團的接龍活動' : 'No drop-in or joined club activities available'}
          </p>
        </div>
      `;
    } else {
      availContainer.innerHTML = availableSignUpList.map(t => renderActivityCard(t, 'available_signup')).join("");
    }
  }

  // 3. 渲染最下方區塊：近期完賽球局 (3日內)
  const compContainer = document.getElementById("activities-completed-list");
  if (compContainer) {
    if (registeredCompletedList.length === 0) {
      compContainer.innerHTML = `
        <div class="col-span-full glass-card rounded-2xl p-6 text-center space-y-1.5 border">
          <p class="text-xs font-semibold sub-text">
            ${isZh ? '近 3 日無完賽球局' : 'No completed matches in the past 3 days'}
          </p>
        </div>
      `;
    } else {
      compContainer.innerHTML = registeredCompletedList.map(t => renderActivityCard(t, 'completed_registered')).join("");
    }
  }

  if (window.lucide) lucide.createIcons();
}

// 掛載至全域 window，確保與 HTML 內嵌 onclick 事件及其他模組 100% 相容
if (typeof window !== "undefined") {
  window.onActivitiesSearchInput = onActivitiesSearchInput;
  window.checkTournamentRegistrationStatus = checkTournamentRegistrationStatus;
  window.renderActivitiesPage = renderActivitiesPage;
  window.displayActivitiesList = displayActivitiesList;
}
