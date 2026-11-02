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

  // 情況 2：3 人以上用分組輪轉排法（每組每人場數相同、整輪剛好每兩人對戰一次）
  return generateBalancedSinglesSchedule(playersList, totalRounds);
}

// ----------------------------------------------------
// 單打分組輪轉排法（3 人以上）
// 舊版逐場挑選會被「不連打」規則鎖死：偶數人數只打固定對手、7 人以上奇數全循環不完整。
// 新版先把所有對戰分成數組，每組內每人場數相同，所有組合起來剛好每兩人對戰 1 次：
//   - 偶數 n：輪轉法，每組 n/2 場、每人 1 場，共 n-1 組
//   - 奇數 n：間隔法，第 d 組是「第 i 人 對 第 i+d 人」，每組 n 場、每人 2 場，共 (n-1)/2 組
// 排序時：每組內逐場挑選（不連打 3 場、優先讓休息最久的人上場、同一組不連續對戰），
// 並從剩下的組裡挑跟前面銜接最好的一組接上。
// 取捨：組與組交界處，部分球員可能比舊版多休 1 場（舊版是靠固定對手才休得平均）。
// ----------------------------------------------------
function singlesBlocks(names) {
  const n = names.length;
  const blocks = [];
  if (n % 2 === 0) {
    const arr = [...names];
    for (let r = 0; r < n - 1; r++) {
      const games = [];
      for (let i = 0; i < n / 2; i++) games.push([arr[i], arr[n - 1 - i]]);
      blocks.push(games);
      arr.splice(1, 0, arr.pop()); // 第一位固定，其餘轉一格
    }
  } else {
    for (let d = 1; d <= (n - 1) / 2; d++) {
      const games = [];
      for (let i = 0; i < n; i++) games.push([names[i], names[(i + d) % n]]);
      blocks.push(games);
    }
  }
  return blocks;
}

