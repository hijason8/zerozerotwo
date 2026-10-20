/**
 * i18n-ui.js - ZeroZeroTwo 多語系 UI 更新模組
 * 將原本分散在 469 行、166 次手動 getElementById 的龐大 UI 賦值
 * 全面轉化為宣告式資料結構（Data-driven i18n mapping），徹底消除冗餘代碼。
 */

import { STATE, t } from "./globals.js";

// ====================================================
// 1. 純文字 ID -> i18n 字典鍵值 (直接呼叫 t(key))
// ====================================================
export const I18N_TEXT_KEYS = {
  "t-nav-hub": "navHub",
  "t-nav-club": "navClub",
  "t-nav-create": "navCreate",
  "t-dropdown-guide": "dropdownGuide",
  "t-dropdown-line-oa": "dropdownLineOa",
  "t-dropdown-install": "dropdownInstall",
  "t-modal-line-oa-title-text": "modalLineOaTitle",
  "t-modal-line-oa-desc": "modalLineOaDesc",
  "t-modal-line-oa-hint": "modalLineOaHint",
  "t-btn-open-line-oa": "btnOpenLineOa",
  "t-btn-copy-line-id": "btnCopyLineId",
  "t-dropdown-email-label": "dropdownEmailLabel",
  "t-hub-privacy-hint": "hubPrivacyHint",
  "t-modal-search-title": "modalSearchTitle",
  "t-modal-search-desc": "modalSearchDesc",
  "t-modal-search-btn": "modalSearchBtn",
  "t-quick-code-btn": "quickCodeBtn",
  "t-create-new-btn-text": "createNewBtn",
  "t-hub-active-heading": "hubActiveTitle",
  "t-hub-completed-heading": "hubCompletedTitle",
  "t-club-create-btn": "createNewBtn",
  "t-btn-share-club": "shareClubBtn",
  "t-choose-club-title": "chooseClubTitle",
  "t-history-aggregate-heading": "clubStandingsTitle",
  "t-history-month-label": "monthFilterLabel",
  "th-agg-player": "thAggPlayer",
  "th-agg-games": "thAggGames",
  "th-agg-winrate": "thAggWinrate",
  "th-agg-wl": "thAggWl",
  "th-agg-diff": "thAggDiff",
  "th-agg-pfpa": "thAggPfPa",
  "t-label-name": "labelName",
  "t-label-club": "labelClub",
  "t-label-max-players-text": "labelMaxPlayers",
  "t-modal-create-club-title": "createClubModalTitle",
  "t-modal-create-club-desc": "createClubModalDesc",
  "t-label-modal-club-desc": "labelModalClubDesc",
  "t-label-modal-club-privacy": "labelModalClubPrivacy",
  "t-modal-club-public-title": "modalClubPublicTitle",
  "t-modal-club-public-desc": "modalClubPublicDesc",
  "t-modal-club-private-title": "modalClubPrivateTitle",
  "t-modal-club-private-desc": "modalClubPrivateDesc",
  "t-label-modal-club-pwd": "labelModalClubPwd",
  "t-modal-club-pwd-hint": "hintModalClubPwd",
  "t-btn-cancel-create-club": "cancelBtn",
  "t-btn-submit-create-club-text": "confirmCreateBtn",
  "t-empty-create-club-btn": "createClubModalTitle",
  "t-modal-explore-clubs-title": "modalExploreClubsTitle",
  "t-modal-explore-clubs-desc": "modalExploreClubsDesc",
  "t-modal-explore-create-link": "createClubModalTitle",
  "t-tab-activities": "clubTabActivities",
  "t-desktop-tab-activities": "clubTabActivities",
  "t-tab-records": "clubTabRecords",
  "t-desktop-tab-records": "clubTabRecords",
  "t-tab-profile": "clubTabProfile",
  "t-desktop-tab-profile": "clubTabProfile",
  "t-tab-info": "clubTabInfo",
  "t-desktop-tab-info": "clubTabInfo",
  "t-club-active-heading": "clubActiveHeading",
  "t-club-no-activities-msg": "clubNoActivitiesHint",
  "t-history-matches-heading": "historyMatchesHeading",
  "t-club-profile-heading": "clubProfileHeading",
  "t-club-profile-subheading": "clubProfileSubheading",
  "t-club-profile-tip-text": "clubProfileTip",
  "t-club-invite-heading": "clubInviteHeading",
  "t-club-invite-desc": "clubInviteDesc",
  "t-btn-share-club-full-text": "btnShareClubFullText",
  "t-mode-fair-desc": "modeFairDesc",
  "t-mode-free-desc": "modeFreeDesc",
  "t-lobby-title": "lobbyTitle",
  "t-lobby-registered-title": "lobbyRegisteredTitle",
  "t-lobby-club-members-title": "lobbyClubMembersTitle",
  "t-lobby-btn-join": "lobbyBtnJoin",
  "t-lobby-share-btn": "lobbyShareBtn",
  "t-lobby-admin-title": "lobbyAdminTitle",
  "t-est-prefix": "estPrefix",
  "t-hrs-unit": "hrsUnit",
  "t-share-btn-text": "shareBtnText",
  "t-btn-complete-and-return": "finishAndReturnBtn",
  "t-btn-live-delete": "deleteTournamentBtn",
  "t-btn-add-match-toolbar": "btnAddMatchToolbar",
  "text-live-copy-report": "copyReportBtn",
  "th-rank": "thRank",
  "th-player": "thPlayer",
  "th-wl": "thWl",
  "th-diff": "thDiff",
  "th-pf-pa": "thPfPa",
  "t-tiebreaker-box-title": "tbTitle",
  "t-modal-qr-title": "modalQrTitle",
  "t-modal-qr-desc": "modalQrDesc",
  "t-btn-share-line": "shareLineBtn",
  "modal-add-match-title": "addMatchModalTitle",
  "t-modal-format-label": "modalFormatLabel",
  "t-modal-format-doubles": "modalFormatDoubles",
  "t-modal-format-singles": "modalFormatSingles",
  "t-modal-auto-pick": "modalAutoPick",
  "t-modal-random-pick": "modalRandomPick",
  "t-modal-swap-sides": "modalSwapSides",
  "t-modal-swap-partners": "modalSwapPartners",
  "t-modal-clear": "modalClear",
  "t-modal-tap-roster-sub": "modalTapRosterSub",
  "t-modal-confirm-add-text": "confirmAddMatchBtn"
};

