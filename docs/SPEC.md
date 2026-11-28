# ZeroZeroTwo 專案規範

> 這份文件記錄網站的設計、配色、元件、頁面結構、Firebase 資料格式與核心規則。
> 新增功能或修改畫面前先看這份；改完之後，如果規則變了，也要回來更新這份。
> 最後更新：2026-11-28
>
> - 設計哲學與歷次決策的來龍去脈：見 `AGENTS.md`
> - 圖文選單、分享預覽圖的設計原始檔：在 claude.ai 專案知識庫（`claude/richmenu_compact_2500x843.html`、`claude/og_image_1200x630.html`）

---

## 目錄

1. 產品定位與設計原則
2. 用詞規範（中文／英文）
3. 視覺設計：配色、字型、形狀、圖示
4. 元件規範
5. 頁面結構與導覽
6. 程式架構
7. Firebase 資料規範
8. 後端程式（Cloud Functions）
9. 核心業務邏輯
10. 部署與發布流程

---

## 1. 產品定位與設計原則

**一句話：** 匹克球的排賽、記分、即時排名工具。球友在 LINE 群組點連結就能用，不用下載 App，也不用註冊。

**網站無人管理。** 所有事情都要能讓使用者在畫面上自己完成，不需要找管理員。

| 原則 | 意思 | 實際做法 |
|---|---|---|
| **零摩擦** | 點開就能用，越少步驟越好 | 不登入也能看、能報名、能記分；登入只用 LINE 一鍵 |
| **全開放信任** | 比賽是大家的，現場誰都能幫忙 | 比賽的建立、記分、加人、結束、刪除未結束的比賽，都不需要密碼，只跳確認 |
| **密碼只管社團** | 社團密碼是「社團管理者的鑰匙」 | 只保護社團名稱、創建人、簡介、公開設定、密碼本身 |
| **戰績要保護** | 打完的結果不能被亂改 | 比賽結束後資料庫整場鎖住；已結束的比賽只有管理員能刪 |
| **主入口是賽事連結** | 大多數人從 LINE 群組的連結直接進比賽，不是從首頁 | 重要功能（☆ 關注、文字賽報、賽事連結）都放在賽事頁 |
| **極簡一致** | 畫面乾淨、用詞統一 | 不加多餘圖示、文字精簡、提示統一綠色 |
| **效能優先** | 手機打開要快 | 先顯示手機裡暫存的資料，再背景更新；圖示只掃描局部畫面 |

---

## 2. 用詞規範

### 中文

| 指的東西 | 標準用詞 | 避免 |
|---|---|---|
| 一整場活動 | **賽事**（口語可用「球局」） | 比賽活動、場次 |
| 其中一局 | **一局**、**第 N 局** | 一場（容易跟整場混淆） |
| 不屬於任何社團的賽事 | **臨打** | 散客、公開賽 |
| 社團的公開設定 | **公開**／**隱藏社團** | 私密 |
| 臨打賽事的公開設定 | **公開**／**僅限連結** | 私密 |
| 使用者關心的賽事清單 | **我的關注** | 我報名的、社團活動 |
| 分享賽事的按鈕 | **賽事連結** | 分享賽事 |
| 賽事的文字結果 | **文字賽報** | 戰報 |
| 讓任何人能記分 | **開啟操作** | 管理模式、解鎖 |

### 英文（一整場＝Event，一局＝Game）

| 中文 | 英文 |
|---|---|
| 賽事（一整場） | **Event**：Create Event、Event Link、End Event、Hidden Event、Event Archives |
| 一局 | **Game**：Add Game、Games Done、Void Game、Game 3 |
| 臨打活動頁 | **Drop-in Play** |
| 我的關注 | **Following** |
| 隱藏社團 | **Hidden club** |
| 社團公開設定 | **Visibility** |

不使用 Tournament、Match、Session、Activity、Practice 指稱上面兩者。

---

## 3. 視覺設計

### 3.1 主題

- 網站目前**只使用淺色主題**（暖白底）。`<html class="light">` 固定。
- `styles.css` 裡保留了深色主題（`html.dark`）的樣式，但目前沒有切換開關，新功能可以不必特別為深色調整，但寫 Tailwind class 時沿用現有的 `dark:` 寫法即可。

