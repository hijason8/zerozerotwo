"""
Firebase Cloud Functions for ZeroZeroTwo (Python 2nd Gen)
包含：
1. auto_schedule_tournament (RTDB Trigger): 監聽 /tournaments/{tournament_id} 自動排賽回寫
2. generateSchedule (HTTP REST API): 前端即時排賽運算端點
3. verifyClubPassword (HTTP REST API): 社團密碼驗證
4. verifyAdminPin (HTTP REST API): 管理員 Master PIN 驗證
"""

import json
import hashlib
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