// ====================================================
// 2. 雙語文字 ID -> [繁中, EN]
// ====================================================
export const I18N_CUSTOM_TEXTS = {
  "t-live-admin-toolbar-title": [
    "操作面板",
    "Operation Panel"
  ],
  "t-live-back-nav": [
    "返回活動總表",
    "Back to Activities"
  ],
  "t-dropdown-theme": [
    "外觀主題",
    "Appearance"
  ],
  "t-dropdown-lang": [
    "語言切換",
    "Language"
  ],
  "t-dropdown-admin": [
    "管理員後台",
    "Admin Panel"
  ],
  "lang-mode-label": [
    "繁中",
    "EN"
  ],
  "t-btn-line-oa": [
    "LINE- APP",
    "LINE- APP"
  ],
  "t-club-info-heading": [
    "社團",
    "Club"
  ],
  "t-btn-edit-club-info": [
    "編輯社團",
    "Edit Club"
  ],
  "t-activities-reg-text": [
    "比賽中與已報名",
    "In Progress & Registered"
  ],
  "t-activities-avail-text": [
    "開放接龍報名",
    "Available for Sign Up"
  ],
  "t-activities-comp-text": [
    "近期完賽球局 (3日內)",
    "Recent Completed Matches (3 Days)"
  ],
  "t-label-notes-text": [
    "活動備註 / 補充說明",
    "Notes / Details"
  ],
  "t-label-notes-opt": [
    "(選填)",
    "(Optional)"
  ],
  "live-notes-heading": [
    "活動說明 / 備註：",
    "Event Notes / Details:"
  ],
  "t-label-entry-type": [
    "3. 開局方式",
    "3. Entry Format"
  ],
  "t-entry-reg-title": [
    "建立接龍",
    "Open Sign-up"
  ],
  "t-entry-instant-title": [
    "直接開打",
    "Direct Play"
  ],
  "t-reg-hint-title": [
    "建立接龍說明",
    "How Sign-up Works:"
  ],
  "t-reg-hint-desc": [
    "建立報名房間後，將網址發至 LINE 群組供球友即時簽到。全員到齊後，可於現場決定以「平均模式」自動排賽或「自由模式/練球」開打！",
    "Create a sign-up room and share the link to your LINE or chat group for players to RSVP (+1). Once everyone is present, choose Fair Rotation or Free Play to start!"
  ],
  "t-label-mode": [
    "4. 賽事模式選擇",
    "4. Match Mode"
  ],
  "t-mode-fair-title": [
    "平均模式",
    "Fair Rotation"
  ],
  "t-mode-free-title": [
    "自由模式/練球",
    "Free Play / Practice"
  ],
  "t-lobby-btn-edit-duration": [
    "調整時間",
    "Edit Duration"
  ],
  "t-lobby-btn-delete": [
    "取消球局",
    "Delete"
  ],
  "t-modal-duration-title": [
    "調整比賽時間",
    "Adjust Tournament Duration"
  ],
  "t-modal-duration-desc": [
    "修改預計總時間，開賽將依此自動試算局數",
    "Update duration, system will recalculate optimal schedule on start"
  ],
  "t-label-duration": [
    "預計比賽總時間",
    "Estimated Total Duration"
  ],
  "t-unit-hours": [
    "小時",
    "Hours"
  ],
  "t-free-notice-title": [
    "自由模式說明：",
    "Free Play Guide:"
  ],
  "t-free-notice-desc": [
    "進入賽事後，使用管理模式隨時點擊「➕ 新增場次」與「補入選手」即時開局記分！",
    "In live view, unlock Admin Mode to add matches and players on the fly!"
  ],
  "t-partner-rotating-text": [
    "輪替隊友",
    "Rotating Doubles"
  ],
  "t-partner-fixed-text": [
    "固定隊友",
    "Fixed Teams"
  ],
  "t-partner-singles-text": [
    "個人單打",
    "Singles"
  ],
  "t-btn-quick-gen": [
    "產生",
    "Generate"
  ],
  "t-label-fair-duration": [
    "6. 排賽目標與時間限制",
    "6. Schedule Goal & Duration"
  ],
  "t-strategy-time-title": [
    "按時間排賽",
    "By Duration"
  ],
  "t-strategy-full-title": [
    "全循環排賽",
    "Full Round-Robin"
  ],
  "t-btn-add-person": [
    "新增",
    "Add"
  ]
};

