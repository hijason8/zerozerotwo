"""
Firebase Cloud Functions for ZeroZeroTwo (Python 2nd Gen)
包含：
1. auto_schedule_tournament (RTDB Trigger): 監聽 /tournaments/{tournament_id} 自動排賽回寫
2. generateSchedule (HTTP REST API): 前端即時排賽運算端點
3. verifyClubPassword (HTTP REST API): 社團密碼驗證
4. verifyAdminPin (HTTP REST API): 管理員 Master PIN 驗證
5. lineWebhook (HTTP REST API): LINE Bot Webhook 訊息回覆 (免跳轉輕量方案)
"""

import os
import json
import hashlib
import hmac
import base64
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Dict
from urllib.parse import quote

from firebase_functions import db_fn, https_fn, options
from firebase_admin import initialize_app, db

from scheduler import (
    generate_doubles_schedule,
    generate_singles_schedule,
    generate_team_schedule
)

initialize_app(options={
    "databaseURL": "https://pickleball-hub-d0ab1-default-rtdb.asia-southeast1.firebasedatabase.app"
})
options.set_global_options(region=options.SupportedRegion.ASIA_SOUTHEAST1)
CORS_CONFIG = options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST", "OPTIONS"])


def sha256(text: str) -> str:
    """計算字串之 SHA-256 雜湊 (hex)"""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ============================================================
# 1. RTDB TRIGGER: 監聽未排賽事，自動喚醒計算並寫回
# ============================================================
@db_fn.on_value_written(reference="/tournaments/{tournament_id}")
def auto_schedule_tournament(event: db_fn.Event[db_fn.Change[Any]]) -> None:
    """
    Realtime Database 觸發器：
    當賽事寫入且標記為 'pending_schedule' 時喚醒，
    以 Python 核心演算法計算賽程後寫回 matches，並將狀態更新為 'active'。
    """
    tournament_data = event.data.after
    if not tournament_data or not isinstance(tournament_data, dict):
        return

    # 防重入保護：僅在 status 為 'pending_schedule' 時執行
    if tournament_data.get("status") != "pending_schedule":
        return

    tournament_id = event.params["tournament_id"]
    players = tournament_data.get("players", [])
    if not isinstance(players, list) or len(players) < 2:
        return

    duration_hours = float(tournament_data.get("durationHours", 2.0))
    schedule_mode = tournament_data.get("tournamentMode", "fair")
    custom_total_games = int(tournament_data.get("customTotalGames", 0))
    partner_type = tournament_data.get("partnerType", "rotating")
    is_team_mode = tournament_data.get("isTeamMode", False) or partner_type == "fixed"
    is_singles = partner_type == "singles"

    matches = []
    if is_singles:
        matches = generate_singles_schedule(
            players_list=players,
            duration_hours=duration_hours,
            schedule_mode=schedule_mode,
            custom_total_games=custom_total_games
        )
    elif is_team_mode:
        matches = generate_team_schedule(teams_list=players)
    else:
        matches = generate_doubles_schedule(
            players_list=players,
            duration_hours=duration_hours,
            schedule_mode=schedule_mode,
            custom_total_games=custom_total_games
        )

    # 寫回 RTDB，觸發前端即時監聽器
    ref = db.reference(f"/tournaments/{tournament_id}")
    ref.update({
        "matches": matches,
        "status": "active",
        "scheduledBy": "python-cloud-function",
        "matchesCount": len(matches)
    })
    print(f"[RTDB Trigger] 賽事 {tournament_id} 排賽完成，共生成 {len(matches)} 場")


