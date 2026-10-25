/**
 * ZeroZeroTwo - Pickleball Match Scheduler Module (ES6)
 * 包含：個人雙打輪轉排程 (加強型防隔離演算法)、單打輪轉排程、隊伍對抗循環賽程及總局數計算
 */

// Helper: 真實全循環 - 計算讓所有單位皆搭檔/對對手打過至少一輪所需的總局數
export function getFullRoundRobinGames(n, isTeamMode = false, isSingles = false) {
  if (n < 2) return 0;
  if (isTeamMode || isSingles) {
    return (n * (n - 1)) / 2;
  }
  const table = {
    4: 3,   // 每單位打3場，共3局
    5: 5,   // 每單位打4場，共5局
    6: 15,  // 每單位打10場，共15局
    7: 21,  // 每單位打12場，共21局
    8: 14,  // 每單位打7場，共14局
    9: 18,  // 每單位打8場，共18局
    10: 45  // 每單位打18場，共45局
  };
  if (table[n]) return table[n];
  const totalSlots = n * (n - 1);
  return totalSlots % 4 === 0 ? totalSlots / 4 : Math.ceil((totalSlots * 2) / 4);
}

// Helper: 個人單打 (1v1) 智慧輪播排程演算法
export function generateSinglesSchedule(playersList, durationHours = 2.0, estMinsPerGame = 15, scheduleMode = "fair", customTotalGames = 0) {
  const n = playersList.length;
  if (n < 2) return [];

  const totalMinutes = Math.round(durationHours * 60);
  const rawTargetGames = Math.max(1, Math.floor(totalMinutes / estMinsPerGame));

  function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
  const blockSize = n / gcd(2, n);

  let totalRounds = 0;
  if (scheduleMode === "round-robin") {
    totalRounds = customTotalGames || ((n * (n - 1)) / 2);
  } else if (customTotalGames && customTotalGames > 0) {
    totalRounds = customTotalGames;
  } else if (scheduleMode === "max") {
    totalRounds = Math.max(1, rawTargetGames);
  } else {
    let blocks = Math.round(rawTargetGames / blockSize);
    if (blocks < 1) blocks = 1;
    totalRounds = blocks * blockSize;
  }

  // 情況 1：僅 2 人對決，無板凳，交替藍紅方直球對決
  if (n === 2) {
    const p1 = playersList[0];
    const p2 = playersList[1];
    const matches = [];
    for (let r = 1; r <= totalRounds; r++) {
      const isEven = (r % 2 === 0);
      matches.push({
        id: r,
        roundName: `Game ${r}`,
        blue: [isEven ? p2 : p1],
        red: [isEven ? p1 : p2],
        resting: [],
        blueScore: null,
        redScore: null,
        completed: false,
        voided: false
      });
    }
    return matches;
  }

  // 情況 2：3 人以上單打輪播排程（多重重啟全域尋優）
  function runSinglesSim() {
    const gamesPlayed = {};
    const opponentCount = {};
    const consecutivePlays = {};
    const consecutiveRests = {};
    const blueCount = {};
    const redCount = {};

    playersList.forEach(p => {
      gamesPlayed[p] = 0;
      consecutivePlays[p] = 0;
      consecutiveRests[p] = 0;
      blueCount[p] = 0;
      redCount[p] = 0;
      opponentCount[p] = {};
      playersList.forEach(q => { opponentCount[p][q] = 0; });
    });

    const allPairs = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        allPairs.push([playersList[i], playersList[j]]);
      }
    }

    const simMatches = [];

    for (let r = 1; r <= totalRounds; r++) {
      let bestPair = null;
      let minCost = Infinity;

      const shuffledPairs = [...allPairs].sort(() => Math.random() - 0.5);
      const minPlayedAcrossAll = Math.min(...Object.values(gamesPlayed));

      for (const [p1, p2] of shuffledPairs) {
        let cost = 0;

        // 1. 出賽總場次越少越優先
        cost += (gamesPlayed[p1] + gamesPlayed[p2]) * 1000;

        // 2. 與全體最少出賽場次的落差懲罰（保證所有人局數差距 <= 1）
        if (gamesPlayed[p1] > minPlayedAcrossAll) cost += (gamesPlayed[p1] - minPlayedAcrossAll) * 5000;
        if (gamesPlayed[p2] > minPlayedAcrossAll) cost += (gamesPlayed[p2] - minPlayedAcrossAll) * 5000;

        // 3. 連打抑制
        if (n >= 4) {
          if (consecutivePlays[p1] >= 1) cost += 4000;
          if (consecutivePlays[p2] >= 1) cost += 4000;
        } else if (n === 3) {
          if (consecutivePlays[p1] >= 2) cost += 10000;
          if (consecutivePlays[p2] >= 2) cost += 10000;
        }

        // 4. 板凳防冷懲罰
        const wouldRest = playersList.filter(p => p !== p1 && p !== p2);
        wouldRest.forEach(rp => {
          if (consecutiveRests[rp] >= 2) cost += (consecutiveRests[rp] * 3000);
        });

        // 5. 對手對決次數懲罰（平均交手）
        const oppTimes = opponentCount[p1][p2] || 0;
        cost += oppTimes * 600;

        if (cost < minCost) {
          minCost = cost;
          bestPair = [p1, p2];
        }
      }

      const [bp, rp] = bestPair;
      let bluePlayer = bp;
      let redPlayer = rp;
      if (blueCount[bp] > blueCount[rp] || redCount[rp] > redCount[bp]) {
        bluePlayer = rp;
        redPlayer = bp;
      }

      const resting = playersList.filter(p => p !== bluePlayer && p !== redPlayer);

      gamesPlayed[bluePlayer]++;
      gamesPlayed[redPlayer]++;
      consecutivePlays[bluePlayer]++;
      consecutivePlays[redPlayer]++;
      consecutiveRests[bluePlayer] = 0;
      consecutiveRests[redPlayer] = 0;
      blueCount[bluePlayer]++;
      redCount[redPlayer]++;

      resting.forEach(p => {
        consecutiveRests[p]++;
        consecutivePlays[p] = 0;
      });

      opponentCount[bluePlayer][redPlayer]++;
      opponentCount[redPlayer][bluePlayer]++;

      simMatches.push({
        id: r,
        roundName: `Game ${r}`,
        blue: [bluePlayer],
        red: [redPlayer],
        resting: resting,
        blueScore: null,
        redScore: null,
        completed: false,
        voided: false
      });
    }

    return { matches: simMatches, gamesPlayed };
  }

  let bestMatches = null;
  let bestSpread = Infinity;

  for (let iter = 0; iter < 15; iter++) {
    const sim = runSinglesSim();
    const vals = Object.values(sim.gamesPlayed);
    const spread = Math.max(...vals) - Math.min(...vals);
    if (spread < bestSpread) {
      bestSpread = spread;
      bestMatches = sim.matches;
      if (spread === 0) break;
    }
  }

  return bestMatches;
}

