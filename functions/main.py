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


def _handle_my_activities(user_id: str) -> str:
    """處理【我的活動總表】：依據 lineUserId 查出已報名／進行中球局與即時計分板連結"""
    if not user_id:
        return "⚠️ 無法取得您的 LINE 帳號識別碼，請點擊下方開啟網頁查看活動總表：\nhttps://zztwo.com/?page=hub"

    # 1. 查詢該使用者在各社團的綁定身分
    bound_names = set()
    try:
        club_mappings = db.reference("/club_mappings").get() or {}
        if isinstance(club_mappings, dict):
            for safe_c, user_map in club_mappings.items():
                if isinstance(user_map, dict) and user_id in user_map:
                    val = str(user_map[user_id]).strip()
                    if val:
                        bound_names.add(val)
    except Exception as e:
        print(f"[LINE Webhook] 讀取 club_mappings 失敗: {e}")

    # 2. 查詢全部賽事並過濾
    tournaments_dict = db.reference("/tournaments").get() or {}
    if not isinstance(tournaments_dict, dict):
        tournaments_dict = {}

    all_tournaments = []
    for tid, t in tournaments_dict.items():
        if isinstance(t, dict):
            if "id" not in t:
                t["id"] = tid
            all_tournaments.append(t)

    # 依建立時間倒序
    all_tournaments.sort(key=lambda x: str(x.get("createdAt", "")), reverse=True)

    active_or_reg = []
    completed_recent = []
    now_ts = datetime.now(timezone.utc)

    for t in all_tournaments:
        players = t.get("players", [])
        if not isinstance(players, list):
            continue

        # 檢查本人是否出賽
        is_my_tournament = False
        my_reg_name = ""
        for p in players:
            p_name = ""
            p_uid = ""
            if isinstance(p, str):
                p_name = p.strip()
            elif isinstance(p, dict):
                p_name = str(p.get("name", "")).strip()
                p_uid = str(p.get("lineUserId", "")).strip()

            if p_uid and p_uid == user_id:
                is_my_tournament = True
                my_reg_name = p_name
                break
            if p_name and p_name in bound_names:
                is_my_tournament = True
                my_reg_name = p_name
                break

        if not is_my_tournament:
            continue

        status = t.get("status", "registering")
        t_id = t.get("id", "")
        t_name = t.get("name", "未命名球局")
        c_name = (t.get("clubName") or "").strip()
        max_p = t.get("maxPlayers") or 100
        p_count = len(players)

        item = {
            "id": t_id,
            "name": t_name,
            "club": c_name or "公開臨打",
            "p_count": p_count,
            "max_p": max_p,
            "status": status,
            "reg_name": my_reg_name
        }

        if status in ("registering", "active", "in_progress"):
            active_or_reg.append(item)
        elif status in ("completed", "finished"):
            created_str = t.get("createdAt")
            if created_str:
                try:
                    c_dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
                    if (now_ts - c_dt).total_seconds() <= 3 * 86400:
                        completed_recent.append(item)
                except Exception:
                    completed_recent.append(item)

    # 組合回覆文字
    lines = ["🎾【ZeroZeroTwo 您的活動總表】🎾", ""]

    if not active_or_reg and not completed_recent:
        lines.append("您目前尚無進行中或已報名的球局喔！")
        lines.append("")
        if bound_names:
            lines.append(f"👤 您已綁定的身分：{', '.join(bound_names)}")
        lines.append("👉 快點擊「搜尋接龍列表」查看近期公開臨打，或開啟全站總表：")
        lines.append("🔗 https://zztwo.com/?page=hub")
        return "\n".join(lines)

    if active_or_reg:
        lines.append("🔥【比賽中與已報名】")
        for idx, it in enumerate(active_or_reg[:5], 1):
            tag = "📋 報名中" if it["status"] == "registering" else "⚔️ 比賽中"
            link = f"https://zztwo.com/?t={it['id']}"
            lines.append(f"{idx}. {it['name']} ({tag})")
            lines.append(f"   🛡️ 所屬：{it['club']}")
            if it["reg_name"]:
                lines.append(f"   👤 出賽身分：{it['reg_name']}")
            if it["max_p"] and it["max_p"] < 100:
                lines.append(f"   👥 人數：{it['p_count']}/{it['max_p']} 人")
            else:
                lines.append(f"   👥 人數：{it['p_count']} 人")
            lines.append(f"   👉 賽事頁面：{link}")
            lines.append("")

    if completed_recent:
        lines.append("🏆【近 3 日完賽紀錄】")
        for it in completed_recent[:3]:
            lines.append(f"• {it['name']} ({it['club']})")
            lines.append(f"  👉 查看戰果：https://zztwo.com/?t={it['id']}")
        lines.append("")

    lines.append("───────────────")
    lines.append("🌐 查看完整網頁總表：https://zztwo.com/?page=hub")
    return "\n".join(lines)


