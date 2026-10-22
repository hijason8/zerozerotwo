// ============================================================
// ZEROZEROTWO - HUB & TOURNAMENT LIST CONTROLLER
// 負責【探索大廳】公開賽事列表、快速代碼搜尋、賽事刪除與歷次賽事歸檔
// ============================================================

import {
  ref,
  onValue,
  get,
  remove
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { escapeHTML, escapeJsAttr, safeSetLocal } from "./utils.js?v=20261022-1";

import {
  STATE,
  t,
  showToast,
  navigateTo,
  loadLiveTournament,
  verifyClubAccess,
  getAllUniqueClubs,
  populateNavClubSelect,
  populateCreateClubSelect
} from "./globals.js?v=20261022-1";

export function getMyTournamentIds() {
  try {
    const raw = localStorage.getItem("pb_my_tournaments");
    if (raw) return JSON.parse(raw);
    const local = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
    const ids = Object.keys(local);
    if (ids.length > 0) {
      localStorage.setItem("pb_my_tournaments", JSON.stringify(ids));
      return ids;
    }
    return [];
  } catch (e) {
    return [];
  }
}

export function addMyTournamentId(tId) {
  if (!tId) return;
  try {
    let ids = getMyTournamentIds();
    ids = ids.filter(id => id !== tId);
    ids.unshift(tId);
    if (ids.length > 60) ids = ids.slice(0, 60);
    localStorage.setItem("pb_my_tournaments", JSON.stringify(ids));
  } catch (e) { }
}

export function setHubTab(tab) {
  const STATE = window.STATE || {};
  STATE.hubTab = tab;
  displayHubTournamentsList(STATE.allTournamentsCache);
}

export function onHubClubFilterChange(clubName) {
  const STATE = window.STATE || {};
  STATE.hubClubFilter = (clubName || "").trim();
  displayHubTournamentsList(STATE.allTournamentsCache);
}

export function quickEnterTournament(code) {
  if (!code) return;
  let clean = code.trim().toUpperCase();
  if (!clean) return;
  if (!clean.startsWith("T-") && /^\d+$/.test(clean)) {
    clean = "T-" + clean;
  }
  if (typeof window.loadLiveTournament === "function") {
    window.loadLiveTournament(clean, true);
  }
}

export function openQuickCodeModal() {
  const modal = document.getElementById("modal-quick-code");
  if (!modal) return;
  modal.classList.remove("hidden");
  if (window.lucide) lucide.createIcons();
  setTimeout(() => {
    const input = document.getElementById("quick-code-modal-input");
    if (input) {
      input.focus();
      input.select();
    }
  }, 50);
}

export function closeQuickCodeModal() {
  const modal = document.getElementById("modal-quick-code");
  if (!modal) return;
  modal.classList.add("hidden");
  const input = document.getElementById("quick-code-modal-input");
  if (input) input.value = "";
}

export function handleQuickCodeModalSubmit(e) {
  if (e) e.preventDefault();
  const input = document.getElementById("quick-code-modal-input");
  if (!input) return;
  const val = input.value.trim();
  const STATE = window.STATE || {};
  if (!val) {
    if (typeof window.showToast === "function") {
      window.showToast(STATE.lang === "zh-TW" ? "請輸入賽事代碼" : "Please enter tournament code", "warning");
    }
    return;
  }
  closeQuickCodeModal();
  quickEnterTournament(val);
}

export function handleQuickCodeSubmit(e) {
  if (e) e.preventDefault();
  const input = document.getElementById("hub-quick-code-input") || document.getElementById("quick-code-modal-input");
  if (!input) return;
  const val = input.value.trim();
  const STATE = window.STATE || {};
  if (!val) {
    if (typeof window.showToast === "function") {
      window.showToast(STATE.lang === "zh-TW" ? "請輸入賽事代碼" : "Please enter tournament code", "warning");
    }
    return;
  }
  quickEnterTournament(val);
  input.value = "";
}

export function saveToLocalTournaments(tObj) {
  if (!tObj || !tObj.id) return;
  const STATE = window.STATE || {};
  try {
    const local = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
    local[tObj.id] = tObj;
    safeSetLocal("pb_tournaments", JSON.stringify(local));
  } catch (e) {
    console.warn("LocalStorage save error:", e);
  }

  if (Array.isArray(STATE.allTournamentsCache)) {
    const idx = STATE.allTournamentsCache.findIndex(t => t.id === tObj.id);
    if (idx !== -1) {
      STATE.allTournamentsCache[idx] = tObj;
    } else {
      STATE.allTournamentsCache.unshift(tObj);
    }
  }
}

export function displayHubTournamentsList(list) {
  const STATE = window.STATE || {};
  STATE.allTournamentsCache = list || [];

  if (typeof window.getAllUniqueClubs === "function" && typeof window.populateNavClubSelect === "function") {
    const uniqueClubs = window.getAllUniqueClubs();
    window.populateNavClubSelect(uniqueClubs);
  }

  if (typeof window.populateCreateClubSelect === "function") {
    window.populateCreateClubSelect();
  }

  let filteredList = (list || []).filter(t => {
    const isClub = !!(t.clubName && t.clubName.trim());
    if (isClub) return false;
    return t.isPrivate !== true;
  });
  filteredList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const activeList = [];
  const completedList = [];
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  const isFinishedFn = typeof window.isTournamentFinished === "function" ? window.isTournamentFinished : (t) => t && t.status === "finished";
  const parseFn = typeof window.parseTournamentDate === "function" ? window.parseTournamentDate : (val) => new Date(val);
  const formatFn = typeof window.formatTournamentDate === "function" ? window.formatTournamentDate : (val) => val;

  filteredList.forEach(tData => {
    const isDone = isFinishedFn(tData);
    if (isDone) {
      const tDate = parseFn(tData.createdAt);
      const isWithin3Days = tDate ? (nowMs - tDate.getTime()) <= THREE_DAYS_MS : true;
      if (isWithin3Days) {
        completedList.push(tData);
      }
    } else {
      activeList.push(tData);
    }
  });

  const activeCountEl = document.getElementById("hub-active-count");
  if (activeCountEl) {
    activeCountEl.innerText = `${activeList.length} ${t("hubActiveCountSuffix")}`;
  }
  const completedCountEl = document.getElementById("hub-completed-count");
  if (completedCountEl) {
    completedCountEl.innerText = `${completedList.length} ${t("hubCompletedCountSuffix")}`;
  }

  const renderCard = (tData) => {
    const isRegistering = (tData.status === "registering");
    const isFinished = isFinishedFn(tData);
    const total = tData.matches ? tData.matches.length : 0;
    const completedCount = tData.matches ? tData.matches.filter(m => m.completed && !m.voided).length : 0;
    const dateStr = formatFn(tData.createdAt);
    const pCount = tData.players ? tData.players.length : 0;

    const clubBadge = tData.clubName && tData.clubName.trim() ? `
      <span class="text-[10px] px-2 py-0.5 rounded font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
        <i data-lucide="shield" class="w-2.5 h-2.5"></i> ${escapeHTML(tData.clubName.trim())}
      </span>
    ` : '';

    const privacyBadge = tData.isPrivate === true ? `
      <span class="text-[10px] px-1.5 py-0.5 rounded font-bold bg-stone-500/10 text-stone-600 dark:text-slate-400 border border-stone-500/20 flex items-center gap-0.5">
        <i data-lucide="lock" class="w-2.5 h-2.5"></i> ${t("badgePrivate")}
      </span>
    ` : `
      <span class="text-[10px] px-1.5 py-0.5 rounded font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-0.5">
        <i data-lucide="zap" class="w-2.5 h-2.5"></i> ${t("badgePublic")}
      </span>
    `;

    const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;

    return `
      <div class="glass-card hover-lift rounded-2xl p-4 sm:p-5 space-y-3.5 border flex flex-col justify-between shadow-sm relative overflow-hidden group">
        <div class="space-y-2.5">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold font-mono card-inner text-emerald-600 dark:text-emerald-400 border">${escapeHTML(tData.id)}</span>
            ${clubBadge}
            ${privacyBadge}
            ${tData.partnerType === 'singles' ? `<span class="text-[10px] px-2 py-0.5 rounded font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">${STATE.lang === 'zh-TW' ? '個人單打' : 'Singles'}</span>` : ''}
          </div>

          <h3 class="text-base sm:text-lg font-bold font-display line-clamp-1 group-hover:text-emerald-500 transition-colors">${escapeHTML(tData.name || '未命名賽事')}</h3>

          <div class="flex items-center gap-2 text-xs sub-text flex-wrap">
            <span class="flex items-center gap-1">
              <i data-lucide="calendar" class="w-3 h-3 text-stone-400"></i> ${dateStr}
            </span>
            ${(tData.isPracticeMode || (tData.tournamentMode === "free" && total === 0))
              ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 inline-flex items-center gap-1"><i data-lucide="activity" class="w-3 h-3"></i> ${STATE.lang === "zh-TW" ? "自由練球" : "Practice"}</span>`
              : tData.tournamentMode === "free"
                ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold card-inner border text-stone-600 dark:text-slate-300 inline-flex items-center gap-1">${STATE.lang === "zh-TW" ? "自由模式" : "Free Play"}</span>`
                : tData.tournamentMode === "round-robin"
                  ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold card-inner border text-stone-600 dark:text-slate-300 inline-flex items-center gap-1">${STATE.lang === "zh-TW" ? "全循環模式" : "Round-Robin"}</span>`
                  : tData.tournamentMode === "group"
                    ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold card-inner border text-stone-600 dark:text-slate-300 inline-flex items-center gap-1">${STATE.lang === "zh-TW" ? "分組循環" : "Group Stage"}</span>`
                    : `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold card-inner border text-stone-600 dark:text-slate-300 inline-flex items-center gap-1"><i data-lucide="clock" class="w-3.5 h-3.5 text-stone-400"></i> ${t("estPrefix")} ${tData.durationHours || 2}${t("hrsUnit")}</span>`
            }
            <span>👥 ${pCount} ${isRegistering ? (STATE.lang === 'zh-TW' ? '人已報名' : 'Signed up') : t("playersCountLabel")}</span>
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

          ${!isRegistering ? (
            (tData.isPracticeMode || (tData.tournamentMode === "free" && total === 0)) ? `
              <div class="flex items-center justify-between text-[11px] sub-text font-mono pt-1.5 border-t border-stone-200/70 dark:border-slate-800/70">
                <span class="flex items-center gap-1 text-teal-600 dark:text-teal-400 font-bold">
                  <i data-lucide="${isFinished ? 'check-circle' : 'activity'}" class="w-3 h-3"></i>
                  ${isFinished ? (STATE.lang === 'zh-TW' ? '練球已存檔' : 'Completed') : (STATE.lang === 'zh-TW' ? '自由暢打中' : 'In Practice')}
                </span>
                <span class="font-bold text-stone-700 dark:text-slate-300">${pCount} ${STATE.lang === 'zh-TW' ? '人出席' : 'attendees'}</span>
              </div>
            ` : `
              <div class="space-y-1 pt-1.5 border-t border-stone-200/70 dark:border-slate-800/70">
                <div class="flex items-center justify-between text-[11px] sub-text font-mono">
                  <span>${STATE.lang === 'zh-TW' ? '賽程進度' : 'Progress'}</span>
                  <span class="font-bold ${isFinished ? 'text-emerald-500' : 'text-amber-500 dark:text-amber-400'}">
                    ${completedCount}/${total} (${pct}%)
                  </span>
                </div>
                <div class="w-full h-1.5 rounded-full bg-stone-200 dark:bg-slate-800 overflow-hidden">
                  <div class="h-full rounded-full transition-all duration-500 ${isFinished ? 'bg-emerald-500' : 'progress-shimmer'}" style="width: ${pct}%"></div>
                </div>
              </div>
            `
          ) : ''}
        </div>

        <div class="flex items-center gap-2 pt-2">
          <button onclick="enterTournament('${escapeJsAttr(tData.id)}')"
            class="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow-sm active:scale-95">
            <i data-lucide="${isRegistering ? 'clipboard-check' : 'play'}" class="w-3.5 h-3.5 ${isRegistering ? '' : 'fill-current'}"></i>
            <span>${isRegistering ? t("enterRegistration") : t("enterTournament")}</span>
          </button>
          ${STATE.isAdmin ? `
            <button onclick="deleteTournament('${escapeJsAttr(tData.id)}')" class="p-2.5 rounded-xl card-inner hover:bg-rose-500/20 sub-text hover:text-rose-500 border transition" title="Delete">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  };

  const activeContainer = document.getElementById("hub-active-tournaments-list");
  if (activeContainer) {
    if (activeList.length === 0) {
      activeContainer.innerHTML = `
        <div class="col-span-full glass-card rounded-2xl p-6 sm:p-8 text-center space-y-3 border">
          <div class="w-12 h-12 rounded-2xl card-inner border mx-auto flex items-center justify-center text-emerald-500 shadow-inner">
            <i data-lucide="layout-grid" class="w-6 h-6"></i>
          </div>
          <div>
            <h4 class="text-sm sm:text-base font-bold font-display leading-snug sm:leading-normal">
              ${STATE.lang === 'zh-TW'
                ? '<span class="block sm:inline">目前無進行中的公開球局，</span><span class="block sm:inline">請使用賽事連結或進入社團大廳</span>'
                : '<span class="block sm:inline">No active public matches.</span> <span class="block sm:inline">Use tournament link or enter Club Lobby</span>'
              }
            </h4>
          </div>
        </div>
      `;
    } else {
      activeContainer.innerHTML = activeList.map(renderCard).join("");
    }
  }

  const completedContainer = document.getElementById("hub-completed-tournaments-list");
  if (completedContainer) {
    if (completedList.length === 0) {
      completedContainer.innerHTML = `
        <div class="col-span-full glass-card rounded-2xl p-6 text-center space-y-1 border">
          <p class="text-xs font-semibold sub-text">${t("noCompletedTournamentsHub")}</p>
        </div>
      `;
    } else {
      completedContainer.innerHTML = completedList.map(renderCard).join("");
    }
  }

  if (window.lucide) lucide.createIcons();
}

export function toggleHubCompletedCollapse() {
  const wrap = document.getElementById("hub-completed-tournaments-wrap");
  const text = document.getElementById("hub-completed-toggle-text");
  const chevron = document.getElementById("hub-completed-chevron");
  const STATE = window.STATE || {};
  if (!wrap) return;
  const isHidden = wrap.classList.contains("hidden");
  if (isHidden) {
    wrap.classList.remove("hidden");
    if (text) text.innerText = STATE.lang === "zh-TW" ? "闔上" : "Collapse";
    if (chevron) chevron.classList.add("rotate-180");
  } else {
    wrap.classList.add("hidden");
    if (text) text.innerText = STATE.lang === "zh-TW" ? "展開" : "Expand";
    if (chevron) chevron.classList.remove("rotate-180");
  }
}

export function renderHubTournaments() {
  const STATE = window.STATE || {};
  const localData = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
  const cached = Object.values(localData);
  if (cached.length > 0) {
    displayHubTournamentsList(cached);
  } else {
    const activeContainer = document.getElementById("hub-active-tournaments-list");
    if (activeContainer) {
      activeContainer.innerHTML = `<div class="col-span-full text-center py-6 sub-text"><i data-lucide="loader-2" class="w-6 h-6 animate-spin mx-auto mb-1"></i>Loading...</div>`;
    }
    if (window.lucide) lucide.createIcons();
  }

  const loadingTimeout = setTimeout(() => {
    const activeContainer = document.getElementById("hub-active-tournaments-list");
    if (activeContainer && activeContainer.innerHTML.includes("Loading...")) {
      const fallbackData = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
      displayHubTournamentsList(Object.values(fallbackData));
    }
  }, 2000);

  if (STATE.hubUnsubscribe) {
    STATE.hubUnsubscribe();
    STATE.hubUnsubscribe = null;
  }

  if (STATE.db) {
    const tournamentsRef = ref(STATE.db, "tournaments");
    STATE.hubUnsubscribe = onValue(tournamentsRef, (snapshot) => {
      clearTimeout(loadingTimeout);
      let list = [];
      if (snapshot.exists()) {
        const data = snapshot.val();
        list = Object.values(data);
        safeSetLocal("pb_tournaments", JSON.stringify(data));
      } else {
        safeSetLocal("pb_tournaments", JSON.stringify({}));
      }
      displayHubTournamentsList(list);
    }, (error) => {
      clearTimeout(loadingTimeout);
      console.error("Fetch tournaments error:", error);
      const fallbackData = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
      displayHubTournamentsList(Object.values(fallbackData));
    });
  } else {
    clearTimeout(loadingTimeout);
    setTimeout(() => {
      if (STATE.db && STATE.currentPage === "hub" && !STATE.hubUnsubscribe) {
        renderHubTournaments();
      }
    }, 250);
  }
}

export function enterTournament(id) {
  if (typeof window.loadLiveTournament === "function") {
    window.loadLiveTournament(id, true);
  }
}

export async function deleteTournament(id, skipConfirm = false) {
  const STATE = window.STATE || {};
  let tObj = (STATE.allTournamentsCache || []).find(t => t.id === id);
  if (!tObj) {
    const local = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
    tObj = local[id];
  }

  const isFinishedFn = typeof window.isTournamentFinished === "function" ? window.isTournamentFinished : (t) => t && t.status === "finished";
  const isFinished = isFinishedFn(tObj);
  if (isFinished && !STATE.isAdmin) {
    if (typeof window.showToast === "function") {
      window.showToast(
        STATE.lang === "zh-TW" ? "🔒 完賽賽事需進入管理員後台才能刪除" : "🔒 Admin required to delete completed tournaments",
        "error"
      );
    }
    return;
  }

  const clubName = tObj ? (tObj.clubName || '').trim() : '';
  const tournamentName = tObj ? tObj.name : id;

  if (clubName && !STATE.isAdmin && (!STATE.authenticatedClubs || !STATE.authenticatedClubs.has(clubName))) {
    if (typeof window.verifyClubAccess === "function") {
      const ok = await window.verifyClubAccess(clubName);
      if (!ok) return;
    }
  }

  if (!skipConfirm) {
    const confirmMsg = STATE.lang === "zh-TW"
      ? `確定要刪除此賽事嗎，比賽紀錄不會歸檔紀錄？`
      : `Are you sure you want to delete this tournament? Match records will not be archived.`;
    if (!confirm(confirmMsg)) return;
  }

  if (STATE.db) {
    try {
      if (STATE.currentTournamentId === id && STATE.dbUnsubscribe) {
        STATE.dbUnsubscribe();
        STATE.dbUnsubscribe = null;
      }
      await remove(ref(STATE.db, `tournaments/${id}`));
    } catch (e) {
      console.error("Firebase delete error:", e);
    }
  }
  const local = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
  delete local[id];
  safeSetLocal("pb_tournaments", JSON.stringify(local));

  STATE.allTournamentsCache = (STATE.allTournamentsCache || []).filter(t => t.id !== id);

  const isLivePageVisible = !document.getElementById("page-live")?.classList.contains("hidden");
  if (isLivePageVisible || STATE.currentPage === "live" || STATE.currentTournamentId === id) {
    STATE.currentTournamentId = null;
    if (typeof window.navigateTo === "function") window.navigateTo(STATE.lineUserId ? "activities" : "hub");
  } else {
    displayHubTournamentsList(STATE.allTournamentsCache);
    renderHubTournaments();
    if (STATE.currentPage === "history" || !document.getElementById("page-history")?.classList.contains("hidden")) {
      if (typeof window.renderHistoryPage === "function") window.renderHistoryPage();
    }
  }
}

export async function liveDeleteTournament() {
  const STATE = window.STATE || {};
  if (!STATE.currentTournamentId) return;
  await deleteTournament(STATE.currentTournamentId);
}

export function renderHistoryPage() {
  const STATE = window.STATE || {};
  const container = document.getElementById("history-tournaments-list");
  if (!container) return;

  container.innerHTML = `<div class="text-center py-8 sub-text"><i data-lucide="loader-2" class="w-6 h-6 animate-spin mx-auto mb-1"></i>Loading...</div>`;
  if (window.lucide) lucide.createIcons();

  if (STATE.db) {
    const tournamentsRef = ref(STATE.db, "tournaments");
    Promise.all([
      get(tournamentsRef),
      get(ref(STATE.db, "clubs_metadata")).catch(() => null)
    ]).then(([snapshot, metaSnap]) => {
      let list = [];
      if (snapshot && snapshot.exists()) {
        const data = snapshot.val();
        list = Object.values(data);
        safeSetLocal("pb_tournaments", JSON.stringify(data));
      } else {
        safeSetLocal("pb_tournaments", JSON.stringify({}));
      }
      if (metaSnap && metaSnap.exists()) {
        STATE.clubsMetadataMap = metaSnap.val() || {};
        safeSetLocal("pb_clubs_metadata", JSON.stringify(STATE.clubsMetadataMap));
      }
      STATE.allTournamentsCache = list;
      if (typeof window.renderHistoryCategorized === "function") {
        window.renderHistoryCategorized(list);
      }
    }).catch(() => {
      const localData = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
      if (typeof window.renderHistoryCategorized === "function") {
        window.renderHistoryCategorized(Object.values(localData));
      }
    });
  } else {
    const localData = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
    if (typeof window.renderHistoryCategorized === "function") {
      window.renderHistoryCategorized(Object.values(localData));
    }
  }
}

export function setHistoryCategory(cat) {
  const STATE = window.STATE || {};
  STATE.historyCategory = cat;
  STATE.historyMonthFilter = "all";
  renderHistoryPage();
}

// 掛載至全域 window，保證與 HTML 內嵌 onclick 事件及其他模組 100% 相容
if (typeof window !== "undefined") {
  window.getMyTournamentIds = getMyTournamentIds;
  window.addMyTournamentId = addMyTournamentId;
  window.setHubTab = setHubTab;
  window.onHubClubFilterChange = onHubClubFilterChange;
  window.quickEnterTournament = quickEnterTournament;
  window.openQuickCodeModal = openQuickCodeModal;
  window.closeQuickCodeModal = closeQuickCodeModal;
  window.handleQuickCodeModalSubmit = handleQuickCodeModalSubmit;
  window.handleQuickCodeSubmit = handleQuickCodeSubmit;
  window.saveToLocalTournaments = saveToLocalTournaments;
  window.displayHubTournamentsList = displayHubTournamentsList;
  window.toggleHubCompletedCollapse = toggleHubCompletedCollapse;
  window.renderHubTournaments = renderHubTournaments;
  window.enterTournament = enterTournament;
  window.deleteTournament = deleteTournament;
  window.liveDeleteTournament = liveDeleteTournament;
  window.renderHistoryPage = renderHistoryPage;
  window.setHistoryCategory = setHistoryCategory;
}