# ============================================================
# 2. HTTP REST API: 前端直連即時排賽端點
# ============================================================
@https_fn.on_request(cors=CORS_CONFIG)
def generateSchedule(req: https_fn.Request) -> https_fn.Response:
    """REST API: 提供前端即時計算賽程並回傳 JSON"""
    if req.method != "POST":
        return https_fn.Response(
            json.dumps({"error": "Method Not Allowed"}),
            status=405,
            mimetype="application/json"
        )

    try:
        body = req.get_json(silent=True) or {}
        players = body.get("players", [])
        if not isinstance(players, list) or len(players) == 0:
            return https_fn.Response(
                json.dumps({"error": "players 必須為非空陣列"}),
                status=400,
                mimetype="application/json"
            )

        unique_players = list(dict.fromkeys(str(p).strip() for p in players if str(p).strip()))
        fmt = body.get("format", "doubles")
        min_units = 2 if fmt == "singles" else 4
        if len(unique_players) < min_units:
            return https_fn.Response(
                json.dumps({"error": f"參賽名單至少需 {min_units} 人/隊"}),
                status=400,
                mimetype="application/json"
            )

        duration_hours = float(body.get("durationHours", 2.0))
        schedule_mode = body.get("scheduleMode", "fair")
        custom_total_games = int(body.get("customTotalGames", 0))

        if fmt == "singles":
            matches = generate_singles_schedule(
                players_list=unique_players,
                duration_hours=duration_hours,
                schedule_mode=schedule_mode,
                custom_total_games=custom_total_games
            )
        elif fmt == "team":
            matches = generate_team_schedule(teams_list=unique_players)
        else:
            matches = generate_doubles_schedule(
                players_list=unique_players,
                duration_hours=duration_hours,
                schedule_mode=schedule_mode,
                custom_total_games=custom_total_games
            )

        return https_fn.Response(
            json.dumps({
                "success": True,
                "matches": matches,
                "totalGames": len(matches),
                "playersCount": len(unique_players),
                "engine": "python-functions-2nd-gen"
            }, ensure_ascii=False),
            status=200,
            mimetype="application/json"
        )
    except Exception as err:
        return https_fn.Response(
            json.dumps({"error": str(err)}),
            status=500,
            mimetype="application/json"
        )


# ============================================================
# 3. HTTP REST API: 安全驗證社團密碼
# ============================================================
@https_fn.on_request(cors=CORS_CONFIG)
def verifyClubPassword(req: https_fn.Request) -> https_fn.Response:
    if req.method != "POST":
        return https_fn.Response(json.dumps({"error": "Method Not Allowed"}), status=405, mimetype="application/json")

    body = req.get_json(silent=True) or {}
    club_name = (body.get("clubName") or "").strip()
    password = (body.get("password") or "").strip()
    check_only = bool(body.get("checkOnly", False))

    if not club_name:
        return https_fn.Response(json.dumps({"valid": False, "error": "缺少社團名稱"}), status=400, mimetype="application/json")

    try:
        safe_key = quote(club_name, safe="").replace(".", "%2E")
        stored_hash = db.reference(f"/club_passwords/{safe_key}").get()
        if not stored_hash:
            stored_hash = db.reference(f"/clubs/{safe_key}/password_hash").get()

        has_password = bool(stored_hash)

        # 僅檢查是否有密碼保護 (不洩漏 Hash)
        if check_only:
            return https_fn.Response(json.dumps({"hasPassword": has_password}), status=200, mimetype="application/json")

        if not has_password:
            return https_fn.Response(json.dumps({"valid": True, "hasPassword": False, "message": "無密碼保護"}), status=200, mimetype="application/json")

        if not password:
            return https_fn.Response(json.dumps({"valid": False, "hasPassword": True, "error": "請輸入密碼"}), status=200, mimetype="application/json")

        input_hash = sha256(password)
        if input_hash == stored_hash:
            return https_fn.Response(json.dumps({"valid": True, "hasPassword": True}), status=200, mimetype="application/json")

        # 容錯比對 Master PIN
        master_ref = db.reference("/app_config/master_pin_hash")
        master_hash = master_ref.get()
        if not master_hash:
            master_hash = db.reference("/admin_config/master_pin_hash").get()

        if master_hash and input_hash == master_hash:
            return https_fn.Response(json.dumps({"valid": True, "byMasterPin": True, "hasPassword": True}), status=200, mimetype="application/json")

        return https_fn.Response(json.dumps({"valid": False, "hasPassword": True}), status=200, mimetype="application/json")
    except Exception as err:
        return https_fn.Response(json.dumps({"error": str(err)}), status=500, mimetype="application/json")


