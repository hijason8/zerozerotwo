"""
ZeroZeroTwo - Pickleball Match Scheduler Core (Python Engine)
Pure function implementation of greedy scheduling with multi-restart global optimization:
- P0: Hard constraint on max-min game spread <= 1
- P1: Extreme penalty for repeated partners (100,000)
- P2: Streak restraint (>=2 consecutive games penalized) & bench rescue (>=3 consecutive rests rewarded)
- P3: Quad overlap cooling (penalize 3+ players repeatedly sharing the court)
- P4: Opponent matchup balance penalty
- P5: Multi-restart global search for theoretical optimum
"""

from typing import List, Dict, Any, Optional
import math
import random
from collections import defaultdict
from itertools import combinations


def get_full_round_robin_games(n: int, is_team_mode: bool = False, is_singles: bool = False) -> int:
    """計算真實全循環所需總局數"""
    if n < 2:
        return 0
    if is_team_mode or is_singles:
        return (n * (n - 1)) // 2

    table = {4: 3, 5: 5, 6: 15, 7: 21, 8: 14, 9: 18, 10: 45}
    if n in table:
        return table[n]

    total_slots = n * (n - 1)
    return total_slots // 4 if total_slots % 4 == 0 else math.ceil((total_slots * 2) / 4)


def get_valid_total_games(n: int, raw_target_games: int) -> int:
    """公平模式：依據區塊大小調整總局數，保證每人出賽局數完全均等"""
    if n < 4:
        return 0
    block_size = n // math.gcd(4, n)
    blocks = max(1, round(raw_target_games / block_size))
    return blocks * block_size


# 8 人完美全循環（固定排法）：14 局、每 2 局 8 人各上場一次（可兩面場同時打）
# 每人與其他 7 人各搭檔 1 次、各當對手 2 次。每次開賽隨機打亂名字、輪次順序與藍紅方
PERFECT_8_ROUNDS = [
    [[[0, 1], [2, 3]], [[4, 5], [6, 7]]],
    [[[0, 2], [4, 6]], [[1, 3], [5, 7]]],
    [[[0, 3], [4, 7]], [[1, 2], [5, 6]]],
    [[[0, 4], [1, 5]], [[2, 6], [3, 7]]],
    [[[0, 5], [2, 7]], [[1, 4], [3, 6]]],
    [[[0, 6], [3, 5]], [[1, 7], [2, 4]]],
    [[[0, 7], [1, 6]], [[2, 5], [3, 4]]],
]


def generate_perfect_eight_schedule(players_list: List[str]) -> List[Dict[str, Any]]:
    names = random.sample(players_list, len(players_list))
    matches: List[Dict[str, Any]] = []
    for rnd in random.sample(PERFECT_8_ROUNDS, len(PERFECT_8_ROUNDS)):
        for game in random.sample(rnd, len(rnd)):
            t1, t2 = (game[0], game[1]) if random.random() < 0.5 else (game[1], game[0])
            blue = [names[i] for i in t1]
            red = [names[i] for i in t2]
            active = blue + red
            r = len(matches) + 1
            matches.append({
                "id": r,
                "roundName": f"Game {r}",
                "blue": blue,
                "red": red,
                "resting": [x for x in names if x not in active],
                "active": active,
                "blueScore": None,
                "redScore": None,
                "completed": False,
                "voided": False
            })
    return matches


# 6 人完美排法（固定排法）：15 局一輪，數字 0~5 代表 6 位球員
# 每人打 10 休 5、每 3 局大家各休 1 次、不會連休、最多連打 3 局
# 每兩人：同隊剛好 2 次（不連續）、一起休息剛好 1 次（不會被綁在一起）、對打剛好 4 次
# 超過 15 局時，接一輪重新打亂名字的排法，並檢查銜接處
PERFECT_6_GAMES = [
    [[2, 5], [3, 4]], [[0, 3], [1, 5]], [[0, 1], [2, 4]],
    [[0, 4], [3, 5]], [[1, 4], [2, 3]], [[0, 1], [2, 5]],
    [[0, 4], [1, 3]], [[0, 2], [3, 5]], [[1, 2], [4, 5]],
    [[0, 2], [3, 4]], [[0, 5], [1, 4]], [[1, 5], [2, 3]],
    [[0, 5], [2, 4]], [[0, 3], [1, 2]], [[1, 3], [4, 5]],
]


