/* ==========================================================================
   포켓몬스터 울트라 익스팬션 - 확장 레이어 (pokemon.js → learnsets.js 다음에 로드)

   기존 시스템(전투/포획/도감/젬/메가진화/세이브)과 디자인은 그대로 두고,
   아래 시스템을 덧씌운다. window 'load'에서 GameEngine이 만들어지기 전에
   prototype을 확장하므로 모든 인스턴스에 적용된다.

     1. 성도(하트골드·소울실버) 지방 맵 - 마을/도로/동굴/바다 배치와 이동 제한
     2. 실제 게임 기술 - 레벨업 기술표·기술 데이터(위력/명중/PP/부가효과)
     3. 기술 습득/망각 - 레벨업 즉시 선택, 정보 화면에서 잊기·다시 배우기
     4. 필드 이펙트 · 레벨 제한과 불복종 · 트레이너 AI (리본 스타일 시스템)
     5. 버그 수정 - 전투 중 가방, 박치기형 기술 연출, 스타팅 포켓몬 확장
   ========================================================================== */

(function () {
    'use strict';

    const RB = window.RB = {};
    const $ = (id) => document.getElementById(id);
    const rand = Math.random;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const pickOne = (arr) => arr[Math.floor(rand() * arr.length)];
    const josa = (word, withBatchim, without) => {
        const ch = String(word || '').trim().slice(-1);
        const code = ch.charCodeAt(0) - 0xAC00;
        if (code < 0 || code > 11171) return withBatchim + '(' + without + ')';
        return (code % 28) ? withBatchim : without;
    };
    RB.josa = josa;

    /* ======================================================================
       1. 실제 게임 기술 데이터
       learnsets.js(RB_LEARN_DATA)의 기술을 SKILL_DATABASE에 'M<기술번호>' 키로
       등록하고, 모든 포켓몬의 레벨업 기술표를 실제 게임 것으로 교체한다.
       ====================================================================== */
    const STAT_KEYS = { 2: 'atk', 3: 'def', 4: 'spAtk', 5: 'spDef', 6: 'spe', 7: 'acc', 8: 'eva' };
    const STAT_NAMES = { atk: '공격', def: '방어', spAtk: '특수공격', spDef: '특수방어', spe: '스피드', acc: '명중률', eva: '회피율' };
    const AILMENT_STATUS = { 1: 'PARALYSIS', 2: 'SLEEP', 3: 'FREEZE', 4: 'BURN', 5: 'POISON' };
    const SELF_TARGETS = new Set([4, 5, 7, 13, 15]);
    const WEATHER_MOVES = { 'rain-dance': [1, '비가 내리기 시작했다!'], 'sunny-day': [4, '햇살이 강해졌다!'], 'sandstorm': [2, '모래바람이 불기 시작했다!'], 'hail': [3, '싸라기눈이 내리기 시작했다!'], 'snowscape': [3, '눈이 내리기 시작했다!'] };

    function buildMoveFromData(id, d) {
        const hits = (d.h0 && d.h1) ? (d.h0 === d.h1 ? d.h0 : Math.round((d.h0 + d.h1) / 2 + 0.5)) : 1;
        const mv = { name: d.n, power: d.p ? d.p * hits : 0, type: d.t, accuracy: d.a, category: d.c, basePp: d.pp, rbId: id, rb: d };
        if (d.pr) mv.priority = d.pr;
        if (hits > 1) mv.rbHits = hits;
        if (d.dr > 0) mv.drain = d.dr / 100;
        if (d.dr < 0) mv.recoil = -d.dr / 100;
        const hasEffect = d.ai || d.fc || (d.st && d.st.length) || d.he || d.c === '변화';
        if (hasEffect) { mv.status = 'RB_EFFECT'; mv.statusChance = 1; }
        return mv;
    }

    const LEARN = {};
    RB.LEARN = LEARN;

    /* 해당 레벨에서 알고 있을 기술 4개 (실제 게임처럼 가장 최근에 배운 4개) */
    RB.movesAtLevel = function (speciesId, level) {
        const ls = LEARN[speciesId];
        if (!ls) return [];
        const known = [];
        ls.forEach(L => {
            if (L.lv > level) return;
            const i = known.indexOf(L.key);
            if (i >= 0) known.splice(i, 1);
            known.push(L.key);
        });
        return known.slice(-4);
    };

    if (typeof RB_LEARN_DATA !== 'undefined') {
        Object.entries(RB_LEARN_DATA.moves).forEach(([id, d]) => { SKILL_DATABASE['M' + id] = buildMoveFromData(+id, d); });
        Object.entries(RB_LEARN_DATA.learn).forEach(([pid, flat]) => {
            const list = [];
            for (let i = 0; i < flat.length; i += 2) {
                const key = 'M' + flat[i + 1];
                if (SKILL_DATABASE[key]) list.push({ lv: flat[i], key });
            }
            LEARN[pid] = list;
        });
        POKEMON_DATABASE.forEach(p => {
            const ls = LEARN[p.id];
            if (!ls || !ls.length) return;
            p.learnset = ls;
            p.skills = RB.movesAtLevel(p.id, 1).map(k => SKILL_DATABASE[k]);
        });
    }

    /* PP는 실제 게임 수치 */
    const _computeMaxPP = computeMaxPP;
    computeMaxPP = function (move) { return (move && move.basePp) ? move.basePp : _computeMaxPP(move); };

    /* ======================================================================
       2. 필드 이펙트 (리본 스타일)
       ====================================================================== */
    const FIELDS = {
        NONE: { name: '일반 필드', icon: '◻️', color: '#94a3b8', desc: '특별한 효과가 없는 평범한 전장.', mult: {} },
        FACTORY: {
            name: '강철 필드', icon: '⚙️', color: '#64748b',
            desc: '강철 ×1.5, 전기 ×1.2. 위력 80 이상의 전기 기술은 일렉트릭 필드를 만든다.',
            mult: { '강철': 1.5, '전기': 1.2 },
            shift: { '전기': ['ELECTRIC', '전류가 금속을 타고 퍼져 나간다!', 80] },
            stage: { sky: 0x8aa0b4, ground: 0x6b7280, ridge: 0x3f4854, hill: 0x556070 }
        },
        ELECTRIC: {
            name: '일렉트릭 필드', icon: '⚡', color: '#eab308',
            desc: '전기 ×1.5. 땅에 선 포켓몬은 잠들지 않는다. 땅 기술이 전류를 없앤다.',
            mult: { '전기': 1.5 }, noSleep: true,
            shift: { '땅': ['NONE', '땅이 전류를 모두 흡수했다!'] },
            stage: { sky: 0xfff3b0, ground: 0xa89a3a, ridge: 0x6b6320, hill: 0xc4b04a }
        },
        GRASSY: {
            name: '그래스 필드', icon: '🌿', color: '#22c55e',
            desc: '풀 ×1.5, 땅 ×0.7. 턴마다 땅에 선 포켓몬 HP 1/16 회복. 불꽃 기술이 닿으면 불타는 필드.',
            mult: { '풀': 1.5, '땅': 0.7 }, endHeal: 1 / 16,
            shift: { '불꽃': ['BURNING', '풀밭에 불이 옮겨붙었다!'] }
        },
        FOREST: {
            name: '숲 필드', icon: '🌲', color: '#15803d',
            desc: '벌레 ×1.5, 풀 ×1.3, 비행 ×0.8. 불꽃 기술이 닿으면 불타는 필드.',
            mult: { '벌레': 1.5, '풀': 1.3, '비행': 0.8 },
            shift: { '불꽃': ['BURNING', '숲에 불길이 번졌다!'] }
        },
        BURNING: {
            name: '불타는 필드', icon: '🔥', color: '#f97316',
            desc: '불꽃 ×1.5, 풀·얼음 ×0.5. 턴마다 불꽃 타입이 아닌 땅 위 포켓몬에게 1/8 데미지. 물 기술로 끌 수 있다.',
            mult: { '불꽃': 1.5, '풀': 0.5, '얼음': 0.5 },
            endDmg: { frac: 1 / 8, immune: ['불꽃'], msg: '불길에 휩싸였다!' },
            shift: { '물': ['NONE', '물줄기가 불길을 잠재웠다!'] },
            stage: { sky: 0xffa36b, ground: 0x6b2a12, ridge: 0x7c2d12, hill: 0x9a3412 }
        },
        VOLCANIC: {
            name: '화산 필드', icon: '🌋', color: '#ef4444',
            desc: '불꽃 ×1.5, 바위 ×1.2, 얼음 ×0.5. 턴마다 불꽃·바위가 아닌 포켓몬에게 1/16 데미지. 물 기술은 수증기(미스트 필드)를 만든다.',
            mult: { '불꽃': 1.5, '바위': 1.2, '얼음': 0.5 },
            endDmg: { frac: 1 / 16, immune: ['불꽃', '바위'], msg: '뜨거운 열기에 데였다!' },
            shift: { '물': ['MISTY', '수증기가 자욱하게 피어오른다!'] }
        },
        WATER: {
            name: '수면 필드', icon: '🌊', color: '#0ea5e9',
            desc: '물 ×1.5, 전기 ×1.3, 불꽃 ×0.6. 얼음 기술은 수면을 얼리고, 독 기술은 물을 오염시킨다.',
            mult: { '물': 1.5, '전기': 1.3, '불꽃': 0.6 },
            shift: { '얼음': ['ICY', '수면이 순식간에 얼어붙었다!'], '독': ['CORROSIVE', '독이 물에 번졌다!'] }
        },
        ICY: {
            name: '빙판 필드', icon: '🧊', color: '#67e8f9',
            desc: '얼음 ×1.5, 격투 ×0.8. 불꽃 기술이 얼음을 녹여 수면 필드가 된다.',
            mult: { '얼음': 1.5, '격투': 0.8 },
            shift: { '불꽃': ['WATER', '얼음이 녹아내려 물바다가 되었다!'] }
        },
        DESERT: {
            name: '모래 필드', icon: '🏜️', color: '#d6a354',
            desc: '땅 ×1.3, 바위 ×1.2, 물 ×0.8. 턴마다 바위·땅·강철이 아닌 포켓몬에게 1/16 데미지.',
            mult: { '땅': 1.3, '바위': 1.2, '물': 0.8 },
            endDmg: { frac: 1 / 16, immune: ['바위', '땅', '강철'], msg: '모래 먼지에 휩쓸렸다!', all: true }
        },
        CAVE: {
            name: '동굴 필드', icon: '⛏️', color: '#78716c',
            desc: '바위 ×1.5, 땅 ×1.2, 비행 ×0.5 (낮은 천장).',
            mult: { '바위': 1.5, '땅': 1.2, '비행': 0.5 }
        },
        MOUNTAIN: {
            name: '산악 필드', icon: '⛰️', color: '#94a3b8',
            desc: '바위 ×1.3, 비행 ×1.3 (거센 산바람), 격투 ×1.2.',
            mult: { '바위': 1.3, '비행': 1.3, '격투': 1.2 }
        },
        CORROSIVE: {
            name: '오염 필드', icon: '☣️', color: '#84cc16',
            desc: '독 ×1.5, 풀 ×0.8. 턴마다 독·강철이 아닌 땅 위 포켓몬에게 1/16 데미지. 페어리 기술이 정화한다.',
            mult: { '독': 1.5, '풀': 0.8 },
            endDmg: { frac: 1 / 16, immune: ['독', '강철'], msg: '독기에 시달렸다!' },
            shift: { '페어리': ['MISTY', '오염이 말끔히 정화되었다!'] }
        },
        MISTY: {
            name: '미스트 필드', icon: '🌸', color: '#f472b6',
            desc: '페어리 ×1.5, 드래곤 ×0.5. 땅에 선 포켓몬은 상태이상에 걸리지 않는다. 독 기술이 안개를 오염시킨다.',
            mult: { '페어리': 1.5, '드래곤': 0.5 }, noStatus: true,
            shift: { '독': ['CORROSIVE', '독이 안개에 스며들었다!'] }
        },
        PSYCHIC: {
            name: '사이코 필드', icon: '🔮', color: '#d946ef',
            desc: '에스퍼 ×1.5. 땅에 선 포켓몬을 노린 선제 기술이 무효가 된다.',
            mult: { '에스퍼': 1.5 }, blockPriority: true
        },
        DARK: {
            name: '어둠 필드', icon: '🌑', color: '#6366f1',
            desc: '밤의 전장. 악·고스트 ×1.5, 에스퍼 ×0.7, 페어리 ×0.8. 페어리 기술의 빛이 어둠을 걷어낸다.',
            mult: { '악': 1.5, '고스트': 1.5, '에스퍼': 0.7, '페어리': 0.8 },
            shift: { '페어리': ['NONE', '눈부신 빛이 어둠을 몰아냈다!'] }
        },
        RUINS: {
            name: '유적 필드', icon: '🏛️', color: '#d97706',
            desc: '드래곤 ×1.5, 에스퍼 ×1.3, 고스트 ×1.2.',
            mult: { '드래곤': 1.5, '에스퍼': 1.3, '고스트': 1.2 }
        },
        SKY: {
            name: '하늘 필드', icon: '🌤️', color: '#38bdf8',
            desc: '높은 탑 위의 전장. 비행 ×1.5, 바위 ×0.8.',
            mult: { '비행': 1.5, '바위': 0.8 }
        }
    };
    RB.FIELDS = FIELDS;

    function fieldForTile(tile, isNight) {
        const T = TILE_TYPES;
        switch (tile) {
            case T.TALL_GRASS: return 'GRASSY';
            case T.FOREST: case T.BAMBOO: return 'FOREST';
            case T.WATER: case T.BEACH: return 'WATER';
            case T.SAND: case T.WASTELAND: return 'DESERT';
            case T.SNOW: case T.ICE_FIELD: return 'ICY';
            case T.VOLCANO: return 'VOLCANIC';
            case T.ROCK: return 'MOUNTAIN';
            case T.CAVE: return 'CAVE';
            case T.SWAMP: return 'CORROSIVE';
            case T.FLOWER: case T.CHERRY: return 'MISTY';
            case T.RUINS: return 'RUINS';
            default: return isNight ? 'DARK' : 'NONE';
        }
    }
    RB.fieldForTile = fieldForTile;

    function isGrounded(pkm) {
        if (!pkm) return false;
        if (pkm.type1 === '비행' || pkm.type2 === '비행') return false;
        return pkm.ability !== 'LEVITATE';
    }
    function hasType(pkm, t) { return !!pkm && (pkm.type1 === t || pkm.type2 === t); }

    /* ======================================================================
       3. 성도 지방 - 체육관 / 챔피언 / 레벨 제한 / 스타팅
       ====================================================================== */
    const JOHTO_GYMS = {
        '도라지시티': { order: 1, leaderName: '비상', title: '비행 타입 체육관 관장', badgeName: '윙배지', field: 'SKY', items: 0,
            team: [16, 17], levels: [9, 13], prize: 1300,
            intro: ['하늘을 나는 포켓몬의 진짜 힘, 보여주지!'], outro: ['...졌다. 윙배지를 가져가라.'] },
        '고동마을': { order: 2, leaderName: '호일', title: '벌레 타입 체육관 관장', badgeName: '인섹트배지', field: 'FOREST', items: 0,
            team: [11, 14, 123], levels: [15, 15, 17], prize: 1700,
            intro: ['벌레 포켓몬에 대해선 누구보다 잘 알아. 연구 성과를 보여줄게!'], outro: ['내 연구가 부족했나 봐. 인섹트배지야!'] },
        '금빛시티': { order: 3, leaderName: '꼭두', title: '노말 타입 체육관 관장', badgeName: '레귤러배지', field: 'NONE', items: 1,
            team: [35, 241], levels: [17, 19], prize: 1900,
            intro: ['다들 내 포켓몬이 귀엽다고만 하는데... 강하기도 하다고!'], outro: ['흑... 너무해! ...알았어, 레귤러배지 줄게.'] },
        '인주시티': { order: 4, leaderName: '유빈', title: '고스트 타입 체육관 관장', badgeName: '팬텀배지', field: 'DARK', items: 1,
            team: [92, 93, 93, 94], levels: [21, 21, 23, 25], prize: 2500,
            intro: ['이 마을에는 무지갯빛 포켓몬의 전설이 전해진다. 네가 그 자격이 있는지 보자.'], outro: ['네 안에서 빛을 봤다. 팬텀배지를 받아라.'] },
        '진청시티': { order: 5, leaderName: '사도', title: '격투 타입 체육관 관장', badgeName: '쇼크배지', field: 'WATER', items: 1,
            team: [57, 62], levels: [27, 30], prize: 3000,
            intro: ['폭포 수행으로 단련한 우리 힘, 받아봐라! 우오오오!'], outro: ['크으... 강하군! 쇼크배지다!'] },
        '담청시티': { order: 6, leaderName: '규리', title: '강철 타입 체육관 관장', badgeName: '스틸배지', field: 'FACTORY', items: 1,
            team: [81, 81, 208], levels: [30, 30, 35], prize: 3500,
            intro: ['저... 강철 타입을 쓰는 규리라고 해요. 잘 부탁드려요.'], outro: ['정말 훌륭하세요... 스틸배지를 드릴게요.'] },
        '황토마을': { order: 7, leaderName: '류옹', title: '얼음 타입 체육관 관장', badgeName: '아이스배지', field: 'ICY', items: 2,
            team: [86, 87, 221], levels: [30, 32, 34], prize: 3400,
            intro: ['50년 동안 얼음 포켓몬과 함께했지. 이 추위를 견딜 수 있겠나?'], outro: ['허허, 대단하군. 아이스배지를 가져가게.'] },
        '검은먹시티': { order: 8, leaderName: '이향', title: '드래곤 타입 체육관 관장', badgeName: '라이징배지', field: 'RUINS', items: 2,
            team: [148, 148, 130, 230], levels: [38, 38, 38, 41], prize: 4100,
            intro: ['최고의 드래곤 조련사 이향이다. 각오해라!'], outro: ['...인정할 수 없지만, 졌어. 라이징배지다.'] }
    };
    Object.keys(GYM_LEADERS).forEach(k => delete GYM_LEADERS[k]);
    Object.assign(GYM_LEADERS, JOHTO_GYMS);
    const CHAMPION_TOWN = '석영고원';
    Object.assign(CHAMPION_DATA, {
        leaderName: '목호', badgeName: '챔피언 트로피', field: 'RUINS', items: 2,
        team: [130, 149, 149, 142, 6, 149], levels: [44, 47, 47, 46, 46, 50], prize: 10000,
        intro: ['석영고원에 온 것을 환영한다. 나는 챔피언 목호.', '8개의 배지를 모은 네 실력, 드래곤 조련사로서 전력을 다해 확인하겠다!'],
        outro: ['훌륭하다... 오늘부터 네가 성도 지방의 챔피언이다!']
    });

    const LEVEL_CAPS = [14, 18, 20, 26, 31, 36, 36, 42, 51];
    RB.levelCap = function (g) {
        if (g.player.championDefeated) return 100;
        return LEVEL_CAPS[clamp(g.player.badges, 0, LEVEL_CAPS.length - 1)];
    };

    /* 스타팅 포켓몬 - 모든 세대의 풀/불꽃/물 스타팅 27종 */
    STARTER_POKEMON_IDS.splice(0, STARTER_POKEMON_IDS.length,
        152, 155, 158, 1, 4, 7, 252, 255, 258, 387, 390, 393, 495, 498, 501,
        650, 653, 656, 722, 725, 728, 810, 813, 816, 906, 909, 912);
    const STARTER_REGIONS = ['성도', '관동', '호연', '신오', '하나', '칼로스', '알로라', '가라르', '팔데아'];

    /* ======================================================================
       4. 성도 지방 맵
       하트골드·소울실버의 지방 구성(마을·도로·동굴·바다의 위치 관계와 연결)을
       640×640 타일 지도 위에 옮겼다. 도로와 마을 밖은 나무 벽/산이라 지나갈 수
       없고, 바다는 파도타기처럼 건널 수 있다.
       ====================================================================== */
    function town(name, r0, c0, h, w, opts) {
        opts = opts || {};
        const rMax = r0 + h - 1, cMax = c0 + w - 1;
        return {
            name, rMin: r0, rMax, cMin: c0, cMax,
            center: [r0 + 3, cMax - 4],
            mart: [r0 + 3, c0 + 4],
            gym: opts.gym ? [rMax - 3, Math.floor(c0 + w / 2)] : null,
            band: opts.band || [2, 5]
        };
    }
    const JOHTO_TOWNS = [
        town('연두마을', 430, 470, 16, 18, { band: [2, 4] }),
        town('무궁시티', 462, 318, 16, 22, { band: [2, 4] }),
        town('도라지시티', 285, 316, 22, 26, { gym: true, band: [3, 6] }),
        town('고동마을', 508, 138, 16, 22, { gym: true, band: [6, 9] }),
        town('금빛시티', 350, 102, 32, 38, { gym: true, band: [10, 13] }),
        town('인주시티', 148, 212, 26, 28, { gym: true, band: [15, 18] }),
        town('담청시티', 240, 38, 26, 26, { gym: true, band: [18, 21] }),
        town('진청시티', 478, 20, 18, 22, { gym: true, band: [20, 24] }),
        town('황토마을', 156, 408, 18, 20, { gym: true, band: [18, 21] }),
        town('검은먹시티', 128, 540, 24, 28, { gym: true, band: [25, 30] }),
        town(CHAMPION_TOWN, 222, 590, 18, 28, { gym: true, band: [40, 45] })
    ];
    EXTRA_TOWN_SITES.splice(0, EXTRA_TOWN_SITES.length, ...JOHTO_TOWNS);
    RB.TOWNS = JOHTO_TOWNS;
    const START_POS = [438, 478];

    /* 지역별 야생 포켓몬 (하트골드·소울실버 서식 분포를 참고) */
    const POOLS = {
        r29: [16, 19, 161, 163], r30: [10, 13, 16, 19, 165, 167, 163], r31: [10, 13, 16, 19, 69, 165, 167],
        darkcave: [41, 74, 206], r32: [19, 23, 69, 179, 187, 41, 194], ruins: [201, 177, 202],
        union: [41, 74, 95, 194, 79], r33: [19, 21, 23, 187, 74], ilex: [10, 11, 13, 14, 43, 46, 163],
        r34: [19, 20, 63, 96, 132, 16, 17], r35: [16, 17, 63, 96, 132, 39, 58, 37], park: [10, 13, 12, 15, 48, 123, 127, 46],
        r36: [16, 17, 58, 37, 163, 167, 175], r37: [16, 17, 58, 37, 163, 167, 175, 234], tower: [92, 93, 19, 20, 109],
        r38: [16, 17, 19, 20, 52, 128, 241, 83], r39: [16, 17, 19, 20, 52, 128, 241, 83], sea: [72, 73, 98, 116, 120, 222, 170],
        whirl: [41, 42, 86, 90, 98, 116, 222, 72], r42: [21, 22, 56, 57, 41, 74, 66, 118], mortar: [41, 42, 74, 75, 66, 67, 236],
        r43: [16, 17, 19, 20, 48, 49, 179, 180, 203], rage: [129, 118, 119, 48, 179, 203], r44: [69, 70, 114, 20, 22, 124],
        icepath: [41, 42, 86, 124, 215, 220], den: [147, 148, 129, 116, 60], r45: [74, 75, 207, 216, 21, 22, 231, 232, 227],
        r46: [19, 21, 74, 231], r27: [22, 55, 60, 61, 72, 73, 77, 78, 84, 85, 54], tohjo: [41, 42, 54, 55, 118, 119, 129],
        r26: [20, 22, 77, 78, 84, 85, 132, 115], victory: [42, 66, 67, 74, 75, 95, 111, 112, 105],
        r28: [78, 85, 115, 228, 229, 217], silver: [75, 95, 111, 112, 215, 217, 246, 247, 42, 105, 86],
        town: [16, 19, 52, 163], island: [16, 19, 21, 22, 56]
    };
    const WATER_POOLS = { sea: [72, 73, 116, 120, 98, 222, 90, 170], lake: [60, 61, 118, 119, 129, 54, 194], rage: [129, 129, 118, 119, 130], whirl: [72, 73, 116, 117, 222, 90], den: [147, 129, 116, 60, 118] };

    RB.world = null;

    RB.buildJohto = function (g) {
        const T = TILE_TYPES;
        const R = MAP_ROWS, C = MAP_COLS, N = R * C;
        const map = g.worldMap = Array.from({ length: R }, () => new Array(C).fill(T.FOREST));
        const solid = new Uint8Array(N).fill(1);
        const areaOf = new Uint16Array(N);
        const areas = [{ name: '성도 지방', band: [5, 8], pool: 'r29', kind: 'wild', water: 'lake' }];
        const inb = (r, c) => r >= 0 && c >= 0 && r < R && c < C;
        const set = (r, c, t, walk, area) => {
            if (!inb(r, c)) return;
            map[r][c] = t;
            solid[r * C + c] = walk ? 0 : 1;
            if (area !== undefined) areaOf[r * C + c] = area;
        };
        const addArea = (name, band, pool, kind, water) => { areas.push({ name, band, pool, kind: kind || 'route', water: water || 'lake' }); return areas.length - 1; };
        const noise = (r, c, s) => {
            const h = Math.sin(r * 12.9898 / s + c * 78.233 / s + (g.worldSeed % 1000) * 0.37) * 43758.5453;
            return h - Math.floor(h);
        };

        // 0) 배경: 나무 벽 + 북쪽/동쪽 산맥
        for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
            const mountain = (r < 110) || (c > 500 && r > 180 && r < 420) || (r > 470 && c > 555);
            if (mountain && noise(r, c, 9) < 0.62) map[r][c] = T.ROCK;
        }

        // 1) 바다
        const seaArea = addArea('40·41번 수로', [20, 26], 'sea', 'sea', 'sea');
        const southSea = addArea('성도 남쪽 바다', [18, 24], 'sea', 'sea', 'sea');
        const eastSea = addArea('27번 도로 (바다)', [28, 33], 'r27', 'sea', 'sea');
        for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
            if (c < 95 && r > 272) set(r, c, T.WATER, true, seaArea);
            else if ((r > 494 && c >= 215 && c < 520) || (r > 566 && c < 215)) set(r, c, T.WATER, true, southSea);
            else if (r > 418 && r < 472 && c > 518 && c < 582) set(r, c, T.WATER, true, eastSea);
        }

        // 2) 도로·특수 지역
        const stampCorridor = (pts, w, areaId, style) => {
            for (let i = 0; i < pts.length - 1; i++) {
                const [r1, c1] = pts[i], [r2, c2] = pts[i + 1];
                const steps = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1)) * 2;
                const horiz = Math.abs(c2 - c1) > Math.abs(r2 - r1);
                for (let s = 0; s <= steps; s++) {
                    const t = s / steps;
                    const wob = Math.sin(i * 7 + t * 6.3) * 2.2 * Math.sin(Math.PI * t);
                    const cr = r1 + (r2 - r1) * t + (horiz ? wob : 0);
                    const cc = c1 + (c2 - c1) * t + (horiz ? 0 : wob);
                    for (let dr = -w; dr <= w; dr++) for (let dc = -w; dc <= w; dc++) {
                        const rr = Math.round(cr + dr), c = Math.round(cc + dc);
                        if (!inb(rr, c)) continue;
                        const d = Math.hypot(dr, dc);
                        if (d > w) continue;
                        const idx = rr * C + c;
                        const isCave = style === 'cave' || style === 'ice';
                        if (map[rr][c] === T.WATER && !isCave) continue;
                        if (!solid[idx] && areaOf[idx] !== 0 && areaOf[idx] !== areaId) continue;
                        let tile;
                        if (style === 'cave') tile = d <= w - 1 ? T.CAVE : T.ROCK;
                        else if (style === 'ice') tile = d <= w - 1 ? (noise(rr, c, 3) < 0.55 ? T.ICE_FIELD : T.CAVE) : T.ROCK;
                        else if (style === 'mountain') tile = d <= 1.2 ? T.PATH : (noise(rr, c, 5) < 0.45 ? T.TALL_GRASS : (noise(rr, c, 2) < 0.15 ? T.ROCK : T.GRASS));
                        else if (style === 'forest') tile = d <= 1.2 ? T.PATH : (noise(rr, c, 4) < 0.6 ? T.TALL_GRASS : T.GRASS);
                        else if (style === 'path') tile = T.PATH;
                        else tile = d <= 1.2 ? T.PATH : (noise(rr, c, 6) < 0.42 ? T.TALL_GRASS : (noise(rr, c, 3) < 0.07 ? T.FLOWER : T.GRASS));
                        const walk = !isCave || d <= w - 1;
                        if (!walk && !solid[idx]) continue;
                        set(rr, c, tile, walk, areaId);
                    }
                }
            }
        };
        const route = (name, band, pool, pts, w, style) => stampCorridor(pts, w || 5, addArea(name, band, pool), style);
        const zone = (name, band, pool, cr, cc, rr, rc, fn, water) => {
            const id = addArea(name, band, pool, 'zone', water);
            for (let r = Math.floor(cr - rr); r <= cr + rr; r++) for (let c = Math.floor(cc - rc); c <= cc + rc; c++) {
                if (!inb(r, c)) continue;
                const e = ((r - cr) / rr) ** 2 + ((c - cc) / rc) ** 2;
                if (e > 1) continue;
                const res = fn(r, c, e);
                if (res) set(r, c, res[0], res[1], id);
            }
            return id;
        };

        zone('알프의 유적', [5, 9], 'ruins', 345, 228, 16, 26, (r, c) => [noise(r, c, 3) < 0.45 ? T.RUINS : (noise(r, c, 5) < 0.5 ? T.TALL_GRASS : T.GRASS), true]);
        zone('자연공원', [10, 14], 'park', 256, 172, 30, 34, (r, c, e) => [e > 0.9 ? T.FOREST : (noise(r, c, 4) < 0.3 ? T.FLOWER : (noise(r, c, 6) < 0.55 ? T.TALL_GRASS : T.GRASS)), e <= 0.9]);
        zone('분노의 호수', [18, 24], 'rage', 62, 432, 44, 58, (r, c, e) => e < 0.55 ? [T.WATER, true] : (e < 0.95 ? [noise(r, c, 4) < 0.5 ? T.TALL_GRASS : T.GRASS, true] : null), 'rage');
        zone('소용돌이섬', [22, 26], 'whirl', 402, 58, 26, 34, (r, c) => {
            const isle = [[395, 40], [410, 72], [388, 64], [418, 48]].some(([ir, ic]) => Math.hypot(r - ir, c - ic) < 6);
            if (!isle) return [T.WATER, true];
            const rock = noise(r, c, 2) < 0.4;
            return [rock ? T.ROCK : T.CAVE, !rock];
        }, 'whirl');
        zone('진청시티 섬', [20, 24], 'island', 487, 31, 18, 24, (r, c, e) => [e > 0.75 ? T.BEACH : T.GRASS, true], 'sea');
        zone('용의 굴', [28, 32], 'den', 98, 575, 16, 26, (r, c, e) => {
            if (e < 0.5) return [T.WATER, true];
            const rock = noise(r, c, 2) < 0.3;
            return [rock ? T.ROCK : T.CAVE, !rock];
        }, 'den');
        zone('방울탑', [18, 22], 'tower', 118, 238, 14, 12, (r, c, e) => [e > 0.8 ? T.ROCK : T.RUINS, e <= 0.8]);

        // 도로망 (하트골드·소울실버의 연결 구조)
        route('29번 도로', [2, 4], 'r29', [[438, 470], [445, 430], [452, 390], [470, 342]]);
        route('30번 도로', [3, 5], 'r30', [[462, 330], [420, 334], [380, 338], [308, 332]]);
        route('31번 도로', [4, 6], 'r31', [[298, 342], [310, 368], [326, 378]]);
        route('어둠의 동굴', [4, 7], 'darkcave', [[326, 376], [330, 400], [322, 420]], 6, 'cave');
        route('32번 도로', [5, 8], 'r32', [[306, 320], [340, 300], [400, 292], [446, 288]]);
        route('알프의 유적 샛길', [5, 9], 'ruins', [[360, 234], [372, 262], [386, 292]], 3);
        route('비전동굴', [6, 9], 'union', [[446, 288], [462, 282], [478, 268]], 6, 'cave');
        route('33번 도로', [6, 9], 'r33', [[478, 268], [484, 230], [500, 190], [514, 160]]);
        route('너도밤나무숲', [6, 10], 'ilex', [[508, 146], [486, 126], [466, 150], [446, 124], [414, 126]], 4, 'forest');
        route('34번 도로', [10, 13], 'r34', [[414, 126], [382, 122]]);
        route('35번 도로', [12, 14], 'r35', [[350, 118], [318, 132], [284, 158]]);
        route('36번 도로', [13, 15], 'r36', [[252, 204], [262, 250], [296, 316]]);
        route('알프의 유적 입구', [5, 9], 'ruins', [[262, 240], [300, 236], [330, 230]], 3);
        route('37번 도로', [14, 16], 'r37', [[262, 252], [220, 244], [174, 236]]);
        route('38번 도로', [16, 18], 'r38', [[160, 212], [178, 170], [200, 124]]);
        route('39번 도로', [16, 19], 'r39', [[200, 124], [222, 88], [242, 54]]);
        route('담청시티 항구', [18, 21], 'sea', [[262, 50], [278, 50]], 3, 'path');
        route('방울탑 가는 길', [18, 22], 'tower', [[148, 226], [124, 236]], 3);
        route('42번 도로', [16, 19], 'r42', [[160, 240], [168, 298]]);
        route('황토산', [17, 21], 'mortar', [[168, 298], [172, 336], [168, 372]], 6, 'cave');
        route('42번 도로', [16, 19], 'r42', [[168, 372], [166, 408]]);
        route('43번 도로', [18, 21], 'r43', [[156, 416], [128, 424], [104, 428]]);
        route('44번 도로', [22, 26], 'r44', [[166, 428], [160, 470]], 5, 'mountain');
        route('얼음 샛길', [22, 27], 'icepath', [[160, 470], [140, 492], [150, 518], [140, 540]], 6, 'ice');
        route('45번 도로', [25, 30], 'r45', [[151, 556], [214, 552], [292, 544], [356, 530]], 5, 'mountain');
        route('46번 도로', [3, 6], 'r46', [[356, 530], [398, 476], [436, 452]], 5, 'mountain');
        route('용의 굴 입구', [28, 32], 'den', [[128, 560], [108, 572]], 3);
        route('27번 도로', [28, 33], 'r27', [[438, 487], [442, 520]]);
        route('통나무폭포', [30, 34], 'tohjo', [[444, 578], [444, 600]], 6, 'cave');
        route('26번 도로', [32, 36], 'r26', [[444, 604], [392, 608], [334, 608]], 5, 'mountain');
        route('챔피언로드', [36, 42], 'victory', [[334, 608], [290, 600], [242, 604]], 6, 'cave');
        route('28번 도로', [40, 44], 'r28', [[448, 606], [486, 600]], 5, 'mountain');
        route('은빛산', [45, 55], 'silver', [[486, 600], [520, 590], [556, 604], [568, 612]], 6, 'cave');

        // 3) 마을
        JOHTO_TOWNS.forEach(t => {
            const id = addArea(t.name, t.band, 'town', 'town');
            for (let r = t.rMin; r <= t.rMax; r++) for (let c = t.cMin; c <= t.cMax; c++) set(r, c, T.TOWN, true, id);
            set(t.center[0], t.center[1], T.CENTER, true, id);
            set(t.mart[0], t.mart[1], T.MART, true, id);
            if (t.gym) set(t.gym[0], t.gym[1], T.GYM, true, id);
        });

        // 4) 전설의 사원 (방울탑 꼭대기 · 소용돌이섬 · 은빛산 정상)
        set(113, 238, T.SKY_TEMPLE, true);
        set(402, 58, T.SEA_TEMPLE, true);
        set(570, 612, T.LAND_TEMPLE, true);

        RB.world = { solid, areaOf, areas };
    };

    RB.isSolid = function (r, c) {
        const w = RB.world;
        if (!w || r < 0 || c < 0 || r >= MAP_ROWS || c >= MAP_COLS) return true;
        return !!w.solid[r * MAP_COLS + c];
    };
    RB.areaAt = function (r, c) {
        const w = RB.world;
        if (!w || r < 0 || c < 0 || r >= MAP_ROWS || c >= MAP_COLS) return null;
        return w.areas[w.areaOf[r * MAP_COLS + c]] || w.areas[0];
    };
    RB.townAt = (r, c) => JOHTO_TOWNS.find(t => r >= t.rMin && r <= t.rMax && c >= t.cMin && c <= t.cMax) || null;

    /* 야생 레벨대 - 그 칸이 속한 도로/지역이 정한다 */
    getRegionAt = function (col, row) {
        const a = RB.areaAt(row, col);
        if (!a) return { name: '성도', distance: 0, frontier: 0, min: 2, max: 5 };
        return { name: a.name, distance: 0, frontier: 0, min: a.band[0], max: a.band[1] };
    };

    /* ======================================================================
       5. 전투 중 필드 UI / 계산 헬퍼
       ====================================================================== */
    function buildBattleFieldDom() {
        const overlay = $('battle-overlay');
        if (!overlay || $('rb-field-banner')) return;
        const banner = document.createElement('div');
        banner.id = 'rb-field-banner';
        banner.innerHTML = `<span class="rb-fb-icon"></span><span class="rb-fb-name"></span><div class="rb-fb-desc"></div>`;
        overlay.appendChild(banner);
        const sweep = document.createElement('div');
        sweep.id = 'rb-field-sweep';
        sweep.innerHTML = `<div class="rb-fs-label">FIELD</div><div class="rb-fs-name"></div>`;
        overlay.appendChild(sweep);
        const pops = document.createElement('div');
        pops.id = 'rb-pop-layer';
        overlay.appendChild(pops);
    }
    RB.updateFieldBanner = function (g, animate) {
        buildBattleFieldDom();
        const f = FIELDS[g.battleField] || FIELDS.NONE;
        const b = $('rb-field-banner');
        if (!b) return;
        b.style.setProperty('--fc', f.color);
        b.querySelector('.rb-fb-icon').textContent = f.icon;
        b.querySelector('.rb-fb-name').textContent = f.name;
        b.querySelector('.rb-fb-desc').textContent = f.desc;
        if (animate && g.battleField !== 'NONE') {
            const s = $('rb-field-sweep');
            s.style.setProperty('--fc', f.color);
            s.querySelector('.rb-fs-name').textContent = `${f.icon} ${f.name}`;
            s.classList.remove('play'); void s.offsetWidth; s.classList.add('play');
            b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse');
        }
    };
    RB.pop = function (text, side, color) {
        buildBattleFieldDom();
        const layer = $('rb-pop-layer');
        if (!layer) return;
        const p = document.createElement('div');
        p.className = 'rb-pop ' + (side === 'player' ? 'at-player' : (side === 'enemy' ? 'at-enemy' : 'at-center'));
        p.textContent = text;
        if (color) p.style.setProperty('--pc', color);
        layer.appendChild(p);
        setTimeout(() => p.remove(), 1700);
    };

    RB.fieldPowerMult = (g, move) => { const f = FIELDS[g.battleField] || FIELDS.NONE; return (f.mult && f.mult[move.type]) || 1; };
    RB.stabMult = (att, move) => (!move || move.isStruggle || !(move.power > 0)) ? 1 : (hasType(att, move.type) ? 1.5 : 1);
    const ACC_STAGE = (s) => s >= 0 ? (3 + s) / 3 : 3 / (3 - s);

    RB.estimateDamage = function (g, att, def, move) {
        if (!move || !(move.power > 0)) return 0;
        let tm = g.getTypeMultiplier(move.type, def.type1, def.type2);
        if (move.type === '땅' && def.ability === 'LEVITATE') tm = 0;
        if (tm === 0) return 0;
        const special = move.category === '특수';
        const aKey = special ? 'spAtk' : 'atk', dKey = special ? 'spDef' : 'def';
        const aStat = att[aKey] * getStatStageMultiplier((att.statStages || {})[aKey] || 0);
        const dStat = Math.max(1, def[dKey] * getStatStageMultiplier((def.statStages || {})[dKey] || 0));
        const power = move.power * RB.fieldPowerMult(g, move) * RB.stabMult(att, move);
        return ((((2 * att.level / 5 + 2) * power * aStat / dStat) / 50) + 2) * tm * 0.93;
    };
    RB.isEliteBattle = (g) => !!(g.currentChampionChallenge || (g.currentGymSite && !g.currentTrainerNpc));
    RB.opponentLabel = (g) => g.currentChampionChallenge ? `챔피언 ${g.currentGymLeaderName || ''}` : (g.currentGymLeaderName || '트레이너');
    RB.hardenEliteMon = function (g, pkm) {
        if (!pkm || pkm._rbHardened || !RB.isEliteBattle(g)) return;
        pkm._rbHardened = true;
        const floor = g.currentChampionChallenge ? 26 : 15;
        Object.keys(pkm.ivs).forEach(k => { pkm.ivs[k] = Math.max(pkm.ivs[k], floor + Math.floor(rand() * (32 - floor))); });
        const st = computeStatsAtLevel(pkm.baseStats, pkm.level, pkm.ivs, pkm.evs, pkm.nature);
        Object.assign(pkm, { maxHp: st.maxHp, hp: st.maxHp, atk: st.atk, def: st.def, spAtk: st.spAtk, spDef: st.spDef, spe: st.spe });
        g.updateBattleHud();
    };

    /* 박치기형(접촉) 기술 판정 - 실제 게임의 "접촉" 플래그를 쓰고, 없으면 이름으로 추정 */
    const NONCONTACT_KW = /지진|땅고르기|스톤|바위|암석|뼈|던지기|발사|샤워|폭탄|미사일|화살|가시|레이저|떨구기|낙하|눈사태|쏘기|기관총|구슬|파도/;
    RB.contactKind = function (m) {
        if (!m || !(m.power > 0) || m.category === '변화') return null;
        const f = (m.rb && m.rb.f) || [];
        let contact;
        if (f.length) contact = f.includes(1);
        else if (m.rb) contact = m.category === '물리' && !NONCONTACT_KW.test(m.name);
        else contact = m.category === '물리' && !NON_CONTACT_PHYSICAL.has(m.name);
        if (!contact) return null;
        const n = m.name;
        if (f.includes(8) || /펀치|주먹|메가톤/.test(n)) return 'punch';
        if (f.includes(16) || /물기|엄니|깨물|이빨/.test(n)) return 'bite';
        if (/할퀴|베기|가르기|클로|칼|슬래시|손톱|커터|시저|찌르기|쪼기|뿔/.test(n)) return 'slash';
        if (/킥|차기|발굽|밟기|발차/.test(n)) return 'kick';
        return 'tackle';
    };

    /* ======================================================================
       6. GameEngine 확장
       ====================================================================== */
    const P = GameEngine.prototype;
    const orig = {};
    ['initWorldMap', 'buildNpcs', 'getCurrentGymSite', 'movePlayer', 'applySave', 'createPokemonInstance',
     'selectStarter', 'renderStarterModal', 'startBattle', '_enterBattle', 'configureBattleStage3D',
     'performMove', 'tryInflictStatus', 'applyEndOfTurnStatus', 'pickEnemyMove', 'decideTurnOrder',
     'grantExp', 'handleBossDefeat', 'handleChampionDefeat', 'sendNextTrainerPokemon', 'endBattle',
     'updateUI', 'renderBattleActionGrid', 'useItemInBattle', 'playSkillAttackFx'].forEach(k => { orig[k] = P[k]; });
    RB._orig = orig;

    /* ---------- 월드 ---------- */
    P.initWorldMap = function () {
        RB.buildJohto(this);
        this.buildMacroVariationLayer();
        this.buildNpcs();
        this.templeTileCoords = [];
        for (let r = 0; r < MAP_ROWS; r++) for (let c = 0; c < MAP_COLS; c++) {
            if (LEGEND_TEMPLE_INFO[this.worldMap[r][c]]) this.templeTileCoords.push({ r, c, tile: this.worldMap[r][c] });
        }
        if (!this.player.party.length) this.rbPlaceAtStart();
    };
    P.rbPlaceAtStart = function () {
        const [r, c] = START_POS;
        Object.assign(this.player, { x: c, y: r, visX: c, visY: r, moveFromX: c, moveFromY: r });
    };
    P.getCurrentGymSite = function () {
        const t = RB.townAt(this.player.y, this.player.x);
        return t ? t.name : null;
    };

    /* 길목 트레이너 · 마을 주민 */
    P.buildNpcs = function () {
        const T = TILE_TYPES;
        const w = RB.world;
        const rng = makeSeededRng((this.worldSeed ^ 0x9e3779b9) >>> 0);
        this.npcs = [];
        let nextId = 1;
        const placed = [];
        const farEnough = (r, c, min) => placed.every(p => Math.abs(p[0] - r) + Math.abs(p[1] - c) > min);
        const legal = (lv) => (p) => p && !p.isBoss && !p.isLegend && !p.isRareTier && lv >= (EVOLUTION_MIN_LEVEL.get(p.id) || 1);

        const pathCells = [];
        for (let r = 2; r < MAP_ROWS - 2; r++) for (let c = 2; c < MAP_COLS - 2; c++) {
            if (this.worldMap[r][c] !== T.PATH) continue;
            const a = w.areas[w.areaOf[r * MAP_COLS + c]];
            if (a && a.kind === 'route') pathCells.push([r, c, a]);
        }
        for (let i = 0; i < pathCells.length * 2 && this.npcs.length < 70 && pathCells.length; i++) {
            const [r, c, area] = pathCells[Math.floor(rng() * pathCells.length)];
            if (Math.hypot(r - START_POS[0], c - START_POS[1]) < 30) continue;
            if (!farEnough(r, c, 14)) continue;
            const horiz = (this.worldMap[r][c - 1] === T.PATH) || (this.worldMap[r][c + 1] === T.PATH);
            const dirs = horiz ? ['left', 'right'] : ['up', 'down'];
            const dir = dirs[Math.floor(rng() * 2)];
            const level = area.band[1];
            const cls = NPC_TRAINER_CLASSES[Math.floor(rng() * NPC_TRAINER_CLASSES.length)];
            const size = level >= 30 ? 3 : (level >= 12 ? 2 : 1);
            const pool = (POOLS[area.pool] || POOLS.r29).map(id => POKEMON_DATABASE.find(p => p.id === id)).filter(legal(level));
            if (!pool.length) continue;
            const team = Array.from({ length: size }, () => pool[Math.floor(rng() * pool.length)].id);
            placed.push([r, c]);
            this.npcs.push({
                id: nextId++, kind: 'trainer', r, c, dir,
                title: cls.title, name: cls.names[Math.floor(rng() * cls.names.length)],
                body: cls.body, trim: cls.trim, cap: cls.cap, taunt: cls.taunt, lose: cls.lose,
                team, levels: team.map((_, k) => Math.max(2, level - (size - 1 - k))),
                prize: 40 + level * 20, sight: 4
            });
        }

        JOHTO_TOWNS.forEach(site => {
            let made = 0, guard = 0;
            while (made < 4 && guard++ < 300) {
                const r = site.rMin + 1 + Math.floor(rng() * (site.rMax - site.rMin - 1));
                const c = site.cMin + 1 + Math.floor(rng() * (site.cMax - site.cMin - 1));
                if (this.worldMap[r][c] !== T.TOWN) continue;
                if ((r % 5) === 0 || (c % 6) === 0) continue;
                if ((r % 5) === 2 && (c % 3) === 1) continue;
                if (window.RB3D && (RB3D.buildingAt(r, c) || RB3D.houseAt(r, c, this))) continue;
                if (!this.npcs.every(n => Math.abs(n.r - r) + Math.abs(n.c - c) > 3)) continue;
                const kind = VILLAGER_KINDS[Math.floor(rng() * VILLAGER_KINDS.length)];
                const gift = rng() < 0.22;
                this.npcs.push({
                    id: nextId++, kind: 'villager', r, c,
                    dir: ['down', 'left', 'right', 'up'][Math.floor(rng() * 4)],
                    title: kind.title, name: site.name, body: kind.body, trim: kind.trim, cap: kind.cap,
                    lines: gift ? GIFT_VILLAGER_LINES[Math.floor(rng() * GIFT_VILLAGER_LINES.length)] : VILLAGER_LINES[Math.floor(rng() * VILLAGER_LINES.length)],
                    gift: gift ? (rng() < 0.5 ? 'MONSTER_BALL' : 'POTION') : null, giftCount: gift ? 3 : 0
                });
                made++;
            }
        });
        this.npcByCell = {};
        this.npcs.forEach(n => { this.npcByCell[n.r * MAP_COLS + n.c] = n; });
    };

    /* 나무 벽·산은 지나갈 수 없다 (자전거는 막히기 직전 칸까지만) */
    P.movePlayer = function (dx, dy) {
        const sx = Math.sign(dx), sy = Math.sign(dy);
        const steps = Math.max(Math.abs(dx), Math.abs(dy));
        let ok = 0;
        for (let i = 1; i <= steps; i++) {
            if (RB.isSolid(this.player.y + sy * i, this.player.x + sx * i)) break;
            ok = i;
        }
        if (!ok) return;
        return orig.movePlayer.call(this, sx * ok, sy * ok);
    };

    /* ---------- 세이브 호환 ---------- */
    P.applySave = function (data) {
        const oldA = ['태초마을', '초록마을', '해안마을', '설원마을', '사막마을', '고원마을', '화산마을', '호반마을'];
        const oldB = ['오닉스 역전가', '녹슨숲 거주구', '폐항구 선착장', '동결 공업단지', '모래무덤 채굴장', '절벽 슬럼가', '용광로 지구', '오염호수 연구특구'];
        const newOrder = Object.entries(JOHTO_GYMS).sort((a, b) => a[1].order - b[1].order).map(e => e[0]);
        if (data && data.player && Array.isArray(data.player.defeatedGyms)) {
            data.player.defeatedGyms = data.player.defeatedGyms.map(n => {
                let i = oldA.indexOf(n); if (i < 0) i = oldB.indexOf(n);
                return i >= 0 ? newOrder[i] : n;
            });
        }
        const ok = orig.applySave.call(this, data);
        if (ok && RB.isSolid(this.player.y, this.player.x)) {
            this.rbPlaceAtStart();
            showToast('🗺️ 지도가 성도 지방으로 바뀌어 연두마을에서 다시 출발합니다.');
        }
        return ok;
    };

    /* ---------- 포켓몬 생성: 실제 레벨업 기술 ---------- */
    P.createPokemonInstance = function (dbData, level) {
        const inst = orig.createPokemonInstance.call(this, dbData, level);
        const keys = RB.movesAtLevel(dbData.id, level);
        if (keys.length) inst.skills = instantiateSkills(keys.map(k => SKILL_DATABASE[k]));
        return inst;
    };

    /* ---------- 스타팅 선택 (세대별) ---------- */
    P.renderStarterModal = function () {
        const container = $('starter-options');
        if (!container) return;
        container.innerHTML = '';
        container.classList.add('rb-starter-wrap');
        for (let gi = 0; gi < STARTER_POKEMON_IDS.length; gi += 3) {
            const group = document.createElement('div');
            group.className = 'rb-starter-group';
            group.innerHTML = `<div class="rb-starter-region">${STARTER_REGIONS[gi / 3] || ''}</div>`;
            const row = document.createElement('div');
            row.className = 'rb-starter-row';
            STARTER_POKEMON_IDS.slice(gi, gi + 3).forEach(id => {
                const data = POKEMON_DATABASE.find(p => p.id === id);
                if (!data) return;
                const card = document.createElement('div');
                card.className = 'starter-card';
                card.innerHTML = `
                    <img src="${data.frontSprite}" class="pixel-sprite-fit" alt="${data.species}"><br>
                    <strong>${data.species}</strong>
                    <div style="margin-top:4px;">${typeBadgeHtml(data.type1)}${typeBadgeHtml(data.type2)}</div>`;
                card.onclick = () => this.selectStarter(data);
                row.appendChild(card);
            });
            group.appendChild(row);
            container.appendChild(group);
        }
    };
    P.selectStarter = function (starterData) {
        if (!this.player.party.length) this.rbPlaceAtStart();
        orig.selectStarter.call(this, starterData);
    };

    /* ---------- 야생 조우: 지역별 서식 포켓몬 ---------- */
    P.startBattle = function (templateData, precomputedWildLv, remainingTeamIds) {
        const wild = !(templateData && (templateData.isBoss || templateData.isLegend)) && !this.currentTrainerNpc;
        // 트레이너와 눈이 마주쳐 대사 중이면 풀숲 야생 조우는 취소한다 (동시에 시작되어 게임이 멈추던 문제)
        if (wild && this.state === GAME_STATES.FIELD &&
            (this._trainerEncounterLock || isNpcDialogOpen() || (this.npcs && this.npcs.some(n => n.alerted)))) return;
        // 그 밖의 경우에도 전투가 시작되면 남아 있는 대화창은 닫는다
        if (isNpcDialogOpen()) {
            const el = document.getElementById('npc-dialog');
            if (el) el.classList.remove('show');
            _npcDialogQueue = []; _npcDialogDone = null;
            this._trainerEncounterLock = false;
        }
        if (templateData && !templateData.isBoss && !templateData.isLegend && !templateData.isRareTier && this.state === GAME_STATES.FIELD) {
            const area = RB.areaAt(this.player.y, this.player.x);
            const tile = this.worldMap[this.player.y][this.player.x];
            if (area) {
                const lv = precomputedWildLv !== undefined ? precomputedWildLv : rollWildLevel(this.player.x, this.player.y);
                const ids = tile === TILE_TYPES.WATER ? (WATER_POOLS[area.water] || WATER_POOLS.lake) : (POOLS[area.pool] || POOLS.r29);
                const cands = ids.map(id => POKEMON_DATABASE.find(p => p.id === id)).filter(p => p && lv >= (EVOLUTION_MIN_LEVEL.get(p.id) || 1));
                if (cands.length) return orig.startBattle.call(this, pickOne(cands), lv, remainingTeamIds);
            }
        }
        return orig.startBattle.call(this, templateData, precomputedWildLv, remainingTeamIds);
    };

    /* ---------- 전투 진입: 필드 결정 ---------- */
    P._enterBattle = function (templateData, precomputedWildLv, remainingTeamIds) {
        if (this.rbForcedField) this.battleField = this.rbForcedField;
        else {
            const tile = (this.worldMap[this.player.y] || [])[this.player.x];
            this.battleField = fieldForTile(tile, !!this.isNight);
        }
        this.rbEnemyItems = this.rbForcedItems || 0;
        this.rbDisobeyNotified = false;
        this.rbCapExpNotified = false;
        this.player.party.forEach(p => { p.rbSeeded = false; p.rbTrap = 0; p.rbYawn = 0; if (p.statStages) { p.statStages.acc = 0; p.statStages.eva = 0; } });
        orig._enterBattle.call(this, templateData, precomputedWildLv, remainingTeamIds);
        document.body.classList.add('rb-in-battle');
        RB.hardenEliteMon(this, this.currentEnemy);
        if (templateData.isBoss && !this.currentChampionChallenge && this.currentEnemy) {
            const who = this.currentGymLeaderName || '트레이너';
            const e = this.currentEnemy;
            this.setBattleDialog(`${who}${josa(who, '이', '가')} 승부를 걸어왔다!\n[${e.species}] (Lv.${e.level})${josa(e.species, '을', '를')} 내보냈다!`);
        }
        RB.updateFieldBanner(this, false);
        setTimeout(() => { if (this.state === GAME_STATES.BATTLE) RB.updateFieldBanner(this, true); }, 650);
    };

    P.configureBattleStage3D = function (enemy) {
        orig.configureBattleStage3D.call(this, enemy);
        this.rbApplyFieldStage(enemy);
    };
    P.rbApplyFieldStage = function (enemy) {
        enemy = enemy || this.currentEnemy;
        if (!enemy || enemy.isLegend) return;
        const f = FIELDS[this.battleField];
        if (!f || !f.stage) return;
        const phase = this.timePhase || sampleTimePhase(this.timeOfDay || 0.42);
        const shade = (hex) => this.blendHexWithTint(hex, phase);
        this.scene3D.background = this.buildSkyTexture3D(shade(f.stage.sky));
        if (this.scene3D.fog) this.scene3D.fog.color.setHex(shade(f.stage.sky));
        this.battleGroundMat3D.color.setHex(shade(f.stage.ground));
        this.battleRidgeMat3D.color.setHex(shade(f.stage.ridge));
        this.battleHillMat3D.color.setHex(shade(f.stage.hill));
        if (this.battleDecorMat3D) this.battleDecorMat3D.color.setHex(shade(f.stage.ridge));
    };
    RB.setField = function (g, key, message) {
        if (!FIELDS[key] || g.battleField === key) return;
        g.battleField = key;
        RB.updateFieldBanner(g, true);
        g.rbApplyFieldStage();
        RB.pop(`${FIELDS[key].icon} ${FIELDS[key].name}!`, 'center', FIELDS[key].color);
        if (message) showToast(`🌐 ${message}`);
        try { playSfx('status'); } catch (e) { }
    };

    /* ---------- 기술 실행 ---------- */
    const ENEMY_ITEM_MOVE = { name: '회복약', power: 0, type: '노말', accuracy: 999, category: '변화', priority: 7, isRbItem: true };

    P.performMove = function (attacker, defender, move, attackerIsPlayer, onDone) {
        const g = this;
        if (!move) return orig.performMove.call(this, attacker, defender, move, attackerIsPlayer, onDone);

        if (move.isRbItem) {
            const heal = Math.max(1, Math.round(attacker.maxHp * 0.6));
            attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal);
            attacker.status = STATUS_EFFECTS.NONE;
            g.rbEnemyItems = Math.max(0, (g.rbEnemyItems || 0) - 1);
            g.setBattleDialog(`${RB.opponentLabel(g)}은(는) [고급상처약]을 사용했다!\n적 [${attacker.species}]의 HP가 ${heal} 회복되었다!`);
            RB.pop(`+${heal} HP`, 'enemy', '#22c55e');
            g.updateUI();
            setTimeout(() => onDone && onDone(), 1300);
            return;
        }

        // 레벨 제한 초과 → 명령 불복종
        if (attackerIsPlayer && !move.isStruggle && attacker.hp > 0 && !g.player.championDefeated) {
            const cap = RB.levelCap(g);
            const over = attacker.level - cap;
            if (over > 0 && rand() < Math.min(0.8, 0.22 + over * 0.07)) {
                const others = attacker.skills.filter(sk => sk !== move && sk.pp > 0);
                RB.pop('명령 불복종!', 'player', '#ef4444');
                if (!g.rbDisobeyNotified) {
                    g.rbDisobeyNotified = true;
                    showToast(`⚠️ 레벨 제한 Lv.${cap} 초과! 배지를 더 모으기 전까지 [${attacker.species}]은(는) 말을 잘 듣지 않는다.`);
                }
                if (others.length && rand() < 0.45) move = pickOne(others);
                else {
                    g.setBattleDialog(`[${attacker.species}]은(는) ${pickOne(['명령을 무시하고 딴청을 피운다...', '하품을 하며 고개를 돌렸다...', '제멋대로 주변을 어슬렁거린다...'])}`);
                    setTimeout(() => onDone && onDone(), 1100);
                    return;
                }
            }
        }

        const field = FIELDS[g.battleField] || FIELDS.NONE;
        if (field.blockPriority && (move.priority || 0) > 0 && move.power > 0 && isGrounded(defender)) {
            if (move.pp !== undefined && !move.isStruggle) move.pp = Math.max(0, move.pp - 1);
            g.setBattleDialog(`${attackerIsPlayer ? '' : '적 '}[${attacker.species}]의 ${move.name}!\n하지만 사이코 필드가 선제 공격을 막아냈다!`);
            setTimeout(() => onDone && onDone(), 1100);
            return;
        }

        // 위력/명중/타입 보정은 복사본으로 계산한다 (원본 기술 객체에는 PP만 반영)
        const useMove = Object.assign({}, move);
        const fMult = RB.fieldPowerMult(g, move);
        const stab = RB.stabMult(attacker, move);
        if (move.power > 0) useMove.power = Math.max(1, Math.round(move.power * fMult * stab));
        if (move.accuracy < 999) {
            const st = ((attacker.statStages && attacker.statStages.acc) || 0) - ((defender.statStages && defender.statStages.eva) || 0);
            useMove.accuracy = Math.round(move.accuracy * ACC_STAGE(clamp(st, -6, 6)) * (field.accMult || 1));
        }
        // 변화 기술은 타입 상성으로 무효가 되지 않는다 (전기자석파만 예외)
        if (move.category === '변화' && move.rb && move.rb.i !== 'thunder-wave') useMove.type = '???';
        const ppBefore = move.pp;
        g._rbCur = { attacker, defender, move, attackerIsPlayer };

        orig.performMove.call(this, attacker, defender, useMove, attackerIsPlayer, onDone);

        const executed = useMove.pp !== ppBefore;
        if (useMove.pp !== undefined) move.pp = useMove.pp;

        if (move.power > 0 && fMult !== 1 && (executed || move.isStruggle)) {
            setTimeout(() => {
                if (g.state === GAME_STATES.BATTLE) RB.pop(`${field.icon} ×${fMult}`, attackerIsPlayer ? 'player' : 'enemy', fMult > 1 ? field.color : '#94a3b8');
            }, 280);
        }
        const shift = field.shift && field.shift[move.type];
        if (shift && (executed || move.isStruggle) && (!shift[2] || (move.power || 0) >= shift[2])) {
            setTimeout(() => { if (g.state === GAME_STATES.BATTLE) RB.setField(g, shift[0], shift[1]); }, 1150);
        }
    };

    /* 실제 게임 기술의 부가효과 (상태이상/혼란/풀죽음/능력 변화/회복/날씨 등) */
    P.rbApplyMoveEffects = function (target, log, targetLabel) {
        const cur = this._rbCur;
        if (!cur || !cur.move || !cur.move.rb) return log;
        const { attacker, move, attackerIsPlayer } = cur;
        const d = move.rb;
        const damaging = move.power > 0;
        const aLabel = `${attackerIsPlayer ? '' : '적 '}[${attacker.species}]`;
        let changed = false, failed = false;
        const f = FIELDS[this.battleField];
        const shielded = (pk) => !!(f && f.noStatus && isGrounded(pk));

        if (WEATHER_MOVES[d.i]) {
            this.weatherIdx = WEATHER_MOVES[d.i][0];
            this.updateUI();
            return log + '\n' + WEATHER_MOVES[d.i][1];
        }
        if (d.i === 'rest') {
            if (attacker.hp >= attacker.maxHp) return log + '\n하지만 실패했다!';
            attacker.hp = attacker.maxHp;
            attacker.status = STATUS_EFFECTS.SLEEP;
            attacker.sleepTurns = 2;
            this.updateUI();
            return log + `\n${aLabel}은(는) 잠들어 체력을 회복했다!`;
        }
        if (d.i === 'haze') {
            [attacker, target].forEach(p => { p.statStages = Object.assign(makeEmptyStatStages(), { acc: 0, eva: 0 }); });
            return log + '\n모든 능력 변화가 원래대로 돌아왔다!';
        }

        // 상태이상
        if (d.ai && target.hp > 0) {
            const chance = damaging ? (d.ac || 0) / 100 : (d.ac ? d.ac / 100 : 1);
            if (rand() < chance) {
                const st = AILMENT_STATUS[d.ai];
                if (st) {
                    const before = target.status;
                    log = this.tryInflictStatus(target, STATUS_EFFECTS[st], 1, log, targetLabel);
                    if (target.status !== before) changed = true;
                    else if (!damaging && before !== STATUS_EFFECTS.NONE) { log += '\n하지만 실패했다!'; failed = true; }
                } else if (d.ai === 6) {
                    if (!target.confused && !shielded(target)) { target.confused = true; target.confusedTurns = 2 + Math.floor(rand() * 4); log += `\n${targetLabel}은(는) 혼란에 빠졌다!`; changed = true; }
                } else if (d.ai === 7) {
                    if (!target.attracted) { target.attracted = true; log += `\n${targetLabel}은(는) 헤롱헤롱해졌다!`; changed = true; }
                } else if (d.ai === 8) {
                    if (!target.rbTrap) { target.rbTrap = 4 + Math.floor(rand() * 2); log += `\n${targetLabel}은(는) 조여져 빠져나갈 수 없다!`; changed = true; }
                } else if (d.ai === 14) {
                    if (!target.rbYawn && target.status === STATUS_EFFECTS.NONE) { target.rbYawn = 2; log += `\n${targetLabel}에게 졸음이 쏟아진다...`; changed = true; }
                } else if (d.ai === 18) {
                    if (!target.rbSeeded && !hasType(target, '풀')) { target.rbSeeded = true; log += `\n${targetLabel}에게 씨앗을 심었다!`; changed = true; }
                }
            }
        }

        // 풀죽음 (먼저 행동했을 때만)
        if (d.fc && damaging && target.hp > 0 && rand() < d.fc / 100) {
            if (this._rbOrder === (attackerIsPlayer ? 'player' : 'enemy')) target.flinched = true;
        }

        // 능력 변화
        if (d.st && d.st.length && rand() < (d.sc ? d.sc / 100 : 1)) {
            const toSelf = d.mc === 7 || (d.mc !== 6 && d.mc !== 5 && SELF_TARGETS.has(d.tg));
            const who = toSelf ? attacker : target;
            const whoLabel = toSelf ? aLabel : targetLabel;
            if (who.hp > 0) {
                if (!who.statStages) who.statStages = makeEmptyStatStages();
                d.st.forEach(([sid, ch]) => {
                    const key = STAT_KEYS[sid];
                    if (!key) return;
                    const curv = who.statStages[key] || 0;
                    const next = clamp(curv + ch, -6, 6);
                    const nm = STAT_NAMES[key];
                    if (next === curv) { log += `\n${whoLabel}의 ${nm}은(는) 더 이상 ${ch > 0 ? '오르지' : '떨어지지'} 않는다!`; failed = true; return; }
                    who.statStages[key] = next;
                    changed = true;
                    log += `\n${whoLabel}의 ${nm}${josa(nm, '이', '가')} ${Math.abs(ch) >= 2 ? '크게 ' : ''}${ch > 0 ? '올랐다' : '떨어졌다'}!`;
                });
                if (toSelf && !damaging && changed) {
                    try { this.playStatBoostFx(attackerIsPlayer ? 'player' : 'enemy', move, () => { }); } catch (e) { }
                }
            }
        }
        if (d.mc === 5 && target.hp > 0 && !target.confused) {
            target.confused = true; target.confusedTurns = 2 + Math.floor(rand() * 4);
            log += `\n${targetLabel}은(는) 혼란에 빠졌다!`; changed = true;
        }
        if (!damaging && d.he > 0) {
            if (attacker.hp >= attacker.maxHp) { log += `\n하지만 ${aLabel}의 체력은 가득 차 있다!`; failed = true; }
            else {
                const heal = Math.max(1, Math.floor(attacker.maxHp * d.he / 100));
                attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal);
                log += `\n${aLabel}의 체력이 회복되었다!`;
                changed = true;
            }
        }
        if (!damaging && !changed && !failed) log += '\n하지만 아무 일도 일어나지 않았다!';
        this.updateUI();
        return log;
    };

    P.tryInflictStatus = function (target, status, chance, log, targetLabel) {
        if (status === 'RB_EFFECT') return this.rbApplyMoveEffects(target, log, targetLabel);
        const f = FIELDS[this.battleField];
        if (f && this.state === GAME_STATES.BATTLE && isGrounded(target) && target.status === STATUS_EFFECTS.NONE) {
            if (f.noStatus || (f.noSleep && status === STATUS_EFFECTS.SLEEP)) {
                return chance >= 1 ? log + `\n${f.icon} ${f.name}이(가) ${targetLabel}을(를) 지켜냈다!` : log;
            }
        }
        return orig.tryInflictStatus.call(this, target, status, chance, log, targetLabel);
    };

    /* 턴 종료: 필드 · 씨뿌리기 · 조이기 · 하품 */
    P.applyEndOfTurnStatus = function (pkm, label) {
        orig.applyEndOfTurnStatus.call(this, pkm, label);
        if (!pkm || pkm.hp <= 0 || this.state !== GAME_STATES.BATTLE) return;
        const isEnemy = pkm === this.currentEnemy;
        const side = isEnemy ? 'enemy' : 'player';
        const other = isEnemy ? this.player.party[this.player.activeIdx] : this.currentEnemy;
        const f = FIELDS[this.battleField];
        if (f && f.endDmg) {
            const d = f.endDmg;
            if (!d.immune.some(t => hasType(pkm, t)) && (d.all || isGrounded(pkm))) {
                const dmg = Math.max(1, Math.floor(pkm.maxHp * d.frac));
                pkm.hp = Math.max(0, pkm.hp - dmg);
                RB.pop(`${f.icon} -${dmg}`, side, f.color);
                showToast(`${label}은(는) ${d.msg}`);
            }
        }
        if (f && f.endHeal && isGrounded(pkm) && pkm.hp > 0 && pkm.hp < pkm.maxHp) {
            const heal = Math.max(1, Math.floor(pkm.maxHp * f.endHeal));
            pkm.hp = Math.min(pkm.maxHp, pkm.hp + heal);
            RB.pop(`${f.icon} +${heal}`, side, '#22c55e');
        }
        if (pkm.rbSeeded && pkm.hp > 0) {
            const dmg = Math.max(1, Math.floor(pkm.maxHp / 8));
            pkm.hp = Math.max(0, pkm.hp - dmg);
            if (other && other.hp > 0) other.hp = Math.min(other.maxHp, other.hp + dmg);
            showToast(`${label}의 체력을 씨앗이 빼앗았다!`);
        }
        if (pkm.rbTrap > 0 && pkm.hp > 0) {
            pkm.rbTrap--;
            pkm.hp = Math.max(0, pkm.hp - Math.max(1, Math.floor(pkm.maxHp / 8)));
            showToast(`${label}은(는) 조이기 데미지를 입었다!`);
        }
        if (pkm.rbYawn > 0) {
            pkm.rbYawn--;
            if (pkm.rbYawn === 0 && pkm.hp > 0 && pkm.status === STATUS_EFFECTS.NONE) {
                pkm.status = STATUS_EFFECTS.SLEEP;
                pkm.sleepTurns = 1 + Math.floor(rand() * 3);
                showToast(`${label}은(는) 잠들어 버렸다!`);
            }
        }
    };

    /* 트레이너 AI - 데미지 예측형 */
    P.pickEnemyMove = function () {
        const e = this.currentEnemy;
        if (!e || !e.isBoss) return orig.pickEnemyMove.call(this);
        const me = this.player.party[this.player.activeIdx];
        const elite = RB.isEliteBattle(this);
        if (elite && (this.rbEnemyItems || 0) > 0 && e.hp > 0 && e.hp / e.maxHp <= 0.25 && rand() < 0.75) return ENEMY_ITEM_MOVE;
        const usable = e.skills.filter(sk => sk.pp > 0);
        if (!usable.length || !me) return orig.pickEnemyMove.call(this);
        const enemyFaster = this.getEffectiveSpeed(e) >= this.getEffectiveSpeed(me);
        const threat = Math.max(0, ...me.skills.filter(s => s.pp > 0).map(s => RB.estimateDamage(this, me, e, s)));
        const scored = usable.map(sk => {
            let score = 1;
            const d = sk.rb || {};
            if (sk.power > 0) {
                const dmg = RB.estimateDamage(this, e, me, sk);
                const acc = Math.min(100, sk.accuracy >= 999 ? 100 : sk.accuracy) / 100;
                score = Math.min(1.2, dmg / Math.max(1, me.hp)) * 100 * acc;
                if (dmg >= me.hp) { score += 50; if ((sk.priority || 0) > 0 && !enemyFaster) score += 60; }
                if (sk.recoil && e.hp < e.maxHp * 0.3) score *= 0.7;
                if (sk.drain && e.hp < e.maxHp * 0.6) score *= 1.25;
            } else if (d.he > 0) {
                score = e.hp < e.maxHp * 0.45 ? 70 : 2;
            } else if (d.st && d.st.length && d.mc === 2 && SELF_TARGETS.has(d.tg)) {
                const up = d.st.some(([sid]) => ((e.statStages || {})[STAT_KEYS[sid]] || 0) < 2);
                score = up && threat < e.hp * 0.45 && e.hp > e.maxHp * 0.6 ? 50 : 3;
            } else if (d.ai || (sk.status && sk.status !== 'RB_EFFECT')) {
                const hasStatus = me.status && me.status !== STATUS_EFFECTS.NONE;
                score = (hasStatus && (AILMENT_STATUS[d.ai] || !d.ai)) ? 1 : (me.hp > me.maxHp * 0.5 ? 38 : 14);
            } else if (d.st && d.st.length) {
                score = me.hp > me.maxHp * 0.6 ? 16 : 5;
            } else score = 3;
            return { sk, score: Math.max(0.1, score) };
        }).sort((a, b) => b.score - a.score);
        if (elite) return (scored.length === 1 || rand() < 0.85) ? scored[0].sk : scored[1].sk;
        const total = scored.reduce((s, x) => s + x.score * x.score, 0);
        let roll = rand() * total;
        for (const x of scored) { roll -= x.score * x.score; if (roll <= 0) return x.sk; }
        return scored[0].sk;
    };

    P.decideTurnOrder = function (playerMove, enemyMove) {
        const r = (enemyMove && enemyMove.isRbItem) ? 'enemy' : orig.decideTurnOrder.call(this, playerMove, enemyMove);
        this._rbOrder = r;
        return r;
    };

    /* 경험치: 레벨 제한 + 레벨업 기술 선택창을 바로 띄운다 */
    P.grantExp = function (amount) {
        const pkm = this.player.party[this.player.activeIdx];
        const cap = RB.levelCap(this);
        if (pkm && pkm.level >= cap && !this.player.championDefeated) {
            amount = Math.max(1, Math.floor(amount * 0.1));
            if (!this.rbCapExpNotified) {
                this.rbCapExpNotified = true;
                setTimeout(() => showToast(`🔒 [${pkm.species}]은(는) 레벨 제한 Lv.${cap}에 도달해 경험치를 거의 얻지 못한다.`), 400);
            }
        }
        const r = orig.grantExp.call(this, amount);
        if (this.pendingMoveLearns && this.pendingMoveLearns.length) setTimeout(() => flushPendingMoveLearns(), 1500);
        return r;
    };

    P.sendNextTrainerPokemon = function (nextSpeciesData) {
        orig.sendNextTrainerPokemon.call(this, nextSpeciesData);
        RB.hardenEliteMon(this, this.currentEnemy);
    };

    /* 체육관 / 챔피언 도전 */
    P.challengeGym = function () {
        const tile = this.worldMap[this.player.y][this.player.x];
        if (tile !== TILE_TYPES.GYM) { showToast('체육관(Gym) 타일 위에서 도전 키 [G]를 누르세요.'); return; }
        const site = this.getCurrentGymSite();
        if (site === CHAMPION_TOWN) {
            if (this.player.badges < GYM_COUNT) { showToast(`🚫 포켓몬리그에 도전하려면 배지 ${GYM_COUNT}개가 필요합니다. (현재 ${this.player.badges}개)`); playSfx('fail'); return; }
            this.rbChallengeChampion();
            return;
        }
        const leader = site && GYM_LEADERS[site];
        if (!leader) { showToast('이 체육관은 비어 있습니다.'); return; }
        const prev = Object.entries(GYM_LEADERS).filter(([, g]) => g.order < leader.order).sort((a, b) => a[1].order - b[1].order);
        const nextUncleared = prev.find(([name]) => !this.player.defeatedGyms.has(name));
        if (nextUncleared) {
            const [name, info] = nextUncleared;
            showToast(`🚫 먼저 ${info.order}번째 [${name}] 체육관(관장 ${info.leaderName})을 이겨야 합니다.`);
            playSfx('fail');
            return;
        }
        const team = leader.team.map(id => POKEMON_DATABASE.find(p => p.id === id)).filter(Boolean);
        const f = FIELDS[leader.field] || FIELDS.NONE;
        const lines = this.player.defeatedGyms.has(site) ? ['또 왔구나. 좋아, 한 판 더 하자!'] : [...leader.intro];
        if (leader.field !== 'NONE') lines.push(`${f.icon} 전장: ${f.name} — ${f.desc}`);
        showNpcDialog(`${leader.title} ${leader.leaderName}`, lines, () => {
            this.currentGymSite = site;
            this.currentGymLeaderName = `관장 ${leader.leaderName}`;
            this.currentTrainerLevels = [...leader.levels];
            this.rbForcedField = leader.field;
            this.rbForcedItems = leader.items || 0;
            this.startBattle({ ...team[0], isBoss: true }, undefined, team.slice(1).map(p => p.id));
        });
    };
    P.rbChallengeChampion = function () {
        const team = CHAMPION_DATA.team.map(id => POKEMON_DATABASE.find(p => p.id === id)).filter(Boolean);
        const f = FIELDS[CHAMPION_DATA.field] || FIELDS.NONE;
        const lines = this.player.championDefeated ? ['다시 왔군. 전력으로 상대하지!'] : [...CHAMPION_DATA.intro];
        lines.push(`${f.icon} 전장: ${f.name} — ${f.desc}`);
        showNpcDialog(`챔피언 ${CHAMPION_DATA.leaderName}`, lines, () => {
            this.currentGymSite = CHAMPION_TOWN;
            this.currentGymLeaderName = CHAMPION_DATA.leaderName;
            this.currentChampionChallenge = true;
            this.currentTrainerLevels = [...CHAMPION_DATA.levels];
            this.rbForcedField = CHAMPION_DATA.field;
            this.rbForcedItems = CHAMPION_DATA.items || 0;
            this.startBattle({ ...team[0], isBoss: true }, undefined, team.slice(1).map(p => p.id));
        });
    };

    P.handleBossDefeat = function () {
        const site = this.currentGymSite;
        const leader = site ? GYM_LEADERS[site] : null;
        const firstWin = !!(site && !this.player.defeatedGyms.has(site));
        orig.handleBossDefeat.call(this);
        if (leader && firstWin) {
            setTimeout(() => showNpcDialog(`관장 ${leader.leaderName}`, [...leader.outro, `🔓 레벨 제한이 Lv.${RB.levelCap(this)}(으)로 올랐다!`], null), 900);
        }
    };
    P.handleChampionDefeat = function () {
        const first = !this.player.championDefeated;
        orig.handleChampionDefeat.call(this);
        if (first) setTimeout(() => showNpcDialog(`챔피언 ${CHAMPION_DATA.leaderName}`, [...CHAMPION_DATA.outro, '🔓 이제 레벨 제한이 없습니다.'], null), 900);
    };

    P.endBattle = function () {
        this.rbForcedField = null;
        this.rbForcedItems = 0;
        this.rbEnemyItems = 0;
        orig.endBattle.call(this);
        this.battleField = null;
        document.body.classList.remove('rb-in-battle');
        if (this.pendingMoveLearns && this.pendingMoveLearns.length) setTimeout(() => flushPendingMoveLearns(), 700);
    };

    /* 기술 버튼에 필드 보정 표시 */
    P.renderBattleActionGrid = function () {
        orig.renderBattleActionGrid.call(this);
        const cur = this.player.party[this.player.activeIdx];
        const f = FIELDS[this.battleField];
        if (!cur || !f) return;
        const btns = [...document.querySelectorAll('#action-grid .btn-action')];
        cur.skills.forEach((sk, i) => {
            const btn = btns[i];
            const first = btn && btn.querySelector('span');
            if (!first || !(sk.power > 0)) return;
            const m = RB.fieldPowerMult(this, sk);
            if (m !== 1) {
                const tag = document.createElement('em');
                tag.className = 'rb-move-tag ' + (m > 1 ? 'up' : 'down');
                tag.style.setProperty('--fc', f.color);
                tag.textContent = `${f.icon}×${m}`;
                first.appendChild(tag);
            }
            if (RB.stabMult(cur, sk) > 1) {
                const tag = document.createElement('em');
                tag.className = 'rb-move-tag stab';
                tag.textContent = '자속';
                first.appendChild(tag);
            }
            const shift = f.shift && f.shift[sk.type];
            if (shift && (!shift[2] || sk.power >= shift[2])) {
                const tag = document.createElement('em');
                tag.className = 'rb-move-tag shift';
                tag.textContent = `→${FIELDS[shift[0]].icon}`;
                tag.title = `사용하면 ${FIELDS[shift[0]].name}(으)로 변화`;
                first.appendChild(tag);
            }
        });
    };

    /* HUD: 위치 · 야생 레벨대 · 레벨 제한 · 전투 필드 예보 */
    P.updateUI = function () {
        orig.updateUI.call(this);
        if (!this.player.party.length || !this.worldMap[this.player.y]) return;
        const T = TILE_TYPES;
        const tile = this.worldMap[this.player.y][this.player.x];
        const t = RB.townAt(this.player.y, this.player.x);
        const area = RB.areaAt(this.player.y, this.player.x);
        const loc = $('hud-location');
        if (loc) {
            let txt = t ? t.name : (area ? area.name : '성도 지방');
            if (tile === T.CENTER) txt = `포켓몬센터 (${txt})`;
            else if (tile === T.GYM) txt = t && t.name === CHAMPION_TOWN ? '포켓몬리그 (석영고원)' : `체육관 (${txt})`;
            else if (tile === T.MART) txt = `프렌들리숍 (${txt})`;
            else if (LEGEND_TEMPLE_INFO[tile]) txt = `⛩️ ${LEGEND_TEMPLE_INFO[tile].templeName}`;
            loc.innerText = txt;
        }
        const regionEl = $('hud-region');
        if (regionEl && area) {
            const mine = this.player.party[0] ? this.player.party[0].level : 1;
            regionEl.innerHTML = `야생 <b>Lv.${area.band[0]}~${area.band[1]}</b>`;
            regionEl.style.color = area.band[0] > mine + 4 ? 'var(--neon-pink)' : 'var(--neon-cyan)';
        }
        const cur = this.player.party[this.player.activeIdx];
        const cap = RB.levelCap(this);
        const capEl = $('rb-hud-cap');
        if (capEl && cur) {
            if (this.player.championDefeated) { capEl.innerHTML = '🔓 레벨 제한 없음'; capEl.className = 'hud-sub rb-cap'; }
            else {
                const over = cur.level > cap;
                capEl.innerHTML = `🔒 레벨 제한 <b>Lv.${cap}</b>` + (over ? ' · <span class="rb-warn">불복종 위험!</span>' : '');
                capEl.className = 'hud-sub rb-cap' + (over ? ' over' : '');
            }
        }
        const fEl = $('rb-hud-field');
        if (fEl) {
            const fld = FIELDS[fieldForTile(tile, !!this.isNight)];
            fEl.innerHTML = `전투 필드: <span style="color:${fld.color}">${fld.icon} ${fld.name}</span>`;
        }
    };

    /* [버그 수정] 전투 중 가방에서 전투용이 아닌 아이템(벌레퇴치스프레이 등)을 누르면
       "턴 진행 중" 플래그만 켜진 채 아무 처리도 되지 않아 전투가 그대로 멈췄다. */
    P.useItemInBattle = function (inventorySlot) {
        const slot = this.player.inventory[inventorySlot];
        if (!slot || slot.count <= 0 || this.isTurnProcessing) return;
        const it = slot.item;
        if (!(it.catchRate || it.healAmount || it.isRevive || it.cures)) {
            showToast(it.repelSec ? '벌레퇴치스프레이는 필드에서만 사용할 수 있습니다.' : `[${it.name}]은(는) 전투 중에 사용할 수 없습니다.`);
            playSfx('fail');
            return;
        }
        if (it.healAmount && !it.catchRate) {
            const cur = this.player.party[this.player.activeIdx];
            if (cur && cur.hp >= cur.maxHp) { showToast(`[${cur.species}]의 체력은 이미 가득 차 있습니다.`); return; }
        }
        return orig.useItemInBattle.call(this, inventorySlot);
    };

    /* [연출 수정] 몸통박치기·펀치·물기처럼 몸으로 부딪히는 기술은 무언가를 날리지 않고
       포켓몬이 직접 상대에게 돌진해 부딪힌다. */
    P.playSkillAttackFx = function (attacker, move, onImpact) {
        const m = (move && typeof move === 'object') ? move : null;
        const kind = RB.contactKind(m);
        if (!kind || this.state !== GAME_STATES.BATTLE) return orig.playSkillAttackFx.call(this, attacker, move, onImpact);
        const isPlayer = attacker === 'player';
        const box = $(isPlayer ? 'player-sprite-box' : 'enemy-sprite-box');
        if (!box || !box.animate) return orig.playSkillAttackFx.call(this, attacker, move, onImpact);
        if (this.battleStageGroup3D && this.battleStageGroup3D.visible) this.triggerCameraPunch(isPlayer);

        const self = this.getSpriteAnchor(isPlayer), foe = this.getSpriteAnchor(!isPlayer);
        const dx = (foe.dom.x - self.dom.x) * 0.78, dy = (foe.dom.y - self.dom.y) * 0.78;
        const sc = isPlayer ? 0.82 : 1.18;
        const frames = kind === 'kick'
            ? [{ transform: 'none' }, { transform: `translate(${-dx * 0.06}px, ${-dy * 0.06 - 18}px)`, offset: 0.18 }, { transform: `translate(${dx}px, ${dy}px) scale(${sc}) rotate(${isPlayer ? 18 : -18}deg)`, offset: 0.5 }, { transform: 'none' }]
            : [{ transform: 'none' }, { transform: `translate(${-dx * 0.08}px, ${-dy * 0.08}px) scale(0.94)`, offset: 0.2 }, { transform: `translate(${dx}px, ${dy}px) scale(${sc})`, offset: 0.5 }, { transform: `translate(${dx * 0.9}px, ${dy * 0.9}px) scale(${sc})`, offset: 0.58 }, { transform: 'none' }];
        const anim = box.animate(frames, { duration: 640, easing: 'cubic-bezier(.5,0,.3,1)' });
        try { playSfx('click'); } catch (e) { }

        const fx = getMoveFx(m);
        fx.hit = (kind === 'slash' || kind === 'bite') ? 'slash' : (m.power >= 90 ? 'crush' : 'impact');
        // 실제로 몸이 상대에게 닿는 순간(애니메이션 절반)에 맞춰 타격 처리 - 프레임이 느린
        // 기기에서도 부딪히기 전에 데미지가 먼저 들어가지 않도록 애니메이션 시간을 따른다.
        let hit = false;
        const doHit = () => {
            if (hit) return;
            hit = true;
            this.playMoveImpactFx(fx, foe.canvas, isPlayer);
            if (onImpact) onImpact();
        };
        const watch = () => {
            if (hit) return;
            if (anim.playState === 'finished' || (anim.currentTime || 0) >= 320) doHit();
            else requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
        setTimeout(doHit, 1500);
    };

    /* ======================================================================
       7. 기술 습득 / 잊기 / 다시 배우기
       ====================================================================== */
    const moveLine = (m) => `${typeBadgeHtml(m.type)} <span class="lm-stat">${m.category} · 위력 ${m.power || '-'} · 명중 ${m.accuracy >= 999 ? '-' : m.accuracy} · PP ${m.maxPp || m.basePp || computeMaxPP(m)}</span>`;

    /* 레벨업으로 새 기술을 배울 때 - 전투 중에도 곧바로 물어본다 */
    flushPendingMoveLearns = function () {
        const g = gameInstance;
        if (!g || !g.pendingMoveLearns || !g.pendingMoveLearns.length) return;
        if ($('learn-move-modal').style.display === 'flex') return;
        const job = g.pendingMoveLearns[0];
        const pkm = job.pkmRef;
        const mv = SKILL_DATABASE[job.moveKey];
        if (!pkm || !mv || pkm.skills.some(sk => sk.name === mv.name) || pkm.skills.length < 4) {
            g.pendingMoveLearns.shift();
            if (pkm && mv && pkm.skills.length < 4 && !pkm.skills.some(sk => sk.name === mv.name)) {
                pkm.skills.push(instantiateSkills([mv])[0]);
                showToast(`📘 ${pkm.species}${josa(pkm.species, '은', '는')} [${mv.name}]${josa(mv.name, '을', '를')} 배웠다!`);
            }
            return flushPendingMoveLearns();
        }
        $('learn-move-desc').textContent = `${pkm.species}${josa(pkm.species, '은', '는')} [${mv.name}]${josa(mv.name, '을', '를')} 배우고 싶어한다! 하지만 이미 기술을 4개 알고 있다. 잊을 기술을 고르거나, 배우지 않을 수 있다.`;
        $('learn-move-new').innerHTML = `<div class="dm-top" style="font-size:14px;">✨ ${mv.name}</div><div style="margin-top:4px;">${moveLine(mv)}</div>`;
        const list = $('learn-move-list');
        list.innerHTML = '';
        pkm.skills.forEach((sk, idx) => {
            const row = document.createElement('div');
            row.className = 'learn-move-row';
            row.innerHTML = `<div style="flex:1;"><div class="lm-name">${sk.name} <span class="lm-stat">PP ${sk.pp}/${sk.maxPp}</span></div><div style="margin-top:3px;">${moveLine(sk)}</div></div><span style="font-size:11px; color:var(--neon-pink); font-weight:bold;">잊기</span>`;
            row.onclick = () => {
                const forgotten = pkm.skills[idx].name;
                pkm.skills[idx] = instantiateSkills([mv])[0];
                g.pendingMoveLearns.shift();
                $('learn-move-modal').style.display = 'none';
                showToast(`📘 1, 2, 3... 짠! ${pkm.species}${josa(pkm.species, '은', '는')} [${forgotten}]${josa(forgotten, '을', '를')} 잊고 [${mv.name}]${josa(mv.name, '을', '를')} 배웠다!`);
                playSfx('levelup');
                g.updateUI();
                if (g.state === GAME_STATES.BATTLE) g.refreshBattleMenu();
                else g.saveGame(true);
                setTimeout(() => flushPendingMoveLearns(), 600);
            };
            list.appendChild(row);
        });
        $('learn-move-modal').style.display = 'flex';
    };
    skipMoveLearn = function () {
        const g = gameInstance;
        if (!g || !g.pendingMoveLearns) return;
        const job = g.pendingMoveLearns.shift();
        $('learn-move-modal').style.display = 'none';
        if (job) {
            const mv = SKILL_DATABASE[job.moveKey];
            const n = mv ? mv.name : '새 기술';
            showToast(`${job.pkmRef.species}${josa(job.pkmRef.species, '은', '는')} [${n}]${josa(n, '을', '를')} 배우지 않았다.`);
        }
        playSfx('menu');
        setTimeout(() => flushPendingMoveLearns(), 400);
    };

    /* 정보 화면의 [기술 관리] - 잊기 / 다시 배우기 */
    function buildMoveManager() {
        if ($('rb-move-modal') || !$('screen-area')) return;
        const m = document.createElement('div');
        m.id = 'rb-move-modal';
        m.className = 'modal';
        m.innerHTML = `
            <div class="modal-card">
                <div class="modal-titlebar" style="background: linear-gradient(135deg, #1d4ed8, #60a5fa);">
                    <h3 id="rb-mm-title">📘 기술 관리</h3>
                    <div class="modal-close-btn" onclick="RB.closeMoveManager()">✕</div>
                </div>
                <p id="rb-mm-desc" style="font-size:12px; color:var(--text-sub); margin:0 0 10px;"></p>
                <div class="record-section-title">알고 있는 기술</div>
                <div id="rb-mm-known" class="learn-move-list"></div>
                <div class="record-section-title" style="margin-top:12px;">다시 배울 수 있는 기술 (지금 레벨까지의 레벨업 기술)</div>
                <div id="rb-mm-learnable" class="learn-move-list"></div>
                <button onclick="RB.closeMoveManager()" class="btn-action" style="margin-top:14px; width:100%;">닫기</button>
            </div>`;
        $('screen-area').appendChild(m);
    }
    RB.openMoveManager = function (partyIdx) {
        const g = gameInstance;
        if (!g || g.state === GAME_STATES.BATTLE) { showToast('전투 중에는 기술을 관리할 수 없습니다.'); return; }
        const pkm = g.player.party[partyIdx];
        if (!pkm) return;
        buildMoveManager();
        RB._mm = { pkm, replacing: null };
        renderMoveManager();
        $('rb-move-modal').style.display = 'flex';
        playSfx('menu');
    };
    RB.closeMoveManager = function () { const m = $('rb-move-modal'); if (m) m.style.display = 'none'; };
    function renderMoveManager() {
        const { pkm, replacing } = RB._mm;
        $('rb-mm-title').textContent = `📘 ${pkm.species}의 기술 관리`;
        $('rb-mm-desc').textContent = replacing
            ? `[${replacing.name}]${josa(replacing.name, '을', '를')} 배우려면 잊을 기술을 고르세요.`
            : '기술을 잊거나, 지금 레벨까지 레벨업으로 배울 수 있었던 기술을 다시 배울 수 있습니다.';
        const known = $('rb-mm-known');
        known.innerHTML = '';
        pkm.skills.forEach((sk, idx) => {
            const row = document.createElement('div');
            row.className = 'learn-move-row';
            const label = replacing ? '이 기술과 교체' : (pkm.skills.length > 1 ? '잊기' : '마지막 기술');
            row.innerHTML = `<div style="flex:1;"><div class="lm-name">${sk.name} <span class="lm-stat">PP ${sk.pp}/${sk.maxPp}</span></div><div style="margin-top:3px;">${moveLine(sk)}</div></div><span style="font-size:11px; color:var(--neon-pink); font-weight:bold;">${label}</span>`;
            row.onclick = () => {
                if (replacing) {
                    const old = pkm.skills[idx].name;
                    pkm.skills[idx] = instantiateSkills([replacing])[0];
                    RB._mm.replacing = null;
                    showToast(`📘 ${pkm.species}${josa(pkm.species, '은', '는')} [${old}]${josa(old, '을', '를')} 잊고 [${replacing.name}]${josa(replacing.name, '을', '를')} 배웠다!`);
                    playSfx('levelup');
                } else {
                    if (pkm.skills.length <= 1) { showToast('마지막 남은 기술은 잊을 수 없습니다.'); return; }
                    const old = pkm.skills.splice(idx, 1)[0];
                    showToast(`${pkm.species}${josa(pkm.species, '은', '는')} [${old.name}]${josa(old.name, '을', '를')} 깨끗이 잊었다!`);
                    playSfx('menu');
                }
                gameInstance.saveGame(true);
                renderMoveManager();
            };
            known.appendChild(row);
        });
        const learnable = $('rb-mm-learnable');
        learnable.innerHTML = '';
        const seen = new Set(pkm.skills.map(s => s.name));
        const cands = [];
        (LEARN[pkm.id] || []).filter(L => L.lv <= pkm.level).forEach(L => {
            const mv = SKILL_DATABASE[L.key];
            if (mv && !seen.has(mv.name) && !cands.some(c => c.mv.name === mv.name)) cands.push({ lv: L.lv, mv });
        });
        if (!cands.length) learnable.innerHTML = '<div class="box-empty">다시 배울 수 있는 기술이 없습니다.</div>';
        cands.forEach(({ lv, mv }) => {
            const row = document.createElement('div');
            row.className = 'learn-move-row';
            row.innerHTML = `<div style="flex:1;"><div class="lm-name">${mv.name} <span class="lm-stat">Lv.${lv}</span></div><div style="margin-top:3px;">${moveLine(mv)}</div></div><span style="font-size:11px; color:var(--poke-blue); font-weight:bold;">배우기</span>`;
            row.onclick = () => {
                if (pkm.skills.length < 4) {
                    pkm.skills.push(instantiateSkills([mv])[0]);
                    showToast(`📘 ${pkm.species}${josa(pkm.species, '은', '는')} [${mv.name}]${josa(mv.name, '을', '를')} 배웠다!`);
                    playSfx('levelup');
                    gameInstance.saveGame(true);
                } else {
                    RB._mm.replacing = mv;
                }
                renderMoveManager();
            };
            learnable.appendChild(row);
        });
    }
    const _openDetailModal = openDetailModal;
    openDetailModal = function (partyIdx, fromBox) {
        _openDetailModal(partyIdx, fromBox);
        if (fromBox) return;
        const body = $('detail-body');
        if (!body || body.querySelector('.rb-mm-btn')) return;
        const btn = document.createElement('button');
        btn.className = 'btn-action rb-mm-btn';
        btn.style.cssText = 'margin-top:12px; width:100%;';
        btn.textContent = '📘 기술 관리 (잊기 · 다시 배우기)';
        btn.onclick = () => { closeDetailModal(); RB.openMoveManager(partyIdx); };
        body.appendChild(btn);
    };

    /* ======================================================================
       8. 기록 창 [J] - 체육관 / 필드 도감
       ====================================================================== */
    function buildStoryModal() {
        if ($('rb-story-modal') || !$('screen-area')) return;
        const m = document.createElement('div');
        m.id = 'rb-story-modal';
        m.className = 'modal';
        m.innerHTML = `
            <div class="modal-card modal-card-wide">
                <div class="modal-titlebar rb-titlebar">
                    <h3>📓 성도 지방 기록</h3>
                    <div class="modal-close-btn" onclick="RB.closeStory()">✕</div>
                </div>
                <div class="rb-tabs">
                    <button class="rb-tab active" data-tab="gyms">체육관</button>
                    <button class="rb-tab" data-tab="fields">필드 도감</button>
                </div>
                <div id="rb-story-body"></div>
                <button onclick="RB.closeStory()" class="btn-action" style="margin-top:14px; width:100%;">닫기</button>
            </div>`;
        $('screen-area').appendChild(m);
        m.querySelectorAll('.rb-tab').forEach(t => t.onclick = () => {
            m.querySelectorAll('.rb-tab').forEach(x => x.classList.toggle('active', x === t));
            renderStoryTab(t.dataset.tab);
            playSfx('click');
        });
    }
    function renderStoryTab(tab) {
        const g = gameInstance;
        const body = $('rb-story-body');
        if (!g || !body) return;
        if (tab === 'fields') {
            body.innerHTML = '<div class="rb-field-grid">' + Object.values(FIELDS).map(f => {
                const shifts = f.shift ? Object.entries(f.shift).map(([t, s]) => `<span class="rb-shift">${t} 기술 → ${FIELDS[s[0]].icon} ${FIELDS[s[0]].name}</span>`).join('') : '';
                return `<div class="rb-field-card" style="--fc:${f.color}"><div class="rb-fc-head">${f.icon} ${f.name}</div><div class="rb-fc-desc">${f.desc}</div>${shifts}</div>`;
            }).join('') + '</div>';
            return;
        }
        const cap = RB.levelCap(g);
        const rows = Object.entries(GYM_LEADERS).sort((a, b) => a[1].order - b[1].order).map(([townName, L]) => {
            const f = FIELDS[L.field] || FIELDS.NONE;
            const done = g.player.defeatedGyms.has(townName);
            return `<div class="rb-gym-row ${done ? 'done' : ''}">
                <div class="rb-gym-no">${L.order}</div>
                <div class="rb-gym-main"><div class="rb-gym-name">${L.leaderName} <span>${L.title}</span></div>
                <div class="rb-gym-sub">${townName} · ${L.badgeName} · 에이스 Lv.${L.levels[L.levels.length - 1]} · ${L.team.length}마리</div></div>
                <div class="rb-gym-field" style="--fc:${f.color}">${f.icon} ${f.name}</div>
                <div class="rb-gym-state">${done ? '🏅' : '—'}</div></div>`;
        }).join('');
        const cf = FIELDS[CHAMPION_DATA.field];
        body.innerHTML = `<div class="rb-stat-row">
                <div><b>${g.player.badges}</b>/8<br><span>배지</span></div>
                <div><b>${g.player.championDefeated ? '∞' : 'Lv.' + cap}</b><br><span>레벨 제한</span></div>
                <div><b>${g.player.pokedex.size}</b><br><span>도감 발견</span></div>
                <div><b>${g.player.championDefeated ? '👑' : '-'}</b><br><span>챔피언</span></div>
            </div>` + rows + `<div class="rb-gym-row champ ${g.player.championDefeated ? 'done' : ''}">
                <div class="rb-gym-no">👑</div>
                <div class="rb-gym-main"><div class="rb-gym-name">${CHAMPION_DATA.leaderName} <span>포켓몬리그 챔피언</span></div>
                <div class="rb-gym-sub">${CHAMPION_TOWN} · 배지 8개 필요 · 에이스 Lv.${CHAMPION_DATA.levels[CHAMPION_DATA.levels.length - 1]}</div></div>
                <div class="rb-gym-field" style="--fc:${cf.color}">${cf.icon} ${cf.name}</div>
                <div class="rb-gym-state">${g.player.championDefeated ? '👑' : '—'}</div></div>
            <div class="rb-tip">💡 기술 버튼의 <em class="rb-move-tag up" style="--fc:#eab308">⚡×1.5</em>는 현재 필드 보정, <em class="rb-move-tag shift">→🔥</em>는 사용하면 필드가 바뀐다는 뜻입니다.</div>`;
    }
    RB.openStory = function () {
        buildStoryModal();
        const m = $('rb-story-modal');
        m.querySelectorAll('.rb-tab').forEach((x, i) => x.classList.toggle('active', i === 0));
        renderStoryTab('gyms');
        m.style.display = 'flex';
        playSfx('menu');
    };
    RB.closeStory = function () { const m = $('rb-story-modal'); if (m) m.style.display = 'none'; };

    /* ======================================================================
       9. DOM 주입 / 입력
       ====================================================================== */
    function injectDom() {
        const card = $('hud-pokemon-card');
        if (card && !$('rb-hud-cap')) {
            const cap = document.createElement('div');
            cap.id = 'rb-hud-cap';
            cap.className = 'hud-sub rb-cap';
            card.appendChild(cap);
        }
        const weather = $('hud-weather');
        if (weather && !$('rb-hud-field')) {
            const f = document.createElement('div');
            f.id = 'rb-hud-field';
            f.className = 'hud-sub';
            f.style.marginTop = '2px';
            weather.parentNode.insertBefore(f, weather);
        }
        buildBattleFieldDom();
        buildStoryModal();
        buildMoveManager();
        try {
            const sys = HELP_SECTIONS.find(s => s.title === '시스템');
            if (sys && !sys.rows.some(r => r.keys[0] === 'J')) sys.rows.unshift({ keys: ['J'], desc: '체육관 기록 · 필드 도감' });
            const grid = $('help-grid');
            if (grid) grid.dataset.built = '';
        } catch (e) { }
        const t = document.querySelector('#starter-modal .modal-titlebar h2');
        if (t) t.textContent = '⭐ 스타팅 포켓몬을 선택하세요! (전 세대)';
    }

    window.addEventListener('keydown', (e) => {
        const key = (e.key || '').toLowerCase();
        const tag = (e.target && e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        for (const id of ['rb-story-modal', 'rb-move-modal']) {
            const m = $(id);
            if (m && m.style.display === 'flex' && (key === 'escape' || (key === 'j' && id === 'rb-story-modal'))) {
                e.preventDefault(); e.stopImmediatePropagation();
                m.style.display = 'none';
                return;
            }
        }
        if (key === 'j' && gameInstance && gameInstance.state === GAME_STATES.FIELD && !gameInstance.titleScreenActive) {
            const login = $('login-modal');
            if (login && login.style.display === 'flex') return;
            e.preventDefault();
            RB.openStory();
        }
    }, true);

    window.addEventListener('load', () => {
        injectDom();
        setInterval(() => {
            const g = gameInstance;
            if (g) document.body.classList.toggle('rb-in-battle', g.state === GAME_STATES.BATTLE);
        }, 400);
    });
})();

/* 대화창은 클릭으로도 넘길 수 있다 */
window.addEventListener('load', () => {
    const el = document.getElementById('npc-dialog');
    if (el) { el.style.cursor = 'pointer'; el.addEventListener('click', () => advanceNpcDialog()); }
});