function generateBalancedSinglesSchedule(playersList, totalRounds) {
  if (totalRounds <= 0) return [];
  const n = playersList.length;
  const restTarget = Math.max(1, Math.ceil((n - 2) / 2)); // 理想的最長休息局數
  const pairKey = g => [...g].sort().join("|");

  const newState = () => {
    const st = { gp: {}, cp: {}, cr: {}, last: null };
    playersList.forEach(p => { st.gp[p] = 0; st.cp[p] = 0; st.cr[p] = 0; });
    return st;
  };
  const cloneState = st => ({ gp: { ...st.gp }, cp: { ...st.cp }, cr: { ...st.cr }, last: st.last });

  // 加入一場的成本（越低越好）
  const stepCost = (st, g) => {
    let c = 0;
    let mx = -Infinity, mn = Infinity;
    playersList.forEach(p => {
      const playing = g.includes(p);
      const after = st.gp[p] + (playing ? 1 : 0);
      if (after > mx) mx = after;
      if (after < mn) mn = after;
      if (playing) {
        const v = st.cp[p] + 1;
        if (v >= 3) c += 10000; else if (v === 2) c += 100;
      } else {
        const v = st.cr[p] + 1;
        if (v > restTarget) c += (v - restTarget) * 300;
      }
    });
    c -= (st.cr[g[0]] + st.cr[g[1]]) * 40; // 休息越久越優先
    if (mx - mn > 1) c += 50000;
    if (pairKey(g) === st.last) c += 100000;
    return c;
  };
  const applyGame = (st, g) => {
    playersList.forEach(p => {
      if (g.includes(p)) { st.gp[p]++; st.cp[p]++; st.cr[p] = 0; } else { st.cr[p]++; st.cp[p] = 0; }
    });
    st.last = pairKey(g);
  };
  // 一組內逐場挑選順序（會改變 st）
  const orderBlock = (st, games) => {
    const remaining = shuffled(games);
    const out = [];
    let cost = 0;
    while (remaining.length > 0) {
      let bestIdx = 0, bestCost = Infinity;
      remaining.forEach((g, idx) => {
        const c = stepCost(st, g);
        if (c < bestCost) { bestCost = c; bestIdx = idx; }
      });
      const g = remaining.splice(bestIdx, 1)[0];
      cost += bestCost;
      applyGame(st, g);
      out.push(g);
    }
    return { out, cost };
  };

  function buildOnce() {
    const st = newState();
    const seq = [];
    let cost = 0;
    let blocks = [];
    while (seq.length < totalRounds) {
      if (blocks.length === 0) blocks = singlesBlocks(shuffled(playersList)); // 新的一輪
      // 從剩下的組裡挑銜接最好的一組
      let pick = null;
      blocks.forEach((games, idx) => {
        const trial = orderBlock(cloneState(st), games);
        if (!pick || trial.cost < pick.cost) pick = { idx, out: trial.out, cost: trial.cost };
      });
      blocks.splice(pick.idx, 1);
      for (const g of pick.out) {
        if (seq.length >= totalRounds) break;
        cost += stepCost(st, g);
        applyGame(st, g);
        seq.push(g);
      }
    }
    return { seq, cost };
  }

  let best = null;
  for (let iter = 0; iter < 40; iter++) {
    const res = buildOnce();
    if (!best || res.cost < best.cost) best = res;
  }

  // 藍紅方平均分配
  const side = {};
  playersList.forEach(p => { side[p] = 0; });
  return best.seq.map((g, idx) => {
    let [a, b] = Math.random() < 0.5 ? g : [g[1], g[0]];
    if (side[a] > side[b]) [a, b] = [b, a];
    side[a]++;
    side[b]--;
    return {
      id: idx + 1,
      roundName: `Game ${idx + 1}`,
      blue: [a],
      red: [b],
      resting: playersList.filter(x => x !== a && x !== b),
      blueScore: null,
      redScore: null,
      completed: false,
      voided: false
    };
  });
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
// 6 人完美排法（固定排法）：15 局一輪，數字 0~5 代表 6 位球員
// 每人打 10 休 5、每 3 局大家各休 1 次、不會連休、最多連打 3 局
// 每兩人：同隊剛好 2 次（不連續）、一起休息剛好 1 次（不會被綁在一起）、對打剛好 4 次
// 超過 15 局時，接一輪重新打亂名字的排法，並檢查銜接處
// ----------------------------------------------------
const PERFECT_6_GAMES = [
  [[2, 5], [3, 4]], [[0, 3], [1, 5]], [[0, 1], [2, 4]],
  [[0, 4], [3, 5]], [[1, 4], [2, 3]], [[0, 1], [2, 5]],
  [[0, 4], [1, 3]], [[0, 2], [3, 5]], [[1, 2], [4, 5]],
  [[0, 2], [3, 4]], [[0, 5], [1, 4]], [[1, 5], [2, 3]],
  [[0, 5], [2, 4]], [[0, 3], [1, 2]], [[1, 3], [4, 5]]
];

// 檢查兩輪銜接處：不能連休 2 局、不能連打超過 3 局、不能連續兩局同隊
function isSixJoinOk(prevGames, nextGames, names) {
  const seq = prevGames.slice(-4).concat(nextGames.slice(0, 4));
  for (const p of names) {
    let plays = 0, rests = 0;
    for (const g of seq) {
      if (g.active.includes(p)) { plays++; rests = 0; } else { rests++; plays = 0; }
      if (plays > 3 || rests > 1) return false;
    }
  }
  const last = prevGames[prevGames.length - 1];
  const first = nextGames[0];
  const key = t => [...t].sort().join("|");
  const lastPairs = [key(last.blue), key(last.red)];
  return !lastPairs.includes(key(first.blue)) && !lastPairs.includes(key(first.red));
}

export function generatePerfectSixSchedule(playersList, totalRounds) {
  const buildCycle = (names) => PERFECT_6_GAMES.map(game => {
    const [t1, t2] = Math.random() < 0.5 ? game : [game[1], game[0]];
    const blue = t1.map(i => names[i]);
    const red = t2.map(i => names[i]);
    return { blue, red, active: [...blue, ...red] };
  });

  let games = [];
  while (games.length < totalRounds) {
    let cycle = buildCycle(shuffled(playersList));
    if (games.length > 0) {
      for (let tries = 0; tries < 500 && !isSixJoinOk(games, cycle, playersList); tries++) {
        cycle = buildCycle(shuffled(playersList));
      }
    }
    games = games.concat(cycle);
  }

  return games.slice(0, totalRounds).map((g, idx) => ({
    id: idx + 1,
    roundName: `Game ${idx + 1}`,
    blue: g.blue,
    red: g.red,
    resting: playersList.filter(x => !g.active.includes(x)),
    active: g.active,
    blueScore: null,
    redScore: null,
    completed: false,
    voided: false
  }));
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

  // 6 人：用完美排法，避免休息組合固定成三對、兩人被綁在一起
  if (n === 6) {
    return generatePerfectSixSchedule(playersList, totalRounds);
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
