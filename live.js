// ============================================================
// ZEROZEROTWO LIVE TOURNAMENT & REGISTRATION LOBBY MODULE (live.js)
// ============================================================
import {
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import {
  escapeHTML,
  safeSetLocal,
  safeGetLocalJSON,
  sha256,
  parseTournamentDate,
  formatTournamentDate
} from "./utils.js";
import {
  getFullRoundRobinGames,
  generateSinglesSchedule,
  generateTeamRoundRobinSchedule,
  getValidTotalGames,
  getMaxTotalGames,
  generateRoundRobinSchedule
} from "./scheduler.js";

import {
  STATE,
  FUNCTIONS_BASE_URL,
  t,
  showToast,
  navigateTo,
  verifyClubAccess,
  encodeClubKey,
  saveToLocalTournaments,
  addMyTournamentId,
  deleteTournament
} from "./globals.js";

// PAGE D: LIVE TOURNAMENT CONTROLLER & REALTIME SYNC
// ----------------------------------------------------
async function loadLiveTournament(tId, pushHistory = true, keepAdmin = false) {
  STATE.currentTournamentId = tId;
  // 剛進到賽事計分頁面，默認一律為閱覽模式，需要計分等操作才手動點選「開啟操作」
  STATE.isViewerMode = true;
  if (!keepAdmin) {
    STATE.activeTournamentAdmin = null;
  }
  addMyTournamentId(tId);
  navigateTo("live", false);
  if (pushHistory) {
    window.history.pushState({}, "", `${window.location.pathname}?t=${tId}`);
  }

  document.getElementById("live-title").innerText = STATE.lang === "zh-TW" ? "賽事載入中..." : "Loading...";
  document.getElementById("live-id-badge").innerText = `ID: ${tId}`;

  if (STATE.db) {
    if (STATE.dbUnsubscribe) STATE.dbUnsubscribe();
    const tRef = ref(STATE.db, `tournaments/${tId}`);

    STATE.dbUnsubscribe = onValue(tRef, (snapshot) => {
      if (snapshot.exists()) {
        STATE.tournamentData = snapshot.val();
        saveToLocalTournaments(STATE.tournamentData);
        renderLiveUI(STATE.tournamentData);
      } else {
        const local = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
        delete local[tId];
        localStorage.setItem("pb_tournaments", JSON.stringify(local));
        showToast(STATE.lang === "zh-TW" ? "❌ 此賽事已不存在或已被刪除" : "Tournament not found or deleted", "error");
        navigateTo("hub");
      }
    });
  } else {
    loadFromLocalCache(tId);
  }
}
window.loadLiveTournament = loadLiveTournament;

function loadFromLocalCache(tId) {
  const local = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
  if (local[tId]) {
    STATE.tournamentData = local[tId];
    renderLiveUI(STATE.tournamentData);
  } else {
    navigateTo("hub");
  }
}

function addCreatedTournamentId(tId) {
  if (!tId) return;
  try {
    const list = JSON.parse(localStorage.getItem("pb_created_tournaments") || "[]");
    if (!list.includes(tId)) {
      list.push(tId);
      localStorage.setItem("pb_created_tournaments", JSON.stringify(list));
    }
  } catch (e) { }
}
window.addCreatedTournamentId = addCreatedTournamentId;

function isTournamentAdmin(tData) {
  if (!tData) return false;
  // 若當前手動切換為「瀏覽模式」，一律回傳 false
  if (STATE.isViewerMode) return false;

  // 所有的完賽，包含社團，包含有密碼的，完賽後一律凍結（僅超級管理員可操作）
  const isFinished = isTournamentFinished(tData);
  if (isFinished) {
    if (STATE.isAdmin) return true;
    return false;
  }

  // 未完賽進行中：人人皆具操作記分權限
  return true;
}
window.isTournamentAdmin = isTournamentAdmin;

function isTournamentFinished(tData) {
  if (!tData) return false;
  return tData.status === "completed";
}
window.isTournamentFinished = isTournamentFinished;

async function toggleTournamentAdminMode() {
  const tData = STATE.tournamentData;
  if (!tData) return;

  const isZh = STATE.lang === "zh-TW";
  const isFinished = isTournamentFinished(tData);

  // 若目前處於唯讀瀏覽模式，欲解鎖切換至「操作模式」：
  if (STATE.isViewerMode) {
    // 1. 若為超級管理員，直接無條件解鎖
    if (STATE.isAdmin) {
      STATE.isViewerMode = false;
      STATE.activeTournamentAdmin = tData.id;
      renderLiveUI(tData);
      return;
    }

    // 所有的完賽，包含社團，包含有密碼的，完賽後皆全面凍結，無法切換至操作模式
    if (isFinished) {
      return;
    }

    // 2. 賽事計分全面採現場互信制，免輸社團密碼直接解鎖操作模式
    STATE.isViewerMode = false;
  } else {
    // 若當前已經是操作模式，切換回唯讀瀏覽模式（防誤觸）
    STATE.isViewerMode = true;
  }

  renderLiveUI(tData);
}
window.toggleTournamentAdminMode = toggleTournamentAdminMode;

function renderLiveUI(data) {
  if (!data) return;

  if (data.name) {
    document.title = `${data.name} · ZeroZeroTwo`;
  } else {
    document.title = "ZeroZeroTwo";
  }

  // Normalize players & matches against Firebase object serialization
  if (data.players) {
    data.players = (Array.isArray(data.players) ? data.players : Object.values(data.players))
      .map(p => (p || "").trim())
      .filter(Boolean);
  } else {
    data.players = [];
  }
  if (data.matches) {
    data.matches = (Array.isArray(data.matches) ? data.matches : Object.values(data.matches)).filter(Boolean);
  } else {
    data.matches = [];
  }

  const totalMatches = data.matches ? data.matches.length : 0;
  const doneMatches = data.matches ? data.matches.filter(m => m.completed || m.voided).length : 0;
  const isFinished = isTournamentFinished(data);

  // 核心防護：所有的完賽（包含社團、包含有密碼的），完賽後一律全面凍結（僅超級管理員例外）
  if (isFinished && !STATE.isAdmin) {
    STATE.isViewerMode = true;
    if (STATE.activeTournamentAdmin === data.id) {
      STATE.activeTournamentAdmin = null;
    }
  }

  const hasAdmin = isTournamentAdmin(data);
  const isFreeMode = data.tournamentMode === "free";
  const isSingles = (data.partnerType === "singles");
  const isTeamMode = !!(data.isTeamMode || data.partnerType === "fixed");
  const pCount = data.players ? data.players.length : 0;
  const validMatches = (data.matches || []).filter(m => !m.voided);
  const playersPerGame = (isSingles || isTeamMode) ? 2 : 4;
  const estGamesPerPlayer = pCount > 0 ? Math.round((validMatches.length * playersPerGame / pCount) * 10) / 10 : 0;

  document.getElementById("live-title").innerText = data.name;

  // Mode Badge
  const isZh = (STATE.lang === "zh-TW");
  const modeBadge = document.getElementById("live-mode-badge");
  if (modeBadge) {
    if (data.status === "registering") {
      modeBadge.innerText = isZh ? "📋 報名中" : "📋 Registering";
      modeBadge.className = "px-2 py-0.5 rounded-md text-[10px] font-bold border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
    } else if (isSingles) {
      modeBadge.innerText = isZh ? "個人單打" : "Singles (1v1)";
      modeBadge.className = "px-2 py-0.5 rounded-md text-[10px] font-bold border bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
    } else if (isFreeMode) {
      modeBadge.innerText = t("modeFreeTitle");
      modeBadge.className = "px-2 py-0.5 rounded-md text-[10px] font-bold border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    } else {
      modeBadge.innerText = t("modeFairTitle");
      modeBadge.className = "px-2 py-0.5 rounded-md text-[10px] font-bold border bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20";
    }
  }

  // Club / Public Badge
  const clubBadge = document.getElementById("live-club-badge");
  if (clubBadge) {
    if (data.clubName && data.clubName.trim()) {
      clubBadge.innerHTML = `<i data-lucide="shield" class="w-2.5 h-2.5 text-amber-500 shrink-0"></i> <span>${escapeHTML(data.clubName.trim())}</span>`;
      clubBadge.className = "text-[10px] px-2 py-0.5 rounded-md font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 inline-flex items-center gap-1";
    } else {
      clubBadge.innerHTML = `<i data-lucide="zap" class="w-2.5 h-2.5 text-teal-500 shrink-0"></i> <span>${isZh ? '公開球局' : 'Public'}</span>`;
      clubBadge.className = "text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 inline-flex items-center gap-0.5";
    }
  }

  // Notes Card (活動說明與備註)
  const notesCard = document.getElementById("live-notes-card");
  const notesText = document.getElementById("live-notes-text");
  if (notesCard && notesText) {
    if (data.notes && data.notes.trim()) {
      notesText.innerText = data.notes.trim();
      notesCard.classList.remove("hidden");
    } else {
      notesCard.classList.add("hidden");
    }
  }

  // Duration badge wrap (支援點擊直接彈窗編輯時間)
  const durWrap = document.getElementById("live-duration-wrap");
  if (durWrap) {
    if (isFreeMode) {
      durWrap.classList.add("hidden");
    } else {
      durWrap.classList.remove("hidden");
      if (data.status === "registering") {
        durWrap.onclick = openEditDurationModal;
        durWrap.className = "flex items-center gap-1.5 px-2.5 py-1 rounded-lg card-inner border cursor-pointer hover:border-amber-500 hover:text-amber-500 transition shadow-sm active:scale-95 group";
        durWrap.title = isZh ? "點擊調整比賽時間" : "Click to adjust duration";
      } else {
        durWrap.onclick = null;
        durWrap.className = "flex items-center gap-1.5 px-2.5 py-1 rounded-lg card-inner border";
        durWrap.removeAttribute("title");
      }
    }
  }

  const unit = isTeamMode ? (isZh ? "隊" : "Teams") : (isZh ? "人" : "Players");
  const perUnit = isTeamMode ? (isZh ? "隊" : "team") : (isZh ? "人" : "p");

  if (data.status === "registering") {
    document.getElementById("live-players-count").innerText = `${pCount} 人`;
  } else {
    document.getElementById("live-players-count").innerText = isZh
      ? (isFreeMode ? `${pCount} ${unit}登記` : `${pCount} ${unit} (每${perUnit}約 ${estGamesPerPlayer} 場)`)
      : (isFreeMode ? `${pCount} ${unit}` : `${pCount} ${unit} (~${estGamesPerPlayer} g/${perUnit})`);
  }
  document.getElementById("live-duration").innerText = data.durationHours || "2.0";

  const matchPct = totalMatches > 0 ? Math.round((doneMatches / totalMatches) * 100) : 0;

  // Admin Mode Toggle Button Styling (操作模式 vs 唯讀瀏覽模式)
  const adminBtn = document.getElementById("btn-toggle-live-admin");
  const adminText = document.getElementById("text-toggle-live-admin");
  const adminIcon = document.getElementById("icon-toggle-live-admin");
  if (adminBtn && adminText) {
    const isFrozen = isFinished && !STATE.isAdmin;
    if (isFrozen) {
      // 所有的完賽，包含社團，包含有密碼的，完賽後都標示 賽事已凍結
      adminBtn.className = "flex-1 px-3 py-2 rounded-xl card-inner border border-stone-200/50 dark:border-stone-800/80 text-xs font-bold flex items-center justify-center gap-1.5 transition opacity-60 text-stone-400 dark:text-stone-500 cursor-not-allowed pointer-events-none select-none";
      adminText.innerText = isZh ? "賽事已凍結" : "Frozen";
      if (adminIcon) adminIcon.setAttribute("data-lucide", "lock");
    } else if (hasAdmin) {
      adminBtn.className = "flex-1 px-3 py-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-sm active:scale-95 outline-none cursor-pointer";
      adminText.innerText = isZh ? "操作中" : "In Operation";
      if (adminIcon) adminIcon.setAttribute("data-lucide", "edit-3");
    } else {
      adminBtn.className = "flex-1 px-3 py-2 rounded-xl card-inner border hover:border-emerald-500/50 text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-sm active:scale-95 outline-none text-stone-700 dark:text-slate-300 cursor-pointer";
      adminText.innerText = isZh ? "開啟操作" : "Enable Controls";
      if (adminIcon) adminIcon.setAttribute("data-lucide", "edit-3");
    }
  }

  const headerProgressBar = document.getElementById("live-header-progress-bar");
  if (headerProgressBar) {
    headerProgressBar.style.width = `${matchPct}%`;
  }
  const progressTextEl = document.getElementById("live-progress-text");
  if (progressTextEl) {
    progressTextEl.innerText = `${doneMatches}/${totalMatches} (${matchPct}%)`;
  }

  // 自由模式 / 練球 專屬「結束練球」按鈕 (僅在 0 場次純暢打時顯示，一旦新增場次則由「結束賽事」取代)
  const hasMatches = !!(data.matches && data.matches.length > 0);
  const isFreeOrPractice = !!(data.tournamentMode === "free" || data.isPracticeMode);
  const finishPracticeBtn = document.getElementById("btn-finish-practice");
  if (finishPracticeBtn) {
    if (hasAdmin && !isFinished && isFreeOrPractice && !hasMatches) {
      finishPracticeBtn.classList.remove("hidden");
      finishPracticeBtn.classList.add("flex");
    } else {
      finishPracticeBtn.classList.add("hidden");
      finishPracticeBtn.classList.remove("flex");
    }
  }

  // Complete & Return to Hub Button (一般賽事、或自由模式一旦新增場次後顯示)
  const completeBtn = document.getElementById("btn-complete-and-return");
  if (completeBtn) {
    if (hasAdmin && !isFinished && (!isFreeOrPractice || hasMatches)) {
      completeBtn.classList.remove("hidden");
      completeBtn.classList.add("flex");
    } else {
      completeBtn.classList.add("hidden");
      completeBtn.classList.remove("flex");
    }
  }

  // Delete Tournament Button (visible if hasAdmin and NOT finished, unless Master Admin)
  const deleteLiveBtn = document.getElementById("btn-live-delete-tournament");
  if (deleteLiveBtn) {
    if (hasAdmin && (!isFinished || STATE.isAdmin)) {
      deleteLiveBtn.classList.remove("hidden");
      deleteLiveBtn.classList.add("flex");
    } else {
      deleteLiveBtn.classList.add("hidden");
      deleteLiveBtn.classList.remove("flex");
    }
  }

  // Copy Report Button (Only visible when tournament is completed)
  const copyReportBtn = document.getElementById("btn-live-copy-report");
  if (copyReportBtn) {
    if (isFinished) {
      copyReportBtn.classList.remove("hidden");
      copyReportBtn.classList.add("flex");
    } else {
      copyReportBtn.classList.add("hidden");
      copyReportBtn.classList.remove("flex");
    }
  }

  // Add Match / Add Player Toolbar (visible if hasAdmin)
  const adminToolbar = document.getElementById("live-admin-toolbar");
  if (adminToolbar) {
    if (hasAdmin) {
      adminToolbar.classList.remove("hidden");
    } else {
      adminToolbar.classList.add("hidden");
    }
  }

  const liveAdminTitleEl = document.getElementById("t-live-admin-toolbar-title");
  if (liveAdminTitleEl) liveAdminTitleEl.innerText = isZh ? "操作面板" : "Operation Panel";
  const btnAddMatchToolbar = document.getElementById("t-btn-add-match-toolbar");
  if (btnAddMatchToolbar) btnAddMatchToolbar.innerText = t("btnAddMatchToolbar");
  const btnCompleteReturn = document.getElementById("t-btn-complete-and-return");
  if (btnCompleteReturn) btnCompleteReturn.innerText = t("finishAndReturnBtn");
  const finishPracticeText = document.getElementById("t-btn-finish-practice");
  if (finishPracticeText) finishPracticeText.innerText = isZh ? "結束練球" : "Finish Practice";
  const btnLiveDelete = document.getElementById("t-btn-live-delete");
  if (btnLiveDelete) btnLiveDelete.innerText = t("deleteTournamentBtn");
  const liveCopyReportText = document.getElementById("text-live-copy-report");
  if (liveCopyReportText) liveCopyReportText.innerText = t("copyReportBtn");
  const shareBtnTextEl = document.getElementById("t-share-btn-text");
  if (shareBtnTextEl) shareBtnTextEl.innerText = t("shareBtnText");

  const addLivePlayerBtn = document.getElementById("t-btn-add-live-player");
  if (addLivePlayerBtn) {
    const isTeam = getTournamentIsTeamMode(data);
    addLivePlayerBtn.innerText = isTeam ? (STATE.lang === "zh-TW" ? "補入隊伍" : "Add Team") : (STATE.lang === "zh-TW" ? "補入選手" : "Add Player");
  }

  const isRegistering = (data.status === "registering");
  const regLobbyEl = document.getElementById("live-registration-lobby");
  const liveMainGridEl = document.getElementById("live-main-grid");
  const headerProgressWrap = document.getElementById("live-header-progress-wrap");
  const headerActionsWrap = document.getElementById("live-header-actions-wrap");

  if (isRegistering) {
    if (regLobbyEl) regLobbyEl.classList.remove("hidden");
    if (liveMainGridEl) liveMainGridEl.classList.add("hidden");
    if (adminToolbar) adminToolbar.classList.add("hidden");
    if (completeBtn) completeBtn.classList.add("hidden");
    if (copyReportBtn) copyReportBtn.classList.add("hidden");
    if (headerProgressWrap) headerProgressWrap.classList.add("hidden");
    if (headerActionsWrap) headerActionsWrap.classList.add("hidden");

    if (progressTextEl) {
      progressTextEl.innerText = isZh ? "報名中" : "Registering";
    }
    if (headerProgressBar) {
      headerProgressBar.style.width = "100%";
      headerProgressBar.className = "h-full rounded-full transition-all duration-500 bg-amber-500";
    }

    const btnLobbyEditDur = document.getElementById("btn-lobby-edit-duration");
    if (btnLobbyEditDur) btnLobbyEditDur.classList.remove("hidden");

    const regCountText = document.getElementById("lobby-registered-count-text");
    if (regCountText) {
      const maxLimit = data.maxPlayers ? Number(data.maxPlayers) : null;
      if (maxLimit) {
        const isFull = pCount >= maxLimit;
        regCountText.innerHTML = isZh
          ? `已報名 <span class="font-black ${isFull ? 'text-rose-500' : 'text-emerald-500'}">${pCount}</span> / 上限 ${maxLimit} 人 ${isFull ? '<span class="text-rose-500 font-bold">(已滿額)</span>' : ''}`
          : `Signed up <span class="font-black ${isFull ? 'text-rose-500' : 'text-emerald-500'}">${pCount}</span> / ${maxLimit} max ${isFull ? '<span class="text-rose-500 font-bold">(Full)</span>' : ''}`;
      } else {
        regCountText.innerText = isZh ? `共 ${pCount} 人` : `Total: ${pCount}`;
      }
    }

    const chipsEl = document.getElementById("lobby-registered-chips");
    if (chipsEl) {
      if ((data.players || []).length === 0) {
        chipsEl.innerHTML = `<span class="sub-text text-xs italic py-1">${isZh ? "目前尚無人報名，請在下方輸入姓名或點選成員加入！" : "No players registered yet. Enter name below or pick members to join!"}</span>`;
      } else {
        chipsEl.innerHTML = (data.players || []).map((p, idx) => {
          return `
                <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl card-inner border font-bold text-xs bg-stone-500/10 text-stone-800 dark:text-slate-200 shadow-sm">
                  <span class="text-[10px] text-amber-600 dark:text-amber-400 font-mono font-black">#${idx + 1}</span>
                  <span>${escapeHTML(p)}</span>
                  <button type="button" onclick="unregisterPlayerFromTournament('${escapeHTML(p)}')" title="${isZh ? '移除 / 取消報名' : 'Remove'}"
                    class="hover:text-rose-500 text-stone-400 dark:text-slate-500 transition ml-1 p-0.5 rounded active:scale-90">
                    <i data-lucide="x" class="w-3.5 h-3.5"></i>
                  </button>
                </div>
              `;
        }).join("");
      }
    }

    const clubSectionEl = document.getElementById("lobby-club-members-section");
    const clubChipsEl = document.getElementById("lobby-club-members-chips");
    if (clubSectionEl && clubChipsEl) {
      if (data.clubName) {
        const clubMembers = getClubMembersList(data.clubName);
        if (clubMembers.length > 0) {
          clubSectionEl.classList.remove("hidden");
          const currentRoster = data.players || [];
          clubChipsEl.innerHTML = clubMembers.map(m => {
            const isJoined = currentRoster.includes(m);
            if (isJoined) {
              return `
                    <span class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                      <i data-lucide="check" class="w-3 h-3"></i> ${escapeHTML(m)}
                    </span>
                  `;
            } else {
              return `
                    <button type="button" onclick="registerPlayerToTournament('${escapeHTML(m)}')"
                      class="px-2.5 py-1 rounded-lg text-xs font-semibold card-inner border hover:border-teal-500 text-stone-700 dark:text-slate-300 hover:text-teal-600 dark:hover:text-teal-400 transition flex items-center gap-1 active:scale-95 shadow-sm">
                      <i data-lucide="plus" class="w-3 h-3"></i> ${escapeHTML(m)}
                    </button>
                  `;
            }
          }).join("");
        } else {
          clubSectionEl.classList.add("hidden");
        }
      } else {
        clubSectionEl.classList.add("hidden");
      }
    }

    const liffBannerEl = document.getElementById("lobby-liff-profile-banner");
    if (liffBannerEl) {
      // 1. 未登入 LINE：直接隱藏該按鈕，維持版面俐落
      if (!STATE.lineUserId || !STATE.lineProfile) {
        liffBannerEl.classList.add("hidden");
      } else {
        liffBannerEl.classList.remove("hidden");
        const clubName = data.clubName || STATE.currentClub || "";
        let boundName = null;
        if (clubName) {
          boundName = localStorage.getItem(`pb_bound_name_${clubName}`);
          if (!boundName && STATE.currentClub === clubName && STATE.clubPlayerName) {
            boundName = STATE.clubPlayerName;
          }
        } else {
          boundName = localStorage.getItem("pb_bound_name___general__") || STATE.clubPlayerName || null;
        }
        if (boundName && boundName.length > 10) {
          boundName = boundName.slice(0, 10);
        }

        const currentRoster = Array.isArray(data.players) ? data.players : [];
        const isJoined = boundName ? currentRoster.includes(boundName) : false;

        if (isJoined) {
          // 4. 已在名單中：顯示「已以『球員姓名』報名簽到」狀態條與「取消報名」按鈕，下方帶有垂直無擠壓情境出口
          liffBannerEl.innerHTML = `
                <div class="space-y-1.5">
                  <div class="flex items-center justify-between p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs font-semibold gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                      <i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-500 shrink-0"></i>
                      <span class="truncate">${isZh ? `已以「${escapeHTML(boundName)}」報名簽到` : `Joined as "${escapeHTML(boundName)}"`}</span>
                    </div>
                    <button type="button" onclick="unregisterPlayerFromTournament('${escapeHTML(boundName)}')"
                      class="text-[10px] sm:text-xs px-2.5 py-1 rounded-lg border border-rose-500/30 text-rose-500 hover:bg-rose-500/10 font-bold transition shrink-0 cursor-pointer">
                      ${isZh ? "取消報名" : "Withdraw"}
                    </button>
                  </div>
                  <div class="flex items-center justify-between px-1 text-[11px] sub-text">
                    <span class="flex items-center gap-1"><i data-lucide="check" class="w-3 h-3 text-emerald-500"></i> ${isZh ? "報名已列入名單" : "Signed up"}</span>
                    <button type="button" onclick="navigateTo('activities')" class="font-bold text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-0.5 cursor-pointer">
                      ${isZh ? "查看我的活動" : "My Activities"} <i data-lucide="chevron-right" class="w-3 h-3"></i>
                    </button>
                  </div>
                </div>
              `;
        } else if (boundName) {
          // 3. 已在社團內綁定球員身分：顯示「使用社團綁定身分報名」按鈕
          liffBannerEl.innerHTML = `
                <button type="button" onclick="registerPlayerToTournament('${escapeHTML(boundName)}')"
                  class="w-full py-2.5 px-3.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow-md active:scale-95 cursor-pointer">
                  <i data-lucide="user-check" class="w-4 h-4 shrink-0"></i>
                  <span class="truncate">${isZh ? `使用社團綁定身分報名（${escapeHTML(boundName)}）` : `Join with club identity (${escapeHTML(boundName)})`}</span>
                </button>
              `;
        } else {
          // 2. 登入 LINE 但未綁定社團球員身分：顯示社團大廳風格的質感琥珀按鈕「⚠️ 尚未綁定球員身分，請先完成認領」，點擊立即開啟認領彈窗
          liffBannerEl.innerHTML = `
                <button type="button" onclick="handleLobbyClaimIdentityClick('${escapeHTML(clubName)}')"
                  class="w-full py-2.5 px-3.5 rounded-xl card-inner border border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 text-xs font-bold transition flex items-center justify-between gap-2 shadow-sm active:scale-95 cursor-pointer">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span class="truncate">${isZh ? "⚠️ 尚未綁定球員身分，請先完成認領" : "⚠️ Identity Not Bound. Tap to Claim"}</span>
                  </div>
                  <span class="px-2.5 py-1 rounded-lg bg-amber-500 text-white text-[10px] font-bold shrink-0">
                    ${isZh ? "前往認領" : "Claim"}
                  </span>
                </button>
              `;
        }
      }
    }

    renderLobbySchedulePlans(data);

    lucide.createIcons();
    return;
  }

  if (regLobbyEl) regLobbyEl.classList.add("hidden");
  if (liveMainGridEl) liveMainGridEl.classList.remove("hidden");
  if (headerProgressWrap) headerProgressWrap.classList.remove("hidden");
  if (headerActionsWrap) headerActionsWrap.classList.remove("hidden");

  // Render Matches Schedule
  renderMatchesList(data.matches || [], hasAdmin);

  // Calculate & Render Leaderboard
  const leaderboardData = calculateLeaderboard(data.players || [], data.matches || []);
  renderLeaderboardTable(leaderboardData);

  lucide.createIcons();
}

function handleLobbyClaimIdentityClick(clubName) {
  const targetClub = clubName || STATE.currentClub || (STATE.tournamentData && STATE.tournamentData.clubName) || "";
  if (typeof showClubIdentityClaimModal === "function") {
    showClubIdentityClaimModal(targetClub);
  }
}
window.handleLobbyClaimIdentityClick = handleLobbyClaimIdentityClick;

// ----------------------------------------------------
// REGISTRATION LOBBY ACTIONS & CHECK-IN CONTROLLERS
// ----------------------------------------------------
async function registerPlayerToTournament(playerName) {
  const tData = STATE.tournamentData;
  if (!tData || !tData.id) return;
  if (tData.status !== "registering") {
    showToast(STATE.lang === "zh-TW" ? "該賽事已截止報名或已開賽！" : "Tournament registration closed!", "warning");
    return;
  }

  let name = (playerName || "").trim();
  if (!name) {
    showToast(STATE.lang === "zh-TW" ? "請輸入選手姓名！" : "Please enter player name!", "warning");
    return;
  }
  if (name.length > 10) {
    name = name.slice(0, 10);
  }

  const currentPlayers = Array.isArray(tData.players) ? [...tData.players] : [];
  if (currentPlayers.includes(name)) {
    showToast(STATE.lang === "zh-TW" ? `「${name}」已經在報名名單中了！` : `"${name}" is already registered!`, "info");
    return;
  }

  const maxLimit = (tData.maxPlayers && !isNaN(Number(tData.maxPlayers))) ? Number(tData.maxPlayers) : null;
  if (maxLimit && currentPlayers.length >= maxLimit) {
    showToast(
      STATE.lang === "zh-TW"
        ? `⚠️ 報名人數已達上限（${maxLimit} 人），名額已滿！`
        : `⚠️ Registration is full (${maxLimit} max)!`,
      "error"
    );
    return;
  }

  currentPlayers.push(name);
  tData.players = currentPlayers;

  // 訪客無痕離開，不保留本地追蹤；僅已登入會員保留輸入慣用名稱
  if (STATE.lineUserId) {
    localStorage.setItem("pb_my_player_name", name);
  }

  if (tData.clubName) {
    const clubMembers = getClubMembersList(tData.clubName);
    if (!clubMembers.includes(name)) {
      clubMembers.push(name);
      saveClubMembersList(tData.clubName, clubMembers);
    }
  }

  saveToLocalTournaments(tData);
  if (STATE.db) {
    try {
      const playersRef = ref(STATE.db, `tournaments/${tData.id}/players`);
      const txResult = await runTransaction(playersRef, (serverPlayers) => {
        let list = Array.isArray(serverPlayers) ? [...serverPlayers] : [];
        if (list.includes(name)) return list; // 已存在不重複加入
        if (maxLimit && list.length >= maxLimit) {
          return; // 取消交易，名額滿了
        }
        list.push(name);
        return list;
      });

      if (!txResult.committed) {
        showToast(
          STATE.lang === "zh-TW"
            ? `⚠️ 報名失敗：名額剛好已滿（${maxLimit} 人）！`
            : `⚠️ Registration full (${maxLimit} max)!`,
          "error"
        );
        return;
      }
      tData.players = txResult.snapshot.val() || currentPlayers;
    } catch (err) {
      console.error("Firebase transaction error:", err);
      try {
        await update(ref(STATE.db, `tournaments/${tData.id}`), { players: currentPlayers });
      } catch (e) { }
    }
  }
  renderLiveUI(tData);
}
window.registerPlayerToTournament = registerPlayerToTournament;

async function unregisterPlayerFromTournament(playerName) {
  const tData = STATE.tournamentData;
  if (!tData || !tData.id) return;
  if (tData.status !== "registering") {
    showToast(STATE.lang === "zh-TW" ? "賽事已開打，無法取消報名！" : "Tournament has already started!", "warning");
    return;
  }

  let name = (playerName || "").trim();
  if (!confirm(STATE.lang === "zh-TW" ? `確定將「${name}」自報名名單中移除嗎？` : `Remove "${name}" from registration?`)) return;

  const currentPlayers = (tData.players || []).filter(p => p !== name);
  tData.players = currentPlayers;

  saveToLocalTournaments(tData);
  if (STATE.db) {
    try {
      const playersRef = ref(STATE.db, `tournaments/${tData.id}/players`);
      const txResult = await runTransaction(playersRef, (serverPlayers) => {
        if (!Array.isArray(serverPlayers)) return [];
        return serverPlayers.filter(p => p !== name);
      });
      if (txResult.committed) {
        tData.players = txResult.snapshot.val() || currentPlayers;
      }
    } catch (err) {
      console.error("Firebase unregister transaction error:", err);
      try {
        await update(ref(STATE.db, `tournaments/${tData.id}`), { players: currentPlayers });
      } catch (e) { }
    }
  }
  renderLiveUI(tData);
}
window.unregisterPlayerFromTournament = unregisterPlayerFromTournament;

async function promptCustomPlayerNameAndRegister() {
  const isZh = STATE.lang === "zh-TW";
  const savedCustom = localStorage.getItem("pb_custom_player_name") || "";
  const defaultSuggest = (savedCustom || (STATE.lineProfile && STATE.lineProfile.displayName) || "").slice(0, 10);

  const promptMsg = isZh
    ? "請輸入您在球局中要顯示的選手暱稱 (上限10字)："
    : "Enter your tournament player display name (max 10 chars):";

  const entered = prompt(promptMsg, defaultSuggest);
  if (entered === null) return;

  let clean = entered.trim();
  if (!clean) {
    showToast(isZh ? "選手名稱不得為空！" : "Player name cannot be empty!", "warning");
    return;
  }
  if (clean.length > 10) {
    clean = clean.slice(0, 10);
  }

  try {
    localStorage.setItem("pb_custom_player_name", clean);
  } catch (e) { }

  await registerPlayerToTournament(clean);
}
window.promptCustomPlayerNameAndRegister = promptCustomPlayerNameAndRegister;

async function joinRegistrationFromInput() {
  const input = document.getElementById("lobby-player-input");
  let raw = input ? input.value.trim() : "";

  if (!raw) {
    if (STATE.lineProfile && STATE.lineProfile.displayName) {
      await promptCustomPlayerNameAndRegister();
    } else {
      showToast(STATE.lang === "zh-TW" ? "請輸入選手姓名！" : "Please enter player name!", "warning");
      if (input) input.focus();
    }
    return;
  }

  const names = raw.split(/[\n,，\s]+/).map(s => s.trim().slice(0, 10)).filter(Boolean);
  if (input) input.value = "";

  for (const name of names) {
    await registerPlayerToTournament(name);
  }
}
window.joinRegistrationFromInput = joinRegistrationFromInput;

function renderLobbySchedulePlans(tData) {
  const wrap = document.getElementById("lobby-schedule-plans-wrap");
  const container = document.getElementById("lobby-schedule-plans-container");
  const badge = document.getElementById("lobby-plans-count-badge");
  const hiddenInput = document.getElementById("lobby-selected-total-games");
  const startBtn = document.getElementById("btn-lobby-start-tournament");
  const practiceBtn = document.getElementById("btn-lobby-start-practice");
  if (!wrap || !container) return;

  const isZh = (STATE.lang === "zh-TW");
  const players = (tData.players || []).map(p => p.trim()).filter(Boolean);
  const isSingles = (tData.partnerType === "singles");
  const isTeamMode = !!(tData.isTeamMode || tData.partnerType === "fixed");
  const minUnits = isSingles ? 2 : 4;
  const unitLabel = isTeamMode ? (isZh ? "隊" : "teams") : (isZh ? "人" : "players");
  const n = players.length;

  // 自由模式 / 練球 按鈕狀態控制 (只要有 1 人以上簽到隨時可開練)
  if (practiceBtn) {
    if (n >= 1) {
      practiceBtn.disabled = false;
      practiceBtn.classList.remove("opacity-50", "cursor-not-allowed");
      practiceBtn.innerHTML = `<span>${isZh ? `自由模式/練球 (不排賽程，以目前 ${n} 人直接開打)` : `Free Mode / Practice (${n} players)`}</span>`;
    } else {
      practiceBtn.disabled = true;
      practiceBtn.classList.add("opacity-50", "cursor-not-allowed");
      practiceBtn.innerHTML = `<span>${isZh ? '自由模式/練球 (等待人員報名簽到)' : 'Free Mode / Practice (Waiting for players)'}</span>`;
    }
  }

  // 若人數不足自動排賽開賽門檻
  if (n < minUnits) {
    wrap.classList.add("hidden");
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.classList.add("opacity-60", "cursor-not-allowed");
      const diff = minUnits - n;
      startBtn.innerHTML = `<span>${isZh ? `等待選手報名中 (目前 ${n} 人，尚差 ${diff} 人開賽)` : `Waiting for players (${n}/${minUnits})...`}</span>`;
    }
    lucide.createIcons();
    return;
  }

  // 人數已達門檻，展開排賽方案選擇區 (無論建立時選平均模式或自由模式皆可自由切換)
  wrap.classList.remove("hidden");
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.classList.remove("opacity-60", "cursor-not-allowed");
  }

  const durationHours = parseFloat(tData.durationHours) || 2.0;
  const totalMinutes = Math.round(durationHours * 60);

  // 計算輪播參數
  function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
  const playersPerGame = isSingles ? 2 : 4;
  const g = gcd(playersPerGame, n);
  const blockSize = n / g;
  const gamesPerBlock = playersPerGame / g;

  // 方案計算
  const allValidPlans = [];
  const maxB = Math.max(15, Math.ceil(totalMinutes / (8 * blockSize)) + 2);

  for (let b = 1; b <= maxB; b++) {
    const totalGames = b * blockSize;
    if (totalGames > 45) break;

    const avgMins = parseFloat((totalMinutes / totalGames).toFixed(1));
    if (avgMins >= 8.0 && avgMins <= 25.0) {
      allValidPlans.push({
        block: b,
        totalGames,
        gamesEach: b * gamesPerBlock,
        restEach: totalGames - (b * gamesPerBlock),
        avgMins,
        diffFromIdeal: Math.abs(avgMins - 14.0)
      });
    }
  }

  let plans = allValidPlans;
  if (plans.length === 0) {
    for (let b = 1; b <= 4; b++) {
      const totalGames = b * blockSize;
      const avgMins = parseFloat((totalMinutes / totalGames).toFixed(1));
      plans.push({
        block: b,
        totalGames,
        gamesEach: b * gamesPerBlock,
        restEach: totalGames - (b * gamesPerBlock),
        avgMins,
        diffFromIdeal: Math.abs(avgMins - 14.0)
      });
    }
  }

  plans.sort((a, b) => a.diffFromIdeal - b.diffFromIdeal);
  plans = plans.slice(0, 3).sort((a, b) => a.totalGames - b.totalGames);

  // 加上完整全循環方案 (若未在清單內且合適)
  const fullGames = getFullRoundRobinGames(n, isTeamMode, isSingles);
  const fullGamesEach = (isTeamMode || isSingles) ? (n - 1) : Math.round((fullGames * 4) / n);
  if (fullGames <= 36 && !plans.some(p => p.totalGames === fullGames)) {
    const fullAvgMins = parseFloat((totalMinutes / fullGames).toFixed(1));
    plans.push({
      block: "full",
      isFullCycle: true,
      totalGames: fullGames,
      gamesEach: fullGamesEach,
      restEach: fullGames - fullGamesEach,
      avgMins: fullAvgMins,
      diffFromIdeal: 99
    });
    plans.sort((a, b) => a.totalGames - b.totalGames);
  }

  // 當前選中的總局數
  let selectedGames = parseInt(hiddenInput?.value);
  if (!selectedGames || !plans.some(p => p.totalGames === selectedGames)) {
    let best = plans[0];
    let minD = Infinity;
    plans.forEach(p => {
      if (!p.isFullCycle && p.diffFromIdeal < minD) {
        minD = p.diffFromIdeal;
        best = p;
      }
    });
    selectedGames = best.totalGames;
    if (hiddenInput) hiddenInput.value = selectedGames;
  }

  if (badge) {
    badge.innerText = isZh ? `報名 ${n} ${unitLabel} · 預估 ${durationHours}h` : `${n} ${unitLabel} · ${durationHours}h`;
  }

  let html = "";
  plans.forEach((p, idx) => {
    const isSelected = (p.totalGames === selectedGames);
    const planName = p.isFullCycle
      ? (isZh ? "完整全循環" : "Full Cycle")
      : (idx === 0 ? (isZh ? "最適推薦" : "Recommended") : (isZh ? `方案 ${idx + 1}` : `Plan ${idx + 1}`));

    html += `
          <button type="button" onclick="selectLobbySchedulePlan(${p.totalGames})"
            class="p-2.5 sm:p-3 rounded-xl border-2 text-left transition cursor-pointer active:scale-95 flex flex-col justify-between gap-1.5 ${isSelected ? 'border-emerald-500 bg-emerald-500/10 shadow-sm' : 'border-stone-200 dark:border-slate-800 hover:border-emerald-500/40'}">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-bold ${isSelected ? 'text-emerald-600 dark:text-emerald-400' : 'sub-text'} flex items-center gap-1">
                ${isSelected ? '<i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i>' : '<i data-lucide="circle" class="w-3.5 h-3.5 opacity-40"></i>'}
                ${planName}
              </span>
              <span class="text-xs font-black font-mono text-emerald-600 dark:text-emerald-400">共 ${p.totalGames} 局</span>
            </div>
            <div class="space-y-0.5">
              <div class="text-xs font-bold text-stone-800 dark:text-stone-200">
                每${unitLabel}各打 <strong class="text-emerald-600 dark:text-emerald-400">${p.gamesEach}</strong> 場
              </div>
              <div class="text-[10px] sub-text flex items-center justify-between">
                <span>休 ${p.restEach} 場</span>
                <span>約 ${Math.round(p.avgMins)} 分/局</span>
              </div>
            </div>
          </button>
        `;
  });

  container.innerHTML = html;

  // 更新開賽按鈕文字
  const currentPlan = plans.find(p => p.totalGames === selectedGames);
  if (startBtn && currentPlan) {
    startBtn.innerHTML = `<i data-lucide="rocket" class="w-4 h-4"></i> <span>${isZh ? `依【${currentPlan.totalGames} 局方案 (每${unitLabel} ${currentPlan.gamesEach} 場)】平均模式開賽！` : `Start with Fair Mode (${currentPlan.totalGames} Games)`}</span>`;
  }

  lucide.createIcons();
}
window.renderLobbySchedulePlans = renderLobbySchedulePlans;