// ====================================================
// 3. 輸入框 Placeholder -> key 或 [繁中, EN]
// ====================================================
export const I18N_PLACEHOLDERS = {
  "quick-code-modal-input": "modalSearchPlaceholder",
  "hub-quick-code-input": "quickCodePlaceholder",
  "create-notes": [
    "例：公館球場4號場、費用150元、請自備球拍...",
    "e.g. Court 4, Fee $150, Bring your own paddle..."
  ],
  "create-max-players": [
    "",
    ""
  ],
  "modal-create-club-name": "placeholderModalClubName",
  "modal-create-club-desc-input": "placeholderModalClubDesc",
  "modal-create-club-pwd": "placeholderModalClubPwd",
  "modal-explore-clubs-search": "modalExploreClubsPlaceholder",
  "lobby-player-input": "lobbyInputPlaceholder",
  "quick-generate-count": [
    "數量",
    "Count"
  ],
  "quick-add-player-input": [
    "姓名，支援空格批量輸入",
    "Enter names (supports space/line batch input)..."
  ],
  "create-name": "placeholderName",
  "create-players": "placeholderPlayers"
};

// ====================================================
// 4. 按鈕 Title 提示文字 -> key
// ====================================================
export const I18N_TITLES = {
  "nav-btn-hub": "navHub",
  "nav-btn-history": "navClub"
};

