"""
Firebase Cloud Functions for ZeroZeroTwo (Python 2nd Gen)
包含：
2. generateSchedule (HTTP REST API): 前端即時排賽運算端點
3. verifyClubPassword (HTTP REST API): 社團密碼驗證
4. verifyAdminPin (HTTP REST API): 管理員 Master PIN 驗證
5. lineWebhook (HTTP REST API): LINE Bot Webhook 訊息回覆 (免跳轉輕量方案)
6. manageClubPassword (HTTP REST API): 社團密碼設定 / 移除 / 改名搬移（資料庫規則禁止前端直接寫密碼）
7. adminTournamentAction (HTTP REST API): 管理員刪除 / 改名賽事（已完賽賽事被資料庫鎖住，需驗證 Master PIN）
8. updateClubMeta (HTTP REST API): 儲存社團說明 / 公開私密設定（有密碼的社團需驗證密碼）
9. adminClubAction (HTTP REST API): 管理員社團改名 / 刪除（需驗證 Master PIN）
"""

import os
import re
import json
import logging
import hashlib
import hmac
import base64
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any, Dict
from urllib.parse import quote

from firebase_functions import https_fn, options
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
LIFF_BASE_URL = "https://liff.line.me/2012043789-KvKpHLCt"


def sha256(text: str) -> str:
    """計算字串之 SHA-256 雜湊 (hex)"""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ============================================================
# 共用：密碼嘗試次數限制（同一 IP 15 分鐘內最多錯 10 次）
# ============================================================
RATE_LIMIT_MAX_FAILS = 10
RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000


def _client_key(req: https_fn.Request) -> str:
    # 使用者可自行偽造 X-Forwarded-For 的前段；Google 會把實際連線位址附加在「最後一個」，只信任最後一個
    forwarded = req.headers.get("X-Forwarded-For", "") or ""
    ip = forwarded.split(",")[-1].strip() or (req.remote_addr or "unknown")
    return sha256(ip)[:24]


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _is_rate_limited(req: https_fn.Request, bucket: str) -> bool:
    try:
        rec = db.reference(f"/rate_limits/{bucket}/{_client_key(req)}").get() or {}
        if _now_ms() - int(rec.get("start", 0)) > RATE_LIMIT_WINDOW_MS:
            return False
        return int(rec.get("fails", 0)) >= RATE_LIMIT_MAX_FAILS
    except Exception as err:
        logging.warning(f"[RateLimit] 讀取失敗，暫不限制: {err}")
        return False


def _record_failure(req: https_fn.Request, bucket: str) -> None:
    ref = db.reference(f"/rate_limits/{bucket}/{_client_key(req)}")
    now = _now_ms()

    def _txn(rec):
        rec = rec or {}
        if now - int(rec.get("start", 0)) > RATE_LIMIT_WINDOW_MS:
            return {"start": now, "fails": 1}
        return {"start": rec.get("start", now), "fails": int(rec.get("fails", 0)) + 1}

    try:
        ref.transaction(_txn)
    except Exception as err:
        logging.warning(f"[RateLimit] 記錄失敗: {err}")


def _too_many_attempts() -> https_fn.Response:
    return https_fn.Response(
        json.dumps({"valid": False, "error": "嘗試次數過多，請 15 分鐘後再試", "rateLimited": True}),
        status=429, mimetype="application/json")


def _uri_component(text: str) -> str:
    """與網頁的 encodeURIComponent 相同的編碼"""
    return quote(text, safe="-_.!~*'()")


def _club_key(club_name: str) -> str:
    """與網頁 encodeClubKey 相同：encodeURIComponent 後再把 . 換成 %2E"""
    return _uri_component(club_name.strip()).replace(".", "%2E")


def _legacy_club_key(club_name: str) -> str:
    """舊版後端使用的編碼（只差在 ! ' ( ) * 這幾個符號），讀取舊密碼用"""
    return quote(club_name.strip(), safe="").replace(".", "%2E")


def _p(key: str) -> str:
    """把社團 key 放進資料庫路徑時用。
    後端套件不會跳脫網址，路徑裡的 %E4%B8%89 會被資料庫解碼成「三」，寫到另一個節點；
    把 % 換成 %25，資料庫解碼後才會是網頁那邊用的 %E4%B8%89 原樣 key。"""
    return key.replace("%", "%25")


def _delete_unescaped(prefix: str, key: str) -> None:
    """清掉舊版後端沒跳脫時誤寫到的節點（例如 clubs_metadata/Gogo三重）。key 沒有 % 時兩者是同一個節點，不能刪。"""
    if "%" not in key:
        return
    try:
        db.reference(f"/{prefix}/{key}").delete()
    except Exception as err:
        logging.warning(f"[ClubKey] 清除未跳脫節點失敗 {prefix}/{key}: {err}")