function selectLobbySchedulePlan(totalGames) {
  const hiddenInput = document.getElementById("lobby-selected-total-games");
  if (hiddenInput) hiddenInput.value = totalGames;
  if (STATE.tournamentData) {
    renderLobbySchedulePlans(STATE.tournamentData);
  }
}
window.selectLobbySchedulePlan = selectLobbySchedulePlan;

let PENDING_LOBBY_START_MODE = "schedule";

function promptConfirmStartTournament(startMode = "schedule") {
  const tData = STATE.tournamentData;
  if (!tData) return;

  const isZh = (STATE.lang === "zh-TW");
  const players = (tData.players || []).map(p => p.trim()).filter(Boolean);
  const isSingles = (tData.partnerType === "singles");
  const isTeamMode = !!(tData.isTeamMode || tData.partnerType === "fixed");
  const minUnits = isSingles ? 2 : 4;
  const unitLabel = isTeamMode ? (isZh ? "隊" : "teams") : (isZh ? "人" : "players");
  const n = players.length;

  // 檢查開賽門檻
  if (startMode === "practice") {
    if (n < 1) {
      showToast(isZh ? "至少需 1 位選手才能開始練球！" : "At least 1 player needed to start practice!", "warning");
      return;
    }
  } else {
    if (n < minUnits) {
      showToast(
        isZh
          ? (isSingles ? `個人單打至少需 ${minUnits} 位選手！目前僅 ${n} 人。` : `雙打輪轉至少需 ${minUnits} 位參賽單位！目前僅 ${n} 人。`)
          : `At least ${minUnits} players required! Currently: ${n}`,
        "warning"
      );
      return;
    }
  }

  PENDING_LOBBY_START_MODE = startMode;
  const modal = document.getElementById("modal-confirm-start-tournament");
  if (!modal) {
    const confirmMsg = startMode === "practice"
      ? (isZh ? `🏓 確定要以目前 ${n} 人開啟自由練球模式嗎？\n（開賽後將結束報名接龍）` : `🎯 確認全員到齊，正式排賽開打？\n（共 ${n} ${unitLabel}，開賽後將正式生成對戰賽程並結束報名）`)
      : (isZh ? `🎯 確認全員到齊，正式排賽開打？\n（共 ${n} ${unitLabel}，開賽後將正式生成對戰賽程並結束報名）` : `Start tournament with ${n} ${unitLabel}?`);
    if (confirm(confirmMsg)) {
      startTournamentFromLobby(startMode, true);
    }
    return;
  }

  const iconBox = document.getElementById("confirm-start-icon-box");
  const iconEl = document.getElementById("confirm-start-icon");
  const titleEl = document.getElementById("confirm-start-title");
  const subtitleEl = document.getElementById("confirm-start-subtitle");
  const summaryCard = document.getElementById("confirm-start-summary-card");
  const warningText = document.getElementById("confirm-start-warning-text");
  const confirmBtnText = document.getElementById("btn-execute-start-text");
  const cancelBtnText = document.getElementById("btn-cancel-start-text");

  if (cancelBtnText) {
    cancelBtnText.innerText = t("btnWaitCancel") || (isZh ? "再等等 / 取消" : "Wait / Cancel");
  }

  if (startMode === "practice") {
    if (iconBox) iconBox.className = "w-10 h-10 rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0";
    if (iconEl) iconEl.setAttribute("data-lucide", "activity");
    if (titleEl) titleEl.innerText = isZh ? "確認開啟自由模式？" : "Confirm Free Practice Mode?";
    if (subtitleEl) subtitleEl.innerText = isZh ? "不排對戰賽程，以現有名冊直接暢打" : "Start playing freely with current players";
    if (summaryCard) {
      summaryCard.innerHTML = `
            <div class="flex items-center justify-between border-b border-stone-200/60 dark:border-slate-800/60 pb-2">
              <span class="sub-text">${isZh ? "目前名單" : "Players"}</span>
              <span class="font-bold font-mono text-emerald-600 dark:text-emerald-400">${n} ${unitLabel}</span>
            </div>
            <div class="flex items-center justify-between pt-1">
              <span class="sub-text">${isZh ? "比賽模式" : "Mode"}</span>
              <span class="font-bold text-teal-600 dark:text-teal-400">${isZh ? "自由練球 / 隨機暢打" : "Free Practice"}</span>
            </div>
          `;
    }
    if (warningText) {
      warningText.innerHTML = `
            <i data-lucide="alert-triangle" class="w-3.5 h-3.5 shrink-0 text-amber-500"></i>
            <span>${isZh ? "開賽後將結束接龍報名，以目前名單直接開打。" : "Registration will close immediately."}</span>
          `;
    }
    if (confirmBtnText) confirmBtnText.innerText = isZh ? "確認開始自由練球" : "Start Free Mode";
  } else {
    const selectedLobbyGames = parseInt(document.getElementById("lobby-selected-total-games")?.value) || 0;
    const totalGames = selectedLobbyGames || tData.customTotalGames || 0;
    const durationHours = parseFloat(tData.durationHours) || 2.0;

    if (iconBox) iconBox.className = "w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0";
    if (iconEl) iconEl.setAttribute("data-lucide", "rocket");
    if (titleEl) titleEl.innerText = isZh ? "確認全員到齊，排賽開打？" : "Ready to Start Tournament?";
    if (subtitleEl) subtitleEl.innerText = isZh ? "即將正式生成賽程並鎖定報名" : "Matches will be generated and sign-up closed";

    const previewList = players.slice(0, 5).join("、") + (n > 5 ? ` 等共 ${n} 人` : "");

    if (summaryCard) {
      summaryCard.innerHTML = `
            <div class="flex items-center justify-between border-b border-stone-200/60 dark:border-slate-800/60 pb-2">
              <span class="sub-text">${isZh ? "參賽人數" : "Players"}</span>
              <span class="font-bold font-mono text-emerald-600 dark:text-emerald-400">${n} ${unitLabel}</span>
            </div>
            <div class="flex items-center justify-between border-b border-stone-200/60 dark:border-slate-800/60 pb-2 pt-1">
              <span class="sub-text">${isZh ? "預計時長" : "Duration"}</span>
              <span class="font-bold font-mono">${durationHours} ${isZh ? "小時" : "hours"}</span>
            </div>
            <div class="flex items-center justify-between border-b border-stone-200/60 dark:border-slate-800/60 pb-2 pt-1">
              <span class="sub-text">${isZh ? "排賽方案" : "Schedule"}</span>
              <span class="font-bold text-emerald-600 dark:text-emerald-400">${totalGames > 0 ? (isZh ? `預計共 ${totalGames} 局` : `${totalGames} Games`) : (isZh ? "智慧循環排賽" : "Fair Cycle")}</span>
            </div>
            <div class="pt-1 text-[11px] sub-text truncate" title="${players.join(', ')}">
              <span>👥 ${previewList}</span>
            </div>
          `;
    }
    if (warningText) {
      warningText.innerHTML = `
            <i data-lucide="alert-triangle" class="w-3.5 h-3.5 shrink-0 text-amber-500"></i>
            <span>${isZh ? "開賽後將關閉接龍報名，請確認全員皆已到齊！" : "Sign-up will close. Confirm all players have arrived!"}</span>
          `;
    }
    if (confirmBtnText) confirmBtnText.innerText = isZh ? "確認全員到齊，開賽！" : "Confirm & Start Tournament";
  }

  modal.classList.remove("hidden");
  lucide.createIcons();
}
window.promptConfirmStartTournament = promptConfirmStartTournament;