### 3.2 配色

**品牌色（綠）**

| 名稱 | 色碼 | 用途 |
|---|---|---|
| Emerald 500（主色） | `#10B981` | 主要按鈕、強調文字、勾選狀態、品牌字「Two」、theme-color |
| Emerald 600 | `#059669` | 主色的深一階，淺色底上的綠色文字、漸層終點 |
| Emerald 400 | `#34D399` | 進度條亮部、深色底上的綠字 |
| Teal 600 | `#0D9488` | 主要按鈕漸層的右端（`from-emerald-500 to-teal-600`） |
| Emerald 50 | `#ECFDF5` | 提示（Toast）底色 |

**中性色（淺色主題，暖白系）**

| 名稱 | 色碼 | 用途 |
|---|---|---|
| 頁面底色 | `#FAF8F5` | `body` 背景（上方帶一點淡綠光暈） |
| 主要文字 | `#292524`（stone-800） | 內文 |
| 次要文字 | `#78716C`（stone-500） | `.sub-text`：說明、時間、計數 |
| 卡片底 | 白色 94% 不透明 | `.glass-card` |
| 卡片框線 | `#EBD9C8` | `.glass-card` 邊框（滑過時 `#DFCDB8`） |
| 內層區塊底 | `#F6F2EB` | `.card-inner`：卡片裡的小區塊、按鈕底 |
| 內層區塊框線 | `#E5DBC9` | `.card-inner` 邊框 |
| 輸入框框線 | `#D6C7B2` | `.input-bg` |
| 導覽列底 | `rgba(250,248,245,.9)` ＋毛玻璃 | `.glass-nav` |

**功能色**

| 名稱 | 色碼 | 用途 |
|---|---|---|
| 藍隊 | `#3B82F6`（blue-500） | 對戰卡片的藍方、藍方獲勝底色 `.winner-card-blue` |
| 紅隊 | `#F43F5E`（rose-500） | 對戰卡片的紅方、紅方獲勝底色 `.winner-card-red`；刪除、錯誤 |
| 琥珀 | `#F59E0B`（amber-500） | 報名中、提醒、注意事項 |
| LINE 綠 | `#06C755`（按下 `#05B34C`） | 只用在 LINE 登入、加入 LINE 好友相關按鈕 |

**規則**
- 所有 Toast 提示一律綠色樣式，不分成功、警告、錯誤（見 4.6）。
- 紅色只用在「刪除／取消」這類不可逆動作與紅隊。
- LINE 綠只用在跟 LINE 有關的按鈕，不要拿來當一般主色。

### 3.3 字型

| 用途 | 字型 | 粗細 |
|---|---|---|
| 內文（`font-sans`） | **Inter**，中文由系統字型（蘋方、Noto Sans TC）補上 | 400／500／600／700 |
| 標題、品牌字、數字（`font-display`） | **Outfit** | 600／700／800 |
| 記分數字 | 加 `.scoreboard-num`（等寬數字、字距收緊） | |

字型從 Google Fonts 載入（`index.html` 第 44 行）。

### 3.4 形狀與質感

| 項目 | 規範 |
|---|---|
| 圓角 | 卡片、對話框 `rounded-2xl`；按鈕、輸入框、內層區塊 `rounded-xl`；小標籤 `rounded-lg` 或 `rounded-full` |
| 卡片 | `.glass-card`：白底、淡框線、柔和暖色陰影；可加 `.hover-lift`（滑過浮起 2.5px＋綠色光暈） |
| 按下回饋 | 可點的按鈕加 `active:scale-95 transition` |
| 對話框背景 | `bg-stone-900/60 backdrop-blur-sm` |
| 間距 | 手機優先，常用 `p-4`、`gap-2`～`gap-4`；大螢幕用 `sm:` 放大 |

### 3.5 圖示

- 使用 **Lucide Icons**（`<i data-lucide="名稱">`）。
- 產生圖示時**限定範圍**：`lucide.createIcons({ root: container })`，不要每次掃整頁。
- 品牌圖示是 Lucide 的 `trophy`（獎盃）。
- 原則：能用文字說清楚就不加圖示；同一區塊的圖示風格一致。

### 3.6 品牌素材