def _get_master_hash():
    master_hash = db.reference("/app_config/master_pin_hash").get()
    if not master_hash:
        master_hash = db.reference("/admin_config/master_pin_hash").get()
    return master_hash


def _get_club_hash(safe_key: str, club_name: str = ""):
    # 先找正確位置（%XX 原樣 key），再找舊版後端誤寫的解碼位置與更舊的編碼方式
    keys = [safe_key]
    if club_name:
        legacy_key = _legacy_club_key(club_name)
        if legacy_key != safe_key:
            keys.append(legacy_key)
    for k in keys:
        stored = db.reference(f"/club_passwords/{_p(k)}").get()
        if not stored and "%" in k:
            try:
                stored = db.reference(f"/club_passwords/{k}").get()
            except Exception:
                stored = None
        if stored:
            return stored
    return db.reference(f"/clubs/{_p(safe_key)}/password_hash").get()


def _clear_club_password(safe_key: str, club_name: str) -> None:
    """刪除社團密碼（正確位置、舊版誤寫位置、舊編碼都清掉）"""
    db.reference(f"/club_passwords/{_p(safe_key)}").delete()
    _delete_unescaped("club_passwords", safe_key)
    legacy_key = _legacy_club_key(club_name)
    if legacy_key != safe_key:
        db.reference(f"/club_passwords/{_p(legacy_key)}").delete()
        _delete_unescaped("club_passwords", legacy_key)


def _is_club_authorized(stored_hash, credential: str) -> bool:
    """社團沒有密碼 → 放行；有密碼 → 需提供社團密碼或 Master PIN"""
    if not stored_hash:
        return True
    if not credential:
        return False
    cred_hash = sha256(credential)
    if cred_hash == stored_hash:
        return True
    master_hash = _get_master_hash()
    return bool(master_hash and cred_hash == master_hash)