// ====================================================
// 5. 帶圖示或 HTML 的標題/按鈕
// ====================================================
export const I18N_HTML = {
  "t-history-title": () => `<i data-lucide="history" class="w-5 h-5 text-emerald-500"></i> ${t("historyTitle")}`,
  "t-create-title": () => `<i data-lucide="plus-circle" class="w-5 h-5 text-orange-500"></i> ${t("createTitle")}`,
  "t-label-modal-club-name": () => `${t("labelModalClubName")} <span class="text-rose-500">*</span>`,
  "t-modal-club-name-label": () => `${t("labelModalClubName")} <span class="text-rose-500">*</span>`,
  "t-time-calc-title": (isZh) => `<i data-lucide="clock" class="w-3.5 h-3.5"></i> <span>${isZh ? "時間與配局試算：" : "Estimated Matchups & Schedule:"}</span>`,
  "t-schedule-title": () => `<i data-lucide="swords" class="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500"></i> ${t("scheduleTitle")}`,
  "t-leaderboard-title": () => `<i data-lucide="crown" class="w-4 h-4 sm:w-5 sm:h-5 text-amber-500"></i> ${t("leaderboardTitle")}`,
  "t-copy-btn": () => `<i data-lucide="copy" class="w-3.5 h-3.5"></i> ${t("copyBtn")}`
};