// Helper: 隊伍對抗全循環對戰表 (1 隊 vs 1 隊)
export function generateTeamRoundRobinSchedule(teamsList) {
  const n = teamsList.length;
  if (n < 2) return [];

  const matches = [];
  let matchId = 1;

  const list = [...teamsList];
  if (list.length % 2 !== 0) {
    list.push(null);
  }
  const numTeams = list.length;
  const totalRounds = numTeams - 1;
  const half = numTeams / 2;

  for (let r = 0; r < totalRounds; r++) {
    for (let i = 0; i < half; i++) {
      const t1 = list[i];
      const t2 = list[numTeams - 1 - i];
      if (t1 !== null && t2 !== null) {
        const resting = list.filter(t => t !== null && t !== t1 && t !== t2);
        matches.push({
          id: matchId,
          roundName: `Game ${matchId}`,
          blue: [t1],
          red: [t2],
          resting: resting,
          blueScore: null,
          redScore: null,
          completed: false,
        });
        matchId++;
      }
    }
    list.splice(1, 0, list.pop());
  }

  return matches;
}

// Helper: 公平模式 - 調整總局數使每人場數完全一致
export function getValidTotalGames(n, rawTargetGames) {
  if (n < 4) return 0;
  function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
  const blockSize = n / gcd(4, n);
  let blocks = Math.round(rawTargetGames / blockSize);
  if (blocks < 1) blocks = 1;
  return blocks * blockSize;
}