function closeConfirmStartModal() {
  const modal = document.getElementById("modal-confirm-start-tournament");
  if (modal) modal.classList.add("hidden");
}
window.closeConfirmStartModal = closeConfirmStartModal;

async function executeStartTournamentConfirmed() {
  closeConfirmStartModal();
  await startTournamentFromLobby(PENDING_LOBBY_START_MODE, true);
}
window.executeStartTournamentConfirmed = executeStartTournamentConfirmed;

async function startTournamentFromLobby(startMode = 'schedule', confirmed = false) {
  if (!confirmed) {
    promptConfirmStartTournament(startMode);
    return;
  }
  const tData = STATE.tournamentData;
  if (!tData || !tData.id) return;

  const isZh = (STATE.lang === "zh-TW");
  const players = (tData.players || []).map(p => p.trim()).filter(Boolean);
  const isSingles = (tData.partnerType === "singles");
  const isTeamMode = !!(tData.isTeamMode || tData.partnerType === "fixed");
  const minUnits = isSingles ? 2 : 4;

  // 1. 若點選「自由練球 / 暢打」
  if (startMode === 'practice') {
    if (players.length < 1) {
      showToast(isZh ? "至少需 1 位選手才能開始練球！" : "At least 1 player needed to start practice!", "warning");
      return;
    }

    tData.tournamentMode = "free";
    tData.isPracticeMode = true;
    tData.matches = [];
    tData.status = "active";
    tData.startedAt = new Date().toISOString();

    saveToLocalTournaments(tData);
    if (STATE.db) {
      await set(ref(STATE.db, `tournaments/${tData.id}`), tData);
    }

    renderLiveUI(tData);
    return;
  }

  // 2. 若點選「平均模式開賽」
  if (players.length < minUnits) {
    showToast(
      isZh
        ? (isSingles ? `個人單打至少需 ${minUnits} 位選手！目前僅 ${players.length} 人。` : `雙打輪轉至少需 ${minUnits} 位參賽單位！目前僅 ${players.length} 人。`)
        : `At least ${minUnits} players required! Currently: ${players.length}`,
      "warning"
    );
    return;
  }

  tData.tournamentMode = "fair";
  tData.isPracticeMode = false;

  const startBtn = document.getElementById("btn-lobby-start-tournament");
  const originalBtnHtml = startBtn ? startBtn.innerHTML : "開賽";
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.classList.add("opacity-60", "cursor-not-allowed");
    startBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> <span>${STATE.lang === "zh-TW" ? "排賽計算中..." : "Scheduling..."}</span>`;
    lucide.createIcons();
  }

  try {
    let matches = [];
    let backendSuccess = false;
    const duration = tData.durationHours || 2.0;
    const selectedLobbyGames = parseInt(document.getElementById("lobby-selected-total-games")?.value) || 0;
    const customTotalGames = selectedLobbyGames || tData.customTotalGames || 0;
    tData.customTotalGames = customTotalGames;
    const effectiveMode = "fair";

    if (effectiveMode !== "free") {
      try {
        const format = isSingles ? "singles" : (isTeamMode ? "team" : "doubles");
        const res = await fetch(`${FUNCTIONS_BASE_URL}/generateSchedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            players: players,
            format: format,
            durationHours: duration,
            scheduleMode: effectiveMode,
            customTotalGames: customTotalGames,
            estMinsPerGame: 15
          })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.matches)) {
            matches = data.matches;
            backendSuccess = true;
            console.info("%c[Scheduler] 報名房開賽計算成功, 場次: " + matches.length, "color: #10b981; font-weight: bold; font-size: 13px;");
          }
        }
      } catch (backendErr) {
        console.warn("[Scheduler] 雲端排程失敗，啟用前端離線備援:", backendErr);
      }

      if (!backendSuccess) {
        if (isSingles) {
          matches = generateSinglesSchedule(players, duration, 15, effectiveMode, customTotalGames);
        } else if (isTeamMode) {
          matches = generateTeamRoundRobinSchedule(players);
        } else {
          matches = generateRoundRobinSchedule(players, duration, 15, effectiveMode, customTotalGames);
        }
      }
    }

    tData.matches = matches;
    tData.status = "active";
    tData.startedAt = new Date().toISOString();
    // 正式開賽進入計分板時，默認維持閱覽模式（防止誤觸比分）
    STATE.isViewerMode = true;

    saveToLocalTournaments(tData);
    if (STATE.db) {
      await set(ref(STATE.db, `tournaments/${tData.id}`), tData);
    }

    renderLiveUI(tData);

  } catch (err) {
    console.error("Start Tournament Error:", err);
    showToast(STATE.lang === "zh-TW" ? `❌ 開賽失敗: ${err.message || err}` : `❌ Failed to start: ${err.message || err}`, "error");
  } finally {
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.classList.remove("opacity-60", "cursor-not-allowed");
      startBtn.innerHTML = originalBtnHtml;
      lucide.createIcons();
    }
  }
}
window.startTournamentFromLobby = startTournamentFromLobby;

