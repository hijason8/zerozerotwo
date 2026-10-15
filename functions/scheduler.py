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

    # 3人以上單打模擬
    all_pairs = list(combinations(players_list, 2))
    best_matches = []
    best_spread = float("inf")

    for _ in range(15):
        games_played = {p: 0 for p in players_list}
        consecutive_plays = {p: 0 for p in players_list}
        consecutive_rests = {p: 0 for p in players_list}
        opponent_count = defaultdict(lambda: defaultdict(int))
        sim_matches = []

        for r in range(1, total_rounds + 1):
            shuffled_pairs = sorted(all_pairs, key=lambda _: random.random())
            min_played = min(games_played.values())
            best_pair = None
            min_cost = float("inf")

            for p1, p2 in shuffled_pairs:
                cost = (games_played[p1] + games_played[p2]) * 1000
                if games_played[p1] > min_played:
                    cost += (games_played[p1] - min_played) * 5000
                if games_played[p2] > min_played:
                    cost += (games_played[p2] - min_played) * 5000

                streak_limit = 1 if n >= 4 else 2
                if consecutive_plays[p1] >= streak_limit:
                    cost += 4000
                if consecutive_plays[p2] >= streak_limit:
                    cost += 4000

                would_rest = [p for p in players_list if p not in (p1, p2)]
                for rp in would_rest:
                    if consecutive_rests[rp] >= 2:
                        cost += consecutive_rests[rp] * 3000

                cost += opponent_count[p1][p2] * 600
                if cost < min_cost:
                    min_cost = cost
                    best_pair = (p1, p2)

            bp, rp = best_pair
            resting = [p for p in players_list if p not in (bp, rp)]
            games_played[bp] += 1
            games_played[rp] += 1
            consecutive_plays[bp] += 1
            consecutive_plays[rp] += 1
            consecutive_rests[bp] = 0
            consecutive_rests[rp] = 0
            for p in resting:
                consecutive_rests[p] += 1
                consecutive_plays[p] = 0

            opponent_count[bp][rp] += 1
            opponent_count[rp][bp] += 1

            sim_matches.append({
                "id": r,
                "roundName": f"Game {r}",
                "blue": [bp],
                "red": [rp],
                "resting": resting,
                "blueScore": None,
                "redScore": None,
                "completed": False,
                "voided": False
            })

        vals = list(games_played.values())
        spread = max(vals) - min(vals)
        if spread < best_spread:
            best_spread = spread
            best_matches = sim_matches
            if spread == 0:
                break

    return best_matches


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
