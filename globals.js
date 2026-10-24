// ============================================================
// ZEROZEROTWO - CROSS-MODULE GLOBAL BRIDGE & HELPERS (globals.js)
// 提供所有拆分模組統一的跨模組函式轉發與動態 STATE 代理，杜絕 ReferenceError
// ============================================================

// 1. 動態代理 STATE，永遠即時指向 window.STATE
export const STATE = new Proxy({}, {
  get(target, prop) {
    if (typeof window !== "undefined" && window.STATE) {
      return window.STATE[prop];
    }
    return target[prop];
  },
  set(target, prop, value) {
    if (typeof window !== "undefined" && window.STATE) {
      window.STATE[prop] = value;
      return true;
    }
    target[prop] = value;
    return true;
  }
});

// 2. Cloud Functions URL (動態判定本地與雲端)
export const FUNCTIONS_BASE_URL = (typeof window !== "undefined" && window.FUNCTIONS_BASE_URL)
  ? window.FUNCTIONS_BASE_URL
  : (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
      ? "http://127.0.0.1:5001/pickleball-hub-d0ab1/asia-southeast1"
      : "https://asia-southeast1-pickleball-hub-d0ab1.cloudfunctions.net");

// 3. 通用 UI 與導航安全轉發函式
export const t = (key) => (typeof window !== "undefined" && typeof window.t === "function" ? window.t(key) : key);

export const showToast = (msg, type = "info", duration = 3500) => {
  if (typeof window !== "undefined" && typeof window.showToast === "function") {
    return window.showToast(msg, type, duration);
  }
  console.log(`[Toast ${type}]`, msg);
};

export const navigateTo = (page, push = true) => {
  if (typeof window !== "undefined" && typeof window.navigateTo === "function") {
    return window.navigateTo(page, push);
  }
};

export const loadLiveTournament = (...args) => {
  if (typeof window !== "undefined" && typeof window.loadLiveTournament === "function") {
    return window.loadLiveTournament(...args);
  }
};

export const enterTournament = (...args) => {
  if (typeof window !== "undefined" && typeof window.enterTournament === "function") {
    return window.enterTournament(...args);
  }
};

export const deleteTournament = (...args) => {
  if (typeof window !== "undefined" && typeof window.deleteTournament === "function") {
    return window.deleteTournament(...args);
  }
};

export const isTransientPlayer = (name) => {
  if (typeof window !== "undefined" && typeof window.isTransientPlayer === "function") {
    return window.isTransientPlayer(name);
  }
  return false;
};

export const renderLiveUI = (...args) => {
  if (typeof window !== "undefined" && typeof window.renderLiveUI === "function") {
    return window.renderLiveUI(...args);
  }
};

export const renderHistoryPage = (...args) => {
  if (typeof window !== "undefined" && typeof window.renderHistoryPage === "function") {
    return window.renderHistoryPage(...args);
  }
};

export const renderHubTournaments = (...args) => {
  if (typeof window !== "undefined" && typeof window.renderHubTournaments === "function") {
    return window.renderHubTournaments(...args);
  }
};

export const displayHubTournamentsList = (...args) => {
  if (typeof window !== "undefined" && typeof window.displayHubTournamentsList === "function") {
    return window.displayHubTournamentsList(...args);
  }
};

export const verifyClubAccess = (...args) => {
  if (typeof window !== "undefined" && typeof window.verifyClubAccess === "function") {
    return window.verifyClubAccess(...args);
  }
  return true;
};

export const openClubSpace = (...args) => {
  if (typeof window !== "undefined" && typeof window.openClubSpace === "function") {
    return window.openClubSpace(...args);
  }
};

export const openLineLoginPromptModal = (...args) => {
  if (typeof window !== "undefined" && typeof window.openLineLoginPromptModal === "function") {
    return window.openLineLoginPromptModal(...args);
  }
};

export const addUserClubToFirebase = (...args) => {
  if (typeof window !== "undefined" && typeof window.addUserClubToFirebase === "function") {
    return window.addUserClubToFirebase(...args);
  }
};

export const getAllUniqueClubs = (...args) => {
  if (typeof window !== "undefined" && typeof window.getAllUniqueClubs === "function") {
    return window.getAllUniqueClubs(...args);
  }
  return [];
};

export const encodeClubKey = (name) => {
  if (typeof window !== "undefined" && typeof window.encodeClubKey === "function") {
    return window.encodeClubKey(name);
  }
  return encodeURIComponent(String(name || "").trim());
};

export { escapeJsAttr as safeEscape } from "./utils.js?v=20261024-12";

export const saveToLocalTournaments = (...args) => {
  if (typeof window !== "undefined" && typeof window.saveToLocalTournaments === "function") {
    return window.saveToLocalTournaments(...args);
  }
};

export const addMyTournamentId = (...args) => {
  if (typeof window !== "undefined" && typeof window.addMyTournamentId === "function") {
    return window.addMyTournamentId(...args);
  }
};

export const addCreatedTournamentId = (...args) => {
  if (typeof window !== "undefined" && typeof window.addCreatedTournamentId === "function") {
    return window.addCreatedTournamentId(...args);
  }
};

export const populateCreateClubSelect = (...args) => {
  if (typeof window !== "undefined" && typeof window.populateCreateClubSelect === "function") {
    return window.populateCreateClubSelect(...args);
  }
};

export const populateNavClubSelect = (...args) => {
  if (typeof window !== "undefined" && typeof window.populateNavClubSelect === "function") {
    return window.populateNavClubSelect(...args);
  }
};

export const isTournamentFinished = (t) => {
  if (typeof window !== "undefined" && typeof window.isTournamentFinished === "function") {
    return window.isTournamentFinished(t);
  }
  return !!(t && (t.status === "finished" || t.isFinished));
};