// ====================================================
// 6. 動態情境語言更新 (狀態/條件式關聯更新)
// ====================================================
function applyDynamicLanguageUI(isZh) {
  // 兼顧舊版導航 ID 相容
  const navClubEl = document.getElementById("t-nav-club") || document.getElementById("t-nav-history");
  if (navClubEl) navClubEl.innerText = t("navClub");

  if (typeof window.updateNavLineProfileUI === "function") {
    window.updateNavLineProfileUI();
  }

  // 大廳社團下拉第 0 項
  const hubClubSelector = document.getElementById("hub-club-selector");
  if (hubClubSelector && hubClubSelector.options.length > 0) {
    if (STATE.lineUserId) {
      hubClubSelector.options[0].text = t("clubFilterOptionAll");
    }
  }

  // 加入/退出社團按鈕
  const btnToggleMyClubEl = document.getElementById("t-btn-toggle-my-club") || document.getElementById("t-btn-remove-my-club");
  if (btnToggleMyClubEl) {
    const isMyClub = !!(STATE.lineUserId && Array.isArray(STATE.myClubs) && STATE.currentClub && STATE.myClubs.includes(STATE.currentClub));
    btnToggleMyClubEl.innerText = isMyClub ? (isZh ? "已加入" : "Joined") : (isZh ? "加入" : "Join");
  }

  // 完賽歷史展開/收合狀態文案
  const hubCompToggle = document.getElementById("hub-completed-toggle-text");
  if (hubCompToggle) {
    const isHubCompOpen = !document.getElementById("hub-completed-tournaments-wrap")?.classList.contains("hidden");
    hubCompToggle.innerText = isHubCompOpen ? t("collapseText") : t("expandText");
  }

  // 社團大廳標題（若無 currentClub 則回退預設）
  const clubHeadingTitleEl = document.getElementById("club-heading-title");
  if (clubHeadingTitleEl && !STATE.currentClub) {
    clubHeadingTitleEl.innerText = t("clubSpaceTitle");
  }

  // 切換社團下拉第 0 項
  const switcherSelect = document.getElementById("club-space-switcher-select");
  if (switcherSelect && switcherSelect.options.length > 0) {
    switcherSelect.options[0].text = t("clubSwitcherAllOption");
  }

  // 創建頁社團選單第 0 項
  const clubSelectEl = document.getElementById("create-club-select");
  if (clubSelectEl && clubSelectEl.options.length > 0 && clubSelectEl.options[0].value === "") {
    clubSelectEl.options[0].text = t("selectClubOption");
  }

  // 創建按鈕文字（判斷接龍 vs 直接開打）
  const submitBtnTextEl = document.getElementById("t-btn-submit-create-text");
  const isReg = document.getElementById("create-entry-mode")?.value === "registration";
  if (submitBtnTextEl) {
    submitBtnTextEl.innerText = isReg
      ? (isZh ? "確認" : "Confirm")
      : (isZh ? "確認並立即開打" : "Start Tournament Now");
  }

  // 清空多餘描述欄
  const stratTimeDescEl = document.getElementById("t-strategy-time-desc");
  if (stratTimeDescEl) stratTimeDescEl.innerText = "";
  const stratFullDescEl = document.getElementById("t-strategy-full-desc");
  if (stratFullDescEl) stratFullDescEl.innerText = "";

  // 選手與配局標籤連動
  const partnerType = document.getElementById("create-partner-type")?.value || "rotating";
  if (typeof window.setPartnerType === "function") {
    window.setPartnerType(partnerType);
  }

  const autoGenLabel = document.getElementById("t-auto-gen-label");
  if (autoGenLabel) {
    autoGenLabel.innerText = isZh
      ? (partnerType === "fixed" ? "自動生成隊伍代號：" : "自動生成選手代號：")
      : (partnerType === "fixed" ? "Auto-generate team codes:" : "Auto-generate player codes:");
  }

  if (typeof window.renderSelectedPlayerChips === "function") window.renderSelectedPlayerChips();
  if (typeof window.renderClubMemberChips === "function") window.renderClubMemberChips();

  // 即時比賽畫面：補入選手/隊伍
  const btnAddLivePlayer = document.getElementById("t-btn-add-live-player");
  if (btnAddLivePlayer) {
    const isTeam = STATE.tournamentData && typeof window.getTournamentIsTeamMode === "function" ? window.getTournamentIsTeamMode(STATE.tournamentData) : false;
    btnAddLivePlayer.innerText = isTeam ? (isZh ? "補入隊伍" : "Add Team") : (isZh ? "補入選手" : "Add Player");
  }

  // 管理者遙控器切換按鈕狀態
  const adminText = document.getElementById("text-toggle-live-admin");
  if (adminText) {
    const tData = STATE.tournamentData;
    const isFinished = tData && typeof window.isTournamentFinished === "function" ? window.isTournamentFinished(tData) : false;
    const isFrozen = isFinished && !STATE.isAdmin;
    if (isFrozen) {
      adminText.innerText = isZh ? "已完賽 (已凍結)" : "Completed (Frozen)";
    } else {
      const hasAdmin = tData && typeof window.isTournamentAdmin === "function" ? window.isTournamentAdmin(tData) : false;
      adminText.innerText = hasAdmin ? t("liveAdminToggleViewer") : t("liveAdminToggleAdmin");
    }
  }

  // 排名平手判定規則列表
  const list = document.getElementById("t-tiebreaker-list");
  if (list && list.children) {
    if (list.children[0]) list.children[0].innerText = t("tbRule1");
    if (list.children[1]) list.children[1].innerText = t("tbRule2");
    if (list.children[2]) list.children[2].innerText = t("tbRule3");
    if (list.children[3]) list.children[3].innerText = t("tbRule4");
  }

  // 手動加場彈窗：依 Team / Singles 切換提示文案
  const addMatchDescEl = document.getElementById("modal-add-match-desc");
  if (addMatchDescEl) {
    const isTeam = STATE.tournamentData && typeof window.getTournamentIsTeamMode === "function" ? window.getTournamentIsTeamMode(STATE.tournamentData) : false;
    const isSingles = (STATE.addMatchFormat === "singles" || STATE.tournamentData?.partnerType === "singles");
    addMatchDescEl.innerText = isTeam
      ? (isZh ? "選擇 2 隊進行對抗，或點擊自動對決" : "Select 2 teams or click auto pick")
      : (isSingles
        ? (isZh ? "選擇 2 位選手進行單打，或點擊自動配對" : "Select 2 players or click auto pick")
        : (isZh ? "選擇 4 位選手或點擊自動配對" : "Select 4 players or click auto pick"));
  }

  // 點選名冊彈窗標題
  const modalTapTitle = document.getElementById("t-modal-tap-roster-title");
  if (modalTapTitle) {
    const isTeam = STATE.tournamentData && typeof window.getTournamentIsTeamMode === "function" ? window.getTournamentIsTeamMode(STATE.tournamentData) : false;
    modalTapTitle.innerText = isTeam ? t("modalTapRosterTitleTeam") : t("modalTapRosterTitle");
  }

  // 藍隊/紅隊 (或藍方/紅方) 標題
  const blueTeamTitleEl = document.getElementById("modal-blue-team-title");
  if (blueTeamTitleEl) {
    const isTeam = STATE.tournamentData && typeof window.getTournamentIsTeamMode === "function" ? window.getTournamentIsTeamMode(STATE.tournamentData) : false;
    const isSingles = (STATE.addMatchFormat === "singles");
    blueTeamTitleEl.innerText = isTeam ? (isZh ? "藍隊" : "Blue Team") : (isSingles ? (isZh ? "藍方" : "Blue Side") : (isZh ? "藍隊" : "Blue Team"));
  }
  const redTeamTitleEl = document.getElementById("modal-red-team-title");
  if (redTeamTitleEl) {
    const isTeam = STATE.tournamentData && typeof window.getTournamentIsTeamMode === "function" ? window.getTournamentIsTeamMode(STATE.tournamentData) : false;
    const isSingles = (STATE.addMatchFormat === "singles");
    redTeamTitleEl.innerText = isTeam ? (isZh ? "紅隊" : "Red Team") : (isSingles ? (isZh ? "紅方" : "Red Side") : (isZh ? "紅隊" : "Red Team"));
  }

  // 取消/再等等按鈕
  const cancelStartTextEl = document.getElementById("btn-cancel-start-text");
  if (cancelStartTextEl) {
    cancelStartTextEl.innerText = t("btnWaitCancel") || (isZh ? "再等等 / 取消" : "Wait / Cancel");
  }

  // 戰績月份下拉選單第 0 項
  const monthSelect = document.getElementById("history-month-select");
  if (monthSelect && monthSelect.options && monthSelect.options.length > 0) {
    monthSelect.options[0].text = isZh ? "全部月份" : "All Months";
  }

  // 社團大廳當前分頁動態文字重刷
  if (STATE.currentClub) {
    if (STATE.activeClubTab === "profile" && typeof window.renderClubProfileTab === "function") {
      window.renderClubProfileTab(STATE.currentClub);
    } else if (STATE.activeClubTab === "info" && typeof window.renderClubInfoTab === "function") {
      window.renderClubInfoTab(STATE.currentClub);
    }
  }
}