def _set_meta_has_password(safe_key: str, has_password: bool) -> None:
    """同步 clubs_metadata 的 hasPassword 標記（資料庫規則禁止前端改有密碼社團的資料）"""
    try:
        meta_ref = db.reference(f"/clubs_metadata/{_p(safe_key)}")
        if meta_ref.get() is not None:
            meta_ref.update({"hasPassword": has_password})
    except Exception as err:
        logging.warning(f"[ClubMeta] 更新 hasPassword 失敗: {err}")


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
        logging.exception(f"[generateSchedule] 排賽計算發生例外: {err}")
        return https_fn.Response(
            json.dumps({"error": "Internal Server Error"}),
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

    if not check_only and _is_rate_limited(req, "club"):
        return _too_many_attempts()

    try:
        safe_key = _club_key(club_name)
        stored_hash = _get_club_hash(safe_key, club_name)

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
        master_hash = _get_master_hash()
        if master_hash and input_hash == master_hash:
            return https_fn.Response(json.dumps({"valid": True, "byMasterPin": True, "hasPassword": True}), status=200, mimetype="application/json")

        _record_failure(req, "club")
        return https_fn.Response(json.dumps({"valid": False, "hasPassword": True}), status=200, mimetype="application/json")
    except Exception as err:
        logging.exception(f"[verifyClubPassword] 驗證密碼發生例外: {err}")
        return https_fn.Response(json.dumps({"error": "Internal Server Error"}), status=500, mimetype="application/json")


# ============================================================
# 4. HTTP REST API: 安全驗證管理員 Master PIN
# ============================================================
# invoker="public"：允許網頁直接呼叫（之前此端點未公開，回傳 403）
@https_fn.on_request(cors=CORS_CONFIG, invoker="public")
def verifyAdminPin(req: https_fn.Request) -> https_fn.Response:
    if req.method != "POST":
        return https_fn.Response(json.dumps({"error": "Method Not Allowed"}), status=405, mimetype="application/json")

    body = req.get_json(silent=True) or {}
    pin = (body.get("pin") or "").strip()
    if not pin:
        return https_fn.Response(json.dumps({"valid": False, "error": "未輸入 PIN"}), status=400, mimetype="application/json")

    if _is_rate_limited(req, "admin"):
        return _too_many_attempts()

    try:
        master_hash = _get_master_hash()
        input_hash = sha256(pin)
        is_valid = bool(master_hash and input_hash == master_hash)
        if not is_valid:
            _record_failure(req, "admin")
        return https_fn.Response(json.dumps({"valid": is_valid}), status=200, mimetype="application/json")
    except Exception as err:
        logging.exception(f"[verifyAdminPin] 驗證 PIN 發生例外: {err}")
        return https_fn.Response(json.dumps({"error": "Internal Server Error"}), status=500, mimetype="application/json")


# ============================================================
# 6. HTTP REST API: 社團密碼管理（設定 / 移除 / 改名搬移）
#    資料庫規則禁止前端直接寫入 /club_passwords，一律經由此端點。
#    社團已有密碼時，必須提供目前密碼或 Master PIN（credential）。
# ============================================================
@https_fn.on_request(cors=CORS_CONFIG)
def manageClubPassword(req: https_fn.Request) -> https_fn.Response:
    def _resp(payload: dict, status: int = 200) -> https_fn.Response:
        return https_fn.Response(json.dumps(payload), status=status, mimetype="application/json")

    if req.method != "POST":
        return _resp({"error": "Method Not Allowed"}, 405)

    body = req.get_json(silent=True) or {}
    action = (body.get("action") or "").strip()
    club_name = (body.get("clubName") or "").strip()
    credential = (body.get("credential") or "").strip()
    new_password = (body.get("newPassword") or "").strip()
    new_club_name = (body.get("newClubName") or "").strip()

    if action not in ("set", "remove", "rename") or not club_name:
        return _resp({"ok": False, "error": "參數錯誤"}, 400)
    if action == "set" and not new_password:
        return _resp({"ok": False, "error": "請輸入新密碼"}, 400)
    if action == "rename" and not new_club_name:
        return _resp({"ok": False, "error": "缺少新社團名稱"}, 400)

    if _is_rate_limited(req, "club"):
        return _too_many_attempts()

    try:
        safe_key = _club_key(club_name)
        stored_hash = _get_club_hash(safe_key, club_name)

        # 已有密碼：必須驗證目前密碼或 Master PIN；尚無密碼：允許首次設定
        if stored_hash:
            cred_hash = sha256(credential) if credential else ""
            master_hash = _get_master_hash()
            authorized = bool(cred_hash) and (cred_hash == stored_hash or (master_hash and cred_hash == master_hash))
            if not authorized:
                _record_failure(req, "club")
                return _resp({"ok": False, "error": "密碼錯誤"}, 403)

        if action == "set":
            _clear_club_password(safe_key, club_name)
            db.reference(f"/club_passwords/{_p(safe_key)}").set(sha256(new_password))
            _set_meta_has_password(safe_key, True)
            return _resp({"ok": True, "hasPassword": True})

        if action == "remove":
            _clear_club_password(safe_key, club_name)
            _set_meta_has_password(safe_key, False)
            return _resp({"ok": True, "hasPassword": False})

        # rename：把密碼搬到新社團名稱底下
        if stored_hash:
            new_key = _club_key(new_club_name)
            if _get_club_hash(new_key, new_club_name):
                return _resp({"ok": False, "error": "新名稱已有密碼"}, 409)
            db.reference(f"/club_passwords/{_p(new_key)}").set(stored_hash)
            _clear_club_password(safe_key, club_name)
        return _resp({"ok": True, "hasPassword": bool(stored_hash)})
    except Exception as err:
        logging.exception(f"[manageClubPassword] 發生例外: {err}")
        return _resp({"ok": False, "error": "Internal Server Error"}, 500)


# ============================================================
# 7. HTTP REST API: 管理員賽事操作（刪除 / 改名）
#    已完賽賽事被資料庫規則鎖住，管理員需驗證 Master PIN 後由後端執行。
# ============================================================
@https_fn.on_request(cors=CORS_CONFIG, invoker="public")
def adminTournamentAction(req: https_fn.Request) -> https_fn.Response:
    def _resp(payload: dict, status: int = 200) -> https_fn.Response:
        return https_fn.Response(json.dumps(payload), status=status, mimetype="application/json")

    if req.method != "POST":
        return _resp({"error": "Method Not Allowed"}, 405)

    body = req.get_json(silent=True) or {}
    action = (body.get("action") or "").strip()
    tournament_id = (body.get("tournamentId") or "").strip()
    pin = (body.get("pin") or "").strip()
    new_name = (body.get("newName") or "").strip()

    if action not in ("delete", "rename") or not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", tournament_id):
        return _resp({"ok": False, "error": "參數錯誤"}, 400)
    if action == "rename" and (not new_name or len(new_name) > 100):
        return _resp({"ok": False, "error": "名稱不可空白或超過 100 字"}, 400)

    if _is_rate_limited(req, "admin"):
        return _too_many_attempts()

    try:
        master_hash = _get_master_hash()
        if not pin or not master_hash or sha256(pin) != master_hash:
            _record_failure(req, "admin")
            return _resp({"ok": False, "error": "管理員 PIN 驗證失敗，請重新登入管理員"}, 403)

        t_ref = db.reference(f"/tournaments/{tournament_id}")
        if action == "delete":
            t_ref.delete()
        else:
            if t_ref.child("id").get() is None:
                return _resp({"ok": False, "error": "找不到此賽事"}, 404)
            t_ref.child("name").set(new_name)
        return _resp({"ok": True})
    except Exception as err:
        logging.exception(f"[adminTournamentAction] 發生例外: {err}")
        return _resp({"ok": False, "error": "Internal Server Error"}, 500)


# ============================================================
# 8. HTTP REST API: 儲存社團說明 / 公開私密設定
#    有密碼的社團：資料庫規則禁止前端直接改，必須提供社團密碼或 Master PIN。
# ============================================================
CLUB_DESC_MAX = 200
CLUB_CREATOR_MAX = 20


@https_fn.on_request(cors=CORS_CONFIG, invoker="public")
def updateClubMeta(req: https_fn.Request) -> https_fn.Response:
    def _resp(payload: dict, status: int = 200) -> https_fn.Response:
        return https_fn.Response(json.dumps(payload, ensure_ascii=False), status=status, mimetype="application/json")

    if req.method != "POST":
        return _resp({"error": "Method Not Allowed"}, 405)

    body = req.get_json(silent=True) or {}
    club_name = (body.get("clubName") or "").strip()
    credential = (body.get("credential") or "").strip()
    description = body.get("description", None)
    is_private = body.get("isPrivate", None)
    creator = body.get("creator", None)

    if not club_name or len(club_name) > 40:
        return _resp({"ok": False, "error": "參數錯誤"}, 400)
    if description is not None and (not isinstance(description, str) or len(description) > CLUB_DESC_MAX):
        return _resp({"ok": False, "error": f"說明不可超過 {CLUB_DESC_MAX} 字"}, 400)
    if is_private is not None and not isinstance(is_private, bool):
        return _resp({"ok": False, "error": "參數錯誤"}, 400)
    if creator is not None and (not isinstance(creator, str) or len(creator.strip()) > CLUB_CREATOR_MAX):
        return _resp({"ok": False, "error": f"創建人不可超過 {CLUB_CREATOR_MAX} 字"}, 400)

    if _is_rate_limited(req, "club"):
        return _too_many_attempts()

    try:
        safe_key = _club_key(club_name)
        stored_hash = _get_club_hash(safe_key, club_name)
        if not _is_club_authorized(stored_hash, credential):
            _record_failure(req, "club")
            return _resp({"ok": False, "error": "密碼錯誤"}, 403)

        meta_ref = db.reference(f"/clubs_metadata/{_p(safe_key)}")
        existing = meta_ref.get() or {}
        if not isinstance(existing, dict):
            existing = {}
        changes: Dict[str, Any] = {"hasPassword": bool(stored_hash), "updatedAt": _now_ms()}
        if description is not None:
            changes["description"] = description.strip()
        if is_private is not None:
            changes["isPrivate"] = is_private
        if creator is not None:
            changes["creator"] = creator.strip()
        if not existing:
            changes["createdAt"] = _now_ms()
        meta_ref.update(changes)
        _delete_unescaped("clubs_metadata", safe_key)
        return _resp({"ok": True, "meta": {**existing, **changes}})
    except Exception as err:
        logging.exception(f"[updateClubMeta] 發生例外: {err}")
        return _resp({"ok": False, "error": "Internal Server Error"}, 500)



# ============================================================
# 社團改名 / 刪除的共用搬移流程（管理員與社團自助改名共用）
#    一次搬移或清除：賽事的社團名稱、成員名單、LINE 綁定、會員常用社團、密碼、說明、短網址。
# ============================================================
CLUB_NAME_MAX = 12


def _rename_conflict(new_name: str) -> str:
    """新名稱已被使用時回傳錯誤訊息，否則回傳空字串"""
    new_key = _club_key(new_name)
    if db.reference(f"/clubs_metadata/{_p(new_key)}").get() is not None:
        return "這個名稱已經有其他社團使用"
    if _get_club_hash(new_key, new_name):
        return "這個名稱已經有其他社團使用"
    if db.reference(f"/club_members/{_p(new_key)}").get():
        return "這個名稱已經有其他社團使用"
    if db.reference("/tournaments").order_by_child("clubName").equal_to(new_name).limit_to_first(1).get():
        return "這個名稱已經有其他社團使用"
    return ""


def _migrate_club(club_name: str, action: str, new_name: str = "") -> Dict[str, Any]:
    old_key = _club_key(club_name)
    new_key = _club_key(new_name) if action == "rename" else ""
    target_name = new_name if action == "rename" else ""
    old_uri = _uri_component(club_name)
    new_uri = _uri_component(new_name) if action == "rename" else ""

    updates: Dict[str, Any] = {}

    # 1. 賽事的社團名稱（含已完賽，後端不受資料庫規則限制）
    tournaments = db.reference("/tournaments").order_by_child("clubName").equal_to(club_name).get() or {}
    for tid in tournaments.keys():
        updates[f"tournaments/{tid}/clubName"] = target_name

    # 2. 成員名單
    members = db.reference(f"/club_members/{_p(old_key)}").get()
    updates[f"club_members/{old_key}"] = None
    if action == "rename" and members:
        updates[f"club_members/{new_key}"] = members

    # 3. 舊的 LINE 綁定資料（已停用，只跟著搬）
    mappings = db.reference(f"/club_mappings/{_p(old_key)}").get() or {}
    updates[f"club_mappings/{old_key}"] = None
    if action == "rename" and isinstance(mappings, dict) and mappings:
        updates[f"club_mappings/{new_key}"] = mappings

    # 4. 所有加入這個社團的會員（users/{LINE ID}/myClubs）與最後造訪的社團
    joined = 0
    users = db.reference("/users").get() or {}
    if isinstance(users, dict):
        for uid, u in users.items():
            if not isinstance(u, dict):
                continue
            my_clubs = u.get("myClubs")
            if isinstance(my_clubs, dict) and old_uri in my_clubs:
                joined += 1
                updates[f"users/{uid}/myClubs/{old_uri}"] = None
                if action == "rename":
                    updates[f"users/{uid}/myClubs/{new_uri}"] = True
            if u.get("lastClub") == club_name:
                updates[f"users/{uid}/lastClub"] = target_name or None

    # 5. 密碼
    stored_hash = _get_club_hash(old_key, club_name)
    updates[f"club_passwords/{old_key}"] = None
    legacy_key = _legacy_club_key(club_name)
    if legacy_key != old_key:
        updates[f"club_passwords/{legacy_key}"] = None
    if action == "rename" and stored_hash:
        updates[f"club_passwords/{new_key}"] = stored_hash

    # 6. 社團說明與短網址
    meta = db.reference(f"/clubs_metadata/{_p(old_key)}").get()
    updates[f"clubs_metadata/{old_key}"] = None
    code = meta.get("code") if isinstance(meta, dict) else None
    if action == "rename":
        base_meta = meta if isinstance(meta, dict) else {"createdAt": _now_ms()}
        updates[f"clubs_metadata/{new_key}"] = {**base_meta, "hasPassword": bool(stored_hash), "updatedAt": _now_ms()}
    if code and re.fullmatch(r"[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}", str(code)):
        updates[f"club_codes/{code}"] = new_key if action == "rename" else None

    # 7. 改名紀錄：舊的 ?club=舊名 連結還能找到新名字（連續改名時，更早的舊名也指向最新名字）
    renames = db.reference("/club_renames").get() or {}
    if isinstance(renames, dict):
        for k, v in renames.items():
            if v == club_name:
                updates[f"club_renames/{k}"] = target_name or None
    if action == "rename":
        updates[f"club_renames/{old_key}"] = new_name
        updates[f"club_renames/{new_key}"] = None

    db.reference("/").update(updates)
    # 清掉舊版後端誤寫的解碼位置（舊名、新名都清）
    for k in [old_key, _legacy_club_key(club_name)] + ([new_key] if new_key else []):
        for prefix in ("clubs_metadata", "club_members", "club_passwords"):
            if prefix == "club_passwords" and k == new_key:
                continue
            _delete_unescaped(prefix, k)
    return {
        "tournaments": len(tournaments),
        "members": joined,
        "bindings": len(mappings) if isinstance(mappings, dict) else 0,
    }

# ============================================================
# 9. HTTP REST API: 管理員社團改名 / 刪除（需 Master PIN）
#    一次搬移或清除：賽事的社團名稱、成員名單、LINE 綁定、會員常用社團、密碼、說明、短網址。
# ============================================================
@https_fn.on_request(cors=CORS_CONFIG, invoker="public")
def adminClubAction(req: https_fn.Request) -> https_fn.Response:
    def _resp(payload: dict, status: int = 200) -> https_fn.Response:
        return https_fn.Response(json.dumps(payload, ensure_ascii=False), status=status, mimetype="application/json")

    if req.method != "POST":
        return _resp({"error": "Method Not Allowed"}, 405)

    body = req.get_json(silent=True) or {}
    action = (body.get("action") or "").strip()
    club_name = (body.get("clubName") or "").strip()
    new_name = (body.get("newClubName") or "").strip()
    pin = (body.get("pin") or "").strip()

    if action not in ("rename", "delete") or not club_name or club_name == "__general__":
        return _resp({"ok": False, "error": "參數錯誤"}, 400)
    if action == "rename" and (not new_name or len(new_name) > 40 or new_name == club_name):
        return _resp({"ok": False, "error": "新名稱不可空白、相同或超過 40 字"}, 400)

    if _is_rate_limited(req, "admin"):
        return _too_many_attempts()

    try:
        master_hash = _get_master_hash()
        if not pin or not master_hash or sha256(pin) != master_hash:
            _record_failure(req, "admin")
            return _resp({"ok": False, "error": "管理員 PIN 驗證失敗，請重新登入管理員"}, 403)

        if action == "rename":
            conflict = _rename_conflict(new_name)
            if conflict:
                return _resp({"ok": False, "error": conflict}, 409)

        result = _migrate_club(club_name, action, new_name)
        return _resp({"ok": True, **result})
    except Exception as err:
        logging.exception(f"[adminClubAction] 發生例外: {err}")
        return _resp({"ok": False, "error": "Internal Server Error"}, 500)


# ============================================================
# 9a. HTTP REST API: 社團自助改名（社團有密碼 → 需社團密碼或 Master PIN；沒密碼 → 直接改）
# ============================================================
@https_fn.on_request(cors=CORS_CONFIG, invoker="public")
def renameClub(req: https_fn.Request) -> https_fn.Response:
    def _resp(payload: dict, status: int = 200) -> https_fn.Response:
        return https_fn.Response(json.dumps(payload, ensure_ascii=False), status=status, mimetype="application/json")

    if req.method != "POST":
        return _resp({"error": "Method Not Allowed"}, 405)

    body = req.get_json(silent=True) or {}
    club_name = (body.get("clubName") or "").strip()
    new_name = (body.get("newClubName") or "").strip()
    credential = (body.get("credential") or "").strip()

    if not club_name or club_name == "__general__" or len(club_name) > 40:
        return _resp({"ok": False, "error": "參數錯誤"}, 400)
    if not new_name or len(new_name) > CLUB_NAME_MAX or new_name == club_name:
        return _resp({"ok": False, "error": f"新名稱不可空白、相同或超過 {CLUB_NAME_MAX} 字"}, 400)
    if new_name.startswith("__"):
        return _resp({"ok": False, "error": "此名稱為系統保留字"}, 400)

    if _is_rate_limited(req, "club"):
        return _too_many_attempts()

    try:
        old_key = _club_key(club_name)
        if db.reference(f"/clubs_metadata/{_p(old_key)}").get() is None and not db.reference(f"/club_members/{_p(old_key)}").get():
            return _resp({"ok": False, "error": "找不到這個社團"}, 404)

        stored_hash = _get_club_hash(old_key, club_name)
        if not _is_club_authorized(stored_hash, credential):
            _record_failure(req, "club")
            return _resp({"ok": False, "error": "密碼錯誤"}, 403)

        conflict = _rename_conflict(new_name)
        if conflict:
            return _resp({"ok": False, "error": conflict}, 409)

        result = _migrate_club(club_name, "rename", new_name)
        return _resp({"ok": True, "newClubName": new_name, **result})
    except Exception as err:
        logging.exception(f"[renameClub] 發生例外: {err}")
        return _resp({"ok": False, "error": "Internal Server Error"}, 500)


# ============================================================
# 4b. HTTP REST API: 管理員會員漏斗統計（只回傳人數，不回傳任何名字或 LINE 代號）
# ============================================================
@https_fn.on_request(cors=CORS_CONFIG, invoker="public")
def adminUserStats(req: https_fn.Request) -> https_fn.Response:
    def _resp(payload: dict, status: int = 200) -> https_fn.Response:
        return https_fn.Response(json.dumps(payload, ensure_ascii=False), status=status, mimetype="application/json")

    if req.method != "POST":
        return _resp({"error": "Method Not Allowed"}, 405)

    body = req.get_json(silent=True) or {}
    pin = (body.get("pin") or "").strip()

    if _is_rate_limited(req, "admin"):
        return _too_many_attempts()

    try:
        master_hash = _get_master_hash()
        if not pin or not master_hash or sha256(pin) != master_hash:
            _record_failure(req, "admin")
            return _resp({"ok": False, "error": "管理員 PIN 驗證失敗，請重新登入管理員"}, 403)

        users = db.reference("/users").get() or {}
        mappings = db.reference("/club_mappings").get() or {}
        clubs_meta = db.reference("/clubs_metadata").get() or {}
        existing_clubs = {urllib.parse.unquote(k) for k in clubs_meta.keys()}

        tz = timezone(timedelta(hours=8))  # 台灣時間
        now = datetime.now(tz)
        today_start_ms = int(datetime(now.year, now.month, now.day, tzinfo=tz).timestamp() * 1000)
        now_ms = int(now.timestamp() * 1000)
        day_ms = 24 * 60 * 60 * 1000

        # 綁定：/club_mappings/{社團}/{LINE ID} = 球員名稱（只算現存社團）
        bound_uids = set()
        bound_by_club: Dict[str, set] = {}
        for key, entries in mappings.items():
            club = urllib.parse.unquote(key)
            if club not in existing_clubs or not isinstance(entries, dict):
                continue
            uids = {uid for uid, name in entries.items() if name}
            bound_by_club[club] = uids
            bound_uids |= uids

        total = len(users)
        active_today = active_7d = active_30d = 0
        joined_any = 0
        joined_by_club: Dict[str, int] = {c: 0 for c in existing_clubs}
        for uid, u in users.items():
            if not isinstance(u, dict):
                continue
            last = u.get("lastLoginAt") or 0
            if isinstance(last, (int, float)):
                if last >= today_start_ms:
                    active_today += 1
                if now_ms - last <= 7 * day_ms:
                    active_7d += 1
                if now_ms - last <= 30 * day_ms:
                    active_30d += 1
            my_clubs = u.get("myClubs") or {}
            joined = [urllib.parse.unquote(k) for k, v in my_clubs.items() if v] if isinstance(my_clubs, dict) else []
            joined = [c for c in joined if c in existing_clubs]
            if joined:
                joined_any += 1
            for c in joined:
                joined_by_club[c] += 1

        per_club = sorted(
            [{"club": c, "joined": joined_by_club.get(c, 0), "bound": len(bound_by_club.get(c, set()))} for c in existing_clubs],
            key=lambda x: (-x["joined"], x["club"])
        )
        return _resp({
            "ok": True,
            "totalUsers": total,
            "activeToday": active_today,
            "active7d": active_7d,
            "active30d": active_30d,
            "joinedAnyClub": joined_any,
            "boundAnyClub": len(bound_uids),
            "perClub": per_club
        })
    except Exception as err:
        logging.exception(f"[adminUserStats] 發生例外: {err}")
        return _resp({"ok": False, "error": "Internal Server Error"}, 500)


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
    if not secret or not signature:
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
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status == 200
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="ignore")
        logging.error(f"[LINE Webhook] Reply API HTTP error ({e.code}): {err_msg}")
        return False
    except Exception as e:
        logging.exception(f"[LINE Webhook] Reply API error: {e}")
        return False