| 素材 | 尺寸 | 位置 |
|---|---|---|
| App 圖示 | 192×192、512×512 | `icon-192.png`、`icon-512.png`、`apple-touch-icon.png`、`icon.svg` |
| 分享預覽圖（LINE／iMessage 連結卡片） | 1200×630 | `og-image.png`；換圖時把 `index.html` 裡 `og-image.png?v=` 的數字加一 |
| LINE 圖文選單 | 2500×843（左大右小兩格） | 原始檔在專案知識庫 |
| 品牌字 | 「ZeroZero」黑＋「Two」綠 | |

---

## 4. 元件規範

### 4.1 按鈕

| 類型 | 樣式 | 用途 |
|---|---|---|
| 主要按鈕 | `bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold rounded-xl shadow-sm active:scale-95` | 建立賽事、確認、開賽 |
| 次要按鈕 | `.card-inner border rounded-xl` | 取消、返回、一般操作 |
| 危險按鈕 | 紅色文字或紅色框（rose） | 刪除、取消球局 |
| 模式切換（分段按鈕） | `.mode-btn-active`／`.mode-btn-inactive` | 建立賽事的模式、格式選擇 |
| LINE 按鈕 | 底色 `#06C755` | LINE 登入、加入好友 |

### 4.2 卡片

- **賽事卡片**（列表用）：`hub.js` 的 `renderTournamentCard()`。顯示名稱、社團／臨打、狀態、進度。已完賽的卡片不顯示進度列。**列表卡片不顯示 ☆ 關注**。
- **對戰卡片**（計分板）：藍方 vs 紅方，分數用 `.scoreboard-num`，獲勝方套 `.winner-card-blue`／`.winner-card-red`。作廢的局顯示「🚫 本局作廢」。

### 4.3 對話框（Modal）

- 結構：外層 `fixed inset-0 z-50 … backdrop-blur-sm hidden flex items-center justify-center p-4`，內層 `glass-card rounded-2xl max-w-sm w-full p-5`。
- 右上角 ✕ 關閉；標題前可放一個 `w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500` 的圖示方塊。
- id 命名：`modal-功能名`（例如 `modal-create-club`、`modal-share`）。
- 長表單的送出按鈕放在底部懸浮列（Sticky Bar）。

### 4.4 輸入框

- `.input-bg border rounded-xl p-2.5 text-xs sm:text-sm focus:border-emerald-500 focus:outline-none`。
- 一律加 `autocomplete="off"`，並設 `maxlength`（見 7.2 各欄位上限）。
- 點開對話框時不要自動 focus 文字欄（手機會跳鍵盤擋住畫面）。

### 4.5 導覽

- **頂部共用工具列**（`#lobby-shared-header`）：左邊是頁面下拉選單（我的關注／臨打活動／我的社團／探索・建立新社團），右邊是「加入社團」與「建立新賽事」按鈕。
- **社團底部分頁**（`#club-bottom-nav`）：只在社團大廳出現，三個分頁：**活動／戰績／社團**。
- 右上角齒輪選單：LINE 官方帳號、使用手冊、語言切換、管理員。

### 4.6 提示（Toast）

- 用 `showToast(訊息, 類型)`。**不論類型，畫面上一律綠色**（`bg-emerald-50 border-emerald-500/50 text-emerald-800`）。
- 一次只顯示一則，新的會取代舊的。
- 文字一句話、說清楚結果，例如「已加入關注，可在「我的關注」找到」。

### 4.7 確認視窗

- 不可逆的動作（刪除、取消球局、結束賽事）一定要確認。
- 確認文字要寫出**賽事名稱**與**無法復原**，例如：「確定要刪除「11/16火鍋盃」嗎？刪除後無法復原，比賽紀錄也不會保留。」

### 4.8 空狀態

- 一行粗體說明現況，必要時一行灰字告訴下一步。例如「目前沒有關注的球局」＋「點選 ☆ 號，關注賽事」。

---

## 5. 頁面結構與導覽

所有頁面都在同一個 `index.html` 裡，用 `navigateTo(頁面代碼)` 切換顯示。