def _is_six_join_ok(prev_games: List[Dict[str, Any]], next_games: List[Dict[str, Any]], names: List[str]) -> bool:
    """檢查兩輪銜接處：不能連休 2 局、不能連打超過 3 局、不能連續兩局同隊"""
    seq = prev_games[-4:] + next_games[:4]
    for p in names:
        plays = rests = 0
        for g in seq:
            if p in g["active"]:
                plays += 1
                rests = 0
            else:
                rests += 1
                plays = 0
            if plays > 3 or rests > 1:
                return False
    last_pairs = {frozenset(prev_games[-1]["blue"]), frozenset(prev_games[-1]["red"])}
    first = next_games[0]
    return frozenset(first["blue"]) not in last_pairs and frozenset(first["red"]) not in last_pairs


def generate_perfect_six_schedule(players_list: List[str], total_rounds: int) -> List[Dict[str, Any]]:
    def build_cycle(names: List[str]) -> List[Dict[str, Any]]:
        cycle = []
        for game in PERFECT_6_GAMES:
            t1, t2 = (game[0], game[1]) if random.random() < 0.5 else (game[1], game[0])
            blue = [names[i] for i in t1]
            red = [names[i] for i in t2]
            cycle.append({"blue": blue, "red": red, "active": blue + red})
        return cycle

    games: List[Dict[str, Any]] = []
    while len(games) < total_rounds:
        cycle = build_cycle(random.sample(players_list, len(players_list)))
        if games:
            tries = 0
            while tries < 500 and not _is_six_join_ok(games, cycle, players_list):
                cycle = build_cycle(random.sample(players_list, len(players_list)))
                tries += 1
        games.extend(cycle)

    matches: List[Dict[str, Any]] = []
    for idx, g in enumerate(games[:total_rounds]):
        r = idx + 1
        matches.append({
            "id": r,
            "roundName": f"Game {r}",
            "blue": g["blue"],
            "red": g["red"],
            "resting": [x for x in players_list if x not in g["active"]],
            "active": g["active"],
            "blueScore": None,
            "redScore": None,
            "completed": False,
            "voided": False
        })
    return matches