function openEditDurationModal() {
  const tData = STATE.tournamentData;
  if (!tData) return;
  const input = document.getElementById("edit-duration-input");
  if (input) input.value = tData.durationHours || 2.0;
  const modal = document.getElementById("modal-edit-duration");
  if (modal) modal.classList.remove("hidden");
  lucide.createIcons();
}
window.openEditDurationModal = openEditDurationModal;

function closeEditDurationModal() {
  const modal = document.getElementById("modal-edit-duration");
  if (modal) modal.classList.add("hidden");
}
window.closeEditDurationModal = closeEditDurationModal;

function setQuickDuration(val) {
  const input = document.getElementById("edit-duration-input");
  if (input) input.value = val;
}
window.setQuickDuration = setQuickDuration;

async function saveTournamentDuration() {
  const tData = STATE.tournamentData;
  if (!tData || !tData.id) return;
  const input = document.getElementById("edit-duration-input");
  const val = parseFloat(input?.value);
  if (isNaN(val) || val <= 0 || val > 12) {
    showToast(STATE.lang === "zh-TW" ? "請輸入有效的比賽時數 (0.5 ~ 12 小時)" : "Please enter valid duration", "warning");
    return;
  }
  tData.durationHours = val;
  saveToLocalTournaments(tData);
  if (STATE.db) {
    try {
      await update(ref(STATE.db, `tournaments/${tData.id}`), { durationHours: val });
    } catch (err) {
      console.error("Firebase update duration error:", err);
    }
  }
  closeEditDurationModal();
  renderLiveUI(tData);
}
window.saveTournamentDuration = saveTournamentDuration;