# ============================================================
# 4. HTTP REST API: 安全驗證管理員 Master PIN
# ============================================================
@https_fn.on_request(cors=CORS_CONFIG)
def verifyAdminPin(req: https_fn.Request) -> https_fn.Response:
    if req.method != "POST":
        return https_fn.Response(json.dumps({"error": "Method Not Allowed"}), status=405, mimetype="application/json")

    body = req.get_json(silent=True) or {}
    pin = (body.get("pin") or "").strip()
    if not pin:
        return https_fn.Response(json.dumps({"valid": False, "error": "未輸入 PIN"}), status=400, mimetype="application/json")

    try:
        master_ref = db.reference("/app_config/master_pin_hash")
        master_hash = master_ref.get()
        if not master_hash:
            master_hash = db.reference("/admin_config/master_pin_hash").get()

        input_hash = sha256(pin)
        is_valid = bool(master_hash and input_hash == master_hash)
        return https_fn.Response(json.dumps({"valid": is_valid}), status=200, mimetype="application/json")
    except Exception as err:
        return https_fn.Response(json.dumps({"error": str(err)}), status=500, mimetype="application/json")


# ============================================================
# 5. HTTP REST API: LINE Bot Webhook (免跳轉輕量訊息回覆)
# ============================================================
def _get_line_config() -> Dict[str, str]:
    """取得 LINE Channel Secret 與 Access Token (優先自環境變數，次自 RTDB /app_config/line_bot)"""
    secret = os.environ.get("LINE_CHANNEL_SECRET", "").strip()
    token = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN", "").strip()
    if not secret or not token:
        try:
            cfg = db.reference("/app_config/line_bot").get() or {}
            if not secret:
                secret = str(cfg.get("channel_secret") or cfg.get("channelSecret") or "").strip()
            if not token:
                token = str(cfg.get("channel_access_token") or cfg.get("channelAccessToken") or "").strip()
        except Exception as e:
            print(f"[LINE Webhook] 讀取 /app_config/line_bot 發生例外: {e}")
    return {"secret": secret, "token": token}


def _verify_line_signature(secret: str, body_bytes: bytes, signature: str) -> bool:
    """驗證 LINE Messaging API Webhook 簽名"""
    if not secret:
        # 開發/初次驗證模式：若尚未配置 Secret，放行以利 Console 測試 Verify
        return True
    if not signature:
        return False
    mac = hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256).digest()
    expected = base64.b64encode(mac).decode("utf-8")
    return hmac.compare_digest(expected, signature)