| 頁面代碼 | 中文稱呼 | 網址 | 區塊 id | 內容 |
|---|---|---|---|---|
| `activities` | **我的關注** | `/`（首頁） | `#page-activities` | 加入社團的賽事＋關注的賽事，分報名中／比賽中／近期完賽（3 天內）。未登入或沒有關注時，顯示登入提示與活躍社團 |
| `hub` | **臨打活動** | `?page=hub` | `#page-hub` | 所有公開臨打賽事，分報名中／比賽中／近期完賽；也列出自己建立或關注的「僅限連結」賽事 |
| `history` | **社團大廳** | `?club=社團名` 或 `?c=短代碼` | `#page-history` | 底部三分頁：活動（報名中／比賽中／近期完賽）、戰績（歷史賽事、按月篩選）、社團（簡介、創建人、成員） |
| `create` | **建立賽事** | `?page=create` | `#page-create` | 建立賽事表單 |
| `live`（報名中） | **接龍大廳** | `?t=T-123456` | `#page-live` → `#live-registration-lobby` | 報名名單、輸入名字報名、開賽 |
| `live`（開賽後） | **即時計分板** | `?t=T-123456` | `#page-live` → `#live-main-grid` | 對戰卡片、記分、加局、排名、文字賽報 |
| `admin` | **管理員頁** | 齒輪選單進入 | `#page-admin` | 需管理員 PIN；統計、社團改名／刪除、賽事管理 |

- `?page=waiting`（舊的「等待報名」頁）已併入「我的關注」，會自動轉過去。
- 從 LINE 打開時網址會是 `https://liff.line.me/2012043789-KvKpHLCt?t=…`，LINE 會轉成 `liff.state` 參數，程式會自動換回正常網址。
- 換頁時自動捲到最上方。

### 建立賽事表單的欄位順序

1. 賽事名稱
2. 所屬社團（下面接「活動備註」，選填，上限 50 字）
3. 誰看得到（只有臨打賽事能選「僅限連結」）
4. 開局方式：**接龍報名**（先開報名，開賽時再決定賽程）或**直接開打**
5. 賽事模式：**平均模式**（指定總時間，系統試算最佳局數）或**自由模式**（賽中單局新增，支援少數優先或隨機抽籤）

---

## 6. 程式架構

### 6.1 技術

| 層 | 技術 |
|---|---|
| 前端 | 純 JavaScript（ES Modules，不用框架）、Tailwind CSS（預先產生的 `tailwind.css`）、Lucide Icons、LINE LIFF SDK |
| 資料庫 | Firebase Realtime Database（即時資料庫） |
| 後端 | Python Cloud Functions（第 2 代），區域 `asia-southeast1` |
| 正式網站 | GitHub Pages（`zztwo.com`，`main` 分支） |
| PR 預覽 | Firebase Hosting 預覽頻道（GitHub Actions 自動產生，網址貼在 PR 留言） |

### 6.2 檔案分工

| 檔案 | 負責 |
|---|---|
| `index.html` | 所有頁面的 HTML、路由（`initRouting`、`navigateTo`）、`showToast`、App 啟動流程 |
| `globals.js` | 共用狀態 `STATE`、`t()` 翻譯、`FUNCTIONS_BASE_URL` 等常數 |
| `utils.js` | `escapeHTML`、`safeSetLocal` 等工具 |
| `i18n.js` | 中英文字典（`zh-TW`／`en`） |
| `i18n-ui.js` | 畫面元素 id 與字典 key 的對照，切換語言時套用 |
| `hub.js` | 臨打活動頁、賽事卡片 `renderTournamentCard()`、刪除賽事 |
| `activities.js` | 我的關注頁 |
| `club.js` | 社團大廳、社團資訊與密碼、改名、成員、探索社團、管理員頁、文字賽報 `copyTournamentReport()` |
| `tournament-create.js` | 建立賽事表單、時間試算、建立流程 |
| `live.js` | 接龍大廳、即時計分板、排名、☆ 關注、自由模式加局 |
| `scheduler.js` | 前端排賽演算法（後端失敗時的備援；8 人 14 局的完美排法） |
| `line.js` | LINE 登入（LIFF）、會員資料同步 |
| `styles.css` | 自訂樣式（玻璃卡片、主題色、記分數字等） |
| `tailwind.css` | 由 `./build-css.sh` 產生，**不要手改** |
| `functions/main.py` | 所有後端程式 |
| `database.rules.json` | 資料庫安全規則 |
| `sw.js` | 只用來**清除**舊版 Service Worker 與快取（網站目前不使用離線快取） |