async function cancelRegistrationTournament() {
  const tId = STATE.currentTournamentId;
  if (!tId) return;
  const tData = STATE.tournamentData;
  const tName = tData ? tData.name : tId;
  const isZh = (STATE.lang === "zh-TW");
  if (!confirm(isZh ? `確定要取消並刪除報名球局嗎？` : `Cancel & delete tournament ?\n(This cannot be undone)`)) {
    return;
  }
  await deleteTournament(tId, true);
}
window.cancelRegistrationTournament = cancelRegistrationTournament;

async function completeTournamentAndReturn() {
  const tData = STATE.tournamentData;
  if (!tData) return;

  if (!isTournamentAdmin(tData)) {
    showToast(STATE.lang === "zh-TW" ? "請先點擊「開啟操作」！" : "Please enable controls first!", "warning");
    return;
  }

  const uncompletedMatches = (tData.matches || []).filter(m => !m.completed && !m.voided);
  const uncompletedCount = uncompletedMatches.length;

  let confirmMsg = "";
  if (uncompletedCount > 0) {
    confirmMsg = STATE.lang === "zh-TW"
      ? `目前尚有 ${uncompletedCount} 場比賽未完成，確定要提早結束並將賽事歸檔嗎？`
      : `There are still ${uncompletedCount} unplayed matches. Complete early and archived?`;
  } else {
    confirmMsg = STATE.lang === "zh-TW"
      ? `確認完賽嗎？\n\n⚠️ 提醒：完賽後賽事將全面凍結，無法再修正分數！`
      : `Complete ?\n\n⚠️ Note: The tournament will be frozen and scores cannot be modified!`;
  }

  if (!confirm(confirmMsg)) return;

  // 自動將所有未完賽且未取消的場次轉為「已取消 (voided)」
  if (uncompletedCount > 0) {
    (tData.matches || []).forEach(m => {
      if (!m.completed && !m.voided) {
        m.voided = true;
        m.completed = true;
        m.blueScore = null;
        m.redScore = null;
      }
    });
  }

  tData.status = "completed";
  tData.completedAt = Date.now();

  if (STATE.db) {
    try {
      const tRef = ref(STATE.db, `tournaments/${tData.id}`);
      await update(tRef, {
        status: "completed",
        completedAt: tData.completedAt,
        matches: tData.matches
      });
    } catch (err) {
      console.error("Complete tournament error:", err);
    }
  }
  saveToLocalTournaments(tData);
  navigateTo(STATE.lineUserId ? "activities" : "hub");
}
window.completeTournamentAndReturn = completeTournamentAndReturn;

function stepMatchScore(matchId, side, delta) {
  const input = document.getElementById(`score-${side}-${matchId}`);
  if (!input || input.disabled) return;
  let val = parseInt(input.value || "0", 10);
  if (isNaN(val)) val = 0;
  val = Math.max(0, Math.min(99, val + delta));
  input.value = val;
}
window.stepMatchScore = stepMatchScore;

