// ============================================================
// ZEROZEROTWO CLUB SPACE & MEMBERSHIP MODULE (club.js)
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
import { escapeHTML, escapeJsAttr, safeSetLocal, safeGetLocalJSON, sha256 } from "./utils.js?v=20261024-12";
import {
  STATE,
  FUNCTIONS_BASE_URL,
  t,
  showToast,
  navigateTo,
  renderLiveUI,
  renderHistoryPage,
  renderHubTournaments,
  displayHubTournamentsList,
  enterTournament,
  deleteTournament,
  openLineLoginPromptModal,
  addUserClubToFirebase,
  populateCreateClubSelect
} from "./globals.js?v=20261024-12";

const isTransientPlayer = (name) => {
  if (typeof window !== "undefined" && typeof window.isTransientPlayer === "function") {
    return window.isTransientPlayer(name);
  }
  if (!name || typeof name !== "string") return false;
  return /^(臨打|臨時|補位|選手|隊伍|Guest|Player|Team)(\s*[-_#]?[0-9A-Za-z]+)?$/i.test(name.trim());
};

    export function getClubMembersList(clubName) {
      if (!clubName || !clubName.trim()) {
        return [];
      }
      const key = clubName.trim();
      const local = JSON.parse(localStorage.getItem("pb_club_members") || "{}");
      let members = local[key] ? [...local[key]] : [];

      const cache = (window.STATE && window.STATE.allTournamentsCache) || [];
      cache.forEach(t => {
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
    window.getClubMembersList = getClubMembersList;

    export function saveClubMembersList(clubName, members) {
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

      if (window.STATE && window.STATE.db && clubName) {
        try {
          set(ref(window.STATE.db, `club_members/${encodeClubKey(clubName)}`), sanitized);
        } catch (e) {
          console.error("Firebase save club members error:", e);
        }
      }
    }
    window.saveClubMembersList = saveClubMembersList;

    function decodeClubKey(safeKey) {
      if (!safeKey) return "";
      try {
        return decodeURIComponent(safeKey.replace(/%2E/gi, "."));
      } catch (e) {
        return safeKey;
      }
    }
    window.decodeClubKey = decodeClubKey;

    function getAllUniqueClubs() {
      const clubsSet = new Set();

      // 1. 記憶體中目前的賽事快取
      if (Array.isArray(STATE.allTournamentsCache)) {
        STATE.allTournamentsCache.forEach(t => {
          if (t && t.clubName && t.clubName.trim()) clubsSet.add(t.clubName.trim());
        });
      }

      // 2. 本地賽事快取 (localStorage pb_tournaments)
      try {
        const localData = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
        Object.values(localData).forEach(t => {
          if (t && t.clubName && t.clubName.trim()) clubsSet.add(t.clubName.trim());
        });
      } catch (e) { }

      // 3. 成員名冊庫 (localStorage pb_club_members) - 保障有成員但暫無賽事的社團
      try {
        const localMembers = JSON.parse(localStorage.getItem("pb_club_members") || "{}");
        Object.keys(localMembers).forEach(k => {
          if (k && k !== "__general__" && k.trim()) clubsSet.add(k.trim());
        });
      } catch (e) { }

      // 4. 本地密碼庫 (localStorage pb_club_passwords)
      try {
        const localPwds = JSON.parse(localStorage.getItem("pb_club_passwords") || "{}");
        Object.keys(localPwds).forEach(k => {
          if (k && k.trim()) clubsSet.add(k.trim());
        });
      } catch (e) { }

      // 5. 雲端密碼映射表 (Firebase club_passwords)
      if (STATE.clubPasswordsMap && typeof STATE.clubPasswordsMap === "object") {
        Object.keys(STATE.clubPasswordsMap).forEach(safeKey => {
          const decoded = decodeClubKey(safeKey);
          if (decoded && decoded !== "__general__" && decoded.trim()) {
            clubsSet.add(decoded.trim());
          }
        });
      }

      // 6. 社團中繼資料庫 (clubs_metadata - 包含所有公開與私密社團)
      try {
        const localMeta = JSON.parse(localStorage.getItem("pb_clubs_metadata") || "{}");
        Object.keys(localMeta).forEach(k => {
          const d = decodeClubKey(k);
          if (d && d !== "__general__" && d.trim()) clubsSet.add(d.trim());
        });
      } catch (e) { }
      if (STATE.clubsMetadataMap && typeof STATE.clubsMetadataMap === "object") {
        Object.keys(STATE.clubsMetadataMap).forEach(k => {
          const d = decodeClubKey(k);
          if (d && d !== "__general__" && d.trim()) clubsSet.add(d.trim());
        });
      }

      // 7. 當前選定或記錄的社團（僅當已證實有效時才保留，不盲目注入已刪除殘留）
      if (STATE.currentClub && STATE.currentClub.trim()) {
        clubsSet.add(STATE.currentClub.trim());
      }

      // 過濾空值與保留字
      clubsSet.delete("");
      clubsSet.delete("__general__");

      // 8. 幽靈社團自動自檢清理 (Garbage Collection)
      // 若社團既無賽事、無成員、無密碼、無Metadata中繼資料，且不在使用者現行myClubs中，即為殘留髒資料
      const validClubsSet = new Set();
      const localMembersCheck = safeGetLocalJSON("pb_club_members", {});
      const localMetaCheck = safeGetLocalJSON("pb_clubs_metadata", {});
      const userMyClubsList = (Array.isArray(STATE.myClubs) ? STATE.myClubs : []).map(c => (c || "").trim());

      clubsSet.forEach(c => {
        const safeKey = typeof encodeClubKey === "function" ? encodeClubKey(c) : encodeURIComponent(c);
        const hasTournaments = Array.isArray(STATE.allTournamentsCache) && STATE.allTournamentsCache.some(t => t && t.clubName === c);
        const hasMembers = (localMembersCheck[c] && localMembersCheck[c].length > 0) || (localMembersCheck[safeKey] && localMembersCheck[safeKey].length > 0);
        const hasPwd = typeof hasClubPassword === "function" ? hasClubPassword(c) : false;
        const hasMeta = !!(localMetaCheck[c] || localMetaCheck[safeKey] || (STATE.clubsMetadataMap && STATE.clubsMetadataMap[safeKey]));
        const isMy = userMyClubsList.includes(c) || STATE.currentClub === c;

        if (hasTournaments || hasMembers || hasPwd || hasMeta || isMy) {
          validClubsSet.add(c);
        } else {
          // 清理本地已刪除幽靈社團的殘留快取
          try {
            if (localStorage.getItem("pb_last_club") === c) localStorage.removeItem("pb_last_club");
          } catch (e) { }
        }
      });

      // 隱私過濾：私密社團若不在使用者的 myClubs 且非當前正在造訪的社團，則排除
      const currentActive = (STATE.currentClub || "").trim();

      const filteredClubs = Array.from(validClubsSet).filter(c => {
        if (!c) return false;
        // 最高權限管理者可以看到全站所有社團（包含私密社團）
        if (STATE.isAdmin) return true;
        if (typeof isClubPrivate === "function" && isClubPrivate(c)) {
          return userMyClubsList.includes(c) || currentActive === c;
        }
        return true;
      });

      return filteredClubs.sort((a, b) => a.localeCompare(b, "zh-Hant"));
    }
    window.getAllUniqueClubs = getAllUniqueClubs;

    function populateNavClubSelect(clubs) {
      const navSelect = document.getElementById("hub-club-selector") || document.getElementById("nav-btn-history");
      if (!navSelect) return;

      const set = new Set(getAllUniqueClubs());
      if (Array.isArray(clubs)) {
        clubs.forEach(c => {
          if (c && c !== "__general__" && c.trim()) set.add(c.trim());
        });
      }
      const uniqueClubs = Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hant"));
      const isZh = STATE.lang === "zh-TW";
      const defaultLabel = isZh ? "臨打活動" : "Drop-in Games";
      const activitiesLabel = isZh ? "社團活動" : "Club Activities";
      const exploreOptionLabel = isZh ? "探索/建立新社團" : "Explore / Create Club";

      const isLoggedIn = !!STATE.lineUserId;
      let html = "";

      if (isLoggedIn) {
        // 會員視角：第一項「我的活動」（比賽中/已報名、開放接龍、近期完賽合併在同一頁）
        const isActivitiesSelected = (!STATE.currentClub && STATE.currentPage === 'activities');
        html += `<option value="activities" ${isActivitiesSelected ? 'selected' : ''}>${activitiesLabel}</option>`;
        html += `<option value="hub" ${(!STATE.currentClub && STATE.currentPage === 'hub') ? 'selected' : ''}>${defaultLabel}</option>`;

        const userMyClubs = (Array.isArray(STATE.myClubs) ? STATE.myClubs : [])
          .filter(c => c && c.trim())
          .map(c => c.trim());
        const myClubsList = uniqueClubs.filter(c => userMyClubs.includes(c));

        // 若當前正處於某社團，但使用者尚未將其加入「我的社團」
        if (STATE.currentClub && !userMyClubs.includes(STATE.currentClub)) {
          const safeCurrent = escapeHTML(STATE.currentClub);
          html += `<option value="${safeCurrent}" selected>${safeCurrent} (${isZh ? "瀏覽中" : "Visiting"})</option>`;
        }

        // 區塊一：我的社團 (無圖案純文字標籤)
        if (myClubsList.length > 0) {
          const groupLabel = isZh ? "我的社團" : "My Clubs";
          html += `<optgroup label="${groupLabel}">`;
          myClubsList.forEach(c => {
            html += `<option value="${escapeHTML(c)}" ${(STATE.currentClub === c && STATE.currentPage !== 'activities') ? 'selected' : ''}>${escapeHTML(c)}</option>`;
          });
          html += `</optgroup>`;
        }
      } else {
        // 訪客視角 (未登入 LINE)：下拉選單僅保留「賽事大廳」以及訪客瀏覽中的社團
        html += `<option value="activities" ${(!STATE.currentClub && STATE.currentPage === 'activities') ? 'selected' : ''}>${activitiesLabel}</option>`;
        html += `<option value="hub" ${(!STATE.currentClub && STATE.currentPage === 'hub') ? 'selected' : ''}>${defaultLabel}</option>`;

        if (STATE.currentClub) {
          const safeCurrent = escapeHTML(STATE.currentClub);
          html += `<option value="${safeCurrent}" selected>${escapeHTML(STATE.currentClub)} (${isZh ? "訪客瀏覽" : "Visiting"})</option>`;
        }
      }

      html += `<option value="__explore_clubs__">${exploreOptionLabel}</option>`;

      navSelect.innerHTML = html;
      updateNavClubSelectValue();
    }
    window.populateNavClubSelect = populateNavClubSelect;

    async function toggleAddCurrentClub() {
      const current = STATE.currentClub;
      if (!current) return;
      if (!STATE.lineUserId) {
        openLineLoginPromptModal();
        return;
      }
      await addUserClubToFirebase(current);
      updateNavClubSelectValue();
      populateNavClubSelect();
      if (typeof populateCreateClubSelect === "function") populateCreateClubSelect();
    }
    window.toggleAddCurrentClub = toggleAddCurrentClub;

    async function toggleCurrentClubStatus() {
      const current = STATE.currentClub;
      if (!current) return;
      const isMyClub = !!(
        STATE.lineUserId &&
        Array.isArray(STATE.myClubs) &&
        STATE.myClubs.includes(current)
      );
      if (isMyClub) {
        await removeMyClub();
      } else {
        await toggleAddCurrentClub();
      }
    }
    window.toggleCurrentClubStatus = toggleCurrentClubStatus;

    function updateNavClubSelectValue() {
      const navSelect = document.getElementById("hub-club-selector") || document.getElementById("nav-btn-history");
      const shareBtn = document.getElementById("btn-share-club");
      const toggleBtn = document.getElementById("btn-toggle-my-club") || document.getElementById("btn-remove-my-club");
      const idBtn = document.getElementById("btn-club-identity");

      if (STATE.currentPage === "activities" || STATE.currentPage === "waiting" || (STATE.currentPage === "hub" && !STATE.currentClub)) {
        if (navSelect) {
          navSelect.value = (STATE.currentPage === "hub") ? "hub" : "activities";
        }
        if (shareBtn) shareBtn.classList.add("hidden");
        if (toggleBtn) toggleBtn.classList.add("hidden");
        if (idBtn) idBtn.classList.add("hidden");
        return;
      }

      if (STATE.currentPage === "history" && STATE.currentClub) {
        if (navSelect) navSelect.value = STATE.currentClub;
        if (shareBtn) shareBtn.classList.add("hidden"); // 已移入社團說明分頁
        if (idBtn) idBtn.classList.add("hidden"); // 已移入個人資訊分頁

        const isMyClub = !!(
          STATE.lineUserId &&
          Array.isArray(STATE.myClubs) &&
          STATE.myClubs.includes(STATE.currentClub)
        );
        if (toggleBtn) {
          toggleBtn.classList.remove("hidden");
          const isZh = STATE.lang === "zh-TW";
          if (isMyClub) {
            // 已經加入時：低調邊框按鈕（card-inner border text-stone-500），文字「已加入」（Hover 時顯示「退出」）
            toggleBtn.onclick = removeMyClub;
            toggleBtn.className = "px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl card-inner border border-stone-200 dark:border-slate-800 text-stone-500 hover:text-rose-500 hover:border-rose-400 dark:hover:border-rose-500/50 text-xs font-semibold transition flex items-center justify-center gap-1 shadow-sm active:scale-95 shrink-0 cursor-pointer";
            toggleBtn.title = isZh ? "點擊退出社團" : "Click to leave club";
            toggleBtn.innerHTML = `<span id="t-btn-toggle-my-club">${isZh ? "已加入" : "Joined"}</span>`;
            toggleBtn.onmouseenter = () => {
              const textSpan = toggleBtn.querySelector("#t-btn-toggle-my-club") || toggleBtn;
              textSpan.innerText = isZh ? "退出" : "Leave";
            };
            toggleBtn.onmouseleave = () => {
              const textSpan = toggleBtn.querySelector("#t-btn-toggle-my-club") || toggleBtn;
              textSpan.innerText = isZh ? "已加入" : "Joined";
            };
          } else {
            // 尚未加入時：明顯主按鈕（bg-emerald-500 text-white），文字「加入」
            toggleBtn.onclick = toggleAddCurrentClub;
            toggleBtn.className = "px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition flex items-center justify-center gap-1 shadow-sm active:scale-95 shrink-0 cursor-pointer";
            toggleBtn.title = isZh ? "加入專屬社團" : "Join Club";
            toggleBtn.innerHTML = `<span id="t-btn-toggle-my-club">${isZh ? "加入" : "Join"}</span>`;
            toggleBtn.onmouseenter = null;
            toggleBtn.onmouseleave = null;
          }
          lucide.createIcons();
        }

        if (typeof updateClubIdentityBadge === "function") {
          updateClubIdentityBadge(STATE.currentClub);
        }
      } else {
        if (navSelect) navSelect.value = "";
        if (shareBtn) shareBtn.classList.add("hidden");
        if (toggleBtn) toggleBtn.classList.add("hidden");
        if (idBtn) idBtn.classList.add("hidden");
      }
    }
    window.updateNavClubSelectValue = updateNavClubSelectValue;

    async function removeMyClub() {
      const clubToRemove = STATE.currentClub;
      if (!clubToRemove) return;

      const isZh = STATE.lang === "zh-TW";
      const isMyClub = !!(STATE.lineUserId && Array.isArray(STATE.myClubs) && STATE.myClubs.includes(clubToRemove));

      if (isMyClub) {
        const confirmMsg = isZh
          ? `確定要退出「${clubToRemove}」嗎？\n\n（將解除您在此社團的球員身分綁定，但不會刪除任何歷史戰績）`
          : `Are you sure you want to leave "${clubToRemove}"?\n\n(Your player identity will be unbound. Match records are kept.)`;

        if (!confirm(confirmMsg)) {
          return;
        }

        const safeClub = typeof encodeClubKey === "function" ? encodeClubKey(clubToRemove) : encodeURIComponent(clubToRemove.trim()).replace(/\./g, "%2E");

        // 1. Firebase 雲端更新：解除專屬社團
        if (STATE.db && STATE.lineUserId) {
          try {
            const updates = {};
            updates[`users/${STATE.lineUserId}/myClubs/${encodeURIComponent(clubToRemove)}`] = null;
            await update(ref(STATE.db), updates);
          } catch (err) {
            console.warn("[Firebase] removeMyClub error:", err);
          }
        }

        // 2. 徹底執行【準則三：解除綁定與零紀錄自動抹除】
        const currentBound = localStorage.getItem(`pb_bound_name_${clubToRemove}`) || STATE.clubPlayerName;
        if (typeof unbindClubIdentity === "function") {
          await unbindClubIdentity(clubToRemove, currentBound, STATE.lineUserId);
        } else {
          localStorage.removeItem(`pb_bound_name_${clubToRemove}`);
          if (STATE.currentClub === clubToRemove) {
            STATE.clubPlayerName = null;
          }
        }

        // 3. 前端狀態同步
        STATE.myClubs = (STATE.myClubs || []).filter(c => c !== clubToRemove);
        try {
          if (STATE.lineUserId) {
            localStorage.setItem(`pb_my_clubs_${STATE.lineUserId}`, JSON.stringify(STATE.myClubs));
          }
        } catch (e) { }
      }

      try {
        localStorage.removeItem("pb_last_club");
      } catch (e) { }

      STATE.currentClub = null;
      STATE.createContextClub = null;

      // 3. 重新渲染頂部導覽列下拉選單
      if (typeof populateNavClubSelect === "function") {
        populateNavClubSelect();
      }

      // 4. 返回默認首頁（登入返回我的活動總表，未登入返回賽事大廳）
      navigateTo(STATE.lineUserId ? "activities" : "hub");
    }
    window.removeMyClub = removeMyClub;

    function handleSharedCreateTournament() {
      if (STATE.currentPage === "history" && STATE.currentClub) {
        STATE.createContextClub = STATE.currentClub;
      } else {
        STATE.createContextClub = null;
      }
      navigateTo("create");
    }
    window.handleSharedCreateTournament = handleSharedCreateTournament;

    async function onNavClubSelectChange(clubName) {
      if (clubName === "activities") {
        STATE.currentClub = null;
        STATE.createContextClub = null;
        if (STATE.currentPage !== "activities") {
          navigateTo("activities");
        }
        updateNavClubSelectValue();
        return;
      }
      if (clubName === "hub") {
        STATE.currentClub = null;
        STATE.createContextClub = null;
        if (STATE.currentPage !== "hub") {
          navigateTo("hub");
        }
        updateNavClubSelectValue();
        return;
      }
      if (clubName === "waiting") {
        STATE.currentClub = null;
        STATE.createContextClub = null;
        if (STATE.currentPage !== "waiting") {
          navigateTo("waiting");
        }
        updateNavClubSelectValue();
        return;
      }
      if (!clubName || clubName === "" || clubName === "__club_activities__") {
        STATE.currentClub = null;
        STATE.createContextClub = null;
        const targetPage = STATE.lineUserId ? "activities" : "hub";
        if (STATE.currentPage !== targetPage) {
          navigateTo(targetPage);
        }
        updateNavClubSelectValue();
        return;
      }
      if (clubName === "__explore_clubs__") {
        updateNavClubSelectValue();
        openExploreClubsModal();
        return;
      }
      if (clubName === "__create_new_club__") {
        updateNavClubSelectValue();
        openCreateClubModal();
        return;
      }
      await openClubSpace(clubName);
    }
    window.onNavClubSelectChange = onNavClubSelectChange;

    function openExploreClubsModal() {
      const modal = document.getElementById("modal-explore-clubs");
      if (!modal) return;
      const searchInput = document.getElementById("modal-explore-clubs-search");
      if (searchInput) searchInput.value = "";
      if (typeof applyLanguageUI === "function") applyLanguageUI();
      renderExploreClubsList("");
      modal.classList.remove("hidden");
      if (searchInput) setTimeout(() => searchInput.focus(), 60);
      lucide.createIcons();
    }
    window.openExploreClubsModal = openExploreClubsModal;

    function closeExploreClubsModal() {
      const modal = document.getElementById("modal-explore-clubs");
      if (modal) modal.classList.add("hidden");
    }
    window.closeExploreClubsModal = closeExploreClubsModal;

    function filterExploreClubsList(keyword) {
      renderExploreClubsList(keyword);
    }
    window.filterExploreClubsList = filterExploreClubsList;

    function hasClubPassword(c) {
      if (!c || !c.trim()) return false;
      const clean = c.trim();
      const safeKey = typeof encodeClubKey === "function" ? encodeClubKey(clean) : encodeURIComponent(clean);
      if (STATE.clubsMetadataMap) {
        if (STATE.clubsMetadataMap[safeKey] && typeof STATE.clubsMetadataMap[safeKey].hasPassword === "boolean") {
          return STATE.clubsMetadataMap[safeKey].hasPassword;
        }
        if (STATE.clubsMetadataMap[clean] && typeof STATE.clubsMetadataMap[clean].hasPassword === "boolean") {
          return STATE.clubsMetadataMap[clean].hasPassword;
        }
      }
      try {
        const localMeta = JSON.parse(localStorage.getItem("pb_clubs_metadata") || "{}");
        if (localMeta[safeKey] && typeof localMeta[safeKey].hasPassword === "boolean") return localMeta[safeKey].hasPassword;
        if (localMeta[clean] && typeof localMeta[clean].hasPassword === "boolean") return localMeta[clean].hasPassword;
      } catch (e) {}
      try {
        const localPwds = JSON.parse(localStorage.getItem("pb_club_passwords") || "{}");
        if (localPwds[safeKey] || localPwds[clean]) return true;
      } catch (e) {}
      return false;
    }
    window.hasClubPassword = hasClubPassword;
    window.hasPassword = hasClubPassword;

    function renderExploreClubsList(keyword = "") {
      const listContainer = document.getElementById("modal-explore-clubs-list");
      if (!listContainer) return;

      const isZh = STATE.lang === "zh-TW";
      const q = (keyword || "").trim().toLowerCase();

      const uniqueClubs = typeof getAllUniqueClubs === "function" ? getAllUniqueClubs() : [];
      const userMyClubs = (Array.isArray(STATE.myClubs) ? STATE.myClubs : [])
        .filter(c => c && c.trim())
        .map(c => c.trim());

      // 篩選社團：非 Admin 且設定為私密者，僅自己已加入的社團可見；公開社團皆可探索
      let clubs = uniqueClubs.filter(c => {
        if (!c) return false;
        if (STATE.isAdmin) return true;
        const isPriv = typeof isClubPrivate === "function" && isClubPrivate(c);
        if (isPriv) return userMyClubs.includes(c);
        return true;
      });

      // 支援即時搜尋：有輸入關鍵字時依名稱篩選，無輸入時展示全部可探索社團
      if (q) {
        clubs = clubs.filter(c => c.toLowerCase().includes(q));
      }

      if (clubs.length === 0) {
        const queryDisplay = escapeHTML(keyword.trim());
        listContainer.innerHTML = `
          <div class="py-8 text-center space-y-1.5">
            <i data-lucide="search-x" class="w-7 h-7 mx-auto text-stone-400 dark:text-stone-500 opacity-60"></i>
            <p class="text-xs sub-text">${q ? (isZh ? `查無符合「${queryDisplay}」的公開社團` : `No clubs matching "${queryDisplay}"`) : (isZh ? "目前尚無可探索的社團" : "No clubs available")}</p>
          </div>
        `;
        lucide.createIcons();
        return;
      }

      let html = "";
      clubs.forEach(c => {
        const hasPwd = hasClubPassword(c);
        const isPriv = typeof isClubPrivate === "function" && isClubPrivate(c);
        const isMyClub = userMyClubs.includes(c);
        const members = typeof getClubMembersList === "function" ? getClubMembersList(c) : [];
        const memberCount = members.length;
        const escaped = typeof safeEscape === "function" ? safeEscape(c) : c.replace(/'/g, "\\'");

        html += `
          <div onclick="selectExploredClub('${escaped}')"
            class="p-3 rounded-xl card-inner border hover:border-teal-500/50 hover:bg-teal-500/5 transition flex items-center justify-between gap-2 cursor-pointer active:scale-98 shadow-sm group">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-8 h-8 rounded-lg ${isPriv ? 'bg-amber-500/10 text-amber-500' : (hasPwd ? 'bg-blue-500/10 text-blue-500' : 'bg-teal-500/10 text-teal-600 dark:text-teal-400')} flex items-center justify-center shrink-0">
                <i data-lucide="${isPriv ? 'lock' : (hasPwd ? 'key-round' : 'shield')}" class="w-4 h-4"></i>
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="text-xs sm:text-sm font-bold truncate group-hover:text-teal-600 dark:group-hover:text-teal-400 transition">${escapeHTML(c)}</span>
                  ${isMyClub ? `<span class="text-[10px] px-1.5 py-0.2 rounded font-bold bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 shrink-0">${isZh ? '我的社團' : 'Joined'}</span>` : ''}
                  ${isPriv ? `<span class="text-[10px] px-1 py-0.2 rounded font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0">${isZh ? '私密' : 'Private'}</span>` : ''}
                </div>
                <div class="flex items-center gap-2 text-[10px] sub-text mt-0.5">
                  <span>👥 ${memberCount} ${isZh ? '成員' : 'members'}</span>
                  <span>•</span>
                  <span>${hasPwd ? (isZh ? '🔒 需密碼' : '🔒 Password') : (isZh ? '公開' : 'Public')}</span>
                </div>
              </div>
            </div>
            <div class="shrink-0 flex items-center gap-1 text-xs font-semibold text-teal-600 dark:text-teal-400 group-hover:translate-x-0.5 transition">
              <span>${isZh ? '進入' : 'Enter'}</span>
              <i data-lucide="chevron-right" class="w-4 h-4"></i>
            </div>
          </div>
        `;
      });

      listContainer.innerHTML = html;
      lucide.createIcons();
    }
    window.renderExploreClubsList = renderExploreClubsList;

    async function selectExploredClub(clubName) {
      closeExploreClubsModal();
      if (!clubName) return;
      await openClubSpace(clubName);
    }
    window.selectExploredClub = selectExploredClub;

    function openCreateClubModal() {
      STATE.modalClubMode = "create";
      const modal = document.getElementById("modal-create-club");
      if (!modal) return;
      const titleEl = document.getElementById("t-modal-create-club-title");
      const descEl = document.getElementById("t-modal-create-club-desc");
      const nameInput = document.getElementById("modal-create-club-name");
      const pwdInput = document.getElementById("modal-create-club-pwd");
      const descInput = document.getElementById("modal-create-club-desc-input");
      const submitTextEl = document.getElementById("t-btn-submit-create-club-text");
      const isZh = (STATE.lang === "zh-TW");

      if (titleEl) titleEl.innerText = isZh ? "建立新社團" : "Create Club";
      if (descEl) descEl.innerText = isZh ? "建立專屬社團大廳與歷次戰績存檔" : "Create club space & record matches";
      if (nameInput) {
        nameInput.value = "";
        nameInput.disabled = false;
        nameInput.className = "w-full input-bg border rounded-xl p-2.5 text-xs sm:text-sm focus:border-emerald-500 focus:outline-none";
      }
      if (pwdInput) {
        pwdInput.value = "";
        pwdInput.placeholder = isZh ? "設定密碼（選填，保護社團資訊修改權限）" : "Set password (optional, protects club info)";
      }
      if (descInput) {
        descInput.value = "";
        descInput.placeholder = isZh ? "上限200字" : "Max 200 characters";
      }
      if (submitTextEl) submitTextEl.innerText = isZh ? "確認建立" : "Create";
      const submitIconEl = document.getElementById("modal-create-club-submit-icon");
      if (submitIconEl) submitIconEl.setAttribute("data-lucide", "plus");

      setModalClubPrivacy(false);
      modal.classList.remove("hidden");
      if (nameInput) setTimeout(() => nameInput.focus(), 60);
      lucide.createIcons();
    }
    window.openCreateClubModal = openCreateClubModal;

    async function openEditClubModal(clubName) {
      const targetClub = clubName || STATE.currentClub;
      if (!targetClub) return;

      STATE.modalClubMode = "edit";
      const modal = document.getElementById("modal-create-club");
      if (!modal) return;

      const titleEl = document.getElementById("t-modal-create-club-title");
      const descEl = document.getElementById("t-modal-create-club-desc");
      const nameInput = document.getElementById("modal-create-club-name");
      const pwdInput = document.getElementById("modal-create-club-pwd");
      const descInput = document.getElementById("modal-create-club-desc-input");
      const submitTextEl = document.getElementById("t-btn-submit-create-club-text");
      const isZh = (STATE.lang === "zh-TW");

      const safeKey = encodeClubKey(targetClub);
      let meta = (STATE.clubsMetadataMap && (STATE.clubsMetadataMap[safeKey] || STATE.clubsMetadataMap[targetClub]))
        || (JSON.parse(localStorage.getItem("pb_clubs_metadata") || "{}")[safeKey])
        || (JSON.parse(localStorage.getItem("pb_clubs_metadata") || "{}")[targetClub]);

      if (!meta && STATE.db) {
        try {
          const snap = await get(ref(STATE.db, `clubs_metadata/${safeKey}`));
          if (snap.exists()) {
            meta = snap.val();
            if (!STATE.clubsMetadataMap) STATE.clubsMetadataMap = {};
            STATE.clubsMetadataMap[safeKey] = meta;
            STATE.clubsMetadataMap[targetClub] = meta;
          }
        } catch (e) {
          console.warn("[Club Info] fetch metadata error:", e);
        }
      }

      if (titleEl) titleEl.innerText = isZh ? "修改社團資訊" : "Edit Club Info";
      if (descEl) descEl.innerText = isZh ? "更新社團簡介、公開隱私與防護密碼" : "Update description, privacy and password";
      if (nameInput) {
        nameInput.value = targetClub;
        nameInput.disabled = true;
        nameInput.className = "w-full input-bg border rounded-xl p-2.5 text-xs sm:text-sm opacity-70 cursor-not-allowed bg-stone-100 dark:bg-stone-900";
      }
      if (descInput) {
        descInput.value = (meta && meta.description) ? meta.description : "";
        descInput.placeholder = isZh ? "上限200字" : "Max 200 characters";
      }
      if (pwdInput) {
        pwdInput.value = "";
        pwdInput.placeholder = isZh ? "若不修改密碼請留白" : "Leave blank to keep current password";
      }
      if (submitTextEl) {
        submitTextEl.innerText = isZh ? "儲存修改" : "Save Changes";
      }
      const editSubmitIconEl = document.getElementById("modal-create-club-submit-icon");
      if (editSubmitIconEl) editSubmitIconEl.setAttribute("data-lucide", "check");

      const isPriv = !!(meta && meta.isPrivate);
      setModalClubPrivacy(isPriv);

      modal.classList.remove("hidden");
      if (descInput) setTimeout(() => descInput.focus(), 60);
      lucide.createIcons();
    }
    window.openEditClubModal = openEditClubModal;

    async function handleEditClubInfoClick() {
      const clubName = STATE.currentClub;
      if (!clubName) return;
      // 檢查密碼授權 (特權操作：強制要求驗證密碼)
      if (typeof verifyClubAccess === "function") {
        const ok = await verifyClubAccess(clubName, true);
        if (!ok) return;
      }
      await openEditClubModal(clubName);
    }
    window.handleEditClubInfoClick = handleEditClubInfoClick;

    function closeCreateClubModal() {
      const modal = document.getElementById("modal-create-club");
      if (!modal) return;
      modal.classList.add("hidden");
    }
    window.closeCreateClubModal = closeCreateClubModal;

    function setModalClubPrivacy(isPrivate) {
      const hiddenInput = document.getElementById("modal-club-is-private");
      const btnPublic = document.getElementById("modal-club-btn-public");
      const btnPrivate = document.getElementById("modal-club-btn-private");
      if (hiddenInput) hiddenInput.value = isPrivate ? "true" : "false";

      if (btnPublic && btnPrivate) {
        if (!isPrivate) {
          btnPublic.className = "p-2.5 rounded-xl border-2 border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-xs flex flex-col items-center justify-center gap-1 transition cursor-pointer active:scale-95 shadow-sm";
          btnPrivate.className = "p-2.5 rounded-xl border border-stone-200 dark:border-slate-800 card-inner sub-text font-semibold text-xs flex flex-col items-center justify-center gap-1 transition cursor-pointer active:scale-95 hover:border-stone-400";
        } else {
          btnPrivate.className = "p-2.5 rounded-xl border-2 border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold text-xs flex flex-col items-center justify-center gap-1 transition cursor-pointer active:scale-95 shadow-sm";
          btnPublic.className = "p-2.5 rounded-xl border border-stone-200 dark:border-slate-800 card-inner sub-text font-semibold text-xs flex flex-col items-center justify-center gap-1 transition cursor-pointer active:scale-95 hover:border-stone-400";
        }
      }
    }
    window.setModalClubPrivacy = setModalClubPrivacy;

    function isClubPrivate(clubName) {
      if (!clubName || !clubName.trim()) return false;
      const safeKey = encodeClubKey(clubName);
      const localMeta = JSON.parse(localStorage.getItem("pb_clubs_metadata") || "{}");
      if (STATE.clubsMetadataMap && STATE.clubsMetadataMap[safeKey]) {
        return !!STATE.clubsMetadataMap[safeKey].isPrivate;
      }
      if (localMeta[clubName] && localMeta[clubName].isPrivate !== undefined) {
        return !!localMeta[clubName].isPrivate;
      }
      if (localMeta[safeKey] && localMeta[safeKey].isPrivate !== undefined) {
        return !!localMeta[safeKey].isPrivate;
      }
      return false;
    }
    window.isClubPrivate = isClubPrivate;

    async function handleModalCreateClubSubmit(e) {
      if (e) e.preventDefault();
      const isZh = STATE.lang === "zh-TW";
      const nameInput = document.getElementById("modal-create-club-name");
      const pwdInput = document.getElementById("modal-create-club-pwd");
      const descInput = document.getElementById("modal-create-club-desc-input");
      const pwd = pwdInput ? pwdInput.value.trim() : "";
      const description = descInput ? descInput.value.trim() : "";
      const isPrivate = document.getElementById("modal-club-is-private")?.value === "true";

      // ==================== MODE: EDIT EXISTING CLUB ====================
      if (STATE.modalClubMode === "edit") {
        const clubName = STATE.currentClub;
        if (!clubName) return;

        const safeKey = encodeClubKey(clubName);
        const localMeta = JSON.parse(localStorage.getItem("pb_clubs_metadata") || "{}");
        const existingMeta = (STATE.clubsMetadataMap && (STATE.clubsMetadataMap[safeKey] || STATE.clubsMetadataMap[clubName]))
          || localMeta[safeKey] || localMeta[clubName] || {};

        // 1. 若有輸入新密碼，更新密碼
        let hasPassword = (existingMeta && typeof existingMeta.hasPassword === "boolean")
          ? existingMeta.hasPassword
          : (typeof hasClubPassword === "function" ? hasClubPassword(clubName) : false);
        if (pwd) {
          if (!(await setClubPasswordDB(clubName, pwd))) return;
          hasPassword = true;
          STATE.authenticatedClubs.add(clubName);
        }

        // 2. 儲存更新後的 metadata
        const metaObj = {
          ...existingMeta,
          isPrivate: isPrivate,
          hasPassword: hasPassword,
          description: description,
          updatedAt: Date.now()
        };

        if (STATE.db) {
          try {
            await set(ref(STATE.db, `clubs_metadata/${safeKey}`), metaObj);
          } catch (err) {
            console.warn("[Firebase] clubs_metadata update error:", err);
          }
        }

        if (!STATE.clubsMetadataMap) STATE.clubsMetadataMap = {};
        STATE.clubsMetadataMap[safeKey] = metaObj;
        STATE.clubsMetadataMap[clubName] = metaObj;

        localMeta[safeKey] = metaObj;
        localMeta[clubName] = metaObj;
        safeSetLocal("pb_clubs_metadata", JSON.stringify(localMeta));

        closeCreateClubModal();

        // 3. 重新渲染說明頁與社團大廳
        if (typeof renderClubInfoTab === "function") {
          renderClubInfoTab(clubName);
        }
        if (typeof renderHistoryCategorized === "function") {
          renderHistoryCategorized(STATE.allTournamentsCache || []);
        }
        return;
      }

      // ==================== MODE: CREATE NEW CLUB ====================
      const rawName = nameInput ? nameInput.value.trim() : "";
      if (!rawName) {
        showToast(isZh ? "請輸入社團名稱！" : "Please enter a club name!", "warning");
        if (nameInput) nameInput.focus();
        return;
      }

      if (rawName.length > 12) {
        showToast(isZh ? "社團名稱不可超過 12 個字！" : "Club name cannot exceed 12 characters!", "warning");
        if (nameInput) nameInput.focus();
        return;
      }

      if (rawName === "__general__" || rawName === "__create_new_club__" || rawName === "__new__") {
        showToast(isZh ? "此名稱為系統保留字，請使用其他名稱！" : "This name is reserved, please choose another!", "error");
        return;
      }

      const existingClubs = getAllUniqueClubs();
      const matched = existingClubs.find(c => c.toLowerCase() === rawName.toLowerCase());

      if (matched) {
        closeCreateClubModal();
        await openClubSpace(matched);
        return;
      }

      // 1. 初始化社團名冊
      const currentMembers = getClubMembersList(rawName);
      saveClubMembersList(rawName, currentMembers);

      // 2. 儲存密碼 (選填)
      if (pwd) {
        if (!(await setClubPasswordDB(rawName, pwd))) return;
      }

      // 3. 儲存社團隱私與說明中繼資料 (clubs_metadata - 包含 hasPassword 與 description)
      const safeKey = encodeClubKey(rawName);
      const metaObj = {
        isPrivate: isPrivate,
        hasPassword: !!pwd,
        description: description,
        createdAt: Date.now()
      };
      if (STATE.db) {
        try {
          await set(ref(STATE.db, `clubs_metadata/${safeKey}`), metaObj);
        } catch (err) {
          console.warn("[Firebase] clubs_metadata set error:", err);
        }
      }

      if (!STATE.clubsMetadataMap) STATE.clubsMetadataMap = {};
      STATE.clubsMetadataMap[safeKey] = metaObj;
      STATE.clubsMetadataMap[rawName] = metaObj;

      const localMeta = JSON.parse(localStorage.getItem("pb_clubs_metadata") || "{}");
      localMeta[safeKey] = metaObj;
      localMeta[rawName] = metaObj;
      safeSetLocal("pb_clubs_metadata", JSON.stringify(localMeta));

      // 4. 加入目前會話已授權清單與儲存偏好
      STATE.authenticatedClubs.add(rawName);
      localStorage.setItem("pb_last_club", rawName);

      // 5. 更新全站下拉選單
      populateNavClubSelect();

      // 6. 關閉建立 Modal，自動訂閱並彈出社團建立專屬憑證（強提醒截圖留存與分享）
      closeCreateClubModal();
      addUserClubToFirebase(rawName);
      openClubCreatedCredentialModal(rawName, pwd);
    }
    window.handleModalCreateClubSubmit = handleModalCreateClubSubmit;

    function openClubCreatedCredentialModal(clubName, pwd) {
      const modal = document.getElementById("modal-club-created-credential");
      const nameEl = document.getElementById("cred-club-name");
      const pwdEl = document.getElementById("cred-club-pwd");
      const qrImg = document.getElementById("cred-club-qr-img");
      if (!modal) return;

      const origin = window.location.origin;
      const pathname = window.location.pathname;
      const clubUrl = `${origin}${pathname}?club=${encodeURIComponent(clubName)}`;

      STATE.lastCreatedClub = {
        name: clubName,
        pwd: pwd || "",
        url: clubUrl
      };

      if (nameEl) nameEl.innerText = clubName;
      if (pwdEl) {
        if (pwd) {
          pwdEl.innerHTML = `<span class="text-amber-500 font-bold select-all">${escapeHTML(pwd)}</span> <span class="text-[10px] sub-text font-normal">🔒 需密碼</span>`;
        } else {
          pwdEl.innerHTML = `<span class="text-emerald-500 font-medium">無密碼 (公開)</span>`;
        }
      }
      if (qrImg) {
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(clubUrl)}`;
      }

      modal.classList.remove("hidden");
      if (window.lucide) lucide.createIcons();
    }
    window.openClubCreatedCredentialModal = openClubCreatedCredentialModal;

    function closeClubCreatedCredentialModal() {
      const modal = document.getElementById("modal-club-created-credential");
      if (modal) modal.classList.add("hidden");
    }
    window.closeClubCreatedCredentialModal = closeClubCreatedCredentialModal;

    function copyClubLinkFromCredential() {
      const club = STATE.lastCreatedClub;
      if (!club || !club.url) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(club.url).then(() => {
          showToast(STATE.lang === "zh-TW" ? `已複製「${club.name}」專屬網址！` : `Copied club link for "${club.name}"!`, "success");
        });
      }
    }
    window.copyClubLinkFromCredential = copyClubLinkFromCredential;

    async function shareClubToLineFromCredential() {
      const club = STATE.lastCreatedClub;
      if (!club || !club.name) return;
      const isZh = STATE.lang === "zh-TW";
      const pwdText = club.pwd ? ` (社團防護密碼: ${club.pwd})` : "";
      const text = isZh
        ? `🏆 邀請您加入匹克球專屬社團【${club.name}】！${pwdText}\n點擊專屬連結立即進入大廳與戰績榜：\n${club.url}`
        : `🏆 Join our pickleball club "${club.name}"!${pwdText}\nClick link to enter lobby & rankings:\n${club.url}`;

      if (window.liff && liff.isLoggedIn() && liff.isApiAvailable("shareTargetPicker")) {
        try {
          await liff.shareTargetPicker([{
            type: "text",
            text: text
          }]);
          showToast(isZh ? "已成功分享至 LINE！" : "Shared to LINE successfully!", "success");
        } catch (err) {
          window.open(`https://line.me/R/msg/text/?${encodeURIComponent(text)}`, "_blank");
        }
      } else {
        window.open(`https://line.me/R/msg/text/?${encodeURIComponent(text)}`, "_blank");
      }
    }
    window.shareClubToLineFromCredential = shareClubToLineFromCredential;

    async function enterClubFromCredential() {
      closeClubCreatedCredentialModal();
      const club = STATE.lastCreatedClub;
      if (club && club.name) {
        await openClubSpace(club.name);
      }
    }
    window.enterClubFromCredential = enterClubFromCredential;

    // ----------------------------------------------------
    // CLUB IDENTITY CLAIM & LINE BINDING SYSTEM
    // ----------------------------------------------------
    let _activeClaimClub = null;
    let _activeClaimMappings = {};

    async function updateClubIdentityBadge(clubName) {
      const badgeBtn = document.getElementById("btn-club-identity");
      const iconEl = document.getElementById("club-identity-icon");
      const textEl = document.getElementById("t-club-identity-text");

      const cleanClub = (clubName || STATE.currentClub || "").trim();
      if (!cleanClub) {
        if (badgeBtn) badgeBtn.classList.add("hidden");
        return;
      }

      if (badgeBtn) {
        badgeBtn.classList.add("hidden"); // 頂部不再顯示身分按鈕，已移至個人資訊分頁
      }

      const safeClub = typeof encodeClubKey === "function" ? encodeClubKey(cleanClub) : encodeURIComponent(cleanClub);
      const isZh = (STATE.lang === "zh-TW");

      // 檢查是否為該社團會員
      const isMyClub = !!(
        STATE.lineUserId &&
        Array.isArray(STATE.myClubs) &&
        STATE.myClubs.includes(cleanClub)
      );

      // 核心原則：若未登入 LINE 或 尚未加入此社團，在該社團 100% 視為未綁定身分
      if (!STATE.lineUserId || !isMyClub) {
        STATE.clubPlayerName = null;
        if (typeof renderClubProfileTab === "function") {
          renderClubProfileTab(cleanClub);
        }
        lucide.createIcons();
        return;
      }

      // 2. 只有已加入社團的會員，才去讀取綁定身分
      let boundName = localStorage.getItem(`pb_bound_name_${cleanClub}`);

      // 3. 從雲端 /club_mappings/{safeClub}/{lineUserId} 同步確認
      if (STATE.db) {
        try {
          const snap = await get(ref(STATE.db, `club_mappings/${safeClub}/${STATE.lineUserId}`));
          if (snap.exists() && snap.val()) {
            boundName = String(snap.val()).trim();
            localStorage.setItem(`pb_bound_name_${cleanClub}`, boundName);
          } else if (!snap.exists()) {
            boundName = null;
            localStorage.removeItem(`pb_bound_name_${cleanClub}`);
          }
        } catch (e) {
          console.warn("[Club Identity] badge fetch error:", e);
        }
      }

      STATE.clubPlayerName = boundName || null;

      if (badgeBtn) {
        if (boundName) {
          badgeBtn.className = "px-2 py-1.5 sm:px-3 sm:py-2 rounded-xl card-inner border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold transition flex items-center gap-1 shadow-sm active:scale-95 shrink-0 cursor-pointer hover:border-emerald-500/70";
          badgeBtn.title = isZh ? `已綁定球員姓名：${boundName} (點擊可更換)` : `Bound to: ${boundName} (Click to change)`;
          if (textEl) textEl.innerHTML = `<span class="hidden xs:inline">${isZh ? "球員：" : "Player: "}</span>${escapeHTML(boundName)}`;
          if (iconEl) iconEl.setAttribute("class", "w-3.5 h-3.5 text-emerald-500");
        } else {
          badgeBtn.className = "px-2 py-1.5 sm:px-3 sm:py-2 rounded-xl card-inner border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-bold transition flex items-center gap-1 shadow-sm active:scale-95 shrink-0 cursor-pointer hover:border-amber-500/80";
          badgeBtn.title = isZh ? "您在此社團尚未綁定球員姓名，點擊認領或自訂" : "No player identity bound. Click to claim";
          if (textEl) textEl.innerText = isZh ? "未綁定身分" : "Claim ID";
          if (iconEl) iconEl.setAttribute("class", "w-3.5 h-3.5 text-amber-500");
        }
      }

      if (typeof renderClubProfileTab === "function") {
        renderClubProfileTab(cleanClub);
      }
      lucide.createIcons();
    }
    window.updateClubIdentityBadge = updateClubIdentityBadge;

    async function handleClubIdentityBadgeClick() {
      const clubName = STATE.currentClub;
      if (!clubName) return;

      const isZh = (STATE.lang === "zh-TW");

      if (!STATE.lineUserId) {
        if (typeof showLineLoginModal === "function") {
          showLineLoginModal();
        } else {
          showToast(isZh ? "請先使用 LINE 登入，綁定社團球員身分與個人戰績！" : "Please log in with LINE to bind identity!", "info");
        }
        return;
      }

      // 核心門禁：若尚未加入社團，提示先加入社團
      const isMyClub = Array.isArray(STATE.myClubs) && STATE.myClubs.includes(clubName);
      if (!isMyClub) {
        const joinConfirm = confirm(
          isZh
            ? `您尚未加入「${clubName}」。\n加入社團後即可綁定專屬球員姓名！是否現在加入？`
            : `You haven't joined "${clubName}".\nJoin this club to bind your player identity now?`
        );
        if (joinConfirm) {
          await addUserClubToFirebase(clubName);
          updateNavClubSelectValue();
          populateNavClubSelect();
        } else {
          return;
        }
      }

      const boundName = localStorage.getItem(`pb_bound_name_${clubName}`) || STATE.clubPlayerName;
      if (boundName) {
        const confirmMsg = isZh
          ? `您目前在【${clubName}】已綁定球員姓名為「${boundName}」。\n\n是否要更換或重新選擇球員身分？`
          : `You are currently bound to "${boundName}" in "${clubName}".\n\nChange player identity?`;
        if (!confirm(confirmMsg)) {
          return;
        }
      }

      // 開啟認領彈窗
      const safeClub = encodeClubKey(clubName);
      let mappings = {};
      if (STATE.db) {
        try {
          const snap = await get(ref(STATE.db, `club_mappings/${safeClub}`));
          if (snap.exists()) mappings = snap.val() || {};
        } catch (e) { }
      }
      showClubIdentityClaimModal(clubName, mappings);
    }
    window.handleClubIdentityBadgeClick = handleClubIdentityBadgeClick;

    async function checkAndPromptClubIdentityClaim(clubName) {
      // 改為主動式狀態徽章檢測，不再被動自動彈窗
      if (typeof updateClubIdentityBadge === "function") {
        await updateClubIdentityBadge(clubName);
      }
    }
    window.checkAndPromptClubIdentityClaim = checkAndPromptClubIdentityClaim;

    async function showClubIdentityClaimModal(clubName, mappings = {}) {
      const effectiveClub = (clubName && clubName.trim()) ? clubName.trim() : (STATE.currentClub || "球友大會");
      _activeClaimClub = effectiveClub;
      _activeClaimMappings = mappings;

      const modal = document.getElementById("modal-club-claim-identity");
      const titleEl = document.getElementById("claim-modal-club-title");
      const countEl = document.getElementById("claim-available-count");
      const containerEl = document.getElementById("claim-members-container");
      const newPlayerInput = document.getElementById("claim-new-player-input");

      if (!modal) return;

      if (titleEl) titleEl.innerText = `【${effectiveClub}】球員身分對照`;

      // 預設填入 LINE 暱稱 (上限10字)
      const lineName = (STATE.lineProfile && STATE.lineProfile.displayName)
        ? STATE.lineProfile.displayName.trim()
        : (localStorage.getItem("pb_my_player_name") || "").trim();

      if (newPlayerInput) {
        newPlayerInput.value = lineName ? lineName.slice(0, 10) : "";
      }

      // 1. 取得該社團所有成員清單 (合併 Firebase 與歷史賽事)
      let clubMembers = getClubMembersList(clubName) || [];
      if (STATE.db) {
        try {
          const safeClub = encodeClubKey(clubName);
          const snap = await get(ref(STATE.db, `club_members/${safeClub}`));
          if (snap.exists() && Array.isArray(snap.val())) {
            const merged = new Set([...clubMembers, ...snap.val()]);
            clubMembers = Array.from(merged);
          }
        } catch (e) { }
      }

      // 2. 排除機制：抓出所有「已被其他 LINE ID 綁定走」的名字
      const claimedNames = new Set(Object.values(mappings).map(n => (n || '').trim()));

      // 剩餘可認領的名字 (排除已被綁定者與臨打/暫代角色)
      const availableNames = clubMembers.filter(m => m && m.trim() && !claimedNames.has(m.trim()) && !isTransientPlayer(m.trim()));

      if (countEl) {
        countEl.innerText = `${availableNames.length} 人待認領`;
      }

      // 3. 渲染 Chips
      if (containerEl) {
        if (availableNames.length === 0) {
          containerEl.innerHTML = `
            <div class="w-full py-3 text-center text-xs sub-text">
              目前名冊中的球員已全數認領或為全新社團，請在下方輸入暱稱完成確認綁定！
            </div>
          `;
        } else {
          containerEl.innerHTML = availableNames.map(name => {
            const safeName = safeEscape(name);
            return `
              <button type="button" onclick="confirmClaimIdentity('${safeName}')"
                class="px-2.5 py-1.5 rounded-xl card-inner border hover:border-emerald-500 hover:text-emerald-500 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 cursor-pointer">
                <i data-lucide="user" class="w-3.5 h-3.5 text-stone-400"></i>
                <span>${escapeHTML(name)}</span>
              </button>
            `;
          }).join("");
        }
      }

      // 4. 動態顯示/隱藏「解除目前身分綁定」按鈕
      const unbindSection = document.getElementById("claim-unbind-section");
      const unbindBtnText = document.getElementById("claim-unbind-btn-text");
      const currentBound = localStorage.getItem(`pb_bound_name_${clubName}`) || STATE.clubPlayerName;
      if (unbindSection) {
        if (currentBound) {
          unbindSection.classList.remove("hidden");
          if (unbindBtnText) {
            unbindBtnText.innerText = (STATE.lang === "zh-TW")
              ? `解除目前綁定 (【${currentBound}】)`
              : `Unbind current identity (${currentBound})`;
          }
        } else {
          unbindSection.classList.add("hidden");
        }
      }

      modal.classList.remove("hidden");
      if (window.lucide) lucide.createIcons();
    }
    window.showClubIdentityClaimModal = showClubIdentityClaimModal;

    function closeClubIdentityClaimModal() {
      const modal = document.getElementById("modal-club-claim-identity");
      if (modal) modal.classList.add("hidden");
    }
    window.closeClubIdentityClaimModal = closeClubIdentityClaimModal;

    async function handleClaimNewPlayerSubmit() {
      const input = document.getElementById("claim-new-player-input");
      let name = input ? input.value.trim() : "";
      if (!name) {
        showToast("請輸入顯示姓名！", "warning");
        if (input) input.focus();
        return;
      }
      if (name.length > 10) {
        name = name.slice(0, 10);
      }
      await executeClaimBinding(name, true);
    }
    window.handleClaimNewPlayerSubmit = handleClaimNewPlayerSubmit;

    async function confirmClaimIdentity(name) {
      if (!name || !name.trim()) return;
      let clean = name.trim();
      if (clean.length > 10) clean = clean.slice(0, 10);
      const clubName = _activeClaimClub || STATE.currentClub;
      const isZh = STATE.lang === "zh-TW";
      const confirmMsg = isZh
        ? `確定要將「${clean}」認領為您在【${clubName}】的專屬球員身分嗎？\n(認領後歷史與未來戰績將直接連結至您的 LINE)`
        : `Claim "${clean}" as your identity in "${clubName}"?`;

      if (!confirm(confirmMsg)) return;
      await executeClaimBinding(clean, false);
    }
    window.confirmClaimIdentity = confirmClaimIdentity;

    async function executeClaimBinding(chosenName, isNewFriend = false) {
      const clubName = _activeClaimClub || STATE.currentClub;
      if (!clubName || !STATE.lineUserId) return;

      let cleanName = chosenName.trim();
      if (!cleanName) {
        showToast("姓名不可為空！", "warning");
        return;
      }
      if (cleanName.length > 10) {
        cleanName = cleanName.slice(0, 10);
      }

      const safeClub = encodeClubKey(clubName);

      // 【準則一：唯一性防冒領】檢查 cleanName 是否已被同社團內其他 LINE ID 綁定
      if (STATE.db) {
        try {
          const mapSnap = await get(ref(STATE.db, `club_mappings/${safeClub}`));
          if (mapSnap.exists()) {
            const currentMappings = mapSnap.val() || {};
            for (const [uid, bName] of Object.entries(currentMappings)) {
              if (uid !== STATE.lineUserId && String(bName).trim() === cleanName) {
                showToast(`「${cleanName}」已被其他球友綁定，請選擇其他姓名！`, "warning");
                return;
              }
            }
          }
        } catch (e) { }
      }

      // 【準則三：狀態分流處理】若使用者原本有綁定舊名字，執行分流清理
      const oldBoundName = (localStorage.getItem(`pb_bound_name_${clubName}`) || STATE.clubPlayerName || "").trim();
      if (oldBoundName && oldBoundName !== cleanName) {
        const hasRecords = checkPlayerHasClubMatchRecords(clubName, oldBoundName);
        if (!hasRecords) {
          // 零參賽紀錄自動抹除：從社團名冊中徹底移除幽靈空殼
          let currentMembers = getClubMembersList(clubName) || [];
          currentMembers = currentMembers.filter(m => (m || "").trim() !== oldBoundName);
          saveClubMembersList(clubName, currentMembers);
          if (STATE.db) {
            try {
              const snap = await get(ref(STATE.db, `club_members/${safeClub}`));
              if (snap.exists() && Array.isArray(snap.val())) {
                const cloudMembers = snap.val().filter(m => (m || "").trim() !== oldBoundName);
                await set(ref(STATE.db, `club_members/${safeClub}`), cloudMembers);
              }
            } catch (e) { }
          }
        }
      }

      try {
        // 1. 寫入 /club_mappings/{safeClub}/{lineUserId} = cleanName
        // 2. 寫入 /users/{lineUserId}/myClubs/{safeClub} = true
        if (STATE.db) {
          try {
            await set(ref(STATE.db, `club_mappings/${safeClub}/${STATE.lineUserId}`), cleanName);
          } catch (e) {
            console.warn("[Club Identity] club_mappings write warning:", e);
          }
          try {
            await set(ref(STATE.db, `users/${STATE.lineUserId}/myClubs/${safeClub}`), true);
          } catch (e) {
            console.warn("[Club Identity] users myClubs write warning:", e);
          }

          // 3. 如果是新朋友，順便把他的名字 push 進 club_members 陣列裡
          if (isNewFriend) {
            let currentMembers = getClubMembersList(clubName) || [];
            try {
              const snap = await get(ref(STATE.db, `club_members/${safeClub}`));
              if (snap.exists() && Array.isArray(snap.val())) {
                currentMembers = Array.from(new Set([...currentMembers, ...snap.val()]));
              }
              if (!currentMembers.includes(cleanName)) {
                currentMembers.push(cleanName);
                saveClubMembersList(clubName, currentMembers);
                await set(ref(STATE.db, `club_members/${safeClub}`), currentMembers);
              }
            } catch (e) {
              console.warn("[Club Identity] club_members write warning:", e);
            }
          }
        }

        // 4. 前端狀態同步
        STATE.clubPlayerName = cleanName;
        STATE.userBindings = STATE.userBindings || {};
        STATE.userBindings[clubName] = cleanName;
        localStorage.setItem(`pb_bound_name_${clubName}`, cleanName);
        localStorage.setItem("pb_my_player_name", cleanName);

        if (!Array.isArray(STATE.myClubs)) STATE.myClubs = [];
        if (!STATE.myClubs.includes(clubName)) {
          STATE.myClubs.push(clubName);
          localStorage.setItem("pb_my_clubs", JSON.stringify(STATE.myClubs));
        }

        if (typeof populateNavClubSelect === "function") {
          populateNavClubSelect();
        }

        closeClubIdentityClaimModal();
        if (typeof updateClubIdentityBadge === "function") {
          updateClubIdentityBadge(clubName);
        }

        // 5. 繼續原本的頁面渲染流程
        if (STATE.currentPage === "live" && STATE.tournamentData) {
          renderLiveUI(STATE.tournamentData);
        } else if (typeof renderHistoryCategorized === "function") {
          renderHistoryCategorized(STATE.allTournamentsCache || []);
        }
      } catch (err) {
        console.error("[Club Identity] executeClaimBinding error:", err);
        // 本地保底成功
        STATE.clubPlayerName = cleanName;
        localStorage.setItem(`pb_bound_name_${clubName}`, cleanName);
        closeClubIdentityClaimModal();
        if (typeof updateClubIdentityBadge === "function") {
          updateClubIdentityBadge(clubName);
        }
        if (STATE.currentPage === "live" && STATE.tournamentData) {
          renderLiveUI(STATE.tournamentData);
        }
      }
    }
    window.executeClaimBinding = executeClaimBinding;

    // 【架構準則三：出賽紀錄判定】檢查特定球員在該社團歷史賽事中是否有出賽紀錄
    function checkPlayerHasClubMatchRecords(clubName, playerName) {
      if (!clubName || !playerName) return false;
      const cleanClub = clubName.trim();
      const cleanName = playerName.trim();
      if (!cleanClub || !cleanName) return false;

      const tournaments = [];
      if (Array.isArray(STATE.allTournamentsCache)) {
        STATE.allTournamentsCache.forEach(t => {
          if (t && (t.clubName || "").trim() === cleanClub) {
            tournaments.push(t);
          }
        });
      }

      try {
        const localData = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
        Object.values(localData).forEach(t => {
          if (t && (t.clubName || "").trim() === cleanClub) {
            if (!tournaments.some(existing => existing.id === t.id)) {
              tournaments.push(t);
            }
          }
        });
      } catch (e) { }

      if (STATE.tournamentData && (STATE.tournamentData.clubName || "").trim() === cleanClub) {
        if (!tournaments.some(existing => existing.id === STATE.tournamentData.id)) {
          tournaments.push(STATE.tournamentData);
        }
      }

      for (const t of tournaments) {
        const matches = t.matches || [];
        for (const m of matches) {
          if (!m) continue;
          const blue = Array.isArray(m.blue) ? m.blue : [];
          const red = Array.isArray(m.red) ? m.red : [];
          if (blue.some(p => (p || "").trim() === cleanName) || red.some(p => (p || "").trim() === cleanName)) {
            return true;
          }
        }
      }

      return false;
    }
    window.checkPlayerHasClubMatchRecords = checkPlayerHasClubMatchRecords;

    // 【架構準則三：解除綁定與零紀錄自動抹除 (Unbind & Auto-Cleanup)】
    async function unbindClubIdentity(clubName, targetName, lineUserId) {
      const cleanClub = (clubName || STATE.currentClub || "").trim();
      if (!cleanClub) return false;

      const uid = lineUserId || STATE.lineUserId;
      const cleanTarget = (targetName || localStorage.getItem(`pb_bound_name_${cleanClub}`) || STATE.clubPlayerName || "").trim();
      const safeClub = encodeClubKey(cleanClub);

      try {
        // 1. 刪除關聯：移除 /club_mappings/{safeClub}/{uid} 與 /users/{uid}/myClubs/{safeClub}
        if (STATE.db && uid) {
          try {
            await remove(ref(STATE.db, `club_mappings/${safeClub}/${uid}`));
          } catch (e) {
            console.warn("[Club Identity] remove club_mappings error:", e);
          }
          try {
            await remove(ref(STATE.db, `users/${uid}/myClubs/${safeClub}`));
          } catch (e) {
            console.warn("[Club Identity] remove user myClubs error:", e);
          }
        }

        // 2. 本地狀態清除
        localStorage.removeItem(`pb_bound_name_${cleanClub}`);
        if (STATE.userBindings) {
          delete STATE.userBindings[cleanClub];
        }
        if (STATE.clubPlayerName === cleanTarget) {
          STATE.clubPlayerName = "";
        }

        // 3. 狀態分流處理 (準則三)
        if (cleanTarget) {
          const hasRecords = checkPlayerHasClubMatchRecords(cleanClub, cleanTarget);
          if (!hasRecords) {
            // 【零參賽紀錄自動抹除】：徹底從 club_members 陣列刪除，不留幽靈空殼
            console.log(`[Club Identity] 零參賽紀錄自動抹除：「${cleanTarget}」自社團【${cleanClub}】`);
            let members = getClubMembersList(cleanClub) || [];
            members = members.filter(m => (m || "").trim() !== cleanTarget);
            saveClubMembersList(cleanClub, members);

            if (STATE.db) {
              try {
                const snap = await get(ref(STATE.db, `club_members/${safeClub}`));
                if (snap.exists() && Array.isArray(snap.val())) {
                  const cloudMembers = snap.val().filter(m => (m || "").trim() !== cleanTarget);
                  await set(ref(STATE.db, `club_members/${safeClub}`), cloudMembers);
                }
              } catch (e) {
                console.warn("[Club Identity] cloud member cleanup error:", e);
              }
            }
          } else {
            // 【有參賽紀錄】：保留於 club_members，使其退回「待認領角色池」，歷史戰績原封不動
            console.log(`[Club Identity] 保留有參賽紀錄球員：「${cleanTarget}」退回待認領角色池`);
          }
        }

        // 4. 更新介面狀態
        if (typeof updateClubIdentityBadge === "function") {
          await updateClubIdentityBadge(cleanClub);
        }

        return true;
      } catch (err) {
        console.error("[Club Identity] unbindClubIdentity error:", err);
        localStorage.removeItem(`pb_bound_name_${cleanClub}`);
        if (STATE.clubPlayerName === cleanTarget) {
          STATE.clubPlayerName = "";
        }
        if (typeof updateClubIdentityBadge === "function") {
          updateClubIdentityBadge(cleanClub);
        }
        return false;
      }
    }
    window.unbindClubIdentity = unbindClubIdentity;

    // 點擊彈窗內「解除目前身分綁定」按鈕處理器
    async function handleDirectUnbindClick() {
      const clubName = _activeClaimClub || STATE.currentClub;
      if (!clubName) return;

      const currentBound = (localStorage.getItem(`pb_bound_name_${clubName}`) || STATE.clubPlayerName || "").trim();
      if (!currentBound) {
        closeClubIdentityClaimModal();
        return;
      }

      const isZh = STATE.lang === "zh-TW";
      const confirmMsg = isZh
        ? `確定要解除在【${clubName}】綁定的身分「${currentBound}」嗎？\n\n• 若無出賽紀錄：系統將自動徹底抹除此名字，不留幽靈資料。\n• 若有出賽紀錄：戰績將原封不動保留，此角色退回待認領池。`
        : `Are you sure you want to unbind "${currentBound}" in "${clubName}"?`;

      if (!confirm(confirmMsg)) return;

      await unbindClubIdentity(clubName, currentBound, STATE.lineUserId);
      closeClubIdentityClaimModal();

      // 重新渲染當前頁面
      if (STATE.currentPage === "live" && STATE.tournamentData) {
        renderLiveUI(STATE.tournamentData);
      } else if (typeof renderHistoryCategorized === "function") {
        renderHistoryCategorized(STATE.allTournamentsCache || []);
      }
    }
    window.handleDirectUnbindClick = handleDirectUnbindClick;

    // ----------------------------------------------------
    // CLUB SPACE 4-TABS NAVIGATION & CONTENT RENDERING
    // ----------------------------------------------------
    function switchClubTab(targetTab) {
      const validTabs = ["activities", "records", "profile", "info"];
      if (!validTabs.includes(targetTab)) targetTab = "activities";

      STATE.activeClubTab = targetTab;

      validTabs.forEach(tName => {
        const isCurrent = (tName === targetTab);
        const container = document.getElementById(`content-tab-${tName}`);
        if (container) {
          if (isCurrent) {
            container.classList.remove("hidden");
          } else {
            container.classList.add("hidden");
          }
        }

        // 手機版底部導覽按鈕 (#tab-btn-*)
        const bottomBtn = document.getElementById(`tab-btn-${tName}`);
        if (bottomBtn) {
          if (isCurrent) {
            bottomBtn.className = "flex flex-col items-center justify-center gap-1.5 h-full w-full py-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 transition active:scale-95 cursor-pointer";
          } else {
            bottomBtn.className = "flex flex-col items-center justify-center gap-1.5 h-full w-full py-1.5 text-xs font-semibold text-stone-500 hover:text-stone-800 dark:text-slate-400 dark:hover:text-slate-200 transition active:scale-95 cursor-pointer";
          }
        }

        // 桌面版分頁標籤按鈕 (#desktop-tab-btn-*)
        const desktopBtn = document.getElementById(`desktop-tab-btn-${tName}`);
        if (desktopBtn) {
          if (isCurrent) {
            desktopBtn.className = "px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30";
          } else {
            desktopBtn.className = "px-3.5 py-1.5 rounded-xl text-xs font-semibold sub-text hover:text-stone-900 dark:hover:text-white transition flex items-center gap-1.5 card-inner border";
          }
        }
      });

      if (targetTab === "profile") {
        renderClubProfileTab(STATE.currentClub);
      } else if (targetTab === "info") {
        renderClubInfoTab(STATE.currentClub);
      }

      lucide.createIcons();
    }
    window.switchClubTab = switchClubTab;

    async function renderClubInfoTab(clubName) {
      const descEl = document.getElementById("club-info-description-text");
      if (!descEl) return;
      const name = clubName || STATE.currentClub;
      const isZh = (STATE.lang === "zh-TW");
      if (!name) {
        descEl.innerText = isZh ? "尚未選擇社團" : "No club selected";
        return;
      }

      const safeKey = typeof encodeClubKey === "function" ? encodeClubKey(name) : encodeURIComponent(name);
      let meta = (STATE.clubsMetadataMap && (STATE.clubsMetadataMap[safeKey] || STATE.clubsMetadataMap[name]))
        || (JSON.parse(localStorage.getItem("pb_clubs_metadata") || "{}")[safeKey])
        || (JSON.parse(localStorage.getItem("pb_clubs_metadata") || "{}")[name]);

      if ((!meta || meta.description === undefined) && STATE.db) {
        try {
          const snap = await get(ref(STATE.db, `clubs_metadata/${safeKey}`));
          if (snap.exists()) {
            meta = snap.val();
            if (!STATE.clubsMetadataMap) STATE.clubsMetadataMap = {};
            STATE.clubsMetadataMap[safeKey] = meta;
            STATE.clubsMetadataMap[name] = meta;
          }
        } catch (e) {
          console.warn("[Club Info] fetch metadata error:", e);
        }
      }

      const desc = (meta && meta.description && meta.description.trim()) ? meta.description.trim() : "";
      if (desc) {
        descEl.innerText = desc;
        descEl.className = "text-xs sm:text-sm text-stone-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed";
      } else {
        descEl.innerText = isZh ? "此社團目前尚未填寫簡介說明。" : "No club description provided yet.";
        descEl.className = "text-xs sm:text-sm sub-text italic whitespace-pre-wrap leading-relaxed";
      }
    }
    window.renderClubInfoTab = renderClubInfoTab;

    async function renderClubProfileTab(clubName) {
      const statusBadgeEl = document.getElementById("club-profile-badge-status");
      const detailWrapEl = document.getElementById("club-profile-detail-wrap");
      const actionBtnTextEl = document.getElementById("btn-club-profile-action-text");
      const actionBtn = document.getElementById("btn-club-profile-action");
      if (!detailWrapEl) return;

      const name = clubName || STATE.currentClub;
      const isZh = (STATE.lang === "zh-TW");

      if (!STATE.lineUserId) {
        if (statusBadgeEl) {
          statusBadgeEl.innerHTML = `<span class="text-xs sm:text-sm font-bold text-amber-500">${isZh ? "（尚未綁定）" : " (Unbound)"}</span>`;
        }
        detailWrapEl.innerHTML = "";
        detailWrapEl.classList.add("hidden");
        if (actionBtnTextEl) actionBtnTextEl.innerText = isZh ? "綁定社團球員身分" : "Bind Player Identity";
        if (actionBtn) {
          actionBtn.onclick = () => {
            if (typeof showLineLoginModal === "function") showLineLoginModal();
            else openLineLoginPromptModal();
          };
        }
        if (window.lucide) lucide.createIcons();
        return;
      }

      const isMyClub = !!(Array.isArray(STATE.myClubs) && name && STATE.myClubs.includes(name));
      if (!isMyClub) {
        if (statusBadgeEl) {
          statusBadgeEl.innerHTML = `<span class="text-xs sm:text-sm font-bold text-amber-500">${isZh ? "（尚未綁定）" : " (Unbound)"}</span>`;
        }
        detailWrapEl.innerHTML = "";
        detailWrapEl.classList.add("hidden");
        if (actionBtnTextEl) actionBtnTextEl.innerText = isZh ? "綁定社團球員身分" : "Bind Player Identity";
        if (actionBtn) {
          actionBtn.onclick = () => handleClubIdentityBadgeClick();
        }
        if (window.lucide) lucide.createIcons();
        return;
      }

      const cleanClub = name.trim();
      const safeClub = typeof encodeClubKey === "function" ? encodeClubKey(cleanClub) : encodeURIComponent(cleanClub);
      let boundName = localStorage.getItem(`pb_bound_name_${cleanClub}`);

      if (STATE.db) {
        try {
          const snap = await get(ref(STATE.db, `club_mappings/${safeClub}/${STATE.lineUserId}`));
          if (snap.exists() && snap.val()) {
            boundName = String(snap.val()).trim();
            localStorage.setItem(`pb_bound_name_${cleanClub}`, boundName);
          } else if (!snap.exists()) {
            boundName = null;
            localStorage.removeItem(`pb_bound_name_${cleanClub}`);
          }
        } catch (e) {
          console.warn("[Club Profile Tab] fetch mapping error:", e);
        }
      }

      STATE.clubPlayerName = boundName || null;

      if (boundName) {
        if (statusBadgeEl) {
          statusBadgeEl.innerHTML = `<span class="text-xs sm:text-sm font-bold text-emerald-600 dark:text-emerald-400">${isZh ? "（已綁定）" : " (Bound)"}</span>`;
        }

        let playerStats = { games: 0, wins: 0, losses: 0, winRate: 0, diff: 0 };
        const allT = (STATE.allTournamentsCache || []).filter(t => (t.clubName || '').trim() === cleanClub && isTournamentFinished(t));
        allT.forEach(t => {
          if (getTournamentIsTeamMode(t)) return;
          (t.matches || []).forEach(m => {
            if (m.voided || !m.completed || m.blueScore == null || m.redScore == null) return;
            const inBlue = (m.blueTeam || []).includes(boundName);
            const inRed = (m.redTeam || []).includes(boundName);
            if (!inBlue && !inRed) return;

            const bScore = parseInt(m.blueScore) || 0;
            const rScore = parseInt(m.redScore) || 0;
            playerStats.games++;
            if (inBlue) {
              playerStats.diff += (bScore - rScore);
              if (bScore > rScore) playerStats.wins++;
              else if (rScore > bScore) playerStats.losses++;
            } else {
              playerStats.diff += (rScore - bScore);
              if (rScore > bScore) playerStats.wins++;
              else if (bScore > rScore) playerStats.losses++;
            }
          });
        });
        if (playerStats.games > 0) {
          playerStats.winRate = Math.round((playerStats.wins / playerStats.games) * 100);
        }

        detailWrapEl.innerHTML = `
          <div class="space-y-3">
            <div class="flex items-center justify-between border-b pb-2.5 border-stone-200/60 dark:border-slate-800">
              <div>
                <span class="text-[10px] sub-text block">${isZh ? "當前綁定球員暱稱" : "Bound Player Name"}</span>
                <div class="text-base sm:text-lg font-bold text-stone-900 dark:text-white">${escapeHTML(boundName)}</div>
              </div>
              <div class="text-right">
                <span class="text-[10px] sub-text block">${isZh ? "LINE 身分狀態" : "LINE Status"}</span>
                <div class="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center justify-end gap-1">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> ${isZh ? "已雲端同步" : "Synced"}
                </div>
              </div>
            </div>

            <div class="grid grid-cols-3 gap-2 text-center pt-1">
              <div class="p-2.5 rounded-xl card-inner border">
                <div class="text-[10px] sub-text">${isZh ? "出賽局數" : "Games"}</div>
                <div class="text-sm sm:text-base font-bold text-stone-900 dark:text-white mt-0.5">${playerStats.games}</div>
              </div>
              <div class="p-2.5 rounded-xl card-inner border">
                <div class="text-[10px] sub-text">${isZh ? "個人勝率" : "Win Rate"}</div>
                <div class="text-sm sm:text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">${playerStats.winRate}%</div>
              </div>
              <div class="p-2.5 rounded-xl card-inner border">
                <div class="text-[10px] sub-text whitespace-nowrap">${isZh ? "勝 / 敗場" : "W / L"}</div>
                <div class="text-sm sm:text-base font-bold text-stone-900 dark:text-white mt-0.5 whitespace-nowrap">
                  <span class="text-emerald-600 dark:text-emerald-400">${playerStats.wins}</span><span class="sub-text text-xs mx-0.5 opacity-50">/</span><span class="text-rose-600 dark:text-rose-400">${playerStats.losses}</span>
                </div>
              </div>
            </div>
          </div>
        `;
        detailWrapEl.classList.remove("hidden");
        if (actionBtnTextEl) actionBtnTextEl.innerText = isZh ? "更換 / 解除綁定身分" : "Change / Unbind Identity";
        if (actionBtn) {
          actionBtn.onclick = () => handleClubIdentityBadgeClick();
        }
      } else {
        if (statusBadgeEl) {
          statusBadgeEl.innerHTML = `<span class="text-xs sm:text-sm font-bold text-amber-500">${isZh ? "（尚未綁定）" : " (Unbound)"}</span>`;
        }
        detailWrapEl.innerHTML = "";
        detailWrapEl.classList.add("hidden");
        if (actionBtnTextEl) actionBtnTextEl.innerText = isZh ? "綁定社團球員身分" : "Bind Player Identity";
        if (actionBtn) {
          actionBtn.onclick = () => handleClubIdentityBadgeClick();
        }
      }

      if (window.lucide) lucide.createIcons();
    }
    window.renderClubProfileTab = renderClubProfileTab;

    async function openClubSpace(clubName) {
      if (clubName && clubName.trim()) {
        const clean = clubName.trim();
        STATE.currentClub = clean;
        localStorage.setItem("pb_last_club", clean);
      } else if (!STATE.currentClub) {
        const lastClub = (localStorage.getItem("pb_last_club") || "").trim();
        if (lastClub) {
          STATE.currentClub = lastClub;
        }
      }
      navigateTo("history");
      updateNavClubSelectValue();

      // 強制將 Tab 重置為 tab-activities
      switchClubTab("activities");

      // 顯示社團底部導覽列
      const clubBottomNav = document.getElementById("club-bottom-nav");
      if (clubBottomNav) {
        clubBottomNav.classList.remove("hidden");
      }

      // 檢查並提示 LINE 身分認領
      if (STATE.currentClub && STATE.lineUserId) {
        checkAndPromptClubIdentityClaim(STATE.currentClub);
      }

      return true;
    }
    window.openClubSpace = openClubSpace;

    async function onClubSpaceSelectChange(clubName) {
      if (!clubName) {
        openClubSpacePicker();
        return;
      }
      await openClubSpace(clubName);
    }
    window.onClubSpaceSelectChange = onClubSpaceSelectChange;

    function openClubSpacePicker() {
      STATE.currentClub = null;
      localStorage.removeItem("pb_last_club");
      navigateTo("history");
    }
    window.openClubSpacePicker = openClubSpacePicker;

    function createClubTournament() {
      STATE.createContextClub = STATE.currentClub;
      navigateTo("create");
    }
    window.createClubTournament = createClubTournament;

    function copyClubLink(clubName) {
      const name = clubName || STATE.currentClub;
      if (!name) return;
      const shareUrl = `${window.location.origin}${window.location.pathname}?club=${encodeURIComponent(name)}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl).then(() => {
          showToast(STATE.lang === "zh-TW" ? `已複製「${name}」專屬網址，可傳至 LINE 群組！` : `Copied club link for "${name}"!`, "success");
        });
      }
    }
    window.copyClubLink = copyClubLink;

    function setHistoryMonthFilter(month) {
      STATE.historyMonthFilter = month;
      const allT = STATE.allTournamentsCache || [];
      renderHistoryCategorized(allT);
    }
    window.setHistoryMonthFilter = setHistoryMonthFilter;

    function renderHistoryCategorized(allList) {
      const contentContainer = document.getElementById("club-content-container");
      const emptyStateEl = document.getElementById("club-empty-state");
      const headerTitleEl = document.getElementById("club-space-header-title");
      const headerSubEl = document.getElementById("club-space-header-sub");
      const headerActionsEl = document.getElementById("club-space-header-actions");
      const btnShareClub = document.getElementById("btn-share-club");
      const btnClubCreate = document.getElementById("btn-club-create-tournament");

      const tournamentsListEl = document.getElementById("history-tournaments-list");
      const aggregateSection = document.getElementById("history-club-aggregate-section");
      const aggregateClubNameEl = document.getElementById("history-aggregate-club-name");
      const sectionTitleEl = document.getElementById("history-matches-section-title");

      // Extract all unique clubs across all sources
      const uniqueClubs = getAllUniqueClubs();
      if (typeof populateNavClubSelect === "function") {
        populateNavClubSelect(uniqueClubs);
      }

      // 1. 若系統中尚無任何社團
      if (uniqueClubs.length === 0) {
        STATE.currentClub = null;
        if (emptyStateEl) emptyStateEl.classList.remove("hidden");
        if (contentContainer) contentContainer.classList.add("hidden");
        if (headerActionsEl) headerActionsEl.classList.add("hidden");
        if (headerTitleEl) headerTitleEl.innerText = t("navClub");
        if (headerSubEl) headerSubEl.innerText = t("noClubsYet");
        updateNavClubSelectValue();
        lucide.createIcons();
        return;
      }

      // 2. 若尚未選定社團，自動帶入上次選取的社團或第一個社團
      if (!STATE.currentClub || !uniqueClubs.includes(STATE.currentClub)) {
        const lastClub = localStorage.getItem("pb_last_club");
        if (lastClub && uniqueClubs.includes(lastClub)) {
          STATE.currentClub = lastClub;
        } else {
          STATE.currentClub = uniqueClubs[0];
        }
        localStorage.setItem("pb_last_club", STATE.currentClub);
      }

      const clubName = STATE.currentClub;
      if (emptyStateEl) emptyStateEl.classList.add("hidden");
      if (contentContainer) contentContainer.classList.remove("hidden");
      if (headerActionsEl) headerActionsEl.classList.remove("hidden");
      if (btnClubCreate) btnClubCreate.classList.remove("hidden");
      if (btnShareClub) btnShareClub.classList.add("hidden"); // 已移入社團說明分頁
      if (headerTitleEl) headerTitleEl.innerText = `${clubName} 社團大廳`;
      if (headerSubEl) headerSubEl.innerText = `${clubName} 專屬戰績榜、歷次賽事存檔與出賽名冊`;

      updateNavClubSelectValue();

      const clubTournamentsAll = (allList || []).filter(t => (t.clubName || '').trim() === clubName);

      // Render Active Tournaments for this Club
      const clubActiveSection = document.getElementById("club-active-section");
      const clubActiveListEl = document.getElementById("club-active-tournaments-list");
      const clubNoActivitiesHint = document.getElementById("club-no-activities-hint");
      // 進行中＝尚未按「結束賽事」的賽事（分數都登錄完但還沒結束的也算，否則會同時不在進行中、也不在歷史存檔裡）
      const clubActiveTournaments = clubTournamentsAll.filter(t => !isTournamentFinished(t));

      if (clubActiveSection && clubActiveListEl) {
        if (clubActiveTournaments.length > 0) {
          clubActiveSection.classList.remove("hidden");
          if (clubNoActivitiesHint) clubNoActivitiesHint.classList.add("hidden");
          // 與社團活動、臨打活動共用同一張賽事卡片（呈現與操作一致）
          clubActiveListEl.innerHTML = clubActiveTournaments
            .sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt))
            .map(tData => window.renderCardWithRegistration(tData)).join("");
        } else {
          clubActiveSection.classList.remove("hidden");
          clubActiveListEl.innerHTML = "";
          if (clubNoActivitiesHint) clubNoActivitiesHint.classList.remove("hidden");
        }
      }

      const completedClubTournaments = clubTournamentsAll.filter(tData => isTournamentFinished(tData));

      // Render Aggregate Leaderboard
      if (aggregateSection) aggregateSection.classList.remove("hidden");
      if (aggregateClubNameEl) aggregateClubNameEl.innerText = clubName;
      if (sectionTitleEl) {
        sectionTitleEl.innerHTML = `<i data-lucide="calendar" class="w-4 h-4"></i> ${escapeHTML(clubName)} 歷次賽事紀錄`;
      }

      populateHistoryMonthSelect(completedClubTournaments);
      renderHistoryClubAggregate(completedClubTournaments);
      renderHistoryTournamentCards(completedClubTournaments, tournamentsListEl);

      if (STATE.activeClubTab === "profile" && typeof renderClubProfileTab === "function") {
        renderClubProfileTab(clubName);
      } else if (STATE.activeClubTab === "info" && typeof renderClubInfoTab === "function") {
        renderClubInfoTab(clubName);
      }

      lucide.createIcons();
    }

    function parseTournamentDate(val) {
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
    window.parseTournamentDate = parseTournamentDate;

    function formatTournamentDate(val) {
      const d = parseTournamentDate(val);
      if (!d) return "";
      return d.toLocaleDateString(STATE.lang === "zh-TW" ? "zh-TW" : "en-US", { year: "numeric", month: "short", day: "numeric" });
    }
    window.formatTournamentDate = formatTournamentDate;

    function populateHistoryMonthSelect(tournaments) {
      const select = document.getElementById("history-month-select");
      if (!select) return;

      const currentVal = STATE.historyMonthFilter || "all";
      const monthsSet = new Set();
      tournaments.forEach(t => {
        const d = parseTournamentDate(t.createdAt);
        if (d) {
          const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          monthsSet.add(ym);
        }
      });

      const sortedMonths = Array.from(monthsSet).sort().reverse();
      let html = `<option value="all">${t("monthAll")}</option>`;
      sortedMonths.forEach(m => {
        const [year, month] = m.split("-");
        const dateObj = new Date(parseInt(year), parseInt(month) - 1, 1);
        const label = STATE.lang === "zh-TW"
          ? `${year} 年 ${parseInt(month)} 月`
          : dateObj.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        html += `<option value="${m}" ${currentVal === m ? 'selected' : ''}>${label}</option>`;
      });

      select.innerHTML = html;
      if (currentVal && (currentVal === "all" || monthsSet.has(currentVal))) {
        select.value = currentVal;
      } else {
        select.value = "all";
        STATE.historyMonthFilter = "all";
      }
    }

    function renderHistoryClubAggregate(tournaments) {
      const tbody = document.getElementById("history-aggregate-tbody");
      if (!tbody) return;

      // Filter tournaments by selected month if not "all"
      let filtered = tournaments;
      if (STATE.historyMonthFilter && STATE.historyMonthFilter !== "all") {
        filtered = tournaments.filter(t => {
          const d = parseTournamentDate(t.createdAt);
          if (!d) return false;
          const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          return ym === STATE.historyMonthFilter;
        });
      }

      // Compute aggregate stats across matches of filtered tournaments
      const stats = {};
      filtered.forEach(t => {
        if (getTournamentIsTeamMode(t)) return; // 隊伍對抗賽以「隊」為單位，不納入個人歷史戰績總表
        const matches = t.matches || [];
        matches.forEach(m => {
          if (m.voided || !m.completed || m.blueScore == null || m.redScore == null) return;
          const bScore = parseInt(m.blueScore) || 0;
          const rScore = parseInt(m.redScore) || 0;
          const blueWon = bScore > rScore;
          const redWon = rScore > bScore;

          const initPlayer = (p) => {
            if (!stats[p]) {
              stats[p] = { name: p, played: 0, wins: 0, losses: 0, pf: 0, pa: 0, diff: 0, winRate: 0 };
            }
          };

          (m.blue || []).forEach(p => {
            if (!p || isTransientPlayer(p)) return; // 排除臨打/暫代角色，不累計歷史總戰績
            initPlayer(p);
            stats[p].played += 1;
            if (blueWon) stats[p].wins += 1;
            else if (redWon) stats[p].losses += 1;
            stats[p].pf += bScore;
            stats[p].pa += rScore;
          });

          (m.red || []).forEach(p => {
            if (!p || isTransientPlayer(p)) return; // 排除臨打/暫代角色，不累計歷史總戰績
            initPlayer(p);
            stats[p].played += 1;
            if (redWon) stats[p].wins += 1;
            else if (blueWon) stats[p].losses += 1;
            stats[p].pf += rScore;
            stats[p].pa += bScore;
          });
        });
      });

      const list = Object.values(stats).map(s => {
        s.diff = s.pf - s.pa;
        s.winRate = s.played > 0 ? Math.round((s.wins / s.played) * 100) : 0;
        return s;
      });

      // Sort by Games played desc -> Wins desc -> WinRate desc -> Diff desc -> PF desc
      list.sort((a, b) => {
        if (b.played !== a.played) return b.played - a.played;
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        if (b.diff !== a.diff) return b.diff - a.diff;
        return b.pf - a.pf;
      });

      if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center sub-text text-xs">${t("noPeriodStats")}</td></tr>`;
        return;
      }

      tbody.innerHTML = list.map((row) => {
        const winUnit = STATE.lang === "zh-TW" ? "勝" : "W";
        const lossUnit = STATE.lang === "zh-TW" ? "敗" : "L";

        return `
          <tr class="hover:bg-stone-500/5 transition">
            <td class="py-2.5 px-3 whitespace-nowrap">
              <span class="font-semibold text-xs text-stone-900 dark:text-slate-100">${escapeHTML(row.name)}</span>
            </td>
            <td class="py-2.5 px-2 text-center font-mono whitespace-nowrap">
              <span class="px-2 py-0.5 rounded-md text-xs font-bold font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">${row.played}</span>
            </td>
            <td class="py-2.5 px-2 text-center font-mono font-bold text-xs whitespace-nowrap ${row.winRate >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'sub-text'}">
              ${row.winRate}%
            </td>
            <td class="py-2.5 px-2 text-center font-mono text-xs whitespace-nowrap">
              <span class="text-emerald-600 dark:text-emerald-400 font-bold">${row.wins}${winUnit}</span><span class="sub-text text-[11px] mx-0.5 opacity-50">/</span><span class="text-rose-600 dark:text-rose-400 font-bold">${row.losses}${lossUnit}</span>
            </td>
            <td class="py-2.5 px-2 text-center font-mono text-xs font-bold whitespace-nowrap ${row.diff > 0 ? 'text-emerald-600 dark:text-emerald-400' : row.diff < 0 ? 'text-rose-600 dark:text-rose-400' : 'sub-text'}">
              ${row.diff > 0 ? '+' + row.diff : row.diff}
            </td>
            <td class="py-2.5 px-2 text-center font-mono text-xs sub-text whitespace-nowrap">
              ${row.pf}<span class="opacity-50">/</span>${row.pa}
            </td>
          </tr>
        `;
      }).join("");
    }

    function renderHistoryTournamentCards(tournaments, container) {
      if (!tournaments || tournaments.length === 0) {
        container.innerHTML = `
          <div class="glass-card rounded-2xl p-8 text-center space-y-3 border">
            <div class="w-12 h-12 rounded-xl card-inner sub-text flex items-center justify-center mx-auto">
              <i data-lucide="archive" class="w-6 h-6 text-emerald-500"></i>
            </div>
            <h3 class="text-base font-bold">${t("noCompletedTournaments")}</h3>
            <p class="text-xs sub-text">${STATE.lang === "zh-TW" ? "完成所有比賽後，賽事將自動歸檔至此" : "Tournaments will appear here once all matches are completed"}</p>
          </div>
        `;
        lucide.createIcons();
        return;
      }

      tournaments.sort((a, b) => (parseTournamentDate(b.createdAt)?.getTime() || 0) - (parseTournamentDate(a.createdAt)?.getTime() || 0));

      container.innerHTML = tournaments.map(tData => {
        const matches = tData.matches || [];
        const players = tData.players || [];
        const leaderboard = calculateLeaderboard(players, matches);
        const totalMatches = matches.length;
        const completedMatches = matches.filter(m => m.completed && !m.voided).length;
        const voidedMatches = matches.filter(m => m.voided).length;
        const isExpanded = STATE.expandedHistoryTournaments[tData.id];

        // Podium
        const champion = leaderboard[0];
        const runnerUp = leaderboard[1];
        const third = leaderboard[2];

        // Safe formatted date
        const dateStr = formatTournamentDate(tData.createdAt);

        const clubBadge = tData.clubName && tData.clubName.trim() ? `
          <span class="text-[10px] px-2 py-0.5 rounded font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
            <i data-lucide="shield" class="w-2.5 h-2.5"></i> ${escapeHTML(tData.clubName.trim())}
          </span>
        ` : '';

        // Expanded content: full leaderboard + match log
        let expandedHTML = '';
        if (isExpanded) {
          const winUnit = STATE.lang === "zh-TW" ? "勝" : "W";
          const lossUnit = STATE.lang === "zh-TW" ? "敗" : "L";
          const lbRows = leaderboard.map((row, idx) => {
            const rankBadge = `<span class="font-mono sub-text font-bold text-[11px]">${idx + 1}</span>`;
            const isMvp = idx === 0 && row.played > 0;
            return `
              <tr class="${isMvp ? 'bg-amber-500/10 font-bold border-l-2 border-amber-400' : 'hover:bg-stone-500/5'} transition">
                <td class="py-2 px-1.5 text-center whitespace-nowrap">${rankBadge}</td>
                <td class="py-2 px-2 whitespace-nowrap"><span class="font-semibold text-xs ${isMvp ? 'text-amber-600 dark:text-amber-300' : ''}">${escapeHTML(row.name)}</span></td>
                <td class="py-2 px-1.5 text-center font-mono text-xs whitespace-nowrap">
                  <span class="text-emerald-600 dark:text-emerald-400 font-bold">${row.wins}${winUnit}</span><span class="sub-text text-[11px] mx-0.5 opacity-50">/</span><span class="text-rose-600 dark:text-rose-400 font-bold">${row.losses}${lossUnit}</span>
                </td>
                <td class="py-2 px-1.5 text-center font-mono text-xs font-bold whitespace-nowrap ${row.diff > 0 ? 'text-emerald-600 dark:text-emerald-400' : row.diff < 0 ? 'text-rose-600 dark:text-rose-400' : 'sub-text'}">
                  ${row.diff > 0 ? '+' + row.diff : row.diff}
                </td>
                <td class="py-2 px-2 text-center font-mono text-xs sub-text whitespace-nowrap">${row.pf}<span class="opacity-50">/</span>${row.pa}</td>
              </tr>
            `;
          }).join("");

          // 生成【全輪次對戰紀錄】緊湊小表（專業對戰表排版：藍隊靠右、比分置中、紅隊靠左）
          const matchRows = matches.map(m => {
            const bScore = m.blueScore != null ? parseInt(m.blueScore) : null;
            const rScore = m.redScore != null ? parseInt(m.redScore) : null;
            const isDone = m.completed && !m.voided && bScore != null && rScore != null;
            const blueWon = isDone && bScore > rScore;
            const redWon = isDone && rScore > bScore;
            const isVoid = !!m.voided;

            const blueNames = escapeHTML((m.blue || []).join(" / "));
            const redNames = escapeHTML((m.red || []).join(" / "));
            const restNames = (m.resting && m.resting.length > 0) ? m.resting.join("、") : "-";

            let scoreBadge = `<span class="sub-text text-[11px] font-mono">-</span>`;
            if (isVoid) {
              scoreBadge = `<span class="px-2 py-0.5 rounded text-[10px] bg-rose-500/10 text-rose-500 border border-rose-500/20 font-bold">${STATE.lang === 'zh-TW' ? '取消' : 'Void'}</span>`;
            } else if (isDone) {
              scoreBadge = `
                <span class="font-mono font-bold text-xs px-2 py-0.5 rounded-md card-inner border inline-flex items-center justify-center gap-1 shadow-xs min-w-[56px]">
                  <span class="${blueWon ? 'text-blue-500 font-extrabold' : 'sub-text'}">${bScore}</span>
                  <span class="sub-text font-normal">:</span>
                  <span class="${redWon ? 'text-rose-500 font-extrabold' : 'sub-text'}">${rScore}</span>
                </span>
              `;
            }

            return `
              <tr class="hover:bg-stone-500/5 transition ${isVoid ? 'opacity-50' : ''}">
                <td class="py-2.5 px-2 text-center font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                  ${m.roundName || `G${m.id}`}
                </td>
                <td class="py-2.5 px-2 text-right text-xs ${blueWon ? 'font-bold text-stone-900 dark:text-slate-100' : 'sub-text'}">
                  <div class="inline-flex items-center justify-end gap-1.5">
                    <span>${blueNames}</span>
                    <span class="w-1.5 h-1.5 rounded-full shrink-0 ${blueWon ? 'bg-blue-500 ring-2 ring-blue-500/30' : 'bg-transparent'}"></span>
                  </div>
                </td>
                <td class="py-2.5 px-1 text-center whitespace-nowrap">
                  ${scoreBadge}
                </td>
                <td class="py-2.5 px-2 text-left text-xs ${redWon ? 'font-bold text-stone-900 dark:text-slate-100' : 'sub-text'}">
                  <div class="inline-flex items-center justify-start gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full shrink-0 ${redWon ? 'bg-rose-500 ring-2 ring-rose-500/30' : 'bg-transparent'}"></span>
                    <span>${redNames}</span>
                  </div>
                </td>
                <td class="py-2.5 px-2 text-center text-[11px] sub-text hidden md:table-cell whitespace-nowrap">
                  ${restNames}
                </td>
              </tr>
            `;
          }).join("");

          expandedHTML = `
            <div class="mt-4 space-y-3 animate-in">
              <!-- Final Leaderboard -->
              <div class="glass-card rounded-xl overflow-hidden border">
                <div class="px-3 py-2 card-inner border-b text-xs font-bold flex items-center justify-between">
                  <span class="flex items-center gap-1.5">
                    <i data-lucide="trophy" class="w-3.5 h-3.5 text-emerald-500"></i>
                    <span>${t("finalLeaderboard")}</span>
                  </span>
                </div>
                <div class="overflow-x-auto">
                  <table class="w-full text-left text-xs min-w-[340px]">
                    <thead class="card-inner sub-text uppercase font-semibold border-b text-[11px] whitespace-nowrap">
                      <tr>
                        <th class="py-2 px-2 text-center w-10 whitespace-nowrap">${t("thRank")}</th>
                        <th class="py-2 px-2 whitespace-nowrap">${t("thPlayer")}</th>
                        <th class="py-2 px-1.5 text-center whitespace-nowrap">${t("thWl")}</th>
                        <th class="py-2 px-1.5 text-center whitespace-nowrap">${t("thDiff")}</th>
                        <th class="py-2 px-2 text-center whitespace-nowrap">${t("thPfPa")}</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y font-medium text-xs">${lbRows}</tbody>
                  </table>
                </div>
              </div>

              <!-- 全輪次對戰紀錄 (Full Match Results - 對稱置中) -->
              <div class="glass-card rounded-xl overflow-hidden border">
                <div class="px-3 py-2 card-inner border-b text-xs font-bold flex items-center justify-between">
                  <span class="flex items-center gap-1.5">
                    <i data-lucide="swords" class="w-3.5 h-3.5 text-emerald-500"></i>
                    <span>${STATE.lang === 'zh-TW' ? '【全輪次對戰紀錄】' : '【Full Match Results】'}</span>
                  </span>
                  <span class="sub-text text-[11px] font-mono">${completedMatches} / ${totalMatches} ${STATE.lang === 'zh-TW' ? '完賽' : 'Done'}</span>
                </div>
                <div class="overflow-x-auto">
                  <table class="w-full text-xs">
                    <thead class="card-inner sub-text uppercase font-semibold border-b text-[11px]">
                      <tr>
                        <th class="py-2 px-2 text-center w-12 shrink-0">${STATE.lang === 'zh-TW' ? '局數' : 'Game'}</th>
                        <th class="py-2 px-2 text-right w-[35%]">${STATE.lang === 'zh-TW' ? (tData.partnerType === 'singles' ? '藍方' : '藍隊') : 'Blue'}</th>
                        <th class="py-2 px-1 text-center w-20 shrink-0">${STATE.lang === 'zh-TW' ? '比分' : 'Score'}</th>
                        <th class="py-2 px-2 text-left w-[35%]">${STATE.lang === 'zh-TW' ? (tData.partnerType === 'singles' ? '紅方' : '紅隊') : 'Red'}</th>
                        <th class="py-2 px-2 text-center hidden md:table-cell sub-text w-24">${STATE.lang === 'zh-TW' ? '輪休' : 'Resting'}</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y font-medium text-xs">
                      ${matchRows || `<tr><td colspan="5" class="py-4 text-center sub-text text-xs">尚無場次紀錄</td></tr>`}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          `;
        }

        return `
          <div class="glass-card hover-lift rounded-2xl p-4 sm:p-5 border space-y-3.5 transition shadow-sm relative overflow-hidden group">
            <!-- Header -->
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="px-2 py-0.5 rounded-md text-[10px] font-bold font-mono card-inner text-emerald-600 dark:text-emerald-400 border">${escapeHTML(tData.id)}</span>
                ${clubBadge}
                ${tData.partnerType === 'singles' ? `<span class="text-[10px] px-2 py-0.5 rounded font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">${STATE.lang === 'zh-TW' ? '個人單打' : 'Singles'}</span>` : ''}
                <span class="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 flex items-center gap-1 shadow-sm">
                  <i data-lucide="check" class="w-3 h-3"></i> ${t("statusFinished")}
                </span>
              </div>
              <span class="text-[10px] sub-text font-mono">${dateStr}</span>
            </div>

            <!-- Title -->
            <h3 class="text-base sm:text-lg font-bold font-display group-hover:text-emerald-500 transition-colors">${escapeHTML(tData.name)}</h3>

            <!-- Podium Badges -->
            <div class="flex items-center gap-2 text-xs flex-wrap pt-0.5">
              ${champion && champion.played > 0
            ? `<span class="inline-flex items-center gap-1.5 font-bold px-2.5 py-1 rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 shadow-sm">
                    <span class="text-sm">🥇</span> <span>${escapeHTML(champion.name)}</span> <span class="sub-text text-[11px] font-normal font-mono">(${champion.wins}${STATE.lang === "zh-TW" ? "勝" : "W"})</span>
                  </span>`
            : ''}
              ${runnerUp && runnerUp.played > 0
            ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl card-inner border text-stone-700 dark:text-slate-300 text-xs shadow-sm">
                    <span>🥈</span> <span>${escapeHTML(runnerUp.name)}</span>
                  </span>`
            : ''}
              ${third && third.played > 0
            ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl card-inner border text-stone-700 dark:text-slate-300 text-xs shadow-sm">
                    <span>🥉</span> <span>${escapeHTML(third.name)}</span>
                  </span>`
            : ''}
            </div>

            <!-- Stats row -->
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sub-text pt-2 border-t border-stone-200/70 dark:border-slate-800/70">
              <span>👥 ${players.length} ${t("playersCountLabel")}</span>
              <span>⚔️ ${STATE.lang === "zh-TW" ? `共 ${totalMatches} 場｜完賽 ${completedMatches} 場${voidedMatches > 0 ? `｜取消 ${voidedMatches} 場` : ''}` : `${totalMatches} games｜${completedMatches} done${voidedMatches > 0 ? `｜${voidedMatches} voided` : ''}`}</span>
              ${tData.partnerType === 'singles' ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">${STATE.lang === "zh-TW" ? "個人單打" : "Singles"}</span>` : ''}
              ${tData.tournamentMode === "free" ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold card-inner border text-stone-600 dark:text-slate-300 inline-flex items-center gap-1">${STATE.lang === "zh-TW" ? "自由模式" : "Free Play"}</span>` : tData.tournamentMode === "round-robin" ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold card-inner border text-stone-600 dark:text-slate-300 inline-flex items-center gap-1">${STATE.lang === "zh-TW" ? "全循環模式" : "Round-Robin"}</span>` : tData.tournamentMode === "group" ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold card-inner border text-stone-600 dark:text-slate-300 inline-flex items-center gap-1">${STATE.lang === "zh-TW" ? "分組循環" : "Group Stage"}</span>` : `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold card-inner border text-stone-600 dark:text-slate-300 inline-flex items-center gap-1"><i data-lucide="clock" class="w-3 h-3 text-stone-400"></i> ${tData.durationHours || 2} ${t("hrsUnit")}</span>`}
            </div>

            <!-- Expand / Collapse & Actions -->
            <div class="flex items-center gap-2 pt-1">
              <button onclick="toggleHistoryTournament('${escapeJsAttr(tData.id)}')" class="flex-1 card-inner border sub-text hover:text-emerald-500 hover:border-emerald-500/40 font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1.5 active:scale-95 shadow-sm">
                <i data-lucide="${isExpanded ? 'chevron-up' : 'chevron-down'}" class="w-3.5 h-3.5"></i>
                <span>${isExpanded ? t("collapseDetails") : t("expandDetails")}</span>
              </button>
              <button onclick="copyTournamentReport('${escapeJsAttr(tData.id)}')" class="px-3 py-2.5 card-inner border sub-text hover:text-blue-500 hover:border-blue-500/40 font-bold rounded-xl text-xs transition flex items-center justify-center gap-1 active:scale-95 shadow-sm" title="${t("copyReportBtn")}">
                <i data-lucide="file-text" class="w-3.5 h-3.5 text-blue-500"></i>
              </button>
              <button onclick="enterTournament('${escapeJsAttr(tData.id)}')" class="px-3 py-2.5 card-inner border sub-text hover:text-emerald-500 hover:border-emerald-500/40 font-bold rounded-xl text-xs transition flex items-center justify-center gap-1 active:scale-95 shadow-sm" title="${t("enterTournament")}">
                <i data-lucide="external-link" class="w-3.5 h-3.5 text-emerald-500"></i>
              </button>
              ${STATE.isAdmin
            ? `<button onclick="deleteTournament('${escapeJsAttr(tData.id)}')" class="px-3 py-2.5 card-inner border hover:bg-rose-500/20 sub-text hover:text-rose-500 border-rose-500/30 font-bold rounded-xl text-xs transition flex items-center justify-center gap-1 active:scale-95 shadow-sm" title="${t("deleteTournamentBtn")}">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5 text-rose-500"></i>
                  </button>`
            : ''
          }
            </div>

            ${expandedHTML}
          </div>
        `;
      }).join("");

      lucide.createIcons();
    }

    function toggleHistoryTournament(id) {
      STATE.expandedHistoryTournaments[id] = !STATE.expandedHistoryTournaments[id];
      renderHistoryPage();
    }
    window.toggleHistoryTournament = toggleHistoryTournament;

    function copyTournamentReport(tId) {
      // 收集所有潛在資料來源，優先挑選已記錄比分最完整的那一份
      const candidates = [];

      if (STATE.tournamentData && STATE.tournamentData.id === tId) {
        candidates.push(STATE.tournamentData);
      }

      try {
        const local = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
        if (local && local[tId]) {
          candidates.push(local[tId]);
        }
      } catch (e) {
        console.warn("Read local tournament failed:", e);
      }

      const cached = (STATE.allTournamentsCache || []).find(t => t.id === tId);
      if (cached) {
        candidates.push(cached);
      }

      if (candidates.length === 0) return;

      // 依照「已填入比分且已完成的局數」由多到少排序，確保抓到最新數據
      candidates.sort((a, b) => {
        const countScores = obj => (obj.matches || []).filter(m => m.completed && m.blueScore !== null && m.redScore !== null).length;
        return countScores(b) - countScores(a);
      });

      const tData = candidates[0];
      if (!tData) return;

      const matches = tData.matches || [];
      const players = tData.players || [];
      const leaderboard = calculateLeaderboard(players, matches);
      const dateStr = formatTournamentDate(tData.createdAt);

      const totalMatches = matches.length;
      const completedCount = matches.filter(m => m.completed && !m.voided).length;
      const voidedCount = matches.filter(m => m.voided).length;

      const isZh = (STATE.lang === "zh-TW");
      const isTeam = getTournamentIsTeamMode(tData);
      const isSingles = (tData.partnerType === "singles");
      let report = "";

      const countBadgeStr = isZh
        ? `共 ${totalMatches} 場｜完賽 ${completedCount} 場${voidedCount > 0 ? `｜取消 ${voidedCount} 場` : ''}`
        : `${totalMatches} games | ${completedCount} completed${voidedCount > 0 ? ` | ${voidedCount} voided` : ''}`;

      const unitStr = isTeam
        ? (isZh ? `${players.length} 隊` : `${players.length} teams`)
        : (isZh ? `${players.length} 人` : `${players.length} players`);

      let modeStr = "";
      if (isSingles) {
        modeStr = isZh ? "個人單打" : "Singles (1v1)";
      } else if (tData.tournamentMode === "free") {
        modeStr = isZh ? "自由模式" : "Free Play";
      } else if (tData.tournamentMode === "round-robin") {
        modeStr = isZh ? "全循環模式" : "Round-Robin";
      } else {
        modeStr = isZh ? "平均模式" : "Fair Schedule";
      }

      // Title & Basic Info
      if (isZh) {
        report += `【賽事戰報】${tData.name}\n`;
        report += `日期：${dateStr}`;
        if (tData.clubName && tData.clubName.trim()) {
          report += ` | 社團：${tData.clubName.trim()}`;
        }
        report += ` | 賽制：${modeStr}\n`;
        report += `${isTeam ? "參賽隊伍" : "參賽人數"}：${unitStr} | 對局統計：${countBadgeStr}\n`;
      } else {
        report += `[TOURNAMENT REPORT] ${tData.name}\n`;
        report += `Date: ${dateStr}`;
        if (tData.clubName && tData.clubName.trim()) {
          report += ` | Club: ${tData.clubName.trim()}`;
        }
        report += ` | Format: ${modeStr}\n`;
        report += `${isTeam ? "Teams" : "Players"}: ${unitStr} | Progress: ${countBadgeStr}\n`;
      }
      report += `${"-".repeat(34)}\n\n`;

      // Podium / Top 3
      if (leaderboard.some(p => p.played > 0)) {
        if (isZh) {
          report += `【榮譽榜】\n`;
          if (leaderboard[0]?.played > 0) report += `  1. 冠軍：${leaderboard[0].name} (${leaderboard[0].wins}勝 ${leaderboard[0].losses}敗, 淨勝分 ${leaderboard[0].diff > 0 ? '+' : ''}${leaderboard[0].diff})\n`;
          if (leaderboard[1]?.played > 0) report += `  2. 亞軍：${leaderboard[1].name} (${leaderboard[1].wins}勝 ${leaderboard[1].losses}敗, 淨勝分 ${leaderboard[1].diff > 0 ? '+' : ''}${leaderboard[1].diff})\n`;
          if (leaderboard[2]?.played > 0) report += `  3. 季軍：${leaderboard[2].name} (${leaderboard[2].wins}勝 ${leaderboard[2].losses}敗, 淨勝分 ${leaderboard[2].diff > 0 ? '+' : ''}${leaderboard[2].diff})\n`;
        } else {
          report += `[PODIUM]\n`;
          if (leaderboard[0]?.played > 0) report += `  1. Champion: ${leaderboard[0].name} (${leaderboard[0].wins}W ${leaderboard[0].losses}L, Diff ${leaderboard[0].diff > 0 ? '+' : ''}${leaderboard[0].diff})\n`;
          if (leaderboard[1]?.played > 0) report += `  2. Runner-up: ${leaderboard[1].name} (${leaderboard[1].wins}W ${leaderboard[1].losses}L, Diff ${leaderboard[1].diff > 0 ? '+' : ''}${leaderboard[1].diff})\n`;
          if (leaderboard[2]?.played > 0) report += `  3. 3rd Place: ${leaderboard[2].name} (${leaderboard[2].wins}W ${leaderboard[2].losses}L, Diff ${leaderboard[2].diff > 0 ? '+' : ''}${leaderboard[2].diff})\n`;
        }
        report += `\n`;
      }

      // Full Standings
      report += `${isZh ? "【完整戰報】" : "[STANDINGS]"}\n`;
      leaderboard.forEach((row, idx) => {
        const rank = idx + 1;
        const diffStr = row.diff > 0 ? `+${row.diff}` : `${row.diff}`;
        if (isZh) {
          report += `  ${rank}. ${row.name}  ${row.wins}勝 ${row.losses}敗  淨勝分 ${diffStr}  (得失分 ${row.pf}/${row.pa})\n`;
        } else {
          report += `  ${rank}. ${row.name}  ${row.wins}W ${row.losses}L  Diff ${diffStr}  (PF/PA ${row.pf}/${row.pa})\n`;
        }
      });
      report += `\n`;

      // Match log
      report += `${isZh ? "【全輪次對戰紀錄】" : "[MATCH LOG]"}\n`;
      matches.forEach(m => {
        const bNames = (m.blue || []).join(' & ');
        const rNames = (m.red || []).join(' & ');
        if (m.voided) {
          report += `  #${m.id} ${bNames} [${isZh ? "已取消" : "Voided"}] ${rNames}\n`;
        } else if (m.completed && m.blueScore != null && m.redScore != null) {
          report += `  #${m.id} ${bNames}  ${m.blueScore} : ${m.redScore}  ${rNames}\n`;
        } else {
          report += `  #${m.id} ${bNames} [${isZh ? "未完賽" : "Pending"}] ${rNames}\n`;
        }
      });

      report += `\n${"-".repeat(34)}\n`;
      report += isZh ? "ZeroZeroTwo " : "ZeroZeroTwo Pickleball Tournament System";

      navigator.clipboard.writeText(report).then(() => {
        showToast(isZh ? "賽報已複製！" : "Match report copied!");
      });
    }
    window.copyTournamentReport = copyTournamentReport;

    function liveCopyReport() {
      if (STATE.currentTournamentId) {
        copyTournamentReport(STATE.currentTournamentId);
      }
    }
    window.liveCopyReport = liveCopyReport;

    // ----------------------------------------------------
    // FEATURE 3: CLUB PASSWORD PROTECTION
    // ----------------------------------------------------
    // Firebase RTDB key-safe encoding for club names (禁止 . $ # [ ] / 等字元)
    function encodeClubKey(clubName) {
      return encodeURIComponent(clubName.trim()).replace(/\./g, '%2E');
    }

    // 通用安全跳脫：用於 inline onclick='fn("...")' 內的字串（先跳脫 JS，再跳脫 HTML 屬性）
    function safeEscape(str) {
      return escapeJsAttr(str);
    }

    async function getClubPassword(clubName) {
      // 資安加固：前端全面禁止讀取密碼 Hash，此函式僅回傳該社團是否有密碼保護
      return typeof hasClubPassword === "function" ? hasClubPassword(clubName) : false;
    }

    // 本次瀏覽期間已驗證過的憑證（只存在記憶體，關閉頁面即消失）
    // 用於呼叫後端修改密碼時證明身分；資料庫規則禁止前端直接寫入 club_passwords
    const _verifiedClubCreds = new Map();
    let _adminPinCred = "";

    function getClubCredential(clubName) {
      if (STATE.isAdmin && _adminPinCred) return _adminPinCred;
      return _verifiedClubCreds.get(clubName) || "";
    }

    async function callManageClubPassword(payload) {
      try {
        const res = await fetch(`${FUNCTIONS_BASE_URL}/manageClubPassword`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) return true;
        showToast(data.error || (STATE.lang === "zh-TW" ? "密碼更新失敗" : "Password update failed"), "error");
      } catch (e) {
        console.error("manageClubPassword error:", e);
        showToast(STATE.lang === "zh-TW" ? "密碼更新失敗，請檢查網路" : "Password update failed, check your network", "error");
      }
      return false;
    }

    // 管理員對已完賽賽事的刪除／改名：經由後端驗證 Master PIN 後執行
    async function adminTournamentAction(payload) {
      if (!STATE.isAdmin || !_adminPinCred) {
        showToast(STATE.lang === "zh-TW" ? "請先登入管理員" : "Please log in as admin first", "error");
        return false;
      }
      try {
        const res = await fetch(`${FUNCTIONS_BASE_URL}/adminTournamentAction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, pin: _adminPinCred })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) return true;
        showToast(data.error || (STATE.lang === "zh-TW" ? "操作失敗" : "Action failed"), "error");
      } catch (e) {
        console.error("adminTournamentAction error:", e);
        showToast(STATE.lang === "zh-TW" ? "操作失敗，請檢查網路" : "Action failed, check your network", "error");
      }
      return false;
    }
    window.adminTournamentAction = adminTournamentAction;

    async function setClubPasswordDB(clubName, password) {
      if (!clubName || !clubName.trim()) return false;
      const key = clubName.trim();
      const safeKey = encodeClubKey(key);
      const hasPassword = !!password;

      // 1. 經由後端寫入密碼（需要目前密碼或 Master PIN），再同步 clubs_metadata 的 hasPassword 標記
      const ok = await callManageClubPassword({
        action: password ? "set" : "remove",
        clubName: key,
        newPassword: password || "",
        credential: getClubCredential(key)
      });
      if (!ok) return false;
      if (password) _verifiedClubCreds.set(key, password);
      else _verifiedClubCreds.delete(key);

      if (STATE.db) {
        try {
          await update(ref(STATE.db, `clubs_metadata/${safeKey}`), { hasPassword });
        } catch (e) {
          console.error("setClubPassword metadata error:", e);
        }
      }

      // 2. 同步本地中繼快取
      if (!STATE.clubsMetadataMap) STATE.clubsMetadataMap = {};
      if (!STATE.clubsMetadataMap[safeKey]) STATE.clubsMetadataMap[safeKey] = {};
      STATE.clubsMetadataMap[safeKey].hasPassword = hasPassword;
      if (!STATE.clubsMetadataMap[key]) STATE.clubsMetadataMap[key] = {};
      STATE.clubsMetadataMap[key].hasPassword = hasPassword;
      safeSetLocal("pb_clubs_metadata", JSON.stringify(STATE.clubsMetadataMap));

      if (hasPassword) {
        STATE.authenticatedClubs.add(key);
      } else {
        STATE.authenticatedClubs.delete(key);
      }
      return true;
    }

    async function checkClubHasPassword(clubName) {
      if (!clubName || !clubName.trim()) return false;
      const cleanClub = clubName.trim();
      const safeKey = encodeClubKey(cleanClub);

      // 1. 記憶體中繼快取
      if (STATE.clubsMetadataMap) {
        const m = STATE.clubsMetadataMap[safeKey] || STATE.clubsMetadataMap[cleanClub];
        if (m && typeof m.hasPassword === "boolean") return m.hasPassword;
      }

      // 2. 本地 pb_clubs_metadata 快取
      try {
        const localMeta = JSON.parse(localStorage.getItem("pb_clubs_metadata") || "{}");
        const lm = localMeta[safeKey] || localMeta[cleanClub];
        if (lm && typeof lm.hasPassword === "boolean") return lm.hasPassword;
      } catch (e) {}

      // 3. 本地 pb_club_passwords 雜湊庫
      try {
        const localPwds = JSON.parse(localStorage.getItem("pb_club_passwords") || "{}");
        if (localPwds[safeKey] || localPwds[cleanClub]) return true;
      } catch (e) {}

      // 4. Firebase RTDB 即時讀取 clubs_metadata (精準判定，不依賴後端函式)
      if (STATE.db) {
        try {
          const snap = await get(ref(STATE.db, `clubs_metadata/${safeKey}/hasPassword`));
          if (snap.exists()) {
            const hasPwd = !!snap.val();
            if (!STATE.clubsMetadataMap) STATE.clubsMetadataMap = {};
            if (!STATE.clubsMetadataMap[safeKey]) STATE.clubsMetadataMap[safeKey] = {};
            STATE.clubsMetadataMap[safeKey].hasPassword = hasPwd;
            return hasPwd;
          }
        } catch (e) {
          console.warn("[Auth] RTDB read hasPassword error:", e);
        }
      }

      return false;
    }
    window.checkClubHasPassword = checkClubHasPassword;

    async function verifyClubAccess(clubName, forcePrompt = false) {
      if (!clubName || !clubName.trim()) return true;
      if (STATE.isAdmin) return true;
      const cleanClub = clubName.trim();
      const safeKey = encodeClubKey(cleanClub);

      // 檢查該社團是否有密碼保護
      const hasPwd = await checkClubHasPassword(cleanClub);

      // 若該社團未設定密碼保護，直接放行
      if (!hasPwd) {
        STATE.authenticatedClubs.add(cleanClub);
        return true;
      }

      // 若非強制特權操作且此工作階段已認證通過，直接放行
      if (!forcePrompt && STATE.authenticatedClubs.has(cleanClub)) {
        return true;
      }

      const promptMsg = t("clubPasswordPrompt").replace("{club}", cleanClub);
      const input = prompt(promptMsg);
      if (input === null) return false;
      const cleanInput = input.trim();
      if (!cleanInput) {
        showToast(t("clubPasswordWrong"), "error");
        return false;
      }

      // 1. 優先呼叫後端 Cloud Function (傳入完整 clubName 與 password)
      try {
        const res = await fetch(`${FUNCTIONS_BASE_URL}/verifyClubPassword`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clubName: cleanClub, password: cleanInput })
        });
        if (res.status === 429) {
          showToast(STATE.lang === "zh-TW" ? "嘗試次數過多，請 15 分鐘後再試" : "Too many attempts, try again in 15 minutes", "error");
          return false;
        }
        if (res.ok) {
          const data = await res.json();
          if (data.valid === true) {
            STATE.authenticatedClubs.add(cleanClub);
            _verifiedClubCreds.set(cleanClub, cleanInput);
            return true;
          }
        }
      } catch (err) {
        console.warn("[Auth] Backend verification failed:", err);
      }

      // 密碼只由後端驗證（不在瀏覽器比對，避免被繞過）
      showToast(t("clubPasswordWrong"), "error");
      return false;
    }

    // ----------------------------------------------------
    // FEATURE 2: ADMIN PAGE
    // ----------------------------------------------------
    async function navigateToAdmin() {
      const currentIsAdmin = (typeof window.getIsAdmin === "function")
        ? window.getIsAdmin()
        : !!STATE.isAdmin;

      if (currentIsAdmin) {
        if (typeof navigateTo === "function") navigateTo("admin");
        if (typeof renderAdminPage === "function") renderAdminPage();
        return;
      }

      const pin = prompt(t("adminPinPrompt"));
      if (pin === null) return;
      const cleanPin = pin.trim();
      if (!cleanPin) {
        showToast(t("adminPinWrong"), "error");
        return;
      }

      let isAuthed = false;

      // 1. 優先嘗試呼叫後端 Cloud Function 安全驗證 Master PIN
      try {
        const res = await fetch(`${FUNCTIONS_BASE_URL}/verifyAdminPin`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: cleanPin })
        });
        if (res.status === 429) {
          showToast(STATE.lang === "zh-TW" ? "嘗試次數過多，請 15 分鐘後再試" : "Too many attempts, try again in 15 minutes", "error");
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (data && data.valid) {
            isAuthed = true;
            _adminPinCred = cleanPin;
          }
        }
      } catch (err) {
        console.warn("[Auth] Backend admin pin verification error:", err);
      }

      if (isAuthed) {
        if (typeof window.setIsAdmin === "function") {
          window.setIsAdmin(true);
        } else if (typeof setIsAdmin === "function") {
          setIsAdmin(true);
        }
        if (typeof populateNavClubSelect === "function") populateNavClubSelect();
        if (typeof navigateTo === "function") navigateTo("admin");
        if (typeof renderAdminPage === "function") renderAdminPage();
        return;
      }

      showToast(t("adminPinWrong"), "error");
    }
    window.navigateToAdmin = navigateToAdmin;

    async function renderAdminPage() {
      const container = document.getElementById("admin-content");
      if (!container) return;

      // 管理員頁面需要全部賽事（其他頁面只下載近期或單一社團），進入時才完整讀取一次
      if (STATE.db) {
        try {
          const snap = await get(ref(STATE.db, "tournaments"));
          STATE.allTournamentsCache = Object.values(snap.val() || {});
        } catch (e) {
          console.warn("[Admin] load all tournaments error:", e);
        }
      }

      const allT = STATE.allTournamentsCache || [];

      // 獲取全站所有社團（管理員專屬全集：賽事 + 成員庫 + 密碼庫 + 隱私中繼資料）
      const clubsSet = new Set();
      allT.forEach(t => { if (t.clubName && t.clubName.trim()) clubsSet.add(t.clubName.trim()); });
      const localMembers = JSON.parse(localStorage.getItem("pb_club_members") || "{}");
      Object.keys(localMembers).forEach(c => { if (c && c.trim()) clubsSet.add(c.trim()); });

      if (STATE.clubPasswordsMap) {
        Object.keys(STATE.clubPasswordsMap).forEach(k => {
          const d = decodeClubKey(k);
          if (d && d.trim()) clubsSet.add(d.trim());
        });
      }
      const localMeta = JSON.parse(localStorage.getItem("pb_clubs_metadata") || "{}");
      Object.keys(localMeta).forEach(k => {
        const d = decodeClubKey(k);
        if (d && d.trim()) clubsSet.add(d.trim());
      });
      if (STATE.clubsMetadataMap) {
        Object.keys(STATE.clubsMetadataMap).forEach(k => {
          const d = decodeClubKey(k);
          if (d && d.trim()) clubsSet.add(d.trim());
        });
      }

      clubsSet.delete("");

      const uniqueClubs = Array.from(clubsSet).sort((a, b) => {
        if (a === "__general__") return 1;
        if (b === "__general__") return -1;
        return a.localeCompare(b, "zh-Hant");
      });

      // Fetch club passwords
      const clubPasswordMap = {};
      for (const club of uniqueClubs) {
        clubPasswordMap[club] = await getClubPassword(club);
      }

      // LINE 綁定：/club_mappings/{社團}/{LINE ID} = 球員名稱
      const bindingsByClub = {};
      const bindingUidsByClub = {};
      const boundLineUsers = new Set();
      if (STATE.db) {
        try {
          const mapSnap = await get(ref(STATE.db, "club_mappings"));
          Object.entries(mapSnap.val() || {}).forEach(([key, users]) => {
            const club = decodeClubKey(key);
            if (!club || !users || typeof users !== "object") return;
            bindingsByClub[club] = Object.values(users).map(n => String(n || "").trim()).filter(Boolean);
            bindingUidsByClub[club] = Object.keys(users);
          });
        } catch (e) {
          console.warn("[Admin] load club_mappings error:", e);
        }
      }
      // 只統計目前存在的社團；已刪除社團留下的綁定另外列出，可一鍵清除
      const orphanBindingClubs = Object.keys(bindingsByClub).filter(c => !uniqueClubs.includes(c));
      const orphanBindingCount = orphanBindingClubs.reduce((acc, c) => acc + bindingsByClub[c].length, 0);
      boundLineUsers.clear();
      let totalBindings = 0;
      Object.keys(bindingsByClub).filter(c => uniqueClubs.includes(c)).forEach(c => {
        totalBindings += bindingsByClub[c].length;
        (bindingUidsByClub[c] || []).forEach(uid => boundLineUsers.add(uid));
      });
      STATE.adminOrphanBindingClubs = orphanBindingClubs;

      // Sort tournaments by date
      const sortedT = [...allT].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // Stats
      const totalTournaments = sortedT.length;
      const totalClubs = uniqueClubs.filter(c => c !== "__general__").length;
      const totalGames = allT.reduce((acc, t) => acc + ((t.matches || []).filter(m => m.completed && !m.voided).length), 0);

      container.innerHTML = `
        <!-- Dashboard Overview Badges -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-4">
          <div class="glass-card rounded-2xl p-3 sm:p-4 border text-center space-y-1">
            <span class="text-[11px] sub-text font-semibold flex items-center justify-center gap-1">
              <i data-lucide="trophy" class="w-3.5 h-3.5 text-emerald-500"></i> ${t("adminStatsTournaments")}
            </span>
            <div class="text-lg sm:text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">${totalTournaments}</div>
          </div>
          <div class="glass-card rounded-2xl p-3 sm:p-4 border text-center space-y-1">
            <span class="text-[11px] sub-text font-semibold flex items-center justify-center gap-1">
              <i data-lucide="shield" class="w-3.5 h-3.5 text-amber-500"></i> ${t("adminStatsClubs")}
            </span>
            <div class="text-lg sm:text-2xl font-black font-mono text-amber-600 dark:text-amber-400">${totalClubs}</div>
          </div>
          <div class="glass-card rounded-2xl p-3 sm:p-4 border text-center space-y-1">
            <span class="text-[11px] sub-text font-semibold flex items-center justify-center gap-1">
              <i data-lucide="swords" class="w-3.5 h-3.5 text-orange-500"></i> ${t("adminStatsGames")}
            </span>
            <div class="text-lg sm:text-2xl font-black font-mono text-orange-600 dark:text-orange-400">${totalGames}</div>
          </div>
          <div class="glass-card rounded-2xl p-3 sm:p-4 border text-center space-y-1">
            <span class="text-[11px] sub-text font-semibold flex items-center justify-center gap-1">
              <i data-lucide="link" class="w-3.5 h-3.5 text-[#06C755]"></i> ${STATE.lang === "zh-TW" ? "LINE 綁定" : "LINE Bindings"}
            </span>
            <div class="text-lg sm:text-2xl font-black font-mono text-[#06C755]">${totalBindings}</div>
            <div class="text-[10px] sub-text">${STATE.lang === "zh-TW" ? `來自 ${boundLineUsers.size} 個 LINE 帳號` : `from ${boundLineUsers.size} LINE accounts`}</div>
            ${orphanBindingCount > 0 ? `
              <button type="button" onclick="adminCleanupOrphanBindings()" class="mt-1 text-[10px] font-bold text-rose-500 hover:underline cursor-pointer">
                ${STATE.lang === "zh-TW" ? `清除已刪除社團的殘留綁定 ${orphanBindingCount} 筆` : `Clean up ${orphanBindingCount} leftover bindings`}
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Club Management Section (Rename / Password / Members) -->
        <div class="glass-card rounded-2xl p-4 sm:p-5 border space-y-3">
          <h3 class="text-sm font-bold font-display flex items-center gap-1.5">${t("adminClubSection")}</h3>
          ${uniqueClubs.length === 0
          ? `<p class="text-xs sub-text">${STATE.lang === "zh-TW" ? "尚無社團" : "No clubs found"}</p>`
          : uniqueClubs.map(club => {
            const isGeneral = club === "__general__";
            const displayName = isGeneral ? (STATE.lang === "zh-TW" ? "臨打通用成員庫" : "General / Casual Roster") : club;
            const hasPwd = !!clubPasswordMap[club];
            const isPrivate = typeof isClubPrivate === "function" && isClubPrivate(club);
            const members = getClubMembersList(club);
            const boundNames = bindingsByClub[club] || [];
            const escapedClub = safeEscape(club);
            const safeClubId = encodeURIComponent(club).replace(/[^A-Za-z0-9]/g, "_");
            return `
              <div class="p-3 rounded-xl card-inner border space-y-2.5 ${isGeneral ? 'border-emerald-500/30 bg-emerald-500/5' : ''}">
                <!-- Row 1: Club Header, Badges & Actions -->
                <div class="flex items-center justify-between gap-2 flex-wrap">
                  <div class="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                    <i data-lucide="${isGeneral ? 'globe' : 'shield'}" class="w-4 h-4 ${isGeneral ? 'text-emerald-500' : 'text-amber-500'} shrink-0"></i>
                    <span class="text-xs sm:text-sm font-bold">${escapeHTML(displayName)}</span>
                    ${!isGeneral ? `
                      <span class="text-[10px] px-1.5 py-0.5 rounded font-mono ${isPrivate ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'}">
                        ${isPrivate ? (STATE.lang === 'zh-TW' ? '🔒 私密' : '🔒 Private') : (STATE.lang === 'zh-TW' ? '🌐 公開' : '🌐 Public')}
                      </span>
                      <span class="text-[10px] px-1.5 py-0.5 rounded font-mono ${hasPwd ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' : 'bg-stone-500/10 sub-text border'}">
                        ${hasPwd ? t("adminHasPassword") : t("adminNoPassword")}
                      </span>
                      <span class="text-[10px] px-1.5 py-0.5 rounded font-mono ${boundNames.length > 0 ? 'bg-[#06C755]/10 text-[#06C755] border border-[#06C755]/30' : 'bg-stone-500/10 sub-text border'}">
                        ${STATE.lang === 'zh-TW' ? `LINE 綁定 ${boundNames.length}/${members.length}` : `LINE ${boundNames.length}/${members.length}`}
                      </span>
                    ` : `<span class="text-[10px] px-1.5 py-0.5 rounded font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">${STATE.lang === 'zh-TW' ? '臨打通用' : 'General'}</span>`}
                  </div>
                  <div class="flex items-center gap-1 sm:gap-1.5 flex-wrap">
                    ${!isGeneral ? `
                    <button onclick="adminEnterClub('${escapedClub}')" class="px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/30 rounded-lg text-[11px] flex items-center gap-1 transition shadow-sm active:scale-95 cursor-pointer" title="進入社團大廳">
                      <i data-lucide="external-link" class="w-3 h-3"></i>
                      <span>${STATE.lang === "zh-TW" ? "進入大廳" : "Enter Club"}</span>
                    </button>
                    <button onclick="adminRenameClub('${escapedClub}')" class="px-2.5 py-1 card-inner border hover:border-emerald-500 text-stone-700 dark:text-stone-300 font-bold rounded-lg text-[11px] flex items-center gap-1 transition shadow-sm active:scale-95 cursor-pointer" title="Rename Club">
                      ${t("adminRenameBtn")}
                    </button>
                    <button onclick="adminDeleteClub('${escapedClub}')" class="px-2 py-1 border border-rose-500/30 text-rose-500 hover:bg-rose-500/10 font-bold rounded-lg text-[11px] transition shadow-sm active:scale-95 cursor-pointer" title="刪除社團">
                      <i data-lucide="trash-2" class="w-3 h-3"></i>
                    </button>` : `
                    <button onclick="navigateTo('hub')" class="px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/30 rounded-lg text-[11px] flex items-center gap-1 transition shadow-sm active:scale-95 cursor-pointer">
                      <i data-lucide="compass" class="w-3 h-3"></i>
                      <span>${STATE.lang === "zh-TW" ? "返回臨打活動" : "Go to Drop-in Games"}</span>
                    </button>
                    `}
                    <button onclick="adminToggleClubMembers('${safeClubId}')" class="px-2.5 py-1 card-inner border hover:border-blue-500 text-blue-600 dark:text-blue-400 font-bold rounded-lg text-[11px] flex items-center gap-1 transition shadow-sm active:scale-95 cursor-pointer">
                      ${t("adminMembersBtn")} (${members.length})
                    </button>
                  </div>
                </div>

                ${!isGeneral ? `
                <!-- Row 2: Password Management -->
                <div class="flex items-center justify-between gap-2 pt-1 border-t border-stone-200 dark:border-slate-800/60 text-xs flex-wrap">
                  <span class="sub-text text-[11px] flex items-center gap-1"><i data-lucide="key" class="w-3 h-3 text-amber-500"></i> ${STATE.lang === "zh-TW" ? "社團密碼：" : "Password:"}</span>
                  <div class="flex items-center gap-1.5 flex-1 justify-end max-w-sm">
                    <input type="password" id="admin-pwd-${safeClubId}" placeholder="${t("adminNewPassword")}"
                      class="w-28 sm:w-32 input-bg border rounded-lg px-2.5 py-1 text-xs focus:border-amber-500 focus:outline-none" />
                    <button onclick="adminSetClubPassword('${escapedClub}', '${safeClubId}')" class="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-white dark:text-slate-950 font-bold rounded-lg text-[11px] transition shadow-sm">${hasPwd ? t("adminChangePassword") : t("adminSetPassword")}</button>
                    ${hasPwd ? `<button onclick="adminRemoveClubPassword('${escapedClub}')" class="px-2 py-1 border border-rose-500/30 text-rose-500 hover:bg-rose-500/10 font-bold rounded-lg text-[11px] transition">${t("adminRemovePassword")}</button>` : ''}
                  </div>
                </div>` : ''}

                <!-- Row 3: Collapsible Member Management Drawer -->
                <div id="admin-members-wrap-${safeClubId}" class="hidden pt-2 border-t border-stone-200 dark:border-slate-800/60 space-y-2">
                  <div class="flex items-center justify-between text-[11px] font-bold sub-text">
                    <span>👥 ${STATE.lang === "zh-TW" ? "常用成員名單（🔗 已綁定 LINE；點 ✕ 移除）：" : "Saved Members (🔗 LINE bound; click ✕ to remove):"}</span>
                  </div>
                  <!-- Chips List -->
                  <div class="flex flex-wrap gap-1.5 p-2 rounded-xl bg-stone-500/5 border border-dashed border-stone-300 dark:border-slate-800 min-h-[32px] items-center">
                    ${members.length === 0
                ? `<span class="sub-text text-[11px] italic py-0.5">${t("adminNoMembers")}</span>`
                : members.map(m => {
                  const escapedM = safeEscape(m);
                  return `
                          <div class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                            ${boundNames.includes(m) ? `<i data-lucide="link" class="w-3 h-3 text-[#06C755]" title="${STATE.lang === 'zh-TW' ? '已綁定 LINE' : 'LINE bound'}"></i>` : ''}
                            <span>${escapeHTML(m)}</span>
                            <button type="button" onclick="adminRemoveMember('${escapedClub}', '${escapedM}')" class="ml-0.5 opacity-60 hover:opacity-100 hover:text-rose-500 transition text-[11px]">✕</button>
                          </div>
                        `;
                }).join("")
              }
                  </div>
                  <!-- Quick Add Input -->
                  <div class="flex items-center gap-1.5 pt-1">
                    <input type="text" id="admin-add-member-input-${safeClubId}" placeholder="${t("adminAddMemberPlaceholder")}"
                      class="flex-1 input-bg border rounded-lg px-2.5 py-1.5 text-xs focus:border-emerald-500 focus:outline-none"
                      onkeydown="if(event.key==='Enter' && !event.isComposing){event.preventDefault(); adminAddMember('${escapedClub}', '${safeClubId}');}" />
                    <button type="button" onclick="adminAddMember('${escapedClub}', '${safeClubId}')"
                      class="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-white dark:text-slate-950 font-bold rounded-lg text-xs transition shadow-sm active:scale-95">
                      ${t("adminAddMemberBtn")}
                    </button>
                  </div>
                </div>
              </div>`;
          }).join("")
        }
        </div>

        <!-- Tournament Management -->
        <div class="glass-card rounded-2xl p-4 sm:p-5 border space-y-3">
          <h3 class="text-sm font-bold font-display flex items-center gap-1.5">${t("adminTournamentSection")}</h3>
          <div class="space-y-2 max-h-[400px] overflow-y-auto">
            ${sortedT.map(tData => {
          const total = tData.matches ? tData.matches.length : 0;
          const done = tData.matches ? tData.matches.filter(m => m.completed).length : 0;
          const isFinished = total > 0 && done === total;
          const clubBadge = tData.clubName ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">${escapeHTML(tData.clubName)}</span>` : '';
          return `
              <div class="flex items-center justify-between gap-2 py-2 border-b border-stone-200 dark:border-slate-800/50 last:border-0">
                <div class="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                  <span class="text-[10px] font-mono font-bold card-inner px-1.5 py-0.5 rounded border text-emerald-600 dark:text-emerald-400">${escapeHTML(tData.id)}</span>
                  ${clubBadge}
                  <span class="text-xs font-semibold truncate">${escapeHTML(tData.name)}</span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded font-medium ${isFinished ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-orange-500/10 text-orange-600 dark:text-orange-400'} border">${isFinished ? '🏆' : '🔥'} ${done}/${total}</span>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <button onclick="adminRenameTournament('${escapeJsAttr(tData.id)}', '${escapeJsAttr(tData.name || '')}')" class="p-1.5 rounded-lg card-inner hover:bg-emerald-500/20 sub-text hover:text-emerald-500 border transition" title="${STATE.lang === 'zh-TW' ? '修改賽事名稱' : 'Rename Tournament'}">
                    <i data-lucide="edit-3" class="w-3 h-3"></i>
                  </button>
                  ${!isFinished ? `<button onclick="adminForceComplete('${escapeJsAttr(tData.id)}')" class="px-2 py-1 border border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 font-bold rounded-lg text-[11px] transition">${t("adminForceComplete")}</button>` : ''}
                  <button onclick="deleteTournament('${escapeJsAttr(tData.id)}')" class="p-1.5 rounded-lg card-inner hover:bg-rose-500/20 sub-text hover:text-rose-500 border transition">
                    <i data-lucide="trash-2" class="w-3 h-3"></i>
                  </button>
                </div>
              </div>`;
        }).join("")}
          </div>
        </div>
      `;

      lucide.createIcons();
    }

    async function adminRenameClub(oldName) {
      const promptMsg = STATE.lang === "zh-TW"
        ? `✏️ 請輸入社團「${oldName}」的新名稱：`
        : `✏️ Enter new name for club "${oldName}":`;
      const newName = prompt(promptMsg, oldName);
      if (newName === null) return;
      const cleanNew = newName.trim();
      if (!cleanNew || cleanNew === oldName) return;

      // 1. Update all tournaments in Firebase via Atomic Multi-Path Update and Local Cache
      const allT = STATE.allTournamentsCache || [];
      const updates = {};
      for (const t of allT) {
        if (t.clubName === oldName) {
          t.clubName = cleanNew;
          updates[`tournaments/${t.id}/clubName`] = cleanNew;
        }
      }
      if (Object.keys(updates).length > 0 && STATE.db) {
        try {
          await update(ref(STATE.db), updates);
        } catch (e) {
          console.error("Update tournament clubName error:", e);
        }
      }

      // Update local tournaments cache
      const localT = JSON.parse(localStorage.getItem("pb_tournaments") || "{}");
      Object.values(localT).forEach(t => {
        if (t.clubName === oldName) t.clubName = cleanNew;
      });
      safeSetLocal("pb_tournaments", JSON.stringify(localT));

      // 2. Migrate club password status（經由後端把密碼搬到新名稱，避免改名後密碼失效）
      const hadPwd = hasClubPassword(oldName);
      if (hadPwd) {
        await callManageClubPassword({
          action: "rename",
          clubName: oldName,
          newClubName: cleanNew,
          credential: getClubCredential(oldName)
        });
        const newSafeKey = encodeClubKey(cleanNew);
        if (!STATE.clubsMetadataMap) STATE.clubsMetadataMap = {};
        if (!STATE.clubsMetadataMap[newSafeKey]) STATE.clubsMetadataMap[newSafeKey] = {};
        STATE.clubsMetadataMap[newSafeKey].hasPassword = true;
      }

      // 3. Migrate club members list
      const oldMembers = getClubMembersList(oldName);
      if (oldMembers && oldMembers.length > 0) {
        const localMembers = JSON.parse(localStorage.getItem("pb_club_members") || "{}");
        localMembers[cleanNew] = oldMembers;
        delete localMembers[oldName];
        safeSetLocal("pb_club_members", JSON.stringify(localMembers));

        if (STATE.db) {
          try {
            await set(ref(STATE.db, `club_members/${encodeClubKey(cleanNew)}`), oldMembers);
            await remove(ref(STATE.db, `club_members/${encodeClubKey(oldName)}`));
          } catch (e) {
            console.error("Migrate club members error:", e);
          }
        }
      }

      // 4. Migrate club metadata
      const oldSafeKey = encodeClubKey(oldName);
      const newSafeKey = encodeClubKey(cleanNew);
      const localMeta = JSON.parse(localStorage.getItem("pb_clubs_metadata") || "{}");
      const existingMeta = localMeta[oldSafeKey] || localMeta[oldName] || (STATE.clubsMetadataMap && STATE.clubsMetadataMap[oldSafeKey]) || null;
      if (existingMeta) {
        localMeta[newSafeKey] = existingMeta;
        delete localMeta[oldSafeKey];
        delete localMeta[oldName];
        safeSetLocal("pb_clubs_metadata", JSON.stringify(localMeta));

        if (!STATE.clubsMetadataMap) STATE.clubsMetadataMap = {};
        STATE.clubsMetadataMap[newSafeKey] = existingMeta;
        delete STATE.clubsMetadataMap[oldSafeKey];

        if (STATE.db) {
          try {
            await set(ref(STATE.db, `clubs_metadata/${newSafeKey}`), existingMeta);
            await remove(ref(STATE.db, `clubs_metadata/${oldSafeKey}`));
          } catch (e) {
            console.error("Migrate clubs_metadata error:", e);
          }
        }
      }

      // 5. Migrate user myClubs list
      let userMyClubs = JSON.parse(localStorage.getItem("pb_my_clubs") || "[]");
      if (Array.isArray(userMyClubs) && userMyClubs.includes(oldName)) {
        userMyClubs = userMyClubs.map(c => c === oldName ? cleanNew : c);
        localStorage.setItem("pb_my_clubs", JSON.stringify(userMyClubs));
      }
      if (Array.isArray(STATE.myClubs) && STATE.myClubs.includes(oldName)) {
        STATE.myClubs = STATE.myClubs.map(c => c === oldName ? cleanNew : c);
      }
      if (STATE.db && STATE.lineUserId) {
        try {
          const updates = {};
          updates[`users/${STATE.lineUserId}/myClubs/${encodeURIComponent(oldName)}`] = null;
          updates[`users/${STATE.lineUserId}/myClubs/${encodeURIComponent(cleanNew)}`] = true;
          await update(ref(STATE.db), updates);
        } catch (e) { }
      }

      // 6. Update session authenticated clubs
      if (STATE.authenticatedClubs.has(oldName)) {
        STATE.authenticatedClubs.delete(oldName);
        STATE.authenticatedClubs.add(cleanNew);
      }
      if (STATE.currentClub === oldName) {
        STATE.currentClub = cleanNew;
        localStorage.setItem("pb_last_club", cleanNew);
      }
      if (typeof populateNavClubSelect === "function") {
        populateNavClubSelect();
      }
      if (typeof populateCreateClubSelect === "function") {
        populateCreateClubSelect();
      }

      renderAdminPage();
      displayHubTournamentsList(STATE.allTournamentsCache);
      renderHubTournaments();
    }
    window.adminRenameClub = adminRenameClub;

    async function adminEnterClub(clubName) {
      if (!clubName || clubName === "__general__") {
        navigateTo("hub");
        return;
      }
      STATE.authenticatedClubs.add(clubName);
      await openClubSpace(clubName);
    }
    window.adminEnterClub = adminEnterClub;

    function adminToggleClubMembers(safeClubId) {
      const el = document.getElementById(`admin-members-wrap-${safeClubId}`);
      if (el) {
        el.classList.toggle("hidden");
        lucide.createIcons();
      }
    }
    window.adminToggleClubMembers = adminToggleClubMembers;

    function adminAddMember(club, safeClubId) {
      const input = document.getElementById(`admin-add-member-input-${safeClubId}`);
      if (!input) return;
      const raw = input.value.trim();
      if (!raw) return;

      const names = extractPlayerNames(raw);
      if (names.length === 0) return;

      const members = getClubMembersList(club);
      names.forEach(n => {
        if (!members.includes(n)) members.push(n);
      });

      saveClubMembersList(club, members);
      input.value = "";
      renderAdminPage();
    }
    window.adminAddMember = adminAddMember;

    function adminRemoveMember(club, memberName) {
      let members = getClubMembersList(club);
      members = members.filter(m => m !== memberName);
      saveClubMembersList(club, members);
      renderAdminPage();
    }
    window.adminRemoveMember = adminRemoveMember;

    async function adminSetClubPassword(club, safeClubId) {
      const input = document.getElementById(`admin-pwd-${safeClubId}`);
      if (!input) return;
      const pwd = input.value.trim();
      if (!pwd) {
        showToast(STATE.lang === "zh-TW" ? "請輸入密碼" : "Please enter a password", "warning");
        return;
      }
      if (!(await setClubPasswordDB(club, pwd))) return;
      input.value = "";
      renderAdminPage();
    }
    window.adminSetClubPassword = adminSetClubPassword;

    async function adminRemoveClubPassword(club) {
      if (!(await setClubPasswordDB(club, null))) return;
      STATE.authenticatedClubs.delete(club);
      renderAdminPage();
    }
    window.adminRemoveClubPassword = adminRemoveClubPassword;

    async function adminDeleteClub(clubName) {
      if (!clubName || clubName === '__general__') return;
      const confirmMsg = STATE.lang === 'zh-TW'
        ? `確定要刪除社團「${clubName}」嗎？\n此操作會徹底移除該社團的賽事關聯、成員名單、密碼、中繼資料與常用記錄，且無法復原。`
        : `Delete club "${clubName}"?\nThis will remove all tournaments, members, passwords, metadata, and shortcuts permanently.`;
      if (!confirm(confirmMsg)) return;

      const safeKey = typeof encodeClubKey === "function" ? encodeClubKey(clubName) : encodeURIComponent(clubName);

      // 1. 解除快取與本地賽事的社團關聯，消除賽事關聯幽靈
      const updates = {};
      const allT = STATE.allTournamentsCache || [];
      allT.forEach(t => {
        if (t && t.clubName === clubName) {
          t.clubName = "";
          updates[`tournaments/${t.id}/clubName`] = "";
        }
      });

      const localT = safeGetLocalJSON("pb_tournaments", {});
      Object.values(localT).forEach(t => {
        if (t && t.clubName === clubName) t.clubName = "";
      });
      safeSetLocal("pb_tournaments", localT);

      // 2. 本地儲存徹底清理 (成員庫、密碼庫、Metadata庫、常用社團、最後造訪)
      const members = safeGetLocalJSON('pb_club_members', {});
      delete members[clubName];
      delete members[safeKey];
      safeSetLocal('pb_club_members', members);

      const passwords = safeGetLocalJSON('pb_club_passwords', {});
      delete passwords[clubName];
      delete passwords[safeKey];
      safeSetLocal('pb_club_passwords', passwords);

      const metadata = safeGetLocalJSON('pb_clubs_metadata', {});
      delete metadata[clubName];
      delete metadata[safeKey];
      safeSetLocal('pb_clubs_metadata', metadata);

      let myClubs = safeGetLocalJSON('pb_my_clubs', []);
      if (Array.isArray(myClubs)) {
        myClubs = myClubs.filter(c => c !== clubName);
        safeSetLocal('pb_my_clubs', myClubs);
      }
      if (Array.isArray(STATE.myClubs)) {
        STATE.myClubs = STATE.myClubs.filter(c => c !== clubName);
      }

      const lastClub = localStorage.getItem("pb_last_club");
      if (lastClub === clubName) {
        localStorage.removeItem("pb_last_club");
      }

      // 3. 記憶體狀態清除
      if (STATE.clubsMetadataMap) {
        delete STATE.clubsMetadataMap[safeKey];
        delete STATE.clubsMetadataMap[clubName];
      }
      if (STATE.clubPasswordsMap) {
        delete STATE.clubPasswordsMap[safeKey];
        delete STATE.clubPasswordsMap[clubName];
      }
      STATE.authenticatedClubs.delete(clubName);
      if (STATE.currentClub === clubName) {
        STATE.currentClub = null;
      }

      // 4. Firebase 雲端徹底清除 (包含 members, passwords, metadata, user myClubs)
      if (STATE.db) {
        try {
          if (Object.keys(updates).length > 0) {
            await update(ref(STATE.db), updates);
          }
          await remove(ref(STATE.db, `club_members/${safeKey}`));
          // LINE 綁定一併清除，並從綁定者的「我的社團」移除，避免留下殘留資料
          try {
            const mapSnap = await get(ref(STATE.db, `club_mappings/${safeKey}`));
            const boundUids = Object.keys(mapSnap.val() || {});
            for (const uid of boundUids) {
              await remove(ref(STATE.db, `users/${uid}/myClubs/${encodeURIComponent(clubName)}`));
            }
            await remove(ref(STATE.db, `club_mappings/${safeKey}`));
          } catch (mapErr) {
            console.warn("adminDeleteClub club_mappings cleanup error:", mapErr);
          }
          if (hasClubPassword(clubName)) {
            await callManageClubPassword({ action: "remove", clubName, credential: getClubCredential(clubName) });
          }
          await remove(ref(STATE.db, `clubs_metadata/${safeKey}`));

          if (STATE.lineUserId) {
            await remove(ref(STATE.db, `users/${STATE.lineUserId}/myClubs/${encodeURIComponent(clubName)}`));
          }
        } catch (e) {
          console.error('adminDeleteClub Firebase error:', e);
        }
      }

      // 5. 重新渲染導覽列下拉選單與建立賽事下拉選單
      if (typeof populateNavClubSelect === "function") {
        populateNavClubSelect();
      }
      if (typeof populateCreateClubSelect === "function") {
        populateCreateClubSelect();
      }

      renderAdminPage();
    }
    window.adminDeleteClub = adminDeleteClub;

    // 清除已刪除社團留下的 LINE 綁定（club_mappings）與綁定者「我的社團」裡的殘留項目
    async function adminCleanupOrphanBindings() {
      const clubs = Array.isArray(STATE.adminOrphanBindingClubs) ? STATE.adminOrphanBindingClubs : [];
      if (!STATE.db || clubs.length === 0) return;
      const isZh = STATE.lang === "zh-TW";
      const msg = isZh
        ? `確定清除以下已刪除社團的殘留綁定嗎？\n\n${clubs.join("、")}\n\n（不影響任何賽事與戰績）`
        : `Clean up leftover bindings of deleted clubs?\n\n${clubs.join(", ")}`;
      if (!confirm(msg)) return;
      try {
        for (const club of clubs) {
          const safeKey = encodeClubKey(club);
          const snap = await get(ref(STATE.db, `club_mappings/${safeKey}`));
          for (const uid of Object.keys(snap.val() || {})) {
            await remove(ref(STATE.db, `users/${uid}/myClubs/${encodeURIComponent(club)}`));
          }
          await remove(ref(STATE.db, `club_mappings/${safeKey}`));
        }
        showToast(isZh ? "✅ 已清除殘留綁定" : "✅ Leftover bindings removed", "success");
      } catch (e) {
        console.error("adminCleanupOrphanBindings error:", e);
        showToast(isZh ? "❌ 清除失敗，請稍後再試" : "❌ Cleanup failed", "error");
      }
      renderAdminPage();
    }
    window.adminCleanupOrphanBindings = adminCleanupOrphanBindings;

    // 掛載歷史頁面渲染與社團存取核心函式至全域 window
    window.renderHistoryCategorized = renderHistoryCategorized;
    window.renderHistoryClubAggregate = renderHistoryClubAggregate;
    window.renderHistoryTournamentCards = renderHistoryTournamentCards;
    window.populateHistoryMonthSelect = populateHistoryMonthSelect;
    window.verifyClubAccess = verifyClubAccess;
    window.encodeClubKey = encodeClubKey;
    window.safeEscape = safeEscape;
    window.renderAdminPage = renderAdminPage;
    window.getClubPassword = getClubPassword;
    window.setClubPasswordDB = setClubPasswordDB;
    window.checkClubHasPassword = checkClubHasPassword;