### 6.3 開發規則

- **版本號：** 每次改 JS／HTML，都要把所有檔案裡的 `?v=YYYYMMDD-N` 一起加一，手機才會抓新檔。
- **Tailwind：** 只能用 `tailwind.css` 裡已經有的 class。要新增 class 時執行 `./build-css.sh` 重新產生並一起提交；無法執行時改用 inline style。class 名稱不能用字串拼接（例如 `bg-${color}-500`）。
- **翻譯：** 新增畫面文字時，中英文都要加；英文遵守第 2 節用詞。
- **圖示：** `lucide.createIcons({ root: container })` 限定範圍。
- **暫存優先：** 列表先用 `localStorage` 的資料畫出來，再等 Firebase 更新。
- **不要過度設計：** 不加複雜的帳號角色權限，不做關聯式資料庫那套主鍵外鍵。

### 6.4 手機本地暫存（localStorage）

| key | 內容 |
|---|---|
| `pb_tournaments` | 近 30 天賽事的暫存（列表先用這份畫） |
| `pb_my_tournaments`、`pb_created_tournaments` | 這支手機建立或開過的賽事 id |
| `pb_my_records_{LINE ID}` | 關注紀錄的暫存 |
| `pb_my_clubs_{LINE ID}` | 我加入的社團暫存 |
| `pb_last_line_uid` | 上次登入的 LINE ID（讓網站一打開就能先顯示登入狀態） |
| `pb_clubs_metadata`、`pb_club_members`、`pb_club_passwords` | 社團資訊、成員、密碼狀態的暫存 |
| `pb_last_club` | 上次看的社團 |
| `pb_lang` | 語言 |
| `pb_app_config` | 設定暫存 |

讀寫一律用 try/catch（`safeSetLocal`），因為在某些瀏覽器會失敗。

---

## 7. Firebase 資料規範

### 7.1 總覽

```
/
├── tournaments/{賽事ID}           所有賽事（公開讀取）
├── users/{LINE ID}                會員資料、加入的社團、關注
├── clubs_metadata/{社團key}       社團簡介、設定、創建人、短代碼
├── club_members/{社團key}         社團常用成員名單（名字陣列）
├── club_codes/{短代碼}            社團短網址代碼 → 社團key
├── club_renames/{舊社團key}       改名紀錄：舊名 → 新名
├── club_passwords/{社團key}       社團密碼雜湊（只有後端能讀寫）
├── club_mappings/                 舊的球員綁定資料（已停用、鎖住）
├── app_config/                    管理員 PIN 雜湊、LINE 機器人設定（只有後端）
└── rate_limits/                   密碼嘗試次數紀錄（只有後端）
```

預設全部不能讀寫，下面列出的才開放。後端程式使用管理權限，不受規則限制。

### 7.2 `tournaments/{賽事ID}`

- **ID 格式：** `T-` 加 6 位數字，例如 `T-235136`。
- **讀取：** 任何人。
- **寫入：** 任何人，**但狀態是 `completed`（已結束）的賽事不能再改**。
- **必要欄位：** `id`、`name`。
- **索引：** `createdAt`、`clubName`。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | 字串 | 同賽事 ID |
| `name` | 字串（≤100） | 賽事名稱 |
| `clubName` | 字串（≤40） | 所屬社團名稱（原始名稱，不是編碼後的 key）；臨打為空字串 |
| `notes` | 字串（畫面限 50） | 活動備註 |
| `isPrivate` | 布林 | 臨打賽事是否「僅限連結」 |
| `status` | 字串 | `registering` 報名中 → `active` 比賽中 → `completed` 已結束 |
| `entryMode` | 字串 | `registration` 表示從接龍報名開始；直接開打的賽事沒有這個欄位 |
| `tournamentMode` | 字串 | `fair` 平均模式（依時間）、`round-robin` 平均模式（完整循環）、`free` 自由模式 |
| `partnerType` | 字串 | `rotating` 輪替搭檔、`fixed` 固定搭檔、`singles` 單打 |
| `isTeamMode` | 布林 | 固定隊伍模式 |
| `players` | 字串陣列 | 參賽名單 |
| `pausedPlayers` | 陣列 | 暫停出賽的球員 |
| `maxPlayers` | 數字 | 報名人數上限（選填） |
| `matches` | 物件陣列 | 每一局，見下表 |
| `durationHours` | 數字 | 預計時數 |
| `customTotalGames` | 數字 | 指定總局數（選填） |
| `scoringType` | 字串 | 目前固定 `rally`（落地得分） |
| `targetScore` | 數字 | 目標分數 |
| `isPracticeMode` | 布林 | 接龍報名後以自由模式開打 |
| `createdAt` | ISO 時間字串 | 建立時間 |
| `startedAt` | ISO 時間字串 | 開賽時間 |
| `completedAt` | 毫秒數字 | 結束時間 |