function renderMatchesList(matches, hasAdmin = false) {
  const container = document.getElementById("matches-container");
  const validMatches = (matches || []).filter(m => !m.voided);
  const doneCount = validMatches.filter(m => m.completed).length;
  document.getElementById("completed-count").innerText = `${doneCount} / ${validMatches.length} ${t("completedGamesBadge")}`;

  if (matches.length === 0) {
    const isPractice = STATE.tournamentData && (STATE.tournamentData.isPracticeMode || STATE.tournamentData.tournamentMode === "free");
    if (isPractice) {
      const isZh = STATE.lang === 'zh-TW';
      container.innerHTML = `
            <div class="glass-card rounded-2xl p-6 sm:p-8 text-center space-y-2 border">
              <p class="font-bold text-sm sm:text-base text-stone-900 dark:text-white">${isZh ? '自由模式進行中' : 'Free Play in Progress'}</p>
              <p class="sub-text text-xs">${isZh ? '點擊上方開啟操作，可彈性加賽與結束今日練球' : 'Enable controls above to add matches or finish practice.'}</p>
            </div>
          `;
      lucide.createIcons();
      return;
    }

    container.innerHTML = `
          <div class="glass-card rounded-2xl p-6 sm:p-8 text-center space-y-2.5 border">
            <div class="w-12 h-12 rounded-2xl card-inner sub-text flex items-center justify-center mx-auto text-emerald-500 border shadow-sm">
              <i data-lucide="swords" class="w-6 h-6"></i>
            </div>
            <p class="font-bold text-sm sm:text-base">${STATE.lang === 'zh-TW' ? '尚未有賽程' : 'No matches yet'}</p>
            <p class="sub-text text-xs">${hasAdmin ? (STATE.lang === 'zh-TW' ? '點擊上方「➕ 新增場次」開始開局記分！' : 'Click "➕ Add Match" above to start games!') : (STATE.lang === 'zh-TW' ? '請等待管理員開局...' : 'Waiting for host to start games...')}</p>
          </div>
        `;
    lucide.createIcons();
    return;
  }

  const matchesHTML = matches.map((m, idx) => {
    const isDone = m.completed;
    const isVoided = m.voided;
    const bScore = m.blueScore != null ? Number(m.blueScore) : null;
    const rScore = m.redScore != null ? Number(m.redScore) : null;
    const blueWon = isDone && bScore !== null && rScore !== null && bScore > rScore;
    const redWon = isDone && bScore !== null && rScore !== null && rScore > bScore;

    // Score display: Editable inputs in Admin Mode with steppers, read-only scoreboard in Viewer Mode
    let scoreHTML = '';
    if (hasAdmin) {
      scoreHTML = `
            <!-- Teams Grid (Admin Mode - Editable with Quick Stepper) -->
            <div class="grid grid-cols-2 gap-2 sm:gap-3 ${isVoided ? 'opacity-50' : ''}">
              <!-- Blue Side -->
              <div class="p-3 sm:p-3.5 rounded-2xl bg-gradient-to-b from-blue-500/15 to-blue-500/5 border border-blue-500/30 space-y-2 flex flex-col justify-between shadow-sm">
                <div class="space-y-1 text-sm sm:text-base font-bold text-stone-900 dark:text-white tracking-wide">
                  <div class="truncate">${m.blue[0] || ''}</div>
                  ${m.blue[1] ? `<div class="truncate">${m.blue[1]}</div>` : ''}
                </div>
                <!-- Stepper Controls -->
                <div class="flex items-center justify-center gap-1.5 pt-1.5">
                  <button type="button" onclick="stepMatchScore(${m.id}, 'blue', -1)" ${isVoided ? 'disabled' : ''} class="w-8 h-8 rounded-xl card-inner border flex items-center justify-center text-xs font-black sub-text hover:text-rose-500 hover:border-rose-500/40 active:scale-90 transition select-none shadow-sm">−1</button>
                  <input type="number" inputmode="numeric" pattern="[0-9]*" min="0" max="99" id="score-blue-${m.id}" ${isVoided ? 'disabled' : ''} value="${m.blueScore != null ? m.blueScore : ''}" placeholder="0" class="w-14 sm:w-16 input-bg border border-blue-500/40 rounded-xl py-1.5 text-center font-mono text-xl sm:text-2xl font-black focus:outline-none focus:border-blue-400 scoreboard-num shadow-inner" />
                  <button type="button" onclick="stepMatchScore(${m.id}, 'blue', 1)" ${isVoided ? 'disabled' : ''} class="w-8 h-8 rounded-xl card-inner border flex items-center justify-center text-xs font-black sub-text hover:text-emerald-500 hover:border-emerald-500/40 active:scale-90 transition select-none shadow-sm">+1</button>
                </div>
              </div>

              <!-- Red Side -->
              <div class="p-3 sm:p-3.5 rounded-2xl bg-gradient-to-b from-rose-500/15 to-rose-500/5 border border-rose-500/30 space-y-2 flex flex-col justify-between shadow-sm">
                <div class="space-y-1 text-sm sm:text-base font-bold text-stone-900 dark:text-white tracking-wide">
                  <div class="truncate">${m.red[0] || ''}</div>
                  ${m.red[1] ? `<div class="truncate">${m.red[1]}</div>` : ''}
                </div>
                <!-- Stepper Controls -->
                <div class="flex items-center justify-center gap-1.5 pt-1.5">
                  <button type="button" onclick="stepMatchScore(${m.id}, 'red', -1)" ${isVoided ? 'disabled' : ''} class="w-8 h-8 rounded-xl card-inner border flex items-center justify-center text-xs font-black sub-text hover:text-rose-500 hover:border-rose-500/40 active:scale-90 transition select-none shadow-sm">−1</button>
                  <input type="number" inputmode="numeric" pattern="[0-9]*" min="0" max="99" id="score-red-${m.id}" ${isVoided ? 'disabled' : ''} value="${m.redScore != null ? m.redScore : ''}" placeholder="0" class="w-14 sm:w-16 input-bg border border-rose-500/40 rounded-xl py-1.5 text-center font-mono text-xl sm:text-2xl font-black focus:outline-none focus:border-rose-400 scoreboard-num shadow-inner" />
                  <button type="button" onclick="stepMatchScore(${m.id}, 'red', 1)" ${isVoided ? 'disabled' : ''} class="w-8 h-8 rounded-xl card-inner border flex items-center justify-center text-xs font-black sub-text hover:text-emerald-500 hover:border-emerald-500/40 active:scale-90 transition select-none shadow-sm">+1</button>
                </div>
              </div>
            </div>
          `;
    } else {
      // Viewer Mode - Read Only Digital Scoreboard
      const hasBlueScore = m.blueScore != null;
      const hasRedScore = m.redScore != null;
      const isScored = isDone && hasBlueScore && hasRedScore;

      scoreHTML = `
            <!-- Teams Grid (Viewer Mode - Digital Scoreboard with Winner Highlight) -->
            <div class="grid grid-cols-2 gap-2 sm:gap-3 ${isVoided ? 'opacity-50' : ''}">
              <!-- Blue Side -->
              <div class="p-3 sm:p-3.5 rounded-2xl ${blueWon ? 'winner-card-blue bg-blue-500/20' : 'bg-blue-500/10'} border ${blueWon ? 'border-blue-500' : 'border-blue-500/25'} space-y-2 flex flex-col justify-between transition-all">
                <div class="space-y-1">
                  <div class="flex items-center justify-between gap-1">
                    <div class="text-sm sm:text-base font-bold text-stone-900 dark:text-white truncate">
                      ${m.blue[0] || ''}
                    </div>
                    ${blueWon ? `<span class="text-[9px] px-1.5 py-0.5 rounded-full font-black bg-blue-500 text-white shrink-0 shadow-sm animate-pulse">WIN</span>` : ''}
                  </div>
                  ${m.blue[1] ? `
                  <div class="text-sm sm:text-base font-bold text-stone-900 dark:text-white truncate">
                    ${m.blue[1]}
                  </div>` : ''}
                </div>
                <div class="pt-1 text-center font-mono text-3xl sm:text-4xl font-black scoreboard-num ${blueWon ? 'text-blue-600 dark:text-blue-400 drop-shadow-sm scale-105' : isScored ? 'sub-text opacity-70' : 'sub-text opacity-30'} transition-transform">
                  ${hasBlueScore ? m.blueScore : '0'}
                </div>
              </div>

              <!-- Red Side -->
              <div class="p-3 sm:p-3.5 rounded-2xl ${redWon ? 'winner-card-red bg-rose-500/20' : 'bg-rose-500/10'} border ${redWon ? 'border-rose-500' : 'border-rose-500/25'} space-y-2 flex flex-col justify-between transition-all">
                <div class="space-y-1">
                  <div class="flex items-center justify-between gap-1">
                    <div class="text-sm sm:text-base font-bold text-stone-900 dark:text-white truncate">
                      ${m.red[0] || ''}
                    </div>
                    ${redWon ? `<span class="text-[9px] px-1.5 py-0.5 rounded-full font-black bg-rose-500 text-white shrink-0 shadow-sm animate-pulse">WIN</span>` : ''}
                  </div>
                  ${m.red[1] ? `
                  <div class="text-sm sm:text-base font-bold text-stone-900 dark:text-white truncate">
                    ${m.red[1]}
                  </div>` : ''}
                </div>
                <div class="pt-1 text-center font-mono text-3xl sm:text-4xl font-black scoreboard-num ${redWon ? 'text-rose-600 dark:text-rose-400 drop-shadow-sm scale-105' : isScored ? 'sub-text opacity-70' : 'sub-text opacity-30'} transition-transform">
                  ${hasRedScore ? m.redScore : '0'}
                </div>
              </div>
            </div>
          `;
    }

    // Action / Status Footer
    let footerHTML = '';
    if (hasAdmin) {
      if (isVoided) {
        footerHTML = `
              <div class="flex items-center justify-between gap-2 pt-1 border-t border-stone-200 dark:border-slate-800/60 text-[11px]">
                <span class="px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold border border-rose-500/20">${t("voidedNotice")}</span>
                <button onclick="toggleVoidMatch(${m.id})" class="px-2.5 py-1 font-bold rounded-lg text-xs transition bg-stone-500/10 hover:bg-stone-500/20 sub-text border">
                  ${t("restoreMatchBtn")}
                </button>
              </div>
            `;
      } else {
        footerHTML = `
              <div class="flex items-center justify-between gap-2 pt-1 border-t border-stone-200 dark:border-slate-800/60 text-[11px]">
                <div class="sub-text truncate">
                  <span>${t("restingLabel")}<strong class="text-stone-800 dark:text-slate-200 font-semibold">${m.resting && m.resting.length ? m.resting.join(', ') : t('noResting')}</strong></span>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <button onclick="toggleVoidMatch(${m.id})" class="px-2 py-1 font-semibold rounded-lg text-[11px] transition text-rose-500 hover:bg-rose-500/10 border border-rose-500/20" title="Void Match">
                    ${t("voidMatchBtn")}
                  </button>
                  <button onclick="saveMatchScore(${m.id})" class="px-3.5 py-1.5 font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow-sm active:scale-95 ${isDone ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400 border border-amber-500/30' : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white dark:text-slate-950'}">
                    <i data-lucide="${isDone ? 'edit-2' : 'check'}" class="w-3.5 h-3.5"></i> ${isDone ? t("editScoreBtn") : t("saveScoreBtn")}
                  </button>
                </div>
              </div>
            `;
      }
    } else {
      // Viewer footer
      let statusBadge = `<span class="sub-text text-[11px] italic">${t("inProgressBadge")}</span>`;
      if (isVoided) {
        statusBadge = `<span class="px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold border border-rose-500/20 text-[11px]">${t("voidMatchBtn")}</span>`;
      } else if (isDone) {
        statusBadge = `<span class="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/20 text-[11px]">${t("finishedBadge")}</span>`;
      }
      footerHTML = `
            <div class="flex items-center justify-between gap-2 pt-1 border-t border-stone-200 dark:border-slate-800/60 text-[11px]">
              <div class="sub-text truncate">
                <span>${t("restingLabel")}<strong class="text-stone-800 dark:text-slate-200 font-semibold">${m.resting && m.resting.length ? m.resting.join(', ') : t('noResting')}</strong></span>
              </div>
              <div>${statusBadge}</div>
            </div>
          `;
    }

    return `
          <div class="glass-card hover-lift rounded-2xl p-3.5 sm:p-4 border ${isVoided ? 'border-rose-500/30 bg-rose-500/5' : isDone ? 'border-emerald-500/40 shadow-sm' : ''} transition space-y-3">
            <!-- Game Header -->
            <div class="flex items-center justify-between">
              <span class="text-xs sm:text-sm font-display font-extrabold flex items-center gap-1.5">
                <span class="w-6 h-6 rounded-lg card-inner text-emerald-600 dark:text-emerald-400 text-xs flex items-center justify-center font-mono border font-black">${m.id}</span>
                ${STATE.lang === 'zh-TW' ? `第 ${m.id} 局` : `Game ${m.id}`}
              </span>
              ${isVoided ? `<span class="text-[10px] px-1.5 py-0.5 rounded font-bold bg-rose-500/20 text-rose-600 dark:text-rose-400">${t("voidedBadge")}</span>` : ''}
            </div>

            ${scoreHTML}
            ${footerHTML}
          </div>
        `;
  }).join("");

  // 當所有有效場次已完成且尚未結算時，在列表底部呈現專屬的醒目完賽引導卡片
  let completionCardHTML = "";
  const isFinished = isTournamentFinished(STATE.tournamentData);
  const allScored = validMatches.length > 0 && validMatches.every(m => m.completed && m.blueScore !== null && m.redScore !== null);
  if (allScored && !isFinished && hasAdmin) {
    const isZh = STATE.lang === "zh-TW";
    completionCardHTML = `
      <div class="glass-card rounded-2xl p-4 sm:p-5 border-2 border-amber-500/60 bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-transparent flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
        <div class="flex items-center gap-3 w-full sm:w-auto">
          <div class="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-500 border border-amber-500/40 flex items-center justify-center shrink-0 shadow-md animate-bounce">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="text-amber-500">
              <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
              <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
              <path d="M4 22h16"/>
              <path d="M10 14.66V17c0 .55-.45 1-1 1H7v4h10v-4h-2c-.55 0-1-.45-1-1v-2.34"/>
              <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" fill="#f59e0b" fill-opacity="0.3"/>
            </svg>
          </div>
          <div>
            <h4 class="font-bold text-sm sm:text-base text-stone-900 dark:text-white">${isZh ? "🎉 所有場次比分已登錄完成！" : "🎉 All matches have been scored!"}</h4>
            <p class="text-xs sub-text">${isZh ? "請核對分數無誤後，點選右方按鈕結束賽事並凍結結算。" : "Please verify scores, then end tournament to finalize results."}</p>
          </div>
        </div>
        <button type="button" onclick="completeTournamentAndReturn()" class="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition cursor-pointer shrink-0">
          <i data-lucide="check-circle-2" class="w-4 h-4"></i> ${isZh ? "結束賽事並結算" : "End & Finalize"}
        </button>
      </div>
    `;
  }

  container.innerHTML = matchesHTML + completionCardHTML;

  lucide.createIcons();
}

async function toggleVoidMatch(matchId) {
  const tData = STATE.tournamentData;
  if (!tData || !tData.matches) return;
  if (!isTournamentAdmin(tData)) {
    showToast(STATE.lang === "zh-TW" ? "請先點擊「開啟操作」！" : "Please enable controls first!", "warning");
    return;
  }

  const match = tData.matches.find(m => m.id === matchId);
  if (!match) return;

  if (match.voided) {
    match.voided = false;
    match.completed = false;
  } else {
    const confirmMsg = STATE.lang === "zh-TW"
      ? `🚫 確定將第 ${matchId} 局標記為「取消」嗎？\n（該局將不計入勝負與得分排行榜）`
      : `🚫 Void Game ${matchId}? (Will not count in leaderboard)`;
    if (!confirm(confirmMsg)) return;

    match.voided = true;
    match.completed = true;
    match.blueScore = null;
    match.redScore = null;
  }

  saveToLocalTournaments(tData);
  if (STATE.db) {
    try {
      const matchIdx = tData.matches.findIndex(m => m.id === matchId);
      if (matchIdx !== -1) {
        const updates = {};
        updates[`tournaments/${tData.id}/matches/${matchIdx}/voided`] = match.voided;
        updates[`tournaments/${tData.id}/matches/${matchIdx}/completed`] = match.completed;
        updates[`tournaments/${tData.id}/matches/${matchIdx}/blueScore`] = match.blueScore;
        updates[`tournaments/${tData.id}/matches/${matchIdx}/redScore`] = match.redScore;
        await update(ref(STATE.db), updates);
      }
    } catch (e) {
      console.error("Firebase sync error:", e);
    }
  }

  renderLiveUI(tData);
}
window.toggleVoidMatch = toggleVoidMatch;

// ----------------------------------------------------
// LIVE VIEW: ADD MATCH (加打一局 / 增加場次)
// ----------------------------------------------------
// Helper: 判斷賽事是否為「固定隊伍 / 隊伍對抗賽」模式（每隊1單位，但不包括個人單打）
function getTournamentIsTeamMode(tData) {
  if (!tData) return false;
  if (tData.partnerType === "singles") return false;
  if (tData.partnerType === "fixed") return true;
  if (tData.isTeamMode !== undefined) return tData.isTeamMode;
  if (tData.matches && tData.matches.length > 0) {
    const firstMatch = tData.matches.find(m => !m.voided) || tData.matches[0];
    if (firstMatch && firstMatch.blue) {
      return firstMatch.blue.length === 1;
    }
  }
  return false;
}
window.getTournamentIsTeamMode = getTournamentIsTeamMode;

// Helper: 判斷每方是否僅有 1 個出賽欄位（單打 1v1 或 隊伍對抗 1v1）
function isSinglePlayerPerSide(tData) {
  if (!tData) return false;
  if (tData.partnerType === "singles") return true;
  return getTournamentIsTeamMode(tData);
}
window.isSinglePlayerPerSide = isSinglePlayerPerSide;

function setAddMatchFormat(format) {
  STATE.addMatchFormat = format;
  const isSingles = (format === "singles");

  const btnDoubles = document.getElementById("modal-btn-format-doubles");
  const btnSingles = document.getElementById("modal-btn-format-singles");
  const blue2 = document.getElementById("add-blue-2");
  const red2 = document.getElementById("add-red-2");
  const swapPartnersBtn = document.getElementById("modal-btn-swap-partners");
  const blueTitle = document.getElementById("modal-blue-team-title");
  const redTitle = document.getElementById("modal-red-team-title");

  const activeCls = "px-2.5 py-1 rounded-md text-xs font-semibold bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-sm transition";
  const inactiveCls = "px-2.5 py-1 rounded-md text-xs font-semibold text-stone-500 dark:text-slate-400 hover:text-stone-800 dark:hover:text-slate-200 transition";

  if (btnDoubles) btnDoubles.className = isSingles ? inactiveCls : activeCls;
  if (btnSingles) btnSingles.className = isSingles ? activeCls : inactiveCls;

  if (blue2) {
    if (isSingles) {
      blue2.value = "";
      blue2.classList.add("hidden");
    } else {
      blue2.classList.remove("hidden");
    }
  }
  if (red2) {
    if (isSingles) {
      red2.value = "";
      red2.classList.add("hidden");
    } else {
      red2.classList.remove("hidden");
    }
  }
  if (swapPartnersBtn) {
    if (isSingles) swapPartnersBtn.classList.add("hidden");
    else swapPartnersBtn.classList.remove("hidden");
  }

  const isZh = (STATE.lang === "zh-TW");
  const isTeam = getTournamentIsTeamMode(STATE.tournamentData);
  if (blueTitle) blueTitle.innerText = isTeam ? (isZh ? "藍隊" : "Blue Team") : (isSingles ? (isZh ? "藍方" : "Blue Side") : (isZh ? "藍隊" : "Blue Team"));
  if (redTitle) redTitle.innerText = isTeam ? (isZh ? "紅隊" : "Red Team") : (isSingles ? (isZh ? "紅方" : "Red Side") : (isZh ? "紅隊" : "Red Team"));

  renderAddMatchRosterChips();
}
window.setAddMatchFormat = setAddMatchFormat;

