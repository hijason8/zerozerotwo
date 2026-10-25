// ============================================================
// ZEROZEROTWO TOURNAMENT CREATION & ESTIMATION MODULE (tournament-create.js)
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
import { escapeHTML, safeSetLocal, safeGetLocalJSON, sha256 } from "./utils.js?v=20261025-1";

// 產生不重複的賽事代碼：建立前先確認代碼沒人用過，避免覆蓋既有賽事
async function generateUniqueTournamentId() {
  const db = window.STATE && window.STATE.db;
  for (let i = 0; i < 10; i++) {
    const id = "T-" + Math.floor(100000 + Math.random() * 900000);
    if (!db) return id;
    try {
      const snap = await get(ref(db, `tournaments/${id}`));
      if (!snap.exists()) return id;
    } catch (e) {
      return id;
    }
  }
  // 連續 10 次都重複（極不可能）時改用 7 位數
  return "T-" + String(Date.now()).slice(-7);
}
import {
  getFullRoundRobinGames,
  generateSinglesSchedule,
  generateTeamRoundRobinSchedule,
  getValidTotalGames,
  getMaxTotalGames,
  generateRoundRobinSchedule
} from "./scheduler.js?v=20261025-1";
import {
  STATE,
  FUNCTIONS_BASE_URL,
  t,
  showToast,
  navigateTo,
  loadLiveTournament,
  displayHubTournamentsList,
  encodeClubKey,
  safeEscape,
  getAllUniqueClubs,
  verifyClubAccess,
  saveToLocalTournaments,
  addMyTournamentId,
  addCreatedTournamentId,
  openClubSpace
} from "./globals.js?v=20261025-1";