def _reply_line_message(reply_token: str, text: str, token: str) -> bool:
    """發送 LINE Reply 訊息 (免費額度通訊)"""
    if not reply_token or not token or not text:
        return False
    payload = json.dumps({
        "replyToken": reply_token,
        "messages": [{"type": "text", "text": text.strip()}]
    }, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(
        "https://api.line.me/v2/bot/message/reply",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}"
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except Exception as e:
        print(f"[LINE Webhook] Reply API error: {e}")
        return False


def _get_user_info(user_id: str):
    """取得使用者的 myClubs 與各社團的綁定身分"""
    user_my_clubs = set()
    club_mappings = {}

    if not user_id:
        return user_my_clubs, club_mappings

    try:
        user_data = db.reference(f"/users/{user_id}").get() or {}
        if isinstance(user_data, dict):
            my_c = user_data.get("myClubs") or {}
            if isinstance(my_c, dict):
                user_my_clubs = {urllib.parse.unquote(k).strip() for k in my_c.keys()}
    except Exception as e:
        print(f"[LINE Webhook] 讀取 user myClubs 失敗: {e}")

    try:
        raw_mappings = db.reference("/club_mappings").get() or {}
        if isinstance(raw_mappings, dict):
            club_mappings = raw_mappings
    except Exception as e:
        print(f"[LINE Webhook] 讀取 club_mappings 失敗: {e}")

    return user_my_clubs, club_mappings


def _is_user_registered_in_tournament(t: dict, user_id: str, user_my_clubs: set, club_mappings: dict):
    """
    精準判斷該 LINE ID 是否為該球局已參加/已報名者：
    1. 比對 players 陣列中是否有 lineUserId == user_id
    2. 若為社團球局，僅在該使用者在該社團有明確綁定名字時比對 (嚴格社團層級隔離)
    """
    if not user_id or not isinstance(t, dict):
        return False, ""

    c_name = (t.get("clubName") or "").strip()
    safe_c = quote(c_name, safe="").replace(".", "%2E") if c_name else ""

    bound_name_in_club = ""
    if safe_c and safe_c in club_mappings and isinstance(club_mappings[safe_c], dict):
        bound_name_in_club = str(club_mappings[safe_c].get(user_id, "")).strip()

    players = t.get("players", [])
    if not isinstance(players, list):
        return False, ""

    for p in players:
        p_name = ""
        p_uid = ""
        if isinstance(p, str):
            p_name = p.strip()
        elif isinstance(p, dict):
            p_name = str(p.get("name", "")).strip()
            p_uid = str(p.get("lineUserId", "")).strip()

        # 1. 直接比對 lineUserId
        if p_uid and p_uid == user_id:
            return True, p_name or bound_name_in_club or "我"

        # 2. 社團隔離綁定姓名比對：必須是該賽事所屬社團的綁定身分相符
        if c_name and bound_name_in_club and p_name == bound_name_in_club:
            return True, p_name

    return False, ""


def _handle_my_activities(user_id: str) -> str:
    """
    處理【比賽中/已報名】：
    列出所有這個 LINE ID 帳下，已參加及已報名且未完賽或結束的活動。
    """
    if not user_id:
        return "⚠️ 無法取得您的 LINE 帳號識別碼，請點擊下方開啟網頁查看：\nzztwo.com/?page=activities"

    user_my_clubs, club_mappings = _get_user_info(user_id)

    tournaments_dict = db.reference("/tournaments").get() or {}
    if not isinstance(tournaments_dict, dict):
        tournaments_dict = {}

    all_tournaments = []
    for tid, t in tournaments_dict.items():
        if isinstance(t, dict):
            if "id" not in t:
                t["id"] = tid
            all_tournaments.append(t)

    all_tournaments.sort(key=lambda x: str(x.get("createdAt", "")), reverse=True)

    active_or_reg = []

    for t in all_tournaments:
        status = t.get("status", "registering")
        # 僅保留未完賽或結束的活動 (排除 completed / finished / archived)
        if status in ("completed", "finished", "archived"):
            continue

        is_registered, my_reg_name = _is_user_registered_in_tournament(t, user_id, user_my_clubs, club_mappings)
        if not is_registered:
            continue

        players = t.get("players", [])
        p_count = len(players) if isinstance(players, list) else 0
        t_id = t.get("id", "")
        t_name = t.get("name", "未命名球局")
        c_name = (t.get("clubName") or "").strip()
        max_p = t.get("maxPlayers") or 100
        notes = (t.get("notes") or "").strip()
        first_note = notes.split("\n")[0].strip() if notes else ""

        active_or_reg.append({
            "id": t_id,
            "name": t_name,
            "club": c_name or "公開臨打",
            "p_count": p_count,
            "max_p": max_p,
            "status": status,
            "reg_name": my_reg_name,
            "notes": first_note
        })

    lines = ["【ZeroZeroTwo 比賽中與已報名】", ""]

    if not active_or_reg:
        lines.append("目前沒有進行中或已報名的活動。")
        lines.append("")
        lines.append("查看等待報名活動：")
        lines.append("zztwo.com/?page=waiting")
        return "\n".join(lines)

    for idx, it in enumerate(active_or_reg[:5], 1):
        tag = "報名中" if it["status"] == "registering" else "比賽中"
        link = f"zztwo.com/?t={it['id']}"
        lines.append(f"{idx}. {it['name']} ({tag})")
        lines.append(f"-所屬：{it['club']}")
        if it["reg_name"]:
            lines.append(f"-出賽身分：{it['reg_name']}")
        if it["max_p"] and it["max_p"] < 100:
            lines.append(f"-人數：{it['p_count']}/{it['max_p']} 人")
        else:
            lines.append(f"-人數：{it['p_count']} 人")
        if it.get("notes"):
            lines.append(f"-備註：{it['notes']}")
        lines.append(link)
        lines.append("")

    return "\n".join(lines).strip()


def _handle_open_registrations(user_id: str = "") -> str:
    """
    處理【等待報名】：
    列出所有沒有社團建立的接龍活動以及該 LINE ID 帳號下的社團，當前可接龍報名的活動。
    如果當前沒有活動可以參加，請寫「目前沒有臨打及已參與社團的接龍活動」。
    """
    user_my_clubs, club_mappings = _get_user_info(user_id) if user_id else (set(), {})

    tournaments_dict = db.reference("/tournaments").get() or {}
    if not isinstance(tournaments_dict, dict):
        tournaments_dict = {}

    all_t = []
    for tid, t in tournaments_dict.items():
        if isinstance(t, dict):
            if "id" not in t:
                t["id"] = tid
            all_t.append(t)

    all_t.sort(key=lambda x: str(x.get("createdAt", "")), reverse=True)

    open_t = []
    for t in all_t:
        status = t.get("status", "registering")
        if status != "registering":
            continue

        is_closed = t.get("registrationClosed", False) or t.get("isRegistrationClosed", False) or t.get("isClosed", False)
        if is_closed:
            continue

        c_name = (t.get("clubName") or "").strip()

        # 篩選來源：
        # 1. 沒有社團建立的接龍活動 (not c_name)
        # 2. 或該 LINE ID 帳號下的社團 (c_name in user_my_clubs)
        if c_name:
            if not user_my_clubs or c_name not in user_my_clubs:
                continue

        # 且本人尚未報名
        if user_id:
            is_reg, _ = _is_user_registered_in_tournament(t, user_id, user_my_clubs, club_mappings)
            if is_reg:
                continue

        open_t.append(t)

    lines = ["【ZeroZeroTwo 等待報名活動】", ""]

    if not open_t:
        lines.append("目前沒有臨打及已參與社團的接龍活動")
        lines.append("")
        lines.append("發起新球局：")
        lines.append("zztwo.com/?page=create")
        return "\n".join(lines)

    for idx, t in enumerate(open_t[:5], 1):
        t_id = t.get("id", "")
        t_name = t.get("name", "未命名球局")
        c_name = (t.get("clubName") or "").strip() or "公開臨打"
        players = t.get("players", [])
        p_count = len(players) if isinstance(players, list) else 0
        max_p = t.get("maxPlayers") or 100
        remain = max_p - p_count if max_p > p_count else 0
        notes = (t.get("notes") or "").strip()
        first_note = notes.split("\n")[0].strip() if notes else ""

        lines.append(f"{idx}. {t_name}")
        lines.append(f"-所屬：{c_name}")
        if max_p and max_p < 100:
            lines.append(f"-人數：{p_count}/{max_p} 人 (剩 {remain} 位)")
        else:
            lines.append(f"-人數：{p_count} 人")
        if first_note:
            lines.append(f"-備註：{first_note}")
        lines.append(f"zztwo.com/?t={t_id}")
        lines.append("")

    return "\n".join(lines).strip()



@https_fn.on_request(cors=CORS_CONFIG)
def lineWebhook(req: https_fn.Request) -> https_fn.Response:
    """
    LINE Messaging API Webhook 端點：
    處理「我的活動總表」、「搜尋接龍列表」等被動回覆訊息
    """
    if req.method == "GET":
        # 供瀏覽器或狀態檢查訪問
        return https_fn.Response("ZeroZeroTwo LINE Webhook Endpoint is Running.", status=200)

    if req.method != "POST":
        return https_fn.Response(json.dumps({"error": "Method Not Allowed"}), status=405, mimetype="application/json")

    line_cfg = _get_line_config()
    secret = line_cfg["secret"]
    token = line_cfg["token"]

    signature = req.headers.get("x-line-signature") or req.headers.get("X-Line-Signature") or ""
    body_bytes = req.get_data()

    if secret and not _verify_line_signature(secret, body_bytes, signature):
        print("[LINE Webhook] 簽名驗證失敗！")
        return https_fn.Response("Invalid signature", status=403)

    try:
        body = req.get_json(silent=True) or {}
        events = body.get("events", [])

        # LINE Developers Console 點擊「Verify」測試時 events 可能為空，需回傳 200 OK
        if not events:
            return https_fn.Response("OK", status=200)

        for ev in events:
            if ev.get("type") != "message":
                continue

            reply_token = ev.get("replyToken")
            source = ev.get("source", {})
            user_id = source.get("userId", "")
            msg = ev.get("message", {})

            if msg.get("type") != "text":
                continue

            user_text = (msg.get("text") or "").strip()

            # 1. 比賽中/已報名 (活動總表)
            if any(k in user_text for k in ["我的活動總表", "我的活動", "我的球局", "總表", "活動總表", "比賽中/已報名", "比賽中與已報名", "比賽中", "已報名"]):
                reply_content = _handle_my_activities(user_id)
                _reply_line_message(reply_token, reply_content, token)

            # 2. 搜尋接龍列表 (等待報名)
            elif any(k in user_text for k in ["搜尋接龍列表", "搜尋接龍", "接龍列表", "接龍", "揪團", "臨打列表", "等待報名", "開放報名"]):
                reply_content = _handle_open_registrations(user_id)
                _reply_line_message(reply_token, reply_content, token)

            # 3. 創建比賽
            elif any(k in user_text for k in ["創建比賽", "建立比賽", "建立賽事", "開局", "創建賽事"]):
                reply_content = (
                    "🏆【創建新賽事 / 暢打球局】\n\n"
                    "支援「平均模式自動排賽」與「自由模式暢打」：\n"
                    "zztwo.com/?page=create"
                )
                _reply_line_message(reply_token, reply_content, token)

            # 4. 其他預設引導訊息
            elif user_text in ["說明", "功能", "選單", "menu", "help", "幫助"]:
                reply_content = (
                    "🎾 ZeroZeroTwo 匹克球助手\n\n"
                    "直接點擊下方圖文選單，或輸入關鍵字：\n"
                    "1.「比賽中/已報名」：查詢您的報名與進行中球局\n"
                    "2.「搜尋接龍列表」：查看近期開放接龍場次\n"
                    "3.「創建比賽」：前往開局排賽\n\n"
                    "zztwo.com"
                )
                _reply_line_message(reply_token, reply_content, token)

        return https_fn.Response("OK", status=200)
    except Exception as e:
        print(f"[LINE Webhook] 處理過程發生例外: {e}")
        return https_fn.Response(json.dumps({"error": str(err)} if "err" in locals() else {"error": str(e)}), status=500, mimetype="application/json")