function renderAddMatchRosterChips() {
  const container = document.getElementById("modal-roster-chips");
  if (!container) return;

  const tData = STATE.tournamentData;
  if (!tData) return;

  const players = tData.players || [];
  const gamesCount = {};
  players.forEach(p => { gamesCount[p] = 0; });
  (tData.matches || []).filter(m => !m.voided).forEach(m => {
    (m.blue || []).concat(m.red || []).forEach(p => {
      if (gamesCount[p] !== undefined) gamesCount[p]++;
    });
  });

  const b1 = document.getElementById("add-blue-1")?.value || "";
  const b2 = document.getElementById("add-blue-2")?.value || "";
  const r1 = document.getElementById("add-red-1")?.value || "";
  const r2 = document.getElementById("add-red-2")?.value || "";

  const isZh = (STATE.lang === "zh-TW");
  const seated = {};
  if (b1) seated[b1] = { side: "blue", label: isZh ? "藍1" : "B1" };
  if (b2 && STATE.addMatchFormat !== "singles") seated[b2] = { side: "blue", label: isZh ? "藍2" : "B2" };
  if (r1) seated[r1] = { side: "red", label: isZh ? "紅1" : "R1" };
  if (r2 && STATE.addMatchFormat !== "singles") seated[r2] = { side: "red", label: isZh ? "紅2" : "R2" };

  const html = players.map(p => {
    const count = gamesCount[p] || 0;
    const seatInfo = seated[p];
    if (seatInfo) {
      const isBlue = (seatInfo.side === "blue");
      const badgeCls = isBlue
        ? "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/40"
        : "bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/40";
      return `<button type="button" onclick="unassignAddMatchPlayer('${escapeHTML(p)}')"
            class="px-2 py-1 rounded-lg text-xs font-bold border transition flex items-center gap-1 shadow-sm active:scale-95 ${badgeCls}">
            <span>${escapeHTML(p)}</span>
            <span class="text-[10px] px-1 py-0.5 rounded font-mono bg-stone-900/10 dark:bg-stone-100/10">${seatInfo.label} · ${count}${isZh ? '場' : 'g'}</span>
            <i data-lucide="x" class="w-3 h-3 opacity-60 hover:opacity-100"></i>
          </button>`;
    } else {
      return `<button type="button" onclick="assignAddMatchPlayer('${escapeHTML(p)}')"
            class="px-2 py-1 rounded-lg text-xs font-medium card-inner border hover:border-amber-500/60 sub-text hover:text-stone-900 dark:hover:text-stone-100 transition flex items-center gap-1 active:scale-95">
            <span>${escapeHTML(p)}</span>
            <span class="text-[10px] font-mono opacity-60">${count}${isZh ? '場' : 'g'}</span>
          </button>`;
    }
  }).join("");

  container.innerHTML = html;
  lucide.createIcons();
}
window.renderAddMatchRosterChips = renderAddMatchRosterChips;

function assignAddMatchPlayer(name) {
  const b1 = document.getElementById("add-blue-1");
  const b2 = document.getElementById("add-blue-2");
  const r1 = document.getElementById("add-red-1");
  const r2 = document.getElementById("add-red-2");

  if (
    (b1 && b1.value === name) ||
    (b2 && b2.value === name && STATE.addMatchFormat !== "singles") ||
    (r1 && r1.value === name) ||
    (r2 && r2.value === name && STATE.addMatchFormat !== "singles")
  ) {
    return;
  }

  const isSingles = (STATE.addMatchFormat === "singles");
  const slots = isSingles ? [b1, r1] : [b1, r1, b2, r2];

  for (const slot of slots) {
    if (slot && !slot.value) {
      slot.value = name;
      renderAddMatchRosterChips();
      return;
    }
  }
}
window.assignAddMatchPlayer = assignAddMatchPlayer;

function unassignAddMatchPlayer(name) {
  ["add-blue-1", "add-blue-2", "add-red-1", "add-red-2"].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value === name) {
      el.value = "";
    }
  });
  renderAddMatchRosterChips();
}
window.unassignAddMatchPlayer = unassignAddMatchPlayer;

function clearAddMatchPlayers() {
  ["add-blue-1", "add-blue-2", "add-red-1", "add-red-2"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  renderAddMatchRosterChips();
}
window.clearAddMatchPlayers = clearAddMatchPlayers;

function swapAddMatchSides() {
  const b1 = document.getElementById("add-blue-1");
  const b2 = document.getElementById("add-blue-2");
  const r1 = document.getElementById("add-red-1");
  const r2 = document.getElementById("add-red-2");

  if (b1 && r1) {
    const tmp = b1.value;
    b1.value = r1.value;
    r1.value = tmp;
  }
  if (b2 && r2 && STATE.addMatchFormat !== "singles") {
    const tmp = b2.value;
    b2.value = r2.value;
    r2.value = tmp;
  }
  renderAddMatchRosterChips();
}
window.swapAddMatchSides = swapAddMatchSides;

function swapAddMatchPartners() {
  if (STATE.addMatchFormat === "singles") return;
  const b2 = document.getElementById("add-blue-2");
  const r2 = document.getElementById("add-red-2");
  if (b2 && r2) {
    const tmp = b2.value;
    b2.value = r2.value;
    r2.value = tmp;
    renderAddMatchRosterChips();
  }
}
window.swapAddMatchPartners = swapAddMatchPartners;

function randomPickAddMatchPlayers() {
  const tData = STATE.tournamentData;
  if (!tData) return;
  const players = [...(tData.players || [])];
  const isSingles = (STATE.addMatchFormat === "singles");
  const minRequired = isSingles ? 2 : 4;
  if (players.length < minRequired) {
    showToast(STATE.lang === "zh-TW" ? `參賽單位不足 ${minRequired} 個！` : `Need at least ${minRequired} units!`, "warning");
    return;
  }

  for (let i = players.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [players[i], players[j]] = [players[j], players[i]];
  }

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || "";
  };

  if (isSingles) {
    setVal("add-blue-1", players[0]);
    setVal("add-blue-2", "");
    setVal("add-red-1", players[1]);
    setVal("add-red-2", "");
  } else {
    setVal("add-blue-1", players[0]);
    setVal("add-blue-2", players[1]);
    setVal("add-red-1", players[2]);
    setVal("add-red-2", players[3]);
  }
  renderAddMatchRosterChips();
}
window.randomPickAddMatchPlayers = randomPickAddMatchPlayers;

function autoPickAddMatchPlayers() {
  const tData = STATE.tournamentData;
  if (!tData) return;
  const players = [...(tData.players || [])];
  const isSingles = (STATE.addMatchFormat === "singles");
  const minRequired = isSingles ? 2 : 4;
  if (players.length < minRequired) return;

  const gamesCount = {};
  players.forEach(p => { gamesCount[p] = 0; });
  (tData.matches || []).filter(m => !m.voided).forEach(m => {
    (m.blue || []).concat(m.red || []).forEach(p => {
      if (gamesCount[p] !== undefined) gamesCount[p]++;
    });
  });

  players.sort((a, b) => {
    if (gamesCount[a] !== gamesCount[b]) return gamesCount[a] - gamesCount[b];
    return Math.random() - 0.5;
  });

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || "";
  };

  if (isSingles) {
    setVal("add-blue-1", players[0]);
    setVal("add-blue-2", "");
    setVal("add-red-1", players[1]);
    setVal("add-red-2", "");
  } else {
    setVal("add-blue-1", players[0]);
    setVal("add-blue-2", players[1]);
    setVal("add-red-1", players[2]);
    setVal("add-red-2", players[3]);
  }
  renderAddMatchRosterChips();
}
window.autoPickAddMatchPlayers = autoPickAddMatchPlayers;

function openAddMatchModal() {
  const modal = document.getElementById("modal-add-match");
  if (!modal) return;

  const tData = STATE.tournamentData;
  if (!tData) return;

  if (!isTournamentAdmin(tData)) {
    showToast(STATE.lang === "zh-TW" ? "請先點擊「開啟操作」！" : "Please enable controls first!", "warning");
    return;
  }

  const players = tData.players || [];
  const isTeam = getTournamentIsTeamMode(tData);
  const minRequired = 2;

  if (players.length < minRequired) {
    showToast(STATE.lang === "zh-TW" ? `參賽單位不足 ${minRequired} 個，請先點擊「補入參賽名單」！` : `Need at least ${minRequired} units! Please add units first.`, "warning");
    return;
  }

  const isZh = (STATE.lang === "zh-TW");
  const formatWrap = document.getElementById("modal-format-toggle-wrap");
  const unitLabel = isTeam ? (isZh ? "隊伍" : "Team") : (isZh ? "選手" : "Player");
  const selectPlaceholder = isZh ? `-- 選擇${unitLabel} --` : `-- Select ${unitLabel} --`;

  ["add-blue-1", "add-blue-2", "add-red-1", "add-red-2"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = `<option value="">${selectPlaceholder}</option>` +
        players.map(p => `<option value="${escapeHTML(p)}">${escapeHTML(p)}</option>`).join("");
    }
  });

  if (isTeam) {
    if (formatWrap) formatWrap.classList.add("hidden");
    setAddMatchFormat("singles");
  } else {
    if (formatWrap) formatWrap.classList.remove("hidden");
    const defaultFormat = (tData.partnerType === "singles" || players.length < 4) ? "singles" : "doubles";
    setAddMatchFormat(defaultFormat);
  }

  autoPickAddMatchPlayers();

  modal.classList.remove("hidden");
  lucide.createIcons();
}
window.openAddMatchModal = openAddMatchModal;

function closeAddMatchModal() {
  const modal = document.getElementById("modal-add-match");
  if (modal) modal.classList.add("hidden");
}
window.closeAddMatchModal = closeAddMatchModal;

async function submitAddMatch() {
  const tData = STATE.tournamentData;
  if (!tData) return;
  if (!isTournamentAdmin(tData)) {
    showToast(STATE.lang === "zh-TW" ? "請先開啟操作模式！" : "Please unlock Edit Mode first!", "warning");
    return;
  }
  const isTeam = getTournamentIsTeamMode(tData);
  const isSingles = (STATE.addMatchFormat === "singles");

  const b1 = document.getElementById("add-blue-1")?.value;
  const b2 = document.getElementById("add-blue-2")?.value;
  const r1 = document.getElementById("add-red-1")?.value;
  const r2 = document.getElementById("add-red-2")?.value;

  let blueUnits = [];
  let redUnits = [];
  let chosen = [];

  if (isSingles) {
    if (!b1 || !r1) {
      showToast(STATE.lang === "zh-TW" ? (isTeam ? "請選滿 2 支對抗隊伍！" : "請選滿 2 位對戰選手！") : "Please select both sides!", "warning");
      return;
    }
    if (b1 === r1) {
      showToast(STATE.lang === "zh-TW" ? (isTeam ? "藍隊與紅隊不能為同一隊！" : "藍方與紅方不能為同一位選手！") : "Both sides must be distinct!", "warning");
      return;
    }
    blueUnits = [b1];
    redUnits = [r1];
    chosen = [b1, r1];
  } else {
    if (!b1 || !b2 || !r1 || !r2) {
      showToast(STATE.lang === "zh-TW" ? "請選滿 4 位選手！" : "Please select all 4 players!", "warning");
      return;
    }
    chosen = [b1, b2, r1, r2];
    if (new Set(chosen).size !== 4) {
      showToast(STATE.lang === "zh-TW" ? "4 位選手不能重複！" : "4 players must be distinct!", "warning");
      return;
    }
    blueUnits = [b1, b2];
    redUnits = [r1, r2];
  }

  if (!tData.matches) tData.matches = [];

  const newMatchId = tData.matches.length + 1;
  const allPlayers = tData.players || [];
  const resting = allPlayers.filter(p => !chosen.includes(p));

  const newMatch = {
    id: newMatchId,
    roundName: `Game ${newMatchId}`,
    blue: blueUnits,
    red: redUnits,
    resting: resting,
    blueScore: null,
    redScore: null,
    completed: false
  };

  tData.matches.push(newMatch);

  saveToLocalTournaments(tData);
  if (STATE.db) {
    try {
      const newMatchIndex = tData.matches.length - 1;
      await set(ref(STATE.db, `tournaments/${tData.id}/matches/${newMatchIndex}`), newMatch);
    } catch (e) {
      console.error("Firebase sync error:", e);
    }
  }

  closeAddMatchModal();
  renderLiveUI(tData);
}
window.submitAddMatch = submitAddMatch;