// Helper: 最大模式 - 直接取最大局數，不調整
export function getMaxTotalGames(rawTargetGames) {
  return Math.max(3, rawTargetGames);
}

// ----------------------------------------------------
// 8 人完美全循環（固定排法）：14 局、每 2 局 8 人各上場一次（可兩面場同時打）
// 每人與其他 7 人各搭檔 1 次、各當對手 2 次。每次開賽隨機打亂名字、輪次順序與藍紅方
// ----------------------------------------------------
const PERFECT_8_ROUNDS = [
  [[[0, 1], [2, 3]], [[4, 5], [6, 7]]],
  [[[0, 2], [4, 6]], [[1, 3], [5, 7]]],
  [[[0, 3], [4, 7]], [[1, 2], [5, 6]]],
  [[[0, 4], [1, 5]], [[2, 6], [3, 7]]],
  [[[0, 5], [2, 7]], [[1, 4], [3, 6]]],
  [[[0, 6], [3, 5]], [[1, 7], [2, 4]]],
  [[[0, 7], [1, 6]], [[2, 5], [3, 4]]]
];

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generatePerfectEightSchedule(playersList) {
  const names = shuffled(playersList);
  const matches = [];
  shuffled(PERFECT_8_ROUNDS).forEach(round => {
    shuffled(round).forEach(game => {
      const [t1, t2] = Math.random() < 0.5 ? game : [game[1], game[0]];
      const blue = t1.map(i => names[i]);
      const red = t2.map(i => names[i]);
      const active = [...blue, ...red];
      const r = matches.length + 1;
      matches.push({
        id: r,
        roundName: `Game ${r}`,
        blue,
        red,
        resting: names.filter(x => !active.includes(x)),
        active,
        blueScore: null,
        redScore: null,
        completed: false,
        voided: false
      });
    });
  });
  return matches;
}