const isTransientPlayer = (name) => {
  if (typeof window !== "undefined" && typeof window.isTransientPlayer === "function") {
    return window.isTransientPlayer(name);
  }
  if (!name || typeof name !== "string") return false;
  return /^(臨打|臨時|補位|選手|隊伍|Guest|Player|Team)(\s*[-_#]?[0-9A-Za-z]+)?$/i.test(name.trim());
};

    // ----------------------------------------------------
    // PAGE C: CREATE TOURNAMENT & TIME ESTIMATION
    // ----------------------------------------------------
    function setCreateEntryType(entryType) {
      const entryInput = document.getElementById("create-entry-mode");
      if (entryInput) entryInput.value = entryType;

      const btnReg = document.getElementById("btn-entry-registration");
      const btnInstant = document.getElementById("btn-entry-instant");
      const regHint = document.getElementById("wrap-registration-hint");
      const instantSections = document.getElementById("wrap-instant-play-sections");
      const submitBtn = document.getElementById("btn-submit-create");
      const isZh = (STATE.lang === "zh-TW");

      const activeCls = "mode-btn-active py-3 px-3 sm:px-4 rounded-2xl border-2 text-xs font-bold transition flex items-center justify-start hover-lift active:scale-95 shadow-sm";
      const inactiveCls = "mode-btn-inactive py-3 px-3 sm:px-4 rounded-2xl border-2 text-xs font-bold transition flex items-center justify-start hover-lift active:scale-95 shadow-sm";

      const maxPlayersWrap = document.getElementById("wrap-create-max-players");

      if (entryType === "registration") {
        if (btnReg) {
          btnReg.className = activeCls;
          const icon = btnReg.querySelector("i");
          if (icon) icon.className = "w-4 h-4 text-emerald-500";
        }
        if (btnInstant) {
          btnInstant.className = inactiveCls;
          const icon = btnInstant.querySelector("i");
          if (icon) icon.className = "w-4 h-4 text-stone-400";
        }
        if (regHint) regHint.classList.remove("hidden");
        if (maxPlayersWrap) maxPlayersWrap.classList.remove("hidden");
        if (instantSections) instantSections.classList.add("hidden");
        if (submitBtn) {
          submitBtn.innerHTML = `<i data-lucide="clipboard-check" class="w-4 h-4"></i> <span id="t-btn-submit-create-text">${isZh ? "確認" : "Confirm"}</span>`;
        }
      } else {
        if (btnReg) {
          btnReg.className = inactiveCls;
          const icon = btnReg.querySelector("i");
          if (icon) icon.className = "w-4 h-4 text-stone-400";
        }
        if (btnInstant) {
          btnInstant.className = activeCls;
          const icon = btnInstant.querySelector("i");
          if (icon) icon.className = "w-4 h-4 text-emerald-500 fill-current";
        }
        if (regHint) regHint.classList.add("hidden");
        if (maxPlayersWrap) maxPlayersWrap.classList.add("hidden");
        if (instantSections) instantSections.classList.remove("hidden");
        if (submitBtn) {
          submitBtn.innerHTML = `<i data-lucide="play" class="w-4 h-4 fill-current"></i> <span id="t-btn-submit-create-text">${isZh ? "確認並立即開打" : "Start Tournament Now"}</span>`;
        }
        const currentMode = document.getElementById("create-tournament-mode")?.value || "fair";
        setCreateMode(currentMode);
      }
      lucide.createIcons();
    }
    window.setCreateEntryType = setCreateEntryType;

    function triggerCreateTournament(entryMode) {
      if (entryMode) setCreateEntryType(entryMode);
      const form = document.getElementById("form-create-tournament");
      if (form) {
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit();
        } else {
          form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        }
      }
    }
    window.triggerCreateTournament = triggerCreateTournament;

    function setCreateMode(mode) {
      const modeInput = document.getElementById("create-tournament-mode");
      if (modeInput) modeInput.value = mode;

      const btnFair = document.getElementById("btn-mode-fair");
      const btnFree = document.getElementById("btn-mode-free");
      const wrapDuration = document.getElementById("wrap-fair-duration");
      const wrapNotice = document.getElementById("wrap-free-notice");
      const timeBox = document.getElementById("time-estimate-box");

      const activeCls = "mode-btn-active py-3 px-4 rounded-2xl border-2 text-xs font-bold transition flex items-center justify-start hover-lift active:scale-95 shadow-sm";
      const inactiveCls = "mode-btn-inactive py-3 px-4 rounded-2xl border-2 text-xs font-bold transition flex items-center justify-start hover-lift active:scale-95 shadow-sm";

      if (btnFair) btnFair.className = mode === "fair" ? activeCls : inactiveCls;
      if (btnFree) btnFree.className = mode === "free" ? activeCls : inactiveCls;

      const wrapPartnerToggle = document.getElementById("wrap-partner-toggle");

      if (mode === "fair") {
        if (wrapDuration) wrapDuration.classList.remove("hidden");
        if (wrapNotice) wrapNotice.classList.add("hidden");
        if (timeBox) timeBox.classList.remove("hidden");
        if (wrapPartnerToggle) wrapPartnerToggle.classList.remove("hidden");
        calculateTimeEstimate();
      } else {
        // Free Mode (自由對抗)：保留搭檔與單雙打切換按鈕，支援單打、輪替雙打與固定隊伍！
        if (wrapDuration) wrapDuration.classList.add("hidden");
        if (wrapNotice) wrapNotice.classList.remove("hidden");
        if (timeBox) timeBox.classList.add("hidden");
        if (wrapPartnerToggle) wrapPartnerToggle.classList.remove("hidden");
        const currentPartnerType = document.getElementById("create-partner-type")?.value || "rotating";
        setPartnerType(currentPartnerType);
      }
      updatePartnerToggleTexts();
      updateRosterHealthNotice();
      updateFreeNoticeText();
      lucide.createIcons();
    }
    window.setCreateMode = setCreateMode;

    function updatePartnerToggleTexts() {
      const mode = document.getElementById("create-tournament-mode")?.value || "fair";
      const rotSpan = document.getElementById("t-partner-rotating-text");
      const fixSpan = document.getElementById("t-partner-fixed-text");
      const sinSpan = document.getElementById("t-partner-singles-text");
      const isZh = (STATE.lang === "zh-TW");

      if (mode === "free") {
        if (rotSpan) rotSpan.innerText = isZh ? "自由雙打" : "Free Doubles";
        if (fixSpan) fixSpan.innerText = isZh ? "固定隊伍" : "Fixed Teams";
        if (sinSpan) sinSpan.innerText = isZh ? "個人單打" : "Singles";
      } else {
        if (rotSpan) rotSpan.innerText = isZh ? "輪替隊友" : "Rotating";
        if (fixSpan) fixSpan.innerText = isZh ? "固定隊友" : "Fixed";
        if (sinSpan) sinSpan.innerText = isZh ? "個人單打" : "Singles";
      }
    }
    window.updatePartnerToggleTexts = updatePartnerToggleTexts;

    function updateFreeNoticeText() {
      const partnerType = document.getElementById("create-partner-type")?.value || "rotating";
      const descEl = document.getElementById("t-free-notice-desc");
      if (!descEl) return;
      const isZh = (STATE.lang === "zh-TW");
      if (partnerType === "singles") {
        descEl.innerHTML = isZh
          ? "<b>👤 自由單打模式</b>：名單為個人選手（至少 2 人）。不預設固定賽程，進入賽事後點擊「➕ 新增場次」即可自由挑選選手進行 1v1 單打對決！"
          : "<b>👤 Free Singles</b>: Enter players (min 2). Click '+ Add Match' to pair up 1v1 matchups on the fly!";
      } else if (partnerType === "fixed") {
        descEl.innerHTML = isZh
          ? "<b>🛡️ 自由隊伍模式</b>：名單為固定隊伍（至少 2 隊）。不預設固定賽程，進入賽事後點擊「➕ 新增場次」由各隊自由約戰 1v1 對決！"
          : "<b>🛡️ Free Team Mode</b>: Enter teams (min 2). Click '+ Add Match' to pair up teams on the fly!";
      } else {
        descEl.innerHTML = isZh
          ? "<b>👥 自由雙打 / 自由配對</b>：名單為個人選手（至少 2 人）。進入賽事後自由度極高，可隨時自選 2v2 雙打或 1v1 單打，支援手動點選、場次少者優先與隨機抽籤！"
          : "<b>👥 Free Doubles / Open</b>: Enter players (min 2). In live view, freely choose 2v2 doubles or 1v1 singles with tap-to-seat, least-played priority, or random draw!";
      }
    }
    window.updateFreeNoticeText = updateFreeNoticeText;

    function setFairStrategy(strategy) {
      const input = document.getElementById("create-fair-strategy");
      if (input) input.value = strategy;

      const btnTime = document.getElementById("btn-strategy-time");
      const btnFull = document.getElementById("btn-strategy-full");
      const wrapTime = document.getElementById("wrap-time-input");

      const activeCls = "mode-btn-active py-3 px-4 rounded-2xl border-2 text-xs font-bold transition flex items-center justify-start hover-lift active:scale-95 shadow-sm";
      const inactiveCls = "mode-btn-inactive py-3 px-4 rounded-2xl border-2 text-xs font-bold transition flex items-center justify-start hover-lift active:scale-95 shadow-sm";

      if (btnTime) btnTime.className = strategy === "time" ? activeCls : inactiveCls;
      if (btnFull) btnFull.className = strategy === "full-cycle" ? activeCls : inactiveCls;

      if (wrapTime) {
        if (strategy === "time") wrapTime.classList.remove("hidden");
        else wrapTime.classList.add("hidden");
      }

      resetSelectedPlan();
      calculateTimeEstimate();
      lucide.createIcons();
    }
    window.setFairStrategy = setFairStrategy;

    function resetSelectedPlan() {
      const el = document.getElementById("create-selected-total-games");
      if (el) el.value = "";
      const badge = document.getElementById("fair-plan-selected-badge");
      if (badge) {
        badge.innerText = "";
        badge.classList.add("hidden");
      }
    }
    window.resetSelectedPlan = resetSelectedPlan;

    function selectFairPlan(games, estMins) {
      const el = document.getElementById("create-selected-total-games");
      if (el) el.value = games;
      calculateTimeEstimate();
    }
    window.selectFairPlan = selectFairPlan;

    function setPartnerType(type) {
      const partnerInput = document.getElementById("create-partner-type");
      if (partnerInput) partnerInput.value = type;

      const btnRotating = document.getElementById("btn-partner-rotating");
      const btnFixed = document.getElementById("btn-partner-fixed");
      const btnSingles = document.getElementById("btn-partner-singles");

      const activeCls = "px-2.5 py-1 rounded-lg transition-all text-xs font-bold bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm";
      const inactiveCls = "px-2.5 py-1 rounded-lg transition-all text-xs font-semibold text-stone-500 dark:text-slate-400 hover:text-stone-800 dark:hover:text-slate-200";

      if (btnRotating) btnRotating.className = type === "rotating" ? activeCls : inactiveCls;
      if (btnFixed) btnFixed.className = type === "fixed" ? activeCls : inactiveCls;
      if (btnSingles) btnSingles.className = type === "singles" ? activeCls : inactiveCls;

      const isRotating = (type === "rotating");
      const isSingles = (type === "singles");
      const labelPlayers = document.getElementById("t-label-players");
      const inputAdd = document.getElementById("quick-add-player-input");
      const headingRoster = document.getElementById("t-selected-roster-heading");
      const titleClub = document.getElementById("t-club-members-title");
      const autoGenLabel = document.getElementById("t-auto-gen-label");

      const isZh = (STATE.lang === "zh-TW");
      const mode = document.getElementById("create-tournament-mode")?.value || "fair";
      if (labelPlayers) {
        if (isZh) {
          if (mode === "free") {
            labelPlayers.innerText = isSingles ? "4. 自由單打選手名單" : (isRotating ? "4. 自由雙打選手名單" : "4. 自由隊伍名單");
          } else {
            labelPlayers.innerText = isSingles ? "4. 個人單打選手名單" : (isRotating ? "4. 參賽選手名單" : "4. 參賽隊伍名單");
          }
        } else {
          labelPlayers.innerText = isSingles ? "4. Singles Player Roster" : (isRotating ? "4. Player Roster" : "4. Team Roster");
        }
      }
      if (inputAdd) inputAdd.placeholder = isZh ? "姓名，支援空格批量輸入" : "Enter names (supports space/line batch input)...";
      if (headingRoster) headingRoster.innerText = isZh ? (isSingles ? "已登錄選手：" : (isRotating ? "已登錄選手：" : "已登錄隊伍：")) : (isSingles ? "Registered Singles:" : (isRotating ? "Registered Players:" : "Registered Teams:"));
      if (titleClub) titleClub.innerText = isZh ? (type === "fixed" ? "社團常用隊伍：" : "社團常用選手：") : (type === "fixed" ? "Club Teams:" : "Club Players:");
      if (autoGenLabel) autoGenLabel.innerText = isZh ? (type === "fixed" ? "增加臨打隊伍：" : "增加臨打選手：") : (type === "fixed" ? "Add Guest Teams:" : "Add Guest Players:");

      updatePartnerToggleTexts();
      updatePlayerCountBadge();
      resetSelectedPlan();
      calculateTimeEstimate();
      updateFreeNoticeText();
    }
    window.setPartnerType = setPartnerType;

    function updatePlayerCountBadge() {
      const text = document.getElementById("create-players")?.value || "";
      const players = text.split("\n").map(s => s.trim()).filter(Boolean);
      const badge = document.getElementById("player-count-badge");
      const num = document.getElementById("roster-count-num");
      const partnerType = document.getElementById("create-partner-type")?.value || "rotating";
      const isZh = (STATE.lang === "zh-TW");
      const unitStr = isZh
        ? (partnerType === "fixed" ? "隊" : "人")
        : (partnerType === "fixed" ? "Teams" : "Players");
      if (num) num.innerText = players.length;
      if (badge) {
        badge.innerHTML = `<i data-lucide="users" class="w-3.5 h-3.5 text-emerald-500"></i> <span><b id="roster-count-num">${players.length}</b> (${unitStr})</span>`;
      }
      updateRosterHealthNotice();
      lucide.createIcons();
    }
    window.updatePlayerCountBadge = updatePlayerCountBadge;

    function updateRosterHealthNotice() {
      const noticeEl = document.getElementById("roster-health-notice");
      if (!noticeEl) return;

      const text = document.getElementById("create-players")?.value || "";
      const players = text.split("\n").map(s => s.trim()).filter(Boolean);
      const partnerType = document.getElementById("create-partner-type")?.value || "rotating";
      const mode = document.getElementById("create-tournament-mode")?.value || "fair";
      const isRotating = (partnerType === "rotating" && mode !== "group");
      const isSingles = (partnerType === "singles" && mode !== "group");
      const isZh = (STATE.lang === "zh-TW");
      const count = players.length;

      if (mode === "free") {
        const unit = (partnerType === "fixed") ? (isZh ? "隊" : "teams") : (isZh ? "人" : "players");
        if (count < 2) {
          noticeEl.className = "text-xs rounded-xl p-2.5 flex items-center gap-2 bg-stone-500/10 text-stone-600 dark:text-slate-300 border border-stone-300/30";
          noticeEl.innerHTML = `
            <i data-lucide="info" class="w-4 h-4 shrink-0 text-stone-400"></i>
            <span>${isZh ? `自由模式名單登錄滿 <b>2</b> 個單位即可開賽，後續隨時可補人！` : `At least 2 units needed for Free Mode, more can be added anytime!`}</span>
          `;
          noticeEl.classList.remove("hidden");
        } else {
          noticeEl.className = "text-xs rounded-xl p-2.5 flex items-center gap-2 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20";
          noticeEl.innerHTML = `
            <i data-lucide="check-circle-2" class="w-4 h-4 shrink-0 text-emerald-500"></i>
            <span><b>${isZh ? "🟢 自由開局就緒" : "🟢 Free Play Ready"}</b>：${isZh ? `目前已登錄 ${count} ${unit}，開局後點擊「➕ 新增場次」可自由選擇雙打/單打、手動指定或隨機抽籤！` : `${count} ${unit} registered, ready to play singles or doubles freely!`}</span>
          `;
          noticeEl.classList.remove("hidden");
        }
        lucide.createIcons();
        return;
      }

      if ((!isRotating && !isSingles) || count === 0) {
        noticeEl.classList.add("hidden");
        noticeEl.innerHTML = "";
        return;
      }

      if (isSingles) {
        if (count < 2) {
          noticeEl.className = "text-xs rounded-xl p-2.5 flex items-center gap-2 bg-stone-500/10 text-stone-600 dark:text-slate-300 border border-stone-300/30";
          noticeEl.innerHTML = `
            <i data-lucide="info" class="w-4 h-4 shrink-0 text-stone-400"></i>
            <span>${isZh ? `目前已登錄 <b>${count}</b> 人（個人單打開賽至少需 2 人）。` : `Currently <b>${count}</b> players registered (min 2 needed for singles).`}</span>
          `;
          noticeEl.classList.remove("hidden");
        } else if (count === 2) {
          noticeEl.className = "text-xs rounded-xl p-2.5 flex items-center gap-2 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20";
          noticeEl.innerHTML = `
            <i data-lucide="check-circle-2" class="w-4 h-4 shrink-0 text-emerald-500"></i>
            <span><b>${isZh ? "🟢 雙人直球對決" : "🟢 1v1 Head-to-Head"}</b>：${isZh ? `2 人單打對抗，每局皆出賽，無板凳等待！` : `2 players, 100% playtime!`}</span>
          `;
          noticeEl.classList.remove("hidden");
        } else if (count <= 4) {
          const pct = Math.round((2 / count) * 100);
          noticeEl.className = "text-xs rounded-xl p-2.5 flex items-center gap-2 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20";
          noticeEl.innerHTML = `
            <i data-lucide="check-circle-2" class="w-4 h-4 shrink-0 text-emerald-500"></i>
            <span><b>${isZh ? "🟢 單打黃金比例" : "🟢 Optimal Singles Ratio"}</b>：${isZh ? `目前 ${count} 人，平均上場率約 ${pct}%，打休體能調節最佳！` : `${count} players (~${pct}% playtime), optimal singles pace!`}</span>
          `;
          noticeEl.classList.remove("hidden");
        } else if (count <= 6) {
          noticeEl.className = "text-xs rounded-xl p-2.5 flex items-center gap-2 bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20";
          noticeEl.innerHTML = `
            <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 text-amber-500"></i>
            <span><b>${isZh ? "🟡 等候時間略長" : "🟡 Moderate Wait"}</b>：${isZh ? `目前 ${count} 人（板凳 ${count - 2} 人），每打 1 局平均需休 ${count - 2} 局。` : `${count} players (${count - 2} resting).`}</span>
          `;
          noticeEl.classList.remove("hidden");
        } else {
          noticeEl.className = "text-xs rounded-xl p-2.5 flex items-center gap-2 bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20";
          noticeEl.innerHTML = `
            <i data-lucide="alert-octagon" class="w-4 h-4 shrink-0 text-rose-500"></i>
            <span><b>${isZh ? "🟠 板凳人數過多" : "🟠 High Bench Warning"}</b>：${isZh ? `目前 ${count} 人單場輪替單打，板凳等候時間較長。若有多面場地建議分開建立賽事！` : `${count} players on 1 court for singles. High wait times. Consider splitting into separate tournaments.`}</span>
          `;
          noticeEl.classList.remove("hidden");
        }
        lucide.createIcons();
        return;
      }

      if (count < 4) {
        noticeEl.className = "text-xs rounded-xl p-2.5 flex items-center gap-2 bg-stone-500/10 text-stone-600 dark:text-slate-300 border border-stone-300/30";
        noticeEl.innerHTML = `
          <i data-lucide="info" class="w-4 h-4 shrink-0 text-stone-400"></i>
          <span>${isZh ? `目前已登錄 <b>${count}</b> 人（雙打單一球場開賽至少需 4 人）。` : `Currently <b>${count}</b> players registered (min 4 needed for doubles).`}</span>
        `;
        noticeEl.classList.remove("hidden");
      } else if (count <= 8) {
        const pct = Math.round((4 / count) * 100);
        noticeEl.className = "text-xs rounded-xl p-2.5 flex items-center gap-2 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20";
        noticeEl.innerHTML = `
          <i data-lucide="check-circle-2" class="w-4 h-4 shrink-0 text-emerald-500"></i>
          <span><b>${isZh ? "🟢 單場黃金比例" : "🟢 Optimal Court Ratio"}</b>：${isZh ? `目前 ${count} 人，平均上場率約 ${pct}%，打休體能調節最佳！` : `${count} players (~${pct}% playtime), optimal play-to-rest pace!`}</span>
        `;
        noticeEl.classList.remove("hidden");
      } else if (count <= 10) {
        noticeEl.className = "text-xs rounded-xl p-2.5 flex items-center gap-2 bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20";
        noticeEl.innerHTML = `
          <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 text-amber-500"></i>
          <span><b>${isZh ? "🟡 等候時間略長" : "🟡 Moderate Wait"}</b>：${isZh ? `目前 ${count} 人（板凳 ${count - 4} 人），每打 1 局平均需休 1~2 局。` : `${count} players (${count - 4} resting), players rest 1-2 games between matches.`}</span>
        `;
        noticeEl.classList.remove("hidden");
      } else {
        noticeEl.className = "text-xs rounded-xl p-2.5 flex items-center gap-2 bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20";
        noticeEl.innerHTML = `
          <i data-lucide="alert-octagon" class="w-4 h-4 shrink-0 text-rose-500"></i>
          <span><b>${isZh ? "🟠 板凳人數過多" : "🟠 High Bench Warning"}</b>：${isZh ? `目前 ${count} 人（板凳 ${count - 4} 人），單場輪替易連休 3 局以上手感變冷。若有多面場地建議分開建立賽事！` : `${count} players (${count - 4} resting). High wait times on 1 court. Consider splitting into separate tournaments.`}</span>
        `;
        noticeEl.classList.remove("hidden");
      }

      lucide.createIcons();
    }
    window.updateRosterHealthNotice = updateRosterHealthNotice;

    function calculateTimeEstimate() {
      const text = document.getElementById("create-players")?.value || "";
      const players = text.split("\n").map(s => s.trim()).filter(Boolean);
      let durationHours = parseFloat(document.getElementById("create-duration")?.value) || 2.0;
      if (durationHours > 6.0) {
        durationHours = 6.0;
        const durInput = document.getElementById("create-duration");
        if (durInput) durInput.value = "6.0";
        showToast(STATE.lang === "zh-TW" ? "預計比賽總時間上限不得超過 6 小時" : "Max duration cannot exceed 6 hours", "warning");
      }
      const hintText = document.getElementById("time-estimate-text");
      const optionsContainer = document.getElementById("fair-schedule-options");
      const selectedGamesInput = document.getElementById("create-selected-total-games");
      const badge = document.getElementById("fair-plan-selected-badge");
      const mode = document.getElementById("create-tournament-mode")?.value || "fair";
      const strategy = document.getElementById("create-fair-strategy")?.value || "time";
      const partnerType = document.getElementById("create-partner-type")?.value || "rotating";
      const isTeamMode = (partnerType === "fixed");
      const isSingles = (partnerType === "singles");
      const unitLabel = isTeamMode ? "隊" : "人";
      const minUnits = isSingles ? 2 : 4;

      if (players.length < minUnits) {
        if (STATE.lang === "zh-TW") {
          hintText.innerHTML = strategy === "full-cycle"
            ? `💡 <strong>全循環排賽</strong>：強制排滿 1 輪完整全循環賽事，人人皆有搭配與對決。<span class="opacity-80">請輸入至少 ${minUnits} 個參賽單位 (${unitLabel}) 開始試算。</span>`
            : `💡 <strong>按時間排賽</strong>：指定總比賽時間，系統自動試算最佳場數與時間對應。<span class="opacity-80">請輸入至少 ${minUnits} 個參賽單位 (${unitLabel}) 開始試算。</span>`;
        } else {
          hintText.innerHTML = strategy === "full-cycle"
            ? `💡 <strong>Full Round-Robin</strong>: Force 1 full cycle so all participants pair & match up. Please enter at least ${minUnits} units.`
            : `💡 <strong>By Duration</strong>: Specify total duration, auto-calc best game options. Please enter at least ${minUnits} units.`;
        }
        if (optionsContainer) {
          optionsContainer.innerHTML = "";
          optionsContainer.classList.add("hidden");
        }
        if (badge) badge.classList.add("hidden");
        return;
      }

      const n = players.length;

      // 全循環/公平輪播計算：
      function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
      const playersPerGame = isSingles ? 2 : 4;
      const g = gcd(playersPerGame, n);
      const blockSize = n / g;       // 1 輪全循環總局數
      const gamesPerBlock = playersPerGame / g;   // 每人/隊每輪出場場數

      // 策略：打滿一輪全循環 (Full Cycle Strategy)
      if (strategy === "full-cycle") {
        const fullGames = getFullRoundRobinGames(n, isTeamMode, isSingles);
        const gamesPerUnit = (isTeamMode || isSingles) ? (n - 1) : Math.round((fullGames * 4) / n);
        const restEach = fullGames - gamesPerUnit;
        const estMins = Math.round(fullGames * 12);

        if (selectedGamesInput) selectedGamesInput.value = fullGames;

        if (badge) {
          badge.innerText = STATE.lang === "zh-TW"
            ? `全循環：共 ${fullGames} 局 (每${unitLabel} ${gamesPerUnit} 場)`
            : `Full Cycle: ${fullGames} games (${gamesPerUnit} g/u)`;
          badge.classList.remove("hidden");
        }

        if (STATE.lang === "zh-TW") {
          hintText.innerHTML = `💡 <strong>全循環排賽</strong>：強制排滿 1 輪完整全循環賽事，人人皆有搭配與對決。<br/>全循環共 <strong class="text-emerald-500">${fullGames} 局賽程</strong>，<strong class="text-emerald-600 dark:text-emerald-400">每${unitLabel}各打 ${gamesPerUnit} 場</strong> (休 ${restEach} 場)，預估總耗時約 <strong>${estMins} 分鐘</strong> (${(estMins / 60).toFixed(1)}h)。`;
        } else {
          hintText.innerHTML = `💡 <strong>Full Round-Robin</strong>: Force 1 full cycle so all participants pair & match up.<br/>Total <strong class="text-emerald-500">${fullGames} games</strong> — <strong class="text-emerald-600 dark:text-emerald-400">each unit plays ${gamesPerUnit} games</strong> (rest ${restEach}), est. <strong>${estMins} mins</strong>.`;
        }

        if (optionsContainer) {
          optionsContainer.classList.remove("hidden");
          const isZh = (STATE.lang === "zh-TW");
          optionsContainer.innerHTML = `
            <div class="text-[11px] font-bold sub-text uppercase tracking-wider mb-1">
              <span>${isZh ? '全循環賽程排案：' : 'Full Round-Robin Schedule Plan:'}</span>
            </div>
            <div class="rounded-xl p-3 border-2 border-emerald-500/30 bg-emerald-500/10 shadow-sm space-y-1">
              <div class="flex items-center justify-between">
                <span class="font-bold text-xs text-emerald-700 dark:text-emerald-300 font-display">
                  ✅ ${isZh ? `完整 1 輪全循環：共 ${fullGames} 局` : `Full 1 Cycle: Total ${fullGames} Games`}
                </span>
                <span class="text-[11px] font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  ${isZh ? `每單位各打 ${gamesPerUnit} 場` : `${gamesPerUnit} Games / Unit`}
                </span>
              </div>
              <div class="text-[10.5px] sub-text flex items-center justify-between">
                <span>${isZh ? `各休 ${restEach} 場` : `Rest ${restEach} Games Each`}</span>
                <span>${isZh ? (isSingles ? '所有選手皆對決到一輪' : '所有單位皆搭檔/對決到一輪') : 'Every pair & matchup played'}</span>
              </div>
            </div>
          `;
        }
        return;
      }

      // 平均模式邏輯 (Fair Mode - 依時間試算)
      const totalMinutes = Math.round(durationHours * 60);
      const allValidPlans = [];
      const maxB = Math.max(15, Math.ceil(totalMinutes / (8 * blockSize)) + 2);

      for (let b = 1; b <= maxB; b++) {
        const totalGames = b * blockSize;
        if (totalGames > 45) break;

        const avgMinsIfFit = parseFloat((totalMinutes / totalGames).toFixed(1));
        if (avgMinsIfFit >= 8.0 && avgMinsIfFit <= 25.0) {
          const gamesEach = b * gamesPerBlock;
          const restEach = totalGames - gamesEach;
          allValidPlans.push({
            block: b,
            totalGames,
            gamesEach,
            restEach,
            avgMins: avgMinsIfFit,
            diffFromIdeal: Math.abs(avgMinsIfFit - 14.0)
          });
        }
      }

      let plans = allValidPlans;
      if (plans.length === 0) {
        for (let b = 1; b <= 4; b++) {
          const totalGames = b * blockSize;
          const avgMinsIfFit = parseFloat((totalMinutes / totalGames).toFixed(1));
          plans.push({
            block: b,
            totalGames,
            gamesEach: b * gamesPerBlock,
            restEach: totalGames - (b * gamesPerBlock),
            avgMins: avgMinsIfFit,
            diffFromIdeal: Math.abs(avgMinsIfFit - 14.0)
          });
        }
      }

      plans.sort((a, b) => a.diffFromIdeal - b.diffFromIdeal);
      plans = plans.slice(0, 4).sort((a, b) => a.totalGames - b.totalGames);

      let selectedGames = parseInt(selectedGamesInput?.value);
      if (!selectedGames || !plans.some(p => p.totalGames === selectedGames)) {
        let bestPlan = plans[0];
        let minDiff = Infinity;
        plans.forEach(p => {
          if (p.diffFromIdeal < minDiff) {
            minDiff = p.diffFromIdeal;
            bestPlan = p;
          }
        });
        selectedGames = bestPlan.totalGames;
        if (selectedGamesInput) selectedGamesInput.value = selectedGames;
      }

      const activePlan = plans.find(p => p.totalGames === selectedGames) || plans[0];

      if (badge) {
        badge.innerText = STATE.lang === "zh-TW"
          ? `已選：${activePlan.totalGames} 局 (每單位 ${activePlan.gamesEach} 場)`
          : `Selected: ${activePlan.totalGames} games (${activePlan.gamesEach} g/u)`;
        badge.classList.remove("hidden");
      }

      if (STATE.lang === "zh-TW") {
        hintText.innerHTML = `💡 <strong>按時間排賽</strong>：指定總比賽時間，系統自動試算最佳場數與時間對應。<br/>總時間 <strong>${totalMinutes} 分鐘</strong> (${durationHours}h) · 目前選定 <strong class="text-emerald-500">${activePlan.totalGames} 局賽程</strong>，<strong class="text-emerald-600 dark:text-emerald-400">每單位(人/隊)各打 ${activePlan.gamesEach} 場</strong> (休 ${activePlan.restEach} 場，單局約 ${activePlan.avgMins} 分鐘)。`;
      } else {
        hintText.innerHTML = `💡 <strong>By Duration</strong>: Specify total duration, auto-calc best game options.<br/>Total <strong>${totalMinutes} mins</strong> (${durationHours}h) · Selected <strong class="text-emerald-500">${activePlan.totalGames} games</strong> — <strong class="text-emerald-600 dark:text-emerald-400">each unit plays ${activePlan.gamesEach} games</strong> (rest ${activePlan.restEach}, ~${activePlan.avgMins}m/game).`;
      }

      if (optionsContainer) {
        optionsContainer.classList.remove("hidden");
        const gridColsClass = plans.length >= 3 ? 'sm:grid-cols-3' : plans.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-1';
        const isZh = (STATE.lang === "zh-TW");
        optionsContainer.innerHTML = `
          <div class="text-[11px] font-bold sub-text uppercase tracking-wider mb-1 flex items-center gap-1">
            <span>${isZh ? '推薦公平排賽方案（點選直接套用）：' : 'Recommended Schedule Options (Click to Select):'}</span>
          </div>
          <div class="grid grid-cols-1 ${gridColsClass} gap-2">
            ${plans.map((p, idx) => {
          const isSelected = p.totalGames === selectedGames;
          const unitText = isTeamMode ? (isZh ? "隊" : "team") : (isZh ? "人" : "player");
          return `
                <div onclick="selectFairPlan(${p.totalGames}, ${Math.round(p.avgMins)})"
                  class="cursor-pointer rounded-xl p-2.5 transition border-2 text-left space-y-1 ${isSelected ? 'border-amber-500 bg-amber-500/10 shadow-sm' : 'border-stone-200 dark:border-slate-800 card-inner hover:border-amber-500/40'}">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-xs flex items-center gap-1 ${isSelected ? 'text-amber-600 dark:text-amber-400 font-display' : ''}">
                      ${isSelected ? '✅' : '📌'} ${isZh ? `方案 ${idx + 1}：共 ${p.totalGames} 局` : `Option ${idx + 1}: ${p.totalGames} Games`}
                    </span>
                    <span class="text-[11px] font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      ${isZh ? `每${unitText} ${p.gamesEach} 場` : `${p.gamesEach} Games / ${unitText}`}
                    </span>
                  </div>
                  <div class="text-[10.5px] sub-text flex items-center justify-between">
                    <span>${isZh ? `各休 ${p.restEach} 場` : `Rest ${p.restEach} Games`}</span>
                    <span>${isZh ? `均配 ~${p.avgMins}分/局` : `~${p.avgMins} mins/game`}</span>
                  </div>
                </div>
              `;
        }).join("")}
          </div>
        `;
      }
      lucide.createIcons();
    }
    window.calculateTimeEstimate = calculateTimeEstimate;

    function toggleNewClubInput(forceShow) {
      // 社團建立已獨立至上方導航選單 Modal，開賽表單保留此函式防呆
      renderClubMemberChips();
      lucide.createIcons();
    }
    window.toggleNewClubInput = toggleNewClubInput;

    function onClubSelectChange() {
      renderClubMemberChips();
    }
    window.onClubSelectChange = onClubSelectChange;

    function filterByClub(clubName) {
      STATE.selectedClub = clubName;
      displayHubTournamentsList(STATE.allTournamentsCache);
    }
    window.filterByClub = filterByClub;

    // ----------------------------------------------------
    // CLUB MEMBER ROSTER MANAGEMENT
    // ----------------------------------------------------
    function getCurrentClubName() {
      const clubSelect = document.getElementById("create-club-select");
      return clubSelect ? (clubSelect.value || "").trim() : "";
    }

    function getClubMembersList(clubName) {
      if (!clubName || !clubName.trim()) {
        return []; // 未選擇社團時保持乾淨空白，不載入歷史混淆舊名單
      }
      const key = clubName.trim();
      const local = JSON.parse(localStorage.getItem("pb_club_members") || "{}");
      let members = local[key] ? [...local[key]] : [];

      // 僅載入此特定社團過去賽事中的成員 (排除臨打/暫代角色)
      (STATE.allTournamentsCache || []).forEach(t => {
        const tClub = (t.clubName || '').trim();
        if (tClub === key && Array.isArray(t.players)) {
          t.players.forEach(p => {
            if (p && !members.includes(p.trim()) && !isTransientPlayer(p.trim())) {
              members.push(p.trim());
            }
          });
        }
      });

      return members.filter(m => !isTransientPlayer(m));
    }

    function saveClubMembersList(clubName, members) {
      const key = clubName || "__general__";
      const sanitized = Array.from(
        new Set(
          (members || [])
            .map(m => (typeof m === "string" ? m.trim().slice(0, 10) : ""))
            .filter(m => m && !isTransientPlayer(m))
        )
      );
      const local = JSON.parse(localStorage.getItem("pb_club_members") || "{}");
      local[key] = sanitized;
      safeSetLocal("pb_club_members", JSON.stringify(local));

      if (STATE.db && clubName) {
        try {
          set(ref(STATE.db, `club_members/${encodeClubKey(clubName)}`), sanitized);
        } catch (e) {
          console.error("Firebase save club members error:", e);
        }
      }
    }

    function extractPlayerNames(rawText) {
      if (!rawText) return [];
      const text = rawText.trim();
      if (!text) return [];

      // 1. 若含有換行、逗號、頓號、分號，優先以此為分隔符 (可保留純英文姓名中間的空格如 "Jason Chu")
      if (/[\n\r,，、;；\t]/.test(text)) {
        return text
          .split(/[\n\r,，、;；\t]+/)
          .map(s => s.replace(/^\d+[\.\、\s\-]+/, "").trim().slice(0, 10))
          .filter(s => s.length > 0);
      }

      // 2. 若含有序號 (如 "1. 小明 2. 小華" 或 "1.Jason 2.Bob")
      if (/\d+[\.\、\s\-]/.test(text)) {
        return text
          .split(/(?=\d+[\.\、\s\-])/)
          .map(s => s.replace(/^\d+[\.\、\s\-]+/, "").trim().slice(0, 10))
          .filter(s => s.length > 0);
      }

      // 3. 空格/全形空白批量分割
      const tokens = text.split(/[\s\u3000]+/).map(s => s.trim()).filter(Boolean);

      // 若恰好為 2 個純英文字詞 (如 "Jason Chu")，視為單一英文全名 (上限10字)
      if (tokens.length === 2 && /^[A-Za-z]+$/.test(tokens[0]) && /^[A-Za-z]+$/.test(tokens[1])) {
        return [text.slice(0, 10)];
      }

      // 否則所有空格隔開的名字皆作為批量名字處理，每位選手嚴格限制上限10字
      return tokens.map(s => s.slice(0, 10)).filter(s => s.length > 0);
    }

    function getSelectedPlayers() {
      const textarea = document.getElementById("create-players");
      if (!textarea || !textarea.value) return [];
      return textarea.value.split("\n").map(s => s.trim().slice(0, 10)).filter(Boolean);
    }

    const MAX_ROSTER_LIMIT = 60; // 參賽登錄上限：60 組/人
    const MAX_ROTATING_PLAYERS = 16; // 單一球場個人輪替上限：16 人

    function setSelectedPlayers(list) {
      const textarea = document.getElementById("create-players");
      const partnerType = document.getElementById("create-partner-type")?.value || "rotating";
      const mode = document.getElementById("create-tournament-mode")?.value || "fair";
      const isRotating = (partnerType === "rotating");
      const isSingles = (partnerType === "singles");

      let unique = Array.from(new Set((list || []).map(s => s.trim().slice(0, 10)).filter(Boolean)));
      if ((isRotating || isSingles) && unique.length > MAX_ROTATING_PLAYERS) {
        unique = unique.slice(0, MAX_ROTATING_PLAYERS);
        showToast(
          STATE.lang === "zh-TW"
            ? `⚠️ 單場${isSingles ? "單打" : "輪替"}模式建議上限為 ${MAX_ROTATING_PLAYERS} 人！若人數更多建議分開建立賽事。`
            : `⚠️ Max ${MAX_ROTATING_PLAYERS} players for single-court rotating/singles! Consider splitting into separate tournaments.`,
          "warning"
        );
      } else if (unique.length > MAX_ROSTER_LIMIT) {
        unique = unique.slice(0, MAX_ROSTER_LIMIT);
        showToast(
          STATE.lang === "zh-TW"
            ? `⚠️ 參賽單位已達上限 (最多 ${MAX_ROSTER_LIMIT} 組)！`
            : `⚠️ Max unit limit reached (max ${MAX_ROSTER_LIMIT})!`,
          "warning"
        );
      }
      if (textarea) textarea.value = unique.join("\n");
      renderSelectedPlayerChips();
      renderClubMemberChips();
      updatePlayerCountBadge();
      updateRosterHealthNotice();
      calculateTimeEstimate();
    }

    function renderSelectedPlayerChips() {
      const container = document.getElementById("selected-players-chips");
      if (!container) return;
      const players = getSelectedPlayers();
      if (players.length === 0) {
        container.innerHTML = "";
        return;
      }
      container.innerHTML = players.map(name => {
        const escaped = safeEscape(name);
        return `
          <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500 text-white dark:text-slate-950 shadow-sm transition hover:scale-[1.02]">
            <i data-lucide="user" class="w-3 h-3"></i>
            <span>${escapeHTML(name)}</span>
            <button type="button" onclick="removeSelectedPlayer('${escaped}')" class="ml-0.5 opacity-75 hover:opacity-100 hover:text-rose-200 transition text-[11px]" title="Remove">✕</button>
          </div>
        `;
      }).join("");
      lucide.createIcons();
    }
    window.renderSelectedPlayerChips = renderSelectedPlayerChips;

    function removeSelectedPlayer(name) {
      const current = getSelectedPlayers().filter(p => p !== name);
      setSelectedPlayers(current);
    }
    window.removeSelectedPlayer = removeSelectedPlayer;

    function renderClubMemberChips() {
      const chipsContainer = document.getElementById("club-members-chips");
      if (!chipsContainer) return;

      const currentClub = getCurrentClubName();
      const members = getClubMembersList(currentClub);
      const selectedNames = getSelectedPlayers();
      const sectionEl = document.getElementById("club-members-section");

      if (!currentClub || members.length === 0) {
        if (sectionEl) sectionEl.classList.add("hidden");
        chipsContainer.innerHTML = "";
        return;
      }

      if (sectionEl) sectionEl.classList.remove("hidden");

      chipsContainer.innerHTML = members.map(name => {
        const isSelected = selectedNames.includes(name);
        const escapedName = safeEscape(name);
        return `
          <div class="group inline-flex items-center rounded-lg border text-xs transition select-none ${isSelected
            ? 'bg-emerald-500/15 border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold shadow-sm'
            : 'card-inner sub-text hover:border-emerald-500/50 hover:text-stone-900 dark:hover:text-white'
          }">
            <button type="button" onclick="togglePlayerSelection('${escapedName}')" class="px-2.5 py-1 flex items-center gap-1.5">
              <i data-lucide="${isSelected ? 'check-circle-2' : 'circle'}" class="w-3 h-3 ${isSelected ? 'text-emerald-500' : 'opacity-40'}"></i>
              <span>${escapeHTML(name)}</span>
            </button>
            <button type="button" onclick="removeClubMember('${escapedName}')" class="pr-1.5 pl-0.5 py-1 text-[10px] opacity-30 group-hover:opacity-100 hover:text-rose-500 transition" title="Delete from club">
              ✕
            </button>
          </div>
        `;
      }).join("");

      lucide.createIcons();
    }
    window.renderClubMemberChips = renderClubMemberChips;

    function quickAddPlayer() {
      const input = document.getElementById("quick-add-player-input");
      if (!input) return;
      const raw = input.value.trim();
      if (!raw) return;

      const names = extractPlayerNames(raw);
      if (names.length === 0) return;

      const current = getSelectedPlayers();
      const currentClub = getCurrentClubName();
      let clubMembers = currentClub ? getClubMembersList(currentClub) : [];

      names.forEach(name => {
        if (!current.includes(name)) current.push(name);
        if (currentClub && !clubMembers.includes(name)) {
          clubMembers.push(name);
        }
      });

      if (currentClub) {
        saveClubMembersList(currentClub, clubMembers);
      }

      input.value = "";
      setSelectedPlayers(current);
    }
    window.quickAddPlayer = quickAddPlayer;

    function togglePlayerSelection(name) {
      let current = getSelectedPlayers();
      if (current.includes(name)) {
        current = current.filter(p => p !== name);
      } else {
        current.push(name);
      }
      setSelectedPlayers(current);
    }
    window.togglePlayerSelection = togglePlayerSelection;

    function removeClubMember(name) {
      const currentClub = getCurrentClubName();
      if (!currentClub) return;
      let members = getClubMembersList(currentClub);
      members = members.filter(p => p !== name);
      saveClubMembersList(currentClub, members);
      renderClubMemberChips();
    }
    window.removeClubMember = removeClubMember;

    function selectAllClubMembers() {
      const currentClub = getCurrentClubName();
      const members = getClubMembersList(currentClub);
      if (members.length === 0) return;
      const current = getSelectedPlayers();
      members.forEach(m => {
        if (!current.includes(m)) current.push(m);
      });
      setSelectedPlayers(current);
    }
    window.selectAllClubMembers = selectAllClubMembers;

    function clearSelectedPlayers() {
      setSelectedPlayers([]);
    }
    window.clearSelectedPlayers = clearSelectedPlayers;

    function quickGeneratePlayers() {
      const countInput = document.getElementById("quick-generate-count");
      const partnerType = document.getElementById("create-partner-type")?.value || "rotating";
      const mode = document.getElementById("create-tournament-mode")?.value || "fair";
      const isRotating = (partnerType === "rotating" && mode !== "group");
      const isSingles = (partnerType === "singles" && mode !== "group");
      const maxLimit = (isRotating || isSingles) ? 16 : 60;
      const isTeamMode = (partnerType === "fixed");
      const isZh = (STATE.lang === "zh-TW");
      const unitStr = isZh ? (isTeamMode ? "隊" : "人") : (isTeamMode ? "Teams" : "Players");

      const existing = (typeof getSelectedPlayers === "function") ? (getSelectedPlayers() || []) : [];

      const rawVal = countInput?.value?.trim();
      let count = parseInt(rawVal, 10);
      if (isNaN(count) || count < 1) {
        if (!rawVal) {
          count = 1;
        } else {
          showToast(
            isZh ? "請輸入有效的增加數量（至少 1 位）！" : "Please enter a valid count (at least 1)!",
            "warning"
          );
          if (countInput) countInput.focus();
          return;
        }
      }

      const availableSlots = maxLimit - existing.length;
      if (availableSlots <= 0) {
        showToast(
          isZh ? `名額已達上限 ${maxLimit} ${unitStr}，無法再增加！` : `Limit of ${maxLimit} ${unitStr} reached!`,
          "warning"
        );
        return;
      }
      if (count > availableSlots) {
        showToast(
          isZh
            ? `目前已有 ${existing.length} ${unitStr}，最多只能再增加 ${availableSlots} ${unitStr}（單場上限 ${maxLimit} ${unitStr}）！`
            : `Can only add up to ${availableSlots} more (limit ${maxLimit})!`,
          "warning"
        );
        return;
      }

      const prefix = isTeamMode
        ? (isZh ? "隊伍" : "Team")
        : (isZh ? "臨打" : "Guest");

      // 檢查現有名單中已存在的臨打/隊伍編號，避免編號碰撞重複
      let maxExistingNum = 0;
      const prefixRegex = isTeamMode
        ? /^(?:隊伍|Team)\s*([0-9]+)$/i
        : /^(?:臨打|Guest|選手|Player)\s*([0-9]+)$/i;

      existing.forEach(name => {
        const m = (name || "").trim().match(prefixRegex);
        if (m && m[1]) {
          const num = parseInt(m[1], 10);
          if (!isNaN(num) && num > maxExistingNum) {
            maxExistingNum = num;
          }
        }
      });

      const generated = [];
      for (let i = 1; i <= count; i++) {
        generated.push(`${prefix} ${maxExistingNum + i}`);
      }

      // 排在原本名單後面追加
      setSelectedPlayers([...existing, ...generated]);

      if (countInput) countInput.value = "";
    }
    window.quickGeneratePlayers = quickGeneratePlayers;

    function populateCreateClubSelect() {
      if (STATE.createContextClub) return;
      const clubSelect = document.getElementById("create-club-select");
      if (!clubSelect) return;

      const currentVal = clubSelect.value;
      // 僅登入會員才具備專屬社團，未登入訪客無專屬社團 (不透過 localStorage 拼湊猜測)
      const userMyClubs = (STATE.lineUserId && Array.isArray(STATE.myClubs) ? STATE.myClubs : [])
        .filter(c => c && c.trim())
        .map(c => c.trim());

      // 嚴格過濾：僅保留全站真實有效（未被刪除）的社團
      const allActiveClubs = typeof getAllUniqueClubs === "function" ? getAllUniqueClubs() : [];
      const validMyClubs = userMyClubs.filter(c => allActiveClubs.includes(c));

      const isZh = STATE.lang === "zh-TW";
      let optionsHtml = `<option value="">${t("selectClubOption")}</option>`;

      if (validMyClubs.length > 0) {
        optionsHtml += `<optgroup label="${isZh ? "我的社團" : "My Clubs"}">`;
        validMyClubs.forEach(c => {
          optionsHtml += `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`;
        });
        optionsHtml += `</optgroup>`;
      }

      clubSelect.innerHTML = optionsHtml;
      if (currentVal && validMyClubs.includes(currentVal)) {
        clubSelect.value = currentVal;
      }
    }
    window.populateCreateClubSelect = populateCreateClubSelect;

    function setupCreateFormContext(clubName) {
      STATE.createContextClub = clubName || null;
      const wrapClub = document.getElementById("wrap-create-club");
      const nameInput = document.getElementById("create-name");

      if (clubName) {
        // 社團模式：直接鎖定為當前社團
        if (wrapClub) {
          wrapClub.innerHTML = `
            <div class="flex items-center justify-between mb-1">
              <label class="block text-xs sm:text-sm font-semibold">2. 所屬社團</label>
              <span class="text-[10px] px-2 py-0.5 rounded-full card-inner border font-bold text-amber-600 dark:text-amber-400">社團專屬球局</span>
            </div>
            <div class="p-3 rounded-xl card-inner border flex items-center justify-between">
              <div class="flex items-center gap-2 text-xs font-bold text-amber-600 dark:text-amber-400">
                <i data-lucide="shield" class="w-4 h-4"></i>
                <span>${escapeHTML(clubName)}</span>
              </div>
              <span class="text-[11px] sub-text">歸檔至該社團大廳</span>
            </div>
            <select id="create-club-select" class="hidden">
              <option value="${escapeHTML(clubName)}" selected>${escapeHTML(clubName)}</option>
            </select>
          `;
        }

        if (nameInput && !nameInput.value.trim()) {
          const today = new Date();
          const dStr = `${today.getMonth() + 1}/${today.getDate()}`;
          nameInput.value = `${clubName} ${dStr} 球局`;
        }
      } else {
        // 臨打模式：顯示社團選單（僅顯示「我的社團」，未加入社團時僅有「臨打球局」）
        if (wrapClub) {
          wrapClub.innerHTML = `
            <label id="t-label-club" class="block text-xs sm:text-sm font-semibold mb-1">${t("labelClub")}</label>
            <div class="space-y-2">
              <select id="create-club-select" onchange="onClubSelectChange()"
                class="w-full input-bg border rounded-xl p-2.5 text-xs sm:text-sm focus:border-emerald-500 focus:outline-none">
              </select>
            </div>
          `;
          populateCreateClubSelect();
        }
      }
      if (typeof onClubSelectChange === "function") onClubSelectChange();
      setCreateEntryType("instant");
      lucide.createIcons();
    }
    window.setupCreateFormContext = setupCreateFormContext;

    function handleCreateNotesKeyDown(e) {
      if (e.key === "Enter") {
        const textarea = e.target;
        const lines = (textarea.value || "").split("\n");
        if (lines.length >= 10 && textarea.selectionStart === textarea.selectionEnd) {
          e.preventDefault();
          showToast(STATE.lang === "zh-TW" ? "⚠️ 備註最多限制 10 行！" : "⚠️ Notes limited to 10 lines max!", "warning");
        }
      }
    }
    window.handleCreateNotesKeyDown = handleCreateNotesKeyDown;

    function updateCreateNotesCounter() {
      const textarea = document.getElementById("create-notes");
      const counter = document.getElementById("create-notes-counter");
      if (!textarea || !counter) return;

      // 限制不能超過 10 行
      const lines = textarea.value.split("\n");
      if (lines.length > 10) {
        textarea.value = lines.slice(0, 10).join("\n");
      }

      // 限制總長度不能超過 50 字
      if (textarea.value.length > 50) {
        textarea.value = textarea.value.slice(0, 50);
      }
      const len = textarea.value.length;
      counter.innerText = `${len}/50`;
      if (len >= 50) {
        counter.className = "text-[10px] font-mono font-bold text-rose-500";
      } else if (len >= 45) {
        counter.className = "text-[10px] font-mono font-bold text-amber-500";
      } else {
        counter.className = "text-[10px] font-mono sub-text";
      }
    }
    window.updateCreateNotesCounter = updateCreateNotesCounter;

    function resetCreateForm() {
      const form = document.getElementById("form-create-tournament");
      if (form) form.reset();
      const createPlayers = document.getElementById("create-players");
      if (createPlayers) createPlayers.value = "";
      const createNotes = document.getElementById("create-notes");
      if (createNotes) createNotes.value = "";
      const maxPlayersInput = document.getElementById("create-max-players");
      if (maxPlayersInput) maxPlayersInput.value = "";
      updateCreateNotesCounter();
      setSelectedPlayers([]);
      renderSelectedPlayerChips();
      renderClubMemberChips();
      updatePlayerCountBadge();
      setCreateEntryType("instant");
      setupCreateFormContext(STATE.createContextClub);
    }
    window.resetCreateForm = resetCreateForm;

    async function handleCreateTournament(e) {
      e.preventDefault();

      const entryMode = document.getElementById("create-entry-mode")?.value || "registration";
      const isReg = (entryMode === "registration");
      const submitBtn = document.getElementById("btn-submit-create");

      // 1. 防重複點擊：鎖定按鈕並呈現加載狀態
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add("opacity-60", "cursor-not-allowed");
        submitBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> <span>${STATE.lang === "zh-TW" ? (isReg ? "建立中..." : "正在排賽開打...") : (isReg ? "Confirming..." : "Starting tournament...")}</span>`;
        lucide.createIcons();
      }

      try {
        let maxPlayers = null;
        if (isReg) {
          const rawVal = document.getElementById("create-max-players")?.value?.trim();
          if (!rawVal) {
            maxPlayers = 100;
          } else {
            const rawMax = parseInt(rawVal, 10);
            if (isNaN(rawMax) || rawMax <= 0 || rawMax > 100) {
              maxPlayers = 100;
            } else if (rawMax < 2) {
              maxPlayers = 2;
            } else {
              maxPlayers = rawMax;
            }
          }
        }

        const mode = document.getElementById("create-tournament-mode")?.value || "fair";
        const nameInput = document.getElementById("create-name");
        const name = nameInput ? nameInput.value.trim() : "";
        if (!name) {
          showToast(STATE.lang === "zh-TW" ? "請輸入賽事名稱！" : "Please enter tournament name!", "warning");
          if (nameInput) nameInput.focus();
          return;
        }

        let notes = (document.getElementById("create-notes")?.value || "").trim().slice(0, 50);
        notes = notes.split("\n").slice(0, 10).join("\n");

        const clubSelect = document.getElementById("create-club-select");
        const clubName = clubSelect ? (clubSelect.value || "").trim() : "";

        let duration = parseFloat(document.getElementById("create-duration")?.value) || 2.0;
        if (duration > 6.0) duration = 6.0;
        const scoringType = "rally";
        const targetScore = 15;
        const customTotalGames = parseInt(document.getElementById("create-selected-total-games")?.value) || 0;
        const rawPlayers = document.getElementById("create-players").value;

        const players = rawPlayers.split("\n").map(s => s.trim()).filter(Boolean);
        const uniquePlayers = [...new Set(players)];

        const strategy = document.getElementById("create-fair-strategy")?.value || "time";
        let effectiveMode = mode;
        if (mode === "fair" && strategy === "full-cycle") {
          effectiveMode = "round-robin";
        }

        const isPrivate = false;

        const partnerType = document.getElementById("create-partner-type")?.value || "rotating";
        const isTeamMode = (partnerType === "fixed");
        const isSingles = (partnerType === "singles");
        const minUnits = isSingles ? 2 : 4;

        // Validation for Direct Play mode
        if (entryMode === "instant") {
          if (mode === "free" && uniquePlayers.length < 2) {
            showToast(
              STATE.lang === "zh-TW"
                ? (isSingles ? "自由單打模式至少需 2 位選手！" : (isTeamMode ? "自由隊伍模式至少需 2 支隊伍！" : "自由模式至少需 2 位參賽單位！"))
                : "At least 2 units required for Free Mode!",
              "error"
            );
            return;
          }

          if (mode === "fair" && uniquePlayers.length < minUnits) {
            showToast(
              STATE.lang === "zh-TW"
                ? (isSingles ? "個人單打參賽選手至少需 2 人！" : "輪轉模式參賽單位至少需 4 個 (人/隊伍)！")
                : `At least ${minUnits} units required for rotation mode!`,
              "error"
            );
            return;
          }
        }

        // Automatically persist all roster players to club members list if clubName exists
        if (clubName && uniquePlayers.length > 0) {
          const currentClubMembers = getClubMembersList(clubName);
          let membersUpdated = false;
          uniquePlayers.forEach(p => {
            if (!currentClubMembers.includes(p)) {
              currentClubMembers.push(p);
              membersUpdated = true;
            }
          });
          if (membersUpdated) {
            saveClubMembersList(clubName, currentClubMembers);
          }
        }

        const tournamentId = await generateUniqueTournamentId();
        let matches = [];

        // ----------------------------------------------------
        // 分支 A: 建立報名模式 (Registration Lobby)
        // ----------------------------------------------------
        if (entryMode === "registration") {
          const tournamentObj = {
            id: tournamentId,
            tournamentMode: effectiveMode,
            partnerType: partnerType,
            isTeamMode: isTeamMode,
            name: name,
            notes: notes,
            clubName: clubName,
            isPrivate: isPrivate,
            durationHours: duration,
            customTotalGames: customTotalGames,
            scoringType: scoringType,
            targetScore: targetScore,
            createdAt: new Date().toISOString(),
            players: uniquePlayers,
            matches: [],
            status: "registering",
            entryMode: "registration",
            maxPlayers: maxPlayers
          };

          saveToLocalTournaments(tournamentObj);
          addMyTournamentId(tournamentId);
          addCreatedTournamentId(tournamentId);

          if (STATE.db) {
            try {
              await set(ref(STATE.db, `tournaments/${tournamentId}`), tournamentObj);
            } catch (err) {
              console.error("Firebase write error for registration lobby:", err);
            }
          }

          if (clubName) {
            STATE.authenticatedClubs.add(clubName);
          }
          STATE.activeTournamentAdmin = tournamentId;

          resetCreateForm();
          loadLiveTournament(tournamentId, true, false);
          return;
        }

        // ----------------------------------------------------
        // 分支 B: 立即開打模式 (Instant Play)
        // ----------------------------------------------------
        let backendSuccess = false;
        // 8 人雙打打滿 14 局：直接在網頁用完美排法（搭檔各 1 次、對手各 2 次），不經雲端
        const usePerfectEight = !isSingles && !isTeamMode && uniquePlayers.length === 8
          && (customTotalGames === 14 || (!customTotalGames && effectiveMode === "round-robin"));
        if (mode === "fair") {
          // 優先呼叫後端 Cloud Function 執行核心排賽計算
          if (!usePerfectEight) try {
            const format = isSingles ? "singles" : (isTeamMode ? "team" : "doubles");
            const res = await fetch(`${FUNCTIONS_BASE_URL}/generateSchedule`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                players: uniquePlayers,
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
                console.info("%c[Scheduler] 賽程由 Cloud Functions 後端計算生成成功, 場次: " + matches.length, "color: #10b981; font-weight: bold; font-size: 13px;");
              }
            }
          } catch (backendErr) {
            console.warn("[Scheduler] 後端排賽失敗，自動啟用前端離線備援演算法:", backendErr);
          }

          // 離線降級備援：若後端未啟動或斷網，由前端備援計算
          if (!backendSuccess) {
            if (isSingles) {
              matches = generateSinglesSchedule(uniquePlayers, duration, 15, effectiveMode, customTotalGames);
            } else if (isTeamMode) {
              matches = generateTeamRoundRobinSchedule(uniquePlayers);
            } else {
              matches = generateRoundRobinSchedule(uniquePlayers, duration, 15, effectiveMode, customTotalGames);
            }
          }
        }

        const tournamentObj = {
          id: tournamentId,
          tournamentMode: effectiveMode,
          partnerType: partnerType,
          isTeamMode: isTeamMode,
          name: name,
          notes: notes,
          clubName: clubName,
          isPrivate: isPrivate,
          durationHours: duration,
          customTotalGames: customTotalGames,
          scoringType: scoringType,
          targetScore: targetScore,
          createdAt: new Date().toISOString(),
          players: uniquePlayers,
          matches: matches,
          status: "active"
        };

        saveToLocalTournaments(tournamentObj);
        addMyTournamentId(tournamentId);
        addCreatedTournamentId(tournamentId);

        const engineTag = backendSuccess ? " (⚡雲端排賽)" : " (💻本地排賽)";
        if (STATE.db) {
          try {
            await set(ref(STATE.db, `tournaments/${tournamentId}`), tournamentObj);
          } catch (err) {
            console.error("Firebase write error:", err);
            showToast(STATE.lang === "zh-TW" ? "雲端發布失敗，已轉存至本地備份" + engineTag : "Saved to local backup" + engineTag, "warning");
          }
        }

        // Creator automatically gets admin session for this tournament
        if (clubName) {
          STATE.authenticatedClubs.add(clubName);
        }
        STATE.activeTournamentAdmin = tournamentId;

        // 重置表單並依情境跳轉至相應大廳
        resetCreateForm();
        if (clubName) {
          openClubSpace(clubName);
        } else {
          navigateTo("hub");
        }

      } catch (err) {
        console.error("[CreateTournament Error]:", err);
        showToast(STATE.lang === "zh-TW" ? `❌ 建立賽事失敗: ${err.message || err}` : `❌ Failed to create tournament: ${err.message || err}`, "error");
      } finally {
        const submitBtn = document.getElementById("btn-submit-create");
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.classList.remove("opacity-60", "cursor-not-allowed");
          const isReg = document.getElementById("create-entry-mode")?.value === "registration";
          const isZh = (STATE.lang === "zh-TW");
          if (isReg) {
            submitBtn.innerHTML = `<i data-lucide="clipboard-check" class="w-4 h-4"></i> <span id="t-btn-submit-create-text">${isZh ? "確認" : "Confirm"}</span>`;
          } else {
            submitBtn.innerHTML = `<i data-lucide="play" class="w-4 h-4 fill-current"></i> <span id="t-btn-submit-create-text">${isZh ? "確認並立即開打" : "Start Tournament Now"}</span>`;
          }
        }
        lucide.createIcons();
      }
    }
    window.handleCreateTournament = handleCreateTournament;

    // ----------------------------------------------------
    // PRIVACY & MY TOURNAMENTS HELPERS
    // ----------------------------------------------------