def _get_user_info(user_id: str):
    """取得使用者加入的社團（myClubs）與關注紀錄（following）"""
    user_my_clubs = set()
    following = {}

    if not user_id:
        return user_my_clubs, following

    try:
        user_data = db.reference(f"/users/{user_id}").get() or {}
        if isinstance(user_data, dict):
            my_c = user_data.get("myClubs") or {}
            if isinstance(my_c, dict):
                user_my_clubs = {urllib.parse.unquote(k).strip() for k in my_c.keys()}
            f = user_data.get("following") or {}
            if isinstance(f, dict):
                following = f
    except Exception as e:
        print(f"[LINE Webhook] 讀取會員資料失敗: {e}")

    return user_my_clubs, following


def _is_following(t: dict, user_my_clubs: set, following: dict) -> bool:
    """與網頁「我的關注」相同的判斷：
    有關注紀錄 → 大於 0 才算關注（0 = 自己取消過）；
    沒有紀錄 → 自己加入的社團的賽事預設算關注"""
    if not isinstance(t, dict):
        return False
    t_id = str(t.get("id") or "")
    if t_id and t_id in following:
        try:
            return float(following[t_id]) > 0
        except (TypeError, ValueError):
            return False
    c_name = (t.get("clubName") or "").strip()
    return bool(c_name) and c_name in user_my_clubs