// ----------------------------------------------------
// INDIVIDUAL ROUND ROBIN ALGORITHM (升級版：個人雙打輪播 - 智慧動態候選池與全域尋優)
// 包含：四人同場熱度冷卻約束（防隔離內戰）與對手均衡化權重
// ----------------------------------------------------
export function generateRoundRobinSchedule(playersList, durationHours = 2.0, estMinsPerGame = 15, scheduleMode = "fair", customTotalGames = 0) {
  const n = playersList.length;
  if (n < 4) return [];

  const totalMinutes = Math.round(durationHours * 60);
  const rawTargetGames = Math.floor(totalMinutes / estMinsPerGame);

  let totalRounds = 0;
  if (scheduleMode === "round-robin") {
    totalRounds = customTotalGames || getFullRoundRobinGames(n);
  } else if (customTotalGames && customTotalGames > 0) {
    totalRounds = customTotalGames;
  } else if (scheduleMode === "max") {
    totalRounds = getMaxTotalGames(rawTargetGames);
  } else {
    totalRounds = getValidTotalGames(n, rawTargetGames);
  }

  // 8 人打滿 14 局：直接用完美排法（搭檔各 1 次、對手各 2 次）
  if (n === 8 && totalRounds === 14) {
    return generatePerfectEightSchedule(playersList);
  }

  function generateSingleSchedule() {
    const gamesPlayed = {};
    const partneredCount = {};
    const opponentCount = {};
    const consecutivePlays = {};
    const consecutiveRests = {};
    const recentQuads = [];

    playersList.forEach(p => {
      gamesPlayed[p] = 0;
      consecutivePlays[p] = 0;
      consecutiveRests[p] = 0;
      partneredCount[p] = {};
      opponentCount[p] = {};
      playersList.forEach(p2 => {
        partneredCount[p][p2] = 0;
        opponentCount[p][p2] = 0;
      });
    });

    const singleMatches = [];

    for (let r = 1; r <= totalRounds; r++) {
      const sortedPlayers = [...playersList].sort((a, b) => {
        if (gamesPlayed[a] !== gamesPlayed[b]) return gamesPlayed[a] - gamesPlayed[b];
        return Math.random() - 0.5;
      });

      // 智慧動態候選池：至多取 12 人，確保零重複搭檔解不被擋在池外，且維持毫秒級運算
      const pool = sortedPlayers.slice(0, Math.min(n, 12));
      const k = pool.length;

      let bestMatch = null;
      let minRoundCost = Infinity;

      for (let i = 0; i < k; i++) {
        for (let j = i + 1; j < k; j++) {
          for (let m = j + 1; m < k; m++) {
            for (let l = m + 1; l < k; l++) {
              const four = [pool[i], pool[j], pool[m], pool[l]];

              // 絕對底線一：所有人上場局數落差絕對不可大於 1 局
              let maxSim = -Infinity;
              let minSim = Infinity;
              playersList.forEach(p => {
                const simPlayed = gamesPlayed[p] + (four.includes(p) ? 1 : 0);
                if (simPlayed > maxSim) maxSim = simPlayed;
                if (simPlayed < minSim) minSim = simPlayed;
              });
              if (maxSim - minSim > 1) continue;

              // 核心約束：四人同場熱度冷卻（防止小團體連續隔離閉環打內戰）
              let quadOverlapCost = 0;
              recentQuads.forEach((rq, qIdx) => {
                const overlap = four.filter(x => rq.includes(x)).length;
                if (overlap >= 3) {
                  quadOverlapCost += (qIdx === recentQuads.length - 1 ? 60000 : 30000);
                }
              });

              const pairings = [
                { blue: [four[0], four[1]], red: [four[2], four[3]] },
                { blue: [four[0], four[2]], red: [four[1], four[3]] },
                { blue: [four[0], four[3]], red: [four[1], four[2]] }
              ];

              for (const p of pairings) {
                // 絕對底線二：搭檔重複重罰 (100000)
                const bRepeat = partneredCount[p.blue[0]][p.blue[1]];
                const rRepeat = partneredCount[p.red[0]][p.red[1]];
                const partnerCost = (bRepeat + rRepeat) * 100000;

                // 絕對底線三：抑制連打與板凳久休救援補償
                let streakCost = 0;
                let restReward = 0;
                four.forEach(player => {
                  if (consecutivePlays[player] >= 2) streakCost += 5000;
                  else if (consecutivePlays[player] === 1) streakCost += 50;

                  // 當連續休息達到 3 局以上，啟動階梯式救援獎勵，避免板凳坐穿
                  const rests = consecutiveRests[player];
                  if (rests >= 3) restReward += (rests - 2) * 500;
                });

                // 對手重複均衡化懲罰（從 1 提升至 200，均衡對打次數）
                let oppCost = 0;
                p.blue.forEach(bp => {
                  p.red.forEach(rp => { oppCost += opponentCount[bp][rp] * 200; });
                });

                const totalCost = partnerCost + streakCost + oppCost + quadOverlapCost - restReward + Math.random();
                if (totalCost < minRoundCost) {
                  minRoundCost = totalCost;
                  bestMatch = {
                    blue: p.blue,
                    red: p.red,
                    active: four,
                    resting: playersList.filter(x => !four.includes(x))
                  };
                }
              }
            }
          }
        }
      }

      // 備援保底
      if (!bestMatch) {
        const fallbackFour = pool.slice(0, 4);
        bestMatch = {
          blue: [fallbackFour[0], fallbackFour[1]],
          red: [fallbackFour[2], fallbackFour[3]],
          active: fallbackFour,
          resting: playersList.filter(x => !fallbackFour.includes(x))
        };
      }

      bestMatch.active.forEach(p => {
        gamesPlayed[p]++;
        consecutivePlays[p]++;
        consecutiveRests[p] = 0;
      });
      bestMatch.resting.forEach(p => {
        consecutiveRests[p]++;
        consecutivePlays[p] = 0;
      });

      partneredCount[bestMatch.blue[0]][bestMatch.blue[1]]++;
      partneredCount[bestMatch.blue[1]][bestMatch.blue[0]]++;
      partneredCount[bestMatch.red[0]][bestMatch.red[1]]++;
      partneredCount[bestMatch.red[1]][bestMatch.red[0]]++;

      bestMatch.blue.forEach(bp => {
        bestMatch.red.forEach(rp => {
          opponentCount[bp][rp]++;
          opponentCount[rp][bp]++;
        });
      });

      recentQuads.push(bestMatch.active);
      if (recentQuads.length > 2) recentQuads.shift();

      singleMatches.push({
        id: r,
        roundName: `Game ${r}`,
        blue: bestMatch.blue,
        red: bestMatch.red,
        resting: bestMatch.resting,
        active: bestMatch.active,
        blueScore: null,
        redScore: null,
        completed: false,
        voided: false
      });
    }

    return { matches: singleMatches, gamesPlayed, partneredCount };
  }

  // 多次重啟 (Multi-Restart) 全域尋優：在毫秒內尋找全域最優賽程
  const NUM_RESTARTS = 20;
  let bestGlobalMatches = null;
  let bestGlobalCost = Infinity;

  for (let iter = 0; iter < NUM_RESTARTS; iter++) {
    const schedule = generateSingleSchedule();
    const playedValues = Object.values(schedule.gamesPlayed);
    const spread = Math.max(...playedValues) - Math.min(...playedValues);

    let totalPartnerRepeats = 0;
    for (const p1 of playersList) {
      for (const p2 of playersList) {
        if (p1 >= p2) continue;
        const count = schedule.partneredCount[p1][p2] || 0;
        if (count > 1) totalPartnerRepeats += (count - 1);
      }
    }

    // 短期相鄰四人重複檢測（防止小團體連續內戰）
    let shortTermQuadRepeats = 0;
    const matchesList = schedule.matches;
    for (let i = 0; i < matchesList.length; i++) {
      for (let j = i + 1; j <= Math.min(matchesList.length - 1, i + 2); j++) {
        const m1Act = matchesList[i].active;
        const m2Act = matchesList[j].active;
        if (m1Act && m2Act) {
          const overlap = m1Act.filter(x => m2Act.includes(x)).length;
          if (overlap >= 4) shortTermQuadRepeats++;
        }
      }
    }

    const globalCost = (spread > 1 ? 10000000 : 0) + (totalPartnerRepeats * 100000) + (shortTermQuadRepeats * 50000);
    if (globalCost < bestGlobalCost) {
      bestGlobalCost = globalCost;
      bestGlobalMatches = schedule.matches;
      if (globalCost === 0) break; // 達到理論極限零重複搭檔與零短期隔離，立即返回
    }
  }

  return bestGlobalMatches || [];
}

if (typeof window !== "undefined") {
  window.getFullRoundRobinGames = getFullRoundRobinGames;
  window.generateSinglesSchedule = generateSinglesSchedule;
  window.generateTeamRoundRobinSchedule = generateTeamRoundRobinSchedule;
  window.getValidTotalGames = getValidTotalGames;
  window.getMaxTotalGames = getMaxTotalGames;
  window.generateRoundRobinSchedule = generateRoundRobinSchedule;
}