**每一局（`matches[]`）**

| 欄位 | 說明 |
|---|---|
| `id` | 局號 |
| `blue`、`red` | 兩隊球員名字陣列（雙打 2 人、單打 1 人） |
| `blueScore`、`redScore` | 比分（未打為空） |
| `voided` | 是否作廢（作廢的局不計分、不計排名） |
| `active`、`resting` | 這局上場與休息的人（排賽演算法使用） |

### 7.3 `users/{LINE ID}`

- **讀寫：** 任何人（沒有 Firebase 登入驗證，靠 LINE ID 不公開來保護）。
- **不允許其他欄位。**

| 欄位 | 型別 | 說明 |
|---|---|---|
| `displayName` | 字串（≤100） | LINE 名稱 |
| `pictureUrl` | 字串（≤500） | LINE 大頭貼 |
| `lastLoginAt` | 數字 | 最後登入時間 |
| `lastClub` | 字串（≤40） | 上次看的社團名稱 |
| `myClubs/{社團名URI編碼}` | `true` | 加入的社團 |
| `following/{賽事ID}` | 數字 | 關注時間；**`0` 表示自己取消過**（見 9.3） |

### 7.4 `clubs_metadata/{社團key}`

- **讀取：** 任何人。
- **寫入：** 沒設密碼的社團，網頁可以直接寫；**有設密碼的社團只能透過後端**（`updateClubMeta`）。
- **不允許其他欄位。**

| 欄位 | 型別 | 說明 |
|---|---|---|
| `description` | 字串（≤200） | 社團簡介 |
| `creator` | 字串（≤20） | 創建人（選填，名義上的聯絡人） |
| `isPrivate` | 布林 | 是否為隱藏社團 |
| `hasPassword` | 布林 | 是否有密碼（必須跟 `club_passwords` 一致） |
| `code` | 5 碼字串 | 社團短代碼（只能寫一次） |
| `createdAt`、`updatedAt` | 數字 | 毫秒時間 |

### 7.5 其他節點

| 節點 | 讀 | 寫 | 內容 |
|---|---|---|---|
| `club_members/{社團key}` | 任何人 | 任何人可新增、修改；整份刪除只在名單剩 1 人以下時允許 | 名字字串陣列，每個 ≤20 字 |
| `club_codes/{代碼}` | 任何人 | 新增，或與 `clubs_metadata` 的 code 對得上 | 值是社團 key；代碼用 `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` 五碼（去掉容易看錯的 0、1、I、O） |
| `club_renames/{舊key}` | 任何人 | 只有後端 | 值是新社團名稱；舊的 `?club=舊名` 連結會自動轉過去 |
| `club_passwords/{社團key}` | 不行 | 不行 | SHA-256 雜湊，只有後端讀寫 |
| `club_mappings/` | 不行 | 不行 | 已停用的球員綁定舊資料 |
| `app_config/` | 不行 | 不行 | `master_pin_hash`、`line_bot` 憑證 |
| `rate_limits/{類別}/{來源}` | 不行 | 不行 | 密碼錯誤次數（後端用） |

### 7.6 社團 key 的編碼（重要）

- 社團相關節點的 key 一律是 `encodeClubKey(社團名稱)`，也就是把名稱做網址編碼，例如「Gogo三重」存成 `Gogo%E4%B8%89%E9%87%8D`。
- **後端注意：** Python 的 Firebase 套件不會跳脫網址，路徑裡的 `%E4…` 會被資料庫還原成中文，寫到另一個節點。所以後端所有帶社團 key 的路徑都要經過 `_p(key)`（把 `%` 換成 `%25`）。用 `db.reference("/").update({...})` 一次寫多筆時，key 不經網址，直接寫原樣即可。
- 賽事裡的 `clubName` 存的是**原始名稱**，不是編碼後的 key。