def _handle_open_registrations() -> str:
    """處理【搜尋接龍列表】：回覆近期公開場次、名額進度與報名連結 (便於轉傳)"""
    tournaments_dict = db.reference("/tournaments").get() or {}
    if not isinstance(tournaments_dict, dict):
        tournaments_dict = {}

    all_t = []
    for tid, t in tournaments_dict.items():
        if isinstance(t, dict):
            if "id" not in t:
                t["id"] = tid
            all_t.append(t)

    # 依建立時間倒序
    all_t.sort(key=lambda x: str(x.get("createdAt", "")), reverse=True)

    # 篩選開放接龍且非私密的賽事
    open_t = []
    for t in all_t:
        if t.get("status") == "registering" and not t.get("isPrivate", False):
            open_t.append(t)

    lines = ["🔥【ZeroZeroTwo 開放接龍球局】🔥", ""]

    if not open_t:
        lines.append("目前暫無開放接龍中的公開球局！")
        lines.append("")
        lines.append("👉 您也可以自己發起新球局接龍：")
        lines.append("🔗 https://zztwo.com/?page=create")
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

        lines.append(f"{idx}️⃣ {t_name}")
        lines.append(f"📍 所屬：{c_name}")
        if max_p and max_p < 100:
            lines.append(f"👥 名額：已報名 {p_count}/{max_p} 人 (剩 {remain} 位！)")
        else:
            lines.append(f"👥 名額：已報名 {p_count} 人")
        if first_note:
            lines.append(f"📝 備註：{first_note}")
        lines.append(f"👉 立即接龍報名：https://zztwo.com/?t={t_id}")
        lines.append("")

    lines.append("───────────────")
    lines.append("💡 點選上方連結進入【接龍大廳】快速報名，轉傳其他群組一起揪球友！")
    lines.append("🌐 探索全站活動：https://zztwo.com/?page=hub")
    return "\n".join(lines)


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

            # 1. 我的活動總表
            if any(k in user_text for k in ["我的活動總表", "我的活動", "我的球局", "總表", "活動總表"]):
                reply_content = _handle_my_activities(user_id)
                _reply_line_message(reply_token, reply_content, token)

            # 2. 搜尋接龍列表
            elif any(k in user_text for k in ["搜尋接龍列表", "搜尋接龍", "接龍列表", "接龍", "揪團", "臨打列表"]):
                reply_content = _handle_open_registrations()
                _reply_line_message(reply_token, reply_content, token)

            # 3. 創建比賽
            elif any(k in user_text for k in ["創建比賽", "建立比賽", "建立賽事", "開局", "創建賽事"]):
                reply_content = (
                    "🏆【創建新賽事 / 暢打球局】\n\n"
                    "支援「平均模式自動排賽」與「自由模式暢打」，請點擊下方連結立即開局：\n"
                    "👉 https://zztwo.com/?page=create\n\n"
                    "🌐 探索全站活動總表：https://zztwo.com/?page=hub"
                )
                _reply_line_message(reply_token, reply_content, token)

            # 4. 其他預設引導訊息
            elif user_text in ["說明", "功能", "選單", "menu", "help", "幫助"]:
                reply_content = (
                    "🎾 歡迎使用 ZeroZeroTwo 匹克球助手！\n\n"
                    "您可以直接點擊下方圖文選單，或輸入關鍵字：\n"
                    "1️⃣ 輸入「我的活動總表」：查詢您的報名與進行中球局\n"
                    "2️⃣ 輸入「搜尋接龍列表」：查看近期公開報名場次（便於一鍵轉傳群組）\n"
                    "3️⃣ 輸入「創建比賽」：前往開局排賽\n\n"
                    "🌐 官方網站：https://zztwo.com/"
                )
                _reply_line_message(reply_token, reply_content, token)

        return https_fn.Response("OK", status=200)
    except Exception as e:
        print(f"[LINE Webhook] 處理過程發生例外: {e}")
        return https_fn.Response(json.dumps({"error": str(err)} if "err" in locals() else {"error": str(e)}), status=500, mimetype="application/json")