RECENT_TOURNAMENT_DAYS = 30


def _recent_tournaments() -> dict:
    """只讀取最近 30 天建立的賽事（依 createdAt 索引），避免每次都下載全部歷史資料"""
    since = (datetime.now(timezone.utc) - timedelta(days=RECENT_TOURNAMENT_DAYS)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    try:
        data = db.reference("/tournaments").order_by_child("createdAt").start_at(since).get() or {}
    except Exception as err:
        logging.warning(f"[Tournaments] 近期查詢失敗，改讀全部: {err}")
        data = db.reference("/tournaments").get() or {}
    return dict(data) if isinstance(data, dict) else {}


def _handle_my_activities(user_id: str) -> str:
    """
    處理【我的關注】：列出這個 LINE 帳號關注中、尚未結束的賽事（報名中／比賽中），
    判斷方式與網頁「我的關注」相同。
    """
    if not user_id:
        return f"⚠️ 無法取得您的 LINE 帳號，請開啟網頁查看「我的關注」：\n{LIFF_BASE_URL}"

    user_my_clubs, following = _get_user_info(user_id)

    tournaments_dict = _recent_tournaments()

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

        if not _is_following(t, user_my_clubs, following):
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
            "club": c_name or "臨打",
            "p_count": p_count,
            "max_p": max_p,
            "status": status,
            "notes": first_note
        })

    lines = ["【ZeroZeroTwo 我的關注】", ""]

    if not active_or_reg:
        lines.append("目前沒有關注中的報名中或比賽中賽事。")
        lines.append("在賽事頁點賽事名稱前的 ☆，就能加入關注。")
        lines.append("")
        lines.append("開啟「我的關注」：")
        lines.append(f"{LIFF_BASE_URL}")
        return "\n".join(lines)

    for idx, it in enumerate(active_or_reg[:5], 1):
        tag = "報名中" if it["status"] == "registering" else "比賽中"
        link = f"{LIFF_BASE_URL}?t={it['id']}"
        lines.append(f"{idx}. {it['name']} ({tag})")
        lines.append(f"-所屬：{it['club']}")
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
    user_my_clubs, following = _get_user_info(user_id) if user_id else (set(), {})

    tournaments_dict = _recent_tournaments()

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

        # 僅限連結的臨打賽事不公開列出
        if t.get("isPrivate") is True:
            continue

        # 篩選來源：
        # 1. 沒有社團建立的接龍活動 (not c_name)
        # 2. 或該 LINE ID 帳號下的社團 (c_name in user_my_clubs)
        if c_name:
            if not user_my_clubs or c_name not in user_my_clubs:
                continue

        # 已在「我的關注」裡的就不重複列出
        if user_id and _is_following(t, user_my_clubs, following):
            continue

        open_t.append(t)

    lines = ["【ZeroZeroTwo 等待報名活動】", ""]

    if not open_t:
        lines.append("目前沒有臨打及已參與社團的接龍活動")
        lines.append("")
        lines.append("發起新球局：")
        lines.append(f"{LIFF_BASE_URL}?page=create")
        return "\n".join(lines)

    for idx, t in enumerate(open_t[:5], 1):
        t_id = t.get("id", "")
        t_name = t.get("name", "未命名球局")
        c_name = (t.get("clubName") or "").strip() or "臨打"
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
        lines.append(f"{LIFF_BASE_URL}?t={t_id}")
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

    if not secret:
        logging.error("[LINE Webhook] 未設定 LINE_CHANNEL_SECRET，拒絕所有請求")
        return https_fn.Response("Server not configured", status=500)

    if not _verify_line_signature(secret, body_bytes, signature):
        logging.warning("[LINE Webhook] 簽名驗證失敗")
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
            if any(k in user_text for k in ["我的關注", "關注", "我的活動總表", "我的活動", "我的球局", "總表", "活動總表", "比賽中/已報名", "比賽中與已報名", "比賽中", "已報名"]):
                reply_content = _handle_my_activities(user_id)
                _reply_line_message(reply_token, reply_content, token)

            # 2. 搜尋接龍列表 (等待報名)
            elif any(k in user_text for k in ["搜尋接龍列表", "搜尋接龍", "接龍列表", "接龍", "揪團", "臨打列表", "等待報名", "開放報名"]):
                reply_content = _handle_open_registrations(user_id)
                _reply_line_message(reply_token, reply_content, token)

            # 3. 創建比賽
            elif any(k in user_text for k in ["創建比賽", "建立比賽", "建立賽事", "開局", "創建賽事"]):
                reply_content = (
                    "🏆【建立賽事】\n\n"
                    "支援「平均模式自動排賽」與「自由模式暢打」：\n"
                    f"{LIFF_BASE_URL}?page=create"
                )
                _reply_line_message(reply_token, reply_content, token)

            # 4. 其他預設引導訊息
            elif user_text in ["說明", "功能", "選單", "menu", "help", "幫助"]:
                reply_content = (
                    "🎾 ZeroZeroTwo 匹克球助手\n\n"
                    "輸入關鍵字：\n"
                    "1.「我的關注」：查看你關注的報名中、比賽中賽事\n"
                    "2.「搜尋接龍列表」：查看近期開放報名的賽事\n"
                    "3.「建立賽事」：前往建立賽事\n\n"
                    f"{LIFF_BASE_URL}"
                )
                _reply_line_message(reply_token, reply_content, token)

        return https_fn.Response("OK", status=200)
    except Exception as e:
        logging.exception(f"[LINE Webhook] 處理過程發生例外: {e}")
        return https_fn.Response(json.dumps({"error": "Internal Server Error"}), status=500, mimetype="application/json")