### 7.7 部署規則

`database.rules.json` 改完**不會自動生效**，要部署：
```
firebase deploy --only database
```

---

## 8. 後端程式（Cloud Functions）

網址前綴：`https://asia-southeast1-pickleball-hub-d0ab1.cloudfunctions.net/`

| 名稱 | 用途 | 權限 |
|---|---|---|
| `generateSchedule` | 平均模式排賽（失敗時網頁改用 `scheduler.js` 備援） | 公開 |
| `verifyClubPassword` | 驗證社團密碼 | 公開；錯 10 次鎖 15 分鐘 |
| `manageClubPassword` | 設定、移除、搬移社團密碼 | 有密碼的社團需原密碼或管理員 PIN |
| `updateClubMeta` | 修改社團簡介、公開設定、創建人 | 有密碼的社團需密碼 |
| `renameClub` | 社團自助改名：一次搬移賽事、成員、所有會員的社團清單、密碼、簡介、短代碼，並寫入改名紀錄 | 有密碼的社團需密碼；沒密碼直接改 |
| `verifyAdminPin` | 驗證管理員 PIN | 錯 10 次鎖 15 分鐘 |
| `adminClubAction` | 管理員改名／刪除社團（與 `renameClub` 共用搬移流程） | 管理員 PIN |
| `adminTournamentAction` | 管理員刪除賽事、修改賽事名稱（含已結束的） | 管理員 PIN |
| `adminUserStats` | 會員統計 | 管理員 PIN |
| `lineWebhook` | LINE 官方帳號的訊息回覆 | 驗證 LINE 簽章 |

雲端上另有一支舊程式 `auto_schedule_tournament`，不在目前的程式碼裡。部署時若問要不要刪除，**選 N**，確認用途前不要刪。

---

## 9. 核心業務邏輯

### 9.1 排賽

| 模式 | 怎麼排 |
|---|---|
| **平均模式（依時間）** | 依指定時間與人數試算總局數；每人出場數相同或差 1，搭檔盡量不重複，避免連打與連休 |
| **平均模式（完整循環）** | 每個人跟每個人都搭檔一次 |
| **8 人雙打 14 局** | 直接套用完美排法：搭檔各 1 次、對手各 2 次、最多連打／連休 2 局（每次開賽隨機打亂名字） |
| **自由模式** | 不預排；賽中一局一局新增，可選「少數優先」（出場少的先上）或隨機抽籤 |

排賽先呼叫後端 `generateSchedule`，失敗才用網頁的 `scheduler.js`。

### 9.2 排名

依序比較：
1. 勝場數（多的在前）
2. 勝率
3. 淨勝分（得分 − 失分）
4. 總得分
5. 總失分（少的在前）

作廢的局不計。

### 9.3 我的關注

- 存在 `users/{LINE ID}/following/{賽事ID}`。值大於 0 表示關注，`0` 表示自己取消過，沒有紀錄則看是否為自己社團的賽事。
- **預設關注：** 自己加入的社團的賽事（可取消）。
- **自動關注：**
  - 登入狀態下建立賽事
  - 在接龍大廳按報名（不論幫自己或代打）
  - **從賽事連結打開網站**（網站一打開網址就帶著賽事編號，等 LINE 登入確認後自動點上 ☆，並提示「已加入關注，可在「我的關注」找到」）
- **不會自動關注：** 在站內點進賽事、按「開啟操作」。
- **取消過的不再自動加回**：取消關注一律記 0，不刪紀錄。
- 「我的關注」頁只顯示報名中、比賽中、3 天內完賽的賽事。
- ☆ 只出現在賽事頁標題前面，列表卡片不顯示。

### 9.4 社團