// ====================================================
// 7. 核心入口：一鍵執行全站 UI 多語系套用
// ====================================================
export function applyLanguageUI() {
  const isZh = (STATE.lang === "zh-TW");

  // 1) 批次處理純字典文字 (innerText)
  for (const [id, key] of Object.entries(I18N_TEXT_KEYS)) {
    const el = document.getElementById(id);
    if (el) el.innerText = t(key);
  }

  // 2) 批次處理雙語文字 (innerText)
  for (const [id, [zh, en]] of Object.entries(I18N_CUSTOM_TEXTS)) {
    const el = document.getElementById(id);
    if (el) el.innerText = isZh ? zh : en;
  }

  // 3) 批次處理 Placeholder
  for (const [id, val] of Object.entries(I18N_PLACEHOLDERS)) {
    const el = document.getElementById(id);
    if (el) el.placeholder = Array.isArray(val) ? (isZh ? val[0] : val[1]) : t(val);
  }

  // 4) 批次處理 Title 提示文字
  for (const [id, key] of Object.entries(I18N_TITLES)) {
    const el = document.getElementById(id);
    if (el) el.title = t(key);
  }

  // 5) 批次處理帶圖示的 HTML
  for (const [id, renderFn] of Object.entries(I18N_HTML)) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = renderFn(isZh);
  }

  // 6) 執行動態/條件式更新
  applyDynamicLanguageUI(isZh);

  // 7) 觸發關聯試算與圖示渲染
  if (typeof window.updatePlayerCountBadge === "function") window.updatePlayerCountBadge();
  if (typeof window.calculateTimeEstimate === "function") window.calculateTimeEstimate();
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

// 掛載至全域
if (typeof window !== "undefined") {
  window.applyLanguageUI = applyLanguageUI;
}