async function addLivePlayerPrompt() {
  const tData = STATE.tournamentData;
  if (!tData) return;

  if (!isTournamentAdmin(tData)) {
    showToast(STATE.lang === "zh-TW" ? "請先點擊「開啟操作」！" : "Please enable controls first!", "warning");
    return;
  }

  const isTeam = getTournamentIsTeamMode(tData);
  const isZh = (STATE.lang === "zh-TW");

  const promptMsg = isTeam
    ? (isZh ? "➕ 請輸入新加入隊伍名稱 (上限10字)：" : "➕ Enter new team name (max 10 chars):")
    : (isZh ? "➕ 請輸入新加入選手姓名 (上限10字)：" : "➕ Enter new player name (max 10 chars):");

  const name = prompt(promptMsg);
  if (!name || !name.trim()) return;
  let cleanName = name.trim();
  if (cleanName.length > 10) {
    cleanName = cleanName.slice(0, 10);
  }

  if (!tData.players) tData.players = [];

  if (tData.players.includes(cleanName)) {
    const dupMsg = isTeam
      ? (isZh ? "隊伍名單中已存在此名稱！" : "Team already in roster!")
      : (isZh ? "選手名單中已存在此姓名！" : "Player already in roster!");
    showToast(dupMsg, "warning");
    return;
  }

  tData.players.push(cleanName);

  // Persist to club if clubName exists
  if (tData.clubName) {
    const clubM = getClubMembersList(tData.clubName);
    if (!clubM.includes(cleanName)) {
      clubM.push(cleanName);
      saveClubMembersList(tData.clubName, clubM);
    }
  }

  saveToLocalTournaments(tData);
  if (STATE.db) {
    try {
      const playersRef = ref(STATE.db, `tournaments/${tData.id}/players`);
      const txRes = await runTransaction(playersRef, (serverPlayers) => {
        let list = Array.isArray(serverPlayers) ? [...serverPlayers] : [];
        if (list.includes(cleanName)) return list;
        list.push(cleanName);
        return list;
      });
      if (txRes.committed) {
        tData.players = txRes.snapshot.val() || tData.players;
      }
    } catch (e) {
      console.error("Firebase sync error:", e);
    }
  }

  renderLiveUI(tData);
}
window.addLivePlayerPrompt = addLivePlayerPrompt;

async function saveMatchScore(matchId) {
  const tObj = STATE.tournamentData;
  if (!tObj || !tObj.matches) return;

  if (!isTournamentAdmin(tObj)) {
    showToast(STATE.lang === "zh-TW" ? "請先點擊「開啟操作」以輸入比分！" : "Please enable controls to enter scores!", "warning");
    return;
  }

  const blueScoreInput = document.getElementById(`score-blue-${matchId}`);
  const redScoreInput = document.getElementById(`score-red-${matchId}`);
  if (!blueScoreInput || !redScoreInput) return;

  const blueRaw = (blueScoreInput.value || "").trim();
  const redRaw = (redScoreInput.value || "").trim();

  // 若雙方皆為完全未填寫（留空顯示淺灰 0）
  if (blueRaw === "" && redRaw === "") {
    const isZh = (STATE.lang === "zh-TW");
    const confirmMsg = isZh
      ? "雙方比分皆為 0 : 0，確定要儲存為完賽嗎？"
      : "Scores are 0 : 0, are you sure you want to save as completed?";
    if (!confirm(confirmMsg)) {
      return;
    }
  }

  // 若其中一方有填，另一方未填（留空顯示淺灰 0），則未填方自動視為 0 分（支援零分完封）
  const blueScore = blueRaw === "" ? 0 : parseInt(blueRaw, 10);
  const redScore = redRaw === "" ? 0 : parseInt(redRaw, 10);

  if (isNaN(blueScore) || isNaN(redScore)) return;

  // 將輸入框同步補上實際數值，讓介面視覺即時明確
  blueScoreInput.value = blueScore;
  redScoreInput.value = redScore;

  const matchIdx = tObj.matches.findIndex(m => m.id === matchId);
  if (matchIdx === -1) return;

  tObj.matches[matchIdx].blueScore = blueScore;
  tObj.matches[matchIdx].redScore = redScore;
  tObj.matches[matchIdx].completed = true;
  tObj.matches[matchIdx].voided = false;

  // Always save locally first
  saveToLocalTournaments(tObj);
  renderLiveUI(tObj);

  if (STATE.db) {
    try {
      const updates = {};
      updates[`tournaments/${tObj.id}/matches/${matchIdx}/blueScore`] = blueScore;
      updates[`tournaments/${tObj.id}/matches/${matchIdx}/redScore`] = redScore;
      updates[`tournaments/${tObj.id}/matches/${matchIdx}/completed`] = true;
      updates[`tournaments/${tObj.id}/matches/${matchIdx}/voided`] = false;
      await update(ref(STATE.db), updates);
    } catch (e) {
      console.error("Save score error:", e);
      showToast(STATE.lang === "zh-TW" ? "雲端同步失敗，已存至本地" : "Cloud sync failed, saved locally", "warning");
    }
  }

  // 檢查是否完成所有有效場次之比分登錄，跳出提醒引導點選上方「結束賽事」
  const validMatches = (tObj.matches || []).filter(m => !m.voided);
  const allScored = validMatches.length > 0 && validMatches.every(m => m.completed && m.blueScore !== null && m.redScore !== null);
  if (allScored && tObj.status !== "completed") {
    setTimeout(() => {
      showCompletionNotice();
    }, 300);
  }
}
window.saveMatchScore = saveMatchScore;

function showCompletionNotice() {
  const isZh = STATE.lang === "zh-TW";
  const trophySVG = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="text-amber-500 drop-shadow-md">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
      <path d="M4 22h16"/>
      <path d="M10 14.66V17c0 .55-.45 1-1 1H7v4h10v-4h-2c-.55 0-1-.45-1-1v-2.34"/>
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" fill="#f59e0b" fill-opacity="0.3"/>
    </svg>
  `;

  const bannerHtml = `
    <div class="flex items-start gap-3 w-full">
      <div class="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-500 border border-amber-500/40 flex items-center justify-center shrink-0 shadow-md animate-bounce">
        ${trophySVG}
      </div>
      <div class="flex-1 min-w-0 pr-1">
        <div class="flex items-center justify-between gap-1">
          <h4 class="font-bold text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
            <span>🎉 所有場次比分已登錄完成！</span>
          </h4>
          <button type="button" onclick="this.closest('#toast-container').innerHTML=''" class="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 text-sm p-1 leading-none -mr-1 cursor-pointer">✕</button>
        </div>
        <p class="text-[11px] text-stone-600 dark:text-stone-300 mt-1 leading-relaxed">
          ${isZh ? "請確認分數無誤後點選「結束賽事」，完賽後無法再修正分數。" : "All matches scored! Please review and click End Tournament."}
        </p>
        <div class="mt-2.5 flex items-center gap-2">
          <button type="button" onclick="completeTournamentAndReturn()" class="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition cursor-pointer">
            <i data-lucide="check-circle-2" class="w-4 h-4"></i> ${isZh ? "點此結束賽事並結算" : "End Tournament Now"}
          </button>
        </div>
      </div>
    </div>
  `;

  showToast(bannerHtml, "celebrate", 10000);

  const completeBtn = document.getElementById("btn-complete-and-return");
  if (completeBtn) {
    completeBtn.classList.add("ring-4", "ring-amber-500", "animate-pulse");
  }
}
window.showCompletionNotice = showCompletionNotice;

// ----------------------------------------------------
// LEADERBOARD CALCULATOR & TIE-BREAKER SORTING
// ----------------------------------------------------
function calculateLeaderboard(players, matches) {
  const stats = {};
  players.forEach(p => {
    stats[p] = { name: p, wins: 0, losses: 0, pf: 0, pa: 0, diff: 0, played: 0 };
  });

  (matches || []).forEach(m => {
    // Exclude voided matches
    if (!m.voided && m.completed && m.blueScore !== null && m.redScore !== null) {
      const bs = m.blueScore;
      const rs = m.redScore;
      const blueWon = bs > rs;
      const redWon = rs > bs;
      const isTie = bs === rs;

      m.blue.forEach(p => {
        if (stats[p]) {
          stats[p].played++;
          stats[p].pf += bs;
          stats[p].pa += rs;
          if (blueWon) stats[p].wins++;
          else if (!isTie) stats[p].losses++;
        }
      });

      m.red.forEach(p => {
        if (stats[p]) {
          stats[p].played++;
          stats[p].pf += rs;
          stats[p].pa += bs;
          if (redWon) stats[p].wins++;
          else if (!isTie) stats[p].losses++;
        }
      });
    }
  });

  Object.values(stats).forEach(s => {
    s.diff = s.pf - s.pa;
    s.winRate = s.played > 0 ? (s.wins / s.played) : 0;
  });

  const sorted = Object.values(stats).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.diff !== a.diff) return b.diff - a.diff;
    if (b.pf !== a.pf) return b.pf - a.pf;
    return a.pa - b.pa;
  });

  return sorted;
}

function renderLeaderboardTable(leaderboard) {
  const tbody = document.getElementById("leaderboard-tbody");
  const isTeam = getTournamentIsTeamMode(STATE.tournamentData);
  const thPlayerEl = document.getElementById("th-player");
  if (thPlayerEl) {
    thPlayerEl.innerText = isTeam ? (STATE.lang === "zh-TW" ? "參賽隊伍" : "Team") : (STATE.lang === "zh-TW" ? "選手" : "Player");
  }

  if (!leaderboard.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-3 text-center sub-text text-xs">${STATE.lang === 'zh-TW' ? '尚無數據' : 'No Data'}</td></tr>`;
    return;
  }

  tbody.innerHTML = leaderboard.map((row, idx) => {
    const isMvp = idx === 0 && row.played > 0;
    let rankBadge = `<span class="font-mono sub-text font-bold text-xs">${idx + 1}</span>`;
    if (isMvp) {
      rankBadge = `<span class="w-6 h-6 rounded-full bg-gradient-to-br from-amber-300 via-amber-400 to-amber-500 text-stone-950 font-black text-xs inline-flex items-center justify-center shadow-sm" title="👑 Champion / MVP">1</span>`;
    } else if (idx === 1 && row.played > 0) {
      rankBadge = `<span class="w-5 h-5 rounded-full bg-gradient-to-br from-slate-200 to-slate-400 text-stone-900 font-bold text-[11px] inline-flex items-center justify-center shadow-sm" title="🥈 Runner-up">2</span>`;
    } else if (idx === 2 && row.played > 0) {
      rankBadge = `<span class="w-5 h-5 rounded-full bg-gradient-to-br from-amber-600 to-amber-800 text-white font-bold text-[11px] inline-flex items-center justify-center shadow-sm" title="🥉 3rd Place">3</span>`;
    }

    const winUnit = STATE.lang === "zh-TW" ? "勝" : "W";
    const lossUnit = STATE.lang === "zh-TW" ? "敗" : "L";

    return `
          <tr class="${isMvp ? 'bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-transparent font-bold border-l-4 border-amber-500' : 'hover:bg-stone-500/5'} transition">
            <td class="py-2.5 px-1.5 text-center">${rankBadge}</td>
            <td class="py-2.5 px-2">
              <span class="font-semibold text-xs sm:text-sm ${isMvp ? 'text-amber-600 dark:text-amber-300' : ''}">${row.name}</span>
            </td>
            <td class="py-2.5 px-1 text-center font-mono text-xs">
              <span class="text-emerald-600 dark:text-emerald-400 font-bold">${row.wins}${winUnit}</span> / <span class="text-rose-600 dark:text-rose-400">${row.losses}${lossUnit}</span>
            </td>
            <td class="py-2.5 px-1 text-center">
              ${row.diff > 0
        ? `<span class="px-1.5 py-0.5 rounded font-mono font-bold text-[11px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">+${row.diff}</span>`
        : row.diff < 0
          ? `<span class="px-1.5 py-0.5 rounded font-mono font-bold text-[11px] bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/25">${row.diff}</span>`
          : `<span class="px-1.5 py-0.5 rounded font-mono text-[11px] sub-text">0</span>`
      }
            </td>
            <td class="py-2.5 px-2 text-center font-mono text-xs sub-text">
              ${row.pf}/${row.pa}
            </td>
          </tr>
        `;
  }).join("");

  lucide.createIcons();
}

// 掛載即時計分與排行榜核心渲染函式至全域 window
window.renderLiveUI = renderLiveUI;
window.renderMatchesList = renderMatchesList;
window.calculateLeaderboard = calculateLeaderboard;
window.renderLeaderboardTable = renderLeaderboardTable;