- **建立：** 名稱上限 12 字；可設密碼、創建人、簡介、公開或隱藏。
- **加入社團：** 只是把社團加進自己的清單（`users/.../myClubs`），讓社團賽事出現在「我的關注」。退出不會刪任何戰績。
- **隱藏社團：** 不出現在探索列表，只能用社團連結進入；看比賽一樣不需要密碼。
- **改名：** 社團頁「編輯社團」直接改。有密碼要輸入密碼，沒密碼直接改。舊連結自動轉到新名。
- **社團密碼保護的範圍：** 名稱、創建人、簡介、公開設定、密碼本身。**不包含任何賽事操作。**

### 9.5 權限總表

| 動作 | 臨打賽事 | 社團賽事 |
|---|---|---|
| 看比賽 | 任何人 | 任何人（隱藏社團要有連結） |
| 報名、記分、加人、加局 | 任何人 | 任何人 |
| 結束賽事 | 任何人（確認） | 任何人（確認） |
| 刪除未結束的賽事 | 任何人（確認） | 任何人（確認） |
| 修改已結束的賽事 | 不行 | 不行 |
| 刪除已結束的賽事 | 只有管理員 | 只有管理員 |
| 修改社團資訊、改名 | — | 有密碼需密碼；沒密碼任何人 |

### 9.6 文字賽報

格式固定，開賽前、比賽中、結束後都能複製，內容往下累加：
`【賽事戰報】` 標題與狀態 → `【名單】` → `【對戰紀錄】`（`#局號 A & B 11:7 C & D`，未打寫 `vs`）→ `【目前排名】`／`【最終排名】` → `【榮譽榜】`。

### 9.7 LINE 整合

- **登入：** LIFF（LINE Front-end Framework，讓網頁在 LINE 裡直接取得登入身分）。只用來識別「我是誰」，以記住加入的社團與關注。
- **賽事連結：** `https://liff.line.me/2012043789-KvKpHLCt?t=賽事ID`，在 LINE 裡點開會自動登入。
- **圖文選單：** 2500×843（LINE「小型」選單），左大右小兩格。
  - 左「官網」（約 x 0～1666）：開啟 `https://zztwo.com/`
  - 右「建立賽事」（約 x 1666～2500）：開啟 `https://zztwo.com/?page=create`
  - 成品圖 `zerozerotwo-richmenu-compact-2500x843.png`，原始檔在專案知識庫。
- **LINE 官方帳號自動回覆（`lineWebhook`）：** 使用者在聊天室輸入關鍵字時回覆。
  - 「我的活動總表」等：列出比賽中／報名中的賽事。**注意：** 目前依「加入的社團」與舊的球員綁定資料比對，還沒改成依「我的關注」。
  - 「搜尋接龍列表」等：列出近期公開的報名中賽事。
  - 「建立賽事」等：回覆建立賽事的連結；「說明」「help」：回覆功能說明。
  - 圖文選單已不再送出這些關鍵字，只有使用者自己輸入才會觸發。
  - 憑證放在環境變數或 `/app_config/line_bot/`；用 LINE 的被動回覆，不消耗每月推播額度。
- **分享預覽：** 由 `index.html` 的 `og:` 設定決定。LINE 會暫存預覽好幾天，而且官方清除工具（Page Poker）已停用，所以換圖後舊連結要等暫存過期。

---

## 10. 部署與發布流程

| 要更新的東西 | 怎麼上線 |
|---|---|
| 網頁（HTML／JS／CSS／圖片） | 合併到 `main` 後，GitHub Pages 自動更新（幾分鐘） |
| 資料庫規則 | 在自己電腦的專案資料夾執行 `firebase deploy --only database` |
| 後端程式 | 在自己電腦的專案資料夾執行 `firebase deploy --only functions`（可指定單支：`--only functions:renameClub`） |

**自己電腦上的專案資料夾：** `/Users/jasonchu/zz-deploy`

**部署後端的標準步驟**
```
cd /Users/jasonchu/zz-deploy
git checkout main
git pull
firebase deploy --only functions,database
```
- 問「要不要刪除雲端上多出來的程式」時，一律選 **N**。
- 看到 `Deploy complete!` 才算完成。
- 後端或規則有改的 PR，**要先部署再合併網頁**，避免網頁呼叫還不存在的功能。

**PR 流程**
1. 每個修改開一個分支與 PR，PR 留言會出現預覽網址。
2. 在預覽網址確認。
3. 說「合併」後才合併到 `main`。