def generate_doubles_schedule(
    players_list: List[str],
    duration_hours: float = 2.0,
    est_mins_per_game: int = 15,
    schedule_mode: str = "fair",
    custom_total_games: int = 0
) -> List[Dict[str, Any]]:
    """個人雙打輪播排程 (Pure Function)"""
    n = len(players_list)
    if n < 4:
        return []

    total_minutes = round(duration_hours * 60)
    raw_target_games = max(1, total_minutes // est_mins_per_game)

    if schedule_mode == "round-robin":
        total_rounds = custom_total_games or get_full_round_robin_games(n)
    elif custom_total_games > 0:
        total_rounds = custom_total_games
    elif schedule_mode == "max":
        total_rounds = max(3, raw_target_games)
    else:
        total_rounds = get_valid_total_games(n, raw_target_games)

    # 8 人打滿 14 局：直接用完美排法（搭檔各 1 次、對手各 2 次）
    if n == 8 and total_rounds == 14:
        return generate_perfect_eight_schedule(players_list)

    # 6 人：用完美排法，避免休息組合固定成三對、兩人被綁在一起
    if n == 6:
        return generate_perfect_six_schedule(players_list, total_rounds)

    def run_single_simulation() -> Dict[str, Any]:
        games_played = {p: 0 for p in players_list}
        consecutive_plays = {p: 0 for p in players_list}
        consecutive_rests = {p: 0 for p in players_list}
        partnered_count = defaultdict(lambda: defaultdict(int))
        opponent_count = defaultdict(lambda: defaultdict(int))
        recent_quads = []
        matches = []

        for r in range(1, total_rounds + 1):
            sorted_players = sorted(
                players_list,
                key=lambda p: (games_played[p], random.random())
            )
            pool = sorted_players[:min(n, 12)]
            best_match = None
            min_round_cost = float("inf")

            for four in combinations(pool, 4):
                four_set = set(four)

                # P0 硬約束：任何人出賽局數落差絕對不可 > 1
                sim_played = [games_played[p] + (1 if p in four_set else 0) for p in players_list]
                if max(sim_played) - min(sim_played) > 1:
                    continue

                # P3 四人同場熱度冷卻（打破小圈圈連續內戰）
                quad_overlap_cost = 0
                for q_idx, rq in enumerate(recent_quads):
                    overlap = len(four_set.intersection(rq))
                    if overlap >= 3:
                        quad_overlap_cost += 60000 if q_idx == len(recent_quads) - 1 else 30000

                pairings = [
                    ((four[0], four[1]), (four[2], four[3])),
                    ((four[0], four[2]), (four[1], four[3])),
                    ((four[0], four[3]), (four[1], four[2])),
                ]

                for blue_team, red_team in pairings:
                    # P1 零重複搭檔懲罰
                    b_rep = partnered_count[blue_team[0]][blue_team[1]]
                    r_rep = partnered_count[red_team[0]][red_team[1]]
                    partner_cost = (b_rep + r_rep) * 100000

                    # P2 連打抑制與久休救援
                    streak_cost = 0
                    rest_reward = 0
                    for p in four:
                        if consecutive_plays[p] >= 2:
                            streak_cost += 5000
                        elif consecutive_plays[p] == 1:
                            streak_cost += 50

                        rests = consecutive_rests[p]
                        if rests >= 3:
                            rest_reward += (rests - 2) * 500

                    # P4 對手重複均衡化
                    opp_cost = sum(
                        opponent_count[bp][rp] * 200
                        for bp in blue_team for rp in red_team
                    )

                    total_cost = (
                        partner_cost + streak_cost + opp_cost +
                        quad_overlap_cost - rest_reward + random.random()
                    )

                    if total_cost < min_round_cost:
                        min_round_cost = total_cost
                        best_match = {
                            "blue": list(blue_team),
                            "red": list(red_team),
                            "active": list(four),
                            "resting": [p for p in players_list if p not in four_set]
                        }

            if not best_match:
                fallback = pool[:4]
                fb_set = set(fallback)
                best_match = {
                    "blue": [fallback[0], fallback[1]],
                    "red": [fallback[2], fallback[3]],
                    "active": fallback,
                    "resting": [p for p in players_list if p not in fb_set]
                }

            for p in best_match["active"]:
                games_played[p] += 1
                consecutive_plays[p] += 1
                consecutive_rests[p] = 0
            for p in best_match["resting"]:
                consecutive_rests[p] += 1
                consecutive_plays[p] = 0

            b1, b2 = best_match["blue"]
            r1, r2 = best_match["red"]
            partnered_count[b1][b2] += 1
            partnered_count[b2][b1] += 1
            partnered_count[r1][r2] += 1
            partnered_count[r2][r1] += 1

            for bp in (b1, b2):
                for rp in (r1, r2):
                    opponent_count[bp][rp] += 1
                    opponent_count[rp][bp] += 1

            recent_quads.append(set(best_match["active"]))
            if len(recent_quads) > 2:
                recent_quads.pop(0)

            matches.append({
                "id": r,
                "roundName": f"Game {r}",
                "blue": best_match["blue"],
                "red": best_match["red"],
                "resting": best_match["resting"],
                "active": best_match["active"],
                "blueScore": None,
                "redScore": None,
                "completed": False,
                "voided": False
            })

        return {"matches": matches, "games_played": games_played, "partnered_count": partnered_count}

    best_matches = []
    best_cost = float("inf")

    for _ in range(20):
        res = run_single_simulation()
        played = list(res["games_played"].values())
        spread = max(played) - min(played)

        repeats = 0
        p_count = res["partnered_count"]
        for i, p1 in enumerate(players_list):
            for p2 in players_list[i + 1:]:
                cnt = p_count[p1][p2]
                if cnt > 1:
                    repeats += (cnt - 1)

        # 短期相鄰四人重複檢測（防止小團體連續內戰）
        short_term_quad_repeats = 0
        matches_list = res["matches"]
        for i in range(len(matches_list)):
            for j in range(i + 1, min(len(matches_list), i + 3)):
                m1_act = set(matches_list[i].get("active", []))
                m2_act = set(matches_list[j].get("active", []))
                if len(m1_act.intersection(m2_act)) >= 4:
                    short_term_quad_repeats += 1

        cost = (10000000 if spread > 1 else 0) + (repeats * 100000) + (short_term_quad_repeats * 50000)
        if cost < best_cost:
            best_cost = cost
            best_matches = res["matches"]
            if cost == 0:
                break

    return best_matches


# 單打分組輪轉排法（3 人以上）
# 舊版逐場挑選會被「不連打」規則鎖死：偶數人數只打固定對手、7 人以上奇數全循環不完整。
# 新版先把所有對戰分成數組，每組內每人場數相同，所有組合起來剛好每兩人對戰 1 次：
#   - 偶數 n：輪轉法，每組 n/2 場、每人 1 場，共 n-1 組
#   - 奇數 n：間隔法，第 d 組是「第 i 人 對 第 i+d 人」，每組 n 場、每人 2 場，共 (n-1)/2 組
# 排序時：每組內逐場挑選（不連打 3 場、優先讓休息最久的人上場、同一組不連續對戰），
# 並從剩下的組裡挑跟前面銜接最好的一組接上。
# 取捨：組與組交界處，部分球員可能比舊版多休 1 場（舊版是靠固定對手才休得平均）。
def _singles_blocks(names: List[str]) -> List[List[List[str]]]:
    n = len(names)
    blocks = []
    if n % 2 == 0:
        arr = list(names)
        for _ in range(n - 1):
            blocks.append([[arr[i], arr[n - 1 - i]] for i in range(n // 2)])
            arr.insert(1, arr.pop())  # 第一位固定，其餘轉一格
    else:
        for d in range(1, (n - 1) // 2 + 1):
            blocks.append([[names[i], names[(i + d) % n]] for i in range(n)])
    return blocks


def generate_balanced_singles_schedule(players_list: List[str], total_rounds: int) -> List[Dict[str, Any]]:
    if total_rounds <= 0:
        return []
    n = len(players_list)
    rest_target = max(1, math.ceil((n - 2) / 2))  # 理想的最長休息局數

    def pair_key(g):
        return tuple(sorted(g))

    def new_state():
        return {"gp": {p: 0 for p in players_list}, "cp": {p: 0 for p in players_list},
                "cr": {p: 0 for p in players_list}, "last": None}

    def clone_state(st):
        return {"gp": dict(st["gp"]), "cp": dict(st["cp"]), "cr": dict(st["cr"]), "last": st["last"]}

    def step_cost(st, g):
        c = 0
        after = [st["gp"][p] + (1 if p in g else 0) for p in players_list]
        for p in players_list:
            if p in g:
                v = st["cp"][p] + 1
                if v >= 3:
                    c += 10000
                elif v == 2:
                    c += 100
            else:
                v = st["cr"][p] + 1
                if v > rest_target:
                    c += (v - rest_target) * 300
        c -= (st["cr"][g[0]] + st["cr"][g[1]]) * 40  # 休息越久越優先
        if max(after) - min(after) > 1:
            c += 50000
        if pair_key(g) == st["last"]:
            c += 100000
        return c

    def apply_game(st, g):
        for p in players_list:
            if p in g:
                st["gp"][p] += 1
                st["cp"][p] += 1
                st["cr"][p] = 0
            else:
                st["cr"][p] += 1
                st["cp"][p] = 0
        st["last"] = pair_key(g)

    def order_block(st, games):
        remaining = random.sample(games, len(games))
        out, cost = [], 0
        while remaining:
            costs = [step_cost(st, g) for g in remaining]
            idx = costs.index(min(costs))
            cost += costs[idx]
            g = remaining.pop(idx)
            apply_game(st, g)
            out.append(g)
        return out, cost

    def build_once():
        st = new_state()
        seq: List[List[str]] = []
        cost = 0
        blocks: List[List[List[str]]] = []
        while len(seq) < total_rounds:
            if not blocks:
                blocks = _singles_blocks(random.sample(players_list, len(players_list)))  # 新的一輪
            # 從剩下的組裡挑銜接最好的一組
            pick = None
            for idx, games in enumerate(blocks):
                out, c = order_block(clone_state(st), games)
                if pick is None or c < pick[2]:
                    pick = (idx, out, c)
            blocks.pop(pick[0])
            for g in pick[1]:
                if len(seq) >= total_rounds:
                    break
                cost += step_cost(st, g)
                apply_game(st, g)
                seq.append(g)
        return seq, cost

    best_seq, best_cost = None, float("inf")
    for _ in range(40):
        seq, cost = build_once()
        if cost < best_cost:
            best_seq, best_cost = seq, cost

    # 藍紅方平均分配
    side = {p: 0 for p in players_list}
    matches: List[Dict[str, Any]] = []
    for idx, g in enumerate(best_seq):
        a, b = (g[0], g[1]) if random.random() < 0.5 else (g[1], g[0])
        if side[a] > side[b]:
            a, b = b, a
        side[a] += 1
        side[b] -= 1
        matches.append({
            "id": idx + 1,
            "roundName": f"Game {idx + 1}",
            "blue": [a],
            "red": [b],
            "resting": [x for x in players_list if x != a and x != b],
            "blueScore": None,
            "redScore": None,
            "completed": False,
            "voided": False
        })
    return matches


def generate_singles_schedule(
    players_list: List[str],
    duration_hours: float = 2.0,
    est_mins_per_game: int = 15,
    schedule_mode: str = "fair",
    custom_total_games: int = 0
) -> List[Dict[str, Any]]:
    """個人單打 (1v1) 智慧輪播排程演算法"""
    n = len(players_list)
    if n < 2:
        return []

    total_minutes = round(duration_hours * 60)
    raw_target_games = max(1, total_minutes // est_mins_per_game)

    block_size = n // math.gcd(2, n)
    if schedule_mode == "round-robin":
        total_rounds = custom_total_games or ((n * (n - 1)) // 2)
    elif custom_total_games > 0:
        total_rounds = custom_total_games
    elif schedule_mode == "max":
        total_rounds = max(1, raw_target_games)
    else:
        blocks = max(1, round(raw_target_games / block_size))
        total_rounds = blocks * block_size

    if n == 2:
        p1, p2 = players_list[0], players_list[1]
        return [{
            "id": r,
            "roundName": f"Game {r}",
            "blue": [p2 if r % 2 == 0 else p1],
            "red": [p1 if r % 2 == 0 else p2],
            "resting": [],
            "blueScore": None,
            "redScore": None,
            "completed": False,
            "voided": False
        } for r in range(1, total_rounds + 1)]

    # 3 人以上用分組輪轉排法（每組每人場數相同、整輪剛好每兩人對戰一次）
    return generate_balanced_singles_schedule(players_list, total_rounds)


def generate_team_schedule(teams_list: List[str]) -> List[Dict[str, Any]]:
    """隊伍對抗全循環對戰表 (1 隊 vs 1 隊)"""
    n = len(teams_list)
    if n < 2:
        return []

    matches = []
    match_id = 1
    t_list = list(teams_list)
    if len(t_list) % 2 != 0:
        t_list.append(None)

    num_teams = len(t_list)
    total_rounds = num_teams - 1
    half = num_teams // 2

    for _ in range(total_rounds):
        for i in range(half):
            t1 = t_list[i]
            t2 = t_list[num_teams - 1 - i]
            if t1 is not None and t2 is not None:
                resting = [t for t in t_list if t is not None and t not in (t1, t2)]
                matches.append({
                    "id": match_id,
                    "roundName": f"Game {match_id}",
                    "blue": [t1],
                    "red": [t2],
                    "resting": resting,
                    "blueScore": None,
                    "redScore": None,
                    "completed": False,
                    "voided": False
                })
                match_id += 1
        t_list.insert(1, t_list.pop())

    return matches
