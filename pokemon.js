const GIANT_BODY_IDS = new Set([382, 383, 384, 249, 250, 483, 484, 487, 373, 130, 306]);
        const TILE_SIZE = 40;
        // [맵 대확장] 320x320 → 640x640 (면적 4배). 마을이 5곳에서 8곳으로 늘고,
        // 북서 삼림·서부 고원·내륙 호수·남동 대해양 같은 지역이 새로 생겼다.
        const MAP_COLS = 640;
        const MAP_ROWS = 640;

        /* ==========================================================================
           0-A. 시드 기반 난수 발생기 (mulberry32)
           월드 지형 생성에만 사용한다. 같은 시드는 언제나 완전히 똑같은 지도를
           만들어내므로, 세이브 데이터에 102,400칸짜리 타일맵 전체를 통째로
           저장할 필요 없이 시드 숫자 하나만 기록하면 된다 - 실제 상용 RPG가
           절차적 월드를 저장하는 방식과 동일하다.
           ========================================================================== */
        function makeSeededRng(seed) {
            let a = seed >>> 0;
            return function () {
                a |= 0; a = (a + 0x6D2B79F5) | 0;
                let t = Math.imul(a ^ (a >>> 15), 1 | a);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        }

        // 맵이 320x320 → 640x640으로 완전히 새로 그려졌기 때문에, 예전 세이브의
        // 좌표/시드를 그대로 불러오면 엉뚱한 지형 한가운데 떨어진다. 저장 키를 올려
        // 구버전 세이브는 자동으로 무시되고 새 모험으로 시작하도록 한다.
        /* 세이브 키는 로그인한 계정에 따라 바뀐다 (SAVE_KEY_BASE::<아이디>).
           계정 기능이 없던 시절의 단일 세이브는 첫 로그인 때 그 계정으로 옮겨진다. */
        const SAVE_KEY_BASE = 'pokemon_ultra_expansion_save_v3';
        let SAVE_KEY = SAVE_KEY_BASE;
        const SAVE_VERSION = 3;
        const DAY_CYCLE_SEC = 300; // 게임 내 하루 = 실제 5분

        /* 하루의 시간대 구간 정의 - timeOfDay(0~1)에 따라 화면 색조/조명/라벨이 바뀐다 */
        const TIME_PHASES = [
            { at: 0.00, key: 'MIDNIGHT', label: '심야 🌌', tint: [8, 12, 40],    alpha: 0.58 },
            { at: 0.22, key: 'DAWN',     label: '새벽 🌄', tint: [86, 60, 110],  alpha: 0.34 },
            { at: 0.30, key: 'MORNING',  label: '아침 🌅', tint: [255, 176, 96], alpha: 0.16 },
            { at: 0.40, key: 'DAY',      label: '낮 ☀️',  tint: [255, 250, 230], alpha: 0.00 },
            { at: 0.66, key: 'EVENING',  label: '저녁 🌇', tint: [255, 132, 52], alpha: 0.26 },
            { at: 0.76, key: 'DUSK',     label: '해질녘 🌆', tint: [172, 78, 104], alpha: 0.38 },
            { at: 0.88, key: 'NIGHT',    label: '밤 🌙',   tint: [10, 16, 48],   alpha: 0.56 },
            { at: 1.00, key: 'MIDNIGHT', label: '심야 🌌', tint: [8, 12, 40],    alpha: 0.58 }
        ];

        function sampleTimePhase(t) {
            const x = ((t % 1) + 1) % 1;
            for (let i = 0; i < TIME_PHASES.length - 1; i++) {
                const a = TIME_PHASES[i], b = TIME_PHASES[i + 1];
                if (x >= a.at && x <= b.at) {
                    const k = (b.at - a.at) === 0 ? 0 : (x - a.at) / (b.at - a.at);
                    return {
                        key: k < 0.5 ? a.key : b.key,
                        label: k < 0.5 ? a.label : b.label,
                        alpha: a.alpha + (b.alpha - a.alpha) * k,
                        tint: [
                            Math.round(a.tint[0] + (b.tint[0] - a.tint[0]) * k),
                            Math.round(a.tint[1] + (b.tint[1] - a.tint[1]) * k),
                            Math.round(a.tint[2] + (b.tint[2] - a.tint[2]) * k)
                        ]
                    };
                }
            }
            return { key: 'DAY', label: '낮 ☀️', alpha: 0, tint: [255, 255, 255] };
        }

        /* ==========================================================================
           0-B. 업적(도전과제) 정의 - 실제 상용 RPG의 트로피/업적 시스템 재현.
           각 업적은 check(game) 함수가 true를 반환하는 순간 자동으로 해금되고
           화면에 해금 연출이 뜬다.
           ========================================================================== */
        const ACHIEVEMENTS = [
            { id: 'FIRST_STEP', icon: '👟', name: '모험의 시작',    desc: '파트너 포켓몬과 함께 여행을 떠난다', check: g => g.player.party.length > 0 },
            { id: 'FIRST_CATCH', icon: '🔴', name: '첫 포획',       desc: '야생 포켓몬을 처음으로 잡는다',       check: g => g.stats.captures >= 1 },
            { id: 'CATCH_10',   icon: '🎯', name: '숙련된 트레이너', desc: '포켓몬을 10마리 포획한다',            check: g => g.stats.captures >= 10 },
            { id: 'CATCH_30',   icon: '🏅', name: '포획 마스터',    desc: '포켓몬을 30마리 포획한다',            check: g => g.stats.captures >= 30 },
            { id: 'DEX_10',     icon: '📗', name: '도감 입문',      desc: '10종을 도감에 등록한다',              check: g => g.player.pokedex.size >= 10 },
            { id: 'DEX_50',     icon: '📘', name: '도감 수집가',    desc: '50종을 도감에 등록한다',              check: g => g.player.pokedex.size >= 50 },
            { id: 'DEX_100',    icon: '📕', name: '도감 박사',      desc: '100종을 도감에 등록한다',             check: g => g.player.pokedex.size >= 100 },
            { id: 'WIN_1',      icon: '⚔️', name: '첫 승리',        desc: '전투에서 처음으로 승리한다',          check: g => g.stats.battlesWon >= 1 },
            { id: 'WIN_50',     icon: '🗡️', name: '백전노장',       desc: '전투에서 50번 승리한다',              check: g => g.stats.battlesWon >= 50 },
            { id: 'BADGE_1',    icon: '🎖️', name: '첫 번째 뱃지',   desc: '체육관 관장을 처음으로 이긴다',       check: g => g.player.badges >= 1 },
            { id: 'BADGE_ALL',  icon: '👑', name: '모든 뱃지',      desc: '모든 체육관 뱃지를 모은다',           check: g => g.player.badges >= GYM_COUNT },
            { id: 'CHAMPION',   icon: '🏆', name: '챔피언',         desc: '포켓몬 리그 챔피언을 격파한다',       check: g => !!g.player.championDefeated },
            { id: 'LEGEND',     icon: '✨', name: '전설과의 조우',   desc: '전설·환상의 포켓몬을 손에 넣는다',    check: g => g.stats.legendsCaught >= 1 },
            { id: 'MEGA',       icon: '⚡', name: '메가진화',       desc: '전투 중 메가진화를 성공시킨다',       check: g => g.stats.megaEvolutions >= 1 },
            { id: 'LV50',       icon: '📈', name: '한계 돌파',      desc: '포켓몬을 50레벨까지 키운다',          check: g => g.player.party.concat(g.player.box).some(p => p.level >= 50) },
            { id: 'WALK_1000',  icon: '🥾', name: '천 걸음의 여정',  desc: '1,000걸음을 걷는다',                  check: g => g.stats.steps >= 1000 },
            { id: 'PLAY_1H',    icon: '⏱️', name: '시간 가는 줄 모르고', desc: '1시간 동안 플레이한다',           check: g => g.stats.playSec >= 3600 },
            { id: 'RICH',       icon: '💰', name: '백만장자',       desc: '소지금 50,000G를 모은다',             check: g => g.player.gold >= 50000 }
        ];

        const GAME_STATES = {
            STARTER_SELECT: 'STARTER_SELECT',
            FIELD: 'FIELD',
            BATTLE: 'BATTLE',
            MENU: 'MENU'
        };

        const TILE_TYPES = {
            GRASS: 0,
            TALL_GRASS: 1,
            WATER: 2,
            ROCK: 3,
            TOWN: 4,
            GYM: 5,
            CENTER: 6,
            SAND: 7,
            SNOW: 8,
            VOLCANO: 9,
            FOREST: 10,
            MART: 12,
            LAND_TEMPLE: 13,
            SEA_TEMPLE: 14,
            SKY_TEMPLE: 15,
            PATH: 16,
            // [지형 확장] 자연 지형을 11종 → 20종으로 늘렸다. 각 지형은 고유한
            // 타일 아트·서식 포켓몬·전투 무대 배경을 가진다.
            SWAMP: 17,       // 늪지대
            BEACH: 18,       // 모래사장(해안선)
            FLOWER: 19,      // 꽃밭
            CAVE: 20,        // 동굴
            RUINS: 21,       // 고대 유적
            ICE_FIELD: 22,   // 빙판 호수
            WASTELAND: 23,   // 황무지
            BAMBOO: 24,      // 대나무 숲
            CHERRY: 25       // 벚꽃 숲
        };

        /* [오버월드 리디자인] 예전 팔레트는 평원(GRASS)이 남색에 가까운 #0f172a여서
           마을 밖 대부분의 화면이 시커멓게 보였고, 나머지 지형도 채도만 높은 단색이라
           "색칠한 격자" 같았다. 실제 포켓몬 필드처럼 자연스러운 자연광 팔레트로 교체한다.
           이 색은 미니맵 색상으로도 그대로 쓰인다. */
        const TILE_COLORS = {
            [TILE_TYPES.GRASS]: '#63ab52',
            [TILE_TYPES.TALL_GRASS]: '#2d7331',
            [TILE_TYPES.WATER]: '#2f8fd0',
            [TILE_TYPES.ROCK]: '#7c8798',
            [TILE_TYPES.TOWN]: '#8ab861',
            [TILE_TYPES.GYM]: '#be123c',
            [TILE_TYPES.CENTER]: '#059669',
            [TILE_TYPES.SAND]: '#e2c689',
            [TILE_TYPES.SNOW]: '#eef4fb',
            [TILE_TYPES.VOLCANO]: '#4a2a26',
            [TILE_TYPES.FOREST]: '#44834a',
            [TILE_TYPES.MART]: '#2563eb',
            [TILE_TYPES.LAND_TEMPLE]: '#8b5a2b',
            [TILE_TYPES.SEA_TEMPLE]: '#1c6b93',
            [TILE_TYPES.SKY_TEMPLE]: '#b08d3f',
            [TILE_TYPES.PATH]: '#cfa86e',
            [TILE_TYPES.SWAMP]: '#4a5f43',
            [TILE_TYPES.BEACH]: '#f0dcae',
            [TILE_TYPES.FLOWER]: '#7fc25f',
            [TILE_TYPES.CAVE]: '#3b3b46',
            [TILE_TYPES.RUINS]: '#a39b86',
            [TILE_TYPES.ICE_FIELD]: '#bfe4f5',
            [TILE_TYPES.WASTELAND]: '#a08a6a',
            [TILE_TYPES.BAMBOO]: '#5b8f4a',
            [TILE_TYPES.CHERRY]: '#8fb86a'
        };

        /* 오버월드 지형 아트용 상세 팔레트 - 타일 스프라이트를 구울 때 사용한다 */
        const FIELD_PALETTE = {
            grass:   { base: '#63ab52', light: '#7cc165', dark: '#4e8f42', deep: '#3c7735' },
            tall:    { base: '#2d7331', blade: '#4f9f47', bladeDark: '#1e5622', tip: '#79c169' },
            water:   { deep: '#1a6aad', base: '#2f8fd0', light: '#5bb8e8', foam: '#e6f6ff' },
            sand:    { base: '#e2c689', light: '#f2ddac', dark: '#c4a361', rock: '#a9884f' },
            snow:    { base: '#eef4fb', light: '#ffffff', dark: '#cfe0f0', deep: '#b3cde4' },
            volcano: { rock: '#3f2521', dark: '#26130f', crack: '#ff6a2b', hot: '#ffd45a', ash: '#5c3a33' },
            forest:  { floor: '#44834a', litter: '#376b3c', canopy: '#2f7a3a', canopyLt: '#45a24f', canopyDk: '#1f5527', trunk: '#6b4522' },
            rock:    { base: '#7c8798', light: '#9dabbb', dark: '#5c6674', crack: '#4a525e' },
            path:    { base: '#cfa86e', light: '#e6c894', dark: '#ad8850', pebble: '#8f7040' },
            swamp:   { base: '#4a5f43', mud: '#3a4a35', water: '#5b7a58', scum: '#7fa06a', bubble: '#a8c48c' },
            beach:   { base: '#f0dcae', light: '#fdf2d4', dark: '#d9bf86', wet: '#cbae7c', shell: '#ffffff' },
            flower:  { base: '#7fc25f', light: '#9ad97a', dark: '#5da345', petal: ['#ff8fab', '#ffd166', '#c4a3ff', '#ffffff', '#ff6b6b'] },
            cave:    { base: '#3b3b46', light: '#585866', dark: '#22222b', crystal: '#7dd3fc', moss: '#3f6b46' },
            ruins:   { base: '#a39b86', light: '#c2baa4', dark: '#7d765f', moss: '#6b8f4f', carve: '#6b6350' },
            ice:     { base: '#bfe4f5', light: '#eaf7ff', dark: '#8fc3dd', crack: '#6aa6c6' },
            waste:   { base: '#a08a6a', light: '#bda482', dark: '#7d6a4f', crack: '#5e4f3a' },
            bamboo:  { base: '#4a7a3f', stalk: '#8fbe57', stalkDk: '#5f8a35', leaf: '#6fa844' },
            cherry:  { base: '#8fb86a', trunk: '#6b4b3a', bloom: '#ffc2d6', bloomLt: '#ffe3ec', bloomDk: '#f28fb0' }
        };

        /* 지형이 이웃을 "덮어가는" 우선순위. 값이 큰 지형이 작은 지형 위로 번져 나간다
           (풀이 바위밭 가장자리를 덮고, 물결이 모래 해변을 적시는 식). 경계마다 한쪽
           방향으로만 번지게 해서, 작은 바위 무더기가 사방에서 밀려오는 초록에 파묻혀
           형체를 잃어버리는 일이 없도록 한다. */
        const TILE_BLEND_PRIORITY = {
            water: 5, beach: 4.5, grass: 4, tall: 4, flower: 4, cherry: 4, bamboo: 3.5,
            swamp: 3.5, snow: 3, ice: 3, sand: 3, forest: 3,
            waste: 2.5, volcano: 2, rock: 2, cave: 1.5, ruins: 1.5, path: 1, structure: 0
        };

        // 카테고리 분류 - 인접 타일 간 지형 경계를 자연스럽게 블렌딩할 때 사용
        function getTileCategory(tile) {
            switch (tile) {
                case TILE_TYPES.WATER: return 'water';
                case TILE_TYPES.SAND: return 'sand';
                case TILE_TYPES.SNOW: return 'snow';
                case TILE_TYPES.VOLCANO: return 'volcano';
                case TILE_TYPES.FOREST: return 'forest';
                case TILE_TYPES.PATH: return 'path';
                // [수정] 예전에는 바위(ROCK)가 어느 분류에도 없어서 'structure'로 떨어졌고,
                // 수풀은 평원과 같은 분류였다. 그래서 바위밭과 수풀 지대만 주변 지형과
                // 전혀 섞이지 않은 채 잘라 붙인 사각형처럼 보였다. 각자 고유 분류를 준다.
                case TILE_TYPES.ROCK: return 'rock';
                case TILE_TYPES.TALL_GRASS: return 'tall';
                case TILE_TYPES.GRASS: return 'grass';
                case TILE_TYPES.SWAMP: return 'swamp';
                case TILE_TYPES.BEACH: return 'beach';
                case TILE_TYPES.FLOWER: return 'flower';
                case TILE_TYPES.CAVE: return 'cave';
                case TILE_TYPES.RUINS: return 'ruins';
                case TILE_TYPES.ICE_FIELD: return 'ice';
                case TILE_TYPES.WASTELAND: return 'waste';
                case TILE_TYPES.BAMBOO: return 'bamboo';
                case TILE_TYPES.CHERRY: return 'cherry';
                default: return 'structure';
            }
        }

        /* ==========================================================================
           3-D 필드 렌더링 상수
           2D 타일맵/이동/인카운터 로직은 그대로 두고, 화면에 그리는 방식만
           Three.js 3D 씬으로 교체한다. 타일 종류마다 "높이"를 다르게 줘서
           절벽(바위)·저지대(길/물)가 자연스럽게 입체적으로 드러나게 한다.
           ========================================================================== */
        const TILE_SIZE_3D = 4;
        const TILE_3D_STYLE = {
            [TILE_TYPES.GRASS]:       { top: 0x4fb85f, side: 0x2f6e3a, height: 2.0 },
            [TILE_TYPES.TALL_GRASS]:  { top: 0x35935a, side: 0x1f5c3a, height: 2.1, prop: 'bush' },
            [TILE_TYPES.WATER]:       { top: 0x2f97f0, side: 0x155a91, height: 0.7, water: true },
            [TILE_TYPES.ROCK]:        { top: 0x94a3b8, side: 0x475569, height: 5.6 },
            [TILE_TYPES.TOWN]:        { top: 0xe8b45c, side: 0x9a6a24, height: 2.0 },
            [TILE_TYPES.GYM]:         { top: 0xd1495f, side: 0x7f1d34, height: 2.0, prop: 'building_gym' },
            [TILE_TYPES.CENTER]:      { top: 0x2cbb82, side: 0x0f6b47, height: 2.0, prop: 'building_center' },
            [TILE_TYPES.SAND]:        { top: 0xdcb066, side: 0x8a621f, height: 1.9 },
            [TILE_TYPES.SNOW]:        { top: 0xf3f8fb, side: 0xb9c8d2, height: 2.3 },
            [TILE_TYPES.VOLCANO]:     { top: 0x9c2b2b, side: 0x3f0f0f, height: 3.0 },
            [TILE_TYPES.FOREST]:      { top: 0x246b3d, side: 0x123a21, height: 2.1, prop: 'tree' },
            [TILE_TYPES.MART]:        { top: 0x2f63f0, side: 0x152f7a, height: 2.0, prop: 'building_mart' },
            [TILE_TYPES.LAND_TEMPLE]: { top: 0x78421c, side: 0x40230e, height: 2.0, prop: 'temple_land' },
            [TILE_TYPES.SEA_TEMPLE]:  { top: 0x0f5478, side: 0x082e40, height: 2.0, prop: 'temple_sea' },
            [TILE_TYPES.SKY_TEMPLE]:  { top: 0x93701f, side: 0x4d3a0f, height: 2.0, prop: 'temple_sky' },
            [TILE_TYPES.PATH]:        { top: 0xc8a76b, side: 0x8a6a3f, height: 1.5 },
            [TILE_TYPES.SWAMP]:       { top: 0x4a5f43, side: 0x2d3a29, height: 1.2 },
            [TILE_TYPES.BEACH]:       { top: 0xf0dcae, side: 0xb59a68, height: 1.7 },
            [TILE_TYPES.FLOWER]:      { top: 0x7fc25f, side: 0x4a7a38, height: 2.0, prop: 'bush' },
            [TILE_TYPES.CAVE]:        { top: 0x4a4a55, side: 0x24242c, height: 4.2 },
            [TILE_TYPES.RUINS]:       { top: 0xa39b86, side: 0x6b6350, height: 2.4 },
            [TILE_TYPES.ICE_FIELD]:   { top: 0xbfe4f5, side: 0x7fb0c8, height: 1.0 },
            [TILE_TYPES.WASTELAND]:   { top: 0xa08a6a, side: 0x5e4f3a, height: 1.8 },
            [TILE_TYPES.BAMBOO]:      { top: 0x4a7a3f, side: 0x28461f, height: 2.2, prop: 'tree' },
            [TILE_TYPES.CHERRY]:      { top: 0x8fb86a, side: 0x50713c, height: 2.1, prop: 'tree' }
        };

        /* ==========================================================================
           5-A. 전설의 사원 정보 - 각 사원 타일 위에서 지정된 소환 아이템을 사용해야만
           해당 전설의 포켓몬이 강림하며, 이 방법 외에는 전설의 포켓몬을 만날 수 없다.
           ========================================================================== */
        /* ==========================================================================
           0-C. 지형별 전투 무대 팔레트
           실제 포켓몬 게임은 풀숲·바다·사막·설산·화산에서 싸울 때마다 배경이
           완전히 다르다. 예전엔 어디서 싸우든 같은 초원 무대였는데, 이제는
           서 있는 지형에 맞춰 하늘/지면/능선/언덕 색이 통째로 바뀐다.
           ========================================================================== */
        const BATTLE_BIOME_PALETTE = {
            DEFAULT:  { sky: 0x8fd3ff, ground: 0x79c26a, ridge: 0x3f7f3a, hill: 0x5fa347, label: '초원' },
            TALL_GRASS:{ sky: 0x9ae0ff, ground: 0x5ea94e, ridge: 0x2f6b32, hill: 0x4a8f3f, label: '풀숲' },
            FOREST:   { sky: 0x7fc6a8, ground: 0x2f6b3d, ridge: 0x14532d, hill: 0x256b38, label: '숲' },
            WATER:    { sky: 0x67c8f0, ground: 0x1f7a9c, ridge: 0x0e4f6b, hill: 0x17688a, label: '바다' },
            SAND:     { sky: 0xffe0a3, ground: 0xd9b26a, ridge: 0xa97f3f, hill: 0xc79a55, label: '사막' },
            SNOW:     { sky: 0xd7ecff, ground: 0xe8f2fa, ridge: 0x9db8cc, hill: 0xc3d9e8, label: '설원' },
            VOLCANO:  { sky: 0xff9a6b, ground: 0x4a2320, ridge: 0x7c2d12, hill: 0x9a3412, label: '화산' },
            ROCK:     { sky: 0xc9d4e0, ground: 0x6b7280, ridge: 0x3f4854, hill: 0x556070, label: '암반' },
            TOWN:     { sky: 0x9fd8ff, ground: 0x9aa87f, ridge: 0x5a7048, hill: 0x77925c, label: '마을' },
            SWAMP:    { sky: 0x9dbfa0, ground: 0x4a5f43, ridge: 0x2d4029, hill: 0x3c5236, label: '늪지' },
            BEACH:    { sky: 0xbfe9ff, ground: 0xf0dcae, ridge: 0x2f8fd0, hill: 0xd9bf86, label: '해변' },
            FLOWER:   { sky: 0xffe0ee, ground: 0x7fc25f, ridge: 0x4a7a38, hill: 0x9ad97a, label: '꽃밭' },
            CAVE:     { sky: 0x2a2a34, ground: 0x4a4a55, ridge: 0x1c1c24, hill: 0x33333e, label: '동굴' },
            RUINS:    { sky: 0xd8cfae, ground: 0xa39b86, ridge: 0x7d765f, hill: 0x8f886f, label: '유적' },
            ICE_FIELD:{ sky: 0xdff2ff, ground: 0xbfe4f5, ridge: 0x7fb0c8, hill: 0xa5d4e8, label: '빙판' },
            WASTELAND:{ sky: 0xe8cfa0, ground: 0xa08a6a, ridge: 0x5e4f3a, hill: 0x7d6a4f, label: '황무지' },
            BAMBOO:   { sky: 0xc8f0d0, ground: 0x4a7a3f, ridge: 0x28461f, hill: 0x3a6330, label: '대숲' },
            CHERRY:   { sky: 0xffe6f0, ground: 0x8fb86a, ridge: 0xf28fb0, hill: 0xffc2d6, label: '벚꽃숲' }
        };

        const LEGEND_TEMPLE_INFO = {
            13: { orbId: 'orb_red', legendId: 383, templeName: '대지의 사원' },
            14: { orbId: 'orb_blue', legendId: 382, templeName: '바다의 사원' },
            15: { orbId: 'orb_sky', legendId: 384, templeName: '하늘의 사원' }
        };
        // 그란돈/가이오가/레쿠쟈는 사원 의식으로만 만날 수 있는 "상자 전설"이라, 다른
        // 전설/환상 포켓몬처럼 낮은 확률로라도 야생에 등장해버리면 사원 시스템의 특별함이
        // 옅어진다. checkTileTrigger()의 전설급 야생 조우 후보에서 이 셋만 제외하는 데 쓴다.
        const TEMPLE_LEGEND_IDS = new Set(Object.values(LEGEND_TEMPLE_INFO).map(t => t.legendId));

        /* 시작 마을(오닉스 역전가) 하나뿐이던 지도에 지역 마을 4곳을 추가로 배치한다.
           각 마을은 각 지형대(숲/설원/사막/화산) 한가운데에 자리하며, 마을 타일
           블록(rMin~rMax, cMin~cMax) 안에 포켓몬센터/체육관/상점 타일을 하나씩
           품는다. initWorldMap()의 지형 생성과 carveRoadNetwork()의 도로 연결 양쪽에서
           공유해서 쓴다. */
        /* 지역 마을 - 맵이 4배로 넓어지면서 3곳(해안/고원/호반)이 새로 추가되어
           시작 마을을 포함해 총 8개 마을 · 8개 체육관이 되었다. */
        const EXTRA_TOWN_SITES = [
            { name: '녹슨숲 거주구', rMin: 256, rMax: 273, cMin: 256, cMax: 273, center: [258, 270], gym: [271, 258], mart: [264, 264] },
            { name: '폐항구 선착장', rMin: 300, rMax: 317, cMin: 540, cMax: 557, center: [302, 554], gym: [315, 542], mart: [308, 548] },
            { name: '동결 공업단지', rMin: 108, rMax: 125, cMin: 508, cMax: 525, center: [110, 522], gym: [123, 510], mart: [116, 516] },
            { name: '모래무덤 채굴장', rMin: 496, rMax: 513, cMin: 60, cMax: 77, center: [498, 74], gym: [511, 62], mart: [504, 68] },
            { name: '절벽 슬럼가', rMin: 340, rMax: 357, cMin: 100, cMax: 117, center: [342, 114], gym: [355, 102], mart: [348, 108] },
            { name: '용광로 지구', rMin: 496, rMax: 513, cMin: 496, cMax: 513, center: [498, 510], gym: [511, 498], mart: [504, 504] },
            { name: '오염호수 연구특구', rMin: 190, rMax: 207, cMin: 430, cMax: 447, center: [192, 444], gym: [205, 432], mart: [198, 438] }
        ];

        /* ==========================================================================
           4-A. 지역 체육관 관장 데이터베이스 (버그 수정 겸 콘텐츠 완성)
           - 문제: 지도에는 5개 마을에 체육관(GYM) 타일이 각각 하나씩 있었지만, 실제로는
             어느 체육관을 가든 challengeGym()이 항상 POKEMON_DATABASE에서 isBoss로
             표시된 단 하나의 종(메타그로스)만 불러와 똑같은 전투가 반복됐다. 게다가
             재도전할 때마다 뱃지/골드가 무한정 쌓여, HUD의 "뱃지 X/8" 표시가 애초에
             달성 불가능한 목표였다(체육관 자체가 5곳뿐이었음).
           - 수정: 마을 5곳에 지형 테마와 어울리는 고유 관장·뱃지 이름을 부여하고,
             player.defeatedGyms(Set)로 마을별 최초 격파 여부를 추적해 뱃지·상금은
             해당 체육관을 처음 이길 때 딱 한 번만 지급한다(재도전은 소액 상금만).
             또한 관장이 포켓몬 한 마리만 데리고 나오던 것을 team 배열로 2~3마리를
             순서대로 내보내는 진짜 "트레이너전" 구조로 확장했다(마지막이 에이스).
           ========================================================================== */
        /* [밸런스 개편] 실제 게임처럼 체육관은 정해진 순서대로만 도전할 수 있고,
           관장의 포켓몬은 도전자 레벨을 따라오지 않는 "고정 레벨"이다. 예전에는
           어느 체육관이든 아무 때나 갈 수 있었고 관장 레벨이 내 선두 포켓몬 +4로
           따라붙어서, 레벨을 올릴수록 관장도 같이 세지는 이상한 구조였다.
           order: 도전 순서(1부터) / levels: 내보내는 포켓몬들의 고정 레벨 / prize: 최초 격파 상금 */
        const GYM_LEADERS = {
            '오닉스 역전가': { order: 1, leaderName: '리키', badgeName: '초심 뱃지',   team: [22, 376],        levels: [10, 12], prize: 1200 },
            '녹슨숲 거주구': { order: 2, leaderName: '이든', badgeName: '삼림 뱃지',   team: [12, 15, 254],    levels: [15, 16, 18], prize: 1600 },
            '폐항구 선착장': { order: 3, leaderName: '미르', badgeName: '해류 뱃지',   team: [119, 121, 130],  levels: [21, 22, 24], prize: 2000 },
            '동결 공업단지': { order: 4, leaderName: '유나', badgeName: '빙설 뱃지',   team: [221, 91, 131],   levels: [27, 28, 30], prize: 2400 },
            '모래무덤 채굴장': { order: 5, leaderName: '카일', badgeName: '황사 뱃지',   team: [112, 89, 34],    levels: [33, 34, 36], prize: 2800 },
            '절벽 슬럼가': { order: 6, leaderName: '바위', badgeName: '암석 뱃지',   team: [95, 208, 306],   levels: [39, 40, 42], prize: 3200 },
            '용광로 지구': { order: 7, leaderName: '레온', badgeName: '작열 뱃지',   team: [38, 257, 146],   levels: [45, 46, 48], prize: 3600 },
            '오염호수 연구특구': { order: 8, leaderName: '세린', badgeName: '용린 뱃지',   team: [65, 373, 149],   levels: [51, 52, 54], prize: 4000 }
        };
        const GYM_COUNT = Object.keys(GYM_LEADERS).length;

        /* ==========================================================================
           4-D. 지역별 야생 레벨대
           예전에는 야생 포켓몬의 레벨이 "내 선두 포켓몬 ±15"라서, 시작 마을 앞
           풀숲에서도 레벨 60짜리가 튀어나오고 마지막 지역에서도 내가 약하면 약한
           놈만 나왔다. 즉 지도를 아무리 넓혀도 "어디를 가든 똑같은 난이도"였다.
           이제는 실제 게임처럼 지역마다 정해진 레벨대가 있다.

             · 각 마을의 레벨대는 그 마을 체육관 레벨에 맞춰 잡는다
               (오닉스 역전가 체육관이 Lv.10이면 그 주변 야생은 Lv.3~7)
             · 어느 마을에도 속하지 않는 야지는 가장 가까운 마을의 레벨대를 따르되,
               마을에서 멀어질수록 조금씩 높아진다 (변방일수록 위험)
             · 지도 한가운데의 미개척지는 어느 마을에서도 멀기 때문에 자연히
               가장 높은 레벨대가 된다
           ========================================================================== */
        const REGION_BANDS = [
            { name: '오닉스 역전가',   r: 12,  c: 12,  min: 3,  max: 7 },
            { name: '녹슨숲 거주구',   r: 264, c: 264, min: 9,  max: 14 },
            { name: '폐항구 선착장',   r: 308, c: 548, min: 15, max: 20 },
            { name: '동결 공업단지',   r: 116, c: 516, min: 21, max: 26 },
            { name: '모래무덤 채굴장',   r: 504, c: 68,  min: 27, max: 32 },
            { name: '절벽 슬럼가',   r: 348, c: 108, min: 33, max: 38 },
            { name: '용광로 지구',   r: 504, c: 504, min: 39, max: 44 },
            { name: '오염호수 연구특구',   r: 198, c: 438, min: 45, max: 50 }
        ];

        /* 마을 코앞(이 반경 안)은 레벨 보정이 전혀 없는 "안전 지대"다. 여기서부터
           멀어질수록 FRONTIER_STEP칸마다 1레벨씩 올라가되, 그 지역 상한 +10까지만
           오른다. 완전히 새로운 지역에 들어서기 전까지는 감당할 수 있는 폭이다. */
        const REGION_SAFE_RADIUS = 45;
        const REGION_FRONTIER_STEP = 40;
        const REGION_FRONTIER_CAP = 6;

        /* 좌표가 속한 지역과 그 지역의 야생 레벨대를 돌려준다. */
        function getRegionAt(col, row) {
            let best = REGION_BANDS[0];
            let bestDist = Infinity;
            for (const band of REGION_BANDS) {
                const d = Math.hypot(col - band.c, row - band.r);
                if (d < bestDist) { bestDist = d; best = band; }
            }
            const frontier = Math.min(
                REGION_FRONTIER_CAP,
                Math.floor(Math.max(0, bestDist - REGION_SAFE_RADIUS) / REGION_FRONTIER_STEP)
            );
            return {
                name: best.name,
                distance: Math.round(bestDist),
                frontier,
                min: best.min + frontier,
                max: best.max + frontier
            };
        }

        /* 이번 조우에 쓸 야생 레벨을 지역 레벨대 안에서 뽑는다. */
        function rollWildLevel(col, row) {
            const region = getRegionAt(col, row);
            const span = region.max - region.min;
            return Math.max(1, region.min + Math.floor(Math.random() * (span + 1)));
        }

        /* ==========================================================================
           4-C. 필드 NPC - 트레이너와 마을 주민
           예전에는 이 세계에 플레이어 혼자뿐이라, 넓은 지도를 걸어도 마주치는 것이
           야생 포켓몬밖에 없었다. 실제 게임처럼 길목마다 트레이너가 서서 시야에
           들어오면 승부를 걸어오고, 마을에는 말을 걸 수 있는 주민이 산다.
           ========================================================================== */
        const NPC_TRAINER_CLASSES = [
            { title: '꼬마',     names: ['민호', '지우', '수아', '하준'],   body: '#f59e0b', trim: '#b45309', cap: '#dc2626', taunt: '나랑 포켓몬 승부하자!', lose: '우와, 엄청 세다...' },
            { title: '단거리주자', names: ['태양', '한별', '도윤'],         body: '#3b82f6', trim: '#1d4ed8', cap: '#f8fafc', taunt: '스피드에는 자신 있어!', lose: '따라잡지 못했어...' },
            { title: '등산가',   names: ['강산', '우진', '바위'],           body: '#a16207', trim: '#713f12', cap: '#78350f', taunt: '산을 넘으려면 나를 이겨야 해!', lose: '자네, 제법이군!' },
            { title: '낚시꾼',   names: ['바다', '해성', '물결'],           body: '#0891b2', trim: '#155e75', cap: '#facc15', taunt: '입질이 왔다... 승부다!', lose: '오늘은 내가 놓쳤군.' },
            { title: '캠핑객',   names: ['나무', '숲이', '초원'],           body: '#16a34a', trim: '#15803d', cap: '#65a30d', taunt: '여행자라면 한 판 붙어야지!', lose: '좋은 여행 되길!' },
            { title: '연구원',   names: ['서연', '지호', '유나'],           body: '#f1f5f9', trim: '#94a3b8', cap: '#64748b', taunt: '데이터를 수집하겠습니다. 실전으로요!', lose: '귀중한 데이터네요...' },
            { title: '괴짜',     names: ['기묘', '수상', '비밀'],           body: '#7c3aed', trim: '#5b21b6', cap: '#a855f7', taunt: '후후... 내 포켓몬을 보여주지!', lose: '이럴 리가 없는데!' }
        ];

        const VILLAGER_KINDS = [
            { title: '마을 주민', body: '#e2e8f0', trim: '#94a3b8', cap: '#cbd5e1' },
            { title: '할머니',   body: '#fbcfe8', trim: '#db2777', cap: '#f9a8d4' },
            { title: '상인',     body: '#fde68a', trim: '#b45309', cap: '#f59e0b' },
            { title: '소년',     body: '#93c5fd', trim: '#1d4ed8', cap: '#ef4444' }
        ];

        /* 주민 대사 - 게임 시스템 힌트와 세계관 이야기를 섞는다 */
        const VILLAGER_LINES = [
            ['수풀에 들어가면 야생 포켓몬이 튀어나온단다.', '길 위에서는 포켓몬이 나오지 않으니, 서두를 땐 길을 따라가렴.'],
            ['체육관은 정해진 순서대로만 도전할 수 있어.', '앞 체육관을 이겨야 다음 관장이 상대해준다더군.'],
            ['포켓몬센터에서는 [H]키로 파티를 전부 회복할 수 있어요.', '기절한 포켓몬도 말끔히 낫는답니다.'],
            ['밤이 되면 반딧불이가 날아다녀요.', '시간대마다 풍경이 달라지니 한 번 밤에도 나가보세요.'],
            ['아주 드물게 색이 다른 포켓몬이 있대.', '평생 한 번 볼까 말까 한 거라던데... 부럽다!'],
            ['레벨이 오르면 새로운 기술을 배운단다.', '기술이 네 개 다 차 있으면 뭘 잊을지 골라야 해.'],
            ['전설의 사원 세 곳을 아나요?', '화산, 바다, 설산 깊은 곳에 있대요. 성물이 있어야 문이 열린다더군요.'],
            ['파티가 꽉 차면 잡은 포켓몬은 보관함으로 가요.', '[B]키로 보관함을 열어 언제든 데려올 수 있어요.'],
            ['우리 마을이 예쁘죠? 밤에는 가로등이 켜진답니다.'],
            ['여행 기록은 [R]키로 볼 수 있어요.', '업적도 모으는 재미가 있죠.'],
            ['포켓몬은 성격에 따라 잘 자라는 능력이 달라.', '정보 화면에서 ▲▼ 표시를 보면 알 수 있단다.'],
            ['트레이너와 눈이 마주치면 반드시 승부해야 해!', '도망칠 수 없으니 회복약은 넉넉히 챙기렴.']
        ];

        const GIFT_VILLAGER_LINES = [
            ['여행자구나! 이걸 가져가렴.', '길에서 도움이 될 거야.'],
            ['우리 가게 홍보 좀 부탁해요. 이건 선물이에요!'],
            ['젊은 트레이너에게 주는 응원 선물이란다.']
        ];

        /* ==========================================================================
           4-B. 포스트게임 챔피언전 (닌텐도급 업그레이드로 신규 추가)
           - 5개 뱃지를 전부 모은 뒤 시작 마을(오닉스 역전가) 체육관으로 돌아오면 평범한
             관장 리키 대신, 게임 최강급 포켓몬 5마리로 무장한 챔피언이 기다린다.
             (뮤츠/프리져/썬더는 이제 POKEMON_DATABASE에서 isLegend:true로 플래그되어
             있어, 이 팀에 등장하면 sendNextTrainerPokemon이 매번 새로 호출하는
             configureBattleStage3D가 그 순간부터 보스(빨강/진홍) 톤 대신 전설급
             (금빛) 하늘/능선/오라 연출로 자동 전환된다 - 챔피언전 후반으로 갈수록
             연출이 한층 더 격상되는 효과라 의도적으로 그대로 둔다. 사원 의식
             시스템과는 겹치지 않는다 - 이 셋은 사원이 없어 애초에 그쪽 소환
             경로가 없고, 일반 야생 등장도 매우 낮은 확률로만 가능하다.)
           ========================================================================== */
        const CHAMPION_DATA = {
            leaderName: '세라',
            badgeName: '챔피언 트로피',
            team: [350, 143, 144, 145, 150], // 밀로틱 → 잠만보 → 프리져 → 썬더 → 뮤츠(에이스)
            levels: [58, 60, 60, 60, 62],
            prize: 8000
        };

        const STATUS_EFFECTS = {
            NONE: '정상',
            PARALYSIS: '마비',
            POISON: '독',
            BURN: '화상',
            SLEEP: '수면',
            ATTRACT: '매혹',
            CONFUSION: '혼란',
            FREEZE: '냉동'
        };

        /* ==========================================================================
           5-B. 공식 스탯 랭크(-6 ~ +6) 배율 테이블
           실제 게임처럼 "능력변화"는 고정 수치(+10)가 아니라 랭크당 배율로 적용된다.
           랭크가 양수면 (2+n)/2, 음수면 2/(2-n) — 포켓몬 본가와 동일한 공식.
           ========================================================================== */
        function getStatStageMultiplier(stage) {
            const s = Math.max(-6, Math.min(6, stage || 0));
            return s >= 0 ? (2 + s) / 2 : 2 / (2 - s);
        }

        function makeEmptyStatStages() {
            return { atk: 0, def: 0, spAtk: 0, spDef: 0, spe: 0 };
        }

        /* ==========================================================================
           5-C. 특성(어빌리티) 데이터베이스
           실제 포켓몬 226마리+ 전종에 대해 하나씩 수동 지정하는 대신,
           타입별 대표 특성을 기본값으로 자동 배정하고, 잘 알려진 개체(스타팅/전설/의사전설)만
           실제 게임과 동일한 특성으로 덮어쓴다. 아래 EFFECT들은 실제 배틀 로직에 반영된다.
           ========================================================================== */
        const ABILITY_DATABASE = {
            BLAZE:        { name: '불꽃의힘',   desc: 'HP가 1/3 이하일 때 불꽃 기술의 위력이 1.5배가 된다.' },
            TORRENT:      { name: '급류',       desc: 'HP가 1/3 이하일 때 물 기술의 위력이 1.5배가 된다.' },
            OVERGROW:     { name: '심록',       desc: 'HP가 1/3 이하일 때 풀 기술의 위력이 1.5배가 된다.' },
            SWARM:        { name: '벌레의알림', desc: 'HP가 1/3 이하일 때 벌레 기술의 위력이 1.5배가 된다.' },
            INTIMIDATE:   { name: '위협',       desc: '전투에 나설 때 상대의 공격 랭크를 1단계 떨어뜨린다.' },
            STURDY:       { name: '옹골참',     desc: 'HP가 가득 찬 상태에서는 한 방에 쓰러지는 공격을 HP 1로 버틴다.' },
            LEVITATE:     { name: '부유',       desc: '땅 타입 기술을 맞지 않는다.' },
            STATIC:       { name: '정전기',     desc: '접촉 기술에 맞으면 30% 확률로 상대를 마비시킨다.' },
            FLAME_BODY:   { name: '불꽃몸',     desc: '접촉 기술에 맞으면 30% 확률로 상대를 화상 입힌다.' },
            POISON_POINT: { name: '독가시',     desc: '접촉 기술에 맞으면 30% 확률로 상대를 독 상태로 만든다.' },
            GUTS:         { name: '근성',       desc: '상태 이상에 걸려 있으면 공격이 1.5배가 된다.' },
            SPEED_BOOST:  { name: '가속',       desc: '매 턴이 끝날 때마다 스피드가 1단계 상승한다.' },
            MULTISCALE:   { name: '이중비늘',   desc: 'HP가 가득 찬 상태에서 받는 데미지가 절반으로 줄어든다.' },
            ICE_BODY:     { name: '아이스바디', desc: '눈 날씨에서 매 턴 최대 HP의 1/16을 회복한다.' },
            SAND_VEIL:    { name: '모래숨기',   desc: '모래바람 날씨에서 모래에 몸을 숨겨 모래바람 데미지를 받지 않는다.' },
            DROUGHT:      { name: '가뭄',       desc: '전투에 나설 때 날씨를 쾌청으로 바꾼다.' },
            DRIZZLE:      { name: '잔물결',     desc: '전투에 나설 때 날씨를 비로 바꾼다.' },
            SAND_STREAM:  { name: '모래날림',   desc: '전투에 나설 때 날씨를 모래바람으로 바꾼다.' },
            AIR_LOCK:     { name: '에어록',     desc: '필드에 있는 동안 날씨의 효과가 사라진다.' },
            PRESSURE:     { name: '프레셔',     desc: '상대에게 위압감을 준다. (연출용)' },
            KEEN_EYE:     { name: '날카로운눈', desc: '명중률이 떨어지지 않는다. (연출용)' },
            RUN_AWAY:     { name: '겁쟁이',     desc: '야생 배틀에서 반드시 도망칠 수 있다. (연출용)' }
        };

        // 타입별 기본(대표) 특성 - 종별로 일일이 지정하지 않은 나머지 포켓몬에게 부여되는 합리적 기본값
        const TYPE_DEFAULT_ABILITY = {
            '노말': 'RUN_AWAY', '불꽃': 'BLAZE', '물': 'TORRENT', '풀': 'OVERGROW',
            '전기': 'STATIC', '땅': 'SAND_VEIL', '비행': 'KEEN_EYE', '드래곤': 'MULTISCALE',
            '강철': 'STURDY', '얼음': 'ICE_BODY', '악': 'INTIMIDATE', '페어리': 'PRESSURE',
            '격투': 'GUTS', '독': 'POISON_POINT', '에스퍼': 'PRESSURE', '벌레': 'SWARM',
            '고스트': 'LEVITATE', '바위': 'STURDY'
        };

        // 잘 알려진 개체(전설/의사전설/스타팅 최종진화)는 실제 게임과 동일한 특성으로 덮어쓴다
        const SPECIES_ABILITY_OVERRIDES = {
            382: 'DRIZZLE',    // 가이오가
            383: 'DROUGHT',    // 그란돈
            384: 'AIR_LOCK',   // 레쿠쟈
            249: 'MULTISCALE', // 루기아
            250: 'PRESSURE',   // 칠색조
            483: 'PRESSURE',   // 디아루가
            484: 'PRESSURE',   // 펄기아
            487: 'PRESSURE',   // 기라티나
            373: 'INTIMIDATE', // 보만다
            130: 'INTIMIDATE', // 갸라도스
            306: 'STURDY'      // 보스로라
        };

        function getAbilityForSpecies(dbData) {
            if (SPECIES_ABILITY_OVERRIDES[dbData.id]) return SPECIES_ABILITY_OVERRIDES[dbData.id];
            return TYPE_DEFAULT_ABILITY[dbData.type1] || 'PRESSURE';
        }

        /* ==========================================================================
           5-D. 기술 PP(포인트) 계산 - 위력이 강할수록 PP가 적다 (실제 게임과 동일한 경향)
           ========================================================================== */
        function computeMaxPP(move) {
            if (!move.power || move.power === 0) return 20;
            if (move.power <= 50) return 35;
            if (move.power <= 80) return 20;
            if (move.power <= 110) return 15;
            return 10;
        }

        // 물리 카테고리 기술 중 실제로는 "접촉"하지 않는 예외 목록 (지진/스톤에지류 등)
        const NON_CONTACT_PHYSICAL = new Set(['지진', '스톤샤워', '바위던지기', '단애의칼', '스톤에지']);

        /* ==========================================================================
           6-A. 마음의 엠블럼(GEM) 데이터베이스 - 스킬 커스텀 & 융합 시스템
           스킬에 젬을 장착하면 특수 부가 효과가 발동합니다.
           예: 10만볼트 + 핑크 하트 젬 = 사용 시 일정 확률로 적을 매혹 상태로 만든다.
           ========================================================================== */
        const GEM_DATABASE = {
            PINK_HEART: { name: '핑크 하트 젬', icon: '💗', color: '#ff5d90', effect: 'ATTRACT', chance: 0.3, price: 1500,
                desc: '기술 적중 시 30% 확률로 상대를 매혹 상태로 만든다.' },
            BLOOD_RUBY: { name: '블러드 루비 젬', icon: '🔴', color: '#ef4444', effect: 'RECOIL_BOOST', powerMult: 1.15, recoil: 0.1, price: 2000,
                desc: '기술의 위력이 15% 상승하지만, 데미지의 10%만큼 반동을 입는다.' },
            FROST_OPAL: { name: '프로스트 오팔 젬', icon: '💠', color: '#38bdf8', effect: 'SPEED_DOWN', chance: 0.3, price: 1500,
                desc: '기술 적중 시 30% 확률로 상대의 스피드를 떨어뜨린다.' },
            GOLDEN_TOPAZ: { name: '골든 토파즈 젬', icon: '🟡', color: '#f59e0b', effect: 'CRIT_UP', price: 1800,
                desc: '이 기술을 사용할 때 급소에 맞을 확률이 대폭 상승한다.' },
            SHADOW_ONYX: { name: '섀도우 오닉스 젬', icon: '⚫', color: '#6b21a8', effect: 'FLINCH', chance: 0.25, price: 1800,
                desc: '기술 적중 시 25% 확률로 상대를 풀죽게(행동불능 1턴) 만든다.' },
            EMERALD_LEAF: { name: '에메랄드 리프 젬', icon: '🟢', color: '#10b981', effect: 'DRAIN', ratio: 0.3, price: 2200,
                desc: '입힌 데미지의 30%만큼 자신의 체력을 회복한다.' },
            STORM_SAPPHIRE: { name: '스톰 사파이어 젬', icon: '🔵', color: '#2563eb', effect: 'PARALYZE', chance: 0.25, price: 1500,
                desc: '기술 적중 시 25% 확률로 상대를 마비 상태로 만든다.' },

            /* [확장] 야생 포켓몬을 잡으면 떨어지는 젬들. 상대 타입에 어울리는 종류가
               나오도록 되어 있어서, 특정 젬이 필요하면 그 타입을 사냥하러 가면 된다. */
            FLAME_GARNET: { name: '플레임 가넷 젬', icon: '🔥', color: '#f97316', effect: 'BURN', chance: 0.3, price: 1600,
                desc: '기술 적중 시 30% 확률로 상대를 화상 상태로 만든다.' },
            TOXIC_AMETHYST: { name: '톡신 아메시스트 젬', icon: '🟣', color: '#a855f7', effect: 'POISON', chance: 0.3, price: 1600,
                desc: '기술 적중 시 30% 확률로 상대를 독 상태로 만든다.' },
            GLACIER_DIAMOND: { name: '글레이셔 다이아 젬', icon: '❄️', color: '#7dd3fc', effect: 'FREEZE', chance: 0.12, price: 2400,
                desc: '기술 적중 시 12% 확률로 상대를 얼려버린다. 확률은 낮지만 효과는 절대적이다.' },
            DREAM_PEARL: { name: '드림 펄 젬', icon: '🌙', color: '#c4b5fd', effect: 'SLEEP', chance: 0.18, price: 2200,
                desc: '기술 적중 시 18% 확률로 상대를 잠재운다.' },
            CHAOS_ALEX: { name: '카오스 알렉산드라이트 젬', icon: '🌀', color: '#ec4899', effect: 'CONFUSE', chance: 0.25, price: 1900,
                desc: '기술 적중 시 25% 확률로 상대를 혼란에 빠뜨린다.' },
            CRACK_JASPER: { name: '크랙 재스퍼 젬', icon: '🟤', color: '#b45309', effect: 'DEF_DOWN', chance: 0.35, price: 1700,
                desc: '기술 적중 시 35% 확률로 상대의 방어를 떨어뜨린다.' },
            PRISM_CORE: { name: '프리즘 코어 젬', icon: '💎', color: '#22d3ee', effect: 'POWER_UP', powerMult: 1.25, price: 3200,
                desc: '기술의 위력이 25% 상승한다. 반동도 부작용도 없는 최상급 젬.' }
        };

        /* 야생 포켓몬을 잡았을 때 어떤 젬이 나올지 - 상대 타입으로 결정한다.
           목록에 없는 타입은 공용 후보에서 뽑는다. */
        const GEM_DROP_BY_TYPE = {
            '불꽃': ['FLAME_GARNET', 'BLOOD_RUBY'],
            '물': ['FROST_OPAL', 'STORM_SAPPHIRE'],
            '얼음': ['GLACIER_DIAMOND', 'FROST_OPAL'],
            '풀': ['EMERALD_LEAF', 'TOXIC_AMETHYST'],
            '전기': ['STORM_SAPPHIRE', 'GOLDEN_TOPAZ'],
            '독': ['TOXIC_AMETHYST', 'SHADOW_ONYX'],
            '벌레': ['TOXIC_AMETHYST', 'EMERALD_LEAF'],
            '고스트': ['SHADOW_ONYX', 'CHAOS_ALEX'],
            '악': ['SHADOW_ONYX', 'BLOOD_RUBY'],
            '에스퍼': ['DREAM_PEARL', 'CHAOS_ALEX'],
            '페어리': ['PINK_HEART', 'DREAM_PEARL'],
            '격투': ['BLOOD_RUBY', 'CRACK_JASPER'],
            '바위': ['CRACK_JASPER', 'GOLDEN_TOPAZ'],
            '땅': ['CRACK_JASPER', 'BLOOD_RUBY'],
            '강철': ['GOLDEN_TOPAZ', 'CRACK_JASPER'],
            '비행': ['FROST_OPAL', 'GOLDEN_TOPAZ'],
            '드래곤': ['PRISM_CORE', 'BLOOD_RUBY'],
            '노말': ['PINK_HEART', 'GOLDEN_TOPAZ', 'EMERALD_LEAF']
        };
        const GEM_DROP_FALLBACK = ['PINK_HEART', 'GOLDEN_TOPAZ', 'EMERALD_LEAF', 'FROST_OPAL'];

        /* 포획 성공 시 젬 드롭 판정.
           희귀한 상대일수록, 레벨이 높을수록 잘 나온다. */
        function rollGemDrop(foe) {
            if (!foe) return null;
            let chance = 0.28;
            if (foe.level >= 30) chance += 0.07;
            if (foe.level >= 50) chance += 0.07;
            if (foe.isRareTier) chance = 0.75;
            if (foe.isLegend) chance = 1.0;
            if (foe.isShiny) chance = Math.min(1, chance + 0.4);
            if (Math.random() >= chance) return null;

            const pool = [];
            [foe.type1, foe.type2].forEach(t => {
                if (t && GEM_DROP_BY_TYPE[t]) pool.push(...GEM_DROP_BY_TYPE[t]);
            });
            const list = pool.length ? pool : GEM_DROP_FALLBACK;
            // 전설·준전설은 최상급 젬이 나올 여지를 따로 준다
            if ((foe.isLegend || foe.isRareTier) && Math.random() < 0.45) return 'PRISM_CORE';
            return list[Math.floor(Math.random() * list.length)];
        }

        const WEATHERS = ['맑음 ☀️', '비 🌧️', '모래바람 🌪️', '눈 ❄️', '쾌청 🔥'];

        /* [타입 상성표 완성] 예전에는 공격 타입 12종만 표에 있어서, 격투·독·에스퍼·
           벌레·고스트·바위 타입 기술은 상대가 누구든 항상 1배(효과 보통)로 계산됐다.
           포켓몬 종류를 대폭 늘리면서 이 여섯 타입의 포켓몬이 크게 늘어났으므로,
           실제 게임과 동일한 18타입 전체 상성표로 채워 넣는다. */
        const TYPE_CHART = {
            '노말':   { '바위': 0.5, '강철': 0.5, '고스트': 0 },
            '불꽃':   { '불꽃': 0.5, '물': 0.5, '풀': 2.0, '얼음': 2.0, '벌레': 2.0, '바위': 0.5, '드래곤': 0.5, '강철': 2.0 },
            '물':     { '불꽃': 2.0, '물': 0.5, '풀': 0.5, '땅': 2.0, '바위': 2.0, '드래곤': 0.5 },
            '풀':     { '불꽃': 0.5, '물': 2.0, '풀': 0.5, '독': 0.5, '땅': 2.0, '비행': 0.5, '벌레': 0.5, '바위': 2.0, '드래곤': 0.5, '강철': 0.5 },
            '전기':   { '물': 2.0, '풀': 0.5, '전기': 0.5, '땅': 0, '비행': 2.0, '드래곤': 0.5 },
            '얼음':   { '풀': 2.0, '땅': 2.0, '비행': 2.0, '드래곤': 2.0, '불꽃': 0.5, '물': 0.5, '얼음': 0.5, '강철': 0.5 },
            '격투':   { '노말': 2.0, '얼음': 2.0, '바위': 2.0, '악': 2.0, '강철': 2.0, '독': 0.5, '비행': 0.5, '에스퍼': 0.5, '벌레': 0.5, '페어리': 0.5, '고스트': 0 },
            '독':     { '풀': 2.0, '페어리': 2.0, '독': 0.5, '땅': 0.5, '바위': 0.5, '고스트': 0.5, '강철': 0 },
            '땅':     { '불꽃': 2.0, '전기': 2.0, '독': 2.0, '바위': 2.0, '강철': 2.0, '풀': 0.5, '벌레': 0.5, '비행': 0 },
            '비행':   { '풀': 2.0, '격투': 2.0, '벌레': 2.0, '전기': 0.5, '바위': 0.5, '강철': 0.5 },
            '에스퍼': { '격투': 2.0, '독': 2.0, '에스퍼': 0.5, '강철': 0.5, '악': 0 },
            '벌레':   { '풀': 2.0, '에스퍼': 2.0, '악': 2.0, '불꽃': 0.5, '격투': 0.5, '독': 0.5, '비행': 0.5, '고스트': 0.5, '강철': 0.5, '페어리': 0.5 },
            '바위':   { '불꽃': 2.0, '얼음': 2.0, '비행': 2.0, '벌레': 2.0, '격투': 0.5, '땅': 0.5, '강철': 0.5 },
            '고스트': { '에스퍼': 2.0, '고스트': 2.0, '악': 0.5, '노말': 0 },
            '드래곤': { '드래곤': 2.0, '강철': 0.5, '페어리': 0 },
            '악':     { '에스퍼': 2.0, '고스트': 2.0, '격투': 0.5, '악': 0.5, '페어리': 0.5 },
            '강철':   { '얼음': 2.0, '바위': 2.0, '페어리': 2.0, '불꽃': 0.5, '물': 0.5, '전기': 0.5, '강철': 0.5 },
            '페어리': { '격투': 2.0, '드래곤': 2.0, '악': 2.0, '불꽃': 0.5, '독': 0.5, '강철': 0.5 }
        };

        /* ==========================================================================
           6-A. 스킬(기술) 타입별 애니메이션 스타일 테이블
           각 포켓몬 타입마다 색상/발광색/투사체 모양을 다르게 지정해서,
           같은 "막치기"라도 노말타입과 불꽃타입이 서로 다른 이펙트로 날아가도록 함.
           ========================================================================== */
        const TYPE_ANIM_STYLES = {
            '노말':   { color: '#d1d5db', glow: '#f8fafc', shape: 'orb' },
            '불꽃':   { color: '#f97316', glow: '#fde68a', shape: 'fire' },
            '물':     { color: '#0ea5e9', glow: '#bae6fd', shape: 'water' },
            '풀':     { color: '#22c55e', glow: '#bbf7d0', shape: 'leaf' },
            '전기':   { color: '#facc15', glow: '#fef9c3', shape: 'bolt' },
            '땅':     { color: '#b45309', glow: '#fde68a', shape: 'rock' },
            '비행':   { color: '#93c5fd', glow: '#eff6ff', shape: 'feather' },
            '드래곤': { color: '#7c3aed', glow: '#ddd6fe', shape: 'orb' },
            '강철':   { color: '#94a3b8', glow: '#f1f5f9', shape: 'rock' },
            '얼음':   { color: '#67e8f9', glow: '#ecfeff', shape: 'ice' },
            '악':     { color: '#4b5563', glow: '#9ca3af', shape: 'orb' },
            '페어리': { color: '#f9a8d4', glow: '#fce7f3', shape: 'orb' },
            '격투':   { color: '#dc2626', glow: '#fecaca', shape: 'fist' },
            '독':     { color: '#a855f7', glow: '#e9d5ff', shape: 'orb' },
            '에스퍼': { color: '#ec4899', glow: '#fbcfe8', shape: 'orb' },
            '벌레':   { color: '#84cc16', glow: '#d9f99d', shape: 'leaf' },
            '고스트': { color: '#6d28d9', glow: '#c4b5fd', shape: 'orb' },
            '바위':   { color: '#78716c', glow: '#d6d3d1', shape: 'rock' }
        };

        /* ==========================================================================
           3-C. 기술별 전용 연출 테이블
           예전에는 "타입"만 보고 이펙트를 골라서, 같은 불꽃 타입이면 불꽃세례든
           화염방사든 성스러운불꽃이든 전부 똑같은 불덩이 하나가 날아갔다. 이제
           기술 하나하나에 고유한 (모션 / 궤적 / 모양 / 색 / 타격 연출)을 지정한다.

             motion : 시전자 포켓몬의 몸동작    (lunge/charge/spin/jump/shake/recoil/rise/stomp/glow)
             path   : 이펙트가 날아가는 방식    (arc/line/beam/zigzag/wave/drop/ground/self/burst)
             shape  : 이펙트 모양               (아래 drawSkillProjectile의 case 목록)
             count  : 연속으로 날아가는 개수
             hit    : 명중 순간의 타격 연출     (impact/blast/shatter/spark/slash/crush/none)
           ========================================================================== */
        const MOVE_FX = {
            // ----- 노말 -----
            '막치기':       { motion: 'lunge',  path: 'line',   shape: 'fist',    hit: 'impact' },
            '몸통박치기':   { motion: 'charge', path: 'line',   shape: 'dash',    hit: 'impact' },
            '할퀴기':       { motion: 'lunge',  path: 'line',   shape: 'claw',    hit: 'slash', count: 3 },
            '전광석화':     { motion: 'charge', path: 'line',   shape: 'streak',  hit: 'impact', duration: 160 },
            '신속':         { motion: 'charge', path: 'line',   shape: 'streak',  hit: 'impact', duration: 130, count: 2 },
            '이판사판태클': { motion: 'recoil', path: 'line',   shape: 'dash',    hit: 'crush' },
            '파괴광선':     { motion: 'glow',   path: 'beam',   shape: 'beam',    hit: 'blast', duration: 620, color: '#fde68a', glow: '#fffbeb' },
            '기가임팩트':   { motion: 'charge', path: 'line',   shape: 'comet',   hit: 'blast', duration: 380, color: '#f0abfc', glow: '#fae8ff' },
            '발버둥':       { motion: 'recoil', path: 'line',   shape: 'dash',    hit: 'impact' },
            '칼춤':         { motion: 'spin',   path: 'self',   shape: 'blades',  hit: 'none', color: '#fbbf24', glow: '#fef3c7' },

            // ----- 불꽃 -----
            '불꽃세례':     { motion: 'shake',  path: 'arc',    shape: 'fire',    hit: 'impact', count: 3, duration: 260 },
            '화염방사':     { motion: 'glow',   path: 'beam',   shape: 'flamejet',hit: 'blast', duration: 560 },
            '불꽃펀치':     { motion: 'lunge',  path: 'line',   shape: 'firefist',hit: 'blast', duration: 200 },
            '플레어드라이브':{ motion: 'recoil', path: 'line',  shape: 'meteor',  hit: 'blast', duration: 300 },
            '성스러운불꽃': { motion: 'rise',   path: 'drop',   shape: 'sacredfire', hit: 'blast', color: '#fbbf24', glow: '#fff7ed' },
            '도깨비불':     { motion: 'shake',  path: 'wave',   shape: 'wisp',    hit: 'spark', count: 3, duration: 460, color: '#60a5fa', glow: '#dbeafe' },

            // ----- 물 -----
            '물대포':       { motion: 'shake',  path: 'line',   shape: 'water',   hit: 'splash', duration: 260 },
            '하이드로펌프': { motion: 'glow',   path: 'beam',   shape: 'torrent', hit: 'splash', duration: 560 },
            '파도타기':     { motion: 'rise',   path: 'ground', shape: 'wavefront', hit: 'splash', duration: 520 },
            '폭포오르기':   { motion: 'jump',   path: 'line',   shape: 'torrent', hit: 'splash', duration: 300 },
            '근원의파동':   { motion: 'glow',   path: 'beam',   shape: 'torrent', hit: 'blast', duration: 620, color: '#38bdf8', glow: '#e0f2fe' },

            // ----- 풀 -----
            '흡수':         { motion: 'shake',  path: 'wave',   shape: 'drain',   hit: 'spark', duration: 420 },
            '기가드레인':   { motion: 'shake',  path: 'wave',   shape: 'drain',   hit: 'spark', count: 3, duration: 460 },
            '리프블레이드': { motion: 'lunge',  path: 'line',   shape: 'slash',   hit: 'slash', count: 2, duration: 200 },
            '잎날가르기':   { motion: 'spin',   path: 'wave',   shape: 'leaf',    hit: 'slash', count: 4, duration: 320 },
            '덩굴채찍':     { motion: 'lunge',  path: 'line',   shape: 'vine',    hit: 'impact', duration: 240 },
            '씨앗폭탄':     { motion: 'shake',  path: 'arc',    shape: 'seed',    hit: 'blast', duration: 380 },
            '에너지볼':     { motion: 'glow',   path: 'line',   shape: 'orb',     hit: 'blast', duration: 340 },
            '솔라빔':       { motion: 'rise',   path: 'beam',   shape: 'solar',   hit: 'blast', duration: 720, color: '#bef264', glow: '#fef9c3' },

            // ----- 전기 -----
            '10만볼트':     { motion: 'shake',  path: 'zigzag', shape: 'bolt',    hit: 'spark', duration: 260 },
            '천둥':         { motion: 'rise',   path: 'drop',   shape: 'lightning', hit: 'spark', duration: 320 },
            '번개펀치':     { motion: 'lunge',  path: 'line',   shape: 'boltfist',hit: 'spark', duration: 200 },
            '전기자석파':   { motion: 'shake',  path: 'zigzag', shape: 'ripple',  hit: 'spark', duration: 380, color: '#facc15', glow: '#fef9c3' },

            // ----- 얼음 -----
            '냉동빔':       { motion: 'glow',   path: 'beam',   shape: 'icebeam', hit: 'shatter', duration: 520 },
            '눈보라':       { motion: 'shake',  path: 'wave',   shape: 'ice',     hit: 'shatter', count: 6, duration: 480 },
            '냉동펀치':     { motion: 'lunge',  path: 'line',   shape: 'icefist', hit: 'shatter', duration: 200 },
            '오로라베일':   { motion: 'rise',   path: 'self',   shape: 'aurora',  hit: 'none', color: '#a5f3fc', glow: '#ecfeff' },

            // ----- 땅/바위/강철 -----
            '지진':         { motion: 'stomp',  path: 'ground', shape: 'quake',   hit: 'crush', duration: 520 },
            '단애의칼':     { motion: 'stomp',  path: 'ground', shape: 'earthblade', hit: 'crush', duration: 520, color: '#f59e0b', glow: '#fef3c7' },
            '스톤샤워':     { motion: 'rise',   path: 'drop',   shape: 'rock',    hit: 'crush', count: 4, duration: 420 },
            '바위던지기':   { motion: 'spin',   path: 'arc',    shape: 'rock',    hit: 'crush', duration: 380 },
            '스톤에지':     { motion: 'stomp',  path: 'burst',  shape: 'spike',   hit: 'crush', duration: 420 },
            '아이언헤드':   { motion: 'charge', path: 'line',   shape: 'steel',   hit: 'crush', duration: 240 },
            '코멧펀치':     { motion: 'lunge',  path: 'line',   shape: 'steelfist', hit: 'blast', duration: 220 },
            '플래시캐논':   { motion: 'glow',   path: 'beam',   shape: 'beam',    hit: 'blast', duration: 480, color: '#cbd5e1', glow: '#f8fafc' },

            // ----- 비행 -----
            '바람일으키기': { motion: 'spin',   path: 'wave',   shape: 'gust',    hit: 'impact', count: 3, duration: 380 },
            '에어슬래시':   { motion: 'spin',   path: 'line',   shape: 'slash',   hit: 'slash', count: 2, duration: 240, color: '#bfdbfe', glow: '#eff6ff' },

            // ----- 격투 -----
            '인파이트':     { motion: 'charge', path: 'line',   shape: 'punch',   hit: 'crush', count: 4, duration: 160 },
            '드레인펀치':   { motion: 'lunge',  path: 'line',   shape: 'punch',   hit: 'impact', duration: 220 },
            '파동탄':       { motion: 'glow',   path: 'line',   shape: 'aura',    hit: 'blast', duration: 380 },

            // ----- 독/악/고스트 -----
            '오물폭탄':     { motion: 'shake',  path: 'arc',    shape: 'sludge',  hit: 'splash', count: 2, duration: 400 },
            '맹독':         { motion: 'shake',  path: 'wave',   shape: 'sludge',  hit: 'splash', duration: 420, color: '#a855f7', glow: '#f3e8ff' },
            '물기':         { motion: 'lunge',  path: 'line',   shape: 'fang',    hit: 'slash', duration: 200 },
            '섀도볼':       { motion: 'glow',   path: 'wave',   shape: 'shadow',  hit: 'blast', duration: 420 },
            '악의파동':     { motion: 'glow',   path: 'beam',   shape: 'darkwave',hit: 'blast', duration: 460 },

            // ----- 에스퍼/페어리 -----
            '사이코키네시스':{ motion: 'rise',  path: 'burst',  shape: 'psywave', hit: 'blast', duration: 520 },
            '문포스':       { motion: 'rise',   path: 'line',   shape: 'moon',    hit: 'blast', duration: 420 },
            '매지컬샤인':   { motion: 'glow',   path: 'burst',  shape: 'sparkle', hit: 'spark', count: 6, duration: 420 },
            '치근거리기':   { motion: 'spin',   path: 'line',   shape: 'heart',   hit: 'impact', count: 3, duration: 260 },

            // ----- 벌레 -----
            '시저크로스':   { motion: 'lunge',  path: 'line',   shape: 'cross',   hit: 'slash', duration: 240 },
            '벌레의야단법석':{ motion: 'shake', path: 'wave',   shape: 'ripple',  hit: 'spark', count: 4, duration: 420, color: '#a3e635', glow: '#ecfccb' },

            // ----- 드래곤 -----
            '용의파동':     { motion: 'glow',   path: 'wave',   shape: 'dragonwave', hit: 'blast', duration: 420 },
            '역린':         { motion: 'charge', path: 'line',   shape: 'dragonclaw', hit: 'crush', count: 3, duration: 180 },
            '용성군':       { motion: 'rise',   path: 'drop',   shape: 'meteor',  hit: 'blast', count: 5, duration: 520, color: '#c4b5fd', glow: '#ede9fe' },
            '화룡점정':     { motion: 'jump',   path: 'line',   shape: 'comet',   hit: 'blast', duration: 340, color: '#86efac', glow: '#dcfce7' },
            '시공절단':     { motion: 'spin',   path: 'burst',  shape: 'rift',    hit: 'slash', duration: 460 }
        };

        function getMoveFx(move) {
            const base = TYPE_ANIM_STYLES[move.type] || TYPE_ANIM_STYLES['노말'];
            const spec = MOVE_FX[move.name] || {};
            return {
                color: spec.color || base.color,
                glow: spec.glow || base.glow,
                shape: spec.shape || base.shape,
                motion: spec.motion || 'lunge',
                path: spec.path || 'arc',
                hit: spec.hit || 'impact',
                count: spec.count || 1,
                duration: spec.duration || 340
            };
        }

        /* [포켓몬스러운 디자인] 실제 포켓덱스/파티창처럼 타입을 색이 있는 알약 모양
           배지로 보여주기 위한 헬퍼. 타입별 색상은 위 TYPE_ANIM_STYLES를 그대로
           재사용해 스킬 이펙트 색상과 UI 배지 색상이 항상 일치하도록 한다. */
        function typeBadgeHtml(type) {
            if (!type) return '';
            const color = (TYPE_ANIM_STYLES[type] || {}).color || '#94a3b8';
            return `<span class="type-badge" style="background:${color};">${type}</span>`;
        }

        /* 배틀 스프라이트 "공중부양" 버그 수정 (2/2) - 발판/그림자 쪽은 CSS 박스
           좌표를 맞춰서 해결했지만, 사용 중인 Pokémon Showdown 스프라이트셋은
           포켓몬마다 투명 여백 비율이 완전히 제각각이다(예: 깨비드릴조는 이미지
           높이의 24%가 빈 여백, 타우로스는 1%뿐). object-fit:contain은 이 여백까지
           통째로 박스에 맞춰버리므로, 여백이 큰 포켓몬은 실제 그림이 박스 바닥(발판
           그림자 위치)보다 한참 위에 떠서 그려진다.
           그래서 이미지가 로드될 때마다 오프스크린 캔버스로 알파 채널을 스캔해 실제
           그림이 어디서 끝나는지(투명 여백 비율)를 한 번 측정하고, 그 비율만큼
           translateY로 아래로 밀어 "그림의 실제 발끝"이 항상 박스 바닥에 오도록
           보정한다. 같은 URL은 재계산하지 않도록 결과를 캐싱한다. */
        const _spriteGroundFixCache = new Map();
        function measureSpriteBottomPadPct(url) {
            if (_spriteGroundFixCache.has(url)) return Promise.resolve(_spriteGroundFixCache.get(url));
            return new Promise((resolve) => {
                const probe = new Image();
                probe.crossOrigin = 'anonymous';
                probe.onload = () => {
                    try {
                        const w = probe.naturalWidth, h = probe.naturalHeight;
                        const cnv = document.createElement('canvas');
                        cnv.width = w; cnv.height = h;
                        const ctx = cnv.getContext('2d');
                        ctx.drawImage(probe, 0, 0);
                        const data = ctx.getImageData(0, 0, w, h).data;
                        let bottomContentRow = -1;
                        for (let y = h - 1; y >= 0 && bottomContentRow < 0; y--) {
                            for (let x = 0; x < w; x++) {
                                if (data[(y * w + x) * 4 + 3] > 10) { bottomContentRow = y; break; }
                            }
                        }
                        const pct = bottomContentRow < 0 ? 0 : (h - 1 - bottomContentRow) / h;
                        _spriteGroundFixCache.set(url, pct);
                        resolve(pct);
                    } catch (e) {
                        // 크로스오리진 캔버스 보안 제약 등으로 측정에 실패해도 배틀 진행에는
                        // 지장이 없도록 보정 없이(0%) 조용히 넘어간다.
                        _spriteGroundFixCache.set(url, 0);
                        resolve(0);
                    }
                };
                probe.onerror = () => { _spriteGroundFixCache.set(url, 0); resolve(0); };
                probe.src = url;
            });
        }
        /* fallbackUrl(선택): 메가진화 스프라이트처럼 별도 CDN(play.pokemonshowdown.com)에
           떠 있어 특정 네트워크 환경에서 막히거나 경로가 어긋날 수 있는 이미지를 쓸 때,
           로드가 실패(onerror)하면 브라우저 기본 "깨진 이미지" 아이콘 + alt 텍스트를
           그대로 노출하는 대신 조용히 기본 스프라이트로 대체한다. */
        /* 포켓몬 그림은 외부에서 받아온다. 인터넷이 없거나 차단된 환경에서는
           전부 깨진 이미지가 되는데, 원인을 모르면 게임이 고장난 줄 알게 되므로
           처음 한 번만 짧게 알려준다. (게임 진행 자체에는 지장이 없다) */
        let _spriteOfflineNotified = false;
        function notifySpriteOffline() {
            if (_spriteOfflineNotified) return;
            _spriteOfflineNotified = true;
            if (typeof showToast === 'function') {
                showToast('🌐 포켓몬 그림을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요 (게임 진행은 가능합니다).');
            }
        }
        function setBattleSpriteSrc(imgEl, url, fallbackUrl) {
            const applyPad = (forUrl) => measureSpriteBottomPadPct(forUrl).then(pct => {
                // 응답이 늦게 도착했을 때 이미 다른 포켓몬으로 교체된 스프라이트에
                // 잘못 적용되지 않도록 src가 여전히 같은 이미지인지 확인 후 적용한다.
                if (imgEl.src === forUrl || imgEl.src.endsWith(forUrl)) {
                    imgEl.style.setProperty('--pad-fix', (pct * 100).toFixed(2) + '%');
                }
            });
            imgEl.style.setProperty('--pad-fix', '0%');
            imgEl.onerror = () => {
                imgEl.onerror = null;
                if (fallbackUrl) { imgEl.src = fallbackUrl; applyPad(fallbackUrl); }
                else notifySpriteOffline();
            };
            imgEl.src = url;
            applyPad(url);
        }

        const NATURES = [
            { name: '고집', atkMod: 1.1, defMod: 1.0, spAtkMod: 0.9, spDefMod: 1.0, speMod: 1.0 },
            { name: '겁쟁이', atkMod: 0.9, defMod: 1.0, spAtkMod: 1.0, spDefMod: 1.0, speMod: 1.1 },
            { name: '조심', atkMod: 0.9, defMod: 1.0, spAtkMod: 1.1, spDefMod: 1.0, speMod: 1.0 },
            { name: '장난꾸러기', atkMod: 1.0, defMod: 1.1, spAtkMod: 0.9, spDefMod: 1.0, speMod: 1.0 },
            { name: '명랑', atkMod: 1.0, defMod: 1.0, spAtkMod: 0.9, spDefMod: 1.0, speMod: 1.1 },
            { name: '솔직', atkMod: 1.0, defMod: 1.0, spAtkMod: 1.0, spDefMod: 1.0, speMod: 1.0 }
        ];

        /* ==========================================================================
           6. SKILL & MOVE DATABASE
           ========================================================================== */
        /* 아래 category(물리/특수/변화)·priority(우선도, 기본 0)는 실제 포켓몬 본가 데이터를
           기준으로 부여했다. 물리 기술은 공격/방어, 특수 기술은 특공/특방 스탯으로 데미지를
           계산하며, 우선도가 높은 기술은 스피드와 무관하게 먼저 발동한다. */
        const SKILL_DATABASE = {
            POUND: { name: '막치기', power: 40, type: '노말', accuracy: 100, category: '물리' },
            ABSORB: { name: '흡수', power: 40, type: '풀', accuracy: 100, drain: 0.4, category: '특수' },
            LEAF_BLADE: { name: '리프블레이드', power: 90, type: '풀', accuracy: 100, category: '물리' },
            DRAGON_PULSE: { name: '용의파동', power: 85, type: '드래곤', accuracy: 100, category: '특수' },
            TACKLE: { name: '몸통박치기', power: 45, type: '노말', accuracy: 100, category: '물리' },
            SCRATCH: { name: '할퀴기', power: 40, type: '노말', accuracy: 100, category: '물리' },
            WATER_GUN: { name: '물대포', power: 40, type: '물', accuracy: 100, category: '특수' },
            EMBER: { name: '불꽃세례', power: 40, type: '불꽃', accuracy: 100, status: STATUS_EFFECTS.BURN, statusChance: 0.2, category: '특수' },
            FLAMETHROWER: { name: '화염방사', power: 90, type: '불꽃', accuracy: 100, status: STATUS_EFFECTS.BURN, statusChance: 0.1, category: '특수' },
            HYDRO_PUMP: { name: '하이드로펌프', power: 110, type: '물', accuracy: 85, category: '특수' },
            THUNDER_BOLT: { name: '10만볼트', power: 90, type: '전기', accuracy: 100, status: STATUS_EFFECTS.PARALYSIS, statusChance: 0.1, category: '특수' },
            METEOR_MASH: { name: '코멧펀치', power: 90, type: '강철', accuracy: 90, statBoost: { stat: 'atk', stages: 1 }, category: '물리' },
            HYPER_BEAM: { name: '파괴광선', power: 150, type: '노말', accuracy: 90, category: '특수' },
            PRECIPICE_BLADES: { name: '단애의칼', power: 120, type: '땅', accuracy: 85, category: '물리' },
            ORIGIN_PULSE: { name: '근원의파동', power: 110, type: '물', accuracy: 85, category: '특수' },
            DRAGON_ASCENT: { name: '화룡점정', power: 120, type: '드래곤', accuracy: 100, category: '물리' },
            EARTHQUAKE: { name: '지진', power: 100, type: '땅', accuracy: 100, category: '물리' },
            ICE_BEAM: { name: '냉동빔', power: 90, type: '얼음', accuracy: 100, status: STATUS_EFFECTS.FREEZE, statusChance: 0.1, category: '특수' },
            BLIZZARD: { name: '눈보라', power: 110, type: '얼음', accuracy: 70, status: STATUS_EFFECTS.FREEZE, statusChance: 0.1, category: '특수' },
            SHADOW_BALL: { name: '섀도볼', power: 80, type: '고스트', accuracy: 100, category: '특수' },
            MOONBLAST: { name: '문포스', power: 95, type: '페어리', accuracy: 100, category: '특수' },
            GUST: { name: '바람일으키기', power: 40, type: '비행', accuracy: 100, category: '특수' },
            THUNDER_PUNCH: { name: '번개펀치', power: 75, type: '전기', accuracy: 100, status: STATUS_EFFECTS.PARALYSIS, statusChance: 0.1, category: '물리' },
            FIRE_PUNCH: { name: '불꽃펀치', power: 75, type: '불꽃', accuracy: 100, status: STATUS_EFFECTS.BURN, statusChance: 0.1, category: '물리' },
            ICE_PUNCH: { name: '냉동펀치', power: 75, type: '얼음', accuracy: 100, status: STATUS_EFFECTS.FREEZE, statusChance: 0.1, category: '물리' },
            SURF: { name: '파도타기', power: 90, type: '물', accuracy: 100, category: '특수' },
            AIR_SLASH: { name: '에어슬래시', power: 75, type: '비행', accuracy: 95, category: '특수' },
            CLOSE_COMBAT: { name: '인파이트', power: 120, type: '격투', accuracy: 100, category: '물리' },
            SLUDGE_BOMB: { name: '오물폭탄', power: 90, type: '독', accuracy: 100, status: STATUS_EFFECTS.POISON, statusChance: 0.3, category: '특수' },
            PSYCHIC: { name: '사이코키네시스', power: 90, type: '에스퍼', accuracy: 100, category: '특수' },
            BUG_BUZZ: { name: '벌레의야단법석', power: 90, type: '벌레', accuracy: 100, category: '특수' },
            STONE_EDGE: { name: '스톤에지', power: 100, type: '바위', accuracy: 80, category: '물리' },
            DARK_PULSE: { name: '악의파동', power: 80, type: '악', accuracy: 100, category: '특수' },
            IRON_HEAD: { name: '아이언헤드', power: 80, type: '강철', accuracy: 100, category: '물리' },
            DAZZLING_GLEAM: { name: '매지컬샤인', power: 80, type: '페어리', accuracy: 100, category: '특수' },
            TOXIC: { name: '맹독', power: 0, type: '독', accuracy: 90, status: STATUS_EFFECTS.POISON, statusChance: 1.0, category: '변화' },
            WILL_O_WISP: { name: '도깨비불', power: 0, type: '불꽃', accuracy: 85, status: STATUS_EFFECTS.BURN, statusChance: 1.0, category: '변화' },
            THUNDER_WAVE: { name: '전기자석파', power: 0, type: '전기', accuracy: 90, status: STATUS_EFFECTS.PARALYSIS, statusChance: 1.0, category: '변화' },
            SWORDS_DANCE: { name: '칼춤', power: 0, type: '노말', accuracy: 100, statBoost: { stat: 'atk', stages: 2 }, category: '변화' },

            // 신규 포켓몬 확장을 위한 추가 기술
            THUNDER: { name: '천둥', power: 110, type: '전기', accuracy: 70, status: STATUS_EFFECTS.PARALYSIS, statusChance: 0.3, category: '특수' },
            SOLAR_BEAM: { name: '솔라빔', power: 120, type: '풀', accuracy: 100, category: '특수' },
            GIGA_DRAIN: { name: '기가드레인', power: 75, type: '풀', accuracy: 100, drain: 0.5, category: '특수' },
            VINE_WHIP: { name: '덩굴채찍', power: 45, type: '풀', accuracy: 100, category: '물리' },
            RAZOR_LEAF: { name: '잎날가르기', power: 55, type: '풀', accuracy: 95, category: '물리' },
            SEED_BOMB: { name: '씨앗폭탄', power: 80, type: '풀', accuracy: 100, category: '물리' },
            BITE: { name: '물기', power: 60, type: '악', accuracy: 100, category: '물리' },
            QUICK_ATTACK: { name: '전광석화', power: 40, type: '노말', accuracy: 100, priority: 1, category: '물리' },
            DOUBLE_EDGE: { name: '이판사판태클', power: 120, type: '노말', accuracy: 100, recoil: 0.25, category: '물리' },
            ROCK_SLIDE: { name: '스톤샤워', power: 75, type: '바위', accuracy: 90, category: '물리' },
            ROCK_THROW: { name: '바위던지기', power: 50, type: '바위', accuracy: 90, category: '물리' },
            X_SCISSOR: { name: '시저크로스', power: 80, type: '벌레', accuracy: 100, category: '물리' },
            GIGA_IMPACT: { name: '기가임팩트', power: 150, type: '노말', accuracy: 90, category: '물리' },
            DRAIN_PUNCH: { name: '드레인펀치', power: 75, type: '격투', accuracy: 100, drain: 0.5, category: '물리' },
            AURA_SPHERE: { name: '파동탄', power: 80, type: '격투', accuracy: 100, category: '특수' },
            FLASH_CANNON: { name: '플래시캐논', power: 80, type: '강철', accuracy: 100, category: '특수' },
            ENERGY_BALL: { name: '에너지볼', power: 90, type: '풀', accuracy: 100, category: '특수' },
            FLARE_BLITZ: { name: '플레어드라이브', power: 120, type: '불꽃', accuracy: 100, recoil: 0.33, status: STATUS_EFFECTS.BURN, statusChance: 0.1, category: '물리' },
            WATERFALL: { name: '폭포오르기', power: 80, type: '물', accuracy: 100, category: '물리' },
            PLAY_ROUGH: { name: '치근거리기', power: 90, type: '페어리', accuracy: 90, category: '물리' },
            OUTRAGE: { name: '역린', power: 120, type: '드래곤', accuracy: 100, category: '물리' },
            DRACO_METEOR: { name: '용성군', power: 130, type: '드래곤', accuracy: 90, category: '특수' },
            EXTREME_SPEED: { name: '신속', power: 80, type: '노말', accuracy: 100, priority: 2, category: '물리' },
            AURORA_VEIL: { name: '오로라베일', power: 0, type: '얼음', accuracy: 100, statBoost: { stat: 'def', stages: 1 }, category: '변화' },
            SACRED_FIRE: { name: '성스러운불꽃', power: 100, type: '불꽃', accuracy: 95, status: STATUS_EFFECTS.BURN, statusChance: 0.5, category: '물리' },
            SPACIAL_REND: { name: '시공절단', power: 100, type: '드래곤', accuracy: 95, category: '특수' },

            // 발버둥 - 사용 가능한 기술의 PP가 모두 떨어졌을 때 자동으로 사용되는 최후의 수단.
            // 실제 게임처럼 타입 상성 계산 없이(무효화 불가) 항상 명중하며, 반동으로 자신도 다친다.
            STRUGGLE: { name: '발버둥', power: 50, type: '노말', accuracy: 999, category: '물리', recoil: 0.25, isStruggle: true }
        };

        const STARTER_POKEMON_IDS = [252, 255, 258];

        /* ==========================================================================
           7. 포켓몬 도감 데이터베이스 (전국도감 1~1025번 전종 수록)
           예전에는 351종을 한 마리씩 객체 리터럴로 길게 적어두었는데, 종류를 3배로
           늘리면서 같은 형식으로 쓰면 8천 줄이 넘고 스프라이트 주소만 250KB가 된다.
           그래서 종족 데이터를 아래의 압축 표(POKEMON_TABLE) 한 줄씩으로 옮기고,
           스프라이트 주소처럼 도감번호에서 그대로 유도할 수 있는 값은 로드 시점에
           만들어 붙인다. 기존 351종의 손질된 값(기초경험치·기술 구성·진화 레벨·
           서식지·전설 플래그·메가진화 스프라이트)은 그대로 보존했다.

           한 줄의 형식:
           [도감번호, 이름, 타입1, 타입2(없으면 0), HP, 공격, 방어, 특공, 특방, 스피드,
            기초경험치, 진화레벨(없으면 0), 진화대상 도감번호(없으면 0), 기술키,
            플래그(1=전설/환상, 2=준전설·울트라비스트·패러독스, 4=보스), 서식지(선택)]
           ========================================================================== */
        /* ==========================================================================
           6-C. 타입별 기술 풀 & 레벨업 학습표
           예전에는 포켓몬이 태어날 때 받은 2~4개의 기술을 평생 그대로 썼다(진화할 때만
           통째로 교체). 실제 게임처럼 레벨이 오르면서 새 기술을 하나씩 배우도록,
           종족의 타입과 종족값을 근거로 레벨별 학습표를 자동으로 만들어 준다.
           도감 1025종에 학습표를 손으로 적을 수는 없으므로 규칙으로 생성하되,
           도감번호를 시드로 써서 같은 종은 언제나 같은 순서로 배우게 한다.
           ========================================================================== */
        const TYPE_MOVE_POOL = {
            '노말':   ['TACKLE', 'POUND', 'SCRATCH', 'QUICK_ATTACK', 'DOUBLE_EDGE', 'EXTREME_SPEED', 'GIGA_IMPACT', 'HYPER_BEAM'],
            '불꽃':   ['EMBER', 'FIRE_PUNCH', 'WILL_O_WISP', 'FLAMETHROWER', 'FLARE_BLITZ', 'SACRED_FIRE'],
            '물':     ['WATER_GUN', 'WATERFALL', 'SURF', 'HYDRO_PUMP', 'ORIGIN_PULSE'],
            '풀':     ['ABSORB', 'VINE_WHIP', 'RAZOR_LEAF', 'SEED_BOMB', 'GIGA_DRAIN', 'ENERGY_BALL', 'LEAF_BLADE', 'SOLAR_BEAM'],
            '전기':   ['THUNDER_WAVE', 'THUNDER_PUNCH', 'THUNDER_BOLT', 'THUNDER'],
            '얼음':   ['ICE_PUNCH', 'AURORA_VEIL', 'ICE_BEAM', 'BLIZZARD'],
            '격투':   ['DRAIN_PUNCH', 'AURA_SPHERE', 'CLOSE_COMBAT'],
            '독':     ['TOXIC', 'SLUDGE_BOMB'],
            '땅':     ['EARTHQUAKE', 'PRECIPICE_BLADES'],
            '비행':   ['GUST', 'AIR_SLASH'],
            '에스퍼': ['PSYCHIC'],
            '벌레':   ['X_SCISSOR', 'BUG_BUZZ'],
            '바위':   ['ROCK_THROW', 'ROCK_SLIDE', 'STONE_EDGE'],
            '고스트': ['SHADOW_BALL'],
            '드래곤': ['DRAGON_PULSE', 'OUTRAGE', 'DRACO_METEOR', 'SPACIAL_REND'],
            '악':     ['BITE', 'DARK_PULSE'],
            '강철':   ['IRON_HEAD', 'METEOR_MASH', 'FLASH_CANNON'],
            '페어리': ['PLAY_ROUGH', 'DAZZLING_GLEAM', 'MOONBLAST']
        };

        // 레벨업으로 새 기술을 배우는 레벨들 (실제 게임과 비슷한 간격)
        const LEARN_LEVELS = [7, 12, 17, 23, 29, 35, 42, 49, 56];

        function buildLearnset(entry) {
            const rng = makeSeededRng(entry.id * 7919 + 13);
            const known = new Set((entry.skills || []).map(sk => sk.name));
            // 주 타입 기술을 우선하되, 보조 타입과 노말 기술도 섞는다
            const candidates = [];
            const push = (type, weightFirst) => {
                const pool = TYPE_MOVE_POOL[type];
                if (!pool) return;
                pool.forEach((key, i) => {
                    const mv = SKILL_DATABASE[key];
                    if (!mv || known.has(mv.name)) return;
                    candidates.push({ key, mv, rank: i / Math.max(1, pool.length - 1), w: weightFirst });
                });
            };
            push(entry.type1, 1.0);
            if (entry.type2) push(entry.type2, 0.85);
            if (entry.type1 !== '노말' && entry.type2 !== '노말') push('노말', 0.45);

            // 약한 기술부터 강한 기술 순으로 배우도록 정렬 (같은 순위는 시드로 섞는다)
            candidates.sort((a, b) => (a.rank - b.rank) || (a.w === b.w ? rng() - 0.5 : b.w - a.w));

            const set = [];
            const used = new Set();
            for (let i = 0; i < LEARN_LEVELS.length && i < candidates.length; i++) {
                const c = candidates[i];
                if (used.has(c.key)) continue;
                used.add(c.key);
                set.push({ lv: LEARN_LEVELS[i], key: c.key });
            }
            return set;
        }

        const POKEMON_SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/';
        const POKEMON_SPRITE_FALLBACK = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
        const MEGA_SPRITE_BASE = 'https://play.pokemonshowdown.com/sprites/ani-back/';
        const MEGA_SPRITES = { 3: 'venusaurmega', 6: 'charizardmegax', 9: 'blastoisemega', 65: 'alakazammega', 94: 'gengarmega', 142: 'aerodactylmega', 248: 'tyranitarmega', 254: 'sceptilemega', 257: 'blazikenmega', 260: 'swampertmega', 282: 'gardevoirmega', 302: 'absolmega', 306: 'aggronmega', 373: 'salamencemega', 376: 'metagrossmega', 445: 'garchompmega', 448: 'lucariomega' };

        const POKEMON_TABLE = [
            [1,'이상해씨','풀','독',45,49,49,65,65,45,64,16,2,'TACKLE VINE_WHIP',0],
            [2,'이상해풀','풀','독',60,62,63,80,80,60,142,32,3,'VINE_WHIP RAZOR_LEAF SEED_BOMB',0],
            [3,'이상해꽃','풀','독',80,82,83,100,100,80,236,0,0,'SEED_BOMB SOLAR_BEAM GIGA_DRAIN SLUDGE_BOMB',0],
            [4,'파이리','불꽃',0,39,52,43,60,50,65,62,16,5,'SCRATCH EMBER',0],
            [5,'리자드','불꽃',0,58,64,58,80,65,80,142,36,6,'EMBER FIRE_PUNCH SCRATCH',0],
            [6,'리자몽','불꽃','비행',78,84,78,109,85,100,240,0,0,'FLAMETHROWER FIRE_PUNCH AIR_SLASH DRAGON_PULSE',0],
            [7,'꼬부기','물',0,44,48,65,50,64,43,63,16,8,'TACKLE WATER_GUN',0],
            [8,'어니부기','물',0,59,63,80,65,80,58,142,36,9,'WATER_GUN ICE_PUNCH TACKLE',0],
            [9,'거북왕','물',0,79,83,100,85,105,78,239,0,0,'HYDRO_PUMP ICE_BEAM FLASH_CANNON WATERFALL',0],
            [10,'캐터피','벌레',0,39,47,45,41,45,49,70,7,11,'POUND BUG_BUZZ',0],
            [11,'단데기','벌레',0,56,66,56,73,53,61,151,10,12,'TACKLE X_SCISSOR BUG_BUZZ',0],
            [12,'버터플','벌레','비행',73,99,78,102,80,97,242,0,0,'POUND BUG_BUZZ AIR_SLASH GUST',0],
            [13,'뿔충이','벌레','독',45,43,46,39,38,47,73,7,14,'TACKLE X_SCISSOR',0],
            [14,'딱충이','벌레','독',62,62,64,64,61,74,154,10,15,'POUND SLUDGE_BOMB X_SCISSOR',0],
            [15,'독침붕','벌레','독',79,95,79,93,88,95,245,0,0,'TACKLE TOXIC SLUDGE_BOMB X_SCISSOR',0],
            [16,'구구','노말','비행',40,45,40,35,35,56,50,16,17,'TACKLE GUST',0],
            [17,'피죤','노말','비행',63,60,55,50,50,71,122,36,18,'GUST QUICK_ATTACK TACKLE',0],
            [18,'피죤투','노말','비행',83,80,75,70,70,101,216,0,0,'AIR_SLASH HYPER_BEAM GUST QUICK_ATTACK',0],
            [19,'꼬렛','노말',0,30,56,35,25,35,72,51,20,20,'TACKLE QUICK_ATTACK',0],
            [20,'레트라','노말',0,55,81,60,50,70,97,145,0,0,'DOUBLE_EDGE QUICK_ATTACK TACKLE',0],
            [21,'깨비참','노말','비행',44,55,41,47,42,49,61,20,22,'TACKLE AIR_SLASH',0],
            [22,'깨비드릴조','노말','비행',81,101,81,99,87,83,232,0,0,'POUND QUICK_ATTACK GIGA_IMPACT GUST',0],
            [23,'아보','독',0,38,45,34,51,37,55,63,22,24,'TACKLE TOXIC',0],
            [24,'아보크','독',0,75,91,82,88,75,89,234,0,0,'POUND SLUDGE_BOMB TOXIC',0],
            [25,'피카츄','전기',0,35,55,40,50,50,90,82,30,26,'THUNDER_PUNCH QUICK_ATTACK',0],
            [26,'라이츄','전기',0,60,90,55,90,80,110,122,0,0,'THUNDER_BOLT THUNDER QUICK_ATTACK IRON_HEAD',0],
            [27,'모래두지','땅',0,34,55,35,51,43,45,67,22,28,'TACKLE PRECIPICE_BLADES',0],
            [28,'고지','땅',0,71,93,83,88,88,86,238,0,0,'POUND EARTHQUAKE PRECIPICE_BLADES',0],
            [29,'니드런♀','독',0,43,52,36,40,38,51,69,16,30,'TACKLE TOXIC',0],
            [30,'니드리나','독',0,60,71,54,65,54,70,150,32,31,'POUND SLUDGE_BOMB TOXIC',0],
            [31,'니드퀸','독','땅',77,89,84,94,81,84,241,0,0,'TACKLE PRECIPICE_BLADES EARTHQUAKE TOXIC',0],
            [32,'니드런♂','독',0,34,41,37,46,39,49,72,16,33,'POUND SLUDGE_BOMB',0],
            [33,'니드리노','독',0,59,67,55,63,62,68,153,32,34,'TACKLE TOXIC SLUDGE_BOMB',0],
            [34,'니드킹','독','땅',76,100,85,92,89,97,244,0,0,'POUND EARTHQUAKE TOXIC SLUDGE_BOMB',0],
            [35,'삐삐','페어리',0,33,52,45,44,47,54,75,20,36,'TACKLE PLAY_ROUGH',0],
            [36,'픽시','페어리',0,85,90,78,96,77,88,246,0,0,'POUND MOONBLAST',0],
            [37,'식스테일','불꽃',0,42,49,46,48,42,53,77,24,38,'TACKLE FLAMETHROWER',0],
            [38,'나인테일','불꽃',0,79,95,86,100,80,94,248,0,0,'POUND FIRE_PUNCH SACRED_FIRE',0],
            [39,'푸린','노말','페어리',36,54,39,52,45,44,79,22,40,'TACKLE QUICK_ATTACK',0],
            [40,'푸크린','노말','페어리',73,92,79,89,75,85,230,0,0,'POUND DOUBLE_EDGE EXTREME_SPEED DAZZLING_GLEAM',0],
            [41,'주뱃','독','비행',38,44,47,48,48,50,61,22,42,'TACKLE TOXIC',0],
            [42,'골뱃','독','비행',75,97,80,100,78,84,232,0,0,'POUND GUST TOXIC SLUDGE_BOMB',0],
            [43,'뚜벅쵸','풀','독',45,50,55,75,65,30,64,16,44,'ABSORB POUND',0],
            [44,'냄새꼬','풀','독',60,65,70,85,75,40,138,36,45,'ABSORB SLUDGE_BOMB POUND',0],
            [45,'라플레시아','풀','독',75,80,85,110,90,50,221,0,0,'SOLAR_BEAM SLUDGE_BOMB GIGA_DRAIN ENERGY_BALL',0],
            [46,'파라스','벌레','풀',35,70,55,45,55,25,57,24,47,'ABSORB X_SCISSOR',0],
            [47,'파라섹트','벌레','풀',60,95,80,60,80,30,142,0,0,'X_SCISSOR GIGA_DRAIN SLUDGE_BOMB',0],
            [48,'콘팡','벌레','독',32,42,34,39,39,45,68,31,49,'POUND BUG_BUZZ',0],
            [49,'도나리','벌레','독',77,88,82,91,77,94,239,0,0,'TACKLE X_SCISSOR BUG_BUZZ TOXIC',0],
            [50,'디그다','땅',0,10,55,25,35,45,95,53,26,51,'POUND ROCK_THROW',0,'SAND'],
            [51,'닥트리오','땅',0,35,100,50,50,70,120,149,0,0,'EARTHQUAKE ROCK_SLIDE QUICK_ATTACK',0,'SAND'],
            [52,'나옹','노말',0,40,45,35,40,40,90,58,28,53,'SCRATCH POUND',0],
            [53,'페르시온','노말',0,65,70,60,65,65,115,154,0,0,'BITE DOUBLE_EDGE QUICK_ATTACK',0],
            [54,'고라파덕','물',0,50,52,48,65,50,55,64,33,55,'WATER_GUN POUND',0,'WATER'],
            [55,'골덕','물',0,80,82,78,95,80,85,175,0,0,'HYDRO_PUMP PSYCHIC SURF ICE_BEAM',0,'WATER'],
            [56,'망키','격투',0,40,80,35,35,45,70,61,28,57,'SCRATCH QUICK_ATTACK',0],
            [57,'성원숭','격투',0,65,105,60,60,70,95,159,0,0,'CLOSE_COMBAT DRAIN_PUNCH AURA_SPHERE QUICK_ATTACK',0],
            [58,'가디','불꽃',0,33,44,45,51,46,53,78,26,59,'POUND WILL_O_WISP',0],
            [59,'윈디','불꽃',0,85,90,85,88,76,87,249,0,0,'TACKLE SACRED_FIRE FIRE_PUNCH',0],
            [60,'발챙이','물',0,40,50,40,40,40,90,60,25,61,'WATER_GUN POUND',0,'WATER'],
            [61,'슈륙챙이','물',0,65,65,65,50,50,90,135,36,62,'SURF ICE_PUNCH WATER_GUN',0,'WATER'],
            [62,'강챙이','물','격투',90,95,95,70,90,70,230,0,0,'SURF CLOSE_COMBAT ICE_PUNCH WATERFALL',0,'WATER'],
            [63,'캐이시','에스퍼',0,25,20,15,105,55,90,62,16,64,'POUND QUICK_ATTACK',0],
            [64,'윤겔라','에스퍼',0,40,35,30,120,70,105,140,36,65,'PSYCHIC POUND QUICK_ATTACK',0],
            [65,'후딘','에스퍼',0,55,50,45,135,95,120,225,0,0,'PSYCHIC SHADOW_BALL FLASH_CANNON DAZZLING_GLEAM',0],
            [66,'알통몬','격투',0,70,80,50,35,35,35,61,28,67,'POUND DRAIN_PUNCH',0],
            [67,'근육몬','격투',0,80,100,70,50,60,45,142,36,68,'CLOSE_COMBAT DRAIN_PUNCH ROCK_SLIDE',0],
            [68,'괴력몬','격투',0,90,130,80,65,85,55,227,0,0,'CLOSE_COMBAT DRAIN_PUNCH STONE_EDGE AURA_SPHERE',0],
            [69,'모다피','풀','독',38,52,33,50,43,53,69,21,70,'TACKLE TOXIC',0],
            [70,'우츠동','풀','독',55,71,59,67,66,65,150,34,71,'POUND ABSORB SEED_BOMB',0],
            [71,'우츠보트','풀','독',72,89,74,96,86,86,241,0,0,'TACKLE VINE_WHIP GIGA_DRAIN LEAF_BLADE',0],
            [72,'왕눈해','물','독',40,40,35,50,100,70,67,0,0,'WATER_GUN SLUDGE_BOMB',0,'WATER'],
            [73,'독파리','물','독',64,74,67,80,67,65,163,0,0,'TACKLE HYDRO_PUMP TOXIC',0],
            [74,'꼬마돌','바위','땅',40,80,100,30,30,20,60,25,75,'TACKLE ROCK_THROW',0,'SAND'],
            [75,'데구리','바위','땅',55,95,115,45,45,35,137,36,76,'ROCK_SLIDE ROCK_THROW EARTHQUAKE',0,'SAND'],
            [76,'딱구리','바위','땅',80,120,130,55,65,45,223,0,0,'STONE_EDGE EARTHQUAKE ROCK_SLIDE IRON_HEAD',0,'SAND'],
            [77,'포니타','불꽃',0,37,49,43,43,47,55,77,40,78,'TACKLE SACRED_FIRE',0],
            [78,'날쌩마','불꽃',0,74,95,76,102,77,89,248,0,0,'POUND EMBER FLARE_BLITZ',0],
            [79,'야돈','물','에스퍼',31,54,44,39,35,46,79,37,80,'TACKLE SURF',0],
            [80,'야도란','물','에스퍼',83,92,84,91,80,95,230,0,0,'POUND WATERFALL PSYCHIC',0],
            [81,'코일','전기','강철',25,35,70,95,55,45,65,30,82,'THUNDER_PUNCH FLASH_CANNON',0],
            [82,'레어코일','전기','강철',50,60,95,120,70,70,163,0,0,'THUNDER_BOLT FLASH_CANNON IRON_HEAD THUNDER',0],
            [83,'파오리','노말','비행',52,90,55,58,62,60,132,0,0,'QUICK_ATTACK AIR_SLASH X_SCISSOR',0],
            [84,'두두','노말','비행',39,55,38,49,38,50,64,31,85,'POUND EXTREME_SPEED',0],
            [85,'두트리오','노말','비행',76,93,78,93,76,84,235,0,0,'TACKLE SWORDS_DANCE POUND QUICK_ATTACK',0],
            [86,'쥬쥬','물',0,33,45,46,45,41,41,66,34,87,'POUND SURF',0],
            [87,'쥬레곤','물',0,85,98,79,97,86,90,237,0,0,'TACKLE WATERFALL WATER_GUN HYDRO_PUMP',0],
            [88,'질퍽이','독',0,42,42,39,49,44,55,68,38,89,'POUND SLUDGE_BOMB',0],
            [89,'질뻐기','독',0,72,88,87,101,89,96,239,0,0,'TACKLE TOXIC SLUDGE_BOMB',0],
            [90,'셀러','물',0,30,65,100,45,25,40,61,30,91,'WATER_GUN ICE_PUNCH',0,'WATER'],
            [91,'파르셀','물','얼음',50,95,180,85,45,70,184,0,0,'SURF ICE_BEAM BLIZZARD IRON_HEAD',0,'WATER'],
            [92,'고오스','고스트','독',30,35,30,100,35,80,62,25,93,'SHADOW_BALL SLUDGE_BOMB',0],
            [93,'고우스트','고스트','독',45,50,45,115,55,95,142,50,94,'SHADOW_BALL SLUDGE_BOMB PSYCHIC',0],
            [94,'팬텀','고스트','독',60,65,60,130,75,110,225,0,0,'SHADOW_BALL DARK_PULSE SLUDGE_BOMB PSYCHIC',0],
            [95,'롱스톤','바위','땅',35,45,160,30,45,70,87,40,208,'ROCK_SLIDE EARTHQUAKE',0,'SAND'],
            [96,'슬리프','에스퍼',0,41,54,34,42,48,42,76,26,97,'POUND PSYCHIC',0],
            [97,'슬리퍼','에스퍼',0,71,100,82,94,78,83,247,0,0,'TACKLE PSYCHIC',0],
            [98,'크랩','물',0,30,105,90,25,25,50,65,28,99,'WATER_GUN POUND',0,'WATER'],
            [99,'킹크랩','물',0,55,130,115,50,50,75,166,0,0,'SURF ICE_PUNCH STONE_EDGE',0,'WATER'],
            [100,'찌리리공','전기',0,37,49,43,42,46,54,60,30,101,'POUND THUNDER_PUNCH',0],
            [101,'붐볼','전기',0,74,102,83,94,76,88,231,0,0,'TACKLE THUNDER_BOLT THUNDER_PUNCH THUNDER_WAVE',0],
            [102,'아라리','풀','에스퍼',31,46,36,46,49,45,62,0,0,'POUND SEED_BOMB',0],
            [103,'나시','풀','에스퍼',83,92,76,98,79,94,233,0,0,'TACKLE GIGA_DRAIN LEAF_BLADE VINE_WHIP',0],
            [104,'탕구리','땅',0,40,51,44,50,37,51,64,28,105,'POUND EARTHQUAKE',0],
            [105,'텅구리','땅',0,77,97,77,102,82,85,235,0,0,'TACKLE PRECIPICE_BLADES EARTHQUAKE',0],
            [106,'시라소몬','격투',0,72,68,62,69,73,72,156,0,0,'POUND DRAIN_PUNCH',0],
            [107,'홍수몬','격투',0,69,74,70,71,71,71,157,0,0,'TACKLE AURA_SPHERE',0],
            [108,'내루미','노말',0,66,73,63,80,61,63,158,0,0,'POUND QUICK_ATTACK GIGA_IMPACT',0],
            [109,'또가스','독',0,40,65,95,60,45,35,68,35,110,'SLUDGE_BOMB TACKLE',0],
            [110,'또도가스','독',0,65,90,120,85,70,60,172,0,0,'SLUDGE_BOMB WILL_O_WISP TOXIC',0],
            [111,'뿔카노','땅','바위',42,42,46,41,43,54,71,42,112,'TACKLE PRECIPICE_BLADES',0],
            [112,'코뿌리','땅','바위',79,95,79,93,88,95,242,0,0,'POUND STONE_EDGE EARTHQUAKE ROCK_SLIDE',0],
            [113,'럭키','노말',0,250,5,5,35,105,50,395,0,0,'TACKLE DAZZLING_GLEAM',0],
            [114,'덩쿠리','풀',0,71,80,72,77,62,66,164,0,0,'POUND RAZOR_LEAF ENERGY_BALL',0],
            [115,'캥카','노말',0,105,95,80,40,80,90,172,0,0,'DOUBLE_EDGE EARTHQUAKE GIGA_IMPACT',0],
            [116,'쏘드라','물',0,30,40,70,70,25,60,59,32,117,'WATER_GUN ICE_BEAM',0,'WATER'],
            [117,'시드라','물',0,55,65,95,95,45,85,154,0,0,'HYDRO_PUMP ICE_BEAM SURF',0,'WATER'],
            [118,'콘치','물',0,44,55,41,47,42,49,78,33,119,'POUND HYDRO_PUMP',0],
            [119,'왕콘치','물',0,81,101,81,99,87,83,249,0,0,'TACKLE ORIGIN_PULSE WATERFALL WATER_GUN',0],
            [120,'별가사리','물',0,38,45,34,51,37,55,60,20,121,'POUND WATER_GUN',0],
            [121,'아쿠스타','물','에스퍼',75,91,82,88,75,89,231,0,0,'TACKLE SURF ORIGIN_PULSE',0],
            [122,'마임맨','에스퍼','페어리',40,45,65,100,120,90,161,0,0,'PSYCHIC DAZZLING_GLEAM MOONBLAST',0],
            [123,'스라크','벌레','비행',70,110,80,55,80,105,187,0,0,'X_SCISSOR AIR_SLASH QUICK_ATTACK',0],
            [124,'루주라','얼음','에스퍼',65,50,35,115,95,95,159,0,0,'ICE_BEAM PSYCHIC BLIZZARD DAZZLING_GLEAM',0,'SNOW'],
            [125,'에레브','전기',0,65,83,57,95,85,105,172,0,0,'THUNDER_PUNCH THUNDER_BOLT THUNDER',0],
            [126,'마그마','불꽃',0,65,95,57,100,85,93,173,0,0,'FIRE_PUNCH FLAMETHROWER WILL_O_WISP',0],
            [127,'쁘사이저','벌레',0,65,125,100,55,70,85,200,0,0,'X_SCISSOR STONE_EDGE QUICK_ATTACK',0],
            [128,'켄타로스','노말',0,75,100,95,40,70,110,172,0,0,'DOUBLE_EDGE EXTREME_SPEED QUICK_ATTACK GIGA_IMPACT',0],
            [129,'잉어킹','물',0,20,10,55,15,20,80,40,20,130,'TACKLE',0,'WATER'],
            [130,'갸라도스','물','비행',95,125,79,60,100,81,189,0,0,'HYDRO_PUMP DRAGON_PULSE ICE_BEAM EARTHQUAKE',0,'WATER'],
            [131,'라프라스','물','얼음',130,85,80,85,95,60,187,0,0,'SURF ICE_BEAM BLIZZARD',0,'WATER'],
            [132,'메타몽','노말',0,48,48,48,48,48,48,101,0,0,'TACKLE',0],
            [133,'이브이','노말',0,55,55,50,45,65,55,65,25,197,'TACKLE BITE',0,'FOREST'],
            [134,'샤미드','물',0,72,76,71,78,68,75,164,0,0,'POUND ORIGIN_PULSE WATERFALL',0],
            [135,'쥬피썬더','전기',0,69,75,71,80,66,74,165,0,0,'TACKLE THUNDER_WAVE THUNDER',0],
            [136,'부스터','불꽃',0,66,81,64,82,71,66,166,0,0,'POUND WILL_O_WISP FLAMETHROWER',0],
            [137,'폴리곤','노말',0,65,60,70,85,75,40,130,0,0,'THUNDER_BOLT ICE_BEAM TACKLE HYPER_BEAM',0],
            [138,'암나이트','바위','물',38,44,47,48,48,50,78,40,139,'POUND ROCK_THROW',0],
            [139,'암스타','바위','물',75,97,80,100,78,84,249,0,0,'TACKLE WATER_GUN HYDRO_PUMP ROCK_SLIDE',0],
            [140,'투구','바위','물',32,49,40,52,36,41,60,40,141,'POUND SURF',0],
            [141,'투구푸스','바위','물',84,102,73,89,81,90,231,0,0,'TACKLE WATERFALL STONE_EDGE WATER_GUN',0],
            [142,'프테라','바위','비행',80,105,65,60,75,130,180,0,0,'ROCK_SLIDE AIR_SLASH STONE_EDGE HYPER_BEAM',0],
            [143,'잠만보','노말',0,160,110,65,65,110,30,189,0,0,'HYPER_BEAM EARTHQUAKE ICE_PUNCH GIGA_IMPACT',0,'FOREST'],
            [144,'프리져','얼음','비행',90,85,100,95,125,85,290,0,0,'ICE_BEAM BLIZZARD AIR_SLASH HYPER_BEAM',1,'SNOW'],
            [145,'썬더','전기','비행',90,90,85,125,90,100,290,0,0,'THUNDER_BOLT THUNDER AIR_SLASH HYPER_BEAM',1],
            [146,'파이어','불꽃','비행',90,100,90,125,85,90,290,0,0,'FLAMETHROWER SACRED_FIRE AIR_SLASH HYPER_BEAM',1,'VOLCANO'],
            [147,'미뇽','드래곤',0,41,64,45,50,50,50,60,30,148,'TACKLE DRAGON_PULSE',0,'WATER'],
            [148,'신뇽','드래곤',0,61,84,65,70,70,70,100,55,149,'DRAGON_PULSE ICE_BEAM THUNDER_PUNCH',0,'WATER'],
            [149,'망나뇽','드래곤','비행',91,134,95,100,100,80,270,0,0,'DRACO_METEOR HYPER_BEAM ICE_BEAM THUNDER_PUNCH',2,'WATER'],
            [150,'뮤츠','에스퍼',0,106,110,90,154,90,130,306,0,0,'PSYCHIC SHADOW_BALL ICE_BEAM HYPER_BEAM',1],
            [151,'뮤','에스퍼',0,100,100,100,100,100,100,270,0,0,'PSYCHIC ENERGY_BALL DAZZLING_GLEAM AURA_SPHERE',1],
            [152,'치코리타','풀',0,34,48,44,38,38,48,72,16,153,'POUND ABSORB',0],
            [153,'베이리프','풀',0,51,74,62,70,61,67,153,32,154,'TACKLE VINE_WHIP GIGA_DRAIN',0],
            [154,'메가니움','풀',0,76,100,77,99,81,96,244,0,0,'POUND RAZOR_LEAF ENERGY_BALL ABSORB',0],
            [155,'브케인','불꽃',0,33,44,45,51,46,53,75,14,156,'TACKLE SACRED_FIRE',0],
            [156,'마그케인','불꽃',0,65,63,63,61,54,65,156,36,157,'POUND EMBER FLARE_BLITZ',0],
            [157,'블레이범','불꽃',0,82,96,78,90,89,94,247,0,0,'TACKLE FLAMETHROWER WILL_O_WISP',0],
            [158,'리아코','물',0,39,55,38,42,39,51,78,18,159,'POUND HYDRO_PUMP',0],
            [159,'엘리게이','물',0,56,74,64,67,62,63,159,30,160,'TACKLE ORIGIN_PULSE WATERFALL',0],
            [160,'장크로다일','물',0,73,92,79,88,82,84,230,0,0,'POUND WATER_GUN HYDRO_PUMP SURF',0],
            [161,'꼬리선','노말',0,45,51,39,40,47,49,61,15,162,'TACKLE SWORDS_DANCE',0],
            [162,'다꼬리','노말',0,75,97,87,92,77,83,232,0,0,'POUND QUICK_ATTACK GIGA_IMPACT',0],
            [163,'부우부','노말','비행',32,41,40,44,35,55,63,20,164,'TACKLE GUST',0],
            [164,'야부엉','노말','비행',84,94,80,96,80,89,234,0,0,'POUND AIR_SLASH SCRATCH HYPER_BEAM',0],
            [165,'레디바','벌레','비행',41,46,33,48,38,46,65,18,166,'TACKLE X_SCISSOR',0],
            [166,'레디안','벌레','비행',78,99,73,100,83,95,236,0,0,'POUND GUST X_SCISSOR BUG_BUZZ',0],
            [167,'페이검','벌레','독',35,51,41,44,48,45,67,22,168,'TACKLE TOXIC',0],
            [168,'아리아도스','벌레','독',72,89,74,96,86,86,238,0,0,'POUND BUG_BUZZ TOXIC SLUDGE_BOMB',0],
            [169,'크로뱃','독','비행',74,75,59,78,62,73,159,0,0,'TACKLE TOXIC SLUDGE_BOMB',0],
            [170,'초라기','물','전기',34,47,42,50,41,43,70,27,171,'POUND THUNDER_WAVE',0],
            [171,'랜턴','물','전기',71,100,75,102,79,84,241,0,0,'TACKLE WATER_GUN HYDRO_PUMP THUNDER_BOLT',0],
            [172,'삐츄','전기',0,73,71,60,69,70,71,162,0,0,'POUND THUNDER_PUNCH THUNDER_WAVE',0],
            [173,'삐','페어리',0,70,70,68,71,75,70,163,0,0,'TACKLE PLAY_ROUGH',0],
            [174,'푸푸린','노말','페어리',67,76,68,73,73,77,164,0,0,'POUND GIGA_IMPACT MOONBLAST',0],
            [175,'토게피','페어리',0,34,48,36,52,37,47,75,20,176,'TACKLE DAZZLING_GLEAM',0],
            [176,'토게틱','페어리','비행',71,101,84,89,75,88,246,0,0,'POUND DAZZLING_GLEAM AIR_SLASH PLAY_ROUGH',0],
            [177,'네이티','에스퍼','비행',43,45,44,41,40,53,77,25,178,'TACKLE PSYCHIC',0],
            [178,'네이티오','에스퍼','비행',73,91,77,93,85,94,248,0,0,'POUND GUST',0],
            [179,'메리프','전기',0,45,50,37,45,43,44,79,15,180,'TACKLE THUNDER_WAVE',0],
            [180,'보송송','전기',0,62,61,63,70,66,71,140,30,181,'POUND THUNDER_PUNCH THUNDER_WAVE',0],
            [181,'전룡','전기',0,79,102,78,99,78,92,231,0,0,'TACKLE THUNDER_BOLT THUNDER_PUNCH THUNDER_WAVE',0],
            [182,'아르코','풀',0,75,80,95,90,100,50,207,0,0,'RAZOR_LEAF ENERGY_BALL SCRATCH',0],
            [183,'마릴','물','페어리',33,45,46,45,41,41,63,18,184,'TACKLE PLAY_ROUGH',0],
            [184,'마릴리','물','페어리',85,98,79,97,86,90,234,0,0,'POUND WATER_GUN HYDRO_PUMP DAZZLING_GLEAM',0],
            [185,'꼬지모','바위',0,72,69,64,79,70,77,155,0,0,'TACKLE ROCK_THROW',0],
            [186,'왕구리','물',0,62,68,72,81,75,76,156,0,0,'POUND SURF ORIGIN_PULSE',0],
            [187,'통통코','풀','비행',44,47,47,38,39,46,67,18,188,'TACKLE LEAF_BLADE',0],
            [188,'두코','풀','비행',61,73,58,63,55,65,148,27,189,'POUND GUST VINE_WHIP',0],
            [189,'솜솜코','풀','비행',78,99,73,92,82,94,239,0,0,'TACKLE AIR_SLASH RAZOR_LEAF ENERGY_BALL',0],
            [190,'에이팜','노말',0,65,70,58,81,66,66,160,0,0,'POUND TACKLE DOUBLE_EDGE',0],
            [191,'해너츠','풀',0,30,30,30,30,30,30,36,44,192,'ABSORB TACKLE',0],
            [192,'해루미','풀',0,75,75,55,105,85,30,155,0,0,'VINE_WHIP GIGA_DRAIN TACKLE',0],
            [193,'왕자리','벌레','비행',65,65,45,75,45,95,127,33,469,'X_SCISSOR GUST TACKLE',0],
            [194,'우파','물',0,31,53,42,44,38,41,74,20,195,'POUND ORIGIN_PULSE',0],
            [195,'누오','물','땅',83,91,82,96,83,90,245,0,0,'TACKLE PRECIPICE_BLADES WATERFALL EARTHQUAKE',0],
            [196,'에브이','에스퍼',0,65,65,60,130,95,110,184,0,0,'PSYCHIC DAZZLING_GLEAM SHADOW_BALL MOONBLAST',0,'FOREST'],
            [197,'블래키','악',0,95,65,110,60,130,65,184,0,0,'BITE DARK_PULSE SHADOW_BALL IRON_HEAD',0,'FOREST'],
            [198,'무우마','악','비행',64,82,68,74,62,68,168,0,0,'POUND GUST DARK_PULSE',0],
            [199,'야도킹','물','에스퍼',61,73,61,76,75,67,169,0,0,'TACKLE SURF ORIGIN_PULSE',0],
            [200,'무우마직','에스퍼',0,73,72,61,78,65,74,150,0,0,'POUND PSYCHIC',0],
            [201,'안농','에스퍼',0,48,72,48,72,48,48,84,0,0,'PSYCHIC TACKLE',0],
            [202,'마자모','에스퍼',0,67,77,62,82,68,65,152,0,0,'POUND PSYCHIC',0],
            [203,'키링키','노말','에스퍼',72,68,62,69,73,72,153,0,0,'TACKLE QUICK_ATTACK GIGA_IMPACT',0],
            [204,'쏘콘','벌레',0,39,47,45,41,45,49,64,31,205,'POUND BUG_BUZZ',0],
            [205,'왕쏘콘','벌레','강철',76,93,78,100,75,83,235,0,0,'TACKLE BUG_BUZZ IRON_HEAD X_SCISSOR',0],
            [206,'노고치','노말',0,63,79,63,82,66,77,156,0,0,'POUND SWORDS_DANCE SCRATCH',0],
            [207,'글라이거','땅','비행',75,70,71,69,64,69,157,0,0,'TACKLE AIR_SLASH GUST',0],
            [208,'강철톤','강철','땅',72,69,71,71,69,76,158,0,0,'POUND EARTHQUAKE IRON_HEAD',0],
            [209,'블루','페어리',0,39,48,39,43,48,53,69,23,210,'TACKLE PLAY_ROUGH',0],
            [210,'그랑블루','페어리',0,76,94,87,95,86,87,240,0,0,'POUND MOONBLAST',0],
            [211,'침바루','물','독',71,80,72,77,62,66,161,0,0,'TACKLE SURF ORIGIN_PULSE',0],
            [212,'핫삼','벌레','강철',68,71,65,71,67,73,162,0,0,'POUND METEOR_MASH BUG_BUZZ',0],
            [213,'단단지','벌레','바위',65,70,58,73,65,65,163,0,0,'TACKLE ROCK_SLIDE X_SCISSOR',0],
            [214,'헤라크로스','벌레','격투',62,76,58,75,70,64,164,0,0,'POUND AURA_SPHERE CLOSE_COMBAT',0],
            [215,'포푸니','얼음','악',74,82,66,77,68,71,165,0,0,'TACKLE DARK_PULSE ICE_PUNCH',0],
            [216,'깜지곰','노말',0,41,54,41,49,47,41,76,30,217,'POUND QUICK_ATTACK',0],
            [217,'링곰','노말',0,78,92,74,101,77,97,247,0,0,'TACKLE DOUBLE_EDGE EXTREME_SPEED',0],
            [218,'마그마그','불꽃',0,40,40,40,70,40,20,50,0,0,'EMBER FLAMETHROWER',0,'VOLCANO'],
            [219,'마그카르고','불꽃','바위',70,77,67,70,66,68,169,0,0,'TACKLE FLARE_BLITZ STONE_EDGE',0],
            [220,'꾸꾸리','얼음','땅',37,41,35,49,45,53,60,33,221,'POUND EARTHQUAKE',0],
            [221,'메꾸리','얼음','땅',74,102,75,101,83,87,231,0,0,'TACKLE PRECIPICE_BLADES BLIZZARD',0],
            [222,'코산호','물','바위',61,73,68,68,74,66,152,0,0,'POUND ROCK_SLIDE SURF',0],
            [223,'총어','물',0,43,52,36,40,38,51,63,25,224,'TACKLE HYDRO_PUMP',0],
            [224,'대포무노','물',0,80,98,76,92,76,92,234,0,0,'POUND ORIGIN_PULSE WATERFALL WATER_GUN',0],
            [225,'딜리버드','얼음','비행',67,69,69,74,67,64,155,0,0,'TACKLE AURORA_VEIL ICE_BEAM',0],
            [226,'만타인','물','비행',64,68,62,76,65,71,156,0,0,'POUND WATERFALL GUST',0],
            [227,'무장조','강철','비행',69,74,62,70,70,70,157,0,0,'TACKLE FLASH_CANNON METEOR_MASH',0],
            [228,'델빌','악','불꽃',36,53,45,42,49,55,68,24,229,'POUND EMBER',0],
            [229,'헬가','악','불꽃',73,99,85,94,87,96,239,0,0,'TACKLE FLAMETHROWER WILL_O_WISP DARK_PULSE',0],
            [230,'키잉드라','물','드래곤',75,70,63,76,63,68,160,0,0,'POUND WATER_GUN HYDRO_PUMP',0],
            [231,'코코리','땅',0,42,49,46,48,42,53,71,25,232,'TACKLE PRECIPICE_BLADES',0],
            [232,'코리갑','땅',0,79,95,86,100,80,94,242,0,0,'POUND EARTHQUAKE PRECIPICE_BLADES',0],
            [233,'폴리곤2','노말',0,66,81,64,82,71,66,163,0,0,'TACKLE SWORDS_DANCE SCRATCH',0],
            [234,'노라키','노말',0,73,95,62,85,65,85,187,27,899,'POUND EXTREME_SPEED',0],
            [235,'루브도','노말',0,68,71,72,78,74,72,165,0,0,'TACKLE DOUBLE_EDGE EXTREME_SPEED',0],
            [236,'배루키','격투',0,35,35,35,35,35,35,36,20,106,'DRAIN_PUNCH TACKLE',0],
            [237,'카포에라','격투',0,62,76,65,82,62,63,167,0,0,'TACKLE CLOSE_COMBAT',0],
            [238,'뽀뽀라','얼음','에스퍼',45,30,15,85,65,65,59,30,124,'ICE_PUNCH PSYCHIC TACKLE',0],
            [239,'에레키드','전기',0,45,63,37,65,55,95,103,30,125,'THUNDER_WAVE THUNDER_PUNCH TACKLE',0],
            [240,'마그비','불꽃',0,45,75,37,70,55,83,107,30,126,'EMBER FIRE_PUNCH TACKLE',0],
            [241,'밀탱크','노말',0,65,78,59,75,75,68,151,0,0,'TACKLE EXTREME_SPEED DOUBLE_EDGE',0],
            [242,'해피너스','노말',0,62,69,59,69,65,67,152,0,0,'POUND SWORDS_DANCE SCRATCH',0],
            [243,'라이코','전기',0,67,68,67,71,63,74,153,0,0,'TACKLE THUNDER_WAVE THUNDER',1],
            [244,'앤테이','불꽃',0,64,74,60,73,68,66,154,0,0,'POUND WILL_O_WISP FLAMETHROWER',1],
            [245,'스이쿤','물',0,61,73,60,75,73,65,155,0,0,'TACKLE WATER_GUN HYDRO_PUMP',1],
            [246,'애버라스','바위','땅',43,52,43,47,45,50,66,30,247,'POUND ROCK_SLIDE',0],
            [247,'데기라스','바위','땅',60,63,54,72,53,69,147,55,248,'TACKLE ROCK_THROW STONE_EDGE',0],
            [248,'마기라스','악','바위',77,89,76,101,80,83,238,0,0,'POUND SHADOW_BALL ROCK_THROW',2],
            [249,'루기아','에스퍼','비행',64,75,69,68,64,70,159,0,0,'TACKLE PSYCHIC',1],
            [250,'칠색조','불꽃','비행',61,81,69,77,69,69,160,0,0,'POUND FIRE_PUNCH SACRED_FIRE',1],
            [251,'세레비','풀','에스퍼',66,80,62,79,67,76,161,0,0,'TACKLE PSYCHIC RAZOR_LEAF',1],
            [252,'나무지기','풀',0,40,45,35,65,55,70,62,16,253,'POUND ABSORB',0],
            [253,'나무돌이','풀',0,50,65,45,85,65,95,142,36,254,'POUND ABSORB LEAF_BLADE',0],
            [254,'나무킹','풀',0,70,85,65,105,85,120,239,0,0,'LEAF_BLADE DRAGON_PULSE ABSORB SWORDS_DANCE',0],
            [255,'아차모','불꽃',0,45,60,40,70,50,45,62,16,256,'SCRATCH EMBER',0],
            [256,'영치코','불꽃','격투',60,85,60,85,60,55,142,36,257,'FIRE_PUNCH CLOSE_COMBAT SCRATCH',0],
            [257,'번치코','불꽃','격투',80,120,70,110,70,80,239,0,0,'FLARE_BLITZ CLOSE_COMBAT FIRE_PUNCH STONE_EDGE',0],
            [258,'물짱이','물',0,50,70,50,50,50,40,62,16,259,'TACKLE WATER_GUN',0],
            [259,'늪짱이','물','땅',70,85,70,60,70,50,142,36,260,'WATER_GUN EARTHQUAKE TACKLE',0],
            [260,'대짱이','물','땅',100,110,90,85,90,60,241,0,0,'HYDRO_PUMP EARTHQUAKE ICE_PUNCH WATERFALL',0],
            [261,'포챠나','악',0,44,47,40,46,40,47,61,18,262,'TACKLE BITE',0],
            [262,'그라에나','악',0,81,93,73,98,78,88,232,0,0,'POUND DARK_PULSE',0],
            [263,'지그제구리','노말',0,38,30,41,30,41,60,56,0,0,'TACKLE POUND',0,'TALL_GRASS'],
            [264,'직구리','노말',0,65,78,66,74,74,67,154,0,0,'POUND QUICK_ATTACK GIGA_IMPACT',0],
            [265,'개무소','벌레',0,32,42,34,46,46,44,65,7,266,'TACKLE X_SCISSOR',0],
            [266,'실쿤','벌레',0,64,68,52,71,54,71,146,10,267,'POUND BUG_BUZZ X_SCISSOR',0],
            [267,'뷰티플라이','벌레','비행',74,94,82,100,81,85,237,0,0,'TACKLE AIR_SLASH GUST X_SCISSOR',0],
            [268,'카스쿤','벌레',0,31,53,35,52,39,42,68,10,269,'POUND BUG_BUZZ',0],
            [269,'독케일','벌레','독',83,91,75,89,84,91,239,0,0,'TACKLE X_SCISSOR BUG_BUZZ TOXIC',0],
            [270,'연꽃몬','물','풀',40,43,43,41,49,48,70,14,271,'POUND ENERGY_BALL',0],
            [271,'로토스','물','풀',57,69,61,66,65,75,151,33,272,'TACKLE SOLAR_BEAM SURF',0],
            [272,'로파파','물','풀',74,95,76,102,77,89,242,0,0,'POUND LEAF_BLADE WATERFALL ABSORB',0],
            [273,'도토링','풀',0,31,54,44,39,35,46,73,14,274,'TACKLE VINE_WHIP',0],
            [274,'잎새코','풀','악',63,65,62,64,58,73,154,36,275,'POUND SHADOW_BALL RAZOR_LEAF',0],
            [275,'다탱구','풀','악',73,91,77,93,85,94,245,0,0,'TACKLE ABSORB SEED_BOMB SOLAR_BEAM',0],
            [276,'테일로','노말','비행',40,55,30,30,30,85,54,0,0,'TACKLE GUST',0,'TALL_GRASS'],
            [277,'스왈로','노말','비행',72,68,70,77,74,73,167,0,0,'TACKLE SCRATCH HYPER_BEAM',0],
            [278,'갈모매','물','비행',39,55,38,49,38,50,78,25,279,'POUND GUST',0],
            [279,'펠리퍼','물','비행',76,93,78,93,76,84,249,0,0,'TACKLE AIR_SLASH WATERFALL GUST',0],
            [280,'랄토스','에스퍼','페어리',33,45,46,45,41,41,60,20,281,'POUND PSYCHIC',0],
            [281,'킬리아','에스퍼','페어리',65,71,57,70,64,68,141,30,282,'TACKLE MOONBLAST PSYCHIC',0],
            [282,'가디안','에스퍼','페어리',82,89,79,99,84,97,232,0,0,'POUND DAZZLING_GLEAM MOONBLAST PSYCHIC',0],
            [283,'곤율거미','벌레','물',32,41,47,51,49,54,63,22,284,'TACKLE SURF',0],
            [284,'비나방','벌레','비행',84,94,87,88,79,88,234,0,0,'POUND BUG_BUZZ AIR_SLASH GUST',0],
            [285,'버섯꼬','풀',0,60,40,60,40,60,35,65,0,0,'ABSORB TOXIC',0,'FOREST'],
            [286,'버섯모','풀','격투',68,79,58,72,68,74,156,0,0,'POUND ABSORB SEED_BOMB',0],
            [287,'게을로','노말',0,35,43,33,51,40,44,67,18,288,'TACKLE SWORDS_DANCE',0],
            [288,'발바로','노말',0,52,62,59,61,63,63,148,36,289,'POUND QUICK_ATTACK GIGA_IMPACT',0],
            [289,'게을킹','노말',0,84,95,74,90,75,92,239,0,0,'TACKLE DOUBLE_EDGE EXTREME_SPEED',0],
            [290,'토중몬','벌레','땅',31,45,90,30,30,40,36,20,291,'X_SCISSOR EARTHQUAKE TACKLE',0],
            [291,'아이스크','벌레','비행',61,90,45,50,50,160,180,0,0,'X_SCISSOR BUG_BUZZ AIR_SLASH',0],
            [292,'껍질몬','벌레','고스트',1,90,45,30,30,40,36,0,0,'X_SCISSOR SHADOW_BALL TACKLE',0],
            [293,'소곤룡','노말',0,64,51,23,51,23,28,36,20,294,'TACKLE',0],
            [294,'노공룡','노말',0,84,71,43,71,43,48,103,40,295,'TACKLE SCRATCH',0],
            [295,'폭음룡','노말',0,104,91,63,91,73,68,207,0,0,'SCRATCH EXTREME_SPEED',0],
            [296,'마크탕','격투',0,31,46,36,46,49,45,76,24,297,'POUND AURA_SPHERE',0],
            [297,'하리뭉','격투',0,83,92,76,98,79,94,247,0,0,'TACKLE CLOSE_COMBAT',0],
            [298,'루리리','노말','페어리',50,20,40,20,40,20,36,27,183,'TACKLE PLAY_ROUGH',0],
            [299,'코코파스','바위',0,30,45,135,45,90,30,115,36,476,'ROCK_THROW ROCK_SLIDE TACKLE',0],
            [300,'에나비','노말',0,42,41,37,39,47,50,60,20,301,'POUND QUICK_ATTACK',0],
            [301,'델케티','노말',0,79,94,85,91,85,91,231,0,0,'TACKLE DOUBLE_EDGE EXTREME_SPEED',0],
            [302,'깜까미','악',0,65,130,60,75,60,75,163,0,0,'DARK_PULSE STONE_EDGE SWORDS_DANCE IRON_HEAD',0],
            [303,'입치트','강철','페어리',50,85,85,55,55,50,119,0,0,'IRON_HEAD METEOR_MASH DAZZLING_GLEAM',0],
            [304,'가보리','강철','바위',45,43,46,39,38,47,64,32,305,'POUND ROCK_SLIDE',0],
            [305,'갱도라','강철','바위',62,62,64,64,61,74,145,42,306,'TACKLE ROCK_THROW FLASH_CANNON',0],
            [306,'보스로라','강철','바위',79,95,79,93,88,95,236,0,0,'POUND METEOR_MASH STONE_EDGE',0],
            [307,'요가랑','격투','에스퍼',36,47,47,45,46,45,67,37,308,'TACKLE PSYCHIC',0],
            [308,'요가램','격투','에스퍼',81,100,87,97,76,86,238,0,0,'POUND CLOSE_COMBAT PSYCHIC AURA_SPHERE',0],
            [309,'썬더라이','전기',0,38,44,40,41,41,51,69,26,310,'TACKLE THUNDER_BOLT',0],
            [310,'썬더볼트','전기',0,75,90,73,93,79,85,240,0,0,'POUND THUNDER THUNDER_BOLT THUNDER_PUNCH',0],
            [311,'플러시','전기',0,60,50,40,85,75,95,139,0,0,'THUNDER_WAVE THUNDER_PUNCH TACKLE',0],
            [312,'마이농','전기',0,60,40,50,75,85,95,139,0,0,'THUNDER_WAVE THUNDER_PUNCH TACKLE',0],
            [313,'볼비트','벌레',0,65,73,75,47,85,85,159,0,0,'X_SCISSOR BUG_BUZZ TACKLE',0],
            [314,'네오비트','벌레',0,65,47,75,73,85,85,159,0,0,'X_SCISSOR BUG_BUZZ TACKLE',0],
            [315,'로젤리아','풀','독',50,60,45,100,80,65,135,32,407,'ABSORB SEED_BOMB TOXIC',0],
            [316,'꿀꺽몬','독',0,40,50,42,40,40,46,76,26,317,'POUND SLUDGE_BOMB',0],
            [317,'꼴깍몬','독',0,77,88,75,99,85,95,247,0,0,'TACKLE TOXIC SLUDGE_BOMB',0],
            [318,'샤프니아','물',0,34,55,35,51,43,45,78,30,319,'POUND HYDRO_PUMP',0],
            [319,'샤크니아','물','악',71,93,83,88,88,86,249,0,0,'TACKLE SHADOW_BALL WATERFALL BITE',0],
            [320,'고래왕자','물',0,43,52,36,40,38,51,60,40,321,'POUND WATER_GUN',0],
            [321,'고래왕','물',0,80,98,76,92,76,92,231,0,0,'TACKLE SURF ORIGIN_PULSE WATERFALL',0],
            [322,'둔타','땅','불꽃',37,42,44,44,41,42,62,33,323,'POUND EMBER',0],
            [323,'폭타','땅','불꽃',74,88,77,96,79,91,233,0,0,'TACKLE FLAMETHROWER WILL_O_WISP PRECIPICE_BLADES',0],
            [324,'코터스','불꽃',0,69,74,62,70,70,70,154,0,0,'POUND EMBER FLARE_BLITZ',0],
            [325,'피그점프','에스퍼',0,60,25,35,70,80,60,79,32,326,'PSYCHIC TACKLE',0],
            [326,'피그킹','에스퍼',0,80,45,65,90,110,80,191,0,0,'PSYCHIC POUND',0],
            [327,'얼루기','노말',0,75,70,63,76,63,68,157,0,0,'TACKLE QUICK_ATTACK GIGA_IMPACT',0],
            [328,'톱치','땅',0,45,100,45,45,45,10,58,0,0,'TACKLE EARTHQUAKE',0,'SAND'],
            [329,'비브라바','땅','드래곤',39,48,46,50,40,52,69,45,330,'TACKLE EARTHQUAKE',0],
            [330,'플라이곤','땅','드래곤',76,101,79,102,85,86,240,0,0,'POUND PRECIPICE_BLADES DRACO_METEOR EARTHQUAKE',0],
            [331,'선인왕','풀',0,50,85,40,85,40,35,83,32,332,'ABSORB RAZOR_LEAF TACKLE',0],
            [332,'밤선인','풀','악',70,115,60,115,60,55,195,0,0,'RAZOR_LEAF ENERGY_BALL DARK_PULSE',0],
            [333,'파비코','노말','비행',45,40,60,40,75,50,63,35,334,'TACKLE POUND GUST',0],
            [334,'파비코리','드래곤','비행',75,70,90,70,105,80,207,0,0,'OUTRAGE DRACO_METEOR AIR_SLASH',0],
            [335,'쟝고','노말',0,73,115,60,60,60,90,181,0,0,'POUND DOUBLE_EDGE',0],
            [336,'세비퍼','독',0,73,100,60,100,60,65,181,0,0,'TOXIC SLUDGE_BOMB POUND',0],
            [337,'루나톤','에스퍼','바위',68,72,66,73,70,76,167,0,0,'TACKLE STONE_EDGE PSYCHIC',0],
            [338,'솔록','에스퍼','바위',65,78,59,75,75,68,168,0,0,'POUND ROCK_SLIDE STONE_EDGE',0],
            [339,'미꾸리','물','땅',50,48,43,46,41,60,45,30,340,'WATER_GUN EARTHQUAKE TACKLE',0],
            [340,'메깅','물','땅',110,78,73,76,71,60,189,0,0,'WATERFALL HYDRO_PUMP PRECIPICE_BLADES',0],
            [341,'가재군','물',0,34,47,35,43,42,44,61,30,342,'TACKLE SURF',0],
            [342,'가재장군','물','악',71,93,75,95,87,85,232,0,0,'POUND DARK_PULSE SURF ORIGIN_PULSE',0],
            [343,'오뚝군','땅','에스퍼',40,40,55,40,70,55,55,36,344,'EARTHQUAKE PSYCHIC TACKLE',0],
            [344,'점토도리','땅','에스퍼',60,70,105,70,120,75,215,0,0,'EARTHQUAKE PRECIPICE_BLADES PSYCHIC',0],
            [345,'릴링','바위','풀',37,42,36,51,40,41,65,40,346,'TACKLE VINE_WHIP',0],
            [346,'릴리요','바위','풀',74,95,84,88,78,90,236,0,0,'POUND RAZOR_LEAF ENERGY_BALL STONE_EDGE',0],
            [347,'아노딥스','바위','벌레',31,54,44,47,43,47,67,40,348,'TACKLE ROCK_THROW',0],
            [348,'아말도','바위','벌레',76,100,77,99,81,96,238,0,0,'POUND BUG_BUZZ ROCK_SLIDE X_SCISSOR',0],
            [349,'빈티나','물',0,33,44,45,51,46,53,69,20,350,'TACKLE ORIGIN_PULSE',0],
            [350,'밀로틱','물',0,95,60,79,100,125,81,189,0,0,'HYDRO_PUMP ICE_BEAM DAZZLING_GLEAM SURF',0,'WATER'],
            [351,'캐스퐁','노말',0,70,70,70,70,70,70,151,0,0,'TACKLE DOUBLE_EDGE',0],
            [352,'켈리몬','노말',0,60,90,70,60,120,40,167,0,0,'POUND DOUBLE_EDGE',0],
            [353,'어둠대신','고스트',0,44,75,35,63,33,45,51,37,354,'SHADOW_BALL TACKLE',0],
            [354,'다크펫','고스트',0,64,115,65,83,63,65,179,0,0,'SHADOW_BALL POUND',0],
            [355,'해골몽','고스트',0,20,40,90,30,90,25,51,37,356,'SHADOW_BALL TACKLE',0],
            [356,'미라몽','고스트',0,40,70,130,60,130,25,179,28,477,'SHADOW_BALL POUND',0],
            [357,'트로피우스','풀','비행',99,68,83,72,87,51,183,0,0,'VINE_WHIP GIGA_DRAIN AIR_SLASH',0],
            [358,'치렁','에스퍼',0,75,50,80,95,90,65,179,0,0,'PSYCHIC POUND',0],
            [359,'앱솔','악',0,71,73,58,78,64,68,169,0,0,'TACKLE SHADOW_BALL',0],
            [360,'마자','에스퍼',0,95,23,48,23,48,23,36,15,202,'PSYCHIC TACKLE',0],
            [361,'눈꼬마','얼음',0,50,50,50,50,50,50,60,0,0,'TACKLE ICE_BEAM',0,'SNOW'],
            [362,'얼음귀신','얼음',0,80,80,80,80,80,80,199,0,0,'ICE_PUNCH ICE_BEAM POUND',0],
            [363,'대굴레오','얼음','물',70,40,50,55,50,25,47,32,364,'ICE_PUNCH WATER_GUN TACKLE',0],
            [364,'씨레오','얼음','물',90,60,70,75,70,45,143,44,365,'ICE_PUNCH ICE_BEAM SURF',0],
            [365,'씨카이저','얼음','물',110,80,90,95,90,65,239,0,0,'ICE_BEAM BLIZZARD HYDRO_PUMP GIGA_IMPACT',0],
            [366,'진주몽','물',0,35,64,85,74,55,32,91,35,367,'WATER_GUN WATERFALL TACKLE',0],
            [367,'헌테일','물',0,55,104,105,94,75,52,203,0,0,'WATERFALL HYDRO_PUMP POUND',0],
            [368,'분홍장이','물',0,55,84,105,114,75,52,203,0,0,'WATERFALL HYDRO_PUMP POUND',0],
            [369,'시라칸','물','바위',100,90,130,45,65,55,203,0,0,'WATERFALL HYDRO_PUMP ROCK_SLIDE',0],
            [370,'사랑동이','물',0,43,30,55,40,65,97,79,0,0,'WATER_GUN WATERFALL TACKLE',0],
            [371,'아공이','드래곤',0,45,75,60,40,30,50,60,30,372,'BITE DRAGON_PULSE',0],
            [372,'쉘곤','드래곤',0,65,95,100,60,50,50,100,50,373,'DRAGON_PULSE BITE IRON_HEAD',0],
            [373,'보만다','드래곤','비행',95,135,80,110,80,100,270,0,0,'DRACO_METEOR OUTRAGE AIR_SLASH FLAMETHROWER',2],
            [374,'메탕','강철','에스퍼',42,41,45,47,48,51,74,20,375,'POUND FLASH_CANNON',0],
            [375,'메탕구','강철','에스퍼',59,75,56,72,56,70,155,45,376,'TACKLE PSYCHIC FLASH_CANNON',0],
            [376,'메타그로스','강철','에스퍼',80,135,130,95,90,70,270,0,0,'METEOR_MASH THUNDER_BOLT HYPER_BEAM PSYCHIC',4],
            [377,'레지락','바위',0,63,72,71,75,67,63,167,0,0,'TACKLE ROCK_THROW',1],
            [378,'레지아이스','얼음',0,75,78,64,77,72,70,168,0,0,'POUND BLIZZARD ICE_PUNCH',1],
            [379,'레지스틸','강철',0,72,69,64,79,70,77,169,0,0,'TACKLE IRON_HEAD',1],
            [380,'라티아스','드래곤','에스퍼',62,68,72,81,75,76,150,0,0,'POUND DRACO_METEOR PSYCHIC',1],
            [381,'라티오스','드래곤','에스퍼',74,74,72,68,65,68,151,0,0,'TACKLE SPACIAL_REND DRAGON_PULSE',1],
            [382,'가이오가','물',0,100,100,90,150,140,90,306,0,0,'ORIGIN_PULSE HYDRO_PUMP HYPER_BEAM ICE_BEAM',1],
            [383,'그란돈','땅','불꽃',100,150,140,100,90,90,306,0,0,'PRECIPICE_BLADES HYPER_BEAM SACRED_FIRE EARTHQUAKE',1],
            [384,'레쿠쟈','드래곤','비행',105,150,90,150,90,95,306,0,0,'DRAGON_ASCENT DRAGON_PULSE HYPER_BEAM EXTREME_SPEED',1],
            [385,'지라치','강철','에스퍼',62,69,66,68,71,65,155,0,0,'TACKLE IRON_HEAD METEOR_MASH',1],
            [386,'테오키스','에스퍼',0,74,75,59,70,61,72,156,0,0,'POUND PSYCHIC',1],
            [387,'모부기','풀',0,55,68,64,45,55,31,69,18,388,'ABSORB VINE_WHIP TACKLE',0],
            [388,'수풀부기','풀',0,75,89,85,55,65,36,139,32,389,'ABSORB SEED_BOMB TACKLE',0],
            [389,'토대부기','풀','땅',95,109,105,75,85,56,235,0,0,'SEED_BOMB LEAF_BLADE PRECIPICE_BLADES',0],
            [390,'불꽃숭이','불꽃',0,40,50,35,48,41,47,70,14,391,'POUND EMBER',0],
            [391,'파이숭이','불꽃','격투',57,69,61,65,64,74,151,36,392,'TACKLE WILL_O_WISP DRAIN_PUNCH',0],
            [392,'초염몽','불꽃','격투',74,102,83,94,76,88,242,0,0,'POUND SACRED_FIRE AURA_SPHERE FIRE_PUNCH',0],
            [393,'팽도리','물',0,31,46,36,46,49,45,73,16,394,'TACKLE HYDRO_PUMP',0],
            [394,'팽태자','물',0,63,65,54,71,57,72,154,36,395,'POUND ORIGIN_PULSE WATERFALL',0],
            [395,'엠페르트','물','강철',80,98,84,100,77,93,245,0,0,'TACKLE HYDRO_PUMP IRON_HEAD SURF',0],
            [396,'찌르꼬','노말','비행',37,50,37,52,42,43,76,14,397,'POUND QUICK_ATTACK',0],
            [397,'찌르버드','노말','비행',62,61,55,62,65,70,157,34,398,'TACKLE DOUBLE_EDGE EXTREME_SPEED',0],
            [398,'찌르호크','노말','비행',79,94,85,91,85,91,248,0,0,'POUND SCRATCH HYPER_BEAM SWORDS_DANCE',0],
            [399,'비버니','노말',0,59,45,40,35,40,31,36,15,400,'TACKLE',0],
            [400,'비버통','노말','물',79,85,60,55,60,71,143,0,0,'TACKLE QUICK_ATTACK SURF',0],
            [401,'귀뚤뚜기','벌레',0,37,25,41,25,41,25,36,10,402,'X_SCISSOR TACKLE',0],
            [402,'귀뚤톡크','벌레',0,77,85,51,55,51,65,122,0,0,'X_SCISSOR TACKLE',0],
            [403,'꼬링크','전기',0,39,48,39,43,48,53,63,15,404,'TACKLE THUNDER_WAVE',0],
            [404,'럭시오','전기',0,56,67,65,68,64,65,144,30,405,'POUND THUNDER_PUNCH THUNDER_WAVE',0],
            [405,'렌트라','전기',0,81,100,87,97,76,86,235,0,0,'TACKLE THUNDER_BOLT THUNDER_PUNCH THUNDER_WAVE',0],
            [406,'꼬몽울','풀','독',40,30,35,50,70,55,39,33,315,'ABSORB VINE_WHIP TOXIC',0],
            [407,'로즈레이드','풀','독',60,70,65,125,105,90,227,0,0,'RAZOR_LEAF LEAF_BLADE SLUDGE_BOMB',0],
            [408,'두개도스','바위',0,67,125,40,30,30,58,95,30,409,'ROCK_THROW ROCK_SLIDE TACKLE',0],
            [409,'램펄드','바위',0,97,165,60,65,50,58,211,0,0,'ROCK_SLIDE SCRATCH',0],
            [410,'방패톱스','바위','강철',30,42,118,42,88,30,95,30,411,'ROCK_THROW ROCK_SLIDE METEOR_MASH',0],
            [411,'바리톱스','바위','강철',60,52,168,47,138,30,211,0,0,'ROCK_SLIDE METEOR_MASH SCRATCH',0],
            [412,'도롱충이','벌레',0,40,29,45,29,45,36,36,20,413,'X_SCISSOR TACKLE',0],
            [413,'도롱마담','벌레','풀',60,59,85,79,105,36,154,0,0,'X_SCISSOR BUG_BUZZ GIGA_DRAIN',0],
            [414,'나메일','벌레','비행',70,94,50,94,50,66,154,0,0,'X_SCISSOR BUG_BUZZ AIR_SLASH',0],
            [415,'세꿀버리','벌레','비행',30,30,42,30,42,70,36,21,416,'X_SCISSOR GUST TACKLE',0],
            [416,'비퀸','벌레','비행',70,80,102,80,102,40,194,0,0,'X_SCISSOR BUG_BUZZ AIR_SLASH',0],
            [417,'파치리스','전기',0,60,45,70,45,90,95,139,0,0,'THUNDER_WAVE THUNDER_PUNCH TACKLE',0],
            [418,'브이젤','물',0,55,65,35,60,30,85,79,26,419,'WATER_GUN WATERFALL TACKLE',0],
            [419,'플로젤','물',0,85,105,55,85,50,115,211,0,0,'WATERFALL HYDRO_PUMP SCRATCH',0],
            [420,'체리버','풀',0,34,41,37,46,39,49,60,25,421,'POUND GIGA_DRAIN',0],
            [421,'체리꼬','풀',0,79,94,77,90,84,90,231,0,0,'TACKLE ENERGY_BALL ABSORB SEED_BOMB',0],
            [422,'깝질무','물',0,76,48,48,57,62,34,75,30,423,'WATER_GUN WATERFALL TACKLE',0],
            [423,'트리토돈','물','땅',111,83,68,92,82,39,195,0,0,'WATERFALL HYDRO_PUMP PRECIPICE_BLADES',0],
            [424,'겟핸보숭','노말',0,75,100,66,60,66,115,201,0,0,'SCRATCH EXTREME_SPEED POUND',0],
            [425,'흔들풍손','고스트','비행',90,50,34,60,44,70,93,28,426,'SHADOW_BALL GUST TACKLE',0],
            [426,'둥실라이드','고스트','비행',150,80,44,90,54,80,213,0,0,'SHADOW_BALL AIR_SLASH SCRATCH',0],
            [427,'이어롤','노말',0,55,66,44,44,56,85,95,34,428,'TACKLE SCRATCH',0],
            [428,'이어롭','노말',0,65,76,84,54,96,105,199,0,0,'SCRATCH EXTREME_SPEED POUND',0],
            [429,'무우마직','고스트',0,60,60,60,105,105,105,211,0,0,'SHADOW_BALL SCRATCH',0],
            [430,'돈크로우','악','비행',100,125,52,105,52,71,219,0,0,'BITE DARK_PULSE AIR_SLASH',0],
            [431,'나옹마','노말',0,49,55,42,42,37,85,63,38,432,'TACKLE POUND',0],
            [432,'몬냥이','노말',0,71,82,64,64,59,112,177,0,0,'POUND DOUBLE_EDGE',0],
            [433,'랑딸랑','에스퍼',0,45,30,50,65,50,45,43,37,358,'PSYCHIC TACKLE',0],
            [434,'스컹뿡','독','악',63,63,47,41,41,74,78,34,435,'TOXIC BITE TACKLE',0],
            [435,'스컹탱크','독','악',103,93,67,71,61,84,198,0,0,'TOXIC SLUDGE_BOMB DARK_PULSE',0],
            [436,'동미러','강철','에스퍼',57,24,86,24,86,23,55,33,437,'IRON_HEAD PSYCHIC TACKLE',0],
            [437,'동탁군','강철','에스퍼',67,89,116,79,116,33,215,0,0,'METEOR_MASH FLASH_CANNON PSYCHIC',0],
            [438,'꼬지지','바위',0,50,80,95,10,45,10,47,33,185,'ROCK_THROW TACKLE',0],
            [439,'흉내내','에스퍼','페어리',20,25,45,70,90,60,63,36,122,'PSYCHIC PLAY_ROUGH TACKLE',0],
            [440,'핑복','노말',0,100,5,5,15,65,30,36,43,113,'TACKLE',0],
            [441,'페라페','노말','비행',76,65,45,92,42,91,144,0,0,'TACKLE QUICK_ATTACK GUST',0],
            [442,'화강돌','고스트','악',50,92,108,92,108,35,203,0,0,'SHADOW_BALL DARK_PULSE POUND',0],
            [443,'딥상어동','드래곤','땅',58,70,45,40,45,42,60,24,444,'BITE ROCK_THROW',0,'SAND'],
            [444,'한바이트','드래곤','땅',68,90,65,50,55,82,100,48,445,'ROCK_SLIDE BITE EARTHQUAKE',0,'SAND'],
            [445,'한카리아스','드래곤','땅',108,130,95,80,85,102,270,0,0,'EARTHQUAKE DRAGON_PULSE ROCK_SLIDE OUTRAGE',2,'SAND'],
            [446,'먹고자','노말',0,135,85,40,40,85,5,127,36,143,'TACKLE QUICK_ATTACK',0],
            [447,'리오르','격투',0,40,70,40,35,40,60,57,30,448,'DRAIN_PUNCH QUICK_ATTACK',0],
            [448,'루카리오','격투','강철',70,110,70,115,70,90,184,0,0,'AURA_SPHERE CLOSE_COMBAT FLASH_CANNON DRAIN_PUNCH',0],
            [449,'히포포타스','땅',0,68,72,78,38,42,32,79,34,450,'EARTHQUAKE TACKLE',0],
            [450,'하마돈','땅',0,108,112,118,68,72,47,235,0,0,'EARTHQUAKE PRECIPICE_BLADES SCRATCH',0],
            [451,'스콜피','독','벌레',40,50,90,30,55,65,79,40,452,'TOXIC X_SCISSOR TACKLE',0],
            [452,'드래피온','독','악',70,90,110,60,75,95,215,0,0,'TOXIC SLUDGE_BOMB DARK_PULSE',0],
            [453,'삐딱구리','독','격투',48,61,40,61,40,50,55,37,454,'TOXIC DRAIN_PUNCH TACKLE',0],
            [454,'독개굴','독','격투',83,106,65,86,65,85,207,0,0,'TOXIC SLUDGE_BOMB AURA_SPHERE',0],
            [455,'무스틈니','풀',0,74,100,72,90,72,46,178,0,0,'VINE_WHIP GIGA_DRAIN POUND',0],
            [456,'형광어','물',0,49,49,56,49,61,66,79,31,457,'WATER_GUN WATERFALL TACKLE',0],
            [457,'네오라이트','물',0,69,69,76,69,86,91,183,0,0,'WATERFALL HYDRO_PUMP POUND',0],
            [458,'타만타','물','비행',45,20,50,60,120,50,91,35,226,'WATER_GUN WATERFALL GUST',0],
            [459,'눈쓰개','풀','얼음',60,62,50,62,60,40,82,40,460,'ABSORB RAZOR_LEAF ICE_BEAM',0],
            [460,'눈설왕','풀','얼음',90,92,75,92,85,60,210,0,0,'RAZOR_LEAF ENERGY_BALL ICE_BEAM',0],
            [461,'포푸니라','악','얼음',70,120,65,45,85,125,223,0,0,'BITE DARK_PULSE BLIZZARD',0],
            [462,'자포코일','전기','강철',70,70,115,130,90,60,243,0,0,'THUNDER_PUNCH THUNDER FLASH_CANNON GIGA_IMPACT',0],
            [463,'내룸벨트','노말',0,110,85,95,80,95,50,227,0,0,'SCRATCH GIGA_IMPACT',0],
            [464,'거대코뿌리','땅','바위',115,140,130,55,55,40,243,0,0,'EARTHQUAKE PRECIPICE_BLADES STONE_EDGE GIGA_IMPACT',0],
            [465,'덩쿠림보','풀',0,100,100,125,110,50,50,243,0,0,'SEED_BOMB LEAF_BLADE QUICK_ATTACK GIGA_IMPACT',0],
            [466,'에레키블','전기',0,75,123,67,95,85,95,247,0,0,'THUNDER_PUNCH THUNDER QUICK_ATTACK GIGA_IMPACT',0],
            [467,'마그마번','불꽃',0,75,95,67,125,95,83,247,0,0,'FLAMETHROWER SACRED_FIRE QUICK_ATTACK GIGA_IMPACT',0],
            [468,'토게키스','페어리','비행',85,50,95,120,115,80,251,0,0,'DAZZLING_GLEAM MOONBLAST AIR_SLASH GIGA_IMPACT',0],
            [469,'메가자리','벌레','비행',86,76,86,116,56,95,227,0,0,'X_SCISSOR BUG_BUZZ AIR_SLASH',0],
            [470,'리피아','풀',0,65,110,130,60,65,95,235,0,0,'SEED_BOMB LEAF_BLADE SCRATCH',0],
            [471,'글레이시아','얼음',0,65,60,110,130,95,65,235,0,0,'ICE_BEAM BLIZZARD SCRATCH',0],
            [472,'글라이온','땅','비행',75,95,125,45,75,95,223,0,0,'EARTHQUAKE PRECIPICE_BLADES AIR_SLASH',0],
            [473,'맘모꾸리','얼음','땅',110,130,80,70,60,80,239,0,0,'ICE_BEAM BLIZZARD PRECIPICE_BLADES GIGA_IMPACT',0],
            [474,'폴리곤Z','노말',0,85,80,70,135,75,90,243,0,0,'QUICK_ATTACK GIGA_IMPACT',0],
            [475,'엘레이드','에스퍼','격투',68,125,65,65,115,80,229,0,0,'PSYCHIC CLOSE_COMBAT SCRATCH',0],
            [476,'대코파스','바위','강철',60,55,145,75,150,40,235,0,0,'ROCK_SLIDE STONE_EDGE FLASH_CANNON',0],
            [477,'야느와르몽','고스트',0,45,100,135,65,135,45,235,0,0,'SHADOW_BALL SCRATCH',0],
            [478,'눈여아','얼음','고스트',70,80,70,80,70,110,199,0,0,'ICE_PUNCH ICE_BEAM SHADOW_BALL',0],
            [479,'로토무','전기','고스트',50,50,77,95,77,91,167,0,0,'THUNDER_WAVE THUNDER_BOLT SHADOW_BALL',0],
            [480,'유크시','에스퍼',0,75,75,130,75,130,95,279,0,0,'PSYCHIC DOUBLE_EDGE GIGA_IMPACT',2],
            [481,'엠라이트','에스퍼',0,80,105,105,105,105,80,279,0,0,'PSYCHIC DOUBLE_EDGE GIGA_IMPACT',2],
            [482,'아그놈','에스퍼',0,75,125,70,125,70,115,279,0,0,'PSYCHIC DOUBLE_EDGE GIGA_IMPACT',2],
            [483,'디아루가','강철','드래곤',100,120,120,150,100,90,340,0,0,'METEOR_MASH FLASH_CANNON SPACIAL_REND GIGA_IMPACT',1],
            [484,'펄기아','물','드래곤',90,120,100,150,120,100,340,0,0,'SURF ORIGIN_PULSE SPACIAL_REND GIGA_IMPACT',1],
            [485,'히드런','불꽃','강철',91,90,106,130,106,77,295,0,0,'FLAMETHROWER SACRED_FIRE FLASH_CANNON GIGA_IMPACT',2],
            [486,'레지기가스','노말',0,110,160,110,80,110,100,340,0,0,'DOUBLE_EDGE HYPER_BEAM GIGA_IMPACT',2],
            [487,'기라티나','고스트','드래곤',150,100,120,100,120,90,340,0,0,'SHADOW_BALL SPACIAL_REND DOUBLE_EDGE GIGA_IMPACT',1],
            [488,'크레세리아','에스퍼',0,120,70,110,75,120,85,279,0,0,'PSYCHIC DOUBLE_EDGE GIGA_IMPACT',2],
            [489,'피오네','물',0,80,80,80,80,80,80,199,0,0,'WATERFALL HYDRO_PUMP POUND',1],
            [490,'마나피','물',0,100,100,100,100,100,100,295,0,0,'SURF ORIGIN_PULSE DOUBLE_EDGE GIGA_IMPACT',1],
            [491,'다크라이','악',0,70,90,90,135,90,125,295,0,0,'DARK_PULSE DOUBLE_EDGE GIGA_IMPACT',1],
            [492,'쉐이미','풀',0,100,100,100,100,100,100,295,0,0,'GIGA_DRAIN SOLAR_BEAM DOUBLE_EDGE GIGA_IMPACT',1],
            [493,'아르세우스','노말',0,120,120,120,120,120,120,340,0,0,'DOUBLE_EDGE HYPER_BEAM GIGA_IMPACT',1],
            [494,'비크티니','에스퍼','불꽃',100,100,100,100,100,100,295,0,0,'PSYCHIC SACRED_FIRE DOUBLE_EDGE GIGA_IMPACT',1],
            [495,'주리비얀','풀',0,45,45,55,45,55,63,61,17,496,'ABSORB VINE_WHIP TACKLE',0],
            [496,'샤비','풀',0,60,60,75,60,75,83,145,36,497,'ABSORB SEED_BOMB TACKLE',0],
            [497,'샤로다','풀',0,75,75,95,75,95,113,237,0,0,'SEED_BOMB LEAF_BLADE SCRATCH',0],
            [498,'뚜꾸리','불꽃',0,65,63,45,45,45,45,61,17,499,'EMBER FIRE_PUNCH TACKLE',0],
            [499,'차오꿀','불꽃','격투',90,93,55,70,55,55,149,36,500,'EMBER FLAMETHROWER AURA_SPHERE',0],
            [500,'염무왕','불꽃','격투',110,123,65,100,65,65,237,0,0,'FLAMETHROWER FLARE_BLITZ CLOSE_COMBAT',0],
            [501,'수댕이','물',0,55,55,45,63,45,45,61,17,502,'WATER_GUN WATERFALL TACKLE',0],
            [502,'쌍검자비','물',0,75,75,60,83,60,60,145,36,503,'WATER_GUN SURF TACKLE',0],
            [503,'대검귀','물',0,95,100,85,108,70,70,237,0,0,'SURF HYDRO_PUMP SCRATCH',0],
            [504,'보르쥐','노말',0,45,55,39,35,39,42,36,20,505,'TACKLE',0],
            [505,'보르그','노말',0,60,85,69,60,69,77,151,0,0,'TACKLE DOUBLE_EDGE',0],
            [506,'요테리','노말',0,45,60,45,25,45,55,36,16,507,'TACKLE POUND',0],
            [507,'하데리어','노말',0,65,80,65,35,65,60,111,32,508,'TACKLE QUICK_ATTACK',0],
            [508,'바랜드','노말',0,85,110,90,45,90,80,215,0,0,'SCRATCH EXTREME_SPEED',0],
            [509,'쌔비냥','악',0,41,50,37,50,37,66,40,20,510,'BITE TACKLE',0],
            [510,'레파르다스','악',0,64,88,50,88,50,106,172,0,0,'BITE DARK_PULSE POUND',0],
            [511,'야나프','풀',0,50,53,48,53,48,64,68,38,512,'ABSORB VINE_WHIP TACKLE',0],
            [512,'야나키','풀',0,75,98,63,98,63,101,213,0,0,'RAZOR_LEAF ENERGY_BALL SCRATCH',0],
            [513,'바오프','불꽃',0,50,53,48,53,48,64,68,38,514,'EMBER FIRE_PUNCH TACKLE',0],
            [514,'바오키','불꽃',0,75,98,63,98,63,101,213,0,0,'FIRE_PUNCH FLARE_BLITZ SCRATCH',0],
            [515,'앗차프','물',0,50,53,48,53,48,64,68,38,516,'WATER_GUN WATERFALL TACKLE',0],
            [516,'앗차키','물',0,75,98,63,98,63,101,213,0,0,'WATERFALL HYDRO_PUMP SCRATCH',0],
            [517,'몽나','에스퍼',0,76,25,45,67,55,24,49,40,518,'PSYCHIC TACKLE',0],
            [518,'몽얌나','에스퍼',0,116,55,85,107,95,29,205,0,0,'PSYCHIC SCRATCH',0],
            [519,'콩둘기','노말','비행',50,55,50,36,30,43,36,21,520,'TACKLE GUST',0],
            [520,'유토브','노말','비행',62,77,62,50,42,65,101,32,521,'TACKLE SCRATCH GUST',0],
            [521,'켄호로우','노말','비행',80,115,80,65,55,93,205,0,0,'SCRATCH EXTREME_SPEED AIR_SLASH',0],
            [522,'줄뮤마','전기',0,45,60,32,50,32,76,51,27,523,'THUNDER_WAVE TACKLE',0],
            [523,'제브라이카','전기',0,75,100,63,80,63,116,213,0,0,'THUNDER_PUNCH THUNDER_BOLT SCRATCH',0],
            [524,'단굴','바위',0,55,75,85,25,25,15,39,25,525,'ROCK_THROW TACKLE',0],
            [525,'암트르','바위',0,70,105,105,50,40,20,127,33,526,'ROCK_THROW ROCK_SLIDE TACKLE',0],
            [526,'기가이어스','바위',0,85,135,130,60,80,25,227,0,0,'ROCK_SLIDE STONE_EDGE SCRATCH',0],
            [527,'또르박쥐','에스퍼','비행',65,45,43,55,43,72,73,31,528,'PSYCHIC GUST TACKLE',0],
            [528,'맘박쥐','에스퍼','비행',67,57,55,77,55,114,155,0,0,'PSYCHIC AIR_SLASH TACKLE',0],
            [529,'두더류','땅',0,60,85,40,30,45,68,77,31,530,'EARTHQUAKE TACKLE',0],
            [530,'몰드류','땅','강철',110,135,60,50,65,88,221,0,0,'EARTHQUAKE PRECIPICE_BLADES FLASH_CANNON',0],
            [531,'다부니','노말',0,103,60,86,60,86,50,171,0,0,'POUND DOUBLE_EDGE',0],
            [532,'으랏차','격투',0,75,80,55,25,35,35,59,25,533,'DRAIN_PUNCH TACKLE',0],
            [533,'토쇠골','격투',0,85,105,85,40,50,40,139,31,534,'DRAIN_PUNCH AURA_SPHERE TACKLE',0],
            [534,'노보청','격투',0,105,140,95,55,65,45,219,0,0,'AURA_SPHERE CLOSE_COMBAT SCRATCH',0],
            [535,'동챙이','물',0,50,50,40,50,40,64,50,25,536,'WATER_GUN WATERFALL TACKLE',0],
            [536,'두까비','물','땅',75,65,55,65,55,69,122,36,537,'WATER_GUN SURF EARTHQUAKE',0],
            [537,'두빅굴','물','땅',105,95,75,85,75,74,222,0,0,'WATERFALL HYDRO_PUMP PRECIPICE_BLADES',0],
            [538,'던지미','격투',0,120,100,85,30,85,45,187,0,0,'DRAIN_PUNCH AURA_SPHERE POUND',0],
            [539,'타격귀','격투',0,75,125,75,30,75,85,187,0,0,'DRAIN_PUNCH AURA_SPHERE POUND',0],
            [540,'두르보','벌레','풀',45,53,70,40,60,42,63,20,541,'X_SCISSOR VINE_WHIP TACKLE',0],
            [541,'두르쿤','벌레','풀',55,63,90,50,80,42,119,33,542,'X_SCISSOR SEED_BOMB TACKLE',0],
            [542,'모아머','벌레','풀',75,103,80,70,80,92,215,0,0,'X_SCISSOR BUG_BUZZ ENERGY_BALL',0],
            [543,'마디네','벌레','독',30,45,59,30,39,57,36,22,544,'X_SCISSOR TOXIC TACKLE',0],
            [544,'휠구','벌레','독',40,55,99,40,79,47,103,30,545,'X_SCISSOR TOXIC TACKLE',0],
            [545,'펜드라','벌레','독',60,100,89,55,69,112,203,0,0,'X_SCISSOR BUG_BUZZ SLUDGE_BOMB',0],
            [546,'소미안','풀','페어리',40,27,60,37,50,66,39,40,547,'ABSORB VINE_WHIP PLAY_ROUGH',0],
            [547,'엘풍','풀','페어리',60,67,85,77,75,116,199,0,0,'RAZOR_LEAF ENERGY_BALL DAZZLING_GLEAM',0],
            [548,'치릴리','풀',0,45,35,50,70,50,30,39,40,549,'ABSORB VINE_WHIP TACKLE',0],
            [549,'드레디어','풀',0,70,60,75,110,75,90,199,0,0,'RAZOR_LEAF ENERGY_BALL POUND',0],
            [550,'배쓰나이','물',0,70,92,65,80,55,98,183,0,0,'WATERFALL HYDRO_PUMP POUND',0],
            [551,'깜눈크','땅','악',50,72,35,35,35,65,49,29,552,'EARTHQUAKE BITE TACKLE',0],
            [552,'악비르','땅','악',60,82,45,45,45,74,96,40,553,'EARTHQUAKE BITE TACKLE',0],
            [553,'악비아르','땅','악',95,117,80,65,70,92,230,0,0,'EARTHQUAKE PRECIPICE_BLADES DARK_PULSE',0],
            [554,'달막화','불꽃',0,70,90,45,15,45,50,67,35,555,'EMBER FIRE_PUNCH TACKLE',0],
            [555,'불비달마','불꽃',0,105,140,55,30,55,95,199,0,0,'FIRE_PUNCH FLARE_BLITZ POUND',0],
            [556,'마라카치','풀',0,75,86,67,106,67,60,184,0,0,'VINE_WHIP GIGA_DRAIN POUND',0],
            [557,'돌살이','벌레','바위',50,65,85,35,35,55,75,34,558,'X_SCISSOR ROCK_THROW TACKLE',0],
            [558,'암팰리스','벌레','바위',70,105,125,65,75,45,203,0,0,'X_SCISSOR BUG_BUZZ ROCK_SLIDE',0],
            [559,'곤율랭','악','격투',50,75,70,35,70,48,93,39,560,'BITE AURA_SPHERE TACKLE',0],
            [560,'곤율거니','악','격투',65,90,115,45,115,58,205,0,0,'BITE DARK_PULSE AURA_SPHERE',0],
            [561,'심보러','에스퍼','비행',72,58,80,103,80,97,207,0,0,'PSYCHIC AIR_SLASH SCRATCH',0],
            [562,'데스마스','고스트',0,38,30,85,55,65,30,57,34,563,'SHADOW_BALL TACKLE',0],
            [563,'데스니칸','고스트',0,58,50,145,95,105,30,201,0,0,'SHADOW_BALL POUND',0],
            [564,'프로토가','물','바위',54,78,103,53,45,22,99,37,565,'WATER_GUN WATERFALL ROCK_SLIDE',0],
            [565,'늑골라','물','바위',74,108,133,83,65,32,211,0,0,'WATERFALL HYDRO_PUMP ROCK_SLIDE',0],
            [566,'아켄','바위','비행',55,112,45,74,45,70,136,37,567,'ROCK_THROW ROCK_SLIDE GUST',0],
            [567,'아케오스','바위','비행',75,140,65,112,65,110,269,0,0,'ROCK_SLIDE STONE_EDGE AIR_SLASH GIGA_IMPACT',0],
            [568,'깨봉이','독',0,50,50,62,40,62,65,78,36,569,'TOXIC TACKLE',0],
            [569,'더스트나','독',0,80,95,82,60,82,75,194,0,0,'TOXIC SLUDGE_BOMB POUND',0],
            [570,'조로아','악',0,40,65,40,80,40,65,79,30,571,'BITE TACKLE',0],
            [571,'조로아크','악',0,60,105,60,120,60,105,223,0,0,'BITE DARK_PULSE SCRATCH',0],
            [572,'치라미','노말',0,55,50,40,40,40,75,55,37,573,'TACKLE POUND',0],
            [573,'치라치노','노말',0,75,95,60,65,60,115,191,0,0,'SCRATCH EXTREME_SPEED POUND',0],
            [574,'고디탱','에스퍼',0,45,30,50,55,65,45,47,32,575,'PSYCHIC TACKLE',0],
            [575,'고디보미','에스퍼',0,60,45,70,75,85,55,127,41,576,'PSYCHIC TACKLE',0],
            [576,'고디모아젤','에스퍼',0,70,55,95,95,110,65,207,0,0,'PSYCHIC SCRATCH',0],
            [577,'유니란','에스퍼',0,45,30,40,105,50,20,47,32,578,'PSYCHIC TACKLE',0],
            [578,'듀란','에스퍼',0,65,40,50,125,60,30,111,41,579,'PSYCHIC TACKLE',0],
            [579,'란쿨루스','에스퍼',0,110,65,75,125,85,30,207,0,0,'PSYCHIC SCRATCH',0],
            [580,'꼬지보리','물','비행',62,44,50,44,50,55,59,35,581,'WATER_GUN WATERFALL GUST',0],
            [581,'스완나','물','비행',75,87,63,87,63,98,193,0,0,'WATERFALL HYDRO_PUMP AIR_SLASH',0],
            [582,'바닐프티','얼음',0,36,50,50,65,60,44,59,35,583,'ICE_PUNCH TACKLE',0],
            [583,'바닐리치','얼음',0,51,65,65,80,75,59,131,47,584,'ICE_PUNCH ICE_BEAM TACKLE',0],
            [584,'배바닐라','얼음',0,71,95,85,110,95,79,243,0,0,'ICE_BEAM BLIZZARD QUICK_ATTACK GIGA_IMPACT',0],
            [585,'사철록','노말','풀',60,60,50,40,50,75,83,34,586,'TACKLE SCRATCH RAZOR_LEAF',0],
            [586,'바라철록','노말','풀',80,100,70,60,70,95,195,0,0,'SCRATCH EXTREME_SPEED ENERGY_BALL',0],
            [587,'에몽가','전기','비행',55,75,60,75,60,103,157,0,0,'THUNDER_WAVE THUNDER_BOLT AIR_SLASH',0],
            [588,'딱정곤','벌레',0,50,75,45,40,45,60,67,38,589,'X_SCISSOR TACKLE',0],
            [589,'슈바르고','벌레','강철',70,135,105,60,105,20,211,0,0,'X_SCISSOR BUG_BUZZ METEOR_MASH',0],
            [590,'깜놀버슬','풀','독',69,55,45,55,55,15,50,39,591,'ABSORB VINE_WHIP TOXIC',0],
            [591,'뽀록나','풀','독',114,85,70,85,80,30,186,0,0,'VINE_WHIP ENERGY_BALL SLUDGE_BOMB',0],
            [592,'탱그릴','물','고스트',55,40,50,65,85,40,83,40,593,'WATER_GUN WATERFALL SHADOW_BALL',0],
            [593,'탱탱겔','물','고스트',100,60,70,85,105,60,199,0,0,'WATERFALL HYDRO_PUMP SHADOW_BALL',0],
            [594,'맘복치','물',0,165,75,80,40,45,65,191,0,0,'WATERFALL HYDRO_PUMP POUND',0],
            [595,'파쪼옥','벌레','전기',50,47,50,57,50,65,70,36,596,'X_SCISSOR THUNDER_PUNCH TACKLE',0],
            [596,'전툴라','벌레','전기',70,77,60,97,60,108,193,0,0,'X_SCISSOR BUG_BUZZ THUNDER_BOLT',0],
            [597,'철시드','풀','강철',44,50,91,24,86,10,59,40,598,'ABSORB VINE_WHIP IRON_HEAD',0],
            [598,'너트령','풀','강철',74,94,131,54,116,20,206,0,0,'RAZOR_LEAF ENERGY_BALL METEOR_MASH',0],
            [599,'기어르','강철',0,40,55,70,45,60,30,55,38,600,'IRON_HEAD TACKLE',0],
            [600,'기기어르','강철',0,60,80,95,70,85,50,167,49,601,'IRON_HEAD METEOR_MASH POUND',0],
            [601,'기기기어르','강철',0,60,100,115,70,85,90,231,0,0,'METEOR_MASH FLASH_CANNON SCRATCH',0],
            [602,'저리어','전기',0,35,55,40,45,40,60,36,39,603,'THUNDER_WAVE TACKLE',0],
            [603,'저리릴','전기',0,65,85,70,75,70,40,139,32,604,'THUNDER_WAVE THUNDER_PUNCH TACKLE',0],
            [604,'저리더프','전기',0,85,115,80,105,80,50,227,0,0,'THUNDER_PUNCH THUNDER_BOLT SCRATCH',0],
            [605,'리그레','에스퍼',0,55,55,55,85,55,30,83,42,606,'PSYCHIC TACKLE',0],
            [606,'벰크','에스퍼',0,75,75,75,125,95,40,203,0,0,'PSYCHIC POUND',0],
            [607,'불켜미','고스트','불꽃',50,30,55,65,55,20,36,41,608,'SHADOW_BALL EMBER TACKLE',0],
            [608,'램프라','고스트','불꽃',60,40,60,95,60,55,111,36,609,'SHADOW_BALL FIRE_PUNCH TACKLE',0],
            [609,'샹델라','고스트','불꽃',60,55,90,145,90,80,231,0,0,'SHADOW_BALL FLARE_BLITZ SCRATCH',0],
            [610,'터검니','드래곤',0,46,87,60,30,40,57,71,38,611,'DRAGON_PULSE OUTRAGE TACKLE',0],
            [611,'액슨도','드래곤',0,66,117,70,40,50,67,143,48,612,'DRAGON_PULSE OUTRAGE TACKLE',0],
            [612,'액스라이즈','드래곤',0,76,147,90,60,70,97,247,0,0,'OUTRAGE SPACIAL_REND QUICK_ATTACK GIGA_IMPACT',0],
            [613,'코고미','얼음',0,55,70,40,60,40,40,59,37,614,'ICE_PUNCH TACKLE',0],
            [614,'툰베어','얼음',0,95,130,80,70,80,50,219,0,0,'ICE_BEAM BLIZZARD SCRATCH',0],
            [615,'프리지오','얼음',0,80,50,50,95,135,105,227,0,0,'ICE_BEAM BLIZZARD SCRATCH',0],
            [616,'쪼마리','벌레',0,50,40,85,40,65,25,59,39,617,'X_SCISSOR TACKLE',0],
            [617,'어지리더','벌레',0,80,70,40,100,60,145,211,0,0,'X_SCISSOR BUG_BUZZ SCRATCH',0],
            [618,'메더','땅','전기',109,66,84,81,99,32,192,0,0,'EARTHQUAKE PRECIPICE_BLADES THUNDER_BOLT',0],
            [619,'비조푸','격투',0,45,85,50,55,50,65,95,50,620,'DRAIN_PUNCH AURA_SPHERE TACKLE',0],
            [620,'비조도','격투',0,65,125,60,95,60,105,223,0,0,'AURA_SPHERE CLOSE_COMBAT SCRATCH',0],
            [621,'크리만','드래곤',0,77,120,90,60,90,48,203,0,0,'OUTRAGE DRACO_METEOR POUND',0],
            [622,'골비람','땅','고스트',59,74,50,35,50,35,57,43,623,'EARTHQUAKE SHADOW_BALL TACKLE',0],
            [623,'골루그','땅','고스트',89,124,80,55,80,55,201,0,0,'EARTHQUAKE PRECIPICE_BLADES SHADOW_BALL',0],
            [624,'자망칼','악','강철',45,85,70,40,40,60,87,52,625,'BITE METEOR_MASH TACKLE',0],
            [625,'절각참','악','강철',65,125,100,60,70,70,207,27,983,'BITE DARK_PULSE METEOR_MASH',0],
            [626,'버프론','노말',0,95,110,95,40,95,55,207,0,0,'SCRATCH EXTREME_SPEED',0],
            [627,'수리둥보','노말','비행',70,83,50,37,50,60,95,54,628,'TACKLE SCRATCH GUST',0],
            [628,'워글','노말','비행',100,123,75,57,75,80,223,0,0,'SCRATCH GIGA_IMPACT AIR_SLASH',0],
            [629,'벌차이','악','비행',70,55,75,45,65,60,111,54,630,'BITE GUST TACKLE',0],
            [630,'버랜지나','악','비행',110,65,105,55,95,80,223,0,0,'BITE DARK_PULSE AIR_SLASH',0],
            [631,'앤티골','불꽃',0,85,97,66,105,66,65,202,0,0,'FIRE_PUNCH FLARE_BLITZ POUND',0],
            [632,'아이앤트','벌레','강철',58,109,112,48,48,109,202,0,0,'X_SCISSOR BUG_BUZZ METEOR_MASH',0],
            [633,'모노두','악','드래곤',52,65,50,45,50,38,55,50,634,'BITE DRAGON_PULSE TACKLE',0],
            [634,'디헤드','악','드래곤',72,85,70,65,70,58,151,64,635,'BITE DARK_PULSE DRACO_METEOR',0],
            [635,'삼삼드래','악','드래곤',92,105,90,125,90,98,295,0,0,'DARK_PULSE SPACIAL_REND DOUBLE_EDGE GIGA_IMPACT',0],
            [636,'활화르바','벌레','불꽃',55,85,55,50,55,60,103,59,637,'X_SCISSOR FIRE_PUNCH TACKLE',0],
            [637,'불카모스','벌레','불꽃',85,60,65,135,105,100,255,0,0,'X_SCISSOR BUG_BUZZ SACRED_FIRE GIGA_IMPACT',0],
            [638,'코바르온','강철','격투',91,90,129,90,72,108,279,0,0,'METEOR_MASH FLASH_CANNON CLOSE_COMBAT GIGA_IMPACT',2],
            [639,'테라키온','바위','격투',91,129,90,72,90,108,279,0,0,'ROCK_SLIDE STONE_EDGE CLOSE_COMBAT GIGA_IMPACT',2],
            [640,'비리디온','풀','격투',91,90,72,90,129,108,279,0,0,'GIGA_DRAIN SOLAR_BEAM CLOSE_COMBAT GIGA_IMPACT',2],
            [641,'토네로스','비행',0,79,115,70,125,80,111,279,0,0,'AIR_SLASH DOUBLE_EDGE GIGA_IMPACT',2],
            [642,'볼트로스','전기','비행',79,115,70,125,80,111,279,0,0,'THUNDER_BOLT THUNDER AIR_SLASH GIGA_IMPACT',2],
            [643,'레시라무','드래곤','불꽃',100,120,100,150,120,90,340,0,0,'DRACO_METEOR SPACIAL_REND SACRED_FIRE GIGA_IMPACT',1],
            [644,'제크로무','드래곤','전기',100,150,120,120,100,90,340,0,0,'DRACO_METEOR SPACIAL_REND THUNDER GIGA_IMPACT',1],
            [645,'랜드로스','땅','비행',89,125,90,115,80,101,295,0,0,'PRECIPICE_BLADES AIR_SLASH DOUBLE_EDGE GIGA_IMPACT',2],
            [646,'큐레무','드래곤','얼음',125,130,90,130,90,95,340,0,0,'DRACO_METEOR SPACIAL_REND BLIZZARD GIGA_IMPACT',1],
            [647,'케르디오','물','격투',91,72,90,129,90,108,279,0,0,'SURF ORIGIN_PULSE CLOSE_COMBAT GIGA_IMPACT',1],
            [648,'메로엣타','노말','에스퍼',100,77,77,128,128,90,295,0,0,'DOUBLE_EDGE HYPER_BEAM PSYCHIC GIGA_IMPACT',1],
            [649,'게노세크트','벌레','강철',71,120,95,120,95,99,295,0,0,'BUG_BUZZ FLASH_CANNON DOUBLE_EDGE GIGA_IMPACT',1],
            [650,'도치마론','풀',0,56,61,65,48,45,38,65,16,651,'ABSORB VINE_WHIP TACKLE',0],
            [651,'도치보구','풀',0,61,78,95,56,58,57,139,36,652,'ABSORB SEED_BOMB TACKLE',0],
            [652,'브리가론','풀','격투',88,107,122,74,75,64,239,0,0,'SEED_BOMB LEAF_BLADE CLOSE_COMBAT GIGA_IMPACT',0],
            [653,'푸호꼬','불꽃',0,40,45,40,62,60,60,61,16,654,'EMBER FIRE_PUNCH TACKLE',0],
            [654,'테르나','불꽃',0,59,59,58,90,70,73,142,36,655,'EMBER FLAMETHROWER TACKLE',0],
            [655,'마폭시','불꽃','에스퍼',75,69,72,114,100,104,242,0,0,'FLAMETHROWER FLARE_BLITZ PSYCHIC GIGA_IMPACT',0],
            [656,'개구마르','물',0,41,56,40,62,44,71,66,16,657,'WATER_GUN WATERFALL TACKLE',0],
            [657,'개굴반장','물',0,54,63,52,83,56,97,139,36,658,'WATER_GUN SURF TACKLE',0],
            [658,'개굴닌자','물','악',72,95,67,103,71,122,239,0,0,'SURF HYDRO_PUMP DARK_PULSE GIGA_IMPACT',0],
            [659,'파르빗','노말',0,38,36,38,32,36,57,36,20,660,'TACKLE',0],
            [660,'파르토','노말','땅',85,56,77,50,77,78,153,0,0,'POUND DOUBLE_EDGE PRECIPICE_BLADES',0],
            [661,'화살꼬빈','노말','비행',45,50,43,40,38,62,37,17,662,'TACKLE POUND GUST',0],
            [662,'불화살빈','불꽃','비행',62,73,55,56,52,84,121,35,663,'EMBER FLAMETHROWER GUST',0],
            [663,'파이어로','불꽃','비행',78,81,71,74,69,126,214,0,0,'FIRE_PUNCH FLARE_BLITZ AIR_SLASH',0],
            [664,'분이벌레','벌레',0,38,35,40,27,25,35,36,9,665,'X_SCISSOR TACKLE',0],
            [665,'분떠도리','벌레',0,45,22,60,27,30,29,36,12,666,'X_SCISSOR TACKLE',0],
            [666,'비비용','벌레','비행',80,52,50,90,50,89,144,0,0,'X_SCISSOR GUST TACKLE',0],
            [667,'레오꼬','불꽃','노말',62,50,58,73,54,72,110,35,668,'EMBER FIRE_PUNCH QUICK_ATTACK',0],
            [668,'화염레오','불꽃','노말',86,68,72,109,66,106,221,0,0,'FIRE_PUNCH FLARE_BLITZ EXTREME_SPEED',0],
            [669,'플라베베','페어리',0,44,38,39,61,79,42,57,19,670,'PLAY_ROUGH TACKLE',0],
            [670,'플라엣테','페어리',0,54,45,47,75,98,52,112,38,671,'PLAY_ROUGH DAZZLING_GLEAM TACKLE',0],
            [671,'플라제스','페어리',0,78,65,68,112,154,75,257,0,0,'DAZZLING_GLEAM MOONBLAST QUICK_ATTACK GIGA_IMPACT',0],
            [672,'메이클','풀',0,66,65,48,62,57,52,95,32,673,'ABSORB RAZOR_LEAF TACKLE',0],
            [673,'고고트','풀',0,123,100,62,97,81,68,240,0,0,'SEED_BOMB LEAF_BLADE SCRATCH GIGA_IMPACT',0],
            [674,'판짱','격투',0,67,82,62,46,48,43,93,32,675,'DRAIN_PUNCH AURA_SPHERE TACKLE',0],
            [675,'부란다','격투','악',95,124,78,69,71,58,211,0,0,'AURA_SPHERE DARK_PULSE SCRATCH',0],
            [676,'트리미앙','노말',0,75,80,60,65,90,102,193,0,0,'SCRATCH EXTREME_SPEED POUND',0],
            [677,'냐스퍼','에스퍼',0,62,48,54,63,60,68,99,25,678,'PSYCHIC TACKLE',0],
            [678,'냐오닉스','에스퍼',0,74,48,76,83,81,104,188,0,0,'PSYCHIC POUND',0],
            [679,'단칼빙','강철','고스트',45,80,100,35,37,28,75,35,680,'IRON_HEAD SHADOW_BALL TACKLE',0],
            [680,'쌍검킬','강철','고스트',59,110,150,45,49,35,173,27,681,'IRON_HEAD METEOR_MASH SHADOW_BALL',0],
            [681,'킬가르도','강철','고스트',60,50,140,50,140,60,215,0,0,'METEOR_MASH FLASH_CANNON SHADOW_BALL',0],
            [682,'슈쁘','페어리',0,78,52,60,63,65,23,88,33,683,'PLAY_ROUGH DAZZLING_GLEAM TACKLE',0],
            [683,'프레프티르','페어리',0,101,72,72,99,89,29,185,0,0,'PLAY_ROUGH DAZZLING_GLEAM POUND',0],
            [684,'나룸퍼프','페어리',0,62,48,66,59,57,49,88,35,685,'PLAY_ROUGH DAZZLING_GLEAM TACKLE',0],
            [685,'나루림','페어리',0,82,80,86,85,75,72,199,0,0,'PLAY_ROUGH DAZZLING_GLEAM POUND',0],
            [686,'오케이징','악','에스퍼',53,54,53,37,46,45,45,30,687,'BITE PSYCHIC TACKLE',0],
            [687,'칼라마네로','악','에스퍼',86,92,88,68,75,73,201,0,0,'BITE DARK_PULSE PSYCHIC',0],
            [688,'거북손손','바위','물',42,52,67,39,56,50,60,39,689,'ROCK_THROW WATERFALL TACKLE',0],
            [689,'거북손데스','바위','물',72,105,115,54,86,68,215,0,0,'ROCK_SLIDE STONE_EDGE HYDRO_PUMP',0],
            [690,'수레기','독','물',50,60,60,60,60,30,71,48,691,'TOXIC WATERFALL TACKLE',0],
            [691,'드래캄','독','드래곤',65,75,90,97,123,44,210,0,0,'TOXIC SLUDGE_BOMB DRACO_METEOR',0],
            [692,'완철포','물',0,50,53,62,58,63,44,79,37,693,'WATER_GUN WATERFALL TACKLE',0],
            [693,'블로스터','물',0,71,73,88,120,89,59,215,0,0,'WATERFALL HYDRO_PUMP SCRATCH',0],
            [694,'목도리키텔','전기','노말',44,38,33,61,43,70,46,39,695,'THUNDER_WAVE POUND TACKLE',0],
            [695,'일레도리자드','전기','노말',62,55,52,109,94,109,200,0,0,'THUNDER_PUNCH THUNDER_BOLT EXTREME_SPEED',0],
            [696,'티고라스','바위','드래곤',58,89,77,45,45,48,105,39,697,'ROCK_THROW ROCK_SLIDE OUTRAGE',0],
            [697,'견고라스','바위','드래곤',82,121,119,69,59,71,232,0,0,'ROCK_SLIDE STONE_EDGE DRACO_METEOR',0],
            [698,'아마루스','바위','얼음',77,59,50,67,63,46,105,39,699,'ROCK_THROW ROCK_SLIDE ICE_BEAM',0],
            [699,'아마루르가','바위','얼음',123,77,72,99,92,58,232,0,0,'ROCK_SLIDE STONE_EDGE BLIZZARD',0],
            [700,'님피아','페어리',0,95,65,65,110,130,60,235,0,0,'DAZZLING_GLEAM MOONBLAST SCRATCH',0],
            [701,'루차불','격투','비행',78,92,75,74,63,118,215,0,0,'AURA_SPHERE CLOSE_COMBAT AIR_SLASH',0],
            [702,'데덴네','전기','페어리',67,58,57,81,67,101,160,0,0,'THUNDER_WAVE THUNDER_BOLT DAZZLING_GLEAM',0],
            [703,'멜리시','바위','페어리',50,50,150,50,150,50,215,0,0,'ROCK_SLIDE STONE_EDGE MOONBLAST',0],
            [704,'미끄메라','드래곤',0,45,50,35,55,75,40,55,40,705,'DRAGON_PULSE TACKLE',0],
            [705,'미끄네일','드래곤',0,68,75,53,83,113,60,177,50,706,'DRAGON_PULSE DRACO_METEOR POUND',0],
            [706,'미끄래곤','드래곤',0,90,100,70,110,150,80,295,0,0,'DRACO_METEOR SPACIAL_REND DOUBLE_EDGE GIGA_IMPACT',0],
            [707,'클레피','강철','페어리',57,80,91,80,87,75,191,0,0,'IRON_HEAD METEOR_MASH DAZZLING_GLEAM',0],
            [708,'나목령','고스트','풀',43,70,48,50,60,38,62,37,709,'SHADOW_BALL VINE_WHIP TACKLE',0],
            [709,'대로트','고스트','풀',85,110,76,65,82,56,194,0,0,'SHADOW_BALL ENERGY_BALL POUND',0],
            [710,'호바귀','고스트','풀',49,66,70,44,55,51,83,36,711,'SHADOW_BALL RAZOR_LEAF TACKLE',0],
            [711,'펌킨인','고스트','풀',65,90,122,58,75,84,210,0,0,'SHADOW_BALL ENERGY_BALL SCRATCH',0],
            [712,'꽁어름','얼음',0,55,69,85,32,35,28,58,37,713,'ICE_PUNCH TACKLE',0],
            [713,'크레베이스','얼음',0,95,117,184,44,46,28,226,0,0,'ICE_BEAM BLIZZARD SCRATCH',0],
            [714,'음뱃','비행','드래곤',40,30,35,45,40,55,36,48,715,'GUST DRAGON_PULSE TACKLE',0],
            [715,'음번','비행','드래곤',85,70,80,97,80,123,243,0,0,'GUST AIR_SLASH SPACIAL_REND GIGA_IMPACT',0],
            [716,'제르네아스','페어리',0,126,131,95,131,98,99,340,0,0,'DAZZLING_GLEAM MOONBLAST DOUBLE_EDGE GIGA_IMPACT',1],
            [717,'이벨타르','악','비행',126,131,95,131,98,99,340,0,0,'DARK_PULSE AIR_SLASH DOUBLE_EDGE GIGA_IMPACT',1],
            [718,'지가르데','드래곤','땅',108,100,121,81,95,95,295,0,0,'DRACO_METEOR SPACIAL_REND PRECIPICE_BLADES GIGA_IMPACT',1],
            [719,'디안시','바위','페어리',50,100,150,100,150,50,295,0,0,'ROCK_SLIDE STONE_EDGE MOONBLAST GIGA_IMPACT',1],
            [720,'후파','에스퍼','고스트',80,110,60,150,130,70,295,0,0,'PSYCHIC SHADOW_BALL DOUBLE_EDGE GIGA_IMPACT',1],
            [721,'볼케니온','불꽃','물',80,110,120,130,90,70,295,0,0,'FLAMETHROWER SACRED_FIRE ORIGIN_PULSE GIGA_IMPACT',1],
            [722,'나몰빼미','풀','비행',68,55,55,50,50,42,71,17,723,'ABSORB VINE_WHIP GUST',0],
            [723,'빼미스로우','풀','비행',78,75,75,70,70,52,151,34,724,'ABSORB GIGA_DRAIN AIR_SLASH',0],
            [724,'모크나이퍼','풀','고스트',78,107,75,100,100,70,239,0,0,'SEED_BOMB LEAF_BLADE SHADOW_BALL GIGA_IMPACT',0],
            [725,'냐오불','불꽃',0,45,65,40,60,40,70,71,17,726,'EMBER FIRE_PUNCH TACKLE',0],
            [726,'냐오히트','불꽃',0,65,85,50,80,50,90,151,34,727,'EMBER FLAMETHROWER TACKLE',0],
            [727,'어흥염','불꽃','악',95,115,90,80,90,60,239,0,0,'FLAMETHROWER FLARE_BLITZ DARK_PULSE GIGA_IMPACT',0],
            [728,'누리공','물',0,50,54,54,66,56,40,71,17,729,'WATER_GUN WATERFALL TACKLE',0],
            [729,'키요공','물',0,60,69,69,91,81,50,151,34,730,'WATER_GUN SURF TACKLE',0],
            [730,'누리레느','물','페어리',80,74,74,126,116,60,239,0,0,'SURF HYDRO_PUMP MOONBLAST GIGA_IMPACT',0],
            [731,'콕코구리','노말','비행',35,75,30,30,30,65,36,14,732,'TACKLE GUST',0],
            [732,'크라파','노말','비행',55,85,50,40,50,75,99,28,733,'TACKLE SCRATCH GUST',0],
            [733,'왕큰부리','노말','비행',80,120,75,75,75,60,203,0,0,'SCRATCH EXTREME_SPEED AIR_SLASH',0],
            [734,'영구스','노말',0,48,70,30,30,30,45,36,20,735,'TACKLE',0],
            [735,'형사구스','노말',0,88,110,60,55,60,45,149,0,0,'TACKLE DOUBLE_EDGE',0],
            [736,'턱지충이','벌레',0,47,62,45,55,45,46,55,20,737,'X_SCISSOR TACKLE',0],
            [737,'전지충이','벌레','전기',57,82,95,55,75,36,135,31,738,'X_SCISSOR THUNDER_PUNCH TACKLE',0],
            [738,'투구뿌논','벌레','전기',77,70,90,145,75,43,215,0,0,'X_SCISSOR BUG_BUZZ THUNDER_BOLT',0],
            [739,'오기지게','격투',0,47,82,57,42,47,63,85,35,740,'DRAIN_PUNCH AURA_SPHERE TACKLE',0],
            [740,'모단단게','격투','얼음',97,132,77,62,67,43,197,0,0,'DRAIN_PUNCH AURA_SPHERE ICE_BEAM',0],
            [741,'춤추새','불꽃','비행',75,70,70,98,70,93,196,0,0,'FIRE_PUNCH FLARE_BLITZ AIR_SLASH',0],
            [742,'에블리','벌레','페어리',40,45,40,55,40,84,58,25,743,'X_SCISSOR PLAY_ROUGH TACKLE',0],
            [743,'에리본','벌레','페어리',60,55,60,95,70,124,186,0,0,'X_SCISSOR BUG_BUZZ DAZZLING_GLEAM',0],
            [744,'암멍이','바위',0,45,65,40,30,40,60,39,25,745,'ROCK_THROW TACKLE',0],
            [745,'루가루암','바위',0,75,115,65,55,65,112,205,0,0,'ROCK_SLIDE SCRATCH',0],
            [746,'약어리','물',0,45,20,20,25,25,40,36,0,0,'WATER_GUN TACKLE',0],
            [747,'시마사리','독','물',50,53,62,43,52,45,59,38,748,'TOXIC WATERFALL TACKLE',0],
            [748,'더시마사리','독','물',50,63,152,53,142,35,211,0,0,'TOXIC SLUDGE_BOMB HYDRO_PUMP',0],
            [749,'머드나기','땅',0,70,100,70,45,55,45,123,30,750,'EARTHQUAKE TACKLE',0],
            [750,'만마드','땅',0,100,125,100,55,85,35,215,0,0,'EARTHQUAKE PRECIPICE_BLADES SCRATCH',0],
            [751,'물거미','물','벌레',38,40,52,40,72,27,36,22,752,'WATER_GUN X_SCISSOR TACKLE',0],
            [752,'깨비물거미','물','벌레',68,70,92,50,132,42,178,0,0,'WATERFALL SURF BUG_BUZZ',0],
            [753,'짜랑랑','풀',0,40,55,35,50,35,35,36,34,754,'ABSORB TACKLE',0],
            [754,'라란티스','풀',0,70,105,90,80,90,45,199,0,0,'RAZOR_LEAF ENERGY_BALL POUND',0],
            [755,'자마슈','풀','페어리',40,35,55,65,75,15,43,24,756,'ABSORB VINE_WHIP PLAY_ROUGH',0],
            [756,'마셰이드','풀','페어리',60,45,80,90,100,30,139,0,0,'ABSORB SEED_BOMB DAZZLING_GLEAM',0],
            [757,'야도뇽','독','불꽃',48,44,40,71,40,77,71,33,758,'TOXIC FIRE_PUNCH TACKLE',0],
            [758,'염뉴트','독','불꽃',68,64,60,111,60,117,199,0,0,'TOXIC SLUDGE_BOMB FLARE_BLITZ',0],
            [759,'포곰곰','노말','격투',70,75,50,45,50,50,87,27,760,'TACKLE SCRATCH AURA_SPHERE',0],
            [760,'이븐곰','노말','격투',120,125,80,55,60,60,215,0,0,'SCRATCH EXTREME_SPEED CLOSE_COMBAT',0],
            [761,'달콤아','풀',0,42,30,38,30,38,32,36,18,762,'ABSORB TACKLE',0],
            [762,'달무리나','풀',0,52,40,48,40,48,62,47,42,763,'ABSORB VINE_WHIP TACKLE',0],
            [763,'달코퀸','풀',0,72,120,98,50,98,72,223,0,0,'RAZOR_LEAF LEAF_BLADE SCRATCH',0],
            [764,'큐아링','페어리',0,51,52,90,82,110,100,203,0,0,'DAZZLING_GLEAM POUND',0],
            [765,'하랑우탄','노말','에스퍼',90,60,80,90,110,60,207,0,0,'SCRATCH EXTREME_SPEED PSYCHIC',0],
            [766,'내던숭이','격투',0,100,120,90,40,60,80,207,0,0,'AURA_SPHERE SCRATCH',0],
            [767,'꼬시레','벌레','물',25,35,40,20,30,80,36,30,768,'X_SCISSOR WATER_GUN TACKLE',0],
            [768,'갑주무사','벌레','물',75,125,140,60,90,40,239,0,0,'X_SCISSOR BUG_BUZZ HYDRO_PUMP GIGA_IMPACT',0],
            [769,'모래꿍','고스트','땅',55,55,80,70,45,15,71,42,770,'SHADOW_BALL EARTHQUAKE TACKLE',0],
            [770,'모래성이당','고스트','땅',85,75,110,100,75,35,199,0,0,'SHADOW_BALL PRECIPICE_BLADES POUND',0],
            [771,'해무기','물',0,55,60,130,30,130,5,143,0,0,'WATER_GUN SURF TACKLE',0],
            [772,'타입:널','노말',0,95,95,95,95,95,59,242,25,773,'QUICK_ATTACK GIGA_IMPACT',2],
            [773,'실버디','노말',0,95,95,95,95,95,95,271,0,0,'DOUBLE_EDGE HYPER_BEAM QUICK_ATTACK GIGA_IMPACT',2],
            [774,'메테노','바위','비행',60,100,60,100,60,120,215,0,0,'ROCK_SLIDE STONE_EDGE AIR_SLASH',0],
            [775,'자말라','노말',0,65,115,65,75,95,65,199,0,0,'SCRATCH EXTREME_SPEED POUND',0],
            [776,'폭거북스','불꽃','드래곤',60,78,135,91,85,36,203,0,0,'FIRE_PUNCH FLARE_BLITZ DRACO_METEOR',0],
            [777,'토게데마루','전기','강철',65,98,63,40,73,96,163,0,0,'THUNDER_WAVE THUNDER_BOLT METEOR_MASH',0],
            [778,'따라큐','고스트','페어리',55,90,80,50,105,96,196,0,0,'SHADOW_BALL DAZZLING_GLEAM POUND',0],
            [779,'치갈기','물','에스퍼',68,105,70,70,70,92,195,0,0,'WATERFALL HYDRO_PUMP PSYCHIC',0],
            [780,'할비롱','노말','드래곤',78,60,85,135,91,36,203,0,0,'SCRATCH EXTREME_SPEED DRACO_METEOR',0],
            [781,'타타륜','고스트','풀',70,131,100,86,90,40,229,0,0,'SHADOW_BALL LEAF_BLADE SCRATCH',0],
            [782,'짜랑꼬','드래곤',0,45,55,65,45,45,45,55,35,783,'DRAGON_PULSE TACKLE',0],
            [783,'짜랑고우','드래곤','격투',55,75,90,65,70,65,151,45,784,'DRAGON_PULSE DRACO_METEOR AURA_SPHERE',0],
            [784,'짜랑고우거','드래곤','격투',75,110,125,100,105,85,295,0,0,'DRACO_METEOR SPACIAL_REND CLOSE_COMBAT GIGA_IMPACT',0],
            [785,'카푸꼬꼬꼭','전기','페어리',70,115,85,95,75,130,271,0,0,'THUNDER_BOLT THUNDER MOONBLAST GIGA_IMPACT',2],
            [786,'카푸나비나','에스퍼','페어리',70,85,75,130,115,95,271,0,0,'PSYCHIC MOONBLAST QUICK_ATTACK GIGA_IMPACT',2],
            [787,'카푸브루루','풀','페어리',70,130,115,85,95,75,271,0,0,'GIGA_DRAIN SOLAR_BEAM MOONBLAST GIGA_IMPACT',2],
            [788,'카푸느지느','물','페어리',70,75,115,95,130,85,271,0,0,'SURF ORIGIN_PULSE MOONBLAST GIGA_IMPACT',2],
            [789,'코스모그','에스퍼',0,43,29,31,29,31,37,36,43,790,'PSYCHIC TACKLE',1],
            [790,'코스모움','에스퍼',0,43,29,131,29,131,37,135,53,791,'PSYCHIC TACKLE',1],
            [791,'솔가레오','에스퍼','강철',137,137,107,113,89,97,340,0,0,'PSYCHIC FLASH_CANNON DOUBLE_EDGE GIGA_IMPACT',1],
            [792,'루나아라','에스퍼','고스트',137,113,89,137,107,97,340,0,0,'PSYCHIC SHADOW_BALL DOUBLE_EDGE GIGA_IMPACT',1],
            [793,'텅비드','바위','독',109,53,47,127,131,103,271,0,0,'ROCK_SLIDE STONE_EDGE SLUDGE_BOMB GIGA_IMPACT',2],
            [794,'매시붕','벌레','격투',107,139,139,53,53,79,271,0,0,'BUG_BUZZ CLOSE_COMBAT QUICK_ATTACK GIGA_IMPACT',2],
            [795,'페로코체','벌레','격투',71,137,37,137,37,151,271,0,0,'BUG_BUZZ CLOSE_COMBAT QUICK_ATTACK GIGA_IMPACT',2],
            [796,'전수목','전기',0,83,89,71,173,71,83,271,0,0,'THUNDER_BOLT THUNDER QUICK_ATTACK GIGA_IMPACT',2],
            [797,'철화구야','강철','비행',97,101,103,107,101,61,271,0,0,'METEOR_MASH FLASH_CANNON AIR_SLASH GIGA_IMPACT',2],
            [798,'종이신도','풀','강철',59,181,131,59,31,109,271,0,0,'GIGA_DRAIN SOLAR_BEAM FLASH_CANNON GIGA_IMPACT',2],
            [799,'악식킹','악','드래곤',223,101,53,97,53,43,271,0,0,'DARK_PULSE SPACIAL_REND QUICK_ATTACK GIGA_IMPACT',2],
            [800,'네크로즈마','에스퍼',0,97,107,101,127,89,79,295,0,0,'PSYCHIC DOUBLE_EDGE GIGA_IMPACT',1],
            [801,'마기아나','강철','페어리',80,95,115,130,115,65,295,0,0,'METEOR_MASH FLASH_CANNON MOONBLAST GIGA_IMPACT',1],
            [802,'마샤도','격투','고스트',90,125,80,90,90,125,295,0,0,'AURA_SPHERE CLOSE_COMBAT SHADOW_BALL GIGA_IMPACT',1],
            [803,'베베놈','독',0,67,73,67,73,67,73,151,33,804,'TOXIC SLUDGE_BOMB TACKLE',2],
            [804,'아고용','독','드래곤',73,73,73,127,73,121,247,0,0,'TOXIC SLUDGE_BOMB SPACIAL_REND GIGA_IMPACT',2],
            [805,'차곡차곡','바위','강철',61,131,211,53,101,13,271,0,0,'ROCK_SLIDE STONE_EDGE FLASH_CANNON GIGA_IMPACT',2],
            [806,'두파팡','불꽃','고스트',53,127,53,151,79,107,271,0,0,'FLAMETHROWER SACRED_FIRE SHADOW_BALL GIGA_IMPACT',2],
            [807,'제라오라','전기',0,88,112,75,102,80,143,295,0,0,'THUNDER_BOLT THUNDER DOUBLE_EDGE GIGA_IMPACT',1],
            [808,'멜탄','강철',0,46,65,65,55,35,34,55,0,0,'IRON_HEAD TACKLE',1],
            [809,'멜메탈','강철',0,135,143,143,80,65,34,295,0,0,'METEOR_MASH FLASH_CANNON DOUBLE_EDGE GIGA_IMPACT',1],
            [810,'흥나숭','풀',0,50,65,50,40,40,65,63,16,811,'ABSORB VINE_WHIP TACKLE',0],
            [811,'채키몽','풀',0,70,85,70,55,60,80,151,35,812,'ABSORB GIGA_DRAIN TACKLE',0],
            [812,'고릴타','풀',0,100,125,90,60,70,85,239,0,0,'SEED_BOMB LEAF_BLADE SCRATCH GIGA_IMPACT',0],
            [813,'염버니','불꽃',0,50,71,40,40,40,69,63,16,814,'EMBER FIRE_PUNCH TACKLE',0],
            [814,'래비풋','불꽃',0,65,86,60,55,60,94,151,35,815,'EMBER FLAMETHROWER TACKLE',0],
            [815,'에이스번','불꽃',0,80,116,75,65,75,119,239,0,0,'FLAMETHROWER FLARE_BLITZ SCRATCH GIGA_IMPACT',0],
            [816,'울머기','물',0,50,40,40,70,40,70,63,16,817,'WATER_GUN WATERFALL TACKLE',0],
            [817,'누겔레온','물',0,65,60,55,95,55,90,151,35,818,'WATER_GUN SURF TACKLE',0],
            [818,'인텔리레온','물',0,70,85,65,125,65,120,239,0,0,'SURF HYDRO_PUMP SCRATCH GIGA_IMPACT',0],
            [819,'탐리스','노말',0,70,55,55,35,35,25,36,24,820,'TACKLE POUND',0],
            [820,'요씽리스','노말',0,120,95,95,55,75,20,183,0,0,'POUND DOUBLE_EDGE',0],
            [821,'파라꼬','비행',0,38,47,35,33,35,57,36,18,822,'GUST TACKLE',0],
            [822,'파크로우','비행',0,68,67,55,43,55,77,107,38,823,'GUST TACKLE',0],
            [823,'아머까오','비행','강철',98,87,105,53,85,67,211,0,0,'GUST AIR_SLASH METEOR_MASH',0],
            [824,'두루지벌레','벌레',0,25,20,20,25,45,45,36,10,825,'X_SCISSOR TACKLE',0],
            [825,'레돔벌레','벌레','에스퍼',50,35,80,50,90,30,83,30,826,'X_SCISSOR PSYCHIC TACKLE',0],
            [826,'이올브','벌레','에스퍼',60,45,110,80,120,90,219,0,0,'X_SCISSOR BUG_BUZZ PSYCHIC',0],
            [827,'훔처우','악',0,40,28,28,47,52,50,36,18,828,'BITE TACKLE',0],
            [828,'폭슬라이','악',0,70,58,58,87,92,90,179,0,0,'BITE DARK_PULSE POUND',0],
            [829,'꼬모카','풀',0,40,40,60,40,60,10,36,20,830,'ABSORB TACKLE',0],
            [830,'백솜모카','풀',0,60,50,90,80,120,60,183,0,0,'VINE_WHIP GIGA_DRAIN POUND',0],
            [831,'우르','노말',0,42,40,55,40,45,48,36,24,832,'TACKLE',0],
            [832,'배우르','노말',0,72,80,100,60,90,88,207,0,0,'SCRATCH EXTREME_SPEED',0],
            [833,'깨물부기','물',0,50,64,50,38,38,44,42,22,834,'WATER_GUN TACKLE',0],
            [834,'갈가부기','물','바위',90,115,90,48,68,74,203,0,0,'WATERFALL HYDRO_PUMP ROCK_SLIDE',0],
            [835,'멍파치','전기',0,59,45,50,40,50,26,36,25,836,'THUNDER_WAVE TACKLE',0],
            [836,'펄스멍','전기',0,69,90,60,90,60,121,207,0,0,'THUNDER_PUNCH THUNDER_BOLT SCRATCH',0],
            [837,'탄동','바위',0,30,40,50,40,50,30,36,18,838,'ROCK_THROW TACKLE',0],
            [838,'탄차곤','바위','불꽃',80,60,90,60,70,50,143,34,839,'ROCK_THROW ROCK_SLIDE FLAMETHROWER',0],
            [839,'석탄산','바위','불꽃',110,80,120,80,90,30,223,0,0,'ROCK_SLIDE STONE_EDGE FLARE_BLITZ',0],
            [840,'과사삭벌레','풀','드래곤',40,40,80,40,40,20,36,42,841,'ABSORB DRAGON_PULSE TACKLE',0],
            [841,'애프룡','풀','드래곤',70,110,80,95,60,70,203,0,0,'RAZOR_LEAF ENERGY_BALL DRACO_METEOR',0],
            [842,'단지래플','풀','드래곤',110,85,80,100,80,30,203,0,0,'RAZOR_LEAF ENERGY_BALL DRACO_METEOR',0],
            [843,'모래뱀','땅',0,52,57,75,35,50,46,67,36,844,'EARTHQUAKE TACKLE',0],
            [844,'사다이사','땅',0,72,107,125,65,70,71,223,0,0,'EARTHQUAKE PRECIPICE_BLADES SCRATCH',0],
            [845,'윽우지','비행','물',70,85,55,85,95,85,195,0,0,'GUST AIR_SLASH HYDRO_PUMP',0],
            [846,'찌로꼬치','물',0,41,63,40,40,30,66,39,26,847,'WATER_GUN TACKLE',0],
            [847,'꼬치조','물',0,61,123,60,60,50,136,207,0,0,'WATERFALL HYDRO_PUMP SCRATCH',0],
            [848,'일레즌','전기','독',40,38,35,54,35,40,36,30,849,'THUNDER_WAVE TOXIC TACKLE',0],
            [849,'스트린더','전기','독',75,98,70,114,70,75,217,0,0,'THUNDER_PUNCH THUNDER_BOLT SLUDGE_BOMB',0],
            [850,'태우지네','불꽃','벌레',50,65,45,50,50,45,59,28,851,'EMBER FIRE_PUNCH X_SCISSOR',0],
            [851,'다태우지네','불꽃','벌레',100,115,65,90,90,65,235,0,0,'FLAMETHROWER FLARE_BLITZ BUG_BUZZ',0],
            [852,'때때무노','격투',0,50,68,60,50,50,32,63,37,853,'DRAIN_PUNCH TACKLE',0],
            [853,'케오퍼스','격투',0,80,118,90,70,80,42,199,0,0,'DRAIN_PUNCH AURA_SPHERE POUND',0],
            [854,'데인차','고스트',0,40,45,45,74,54,50,61,40,855,'SHADOW_BALL TACKLE',0],
            [855,'포트데스','고스트',0,60,65,65,134,114,70,221,0,0,'SHADOW_BALL SCRATCH',0],
            [856,'몸지브림','에스퍼',0,42,30,45,56,53,39,36,32,857,'PSYCHIC TACKLE',0],
            [857,'손지브림','에스퍼',0,57,40,65,86,73,49,111,42,858,'PSYCHIC TACKLE',0],
            [858,'브리무음','에스퍼','페어리',57,90,95,136,103,29,223,0,0,'PSYCHIC MOONBLAST SCRATCH',0],
            [859,'메롱꿍','악','페어리',45,45,30,55,40,50,36,32,860,'BITE PLAY_ROUGH TACKLE',0],
            [860,'쏘겨모','악','페어리',65,60,45,75,55,70,111,42,861,'BITE DAZZLING_GLEAM TACKLE',0],
            [861,'오롱털','악','페어리',95,120,65,95,75,60,223,0,0,'BITE DARK_PULSE MOONBLAST',0],
            [862,'가로막구리','악','노말',93,90,101,60,81,95,231,0,0,'BITE DARK_PULSE GIGA_IMPACT',0],
            [863,'나이킹','강철',0,70,110,100,50,60,50,167,0,0,'IRON_HEAD METEOR_MASH POUND',0],
            [864,'산호르곤','고스트',0,60,95,50,145,130,30,223,0,0,'SHADOW_BALL SCRATCH',0],
            [865,'창파나이트','격투',0,62,135,95,68,82,65,221,0,0,'AURA_SPHERE CLOSE_COMBAT SCRATCH',0],
            [866,'마임꽁꽁','얼음','에스퍼',80,85,75,110,100,70,231,0,0,'ICE_BEAM BLIZZARD PSYCHIC',0],
            [867,'데스판','땅','고스트',58,95,145,50,105,30,201,0,0,'EARTHQUAKE PRECIPICE_BLADES SHADOW_BALL',0],
            [868,'마빌크','페어리',0,45,40,40,50,61,34,36,42,869,'PLAY_ROUGH TACKLE',0],
            [869,'마휘핑','페어리',0,65,60,75,110,121,64,211,0,0,'DAZZLING_GLEAM SCRATCH',0],
            [870,'대여르','격투',0,65,100,100,70,60,75,191,0,0,'DRAIN_PUNCH AURA_SPHERE POUND',0],
            [871,'찌르성게','전기',0,48,101,95,91,85,15,163,0,0,'THUNDER_WAVE THUNDER_BOLT TACKLE',0],
            [872,'누니머기','얼음','벌레',30,25,35,45,30,20,36,45,873,'ICE_PUNCH X_SCISSOR TACKLE',0],
            [873,'모스노우','얼음','벌레',70,65,60,125,90,65,195,0,0,'ICE_PUNCH ICE_BEAM BUG_BUZZ',0],
            [874,'돌헨진','바위',0,100,125,135,20,20,70,191,0,0,'ROCK_THROW ROCK_SLIDE POUND',0],
            [875,'빙큐보','얼음',0,75,80,110,65,90,50,191,0,0,'ICE_PUNCH ICE_BEAM POUND',0],
            [876,'에써르','에스퍼','노말',60,65,55,105,95,95,195,0,0,'PSYCHIC EXTREME_SPEED POUND',0],
            [877,'모르페코','전기','악',58,95,58,70,58,97,164,0,0,'THUNDER_WAVE THUNDER_BOLT DARK_PULSE',0],
            [878,'끼리동','강철',0,72,80,49,40,49,40,79,34,879,'IRON_HEAD TACKLE',0],
            [879,'대왕끼리동','강철',0,122,130,69,80,69,30,215,0,0,'METEOR_MASH FLASH_CANNON SCRATCH',0],
            [880,'파치래곤','전기','드래곤',90,100,90,80,70,75,219,0,0,'THUNDER_PUNCH THUNDER_BOLT DRACO_METEOR',0],
            [881,'파치르돈','전기','얼음',90,100,90,90,80,55,219,0,0,'THUNDER_PUNCH THUNDER_BOLT BLIZZARD',0],
            [882,'어래곤','물','드래곤',90,90,100,70,80,75,219,0,0,'WATERFALL HYDRO_PUMP DRACO_METEOR',0],
            [883,'어치르돈','물','얼음',90,90,100,80,90,55,219,0,0,'WATERFALL HYDRO_PUMP BLIZZARD',0],
            [884,'두랄루돈','강철','드래곤',70,95,115,120,50,85,243,28,1018,'METEOR_MASH FLASH_CANNON SPACIAL_REND GIGA_IMPACT',0],
            [885,'드라꼰','드래곤','고스트',28,60,30,40,30,82,36,50,886,'DRAGON_PULSE SHADOW_BALL TACKLE',0],
            [886,'드래런치','드래곤','고스트',68,80,50,60,50,102,143,60,887,'DRAGON_PULSE OUTRAGE SHADOW_BALL',0],
            [887,'드래펄트','드래곤','고스트',88,120,75,100,75,142,295,0,0,'DRACO_METEOR SPACIAL_REND SHADOW_BALL GIGA_IMPACT',0],
            [888,'자시안','페어리',0,92,120,115,80,115,138,340,0,0,'DAZZLING_GLEAM MOONBLAST DOUBLE_EDGE GIGA_IMPACT',1],
            [889,'자마젠타','격투',0,92,120,115,80,115,138,340,0,0,'AURA_SPHERE CLOSE_COMBAT DOUBLE_EDGE GIGA_IMPACT',1],
            [890,'무한다이노','독','드래곤',140,85,95,145,95,130,340,0,0,'SLUDGE_BOMB SPACIAL_REND DOUBLE_EDGE GIGA_IMPACT',1],
            [891,'치고마','격투',0,60,90,60,53,50,72,123,37,892,'DRAIN_PUNCH AURA_SPHERE TACKLE',2],
            [892,'우라오스','격투','악',100,130,100,63,60,97,255,0,0,'AURA_SPHERE CLOSE_COMBAT DARK_PULSE GIGA_IMPACT',2],
            [893,'자루도','악','풀',105,120,105,70,95,105,295,0,0,'DARK_PULSE SOLAR_BEAM DOUBLE_EDGE GIGA_IMPACT',1],
            [894,'레지에레키','전기',0,80,100,50,100,50,200,279,0,0,'THUNDER_BOLT THUNDER DOUBLE_EDGE GIGA_IMPACT',2],
            [895,'레지드래고','드래곤',0,200,100,50,100,50,80,279,0,0,'DRACO_METEOR SPACIAL_REND DOUBLE_EDGE GIGA_IMPACT',2],
            [896,'블리자포스','얼음',0,100,145,130,65,110,30,279,0,0,'ICE_BEAM BLIZZARD DOUBLE_EDGE GIGA_IMPACT',2],
            [897,'레이스포스','고스트',0,100,65,60,145,80,130,279,0,0,'SHADOW_BALL DOUBLE_EDGE GIGA_IMPACT',2],
            [898,'버드렉스','에스퍼','풀',100,80,80,80,80,80,215,0,0,'PSYCHIC ENERGY_BALL SCRATCH',1],
            [899,'신비록','노말','에스퍼',103,105,72,105,75,65,235,0,0,'QUICK_ATTACK GIGA_IMPACT PSYCHIC',0],
            [900,'사마자르','벌레','바위',70,135,95,45,70,85,215,0,0,'X_SCISSOR BUG_BUZZ STONE_EDGE',0],
            [901,'다투곰','땅','노말',130,140,105,45,80,50,255,0,0,'EARTHQUAKE PRECIPICE_BLADES GIGA_IMPACT',0],
            [902,'대쓰여너','물','고스트',120,112,65,80,75,78,239,0,0,'SURF HYDRO_PUMP SHADOW_BALL GIGA_IMPACT',0],
            [903,'포푸니크','격투','독',80,130,60,40,80,120,223,0,0,'AURA_SPHERE CLOSE_COMBAT SLUDGE_BOMB',0],
            [904,'장침바루','악','독',85,115,95,65,65,85,223,0,0,'BITE DARK_PULSE SLUDGE_BOMB',0],
            [905,'러브로스','페어리','비행',74,115,70,135,80,106,279,0,0,'DAZZLING_GLEAM MOONBLAST AIR_SLASH GIGA_IMPACT',2],
            [906,'나오하','풀',0,40,61,54,45,45,65,63,16,907,'ABSORB VINE_WHIP TACKLE',0],
            [907,'나로테','풀',0,61,80,63,60,63,83,143,36,908,'ABSORB SEED_BOMB TACKLE',0],
            [908,'마스카나','풀','악',76,110,70,81,70,123,239,0,0,'SEED_BOMB LEAF_BLADE DARK_PULSE GIGA_IMPACT',0],
            [909,'뜨아거','불꽃',0,67,45,59,63,40,36,63,16,910,'EMBER FIRE_PUNCH TACKLE',0],
            [910,'악뜨거','불꽃',0,81,55,78,90,58,49,144,36,911,'EMBER FLAMETHROWER TACKLE',0],
            [911,'라우드본','불꽃','고스트',104,75,100,110,75,66,239,0,0,'FLAMETHROWER FLARE_BLITZ SHADOW_BALL GIGA_IMPACT',0],
            [912,'꾸왁스','물',0,55,65,45,50,45,50,63,16,913,'WATER_GUN WATERFALL TACKLE',0],
            [913,'아꾸왁','물',0,70,85,65,65,60,65,143,36,914,'WATER_GUN SURF TACKLE',0],
            [914,'웨이니발','물','격투',85,120,80,85,75,85,239,0,0,'SURF HYDRO_PUMP CLOSE_COMBAT GIGA_IMPACT',0],
            [915,'맛보돈','노말',0,54,45,40,35,45,35,36,18,916,'TACKLE',0],
            [916,'퍼퓨돈','노말',0,110,100,75,59,80,65,206,0,0,'SCRATCH EXTREME_SPEED',0],
            [917,'타랜툴라','벌레',0,35,41,45,29,40,20,36,15,918,'X_SCISSOR TACKLE',0],
            [918,'트래피더','벌레',0,60,79,92,52,86,35,138,0,0,'X_SCISSOR TACKLE',0],
            [919,'콩알뚜기','벌레',0,33,46,40,21,25,45,36,24,920,'X_SCISSOR TACKLE',0],
            [920,'엑스레그','벌레','악',71,102,78,52,55,92,175,0,0,'X_SCISSOR BUG_BUZZ DARK_PULSE',0],
            [921,'빠모','전기',0,45,50,20,40,25,60,36,18,922,'THUNDER_WAVE TACKLE',0],
            [922,'빠모트','전기','격투',60,75,40,50,40,85,95,35,923,'THUNDER_WAVE THUNDER_PUNCH AURA_SPHERE',0],
            [923,'빠르모트','전기','격투',70,115,70,70,60,105,207,0,0,'THUNDER_PUNCH THUNDER_BOLT AURA_SPHERE',0],
            [924,'두리쥐','노말',0,50,50,45,40,45,75,59,25,925,'TACKLE POUND',0],
            [925,'파밀리쥐','노말',0,74,75,70,65,75,111,191,0,0,'SCRATCH EXTREME_SPEED POUND',0],
            [926,'쫀도기','페어리',0,37,55,70,30,55,65,65,26,927,'PLAY_ROUGH TACKLE',0],
            [927,'바우첼','페어리',0,57,80,115,50,80,95,197,0,0,'PLAY_ROUGH DAZZLING_GLEAM POUND',0],
            [928,'미니브','풀','노말',41,35,45,58,51,30,36,25,929,'ABSORB TACKLE',0],
            [929,'올리뇨','풀','노말',52,53,60,78,78,33,98,35,930,'ABSORB RAZOR_LEAF SCRATCH',0],
            [930,'올리르바','풀','노말',78,69,90,125,109,39,223,0,0,'RAZOR_LEAF LEAF_BLADE GIGA_IMPACT',0],
            [931,'시비꼬','노말','비행',82,96,51,45,51,92,149,0,0,'TACKLE DOUBLE_EDGE AIR_SLASH',0],
            [932,'베베솔트','바위',0,55,55,75,35,35,25,39,24,933,'ROCK_THROW TACKLE',0],
            [933,'스태솔트','바위',0,60,60,100,35,65,35,99,38,934,'ROCK_THROW ROCK_SLIDE TACKLE',0],
            [934,'콜로솔트','바위',0,100,100,130,45,90,35,215,0,0,'ROCK_SLIDE STONE_EDGE SCRATCH',0],
            [935,'카르본','불꽃',0,40,50,40,50,40,35,36,45,936,'EMBER TACKLE',0],
            [936,'카디나르마','불꽃','에스퍼',85,60,100,125,80,75,235,0,0,'FLAMETHROWER FLARE_BLITZ PSYCHIC',0],
            [937,'파라블레이즈','불꽃','고스트',75,125,80,60,100,85,235,0,0,'FLAMETHROWER FLARE_BLITZ SHADOW_BALL',0],
            [938,'빈나두','전기',0,61,31,41,59,35,45,36,42,939,'THUNDER_WAVE TACKLE',0],
            [939,'찌리배리','전기',0,109,64,91,103,83,45,211,0,0,'THUNDER_PUNCH THUNDER_BOLT SCRATCH',0],
            [940,'찌리비','전기','비행',40,40,35,55,40,70,39,25,941,'THUNDER_WAVE GUST TACKLE',0],
            [941,'찌리비크','전기','비행',70,70,60,105,60,125,207,0,0,'THUNDER_PUNCH THUNDER_BOLT AIR_SLASH',0],
            [942,'오라티프','악',0,60,78,60,40,51,51,87,30,943,'BITE TACKLE',0],
            [943,'마피티프','악',0,80,120,90,60,70,85,219,0,0,'BITE DARK_PULSE SCRATCH',0],
            [944,'땃쭈르','독','노말',40,65,35,40,35,75,47,28,945,'TOXIC POUND TACKLE',0],
            [945,'태깅구르','독','노말',63,95,65,80,72,110,203,0,0,'TOXIC SLUDGE_BOMB EXTREME_SPEED',0],
            [946,'그푸리','풀','고스트',40,65,30,45,35,60,36,40,947,'ABSORB VINE_WHIP SHADOW_BALL',0],
            [947,'공푸리','풀','고스트',55,115,70,80,70,90,199,0,0,'RAZOR_LEAF ENERGY_BALL SHADOW_BALL',0],
            [948,'들눈해','땅','풀',40,40,35,50,100,70,83,30,949,'EARTHQUAKE RAZOR_LEAF TACKLE',0],
            [949,'육파리','땅','풀',80,70,65,80,120,100,227,0,0,'EARTHQUAKE PRECIPICE_BLADES LEAF_BLADE',0],
            [950,'절벼게','바위',0,70,100,115,35,55,75,175,0,0,'ROCK_THROW ROCK_SLIDE POUND',0],
            [951,'캡싸이','풀',0,50,62,40,62,40,50,58,38,952,'ABSORB VINE_WHIP TACKLE',0],
            [952,'스코빌런','풀','불꽃',65,108,65,108,65,75,204,0,0,'RAZOR_LEAF ENERGY_BALL FLARE_BLITZ',0],
            [953,'구르데','벌레',0,41,50,60,31,58,30,36,40,954,'X_SCISSOR TACKLE',0],
            [954,'베라카스','벌레','에스퍼',75,50,85,115,100,45,191,0,0,'X_SCISSOR BUG_BUZZ PSYCHIC',0],
            [955,'하느라기','에스퍼',0,30,35,30,55,30,75,36,35,956,'PSYCHIC TACKLE',0],
            [956,'클레스퍼트라','에스퍼',0,95,60,60,101,60,105,200,0,0,'PSYCHIC POUND',0],
            [957,'어리짱','페어리','강철',50,45,45,35,64,58,53,24,958,'PLAY_ROUGH IRON_HEAD TACKLE',0],
            [958,'벼리짱','페어리','강철',65,55,55,45,82,78,119,38,959,'PLAY_ROUGH DAZZLING_GLEAM METEOR_MASH',0],
            [959,'두드리짱','페어리','강철',85,75,77,70,105,94,220,0,0,'DAZZLING_GLEAM MOONBLAST FLASH_CANNON',0],
            [960,'바다그다','물',0,10,55,25,35,25,95,36,26,961,'WATER_GUN TACKLE',0],
            [961,'바닥트리오','물',0,35,100,50,50,70,120,155,0,0,'WATER_GUN SURF TACKLE',0],
            [962,'떨구새','비행','악',70,103,85,60,85,82,203,0,0,'GUST AIR_SLASH DARK_PULSE',0],
            [963,'맨돌핀','물',0,70,45,40,45,40,75,67,38,964,'WATER_GUN WATERFALL TACKLE',0],
            [964,'돌핀맨','물',0,100,70,72,53,62,100,181,0,0,'WATERFALL HYDRO_PUMP POUND',0],
            [965,'부르롱','강철','독',45,70,63,30,45,47,55,40,966,'IRON_HEAD TOXIC TACKLE',0],
            [966,'부르르룸','강철','독',80,119,90,54,67,90,215,0,0,'METEOR_MASH FLASH_CANNON SLUDGE_BOMB',0],
            [967,'모토마','드래곤','노말',70,95,65,85,65,121,216,0,0,'OUTRAGE DRACO_METEOR EXTREME_SPEED',0],
            [968,'꿈트렁','강철',0,70,85,145,60,55,65,199,0,0,'IRON_HEAD METEOR_MASH POUND',0],
            [969,'초롱순','바위','독',48,35,42,105,60,60,95,35,970,'ROCK_THROW ROCK_SLIDE TOXIC',0],
            [970,'킬라플로르','바위','독',83,55,90,130,81,86,235,0,0,'ROCK_SLIDE STONE_EDGE SLUDGE_BOMB',0],
            [971,'망망이','고스트',0,50,61,60,30,55,34,47,30,972,'SHADOW_BALL TACKLE',0],
            [972,'묘두기','고스트',0,72,101,100,50,97,68,205,0,0,'SHADOW_BALL SCRATCH',0],
            [973,'꼬이밍고','비행','격투',82,115,74,75,64,90,215,0,0,'GUST AIR_SLASH CLOSE_COMBAT',0],
            [974,'터벅고래','얼음',0,108,68,45,30,40,43,82,39,975,'ICE_PUNCH ICE_BEAM TACKLE',0],
            [975,'우락고래','얼음',0,170,113,65,45,55,73,232,0,0,'ICE_BEAM BLIZZARD SCRATCH',0],
            [976,'가비루사','물','에스퍼',90,102,73,78,65,70,197,0,0,'WATERFALL HYDRO_PUMP PSYCHIC',0],
            [977,'어써러셔','물',0,150,100,115,65,65,35,239,0,0,'SURF HYDRO_PUMP SCRATCH GIGA_IMPACT',0],
            [978,'싸리용','드래곤','물',68,50,60,120,95,82,195,0,0,'OUTRAGE DRACO_METEOR HYDRO_PUMP',0],
            [979,'저승갓숭','격투','고스트',110,115,80,50,90,90,243,0,0,'AURA_SPHERE CLOSE_COMBAT SHADOW_BALL GIGA_IMPACT',0],
            [980,'토오','독','땅',130,75,60,45,100,20,159,0,0,'TOXIC SLUDGE_BOMB PRECIPICE_BLADES',0],
            [981,'키키링','노말','에스퍼',120,90,70,110,70,60,231,0,0,'QUICK_ATTACK GIGA_IMPACT PSYCHIC',0],
            [982,'노고고치','노말',0,125,100,80,85,75,55,231,0,0,'QUICK_ATTACK GIGA_IMPACT SCRATCH',0],
            [983,'대도각참','악','강철',100,135,120,60,85,50,255,0,0,'BITE DARK_PULSE FLASH_CANNON GIGA_IMPACT',0],
            [984,'위대한엄니','땅','격투',115,131,131,53,53,87,271,0,0,'PRECIPICE_BLADES CLOSE_COMBAT QUICK_ATTACK GIGA_IMPACT',2],
            [985,'우렁찬꼬리','페어리','에스퍼',115,65,99,65,115,111,271,0,0,'DAZZLING_GLEAM MOONBLAST PSYCHIC GIGA_IMPACT',2],
            [986,'사나운버섯','풀','악',111,127,99,79,99,55,271,0,0,'GIGA_DRAIN SOLAR_BEAM DARK_PULSE GIGA_IMPACT',2],
            [987,'날개치는머리','고스트','페어리',55,55,55,135,135,135,271,0,0,'SHADOW_BALL MOONBLAST QUICK_ATTACK GIGA_IMPACT',2],
            [988,'땅을기는날개','벌레','격투',85,135,79,85,105,81,271,0,0,'BUG_BUZZ CLOSE_COMBAT QUICK_ATTACK GIGA_IMPACT',2],
            [989,'모래털가죽','전기','땅',85,81,97,121,85,101,271,0,0,'THUNDER_BOLT THUNDER PRECIPICE_BLADES GIGA_IMPACT',2],
            [990,'무쇠바퀴','땅','강철',90,112,120,72,70,106,271,0,0,'PRECIPICE_BLADES FLASH_CANNON QUICK_ATTACK GIGA_IMPACT',2],
            [991,'무쇠보따리','얼음','물',56,80,114,124,60,136,271,0,0,'ICE_BEAM BLIZZARD ORIGIN_PULSE GIGA_IMPACT',2],
            [992,'무쇠손','격투','전기',154,140,108,50,68,50,271,0,0,'AURA_SPHERE CLOSE_COMBAT THUNDER GIGA_IMPACT',2],
            [993,'무쇠머리','악','비행',94,80,86,122,80,108,271,0,0,'DARK_PULSE AIR_SLASH QUICK_ATTACK GIGA_IMPACT',2],
            [994,'무쇠독나방','불꽃','독',80,70,60,140,110,110,271,0,0,'FLAMETHROWER SACRED_FIRE SLUDGE_BOMB GIGA_IMPACT',2],
            [995,'무쇠가시','바위','전기',100,134,110,70,84,72,271,0,0,'ROCK_SLIDE STONE_EDGE THUNDER GIGA_IMPACT',2],
            [996,'드니차','드래곤','얼음',65,75,45,35,45,55,71,35,997,'DRAGON_PULSE OUTRAGE ICE_PUNCH',0],
            [997,'드니꽁','드래곤','얼음',90,95,66,45,65,62,153,54,998,'DRAGON_PULSE DRACO_METEOR ICE_BEAM',0],
            [998,'드닐레이브','드래곤','얼음',115,145,92,75,86,87,295,0,0,'DRACO_METEOR SPACIAL_REND BLIZZARD GIGA_IMPACT',0],
            [999,'모으령','고스트',0,45,30,70,75,70,10,55,45,1000,'SHADOW_BALL TACKLE',0],
            [1000,'타부자고','강철','고스트',87,60,95,133,91,84,255,0,0,'METEOR_MASH FLASH_CANNON SHADOW_BALL GIGA_IMPACT',0],
            [1001,'총지엔','악','풀',85,85,100,95,135,70,271,0,0,'DARK_PULSE SOLAR_BEAM QUICK_ATTACK GIGA_IMPACT',2],
            [1002,'파오젠','악','얼음',80,120,80,90,65,135,271,0,0,'DARK_PULSE BLIZZARD QUICK_ATTACK GIGA_IMPACT',2],
            [1003,'딩루','악','땅',155,110,125,55,80,45,271,0,0,'DARK_PULSE PRECIPICE_BLADES QUICK_ATTACK GIGA_IMPACT',2],
            [1004,'위유이','악','불꽃',55,80,80,135,120,100,271,0,0,'DARK_PULSE SACRED_FIRE QUICK_ATTACK GIGA_IMPACT',2],
            [1005,'고동치는달','드래곤','악',105,139,71,55,101,119,287,0,0,'DRACO_METEOR SPACIAL_REND DARK_PULSE GIGA_IMPACT',2],
            [1006,'무쇠무인','페어리','격투',74,130,90,120,60,116,287,0,0,'DAZZLING_GLEAM MOONBLAST CLOSE_COMBAT GIGA_IMPACT',2],
            [1007,'코라이돈','격투','드래곤',100,135,115,85,100,135,340,0,0,'AURA_SPHERE CLOSE_COMBAT SPACIAL_REND GIGA_IMPACT',1],
            [1008,'미라이돈','전기','드래곤',100,85,100,135,115,135,340,0,0,'THUNDER_BOLT THUNDER SPACIAL_REND GIGA_IMPACT',1],
            [1009,'굽이치는물결','물','드래곤',99,83,91,125,83,109,287,0,0,'SURF ORIGIN_PULSE SPACIAL_REND GIGA_IMPACT',2],
            [1010,'무쇠잎새','풀','에스퍼',90,130,88,70,108,104,287,0,0,'GIGA_DRAIN SOLAR_BEAM PSYCHIC GIGA_IMPACT',2],
            [1011,'과미르','풀','드래곤',80,80,110,95,80,40,203,27,1019,'RAZOR_LEAF ENERGY_BALL DRACO_METEOR',0],
            [1012,'차데스','풀','고스트',40,45,45,74,54,50,61,40,1013,'ABSORB VINE_WHIP SHADOW_BALL',0],
            [1013,'그우린차','풀','고스트',71,60,106,121,80,70,221,0,0,'RAZOR_LEAF ENERGY_BALL SHADOW_BALL',0],
            [1014,'조타구','독','격투',88,128,115,58,86,80,259,0,0,'TOXIC SLUDGE_BOMB CLOSE_COMBAT GIGA_IMPACT',2],
            [1015,'이야후','독','에스퍼',88,75,66,130,90,106,259,0,0,'TOXIC SLUDGE_BOMB PSYCHIC GIGA_IMPACT',2],
            [1016,'기로치','독','페어리',88,91,82,70,125,99,259,0,0,'TOXIC SLUDGE_BOMB MOONBLAST GIGA_IMPACT',2],
            [1017,'오거폰','풀',0,80,120,84,60,96,110,255,0,0,'SEED_BOMB LEAF_BLADE QUICK_ATTACK GIGA_IMPACT',2],
            [1018,'브리두라스','강철','드래곤',90,105,130,125,65,85,295,0,0,'METEOR_MASH FLASH_CANNON SPACIAL_REND GIGA_IMPACT',0],
            [1019,'과미드라','풀','드래곤',106,80,110,120,80,44,247,0,0,'SEED_BOMB LEAF_BLADE SPACIAL_REND GIGA_IMPACT',0],
            [1020,'꿰뚫는화염','불꽃','드래곤',105,115,121,65,93,91,287,0,0,'FLAMETHROWER SACRED_FIRE SPACIAL_REND GIGA_IMPACT',0],
            [1021,'날뛰는우레','전기','드래곤',125,73,91,137,89,75,287,0,0,'THUNDER_BOLT THUNDER SPACIAL_REND GIGA_IMPACT',0],
            [1022,'무쇠암석','바위','에스퍼',90,120,80,68,108,124,287,0,0,'ROCK_SLIDE STONE_EDGE PSYCHIC GIGA_IMPACT',0],
            [1023,'무쇠감투','강철','에스퍼',90,72,100,122,108,98,287,0,0,'METEOR_MASH FLASH_CANNON PSYCHIC GIGA_IMPACT',0],
            [1024,'테라파고스','노말',0,90,65,85,65,85,60,175,0,0,'POUND DOUBLE_EDGE',1],
            [1025,'복숭악동','독','고스트',88,88,160,88,88,88,295,0,0,'SLUDGE_BOMB SHADOW_BALL DOUBLE_EDGE GIGA_IMPACT',1]
        ];

        const POKEMON_DATABASE = POKEMON_TABLE.map(row => {
            const [id, species, type1, type2, hp, atk, def, spAtk, spDef, spe,
                   expYield, evolveLv, evolveTo, skillKeys, flags, habitatKey] = row;
            const entry = {
                id, species, type1, type2: type2 || null,
                baseStats: { hp, atk, def, spAtk, spDef, spe },
                expYield,
                frontSprite: POKEMON_SPRITE_BASE + id + '.gif',
                backSprite: POKEMON_SPRITE_BASE + 'back/' + id + '.gif',
                skills: skillKeys.split(' ').map(k => SKILL_DATABASE[k]).filter(Boolean)
            };
            if (evolveLv && evolveTo) { entry.evolveLv = evolveLv; entry.evolveTo = evolveTo; }
            if (MEGA_SPRITES[id]) entry.megaSprite = MEGA_SPRITE_BASE + MEGA_SPRITES[id] + '.gif';
            if (flags & 1) entry.isLegend = true;
            if (flags & 2) entry.isRareTier = true;
            if (flags & 4) entry.isBoss = true;
            if (habitatKey) entry.habitat = TILE_TYPES[habitatKey];
            entry.learnset = buildLearnset(entry);
            return entry;
        });

        /* 애니메이션 스프라이트(gif)가 없는 종은 정지 이미지(png)로, 그마저 없으면
           앞모습으로 조용히 대체한다. 도감/파티창/전투 화면 어디서든 깨진 이미지
           아이콘이 뜨지 않도록 문서 전체에 한 번만 걸어두는 안전망이다. */
        document.addEventListener('error', (e) => {
            const img = e.target;
            if (!img || img.tagName !== 'IMG' || !img.src) return;
            const showdown = img.src.match(/\/other\/showdown\/(back\/)?(\d+)\.gif$/);
            if (showdown) {
                img.src = POKEMON_SPRITE_FALLBACK + (showdown[1] || '') + showdown[2] + '.png';
                return;
            }
            const backPng = img.src.match(/\/sprites\/pokemon\/back\/(\d+)\.png$/);
            if (backPng) img.src = POKEMON_SPRITE_FALLBACK + backPng[1] + '.png';
        }, true);

        const EVOLUTION_MIN_LEVEL = new Map();
        POKEMON_DATABASE.forEach(p => {
            if (p.evolveTo && p.evolveLv) {
                EVOLUTION_MIN_LEVEL.set(p.evolveTo, p.evolveLv);
            }
        });

        /* ==========================================================================
           7-B. 서식지(habitat) 자동 보강 (버그 수정)
           - 문제: 확장팩으로 한꺼번에 추가된 포켓몬 대부분(전체 351종 중 약 297종,
             85%)에 habitat 필드가 지정되어 있지 않았다. checkTileTrigger()의 야생
             조우 후보 필터는 "habitat===undefined이면 모든 지형에서 등장 가능"으로
             처리하기 때문에, 이 297종이 키 큰 풀숲/물/사막/설원/화산/숲 지형 전부에서
             동시에 등장 후보가 되어버렸다. 그 결과 물짱이 계열처럼 원래 물에서만
             나오도록 손수 habitat을 지정해둔 몇몇 종은 압도적으로 많은 무지정 종에
             밀려 사실상 존재감이 사라지고, 반대로 리자몽(불꽃/비행) 같은 종이 바다나
             설원에서도 태연히 나타나는 등 지형별 생태 다양성이 거의 무의미해졌다.
           - 수정: POKEMON_DATABASE 원본 데이터는 그대로 두고(수천 줄을 일일이 손으로
             고치는 대신), 로드 시점에 한 번 순회하며 habitat이 비어 있는 종에게 주 타입
             기준으로 합리적인 기본 서식지를 부여한다. 보스/전설/준전설급은 원래도
             일반 야생 조우 대상이 아니므로(별도 로직으로 처리) 그대로 둔다.
           ========================================================================== */
        const TYPE_HABITAT_FALLBACK = {
            '물': TILE_TYPES.WATER,
            '불꽃': TILE_TYPES.VOLCANO,
            '얼음': TILE_TYPES.SNOW,
            '땅': TILE_TYPES.SAND,
            '바위': TILE_TYPES.SAND,
            '풀': TILE_TYPES.FOREST,
            '벌레': TILE_TYPES.FOREST
        };
        /* [지형 확장] 지형마다 "어떤 서식지의 포켓몬이 나오는지"를 묶어준다.
           새로 생긴 지형(늪지/해변/꽃밭/동굴/유적/빙판/황무지/대숲/벚꽃숲)에도
           어울리는 야생 포켓몬이 제대로 등장하도록, 타일 → 서식지 목록으로 매핑한다.
           (예전에는 타일과 서식지가 1:1이라 새 지형에서는 후보가 0마리가 되어
            항상 같은 포켓몬만 튀어나왔다.) */
        const TILE_WILD_HABITATS = {
            [TILE_TYPES.TALL_GRASS]: [TILE_TYPES.TALL_GRASS],
            [TILE_TYPES.GRASS]:      [TILE_TYPES.TALL_GRASS],
            [TILE_TYPES.FOREST]:     [TILE_TYPES.FOREST, TILE_TYPES.TALL_GRASS],
            [TILE_TYPES.WATER]:      [TILE_TYPES.WATER],
            [TILE_TYPES.SAND]:       [TILE_TYPES.SAND],
            [TILE_TYPES.SNOW]:       [TILE_TYPES.SNOW],
            [TILE_TYPES.VOLCANO]:    [TILE_TYPES.VOLCANO],
            [TILE_TYPES.SWAMP]:      [TILE_TYPES.WATER, TILE_TYPES.TALL_GRASS],
            [TILE_TYPES.BEACH]:      [TILE_TYPES.WATER, TILE_TYPES.SAND],
            [TILE_TYPES.FLOWER]:     [TILE_TYPES.TALL_GRASS, TILE_TYPES.FOREST],
            [TILE_TYPES.CAVE]:       [TILE_TYPES.SAND, TILE_TYPES.VOLCANO],
            [TILE_TYPES.RUINS]:      [TILE_TYPES.TALL_GRASS, TILE_TYPES.SAND],
            [TILE_TYPES.ICE_FIELD]:  [TILE_TYPES.SNOW, TILE_TYPES.WATER],
            [TILE_TYPES.WASTELAND]:  [TILE_TYPES.SAND, TILE_TYPES.VOLCANO],
            [TILE_TYPES.BAMBOO]:     [TILE_TYPES.FOREST, TILE_TYPES.TALL_GRASS],
            [TILE_TYPES.CHERRY]:     [TILE_TYPES.FOREST, TILE_TYPES.TALL_GRASS]
        };

        function habitatsForTile(tile) {
            return TILE_WILD_HABITATS[tile] || [TILE_TYPES.TALL_GRASS];
        }

        POKEMON_DATABASE.forEach(p => {
            if (p.habitat === undefined && !p.isBoss && !p.isRareTier) {
                // 주 타입(type1) 우선, 없으면 보조 타입(type2) 기준으로 배정.
                // 두 타입 모두 특수 지형에 해당하지 않으면(노말/전기/에스퍼 등)
                // 실제 게임처럼 가장 흔한 지형인 "키 큰 풀숲"을 기본값으로 둔다.
                p.habitat = TYPE_HABITAT_FALLBACK[p.type1] ?? TYPE_HABITAT_FALLBACK[p.type2] ?? TILE_TYPES.TALL_GRASS;
            }
        });

        /* ==========================================================================
           8. ITEMS & SHOP DATABASE
           ========================================================================== */
        /* ==========================================================================
           8-Z. 몬스터볼 도감 (BALL_CATALOG) - 본가 시리즈의 볼 전종류
           색과 무늬를 "데이터"로만 기술하고, 실제 그림은 아래 페인터가 이 데이터에서
           그려낸다. 2D 아이콘(가방/상점)과 3D 구체 텍스처(전투 연출)가 같은 정의를
           공유하므로, 볼을 새로 추가할 때 CSS를 한 줄도 손댈 필요가 없다.
             top/bottom : 상·하 반구 색   band : 가운데 밴드   btn : 중앙 버튼
             accent/accent2 : 무늬 색     ring : 버튼 둘레 링 색(선택)
             motif : 무늬 종류            rate : 기본 포획 배율
             tier  : 상점 해금에 필요한 체육관 뱃지 수
           ========================================================================== */
        const BALL_CATALOG = {
            MONSTER: { id: 'ball_std', name: '몬스터볼', price: 200, rate: 1.0, tier: 0,
                top: '#ee1515', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#a50f0f',
                motif: 'plain', desc: '포켓몬 포획용 표준 볼.' },
            SUPER: { id: 'ball_super', name: '수퍼볼', price: 600, rate: 1.5, tier: 0,
                top: '#1f5fd0', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#e8402f', accent2: '#f2f4f8',
                motif: 'great', desc: '성능이 향상된 포획용 볼.' },
            HYPER: { id: 'ball_hyper', name: '하이퍼볼', price: 1200, rate: 2.0, tier: 2,
                top: '#232329', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#f5c518',
                motif: 'ultra', desc: '우수한 성공률을 지닌 최고급 볼.' },
            MASTER: { id: 'ball_master', name: '마스터볼', price: 30000, rate: 255, tier: 8,
                top: '#6b28c9', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#f472d0', glow: '#c084fc',
                motif: 'master', desc: '어떤 포켓몬이든 절대 놓치지 않는 전설의 볼.' },
            PREMIER: { id: 'ball_premier', name: '프리미어볼', price: 200, rate: 1.0, tier: 0,
                top: '#fbfcff', bottom: '#eceff5', band: '#1a1a22', btn: '#ffffff', accent: '#e8402f', ring: '#e8402f',
                motif: 'plain', desc: '기념 행사용으로 만들어진 새하얀 볼. 성능은 몬스터볼과 같다.' },
            HEAL: { id: 'ball_heal', name: '힐볼', price: 400, rate: 1.0, tier: 1,
                top: '#f06fa8', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#ffd9ea', ring: '#f06fa8',
                motif: 'heal', desc: '잡은 포켓몬의 HP와 상태 이상이 즉시 모두 회복된다.' },
            NEST: { id: 'ball_nest', name: '네스트볼', price: 1000, rate: 1.0, tier: 2,
                top: '#8fc93a', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#4e7d1f',
                motif: 'nest', desc: '상대의 레벨이 낮을수록 포획률이 크게 오른다.' },
            NET: { id: 'ball_net', name: '네트볼', price: 1000, rate: 1.0, tier: 2,
                top: '#1b8fa8', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#0b3a45',
                motif: 'net', desc: '물·벌레 타입 상대에게 특히 잘 듣는다.' },
            DIVE: { id: 'ball_dive', name: '다이브볼', price: 1000, rate: 1.0, tier: 3,
                top: '#2ca8e0', bottom: '#dff3fb', band: '#1a1a22', btn: '#ffffff', accent: '#0d5c88',
                motif: 'dive', desc: '물가·늪·해변에서 만난 상대에게 특히 잘 듣는다.' },
            REPEAT: { id: 'ball_repeat', name: '리피트볼', price: 1000, rate: 1.0, tier: 3,
                top: '#f2c11c', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#1a1a22',
                motif: 'repeat', desc: '이미 도감에 등록한 종족에게 특히 잘 듣는다.' },
            TIMER: { id: 'ball_timer', name: '타이머볼', price: 1000, rate: 1.0, tier: 3,
                top: '#f4f6fa', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#e8402f', accent2: '#1a1a22',
                motif: 'timer', desc: '전투가 길어질수록 포획률이 올라간다.' },
            QUICK: { id: 'ball_quick', name: '퀵볼', price: 1000, rate: 1.0, tier: 3,
                top: '#3fc3ea', bottom: '#f2c11c', band: '#1a1a22', btn: '#ffffff', accent: '#f7fbff',
                motif: 'quick', desc: '전투 첫 턴에 던지면 포획률이 폭발적으로 오른다.' },
            DUSK: { id: 'ball_dusk', name: '다크볼', price: 1000, rate: 1.0, tier: 4,
                top: '#1d3b32', bottom: '#23272d', band: '#0e0e12', btn: '#ff7a1a', accent: '#3fae72',
                motif: 'dusk', desc: '밤이나 동굴에서 특히 잘 듣는다.' },
            LUXURY: { id: 'ball_luxury', name: '럭셔리볼', price: 3000, rate: 1.0, tier: 4,
                top: '#17171d', bottom: '#17171d', band: '#e0b23a', btn: '#ffffff', accent: '#e8402f', accent2: '#e0b23a',
                motif: 'luxury', desc: '호화로운 볼. 여기서 나온 포켓몬은 경험치를 20% 더 얻는다.' },
            LEVEL: { id: 'ball_level', name: '레벨볼', price: 1000, rate: 1.0, tier: 5,
                top: '#e8402f', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#1a1a22',
                motif: 'level', desc: '내 포켓몬의 레벨이 상대보다 높을수록 잘 듣는다.' },
            LURE: { id: 'ball_lure', name: '루어볼', price: 1000, rate: 1.0, tier: 5,
                top: '#2f6fd0', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#59d7f2',
                motif: 'lure', desc: '물 위나 해변에서 만난 상대에게 잘 듣는다.' },
            MOON: { id: 'ball_moon', name: '문볼', price: 1000, rate: 1.0, tier: 5,
                top: '#1f2a5e', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#f6d64a',
                motif: 'moon', desc: '밤에 던지면 잘 듣는다.' },
            FRIEND: { id: 'ball_friend', name: '프렌드볼', price: 1000, rate: 1.0, tier: 5,
                top: '#4fae4a', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#f27a2f',
                motif: 'friend', desc: '잡은 포켓몬과 금방 친해진다. 경험치를 20% 더 얻는다.' },
            LOVE: { id: 'ball_love', name: '러브볼', price: 1000, rate: 1.0, tier: 5,
                top: '#f46ba8', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#ffe0ee',
                motif: 'love', desc: '내 선두 포켓몬과 같은 종족의 상대에게 아주 잘 듣는다.' },
            HEAVY: { id: 'ball_heavy', name: '헤비볼', price: 1000, rate: 1.0, tier: 5,
                top: '#5a6472', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#2b323b',
                motif: 'heavy', desc: '덩치가 크고 묵직한(종족값 총합이 높은) 상대에게 잘 듣는다.' },
            FAST: { id: 'ball_fast', name: '스피드볼', price: 1000, rate: 1.0, tier: 5,
                top: '#f6e05a', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#e8402f',
                motif: 'fast', desc: '발이 빠른(스피드 종족값이 높은) 상대에게 잘 듣는다.' },
            SPORT: { id: 'ball_sport', name: '경기볼', price: 1000, rate: 1.0, tier: 5,
                top: '#f0762a', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#4fae4a', accent2: '#f7fbff',
                motif: 'great', desc: '벌레잡기 대회용 볼. 벌레 타입 상대에게 잘 듣는다.' },
            SAFARI: { id: 'ball_safari', name: '사파리볼', price: 1000, rate: 1.5, tier: 5,
                top: '#8a9a4a', bottom: '#d8cf9a', band: '#1a1a22', btn: '#ffffff', accent: '#5c6b2c',
                motif: 'safari', desc: '사파리존 전용 볼. 풀숲·꽃밭·사막에서 잘 듣는다.' },
            PARK: { id: 'ball_park', name: '파크볼', price: 1000, rate: 1.0, tier: 6,
                top: '#3fae72', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#f2c11c',
                motif: 'park', desc: '자연공원용 볼. 숲·대나무·벚꽃 지형에서 잘 듣는다.' },
            DREAM: { id: 'ball_dream', name: '드림볼', price: 1500, rate: 1.0, tier: 6,
                top: '#e07ad8', bottom: '#fbe6f6', band: '#1a1a22', btn: '#ffffff', accent: '#8b3fae',
                motif: 'dream', desc: '잠듦·마비 등 상태 이상에 걸린 상대에게 아주 잘 듣는다.' },
            BEAST: { id: 'ball_beast', name: '비스트볼', price: 2500, rate: 0.5, tier: 7,
                top: '#2f7fc9', bottom: '#bfe8f5', band: '#1a1a22', btn: '#ffffff', accent: '#0d3f66',
                motif: 'beast', desc: '전설·보스급을 붙잡기 위한 특수 볼. 평범한 상대에게는 잘 듣지 않는다.' },
            CHERISH: { id: 'ball_cherish', name: '프레셔스볼', price: 5000, rate: 1.5, tier: 7,
                top: '#c9202a', bottom: '#f2f4f8', band: '#1a1a22', btn: '#ffffff', accent: '#e8c04a',
                motif: 'cherish', desc: '특별한 기념 볼. 여기서 나온 포켓몬은 경험치를 20% 더 얻는다.' }
        };

        /* 볼 id → 카탈로그 키 (저장 데이터에는 item.id만 남으므로 역인덱스가 필요하다) */
        const BALL_KEY_BY_ID = Object.fromEntries(
            Object.entries(BALL_CATALOG).map(([key, b]) => [b.id, key])
        );

        /* ==========================================================================
           8-Z1. 볼 무늬 페인터
           무늬는 "위쪽 반구를 펼친 사각형" (x, y, w, h) 안에 그린다. 2D 아이콘은 이
           사각형이 원의 위쪽 절반이고, 3D 구체 텍스처는 가로로 4번 반복되는 띠다.
           덕분에 무늬 코드를 한 벌만 유지해도 두 표현이 항상 같은 모습이 된다.
           ========================================================================== */
        function paintBallMotif(ctx, s, x, y, w, h) {
            const U = (u) => x + u * w;      // 가로 0~1
            const V = (v) => y + v * h;      // 세로 0(꼭대기)~1(밴드)
            const acc = s.accent || '#ffffff';
            const acc2 = s.accent2 || acc;
            const bar = (u0, v0, u1, v1, color) => {
                ctx.fillStyle = color;
                ctx.fillRect(U(u0), V(v0), (u1 - u0) * w, (v1 - v0) * h);
            };
            const dot = (u, v, r, color) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.ellipse(U(u), V(v), r * w, r * w, 0, 0, Math.PI * 2);
                ctx.fill();
            };
            const wave = (v, amp, color, lw) => {
                ctx.strokeStyle = color;
                ctx.lineWidth = lw * h;
                ctx.beginPath();
                for (let i = 0; i <= 40; i++) {
                    const u = i / 40;
                    const yy = V(v + Math.sin(u * Math.PI * 4) * amp);
                    if (i === 0) ctx.moveTo(U(u), yy); else ctx.lineTo(U(u), yy);
                }
                ctx.stroke();
            };

            switch (s.motif) {
                case 'great':   // 수퍼볼 - 양 어깨의 흰 띠 + 위쪽 붉은 밴드
                    bar(0.04, 0.46, 0.22, 1.0, acc2);
                    bar(0.78, 0.46, 0.96, 1.0, acc2);
                    bar(0.0, 0.33, 1.0, 0.45, acc);
                    break;
                case 'ultra':   // 하이퍼볼 - 노란 H 마크
                    bar(0.30, 0.44, 0.42, 1.0, acc);
                    bar(0.58, 0.44, 0.70, 1.0, acc);
                    bar(0.30, 0.70, 0.70, 0.82, acc);
                    break;
                case 'master': { // 마스터볼 - 분홍 M + 좌우 원
                    dot(0.16, 0.62, 0.055, acc);
                    dot(0.84, 0.62, 0.055, acc);
                    ctx.strokeStyle = acc;
                    ctx.lineWidth = 0.13 * h;
                    ctx.lineJoin = 'round';
                    ctx.beginPath();
                    ctx.moveTo(U(0.36), V(0.86));
                    ctx.lineTo(U(0.40), V(0.34));
                    ctx.lineTo(U(0.50), V(0.62));
                    ctx.lineTo(U(0.60), V(0.34));
                    ctx.lineTo(U(0.64), V(0.86));
                    ctx.stroke();
                    break;
                }
                case 'heal':    // 힐볼 - 좌우 연분홍 원
                    dot(0.18, 0.66, 0.085, acc);
                    dot(0.82, 0.66, 0.085, acc);
                    break;
                case 'nest': {  // 네스트볼 - 밴드를 따라 이어지는 잎사귀 물결
                    ctx.fillStyle = acc;
                    ctx.beginPath();
                    ctx.moveTo(U(0), V(1));
                    for (let i = 0; i <= 8; i++) {
                        const u = i / 8;
                        ctx.lineTo(U(u), V(0.70 + (i % 2 ? 0.18 : 0)));
                    }
                    ctx.lineTo(U(1), V(1));
                    ctx.closePath();
                    ctx.fill();
                    break;
                }
                case 'net':     // 네트볼 - 격자 그물
                    ctx.strokeStyle = acc;
                    ctx.lineWidth = 0.055 * h;
                    ctx.beginPath();
                    for (let i = 0; i < 5; i++) {
                        ctx.moveTo(U(i / 5 - 0.2), V(0.1));
                        ctx.lineTo(U(i / 5 + 0.22), V(1.0));
                        ctx.moveTo(U(i / 5 + 0.22), V(0.1));
                        ctx.lineTo(U(i / 5 - 0.2), V(1.0));
                    }
                    ctx.stroke();
                    break;
                case 'dive':    // 다이브볼 - 물결 두 줄
                    wave(0.40, 0.07, acc, 0.10);
                    wave(0.74, 0.07, acc, 0.10);
                    break;
                case 'repeat':  // 리피트볼 - 검은 밴드 + 반복 화살 점
                    bar(0.0, 0.24, 1.0, 0.40, acc);
                    dot(0.25, 0.68, 0.05, acc);
                    dot(0.75, 0.68, 0.05, acc);
                    break;
                case 'timer':   // 타이머볼 - 빨강/검정 세로 줄무늬
                    for (let i = 0; i < 4; i++) {
                        const u = 0.09 + i * 0.22;
                        bar(u, 0.12, u + 0.085, 1.0, i % 2 ? acc2 : acc);
                    }
                    break;
                case 'quick': { // 퀵볼 - 아래를 향한 흰 갈매기 무늬
                    ctx.strokeStyle = acc;
                    ctx.lineWidth = 0.11 * h;
                    ctx.lineCap = 'round';
                    for (let k = 0; k < 2; k++) {
                        const base = 0.36 + k * 0.30;
                        ctx.beginPath();
                        ctx.moveTo(U(0.10), V(base - 0.16));
                        ctx.lineTo(U(0.50), V(base + 0.12));
                        ctx.lineTo(U(0.90), V(base - 0.16));
                        ctx.stroke();
                    }
                    ctx.lineCap = 'butt';
                    break;
                }
                case 'dusk':    // 다크볼 - 초록 캡 + 사선 쐐기
                    bar(0.0, 0.0, 1.0, 0.22, acc);
                    ctx.fillStyle = acc;
                    for (let i = 0; i < 3; i++) {
                        const u = 0.12 + i * 0.32;
                        ctx.beginPath();
                        ctx.moveTo(U(u), V(0.26));
                        ctx.lineTo(U(u + 0.16), V(0.26));
                        ctx.lineTo(U(u + 0.05), V(0.92));
                        ctx.closePath();
                        ctx.fill();
                    }
                    break;
                case 'luxury':  // 럭셔리볼 - 금테 사이의 붉은 밴드
                    bar(0.0, 0.52, 1.0, 0.60, acc2);
                    bar(0.0, 0.60, 1.0, 0.82, acc);
                    bar(0.0, 0.82, 1.0, 0.90, acc2);
                    break;
                case 'level':   // 레벨볼 - 검은 가로 막대 두 줄
                    bar(0.0, 0.30, 1.0, 0.44, acc);
                    bar(0.0, 0.60, 1.0, 0.74, acc);
                    break;
                case 'lure':    // 루어볼 - 아래쪽 하늘색 띠 + 물결
                    bar(0.0, 0.58, 1.0, 1.0, acc);
                    wave(0.40, 0.06, acc, 0.09);
                    break;
                case 'moon': {  // 문볼 - 노란 초승달
                    ctx.fillStyle = acc;
                    ctx.beginPath();
                    ctx.ellipse(U(0.50), V(0.60), 0.155 * w, 0.155 * w, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.globalCompositeOperation = 'destination-out';
                    ctx.beginPath();
                    ctx.ellipse(U(0.57), V(0.53), 0.135 * w, 0.135 * w, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.globalCompositeOperation = 'source-over';
                    break;
                }
                case 'friend':  // 프렌드볼 - 주황 점 흩뿌리기
                    [[0.16, 0.42], [0.38, 0.72], [0.60, 0.38], [0.82, 0.68], [0.50, 0.86]]
                        .forEach(([u, v]) => dot(u, v, 0.045, acc));
                    break;
                case 'love': {  // 러브볼 - 하트
                    ctx.fillStyle = acc;
                    const cx = U(0.50), cy = V(0.58), r = 0.115 * w;
                    ctx.beginPath();
                    ctx.moveTo(cx, cy + r);
                    ctx.bezierCurveTo(cx - r * 1.6, cy - r * 0.25, cx - r * 0.72, cy - r * 1.5, cx, cy - r * 0.52);
                    ctx.bezierCurveTo(cx + r * 0.72, cy - r * 1.5, cx + r * 1.6, cy - r * 0.25, cx, cy + r);
                    ctx.fill();
                    break;
                }
                case 'heavy':   // 헤비볼 - 두꺼운 가로 리브 세 줄
                    ctx.fillStyle = acc;
                    [0.34, 0.54, 0.74].forEach(v => {
                        ctx.beginPath();
                        ctx.roundRect ? ctx.roundRect(U(0.14), V(v), 0.72 * w, 0.10 * h, 0.05 * h)
                                      : ctx.rect(U(0.14), V(v), 0.72 * w, 0.10 * h);
                        ctx.fill();
                    });
                    break;
                case 'fast':    // 스피드볼 - 속도선 세 줄
                    ctx.strokeStyle = acc;
                    ctx.lineWidth = 0.10 * h;
                    ctx.lineCap = 'round';
                    [[0.10, 0.32, 0.52, 0.46], [0.24, 0.56, 0.68, 0.70], [0.40, 0.80, 0.86, 0.94]]
                        .forEach(([u0, v0, u1, v1]) => {
                            ctx.beginPath();
                            ctx.moveTo(U(u0), V(v0));
                            ctx.lineTo(U(u1), V(v1));
                            ctx.stroke();
                        });
                    ctx.lineCap = 'butt';
                    break;
                case 'safari':  // 사파리볼 - 위장 얼룩
                    ctx.fillStyle = acc;
                    [[0.16, 0.40, 0.10, 0.07], [0.44, 0.72, 0.13, 0.08], [0.74, 0.36, 0.11, 0.06], [0.90, 0.80, 0.08, 0.05]]
                        .forEach(([u, v, rx, ry]) => {
                            ctx.beginPath();
                            ctx.ellipse(U(u), V(v), rx * w, ry * w, 0.4, 0, Math.PI * 2);
                            ctx.fill();
                        });
                    break;
                case 'park': {  // 파크볼 - 나뭇잎
                    ctx.fillStyle = acc;
                    ctx.beginPath();
                    ctx.moveTo(U(0.34), V(0.84));
                    ctx.quadraticCurveTo(U(0.34), V(0.26), U(0.68), V(0.30));
                    ctx.quadraticCurveTo(U(0.70), V(0.80), U(0.34), V(0.84));
                    ctx.fill();
                    break;
                }
                case 'dream': { // 드림볼 - 잠꼬대 Z 두 개
                    ctx.strokeStyle = acc;
                    ctx.lineWidth = 0.09 * h;
                    ctx.lineJoin = 'round';
                    [[0.24, 0.34, 0.20], [0.58, 0.54, 0.26]].forEach(([u, v, sz]) => {
                        ctx.beginPath();
                        ctx.moveTo(U(u), V(v));
                        ctx.lineTo(U(u + sz), V(v));
                        ctx.lineTo(U(u), V(v + sz * 1.5));
                        ctx.lineTo(U(u + sz), V(v + sz * 1.5));
                        ctx.stroke();
                    });
                    break;
                }
                case 'beast':   // 비스트볼 - 짙은 파랑 밴드와 사각 마크
                    bar(0.0, 0.22, 1.0, 0.38, acc);
                    bar(0.14, 0.52, 0.34, 0.88, acc);
                    bar(0.66, 0.52, 0.86, 0.88, acc);
                    break;
                case 'cherish': { // 프레셔스볼 - 금색 리본과 별
                    bar(0.0, 0.26, 1.0, 0.38, acc);
                    ctx.fillStyle = acc;
                    const cx = U(0.50), cy = V(0.62), R = 0.155 * w;
                    ctx.beginPath();
                    for (let i = 0; i < 10; i++) {
                        const ang = -Math.PI / 2 + i * Math.PI / 5;
                        const rr = i % 2 ? R * 0.45 : R;
                        const px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr;
                        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                    }
                    ctx.closePath();
                    ctx.fill();
                    break;
                }
                default:
                    break;      // plain - 무늬 없음
            }
        }

        /* 3D 구체용 등장방형(equirectangular) 텍스처. 위 절반=상단 반구, 아래 절반=하단.
           무늬는 둘레를 따라 4번 반복시켜 어느 각도에서 봐도 같은 볼로 읽히게 한다. */
        function paintBallTexture(ctx, s, W, H) {
            const bandTop = H * 0.455, bandBot = H * 0.545;
            ctx.clearRect(0, 0, W, H);
            ctx.fillStyle = s.top;    ctx.fillRect(0, 0, W, bandTop);
            ctx.fillStyle = s.bottom; ctx.fillRect(0, bandBot, W, H - bandBot);
            for (let i = 0; i < 4; i++) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(i * W / 4, 0, W / 4, bandTop);
                ctx.clip();
                paintBallMotif(ctx, s, i * W / 4, H * 0.06, W / 4, bandTop - H * 0.06);
                ctx.restore();
            }
            ctx.fillStyle = s.band;   ctx.fillRect(0, bandTop, W, bandBot - bandTop);
            // 밴드 위아래 하이라이트로 금속 테 느낌을 낸다
            ctx.fillStyle = 'rgba(255,255,255,0.20)'; ctx.fillRect(0, bandTop, W, H * 0.012);
            ctx.fillStyle = 'rgba(0,0,0,0.30)';       ctx.fillRect(0, bandBot - H * 0.012, W, H * 0.012);
        }

        /* 2D 아이콘/폴백용 정면 스프라이트. 구체 음영 + 밴드 + 버튼까지 한 번에 그린다. */
        function paintBallSprite(ctx, s, size) {
            const r = size / 2, cx = r, cy = r;
            const bandTop = cy - size * 0.045, bandBot = cy + size * 0.045;
            ctx.clearRect(0, 0, size, size);
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, r - size * 0.03, 0, Math.PI * 2);
            ctx.clip();

            ctx.fillStyle = s.top;    ctx.fillRect(0, 0, size, bandTop);
            ctx.fillStyle = s.bottom; ctx.fillRect(0, bandBot, size, size - bandBot);
            paintBallMotif(ctx, s, size * 0.06, size * 0.07, size * 0.88, bandTop - size * 0.07);
            ctx.fillStyle = s.band;   ctx.fillRect(0, bandTop, size, bandBot - bandTop);

            // 구체 음영 - 좌상단 하이라이트 / 우하단 그림자
            let g = ctx.createRadialGradient(cx - r * 0.34, cy - r * 0.42, r * 0.04, cx - r * 0.3, cy - r * 0.38, r * 1.05);
            g.addColorStop(0, 'rgba(255,255,255,0.85)');
            g.addColorStop(0.17, 'rgba(255,255,255,0.30)');
            g.addColorStop(0.45, 'rgba(255,255,255,0)');
            ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
            g = ctx.createRadialGradient(cx + r * 0.42, cy + r * 0.5, r * 0.05, cx + r * 0.3, cy + r * 0.35, r * 1.1);
            g.addColorStop(0, 'rgba(0,0,0,0.42)');
            g.addColorStop(0.55, 'rgba(0,0,0,0.12)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
            ctx.restore();

            // 외곽선
            ctx.strokeStyle = '#15151c';
            ctx.lineWidth = Math.max(1, size * 0.055);
            ctx.beginPath();
            ctx.arc(cx, cy, r - size * 0.035, 0, Math.PI * 2);
            ctx.stroke();

            // 중앙 버튼 - 바깥 검은 링 / 금속 링 / 코어
            const rings = [[0.165, '#15151c'], [0.128, s.ring || '#a8aeba'], [0.098, '#15151c']];
            rings.forEach(([rad, color]) => {
                ctx.fillStyle = color;
                ctx.beginPath(); ctx.arc(cx, cy, size * rad, 0, Math.PI * 2); ctx.fill();
            });
            const bg = ctx.createRadialGradient(cx - size * 0.03, cy - size * 0.035, size * 0.005, cx, cy, size * 0.082);
            bg.addColorStop(0, '#ffffff');
            bg.addColorStop(0.55, s.btn || '#ffffff');
            bg.addColorStop(1, 'rgba(0,0,0,0.25)');
            ctx.fillStyle = bg;
            ctx.beginPath(); ctx.arc(cx, cy, size * 0.078, 0, Math.PI * 2); ctx.fill();
        }

        /* 아이콘 data URL 캐시 - 가방/상점을 열 때마다 27개를 다시 그리지 않는다 */
        const _ballIconCache = {};
        function ballIconDataUrl(key, size) {
            const s = BALL_CATALOG[key];
            if (!s) return '';
            const px = size || 44;
            const ck = key + '@' + px;
            if (_ballIconCache[ck]) return _ballIconCache[ck];
            const cnv = document.createElement('canvas');
            cnv.width = cnv.height = px;
            paintBallSprite(cnv.getContext('2d'), s, px);
            return (_ballIconCache[ck] = cnv.toDataURL('image/png'));
        }

        /* ==========================================================================
           8-Z2. 볼별 포획 보정
           본가의 "볼 보정(ball bonus)"을 상황 맥락(ctx)에 따라 계산한다. 어떤 볼을
           언제 쓰느냐가 실제로 의미를 갖게 하는 핵심 로직이다.
           ========================================================================== */
        function ballCatchMultiplier(key, ctx) {
            const T = TILE_TYPES;
            const foe = ctx.foe || {};
            const mine = ctx.mine || {};
            const hasType = (...list) => list.includes(foe.type1) || list.includes(foe.type2);
            const bst = foe.baseStats ? Object.values(foe.baseStats).reduce((a, b) => a + b, 0) : 0;
            switch (key) {
                case 'NEST':   return foe.level <= 30 ? Math.max(1, (41 - foe.level) / 10) : 1;
                case 'NET':    return hasType('물', '벌레') ? 3.5 : 1;
                case 'DIVE':   return [T.WATER, T.BEACH, T.SWAMP].includes(ctx.tile) ? 3.5 : 1;
                case 'REPEAT': return ctx.dexKnown ? 3.5 : 1;
                case 'TIMER':  return Math.min(4, 1 + (ctx.turn || 0) * 0.35);
                case 'QUICK':  return (ctx.turn || 0) <= 0 ? 5 : 1;
                case 'DUSK':   return (ctx.night || ctx.tile === T.CAVE || ctx.tile === T.RUINS) ? 3 : 1;
                case 'LEVEL':  return mine.level >= foe.level * 2 ? 4 : (mine.level > foe.level ? 2 : 1);
                case 'LURE':   return [T.WATER, T.BEACH].includes(ctx.tile) ? 4 : 1;
                case 'MOON':   return ctx.night ? 4 : 1;
                case 'LOVE':   return mine.species === foe.species ? 8 : 1;
                case 'HEAVY':  return bst >= 540 ? 3.5 : (bst >= 440 ? 2 : 1);
                case 'FAST':   return (foe.baseStats && foe.baseStats.spe >= 100) ? 4 : 1;
                case 'SPORT':  return hasType('벌레') ? 3.5 : 1;
                case 'SAFARI': return [T.TALL_GRASS, T.SAND, T.FLOWER, T.WASTELAND].includes(ctx.tile) ? 2.5 : 1;
                case 'PARK':   return [T.FOREST, T.BAMBOO, T.CHERRY].includes(ctx.tile) ? 3 : 1;
                case 'DREAM':  return (foe.status && foe.status !== STATUS_EFFECTS.NONE) ? 4 : 1;
                case 'BEAST':  return (foe.isLegend || foe.isRareTier || foe.isBoss) ? 5 : 0.4;
                default:       return 1;
            }
        }

        const ITEM_DATABASE = {
            /* [가격 밸런스 개편] 실제 게임의 가격표를 기준으로 다시 잡았다. 예전에는
               상금이 회당 8000G씩 쏟아지는데 회복약은 300G라 "돈이 남아돌아 아이템이
               의미 없는" 상태였다. 이제 상금을 크게 낮춘 대신, 볼·회복약 값도 실제
               게임 수준으로 맞춰 초반에는 한 개 한 개를 아껴 쓰게 된다. */
            /* 볼은 위 BALL_CATALOG(8-Z)에서 통째로 생성한다 - 27종 전부가 아이템이 된다.
               키는 <카탈로그키>_BALL 형태이므로 기존 코드의 ITEM_DATABASE.MONSTER_BALL /
               SUPER_BALL / HYPER_BALL / MASTER_BALL 참조가 그대로 유효하다. */
            ...Object.fromEntries(Object.entries(BALL_CATALOG).map(([key, b]) => [key + '_BALL', {
                id: b.id, name: b.name, price: b.price, desc: b.desc,
                catchRate: b.rate, ballKey: key, ballTier: b.tier
            }])),
            /* 필드 전용 - 가방에서 바로 쓰면 60초 동안 야생 조우가 멈춘다.
               레벨대가 높은 지역을 가로질러 다음 마을로 이동할 때 쓰라고 만든 아이템이다. */
            REPEL: { id: 'repel', name: '벌레퇴치스프레이', price: 400, repelSec: 60, emoji: '🧴',
                desc: '60초 동안 야생 포켓몬이 나타나지 않는다. (필드에서 사용)' },
            POTION: { id: 'heal_small', name: '상처약', healAmount: 20, price: 200, desc: 'HP를 20 회복시킨다.' },
            SUPER_POTION: { id: 'heal_mid', name: '좋은상처약', healAmount: 50, price: 550, desc: 'HP를 50 회복시킨다.' },
            HYPER_POTION: { id: 'heal_hyper', name: '고급상처약', healAmount: 120, price: 1100, desc: 'HP를 120 회복시킨다.' },
            MAX_POTION: { id: 'heal_max', name: '풀회복약', healAmount: 999, price: 2200, desc: 'HP를 모두 회복시킨다.' },
            REVIVE: { id: 'heal_revive', name: '기력의조각', healAmount: 0, price: 1500, isRevive: true, desc: '기절한 포켓몬을 HP 절반으로 되살린다.' },
            ANTIDOTE: { id: 'cure_poison', name: '해독제', cures: STATUS_EFFECTS.POISON, price: 100, desc: '독 상태를 치유한다.' },
            PARALYZE_HEAL: { id: 'cure_paralyze', name: '마비치료제', cures: STATUS_EFFECTS.PARALYSIS, price: 200, desc: '마비 상태를 치유한다.' },
            BURN_HEAL: { id: 'cure_burn', name: '화상치료제', cures: STATUS_EFFECTS.BURN, price: 250, desc: '화상 상태를 치유한다.' },
            ICE_HEAL: { id: 'cure_freeze', name: '냉동치료제', cures: STATUS_EFFECTS.FREEZE, price: 250, desc: '냉동 상태를 치유한다.' },
            AWAKENING: { id: 'cure_sleep', name: '각성제', cures: STATUS_EFFECTS.SLEEP, price: 200, desc: '수면 상태를 치유한다.' },
            FULL_HEAL: { id: 'cure_all', name: '만능치료제', cures: 'ANY', price: 600, desc: '모든 상태 이상과 혼란을 한 번에 치유한다.' },

            /* ==================================================================
               8-A. 전설의 사원 소환 아이템 (성물)
               각 사원 타일 위에서 해당 성물을 사용해야만 전설의 포켓몬이 강림한다.
               일반 필드에서는 절대 전설의 포켓몬과 마주칠 수 없다.
               ================================================================== */
            RED_ORB: { id: 'orb_red', name: '레드오브', price: 12000, isSummonOrb: true, emoji: '🔶', desc: '대지의 사원에서 그란돈을 불러내는 붉은 성물.' },
            BLUE_ORB: { id: 'orb_blue', name: '블루오브', price: 12000, isSummonOrb: true, emoji: '🔷', desc: '바다의 사원에서 가이오가를 불러내는 푸른 성물.' },
            SKY_FEATHER: { id: 'orb_sky', name: '천공의깃털', price: 12000, isSummonOrb: true, emoji: '🪶', desc: '하늘의 사원에서 레쿠쟈를 불러내는 신비한 깃털.' }
        };

        /* ==========================================================================
           8-B. 공용 스탯 계산 / 스킬 인스턴스화 헬퍼
           - computeStatsAtLevel: 종족값+개체값+노력치+성격+레벨로 실제 스탯을 계산한다.
             레벨업/포켓몬 생성 양쪽에서 동일한 공식을 재사용해, 예전처럼 "레벨업할 때
             특공/특방/스피드는 그대로인" 버그가 나지 않도록 한다.
           - instantiateSkills: 종족 데이터의 skills 배열(SKILL_DATABASE 공유 참조)을
             복사해 각 포켓몬 개체마다 독립적인 PP를 갖도록 만든다.
           ========================================================================== */
        /* ==========================================================================
           8-B0. 경험치 시스템 (닌텐도 공식 재현)
           - 성장 곡선: 실제 게임의 "중간(medium-fast)" 곡선인 총 경험치 = 레벨³.
             따라서 다음 레벨까지 필요한 양은 (L+1)³ - L³ 이다.
           - 획득량: 실제 게임 공식 그대로 (상대 종족 기초경험치 × 상대 레벨 ÷ 7),
             트레이너전은 1.5배. 예전에는 종족 기초경험치를 레벨과 무관하게 그대로
             주고 필요 경험치는 1.2^레벨로 폭증해서, 레벨이 조금만 올라도 한 마리
             잡아봐야 경험치 바가 거의 움직이지 않았다.
           ========================================================================== */
        function expToNextLevel(level) {
            const L = Math.max(1, level);
            return Math.max(1, Math.pow(L + 1, 3) - Math.pow(L, 3));
        }

        function computeExpReward(foe, isTrainerBattle) {
            const base = foe.expYield || Math.round(Object.values(foe.baseStats || {}).reduce((a, b) => a + b, 0) * 0.55) || 60;
            const gain = (base * (foe.level || 5)) / 7 * (isTrainerBattle ? 1.5 : 1);
            return Math.max(1, Math.floor(gain));
        }

        function computeStatsAtLevel(baseStats, level, ivs, evs, nature) {
            const maxHp = Math.floor((baseStats.hp * 2 + ivs.hp + Math.floor(evs.hp / 4)) * level / 100) + level + 10;
            const atk = Math.floor((Math.floor((baseStats.atk * 2 + ivs.atk + Math.floor(evs.atk / 4)) * level / 100) + 5) * nature.atkMod);
            const def = Math.floor((Math.floor((baseStats.def * 2 + ivs.def + Math.floor(evs.def / 4)) * level / 100) + 5) * nature.defMod);
            const spAtk = Math.floor((Math.floor((baseStats.spAtk * 2 + ivs.spAtk + Math.floor(evs.spAtk / 4)) * level / 100) + 5) * nature.spAtkMod);
            const spDef = Math.floor((Math.floor((baseStats.spDef * 2 + ivs.spDef + Math.floor(evs.spDef / 4)) * level / 100) + 5) * nature.spDefMod);
            const spe = Math.floor((Math.floor((baseStats.spe * 2 + ivs.spe + Math.floor(evs.spe / 4)) * level / 100) + 5) * nature.speMod);
            return { maxHp, atk, def, spAtk, spDef, spe };
        }

        function instantiateSkills(skillsArray) {
            return (skillsArray || []).map(sk => {
                const maxPp = computeMaxPP(sk);
                return { ...sk, maxPp, pp: maxPp };
            });
        }

        /* ==========================================================================
           9. CORE GAME ENGINE CLASS
           ========================================================================== */
        class GameEngine {
            constructor() {
                this.canvas = document.getElementById('gameCanvas');
                this.ctx = this.canvas.getContext('2d');
                this.minimapCanvas = document.getElementById('minimapCanvas');
                this.minimapCtx = this.minimapCanvas.getContext('2d');

                this.state = GAME_STATES.STARTER_SELECT;
                this.weatherIdx = 0;

                // 절차적 월드 시드 - 세이브에는 이 숫자 하나만 기록하면 지도 전체가 복원된다.
                this.worldSeed = (Math.random() * 0xFFFFFFFF) >>> 0;
                this.wrnd = makeSeededRng(this.worldSeed);

                // 연속적인 하루 주기(0=자정, 0.5=정오). 예전엔 45초마다 낮/밤이 뚝 끊기듯
                // 뒤집혔지만, 이제 새벽→아침→낮→저녁→해질녘→밤이 매 프레임 부드럽게
                // 이어지고 화면 색조/조명도 그에 맞춰 연속적으로 보간된다.
                this.timeOfDay = 0.42;
                this.isNight = false;
                this.timePhase = sampleTimePhase(this.timeOfDay);

                // 모험 기록(플레이 통계) - 세이브에 함께 저장되어 [R]키 기록 화면에 표시된다.
                this.stats = {
                    playSec: 0, steps: 0, encounters: 0, captures: 0,
                    battlesWon: 0, battlesLost: 0, runAways: 0, gymWins: 0,
                    legendsCaught: 0, megaEvolutions: 0, itemsUsed: 0,
                    startedAt: Date.now(), highestLevel: 1, totalDamage: 0
                };
                this.unlockedAchievements = new Set();
                this.lastSaveAt = 0;
                this._lastTimeTick = performance.now();
                this.isRidingBike = false;
                this.isTurnProcessing = false;
                // 기절 후 강제 교체 버그 수정용 플래그 - 상대(적)의 공격으로 내 포켓몬이
                // 기절해 강제로 파티 모달이 열린 경우에만 true로 설정된다. 이 경우 새
                // 포켓몬이 나오자마자 다시 적의 공격을 받아서는 안 된다(이미 이번 턴에
                // 적이 행동을 마쳤기 때문). 반면 자발적 교체나, 반동 데미지 등으로 내
                // 턴 중에 기절해 교체하는 경우는 적이 아직 이번 턴 행동을 하지 않았으므로
                // 교체 후 정상적으로 적 턴이 진행되어야 한다 - 그런 경우엔 이 플래그를
                // 세우지 않는다.
                this.forcedSwitchAfterEnemyMove = false;
                // 야생 포켓몬 조우 쿨다운 카운터 - 이동할 때마다 1씩 증가하고,
                // 조우가 발생하면 0으로 초기화된다. 최소 걸음 수를 보장해
                // "한 칸 갈 때마다" 조우가 뜨는 문제를 방지한다.
                this.stepsSinceEncounter = 0;

                // 이동키 꾹 누르기(OS 키 반복) 대응 - 실제로 눌려있는 이동키 목록과
                // 마지막으로 한 칸 이동한 시각을 기록해, moveDuration 간격으로만
                // 이동을 허용한다 (더 이상 raw keydown 이벤트 속도에 좌우되지 않음)
                this.heldMoveKeys = new Set();
                this.lastStepTime = 0;

                this.player = {
                    x: 16,
                    y: 16,
                    direction: 'down', // down, up, left, right
                    animStep: 0,
                    visX: 16,
                    visY: 16,
                    moveFromX: 16,
                    moveFromY: 16,
                    moveStart: 0,
                    moveDuration: 130,
                    gold: 3000,
                    badges: 0,
                    party: [],
                    pokedex: new Set(),
                    // 실제로 "포획에 성공한" 종족 - 리피트볼 보정 판정에 쓴다.
                    // (pokedex는 조우만 해도 등록되므로 구분이 필요하다)
                    caughtSpecies: new Set(),
                    activeIdx: 0,
                    inventory: [
                        { item: ITEM_DATABASE.MONSTER_BALL, count: 20 },
                        { item: ITEM_DATABASE.SUPER_BALL, count: 10 },
                        { item: ITEM_DATABASE.HYPER_BALL, count: 5 },
                        { item: ITEM_DATABASE.REPEL, count: 2 },
                        { item: ITEM_DATABASE.POTION, count: 15 },
                        { item: ITEM_DATABASE.ANTIDOTE, count: 5 }
                    ],
                    // 마음의 엠블럼(GEM) 인벤토리 - 스킬 커스텀 & 융합 시스템
                    gemInventory: [
                        { key: 'PINK_HEART', count: 2 },
                        { key: 'GOLDEN_TOPAZ', count: 2 },
                        { key: 'EMERALD_LEAF', count: 2 }
                    ],
                    // 파티가 가득 찼을 때(6마리) 포획한 포켓몬을 보관하는 PC 보관함.
                    // 예전에는 파티가 가득 차면 "PC로 전송되었다"는 안내만 뜨고
                    // 실제로는 어디에도 저장되지 않은 채 그냥 사라졌다(포켓몬 유실 버그).
                    box: [],
                    // 마을별 체육관 최초 격파 여부 - 뱃지/상금이 재도전 때마다 무한정
                    // 쌓이던 버그를 막기 위해 마을 이름을 키로 추적한다.
                    defeatedGyms: new Set(),
                    // 포스트게임 챔피언 격파 여부 - 최초 격파 시 큰 상금을 지급하고,
                    // 이후 재대결은 소액 상금만 주는 친선전으로 처리한다.
                    championDefeated: false,
                    // 이미 이긴 길목 트레이너와 선물을 받은 주민 (세이브에 함께 저장된다)
                    defeatedTrainers: new Set(),
                    receivedGifts: new Set()
                };

                this.worldMap = [];
                this.currentEnemy = null;
                this.enemyTeamQueue = []; // 체육관 관장전에서 아직 내보내지 않은 나머지 포켓몬 ID 목록
                this.currentChampionChallenge = false; // 현재 전투가 포스트게임 챔피언전인지 여부
                this.particles = [];
                this.weatherParticles = []; // 비/눈/모래바람 상시 파티클 (날씨 텍스트만 있던 것을 실제 시각효과로 업그레이드)
                this.skillEffects = []; // 스킬 사용 시 날아가는 타입별 투사체 이펙트 목록

                this.buildFieldArt();
                this.initWorldMap();
                this.buildMinimapBaseLayer();
                this.init3D();
                this.buildBattleStage3D();
                this.renderStarterModal();
                this.bindInputEvents();
                this.startTimeCycle();
            }

            /* [업그레이드] 낮/밤이 45초마다 뚝 끊기듯 뒤집히던 연출을, 실제 상용 RPG처럼
               새벽→아침→낮→저녁→해질녘→밤이 매 프레임 연속적으로 흘러가는 하루 주기로
               교체했다. 화면 색조·조명·HUD 라벨이 모두 이 timeOfDay 하나에서 파생된다.
               동시에 플레이 시간 통계도 여기서 누적한다. */
            startTimeCycle() {
                this._lastTimeTick = performance.now();
                setInterval(() => {
                    const now = performance.now();
                    const dt = Math.min(2, (now - this._lastTimeTick) / 1000);
                    this._lastTimeTick = now;

                    if (this.state !== GAME_STATES.STARTER_SELECT && !this.titleScreenActive) {
                        this.stats.playSec += dt;
                    }
                    this.timeOfDay = (this.timeOfDay + dt / DAY_CYCLE_SEC) % 1;
                    this.timePhase = sampleTimePhase(this.timeOfDay);
                    this.isNight = this.timePhase.alpha > 0.30;

                    const timeEl = document.getElementById('hud-time');
                    if (timeEl) {
                        const totalMin = Math.floor(this.timeOfDay * 1440);
                        const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
                        const mm = String(totalMin % 60).padStart(2, '0');
                        timeEl.innerText = `${hh}:${mm} ${this.timePhase.label}`;
                    }

                    // 벌레퇴치스프레이 남은 시간도 같은 주기로 깎아 보여준다
                    const repelEl = document.getElementById('hud-repel');
                    if (repelEl) {
                        const leftMs = this.repelRemainingMs();
                        repelEl.style.display = leftMs > 0 ? 'block' : 'none';
                        if (leftMs > 0) repelEl.innerHTML = `🧴 벌레퇴치 <b>${Math.ceil(leftMs / 1000)}초</b>`;
                    }
                }, 250);

                // 30초마다 조용히 자동 저장 (전투 중에는 건너뛴다)
                setInterval(() => {
                    if (this.state === GAME_STATES.FIELD && this.player.party.length > 0) this.saveGame(true);
                }, 30000);
            }

            /* ==========================================================================
               1-S. 세이브 / 로드 시스템
               브라우저 localStorage에 모험 전체(파티·보관함·도감·소지품·좌표·시드·
               통계·업적)를 JSON으로 저장한다. 절차적으로 생성되는 지도는 시드 하나만
               저장하고 불러올 때 똑같이 재생성하므로 세이브 용량이 작다.
               ========================================================================== */
            serializeSave() {
                const pk = p => {
                    const copy = JSON.parse(JSON.stringify(p));
                    delete copy.learnset; // 도감 데이터에서 다시 붙이므로 저장하지 않는다
                    return copy;
                };
                return {
                    version: SAVE_VERSION,
                    savedAt: Date.now(),
                    worldSeed: this.worldSeed,
                    timeOfDay: this.timeOfDay,
                    weatherIdx: this.weatherIdx,
                    postFx: !!this.postFxEnabled,
                    stats: { ...this.stats },
                    achievements: [...this.unlockedAchievements],
                    player: {
                        x: this.player.x, y: this.player.y,
                        direction: this.player.direction,
                        gold: this.player.gold,
                        badges: this.player.badges,
                        activeIdx: this.player.activeIdx,
                        party: this.player.party.map(pk),
                        box: this.player.box.map(pk),
                        pokedex: [...this.player.pokedex],
                        caughtSpecies: [...(this.player.caughtSpecies || [])],
                        inventory: this.player.inventory.map(slot => ({ id: slot.item.id, count: slot.count })),
                        gemInventory: this.player.gemInventory.map(g => ({ key: g.key, count: g.count })),
                        repelSecLeft: Math.ceil(this.repelRemainingMs() / 1000),
                        defeatedGyms: [...this.player.defeatedGyms],
                        defeatedTrainers: [...(this.player.defeatedTrainers || [])],
                        receivedGifts: [...(this.player.receivedGifts || [])],
                        championDefeated: !!this.player.championDefeated
                    }
                };
            }

            saveGame(silent) {
                if (this.player.party.length === 0) return false;
                try {
                    localStorage.setItem(SAVE_KEY, JSON.stringify(this.serializeSave()));
                    this.lastSaveAt = Date.now();
                    if (!silent) {
                        showToast('💾 모험을 저장했습니다!');
                        playSfx('save');
                    }
                    const badge = document.getElementById('save-indicator');
                    if (badge) {
                        badge.classList.add('show');
                        setTimeout(() => badge.classList.remove('show'), 1400);
                    }
                    return true;
                } catch (e) {
                    // 자동 저장이 실패해도 한 번은 반드시 알린다 - 조용히 실패하면
                    // 플레이어는 다음에 접속해서야 진행이 통째로 날아간 걸 알게 된다.
                    if (!silent || !this._saveFailNotified) {
                        this._saveFailNotified = true;
                        showToast('⚠️ 저장에 실패했습니다. ' + storageHelpText());
                    }
                    return false;
                }
            }

            /* 저장된 데이터를 현재 게임 인스턴스에 적용한다. 지도는 저장된 시드로
               완전히 동일하게 재생성한다. */
            applySave(data) {
                if (!data || !data.player) return false;

                this.worldSeed = data.worldSeed >>> 0;
                this.wrnd = makeSeededRng(this.worldSeed);
                this.initWorldMap();
                this.buildMinimapBaseLayer();

                const P = data.player;
                this.player.x = P.x; this.player.y = P.y;
                this.player.visX = P.x; this.player.visY = P.y;
                this.player.moveFromX = P.x; this.player.moveFromY = P.y;
                this.player.direction = P.direction || 'down';
                this.player.gold = P.gold;
                this.player.badges = P.badges;
                this.player.activeIdx = P.activeIdx || 0;
                this.player.party = (P.party || []).map(p => this.rehydratePokemon(p));
                this.player.box = (P.box || []).map(p => this.rehydratePokemon(p));
                this.player.pokedex = new Set(P.pokedex || []);
                this.player.caughtSpecies = new Set(P.caughtSpecies || []);
                this.player.defeatedGyms = new Set(P.defeatedGyms || []);
                this.player.defeatedTrainers = new Set(P.defeatedTrainers || []);
                this.player.receivedGifts = new Set(P.receivedGifts || []);
                this.player.championDefeated = !!P.championDefeated;

                const allItems = Object.values(ITEM_DATABASE);
                this.player.inventory = (P.inventory || [])
                    .map(slot => ({ item: allItems.find(it => it.id === slot.id), count: slot.count }))
                    .filter(slot => slot.item && slot.count > 0);
                this.player.gemInventory = (P.gemInventory || []).filter(g => GEM_DATABASE[g.key]);
                // 스프레이는 남은 "초"로 저장해 두었다가 불러올 때 다시 시각으로 환산한다
                const repelLeft = Math.max(0, Number(P.repelSecLeft) || 0);
                this.repelUntil = repelLeft > 0 ? Date.now() + repelLeft * 1000 : 0;
                this._repelExpiredNotified = false;

                this.timeOfDay = typeof data.timeOfDay === 'number' ? data.timeOfDay : 0.42;
                this.timePhase = sampleTimePhase(this.timeOfDay);
                this.weatherIdx = data.weatherIdx || 0;
                if (typeof data.postFx === 'boolean' && this.postFxReady) {
                    this.postFxEnabled = data.postFx;
                    this._postFxVisible = null;
                }
                this.stats = Object.assign({
                    playSec: 0, steps: 0, encounters: 0, captures: 0,
                    battlesWon: 0, battlesLost: 0, runAways: 0, gymWins: 0,
                    legendsCaught: 0, megaEvolutions: 0, itemsUsed: 0,
                    startedAt: Date.now(), highestLevel: 1, totalDamage: 0
                }, data.stats || {});
                this.unlockedAchievements = new Set(data.achievements || []);

                if (this.player.party.length === 0) return false;
                if (this.player.activeIdx >= this.player.party.length) this.player.activeIdx = 0;

                this.state = GAME_STATES.FIELD;
                this.updateUI();
                return true;
            }

            /* JSON으로 저장됐다 돌아온 포켓몬 객체에서, 세이브 이후 데이터베이스가
               바뀌었을 수 있는 항목(스프라이트 주소·종족값·기술 위력 등)을 최신
               데이터로 다시 이어 붙인다. 레벨/개체값/경험치/HP 같은 "내 포켓몬만의
               기록"은 저장된 값을 그대로 유지한다. */
            rehydratePokemon(saved) {
                const db = POKEMON_DATABASE.find(p => p.id === saved.id);
                const merged = db ? { ...db, ...saved } : { ...saved };
                merged.statStages = Object.assign(makeEmptyStatStages(), saved.statStages || {});
                merged.gemSlots = saved.gemSlots || {};
                merged.skills = (saved.skills || []).map(sk => {
                    const base = SKILL_DATABASE[sk.name];
                    return base ? { ...base, ...sk } : sk;
                });
                if (!merged.skills.length && db) merged.skills = instantiateSkills(db.skills);
                merged.isMega = false;
                merged.hp = Math.max(0, Math.min(merged.hp, merged.maxHp));
                // 경험치 곡선이 닌텐도 공식으로 바뀌었으므로, 예전 세이브의 값도 새 곡선에 맞춘다
                if (db) merged.learnset = db.learnset;
                merged.maxExp = expToNextLevel(merged.level);
                merged.exp = Math.max(0, Math.min(merged.exp || 0, merged.maxExp - 1));
                return merged;
            }

            /* ==========================================================================
               1-T. 업적 판정 - 주요 사건(포획/승리/레벨업/뱃지 등)마다 호출된다.
               ========================================================================== */
            checkAchievements() {
                ACHIEVEMENTS.forEach(a => {
                    if (this.unlockedAchievements.has(a.id)) return;
                    let ok = false;
                    try { ok = a.check(this); } catch (e) { ok = false; }
                    if (ok) {
                        this.unlockedAchievements.add(a.id);
                        showAchievementPopup(a);
                    }
                });
            }

            /* ==========================================================================
               9-D. 3D 필드 렌더러 (Three.js)
               타일맵/이동/인카운터 등 게임 로직은 전혀 건드리지 않고, 필드 화면을
               2D canvas 대신 실제 3D 씬으로 그린다. 성능을 위해 플레이어 주변의
               "청크"만 실시간으로 빌드하고, 타일 종류별로 InstancedMesh를 사용한다.
               ========================================================================== */
            init3D() {
                this.threeCanvas = document.getElementById('threeCanvas');
                this.renderer3D = new THREE.WebGLRenderer({ canvas: this.threeCanvas, antialias: true });
                this.renderer3D.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
                this.renderer3D.setSize(900, 650, false);
                this.renderer3D.shadowMap.enabled = true;
                this.renderer3D.shadowMap.type = THREE.PCFSoftShadowMap;

                this.scene3D = new THREE.Scene();
                this.scene3D.background = new THREE.Color(0x8fd3ff);
                this.scene3D.fog = new THREE.Fog(0x8fd3ff, 140, 340);

                this.camera3D = new THREE.PerspectiveCamera(48, 900 / 650, 1, 900);

                this.sunLight3D = new THREE.DirectionalLight(0xffffff, 1.15);
                this.sunLight3D.position.set(60, 90, 40);
                this.sunLight3D.castShadow = true;
                this.sunLight3D.shadow.mapSize.set(1024, 1024);
                this.sunLight3D.shadow.camera.left = -70;
                this.sunLight3D.shadow.camera.right = 70;
                this.sunLight3D.shadow.camera.top = 70;
                this.sunLight3D.shadow.camera.bottom = -70;
                this.sunLight3D.shadow.camera.far = 260;
                this.scene3D.add(this.sunLight3D);
                this.scene3D.add(this.sunLight3D.target);

                this.ambientLight3D = new THREE.AmbientLight(0xffffff, 0.7);
                this.scene3D.add(this.ambientLight3D);
                this.hemiLight3D = new THREE.HemisphereLight(0xbfe6ff, 0x3a6b3f, 0.5);
                this.scene3D.add(this.hemiLight3D);

                this.terrainGroup3D = new THREE.Group();
                this.scene3D.add(this.terrainGroup3D);
                this.propsGroup3D = new THREE.Group();
                this.scene3D.add(this.propsGroup3D);

                this.playerGroup3D = this.buildPlayerMesh3D();
                this.scene3D.add(this.playerGroup3D);

                // 오버월드 포스트프로세싱 셰이더 초기화 (배틀용 렌더러를 그대로 재사용)
                this.initFieldPostFx();

                this.terrainChunkKey3D = null;
                this.playerVisual3D = { x: this.player.x, z: this.player.y };
                this.playerMoveAnim3D = null;

                this.rebuildTerrainChunk3D();
            }

            // 실루엣이 뚜렷한 "복셀/블록" 스타일 트레이너 모델 - 색상은 기존 2D 도트 캐릭터와 통일
            buildPlayerMesh3D() {
                const group = new THREE.Group();
                const mat = (hex) => new THREE.MeshLambertMaterial({ color: hex });

                const JACKET = mat(0xef2d3f);
                const PANTS = mat(0x1c2942);
                const SKIN = mat(0xffd9ae);
                const CAP = mat(0xe11d2e);
                const CAP_BRIM = mat(0xffffff);
                const SHOES = mat(0x0ea5a0);
                const BAG = mat(0xc2650f);

                const torso = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.7, 1.0), JACKET);
                torso.position.y = 1.55;
                torso.castShadow = true;
                group.add(torso);

                const bag = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 0.4), BAG);
                bag.position.set(0, 1.6, -0.65);
                bag.castShadow = true;
                group.add(bag);

                const head = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.05, 1.1), SKIN);
                head.position.y = 2.85;
                head.castShadow = true;
                group.add(head);

                const capTop = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.5, 1.2), CAP);
                capTop.position.y = 3.55;
                capTop.castShadow = true;
                group.add(capTop);

                const capBrim = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.15, 0.7), CAP_BRIM);
                capBrim.position.set(0, 3.28, 0.75);
                capBrim.castShadow = true;
                group.add(capBrim);

                const legGeo = new THREE.BoxGeometry(0.6, 1.1, 0.6);
                const legL = new THREE.Mesh(legGeo, PANTS);
                legL.position.set(-0.42, 0.55, 0);
                legL.castShadow = true;
                const legR = new THREE.Mesh(legGeo, PANTS);
                legR.position.set(0.42, 0.55, 0);
                legR.castShadow = true;
                group.add(legL, legR);

                const shoeGeo = new THREE.BoxGeometry(0.62, 0.32, 0.75);
                const shoeL = new THREE.Mesh(shoeGeo, SHOES);
                shoeL.position.set(-0.42, 0.16, 0.08);
                const shoeR = new THREE.Mesh(shoeGeo, SHOES);
                shoeR.position.set(0.42, 0.16, 0.08);
                group.add(shoeL, shoeR);

                const armGeo = new THREE.BoxGeometry(0.5, 1.2, 0.5);
                const armL = new THREE.Mesh(armGeo, JACKET);
                armL.position.set(-1.05, 1.65, 0);
                armL.castShadow = true;
                const armR = new THREE.Mesh(armGeo, JACKET);
                armR.position.set(1.05, 1.65, 0);
                armR.castShadow = true;
                group.add(armL, armR);

                // 애니메이션에서 다시 참조할 파츠 저장
                group.userData.legL = legL;
                group.userData.legR = legR;
                group.userData.armL = armL;
                group.userData.armR = armR;
                group.userData.torso = torso;
                group.userData.head = head;

                return group;
            }

            // 타일 종류별 장식 오브젝트(나무/덤불/신전/건물)를 InstancedMesh로 일괄 배치한다.
            // 개별 Mesh를 수백 개씩 추가하면 느려지므로, prop 종류별로 묶어서 한 번에 그린다.
            flushProps3D(propBuckets) {
                const S = TILE_SIZE_3D;
                const addInstanced = (geo, mat, list, yOffset = 0, castShadow = true) => {
                    if (!list || list.length === 0) return;
                    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
                    mesh.castShadow = castShadow;
                    mesh.receiveShadow = true;
                    const dummy = new THREE.Object3D();
                    list.forEach((cell, i) => {
                        dummy.position.set(cell.c * S, cell.h + yOffset, cell.r * S);
                        dummy.rotation.y = cell.rot || 0;
                        dummy.scale.setScalar(cell.scale || 1);
                        dummy.updateMatrix();
                        mesh.setMatrixAt(i, dummy.matrix);
                    });
                    mesh.instanceMatrix.needsUpdate = true;
                    this.propsGroup3D.add(mesh);
                };

                addInstanced(new THREE.ConeGeometry(1.1, 2.4, 6), new THREE.MeshLambertMaterial({ color: 0x1f7a3f }), propBuckets.tree, 1.2);
                addInstanced(new THREE.CylinderGeometry(0.22, 0.28, 1.1, 6), new THREE.MeshLambertMaterial({ color: 0x5b3a1e }), propBuckets.tree, 0.3);
                addInstanced(new THREE.SphereGeometry(0.55, 6, 5), new THREE.MeshLambertMaterial({ color: 0x3fae55 }), propBuckets.bush, 0.55);
                addInstanced(new THREE.SphereGeometry(0.9, 8, 6), new THREE.MeshLambertMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.9 }), propBuckets.secretbase, 0.9);

                const buildingColors = {
                    building_gym: 0xd1495f, building_center: 0x2cbb82, building_mart: 0x2f63f0
                };
                ['building_gym', 'building_center', 'building_mart'].forEach(key => {
                    addInstanced(new THREE.BoxGeometry(2.6, 2.4, 2.6), new THREE.MeshLambertMaterial({ color: buildingColors[key] }), propBuckets[key], 1.2);
                    addInstanced(new THREE.ConeGeometry(2.0, 1.4, 4), new THREE.MeshLambertMaterial({ color: 0x1e1b2e }), propBuckets[key], 3.1);
                });

                const templeThemes = {
                    temple_land: 0xf59e0b, temple_sea: 0x38bdf8, temple_sky: 0xfde68a
                };
                Object.keys(templeThemes).forEach(key => {
                    addInstanced(new THREE.BoxGeometry(3.4, 2.6, 3.4), new THREE.MeshLambertMaterial({ color: 0x3f3f46 }), propBuckets[key], 1.3);
                    addInstanced(new THREE.ConeGeometry(2.6, 2.0, 4), new THREE.MeshLambertMaterial({ color: templeThemes[key] }), propBuckets[key], 3.6);
                });
            }

            // 플레이어 주변 반경만 지형을 실시간으로 다시 빌드한다 (청크 로딩).
            // 플레이어가 실제로 다른 타일로 이동했을 때만 재계산해서 매 프레임 비용을 없앤다.
            rebuildTerrainChunk3D() {
                const RADIUS = 15;
                const px = this.player.x, py = this.player.y;
                const key = `${px},${py}`;
                if (this.terrainChunkKey3D === key) return;
                this.terrainChunkKey3D = key;

                while (this.terrainGroup3D.children.length) {
                    const obj = this.terrainGroup3D.children.pop();
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) obj.material.dispose();
                }
                while (this.propsGroup3D.children.length) {
                    const obj = this.propsGroup3D.children.pop();
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) obj.material.dispose();
                }

                const S = TILE_SIZE_3D;
                const minR = Math.max(0, py - RADIUS), maxR = Math.min(MAP_ROWS - 1, py + RADIUS);
                const minC = Math.max(0, px - RADIUS), maxC = Math.min(MAP_COLS - 1, px + RADIUS);

                const tileBuckets = {};
                const propBuckets = {
                    tree: [], bush: [], secretbase: [],
                    building_gym: [], building_center: [], building_mart: [],
                    temple_land: [], temple_sea: [], temple_sky: []
                };

                for (let r = minR; r <= maxR; r++) {
                    for (let c = minC; c <= maxC; c++) {
                        const t = this.worldMap[r][c];
                        const style = TILE_3D_STYLE[t] || TILE_3D_STYLE[TILE_TYPES.GRASS];
                        (tileBuckets[t] = tileBuckets[t] || []).push({ r, c });

                        if (style.prop && propBuckets[style.prop]) {
                            const seed = (r * 37 + c * 17) % 100;
                            if (style.prop === 'bush') {
                                // 풀숲 한 칸에 덤불 2~3개를 시드 기반으로 배치 (매 리빌드마다 흔들리지 않게)
                                for (let i = 0; i < 2; i++) {
                                    propBuckets.bush.push({
                                        r: r + ((seed + i * 31) % 10) / 26 - 0.18,
                                        c: c + ((seed + i * 17) % 10) / 26 - 0.18,
                                        h: style.height,
                                        scale: 0.6 + ((seed + i) % 5) / 10
                                    });
                                }
                            } else if (style.prop === 'tree') {
                                propBuckets.tree.push({ r, c, h: style.height, scale: 0.85 + (seed % 5) / 10 });
                            } else {
                                propBuckets[style.prop].push({ r, c, h: style.height });
                            }
                        }
                    }
                }

                Object.entries(tileBuckets).forEach(([tKey, cells]) => {
                    const t = Number(tKey);
                    const style = TILE_3D_STYLE[t] || TILE_3D_STYLE[TILE_TYPES.GRASS];
                    const geo = new THREE.BoxGeometry(S * 0.98, style.height, S * 0.98);
                    const mat = new THREE.MeshLambertMaterial({
                        color: style.top,
                        transparent: !!style.water,
                        opacity: style.water ? 0.85 : 1
                    });
                    const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
                    mesh.castShadow = !style.water;
                    mesh.receiveShadow = true;
                    const dummy = new THREE.Object3D();
                    cells.forEach((cell, i) => {
                        dummy.position.set(cell.c * S, style.height / 2, cell.r * S);
                        dummy.updateMatrix();
                        mesh.setMatrixAt(i, dummy.matrix);
                    });
                    mesh.instanceMatrix.needsUpdate = true;
                    this.terrainGroup3D.add(mesh);
                });

                this.flushProps3D(propBuckets);
            }

            // 매 프레임 호출 - 이동 보간, 걷기 애니메이션, 카메라 추적, 밤/낮 조명, 청크 갱신을 처리한다.
            update3DField() {
                const S = TILE_SIZE_3D;
                this.rebuildTerrainChunk3D();

                // 그리드 이동을 부드럽게 보간해서 실제 3D 게임처럼 미끄러지듯 걷게 한다
                let vx = this.player.x, vz = this.player.y;
                if (this.playerMoveAnim3D) {
                    const t = Math.min(1, (performance.now() - this.playerMoveAnim3D.start) / this.playerMoveAnim3D.duration);
                    vx = this.playerMoveAnim3D.fromX + (this.playerMoveAnim3D.toX - this.playerMoveAnim3D.fromX) * t;
                    vz = this.playerMoveAnim3D.fromZ + (this.playerMoveAnim3D.toZ - this.playerMoveAnim3D.fromZ) * t;
                    if (t >= 1) this.playerMoveAnim3D = null;
                }
                this.playerVisual3D.x = vx;
                this.playerVisual3D.z = vz;

                const tileHere = this.worldMap[Math.min(MAP_ROWS - 1, Math.round(vz))][Math.min(MAP_COLS - 1, Math.round(vx))];
                const groundH = (TILE_3D_STYLE[tileHere] || TILE_3D_STYLE[TILE_TYPES.GRASS]).height;

                const worldX = vx * S, worldZ = vz * S;
                const isMoving = !!this.playerMoveAnim3D;
                const walkT = (performance.now() / 110);
                const legSwing = isMoving ? Math.sin(walkT) * 0.5 : 0;
                const bob = isMoving ? Math.abs(Math.sin(walkT)) * 0.18 : 0;

                this.playerGroup3D.position.set(worldX, groundH + bob, worldZ);
                const yawMap = { down: 0, up: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 };
                this.playerGroup3D.rotation.y = yawMap[this.player.direction] ?? 0;

                const ud = this.playerGroup3D.userData;
                ud.legL.rotation.x = legSwing;
                ud.legR.rotation.x = -legSwing;
                ud.armL.rotation.x = -legSwing;
                ud.armR.rotation.x = legSwing;

                // 고정 각도 3인칭 추적 카메라 (플레이어 방향에 따라 회전하지 않아 화면이 흔들리지 않는다)
                this.camera3D.position.set(worldX, groundH + 26, worldZ + 22);
                this.camera3D.lookAt(worldX, groundH + 2, worldZ);

                // 낮/밤 및 날씨에 따른 조명 톤 변화
                const night = this.isNight;
                this.sunLight3D.intensity = night ? 0.28 : 1.15;
                this.ambientLight3D.intensity = night ? 0.32 : 0.7;
                this.hemiLight3D.intensity = night ? 0.2 : 0.5;
                const skyColor = night ? 0x0b1330 : 0x8fd3ff;
                this.scene3D.background.set(skyColor);
                this.scene3D.fog.color.set(skyColor);
                this.sunLight3D.position.set(worldX + 60, worldZ ? 90 : 90, worldZ + 40);
                this.sunLight3D.target.position.set(worldX, 0, worldZ);
                this.sunLight3D.target.updateMatrixWorld();

                this.renderer3D.render(this.scene3D, this.camera3D);
            }

            /* ==========================================================================
               9-E. 배틀 3D 무대 (Three.js)
               필드 3D 파이프라인용으로 이미 준비된 렌더러/씬/조명(init3D())을 그대로
               재사용해서, 전투 배경만 실제 입체 공간(하늘-원경 능선-초원 지면-좌우 대결
               발판)으로 렌더링한다. 포켓몬 본체는 기존처럼 2D 스프라이트(#enemy-sprite,
               #player-sprite)를 그 위에 그대로 띄우는 방식 - 실제 3D 포켓몬 게임 다수도
               "3D 무대 + 카메라를 향한 스프라이트/빌보드" 조합을 쓴다.
               ========================================================================== */
            // 초원 지면용 캔버스 텍스처 - 단색 원판이면 아무리 조명을 바꿔도
            // "텅 빈 초록 접시"처럼 밋밋해 보이므로, 중심부가 밝고 가장자리로
            // 갈수록 은은히 어두워지는 라디얼 그라데이션 + 잔디 얼룩 반점 +
            // 아레나 경계를 암시하는 옅은 동심원 가이드선을 구워 넣는다.
            // 실제 색상은 configureBattleStage3D에서 material.color로 계속 곱해지므로
            // (MeshLambertMaterial의 color * map 혼합) 조우 등급별 색조는 그대로 유지된다.
            buildBattleGroundTexture3D() {
                const size = 512;
                const cnv = document.createElement('canvas');
                cnv.width = cnv.height = size;
                const ctx = cnv.getContext('2d');
                const cx = size / 2, cy = size / 2;

                // 예전엔 바탕이 순백(#ffffff)에 중앙까지 흰색을 60%나 덧칠해서,
                // material.color를 아무리 진하게 넣어도(색상 × 텍스처) 화면 앞쪽
                // 지면이 하얗게 날아가 "색 빠진 접시"처럼 보였다. 바탕을 중간톤으로
                // 낮추고 중앙 하이라이트도 은은하게만 남겨 지형 고유색이 제대로 살아나게 한다.
                ctx.fillStyle = '#d8d8d8';
                ctx.fillRect(0, 0, size, size);

                const grad = ctx.createRadialGradient(cx, cy, size * 0.04, cx, cy, size * 0.5);
                grad.addColorStop(0, 'rgba(255,255,255,0.22)');
                grad.addColorStop(0.55, 'rgba(255,255,255,0.06)');
                grad.addColorStop(1, 'rgba(0,0,0,0.34)');
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, size, size);

                // 잔디 결 - 가느다란 선을 촘촘히 그어 단색 면을 없앤다
                ctx.lineWidth = 1;
                for (let i = 0; i < 900; i++) {
                    const gx = Math.random() * size, gy = Math.random() * size;
                    ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
                    ctx.beginPath();
                    ctx.moveTo(gx, gy);
                    ctx.lineTo(gx + (Math.random() - 0.5) * 6, gy - 4 - Math.random() * 6);
                    ctx.stroke();
                }

                for (let i = 0; i < 160; i++) {
                    const a = Math.random() * Math.PI * 2;
                    const r = Math.pow(Math.random(), 0.6) * size * 0.49;
                    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
                    const rad = 5 + Math.random() * 16;
                    const dark = Math.random() < 0.55;
                    ctx.beginPath();
                    ctx.fillStyle = dark
                        ? `rgba(0,0,0,${(0.04 + Math.random() * 0.06).toFixed(3)})`
                        : `rgba(255,255,255,${(0.04 + Math.random() * 0.06).toFixed(3)})`;
                    ctx.arc(px, py, rad, 0, Math.PI * 2);
                    ctx.fill();
                }

                ctx.strokeStyle = 'rgba(255,255,255,0.22)';
                ctx.lineWidth = 2;
                [0.3, 0.44].forEach(f => {
                    ctx.beginPath();
                    ctx.arc(cx, cy, size * f, 0, Math.PI * 2);
                    ctx.stroke();
                });

                const tex = new THREE.CanvasTexture(cnv);
                return tex;
            }

            buildBattleStage3D() {
                this.battleStageGroup3D = new THREE.Group();
                this.battleStageGroup3D.visible = false;
                this.scene3D.add(this.battleStageGroup3D);

                // 1. 초원 지면 (원형 아레나) - 단색 원판 대신 은은한 그라데이션/반점
                // 텍스처를 입혀 "텅 빈 접시" 느낌을 없앤다.
                // 주의: receiveShadow를 켜면 필드용으로 좁게(±70) 맞춰둔 sunLight3D의
                // 그림자 카메라 범위와 이 훨씬 큰 아레나(반경 260+)가 어긋나서 지면 먼 쪽에
                // 체커판처럼 얼룩지는 그림자맵 아티팩트가 생긴다. 배틀 무대에서는 어차피
                // 2D 스프라이트끼리라 실그림자가 필요 없으므로 아예 그림자 수신을 끈다.
                const ground = new THREE.Mesh(
                    new THREE.CircleGeometry(320, 48),
                    (this.battleGroundMat3D = new THREE.MeshLambertMaterial({ color: 0x79c26a, map: this.buildBattleGroundTexture3D() }))
                );
                ground.rotation.x = -Math.PI / 2;
                this.battleStageGroup3D.add(ground);

                // 2. 원경 능선(산) - 아레나를 원형으로 둘러싼 콘 실루엣.
                // 각 콘을 자기 배치 각도만큼 y축으로 돌려 같은 면이 카메라를 향해
                // 반복되지 않게 하고, 높이/굵기도 개별로 흔들어 실제 산맥처럼
                // 들쭉날쭉한 스카이라인을 만든다 (예전엔 똑같은 저해상도 콘이
                // 균일한 간격으로 늘어서 있어 "판박이 종이산" 같은 인상을 줬다).
                this.battleRidgeMat3D = new THREE.MeshLambertMaterial({ color: 0x3f7f3a });
                const ridgeGeo = new THREE.ConeGeometry(66, 108, 8);
                const ridgeCount = 16;
                for (let i = 0; i < ridgeCount; i++) {
                    const angle = (i / ridgeCount) * Math.PI * 2;
                    const radius = 250 + (i % 3) * 25;
                    const cone = new THREE.Mesh(ridgeGeo, this.battleRidgeMat3D);
                    cone.position.set(Math.cos(angle) * radius, 30, Math.sin(angle) * radius);
                    cone.rotation.y = angle * 1.7;
                    cone.scale.set(0.75 + (i % 4) * 0.18, 0.85 + ((i * 7) % 5) * 0.16, 0.75 + (i % 4) * 0.18);
                    this.battleStageGroup3D.add(cone);
                }

                // 2b. 근경 언덕 - 원경 산 하나만 덩그러니 있으면 발판과 산 사이가
                // 휑하게 비어 밋밋해 보이므로, 더 진하고 가까운 "앞산" 레이어를
                // 하나 더 깔아 전경-중경-원경 레이어감을 만든다. 적 발판 방향
                // 부채꼴은 발판과 겹치지 않도록 건너뛴다.
                this.battleHillMat3D = new THREE.MeshLambertMaterial({ color: 0x5fa347 });
                const hillGeo = new THREE.ConeGeometry(40, 50, 7);
                const hillCount = 14;
                const enemyAngle = Math.atan2(-143, 131);
                for (let i = 0; i < hillCount; i++) {
                    const angle = (i / hillCount) * Math.PI * 2 + 0.22;
                    let angleDiff = Math.abs(angle - enemyAngle) % (Math.PI * 2);
                    if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
                    if (angleDiff < 0.7) continue;
                    const radius = 195 + (i % 3) * 22;
                    const hill = new THREE.Mesh(hillGeo, this.battleHillMat3D);
                    hill.position.set(Math.cos(angle) * radius, 12, Math.sin(angle) * radius);
                    hill.rotation.y = angle * 1.3;
                    hill.scale.set(0.65 + (i % 3) * 0.16, 0.5 + ((i * 5) % 4) * 0.14, 0.65 + (i % 3) * 0.16);
                    this.battleStageGroup3D.add(hill);
                }

                // 3. 좌/우 대결 발판 - 아군은 카메라 쪽 가까이(전경), 상대는 화면 안쪽 멀리(원경)
                // 좌표는 임의로 눈대중한 값이 아니라, 실제 카메라(configureBattleStage3D의
                // 구도)로 #enemy-sprite-box / #player-sprite-box가 화면에 뜨는 지점(스프라이트
                // "발" 위치)을 향해 광선을 쏴서 지면과 만나는 지점을 역산해 구한 값이다.
                // 예전엔 감으로 정한 좌표라 발판이 스프라이트와 동떨어진 엉뚱한 자리에
                // 있는 것처럼 보이는 문제가 있었다.
                // 아군 발판은 카메라에 훨씬 가까워서 같은 반지름이면 화면을 절반이나
                // 잡아먹는다. 상대 발판과 화면상 크기가 비슷해 보이도록 실제 반지름을
                // 줄여 균형을 맞춘다.
                const platformGeo = new THREE.CylinderGeometry(44, 48, 7, 30);
                this.battlePlatformMat3D = new THREE.MeshLambertMaterial({ color: 0xe9e4c9, transparent: true, opacity: 0.94 });
                this.playerPlatform3D = new THREE.Mesh(platformGeo, this.battlePlatformMat3D);
                this.playerPlatform3D.position.set(-43, 3.5, 24);
                this.playerPlatform3D.scale.set(0.8, 1, 0.8);
                this.battleStageGroup3D.add(this.playerPlatform3D);

                this.enemyPlatform3D = new THREE.Mesh(platformGeo, this.battlePlatformMat3D);
                this.enemyPlatform3D.position.set(131, 3.5, -143);
                this.enemyPlatform3D.scale.setScalar(0.95);
                this.battleStageGroup3D.add(this.enemyPlatform3D);

                // 발판 테두리 링 - 경계를 또렷하게
                const ringGeo = new THREE.TorusGeometry(46, 1.4, 8, 32);
                const ringMat = new THREE.MeshBasicMaterial({ color: 0x1f2937, transparent: true, opacity: 0.28 });
                const playerRing = new THREE.Mesh(ringGeo, ringMat);
                playerRing.rotation.x = Math.PI / 2;
                playerRing.position.copy(this.playerPlatform3D.position).setY(7.2);
                playerRing.scale.set(0.8, 0.8, 1);
                this.battleStageGroup3D.add(playerRing);
                const enemyRing = new THREE.Mesh(ringGeo, ringMat);
                enemyRing.rotation.x = Math.PI / 2;
                enemyRing.position.copy(this.enemyPlatform3D.position).setY(6.2);
                enemyRing.scale.set(0.95, 0.95, 1);
                this.battleStageGroup3D.add(enemyRing);

                // 2c. 지면 장식물 - 텅 빈 접시 같던 아레나에 바위/풀 무더기를 흩뿌려
                // 실제 필드에서 싸우는 느낌을 준다. 색은 지형 팔레트를 따라간다.
                this.battleDecorMat3D = new THREE.MeshLambertMaterial({ color: 0x4f8f45 });
                this.battleDecorGroup3D = new THREE.Group();
                const decorRng = makeSeededRng(20260916);
                const decorGeos = [
                    new THREE.ConeGeometry(8, 16, 5),
                    new THREE.DodecahedronGeometry(7, 0),
                    new THREE.ConeGeometry(5, 11, 4)
                ];
                for (let i = 0; i < 70; i++) {
                    const ang = decorRng() * Math.PI * 2;
                    const rad = 95 + decorRng() * 175;
                    const px = Math.cos(ang) * rad, pz = Math.sin(ang) * rad;
                    // 발판 근처는 비워둔다 (스프라이트를 가리지 않도록)
                    if (Math.hypot(px + 43, pz - 24) < 78) continue;
                    if (Math.hypot(px - 131, pz + 143) < 72) continue;
                    const m = new THREE.Mesh(decorGeos[i % decorGeos.length], this.battleDecorMat3D);
                    const sc = 0.85 + decorRng() * 1.35;
                    m.scale.setScalar(sc);
                    m.position.set(px, 4 * sc, pz);
                    m.rotation.y = decorRng() * Math.PI * 2;
                    this.battleDecorGroup3D.add(m);
                }
                this.battleStageGroup3D.add(this.battleDecorGroup3D);

                // 4. 흘러가는 구름 (납작한 구체 몇 개)
                this.battleCloudGroup3D = new THREE.Group();
                const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
                for (let i = 0; i < 5; i++) {
                    const cloud = new THREE.Mesh(new THREE.SphereGeometry(14 + (i % 3) * 4, 8, 6), cloudMat);
                    cloud.scale.set(1.6, 0.5, 1);
                    cloud.position.set(-260 + i * 130, 95 + (i % 2) * 12, -180 - (i % 3) * 40);
                    this.battleCloudGroup3D.add(cloud);
                }
                this.battleStageGroup3D.add(this.battleCloudGroup3D);

                // 5. 전설/보스/준전설급 조우 전용 맥동 광휘 링 (평소엔 숨김)
                const auraGeo = new THREE.TorusGeometry(75, 2.2, 8, 40);
                this.legendAuraMat3D = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.5 });
                this.bossAuraMat3D = new THREE.MeshBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.5 });
                this.rareAuraMat3D = new THREE.MeshBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.5 });
                this.battleAuraRing3D = new THREE.Mesh(auraGeo, this.legendAuraMat3D);
                this.battleAuraRing3D.rotation.x = Math.PI / 2;
                this.battleAuraRing3D.position.copy(this.enemyPlatform3D.position).setY(5);
                this.battleAuraRing3D.visible = false;
                this.battleStageGroup3D.add(this.battleAuraRing3D);
            }

            /* 위(연한 상층) → 아래(지평선 근처의 진한 색)로 이어지는 하늘 그라데이션
               텍스처를 구워 scene.background으로 쓴다. 단색 하늘보다 훨씬 깊이감이 있고,
               지형/시간대별 색조 차이도 뚜렷하게 드러난다. */
            buildSkyTexture3D(hex) {
                const cnv = this._skyCanvas3D || (this._skyCanvas3D = document.createElement('canvas'));
                cnv.width = 4; cnv.height = 256;
                const ctx = cnv.getContext('2d');
                const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
                const lighten = (v, k) => Math.min(255, Math.round(v + (255 - v) * k));
                const darken = (v, k) => Math.max(0, Math.round(v * (1 - k)));
                const grad = ctx.createLinearGradient(0, 0, 0, 256);
                grad.addColorStop(0, `rgb(${darken(r, 0.30)},${darken(g, 0.26)},${darken(b, 0.10)})`);
                grad.addColorStop(0.45, `rgb(${r},${g},${b})`);
                grad.addColorStop(1, `rgb(${lighten(r, 0.42)},${lighten(g, 0.40)},${lighten(b, 0.30)})`);
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, 4, 256);

                if (this._skyTex3D) this._skyTex3D.dispose();
                this._skyTex3D = new THREE.CanvasTexture(cnv);
                this._skyTex3D.wrapS = THREE.ClampToEdgeWrapping;
                this._skyTex3D.wrapT = THREE.ClampToEdgeWrapping;
                return this._skyTex3D;
            }

            /* 전투 조우마다 한 번씩 호출 - 상대 등급(전설/보스/준전설/일반)에 맞춰
               하늘·지면·능선 색상과 광휘 링, 카메라 구도를 설정한다. */
            configureBattleStage3D(enemy) {
                let skyHex, groundHex, ridgeHex, hillHex;
                if (enemy.isLegend) { skyHex = 0xfde9b0; groundHex = 0xa16207; ridgeHex = 0x92400e; hillHex = 0xca8a04; }
                else if (enemy.isBoss) { skyHex = 0xf3a0a0; groundHex = 0x4c0519; ridgeHex = 0x701a2e; hillHex = 0x9f2a44; }
                else if (enemy.isRareTier) { skyHex = 0xd8b4fe; groundHex = 0x4c1d95; ridgeHex = 0x5b21b6; hillHex = 0x7c3aed; }
                else {
                    // [업그레이드] 일반 조우는 "지금 서 있는 지형"에 맞는 무대에서 싸운다.
                    const pal = this.getBattleBiomePalette();
                    skyHex = pal.sky; groundHex = pal.ground; ridgeHex = pal.ridge; hillHex = pal.hill;
                }

                // 하루 주기에 맞춰 무대 전체의 밝기/색온도를 낮→노을→밤으로 물들인다.
                const phase = this.timePhase || sampleTimePhase(this.timeOfDay || 0.42);
                const shade = (hex) => this.blendHexWithTint(hex, phase);
                skyHex = shade(skyHex); groundHex = shade(groundHex);
                ridgeHex = shade(ridgeHex); hillHex = shade(hillHex);
                const dayLight = 1 - phase.alpha * 0.9;
                if (this.sunLight3D) this.sunLight3D.intensity = 0.34 + dayLight * 0.72;
                if (this.ambientLight3D) this.ambientLight3D.intensity = 0.24 + dayLight * 0.40;
                if (this.hemiLight3D) this.hemiLight3D.intensity = 0.14 + dayLight * 0.34;

                this.scene3D.background = this.buildSkyTexture3D(skyHex);
                if (this.scene3D.fog) {
                    this.scene3D.fog.color.setHex(skyHex);
                    // 필드용 카메라는 지면에 훨씬 가깝게 붙어있어서(near:140/far:340) 그
                    // 값 그대로 쓰면, 훨씬 멀리서 아레나 전체를 내려다보는 배틀 카메라
                    // 시점에서는 능선(카메라 기준 약 500~540 거리)이 안개 범위의
                    // 80%나 파고들어 하늘색에 거의 파묻혀 버린다 - 사용자가 지적한
                    // "산이 하얗게 뜬 것처럼 흐릿하다"는 현상의 실제 원인이었다.
                    // 배틀 무대 스케일에 맞게 near/far를 더 멀리 벌려, 같은 거리에서
                    // 안개 혼합률이 절반 이하로 줄도록(더 진하고 또렷한 색이 보이도록) 재설정.
                    this.scene3D.fog.near = 260;
                    this.scene3D.fog.far = 950;
                }
                this.battleGroundMat3D.color.setHex(groundHex);
                this.battleRidgeMat3D.color.setHex(ridgeHex);
                this.battleHillMat3D.color.setHex(hillHex);
                if (this.battleDecorMat3D) this.battleDecorMat3D.color.setHex(ridgeHex);
                // 발판도 지형/시간대 색조를 따라가야 밤 화산에서 혼자 새하얗게 뜨지 않는다
                if (this.battlePlatformMat3D) {
                    const base = this.blendHexWithTint(0xe9e4c9, phase);
                    const gr = (groundHex >> 16) & 255, gg = (groundHex >> 8) & 255, gb = groundHex & 255;
                    const br = (base >> 16) & 255, bg = (base >> 8) & 255, bb = base & 255;
                    const mix = (a, b) => Math.round(a * 0.76 + b * 0.24);
                    this.battlePlatformMat3D.color.setRGB(mix(br, gr) / 255, mix(bg, gg) / 255, mix(bb, gb) / 255);
                }

                this.battleAuraRing3D.visible = !!(enemy.isLegend || enemy.isBoss || enemy.isRareTier);
                this.battleAuraRing3D.material = enemy.isLegend ? this.legendAuraMat3D : (enemy.isBoss ? this.bossAuraMat3D : this.rareAuraMat3D);

                // 카메라 기본(휴식) 구도: 아레나를 높은 곳에서 비스듬히 내려다보며,
                // 내 발판(전경)과 상대 발판(원경)이 모두 화면 안에 들어오는 3인칭 구도.
                // 실제 렌더링에서는 매 프레임 여기서 살짝 흔들리거나(유휴 숨쉬기),
                // 기술을 쓸 때마다 살짝 파고드는(임팩트 펀치) 연출이 덧붙는다.
                this.battleCamRestPos = new THREE.Vector3(0, 80, 210);
                this.battleCamRestLook = new THREE.Vector3(20, 0, -70);

                // 배틀 챔피언십 방송 카메라처럼, 조우 시작 순간 위에서 아래로 훅 파고들며
                // 시작하는 다이나믹한 인트로 연출 (기존엔 처음부터 고정 구도라 밋밋했음).
                // 준전설/환상/전설급 조우는 일반 조우와 확실히 구분되도록, 훨씬 낮고 먼
                // 측면 각도에서 상대 발판을 정면으로 응시하며 천천히 훑고 들어오는
                // 전용 연출을 쓴다 (실제 게임의 전설전 전용 인트로 연출 재현).
                const isSpecialTier = !!(enemy.isLegend || enemy.isRareTier);
                this.battleCamIntro = {
                    active: true,
                    start: Date.now(),
                    duration: isSpecialTier ? 1750 : 950,
                    from: isSpecialTier ? new THREE.Vector3(-270, 150, 40) : new THREE.Vector3(30, 230, 400),
                    lookFrom: isSpecialTier ? this.enemyPlatform3D.position.clone().setY(45) : null
                };
                this.battleCamPunch = { active: false, start: 0, duration: 260, side: 1 };
            }

            /* 기술 사용(playSkillAttackFx/playStatBoostFx) 시점에 호출 - 카메라가
               공격자 쪽으로 짧게 파고들었다가 되돌아오는 "임팩트 펀치"를 재생해,
               고정 카메라로 지켜만 보던 것과 달리 실제 대전 중계 카메라처럼
               타격 순간마다 화면이 반응하는 느낌을 준다. */
            triggerCameraPunch(isPlayerAttacking) {
                this.battleCamPunch = {
                    active: true,
                    start: Date.now(),
                    duration: 260,
                    side: isPlayerAttacking ? -1 : 1
                };
            }

            /* 배틀 상태일 때 매 프레임 호출 - 인트로 돌입 연출, 유휴 숨쉬기, 기술 사용
               임팩트 펀치, 구름 흐름, 특수 조우 광휘 링 맥동을 모두 합성한 뒤 렌더링한다. */
            renderBattleStage3D() {
                const t = Date.now();

                // 1) 기본 구도 + 아주 은은한 유휴 흔들림 (완전히 고정되어 있으면 밋밋함)
                const restPos = this.battleCamRestPos.clone();
                restPos.x += Math.sin(t / 1400) * 1.6;
                restPos.y += Math.sin(t / 1900) * 1.2;

                // 2) 조우 시작 인트로 - 위쪽 먼 곳(또는 전설급의 경우 측면 먼 곳)에서
                //    기본 구도로 부드럽게 파고든다. 전설급은 lookFrom이 함께 지정되어
                //    상대를 정면으로 응시하다가 기본 시선으로 스윽 옮겨가는 연출이 된다.
                let camPos = restPos;
                let camLook = this.battleCamRestLook;
                if (this.battleCamIntro && this.battleCamIntro.active) {
                    const p = Math.min(1, (t - this.battleCamIntro.start) / this.battleCamIntro.duration);
                    const ease = 1 - Math.pow(1 - p, 3);
                    camPos = this.battleCamIntro.from.clone().lerp(restPos, ease);
                    if (this.battleCamIntro.lookFrom) {
                        camLook = this.battleCamIntro.lookFrom.clone().lerp(this.battleCamRestLook, ease);
                    }
                    if (p >= 1) this.battleCamIntro.active = false;
                }

                // 3) 기술 사용 임팩트 펀치 - 공격 쪽 방향으로 짧게 카메라가 딸려갔다가 복귀
                if (this.battleCamPunch && this.battleCamPunch.active) {
                    const p = Math.min(1, (t - this.battleCamPunch.start) / this.battleCamPunch.duration);
                    const impulse = Math.sin(Math.PI * p) * 9 * this.battleCamPunch.side;
                    camPos = camPos.clone();
                    camPos.x += impulse;
                    camPos.z -= Math.abs(impulse) * 0.6;
                    if (p >= 1) this.battleCamPunch.active = false;
                }

                this.camera3D.position.copy(camPos);
                this.camera3D.lookAt(camLook);

                this.battleCloudGroup3D.children.forEach(cloud => {
                    cloud.position.x += 0.03;
                    if (cloud.position.x > 400) cloud.position.x = -400;
                });

                if (this.battleAuraRing3D.visible) {
                    const pulse = 0.35 + Math.abs(Math.sin(t / 500)) * 0.3;
                    this.battleAuraRing3D.material.opacity = pulse;
                    this.battleAuraRing3D.rotation.z += 0.01;
                }

                this.updateBallThrow3D();
                this.renderer3D.render(this.scene3D, this.camera3D);
            }

            renderStarterModal() {
                const container = document.getElementById('starter-options');
                container.innerHTML = '';

                STARTER_POKEMON_IDS.forEach(id => {
                    const data = POKEMON_DATABASE.find(p => p.id === id);
                    const card = document.createElement('div');
                    card.className = 'starter-card';
                    card.innerHTML = `
                        <img src="${data.frontSprite}" class="pixel-sprite-fit" alt="${data.species}"><br>
                        <strong>${data.species}</strong>
                        <div style="margin-top:4px;">${typeBadgeHtml(data.type1)}${typeBadgeHtml(data.type2)}</div>
                        <div style="font-size:10px; color:var(--neon-cyan); margin-top:2px;">종족값 합계: ${Object.values(data.baseStats).reduce((a,b)=>a+b,0)}</div>
                    `;
                    card.onclick = () => this.selectStarter(data);
                    container.appendChild(card);
                });
            }

            selectStarter(starterData) {
                const instance = this.createPokemonInstance(starterData, 5);
                this.player.party.push(instance);
                this.player.pokedex.add(starterData.id);

                document.getElementById('starter-modal').style.display = 'none';
                this.state = GAME_STATES.FIELD;
                this.stats.startedAt = Date.now();
                showToast(`파트너 포켓몬 [${starterData.species}]와 함께 모험을 시작합니다!`);
                this.updateUI();
                this.checkAchievements();
                this.saveGame(true);
                this.refreshFieldMusic(true);
                // 전투 중 레벨업으로 배우려던 기술이 있으면 이제 무엇을 잊을지 고른다
                setTimeout(() => flushPendingMoveLearns(), 600);
            }

            initWorldMap() {
                // 맵이 200x200 → 320x320(1.6배)으로 커진 만큼, 마을/체육관/사원 같은
                // 고정 랜드마크 좌표도 동일한 비율로 스케일링해 지형 배치 구조는 그대로 유지한다.
                this.worldMap = Array.from({ length: MAP_ROWS }, (_, r) =>
                    Array.from({ length: MAP_COLS }, (_, c) => {
                        // [버그 수정] 아래 세 줄(센터/체육관/상점 고정 좌표 검사)이 바로 위의
                        // "r<24 && c<24 → TOWN" 블록보다 뒤에 있었기 때문에, 좌표
                        // (8,19)/(19,8)/(13,13)이 전부 그 블록 안에 포함되어 항상 먼저
                        // TOWN으로 매치되어버려 실행조차 되지 않는 죽은 코드였다. 그 결과
                        // 시작 마을(오닉스 역전가)에는 실제로 작동하는 체육관 타일이 단 하나도
                        // 없어서, 첫 체육관(뱃지 1개)을 원천적으로 도전할 수 없는 치명적인
                        // 버그였다. 특정 좌표 검사를 먼저 하도록 순서를 바꿔 고친다.
                        if (r === 8 && c === 19) return TILE_TYPES.CENTER;
                        if (r === 19 && c === 8) return TILE_TYPES.GYM;
                        if (r === 13 && c === 13) return TILE_TYPES.MART;
                        if (r < 24 && c < 24) return TILE_TYPES.TOWN;

                        // 시작 마을(오닉스 역전가) 하나뿐이던 지도에 지역 마을 4곳을 추가로 배치.
                        // 마을 블록보다 센터/체육관/상점 좌표 검사를 먼저 해야 그 자리가
                        // 평범한 TOWN 타일로 먼저 매치돼버리지 않는다.
                        for (const site of EXTRA_TOWN_SITES) {
                            if (r === site.center[0] && c === site.center[1]) return TILE_TYPES.CENTER;
                            if (r === site.gym[0] && c === site.gym[1]) return TILE_TYPES.GYM;
                            if (r === site.mart[0] && c === site.mart[1]) return TILE_TYPES.MART;
                            if (r >= site.rMin && r <= site.rMax && c >= site.cMin && c <= site.cMax) return TILE_TYPES.TOWN;
                        }

                        // 전설의 사원 - 각 전설이 상징하는 지형 한가운데 깊숙이 단일 배치.
                        // (예전엔 대지의 사원이 사막에, 바다의 사원이 화산 지대에 있어서
                        // 그란돈/가이오가의 테마와 맞지 않았음 - 마그마 지역=그란돈(대지의 사원),
                        // 대해양=가이오가(바다의 사원), 설산=레쿠쟈(하늘의 사원)로 재배치.)
                        if (r === 460 && c === 470) return TILE_TYPES.LAND_TEMPLE;
                        if (r === 300 && c === 610) return TILE_TYPES.SEA_TEMPLE;
                        if (r === 80 && c === 480) return TILE_TYPES.SKY_TEMPLE;

                        // ----- 지역(바이옴) 배치 -----
                        // [지형 확장] 신규 지역 - 벚꽃 숲 / 꽃밭 / 대나무 숲 / 고대 유적 /
                        // 늪지대 / 황무지. 기존 지역보다 먼저 검사해서 고유 영역을 확보한다.
                        if (r > 40 && r < 92 && c > 58 && c < 122) {   // 북서 벚꽃 숲 (시작 마을 근처)
                            return this.wrnd() < 0.72 ? TILE_TYPES.CHERRY : TILE_TYPES.GRASS;
                        }
                        if (r > 148 && r < 202 && c > 118 && c < 192) { // 중서부 대꽃밭
                            return this.wrnd() < 0.8 ? TILE_TYPES.FLOWER : TILE_TYPES.GRASS;
                        }
                        if (r > 228 && r < 302 && c > 418 && c < 498) { // 동부 대나무 숲
                            return this.wrnd() < 0.78 ? TILE_TYPES.BAMBOO : TILE_TYPES.GRASS;
                        }
                        if (r > 378 && r < 432 && c > 248 && c < 322) { // 남중부 고대 유적지
                            return this.wrnd() < 0.82 ? TILE_TYPES.RUINS : TILE_TYPES.WASTELAND;
                        }
                        if (r > 298 && r < 362 && c > 376 && c < 432) { // 남동 늪지대
                            return this.wrnd() < 0.85 ? TILE_TYPES.SWAMP : TILE_TYPES.TALL_GRASS;
                        }
                        if (r > 396 && r < 446 && c > 322 && c < 392) { // 화산 앞 황무지
                            return this.wrnd() < 0.8 ? TILE_TYPES.WASTELAND : TILE_TYPES.ROCK;
                        }

                        // 남동 화산지대 / 북동 설원 / 남서 사막 / 중앙 대삼림
                        if (r > 440 && c > 430) return TILE_TYPES.VOLCANO;
                        if (r < 150 && c > 420) return TILE_TYPES.SNOW;
                        if (r > 440 && c < 220) return TILE_TYPES.SAND;
                        if (r > 230 && r < 350 && c > 230 && c < 360) return TILE_TYPES.FOREST;
                        // 북서 삼림지대 (신규)
                        if (r < 150 && c > 150 && c < 300) return TILE_TYPES.FOREST;
                        // 서부 암석 고원 (신규)
                        if (r > 300 && r < 420 && c > 60 && c < 190) {
                            return this.wrnd() < 0.55 ? TILE_TYPES.ROCK : TILE_TYPES.GRASS;
                        }
                        // 내륙 대호수 (신규)
                        if (r > 165 && r < 235 && c > 400 && c < 500) return TILE_TYPES.WATER;
                        // 남동 대해양
                        if (r > 545 || c > 575) return TILE_TYPES.WATER;
                        // 북부 설원 자락 (설원과 평원 사이 완충지대)
                        if (r < 90 && c > 340 && c <= 420) return this.wrnd() < 0.45 ? TILE_TYPES.SNOW : TILE_TYPES.GRASS;
                        // 화산 자락
                        if (r > 400 && r <= 440 && c > 380) return this.wrnd() < 0.4 ? TILE_TYPES.VOLCANO : TILE_TYPES.ROCK;
                        // 사막 자락
                        if (r > 400 && r <= 440 && c < 260) return this.wrnd() < 0.45 ? TILE_TYPES.SAND : TILE_TYPES.GRASS;

                        // 이전에는 바위가 "r%12===0 && c%12===0" 같은 고정 격자 패턴으로만 배치되어
                        // 매번 게임을 새로 시작해도 지형지물이 완전히 똑같은 자리에 나오는 문제가 있었음.
                        // → 완전 확률 기반 랜덤 배치로 변경해서 플레이할 때마다 지형지물 배치가 달라지도록 수정.
                        if (this.wrnd() < 0.012) return TILE_TYPES.ROCK;
                        if (this.wrnd() < 0.05) return TILE_TYPES.FOREST;
                        if (this.wrnd() < 0.3) return TILE_TYPES.TALL_GRASS;
                        return TILE_TYPES.GRASS;
                    })
                );

                this.scatterRandomLandmarks();

                // [지형 확장] 후처리 - 자연스럽게만 생길 수 있는 지형들을 지도 위에 덧입힌다.
                this.applyTerrainRefinements();

                // 닌텐도 게임처럼 "포켓몬이 나오는 수풀"과 "포켓몬이 나오지 않는 길"을
                // 명확히 분리하기 위해, 마을·체육관·상점·전설의 사원을 모두 잇는
                // 전용 도로(PATH) 네트워크를 지형 위에 마지막으로 깔아준다.
                this.carveRoadNetwork();

                // 지형과 도로가 모두 확정된 뒤에 매크로 명암과 NPC를 배치한다
                // (도로가 깔리기 전에 NPC를 세우면 길목 트레이너가 한 명도 서지 못한다)
                this.buildMacroVariationLayer();
                this.buildNpcs();

                // 전설의 사원 좌표를 미리 캐싱해 매 프레임 전체 맵을 스캔하지 않도록 최적화
                this.templeTileCoords = [];
                for (let r = 0; r < MAP_ROWS; r++) {
                    for (let c = 0; c < MAP_COLS; c++) {
                        if (LEGEND_TEMPLE_INFO[this.worldMap[r][c]]) {
                            this.templeTileCoords.push({ r, c, tile: this.worldMap[r][c] });
                        }
                    }
                }
            }

            /* ==========================================================================
               9-N. NPC 배치 / 시야 / 대화 / 트레이너전
               ========================================================================== */
            buildNpcs() {
                const T = TILE_TYPES;
                const rng = makeSeededRng((this.worldSeed ^ 0x9e3779b9) >>> 0);
                this.npcs = [];
                let nextId = 1;

                // ---- 1) 길목 트레이너 ----
                // 도로(PATH) 타일을 모아 일정 간격으로 세운다. 도로 위에서는 야생
                // 포켓몬이 나오지 않는 대신, 이제 트레이너가 기다리고 있다.
                const pathCells = [];
                for (let r = 2; r < MAP_ROWS - 2; r += 1) {
                    for (let c = 2; c < MAP_COLS - 2; c += 1) {
                        if (this.worldMap[r][c] === T.PATH) pathCells.push([r, c]);
                    }
                }
                const placed = [];
                const farEnough = (r, c, min) => placed.every(p => Math.abs(p[0] - r) + Math.abs(p[1] - c) > min);

                // 시작 마을 바로 앞은 비워둔다 (첫 포켓몬으로 바로 얻어맞지 않도록)
                for (let i = 0; i < pathCells.length && this.npcs.length < 64; i++) {
                    const idx = Math.floor(rng() * pathCells.length);
                    const [r, c] = pathCells[idx];
                    if (r < 30 && c < 30) continue;
                    if (!farEnough(r, c, 22)) continue;

                    // 도로가 이어지는 방향을 보고, 그 길을 따라오는 사람을 마주보게 한다
                    const horiz = (this.worldMap[r][c - 1] === T.PATH) || (this.worldMap[r][c + 1] === T.PATH);
                    const dirs = horiz ? ['left', 'right'] : ['up', 'down'];
                    const dir = dirs[Math.floor(rng() * 2)];

                    // 시작 마을에서 멀수록 강하다
                    const dist = Math.hypot(r - 16, c - 16) / Math.hypot(MAP_ROWS, MAP_COLS);
                    const level = Math.max(6, Math.min(56, Math.round(7 + dist * 66)));
                    const cls = NPC_TRAINER_CLASSES[Math.floor(rng() * NPC_TRAINER_CLASSES.length)];
                    const teamSize = level >= 34 ? 2 : 1;

                    // 그 지역 지형에 어울리는 포켓몬을 데리고 다닌다
                    const around = this.worldMap[r + (dir === 'down' ? 2 : -2)] ? this.worldMap[r + (dir === 'down' ? 2 : -2)][c] : T.GRASS;
                    const habitats = habitatsForTile(around === T.PATH ? T.TALL_GRASS : around);
                    const pool = POKEMON_DATABASE.filter(p =>
                        !p.isBoss && !p.isLegend && !p.isRareTier &&
                        (p.habitat === undefined || habitats.includes(p.habitat)) &&
                        level >= (EVOLUTION_MIN_LEVEL.get(p.id) || 1));
                    const team = [];
                    for (let k = 0; k < teamSize; k++) {
                        const pick = pool.length ? pool[Math.floor(rng() * pool.length)] : POKEMON_DATABASE[0];
                        team.push(pick.id);
                    }

                    placed.push([r, c]);
                    this.npcs.push({
                        id: nextId++, kind: 'trainer', r, c, dir,
                        title: cls.title,
                        name: cls.names[Math.floor(rng() * cls.names.length)],
                        body: cls.body, trim: cls.trim, cap: cls.cap,
                        taunt: cls.taunt, lose: cls.lose,
                        team, levels: team.map((_, k) => Math.max(5, level - (teamSize - 1 - k) * 2)),
                        prize: 60 + level * 16,
                        sight: 4
                    });
                }

                // ---- 2) 마을 주민 ----
                const townSites = [{ name: '오닉스 역전가', rMin: 1, rMax: 22, cMin: 1, cMax: 22 }]
                    .concat(EXTRA_TOWN_SITES.map(t => ({ name: t.name, rMin: t.rMin + 1, rMax: t.rMax - 1, cMin: t.cMin + 1, cMax: t.cMax - 1 })));

                townSites.forEach(site => {
                    let made = 0, guard = 0;
                    while (made < 5 && guard++ < 260) {
                        const r = site.rMin + Math.floor(rng() * (site.rMax - site.rMin));
                        const c = site.cMin + Math.floor(rng() * (site.cMax - site.cMin));
                        if (this.worldMap[r][c] !== T.TOWN) continue;
                        if ((r % 5) === 0 || (c % 6) === 0) continue;          // 도로 위는 피한다
                        if ((r % 5) === 2 && (c % 3) === 1) continue;          // 집이 서 있는 자리도 피한다
                        if (!this.npcs.every(n => Math.abs(n.r - r) + Math.abs(n.c - c) > 3)) continue;

                        const kind = VILLAGER_KINDS[Math.floor(rng() * VILLAGER_KINDS.length)];
                        const gift = rng() < 0.22;
                        this.npcs.push({
                            id: nextId++, kind: 'villager', r, c,
                            dir: ['down', 'left', 'right', 'up'][Math.floor(rng() * 4)],
                            title: kind.title, name: site.name,
                            body: kind.body, trim: kind.trim, cap: kind.cap,
                            lines: gift
                                ? GIFT_VILLAGER_LINES[Math.floor(rng() * GIFT_VILLAGER_LINES.length)]
                                : VILLAGER_LINES[Math.floor(rng() * VILLAGER_LINES.length)],
                            gift: gift ? (rng() < 0.5 ? 'MONSTER_BALL' : 'POTION') : null,
                            giftCount: gift ? 3 : 0
                        });
                        made++;
                    }
                });

                // 좌표로 빠르게 찾기 위한 색인
                this.npcByCell = {};
                this.npcs.forEach(n => { this.npcByCell[n.r * MAP_COLS + n.c] = n; });
            }

            npcAt(r, c) {
                if (!this.npcs) return null;
                for (const n of this.npcs) if (n.r === r && n.c === c) return n;
                return null;
            }

            /* NPC 한 명을 그린다 - 플레이어보다 단순하지만 방향/직업색이 드러나는 도트 */
            drawNpc(x, y, npc) {
                const ctx = this.ctx;
                const bob = Math.sin(performance.now() / 420 + npc.id) * 1.2;
                ctx.save();
                ctx.translate(x + TILE_SIZE / 2, y + TILE_SIZE / 2 + bob);
                ctx.imageSmoothingEnabled = false;

                // 그림자
                ctx.fillStyle = 'rgba(0,0,0,0.34)';
                ctx.beginPath();
                ctx.ellipse(0, 15 - bob, 8, 3.6, 0, 0, Math.PI * 2);
                ctx.fill();

                ctx.scale(1.15, 1.15);
                const ink = 'rgba(28,24,34,0.9)';
                // 몸통
                ctx.fillStyle = npc.body;
                ctx.fillRect(-6, -2, 12, 12);
                ctx.strokeStyle = ink; ctx.lineWidth = 1;
                ctx.strokeRect(-6, -2, 12, 12);
                ctx.fillStyle = npc.trim;
                ctx.fillRect(-6, 6, 12, 4);
                // 다리
                ctx.fillStyle = '#334155';
                ctx.fillRect(-4.5, 10, 3.5, 4);
                ctx.fillRect(1, 10, 3.5, 4);
                // 머리
                ctx.fillStyle = '#f5d0a9';
                ctx.fillRect(-5, -11, 10, 9);
                ctx.strokeRect(-5, -11, 10, 9);
                // 모자/머리카락
                ctx.fillStyle = npc.cap;
                ctx.fillRect(-6, -13, 12, 4);
                ctx.strokeRect(-6, -13, 12, 4);
                // 눈 (바라보는 방향)
                ctx.fillStyle = '#1f2937';
                if (npc.dir === 'down') { ctx.fillRect(-3, -7, 1.8, 2); ctx.fillRect(1.2, -7, 1.8, 2); }
                else if (npc.dir === 'left') { ctx.fillRect(-4, -7, 1.8, 2); }
                else if (npc.dir === 'right') { ctx.fillRect(2.2, -7, 1.8, 2); }
                ctx.restore();

                // 시야에 걸린 트레이너는 느낌표를 띄운다
                if (npc.alerted) {
                    ctx.save();
                    const pop = Math.min(1, (performance.now() - npc.alertedAt) / 160);
                    ctx.translate(x + TILE_SIZE / 2, y - 6 - pop * 6);
                    ctx.scale(pop, pop);
                    ctx.fillStyle = '#fef08a';
                    ctx.strokeStyle = '#7c2d12';
                    ctx.lineWidth = 2;
                    ctx.font = 'bold 22px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.strokeText('!', 0, 0);
                    ctx.fillText('!', 0, 0);
                    ctx.restore();
                }
            }

            /* 트레이너의 시야에 들어왔는지 검사한다 - 바라보는 방향으로 직선상 sight칸 이내,
               중간에 바위·물처럼 시야를 막는 지형이 없어야 한다. */
            checkTrainerSight() {
                if (!this.npcs || this.state !== GAME_STATES.FIELD || this._trainerEncounterLock) return;
                if (isNpcDialogOpen()) return;
                const T = TILE_TYPES;
                const blockers = new Set([T.ROCK, T.WATER, T.CAVE, T.FOREST, T.BAMBOO, T.CHERRY]);
                const step = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

                for (const npc of this.npcs) {
                    if (npc.kind !== 'trainer') continue;
                    if (this.player.defeatedTrainers && this.player.defeatedTrainers.has(npc.id)) continue;
                    const [dr, dc] = step[npc.dir] || step.down;
                    for (let k = 1; k <= npc.sight; k++) {
                        const rr = npc.r + dr * k, cc = npc.c + dc * k;
                        if (rr < 0 || cc < 0 || rr >= MAP_ROWS || cc >= MAP_COLS) break;
                        if (blockers.has(this.worldMap[rr][cc])) break;
                        if (this.player.y === rr && this.player.x === cc) {
                            this.triggerTrainerEncounter(npc, k);
                            return;
                        }
                    }
                }
            }

            /* 눈이 마주치면 느낌표 → 트레이너가 다가옴 → 대사 → 전투 */
            triggerTrainerEncounter(npc, distance) {
                this._trainerEncounterLock = true;
                npc.alerted = true;
                npc.alertedAt = performance.now();
                this.heldMoveKeys.clear();
                playSfx('encounter');
                showToast(`❗ ${npc.title} ${npc.name}와(과) 눈이 마주쳤다!`);

                const step = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[npc.dir] || [1, 0];
                let moved = 0;
                const walk = setInterval(() => {
                    if (moved >= distance - 1) {
                        clearInterval(walk);
                        npc.alerted = false;
                        showNpcDialog(`${npc.title} ${npc.name}`, npc.taunt, () => {
                            this._trainerEncounterLock = false;
                            this.startNpcTrainerBattle(npc);
                        });
                        return;
                    }
                    npc.r += step[0]; npc.c += step[1];
                    moved++;
                }, 170);
            }

            startNpcTrainerBattle(npc) {
                const team = npc.team.map(id => POKEMON_DATABASE.find(p => p.id === id)).filter(Boolean);
                if (team.length === 0) { this._trainerEncounterLock = false; return; }
                this.currentTrainerNpc = npc;
                this.currentGymSite = null;
                this.currentGymLeaderName = `${npc.title} ${npc.name}`;
                this.currentTrainerLevels = [...npc.levels];
                this.startBattle({ ...team[0], isBoss: true }, undefined, team.slice(1).map(p => p.id));
            }

            handleNpcTrainerDefeat() {
                const npc = this.currentTrainerNpc;
                if (!npc) return;
                if (!this.player.defeatedTrainers) this.player.defeatedTrainers = new Set();
                let prize = npc.prize;
                if (this.player.defeatedTrainers.has(npc.id)) {
                    prize = Math.round(prize * 0.2);
                } else {
                    this.player.defeatedTrainers.add(npc.id);
                    this.stats.trainersBeaten = (this.stats.trainersBeaten || 0) + 1;
                }
                this.player.gold += prize;
                showToast(`🏅 ${npc.title} ${npc.name} 격파! 상금 ${prize}G를 받았다.`);
                // 패배 대사는 전투 화면이 닫힌 뒤에 띄운다
                const line = npc.lose;
                setTimeout(() => showNpcDialog(`${npc.title} ${npc.name}`, line, null), 900);
            }

            /* [스페이스] - 바라보는 칸 또는 바로 옆에 있는 NPC에게 말을 건다 */
            tryTalkToNpc() {
                // 대화창이 열려 있으면 무조건 "넘기기"가 먼저다. (트레이너와 눈이 마주쳐
                // 이동이 잠긴 상태에서도 도발 대사는 넘길 수 있어야 전투로 이어진다.)
                if (isNpcDialogOpen()) { advanceNpcDialog(); return; }
                if (this.state !== GAME_STATES.FIELD || this._trainerEncounterLock) return;

                const step = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[this.player.direction] || [1, 0];
                const targets = [
                    [this.player.y + step[0], this.player.x + step[1]],
                    [this.player.y - 1, this.player.x], [this.player.y + 1, this.player.x],
                    [this.player.y, this.player.x - 1], [this.player.y, this.player.x + 1]
                ];
                for (const [r, c] of targets) {
                    const npc = this.npcAt(r, c);
                    if (!npc) continue;
                    if (npc.kind === 'trainer') {
                        const beaten = this.player.defeatedTrainers && this.player.defeatedTrainers.has(npc.id);
                        if (beaten) {
                            showNpcDialog(`${npc.title} ${npc.name}`, npc.lose, null);
                        } else {
                            showNpcDialog(`${npc.title} ${npc.name}`, npc.taunt, () => this.startNpcTrainerBattle(npc));
                        }
                        return;
                    }
                    // 주민 - 대사를 순서대로 보여주고, 선물이 있으면 한 번만 건넨다
                    const lines = [...(npc.lines || ['...'])];
                    if (npc.gift && npc.giftCount > 0 && !(this.player.receivedGifts && this.player.receivedGifts.has(npc.id))) {
                        const item = ITEM_DATABASE[npc.gift];
                        lines.push(`[${item.name}] ${npc.giftCount}개를 받았다!`);
                        showNpcDialog(`${npc.title} (${npc.name})`, lines, () => {
                            if (!this.player.receivedGifts) this.player.receivedGifts = new Set();
                            if (this.player.receivedGifts.has(npc.id)) return;
                            this.player.receivedGifts.add(npc.id);
                            const slot = this.player.inventory.find(sl => sl.item.id === item.id);
                            if (slot) slot.count += npc.giftCount;
                            else this.player.inventory.push({ item, count: npc.giftCount });
                            playSfx('catch');
                            this.saveGame(true);
                        });
                    } else {
                        showNpcDialog(`${npc.title} (${npc.name})`, lines, null);
                    }
                    return;
                }
            }

            /* ==========================================================================
               9-B1. 매크로 지형 변주 레이어
               같은 지형이 넓게 펼쳐지면, 타일 그림을 아무리 여러 종류로 만들어도
               40픽셀 격자가 규칙적으로 반복되는 게 눈에 띈다. 실제 자연은 그보다
               훨씬 큰 스케일로 밝기와 색이 일렁인다 - 볕이 드는 자리, 물기가 많은
               저지대, 마른 둔덕 같은 것들이다.
               그래서 지도 전체 크기(1타일=1픽셀)짜리 저해상도 노이즈 레이어를 한 번
               구워두고, 매 프레임 화면에 보이는 부분만 잘라 40배로 확대해 soft-light로
               덮는다. 브라우저가 확대할 때 자동으로 부드럽게 보간해주므로, 단 한 번의
               drawImage로 화면 전체에 커다란 명암 기복이 생기고 타일 격자감이 크게 줄어든다.
               ========================================================================== */
            buildMacroVariationLayer() {
                const cv = document.createElement('canvas');
                cv.width = MAP_COLS;
                cv.height = MAP_ROWS;
                const ctx = cv.getContext('2d');
                const img = ctx.createImageData(MAP_COLS, MAP_ROWS);
                const data = img.data;

                // 격자점에서 값을 뽑아 부드럽게 보간하는 값 노이즈
                const rnd = makeSeededRng(this.worldSeed ^ 0x5eed1234);
                const grid = [];
                const GN = 96; // 노이즈 격자 해상도
                for (let i = 0; i < GN * GN; i++) grid.push(rnd());
                const at = (gx, gy) => grid[((gy % GN) + GN) % GN * GN + (((gx % GN) + GN) % GN)];
                const smooth = t => t * t * (3 - 2 * t);
                const noise = (x, y) => {
                    const x0 = Math.floor(x), y0 = Math.floor(y);
                    const fx = smooth(x - x0), fy = smooth(y - y0);
                    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
                    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
                };

                for (let r = 0; r < MAP_ROWS; r++) {
                    for (let c = 0; c < MAP_COLS; c++) {
                        // 세 개의 스케일을 겹친다. 화면 하나가 23x16타일쯤이므로,
                        // 한 화면 안에서도 기복이 보이도록 주 스케일을 10타일 주기로 잡았다.
                        let n = noise(c / 11, r / 11) * 0.55
                              + noise(c / 4.5, r / 4.5) * 0.30
                              + noise(c / 29, r / 29) * 0.15;
                        n = Math.max(0, Math.min(1, (n - 0.5) * 1.5 + 0.5));
                        // 곱연산(multiply)으로 덮을 값 - 밝은 지형(눈밭)에서도 확실히 먹힌다.
                        // 195~255 범위라 최대 23%까지 그늘이 진다.
                        const v = Math.round(195 + n * 60);
                        const warm = Math.round((n - 0.5) * 18); // 볕 드는 곳은 따뜻하게, 그늘은 차갑게
                        const i = (r * MAP_COLS + c) * 4;
                        data[i] = Math.max(0, Math.min(255, v + warm));
                        data[i + 1] = v;
                        data[i + 2] = Math.max(0, Math.min(255, v - warm));
                        data[i + 3] = 255;
                    }
                }
                ctx.putImageData(img, 0, 0);
                this.macroCanvas = cv;
            }

            /* 화면에 보이는 구역의 매크로 변주를 한 번의 drawImage로 덮는다 */
            drawMacroVariation(camX, camY) {
                if (!this.macroCanvas) return;
                const ctx = this.ctx;
                const W = this.canvas.width, H = this.canvas.height;
                const sx = camX / TILE_SIZE;
                const sy = camY / TILE_SIZE;
                const sw = W / TILE_SIZE;
                const sh = H / TILE_SIZE;
                ctx.save();
                ctx.globalCompositeOperation = 'multiply';
                ctx.globalAlpha = 0.9;
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                try {
                    ctx.drawImage(this.macroCanvas, sx, sy, sw, sh, 0, 0, W, H);
                } catch (e) { /* 화면 밖 구간은 무시 */ }
                ctx.restore();
            }

            /* ==========================================================================
               9-B2. 지형 후처리
               "물가에는 모래사장", "설원 안의 호수는 얼어붙는다", "바위산 깊은 곳에는
               동굴이 뚫린다" 처럼 주변 지형을 보고 나서야 결정할 수 있는 지형들을
               1차 생성이 끝난 뒤에 덧입힌다.
               ========================================================================== */
            applyTerrainRefinements() {
                const T = TILE_TYPES;
                const map = this.worldMap;
                const isWater = (r, c) => {
                    const t = map[r] && map[r][c];
                    return t === T.WATER || t === T.ICE_FIELD || t === T.SWAMP;
                };

                // 1) 설원 안의 물은 얼어붙은 빙판 호수가 된다
                for (let r = 0; r < MAP_ROWS; r++) {
                    for (let c = 0; c < MAP_COLS; c++) {
                        if (map[r][c] !== T.WATER) continue;
                        let snowNear = 0;
                        for (let dr = -3; dr <= 3; dr++) {
                            for (let dc = -3; dc <= 3; dc++) {
                                const nr = r + dr, nc = c + dc;
                                if (nr < 0 || nc < 0 || nr >= MAP_ROWS || nc >= MAP_COLS) continue;
                                if (map[nr][nc] === T.SNOW) snowNear++;
                            }
                        }
                        if (snowNear >= 4) map[r][c] = T.ICE_FIELD;
                    }
                }

                // 1b) 설원 한복판에 얼어붙은 호수를 몇 개 직접 찍는다
                const snowCells = [];
                for (let r = 0; r < MAP_ROWS; r += 2) {
                    for (let c = 0; c < MAP_COLS; c += 2) {
                        if (map[r][c] === T.SNOW && !this.isProtectedTile(r, c)) snowCells.push([r, c]);
                    }
                }
                for (let i = 0; i < Math.min(snowCells.length, 26); i++) {
                    const [cr, cc] = snowCells[Math.floor(this.wrnd() * snowCells.length)];
                    const rad = 2 + Math.floor(this.wrnd() * 4);
                    for (let dr = -rad; dr <= rad; dr++) {
                        for (let dc = -rad; dc <= rad; dc++) {
                            const nr = cr + dr, nc = cc + dc;
                            if (nr < 0 || nc < 0 || nr >= MAP_ROWS || nc >= MAP_COLS) continue;
                            if (this.isProtectedTile(nr, nc)) continue;
                            if (map[nr][nc] !== T.SNOW) continue;
                            if (Math.hypot(dr, dc) <= rad && this.wrnd() < 0.85) map[nr][nc] = T.ICE_FIELD;
                        }
                    }
                }

                // 2) 바다·호수와 맞닿은 육지는 모래사장이 된다 (사막/화산/설원/유적은 제외)
                const beachable = new Set([T.GRASS, T.TALL_GRASS, T.FOREST, T.FLOWER, T.CHERRY, T.BAMBOO]);
                const toBeach = [];
                for (let r = 0; r < MAP_ROWS; r++) {
                    for (let c = 0; c < MAP_COLS; c++) {
                        if (!beachable.has(map[r][c])) continue;
                        if (this.isProtectedTile(r, c)) continue;
                        let near = false;
                        for (let dr = -2; dr <= 2 && !near; dr++) {
                            for (let dc = -2; dc <= 2; dc++) {
                                const nr = r + dr, nc = c + dc;
                                if (nr < 0 || nc < 0 || nr >= MAP_ROWS || nc >= MAP_COLS) continue;
                                if (map[nr][nc] === T.WATER) { near = true; break; }
                            }
                        }
                        if (near) toBeach.push([r, c]);
                    }
                }
                toBeach.forEach(([r, c]) => { map[r][c] = T.BEACH; });

                // 3) 바위 지대 깊숙한 곳에 동굴이 뚫린다.
                //    무작위 좌표를 찍으면 바위 타일(전체의 1%)에 거의 맞지 않으므로,
                //    실제 바위 타일 목록을 모아 그 중에서 입구를 고른다.
                const rockCells = [];
                for (let r = 0; r < MAP_ROWS; r++) {
                    for (let c = 0; c < MAP_COLS; c++) {
                        if (map[r][c] === T.ROCK && !this.isProtectedTile(r, c)) rockCells.push([r, c]);
                    }
                }
                const caveSeeds = Math.min(rockCells.length, 150);
                for (let i = 0; i < caveSeeds; i++) {
                    const [cr, cc] = rockCells[Math.floor(this.wrnd() * rockCells.length)];
                    if (map[cr][cc] !== T.ROCK) continue;
                    const rad = 1 + Math.floor(this.wrnd() * 3);
                    for (let dr = -rad; dr <= rad; dr++) {
                        for (let dc = -rad; dc <= rad; dc++) {
                            const nr = cr + dr, nc = cc + dc;
                            if (nr < 0 || nc < 0 || nr >= MAP_ROWS || nc >= MAP_COLS) continue;
                            if (this.isProtectedTile(nr, nc)) continue;
                            if (map[nr][nc] !== T.ROCK) continue;
                            if (Math.hypot(dr, dc) <= rad && this.wrnd() < 0.8) map[nr][nc] = T.CAVE;
                        }
                    }
                }

                // 4) 평원 곳곳에 작은 꽃밭 / 숲 가장자리에 늪 웅덩이를 흩뿌린다
                const sprinkle = (from, to, count, radMax) => {
                    for (let i = 0; i < count; i++) {
                        const cr = 8 + Math.floor(this.wrnd() * (MAP_ROWS - 16));
                        const cc = 8 + Math.floor(this.wrnd() * (MAP_COLS - 16));
                        if (map[cr][cc] !== from) continue;
                        const rad = 1 + Math.floor(this.wrnd() * radMax);
                        for (let dr = -rad; dr <= rad; dr++) {
                            for (let dc = -rad; dc <= rad; dc++) {
                                const nr = cr + dr, nc = cc + dc;
                                if (nr < 0 || nc < 0 || nr >= MAP_ROWS || nc >= MAP_COLS) continue;
                                if (this.isProtectedTile(nr, nc)) continue;
                                if (map[nr][nc] !== from) continue;
                                if (Math.hypot(dr, dc) <= rad && this.wrnd() < 0.75) map[nr][nc] = to;
                            }
                        }
                    }
                };
                sprinkle(T.GRASS, T.FLOWER, 70, 3);
                sprinkle(T.FOREST, T.SWAMP, 34, 2);
                sprinkle(T.FOREST, T.BAMBOO, 30, 2);
                sprinkle(T.GRASS, T.CHERRY, 26, 2);
                sprinkle(T.SAND, T.WASTELAND, 40, 3);
                sprinkle(T.ROCK, T.RUINS, 22, 2);
            }

            // 좌표가 고정되어야 하는 랜드마크(마을/체육관/상점/센터/사원) 타일인지 검사.
            // 장식 지형지물 배치와 도로 포장 양쪽에서 공통으로 사용한다.
            isProtectedTile(r, c) {
                if (r < 24 && c < 24) return true; // 시작 마을 보호
                const tile = this.worldMap[r] ? this.worldMap[r][c] : null;
                if (tile == null) return true;
                if (LEGEND_TEMPLE_INFO[tile]) return true;
                return tile === TILE_TYPES.TOWN || tile === TILE_TYPES.CENTER ||
                       tile === TILE_TYPES.GYM || tile === TILE_TYPES.MART ||
                       tile === TILE_TYPES.LAND_TEMPLE || tile === TILE_TYPES.SEA_TEMPLE ||
                       tile === TILE_TYPES.SKY_TEMPLE;
            }

            /* ==========================================================================
               9-B. 지형지물 랜덤 배치 시스템
               타운/체육관/사원처럼 좌표가 고정되어야 하는 랜드마크를 제외한 나머지 지역에,
               바위 무더기 / 숲 군락 / 작은 연못 / 꽃밭 같은 "장식용 지형지물"을
               매 게임 시작마다 완전히 다른 위치·모양으로 흩뿌려서 심어준다.
               같은 맵을 다시 시작해도 지형지물 배치가 절대 동일하지 않도록
               중심 좌표 자체를 this.wrnd()으로 뽑고, 군집 모양도 매번 랜덤하게 결정한다.
               ========================================================================== */
            scatterRandomLandmarks() {
                const isProtected = (r, c) => this.isProtectedTile(r, c);

                const stampCluster = (tileType, count) => {
                    for (let i = 0; i < count; i++) {
                        const cr = 24 + Math.floor(this.wrnd() * (MAP_ROWS - 30));
                        const cc = 24 + Math.floor(this.wrnd() * (MAP_COLS - 30));
                        const radius = 1 + Math.floor(this.wrnd() * 3); // 매번 다른 군집 크기(1~3칸 반경)
                        for (let dr = -radius; dr <= radius; dr++) {
                            for (let dc = -radius; dc <= radius; dc++) {
                                const r = cr + dr, c = cc + dc;
                                if (r < 0 || c < 0 || r >= MAP_ROWS || c >= MAP_COLS) continue;
                                if (isProtected(r, c)) continue;
                                // 원형에 가깝게, 그리고 군집 내부도 듬성듬성하게(랜덤 확률) 채워서
                                // 매번 다른 실루엣의 지형지물 무더기가 만들어지도록 함
                                if (Math.hypot(dr, dc) <= radius && this.wrnd() < 0.7) {
                                    this.worldMap[r][c] = tileType;
                                }
                            }
                        }
                    }
                };

                // 맵이 훨씬 커진 만큼 장식 지형지물 개수도 비례해서 늘려 밀도가 흐릿해지지 않도록 한다.
                // 바위 무더기 (군집형) - 지역 곳곳에 무작위 개수/위치로 생성
                stampCluster(TILE_TYPES.ROCK, 136 + Math.floor(this.wrnd() * 80));
                // 작은 숲 군락 (초원 지대에 무작위로 섞여 들어가는 미니 삼림)
                stampCluster(TILE_TYPES.FOREST, 104 + Math.floor(this.wrnd() * 64));
                // 작은 연못/호수 (물가 지형지물)
                stampCluster(TILE_TYPES.WATER, 80 + Math.floor(this.wrnd() * 48));
                // 키 큰 풀숲 - 포켓몬 조우 확률이 있는 지형지물이라 매번 다른 위치에 재배치되면
                // 탐험 루트 자체가 매 플레이마다 달라지는 효과가 있음
                stampCluster(TILE_TYPES.TALL_GRASS, 200 + Math.floor(this.wrnd() * 120));
                // 넓어진 대륙이 허전하지 않도록 설원/사막 자락 얼룩도 흩뿌린다
                stampCluster(TILE_TYPES.SNOW, 26 + Math.floor(this.wrnd() * 16));
                stampCluster(TILE_TYPES.SAND, 30 + Math.floor(this.wrnd() * 18));
            }

            /* ==========================================================================
               9-C. 도로(PATH) 네트워크 생성
               실제 닌텐도 포켓몬 게임의 "루트"처럼, 포켓몬이 등장하는 수풀 지대와
               완전히 분리된 흙길을 마을 → 체육관/상점/센터 → 각 지역 관문(웨이포인트) →
               세 개의 전설의 사원까지 구불구불하게 이어준다. 이 길 위에서는 절대
               야생 포켓몬이 나타나지 않는다 (encounterTiles 목록에 PATH가 없음).
               ========================================================================== */
            carvePath(startR, startC, endR, endC, width = 2) {
                let cr = startR, cc = startC;
                const maxSteps = (Math.abs(endR - startR) + Math.abs(endC - startC)) * 3 + 40;
                let steps = 0;
                const half = Math.floor(width / 2);

                while ((cr !== endR || cc !== endC) && steps < maxSteps) {
                    steps++;

                    for (let dr = -half; dr <= width - half - 1; dr++) {
                        for (let dc = -half; dc <= width - half - 1; dc++) {
                            const r = cr + dr, c = cc + dc;
                            if (r < 0 || c < 0 || r >= MAP_ROWS || c >= MAP_COLS) continue;
                            if (this.isProtectedTile(r, c)) continue;
                            if (this.worldMap[r][c] === TILE_TYPES.WATER) continue; // 바다는 포장하지 않고 자연스럽게 우회
                            this.worldMap[r][c] = TILE_TYPES.PATH;
                        }
                    }

                    const dr = endR - cr, dc = endC - cc;
                    let moveR = 0, moveC = 0;

                    if (Math.abs(dr) > Math.abs(dc)) {
                        moveR = dr > 0 ? 1 : -1;
                        if (this.wrnd() < 0.2 && dc !== 0) moveC = dc > 0 ? 1 : -1;
                    } else {
                        moveC = dc > 0 ? 1 : -1;
                        if (this.wrnd() < 0.2 && dr !== 0) moveR = dr > 0 ? 1 : -1;
                    }

                    // 자연스러운 곡선을 위해 이따금 진행 방향에 수직으로 살짝 흔들어준다
                    if (this.wrnd() < 0.15) {
                        if (moveR !== 0) moveC += this.wrnd() < 0.5 ? 1 : -1;
                        else moveR += this.wrnd() < 0.5 ? 1 : -1;
                    }

                    cr = Math.max(0, Math.min(MAP_ROWS - 1, cr + moveR));
                    cc = Math.max(0, Math.min(MAP_COLS - 1, cc + moveC));
                }
            }

            carveRoadNetwork() {
                const TOWN_HUB = [16, 16];
                const GYM = [19, 8];
                const CENTER = [8, 19];
                const MART = [13, 13];

                // 4배로 넓어진 대륙을 관통하는 간선 도로 - 주요 분기점(웨이포인트)을
                // 늘려서 어느 지역으로 가든 길이 끊기지 않도록 했다.
                const WP_NW = [110, 90];
                const WP_N = [80, 230];
                const WP_MID = [300, 260];
                const WP_W = [330, 150];
                const WP_S = [420, 200];
                const WP_E = [270, 430];
                const WP_SE = [470, 420];

                const LAND_TEMPLE = [460, 470];
                const SEA_TEMPLE = [300, 610];
                const SKY_TEMPLE = [80, 480];

                // 마을 내부 도로
                this.carvePath(TOWN_HUB[0], TOWN_HUB[1], GYM[0], GYM[1], 2);
                this.carvePath(TOWN_HUB[0], TOWN_HUB[1], CENTER[0], CENTER[1], 2);
                this.carvePath(TOWN_HUB[0], TOWN_HUB[1], MART[0], MART[1], 2);

                // 간선 도로
                this.carvePath(TOWN_HUB[0], TOWN_HUB[1], WP_NW[0], WP_NW[1], 3);
                this.carvePath(WP_NW[0], WP_NW[1], WP_N[0], WP_N[1], 3);       // 북서 삼림 통과
                this.carvePath(WP_N[0], WP_N[1], SKY_TEMPLE[0], SKY_TEMPLE[1], 3);
                this.carvePath(WP_NW[0], WP_NW[1], WP_MID[0], WP_MID[1], 3);
                this.carvePath(WP_MID[0], WP_MID[1], WP_E[0], WP_E[1], 3);
                this.carvePath(WP_E[0], WP_E[1], SEA_TEMPLE[0], SEA_TEMPLE[1], 3);
                this.carvePath(WP_MID[0], WP_MID[1], WP_W[0], WP_W[1], 3);      // 서부 고원
                this.carvePath(WP_W[0], WP_W[1], WP_S[0], WP_S[1], 3);
                this.carvePath(WP_S[0], WP_S[1], WP_SE[0], WP_SE[1], 3);
                this.carvePath(WP_SE[0], WP_SE[1], LAND_TEMPLE[0], LAND_TEMPLE[1], 3);

                // 마을 내부 도로 + 간선 진입로
                EXTRA_TOWN_SITES.forEach(site => {
                    this.carvePath(site.center[0], site.center[1], site.gym[0], site.gym[1], 2);
                    this.carvePath(site.center[0], site.center[1], site.mart[0], site.mart[1], 2);
                });
                const byName = {};
                EXTRA_TOWN_SITES.forEach(site => { byName[site.name] = site; });

                const link = (from, townName) => {
                    const site = byName[townName];
                    if (site) this.carvePath(from[0], from[1], site.center[0], site.center[1], 3);
                };
                link(WP_MID, '녹슨숲 거주구');
                link(WP_E, '오염호수 연구특구');
                link(WP_E, '폐항구 선착장');
                link(SKY_TEMPLE, '동결 공업단지');
                link(WP_S, '모래무덤 채굴장');
                link(WP_W, '절벽 슬럼가');
                link(LAND_TEMPLE, '용광로 지구');
            }

            createPokemonInstance(dbData, level) {
                const nature = NATURES[Math.floor(Math.random() * NATURES.length)];

                const ivs = {
                    hp: Math.floor(Math.random() * 32),
                    atk: Math.floor(Math.random() * 32),
                    def: Math.floor(Math.random() * 32),
                    spAtk: Math.floor(Math.random() * 32),
                    spDef: Math.floor(Math.random() * 32),
                    spe: Math.floor(Math.random() * 32)
                };

                const evs = { hp: 0, atk: 0, def: 0, spAtk: 0, spDef: 0, spe: 0 };
                const stats = computeStatsAtLevel(dbData.baseStats, level, ivs, evs, nature);

                return {
                    ...dbData,
                    level: level,
                    hp: stats.maxHp,
                    maxHp: stats.maxHp,
                    atk: stats.atk,
                    def: stats.def,
                    spAtk: stats.spAtk,
                    spDef: stats.spDef,
                    spe: stats.spe,
                    ivs: ivs,
                    evs: evs,
                    nature: nature,
                    ability: getAbilityForSpecies(dbData),
                    skills: instantiateSkills(dbData.skills),
                    status: STATUS_EFFECTS.NONE,
                    attracted: false,
                    flinched: false,
                    confused: false,
                    confusedTurns: 0,
                    sleepTurns: 0,
                    statStages: makeEmptyStatStages(),
                    gemSlots: {},
                    // [이로치] 실제 게임처럼 아주 낮은 확률로 색이 다른 개체가 태어난다.
                    // 1/512 - 전설·보스급은 조금 더 높게 잡아 특별한 조우를 기억에 남게 한다.
                    isShiny: Math.random() < ((dbData.isLegend || dbData.isRareTier) ? 1 / 180 : 1 / 512),
                    exp: 0,
                    maxExp: expToNextLevel(level),
                    isMega: false
                };
            }

            bindInputEvents() {
                const MOVE_KEYS = new Set(['w', 'a', 's', 'd']);

                window.addEventListener('keydown', (e) => {
                    // 입력칸에 글자를 칠 때 게임 단축키가 가로채지 않도록 한다
                    // (그러지 않으면 비밀번호에 'b'를 치는 순간 보관함이 열려버린다).
                    // 단, Esc만은 통과시킨다 - 도감 검색창에 커서를 둔 채 Esc를 눌렀을 때
                    // 창이 닫히지 않으면 화면이 멈춘 것처럼 느껴지고, 포커스가 입력칸에
                    // 갇혀 있는 동안 다른 단축키도 전부 먹통이 되어 버린다.
                    const tag = (e.target && e.target.tagName || '').toLowerCase();
                    const typing = (tag === 'input' || tag === 'textarea' || tag === 'select');
                    const loginEl = document.getElementById('login-modal');
                    const loginOpen = !!(loginEl && loginEl.style.display === 'flex');
                    if (loginOpen) return;
                    if (typing) {
                        if (e.key === 'Escape') { releaseFocus(); closeTopModal(); }
                        return;
                    }
                    const key = e.key.toLowerCase();

                    // 조작 방법은 어느 화면에서든 열 수 있다 (예전의 화면 밖 안내 바를 대체)
                    if (key === '?' || key === '/' || e.key === 'F1') {
                        e.preventDefault();
                        toggleHelpModal();
                        return;
                    }

                    // 이동키는 여기서 즉시 이동시키지 않는다 - held set에 등록만 하고
                    // 실제 이동은 processMovementInput()이 매 프레임 moveDuration 간격으로
                    // 처리한다. e.repeat(브라우저 OS 키 반복) 이벤트는 아예 무시해서
                    // Set에 중복 등록되거나 첫 입력이 씹히는 일이 없게 한다.
                    if (key === ' ' || key === 'spacebar') {
                        e.preventDefault();
                        if (this.state === GAME_STATES.FIELD) this.tryTalkToNpc();
                        else if (isNpcDialogOpen()) advanceNpcDialog();   // 어느 상태든 대화창은 넘길 수 있게
                        return;
                    }

                    if (MOVE_KEYS.has(key)) {
                        if (!e.repeat) this.heldMoveKeys.add(key);
                        this.updateUI();
                        return;
                    }

                    if (this.state === GAME_STATES.FIELD) {
                        if (key === 'z') {
                            this.isRidingBike = !this.isRidingBike;
                            showToast(this.isRidingBike ? "🚲 자전거에 탑승했습니다! (이동 속도 증가)" : "🚶 자전거에서 내렸습니다.");
                        }
                        if (key === 'p') openPartyModal();
                        if (key === 'i') openBagModal();
                        if (key === 'v') openPokedexModal(); // 이동키(D)와 완전히 분리된 전용 단축키
                        if (key === 'm') this.checkShopInteract();
                        if (key === 'g') this.challengeGym();
                        if (key === 'h') this.healPartyAtCenter();
                        if (key === 'e') this.attemptTempleRitual();
                        if (key === 'x') openMegaGuideModal();
                        if (key === 'u') openGemModal();
                        if (key === 'b') openBoxModal();
                        if (key === 'r') openRecordModal();
                        if (key === 'f') this.saveGame(false);
                        if (key === 't') this.toggleFieldPostFx();
                    }
                    // ESC로 열려 있는 창을 닫는다 (강제 교체 상황은 제외)
                    if (key === 'escape') closeTopModal();
                    this.updateUI();
                });

                window.addEventListener('keyup', (e) => {
                    this.heldMoveKeys.delete(e.key.toLowerCase());
                });

                // 창/탭 전환 등으로 keyup을 못 받는 경우 이동키가 "눌린 채로 고정"되는
                // 버그를 막기 위한 안전장치
                window.addEventListener('blur', () => this.heldMoveKeys.clear());
            }

            /* 매 프레임 호출됨 (render 루프에서). heldMoveKeys에 들어있는 이동키를 보고,
               마지막 이동으로부터 moveDuration(기본 130ms, 자전거는 절반)이 지났을 때만
               정확히 한 칸씩 이동시킨다. 이렇게 하면 키를 꾹 눌러도 OS 키 반복 속도와
               무관하게 항상 같은 속도로 걷고, 다리 스윙 애니메이션도 실제 이동 칸수와
               항상 동기화된다. */
            processMovementInput() {
                if (this.state !== GAME_STATES.FIELD || this.titleScreenActive) return;
                if (this._trainerEncounterLock || isNpcDialogOpen()) return;
                if (this.heldMoveKeys.size === 0) return;

                const now = performance.now();
                const interval = this.isRidingBike ? this.player.moveDuration / 2 : this.player.moveDuration;
                if (now - this.lastStepTime < interval) return;

                let step = this.isRidingBike ? 2 : 1;
                let dx = 0, dy = 0;

                // 여러 키가 동시에 눌려있어도 한 방향만 우선 처리 (마지막에 눌린 방향 느낌을
                // 주기 위해 W/A/S/D 순서로 검사)
                if (this.heldMoveKeys.has('w')) { dy = -step; this.player.direction = 'up'; }
                else if (this.heldMoveKeys.has('s')) { dy = step; this.player.direction = 'down'; }
                else if (this.heldMoveKeys.has('a')) { dx = -step; this.player.direction = 'left'; }
                else if (this.heldMoveKeys.has('d')) { dx = step; this.player.direction = 'right'; }

                if (dx !== 0 || dy !== 0) {
                    this.player.animStep = (this.player.animStep + 1) % 4;
                    this.movePlayer(dx, dy);
                    this.lastStepTime = now;
                    this.updateUI();
                }
            }

            movePlayer(dx, dy) {
                const prevX = this.player.x, prevY = this.player.y;
                const nx = Math.max(0, Math.min(MAP_COLS - 1, this.player.x + dx));
                const ny = Math.max(0, Math.min(MAP_ROWS - 1, this.player.y + dy));

                // 실제로 칸이 이동했을 때만 부드러운 이동 애니메이션을 새로 시작한다.
                // (맵 끝에 막혀 제자리인 경우엔 애니메이션을 재시작하지 않아 캐릭터가
                //  움찔거리지 않도록 함)
                if (nx !== this.player.x || ny !== this.player.y) {
                    this.player.moveFromX = this.getVisualX();
                    this.player.moveFromY = this.getVisualY();
                    this.player.moveStart = performance.now();
                }

                this.player.x = nx;
                this.player.y = ny;
                if (nx !== prevX || ny !== prevY) {
                    this.stats.steps++;
                    this.spawnFootstepFx();
                }
                this.refreshFieldMusic(false);
                this.checkTrainerSight();

                if (Math.random() < 0.04) {
                    this.weatherIdx = Math.floor(Math.random() * WEATHERS.length);
                }

                this.checkTileTrigger();
            }

            /* 부드러운 이동 보간 - 실제 로직상의 좌표(this.player.x/y)는 키를 누르는 즉시
               한 칸씩 갱신되지만(충돌/조우 판정을 위해 그대로 유지), 화면에 그려지는
               "시각적" 좌표는 moveFromX/Y → x/y 로 moveDuration(ms)에 걸쳐 ease-out 하며
               부드럽게 미끄러지듯 이동한다. 카메라와 캐릭터 스프라이트 렌더링 모두 이
               시각적 좌표를 사용해 이전의 "칸 단위로 뚝뚝 끊기는" 움직임을 개선한다. */
            getMoveProgress() {
                const t = Math.min(1, (performance.now() - this.player.moveStart) / this.player.moveDuration);
                // ease-out cubic: 시작은 빠르게, 도착 직전엔 부드럽게 감속
                return 1 - Math.pow(1 - t, 3);
            }

            getVisualX() {
                const t = this.getMoveProgress();
                return this.player.moveFromX + (this.player.x - this.player.moveFromX) * t;
            }

            getVisualY() {
                const t = this.getMoveProgress();
                return this.player.moveFromY + (this.player.y - this.player.moveFromY) * t;
            }

            checkTileTrigger() {
                const tile = this.worldMap[this.player.y][this.player.x];

                // 조우 발생 여부와 무관하게 걸음 수를 누적시킨다
                this.stepsSinceEncounter++;

                // 최소 4칸을 이동하기 전에는 절대 조우하지 않으며(쿨다운),
                // 그 이후부터는 매 걸음마다 12%의 낮은 확률로만 조우한다.
                // (기존 25%·쿨다운 없음 → 사실상 매 칸마다 조우하던 문제 개선)
                const ENCOUNTER_MIN_STEPS = 4;
                const ENCOUNTER_CHANCE = 0.12;

                const encounterTiles = [
                    TILE_TYPES.TALL_GRASS, TILE_TYPES.WATER, TILE_TYPES.SAND, TILE_TYPES.SNOW,
                    TILE_TYPES.VOLCANO, TILE_TYPES.FOREST,
                    // [지형 확장] 새로 생긴 지형에서도 야생 포켓몬이 나타난다
                    TILE_TYPES.SWAMP, TILE_TYPES.BEACH, TILE_TYPES.FLOWER, TILE_TYPES.CAVE,
                    TILE_TYPES.RUINS, TILE_TYPES.ICE_FIELD, TILE_TYPES.WASTELAND,
                    TILE_TYPES.BAMBOO, TILE_TYPES.CHERRY
                ];
                const tileHabitats = habitatsForTile(tile);
                // 벌레퇴치스프레이가 남아 있으면 야생 조우 판정만 건너뛴다.
                // (함수 전체를 return하면 사원 안내 같은 다른 타일 이벤트까지 막혀버린다)
                const repelOn = this.repelRemainingMs() > 0;
                if (!repelOn && encounterTiles.includes(tile) && this.stepsSinceEncounter >= ENCOUNTER_MIN_STEPS && Math.random() < ENCOUNTER_CHANCE) {
                    this.stepsSinceEncounter = 0;

                    // 10-B. 준전설/환상급(isRareTier) 포켓몬 조우 판정을 먼저 시도한다.
                    // 이 등급은 일반 야생 포켓몬과 달리 내 파티 레벨과 무관하게 항상
                    // 45~60 사이의 랜덤 레벨로 등장하며, 등장 확률 자체를 극도로 낮게(1.5%)
                    // 잡아 "어쩌다 한 번 마주치는 특별한 조우"가 되도록 한다.
                    const RARE_TIER_ENCOUNTER_CHANCE = 0.015;
                    const rareTierCandidates = POKEMON_DATABASE.filter(p => p.isRareTier && (p.habitat === undefined || tileHabitats.includes(p.habitat)));

                    // 진짜 전설/환상(isLegend)은 준전설(isRareTier)보다도 한층 더 희귀하게
                    // 등장해야 격이 느껴지므로 확률을 절반 이하로 낮췄다. 그란돈/가이오가/
                    // 레쿠쟈(TEMPLE_LEGEND_IDS)는 사원 의식 전용 "상자 전설"이라 이 야생
                    // 후보에서는 제외한다 - 야생에서 우연히 마주쳐 버리면 사원/성물 시스템의
                    // 특별함이 사라지기 때문. 레벨은 준전설과 동일하게 45~60으로 고정한다.
                    const LEGEND_ENCOUNTER_CHANCE = 0.006;
                    const legendCandidates = POKEMON_DATABASE.filter(p => p.isLegend && !TEMPLE_LEGEND_IDS.has(p.id) && (p.habitat === undefined || tileHabitats.includes(p.habitat)));

                    if (legendCandidates.length > 0 && Math.random() < LEGEND_ENCOUNTER_CHANCE) {
                        const legendTemplate = legendCandidates[Math.floor(Math.random() * legendCandidates.length)];
                        const legendLv = 45 + Math.floor(Math.random() * 16); // 45 ~ 60 레벨 균등 랜덤
                        this.startBattle(legendTemplate, legendLv);
                        return;
                    }

                    if (rareTierCandidates.length > 0 && Math.random() < RARE_TIER_ENCOUNTER_CHANCE) {
                        const rareTemplate = rareTierCandidates[Math.floor(Math.random() * rareTierCandidates.length)];
                        const rareLv = 45 + Math.floor(Math.random() * 16); // 45 ~ 60 레벨 균등 랜덤
                        this.startBattle(rareTemplate, rareLv);
                        return;
                    }

                    // 이 조우에 배정될 레벨을 먼저 정하고 나서 후보를 고른다 (기존에는
                    // 레벨과 무관하게 아무 진화 단계나 후보에 들어가서, 진화 레벨보다
                    // 한참 낮은 레벨로 최종 진화체가 등장하는 버그가 있었다).
                    // [지역제] 야생 레벨은 내 파티가 아니라 "지금 서 있는 지역"이 정한다.
                    const wildLv = rollWildLevel(this.player.x, this.player.y);

                    const levelAppropriate = p => wildLv >= (EVOLUTION_MIN_LEVEL.get(p.id) || 1);
                    let validWilds = POKEMON_DATABASE.filter(p => !p.isBoss && !p.isLegend && !p.isRareTier && (p.habitat === undefined || tileHabitats.includes(p.habitat)) && levelAppropriate(p));

                    // 서식지 + 레벨 조건을 모두 만족하는 후보가 하나도 없다면(예: 아주 낮은
                    // 레벨대), 레벨 조건만 완화해 서식지 후보 중에서 고른다.
                    if (validWilds.length === 0) {
                        validWilds = POKEMON_DATABASE.filter(p => !p.isBoss && !p.isLegend && !p.isRareTier && (p.habitat === undefined || tileHabitats.includes(p.habitat)));
                    }

                    const enemyTemplate = validWilds[Math.floor(Math.random() * validWilds.length)] || POKEMON_DATABASE[5];
                    this.startBattle(enemyTemplate, wildLv);
                    return;
                }

                // 사원 타일에 도착하면 어떤 성물이 필요한지 안내 (야생 조우는 발생하지 않음)
                const templeInfo = LEGEND_TEMPLE_INFO[tile];
                if (templeInfo) {
                    const orbItem = Object.values(ITEM_DATABASE).find(it => it.id === templeInfo.orbId);
                    showToast(`⛩️ ${templeInfo.templeName}에 도착했다. [${orbItem ? orbItem.name : '성물'}]을(를) 지니고 [E]키를 눌러보세요.`);
                }
            }

            checkShopInteract() {
                const tile = this.worldMap[this.player.y][this.player.x];
                if (tile === TILE_TYPES.MART || tile === TILE_TYPES.TOWN) {
                    openShopModal();
                } else {
                    showToast("마을 또는 프렌들리 숍 타일에서만 이용 가능합니다.");
                }
            }

            healPartyAtCenter() {
                const tile = this.worldMap[this.player.y][this.player.x];
                if (tile === TILE_TYPES.CENTER || tile === TILE_TYPES.TOWN) {
                    this.player.party.forEach(p => {
                        p.hp = p.maxHp;
                        p.status = STATUS_EFFECTS.NONE;
                        p.attracted = false;
                        p.confused = false;
                        p.confusedTurns = 0;
                        p.sleepTurns = 0;
                        p.flinched = false;
                        p.statStages = makeEmptyStatStages();
                        if (p.skills) p.skills.forEach(sk => { sk.pp = sk.maxPp; });
                    });
                    this.player.activeIdx = 0;
                    showToast("🏥 포켓몬 센터에서 파티를 완벽히 치료했습니다! (PP 회복 · 선두는 1번 포켓몬)");
                    playSfx('heal');
                    this.updateUI();
                    this.saveGame(true);
                } else {
                    showToast("마을이나 포켓몬 센터 타일에서만 치료할 수 있습니다.");
                }
            }

            /* ==========================================================================
               10-R. 벌레퇴치스프레이
               남은 시간을 "만료 시각"으로 들고 있다가, 저장할 때는 남은 초로 바꿔
               기록한다. 시각 그대로 저장하면 게임을 껐다 며칠 뒤에 켰을 때 이미
               지나버린 시간이 되어 효과가 사라지기 때문이다.
               ========================================================================== */
            repelRemainingMs() {
                if (!this.repelUntil) return 0;
                const left = this.repelUntil - Date.now();
                if (left <= 0) {
                    this.repelUntil = 0;
                    if (!this._repelExpiredNotified) {
                        this._repelExpiredNotified = true;
                        showToast('🧴 벌레퇴치스프레이의 효과가 끝났습니다.');
                        playSfx('fail');
                    }
                    return 0;
                }
                return left;
            }

            activateRepel(seconds) {
                const add = (seconds || 60) * 1000;
                const left = this.repelRemainingMs();
                // 이미 뿌려둔 상태에서 또 쓰면 시간을 덮어쓰지 않고 이어 붙인다
                this.repelUntil = Date.now() + left + add;
                this._repelExpiredNotified = false;
                this.updateUI();
            }

            /* 필드에서 아이템을 쓰는 경로. 지금은 스프레이만 해당된다. */
            useItemInField(inventorySlot) {
                const slot = this.player.inventory[inventorySlot];
                if (!slot || slot.count <= 0) return false;
                if (!slot.item.repelSec) return false;
                slot.count--;
                this.activateRepel(slot.item.repelSec);
                const total = Math.ceil(this.repelRemainingMs() / 1000);
                showToast(`🧴 [${slot.item.name}]을(를) 뿌렸다! ${total}초 동안 야생 포켓몬이 나타나지 않습니다.`);
                playSfx('heal');
                this.saveGame(true);
                return true;
            }
            /* 현재 플레이어가 서 있는 좌표가 어느 마을 블록에 속하는지 판정한다.
               updateUI()의 마을 이름 표시 로직과 동일한 규칙을 공유해, HUD에 뜨는
               마을 이름과 체육관 관장이 항상 일치하도록 한다. */
            getCurrentGymSite() {
                if (this.player.y < 24 && this.player.x < 24) return '오닉스 역전가';
                const site = EXTRA_TOWN_SITES.find(s =>
                    this.player.y >= s.rMin && this.player.y <= s.rMax &&
                    this.player.x >= s.cMin && this.player.x <= s.cMax);
                return site ? site.name : null;
            }

            /* [버그 수정] 예전에는 지도 위 5개 체육관 타일 전부가 POKEMON_DATABASE에서
               isBoss로 표시된 단 하나의 종(메타그로스)만 불러왔기 때문에, 어느 체육관을
               가든 완전히 똑같은 전투가 반복됐다. 이제는 서 있는 마을에 맞는 고유
               관장(GYM_LEADERS)을 찾아 그 종으로 전투를 시작한다. */
            challengeGym() {
                const tile = this.worldMap[this.player.y][this.player.x];
                if (tile !== TILE_TYPES.GYM) {
                    showToast("체육관(Gym) 타일 위에서 도전 키를 누르세요.");
                    return;
                }
                const site = this.getCurrentGymSite();

                // [포스트게임] 5개 뱃지를 모두 모은 뒤 시작 마을(오닉스 역전가) 체육관으로
                // 돌아오면 평범한 관장전 대신 챔피언전이 열린다.
                if (site === '오닉스 역전가' && this.player.badges >= GYM_COUNT) {
                    this.challengeChampion();
                    return;
                }

                const leader = site && GYM_LEADERS[site];
                if (!leader) {
                    showToast("이 체육관은 아직 관장이 배정되지 않았습니다.");
                    return;
                }

                // [순차 도전] 실제 게임처럼 체육관은 정해진 순서대로만 도전할 수 있다.
                // 앞 순서의 체육관을 아직 깨지 않았다면 접수처에서 돌려보낸다.
                const prevGyms = Object.entries(GYM_LEADERS)
                    .filter(([, g]) => g.order < leader.order)
                    .sort((a, b) => a[1].order - b[1].order);
                const nextUncleared = prevGyms.find(([townName]) => !this.player.defeatedGyms.has(townName));
                if (nextUncleared) {
                    const [townName, info] = nextUncleared;
                    showToast(`🚫 아직 도전할 수 없습니다. ${leader.order}번째 체육관에 도전하려면 먼저 ${info.order}번째 [${townName}] 체육관(관장 ${info.leaderName})을 이겨야 합니다.`);
                    playSfx('fail');
                    return;
                }

                const team = leader.team.map(id => POKEMON_DATABASE.find(p => p.id === id)).filter(Boolean);
                if (team.length === 0) return;

                this.currentGymSite = site;
                this.currentGymLeaderName = leader.leaderName;
                // 관장 포켓몬은 도전자 레벨을 따라오지 않는 고정 레벨이다
                this.currentTrainerLevels = leader.levels ? [...leader.levels] : null;
                showToast(`💪 ${leader.order}번째 체육관 관장 [${leader.leaderName}]이(가) 도전을 받아들였다! (포켓몬 ${team.length}마리 · Lv.${leader.levels[0]}~${leader.levels[leader.levels.length - 1]})`);
                this.startBattle({ ...team[0], isBoss: true }, undefined, team.slice(1).map(p => p.id));
            }

            /* [포스트게임] 5개 뱃지를 모두 모은 도전자만 만날 수 있는 최종 챔피언전.
               게임 내 최강급 포켓몬 5마리(뮤츠 에이스)로 구성되며, 전용 승리 대사와
               큰 상금으로 "이 게임을 진짜로 클리어했다"는 감각을 준다. */
            challengeChampion() {
                const team = CHAMPION_DATA.team.map(id => POKEMON_DATABASE.find(p => p.id === id)).filter(Boolean);
                if (team.length === 0) return;

                this.currentGymSite = '오닉스 역전가';
                this.currentGymLeaderName = CHAMPION_DATA.leaderName;
                this.currentChampionChallenge = true;
                this.currentTrainerLevels = CHAMPION_DATA.levels ? [...CHAMPION_DATA.levels] : null;

                if (!this.player.championDefeated) {
                    showToast(`👑 축하합니다! 모든 뱃지를 모은 당신 앞에 챔피언 [${CHAMPION_DATA.leaderName}]이(가) 나타났다! (포켓몬 ${team.length}마리)`);
                } else {
                    showToast(`👑 챔피언 [${CHAMPION_DATA.leaderName}]과(와)의 재대결! (포켓몬 ${team.length}마리)`);
                }
                this.startBattle({ ...team[0], isBoss: true }, undefined, team.slice(1).map(p => p.id));
            }

            /* 체육관 관장을 격파했을 때 뱃지/상금을 지급하는 공용 처리 - 예전에는 이
               로직이 performMove(플레이어 공격으로 격파/적 반동으로 격파)와
               finishTurnCycle(날씨·상태이상 데미지로 격파) 세 곳에 각각 중복돼 있었고,
               재도전할 때마다 뱃지·골드가 무한정 쌓이는 버그가 있었다. 이제는 마을별로
               최초 격파 시 한 번만 뱃지+상금을 주고, 이미 격파한 체육관은 소액 상금만
               지급한다. */
            handleBossDefeat() {
                const site = this.currentGymSite;
                const leaderName = this.currentGymLeaderName || '체육관 관장';
                const leader = site ? GYM_LEADERS[site] : null;

                const prize = (leader && leader.prize) || 1200;
                if (site && !this.player.defeatedGyms.has(site)) {
                    this.player.defeatedGyms.add(site);
                    this.player.badges++;
                    this.player.gold += prize;
                    const badgeName = leader ? leader.badgeName : '뱃지';
                    this.stats.gymWins++;
                    showToast(`🏆 [${leaderName}] 격파! [${badgeName}]와 ${prize}G를 획득했습니다! (뱃지 ${this.player.badges}/${GYM_COUNT})`);
                } else {
                    const rematch = Math.round(prize * 0.25);
                    this.player.gold += rematch;
                    showToast(`🤝 [${leaderName}]과(와)의 친선전 승리! 상금 ${rematch}G를 받았습니다. (뱃지는 이미 획득함)`);
                }
            }

            /* [포스트게임] 챔피언을 격파했을 때 지급되는 전용 보상 처리 - 최초 격파
               시에는 큰 축하 메시지와 함께 거액의 상금을, 이후 재대결에서는 소액
               상금만 지급한다(뱃지 시스템과는 별개로 관리되는 1회성 플래그). */
            handleChampionDefeat() {
                if (!this.player.championDefeated) {
                    this.player.championDefeated = true;
                    this.player.gold += CHAMPION_DATA.prize;
                    showToast(`🏆👑 챔피언 [${CHAMPION_DATA.leaderName}] 격파! 당신은 이 세계의 새로운 챔피언입니다! ${CHAMPION_DATA.prize}G를 획득했습니다!`);
                } else {
                    this.player.gold += 1500;
                    showToast(`👑 챔피언과의 재대결에서 승리! 상금 1500G를 받았습니다.`);
                }
            }

            /* [닌텐도급 업그레이드] 적 포켓몬이 쓰러졌을 때 이제 이 한 곳에서만
               "전투를 끝낼지, 관장의 다음 포켓몬을 내보낼지"를 판단한다. 예전에는
               performMove/finishTurnCycle 네 곳에서 곧바로 endBattle()을 불렀기
               때문에 체육관 관장이라도 첫 포켓몬만 잡으면 배틀이 끝나버렸다. 이제는
               enemyTeamQueue(startBattle에서 채워짐)에 남은 포켓몬이 있으면 배틀을
               끝내지 않고 다음 포켓몬을 링에 올리며, 관장의 "에이스"까지 전부 잡아야
               비로소 뱃지를 받고 배틀이 종료된다. */
            handleEnemyFaint(wasBoss) {
                if (wasBoss && this.enemyTeamQueue && this.enemyTeamQueue.length > 0) {
                    const nextId = this.enemyTeamQueue.shift();
                    const nextSpecies = POKEMON_DATABASE.find(p => p.id === nextId);
                    if (nextSpecies) {
                        this.sendNextTrainerPokemon(nextSpecies);
                        return;
                    }
                }
                if (wasBoss) {
                    if (this.currentTrainerNpc) this.handleNpcTrainerDefeat();
                    else if (this.currentChampionChallenge) this.handleChampionDefeat();
                    else this.handleBossDefeat();
                }
                this.stats.battlesWon++;
                if (!wasBoss && this.currentEnemy) {
                    // 야생전은 실제 게임처럼 상금이 거의 없다시피 한 수준으로만 준다
                    // (돈은 주로 체육관 상금에서 나오도록 경제를 재설계했다).
                    const pocket = 6 + (this.currentEnemy.level || 1) * 2;
                    this.player.gold += pocket;
                    showToast(`💰 야생전 승리! 잔돈 ${pocket}G를 주웠다.`);
                }
                this.endBattle();
            }

            /* 관장의 다음 포켓몬을 배틀을 끝내지 않은 채로 그대로 링에 올린다.
               실제 게임처럼 "관장이 다음 포켓몬을 보냈다!" 대화창과 함께 적
               스프라이트/3D 무대/체력바만 새로 교체하고, 내 포켓몬은 그대로 이어서
               싸운다(강제 교체 없음). */
            sendNextTrainerPokemon(nextSpeciesData) {
                const activePkm = this.player.party[this.player.activeIdx];
                let enemyLv = activePkm.level + (this.currentChampionChallenge ? 8 : 4);
                if (this.currentTrainerLevels && this.currentTrainerLevels.length > 0) {
                    enemyLv = this.currentTrainerLevels.shift();
                }
                this.currentEnemy = this.createPokemonInstance({ ...nextSpeciesData, isBoss: true }, enemyLv);
                this.player.pokedex.add(this.currentEnemy.id);

                this.configureBattleStage3D(this.currentEnemy);
                setBattleSpriteSrc(document.getElementById('enemy-sprite'), this.currentEnemy.frontSprite);
                this.applyShinyLook();
                this.playSpriteEntryAnim('enemy');
                document.getElementById('enemy-sprite-box').classList.toggle('giant-mon', !!(this.currentEnemy.isLegend || this.currentEnemy.isBoss || this.currentEnemy.isRareTier || GIANT_BODY_IDS.has(this.currentEnemy.id)));

                const leaderName = this.currentChampionChallenge
                    ? `챔피언 ${this.currentGymLeaderName || ''}`
                    : (this.currentGymLeaderName || '체육관 관장');
                this.setBattleDialog(`${leaderName}이(가) 다음 포켓몬 [${this.currentEnemy.species}] (Lv.${this.currentEnemy.level})을(를) 보냈다!`);
                this.triggerAbilityOnEntry(this.currentEnemy, false);

                this.isTurnProcessing = false;
                this.battleMenuMode = 'command';
                this.updateUI();
                this.showBattleCommandMenu();
            }

            /* ==========================================================================
               9-A. 전설의 사원 의식 시스템
               사원 타일 위에서 전용 소환 아이템(성물)을 사용해야만 해당 전설의 포켓몬이
               강림한다. 성물이 없거나 엉뚱한 사원에서는 절대 발동하지 않는다.
               ========================================================================== */
            attemptTempleRitual() {
                const tile = this.worldMap[this.player.y][this.player.x];
                const info = LEGEND_TEMPLE_INFO[tile];

                if (!info) {
                    showToast("이곳은 사원이 아닙니다. 전설의 사원 타일 위에서 [E]키를 눌러보세요.");
                    return;
                }

                const orbSlot = this.player.inventory.find(s => s.item.id === info.orbId);
                if (!orbSlot || orbSlot.count <= 0) {
                    const orbItem = Object.values(ITEM_DATABASE).find(it => it.id === info.orbId);
                    showToast(`${info.templeName}이(가) 반응하지 않는다... [${orbItem ? orbItem.name : '성물'}]이(가) 필요하다!`);
                    return;
                }

                orbSlot.count--;
                const legendData = POKEMON_DATABASE.find(p => p.id === info.legendId);
                showToast(`✨ ${info.templeName}의 봉인이 풀리기 시작한다...!`);

                this.player.direction = 'up';
                this.updateUI();

                setTimeout(() => {
                    showToast(`⚡ [${legendData.species}]이(가) 강림했다!`);
                    this.startBattle(legendData);
                }, 1000);
            }

            /* ==========================================================================
               10. UPGRADED BATTLE ENGINE & VERIFIED TURN SYSTEM
               ========================================================================== */
            /* [닌텐도급 연출] 실제 게임처럼, 조우한 순간 곧바로 전투 화면으로 튀지
               않고 화면이 번쩍이며 셔터가 닫혔다 열리는 전환 연출을 먼저 재생한다.
               모든 전투 진입 경로(야생/체육관/챔피언/사원 의식)가 이 한 곳을 지나므로
               연출이 빠지는 곳이 없다. */
            startBattle(templateData, precomputedWildLv, remainingTeamIds) {
                if (this._battleTransitionRunning) return;
                this._battleTransitionRunning = true;
                this.stats.encounters++;

                const special = !!(templateData.isLegend || templateData.isRareTier);
                const overlay = document.getElementById('battle-transition');
                playSfx('encounter');

                if (overlay) {
                    overlay.classList.remove('play', 'legend');
                    void overlay.offsetWidth;
                    if (special) overlay.classList.add('legend');
                    overlay.classList.add('play');
                    setTimeout(() => overlay.classList.remove('play', 'legend'), 960);
                }

                // 셔터가 완전히 닫힌 순간(약 0.42초)에 전투 화면을 세팅해야 전환이 매끄럽다
                setTimeout(() => {
                    this._battleTransitionRunning = false;
                    this._enterBattle(templateData, precomputedWildLv, remainingTeamIds);
                }, overlay ? 430 : 0);
            }

            _enterBattle(templateData, precomputedWildLv, remainingTeamIds) {
                this.state = GAME_STATES.BATTLE;
                this.ambientFx = [];
                this.isTurnProcessing = false;
                this.megaUsedThisBattle = false;
                // 퀵볼/타이머볼 보정에 쓰이는 경과 턴 수
                this.battleTurn = 0;
                this.ballThrow3D = null;
                this.hideBall3D();
                this.clearBallFxClasses();
                this.forcedSwitchAfterEnemyMove = false;
                this.forcedPartySwitch = false;
                // [체육관 관장 다중 포켓몬] 체육관 관장은 실제 게임처럼 여러 포켓몬을
                // 순서대로 내보낸다. 첫 번째 포켓몬은 여기서 바로 내보내고, 나머지는
                // 큐에 저장해 handleEnemyFaint()에서 하나씩 꺼내 쓴다.
                this.enemyTeamQueue = remainingTeamIds ? [...remainingTeamIds] : [];
                MusicEngine.start(templateData.isBoss ? 'BOSS' : ((templateData.isLegend || templateData.isRareTier) ? 'LEGEND' : 'BATTLE'));

                // [방어적 버그 수정] 어떤 경로로든 기절한(HP 0) 포켓몬이 선봉으로 지정된
                // 채 전투가 시작되면, HP 0인 포켓몬이 그대로 배틀에 나서서 기절 처리가
                // 되지 않는 먹통 상태로 이어질 수 있다. 전투 시작 시점에 한 번 더
                // 확인해서, 사용 가능한 다른 포켓몬이 있다면 자동으로 교체해준다.
                if (this.player.party[this.player.activeIdx].hp <= 0) {
                    const swapIdx = this.player.party.findIndex(p => p.hp > 0);
                    if (swapIdx >= 0) this.player.activeIdx = swapIdx;
                }

                const activePkm = this.player.party[this.player.activeIdx];
                // 야생 포켓몬: 내 포켓몬 레벨 기준 -15 ~ +15 사이에서 랜덤 (최저 1레벨 보장).
                // checkTileTrigger()에서 진화 단계에 맞는 후보를 고르기 위해 이미 레벨을
                // 미리 계산해 넘겨준 경우(precomputedWildLv)에는 그 값을 그대로 사용해
                // 후보 선정 때 쓰인 레벨과 실제 등장 레벨이 어긋나지 않게 한다.
                // 준전설/환상/전설의 포켓몬: 실제 게임처럼 45~60 사이에서 랜덤 등장
                // (사원 의식으로 소환되는 전설은 precomputedWildLv가 없으므로 여기서 새로 굴린다)
                // 보스: 기존과 동일하게 내 포켓몬보다 4레벨 높게 등장
                const wildLv = precomputedWildLv !== undefined ? precomputedWildLv : rollWildLevel(this.player.x, this.player.y);
                const legendLv = 45 + Math.floor(Math.random() * 16);
                // 관장/챔피언은 미리 정해진 고정 레벨로 나온다 (currentTrainerLevels).
                // 예전에는 "내 선두 포켓몬 +4"라서 내가 강해질수록 관장도 같이 강해졌다.
                let bossLv = activePkm.level + (this.currentChampionChallenge ? 8 : 4);
                if (templateData.isBoss && this.currentTrainerLevels && this.currentTrainerLevels.length > 0) {
                    bossLv = this.currentTrainerLevels.shift();
                }
                const enemyLv = templateData.isBoss ? bossLv : ((templateData.isLegend || templateData.isRareTier) ? (precomputedWildLv !== undefined ? precomputedWildLv : legendLv) : wildLv);

                this.currentEnemy = this.createPokemonInstance(templateData, enemyLv);
                this.player.pokedex.add(this.currentEnemy.id);

                this.player.party.forEach(p => p.isMega = false);
                activePkm.statStages = makeEmptyStatStages();
                activePkm.confused = false;
                activePkm.confusedTurns = 0;
                activePkm.attracted = false;
                activePkm.flinched = false;
                this._enemyActedThisTurn = false;

                document.getElementById('hud-layer').classList.add('hidden');
                document.getElementById('minimap-container').classList.add('hidden');

                document.getElementById('battle-panel').style.display = 'flex';
                document.getElementById('battle-overlay').style.display = 'block';
                // 이전 전투에서 남아 있을지 모르는 메가진화 연출 클래스를 제거한다
                // (display:none → block 전환 때 CSS 애니메이션이 재시작되는 것을 막는다)
                this.clearMegaFxClasses();

                // 전투 배경을 3D 무대로 전환 (필드는 그대로 2D 유지, 배경만 입체화)
                // init3D()가 미리 만들어 둔 필드용 지형/오브젝트/플레이어 모델은 같은
                // scene3D 안에 계속 남아있으므로, 숨기지 않으면 배틀 카메라 시야에
                // 엉뚱하게 필드 타일들이 함께 렌더링되어 버린다.
                this.terrainGroup3D.visible = false;
                this.propsGroup3D.visible = false;
                this.playerGroup3D.visible = false;
                this.threeCanvas.style.display = 'block';
                this.threeCanvas.classList.remove('fx-light-layer');
                this.canvas.style.visibility = 'visible';
                this._postFxVisible = false;
                // 빛 레이어용으로 절반 해상도였다면 전투용 원래 해상도로 되돌린다
                if (this._rendererSize !== 'full') {
                    this.renderer3D.setSize(this.canvas.width, this.canvas.height, false);
                    this._rendererSize = 'full';
                }
                this.battleStageGroup3D.visible = true;
                this.configureBattleStage3D(this.currentEnemy);

                setBattleSpriteSrc(document.getElementById('enemy-sprite'), this.currentEnemy.frontSprite);
                setBattleSpriteSrc(document.getElementById('player-sprite'), activePkm.backSprite);
                this.applyShinyLook();
                this.playSpriteEntryAnim('both');

                // 가이오가/그란돈/레쿠쟈처럼 원본 스프라이트가 가로로 매우 긴 초대형 포켓몬은
                // 박스 한도를 살짝 넓혀주되, object-fit: contain 덕분에 비율은 항상 유지된다.
                document.getElementById('enemy-sprite-box').classList.toggle('giant-mon', !!(this.currentEnemy.isLegend || this.currentEnemy.isBoss || this.currentEnemy.isRareTier || GIANT_BODY_IDS.has(this.currentEnemy.id)));
                document.getElementById('player-sprite-box').classList.toggle('giant-mon', GIANT_BODY_IDS.has(activePkm.id));

                // 전설의 포켓몬과의 조우는 화면 섬광 연출로 특별함을 강조한다 (DS 시절 전설전 연출 재현)
                if (templateData.isLegend) {
                    this.triggerLegendFlash();
                    this.setBattleDialog(`전설의 포켓몬 [${this.currentEnemy.species}] (Lv.${this.currentEnemy.level})이(가) 강림했다!`);
                } else if (templateData.isBoss) {
                    const gymLeaderTag = this.currentChampionChallenge
                        ? `챔피언 ${this.currentGymLeaderName || ''}의`
                        : (this.currentGymLeaderName ? `체육관 관장 ${this.currentGymLeaderName}의` : '체육관 관장의');
                    this.setBattleDialog(`${gymLeaderTag} [${this.currentEnemy.species}] (Lv.${this.currentEnemy.level})가 도전을 받아들였다!`);
                } else if (templateData.isRareTier) {
                    // 준전설/환상급 포켓몬 조우도 살짝 특별한 연출로 강조한다
                    this.triggerLegendFlash();
                    this.setBattleDialog(`✨ 희귀한 [${this.currentEnemy.species}] (Lv.${this.currentEnemy.level})이(가) 모습을 드러냈다!`);
                } else if (this.currentEnemy.isShiny) {
                    this.setBattleDialog(`✨ 색이 다른 [${this.currentEnemy.species}] (Lv.${this.currentEnemy.level})이(가) 나타났다!`);
                } else {
                    this.setBattleDialog(`야생의 [${this.currentEnemy.species}] (Lv.${this.currentEnemy.level}) 출현!`);
                }
                if (this.currentEnemy.isShiny) setTimeout(() => this.playShinyBurst(false), 500);
                if (activePkm.isShiny) setTimeout(() => this.playShinyBurst(true), 760);

                // 특성(위협/날씨 세팅 등) 등장 효과 - 적 먼저, 그 다음 내 포켓몬 순서로 발동
                this.triggerAbilityOnEntry(this.currentEnemy, false);
                this.triggerAbilityOnEntry(activePkm, true);

                this.battleMenuMode = 'command';
                this.updateBattleHud();
                this.showBattleCommandMenu();
            }

            /* [이로치] 색이 다른 개체는 스프라이트 색조를 돌려 한눈에 구분되게 하고,
               등장 순간 반짝임과 전용 효과음으로 특별함을 알린다. */
            applyShinyLook() {
                const enemyImg = document.getElementById('enemy-sprite');
                const playerImg = document.getElementById('player-sprite');
                const me = this.player.party[this.player.activeIdx];
                if (enemyImg) enemyImg.classList.toggle('shiny-mon', !!(this.currentEnemy && this.currentEnemy.isShiny));
                if (playerImg) playerImg.classList.toggle('shiny-mon', !!(me && me.isShiny));
            }

            playShinyBurst(isPlayerSide) {
                const overlay = document.getElementById('battle-overlay');
                if (!overlay) return;
                const pt = this.getSpriteAnchor(isPlayerSide).dom;
                let el = document.getElementById('shiny-burst');
                if (!el) {
                    el = document.createElement('div');
                    el.id = 'shiny-burst';
                    el.textContent = '✨';
                    overlay.appendChild(el);
                }
                el.style.left = `${pt.x - 20}px`;
                el.style.top = `${pt.y - 20}px`;
                el.classList.remove('play');
                void el.offsetWidth;
                el.classList.add('play');
                playSfx('mega_complete');
            }

            /* 포켓몬이 배틀에 나설 때(등장/교체) 발동하는 특성 효과 - 위협(공격 하락),
               가뭄/잔물결/모래날림(날씨 세팅) 등 실제 게임의 "등장 특성"을 재현한다. */
            triggerAbilityOnEntry(pkm, isPlayerSide) {
                if (!pkm) return;
                const opponent = isPlayerSide ? this.currentEnemy : this.player.party[this.player.activeIdx];
                if (pkm.ability === 'INTIMIDATE' && opponent) {
                    opponent.statStages.atk = Math.max(-6, (opponent.statStages.atk || 0) - 1);
                    showToast(`😠 [${pkm.species}]의 위협! 상대의 공격이 떨어졌다!`);
                } else if (pkm.ability === 'DROUGHT') {
                    this.weatherIdx = 4;
                    showToast(`☀️ [${pkm.species}]가 날씨를 쾌청으로 바꿨다!`);
                } else if (pkm.ability === 'DRIZZLE') {
                    this.weatherIdx = 1;
                    showToast(`🌧️ [${pkm.species}]가 날씨를 비로 바꿨다!`);
                } else if (pkm.ability === 'SAND_STREAM') {
                    this.weatherIdx = 2;
                    showToast(`🌪️ [${pkm.species}]가 모래바람을 일으켰다!`);
                }
                this.updateUI();
            }

            /* 전설의 포켓몬 등장 시 화면을 하얗게 번쩍이는 섬광 오버레이를 재생한다 */
            triggerLegendFlash() {
                const flash = document.getElementById('legend-flash-overlay');
                if (!flash) return;
                flash.classList.remove('flash-play');
                void flash.offsetWidth; // 리플로우 강제 → 애니메이션 재시작
                flash.classList.add('flash-play');
            }

            /* 실제 게임처럼 대화창 텍스트를 한 글자씩 타이핑하고, 다 쓰이면 깜빡이는
               ▼ 커서를 보여준다. 클릭/다음 메시지가 오면 즉시 전체 텍스트를 표시한다. */
            setBattleDialog(text) {
                const textEl = document.getElementById('dialog-text');
                const cursorEl = document.getElementById('dialog-cursor');
                if (!textEl) return;

                clearInterval(this._typewriterTimer);
                cursorEl.classList.remove('show');
                textEl.textContent = '';

                let i = 0;
                this._typewriterTimer = setInterval(() => {
                    i++;
                    textEl.textContent = text.slice(0, i);
                    if (i >= text.length) {
                        clearInterval(this._typewriterTimer);
                        cursorEl.classList.add('show');
                    }
                }, 18);
            }

            getTypeMultiplier(atkType, defType1, defType2) {
                let mult = 1.0;
                if (TYPE_CHART[atkType] && TYPE_CHART[atkType][defType1] !== undefined) {
                    mult *= TYPE_CHART[atkType][defType1];
                }
                if (defType2 && TYPE_CHART[atkType] && TYPE_CHART[atkType][defType2] !== undefined) {
                    mult *= TYPE_CHART[atkType][defType2];
                }
                return mult;
            }

            /* 실제 게임의 1차 커맨드 메뉴 - [싸우다/가방/포켓몬/도망] 4버튼.
               [싸우다]를 눌러야 비로소 기술 목록(2차 메뉴)이 나타난다. */
            showBattleCommandMenu() {
                this.battleMenuMode = 'command';
                document.getElementById('command-grid').style.display = 'grid';
                document.getElementById('action-grid').style.display = 'none';
                this.renderCommandGrid();
            }

            showBattleMoveMenu() {
                this.battleMenuMode = 'moves';
                document.getElementById('command-grid').style.display = 'none';
                document.getElementById('action-grid').style.display = 'grid';
                this.renderBattleActionGrid();
            }

            /* 현재 보여지고 있는 메뉴(커맨드/기술)를 다시 그려 비활성화 상태 등을 갱신한다 */
            refreshBattleMenu() {
                if (this.battleMenuMode === 'moves') this.renderBattleActionGrid();
                else this.renderCommandGrid();
            }

            renderCommandGrid() {
                const grid = document.getElementById('command-grid');
                grid.innerHTML = '';
                const curPkm = this.player.party[this.player.activeIdx];
                const busy = this.isTurnProcessing;

                const makeBtn = (cls, html, onClick) => {
                    const btn = document.createElement('button');
                    btn.className = `btn-action ${cls}`;
                    btn.disabled = busy;
                    btn.innerHTML = html;
                    btn.onclick = () => { if (!this.isTurnProcessing) onClick(); };
                    grid.appendChild(btn);
                };

                makeBtn('btn-fight', `<span>⚔️ 싸우다</span>`, () => { playSfx('menu'); this.showBattleMoveMenu(); });
                makeBtn('btn-bag', `<span>🎒 가방</span>`, () => { playSfx('menu'); openBagModal(); });
                makeBtn('btn-switch', `<span>🔄 포켓몬</span>`, () => { playSfx('menu'); openPartyModal(); });
                // 트레이너전(체육관 관장)에서는 도망칠 수 없다는 것을 버튼 라벨만 보고도
                // 미리 알 수 있게 표시한다 (클릭했을 때만 알려주면 뒤늦게 놀라게 된다).
                const isTrainerBattle = !!(this.currentEnemy && this.currentEnemy.isBoss);
                makeBtn('btn-run', isTrainerBattle ? `<span>🏃 도망 (불가)</span>` : `<span>🏃 도망</span>`, () => {
                    // [버그 수정] 체육관 관장전에서도 도망 버튼 한 번으로 그냥 빠져나갈 수
                    // 있어, 사실상 체육관 도전 자체를 무시할 수 있는 문제가 있었다.
                    // 실제 게임처럼 트레이너와의 정식 대결에서는 도망칠 수 없게 막는다.
                    if (this.currentEnemy && this.currentEnemy.isBoss) {
                        playSfx('fail');
                        const opponentTag = this.currentChampionChallenge
                            ? `챔피언 ${this.currentGymLeaderName || ''}`
                            : (this.currentGymLeaderName || '체육관 관장');
                        this.setBattleDialog(`${opponentTag}과(와)의 승부에서는 도망칠 수 없다!`);
                        return;
                    }
                    playSfx('run');
                    this.setBattleDialog("무사히 도망쳤다!");
                    setTimeout(() => this.endBattle(), 800);
                });
            }

            renderBattleActionGrid() {
                const grid = document.getElementById('action-grid');
                grid.innerHTML = '';
                const curPkm = this.player.party[this.player.activeIdx];

                const hasUsableMove = curPkm.skills.some(sk => sk.pp > 0);

                if (!hasUsableMove) {
                    // 실제 게임처럼 모든 기술의 PP가 떨어지면 [발버둥]만 사용할 수 있다.
                    const struggleBtn = document.createElement('button');
                    struggleBtn.className = 'btn-action';
                    struggleBtn.disabled = this.isTurnProcessing;
                    struggleBtn.innerHTML = `<span>발버둥</span><span style="font-size:10px; opacity:0.8;">PP 없음 - 반동 있음</span>`;
                    struggleBtn.onclick = () => {
                        if (!this.isTurnProcessing) this.executeBattleTurn(SKILL_DATABASE.STRUGGLE);
                    };
                    grid.appendChild(struggleBtn);
                } else {
                    curPkm.skills.forEach(skill => {
                        const btn = document.createElement('button');
                        btn.className = 'btn-action';
                        const noPp = skill.pp <= 0;
                        btn.disabled = this.isTurnProcessing || noPp;

                        const mult = this.getTypeMultiplier(skill.type, this.currentEnemy.type1, this.currentEnemy.type2);
                        let multTag = '';
                        if (mult > 1.0) multTag = ' <span style="color:var(--neon-amber)">[우수]</span>';
                        if (mult < 1.0 && mult > 0) multTag = ' <span style="color:var(--text-sub)">[별로]</span>';
                        if (mult === 0) multTag = ' <span style="color:var(--neon-pink)">[무효]</span>';

                        const catTag = skill.category === '물리' ? '💪' : (skill.category === '특수' ? '✨' : '🔧');
                        btn.innerHTML = `<span>${skill.name}${multTag}</span><span style="font-size:10px; opacity:0.8;">${catTag} 위력 ${skill.power || '-'} | ${skill.type} | PP ${skill.pp}/${skill.maxPp}</span>`;
                        btn.onclick = () => {
                            if (!this.isTurnProcessing && !noPp) this.executeBattleTurn(skill);
                        };
                        grid.appendChild(btn);
                    });
                }

                if (curPkm.megaSprite && !curPkm.isMega && !this.megaUsedThisBattle) {
                    const megaBtn = document.createElement('button');
                    megaBtn.className = 'btn-action btn-mega';
                    megaBtn.disabled = this.isTurnProcessing;
                    megaBtn.innerHTML = `<span>⚡ 메가진화</span>`;
                    megaBtn.onclick = () => this.startMegaEvolution(curPkm);
                    grid.appendChild(megaBtn);
                }

                const backBtn = document.createElement('button');
                backBtn.className = 'btn-action btn-back';
                backBtn.disabled = this.isTurnProcessing;
                backBtn.innerHTML = `<span>↩️ 뒤로</span>`;
                backBtn.onclick = () => { if (!this.isTurnProcessing) this.showBattleCommandMenu(); };
                grid.appendChild(backBtn);
            }

            /* ==========================================================================
               메가진화 연출 시퀀스
               1) 빛의 고리/파편 오버레이 재생 + 상승음
               2) 트레이너의 포켓몬 스프라이트가 실루엣으로 격렬히 흔들림
               3) 진화 완료 - 메가 스프라이트로 전환되며 팡파레와 함께 팝업 연출
               한 트레이너는 전투당 단 한 번만 메가진화할 수 있다 (원작 룰 재현)
               ========================================================================== */
            /* [버그 수정] 메가진화 연출이 다음 배틀 시작 때 또 재생되던 문제.
               원인은 CSS 클래스(mega-play / mega-evolving / mega-reveal-pop)를 한 번
               붙인 뒤 한 번도 떼지 않은 것이었다. 이 요소들의 부모(#battle-overlay)는
               전투가 끝나면 display:none이 되는데, 다음 전투에서 다시 보이게 되는
               순간 브라우저가 "숨겨졌다 나타난 요소"의 CSS 애니메이션을 처음부터
               다시 재생한다 - 그래서 메가진화를 한 적 있는 세션에서는 이후 모든
               전투가 시작될 때마다 보라색 광선 연출이 한 번씩 번쩍였다.
               연출이 끝나는 시점과 전투 시작/종료 시점 양쪽에서 확실히 떼어낸다. */
            /* 포획 연출용 스프라이트 클래스를 지운다. display:none -> block 전환 때
               CSS 애니메이션이 되살아나 다음 전투 첫 프레임에 상대가 사라져 보이는
               것을 막기 위해, 전투 시작/종료 양쪽에서 호출한다. */
            clearBallFxClasses() {
                ['enemy-sprite', 'player-sprite'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.classList.remove('sprite-suck-in', 'sprite-burst-out');
                });
            }

            clearMegaFxClasses() {
                const overlay = document.getElementById('mega-evolve-overlay');
                const spriteEl = document.getElementById('player-sprite');
                const enemySpriteEl = document.getElementById('enemy-sprite');
                if (overlay) overlay.classList.remove('mega-play');
                if (spriteEl) spriteEl.classList.remove('mega-evolving', 'mega-reveal-pop');
                if (enemySpriteEl) enemySpriteEl.classList.remove('mega-evolving', 'mega-reveal-pop');
            }

            startMegaEvolution(pkm) {
                if (this.isTurnProcessing || this.megaUsedThisBattle || pkm.isMega || !pkm.megaSprite) return;

                this.isTurnProcessing = true;
                this.megaUsedThisBattle = true;
                this.stats.megaEvolutions++;
                this.renderBattleActionGrid();

                const spriteEl = document.getElementById('player-sprite');
                const boxEl = document.getElementById('player-sprite-box');
                const overlay = document.getElementById('mega-evolve-overlay');

                this.setBattleDialog(`✨ ${pkm.species}에게 힘이 흘러든다...!`);
                playSfx('mega_charge');

                overlay.classList.remove('mega-play');
                void overlay.offsetWidth; // 리플로우 강제로 애니메이션 재시작
                overlay.classList.add('mega-play');

                spriteEl.classList.remove('mega-evolving');
                void spriteEl.offsetWidth;
                spriteEl.classList.add('mega-evolving');

                // 진화가 응축되는 동안 지속적으로 보라색/흰색 파티클을 방출
                const particleTimer = setInterval(() => {
                    const mp = this.getSpriteAnchor(true).canvas; this.spawnParticles(mp.x, mp.y, Math.random() > 0.5 ? '#c084fc' : '#f5d0fe');
                }, 140);

                setTimeout(() => {
                    clearInterval(particleTimer);
                    spriteEl.classList.remove('mega-evolving');

                    pkm.isMega = true;
                    // 메가진화 스프라이트는 일반 스프라이트와 다른 CDN(play.pokemonshowdown.com)에서
                    // 불러오는데, 이 주소가 막히거나 경로가 어긋나면 깨진 이미지 아이콘 + "Player"
                    // alt 텍스트가 그대로 노출되는 버그가 있었다. 로드 실패 시 평소 뒷모습
                    // 스프라이트로 조용히 대체해, 최소한 깨진 아이콘이 보이는 일은 없게 한다.
                    setBattleSpriteSrc(spriteEl, pkm.megaSprite, pkm.backSprite);
                    boxEl.classList.add('giant-mon');

                    spriteEl.classList.remove('mega-reveal-pop');
                    void spriteEl.offsetWidth;
                    spriteEl.classList.add('mega-reveal-pop');

                    playSfx('mega_complete');
                    const mp2 = this.getSpriteAnchor(true).canvas;
                    this.spawnParticles(mp2.x, mp2.y, '#ffffff');
                    this.spawnParticles(mp2.x, mp2.y, '#a855f7');
                    this.setBattleDialog(`⚡ ${pkm.species}이(가) [메가진화]를 완료했다!`);

                    this.isTurnProcessing = false;
                    this.renderBattleActionGrid();

                    // 오버레이 연출(1.7초)과 팝 연출이 완전히 끝난 뒤 클래스를 떼어내,
                    // 다음 전투에서 화면이 다시 표시될 때 재생되지 않도록 한다.
                    setTimeout(() => this.clearMegaFxClasses(), 900);
                }, 1500);
            }

            switchPokemonInBattle(newIdx) {
                if (newIdx === this.player.activeIdx) {
                    showToast("이미 전투에 참여 중인 포켓몬입니다.");
                    return;
                }
                if (this.player.party[newIdx].hp <= 0) {
                    showToast("기절한 포켓몬으로는 교체할 수 없습니다!");
                    return;
                }

                this.forcedPartySwitch = false;
                this.isTurnProcessing = true;
                this.refreshBattleMenu();

                // 교체되어 나가는 포켓몬은 능력변화/혼란 등 임시 상태를 여기서 초기화한다
                // (실제 게임처럼 교체 시 랭크업/혼란/풀죽음은 사라지지만, 마비/독/화상 같은
                // 주요 상태이상과 PP는 그대로 유지된다).
                const outgoingPkm = this.player.party[this.player.activeIdx];
                if (outgoingPkm) {
                    outgoingPkm.statStages = makeEmptyStatStages();
                    outgoingPkm.confused = false;
                    outgoingPkm.confusedTurns = 0;
                    outgoingPkm.attracted = false;
                    outgoingPkm.flinched = false;
                }

                this.player.activeIdx = newIdx;
                const newPkm = this.player.party[this.player.activeIdx];
                newPkm.isMega = false;
                newPkm.statStages = makeEmptyStatStages();
                newPkm.confused = false;
                newPkm.confusedTurns = 0;
                newPkm.attracted = false;
                newPkm.flinched = false;

                setBattleSpriteSrc(document.getElementById('player-sprite'), newPkm.backSprite);
                document.getElementById('player-sprite-box').classList.toggle('giant-mon', GIANT_BODY_IDS.has(newPkm.id));
                this.applyShinyLook();
                this.playSpriteEntryAnim('player');
                closePartyModal();
                playSfx('switch_pkm');
                this.setBattleDialog(`가라! ${newPkm.species}!`);
                this.updateUI();
                this.triggerAbilityOnEntry(newPkm, true);

                if (this._enemyActedThisTurn) {
                    // 적이 방금 전 이번 턴 공격을 이미 마쳤기 때문에, 새로 나온 포켓몬을
                    // 즉시 다시 공격하게 하지 않는다. 대신 턴을 정상적으로 마무리해
                    // 다음 라운드에서 플레이어가 새 포켓몬으로 행동을 선택할 수 있게 한다.
                    setTimeout(() => this.finishTurnCycle(), 300);
                } else {
                    // 자발적 교체이거나(내 턴에 교체 버튼 사용), 내 턴 중 반동 등으로
                    // 기절해 교체한 경우 - 이번 라운드에서 적은 아직 행동하지 않았으므로
                    // 교체 후 정상적으로 적의 턴이 이어진다.
                    setTimeout(() => this.runEnemyMoveThenFinish(), 1000);
                }
            }

            /* ==========================================================================
               14-B. 3D 몬스터볼 연출
               예전에는 볼이 DOM <div> 한 장이라 아무리 그림자를 넣어도 "화면에 붙은
               스티커"처럼 보였다. 이제는 배틀 무대(scene3D)에 실제 구체 메시를 띄워
               던진다. 카메라에 가까운 발치에서 출발해 멀리 있는 상대 발판으로
               날아가므로 원근에 따라 자연스럽게 작아지고, 무대 조명을 그대로 받아
               금속 밴드와 버튼에 하이라이트가 생기며, 바닥에는 높이에 따라 흐려지는
               그림자가 따라다닌다.
                 구조: ball3D(위치 + 카메라 정면 정렬) > ballShell3D(회전) > 구체/버튼
               ========================================================================== */
            ensureBall3D() {
                if (this.ball3D) return this.ball3D;
                if (typeof THREE === 'undefined' || !this.battleStageGroup3D) return null;

                const R = 11;
                this.ballRadius3D = R;

                const outer = new THREE.Group();
                const shell = new THREE.Group();
                outer.add(shell);

                // 구체 표면은 BALL_CATALOG에서 구운 등장방형 텍스처를 그대로 입는다
                this.ballTexCanvas3D = document.createElement('canvas');
                this.ballTexCanvas3D.width = 512;
                this.ballTexCanvas3D.height = 256;
                this.ballTex3D = new THREE.CanvasTexture(this.ballTexCanvas3D);
                this.ballShellMat3D = new THREE.MeshPhongMaterial({
                    map: this.ballTex3D, shininess: 95, specular: 0x9aa6b8, transparent: true
                });
                shell.add(new THREE.Mesh(new THREE.SphereGeometry(R, 32, 22), this.ballShellMat3D));

                // 정면 버튼 - 검은 받침 원판 / 금속 링 / 볼록한 코어
                const disc = new THREE.Mesh(
                    new THREE.CircleGeometry(R * 0.33, 22),
                    new THREE.MeshPhongMaterial({ color: 0x15151c, shininess: 30 })
                );
                disc.position.z = R * 0.952;
                this.ballRingMat3D = new THREE.MeshPhongMaterial({ color: 0xa8aeba, shininess: 130, specular: 0xffffff });
                const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.235, R * 0.05, 8, 20), this.ballRingMat3D);
                ring.position.z = R * 0.972;
                this.ballCoreMat3D = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 150, specular: 0xffffff });
                const core = new THREE.Mesh(new THREE.SphereGeometry(R * 0.17, 16, 10), this.ballCoreMat3D);
                core.position.z = R * 0.985;
                shell.add(disc, ring, core);

                // 마스터볼처럼 빛나는 볼을 위한 전용 점광원 (평소엔 꺼둔다)
                this.ballGlow3D = new THREE.PointLight(0xc084fc, 0, 90);
                outer.add(this.ballGlow3D);

                // 높이에 따라 옅어지는 접지 그림자
                this.ballShadow3D = new THREE.Mesh(
                    new THREE.CircleGeometry(R * 1.15, 22),
                    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false })
                );
                this.ballShadow3D.rotation.x = -Math.PI / 2;
                this.ballShadow3D.visible = false;
                this.battleStageGroup3D.add(this.ballShadow3D);

                outer.visible = false;
                this.battleStageGroup3D.add(outer);
                this.ball3D = outer;
                this.ballShell3D = shell;
                return outer;
            }

            applyBallStyle3D(key) {
                const s = BALL_CATALOG[key] || BALL_CATALOG.MONSTER;
                paintBallTexture(this.ballTexCanvas3D.getContext('2d'), s, 512, 256);
                this.ballTex3D.needsUpdate = true;
                this.ballCoreMat3D.color.set(s.btn || '#ffffff');
                this.ballRingMat3D.color.set(s.ring || '#a8aeba');
                this.ballShellMat3D.emissive.set(s.glow ? 0x300f45 : 0x000000);
                if (this.ballGlow3D) {
                    this.ballGlow3D.intensity = s.glow ? 1.6 : 0;
                    if (s.glow) this.ballGlow3D.color.set(s.glow);
                }
                return s;
            }

            hideBall3D() {
                if (!this.ball3D) return;
                this.ball3D.visible = false;
                this.ball3D.scale.setScalar(1);
                this.ballShell3D.rotation.set(0, 0, 0);
                this.ballShellMat3D.opacity = 1;
                if (this.ballShadow3D) this.ballShadow3D.visible = false;
            }

            /* 볼을 던진다. willCatch를 미리 받아두는 이유는, 성공이면 마지막에 별이
               터지고 실패면 볼이 열리며 상대가 튀어나오는 "결말이 다른 연출"을
               흔들림이 끝나는 그 프레임에 이어붙여야 하기 때문이다. */
            animatePokeballThrow(ballItem, willCatch, onComplete) {
                const key = (ballItem && ballItem.ballKey)
                    || (ballItem && BALL_KEY_BY_ID[ballItem.id])
                    || (typeof ballItem === 'string' ? ballItem : 'MONSTER');
                const ball = this.ensureBall3D();
                if (!ball || !this.battleStageGroup3D.visible) {
                    return this.animatePokeballThrow2D(key, willCatch, onComplete);
                }
                const style = this.applyBallStyle3D(key);
                const ep = this.enemyPlatform3D.position;
                this.ballThrow3D = {
                    phase: 'fly', start: performance.now(), key, style, willCatch, onComplete, shakes: 0,
                    from: new THREE.Vector3(-108, 4, 152),
                    mid: new THREE.Vector3(ep.x, 34, ep.z),
                    rest: new THREE.Vector3(ep.x, 7 + this.ballRadius3D, ep.z)
                };
                ball.visible = true;
                ball.position.copy(this.ballThrow3D.from);
                this.ballShadow3D.visible = true;
                const dom = document.getElementById('pokeball-anim');
                if (dom) dom.style.display = 'none';
                playSfx('click');
            }

            updateBallThrow3D() {
                const st = this.ballThrow3D;
                if (!st || !this.ball3D) return;
                const now = performance.now();
                const ball = this.ball3D, shell = this.ballShell3D;
                const foeEl = () => document.getElementById('enemy-sprite');

                if (st.phase === 'fly') {
                    const p = Math.min(1, (now - st.start) / 640);
                    const pos = st.from.clone().lerp(st.mid, p);
                    pos.y += Math.sin(p * Math.PI) * 76;
                    ball.position.copy(pos);
                    shell.rotation.x = p * Math.PI * 7;
                    if (p >= 1) {
                        st.phase = 'open'; st.start = now;
                        const pt = this.getSpriteAnchor(false).canvas;
                        this.spawnParticles(pt.x, pt.y, st.style.glow || st.style.top);
                        const el = foeEl();
                        if (el) { el.classList.remove('sprite-burst-out'); void el.offsetWidth; el.classList.add('sprite-suck-in'); }
                        playSfx('click');
                    }
                } else if (st.phase === 'open') {
                    // 상대가 빨려 들어가는 동안 볼이 제자리에서 잘게 떤다
                    const p = Math.min(1, (now - st.start) / 430);
                    ball.position.copy(st.mid).setY(st.mid.y + Math.sin(p * Math.PI * 7) * 2.6);
                    shell.rotation.x = 0;
                    if (p >= 1) { st.phase = 'drop'; st.start = now; }
                } else if (st.phase === 'drop') {
                    const p = Math.min(1, (now - st.start) / 400);
                    const pos = st.mid.clone().lerp(st.rest, p * p);
                    if (p > 0.82) pos.y += Math.sin((p - 0.82) / 0.18 * Math.PI) * 5.5;  // 작은 반동
                    ball.position.copy(pos);
                    if (p >= 1) { st.phase = 'wobble'; st.start = now; st.shakes = 0; }
                } else if (st.phase === 'wobble') {
                    const p = Math.min(1, (now - st.start) / 500);
                    const dir = st.shakes % 2 ? -1 : 1;
                    const sw = Math.sin(p * Math.PI) * Math.sin(p * Math.PI * 2);
                    shell.rotation.z = dir * sw * 0.42;
                    ball.position.copy(st.rest).setY(st.rest.y + Math.abs(sw) * 2.4);
                    if (p >= 1) {
                        st.shakes++;
                        shell.rotation.z = 0;
                        st.start = now;
                        if (st.shakes >= 3) { st.phase = 'settle'; }
                        else playSfx('click');
                    }
                } else if (st.phase === 'settle') {
                    const p = Math.min(1, (now - st.start) / 460);
                    if (st.willCatch) {
                        ball.position.copy(st.rest);
                        if (!st._done && p > 0.2) {
                            st._done = true;
                            const pt = this.getSpriteAnchor(false).canvas;
                            this.spawnParticles(pt.x, pt.y, '#fde68a');
                            this.spawnParticles(pt.x, pt.y, '#ffffff');
                        }
                    } else {
                        // 실패 - 볼이 부풀며 사라지고 상대가 튀어나온다
                        ball.position.copy(st.rest).setY(st.rest.y + p * 15);
                        ball.scale.setScalar(1 + p * 0.85);
                        this.ballShellMat3D.opacity = Math.max(0, 1 - p * 1.2);
                        if (!st._done && p > 0.08) {
                            st._done = true;
                            const el = foeEl();
                            if (el) {
                                el.classList.remove('sprite-suck-in');
                                void el.offsetWidth;
                                el.classList.add('sprite-burst-out');
                                setTimeout(() => el.classList.remove('sprite-burst-out'), 700);
                            }
                            const pt = this.getSpriteAnchor(false).canvas;
                            this.spawnParticles(pt.x, pt.y, st.style.top);
                        }
                    }
                    if (p >= 1) {
                        // 포획 성공이면 볼을 발판에 그대로 남겨둔다 - "잡았다!" 메시지가
                        // 뜨는 동안 볼이 사라져 버리면 결말이 붕 뜬다. endBattle()이 치운다.
                        if (!st.willCatch) this.hideBall3D();
                        const cb = st.onComplete;
                        this.ballThrow3D = null;
                        if (cb) cb();
                        return;
                    }
                }

                // 버튼이 늘 화면을 향하도록 카메라 정면 정렬 (회전은 안쪽 shell이 담당)
                ball.lookAt(this.camera3D.position);

                const sh = this.ballShadow3D;
                const ep = this.enemyPlatform3D.position;
                const onPlatform = Math.hypot(ball.position.x - ep.x, ball.position.z - ep.z) < 44;
                const groundY = onPlatform ? 7.4 : 0.6;
                sh.position.set(ball.position.x, groundY, ball.position.z);
                const k = Math.max(0.3, 1 - Math.max(0, ball.position.y - groundY) / 120);
                sh.scale.setScalar(k);
                sh.material.opacity = 0.34 * k;
            }

            /* WebGL을 쓸 수 없는 환경을 위한 2D 폴백. 볼 그림은 3D와 같은 카탈로그에서
               구운 스프라이트를 배경 이미지로 얹으므로 디자인은 완전히 동일하다. */
            animatePokeballThrow2D(key, willCatch, onComplete) {
                const ball = document.getElementById('pokeball-anim');
                const style = BALL_CATALOG[key] || BALL_CATALOG.MONSTER;
                ball.className = 'ball-sprite';
                ball.style.backgroundImage = `url(${ballIconDataUrl(key, 96)})`;
                ball.style.display = 'block';

                const half = (ball.offsetWidth || 34) / 2;
                const myAnchor = this.getSpriteAnchor(true);
                const foeAnchor = this.getSpriteAnchor(false);
                const startX = myAnchor.dom.x - half, startY = myAnchor.dom.y - half;
                const targetX = foeAnchor.dom.x - half, targetY = foeAnchor.dom.y - half;
                const impact = foeAnchor.canvas;
                let progress = 0;

                const anim = setInterval(() => {
                    progress += 0.045;
                    ball.style.left = `${startX + (targetX - startX) * progress}px`;
                    ball.style.top = `${startY + (targetY - startY) * progress - Math.sin(progress * Math.PI) * 110}px`;
                    ball.style.transform = `rotate(${progress * 720}deg)`;
                    if (progress >= 1) {
                        clearInterval(anim);
                        this.spawnParticles(impact.x, impact.y, style.top);
                        ball.style.left = `${targetX}px`;
                        ball.style.top = `${targetY}px`;
                        ball.style.transform = 'rotate(0deg)';
                        this.playCaptureShakeSequence(ball, onComplete);
                    }
                }, 16);
            }

            /* 정통 포획 연출: 볼이 착지한 뒤 좌우로 3번 흔들리며 긴장감을 조성한다 */
            playCaptureShakeSequence(ball, onComplete) {
                let shakeCount = 0;
                const maxShakes = 3;

                const doOneShake = () => {
                    ball.classList.add('ball-spin-fast');
                    setTimeout(() => {
                        ball.classList.remove('ball-spin-fast');
                        shakeCount++;
                        if (shakeCount < maxShakes) {
                            setTimeout(doOneShake, 220);
                        } else {
                            setTimeout(() => {
                                ball.style.display = 'none';
                                if (onComplete) onComplete();
                            }, 260);
                        }
                    }, 320);
                };

                setTimeout(doOneShake, 200);
            }

            /* 마음의 엠블럼(GEM) 효과를 스킬 데미지 계산 전/후에 적용 */
            applyGemPreDamage(curPkm, chosenSkill) {
                const gemKey = curPkm.gemSlots && curPkm.gemSlots[chosenSkill.name];
                const gem = gemKey ? GEM_DATABASE[gemKey] : null;
                let powerMult = 1.0;
                let critBonus = false;
                if (gem && gem.effect === 'RECOIL_BOOST') powerMult = gem.powerMult;
                if (gem && gem.effect === 'POWER_UP') powerMult = gem.powerMult;
                if (gem && gem.effect === 'CRIT_UP') critBonus = true;
                return { gem, powerMult, critBonus };
            }

            applyGemPostDamage(curPkm, chosenSkill, gem, rawDmg, logRef) {
                if (!gem) return logRef;
                let log = logRef;
                if (gem.effect === 'RECOIL_BOOST') {
                    const recoilDmg = Math.max(1, Math.floor(rawDmg * gem.recoil));
                    curPkm.hp = Math.max(0, curPkm.hp - recoilDmg);
                    log += `\n💎 [${gem.name}]의 반동으로 ${recoilDmg}의 데미지를 입었다!`;
                }
                if (gem.effect === 'DRAIN') {
                    const healAmt = Math.max(1, Math.floor(rawDmg * gem.ratio));
                    curPkm.hp = Math.min(curPkm.maxHp, curPkm.hp + healAmt);
                    log += `\n💎 [${gem.name}]의 힘으로 체력을 ${healAmt} 흡수했다!`;
                }
                if (gem.effect === 'ATTRACT' && Math.random() < gem.chance && !this.currentEnemy.attracted) {
                    this.currentEnemy.attracted = true;
                    log += `\n💎 [${gem.name}]의 효과! 상대가 매혹 상태에 빠졌다!`;
                }
                if (gem.effect === 'PARALYZE' && Math.random() < gem.chance && this.currentEnemy.status === STATUS_EFFECTS.NONE) {
                    this.currentEnemy.status = STATUS_EFFECTS.PARALYSIS;
                    log += `\n💎 [${gem.name}]의 효과! 상대가 마비되었다!`;
                }
                if (gem.effect === 'SPEED_DOWN' && Math.random() < gem.chance) {
                    this.currentEnemy.spe = Math.max(1, Math.floor(this.currentEnemy.spe * 0.9));
                    log += `\n💎 [${gem.name}]의 효과! 상대의 스피드가 떨어졌다!`;
                }
                if (gem.effect === 'FLINCH' && Math.random() < gem.chance) {
                    this.currentEnemy.flinched = true;
                    log += `\n💎 [${gem.name}]의 효과! 상대가 풀이 죽었다!`;
                }
                // [확장 젬] 상태 이상 계열은 이미 다른 상태에 걸려 있으면 겹치지 않는다
                const STATUS_GEMS = {
                    BURN: STATUS_EFFECTS.BURN,
                    POISON: STATUS_EFFECTS.POISON,
                    FREEZE: STATUS_EFFECTS.FREEZE,
                    SLEEP: STATUS_EFFECTS.SLEEP
                };
                const newStatus = STATUS_GEMS[gem.effect];
                if (newStatus && Math.random() < gem.chance && this.currentEnemy.status === STATUS_EFFECTS.NONE) {
                    this.currentEnemy.status = newStatus;
                    if (newStatus === STATUS_EFFECTS.SLEEP) this.currentEnemy.sleepTurns = 1 + Math.floor(Math.random() * 3);
                    log += `\n💎 [${gem.name}]의 효과! 상대가 ${newStatus} 상태가 되었다!`;
                }
                if (gem.effect === 'CONFUSE' && Math.random() < gem.chance && !this.currentEnemy.confused) {
                    this.currentEnemy.confused = true;
                    this.currentEnemy.confusedTurns = 2 + Math.floor(Math.random() * 3);
                    log += `\n💎 [${gem.name}]의 효과! 상대가 혼란에 빠졌다!`;
                }
                if (gem.effect === 'DEF_DOWN' && Math.random() < gem.chance) {
                    this.currentEnemy.def = Math.max(1, Math.floor(this.currentEnemy.def * 0.88));
                    log += `\n💎 [${gem.name}]의 효과! 상대의 방어가 떨어졌다!`;
                }
                return log;
            }

            /* ==========================================================================
               10-A. 턴 순서 결정 - 우선도(priority)가 같으면 스피드(마비 시 절반)로 비교,
               동률이면 50:50 랜덤. 실제 게임과 동일한 규칙.
               ========================================================================== */
            getEffectiveSpeed(pkm) {
                let spe = pkm.spe * getStatStageMultiplier(pkm.statStages ? pkm.statStages.spe : 0);
                if (pkm.status === STATUS_EFFECTS.PARALYSIS) spe *= 0.5;
                return spe;
            }

            decideTurnOrder(playerMove, enemyMove) {
                const pPriority = playerMove.priority || 0;
                const ePriority = enemyMove.priority || 0;
                if (pPriority !== ePriority) return pPriority > ePriority ? 'player' : 'enemy';
                const pSpe = this.getEffectiveSpeed(this.player.party[this.player.activeIdx]);
                const eSpe = this.getEffectiveSpeed(this.currentEnemy);
                if (pSpe === eSpe) return Math.random() < 0.5 ? 'player' : 'enemy';
                return pSpe > eSpe ? 'player' : 'enemy';
            }

            /* PP가 남아있는 기술 중에서 무작위로 고르고, 하나도 없으면 발버둥을 사용한다 */
            /* [닌텐도급 업그레이드] 예전에는 사용 가능한 기술 중 완전 무작위로 하나를
               골랐기 때문에, 상성상 전혀 효과가 없는 기술을 태연히 사용하는 등 트레이너
               답지 않게 행동했다. 이제는 실제 게임 AI처럼 상성이 좋고 위력이 센 기술일수록
               더 자주(하지만 100% 확정은 아니게) 고르도록 가중치 추첨 방식으로 바꿨다.
               체육관 관장의 포켓몬은 야생보다 한 수 더 계산적으로 상성을 노린다. */
            pickEnemyMove() {
                const usable = this.currentEnemy.skills.filter(sk => sk.pp > 0);
                if (usable.length === 0) return SKILL_DATABASE.STRUGGLE;

                const player = this.player.party[this.player.activeIdx];
                const weighted = usable.map(sk => {
                    let weight = 1;
                    if (sk.power > 0) {
                        const mult = this.getTypeMultiplier(sk.type, player.type1, player.type2);
                        if (mult >= 2) weight += 5;
                        else if (mult > 1) weight += 3;
                        else if (mult === 0) weight = 0.1;
                        else if (mult < 1) weight += 0.5;
                        weight += sk.power / 40;
                    } else if (sk.statBoost) {
                        // 이미 해당 능력치가 충분히 오른 상태라면 같은 변화기를 반복하지 않는다
                        const key = sk.statBoost.stat;
                        const cur = this.currentEnemy.statStages[key] || 0;
                        weight += cur >= 2 ? 0.2 : 1.5;
                    } else if (sk.status) {
                        // 상대가 이미 상태이상이면 상태이상 기술의 우선순위를 낮춘다
                        weight += (player.status && player.status !== STATUS_EFFECTS.NONE) ? 0.2 : 1.2;
                    }
                    return { sk, weight: Math.max(0.05, weight) };
                });

                if (this.currentEnemy.isBoss) {
                    weighted.forEach(w => { if (w.weight > 1) w.weight *= 1.6; });
                }

                const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
                let roll = Math.random() * totalWeight;
                for (const w of weighted) {
                    roll -= w.weight;
                    if (roll <= 0) return w.sk;
                }
                return weighted[weighted.length - 1].sk;
            }

            /* ==========================================================================
               10-B. 행동 전 상태이상 판정 - 수면/냉동/풀죽음/혼란/매혹/마비를 실제 게임과
               동일한 순서와 확률로 검사한다. 혼란(selfHit)이면 이번 행동은 자해로 대체된다.
               ========================================================================== */
            checkPreMoveStatus(pkm, label) {
                if (pkm.status === STATUS_EFFECTS.SLEEP) {
                    pkm.sleepTurns--;
                    if (pkm.sleepTurns <= 0) {
                        pkm.status = STATUS_EFFECTS.NONE;
                        return { blocked: false, wakeMsg: `${label}은(는) 잠에서 깨어났다!` };
                    }
                    return { blocked: true, message: `${label}은(는) 잠들어 있다...` };
                }
                if (pkm.status === STATUS_EFFECTS.FREEZE) {
                    if (Math.random() < 0.2) {
                        pkm.status = STATUS_EFFECTS.NONE;
                        return { blocked: false, wakeMsg: `${label}의 얼음이 녹았다!` };
                    }
                    return { blocked: true, message: `${label}은(는) 얼어붙어 움직일 수 없다!` };
                }
                if (pkm.flinched) {
                    pkm.flinched = false;
                    return { blocked: true, message: `${label}은(는) 풀이 죽어 움직이지 못한다!` };
                }
                if (pkm.confused) {
                    pkm.confusedTurns--;
                    if (pkm.confusedTurns <= 0) {
                        pkm.confused = false;
                    } else if (Math.random() < 0.33) {
                        return { blocked: true, selfHit: true, message: `${label}은(는) 혼란에 빠져 있다!` };
                    }
                }
                if (pkm.attracted && Math.random() < 0.5) {
                    return { blocked: true, message: `${label}은(는) 매혹되어 움직일 수 없다...` };
                }
                if (pkm.status === STATUS_EFFECTS.PARALYSIS && Math.random() < 0.25) {
                    return { blocked: true, message: `${label}은(는) 몸이 마비되어 움직일 수 없다!` };
                }
                return { blocked: false };
            }

            computeConfusionSelfDamage(pkm) {
                const randomRoll = (Math.floor(Math.random() * 16) + 85) / 100;
                return Math.max(1, Math.floor((((2 * pkm.level / 5 + 2) * 40 * pkm.atk / Math.max(1, pkm.def)) / 50 + 2) * randomRoll));
            }

            /* 상태이상 부여 시도 - 이미 다른 이상이 있거나, 타입 면역(실제 게임 규칙: 불꽃은
               화상 면역, 독/강철은 중독 면역, 전기는 마비 면역, 얼음은 냉동 면역)이면 무효 */
            tryInflictStatus(target, status, chance, log, targetLabel) {
                if (Math.random() >= chance) return log;
                if (target.status !== STATUS_EFFECTS.NONE) return log;
                const types = [target.type1, target.type2].filter(Boolean);
                if (status === STATUS_EFFECTS.BURN && types.includes('불꽃')) return log;
                if (status === STATUS_EFFECTS.POISON && (types.includes('독') || types.includes('강철'))) return log;
                if (status === STATUS_EFFECTS.PARALYSIS && types.includes('전기')) return log;
                if (status === STATUS_EFFECTS.FREEZE && types.includes('얼음')) return log;

                if (status === STATUS_EFFECTS.SLEEP) target.sleepTurns = 1 + Math.floor(Math.random() * 3);
                target.status = status;
                playSfx('status');
                return log + `\n${targetLabel}은(는) [${status}] 상태에 걸렸다!`;
            }

            handleFaint() {
                playSfx('faint');
                this.playFaintAnim(true);
                this.stats.battlesLost++;
                const hasAvailable = this.player.party.some(p => p.hp > 0);
                if (hasAvailable) {
                    // 기절 직후엔 반드시 다른 포켓몬으로 교체해야 하므로, 선택 전까지
                    // 파티 창을 닫을 수 없게 하는 강제 교체 플래그를 세운다.
                    this.forcedPartySwitch = true;
                    setTimeout(() => openPartyModal(), 1000);
                } else {
                    setTimeout(() => {
                        this.setBattleDialog("사용 가능한 포켓몬이 없습니다. 눈앞이 캄캄해졌다...");
                        // [버그 수정] 예전에는 전멸 후 회복만 하고 선두를 그대로 뒀기 때문에,
                        // 마지막에 쓰러진 포켓몬(= 파티 맨 뒤)이 그대로 선두로 남아 다음
                        // 전투에 나갔다. 실제 게임처럼 파티 1번 포켓몬으로 되돌린다.
                        this.player.party.forEach(p => {
                            p.hp = p.maxHp;
                            p.status = STATUS_EFFECTS.NONE;
                            p.confused = false; p.confusedTurns = 0;
                            p.attracted = false; p.flinched = false; p.sleepTurns = 0;
                            p.statStages = makeEmptyStatStages();
                            if (p.skills) p.skills.forEach(sk => { sk.pp = sk.maxPp; });
                        });
                        this.player.activeIdx = 0;
                        showToast('🏥 가장 가까운 포켓몬센터로 옮겨져 파티가 모두 회복되었습니다. 선두는 1번 포켓몬으로 돌아갑니다.');
                        setTimeout(() => this.endBattle(), 2000);
                    }, 1000);
                }
            }

            runEnemyMoveThenFinish() {
                this._enemyActedThisTurn = true;
                const enemyMove = this.pickEnemyMove();
                this.performMove(this.currentEnemy, this.player.party[this.player.activeIdx], enemyMove, false, () => this.finishTurnCycle());
            }

            /* ==========================================================================
               10-C. 공용 기술 실행 엔진 - 플레이어/적 양쪽이 동일한 함수를 공유한다.
               상태이상 판정 → PP 소모 → 명중 판정 → (변화기술/데미지기술 분기) →
               물리/특수 분리 데미지 계산(랭크·특성·날씨 반영) → 상태 부여/흡수/반동 →
               접촉 특성 반격 → 기절 판정 순으로 실제 게임 로직을 재현한다.
               onDone은 이번 행동이 정상적으로 끝나 다음 행동(상대 턴 등)으로 넘어갈 때만
               호출되고, 기절/승패가 갈리면 호출되지 않아 턴 체인이 자연스럽게 멈춘다.
               ========================================================================== */
            performMove(attacker, defender, move, attackerIsPlayer, onDone) {
                const attackerBoxId = attackerIsPlayer ? 'player-sprite-box' : 'enemy-sprite-box';
                const defenderBoxId = attackerIsPlayer ? 'enemy-sprite-box' : 'player-sprite-box';
                const attackerLabel = attackerIsPlayer ? (attacker.isMega ? '메가' + attacker.species : attacker.species) : attacker.species;
                const prefix = attackerIsPlayer ? '' : '적 ';
                const defenderPrefix = attackerIsPlayer ? '적 ' : '';

                const gate = this.checkPreMoveStatus(attacker, `${prefix}[${attackerLabel}]`);
                if (gate.blocked) {
                    if (gate.selfHit) {
                        const selfDmg = this.computeConfusionSelfDamage(attacker);
                        attacker.hp = Math.max(0, attacker.hp - selfDmg);
                        this.setBattleDialog(`${gate.message}\n혼란에 빠져 자신을 공격했다! (${selfDmg}의 데미지)`);
                        this.triggerHitAnimation(attackerBoxId);
                        playSfx('hit');
                        this.updateUI();
                        if (attacker.hp <= 0) {
                            if (attackerIsPlayer) {
                                this.setBattleDialog(`${gate.message}\n혼란에 빠져 자신을 공격했다!\n[${attackerLabel}]이(가) 쓰러졌습니다...`);
                                this.handleFaint();
                            } else {
                                const wasBoss = this.currentEnemy.isBoss;
                                this.setBattleDialog(`${gate.message}\n혼란에 빠져 자신을 공격했다!\n적 [${attacker.species}] 쓰러짐!`);
                                this.grantExp(computeExpReward(this.currentEnemy, !!this.currentEnemy.isBoss));
                                playSfx('victory');
                                this.playFaintAnim(false);
                                setTimeout(() => this.handleEnemyFaint(wasBoss), 1800);
                            }
                            return;
                        }
                        setTimeout(() => onDone(), 900);
                        return;
                    }
                    this.setBattleDialog(gate.message);
                    setTimeout(() => onDone(), 1000);
                    return;
                }

                const wakeLine = gate.wakeMsg ? gate.wakeMsg + '\n' : '';

                if (!move.isStruggle && move.pp !== undefined) move.pp = Math.max(0, move.pp - 1);

                const willHit = move.accuracy >= 999 ? true : (Math.random() * 100 < move.accuracy);
                if (!willHit) {
                    this.setBattleDialog(`${wakeLine}${prefix}[${attackerLabel}]의 ${move.name}!\n하지만 빗나갔다!`);
                    playSfx('miss');
                    setTimeout(() => onDone(), 1000);
                    return;
                }

                // [버그 수정] 예전에는 statBoost가 붙어 있기만 하면 무조건 이 분기로 빠져서,
                // 위력 90짜리 공격기인 코멧펀치가 데미지를 1도 주지 않고 공격만 올리고
                // 끝나버렸다. 위력이 없는 순수 변화기일 때만 이 분기를 탄다.
                if (move.statBoost && !(move.power > 0)) {
                    this.setBattleDialog(`${wakeLine}${prefix}[${attackerLabel}]의 ${move.name}!`);
                    this.playStatBoostFx(attackerIsPlayer ? 'player' : 'enemy', move, () => {
                        const key = move.statBoost.stat;
                        attacker.statStages[key] = Math.max(-6, Math.min(6, (attacker.statStages[key] || 0) + move.statBoost.stages));
                        const statNameMap = { atk: '공격', def: '방어', spAtk: '특수공격', spDef: '특수방어', spe: '스피드' };
                        this.setBattleDialog(`${prefix}[${attackerLabel}]의 ${move.name}!\n${statNameMap[key] || key}이(가) ${move.statBoost.stages >= 2 ? '크게 ' : ''}상승했다!`);
                        this.updateUI();
                        setTimeout(() => onDone(), 900);
                    });
                    return;
                }

                let typeMult = this.getTypeMultiplier(move.type, defender.type1, defender.type2);
                if (move.type === '땅' && defender.ability === 'LEVITATE') typeMult = 0;
                if (move.isStruggle) typeMult = 1.0;

                if (typeMult === 0) {
                    this.setBattleDialog(`${wakeLine}${prefix}[${attackerLabel}]의 ${move.name}!\n${defenderPrefix}[${defender.species}]에게는 효과가 없는 것 같다...`);
                    setTimeout(() => onDone(), 1000);
                    return;
                }

                if (!move.power || move.power === 0) {
                    let log = `${prefix}[${attackerLabel}]의 ${move.name}!`;
                    if (move.status) {
                        log = this.tryInflictStatus(defender, move.status, move.statusChance != null ? move.statusChance : 1.0, log, `${defenderPrefix}[${defender.species}]`);
                    }
                    this.setBattleDialog(`${wakeLine}${log}`);
                    this.updateUI();
                    setTimeout(() => onDone(), 1000);
                    return;
                }

                const { gem: equippedGem, powerMult: gemPowerMult, critBonus: gemCritBonus } = this.applyGemPreDamage(attacker, move);

                let effectivePower = move.power * gemPowerMult;
                const SAME_TYPE_BOOST_ABILITY = { BLAZE: '불꽃', TORRENT: '물', OVERGROW: '풀', SWARM: '벌레' };
                if (SAME_TYPE_BOOST_ABILITY[attacker.ability] === move.type && attacker.hp <= attacker.maxHp / 3) {
                    effectivePower *= 1.5;
                }

                const isSpecial = move.category === '특수';
                const atkKey = isSpecial ? 'spAtk' : 'atk';
                const defKey = isSpecial ? 'spDef' : 'def';
                let atkStat = attacker[atkKey] + (attackerIsPlayer && attacker.isMega ? 35 : 0);
                atkStat *= getStatStageMultiplier(attacker.statStages[atkKey]);
                if (attacker.ability === 'GUTS' && attacker.status !== STATUS_EFFECTS.NONE) atkStat *= 1.5;
                const defStat = Math.max(1, defender[defKey] * getStatStageMultiplier(defender.statStages[defKey]));

                let weatherMult = 1.0;
                const airLockActive = attacker.ability === 'AIR_LOCK' || defender.ability === 'AIR_LOCK';
                if (!airLockActive) {
                    if (this.weatherIdx === 0 || this.weatherIdx === 4) {
                        if (move.type === '불꽃') weatherMult = 1.5;
                        if (move.type === '물') weatherMult = 0.5;
                    } else if (this.weatherIdx === 1) {
                        if (move.type === '물') weatherMult = 1.5;
                        if (move.type === '불꽃') weatherMult = 0.5;
                    }
                }

                const isCrit = Math.random() < (gemCritBonus ? 0.35 : 0.0625);
                const critMult = isCrit ? 1.5 : 1.0;
                const randomRoll = (Math.floor(Math.random() * 16) + 85) / 100;

                let rawDmg = Math.floor((((2 * attacker.level / 5 + 2) * effectivePower * atkStat / defStat) / 50 + 2) * typeMult * critMult * randomRoll * weatherMult);
                if (move.power > 0) rawDmg = Math.max(1, rawDmg);

                if (defender.ability === 'MULTISCALE' && defender.hp === defender.maxHp) rawDmg = Math.max(1, Math.floor(rawDmg / 2));

                let sturdySaved = false;
                if (defender.ability === 'STURDY' && defender.hp === defender.maxHp && rawDmg >= defender.hp) {
                    rawDmg = defender.hp - 1;
                    sturdySaved = true;
                }

                this.setBattleDialog(`${wakeLine}${prefix}[${attackerLabel}]의 ${move.name}!`);

                this.playSkillAttackFx(attackerIsPlayer ? 'player' : 'enemy', move, () => {
                    const fxColor = (TYPE_ANIM_STYLES[move.type] || TYPE_ANIM_STYLES['노말']).color;
                    defender.hp = Math.max(0, defender.hp - rawDmg);
                    this.triggerHitAnimation(defenderBoxId);
                    const hitPt = this.getSpriteAnchor(!attackerIsPlayer).canvas;
                    this.spawnParticles(hitPt.x, hitPt.y, fxColor);
                    playSfx('hit');

                    // [타격감 업그레이드] 급소타이거나 상대 최대체력의 상당 부분을 깎는
                    // 강타일 때 화면 전체를 짧게 흔들어 실제 콘솔 게임 같은 타격감을 준다.
                    const dmgRatio = rawDmg / defender.maxHp;
                    if (isCrit || dmgRatio >= 0.5) this.triggerScreenShake('hard');
                    else if (dmgRatio >= 0.22) this.triggerScreenShake('soft');

                    let log = `${prefix}[${attackerLabel}]의 ${move.name}!`;
                    if (equippedGem) log += ` (💎${equippedGem.icon})`;
                    if (isCrit) log += " (급소에 맞았다!)";
                    if (typeMult > 1.0) log += "\n효과가 뛰어났다!";
                    if (typeMult < 1.0 && typeMult > 0) log += "\n효과가 별로인 듯하다...";
                    if (sturdySaved) log += `\n${defenderPrefix}[${defender.species}]은(는) 옹골참으로 버텨냈다!`;

                    if (move.status) {
                        log = this.tryInflictStatus(defender, move.status, move.statusChance != null ? move.statusChance : 1.0, log, `${defenderPrefix}[${defender.species}]`);
                    }

                    if (move.drain) {
                        const healAmt = Math.max(1, Math.floor(rawDmg * move.drain));
                        attacker.hp = Math.min(attacker.maxHp, attacker.hp + healAmt);
                        log += `\n체력을 ${healAmt} 흡수했다!`;
                    }

                    if (move.recoil) {
                        const recoilBase = move.isStruggle ? attacker.maxHp : rawDmg;
                        const recoilDmg = Math.max(1, Math.floor(recoilBase * move.recoil));
                        attacker.hp = Math.max(0, attacker.hp - recoilDmg);
                        log += `\n반동으로 ${recoilDmg}의 데미지를 입었다!`;
                    }

                    // 접촉 특성(정전기/불꽃몸/독가시) - 접촉 기술로 때린 공격자가 되받는다
                    const isContact = move.category === '물리' && !NON_CONTACT_PHYSICAL.has(move.name);
                    if (isContact && attacker.hp > 0 && attacker.status === STATUS_EFFECTS.NONE) {
                        const atkTypes = [attacker.type1, attacker.type2].filter(Boolean);
                        if (defender.ability === 'STATIC' && Math.random() < 0.3 && !atkTypes.includes('전기')) {
                            attacker.status = STATUS_EFFECTS.PARALYSIS;
                            log += `\n💥 [${defender.species}]의 정전기! ${prefix}[${attackerLabel}]이(가) 마비되었다!`;
                        } else if (defender.ability === 'FLAME_BODY' && Math.random() < 0.3 && !atkTypes.includes('불꽃')) {
                            attacker.status = STATUS_EFFECTS.BURN;
                            log += `\n💥 [${defender.species}]의 불꽃몸! ${prefix}[${attackerLabel}]이(가) 화상을 입었다!`;
                        } else if (defender.ability === 'POISON_POINT' && Math.random() < 0.3 && !atkTypes.includes('독') && !atkTypes.includes('강철')) {
                            attacker.status = STATUS_EFFECTS.POISON;
                            log += `\n💥 [${defender.species}]의 독가시! ${prefix}[${attackerLabel}]이(가) 중독되었다!`;
                        }
                    }

                    log = this.applyGemPostDamage(attacker, move, equippedGem, rawDmg, log);
                    this.updateUI();

                    if (defender.hp <= 0) {
                        if (attackerIsPlayer) {
                            const wasBoss = defender.isBoss;
                            log += `\n${defenderPrefix}[${defender.species}] 쓰러짐! (+${computeExpReward(defender, !!defender.isBoss)} EXP)`;
                            this.setBattleDialog(log);
                            this.grantExp(computeExpReward(defender, !!defender.isBoss));
                            playSfx('victory');
                            this.playFaintAnim(false);
                            setTimeout(() => this.handleEnemyFaint(wasBoss), 1800);
                        } else {
                            log += `\n내 [${defender.species}]이(가) 쓰러졌습니다...`;
                            this.setBattleDialog(log);
                            this.handleFaint();
                        }
                        return;
                    }

                    this.setBattleDialog(log);

                    if (attacker.hp <= 0) {
                        if (attackerIsPlayer) {
                            this.setBattleDialog(log + `\n반동으로 [${attackerLabel}]이(가) 쓰러졌습니다...`);
                            this.handleFaint();
                        } else {
                            const wasBoss = this.currentEnemy.isBoss;
                            this.setBattleDialog(log + `\n적 [${attacker.species}]은(는) 반동으로 쓰러졌습니다!`);
                            this.grantExp(computeExpReward(this.currentEnemy, !!this.currentEnemy.isBoss));
                            playSfx('victory');
                            this.playFaintAnim(false);
                            setTimeout(() => this.handleEnemyFaint(wasBoss), 1800);
                        }
                        return;
                    }

                    setTimeout(() => onDone(), 1000);
                });
            }

            /* 플레이어가 기술을 선택했을 때 호출되는 진입점 - 적의 기술을 정하고 턴 순서를
               결정한 뒤, performMove를 순서대로 체이닝해 한 라운드를 완성한다. */
            executeBattleTurn(chosenSkill) {
                if (!chosenSkill || (!chosenSkill.isStruggle && chosenSkill.pp <= 0)) return;

                this.isTurnProcessing = true;
                this.renderBattleActionGrid();

                const curPkm = this.player.party[this.player.activeIdx];
                const enemyMove = this.pickEnemyMove();
                const order = this.decideTurnOrder(chosenSkill, enemyMove);

                if (order === 'player') {
                    this.performMove(curPkm, this.currentEnemy, chosenSkill, true, () => {
                        if (this.state !== GAME_STATES.BATTLE) return;
                        if (curPkm.hp <= 0) return; // 반동 등으로 기절 - 교체 후 처리는 switchPokemonInBattle에서
                        this._enemyActedThisTurn = true;
                        this.performMove(this.currentEnemy, this.player.party[this.player.activeIdx], enemyMove, false, () => {
                            this.finishTurnCycle();
                        });
                    });
                } else {
                    this._enemyActedThisTurn = true;
                    this.performMove(this.currentEnemy, curPkm, enemyMove, false, () => {
                        if (this.state !== GAME_STATES.BATTLE) return;
                        if (this.currentEnemy.hp <= 0) return;
                        if (this.player.party[this.player.activeIdx].hp <= 0) return; // 기절 - 강제교체 대기
                        this.performMove(this.player.party[this.player.activeIdx], this.currentEnemy, chosenSkill, true, () => {
                            this.finishTurnCycle();
                        });
                    });
                }
            }

            /* ==========================================================================
               10-D. 턴 종료 처리 - 독/화상 지속 데미지(양쪽 모두), 날씨 틱(모래바람/눈),
               가속(스피드 상승)·아이스바디(회복) 특성을 실제 게임처럼 매 턴 끝에 적용한다.
               ========================================================================== */
            applyEndOfTurnStatus(pkm, label) {
                if (!pkm || pkm.hp <= 0) return;
                if (pkm.status === STATUS_EFFECTS.POISON || pkm.status === STATUS_EFFECTS.BURN) {
                    const statusDmg = Math.max(1, Math.floor(pkm.maxHp / 8));
                    pkm.hp = Math.max(0, pkm.hp - statusDmg);
                    showToast(`${label}은(는) ${pkm.status} 데미지를 입었다!`);
                }
                if (pkm.hp > 0 && (this.weatherIdx === 2 || this.weatherIdx === 3) && !(pkm.ability === 'AIR_LOCK')) {
                    const types = [pkm.type1, pkm.type2].filter(Boolean);
                    if (this.weatherIdx === 2 && !types.some(t => ['바위', '땅', '강철'].includes(t)) && pkm.ability !== 'SAND_VEIL') {
                        const chip = Math.max(1, Math.floor(pkm.maxHp / 16));
                        pkm.hp = Math.max(0, pkm.hp - chip);
                        showToast(`${label}은(는) 모래바람에 시달렸다!`);
                    } else if (this.weatherIdx === 3) {
                        if (pkm.ability === 'ICE_BODY') {
                            pkm.hp = Math.min(pkm.maxHp, pkm.hp + Math.max(1, Math.floor(pkm.maxHp / 16)));
                        } else if (!types.includes('얼음')) {
                            const chip = Math.max(1, Math.floor(pkm.maxHp / 16));
                            pkm.hp = Math.max(0, pkm.hp - chip);
                            showToast(`${label}은(는) 추위에 시달렸다!`);
                        }
                    }
                }
                if (pkm.hp > 0 && pkm.ability === 'SPEED_BOOST') {
                    pkm.statStages.spe = Math.max(-6, Math.min(6, (pkm.statStages.spe || 0) + 1));
                }
            }

            finishTurnCycle() {
                this.battleTurn = (this.battleTurn || 0) + 1;
                const curPkm = this.player.party[this.player.activeIdx];
                this.applyEndOfTurnStatus(curPkm, `[${curPkm.species}]`);
                if (this.currentEnemy) this.applyEndOfTurnStatus(this.currentEnemy, `적 [${this.currentEnemy.species}]`);

                this.isTurnProcessing = false;
                this.updateUI();

                if (curPkm.hp <= 0) {
                    // 턴이 끝난 뒤(독/화상/날씨) 기절한 경우 - 양쪽 모두 이미 이번 라운드
                    // 행동을 마쳤으므로, 교체 후 적이 추가로 공격하지 않도록 플래그를 세운다.
                    this._enemyActedThisTurn = true;
                    this.handleFaint();
                    return;
                }

                this._enemyActedThisTurn = false;
                if (this.currentEnemy && this.currentEnemy.hp <= 0) {
                    // 날씨/상태 데미지로 상대가 쓰러진 경우 - 정상 승리 처리로 넘어간다
                    const expYield = this.currentEnemy.expYield;
                    const wasBoss = this.currentEnemy.isBoss;
                    this.setBattleDialog(`적 [${this.currentEnemy.species}] 쓰러짐! (+${expYield} EXP)`);
                    this.grantExp(expYield);
                    playSfx('victory');
                    this.playFaintAnim(false);
                    setTimeout(() => this.handleEnemyFaint(wasBoss), 1800);
                    return;
                }

                // 매 라운드가 끝나면 실제 게임처럼 다시 [싸우다/가방/포켓몬/도망] 메인
                // 커맨드 메뉴로 돌아간다.
                this.showBattleCommandMenu();
            }

            useItemInBattle(inventorySlot) {
                const slot = this.player.inventory[inventorySlot];
                if (!slot || slot.count <= 0) return;

                // [버그 수정] 체육관 관장의 트레이너 포켓몬을 몬스터볼로 그대로 포획할 수
                // 있었다. 실제 게임처럼 트레이너가 소유한 포켓몬은 포획 대상이 아니므로,
                // 볼을 소모하거나 턴을 넘기지 않고 즉시 안내만 띄운다.
                if (slot.item.catchRate && this.currentEnemy && this.currentEnemy.isBoss) {
                    showToast("트레이너가 소유한 포켓몬은 포획할 수 없습니다!");
                    closeBagModal();
                    return;
                }

                this.isTurnProcessing = true;
                this.refreshBattleMenu();
                const curPkm = this.player.party[this.player.activeIdx];

                if (slot.item.catchRate) {
                    slot.count--;
                    closeBagModal();

                    const ballKey = slot.item.ballKey || BALL_KEY_BY_ID[slot.item.id] || 'MONSTER';
                    // [볼 보정] 상황(지형/시간/턴수/상대 상태 등)에 따라 볼마다 다른 배율이 붙는다.
                    const ctx = this.buildCatchContext();
                    const bonus = ballCatchMultiplier(ballKey, ctx);
                    const hpFactor = (1 - this.currentEnemy.hp / this.currentEnemy.maxHp) * 0.75 + 0.25;
                    const catchRate = slot.item.catchRate >= 255
                        ? 999
                        : hpFactor * slot.item.catchRate * bonus;
                    const willCatch = Math.random() < catchRate;

                    const bonusNote = (slot.item.catchRate < 255 && bonus > 1.05)
                        ? `  (${BALL_CATALOG[ballKey].name} 효과 발동! x${bonus.toFixed(1)})` : '';
                    this.setBattleDialog(`[${slot.item.name}]을(를) 던졌다!${bonusNote}`);
                    this.animatePokeballThrow(slot.item, willCatch, () => {
                        if (willCatch) {
                            this.currentEnemy.caughtBall = ballKey;
                            // 힐볼은 잡는 순간 HP와 상태 이상이 전부 회복된다
                            if (ballKey === 'HEAL') {
                                this.currentEnemy.hp = this.currentEnemy.maxHp;
                                this.currentEnemy.status = STATUS_EFFECTS.NONE;
                                this.currentEnemy.confused = false;
                                this.currentEnemy.skills.forEach(sk => { sk.pp = sk.maxPp != null ? sk.maxPp : sk.pp; });
                            }
                            this.setBattleDialog(`신난다! [${this.currentEnemy.species}]을(를) 포획했다!`);
                            playSfx('catch');
                            if (this.player.party.length < 6) {
                                this.player.party.push(this.currentEnemy);
                            } else {
                                this.player.box.push(this.currentEnemy);
                                showToast("파티가 가득 차 PC 보관함으로 전송되었습니다. [B] 보관함에서 꺼낼 수 있습니다.");
                            }
                            this.player.caughtSpecies.add(this.currentEnemy.id);
                            // [젬 드롭] 잡은 포켓몬의 타입에 어울리는 젬이 확률로 떨어진다
                            const dropKey = rollGemDrop(this.currentEnemy);
                            if (dropKey && GEM_DATABASE[dropKey]) {
                                const gemSlot = this.player.gemInventory.find(g => g.key === dropKey);
                                if (gemSlot) gemSlot.count++;
                                else this.player.gemInventory.push({ key: dropKey, count: 1 });
                                const gd = GEM_DATABASE[dropKey];
                                setTimeout(() => showToast(`${gd.icon} [${gd.name}]을(를) 손에 넣었다! ([U]에서 기술에 장착)`), 900);
                            }
                            this.stats.captures++;
                            if (this.currentEnemy.isLegend || this.currentEnemy.isRareTier) this.stats.legendsCaught++;
                            if (this.currentEnemy.isShiny) {
                                this.stats.shiniesCaught = (this.stats.shiniesCaught || 0) + 1;
                                showToast('✨ 색이 다른 포켓몬을 손에 넣었습니다! 아주 희귀한 개체입니다.');
                            }
                            this.checkAchievements();
                            setTimeout(() => this.endBattle(), 1600);
                        } else {
                            this.setBattleDialog(`볼에서 빠져나왔다! 포획 실패...`);
                            playSfx('fail');
                            setTimeout(() => this.runEnemyMoveThenFinish(), 1200);
                        }
                    });
                } else if (slot.item.healAmount) {
                    slot.count--;
                    curPkm.hp = Math.min(curPkm.maxHp, curPkm.hp + slot.item.healAmount);
                    this.setBattleDialog(`[${slot.item.name}]을(를) 사용하여 체력을 회복했습니다.`);
                    closeBagModal();
                    setTimeout(() => this.runEnemyMoveThenFinish(), 1200);
                } else if (slot.item.isRevive) {
                    // 기력의조각 - 기절한 파티 포켓몬 중 첫 번째를 HP 절반으로 되살린다
                    const faintedIdx = this.player.party.findIndex(p => p.hp <= 0);
                    if (faintedIdx < 0) {
                        this.setBattleDialog('기절한 포켓몬이 없어 효과가 없었다...');
                        closeBagModal();
                        setTimeout(() => this.runEnemyMoveThenFinish(), 1000);
                    } else {
                        slot.count--;
                        const target = this.player.party[faintedIdx];
                        target.hp = Math.max(1, Math.floor(target.maxHp / 2));
                        target.status = STATUS_EFFECTS.NONE;
                        this.setBattleDialog(`[${slot.item.name}]을(를) 사용해 [${target.species}]이(가) 되살아났다!`);
                        playSfx('heal');
                        closeBagModal();
                        setTimeout(() => this.runEnemyMoveThenFinish(), 1200);
                    }
                } else if (slot.item.cures) {
                    slot.count--;
                    if (slot.item.cures === 'ANY') {
                        curPkm.status = STATUS_EFFECTS.NONE;
                        curPkm.confused = false;
                        curPkm.confusedTurns = 0;
                        this.setBattleDialog(`[${slot.item.name}]을(를) 사용해 모든 상태 이상을 치유했습니다.`);
                    } else if (curPkm.status === slot.item.cures) {
                        curPkm.status = STATUS_EFFECTS.NONE;
                        this.setBattleDialog(`[${slot.item.name}]을(를) 사용해 상태 이상을 치유했습니다.`);
                    } else {
                        this.setBattleDialog(`하지만 효과가 없었다...`);
                    }
                    closeBagModal();
                    setTimeout(() => this.runEnemyMoveThenFinish(), 1200);
                }
                this.updateUI();
            }

            /* 실제 닌텐도 포켓몬 게임처럼 EXP 바가 레벨 문턱에서 꽉 찼다가 반짝이며
               레벨업 팡파레·능력치 상승 안내가 뜨고, 다시 0%부터 채워지는 것처럼
               "보이도록" 연출한다. 단, 레벨/스탯/진화 등 실제 데이터는 항상 이 함수
               호출이 끝나는 즉시 완전히 반영된다(동기 처리) - 연출용 setTimeout 때문에
               레벨업 판정이 지연되면 그 사이에 게임 로직이나 테스트가 마치 레벨업이
               일어나지 않은 것처럼 오판할 수 있기 때문이다. 애니메이션은 순수하게
               화면(EXP 바/토스트/글로우)에만 영향을 주는 후처리 레이어다. */
            grantExp(amount) {
                const pkm = this.player.party[this.player.activeIdx];
                if (pkm.level >= 100) { pkm.exp = 0; this.updateUI(); return; }
                // 럭셔리볼/프렌드볼/프레셔스볼에서 나온 포켓몬은 경험치를 20% 더 받는다
                if (['LUXURY', 'FRIEND', 'CHERISH'].includes(pkm.caughtBall)) amount = Math.floor(amount * 1.2);
                pkm.exp += amount;
                if (pkm.level > (this.stats.highestLevel || 1)) this.stats.highestLevel = pkm.level;

                const levelUpSteps = [];

                while (pkm.exp >= pkm.maxExp && pkm.level < 100) {
                    pkm.exp -= pkm.maxExp;
                    pkm.level++;
                    pkm.maxExp = expToNextLevel(pkm.level);

                    // 실제 게임처럼 레벨업 시 HP뿐 아니라 공격/방어/특공/특방/스피드까지
                    // 종족값 공식으로 전부 재계산한다 (예전엔 특공/특방/스피드가 생성 시점에
                    // 고정되어 레벨이 올라도 절대 오르지 않는 문제가 있었음).
                    const oldMaxHp = pkm.maxHp, oldAtk = pkm.atk, oldDef = pkm.def, oldSpAtk = pkm.spAtk, oldSpDef = pkm.spDef, oldSpe = pkm.spe;
                    const stats = computeStatsAtLevel(pkm.baseStats, pkm.level, pkm.ivs, pkm.evs, pkm.nature);
                    pkm.maxHp = stats.maxHp;
                    pkm.hp = Math.min(pkm.maxHp, pkm.hp + (stats.maxHp - oldMaxHp));
                    pkm.atk = stats.atk;
                    pkm.def = stats.def;
                    pkm.spAtk = stats.spAtk;
                    pkm.spDef = stats.spDef;
                    pkm.spe = stats.spe;

                    // [레벨업 기술 습득] 이 레벨에서 배우는 기술이 있는지 확인한다
                    const learnable = (pkm.learnset || []).filter(L => L.lv === pkm.level);
                    const learnedNow = [];
                    learnable.forEach(L => {
                        const mv = SKILL_DATABASE[L.key];
                        if (!mv) return;
                        if (pkm.skills.some(sk => sk.name === mv.name)) return;
                        if (pkm.skills.length < 4) {
                            pkm.skills.push(instantiateSkills([mv])[0]);
                            learnedNow.push(mv.name);
                        } else {
                            // 이미 4개를 익혔으면 무엇을 잊을지 직접 고르게 한다
                            if (!this.pendingMoveLearns) this.pendingMoveLearns = [];
                            this.pendingMoveLearns.push({ pkmRef: pkm, moveKey: L.key });
                        }
                    });

                    const step = {
                        species: pkm.species,
                        level: pkm.level,
                        learnText: learnedNow.length ? `📘 ${pkm.species}이(가) [${learnedNow.join(', ')}]을(를) 배웠다!` : null,
                        // 실제 게임의 "능력치가 올랐다!" 화면을 흉내내, 스탯별 상승폭을 보여준다.
                        deltaText: `📈 HP+${stats.maxHp - oldMaxHp} 공격+${stats.atk - oldAtk} 방어+${stats.def - oldDef} 특공+${stats.spAtk - oldSpAtk} 특방+${stats.spDef - oldSpDef} 스피드+${stats.spe - oldSpe}`,
                        evolveText: null
                    };

                    if (pkm.evolveLv && pkm.level >= pkm.evolveLv) {
                        const nextForm = POKEMON_DATABASE.find(p => p.id === pkm.evolveTo);
                        if (nextForm) {
                            pkm.id = nextForm.id;
                            pkm.species = nextForm.species;
                            pkm.type1 = nextForm.type1;
                            pkm.type2 = nextForm.type2;
                            pkm.baseStats = nextForm.baseStats;
                            pkm.frontSprite = nextForm.frontSprite;
                            pkm.backSprite = nextForm.backSprite;
                            pkm.evolveLv = nextForm.evolveLv;
                            pkm.evolveTo = nextForm.evolveTo;
                            if (nextForm.megaSprite) pkm.megaSprite = nextForm.megaSprite;
                            // 진화체의 기본 종족값으로 스탯을 다시 계산하고, 스킬은 PP를 가진
                            // 새 인스턴스로 교체한다 (기존 PP 소모분은 초기화된다).
                            const evoStats = computeStatsAtLevel(pkm.baseStats, pkm.level, pkm.ivs, pkm.evs, pkm.nature);
                            const hpRatio = pkm.hp / pkm.maxHp;
                            pkm.maxHp = evoStats.maxHp;
                            pkm.hp = Math.max(1, Math.round(evoStats.maxHp * hpRatio));
                            pkm.atk = evoStats.atk; pkm.def = evoStats.def;
                            pkm.spAtk = evoStats.spAtk; pkm.spDef = evoStats.spDef; pkm.spe = evoStats.spe;
                            pkm.ability = getAbilityForSpecies(nextForm);
                            // 실제 게임처럼 진화해도 익힌 기술은 그대로 유지한다
                            pkm.learnset = nextForm.learnset;
                            step.evolveText = `✨ 축하합니다! [${pkm.species}](으)로 진화했습니다!`;
                        }
                    }

                    levelUpSteps.push(step);
                }

                if (levelUpSteps.length > 0) {
                    this._playLevelUpPresentation(pkm, levelUpSteps);
                } else {
                    this.updateUI();
                }
            }

            /* grantExp()가 이미 확정한 레벨업 결과를 실제 게임처럼 순서대로 "보여주기만"
               하는 연출 담당 함수 - EXP 바를 100%로 채운 뒤 팡파레/글로우/토스트를
               띄우고 다음 레벨 몫만큼 다시 0%부터 채우는 흐름을 반복 재생한다. */
            _playLevelUpPresentation(pkm, steps) {
                const expBarIds = ['hud-exp-bar', 'player-info-exp-bar'];
                const setBarPct = (pct) => expBarIds.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.style.width = `${pct}%`;
                });

                // 다른 updateUI() 호출이 끼어들어도(에너미 HP 갱신 등) 최소한 이름/레벨/HP는
                // 즉시 최신 상태로 보이도록 먼저 한 번 갱신해 둔다.
                this.updateUI();

                let delay = 0;
                steps.forEach((step, i) => {
                    const isLast = i === steps.length - 1;
                    setTimeout(() => setBarPct(100), delay);
                    delay += 340;
                    setTimeout(() => {
                        showToast(`🎉 ${step.species}의 레벨이 ${step.level}(으)로 상승했습니다!`);
                        playSfx('levelup');
                        this.triggerLevelUpGlow();
                        setTimeout(() => showToast(step.deltaText), 750);
                        if (step.learnText) {
                            setTimeout(() => { showToast(step.learnText); playSfx('levelup'); }, 1500);
                        }
                        if (step.evolveText) {
                            setTimeout(() => showToast(step.evolveText), step.learnText ? 2250 : 1500);
                        }
                    }, delay);
                    delay += 300;
                    setTimeout(() => {
                        setBarPct(isLast ? (pkm.exp / pkm.maxExp) * 100 : 0);
                    }, delay);
                    delay += 260;
                });
            }

            /* 레벨업 순간 HUD/배틀 정보창에 실제 게임처럼 은은한 황금빛 섬광을 준다.
               예전엔 'hud-layer'(카드 두 개를 감싸는 투명한 flex 컨테이너, 자체 배경/
               테두리 없음)에 이 효과를 걸어서, 카드 테두리가 아니라 화면 상단 전체에
               걸친 네모난 검은 그림자+금빛 섬광이 뜬금없이 번쩍이는 것처럼 보였다.
               실제 카드(포켓몬 HP 카드)에 걸어야 카드 테두리를 따라 도는 은은한
               섬광으로 보인다. */
            triggerLevelUpGlow() {
                ['hud-pokemon-card', 'player-info-box'].forEach(id => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    el.classList.remove('levelup-glow');
                    void el.offsetWidth;
                    el.classList.add('levelup-glow');
                });
            }

            endBattle() {
                this.ballThrow3D = null;
                this.hideBall3D();
                this.clearBallFxClasses();
                this.state = GAME_STATES.FIELD;
                this.isTurnProcessing = false;
                this.forcedPartySwitch = false;
                this.currentGymSite = null;
                this.currentGymLeaderName = null;
                this.currentTrainerLevels = null;
                this.currentTrainerNpc = null;
                this._trainerEncounterLock = false;
                this.enemyTeamQueue = [];
                this.currentChampionChallenge = false;

                document.getElementById('battle-panel').style.display = 'none';
                document.getElementById('battle-overlay').style.display = 'none';
                this.clearMegaFxClasses();

                // 3D 배틀 무대 숨기기 - 필드용 셰이더가 켜져 있으면 다음 프레임에
                // syncFieldPostFxVisibility()가 threeCanvas를 다시 켠다.
                this.threeCanvas.style.display = 'none';
                this.threeCanvas.classList.remove('fx-light-layer');
                this.canvas.style.visibility = 'visible';
                this._postFxVisible = false;
                this.battleStageGroup3D.visible = false;
                this.terrainGroup3D.visible = true;
                this.propsGroup3D.visible = true;
                this.playerGroup3D.visible = true;
                if (this.scene3D.fog) { this.scene3D.fog.near = 140; this.scene3D.fog.far = 340; }

                document.getElementById('hud-layer').classList.remove('hidden');
                document.getElementById('minimap-container').classList.remove('hidden');

                this.updateUI();
                this.checkAchievements();
                this.saveGame(true);
                this.refreshFieldMusic(true);
            }

            /* 서 있는 지형에 따라 필드 BGM을 바꾼다 - 마을에 들어서면 평화로운
               마을 테마, 사원에서는 신비로운 테마가 흐른다 (실제 게임의 지역 BGM 재현). */
            refreshFieldMusic(force) {
                if (this.state !== GAME_STATES.FIELD) return;
                const tile = this.worldMap[this.player.y] ? this.worldMap[this.player.y][this.player.x] : 0;
                let track = 'FIELD';
                if (tile === TILE_TYPES.TOWN || tile === TILE_TYPES.CENTER || tile === TILE_TYPES.GYM || tile === TILE_TYPES.MART) track = 'TOWN';
                else if (LEGEND_TEMPLE_INFO[tile]) track = 'TEMPLE';
                if (force || track !== this._currentFieldTrack) {
                    this._currentFieldTrack = track;
                    MusicEngine.start(track);
                }
            }

            /* 현재 서 있는 타일에 맞는 전투 무대 팔레트를 고른다 */
            /* 볼 보정에 필요한 "지금 이 순간"의 정보를 한 곳에 모은다.
               (서 있는 지형 / 밤 여부 / 경과 턴 / 도감 등록 여부 / 내 선두 포켓몬) */
            buildCatchContext() {
                const phase = this.timePhase || sampleTimePhase(this.timeOfDay || 0.42);
                return {
                    foe: this.currentEnemy || {},
                    mine: this.player.party[this.player.activeIdx] || {},
                    tile: (this.worldMap[this.player.y] || [])[this.player.x],
                    night: phase.alpha > 0.34,
                    turn: this.battleTurn || 0,
                    dexKnown: !!(this.player.caughtSpecies && this.currentEnemy && this.player.caughtSpecies.has(this.currentEnemy.id))
                };
            }
            getBattleBiomePalette() {
                const T = TILE_TYPES;
                const tile = (this.worldMap[this.player.y] || [])[this.player.x];
                const map = {
                    [T.TALL_GRASS]: 'TALL_GRASS', [T.FOREST]: 'FOREST', [T.WATER]: 'WATER',
                    [T.SAND]: 'SAND', [T.SNOW]: 'SNOW', [T.VOLCANO]: 'VOLCANO',
                    [T.ROCK]: 'ROCK', [T.TOWN]: 'TOWN', [T.GYM]: 'TOWN',
                    [T.CENTER]: 'TOWN', [T.MART]: 'TOWN',
                    [T.SWAMP]: 'SWAMP', [T.BEACH]: 'BEACH', [T.FLOWER]: 'FLOWER',
                    [T.CAVE]: 'CAVE', [T.RUINS]: 'RUINS', [T.ICE_FIELD]: 'ICE_FIELD',
                    [T.WASTELAND]: 'WASTELAND', [T.BAMBOO]: 'BAMBOO', [T.CHERRY]: 'CHERRY'
                };
                return BATTLE_BIOME_PALETTE[map[tile]] || BATTLE_BIOME_PALETTE.DEFAULT;
            }

            /* 색상 hex를 현재 시간대 색조(tint/alpha)와 섞어 낮/노을/밤 분위기를 만든다 */
            blendHexWithTint(hex, phase) {
                const a = Math.min(0.72, phase.alpha);
                const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
                const nr = Math.round(r * (1 - a) + phase.tint[0] * a);
                const ng = Math.round(g * (1 - a) + phase.tint[1] * a);
                const nb = Math.round(b * (1 - a) + phase.tint[2] * a);
                return (nr << 16) | (ng << 8) | nb;
            }

            /* [닌텐도급 연출] 포켓몬이 전투에 등장할 때 좌우에서 미끄러지듯 튀어나오는
               모션. 전투 시작, 관장의 다음 포켓몬, 내 포켓몬 교체 모두에서 재생된다. */
            playSpriteEntryAnim(which) {
                const run = (boxId, cls) => {
                    const box = document.getElementById(boxId);
                    if (!box) return;
                    box.classList.remove('enter-player', 'enter-enemy');
                    void box.offsetWidth;
                    box.classList.add(cls);
                    setTimeout(() => box.classList.remove(cls), 700);
                };
                if (which === 'both' || which === 'enemy') run('enemy-sprite-box', 'enter-enemy');
                if (which === 'both' || which === 'player') run('player-sprite-box', 'enter-player');
            }

            /* 쓰러진 포켓몬이 화면 아래로 스르륵 가라앉는 기절 연출 */
            playFaintAnim(isPlayerSide) {
                const img = document.getElementById(isPlayerSide ? 'player-sprite' : 'enemy-sprite');
                if (!img) return;
                img.classList.remove('fainting');
                void img.offsetWidth;
                img.classList.add('fainting');
                setTimeout(() => img.classList.remove('fainting'), 900);
            }

            triggerHitAnimation(elementId) {
                const el = document.getElementById(elementId);
                el.style.transform = 'scale(0.85) rotate(6deg)';
                setTimeout(() => el.style.transform = 'scale(1) rotate(0deg)', 150);
            }

            /* [타격감 업그레이드] 화면 전체(#screen-area)를 짧게 흔드는 CSS 애니메이션을
               재생한다. 이미 재생 중이면 클래스를 한 번 떼었다 다시 붙여 애니메이션을
               재시작한다(연속 강타 시에도 매번 자연스럽게 흔들리도록). */
            triggerScreenShake(intensity) {
                const el = document.getElementById('screen-area');
                if (!el) return;
                const cls = intensity === 'hard' ? 'shake-hard' : 'shake-soft';
                el.classList.remove('shake-soft', 'shake-hard');
                void el.offsetWidth; // 리플로우를 강제해 애니메이션 재시작을 보장
                el.classList.add(cls);
            }

            spawnParticles(x, y, color) {
                for (let i = 0; i < 20; i++) {
                    this.particles.push({
                        x: x, y: y,
                        vx: (Math.random() - 0.5) * 12,
                        vy: (Math.random() - 0.5) * 12,
                        life: 1.0,
                        color: color
                    });
                }
            }

            /* ==========================================================================
               11. CANVAS RENDERING & DAY/NIGHT LIGHTING
               ========================================================================== */
            /* ==========================================================================
               11-A. 주인공 트레이너 캐릭터 - 닌텐도 DS 시절 도트 오버월드 스프라이트 재현
               (RSE/DPPt 시절 주인공을 참고한 4방향 2프레임 워크사이클 + 음영/하이라이트)
               ========================================================================== */
            /* ==========================================================================
               11-A. 오버월드 지형 아트 아틀라스
               예전에는 매 프레임 타일마다 fillRect/arc를 직접 호출해 그렸기 때문에,
               디테일을 조금만 늘려도 프레임이 흔들렸다. 그래서 디테일이 "단색 + 점 몇 개"
               수준에 머물러 있었다. 이제는 지형마다 여러 종류의 40x40 타일 그림을 게임
               시작 시 오프스크린 캔버스에 딱 한 번 구워두고(변주 6종, 애니메이션 지형은
               프레임까지), 매 프레임에는 drawImage 한 번으로 찍어낸다. 덕분에 훨씬
               촘촘한 지형 표현을 쓰면서도 렌더링 비용은 오히려 줄었다.
               ========================================================================== */
            buildFieldArt() {
                const T = TILE_TYPES;
                const mk = (w, h) => {
                    const cv = document.createElement('canvas');
                    cv.width = w; cv.height = h;
                    return cv;
                };
                const S = TILE_SIZE;

                // 지형별 (변주 수, 애니메이션 프레임 수)
                const SPEC = {
                    [T.GRASS]:      { v: 6, f: 1 },
                    [T.TALL_GRASS]: { v: 4, f: 4 },
                    [T.WATER]:      { v: 4, f: 8 },
                    [T.SAND]:       { v: 6, f: 1 },
                    [T.SNOW]:       { v: 6, f: 1 },
                    [T.VOLCANO]:    { v: 8, f: 4 },
                    [T.FOREST]:     { v: 6, f: 1 },
                    [T.ROCK]:       { v: 6, f: 1 },
                    [T.PATH]:       { v: 6, f: 1 },
                    [T.SWAMP]:      { v: 6, f: 4 },
                    [T.BEACH]:      { v: 6, f: 1 },
                    [T.FLOWER]:     { v: 6, f: 1 },
                    [T.CAVE]:       { v: 8, f: 3 },
                    [T.RUINS]:      { v: 8, f: 1 },
                    [T.ICE_FIELD]:  { v: 4, f: 4 },
                    [T.WASTELAND]:  { v: 6, f: 1 },
                    [T.BAMBOO]:     { v: 5, f: 1 },
                    [T.CHERRY]:     { v: 6, f: 1 }
                };

                this.tileArt = {};
                this.tileArtFrames = {};

                Object.keys(SPEC).forEach(k => {
                    const type = Number(k);
                    const { v, f } = SPEC[k];
                    this.tileArtFrames[type] = f;
                    this.tileArt[type] = [];
                    for (let vi = 0; vi < v; vi++) {
                        const frames = [];
                        for (let fi = 0; fi < f; fi++) {
                            const cv = mk(S, S);
                            this.paintTileArt(cv.getContext('2d'), type, vi, fi / f, S);
                            frames.push(cv);
                        }
                        this.tileArt[type].push(frames);
                    }
                });

                // 마을 포장도로 - 회백색 판석. 타일 아트와 같은 방식으로 미리 구워둔다.
                this.townRoadArt = [];
                for (let vi = 0; vi < 4; vi++) {
                    const cv = mk(S, S);
                    const rc = cv.getContext('2d');
                    const rr = makeSeededRng(4242 + vi * 97);
                    rc.fillStyle = '#cfc6ae';
                    rc.fillRect(0, 0, S, S);
                    // 판석 얼룩
                    for (let i = 0; i < 5; i++) {
                        rc.fillStyle = rr() < 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(120,108,88,0.16)';
                        rc.beginPath();
                        rc.arc(rr() * S, rr() * S, 6 + rr() * 9, 0, Math.PI * 2);
                        rc.fill();
                    }
                    // 벽돌 줄눈
                    rc.strokeStyle = 'rgba(120,110,90,0.38)';
                    rc.lineWidth = 1;
                    for (let i = 0; i <= 2; i++) {
                        rc.beginPath();
                        rc.moveTo(0, i * (S / 2) + 0.5);
                        rc.lineTo(S, i * (S / 2) + 0.5);
                        rc.stroke();
                    }
                    for (let row = 0; row < 2; row++) {
                        const off = (vi + row) % 2 ? S / 2 : 0;
                        rc.beginPath();
                        rc.moveTo(off + 0.5, row * (S / 2));
                        rc.lineTo(off + 0.5, (row + 1) * (S / 2));
                        rc.stroke();
                    }
                    // 자잘한 모래알
                    rc.fillStyle = 'rgba(140,128,104,0.5)';
                    for (let i = 0; i < 10; i++) rc.fillRect(rr() * S, rr() * S, 1.2, 1.2);
                    this.townRoadArt.push(cv);
                }

                // 지형 위에 얹히는 입체 오브젝트(나무/바위/선인장/전나무 등).
                // 타일보다 위로 솟아오르므로 캔버스를 세로로 길게 잡고, 그릴 때
                // y를 위로 끌어올려 아래 줄 타일이 윗줄 오브젝트를 자연스럽게 가린다.
                /* 오브젝트는 [변주][바람 프레임] 2차원으로 굽는다. 나무·벚나무·대나무·
                   덤불·갈대처럼 잎이 있는 것들은 바람에 흔들리는 4프레임을 만들어
                   칸마다 다른 위상으로 재생한다 - 정지 화면이던 숲이 살랑거리기 시작한다. */
                /* 반딧불이·불티·꽃가루처럼 빛나는 입자는 매 프레임 radial gradient를
                   새로 만들면 캔버스에서 가장 비싼 연산 중 하나가 된다. 미리 작은
                   스프라이트로 구워두고 drawImage로 찍기만 한다. */
                this.glowSprites = {};
                const glowDefs = {
                    firefly: ['rgba(220,255,150,1)', 'rgba(180,240,90,0.45)', 'rgba(160,220,60,0)'],
                    ember:   ['rgba(255,220,130,1)', 'rgba(255,140,40,0.5)', 'rgba(255,90,20,0)'],
                    pollen:  ['rgba(255,245,180,0.85)', 'rgba(255,245,180,0.3)', 'rgba(255,245,180,0)'],
                    mote:    ['rgba(200,220,255,0.85)', 'rgba(200,220,255,0.3)', 'rgba(200,220,255,0)']
                };
                Object.keys(glowDefs).forEach(k => {
                    const R = 16;
                    const cv = mk(R * 2, R * 2);
                    const gc = cv.getContext('2d');
                    const g = gc.createRadialGradient(R, R, 0, R, R, R);
                    g.addColorStop(0, glowDefs[k][0]);
                    g.addColorStop(0.38, glowDefs[k][1]);
                    g.addColorStop(1, glowDefs[k][2]);
                    gc.fillStyle = g;
                    gc.fillRect(0, 0, R * 2, R * 2);
                    this.glowSprites[k] = cv;
                });

                this.propArt = {};
                this.PROP_LIFT = 20;
                const propDefs = {
                    tree: 6, pine: 3, boulder: 4, bush: 3, cactus: 2, flowers: 2, stone: 3, charred: 2,
                    bamboo: 3, cherry: 3, stalagmite: 3, pillar: 2, deadtree: 2, cattail: 2, shell: 2, mushroom: 2
                };
                const SWAYING = { tree: 3.0, cherry: 3.0, bamboo: 3.4, bush: 1.6, cattail: 2.6, flowers: 1.4, deadtree: 1.2 };
                this.PROP_SWAY_FRAMES = 4;
                Object.keys(propDefs).forEach(name => {
                    const amp = SWAYING[name] || 0;
                    const frames = amp > 0 ? this.PROP_SWAY_FRAMES : 1;
                    this.propArt[name] = [];
                    for (let i = 0; i < propDefs[name]; i++) {
                        const variantFrames = [];
                        for (let f = 0; f < frames; f++) {
                            const cv = mk(S, S + this.PROP_LIFT);
                            const sway = amp === 0 ? 0 : Math.sin((f / frames) * Math.PI * 2) * amp;
                            this.paintProp(cv.getContext('2d'), name, i, S, S + this.PROP_LIFT, sway);
                            variantFrames.push(cv);
                        }
                        this.propArt[name].push(variantFrames);
                    }
                });
            }

            /* 타일 한 장을 오프스크린 캔버스에 굽는다 (t = 애니메이션 위상 0~1) */
            paintTileArt(ctx, type, variant, t, S) {
                const T = TILE_TYPES;
                const P = FIELD_PALETTE;
                const rng = makeSeededRng(type * 9176 + variant * 733 + 17);
                const TAU = Math.PI * 2;

                const speckle = (color, n, minR, maxR, alpha) => {
                    ctx.fillStyle = color;
                    ctx.globalAlpha = alpha;
                    for (let i = 0; i < n; i++) {
                        const px = rng() * S, py = rng() * S;
                        const rr = minR + rng() * (maxR - minR);
                        ctx.beginPath();
                        ctx.arc(px, py, rr, 0, TAU);
                        ctx.fill();
                    }
                    ctx.globalAlpha = 1;
                };

                switch (type) {
                    case T.GRASS: {
                        ctx.fillStyle = P.grass.base;
                        ctx.fillRect(0, 0, S, S);
                        // 밝고 어두운 잔디 얼룩을 크게 깔아 단색 격자 느낌을 없앤다
                        speckle(P.grass.light, 3, 7, 13, 0.38);
                        speckle(P.grass.dark, 3, 6, 12, 0.30);
                        // 풀 잎맥
                        ctx.strokeStyle = P.grass.deep;
                        ctx.globalAlpha = 0.45;
                        ctx.lineWidth = 1;
                        for (let i = 0; i < 9; i++) {
                            const px = 2 + rng() * (S - 4), py = 5 + rng() * (S - 8);
                            ctx.beginPath();
                            ctx.moveTo(px, py);
                            ctx.quadraticCurveTo(px + 1.5, py - 3, px + (rng() < 0.5 ? -2.5 : 2.5), py - 5.5);
                            ctx.stroke();
                        }
                        ctx.globalAlpha = 1;
                        // 일부 변주에는 작은 조약돌/데이지
                        if (variant === 4) {
                            ctx.fillStyle = 'rgba(255,255,255,0.85)';
                            for (let i = 0; i < 3; i++) {
                                const px = 8 + rng() * 24, py = 8 + rng() * 24;
                                ctx.beginPath(); ctx.arc(px, py, 1.9, 0, TAU); ctx.fill();
                            }
                        }
                        if (variant === 5) {
                            ctx.fillStyle = '#a3b18a';
                            ctx.beginPath(); ctx.ellipse(13, 27, 4, 2.6, 0.3, 0, TAU); ctx.fill();
                            ctx.fillStyle = '#c2cdb2';
                            ctx.beginPath(); ctx.ellipse(12, 26, 2.4, 1.4, 0.3, 0, TAU); ctx.fill();
                        }
                        break;
                    }

                    case T.TALL_GRASS: {
                        // 야생 포켓몬이 튀어나오는 수풀은 한눈에 구분돼야 하므로,
                        // 평원보다 뚜렷하게 어둡고 빽빽하게 그린다.
                        ctx.fillStyle = P.tall.base;
                        ctx.fillRect(0, 0, S, S);
                        speckle(P.tall.bladeDark, 5, 8, 15, 0.45);
                        // 풀숲이 드리우는 그늘 - 위쪽이 어두워 키가 있어 보인다
                        const shade = ctx.createLinearGradient(0, 0, 0, S);
                        shade.addColorStop(0, 'rgba(0,0,0,0.22)');
                        shade.addColorStop(0.45, 'rgba(0,0,0,0.02)');
                        shade.addColorStop(1, 'rgba(0,0,0,0.10)');
                        ctx.fillStyle = shade;
                        ctx.fillRect(0, 0, S, S);
                        // 바람에 흔들리는 풀잎 - t에 따라 끝이 좌우로 스윙한다
                        const sway = Math.sin(t * TAU) * 2.6;
                        for (let i = 0; i < 24; i++) {
                            const bx = 1 + rng() * (S - 2);
                            const by = 10 + rng() * (S - 8);
                            const hgt = 11 + rng() * 11;
                            const phase = rng() * TAU;
                            const off = sway * (0.6 + 0.4 * Math.sin(phase));
                            ctx.strokeStyle = i % 3 === 0 ? P.tall.tip : (i % 3 === 1 ? P.tall.blade : P.tall.bladeDark);
                            ctx.lineWidth = i % 3 === 0 ? 1.2 : 1.8;
                            ctx.lineCap = 'round';
                            ctx.beginPath();
                            ctx.moveTo(bx, by);
                            ctx.quadraticCurveTo(bx + off * 0.5, by - hgt * 0.6, bx + off, by - hgt);
                            ctx.stroke();
                        }
                        ctx.lineCap = 'butt';
                        break;
                    }

                    case T.WATER: {
                        // 예전에는 타일마다 위아래로 어두워지는 세로 그라데이션을 넣어서,
                        // 타일이 맞닿는 줄마다 어두운 띠가 생겨 바다 전체가 가로 줄무늬로
                        // 보였다. 이제 바탕은 평평하게 깔고, 깊이감은 큼직한 얼룩으로만
                        // 준다 - 타일 경계가 완전히 사라진다.
                        ctx.fillStyle = P.water.base;
                        ctx.fillRect(0, 0, S, S);
                        speckle(P.water.deep, 3, 9, 16, 0.30);
                        speckle(P.water.light, 2, 8, 14, 0.22);

                        // 잔물결 - 위치를 무작위로 흩고, 위상이 t에 따라 옆으로 흘러간다.
                        ctx.lineCap = 'round';
                        const waves = [];
                        for (let i = 0; i < 4; i++) waves.push([rng() * S, rng() * S, 9 + rng() * 7, rng()]);
                        waves.forEach(([wx, wy, wlen, ph], i) => {
                            const shift = ((t + ph) % 1) * S;
                            ctx.strokeStyle = i % 2 === 0 ? 'rgba(228,246,255,0.45)' : 'rgba(150,214,245,0.42)';
                            ctx.lineWidth = 1.5;
                            for (let k = -1; k <= 1; k++) {
                                const sx = ((wx + shift) % S) + k * S;
                                ctx.beginPath();
                                ctx.moveTo(sx, wy);
                                ctx.quadraticCurveTo(sx + wlen / 2, wy - 3.2, sx + wlen, wy);
                                ctx.stroke();
                            }
                        });
                        ctx.lineCap = 'butt';

                        // 반짝이는 윤슬
                        const twinkle = 0.22 + 0.5 * Math.abs(Math.sin(t * TAU + variant));
                        ctx.fillStyle = `rgba(255,255,255,${twinkle.toFixed(3)})`;
                        for (let i = 0; i < 3; i++) {
                            const px = 6 + rng() * (S - 12), py = 6 + rng() * (S - 12);
                            ctx.fillRect(px, py, 3.5, 1.2);
                            ctx.fillRect(px + 1.2, py - 1.2, 1.2, 3.5);
                        }
                        break;
                    }

                    case T.SAND: {
                        ctx.fillStyle = P.sand.base;
                        ctx.fillRect(0, 0, S, S);
                        speckle(P.sand.light, 3, 8, 14, 0.42);
                        speckle(P.sand.dark, 3, 7, 12, 0.26);
                        // 바람이 만든 모래 결
                        ctx.strokeStyle = P.sand.dark;
                        ctx.globalAlpha = 0.35;
                        ctx.lineWidth = 1.4;
                        for (let i = 0; i < 4; i++) {
                            const yy = 4 + i * 10 + rng() * 3;
                            ctx.beginPath();
                            ctx.moveTo(-2, yy);
                            ctx.bezierCurveTo(S * 0.3, yy - 3.5, S * 0.7, yy + 3.5, S + 2, yy);
                            ctx.stroke();
                        }
                        ctx.globalAlpha = 1;
                        if (variant % 3 === 0) {
                            ctx.fillStyle = P.sand.rock;
                            for (let i = 0; i < 4; i++) {
                                ctx.beginPath();
                                ctx.arc(5 + rng() * 30, 5 + rng() * 30, 1.3, 0, TAU);
                                ctx.fill();
                            }
                        }
                        break;
                    }

                    case T.SNOW: {
                        ctx.fillStyle = P.snow.base;
                        ctx.fillRect(0, 0, S, S);
                        // 푸른 그림자가 진 눈 두덕
                        speckle(P.snow.dark, 3, 8, 15, 0.55);
                        speckle(P.snow.light, 3, 7, 13, 0.85);
                        ctx.strokeStyle = P.snow.deep;
                        ctx.globalAlpha = 0.30;
                        ctx.lineWidth = 1.6;
                        for (let i = 0; i < 3; i++) {
                            const yy = 8 + i * 12 + rng() * 4;
                            ctx.beginPath();
                            ctx.moveTo(-2, yy);
                            ctx.quadraticCurveTo(S / 2, yy + (i % 2 ? -4 : 4), S + 2, yy);
                            ctx.stroke();
                        }
                        ctx.globalAlpha = 1;
                        // 눈 결정 반짝임
                        ctx.fillStyle = 'rgba(255,255,255,0.95)';
                        for (let i = 0; i < 4; i++) {
                            const px = 4 + rng() * 32, py = 4 + rng() * 32;
                            ctx.fillRect(px, py, 2, 1);
                            ctx.fillRect(px + 0.5, py - 0.5, 1, 2);
                        }
                        break;
                    }

                    case T.VOLCANO: {
                        // 예전에는 모든 칸에 용암 균열을 그려 넣어서, 화산지대 전체가
                        // 주황색 낙서로 뒤덮인 것처럼 보였다. 이제 대부분의 칸은 식어
                        // 굳은 검은 현무암이고, 여덟 칸 중 두 칸 꼴로만 붉게 갈라진
                        // 용암 틈이 드러난다 - 훨씬 무겁고 사실적인 화산지대가 된다.
                        ctx.fillStyle = P.volcano.rock;
                        ctx.fillRect(0, 0, S, S);
                        speckle(P.volcano.dark, 5, 8, 16, 0.6);
                        speckle(P.volcano.ash, 3, 6, 12, 0.28);

                        // 굳은 용암판이 갈라진 결
                        ctx.strokeStyle = 'rgba(15,8,6,0.5)';
                        ctx.lineWidth = 1.3;
                        for (let i = 0; i < 3; i++) {
                            let px = rng() * S, py = rng() * S;
                            ctx.beginPath();
                            ctx.moveTo(px, py);
                            for (let k = 0; k < 3; k++) {
                                px += (rng() - 0.5) * 20;
                                py += (rng() - 0.5) * 20;
                                ctx.lineTo(px, py);
                            }
                            ctx.stroke();
                        }

                        if (variant >= 6) {
                            const pulse = 0.45 + 0.55 * Math.abs(Math.sin(t * TAU));
                            const vertical = (variant % 2) === 0;
                            let px = vertical ? 8 + rng() * (S - 16) : -3;
                            let py = vertical ? -3 : 8 + rng() * (S - 16);
                            const pts = [[px, py]];
                            for (let k = 0; k < 5; k++) {
                                if (vertical) { py += S / 4.2; px += (rng() - 0.5) * 11; }
                                else { px += S / 4.2; py += (rng() - 0.5) * 11; }
                                pts.push([px, py]);
                            }
                            const stroke = (color, width) => {
                                ctx.strokeStyle = color;
                                ctx.lineWidth = width;
                                ctx.beginPath();
                                pts.forEach((pt, i) => i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]));
                                ctx.stroke();
                            };
                            ctx.lineCap = 'round';
                            stroke(`rgba(180,40,10,${(0.40 * pulse).toFixed(3)})`, 8);
                            stroke(`rgba(255,106,43,${(0.70 * pulse).toFixed(3)})`, 4);
                            stroke(`rgba(255,220,120,${(0.92 * pulse).toFixed(3)})`, 1.6);
                            ctx.lineCap = 'butt';

                            ctx.fillStyle = `rgba(255,170,60,${(0.5 * pulse).toFixed(3)})`;
                            for (let i = 0; i < 3; i++) {
                                ctx.beginPath();
                                ctx.arc(4 + rng() * 32, 4 + rng() * 32 - t * 7, 1.3, 0, TAU);
                                ctx.fill();
                            }
                        }
                        break;
                    }

                    case T.FOREST: {
                        // 나무는 별도 오브젝트 레이어에서 그리므로, 여기서는 어둡고
                        // 촉촉한 숲 바닥(낙엽/이끼/뿌리)만 그린다.
                        ctx.fillStyle = P.forest.floor;
                        ctx.fillRect(0, 0, S, S);
                        speckle(P.forest.litter, 4, 7, 14, 0.5);
                        speckle(P.forest.canopyDk, 3, 8, 14, 0.30);
                        // 우거진 잎 사이로 스며드는 빛과 그 사이의 그늘
                        ctx.fillStyle = 'rgba(20,48,24,0.22)';
                        ctx.fillRect(0, 0, S, S);
                        ctx.fillStyle = 'rgba(190,240,170,0.16)';
                        for (let i = 0; i < 3; i++) {
                            ctx.beginPath();
                            ctx.ellipse(rng() * S, rng() * S, 6 + rng() * 6, 4 + rng() * 4, rng() * TAU, 0, TAU);
                            ctx.fill();
                        }
                        ctx.fillStyle = 'rgba(120, 90, 50, 0.32)';
                        for (let i = 0; i < 5; i++) {
                            const px = rng() * S, py = rng() * S;
                            ctx.save();
                            ctx.translate(px, py);
                            ctx.rotate(rng() * TAU);
                            ctx.fillRect(-2.5, -1, 5, 2);
                            ctx.restore();
                        }
                        break;
                    }

                    case T.SWAMP: {
                        // 늪지대 - 탁한 진흙물 + 떠 있는 부유물 + 보글거리는 기포
                        ctx.fillStyle = P.swamp.mud;
                        ctx.fillRect(0, 0, S, S);
                        // 고인 물웅덩이 - 진흙 위에 어둡고 매끈한 물이 고여 있다
                        ctx.fillStyle = P.swamp.base;
                        for (let i = 0; i < 3; i++) {
                            ctx.beginPath();
                            ctx.ellipse(rng() * S, rng() * S, 10 + rng() * 9, 7 + rng() * 6, rng() * TAU, 0, TAU);
                            ctx.fill();
                        }
                        // 물에 비친 하늘빛
                        ctx.globalAlpha = 0.22;
                        ctx.fillStyle = '#9fd0b0';
                        for (let i = 0; i < 2; i++) {
                            ctx.beginPath();
                            ctx.ellipse(rng() * S, rng() * S, 7, 3, rng() * TAU, 0, TAU);
                            ctx.fill();
                        }
                        ctx.globalAlpha = 1;
                        speckle(P.swamp.mud, 3, 7, 13, 0.45);
                        speckle(P.swamp.water, 2, 6, 11, 0.35);
                        // 수면에 낀 초록 부유물
                        ctx.fillStyle = P.swamp.scum;
                        ctx.globalAlpha = 0.5;
                        for (let i = 0; i < 4; i++) {
                            ctx.beginPath();
                            ctx.ellipse(rng() * S, rng() * S, 5 + rng() * 5, 3 + rng() * 3, rng() * TAU, 0, TAU);
                            ctx.fill();
                        }
                        ctx.globalAlpha = 1;
                        // 보글보글 올라오는 기포 (t에 따라 위로 떠오른다)
                        for (let i = 0; i < 4; i++) {
                            const bx = 5 + rng() * (S - 10);
                            const by0 = rng() * S;
                            const by = (by0 - t * 14 + S) % S;
                            const rr = 1.8 + rng() * 2.2;
                            ctx.strokeStyle = P.swamp.bubble;
                            ctx.globalAlpha = 0.75;
                            ctx.lineWidth = 1.2;
                            ctx.beginPath(); ctx.arc(bx, by, rr, 0, TAU); ctx.stroke();
                        }
                        ctx.globalAlpha = 1;
                        break;
                    }

                    case T.BEACH: {
                        // 모래사장 - 밝고 고운 모래 + 젖은 모래띠 + 조개껍질 조각
                        ctx.fillStyle = P.beach.base;
                        ctx.fillRect(0, 0, S, S);
                        speckle(P.beach.light, 3, 8, 14, 0.5);
                        speckle(P.beach.dark, 2, 7, 12, 0.22);
                        ctx.strokeStyle = P.beach.wet;
                        ctx.globalAlpha = 0.35;
                        ctx.lineWidth = 2.2;
                        for (let i = 0; i < 3; i++) {
                            const yy = 6 + i * 13 + rng() * 4;
                            ctx.beginPath();
                            ctx.moveTo(-2, yy);
                            ctx.bezierCurveTo(S * 0.3, yy - 4, S * 0.7, yy + 4, S + 2, yy);
                            ctx.stroke();
                        }
                        ctx.globalAlpha = 1;
                        // 고운 모래알
                        ctx.fillStyle = '#ffffff';
                        for (let i = 0; i < 8; i++) {
                            ctx.globalAlpha = 0.5 + rng() * 0.4;
                            ctx.fillRect(rng() * S, rng() * S, 1.3, 1.3);
                        }
                        ctx.globalAlpha = 1;
                        break;
                    }

                    case T.FLOWER: {
                        // 꽃밭 - 연한 풀밭 위에 알록달록한 꽃송이가 빽빽하게 핀다
                        ctx.fillStyle = P.flower.base;
                        ctx.fillRect(0, 0, S, S);
                        speckle(P.flower.light, 3, 8, 14, 0.4);
                        speckle(P.flower.dark, 2, 7, 12, 0.3);
                        // 풀 결
                        ctx.strokeStyle = P.flower.dark;
                        ctx.globalAlpha = 0.4;
                        ctx.lineWidth = 1;
                        for (let i = 0; i < 8; i++) {
                            const px = rng() * S, py = 6 + rng() * (S - 8);
                            ctx.beginPath();
                            ctx.moveTo(px, py);
                            ctx.lineTo(px + (rng() - 0.5) * 4, py - 5);
                            ctx.stroke();
                        }
                        ctx.globalAlpha = 1;
                        // 꽃송이
                        for (let i = 0; i < 5; i++) {
                            const fx = 4 + rng() * (S - 8), fy = 5 + rng() * (S - 10);
                            const col = P.flower.petal[Math.floor(rng() * P.flower.petal.length)];
                            ctx.strokeStyle = 'rgba(60,120,52,0.8)';
                            ctx.lineWidth = 1;
                            ctx.beginPath(); ctx.moveTo(fx, fy + 4.5); ctx.lineTo(fx, fy); ctx.stroke();
                            ctx.fillStyle = col;
                            for (let k = 0; k < 5; k++) {
                                const a = (k / 5) * TAU + i;
                                ctx.beginPath();
                                ctx.arc(fx + Math.cos(a) * 2.2, fy + Math.sin(a) * 2.2, 1.9, 0, TAU);
                                ctx.fill();
                            }
                            ctx.fillStyle = '#fff3b0';
                            ctx.beginPath(); ctx.arc(fx, fy, 1.4, 0, TAU); ctx.fill();
                        }
                        break;
                    }

                    case T.CAVE: {
                        // 동굴 - 어두운 암반 바닥 + 이끼 + 은은하게 빛나는 결정
                        ctx.fillStyle = P.cave.base;
                        ctx.fillRect(0, 0, S, S);
                        speckle(P.cave.dark, 5, 8, 16, 0.6);
                        speckle(P.cave.light, 2, 6, 11, 0.25);
                        // 천장에서 스며드는 빛 (위쪽이 아주 살짝 밝다)
                        const cg = ctx.createLinearGradient(0, 0, 0, S);
                        cg.addColorStop(0, 'rgba(255,255,255,0.09)');
                        cg.addColorStop(1, 'rgba(0,0,0,0.22)');
                        ctx.fillStyle = cg;
                        ctx.fillRect(0, 0, S, S);
                        // 암반 균열
                        ctx.strokeStyle = '#1a1a22';
                        ctx.globalAlpha = 0.6;
                        ctx.lineWidth = 1.2;
                        for (let i = 0; i < 3; i++) {
                            let px = rng() * S, py = rng() * S;
                            ctx.beginPath(); ctx.moveTo(px, py);
                            for (let k = 0; k < 3; k++) {
                                px += (rng() - 0.5) * 18; py += (rng() - 0.5) * 18;
                                ctx.lineTo(px, py);
                            }
                            ctx.stroke();
                        }
                        ctx.globalAlpha = 1;
                        if (variant % 4 === 0) {
                            // 이끼
                            ctx.fillStyle = P.cave.moss;
                            ctx.globalAlpha = 0.5;
                            ctx.beginPath();
                            ctx.ellipse(8 + rng() * 24, 8 + rng() * 24, 7, 4.5, rng() * TAU, 0, TAU);
                            ctx.fill();
                            ctx.globalAlpha = 1;
                        }
                        if (variant === 7) {
                            // 빛나는 결정 조각 (여덟 칸 중 한 칸에만)
                            const gx = 8 + rng() * 24, gy = 8 + rng() * 24;
                            const glow = 0.45 + 0.55 * Math.abs(Math.sin(t * TAU + variant));
                            ctx.globalAlpha = glow * 0.5;
                            const g2 = ctx.createRadialGradient(gx, gy, 0, gx, gy, 12);
                            g2.addColorStop(0, P.cave.crystal);
                            g2.addColorStop(1, 'rgba(125,211,252,0)');
                            ctx.fillStyle = g2;
                            ctx.beginPath(); ctx.arc(gx, gy, 12, 0, TAU); ctx.fill();
                            ctx.globalAlpha = 1;
                            ctx.fillStyle = P.cave.crystal;
                            ctx.beginPath();
                            ctx.moveTo(gx, gy - 5); ctx.lineTo(gx + 2.6, gy); ctx.lineTo(gx, gy + 5); ctx.lineTo(gx - 2.6, gy);
                            ctx.closePath(); ctx.fill();
                        }
                        break;
                    }

                    case T.RUINS: {
                        // 고대 유적 - 깨진 석판 바닥 + 이끼 + 새겨진 문양
                        ctx.fillStyle = P.ruins.base;
                        ctx.fillRect(0, 0, S, S);
                        speckle(P.ruins.dark, 3, 7, 13, 0.3);
                        speckle(P.ruins.light, 2, 7, 12, 0.35);
                        // 석판 줄눈
                        ctx.strokeStyle = P.ruins.dark;
                        ctx.globalAlpha = 0.55;
                        ctx.lineWidth = 1.4;
                        const off = (variant % 2) * (S / 2);
                        ctx.strokeRect(-0.5 + off, -0.5, S / 2, S / 2);
                        ctx.strokeRect(-0.5 + off, S / 2 - 0.5, S / 2, S / 2);
                        ctx.beginPath();
                        ctx.moveTo(0, S / 2 - 0.5); ctx.lineTo(S, S / 2 - 0.5);
                        ctx.stroke();
                        ctx.globalAlpha = 1;
                        // 이끼
                        ctx.fillStyle = P.ruins.moss;
                        ctx.globalAlpha = 0.4;
                        for (let i = 0; i < 3; i++) {
                            ctx.beginPath();
                            ctx.ellipse(rng() * S, rng() * S, 5 + rng() * 4, 3 + rng() * 3, rng() * TAU, 0, TAU);
                            ctx.fill();
                        }
                        ctx.globalAlpha = 1;
                        if (variant === 3 || variant === 7) {
                            // 바닥에 새겨진 고대 문양 - 변주마다 위치·크기·회전이 다르다
                            const gx = 12 + rng() * 16, gy = 12 + rng() * 16;
                            const gr = 7 + rng() * 4;
                            const rot = rng() * TAU;
                            ctx.save();
                            ctx.translate(gx, gy);
                            ctx.rotate(rot);
                            ctx.strokeStyle = P.ruins.carve;
                            ctx.globalAlpha = 0.65;
                            ctx.lineWidth = 1.6;
                            ctx.beginPath(); ctx.arc(0, 0, gr, 0, TAU); ctx.stroke();
                            ctx.beginPath(); ctx.arc(0, 0, gr * 0.5, 0, TAU); ctx.stroke();
                            const spokes = 3 + (variant % 3);
                            for (let i = 0; i < spokes; i++) {
                                const a = (i / spokes) * TAU;
                                ctx.beginPath();
                                ctx.moveTo(Math.cos(a) * gr * 0.55, Math.sin(a) * gr * 0.55);
                                ctx.lineTo(Math.cos(a) * gr * 1.3, Math.sin(a) * gr * 1.3);
                                ctx.stroke();
                            }
                            ctx.restore();
                            ctx.globalAlpha = 1;
                        }
                        break;
                    }

                    case T.ICE_FIELD: {
                        // 빙판 호수 - 얼어붙은 수면 + 갈라진 금 + 미끄러운 광택
                        ctx.fillStyle = P.ice.base;
                        ctx.fillRect(0, 0, S, S);
                        speckle(P.ice.light, 3, 9, 15, 0.6);
                        speckle(P.ice.dark, 2, 7, 12, 0.3);
                        // 얼음 금
                        ctx.strokeStyle = P.ice.crack;
                        ctx.globalAlpha = 0.5;
                        ctx.lineWidth = 1.2;
                        for (let i = 0; i < 3; i++) {
                            let px = rng() * S, py = rng() * S;
                            ctx.beginPath(); ctx.moveTo(px, py);
                            for (let k = 0; k < 3; k++) {
                                px += (rng() - 0.5) * 22; py += (rng() - 0.5) * 22;
                                ctx.lineTo(px, py);
                            }
                            ctx.stroke();
                        }
                        ctx.globalAlpha = 1;
                        // 미끄러운 하이라이트 (빛이 지나가는 듯한 광택 띠)
                        ctx.save();
                        ctx.globalAlpha = 0.35;
                        ctx.fillStyle = '#ffffff';
                        ctx.translate(20, 20);
                        ctx.rotate(-0.7);
                        ctx.fillRect(-26 + ((t * 40) % 52), -3, 16, 5);
                        ctx.restore();
                        break;
                    }

                    case T.WASTELAND: {
                        // 황무지 - 쩍쩍 갈라진 마른 땅 + 마른 풀 + 잔돌
                        ctx.fillStyle = P.waste.base;
                        ctx.fillRect(0, 0, S, S);
                        speckle(P.waste.dark, 4, 8, 15, 0.4);
                        speckle(P.waste.light, 2, 7, 12, 0.3);
                        // 거북등처럼 갈라진 지면
                        ctx.strokeStyle = P.waste.crack;
                        ctx.globalAlpha = 0.65;
                        ctx.lineWidth = 1.5;
                        const cells = 3;
                        for (let i = 0; i <= cells; i++) {
                            ctx.beginPath();
                            for (let k = 0; k <= 4; k++) {
                                const px = (k / 4) * S;
                                const py = (i / cells) * S + Math.sin(k * 2 + i + variant) * 3;
                                k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
                            }
                            ctx.stroke();
                            ctx.beginPath();
                            for (let k = 0; k <= 4; k++) {
                                const py = (k / 4) * S;
                                const px = (i / cells) * S + Math.sin(k * 2 + i * 1.7 + variant) * 3;
                                k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
                            }
                            ctx.stroke();
                        }
                        ctx.globalAlpha = 1;
                        // 마른 풀 다발
                        if (variant % 2 === 0) {
                            ctx.strokeStyle = '#8a7a4f';
                            ctx.lineWidth = 1.2;
                            const gx = 8 + rng() * 24, gy = 24 + rng() * 10;
                            for (let i = 0; i < 5; i++) {
                                ctx.beginPath();
                                ctx.moveTo(gx, gy);
                                ctx.lineTo(gx + (i - 2) * 3, gy - 8 - rng() * 5);
                                ctx.stroke();
                            }
                        }
                        break;
                    }

                    case T.BAMBOO: {
                        // 대나무 숲 바닥 - 어두운 그늘 + 떨어진 댓잎 (대나무 줄기는 오브젝트 레이어)
                        ctx.fillStyle = P.bamboo.base;
                        ctx.fillRect(0, 0, S, S);
                        speckle('#3a6330', 4, 8, 15, 0.5);
                        speckle(P.bamboo.leaf, 2, 6, 11, 0.28);
                        ctx.fillStyle = '#7fa855';
                        ctx.globalAlpha = 0.55;
                        for (let i = 0; i < 6; i++) {
                            ctx.save();
                            ctx.translate(rng() * S, rng() * S);
                            ctx.rotate(rng() * TAU);
                            ctx.beginPath();
                            ctx.ellipse(0, 0, 6, 1.6, 0, 0, TAU);
                            ctx.fill();
                            ctx.restore();
                        }
                        ctx.globalAlpha = 1;
                        break;
                    }

                    case T.CHERRY: {
                        // 벚꽃 숲 바닥 - 연둣빛 잔디에 떨어져 쌓인 분홍 꽃잎
                        ctx.fillStyle = P.cherry.base;
                        ctx.fillRect(0, 0, S, S);
                        speckle('#a3ca7e', 3, 8, 14, 0.42);
                        speckle('#6f9a4f', 2, 7, 12, 0.28);
                        // 바닥에 깔린 꽃잎
                        for (let i = 0; i < 9; i++) {
                            ctx.save();
                            ctx.translate(rng() * S, rng() * S);
                            ctx.rotate(rng() * TAU);
                            ctx.fillStyle = i % 3 === 0 ? P.cherry.bloomLt : (i % 3 === 1 ? P.cherry.bloom : P.cherry.bloomDk);
                            ctx.globalAlpha = 0.85;
                            ctx.beginPath();
                            ctx.ellipse(0, 0, 3.2, 2, 0, 0, TAU);
                            ctx.fill();
                            ctx.restore();
                        }
                        ctx.globalAlpha = 1;
                        break;
                    }

                    case T.ROCK: {
                        ctx.fillStyle = P.rock.base;
                        ctx.fillRect(0, 0, S, S);
                        speckle(P.rock.light, 3, 7, 13, 0.34);
                        speckle(P.rock.dark, 3, 7, 13, 0.32);
                        // 갈라진 암반 결
                        ctx.strokeStyle = P.rock.crack;
                        ctx.globalAlpha = 0.26;
                        ctx.lineWidth = 1.1;
                        for (let i = 0; i < 3; i++) {
                            let px = rng() * S, py = rng() * S;
                            ctx.beginPath();
                            ctx.moveTo(px, py);
                            for (let k = 0; k < 3; k++) {
                                px += (rng() - 0.5) * 16;
                                py += (rng() - 0.5) * 16;
                                ctx.lineTo(px, py);
                            }
                            ctx.stroke();
                        }
                        ctx.globalAlpha = 1;
                        break;
                    }

                    case T.PATH: {
                        ctx.fillStyle = P.path.base;
                        ctx.fillRect(0, 0, S, S);
                        // 가장자리는 어둡게, 가운데는 밟혀 다져져 밝게
                        const g2 = ctx.createLinearGradient(0, 0, 0, S);
                        g2.addColorStop(0, 'rgba(0,0,0,0.16)');
                        g2.addColorStop(0.5, 'rgba(255,255,255,0.12)');
                        g2.addColorStop(1, 'rgba(0,0,0,0.16)');
                        ctx.fillStyle = g2;
                        ctx.fillRect(0, 0, S, S);
                        speckle(P.path.light, 2, 6, 12, 0.35);
                        speckle(P.path.dark, 2, 6, 11, 0.28);
                        ctx.fillStyle = P.path.pebble;
                        ctx.globalAlpha = 0.65;
                        for (let i = 0; i < 6; i++) {
                            ctx.beginPath();
                            ctx.ellipse(3 + rng() * 34, 3 + rng() * 34, 1.6, 1.1, rng() * TAU, 0, TAU);
                            ctx.fill();
                        }
                        ctx.globalAlpha = 1;
                        break;
                    }
                }
            }

            /* 지형 위에 솟아오르는 오브젝트 한 개를 굽는다. 캔버스 아래쪽이 타일 바닥이고,
               위로 PROP_LIFT(20px)만큼 더 솟아오를 수 있다. */
            paintProp(ctx, name, variant, S, H, sway) {
                sway = sway || 0;
                const P = FIELD_PALETTE;
                const TAU = Math.PI * 2;
                const rng = makeSeededRng(name.length * 8191 + variant * 619 + 3);
                const groundY = H - 6;

                const shadow = (w, h) => {
                    ctx.fillStyle = 'rgba(0,0,0,0.28)';
                    ctx.beginPath();
                    ctx.ellipse(S / 2, groundY + 2, w, h, 0, 0, TAU);
                    ctx.fill();
                };

                if (name === 'tree') {
                    // 변주마다 키·수관 크기·잎 색조가 달라서, 숲이 "복사한 나무 격자"처럼
                    // 보이지 않고 서로 다른 나무가 우거진 것처럼 읽힌다.
                    const scale = [1.0, 0.86, 1.12, 0.94, 1.05, 0.8][variant % 6];
                    const tints = [
                        ['#1f5527', '#2f7a3a', '#4aa855'],
                        ['#1b4a24', '#2a6f34', '#3f9647'],
                        ['#235c2a', '#357f3c', '#54b25e'],
                        ['#1d5326', '#2c7537', '#46a350'],
                        ['#265f2c', '#3a8641', '#5cb965'],
                        ['#1a4a22', '#2b6d33', '#43994c']
                    ][variant % 6];
                    const cx = S / 2 + (variant % 2 ? 1.5 : -1.5);
                    const trunkH = 13 * scale;
                    shadow(12 * scale, 4.5 * scale);
                    ctx.fillStyle = P.forest.trunk;
                    ctx.fillRect(cx - 3 * scale, groundY - trunkH, 6 * scale, trunkH + 1);
                    ctx.fillStyle = 'rgba(0,0,0,0.24)';
                    ctx.fillRect(cx + 0.6 * scale, groundY - trunkH, 2 * scale, trunkH + 1);

                    // 바람에 흔들리는 수관 - 위로 갈수록 더 많이 휜다
                    const blobs = [
                        [cx + sway * 0.7, groundY - (24 * scale), 13 * scale],
                        [cx - 9 * scale + sway * 0.6, groundY - (19 * scale), 9.5 * scale],
                        [cx + 9 * scale + sway * 0.6, groundY - (19 * scale), 9.5 * scale],
                        [cx + (variant % 3 - 1) * 4.5 * scale + sway * 1.1, groundY - (31 * scale), 8.5 * scale]
                    ];
                    ctx.fillStyle = tints[0];
                    blobs.forEach(([bx, by, br]) => { ctx.beginPath(); ctx.arc(bx, by + 1.8, br, 0, TAU); ctx.fill(); });
                    ctx.fillStyle = tints[1];
                    blobs.forEach(([bx, by, br]) => { ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill(); });
                    ctx.fillStyle = tints[2];
                    ctx.globalAlpha = 0.8;
                    blobs.forEach(([bx, by, br]) => { ctx.beginPath(); ctx.arc(bx - br * 0.32, by - br * 0.4, br * 0.46, 0, TAU); ctx.fill(); });
                    ctx.globalAlpha = 1;
                    ctx.strokeStyle = 'rgba(18,54,24,0.32)';
                    ctx.lineWidth = 1;
                    for (let i = 0; i < 8; i++) {
                        const ax = cx - 13 + rng() * 26, ay = groundY - 34 * scale + rng() * 20;
                        ctx.beginPath();
                        ctx.moveTo(ax, ay);
                        ctx.lineTo(ax + 3, ay + 3);
                        ctx.stroke();
                    }
                    return;
                }

                if (name === 'pine') {
                    shadow(10, 4);
                    ctx.fillStyle = '#5b3d1f';
                    ctx.fillRect(S / 2 - 2.5, groundY - 8, 5, 9);
                    const tiers = [[groundY - 8, 13], [groundY - 17, 10.5], [groundY - 25, 8]];
                    tiers.forEach(([ty, tw], i) => {
                        ctx.fillStyle = i === 0 ? '#1f5527' : (i === 1 ? '#25632e' : '#2b7135');
                        ctx.beginPath();
                        ctx.moveTo(S / 2, ty - 13);
                        ctx.lineTo(S / 2 - tw, ty);
                        ctx.lineTo(S / 2 + tw, ty);
                        ctx.closePath();
                        ctx.fill();
                        // 가지에 쌓인 눈
                        ctx.fillStyle = 'rgba(255,255,255,0.92)';
                        ctx.beginPath();
                        ctx.moveTo(S / 2, ty - 13);
                        ctx.lineTo(S / 2 - tw * 0.62, ty - 4.5);
                        ctx.lineTo(S / 2 - tw * 0.2, ty - 6);
                        ctx.lineTo(S / 2 + tw * 0.34, ty - 3.4);
                        ctx.lineTo(S / 2 + tw * 0.62, ty - 4.5);
                        ctx.closePath();
                        ctx.fill();
                    });
                    return;
                }

                if (name === 'boulder') {
                    // 위쪽(햇빛)과 아래쪽(그늘)의 명암 차를 크게 줘 납작한 회색 도형이 아니라
                    // 실제로 땅에 박힌 덩어리처럼 보이게 한다. 변주마다 크기 차이도 크게 둔다.
                    const sc = [0.78, 1.0, 1.28, 1.55][variant % 4];
                    const w = 11 * sc, h = 9 * sc;
                    const cx = S / 2, cy = groundY - h * 0.75;

                    ctx.fillStyle = 'rgba(0,0,0,0.30)';
                    ctx.beginPath();
                    ctx.ellipse(cx + 1.5, groundY + 1, w * 1.05, h * 0.42, 0, 0, TAU);
                    ctx.fill();

                    const pts = [];
                    const n = 9;
                    for (let i = 0; i < n; i++) {
                        const a = (i / n) * TAU - Math.PI / 2;
                        const rr = 0.8 + rng() * 0.3;
                        pts.push([cx + Math.cos(a) * w * rr, cy + Math.sin(a) * h * rr * 1.15]);
                    }
                    const path = () => {
                        ctx.beginPath();
                        pts.forEach((pt, i) => i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]));
                        ctx.closePath();
                    };

                    path();
                    ctx.fillStyle = P.rock.dark;
                    ctx.fill();

                    ctx.save();
                    path();
                    ctx.clip();
                    // 위 절반은 밝은 면
                    const gg = ctx.createLinearGradient(cx - w, cy - h, cx + w, cy + h);
                    gg.addColorStop(0, P.rock.light);
                    gg.addColorStop(0.45, P.rock.base);
                    gg.addColorStop(1, P.rock.dark);
                    ctx.fillStyle = gg;
                    ctx.fillRect(cx - w * 1.4, cy - h * 1.6, w * 2.8, h * 3.2);
                    // 정수리 하이라이트
                    ctx.fillStyle = 'rgba(255,255,255,0.32)';
                    ctx.beginPath();
                    ctx.ellipse(cx - w * 0.3, cy - h * 0.48, w * 0.5, h * 0.34, -0.4, 0, TAU);
                    ctx.fill();
                    // 아래쪽 그늘
                    ctx.fillStyle = 'rgba(20,26,36,0.36)';
                    ctx.beginPath();
                    ctx.ellipse(cx + w * 0.25, cy + h * 0.72, w * 0.95, h * 0.55, 0, 0, TAU);
                    ctx.fill();
                    // 결
                    ctx.strokeStyle = P.rock.crack;
                    ctx.globalAlpha = 0.55;
                    ctx.lineWidth = 1.2 * sc;
                    ctx.beginPath();
                    ctx.moveTo(cx - w * 0.45, cy + h * 0.1);
                    ctx.lineTo(cx - w * 0.05, cy - h * 0.3);
                    ctx.lineTo(cx + w * 0.42, cy + h * 0.28);
                    ctx.stroke();
                    ctx.globalAlpha = 1;
                    ctx.restore();

                    path();
                    ctx.strokeStyle = 'rgba(28,34,44,0.62)';
                    ctx.lineWidth = 1.4;
                    ctx.stroke();
                    return;
                }

                if (name === 'bush') {
                    shadow(9, 3.4);
                    const blobs = [[S / 2 - 5 + sway * 0.8, groundY - 6, 6.5], [S / 2 + 5 + sway * 0.8, groundY - 6, 6], [S / 2 + sway, groundY - 10, 7.5]];
                    ctx.fillStyle = '#245c2d';
                    blobs.forEach(([bx, by, br]) => { ctx.beginPath(); ctx.arc(bx, by + 1, br, 0, TAU); ctx.fill(); });
                    ctx.fillStyle = variant ? '#3d8a38' : '#347c33';
                    blobs.forEach(([bx, by, br]) => { ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill(); });
                    ctx.fillStyle = 'rgba(120,200,110,0.65)';
                    blobs.forEach(([bx, by, br]) => { ctx.beginPath(); ctx.arc(bx - br * 0.3, by - br * 0.35, br * 0.4, 0, TAU); ctx.fill(); });
                    if (variant === 1) {
                        ctx.fillStyle = '#e4473c';
                        for (let i = 0; i < 3; i++) {
                            ctx.beginPath();
                            ctx.arc(S / 2 - 6 + rng() * 12, groundY - 11 + rng() * 8, 1.7, 0, TAU);
                            ctx.fill();
                        }
                    }
                    return;
                }

                if (name === 'cactus') {
                    shadow(8, 3.2);
                    ctx.fillStyle = '#3f7a45';
                    ctx.beginPath();
                    ctx.roundRect ? ctx.roundRect(S / 2 - 4, groundY - 22, 8, 23, 4) : ctx.rect(S / 2 - 4, groundY - 22, 8, 23);
                    ctx.fill();
                    if (variant === 0) {
                        ctx.beginPath();
                        ctx.roundRect ? ctx.roundRect(S / 2 - 12, groundY - 16, 8, 4, 2) : ctx.rect(S / 2 - 12, groundY - 16, 8, 4);
                        ctx.fill();
                        ctx.beginPath();
                        ctx.roundRect ? ctx.roundRect(S / 2 - 12, groundY - 16, 4, 9, 2) : ctx.rect(S / 2 - 12, groundY - 16, 4, 9);
                        ctx.fill();
                    } else {
                        ctx.beginPath();
                        ctx.roundRect ? ctx.roundRect(S / 2 + 4, groundY - 18, 8, 4, 2) : ctx.rect(S / 2 + 4, groundY - 18, 8, 4);
                        ctx.fill();
                        ctx.beginPath();
                        ctx.roundRect ? ctx.roundRect(S / 2 + 8, groundY - 18, 4, 10, 2) : ctx.rect(S / 2 + 8, groundY - 18, 4, 10);
                        ctx.fill();
                    }
                    ctx.fillStyle = 'rgba(160,220,150,0.55)';
                    ctx.fillRect(S / 2 - 2.5, groundY - 20, 2, 19);
                    ctx.strokeStyle = 'rgba(240,255,230,0.55)';
                    ctx.lineWidth = 1;
                    for (let i = 0; i < 4; i++) {
                        const yy = groundY - 19 + i * 5;
                        ctx.beginPath(); ctx.moveTo(S / 2 - 5, yy); ctx.lineTo(S / 2 - 7, yy - 1.5); ctx.stroke();
                        ctx.beginPath(); ctx.moveTo(S / 2 + 5, yy); ctx.lineTo(S / 2 + 7, yy - 1.5); ctx.stroke();
                    }
                    return;
                }

                if (name === 'bamboo') {
                    // 대나무 - 곧게 솟은 줄기 + 마디 + 잎사귀
                    shadow(7, 2.8);
                    const stalks = variant === 0 ? [[-8, 0.9], [0, 1.1], [9, 0.85]] : (variant === 1 ? [[-5, 1.0], [6, 0.92]] : [[0, 1.15], [-11, 0.8], [10, 0.75]]);
                    stalks.forEach(([ox, sc], si) => {
                        const bx = S / 2 + ox;
                        const bh = 46 * sc;
                        // 아래는 고정, 위로 갈수록 휘어지도록 기울여 그린다
                        ctx.save();
                        ctx.translate(bx, groundY);
                        ctx.transform(1, 0, -(sway * 0.02), 1, 0, 0);
                        ctx.translate(-bx, -groundY);
                        ctx.fillStyle = si % 2 ? P.bamboo.stalkDk : P.bamboo.stalk;
                        ctx.fillRect(bx - 3 * sc, groundY - bh, 6 * sc, bh);
                        ctx.fillStyle = 'rgba(0,0,0,0.20)';
                        ctx.fillRect(bx + 1 * sc, groundY - bh, 2 * sc, bh);
                        // 마디
                        ctx.fillStyle = '#3f6b28';
                        for (let k = 1; k <= 4; k++) {
                            ctx.fillRect(bx - 3.6 * sc, groundY - (bh / 5) * k, 7.2 * sc, 1.6);
                        }
                        // 잎
                        ctx.fillStyle = P.bamboo.leaf;
                        for (let k = 0; k < 3; k++) {
                            const ly = groundY - bh + 4 + k * 9;
                            const dir = (k + si) % 2 ? 1 : -1;
                            ctx.save();
                            ctx.translate(bx + dir * 3, ly);
                            ctx.rotate(dir * 0.55);
                            ctx.beginPath();
                            ctx.ellipse(dir * 7, 0, 8, 2.4, 0, 0, TAU);
                            ctx.fill();
                            ctx.restore();
                        }
                        ctx.restore();
                    });
                    return;
                }

                if (name === 'cherry') {
                    // 벚나무 - 굵은 줄기 + 분홍 꽃 구름 + 흩날리는 꽃잎
                    const sc = [1.0, 0.86, 1.12][variant % 3];
                    shadow(13 * sc, 4.6 * sc);
                    ctx.fillStyle = P.cherry.trunk;
                    ctx.fillRect(S / 2 - 3.4 * sc, groundY - 15 * sc, 6.8 * sc, 15 * sc + 1);
                    ctx.fillStyle = 'rgba(0,0,0,0.25)';
                    ctx.fillRect(S / 2 + 0.8 * sc, groundY - 15 * sc, 2.2 * sc, 15 * sc + 1);
                    // 가지
                    ctx.strokeStyle = P.cherry.trunk;
                    ctx.lineWidth = 2.4 * sc;
                    ctx.beginPath();
                    ctx.moveTo(S / 2, groundY - 12 * sc); ctx.lineTo(S / 2 - 9 * sc, groundY - 20 * sc);
                    ctx.moveTo(S / 2, groundY - 12 * sc); ctx.lineTo(S / 2 + 9 * sc, groundY - 20 * sc);
                    ctx.stroke();
                    const blobs = [
                        [S / 2 + sway * 0.7, groundY - 26 * sc, 13 * sc],
                        [S / 2 - 10 * sc + sway * 0.6, groundY - 21 * sc, 9 * sc],
                        [S / 2 + 10 * sc + sway * 0.6, groundY - 21 * sc, 9 * sc],
                        [S / 2 + (variant % 3 - 1) * 4 + sway * 1.1, groundY - 33 * sc, 8 * sc]
                    ];
                    ctx.fillStyle = P.cherry.bloomDk;
                    blobs.forEach(([bx, by, br]) => { ctx.beginPath(); ctx.arc(bx, by + 1.8, br, 0, TAU); ctx.fill(); });
                    ctx.fillStyle = P.cherry.bloom;
                    blobs.forEach(([bx, by, br]) => { ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill(); });
                    ctx.fillStyle = P.cherry.bloomLt;
                    ctx.globalAlpha = 0.85;
                    blobs.forEach(([bx, by, br]) => { ctx.beginPath(); ctx.arc(bx - br * 0.3, by - br * 0.38, br * 0.44, 0, TAU); ctx.fill(); });
                    ctx.globalAlpha = 1;
                    // 흩날리는 꽃잎
                    ctx.fillStyle = P.cherry.bloomLt;
                    for (let i = 0; i < 5; i++) {
                        ctx.save();
                        ctx.translate(S / 2 - 16 + rng() * 32, groundY - 34 * sc + rng() * 30);
                        ctx.rotate(rng() * TAU);
                        ctx.beginPath(); ctx.ellipse(0, 0, 3, 1.8, 0, 0, TAU); ctx.fill();
                        ctx.restore();
                    }
                    return;
                }

                if (name === 'stalagmite') {
                    // 석순 - 동굴 바닥에서 솟은 뾰족한 바위
                    shadow(8, 3);
                    const h = [20, 28, 15][variant % 3];
                    const w = [8, 10, 6][variant % 3];
                    const g = ctx.createLinearGradient(S / 2 - w, groundY - h, S / 2 + w, groundY);
                    g.addColorStop(0, '#8a8a99');
                    g.addColorStop(0.5, '#5c5c68');
                    g.addColorStop(1, '#33333d');
                    ctx.fillStyle = g;
                    ctx.beginPath();
                    ctx.moveTo(S / 2, groundY - h);
                    ctx.lineTo(S / 2 + w, groundY + 1);
                    ctx.lineTo(S / 2 - w, groundY + 1);
                    ctx.closePath();
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(20,20,28,0.6)';
                    ctx.lineWidth = 1.2;
                    ctx.stroke();
                    ctx.fillStyle = 'rgba(255,255,255,0.28)';
                    ctx.beginPath();
                    ctx.moveTo(S / 2 - 1, groundY - h + 2);
                    ctx.lineTo(S / 2 + 2, groundY - 2);
                    ctx.lineTo(S / 2 - 3, groundY - 2);
                    ctx.closePath();
                    ctx.fill();
                    return;
                }

                if (name === 'pillar') {
                    // 무너진 고대 석주
                    shadow(10, 3.6);
                    const broken = variant % 2 === 1;
                    const h = broken ? 20 : 36;
                    ctx.fillStyle = '#c2baa4';
                    ctx.fillRect(S / 2 - 7, groundY - h, 14, h + 1);
                    ctx.fillStyle = 'rgba(0,0,0,0.22)';
                    ctx.fillRect(S / 2 + 2, groundY - h, 5, h + 1);
                    // 홈(플루팅)
                    ctx.strokeStyle = 'rgba(110,104,86,0.7)';
                    ctx.lineWidth = 1;
                    for (let i = 0; i < 3; i++) {
                        ctx.beginPath();
                        ctx.moveTo(S / 2 - 4 + i * 4, groundY - h + 3);
                        ctx.lineTo(S / 2 - 4 + i * 4, groundY - 2);
                        ctx.stroke();
                    }
                    // 주초 / 주두
                    ctx.fillStyle = '#9b9481';
                    ctx.fillRect(S / 2 - 10, groundY - 4, 20, 5);
                    if (!broken) ctx.fillRect(S / 2 - 10, groundY - h - 4, 20, 5);
                    else {
                        // 부러진 단면
                        ctx.fillStyle = '#7d765f';
                        ctx.beginPath();
                        ctx.moveTo(S / 2 - 7, groundY - h);
                        ctx.lineTo(S / 2 - 1, groundY - h - 4);
                        ctx.lineTo(S / 2 + 7, groundY - h + 1);
                        ctx.closePath(); ctx.fill();
                    }
                    ctx.fillStyle = 'rgba(107,143,79,0.5)';
                    ctx.beginPath(); ctx.ellipse(S / 2 - 4, groundY - 8, 5, 3, 0.3, 0, TAU); ctx.fill();
                    return;
                }

                if (name === 'deadtree') {
                    // 황무지의 말라죽은 나무
                    shadow(9, 3.2);
                    ctx.strokeStyle = '#6b5a43';
                    ctx.lineCap = 'round';
                    ctx.lineWidth = 5;
                    ctx.beginPath();
                    ctx.moveTo(S / 2, groundY);
                    ctx.lineTo(S / 2 + (variant ? 2 : -2), groundY - 26);
                    ctx.stroke();
                    ctx.lineWidth = 2.6;
                    const branches = variant ? [[-12, -34, -1], [11, -30, 2], [-7, -22, -1]] : [[12, -32, 1], [-11, -28, -2], [6, -20, 1]];
                    branches.forEach(([bx, by, tip]) => {
                        ctx.beginPath();
                        ctx.moveTo(S / 2, groundY - 20);
                        ctx.quadraticCurveTo(S / 2 + bx * 0.5, groundY + by * 0.6, S / 2 + bx, groundY + by);
                        ctx.stroke();
                        ctx.lineWidth = 1.6;
                        ctx.beginPath();
                        ctx.moveTo(S / 2 + bx, groundY + by);
                        ctx.lineTo(S / 2 + bx + tip * 4, groundY + by - 6);
                        ctx.stroke();
                        ctx.lineWidth = 2.6;
                    });
                    ctx.lineCap = 'butt';
                    return;
                }

                if (name === 'cattail') {
                    // 늪지의 갈대
                    ctx.strokeStyle = '#6f8f52';
                    ctx.lineWidth = 1.6;
                    ctx.lineCap = 'round';
                    const n = 4 + variant;
                    for (let i = 0; i < n; i++) {
                        const bx = S / 2 - 12 + (i / (n - 1)) * 24;
                        const h = 16 + rng() * 14;
                        ctx.beginPath();
                        ctx.moveTo(bx, groundY);
                        ctx.quadraticCurveTo(bx + 3 + sway * 0.4, groundY - h * 0.6, bx + (i % 2 ? 5 : -5) + sway, groundY - h);
                        ctx.stroke();
                        if (i % 2 === 0) {
                            ctx.fillStyle = '#7a5a33';
                            ctx.beginPath();
                            ctx.ellipse(bx + (i % 2 ? 5 : -5), groundY - h + 3, 2, 5, 0, 0, TAU);
                            ctx.fill();
                        }
                    }
                    ctx.lineCap = 'butt';
                    return;
                }

                if (name === 'shell') {
                    // 해변의 조개껍질 / 불가사리
                    ctx.fillStyle = 'rgba(0,0,0,0.18)';
                    ctx.beginPath(); ctx.ellipse(S / 2 + 1, groundY + 1, 7, 2.6, 0, 0, TAU); ctx.fill();
                    if (variant === 0) {
                        ctx.fillStyle = '#ffe9ef';
                        ctx.strokeStyle = '#e4a8bc';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(S / 2, groundY);
                        ctx.arc(S / 2, groundY, 8, Math.PI, 0);
                        ctx.closePath();
                        ctx.fill(); ctx.stroke();
                        for (let i = 0; i < 4; i++) {
                            ctx.beginPath();
                            ctx.moveTo(S / 2, groundY);
                            const a = Math.PI + (i + 1) * (Math.PI / 5);
                            ctx.lineTo(S / 2 + Math.cos(a) * 8, groundY + Math.sin(a) * 8);
                            ctx.stroke();
                        }
                    } else {
                        ctx.fillStyle = '#f9a03f';
                        ctx.beginPath();
                        for (let i = 0; i < 10; i++) {
                            const a = (i / 10) * TAU - Math.PI / 2;
                            const rr = i % 2 ? 3.2 : 8;
                            const px = S / 2 + Math.cos(a) * rr, py = groundY - 2 + Math.sin(a) * rr * 0.8;
                            i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
                        }
                        ctx.closePath(); ctx.fill();
                        ctx.fillStyle = '#ffd7a8';
                        ctx.beginPath(); ctx.arc(S / 2, groundY - 2, 2.2, 0, TAU); ctx.fill();
                    }
                    return;
                }

                if (name === 'mushroom') {
                    // 숲/동굴의 버섯 무리
                    ctx.fillStyle = 'rgba(0,0,0,0.2)';
                    ctx.beginPath(); ctx.ellipse(S / 2 + 1, groundY + 1, 8, 2.6, 0, 0, TAU); ctx.fill();
                    const caps = [[-6, 0, 0.9], [5, -2, 1.1], [0, 2, 0.75]];
                    caps.forEach(([ox, oy, sc], i) => {
                        const mx = S / 2 + ox, my = groundY + oy;
                        ctx.fillStyle = '#f5ecd8';
                        ctx.fillRect(mx - 2 * sc, my - 8 * sc, 4 * sc, 8 * sc);
                        ctx.fillStyle = variant === 0 ? '#e0483c' : '#9b6bd6';
                        ctx.beginPath();
                        ctx.ellipse(mx, my - 8 * sc, 7 * sc, 5 * sc, 0, Math.PI, 0);
                        ctx.closePath(); ctx.fill();
                        ctx.fillStyle = '#fff6e6';
                        for (let k = 0; k < 3; k++) {
                            ctx.beginPath();
                            ctx.arc(mx - 3.5 * sc + k * 3.5 * sc, my - 9.5 * sc + (k % 2) * 1.6, 1.2 * sc, 0, TAU);
                            ctx.fill();
                        }
                    });
                    return;
                }

                if (name === 'flowers') {
                    const colors = variant === 0 ? ['#f6d365', '#ffffff', '#f59fd0'] : ['#7fb3ff', '#ffffff', '#c79bf2'];
                    for (let i = 0; i < 6; i++) {
                        const fx = 7 + rng() * 26, fy = groundY - 2 - rng() * 14;
                        ctx.strokeStyle = 'rgba(52,110,48,0.8)';
                        ctx.lineWidth = 1;
                        ctx.beginPath(); ctx.moveTo(fx, fy + 4); ctx.lineTo(fx + sway, fy); ctx.stroke();
                        ctx.fillStyle = colors[i % colors.length];
                        for (let k = 0; k < 4; k++) {
                            const a = (k / 4) * TAU;
                            ctx.beginPath();
                            ctx.arc(fx + Math.cos(a) * 1.7, fy + Math.sin(a) * 1.7, 1.5, 0, TAU);
                            ctx.fill();
                        }
                        ctx.fillStyle = '#fff3b0';
                        ctx.beginPath(); ctx.arc(fx, fy, 1.1, 0, TAU); ctx.fill();
                    }
                    return;
                }

                if (name === 'stone') {
                    shadow(7, 2.6);
                    ctx.fillStyle = P.rock.dark;
                    ctx.beginPath(); ctx.ellipse(S / 2, groundY - 3, 7 + variant, 5 + variant * 0.6, 0, 0, TAU); ctx.fill();
                    ctx.fillStyle = P.rock.base;
                    ctx.beginPath(); ctx.ellipse(S / 2, groundY - 4, 6.2 + variant, 4.2 + variant * 0.6, 0, 0, TAU); ctx.fill();
                    ctx.fillStyle = P.rock.light;
                    ctx.beginPath(); ctx.ellipse(S / 2 - 2, groundY - 5.5, 3, 2, -0.3, 0, TAU); ctx.fill();
                    return;
                }

                if (name === 'charred') {
                    shadow(9, 3.2);
                    ctx.fillStyle = '#20110e';
                    ctx.beginPath();
                    ctx.moveTo(S / 2 - 9, groundY);
                    ctx.lineTo(S / 2 - 5, groundY - 13);
                    ctx.lineTo(S / 2 + 2, groundY - 16);
                    ctx.lineTo(S / 2 + 8, groundY - 5);
                    ctx.lineTo(S / 2 + 9, groundY);
                    ctx.closePath();
                    ctx.fill();
                    ctx.fillStyle = 'rgba(255,120,40,0.55)';
                    ctx.beginPath(); ctx.ellipse(S / 2 + 1, groundY - 3, 5, 2.2, 0, 0, TAU); ctx.fill();
                    ctx.fillStyle = 'rgba(255,205,90,0.7)';
                    ctx.beginPath(); ctx.arc(S / 2 + 1, groundY - 3.5, 1.6, 0, TAU); ctx.fill();
                    return;
                }
            }

            /* 좌표 해시 - 같은 칸은 언제나 같은 변주/오브젝트를 쓰므로 화면이 깜빡이지 않는다 */
            tileHash(r, c) {
                let h = (r * 73856093) ^ (c * 19349663);
                h = (h ^ (h >>> 13)) >>> 0;
                return h;
            }

            /* 이 칸에 놓일 오브젝트(나무/바위/꽃 등)를 결정한다. 없으면 null */
            getTileProp(tileType, r, c) {
                const T = TILE_TYPES;
                const h = this.tileHash(r, c);
                switch (tileType) {
                    case T.FOREST:
                        if (h % 23 === 0) return { name: 'mushroom', v: 0 };
                        return (h % 11 === 0) ? { name: 'bush', v: h % 2 } : { name: 'tree', v: h % 6 };
                    case T.ROCK:
                        // 예전엔 60%의 칸에 똑같은 바위가 놓여 자갈밭이 바둑판처럼 보였다.
                        // 큰 바위는 드물게, 작은 돌은 조금 더 자주 - 사이사이 맨 암반이
                        // 드러나도록 밀도를 낮춘다.
                        if (h % 7 === 0) return { name: 'boulder', v: h % 4 };
                        if (h % 7 === 3) return { name: 'stone', v: h % 3 };
                        return null;
                    case T.GRASS:
                        if (h % 17 === 0) return { name: 'bush', v: h % 2 };
                        if (h % 13 === 0) return { name: 'flowers', v: h % 2 };
                        if (h % 29 === 0) return { name: 'stone', v: 0 };
                        return null;
                    case T.TALL_GRASS:
                        return (h % 19 === 0) ? { name: 'bush', v: 0 } : null;
                    case T.BAMBOO:
                        return (h % 3 !== 2) ? { name: 'bamboo', v: h % 3 } : null;
                    case T.CHERRY:
                        if (h % 4 === 0) return { name: 'cherry', v: h % 3 };
                        if (h % 13 === 0) return { name: 'bush', v: h % 3 };
                        return null;
                    case T.CAVE:
                        if (h % 6 === 0) return { name: 'stalagmite', v: h % 3 };
                        if (h % 11 === 0) return { name: 'mushroom', v: 1 };
                        if (h % 9 === 0) return { name: 'stone', v: h % 3 };
                        return null;
                    case T.RUINS:
                        if (h % 7 === 0) return { name: 'pillar', v: h % 2 };
                        if (h % 12 === 0) return { name: 'stone', v: h % 3 };
                        return null;
                    case T.SWAMP:
                        if (h % 5 === 0) return { name: 'cattail', v: h % 2 };
                        if (h % 17 === 0) return { name: 'deadtree', v: h % 2 };
                        return null;
                    case T.BEACH:
                        if (h % 12 === 0) return { name: 'shell', v: h % 2 };
                        if (h % 21 === 0) return { name: 'stone', v: 0 };
                        return null;
                    case T.WASTELAND:
                        if (h % 13 === 0) return { name: 'deadtree', v: h % 2 };
                        if (h % 8 === 0) return { name: 'stone', v: h % 3 };
                        return null;
                    case T.ICE_FIELD:
                        return (h % 19 === 0) ? { name: 'stone', v: 0 } : null;
                    case T.FLOWER:
                        if (h % 5 === 0) return { name: 'flowers', v: h % 2 };
                        if (h % 16 === 0) return { name: 'bush', v: h % 3 };
                        return null;
                    case T.TOWN: {
                        // 도로/집 칸을 뺀 나머지 마당에만 가로수와 관목을 심는다
                        if ((r % 5) === 0 || (c % 6) === 0) return null;
                        if ((r % 5) === 2 && (c % 3) === 1) return null;
                        const k = h % 10;
                        if (k < 2) return { name: 'tree', v: h % 6 };
                        if (k === 2) return { name: 'bush', v: h % 3 };
                        return null;
                    }
                    case T.SAND:
                        if (h % 14 === 0) return { name: 'cactus', v: h % 2 };
                        if (h % 9 === 0) return { name: 'stone', v: h % 2 };
                        return null;
                    case T.SNOW:
                        if (h % 8 === 0) return { name: 'pine', v: h % 2 };
                        if (h % 17 === 0) return { name: 'stone', v: 0 };
                        return null;
                    case T.VOLCANO:
                        if (h % 9 === 0) return { name: 'charred', v: h % 2 };
                        return null;
                    default:
                        return null;
                }
            }

            /* 인접한 다른 지형과 맞닿은 면을 부드럽게 이어준다.
               예전에는 검은 반투명 막대를 덧대서 오히려 경계가 더 도드라졌는데,
               이제는 이웃 지형의 색을 물결치듯 번지게 깔아 자연스럽게 섞이고,
               물가에는 젖은 모래와 하얀 포말까지 그려 실제 해안선처럼 보이게 한다. */
            drawFieldTransition(x, y, r, c, tileType) {
                const T = TILE_TYPES;
                const ctx = this.ctx;
                const cat = getTileCategory(tileType);
                if (cat === 'structure') return;

                const S = TILE_SIZE;
                const sides = [
                    [r - 1, c, 0], [r + 1, c, 1], [r, c - 1, 2], [r, c + 1, 3]
                ];

                for (const [nr, nc, side] of sides) {
                    if (nr < 0 || nc < 0 || nr >= MAP_ROWS || nc >= MAP_COLS) continue;
                    const nTile = this.worldMap[nr][nc];
                    const nCat = getTileCategory(nTile);
                    if (nCat === cat || nCat === 'structure') continue;

                    const isShore = (cat === 'water') !== (nCat === 'water');
                    const color = TILE_COLORS[nTile] || '#000000';
                    const h = this.tileHash(nr * 7 + r, nc * 11 + c);

                    // 우선순위가 높은 지형만 이웃 위로 번진다 (양쪽에서 서로 덮어쓰면
                    // 한 칸짜리 지형지물이 통째로 뭉개져 버린다).
                    // [버그 수정] 평원/수풀/꽃밭/벚꽃숲은 우선순위가 4로 같아서 어느 쪽도
                    // 번지지 않았고, 그 결과 꽃밭과 평원이 맞닿는 곳이 자로 그은 듯한
                    // 직선으로 뚝 끊겨 보였다. 우선순위가 같을 때는 이름 순으로 한쪽을
                    // 정해 항상 한 방향으로만 번지게 한다.
                    const myPri = TILE_BLEND_PRIORITY[cat] || 0;
                    const nPri = TILE_BLEND_PRIORITY[nCat] || 0;
                    const spreads = nPri > myPri || (nPri === myPri && nCat > cat);
                    if (spreads) {
                        ctx.save();
                        ctx.globalAlpha = isShore ? 0.5 : 0.36;
                        ctx.fillStyle = color;
                        for (let i = 0; i < 6; i++) {
                            const t = (i + 0.5) / 6;
                            const depth = ((h >> (i * 3)) % 5);
                            const rad = 3.5 + ((h >> (i * 2)) % 3);
                            let px, py;
                            if (side === 0) { px = x + t * S; py = y + depth - 2; }
                            else if (side === 1) { px = x + t * S; py = y + S - depth + 2; }
                            else if (side === 2) { px = x + depth - 2; py = y + t * S; }
                            else { px = x + S - depth + 2; py = y + t * S; }
                            ctx.beginPath();
                            ctx.arc(px, py, rad, 0, Math.PI * 2);
                            ctx.fill();
                        }
                        ctx.restore();
                    }

                    // 물가 포말 - 물 타일 쪽에만 흰 파도선을 그린다
                    if (isShore && cat === 'water') {
                        const foamPhase = Math.sin(performance.now() / 420 + (r + c)) * 1.6;
                        ctx.save();
                        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
                        ctx.lineWidth = 2;
                        ctx.lineCap = 'round';
                        ctx.beginPath();
                        if (side === 0) { ctx.moveTo(x + 2, y + 4 + foamPhase); ctx.quadraticCurveTo(x + S / 2, y + 1 + foamPhase, x + S - 2, y + 4 + foamPhase); }
                        else if (side === 1) { ctx.moveTo(x + 2, y + S - 4 - foamPhase); ctx.quadraticCurveTo(x + S / 2, y + S - 1 - foamPhase, x + S - 2, y + S - 4 - foamPhase); }
                        else if (side === 2) { ctx.moveTo(x + 4 + foamPhase, y + 2); ctx.quadraticCurveTo(x + 1 + foamPhase, y + S / 2, x + 4 + foamPhase, y + S - 2); }
                        else { ctx.moveTo(x + S - 4 - foamPhase, y + 2); ctx.quadraticCurveTo(x + S - 1 - foamPhase, y + S / 2, x + S - 4 - foamPhase, y + S - 2); }
                        ctx.stroke();
                        ctx.restore();
                    }
                }

                // 수풀 가장자리 - 네모난 경계 대신 풀 뭉치가 삐져나온 듯한 외곽선을 만든다
                if (tileType === T.TALL_GRASS) {
                    const P = FIELD_PALETTE.tall;
                    for (const [nr, nc, side] of sides) {
                        if (nr < 0 || nc < 0 || nr >= MAP_ROWS || nc >= MAP_COLS) continue;
                        if (this.worldMap[nr][nc] === T.TALL_GRASS) continue;
                        const h = this.tileHash(r * 3 + side, c * 5 + side);
                        ctx.save();
                        ctx.fillStyle = P.base;
                        for (let i = 0; i < 5; i++) {
                            const tt = (i + 0.5) / 5;
                            const out = 3 + ((h >> (i * 3)) % 4);
                            const rad = 4 + ((h >> (i * 2)) % 3);
                            let px, py;
                            if (side === 0) { px = x + tt * S; py = y - out + 2; }
                            else if (side === 1) { px = x + tt * S; py = y + S + out - 2; }
                            else if (side === 2) { px = x - out + 2; py = y + tt * S; }
                            else { px = x + S + out - 2; py = y + tt * S; }
                            ctx.beginPath();
                            ctx.arc(px, py, rad, 0, Math.PI * 2);
                            ctx.fill();
                        }
                        ctx.strokeStyle = P.tip;
                        ctx.globalAlpha = 0.55;
                        ctx.lineWidth = 1.3;
                        ctx.lineCap = 'round';
                        for (let i = 0; i < 4; i++) {
                            const tt = (i + 0.5) / 4;
                            let px, py, dy;
                            if (side === 0) { px = x + tt * S; py = y + 3; dy = -7; }
                            else if (side === 1) { px = x + tt * S; py = y + S - 3; dy = 5; }
                            else if (side === 2) { px = x + 3; py = y + tt * S; dy = -5; }
                            else { px = x + S - 3; py = y + tt * S; dy = -5; }
                            ctx.beginPath();
                            ctx.moveTo(px, py);
                            ctx.lineTo(px + ((h >> i) % 3) - 1, py + dy);
                            ctx.stroke();
                        }
                        ctx.restore();
                    }
                }

                // 절벽 느낌 - 바위 지형의 아래쪽 경계에 그림자 벽을 세운다
                if (tileType === T.ROCK && r + 1 < MAP_ROWS && this.worldMap[r + 1][c] !== T.ROCK) {
                    ctx.fillStyle = 'rgba(30,36,48,0.34)';
                    ctx.fillRect(x, y + S - 7, S, 7);
                    ctx.fillStyle = 'rgba(0,0,0,0.22)';
                    ctx.fillRect(x, y + S - 2, S, 2);
                }
            }

            drawTrainerCharacter(x, y) {
                const ctx = this.ctx;
                const p = this.player;
                const isOdd = p.animStep % 2 === 1;
                const bounce = isOdd ? -1 : 0; // 걸음마다 살짝 튀는 도트 애니메이션 느낌

                ctx.save();
                ctx.translate(x + TILE_SIZE / 2, y + TILE_SIZE / 2 + bounce);
                ctx.imageSmoothingEnabled = false;

                // 바닥 그림자 (타원형 소프트 셰이딩)
                ctx.fillStyle = 'rgba(0,0,0,0.38)';
                ctx.beginPath();
                ctx.ellipse(0, 15 - bounce, 9, 4, 0, 0, Math.PI * 2);
                ctx.fill();

                // 자전거 탑승 시 바퀴 + 프레임 연출 - 실제 게임처럼 좌우로 이동할 때는
                // 바퀴가 옆으로 나란히 놓인 옆모습으로, 위/아래로 이동할 때는 앞바퀴가
                // 뒷바퀴 앞쪽에 겹쳐 보이는 정면/후면 구도로 90도 "회전"해서 그려준다
                // (예전엔 방향과 무관하게 항상 같은 옆모습 그대로 고정되어 있었음).
                if (this.isRidingBike) {
                    const facingVertical = (p.direction === 'up' || p.direction === 'down');
                    const wheelA = facingVertical ? { x: 0, y: 5 } : { x: -8, y: 12 };
                    const wheelB = facingVertical ? { x: 0, y: 17 } : { x: 8, y: 12 };
                    const wheelR = facingVertical ? 5 : 6;

                    ctx.strokeStyle = '#475569';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(wheelA.x, wheelA.y, wheelR, 0, Math.PI * 2);
                    ctx.arc(wheelB.x, wheelB.y, wheelR, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.strokeStyle = '#cbd5e1';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.arc(wheelA.x, wheelA.y, wheelR, 0, Math.PI * 2);
                    ctx.arc(wheelB.x, wheelB.y, wheelR, 0, Math.PI * 2);
                    ctx.stroke();

                    ctx.strokeStyle = '#e2e8f0';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    if (facingVertical) {
                        ctx.moveTo(wheelB.x, wheelB.y); ctx.lineTo(wheelA.x, wheelA.y);
                        // 핸들바 - 정면/후면 구도에서 좌우로 살짝 뻗은 손잡이를 더해준다
                        ctx.moveTo(-4, 3); ctx.lineTo(4, 3);
                    } else {
                        ctx.moveTo(wheelA.x, wheelA.y); ctx.lineTo(0, 4); ctx.lineTo(wheelB.x, wheelB.y);
                    }
                    ctx.stroke();
                }

                // 실제 닌텐도 포켓몬 도트 트레이너처럼 전체 실루엣을 살짝 키우고
                // 잉크 아웃라인을 더해 훨씬 또렷하고 완성도 높은 느낌을 준다.
                ctx.scale(1.2, 1.2);

                const legOffset = isOdd ? 3 : -3;
                const SKIN = '#ffd9ae';
                const SKIN_SHADE = '#e8b380';
                const JACKET = '#ef2d3f';
                const JACKET_SHADE = '#a8172a';
                const JACKET_HI = '#ff6b7d';
                const PANTS = '#1c2942';
                const SHOES = '#0ea5a0';
                const SHOES_HI = '#5eead4';
                const CAP = '#e11d2e';
                const CAP_SHADE = '#a8172a';
                const CAP_BRIM = '#ffffff';
                const BAG = '#c2650f';
                const HAIR = '#2c1810';
                const GLOVE = '#f8fafc';
                const OUTLINE = 'rgba(20, 12, 8, 0.55)';

                ctx.lineJoin = 'round';

                if (p.direction === 'left' || p.direction === 'right') {
                    if (p.direction === 'left') ctx.scale(-1, 1);

                    // 뒷다리(원경) → 신발
                    ctx.fillStyle = PANTS;
                    ctx.fillRect(-4 + legOffset, 4, 4, 8);
                    ctx.fillRect(-2 - legOffset, 4, 4, 8);
                    ctx.fillStyle = SHOES;
                    ctx.fillRect(-4 + legOffset, 11, 4, 3);
                    ctx.fillRect(-2 - legOffset, 11, 4, 3);
                    ctx.fillStyle = SHOES_HI;
                    ctx.fillRect(-4 + legOffset, 11, 4, 1);
                    ctx.fillRect(-2 - legOffset, 11, 4, 1);

                    // 배낭 (등 쪽, 진행방향 반대편에 살짝 노출)
                    ctx.fillStyle = BAG;
                    ctx.fillRect(-8, -5, 4, 9);
                    ctx.strokeStyle = OUTLINE;
                    ctx.lineWidth = 0.6;
                    ctx.strokeRect(-8, -5, 4, 9);

                    // 몸통 재킷 (음영 포함)
                    ctx.fillStyle = JACKET_SHADE;
                    ctx.fillRect(-6, -6, 12, 11);
                    ctx.fillStyle = JACKET;
                    ctx.fillRect(-6, -6, 9, 11);
                    ctx.fillStyle = JACKET_HI;
                    ctx.fillRect(-6, -6, 3, 11);
                    // 지퍼 라인
                    ctx.fillStyle = '#7f1d1d';
                    ctx.fillRect(-1, -6, 1, 11);
                    ctx.strokeStyle = OUTLINE;
                    ctx.lineWidth = 0.7;
                    ctx.strokeRect(-6, -6, 12, 11);

                    // 팔 (걸음에 맞춰 앞뒤로 스윙) + 장갑 낀 손
                    ctx.fillStyle = JACKET_SHADE;
                    ctx.fillRect(4, -3 + (isOdd ? -1 : 1), 3, 6);
                    ctx.fillStyle = GLOVE;
                    ctx.fillRect(4, 3 + (isOdd ? -1 : 1), 3, 2);

                    // 목/피부
                    ctx.fillStyle = SKIN_SHADE;
                    ctx.fillRect(-3, -13, 6, 3);

                    // 머리
                    ctx.fillStyle = SKIN;
                    ctx.beginPath();
                    ctx.arc(0, -11, 7, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = OUTLINE;
                    ctx.lineWidth = 0.7;
                    ctx.stroke();
                    // 코/얼굴 음영
                    ctx.fillStyle = SKIN_SHADE;
                    ctx.beginPath();
                    ctx.arc(2, -9, 3, 0, Math.PI * 2);
                    ctx.fill();
                    // 뒤로 살짝 삐져나온 머리카락
                    ctx.fillStyle = HAIR;
                    ctx.fillRect(-7, -14, 3, 5);

                    // 모자
                    ctx.fillStyle = CAP_SHADE;
                    ctx.fillRect(-7, -18, 14, 6);
                    ctx.beginPath();
                    ctx.arc(0, -18, 7, Math.PI, 0);
                    ctx.fill();
                    ctx.fillStyle = CAP;
                    ctx.fillRect(-6, -18, 12, 5);
                    ctx.beginPath();
                    ctx.arc(0, -18, 6, Math.PI, 0);
                    ctx.fill();
                    ctx.fillStyle = CAP_BRIM;
                    ctx.fillRect(2, -15, 8, 3); // 챙
                    ctx.strokeStyle = OUTLINE;
                    ctx.lineWidth = 0.6;
                    ctx.strokeRect(2, -15, 8, 3);
                    ctx.fillStyle = '#ffe066';
                    ctx.beginPath();
                    ctx.arc(-2, -16, 1.6, 0, Math.PI * 2); // 모자 로고 포인트
                    ctx.fill();
                } else {
                    const isUp = p.direction === 'up';

                    // 다리 (걸음마다 번갈아 길이 조정 → 워크사이클)
                    ctx.fillStyle = PANTS;
                    ctx.fillRect(-5, 5, 4, 7 + (isOdd ? 2 : 0));
                    ctx.fillRect(1, 5, 4, 7 + (!isOdd ? 2 : 0));
                    ctx.fillStyle = SHOES;
                    ctx.fillRect(-5, 10 + (isOdd ? 2 : 0), 4, 3);
                    ctx.fillRect(1, 10 + (!isOdd ? 2 : 0), 4, 3);
                    ctx.fillStyle = SHOES_HI;
                    ctx.fillRect(-5, 10 + (isOdd ? 2 : 0), 4, 1);
                    ctx.fillRect(1, 10 + (!isOdd ? 2 : 0), 4, 1);

                    // 몸통 (좌우 음영으로 입체감)
                    ctx.fillStyle = JACKET_SHADE;
                    ctx.fillRect(-7, -5, 14, 11);
                    ctx.fillStyle = JACKET;
                    ctx.fillRect(-5, -5, 10, 11);
                    ctx.fillStyle = JACKET_HI;
                    ctx.fillRect(-5, -5, 3, 2);
                    // 지퍼/단추
                    ctx.fillStyle = '#7f1d1d';
                    ctx.fillRect(-1, -5, 1, 11);
                    ctx.fillStyle = '#fde68a';
                    ctx.fillRect(-2, -1, 1, 1);
                    ctx.fillRect(-2, 2, 1, 1);
                    ctx.strokeStyle = OUTLINE;
                    ctx.lineWidth = 0.7;
                    ctx.strokeRect(-7, -5, 14, 11);

                    // 팔 (양옆) + 장갑 낀 손
                    ctx.fillStyle = JACKET_SHADE;
                    ctx.fillRect(-9, -3, 3, 6);
                    ctx.fillRect(6, -3, 3, 6);
                    ctx.fillStyle = GLOVE;
                    ctx.fillRect(-9, 3, 3, 2);
                    ctx.fillRect(6, 3, 3, 2);

                    // 배낭 (뒤돌아 있을 때 - 위쪽 방향)
                    if (isUp) {
                        ctx.fillStyle = BAG;
                        ctx.fillRect(-5, -3, 10, 8);
                        ctx.fillStyle = '#92400e';
                        ctx.fillRect(-5, -3, 10, 2);
                        ctx.strokeStyle = OUTLINE;
                        ctx.lineWidth = 0.6;
                        ctx.strokeRect(-5, -3, 10, 8);
                    }

                    // 머리
                    ctx.fillStyle = SKIN;
                    ctx.beginPath();
                    ctx.arc(0, -10, 7, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = OUTLINE;
                    ctx.lineWidth = 0.7;
                    ctx.stroke();

                    if (!isUp) {
                        // 정면일 때만 눈/입 등 얼굴 디테일 노출 (선명한 표정으로 완성도 강화)
                        ctx.fillStyle = HAIR;
                        ctx.fillRect(-5, -14, 10, 2);
                        ctx.fillStyle = '#1e293b';
                        ctx.fillRect(-4, -10, 2, 2);
                        ctx.fillRect(2, -10, 2, 2);
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(-4, -10, 1, 1);
                        ctx.fillRect(2, -10, 1, 1);
                        ctx.fillStyle = '#b91c1c';
                        ctx.fillRect(-2, -6, 4, 1);
                        // 볼터치
                        ctx.fillStyle = 'rgba(248,113,113,0.55)';
                        ctx.beginPath();
                        ctx.arc(-5, -8, 1.4, 0, Math.PI * 2);
                        ctx.arc(5, -8, 1.4, 0, Math.PI * 2);
                        ctx.fill();
                    } else {
                        // 뒷모습에도 머리카락 결을 살짝 넣어 밋밋하지 않게
                        ctx.fillStyle = HAIR;
                        ctx.fillRect(-5, -14, 10, 3);
                    }

                    // 모자
                    ctx.fillStyle = CAP_SHADE;
                    ctx.fillRect(-7, -17, 14, 6);
                    ctx.beginPath();
                    ctx.arc(0, -17, 7, Math.PI, 0);
                    ctx.fill();
                    ctx.fillStyle = CAP;
                    ctx.fillRect(-6, -17, 12, 5);
                    ctx.beginPath();
                    ctx.arc(0, -17, 6, Math.PI, 0);
                    ctx.fill();
                    ctx.fillStyle = '#ffe066';
                    ctx.beginPath();
                    ctx.arc(0, -15, 1.8, 0, Math.PI * 2);
                    ctx.fill();
                    if (!isUp) {
                        ctx.fillStyle = CAP_BRIM;
                        ctx.fillRect(-4, -13, 8, 3); // 앞챙
                        ctx.strokeStyle = OUTLINE;
                        ctx.lineWidth = 0.6;
                        ctx.strokeRect(-4, -13, 8, 3);
                    }
                }

                ctx.restore();
            }

            /* 필드 위의 전설의 사원 타일에 작은 신전 실루엣을 덧그려 밋밋한 단색 타일 대신
               실제 던전 입구처럼 보이도록 한다 (닌텐도 DS풍 필드 오브젝트 연출) */
            /* [오버월드 리디자인] 전설의 사원은 게임에서 가장 중요한 랜드마크인데도
               예전에는 한 칸짜리 작은 아이콘처럼 보였다. 이제 타일 밖으로 크게 솟아오른
               석조 신전(계단 기단 - 기둥 - 박공 지붕 - 빛나는 성물)을 그리고, 성물에서
               빛기둥과 맥동하는 후광이 뿜어져 나오게 해 멀리서도 바로 눈에 띄게 한다. */
            drawTempleStructure(x, y, tile) {
                const ctx = this.ctx;
                const themeMap = {
                    [TILE_TYPES.LAND_TEMPLE]: { roof: '#e0912f', roofDk: '#a55c12', stone: '#c8b190', stoneDk: '#8d7a5e', gem: '#ff7a1a', glow: '255,140,40' },
                    [TILE_TYPES.SEA_TEMPLE]:  { roof: '#37a7d8', roofDk: '#12617f', stone: '#bcd3dd', stoneDk: '#7d99a6', gem: '#2ee0ff', glow: '60,215,255' },
                    [TILE_TYPES.SKY_TEMPLE]:  { roof: '#d9c25a', roofDk: '#9a8129', stone: '#d6d1bd', stoneDk: '#9b9581', gem: '#fef08a', glow: '255,240,150' }
                };
                const theme = themeMap[tile];
                if (!theme) return;

                const cx = x + TILE_SIZE / 2;
                const baseY = y + TILE_SIZE - 2;   // 신전이 서 있는 지면
                const pulse = 0.55 + Math.abs(Math.sin(Date.now() / 520)) * 0.45;

                ctx.save();
                ctx.translate(cx, baseY);

                // 바닥에 퍼지는 후광
                const halo = ctx.createRadialGradient(0, -18, 2, 0, -18, 52);
                halo.addColorStop(0, `rgba(${theme.glow},${(0.30 * pulse).toFixed(3)})`);
                halo.addColorStop(1, `rgba(${theme.glow},0)`);
                ctx.fillStyle = halo;
                ctx.fillRect(-56, -70, 112, 88);

                // 그림자
                ctx.fillStyle = 'rgba(0,0,0,0.32)';
                ctx.beginPath();
                ctx.ellipse(2, 2, 30, 8, 0, 0, Math.PI * 2);
                ctx.fill();

                // 3단 계단 기단
                for (let i = 0; i < 3; i++) {
                    const w = 30 - i * 4.5;
                    const yy = -i * 5;
                    ctx.fillStyle = i % 2 === 0 ? theme.stone : theme.stoneDk;
                    ctx.fillRect(-w, yy - 5, w * 2, 5);
                    ctx.fillStyle = 'rgba(0,0,0,0.22)';
                    ctx.fillRect(-w, yy - 1.4, w * 2, 1.4);
                }

                const floorY = -15;

                // 기둥 4개 (원근감을 위해 바깥 기둥이 조금 더 길다)
                const pillars = [-18, -7.5, 7.5, 18];
                pillars.forEach((px, i) => {
                    const ph = (i === 0 || i === 3) ? 26 : 23;
                    ctx.fillStyle = theme.stone;
                    ctx.fillRect(px - 3.6, floorY - ph, 7.2, ph);
                    ctx.fillStyle = 'rgba(0,0,0,0.26)';
                    ctx.fillRect(px + 1.4, floorY - ph, 2.2, ph);
                    ctx.fillStyle = theme.stoneDk;
                    ctx.fillRect(px - 5, floorY - ph - 3, 10, 3);   // 주두
                    ctx.fillRect(px - 5, floorY - 3, 10, 3);         // 주초
                });

                // 어두운 내부 (신전 안쪽)
                ctx.fillStyle = 'rgba(18,14,26,0.82)';
                ctx.fillRect(-16, floorY - 24, 32, 24);

                // 박공 지붕
                const roofY = floorY - 29;
                ctx.fillStyle = theme.roofDk;
                ctx.beginPath();
                ctx.moveTo(-30, roofY + 2);
                ctx.lineTo(0, roofY - 20);
                ctx.lineTo(30, roofY + 2);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = theme.roof;
                ctx.beginPath();
                ctx.moveTo(-27, roofY);
                ctx.lineTo(0, roofY - 18);
                ctx.lineTo(27, roofY);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = 'rgba(0,0,0,0.35)';
                ctx.lineWidth = 1.4;
                ctx.stroke();
                // 지붕 아래 처마
                ctx.fillStyle = theme.stoneDk;
                ctx.fillRect(-29, roofY, 58, 4);

                // 성물 - 공중에 뜬 채 회전하며 빛나는 보석
                const orbY = floorY - 13 + Math.sin(Date.now() / 700) * 2;
                const orbGlow = ctx.createRadialGradient(0, orbY, 1, 0, orbY, 16);
                orbGlow.addColorStop(0, `rgba(${theme.glow},${(0.95 * pulse).toFixed(3)})`);
                orbGlow.addColorStop(1, `rgba(${theme.glow},0)`);
                ctx.fillStyle = orbGlow;
                ctx.beginPath();
                ctx.arc(0, orbY, 16, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = theme.gem;
                ctx.beginPath();
                ctx.moveTo(0, orbY - 6);
                ctx.lineTo(4.5, orbY);
                ctx.lineTo(0, orbY + 6);
                ctx.lineTo(-4.5, orbY);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.beginPath();
                ctx.moveTo(0, orbY - 3);
                ctx.lineTo(1.8, orbY);
                ctx.lineTo(0, orbY + 3);
                ctx.lineTo(-1.8, orbY);
                ctx.closePath();
                ctx.fill();

                // 하늘로 뻗는 빛기둥
                const beam = ctx.createLinearGradient(0, roofY - 46, 0, orbY);
                beam.addColorStop(0, `rgba(${theme.glow},0)`);
                beam.addColorStop(1, `rgba(${theme.glow},${(0.28 * pulse).toFixed(3)})`);
                ctx.fillStyle = beam;
                ctx.beginPath();
                ctx.moveTo(-3.5, orbY);
                ctx.lineTo(-11, roofY - 46);
                ctx.lineTo(11, roofY - 46);
                ctx.lineTo(3.5, orbY);
                ctx.closePath();
                ctx.fill();

                ctx.restore();
            }

            /* 단색 타일이 밋밋해 보이지 않도록 지형별 저비용 텍스처 디테일을 덧그린다.
               r, c는 시드로 사용해 프레임마다 흔들리지 않는 고정 패턴을 만든다. */
            drawTileDetail(x, y, tileType, r, c) {
                const ctx = this.ctx;
                const seed = (r * 37 + c * 17) % 100;

                switch (tileType) {
                    case TILE_TYPES.TALL_GRASS:
                        ctx.fillStyle = 'rgba(134, 239, 172, 0.35)';
                        for (let i = 0; i < 3; i++) {
                            const ox = 6 + ((seed + i * 13) % 28);
                            const oy = 8 + ((seed + i * 7) % 24);
                            ctx.fillRect(x + ox, y + oy, 2, 6);
                        }
                        break;
                    case TILE_TYPES.GRASS:
                        ctx.fillStyle = 'rgba(148, 163, 184, 0.08)';
                        ctx.fillRect(x + ((seed) % 30), y + ((seed * 3) % 30), 3, 3);
                        break;
                    case TILE_TYPES.WATER:
                        ctx.strokeStyle = 'rgba(224, 242, 254, 0.35)';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        const waveY = 12 + ((seed) % 16);
                        ctx.moveTo(x + 4, y + waveY);
                        ctx.quadraticCurveTo(x + 20, y + waveY - 5, x + 36, y + waveY);
                        ctx.stroke();
                        break;
                    case TILE_TYPES.SAND:
                        ctx.fillStyle = 'rgba(120, 53, 15, 0.25)';
                        for (let i = 0; i < 4; i++) {
                            ctx.fillRect(x + ((seed + i * 9) % 34), y + ((seed + i * 11) % 34), 1, 1);
                        }
                        break;
                    case TILE_TYPES.SNOW:
                        ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
                        ctx.beginPath();
                        ctx.arc(x + 10 + ((seed) % 20), y + 10 + ((seed * 2) % 20), 1.4, 0, Math.PI * 2);
                        ctx.fill();
                        break;
                    case TILE_TYPES.VOLCANO:
                        ctx.fillStyle = 'rgba(251, 146, 60, 0.3)';
                        ctx.fillRect(x + 14 + ((seed) % 10), y + 14 + ((seed) % 10), 2, 2);
                        break;
                    case TILE_TYPES.FOREST:
                        ctx.fillStyle = 'rgba(21, 128, 61, 0.5)';
                        ctx.beginPath();
                        ctx.arc(x + 20, y + 16, 8, 0, Math.PI * 2);
                        ctx.fill();
                        break;
                    case TILE_TYPES.PATH:
                        // 흙길 - 밟혀서 다져진 중앙부와 자갈 알갱이로 실제 "루트" 도로처럼 연출
                        ctx.fillStyle = 'rgba(160, 120, 66, 0.45)';
                        ctx.fillRect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6);
                        ctx.fillStyle = 'rgba(94, 68, 34, 0.5)';
                        for (let i = 0; i < 3; i++) {
                            const ox = 5 + ((seed + i * 11) % 30);
                            const oy = 5 + ((seed + i * 19) % 30);
                            ctx.fillRect(x + ox, y + oy, 2, 2);
                        }
                        ctx.fillStyle = 'rgba(255, 236, 179, 0.18)';
                        ctx.fillRect(x + 6, y + 6, TILE_SIZE - 12, 2);
                        break;
                    // 마을/체육관/포켓몬센터/마트는 예전엔 단색 사각형 하나로만 그려져서
                    // "마을이 안 보인다"는 혼란을 줬다. 실제 3D 파이프라인(update3DField)은
                    // 죽어있고 #threeCanvas도 display:none이라 2D 캔버스만 쓰이므로,
                    // 여기에 지붕/문/간판 실루엣을 덧그려 한눈에 건물임을 알아볼 수 있게 한다.
                    case TILE_TYPES.TOWN:
                        // [업그레이드] 예전엔 마을 안의 모든 칸이 똑같은 집 한 채로 채워져서,
                        // 24x24칸 마을 전체가 복사-붙여넣기한 지붕 격자처럼 보였다. 실제
                        // 포켓몬 마을처럼 "집은 드문드문, 나머지는 포장길·잔디·화단·나무·
                        // 울타리"로 구성되도록 좌표 해시를 이용해 결정적으로 배치한다.
                        // (해시 기반이라 매 프레임 같은 그림이 나오고, 저장/불러오기 후에도
                        //  마을 모습이 절대 달라지지 않는다.)
                        this.drawTownTile(x, y, r, c);
                        break;
                    case TILE_TYPES.GYM:
                    case TILE_TYPES.CENTER:
                    case TILE_TYPES.MART:
                        // [업그레이드] 예전에는 단색 바탕 위에 작은 지붕 사각형만 얹어
                        // 멀리서 보면 그냥 "색깔 칸"으로 보였다. 이제 실제 포켓몬센터/
                        // 프렌들리숍/체육관처럼 간판·자동문·차양·계단까지 그려 넣어
                        // 한눈에 어떤 시설인지 알아볼 수 있게 한다.
                        this.drawLandmarkBuilding(x, y, tileType);
                        break;
                    default:
                        break;
                }
            }

            /* 포켓몬센터 / 프렌들리숍 / 체육관 건물 한 칸을 그린다 */
            drawLandmarkBuilding(x, y, tileType) {
                const ctx = this.ctx;
                const T = TILE_TYPES;
                const theme = tileType === T.CENTER
                    ? { roof: '#e63946', wall: '#f8fafc', trim: '#b91c1c', sign: '#ffffff' }
                    : (tileType === T.MART
                        ? { roof: '#2563eb', wall: '#f0f7ff', trim: '#1e40af', sign: '#ffffff' }
                        : { roof: '#b45309', wall: '#fde68a', trim: '#78350f', sign: '#fff7ed' });

                // 바닥 포장
                ctx.fillStyle = '#cfc6ae';
                ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

                // 벽체
                ctx.fillStyle = theme.wall;
                ctx.fillRect(x + 3, y + 13, TILE_SIZE - 6, 24);
                ctx.strokeStyle = 'rgba(0,0,0,0.4)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x + 3, y + 13, TILE_SIZE - 6, 24);

                // 지붕/차양
                ctx.fillStyle = theme.roof;
                ctx.beginPath();
                ctx.moveTo(x + 1, y + 14);
                ctx.lineTo(x + 6, y + 4);
                ctx.lineTo(x + TILE_SIZE - 6, y + 4);
                ctx.lineTo(x + TILE_SIZE - 1, y + 14);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                // 자동문
                ctx.fillStyle = 'rgba(56, 189, 248, 0.85)';
                ctx.fillRect(x + 14, y + 24, 12, 13);
                ctx.strokeStyle = theme.trim;
                ctx.strokeRect(x + 14, y + 24, 12, 13);
                ctx.beginPath();
                ctx.moveTo(x + 20, y + 24);
                ctx.lineTo(x + 20, y + 37);
                ctx.stroke();

                // 간판 마크
                ctx.fillStyle = theme.sign;
                if (tileType === T.CENTER) {
                    // 빨간 십자 (회복 시설)
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(x + 18, y + 6, 4, 8);
                    ctx.fillRect(x + 16, y + 8, 8, 4);
                } else if (tileType === T.MART) {
                    // 쇼핑백
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(x + 16, y + 7, 8, 7);
                    ctx.strokeStyle = '#ffffff';
                    ctx.beginPath();
                    ctx.arc(x + 20, y + 7, 3, Math.PI, 0);
                    ctx.stroke();
                } else {
                    // 체육관 뱃지 마크
                    ctx.fillStyle = '#fff7ed';
                    ctx.beginPath();
                    ctx.arc(x + 20, y + 9, 4.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = theme.trim;
                    ctx.beginPath();
                    ctx.arc(x + 20, y + 9, 2, 0, Math.PI * 2);
                    ctx.fill();
                }

                // 창문 두 개
                ctx.fillStyle = 'rgba(125, 211, 252, 0.9)';
                ctx.fillRect(x + 6, y + 17, 6, 5);
                ctx.fillRect(x + 28, y + 17, 6, 5);

                // 밤에는 창문/간판에 불이 켜진다
                const phase = this.timePhase || sampleTimePhase(this.timeOfDay || 0.42);
                if (phase.alpha > 0.28) {
                    ctx.save();
                    ctx.globalCompositeOperation = 'lighter';
                    ctx.fillStyle = 'rgba(255, 226, 138, 0.55)';
                    ctx.fillRect(x + 6, y + 17, 6, 5);
                    ctx.fillRect(x + 28, y + 17, 6, 5);
                    ctx.fillRect(x + 14, y + 24, 12, 13);
                    ctx.restore();
                }
            }

            /* 마을 한 칸을 그린다 - 좌표에 따라 집/포장길/광장/화단/나무/울타리/잔디 중
               하나가 결정적으로 선택된다. */
            drawTownTile(x, y, r, c) {
                const ctx = this.ctx;
                const h = ((r * 73856093) ^ (c * 19349663)) >>> 0;
                const isRoadRow = (r % 5) === 0;
                const isRoadCol = (c % 6) === 0;
                const S = TILE_SIZE;

                if (isRoadRow || isRoadCol) {
                    ctx.drawImage(this.townRoadArt[h % this.townRoadArt.length], x, y);
                    if (isRoadRow && isRoadCol) {
                        // 교차로 가로등 - 기둥에 그림자와 금속 질감을 넣어 입체적으로
                        ctx.fillStyle = 'rgba(0,0,0,0.22)';
                        ctx.beginPath();
                        ctx.ellipse(x + 21, y + 33, 6, 2.4, 0, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.fillStyle = '#3b4553';
                        ctx.fillRect(x + 18.5, y + 12, 3.5, 21);
                        ctx.fillStyle = '#6b7785';
                        ctx.fillRect(x + 18.5, y + 12, 1.2, 21);
                        ctx.fillStyle = '#2a323d';
                        ctx.fillRect(x + 16, y + 32, 9, 2.5);
                        // 등갓 + 전구
                        ctx.fillStyle = '#2a323d';
                        ctx.beginPath();
                        ctx.moveTo(x + 14, y + 9);
                        ctx.lineTo(x + 27, y + 9);
                        ctx.lineTo(x + 24, y + 5);
                        ctx.lineTo(x + 17, y + 5);
                        ctx.closePath();
                        ctx.fill();
                        ctx.fillStyle = '#ffe58a';
                        ctx.beginPath();
                        ctx.arc(x + 20.5, y + 11, 3.6, 0, Math.PI * 2);
                        ctx.fill();
                        const phase = this.timePhase || sampleTimePhase(this.timeOfDay || 0.42);
                        if (phase.alpha > 0.25) {
                            ctx.save();
                            ctx.globalCompositeOperation = 'lighter';
                            const glow = ctx.createRadialGradient(x + 20.5, y + 11, 0, x + 20.5, y + 11, 30);
                            glow.addColorStop(0, 'rgba(255, 226, 140, 0.6)');
                            glow.addColorStop(1, 'rgba(255, 226, 140, 0)');
                            ctx.fillStyle = glow;
                            ctx.fillRect(x - 14, y - 18, S + 28, S + 28);
                            ctx.restore();
                        }
                    }
                    return;
                }

                // 마당 바닥은 들판과 똑같은 잔디 아트를 재사용해, 마을 안팎의 질감이
                // 끊기지 않고 자연스럽게 이어지도록 한다.
                const lawn = this.tileArt[TILE_TYPES.GRASS];
                ctx.drawImage(lawn[h % lawn.length][0], x, y);

                // 집은 도로가 아닌 구획의 "앞줄"에만 드문드문 세운다
                if ((r % 5) === 2 && (c % 3) === 1) {
                    this.drawTownHouse(x, y, h);
                    return;
                }

                // 나무/관목은 오브젝트 레이어(getTileProp)에서 그린다. 여기서는
                // 바닥에 붙는 장식(화단/울타리/벤치/징검돌)만 그린다.
                const kind = h % 10;
                if (kind === 3 || kind === 4) {
                    // 화단
                    const colors = ['#f87171', '#facc15', '#f472b6', '#a78bfa', '#fb923c'];
                    ctx.fillStyle = 'rgba(92,64,34,0.30)';
                    ctx.beginPath();
                    ctx.ellipse(x + 20, y + 22, 13, 8, 0, 0, Math.PI * 2);
                    ctx.fill();
                    for (let i = 0; i < 7; i++) {
                        const ox = 9 + ((h >> (i * 2)) % 23);
                        const oy = 12 + ((h >> (i * 3)) % 18);
                        ctx.strokeStyle = 'rgba(52,110,48,0.75)';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(x + ox, y + oy + 4);
                        ctx.lineTo(x + ox, y + oy);
                        ctx.stroke();
                        ctx.fillStyle = colors[(h + i) % colors.length];
                        ctx.beginPath();
                        ctx.arc(x + ox, y + oy, 2.4, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.fillStyle = 'rgba(255,255,255,0.75)';
                        ctx.beginPath();
                        ctx.arc(x + ox - 0.7, y + oy - 0.7, 0.9, 0, Math.PI * 2);
                        ctx.fill();
                    }
                } else if (kind === 5) {
                    // 나무 울타리 (기둥에 그림자와 나뭇결)
                    ctx.fillStyle = 'rgba(0,0,0,0.18)';
                    ctx.fillRect(x + 3, y + 30, S - 6, 3);
                    ctx.fillStyle = '#9c6b3c';
                    ctx.fillRect(x + 2, y + 21, S - 4, 3.5);
                    ctx.fillRect(x + 2, y + 27, S - 4, 3);
                    for (let i = 0; i < 4; i++) {
                        ctx.fillStyle = '#a97845';
                        ctx.fillRect(x + 4 + i * 9.6, y + 15, 3.6, 16);
                        ctx.fillStyle = 'rgba(80,50,24,0.45)';
                        ctx.fillRect(x + 6.4 + i * 9.6, y + 15, 1.2, 16);
                    }
                } else if (kind === 6) {
                    // 공원 벤치
                    ctx.fillStyle = 'rgba(0,0,0,0.2)';
                    ctx.beginPath();
                    ctx.ellipse(x + 20, y + 31, 13, 3.4, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = '#8a5a2e';
                    ctx.fillRect(x + 7, y + 21, 26, 4);
                    ctx.fillRect(x + 7, y + 14, 26, 3.4);
                    ctx.fillStyle = 'rgba(255,220,170,0.35)';
                    ctx.fillRect(x + 7, y + 21, 26, 1.2);
                    ctx.fillStyle = '#4b5563';
                    ctx.fillRect(x + 8, y + 25, 3, 6);
                    ctx.fillRect(x + 29, y + 25, 3, 6);
                } else if (kind === 7) {
                    // 징검돌
                    ctx.fillStyle = 'rgba(0,0,0,0.16)';
                    for (let i = 0; i < 3; i++) {
                        const ox = 8 + i * 11, oy = 14 + ((h >> i) % 12);
                        ctx.beginPath();
                        ctx.ellipse(x + ox + 1, y + oy + 1.5, 5, 3.4, 0, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    for (let i = 0; i < 3; i++) {
                        const ox = 8 + i * 11, oy = 14 + ((h >> i) % 12);
                        ctx.fillStyle = '#b8b2a2';
                        ctx.beginPath();
                        ctx.ellipse(x + ox, y + oy, 5, 3.4, 0, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.fillStyle = 'rgba(255,255,255,0.4)';
                        ctx.beginPath();
                        ctx.ellipse(x + ox - 1.2, y + oy - 1, 2.4, 1.4, 0, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }

            /* 마을 민가 한 채 - 지붕 기와결, 벽 그림자, 창틀, 현관 계단까지 넣어
               한 칸짜리 도형이 아니라 실제 집처럼 보이게 한다. */
            drawTownHouse(x, y, h) {
                const ctx = this.ctx;
                const palette = [
                    ['#d2552b', '#a03a17', '#fff4de'],
                    ['#2f6fd0', '#1c4894', '#eef5ff'],
                    ['#2f9450', '#1c6435', '#f0fff4'],
                    ['#8b5cf6', '#6134c4', '#faf5ff'],
                    ['#d99b2b', '#a36c13', '#fffaed']
                ][h % 5];

                // 그림자
                ctx.fillStyle = 'rgba(0,0,0,0.24)';
                ctx.beginPath();
                ctx.ellipse(x + 21, y + 37, 17, 4.5, 0, 0, Math.PI * 2);
                ctx.fill();

                // 벽
                ctx.fillStyle = palette[2];
                ctx.fillRect(x + 8, y + 19, 24, 18);
                ctx.fillStyle = 'rgba(0,0,0,0.12)';
                ctx.fillRect(x + 26, y + 19, 6, 18);
                ctx.strokeStyle = 'rgba(40,30,20,0.5)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x + 8, y + 19, 24, 18);

                // 지붕
                ctx.fillStyle = palette[0];
                ctx.beginPath();
                ctx.moveTo(x + 3, y + 20);
                ctx.lineTo(x + 20, y + 4);
                ctx.lineTo(x + 37, y + 20);
                ctx.closePath();
                ctx.fill();
                // 기와 결
                ctx.strokeStyle = palette[1];
                ctx.lineWidth = 1;
                for (let i = 1; i <= 3; i++) {
                    const t = i / 4;
                    ctx.beginPath();
                    ctx.moveTo(x + 3 + 17 * t, y + 20 - 16 * t);
                    ctx.lineTo(x + 37 - 17 * t, y + 20 - 16 * t);
                    ctx.stroke();
                }
                ctx.fillStyle = 'rgba(255,255,255,0.22)';
                ctx.beginPath();
                ctx.moveTo(x + 3, y + 20);
                ctx.lineTo(x + 20, y + 4);
                ctx.lineTo(x + 20, y + 20);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = 'rgba(30,20,12,0.55)';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(x + 3, y + 20);
                ctx.lineTo(x + 20, y + 4);
                ctx.lineTo(x + 37, y + 20);
                ctx.stroke();

                // 굴뚝
                ctx.fillStyle = palette[1];
                ctx.fillRect(x + 28, y + 5, 4.5, 8);
                ctx.fillStyle = '#6b7280';
                ctx.fillRect(x + 27.4, y + 4, 5.6, 2);

                // 현관 + 계단
                ctx.fillStyle = '#7a4c22';
                ctx.fillRect(x + 17, y + 26, 7.5, 11);
                ctx.fillStyle = 'rgba(255,220,170,0.35)';
                ctx.fillRect(x + 17, y + 26, 1.4, 11);
                ctx.fillStyle = '#ffd166';
                ctx.beginPath();
                ctx.arc(x + 23.2, y + 31.5, 0.9, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#c9c0ab';
                ctx.fillRect(x + 15.5, y + 36.5, 10.5, 2.5);

                // 창문
                const win = (wx, wy) => {
                    ctx.fillStyle = '#7dd3fc';
                    ctx.fillRect(x + wx, y + wy, 6, 5.5);
                    ctx.fillStyle = 'rgba(255,255,255,0.55)';
                    ctx.beginPath();
                    ctx.moveTo(x + wx, y + wy + 5.5);
                    ctx.lineTo(x + wx + 6, y + wy);
                    ctx.lineTo(x + wx + 6, y + wy + 2);
                    ctx.lineTo(x + wx + 2, y + wy + 5.5);
                    ctx.closePath();
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(60,45,30,0.7)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x + wx, y + wy, 6, 5.5);
                };
                win(10, 22);
                win(25.5, 22);

                // 밤에는 창문과 현관에 불이 켜진다
                const phase = this.timePhase || sampleTimePhase(this.timeOfDay || 0.42);
                if (phase.alpha > 0.28) {
                    ctx.save();
                    ctx.globalCompositeOperation = 'lighter';
                    ctx.fillStyle = 'rgba(255, 222, 130, 0.5)';
                    ctx.fillRect(x + 10, y + 22, 6, 5.5);
                    ctx.fillRect(x + 25.5, y + 22, 6, 5.5);
                    ctx.restore();
                }
            }

            /* 포켓몬센터 / 프렌들리숍 / 체육관 건물 한 칸을 그린다 */
            drawLandmarkBuilding(x, y, tileType) {
                const ctx = this.ctx;
                const T = TILE_TYPES;
                const theme = tileType === T.CENTER
                    ? { roof: '#e63946', wall: '#f8fafc', trim: '#b91c1c', sign: '#ffffff' }
                    : (tileType === T.MART
                        ? { roof: '#2563eb', wall: '#f0f7ff', trim: '#1e40af', sign: '#ffffff' }
                        : { roof: '#b45309', wall: '#fde68a', trim: '#78350f', sign: '#fff7ed' });

                // 바닥 포장
                ctx.fillStyle = '#cfc6ae';
                ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

                // 벽체
                ctx.fillStyle = theme.wall;
                ctx.fillRect(x + 3, y + 13, TILE_SIZE - 6, 24);
                ctx.strokeStyle = 'rgba(0,0,0,0.4)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x + 3, y + 13, TILE_SIZE - 6, 24);

                // 지붕/차양
                ctx.fillStyle = theme.roof;
                ctx.beginPath();
                ctx.moveTo(x + 1, y + 14);
                ctx.lineTo(x + 6, y + 4);
                ctx.lineTo(x + TILE_SIZE - 6, y + 4);
                ctx.lineTo(x + TILE_SIZE - 1, y + 14);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                // 자동문
                ctx.fillStyle = 'rgba(56, 189, 248, 0.85)';
                ctx.fillRect(x + 14, y + 24, 12, 13);
                ctx.strokeStyle = theme.trim;
                ctx.strokeRect(x + 14, y + 24, 12, 13);
                ctx.beginPath();
                ctx.moveTo(x + 20, y + 24);
                ctx.lineTo(x + 20, y + 37);
                ctx.stroke();

                // 간판 마크
                ctx.fillStyle = theme.sign;
                if (tileType === T.CENTER) {
                    // 빨간 십자 (회복 시설)
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(x + 18, y + 6, 4, 8);
                    ctx.fillRect(x + 16, y + 8, 8, 4);
                } else if (tileType === T.MART) {
                    // 쇼핑백
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(x + 16, y + 7, 8, 7);
                    ctx.strokeStyle = '#ffffff';
                    ctx.beginPath();
                    ctx.arc(x + 20, y + 7, 3, Math.PI, 0);
                    ctx.stroke();
                } else {
                    // 체육관 뱃지 마크
                    ctx.fillStyle = '#fff7ed';
                    ctx.beginPath();
                    ctx.arc(x + 20, y + 9, 4.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = theme.trim;
                    ctx.beginPath();
                    ctx.arc(x + 20, y + 9, 2, 0, Math.PI * 2);
                    ctx.fill();
                }

                // 창문 두 개
                ctx.fillStyle = 'rgba(125, 211, 252, 0.9)';
                ctx.fillRect(x + 6, y + 17, 6, 5);
                ctx.fillRect(x + 28, y + 17, 6, 5);

                // 밤에는 창문/간판에 불이 켜진다
                const phase = this.timePhase || sampleTimePhase(this.timeOfDay || 0.42);
                if (phase.alpha > 0.28) {
                    ctx.save();
                    ctx.globalCompositeOperation = 'lighter';
                    ctx.fillStyle = 'rgba(255, 226, 138, 0.55)';
                    ctx.fillRect(x + 6, y + 17, 6, 5);
                    ctx.fillRect(x + 28, y + 17, 6, 5);
                    ctx.fillRect(x + 14, y + 24, 12, 13);
                    ctx.restore();
                }
            }

            /* 마을 한 칸을 그린다 - 좌표에 따라 집/포장길/광장/화단/나무/울타리/잔디 중
               하나가 결정적으로 선택된다. */
            drawTownTile(x, y, r, c) {
                const ctx = this.ctx;
                const h = ((r * 73856093) ^ (c * 19349663)) >>> 0;
                const isRoadRow = (r % 5) === 0;
                const isRoadCol = (c % 6) === 0;

                if (isRoadRow || isRoadCol) {
                    // 마을 포장 도로 - 회백색 벽돌 바닥
                    ctx.fillStyle = '#cfc6ae';
                    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
                    ctx.strokeStyle = 'rgba(120, 110, 90, 0.35)';
                    ctx.lineWidth = 1;
                    for (let i = 0; i <= 2; i++) {
                        ctx.beginPath();
                        ctx.moveTo(x, y + i * (TILE_SIZE / 2));
                        ctx.lineTo(x + TILE_SIZE, y + i * (TILE_SIZE / 2));
                        ctx.stroke();
                    }
                    const off = (r % 2) * (TILE_SIZE / 2);
                    ctx.beginPath();
                    ctx.moveTo(x + off, y);
                    ctx.lineTo(x + off, y + TILE_SIZE);
                    ctx.stroke();
                    if (isRoadRow && isRoadCol) {
                        // 교차로에는 가로등을 세운다 (밤에는 실제로 불이 켜진다)
                        ctx.fillStyle = 'rgba(71, 85, 105, 0.9)';
                        ctx.fillRect(x + 19, y + 12, 3, 20);
                        ctx.fillStyle = 'rgba(253, 224, 71, 0.95)';
                        ctx.beginPath();
                        ctx.arc(x + 20.5, y + 11, 4.5, 0, Math.PI * 2);
                        ctx.fill();
                        const phase = this.timePhase || sampleTimePhase(this.timeOfDay || 0.42);
                        if (phase.alpha > 0.25) {
                            ctx.save();
                            ctx.globalCompositeOperation = 'lighter';
                            const glow = ctx.createRadialGradient(x + 20.5, y + 11, 0, x + 20.5, y + 11, 26);
                            glow.addColorStop(0, 'rgba(255, 224, 130, 0.55)');
                            glow.addColorStop(1, 'rgba(255, 224, 130, 0)');
                            ctx.fillStyle = glow;
                            ctx.fillRect(x - 12, y - 16, TILE_SIZE + 24, TILE_SIZE + 24);
                            ctx.restore();
                        }
                    }
                    return;
                }

                // 집은 도로가 아닌 구획의 "앞줄"에만 드문드문 세운다
                if ((r % 5) === 2 && (c % 3) === 1) {
                    const palette = [
                        ['#c2410c', '#fef3c7'], ['#1d4ed8', '#eff6ff'],
                        ['#15803d', '#f0fdf4'], ['#7c3aed', '#faf5ff'], ['#b45309', '#fffbeb']
                    ][h % 5];
                    // 지붕
                    ctx.fillStyle = palette[0];
                    ctx.beginPath();
                    ctx.moveTo(x + 3, y + 19);
                    ctx.lineTo(x + 20, y + 4);
                    ctx.lineTo(x + 37, y + 19);
                    ctx.closePath();
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    // 벽
                    ctx.fillStyle = palette[1];
                    ctx.fillRect(x + 8, y + 19, 24, 17);
                    ctx.strokeRect(x + 8, y + 19, 24, 17);
                    // 문 + 창문
                    ctx.fillStyle = 'rgba(120, 53, 15, 0.9)';
                    ctx.fillRect(x + 17, y + 26, 7, 10);
                    ctx.fillStyle = 'rgba(125, 211, 252, 0.95)';
                    ctx.fillRect(x + 10, y + 22, 5, 5);
                    ctx.fillRect(x + 26, y + 22, 5, 5);
                    // 굴뚝
                    ctx.fillStyle = palette[0];
                    ctx.fillRect(x + 28, y + 6, 4, 7);
                    return;
                }

                // 나머지 칸: 잔디 위에 나무 / 화단 / 울타리 / 벤치 / 그냥 잔디
                const kind = h % 10;
                if (kind < 2) {
                    // 마을 나무
                    ctx.fillStyle = 'rgba(92, 64, 30, 0.9)';
                    ctx.fillRect(x + 18, y + 24, 4, 10);
                    ctx.fillStyle = '#2f7d32';
                    ctx.beginPath();
                    ctx.arc(x + 20, y + 19, 10, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = 'rgba(134, 239, 172, 0.55)';
                    ctx.beginPath();
                    ctx.arc(x + 17, y + 16, 4, 0, Math.PI * 2);
                    ctx.fill();
                } else if (kind < 4) {
                    // 화단 (알록달록한 꽃)
                    const colors = ['#f87171', '#facc15', '#f472b6', '#a78bfa'];
                    for (let i = 0; i < 4; i++) {
                        ctx.fillStyle = colors[(h + i) % colors.length];
                        const ox = 8 + ((h >> (i * 2)) % 22);
                        const oy = 10 + ((h >> (i * 3)) % 20);
                        ctx.beginPath();
                        ctx.arc(x + ox, y + oy, 2.6, 0, Math.PI * 2);
                        ctx.fill();
                    }
                } else if (kind < 5) {
                    // 나무 울타리
                    ctx.fillStyle = 'rgba(146, 104, 60, 0.95)';
                    ctx.fillRect(x + 2, y + 22, TILE_SIZE - 4, 3);
                    for (let i = 0; i < 4; i++) ctx.fillRect(x + 4 + i * 10, y + 16, 3, 14);
                } else if (kind < 6) {
                    // 벤치
                    ctx.fillStyle = 'rgba(120, 82, 45, 0.95)';
                    ctx.fillRect(x + 8, y + 22, 24, 4);
                    ctx.fillRect(x + 8, y + 16, 24, 3);
                    ctx.fillRect(x + 9, y + 26, 3, 6);
                    ctx.fillRect(x + 28, y + 26, 3, 6);
                } else {
                    // 잔디 결 - 은은한 풀 텍스처
                    ctx.fillStyle = 'rgba(255,255,255,0.10)';
                    for (let i = 0; i < 3; i++) {
                        ctx.fillRect(x + 5 + ((h >> (i * 3)) % 30), y + 6 + ((h >> (i * 5)) % 28), 2, 4);
                    }
                }
            }

            /* 타일마다 (r+c) 패리티에 따라 아주 옅은 명암을 번갈아 입혀, 포켓몬 GBA/DS 시절
               특유의 체커보드 지형 음영을 재현한다. 단조로운 단색 타일을 훨씬 고급스럽게 만들어준다. */
            drawTileShade(x, y, r, c) {
                this.ctx.fillStyle = (r + c) % 2 === 0 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.045)';
                this.ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
            }

            /* 서로 다른 지형(카테고리) 경계가 칼로 자른 듯 뚝 끊기지 않도록,
               인접 타일과 종류가 다른 변에만 부드러운 그림자 띠를 덧그려 전이 구간을 표현한다. */
            drawBiomeEdge(x, y, r, c, tileType) {
                const cat = getTileCategory(tileType);
                if (cat === 'structure' || cat === 'path') return;
                const ctx = this.ctx;
                const edges = [
                    [r - 1, c, 'top'], [r + 1, c, 'bottom'], [r, c - 1, 'left'], [r, c + 1, 'right']
                ];
                ctx.fillStyle = 'rgba(0,0,0,0.12)';
                edges.forEach(([nr, nc, side]) => {
                    if (nr < 0 || nc < 0 || nr >= MAP_ROWS || nc >= MAP_COLS) return;
                    const nCat = getTileCategory(this.worldMap[nr][nc]);
                    if (nCat === cat || nCat === 'structure' || nCat === 'path') return;
                    if (side === 'top') ctx.fillRect(x, y, TILE_SIZE, 3);
                    else if (side === 'bottom') ctx.fillRect(x, y + TILE_SIZE - 3, TILE_SIZE, 3);
                    else if (side === 'left') ctx.fillRect(x, y, 3, TILE_SIZE);
                    else ctx.fillRect(x + TILE_SIZE - 3, y, 3, TILE_SIZE);
                });
            }

            render() {
                this.processMovementInput();

                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

                // 필드 타일맵은 FIELD 상태에서만 그린다. 예전엔 BATTLE 상태에서도 이 타일맵을
                // 그렸는데, 그 위를 옛 2D drawBattleStadium()이 불투명하게 완전히 덮어써서
                // 문제가 없었다. 이제 배틀 배경은 별도의 3D 캔버스(threeCanvas)가 담당하므로,
                // 이 2D 타일맵을 배틀 중에도 계속 그리면 3D 무대를 그대로 가려버리게 된다.
                if (this.state === GAME_STATES.FIELD) {
                    const visualX = this.getVisualX();
                    const visualY = this.getVisualY();
                    const camX = visualX * TILE_SIZE - this.canvas.width / 2 + TILE_SIZE / 2;
                    const camY = visualY * TILE_SIZE - this.canvas.height / 2 + TILE_SIZE / 2;

                    const visibleTempleTiles = [];

                    // 맵이 320x320으로 크게 늘어난 만큼, 매 프레임 전체 맵을 훑는 대신
                    // 실제로 화면에 보이는 행/열 범위만 계산해서 그 구간만 순회한다 (카메라 컬링).
                    const startCol = Math.max(0, Math.floor(camX / TILE_SIZE) - 1);
                    const endCol = Math.min(MAP_COLS - 1, Math.ceil((camX + this.canvas.width) / TILE_SIZE) + 1);
                    const startRow = Math.max(0, Math.floor(camY / TILE_SIZE) - 1);
                    const endRow = Math.min(MAP_ROWS - 1, Math.ceil((camY + this.canvas.height) / TILE_SIZE) + 1);

                    // [오버월드 리디자인] 렌더링을 2단계로 나눈다.
                    //  1) 바닥 레이어: 미리 구워둔 지형 타일 그림을 drawImage로 찍고,
                    //     인접 지형과의 경계를 부드럽게 번지게 한다.
                    //  2) 오브젝트 레이어: 나무·바위·선인장처럼 타일 위로 솟는 물체를
                    //     "아래 줄이 윗줄을 가리는" 순서로 그려 진짜 입체감을 만든다.
                    const animTick = performance.now();
                    const props = [];

                    for (let r = startRow; r <= endRow; r++) {
                        for (let c = startCol; c <= endCol; c++) {
                            const x = c * TILE_SIZE - camX;
                            const y = r * TILE_SIZE - camY;
                            const tileType = this.worldMap[r][c];

                            const art = this.tileArt[tileType];
                            if (art) {
                                const h = this.tileHash(r, c);
                                const frames = art[h % art.length];
                                const fi = frames.length > 1
                                    ? Math.floor(animTick / 140 + h % frames.length) % frames.length
                                    : 0;
                                this.ctx.drawImage(frames[fi], x, y);
                            } else {
                                this.ctx.fillStyle = TILE_COLORS[tileType];
                                this.ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
                                this.drawTileDetail(x, y, tileType, r, c);
                            }

                            this.drawFieldTransition(x, y, r, c, tileType);

                            const prop = this.getTileProp(tileType, r, c);
                            if (prop) {
                                // 오브젝트를 칸 정중앙에 딱 맞추면 숲/바위밭이 "벽지 무늬"처럼
                                // 보인다. 칸마다 고정된 값만큼 좌우·상하로 어긋나게 놓아
                                // 자연스럽게 흩어진 배치로 만든다.
                                const jh = this.tileHash(c, r);
                                props.push({
                                    x: x + ((jh % 15) - 7),
                                    y: y + (((jh >> 5) % 9) - 4),
                                    phase: (jh >> 9) % 4,
                                    prop
                                });
                            }

                            if (LEGEND_TEMPLE_INFO[tileType]) {
                                visibleTempleTiles.push({ x, y, tileType });
                            }
                        }
                    }

                    // 지형 위에 커다란 명암 기복을 덮어 타일 격자감을 없앤다
                    this.drawMacroVariation(camX, camY);

                    // 화면 안의 NPC를 모아 오브젝트와 같은 순서로 그린다
                    const visibleNpcs = [];
                    if (this.npcs) {
                        for (const npc of this.npcs) {
                            if (npc.r < startRow - 1 || npc.r > endRow + 1 || npc.c < startCol - 1 || npc.c > endCol + 1) continue;
                            visibleNpcs.push(npc);
                        }
                    }

                    // 오브젝트 레이어 (위쪽 줄부터 차례대로 → 아래 줄이 자연스럽게 겹쳐 가린다)
                    for (const item of props) {
                        const sheet = this.propArt[item.prop.name];
                        if (!sheet) continue;
                        const frames = sheet[item.prop.v % sheet.length];
                        // 칸마다 위상을 다르게 줘서 숲 전체가 한 몸처럼 움직이지 않게 한다
                        const img = frames.length > 1
                            ? frames[Math.floor(animTick / 230 + item.phase) % frames.length]
                            : frames[0];
                        this.ctx.drawImage(img, item.x, item.y - this.PROP_LIFT);
                    }

                    // NPC (나무/바위 뒤에서 나오도록 오브젝트 다음에 그린다)
                    for (const npc of visibleNpcs) {
                        this.drawNpc(npc.c * TILE_SIZE - camX, npc.r * TILE_SIZE - camY, npc);
                    }

                    // 전설의 사원 구조물 (평면 타일 대신 신전 실루엣을 덧그려 던전 입구처럼 연출)
                    visibleTempleTiles.forEach(t => this.drawTempleStructure(t.x, t.y, t.tileType));

                    // 닌텐도 캐릭터 도트 렌더링
                    // 지형 위를 떠다니는 생물/입자 (암전 전에 그려 밤에는 함께 어두워진다)
                    this.updateAmbientLife(camX, camY);
                    this.renderAmbientLife(camX, camY, false);

                    const px = visualX * TILE_SIZE - camX;
                    const py = visualY * TILE_SIZE - camY;
                    this.drawTrainerCharacter(px, py);
                    this.drawGrassRustle(px, py);
                    this._playerScreenX = px;
                    this._playerScreenY = py;

                    // [업그레이드] 예전엔 밤이면 단색 검정 필터가 한 겹 뚝 덮이는 것이
                    // 전부였다. 이제는 새벽의 보랏빛, 아침의 주황빛, 노을의 붉은빛,
                    // 한밤의 푸른빛이 timeOfDay를 따라 연속적으로 보간되어 덮이고,
                    // 어두운 시간대에는 플레이어 주변만 동그랗게 밝은 "손전등" 영역이
                    // 남아 실제 상용 RPG의 밤 연출처럼 보이게 한다.
                    this.renderTimeOfDayOverlay(px, py);
                    // 반딧불이·불티·눈꽃은 암전 뒤에 그려야 밤에도 스스로 빛난다
                    // (셰이더 블룸을 타고 실제로 반짝인다)
                    this.renderAmbientLife(camX, camY, true);
                    this.renderFieldVignette();
                }

                // 날씨 시각 효과(비/눈/모래바람)는 필드뿐 아니라 배틀 중에도 계속 보여야
                // 날씨가 기술 데미지에 실제로 영향을 주는 배틀 메커니즘과 화면이 어긋나지 않는다.
                if (this.state === GAME_STATES.FIELD || this.state === GAME_STATES.BATTLE) {
                    this.renderWeatherEffect();
                }

                if (this.state === GAME_STATES.BATTLE) {
                    this.renderBattleVignette();
                    // 이름/레벨/HP바 정보창은 #enemy-info-box, #player-info-box (DOM, updateBattleHud())가
                    // 전담한다. 예전에는 이 2D 캔버스에도 drawHpPanel()로 같은 정보를 중복 드로잉해서
                    // 좌표가 DOM 박스와 어긋나 체력바가 두 개씩 겹쳐 보이는 버그가 있었기에 제거했다.
                    // 배경 자체도 2D 그라데이션 대신 실제 3D 무대(threeCanvas)로 렌더링하고,
                    // 이 2D 캔버스는 날씨 파티클/스킬 이펙트 같은 오버레이 FX 전용으로만 쓴다.
                    this.renderBattleStage3D();
                }

                this.renderMinimap();
                this.updateAndRenderParticles();
                this.updateAndRenderSkillEffects();

                // 2D 화면이 전부 완성된 뒤 마지막 단계로 셰이더를 통과시킨다
                this.syncFieldPostFxVisibility();
                this.renderFieldPostFx(this._playerScreenX || 0, this._playerScreenY || 0);

                requestAnimationFrame(() => this.render());
            }

            /* [최적화] 세계 지형(worldMap)은 initWorldMap() 이후로 절대 바뀌지 않는데도,
               예전 renderMinimap()은 매 프레임(60fps) 정지된 지형 전체를 fillRect
               400회 안팎으로 다시 그리고 있었다 - 화면에 보이지도 않는 낭비였다.
               이제는 정지된 지형 레이어를 딱 한 번(월드 생성 시점)만 오프스크린
               캔버스에 그려 캐싱하고, 매 프레임에는 그 캐시를 한 번에 그대로
               붙여넣은 뒤 반짝이는 사원 마커와 플레이어 점 같은 "실제로 매 프레임
               바뀌는" 요소만 추가로 그린다. */
            /* 전투 화면 가장자리를 은은하게 어둡게 눌러(비네트) 중앙의 포켓몬에
               시선이 모이게 한다. 실제 게임의 전투 화면 연출 특유의 "무대 조명" 느낌. */
            renderBattleVignette() {
                const W = this.canvas.width, H = this.canvas.height;
                const ctx = this.ctx;
                ctx.save();
                const v = ctx.createRadialGradient(W / 2, H * 0.42, H * 0.30, W / 2, H * 0.42, H * 0.86);
                v.addColorStop(0, 'rgba(0,0,0,0)');
                v.addColorStop(1, 'rgba(0,0,0,0.42)');
                ctx.fillStyle = v;
                ctx.fillRect(0, 0, W, H);
                ctx.restore();
            }

            /* ==========================================================================
               11-S. 오버월드 포스트프로세싱 셰이더
               필드 화면은 2D 캔버스에 그려지지만, 그 결과를 그대로 화면에 내보내는 대신
               텍스처로 삼아 WebGL 프래그먼트 셰이더를 한 번 통과시킨다. 배틀용으로 이미
               만들어 둔 Three.js 렌더러(#threeCanvas)를 그대로 재사용하므로 추가 컨텍스트가
               생기지 않는다.

               셰이더가 하는 일
                 · 시간대 색보정 - 새벽의 보랏빛 / 한낮의 맑음 / 노을의 주황 / 한밤의 청색
                 · 블룸 - 물빛 반짝임·가로등·용암 균열처럼 밝은 부분만 부드럽게 번진다
                 · 박명 태양광 산란(갓레이) - 해가 낮게 뜬 시간대에 빛줄기가 비친다
                 · 야간 랜턴 - 플레이어 주변만 따뜻하게 밝아진다
                 · 비네트 / 색수차 / 필름 그레인 - 화면 가장자리를 눌러 중앙에 시선을 모은다
                 · 아지랑이 - 쾌청한 날 공기가 일렁인다
               ========================================================================== */
            initFieldPostFx() {
                if (!this.renderer3D || typeof THREE === 'undefined' || !THREE.ShaderMaterial) return;
                try {
                    const W = this.canvas.width, H = this.canvas.height;

                    /* 셰이더는 "화면 전체를 다시 그리는" 방식 대신 "빛만 더하는" 방식을 쓴다.
                       2D 필드 화면을 통째로 GPU에 올려 전 픽셀을 다시 칠하면, 매 프레임
                       900x650짜리 텍스처 업로드 + 풀스크린 셰이딩이 고정 비용으로 들어가
                       내장 그래픽에서는 그것만으로도 프레임이 반토막 난다(실측: 60 → 24fps).
                       대신 화면을 1/4 크기로 줄여 올린 뒤(=픽셀 수 1/16), 그 위에서
                       블룸·빛줄기·랜턴 같은 "더해지는 빛"만 만들어 mix-blend-mode: screen으로
                       원본 위에 얹는다. 어두워지는 쪽(밤 암전·시간대 색조·비네트)은 원래대로
                       2D 캔버스가 담당한다. 결과는 거의 같은데 비용은 10분의 1 수준이다. */
                    const sw = Math.max(1, Math.round(W / 6)), sh = Math.max(1, Math.round(H / 6));
                    this.fxSourceCanvas = document.createElement('canvas');
                    this.fxSourceCanvas.width = sw;
                    this.fxSourceCanvas.height = sh;
                    this.fxSourceCtx = this.fxSourceCanvas.getContext('2d');
                    this.fxSourceCtx.imageSmoothingEnabled = true;

                    this.fieldTexture = new THREE.CanvasTexture(this.fxSourceCanvas);
                    this.fieldTexture.minFilter = THREE.LinearFilter;
                    this.fieldTexture.magFilter = THREE.LinearFilter;
                    this.fieldTexture.wrapS = THREE.ClampToEdgeWrapping;
                    this.fieldTexture.wrapT = THREE.ClampToEdgeWrapping;
                    this.fieldTexture.generateMipmaps = false;

                    this.postUniforms = {
                        tScene:    { value: this.fieldTexture },
                        uTexel:    { value: new THREE.Vector2(1 / sw, 1 / sh) },
                        uAspect:   { value: W / H },
                        uTime:     { value: 0 },
                        uThreshold:{ value: 0.72 },
                        uBloom:    { value: 0.55 },
                        uShaft:    { value: 0 },
                        uSunPos:   { value: new THREE.Vector2(0.5, 1.15) },
                        uSunColor: { value: new THREE.Color(1.0, 0.82, 0.55) },
                        uNight:    { value: 0 },
                        uPlayer:   { value: new THREE.Vector2(0.5, 0.5) },
                        uLamp:     { value: new THREE.Color(1.0, 0.84, 0.56) },
                        uWarm:     { value: new THREE.Color(1.0, 0.86, 0.66) },
                        uWarmAmt:  { value: 0 }
                    };

                    const vert = `
                        varying vec2 vUv;
                        void main() {
                            vUv = uv;
                            gl_Position = vec4(position.xy, 0.0, 1.0);
                        }`;

                    const frag = `
                        precision mediump float;
                        varying vec2 vUv;
                        uniform sampler2D tScene;
                        uniform vec2 uTexel;
                        uniform float uAspect;
                        uniform float uTime;
                        uniform float uThreshold;
                        uniform float uBloom;
                        uniform float uShaft;
                        uniform vec2 uSunPos;
                        uniform vec3 uSunColor;
                        uniform float uNight;
                        uniform vec2 uPlayer;
                        uniform vec3 uLamp;
                        uniform vec3 uWarm;
                        uniform float uWarmAmt;

                        float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

                        vec3 bright(vec2 uv) {
                            vec3 s = texture2D(tScene, uv).rgb;
                            return s * max(0.0, luma(s) - uThreshold);
                        }

                        // 빛줄기용 - 블룸보다 훨씬 높은 문턱을 써서 정말 눈부신 곳에서만 뻗어 나온다
                        vec3 sparkle(vec2 uv) {
                            vec3 s = texture2D(tScene, uv).rgb;
                            return s * max(0.0, luma(s) - 0.90) * 4.0;
                        }

                        void main() {
                            vec3 light = vec3(0.0);

                            // 1) 블룸 - 물빛 반짝임, 가로등, 용암 균열처럼 밝은 부분이 부드럽게 번진다
                            if (uBloom > 0.001) {
                                vec3 glow = bright(vUv) * 1.6;
                                for (int i = 0; i < 8; i++) {
                                    float a = float(i) * 0.7853982;
                                    vec2 d = vec2(cos(a), sin(a)) * uTexel;
                                    glow += bright(vUv + d * 1.6);
                                    glow += bright(vUv + d * 3.6) * 0.55;
                                }
                                light += glow * (uBloom / 13.0) * 2.1;
                            }

                            // 2) 빛줄기 - 해가 낮게 뜬 새벽·노을에 밝은 곳에서 빛이 뻗어 나온다
                            if (uShaft > 0.001) {
                                vec2 dir = (uSunPos - vUv) * 0.13;
                                vec2 p = vUv;
                                float w = 1.0;
                                vec3 shafts = vec3(0.0);
                                for (int k = 0; k < 8; k++) {
                                    p += dir;
                                    shafts += sparkle(p) * w;
                                    w *= 0.78;
                                }
                                light += shafts * uSunColor * uShaft * 0.16;
                            }

                            // 3) 야간 랜턴 - 플레이어 주변만 따뜻하게 밝아진다 (은은하게 맥동)
                            if (uNight > 0.001) {
                                vec2 d = (vUv - uPlayer) * vec2(uAspect, 1.0);
                                float flicker = 0.94 + 0.06 * sin(uTime * 3.1) * sin(uTime * 1.7);
                                float lantern = smoothstep(0.23, 0.02, length(d)) * flicker;
                                light += uLamp * lantern * uNight * 0.34;
                            }

                            gl_FragColor = vec4(clamp(light, 0.0, 1.0), 1.0);
                        }`;

                    this.postScene = new THREE.Scene();
                    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
                    this.postMaterial = new THREE.ShaderMaterial({
                        uniforms: this.postUniforms, vertexShader: vert, fragmentShader: frag,
                        depthTest: false, depthWrite: false
                    });
                    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial));

                    // 빛 레이어는 흐릿해도 티가 나지 않으므로 절반 해상도로 그린다
                    this.postFxWidth = Math.round(W / 2);
                    this.postFxHeight = Math.round(H / 2);
                    // 빛은 천천히 변하므로 매 프레임 갱신할 필요가 없다. 한 프레임 걸러
                    // 갱신해도 눈으로는 구분되지 않지만 비용은 절반이 된다.
                    this._postFxTick = 0;

                    this.postFxReady = true;
                    this.postFxEnabled = true;
                    this._postFxFrames = 0;
                    this._postFxT0 = 0;
                    this._postFxAutoTuned = false;
                } catch (e) {
                    this.postFxReady = false;
                    this.postFxEnabled = false;
                }
            }

            /* 포스트프로세싱이 켜져 있는지 - 필드 상태에서만 동작한다 */
            isFieldPostFxActive() {
                return !!(this.postFxReady && this.postFxEnabled && this.state === GAME_STATES.FIELD && !this.titleScreenActive);
            }

            /* 아주 느린 기기에서 셰이더가 프레임을 잡아먹으면 자동으로 끈다.
               (자동으로 다시 켜지는 않는다 - 사용자가 [T]로 직접 켤 때까지 유지) */
            autoTunePostFx() {
                if (this._postFxAutoTuned) return;
                const now = performance.now();
                if (!this._postFxT0) { this._postFxT0 = now; this._postFxFrames = 0; return; }
                this._postFxFrames++;
                const elapsed = now - this._postFxT0;
                if (elapsed < 2000) return;

                const fps = this._postFxFrames / (elapsed / 1000);
                this._postFxT0 = now;
                this._postFxFrames = 0;
                this._postFxAutoTuned = true;

                if (fps < 30) {
                    this.postFxEnabled = false;
                    this.syncFieldPostFxVisibility();
                    showToast('⚙️ 이 기기에서는 화면 효과가 무거워 껐습니다. ([T]로 다시 켜기)');
                }
            }

            /* 매 프레임 필드 화면의 축소본을 셰이더에 넘겨 "빛 레이어"를 만들어 덮는다 */
            renderFieldPostFx(playerScreenX, playerScreenY) {
                if (!this.isFieldPostFxActive()) return;

                const phase = this.timePhase || sampleTimePhase(this.timeOfDay || 0.42);
                const u = this.postUniforms;
                const W = this.canvas.width, H = this.canvas.height;

                u.uTime.value = performance.now() / 1000;
                u.uNight.value = Math.max(0, Math.min(1, (phase.alpha - 0.24) / 0.34));

                // 플레이어 화면 위치 (UV 좌표계는 위아래가 뒤집혀 있다)
                u.uPlayer.value.set(
                    (playerScreenX + TILE_SIZE / 2) / W,
                    1.0 - (playerScreenY + TILE_SIZE / 2) / H
                );

                // 박명(새벽/노을)에 가장 강한 빛줄기 - 해는 시간에 따라 좌우로 이동한다
                const t = this.timeOfDay || 0.42;
                const lowSun = Math.max(0, Math.min(1, Math.max(
                    1 - Math.abs(t - 0.29) / 0.11,
                    1 - Math.abs(t - 0.73) / 0.11
                )));
                u.uShaft.value = lowSun * 0.95;
                u.uWarmAmt.value = lowSun;
                u.uSunPos.value.set(t < 0.5 ? 0.10 : 0.90, 1.05);
                if (t < 0.5) { u.uSunColor.value.setRGB(1.0, 0.80, 0.52); u.uWarm.value.setRGB(1.0, 0.84, 0.62); }
                else { u.uSunColor.value.setRGB(1.0, 0.60, 0.40); u.uWarm.value.setRGB(1.0, 0.70, 0.50); }

                // 날씨 연동 - 쾌청하면 빛이 강하고, 비/모래바람에는 흐릿해진다
                const weather = WEATHERS[this.weatherIdx] || '';
                let bloom = 0.5;
                if (weather.indexOf('쾌청') >= 0) bloom = 0.85;
                else if (weather.indexOf('맑음') >= 0) bloom = 0.55;
                else if (weather.indexOf('비') >= 0) bloom = 0.28;
                else if (weather.indexOf('눈') >= 0) bloom = 0.70;
                else if (weather.indexOf('모래') >= 0) bloom = 0.34;
                u.uBloom.value = bloom;
                u.uThreshold.value = 0.72 - u.uNight.value * 0.14; // 밤에는 불빛만 살짝 더 번지게

                // 1/4 크기 축소본을 만들어 텍스처로 올린다 (업로드 비용이 1/16로 줄어든다)
                // 한 프레임 걸러 한 번만 갱신한다 (빛 레이어는 별도 캔버스라 그 사이에도
                // 화면에 그대로 남아 있으므로 깜빡이지 않는다)
                this._postFxTick = (this._postFxTick + 1) % 2;
                if (this._postFxTick === 0) {
                    this.fxSourceCtx.drawImage(this.canvas, 0, 0, this.fxSourceCanvas.width, this.fxSourceCanvas.height);
                    this.fieldTexture.needsUpdate = true;

                    if (this._rendererSize !== 'fx') {
                        this.renderer3D.setSize(this.postFxWidth, this.postFxHeight, false);
                        this._rendererSize = 'fx';
                    }
                    this.renderer3D.render(this.postScene, this.postCamera);
                }

                this.autoTunePostFx();
            }

            /* 빛 레이어(#threeCanvas)를 원본 위에 screen 합성으로 얹을지 전환한다.
               #gameCanvas는 계속 그대로 보이므로 도트 원본은 하나도 손상되지 않는다. */
            syncFieldPostFxVisibility() {
                const active = this.isFieldPostFxActive();
                if (active === this._postFxVisible) return;
                this._postFxVisible = active;
                if (this.state !== GAME_STATES.FIELD) return;
                this.threeCanvas.classList.toggle('fx-light-layer', active);
                this.threeCanvas.style.display = active ? 'block' : 'none';
                this.canvas.style.visibility = 'visible';
            }

            /* [T] 키 - 셰이더 켜기/끄기 (도트 원본 그대로 보고 싶은 사람을 위해) */
            toggleFieldPostFx() {
                if (!this.postFxReady) {
                    showToast('이 환경에서는 셰이더를 사용할 수 없습니다.');
                    return;
                }
                this.postFxEnabled = !this.postFxEnabled;
                if (this.postFxEnabled) {
                    this._postFxAutoTuned = false;
                    this._postFxT0 = 0;
                    this._postFxFrames = 0;
                }
                this.syncFieldPostFxVisibility();
                showToast(this.postFxEnabled ? '✨ 화면 효과(셰이더) 켜짐' : '화면 효과(셰이더) 꺼짐 - 원본 도트 화면');
                playSfx('menu');
                this.saveGame(true);
            }

            /* ==========================================================================
               11-L. 살아있는 오버월드 - 지형·시간대별 생물/입자 연출
               지형을 아무리 촘촘히 그려도 화면 안에서 아무것도 움직이지 않으면 배경
               그림처럼 보인다. 서 있는 지형과 시간대에 맞춰 나비·반딧불이·꽃잎·낙엽·
               불티·눈꽃·모래바람·잠자리 같은 것들을 끊임없이 흘려보내 화면이 살아 있게 한다.
               좌표는 월드 픽셀 기준이라 카메라가 움직이면 자연스럽게 함께 스크롤된다.
               ========================================================================== */
            updateAmbientLife(camX, camY) {
                if (!this.ambientFx) this.ambientFx = [];
                const T = TILE_TYPES;
                const W = this.canvas.width, H = this.canvas.height;
                const now = performance.now();
                const phase = this.timePhase || sampleTimePhase(this.timeOfDay || 0.42);
                const isNight = phase.alpha > 0.34;

                // --- 생성 ---
                const MAX = 38;
                if (this.ambientFx.length < MAX) {
                    const tries = 2;
                    for (let i = 0; i < tries; i++) {
                        // 화면보다 살짝 넓은 범위에서 생성해 가장자리에서 튀어나오지 않게 한다
                        const wx = camX - 40 + Math.random() * (W + 80);
                        const wy = camY - 40 + Math.random() * (H + 80);
                        const tc = Math.floor(wx / TILE_SIZE), tr = Math.floor(wy / TILE_SIZE);
                        if (tr < 0 || tc < 0 || tr >= MAP_ROWS || tc >= MAP_COLS) continue;
                        const tile = this.worldMap[tr][tc];

                        let kind = null, chance = 0;
                        if (isNight) {
                            // 밤에는 대부분의 육지에 반딧불이가 떠다닌다
                            if (tile === T.GRASS || tile === T.TALL_GRASS || tile === T.FOREST ||
                                tile === T.FLOWER || tile === T.CHERRY || tile === T.BAMBOO ||
                                tile === T.SWAMP || tile === T.TOWN) { kind = 'firefly'; chance = 0.30; }
                            else if (tile === T.VOLCANO) { kind = 'ember'; chance = 0.35; }
                            else if (tile === T.SNOW || tile === T.ICE_FIELD) { kind = 'sparkle'; chance = 0.18; }
                        } else {
                            switch (tile) {
                                case T.FLOWER: kind = Math.random() < 0.55 ? 'butterfly' : 'pollen'; chance = 0.34; break;
                                case T.GRASS: kind = 'butterfly'; chance = 0.10; break;
                                case T.TALL_GRASS: kind = Math.random() < 0.5 ? 'butterfly' : 'pollen'; chance = 0.13; break;
                                case T.CHERRY: kind = 'petal'; chance = 0.40; break;
                                case T.FOREST: case T.BAMBOO: kind = 'leaf'; chance = 0.22; break;
                                case T.VOLCANO: kind = 'ember'; chance = 0.34; break;
                                case T.SNOW: case T.ICE_FIELD: kind = 'sparkle'; chance = 0.20; break;
                                case T.SAND: case T.WASTELAND: case T.BEACH: kind = 'dust'; chance = 0.22; break;
                                case T.WATER: case T.SWAMP: kind = 'dragonfly'; chance = 0.16; break;
                                case T.RUINS: case T.CAVE: kind = 'mote'; chance = 0.16; break;
                                default: break;
                            }
                        }
                        if (!kind || Math.random() > chance) continue;

                        const life = 2600 + Math.random() * 3200;
                        const p = { kind, wx, wy, born: now, life, seed: Math.random() * 6.28, vx: 0, vy: 0, glow: false };
                        switch (kind) {
                            case 'firefly': p.vx = (Math.random() - 0.5) * 11; p.vy = (Math.random() - 0.5) * 9; p.glow = true; break;
                            case 'butterfly': p.vx = (Math.random() - 0.5) * 34; p.vy = (Math.random() - 0.5) * 24; break;
                            case 'petal': p.vx = -8 - Math.random() * 16; p.vy = 16 + Math.random() * 14; break;
                            case 'leaf': p.vx = -10 - Math.random() * 18; p.vy = 12 + Math.random() * 12; break;
                            case 'ember': p.vx = (Math.random() - 0.5) * 12; p.vy = -22 - Math.random() * 20; p.glow = true; break;
                            case 'sparkle': p.vx = (Math.random() - 0.5) * 6; p.vy = -3 - Math.random() * 5; p.glow = true; p.life = 1100 + Math.random() * 900; break;
                            case 'dust': p.vx = 34 + Math.random() * 40; p.vy = (Math.random() - 0.5) * 8; break;
                            case 'dragonfly': p.vx = (Math.random() - 0.5) * 70; p.vy = (Math.random() - 0.5) * 34; break;
                            case 'pollen': p.vx = (Math.random() - 0.5) * 8; p.vy = -6 - Math.random() * 8; p.glow = true; break;
                            case 'mote': p.vx = (Math.random() - 0.5) * 6; p.vy = -4 - Math.random() * 6; p.glow = true; break;
                        }
                        this.ambientFx.push(p);
                    }
                }

                // --- 이동 / 수명 ---
                const dt = Math.min(0.05, (now - (this._ambientLast || now)) / 1000);
                this._ambientLast = now;
                for (let i = this.ambientFx.length - 1; i >= 0; i--) {
                    const p = this.ambientFx[i];
                    const age = now - p.born;
                    if (age > p.life) { this.ambientFx.splice(i, 1); continue; }
                    const t = age / 1000;

                    if (p.kind === 'butterfly') {
                        p.wx += (p.vx + Math.sin(t * 3.1 + p.seed) * 26) * dt;
                        p.wy += (p.vy + Math.cos(t * 2.3 + p.seed) * 20) * dt;
                    } else if (p.kind === 'firefly') {
                        p.wx += (p.vx + Math.sin(t * 1.3 + p.seed) * 9) * dt;
                        p.wy += (p.vy + Math.cos(t * 1.1 + p.seed) * 8) * dt;
                    } else if (p.kind === 'petal' || p.kind === 'leaf') {
                        p.wx += (p.vx + Math.sin(t * 2.0 + p.seed) * 22) * dt;
                        p.wy += p.vy * dt;
                    } else if (p.kind === 'dragonfly') {
                        p.wx += (p.vx + Math.sin(t * 5.5 + p.seed) * 30) * dt;
                        p.wy += (p.vy + Math.cos(t * 4.4 + p.seed) * 18) * dt;
                    } else {
                        p.wx += (p.vx + Math.sin(t * 1.7 + p.seed) * 7) * dt;
                        p.wy += p.vy * dt;
                    }

                    // 화면에서 한참 벗어나면 바로 정리한다
                    const sx = p.wx - camX, sy = p.wy - camY;
                    if (sx < -90 || sy < -90 || sx > W + 90 || sy > H + 90) this.ambientFx.splice(i, 1);
                }
            }

            /* glowPass=false : 시간대 암전 이전에 그리는 평범한 생물(나비/꽃잎/낙엽 등)
               glowPass=true  : 암전 이후에 그려 밤에도 빛나는 것들(반딧불이/불티/눈꽃)
                                → 셰이더 블룸을 타고 실제로 반짝인다 */
            renderAmbientLife(camX, camY, glowPass) {
                if (!this.ambientFx || !this.ambientFx.length) return;
                const ctx = this.ctx;
                const now = performance.now();
                const TAU = Math.PI * 2;

                ctx.save();
                for (const p of this.ambientFx) {
                    if (!!p.glow !== !!glowPass) continue;
                    const x = p.wx - camX, y = p.wy - camY;
                    const age = now - p.born;
                    const k = age / p.life;
                    const fade = Math.min(1, Math.min(k / 0.12, (1 - k) / 0.22));
                    if (fade <= 0) continue;
                    const t = age / 1000;
                    ctx.globalAlpha = fade;

                    switch (p.kind) {
                        case 'butterfly': {
                            const flap = Math.abs(Math.sin(t * 11 + p.seed));
                            const wing = 3.0 + flap * 4.6;
                            const col = ['#fde68a', '#fca5a5', '#bfdbfe', '#f5d0fe'][Math.floor(p.seed * 4) % 4];
                            // 바닥 그림자 - 꽃밭처럼 어수선한 바닥 위에서도 "떠 있다"는 게 읽힌다
                            ctx.fillStyle = 'rgba(0,0,0,0.18)';
                            ctx.beginPath(); ctx.ellipse(x + 2, y + 11, 5.5, 2, 0, 0, TAU); ctx.fill();
                            ctx.strokeStyle = 'rgba(40,30,25,0.5)';
                            ctx.lineWidth = 1;
                            ctx.fillStyle = col;
                            ctx.beginPath(); ctx.ellipse(x - 3.2, y, wing, 4.2, -0.5, 0, TAU); ctx.fill(); ctx.stroke();
                            ctx.beginPath(); ctx.ellipse(x + 3.2, y, wing, 4.2, 0.5, 0, TAU); ctx.fill(); ctx.stroke();
                            ctx.fillStyle = 'rgba(55,38,28,0.9)';
                            ctx.fillRect(x - 0.8, y - 3, 1.6, 6.2);
                            break;
                        }
                        case 'petal': {
                            ctx.save();
                            ctx.translate(x, y);
                            ctx.rotate(t * 3.4 + p.seed);
                            ctx.fillStyle = ['#ffc2d6', '#ffe3ec', '#f9a8c8'][Math.floor(p.seed * 3) % 3];
                            ctx.beginPath(); ctx.ellipse(0, 0, 3.4, 2.0, 0, 0, TAU); ctx.fill();
                            ctx.restore();
                            break;
                        }
                        case 'leaf': {
                            ctx.save();
                            ctx.translate(x, y);
                            ctx.rotate(t * 2.6 + p.seed);
                            ctx.fillStyle = ['#7fa855', '#a3b545', '#c98f3f'][Math.floor(p.seed * 3) % 3];
                            ctx.beginPath(); ctx.ellipse(0, 0, 4.4, 1.9, 0, 0, TAU); ctx.fill();
                            ctx.strokeStyle = 'rgba(60,80,40,0.6)';
                            ctx.lineWidth = 0.8;
                            ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.stroke();
                            ctx.restore();
                            break;
                        }
                        case 'dust': {
                            ctx.fillStyle = 'rgba(214,190,150,0.55)';
                            ctx.beginPath(); ctx.ellipse(x, y, 7 + Math.sin(t * 6 + p.seed) * 2, 1.6, 0, 0, TAU); ctx.fill();
                            break;
                        }
                        case 'dragonfly': {
                            const flap = Math.abs(Math.sin(t * 26 + p.seed));
                            ctx.strokeStyle = 'rgba(190,235,255,0.75)';
                            ctx.lineWidth = 1;
                            ctx.beginPath();
                            ctx.moveTo(x - 6, y - 1.5 - flap * 2); ctx.lineTo(x + 6, y - 1.5 - flap * 2);
                            ctx.stroke();
                            ctx.fillStyle = '#3fa9c9';
                            ctx.fillRect(x - 4, y - 0.6, 8, 1.6);
                            break;
                        }
                        case 'firefly': {
                            const blink = 0.35 + 0.65 * Math.pow(Math.abs(Math.sin(t * 2.1 + p.seed)), 2.5);
                            const spr = this.glowSprites && this.glowSprites.firefly;
                            if (spr) {
                                ctx.globalAlpha = fade * blink;
                                ctx.drawImage(spr, x - 10, y - 10, 20, 20);
                                ctx.globalAlpha = fade;
                            }
                            ctx.fillStyle = `rgba(245,255,215,${blink.toFixed(3)})`;
                            ctx.beginPath(); ctx.arc(x, y, 1.5, 0, TAU); ctx.fill();
                            break;
                        }
                        case 'ember': {
                            const spr = this.glowSprites && this.glowSprites.ember;
                            if (spr) ctx.drawImage(spr, x - 8, y - 8, 16, 16);
                            break;
                        }
                        case 'sparkle': {
                            const tw = Math.abs(Math.sin(t * 6 + p.seed));
                            ctx.fillStyle = `rgba(255,255,255,${(0.9 * tw).toFixed(3)})`;
                            const r = 1.2 + tw * 3.2;
                            ctx.fillRect(x - r, y - 0.5, r * 2, 1);
                            ctx.fillRect(x - 0.5, y - r, 1, r * 2);
                            break;
                        }
                        case 'pollen': case 'mote': {
                            const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.9 + p.seed));
                            const spr = this.glowSprites && this.glowSprites[p.kind];
                            if (spr) {
                                ctx.globalAlpha = fade * tw;
                                ctx.drawImage(spr, x - 6, y - 6, 12, 12);
                            }
                            break;
                        }
                    }
                }
                ctx.restore();
            }

            /* 발자국 먼지 / 수풀 흔들림 - 걸을 때마다 발밑에서 지형에 맞는 반응이 일어난다 */
            spawnFootstepFx() {
                const tile = (this.worldMap[this.player.y] || [])[this.player.x];
                const T = TILE_TYPES;
                if (!this.ambientFx) this.ambientFx = [];
                const wx = this.player.x * TILE_SIZE + TILE_SIZE / 2;
                const wy = this.player.y * TILE_SIZE + TILE_SIZE - 6;
                const now = performance.now();

                let kind = null;
                if (tile === T.SAND || tile === T.BEACH || tile === T.WASTELAND || tile === T.PATH) kind = 'dust';
                else if (tile === T.SNOW || tile === T.ICE_FIELD) kind = 'sparkle';
                else if (tile === T.WATER || tile === T.SWAMP) kind = 'dragonfly';
                if (!kind) return;

                for (let i = 0; i < (kind === 'dust' ? 2 : 1); i++) {
                    this.ambientFx.push({
                        kind: kind === 'dragonfly' ? 'sparkle' : kind,
                        wx: wx + (Math.random() - 0.5) * 14,
                        wy: wy + (Math.random() - 0.5) * 6,
                        born: now, life: 520 + Math.random() * 320,
                        seed: Math.random() * 6.28,
                        vx: (Math.random() - 0.5) * 22, vy: -6 - Math.random() * 10,
                        glow: kind !== 'dust'
                    });
                }
            }

            /* 수풀 위를 걸을 때 발밑의 풀이 좌우로 흔들린다 */
            drawGrassRustle(px, py) {
                const tile = (this.worldMap[this.player.y] || [])[this.player.x];
                if (tile !== TILE_TYPES.TALL_GRASS && tile !== TILE_TYPES.FLOWER) return;
                const ctx = this.ctx;
                const t = performance.now() / 120;
                const moving = !!(this.heldMoveKeys && this.heldMoveKeys.size);
                const amp = moving ? 3.2 : 1.1;
                const P = FIELD_PALETTE.tall;
                ctx.save();
                ctx.strokeStyle = tile === TILE_TYPES.FLOWER ? '#9ad97a' : P.tip;
                ctx.lineWidth = 1.6;
                ctx.lineCap = 'round';
                ctx.globalAlpha = 0.9;
                for (let i = 0; i < 7; i++) {
                    const bx = px + 5 + i * 4.6;
                    const by = py + TILE_SIZE - 3;
                    const sway = Math.sin(t + i * 1.1) * amp;
                    ctx.beginPath();
                    ctx.moveTo(bx, by);
                    ctx.quadraticCurveTo(bx + sway * 0.5, by - 6, bx + sway, by - 11);
                    ctx.stroke();
                }
                ctx.restore();
            }

            /* 필드 화면 가장자리를 아주 은은하게 눌러 중앙에 시선을 모은다.
               전투 화면 비네트보다 훨씬 약하게 적용해 탐험 시야를 가리지 않는다. */
            renderFieldVignette() {
                const W = this.canvas.width, H = this.canvas.height;
                const ctx = this.ctx;
                ctx.save();
                const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.92);
                v.addColorStop(0, 'rgba(0,0,0,0)');
                v.addColorStop(1, 'rgba(8,10,20,0.30)');
                ctx.fillStyle = v;
                ctx.fillRect(0, 0, W, H);
                ctx.restore();
            }

            /* 하루 주기에 따른 화면 색조 + 야간 시야 연출 */
            renderTimeOfDayOverlay(px, py) {
                // 어두워지는 연출(시간대 색조·야간 암전)은 2D 쪽이 담당하고,
                // 밝아지는 연출(블룸·빛줄기·랜턴 불빛)은 셰이더 빛 레이어가 담당한다.
                // 셰이더가 켜져 있으면 랜턴 하이라이트가 중복되므로 그 부분만 뺀다.
                const shaderOn = this.isFieldPostFxActive();
                const phase = this.timePhase || sampleTimePhase(this.timeOfDay || 0.42);
                if (phase.alpha <= 0.005) return;

                const W = this.canvas.width, H = this.canvas.height;
                const [r, g, b] = phase.tint;

                this.ctx.save();
                this.ctx.globalCompositeOperation = 'source-over';

                if (phase.alpha > 0.30) {
                    // 어두운 시간대: 플레이어 주변을 뚫어놓은 라디얼 암전
                    const grad = this.ctx.createRadialGradient(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 24,
                                                               px + TILE_SIZE / 2, py + TILE_SIZE / 2, 250);
                    grad.addColorStop(0, `rgba(${r},${g},${b},${(phase.alpha * 0.18).toFixed(3)})`);
                    grad.addColorStop(0.45, `rgba(${r},${g},${b},${(phase.alpha * 0.62).toFixed(3)})`);
                    grad.addColorStop(1, `rgba(${r},${g},${b},${phase.alpha.toFixed(3)})`);
                    this.ctx.fillStyle = grad;
                    this.ctx.fillRect(0, 0, W, H);

                    // 플레이어 발밑의 은은한 등불 하이라이트 (셰이더가 켜져 있으면 생략)
                    if (!shaderOn) {
                        const lamp = this.ctx.createRadialGradient(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 0,
                                                                   px + TILE_SIZE / 2, py + TILE_SIZE / 2, 96);
                        lamp.addColorStop(0, 'rgba(255, 224, 150, 0.22)');
                        lamp.addColorStop(1, 'rgba(255, 224, 150, 0)');
                        this.ctx.globalCompositeOperation = 'lighter';
                        this.ctx.fillStyle = lamp;
                        this.ctx.fillRect(0, 0, W, H);
                    }
                } else {
                    // 새벽/아침/노을: 화면 전체에 따뜻한 색을 얇게 덮어 시간대를 표현
                    this.ctx.fillStyle = `rgba(${r},${g},${b},${phase.alpha.toFixed(3)})`;
                    this.ctx.fillRect(0, 0, W, H);

                    // 해가 낮게 뜬 시간대의 빛 번짐 (셰이더가 켜져 있으면 빛줄기가 대신한다)
                    if (!shaderOn) {
                        const sun = this.ctx.createLinearGradient(0, 0, 0, H * 0.65);
                        sun.addColorStop(0, `rgba(255, 214, 140, ${(phase.alpha * 0.85).toFixed(3)})`);
                        sun.addColorStop(1, 'rgba(255, 214, 140, 0)');
                        this.ctx.globalCompositeOperation = 'lighter';
                        this.ctx.fillStyle = sun;
                        this.ctx.fillRect(0, 0, W, H);
                    }
                }

                this.ctx.restore();
            }

            buildMinimapBaseLayer() {
                const mw = this.minimapCanvas.width;
                const mh = this.minimapCanvas.height;
                const cellW = mw / MAP_COLS;
                const cellH = mh / MAP_ROWS;

                const base = document.createElement('canvas');
                base.width = mw;
                base.height = mh;
                const bctx = base.getContext('2d');

                // 맵이 640x640으로 넓어진 만큼 샘플 간격을 촘촘히 잡아야 미니맵이
                // 뭉개지지 않는다 (한 번만 굽는 정적 레이어라 비용은 문제되지 않는다).
                const step = Math.max(2, Math.round(MAP_ROWS / 160));
                for (let r = 0; r < MAP_ROWS; r += step) {
                    for (let c = 0; c < MAP_COLS; c += step) {
                        bctx.fillStyle = TILE_COLORS[this.worldMap[r][c]];
                        bctx.fillRect(c * cellW, r * cellH, cellW * step, cellH * step);
                    }
                }

                this.minimapBaseCanvas = base;
                this.minimapCellW = cellW;
                this.minimapCellH = cellH;
            }

            renderMinimap() {
                const mw = this.minimapCanvas.width;
                const mh = this.minimapCanvas.height;
                const cellW = this.minimapCellW;
                const cellH = this.minimapCellH;

                this.minimapCtx.clearRect(0, 0, mw, mh);
                this.minimapCtx.drawImage(this.minimapBaseCanvas, 0, 0);

                // 전설의 사원 위치를 미니맵에 반짝이는 별표로 강조 표시
                const templeBlink = Math.abs(Math.sin(Date.now() / 300));
                this.templeTileCoords.forEach(t => {
                    this.minimapCtx.fillStyle = `rgba(253, 224, 71, ${0.5 + templeBlink * 0.5})`;
                    this.minimapCtx.beginPath();
                    this.minimapCtx.arc(t.c * cellW, t.r * cellH, 3, 0, Math.PI * 2);
                    this.minimapCtx.fill();
                });

                // 마을 위치 표시 - 넓어진 맵에서 길을 잃지 않도록 주요 마을을 점으로 찍는다
                this.minimapCtx.fillStyle = 'rgba(255,255,255,0.9)';
                [{ r: 12, c: 12 }].concat(EXTRA_TOWN_SITES.map(t => ({ r: t.center[0], c: t.center[1] })))
                    .forEach(t => {
                        this.minimapCtx.fillRect(t.c * cellW - 1.5, t.r * cellH - 1.5, 3, 3);
                    });

                // 현재 화면에 보이는 범위를 사각형으로 표시 (넓은 맵에서 위치 감각용)
                const viewW = (this.canvas.width / TILE_SIZE) * cellW;
                const viewH = (this.canvas.height / TILE_SIZE) * cellH;
                this.minimapCtx.strokeStyle = 'rgba(255,255,255,0.75)';
                this.minimapCtx.lineWidth = 1;
                this.minimapCtx.strokeRect(
                    this.player.x * cellW - viewW / 2,
                    this.player.y * cellH - viewH / 2,
                    viewW, viewH
                );

                // 플레이어 - 밝은 점 + 발광 링
                const blink = 0.55 + Math.abs(Math.sin(Date.now() / 260)) * 0.45;
                this.minimapCtx.fillStyle = `rgba(56,189,248,${blink.toFixed(2)})`;
                this.minimapCtx.beginPath();
                this.minimapCtx.arc(this.player.x * cellW, this.player.y * cellH, 4.5, 0, Math.PI * 2);
                this.minimapCtx.fill();
                this.minimapCtx.fillStyle = '#ffffff';
                this.minimapCtx.fillRect(this.player.x * cellW - 1.5, this.player.y * cellH - 1.5, 3, 3);
            }

            /* ==========================================================================
               10-C. 스킬 애니메이션 시스템
               포켓몬마다 / 스킬 타입마다 다른 모션과 투사체 이펙트를 재생한 뒤,
               투사체가 상대에게 도달하는 순간 실제 데미지 처리(onImpact)를 실행한다.
               ========================================================================== */
            /* [버그 수정] 기술 이펙트와 몬스터볼이 날아가는 좌표가 (190,300)/(640,100)처럼
               통째로 하드코딩돼 있어서, 실제 포켓몬 스프라이트보다 한참 위쪽 허공으로
               날아갔다. 이제 매번 실제 스프라이트의 화면 위치를 재서 그 중심을 맞춘다.
               - canvas: 900x650 고정 해상도 캔버스 좌표계 (기술 이펙트/파티클용)
               - dom: CSS 레이아웃 좌표계 (DOM 요소인 몬스터볼용) */
            getSpriteAnchor(isPlayer) {
                const fallback = isPlayer ? { x: 250, y: 545 } : { x: 670, y: 215 };
                const area = document.getElementById('screen-area');
                const overlay = document.getElementById('battle-overlay');
                const img = document.getElementById(isPlayer ? 'player-sprite' : 'enemy-sprite');
                if (!area || !overlay || !img) return { canvas: fallback, dom: fallback };

                const ar = area.getBoundingClientRect();
                const ir = img.getBoundingClientRect();
                if (!ar.width || !ir.width) return { canvas: fallback, dom: fallback };

                const cx = ir.left + ir.width / 2 - ar.left;
                const cy = ir.top + ir.height / 2 - ar.top;
                const canvasPt = {
                    x: cx * (this.canvas.width / ar.width),
                    y: cy * (this.canvas.height / ar.height)
                };
                const oScale = (overlay.getBoundingClientRect().width || 1) / (overlay.offsetWidth || 1);
                return { canvas: canvasPt, dom: { x: cx / oScale, y: cy / oScale } };
            }

            playSkillAttackFx(attacker, move, onImpact) {
                const isPlayer = attacker === 'player';
                const boxEl = document.getElementById(isPlayer ? 'player-sprite-box' : 'enemy-sprite-box');

                // move는 기술 객체지만, 예전 호출부 호환을 위해 타입 문자열도 허용한다.
                const moveObj = (typeof move === 'string') ? { name: '', type: move } : (move || { name: '', type: '노말' });
                const fx = getMoveFx(moveObj);

                if (this.state === GAME_STATES.BATTLE && this.battleStageGroup3D && this.battleStageGroup3D.visible) {
                    this.triggerCameraPunch(isPlayer);
                }

                // 1) 기술마다 다른 시전 모션
                const motionClass = `fx-${fx.motion}-${isPlayer ? 'r' : 'l'}`;
                const allMotions = ['lunge', 'charge', 'spin', 'jump', 'shake', 'recoil', 'rise', 'stomp', 'glow']
                    .flatMap(m => [`fx-${m}-r`, `fx-${m}-l`]);
                boxEl.classList.remove(...allMotions);
                void boxEl.offsetWidth;
                boxEl.classList.add(motionClass);
                setTimeout(() => boxEl.classList.remove(motionClass), 620);

                // 2) 실제 스프라이트 위치를 기준으로 이펙트를 쏜다
                const selfPt = this.getSpriteAnchor(isPlayer).canvas;
                const foePt = this.getSpriteAnchor(!isPlayer).canvas;

                const fire = (idx) => {
                    playSfx('click');
                    this.skillEffects.push({
                        from: { x: selfPt.x, y: selfPt.y },
                        to: { x: foePt.x + (idx ? (idx % 2 ? 1 : -1) * (8 + idx * 5) : 0), y: foePt.y + (idx ? ((idx % 3) - 1) * 12 : 0) },
                        style: fx,
                        seed: idx * 1.7 + (isPlayer ? 0 : 3.1),
                        start: performance.now(),
                        duration: fx.duration,
                        impacted: false,
                        // 여러 발이 날아가는 기술은 마지막 한 발이 명중할 때만 데미지 처리
                        onImpact: idx === fx.count - 1 ? () => {
                            this.playMoveImpactFx(fx, foePt, isPlayer);
                            if (onImpact) onImpact();
                        } : () => this.playMoveImpactFx(fx, foePt, isPlayer, true)
                    });
                };

                const delayBase = fx.motion === 'charge' ? 120 : (fx.motion === 'rise' ? 260 : 190);
                for (let i = 0; i < fx.count; i++) {
                    setTimeout(() => fire(i), delayBase + i * Math.max(70, fx.duration * 0.22));
                }
            }

            /* 명중 순간 연출 - 기술의 hit 종류에 따라 다른 파편/섬광/화면 흔들림을 낸다 */
            playMoveImpactFx(fx, pt, isPlayerAttacking, minor) {
                const n = minor ? 8 : 18;
                switch (fx.hit) {
                    case 'blast':
                        this.spawnParticles(pt.x, pt.y, fx.glow);
                        this.spawnParticles(pt.x, pt.y, fx.color);
                        this.skillEffects.push({ burstAt: pt, kind: 'ring', style: fx, start: performance.now(), duration: 380, impacted: true });
                        if (!minor) this.triggerScreenShake('hard');
                        break;
                    case 'shatter':
                        this.spawnParticles(pt.x, pt.y, '#ffffff');
                        this.skillEffects.push({ burstAt: pt, kind: 'shards', style: fx, start: performance.now(), duration: 420, impacted: true });
                        if (!minor) this.triggerScreenShake('soft');
                        break;
                    case 'spark':
                        this.skillEffects.push({ burstAt: pt, kind: 'sparks', style: fx, start: performance.now(), duration: 320, impacted: true });
                        this.spawnParticles(pt.x, pt.y, fx.color);
                        break;
                    case 'slash':
                        this.skillEffects.push({ burstAt: pt, kind: 'slashmark', style: fx, start: performance.now(), duration: 300, impacted: true });
                        if (!minor) this.triggerScreenShake('soft');
                        break;
                    case 'crush':
                        this.spawnParticles(pt.x, pt.y, fx.color);
                        this.skillEffects.push({ burstAt: pt, kind: 'shock', style: fx, start: performance.now(), duration: 340, impacted: true });
                        if (!minor) this.triggerScreenShake('hard');
                        break;
                    case 'splash':
                        this.skillEffects.push({ burstAt: pt, kind: 'droplets', style: fx, start: performance.now(), duration: 380, impacted: true });
                        this.spawnParticles(pt.x, pt.y, fx.glow);
                        break;
                    case 'none':
                        break;
                    default:
                        this.spawnParticles(pt.x, pt.y, fx.color);
                        this.skillEffects.push({ burstAt: pt, kind: 'shock', style: fx, start: performance.now(), duration: 260, impacted: true });
                        break;
                }
            }

            /* 자기강화형 스킬(칼춤 등) 전용 연출: 상대에게 발사체를 보내는 대신
               시전자 스프라이트 자체가 노란 빛으로 두 번 맥동하며 파티클이 위로 솟구친다. */
            playStatBoostFx(attacker, move, onImpact) {
                // 예전 호출부 호환 (move 없이 콜백만 넘기던 형태)
                if (typeof move === 'function') { onImpact = move; move = null; }
                const isPlayer = attacker === 'player';
                const spriteEl = document.getElementById(isPlayer ? 'player-sprite' : 'enemy-sprite');
                const boxEl = document.getElementById(isPlayer ? 'player-sprite-box' : 'enemy-sprite-box');
                const pos = this.getSpriteAnchor(isPlayer).canvas;

                // 기술별 전용 자기강화 이펙트 (칼춤=회전하는 칼날, 오로라베일=오로라 커튼 …)
                const fx = move ? getMoveFx(move) : null;
                if (fx) {
                    const motionClass = `fx-${fx.motion}-${isPlayer ? 'r' : 'l'}`;
                    boxEl.classList.add(motionClass);
                    setTimeout(() => boxEl.classList.remove(motionClass), 680);
                    this.skillEffects.push({
                        from: { x: pos.x, y: pos.y }, to: { x: pos.x, y: pos.y },
                        style: fx, seed: 0, start: performance.now(),
                        duration: 620, impacted: false, onImpact: null
                    });
                }

                if (this.state === GAME_STATES.BATTLE && this.battleStageGroup3D && this.battleStageGroup3D.visible) {
                    this.triggerCameraPunch(isPlayer);
                }

                spriteEl.classList.remove('stat-boost-pulse');
                void spriteEl.offsetWidth;
                spriteEl.classList.add('stat-boost-pulse');

                const particleTimer = setInterval(() => {
                    this.spawnParticles(pos.x, pos.y, (fx && fx.glow) || '#fde047');
                }, 130);

                setTimeout(() => {
                    clearInterval(particleTimer);
                    spriteEl.classList.remove('stat-boost-pulse');
                    if (onImpact) onImpact();
                }, 620);
            }

            updateAndRenderSkillEffects() {
                const now = performance.now();
                for (let i = this.skillEffects.length - 1; i >= 0; i--) {
                    const fx = this.skillEffects[i];
                    const t = Math.min(1, (now - fx.start) / fx.duration);

                    // 명중 순간 폭발/파편 같은 "터지는" 이펙트
                    if (fx.burstAt) {
                        this.drawImpactBurst(fx.burstAt.x, fx.burstAt.y, fx.kind, fx.style, t);
                        if (t >= 1) this.skillEffects.splice(i, 1);
                        continue;
                    }

                    const dx = fx.to.x - fx.from.x;
                    const dy = fx.to.y - fx.from.y;
                    const seed = fx.seed || 0;
                    let x, y;

                    switch (fx.style.path) {
                        case 'line':
                            x = fx.from.x + dx * t;
                            y = fx.from.y + dy * t;
                            break;
                        case 'zigzag': {
                            const k = Math.sin(t * Math.PI * 6 + seed) * 22 * (1 - t * 0.4);
                            const len = Math.hypot(dx, dy) || 1;
                            x = fx.from.x + dx * t + (-dy / len) * k;
                            y = fx.from.y + dy * t + (dx / len) * k;
                            break;
                        }
                        case 'wave': {
                            const k = Math.sin(t * Math.PI * 2.4 + seed) * 34;
                            const len = Math.hypot(dx, dy) || 1;
                            x = fx.from.x + dx * t + (-dy / len) * k;
                            y = fx.from.y + dy * t + (dx / len) * k;
                            break;
                        }
                        case 'drop':
                            // 화면 위쪽에서 상대에게 수직으로 떨어진다
                            x = fx.to.x + Math.sin(seed) * 26 * (1 - t);
                            y = -50 + (fx.to.y + 50) * t;
                            break;
                        case 'ground':
                            // 지면을 타고 상대에게 밀려간다
                            x = fx.from.x + dx * t;
                            y = Math.max(fx.from.y, fx.to.y) + 26 - Math.abs(Math.sin(t * Math.PI)) * 6;
                            break;
                        case 'self':
                            x = fx.from.x;
                            y = fx.from.y;
                            break;
                        case 'burst':
                            x = fx.to.x;
                            y = fx.to.y;
                            break;
                        case 'beam':
                            // 빔은 좌표 대신 선 자체를 그린다
                            this.drawBeamEffect(fx, t);
                            x = null;
                            break;
                        default: { // arc
                            const arc = Math.sin(t * Math.PI) * 46;
                            x = fx.from.x + dx * t;
                            y = fx.from.y + dy * t - arc;
                        }
                    }

                    if (x !== null) this.drawSkillProjectile(x, y, fx.style, t, seed);

                    if (t >= 1 && !fx.impacted) {
                        fx.impacted = true;
                        if (fx.onImpact) fx.onImpact();
                        this.skillEffects.splice(i, 1);
                    }
                }
            }

            /* 화염방사·냉동빔·파괴광선처럼 "쭉 뻗는 광선" 계열 전용 렌더러 */
            drawBeamEffect(fx, t) {
                const ctx = this.ctx;
                const style = fx.style;
                // 0~0.25 충전 → 0.25~0.75 발사 유지 → 0.75~1 소멸
                const charge = Math.min(1, t / 0.25);
                const fade = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
                const reach = t < 0.25 ? 0 : Math.min(1, (t - 0.25) / 0.18);

                ctx.save();
                // 충전 코어
                const cg = ctx.createRadialGradient(fx.from.x, fx.from.y, 1, fx.from.x, fx.from.y, 8 + charge * 16);
                cg.addColorStop(0, style.glow);
                cg.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.globalAlpha = fade * (0.5 + charge * 0.5);
                ctx.fillStyle = cg;
                ctx.beginPath();
                ctx.arc(fx.from.x, fx.from.y, 8 + charge * 16, 0, Math.PI * 2);
                ctx.fill();

                if (reach > 0) {
                    const ex = fx.from.x + (fx.to.x - fx.from.x) * reach;
                    const ey = fx.from.y + (fx.to.y - fx.from.y) * reach;
                    const wob = Math.sin(t * 40) * 2;
                    ctx.lineCap = 'round';
                    ctx.globalAlpha = fade * 0.55;
                    ctx.strokeStyle = style.color;
                    ctx.lineWidth = (style.shape === 'solar' ? 30 : 20) + wob;
                    ctx.beginPath(); ctx.moveTo(fx.from.x, fx.from.y); ctx.lineTo(ex, ey); ctx.stroke();
                    ctx.globalAlpha = fade * 0.95;
                    ctx.strokeStyle = style.glow;
                    ctx.lineWidth = (style.shape === 'solar' ? 13 : 8) + wob * 0.5;
                    ctx.beginPath(); ctx.moveTo(fx.from.x, fx.from.y); ctx.lineTo(ex, ey); ctx.stroke();

                    // 빔 종류별 덧그림
                    if (style.shape === 'flamejet') {
                        ctx.globalAlpha = fade * 0.8;
                        for (let i = 0; i < 7; i++) {
                            const p = i / 7;
                            const px = fx.from.x + (ex - fx.from.x) * p;
                            const py = fx.from.y + (ey - fx.from.y) * p + Math.sin(t * 26 + i) * 7;
                            ctx.fillStyle = i % 2 ? '#fbbf24' : '#f97316';
                            ctx.beginPath();
                            ctx.arc(px, py, 10 - p * 3, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    } else if (style.shape === 'icebeam') {
                        ctx.globalAlpha = fade;
                        ctx.fillStyle = '#ffffff';
                        for (let i = 0; i < 6; i++) {
                            const p = i / 6;
                            const px = fx.from.x + (ex - fx.from.x) * p;
                            const py = fx.from.y + (ey - fx.from.y) * p;
                            ctx.save();
                            ctx.translate(px, py);
                            ctx.rotate(t * 8 + i);
                            for (let k = 0; k < 3; k++) {
                                ctx.rotate(Math.PI / 3);
                                ctx.fillRect(-1, -9, 2, 18);
                            }
                            ctx.restore();
                        }
                    } else if (style.shape === 'torrent') {
                        ctx.globalAlpha = fade * 0.7;
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 2;
                        for (let i = 0; i < 4; i++) {
                            ctx.beginPath();
                            for (let p = 0; p <= 1.001; p += 0.1) {
                                const px = fx.from.x + (ex - fx.from.x) * p;
                                const py = fx.from.y + (ey - fx.from.y) * p + Math.sin(p * 14 + t * 30 + i * 1.6) * 8;
                                p === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
                            }
                            ctx.stroke();
                        }
                    } else if (style.shape === 'darkwave') {
                        ctx.globalAlpha = fade * 0.6;
                        ctx.fillStyle = '#1e1b4b';
                        for (let i = 0; i < 5; i++) {
                            const p = i / 5;
                            const px = fx.from.x + (ex - fx.from.x) * p;
                            const py = fx.from.y + (ey - fx.from.y) * p;
                            ctx.beginPath();
                            ctx.ellipse(px, py, 16, 9, t * 6 + i, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    }

                    // 빔 끝 충격 섬광
                    ctx.globalAlpha = fade;
                    const hg = ctx.createRadialGradient(ex, ey, 1, ex, ey, 26);
                    hg.addColorStop(0, '#ffffff');
                    hg.addColorStop(0.4, style.glow);
                    hg.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = hg;
                    ctx.beginPath(); ctx.arc(ex, ey, 26, 0, Math.PI * 2); ctx.fill();
                }
                ctx.restore();
            }

            /* 명중 순간 터지는 연출들 */
            drawImpactBurst(x, y, kind, style, t) {
                const ctx = this.ctx;
                const TAU = Math.PI * 2;
                ctx.save();
                const fade = 1 - t;

                if (kind === 'ring') {
                    for (let i = 0; i < 3; i++) {
                        const rr = 10 + t * (60 + i * 18);
                        ctx.globalAlpha = fade * (0.8 - i * 0.22);
                        ctx.strokeStyle = i === 0 ? '#ffffff' : style.color;
                        ctx.lineWidth = 6 - i * 1.6;
                        ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
                    }
                    ctx.globalAlpha = fade * 0.9;
                    const g = ctx.createRadialGradient(x, y, 1, x, y, 40 * (1 - t * 0.5));
                    g.addColorStop(0, '#ffffff');
                    g.addColorStop(0.45, style.glow);
                    g.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = g;
                    ctx.beginPath(); ctx.arc(x, y, 40, 0, TAU); ctx.fill();
                } else if (kind === 'shards') {
                    ctx.globalAlpha = fade;
                    for (let i = 0; i < 10; i++) {
                        const a = (i / 10) * TAU;
                        const d = 12 + t * 56;
                        ctx.save();
                        ctx.translate(x + Math.cos(a) * d, y + Math.sin(a) * d);
                        ctx.rotate(a + t * 4);
                        ctx.fillStyle = i % 2 ? '#ffffff' : style.color;
                        ctx.beginPath();
                        ctx.moveTo(0, -9); ctx.lineTo(4, 0); ctx.lineTo(0, 9); ctx.lineTo(-4, 0);
                        ctx.closePath(); ctx.fill();
                        ctx.restore();
                    }
                } else if (kind === 'sparks') {
                    ctx.globalAlpha = fade;
                    ctx.strokeStyle = style.glow;
                    ctx.lineWidth = 2.5;
                    ctx.lineCap = 'round';
                    for (let i = 0; i < 9; i++) {
                        const a = (i / 9) * TAU + t * 2;
                        const d1 = 8 + t * 24, d2 = d1 + 16;
                        ctx.beginPath();
                        ctx.moveTo(x + Math.cos(a) * d1, y + Math.sin(a) * d1);
                        ctx.lineTo(x + Math.cos(a + 0.2) * d2, y + Math.sin(a + 0.2) * d2);
                        ctx.stroke();
                    }
                } else if (kind === 'slashmark') {
                    ctx.globalAlpha = fade;
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 5 * (1 - t * 0.5);
                    ctx.lineCap = 'round';
                    for (let i = 0; i < 2; i++) {
                        const off = i ? 14 : -14;
                        ctx.beginPath();
                        ctx.moveTo(x - 34 + off, y - 30);
                        ctx.lineTo(x + 30 + off, y + 30);
                        ctx.stroke();
                    }
                    ctx.strokeStyle = style.color;
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(x - 30, y + 26); ctx.lineTo(x + 34, y - 26);
                    ctx.stroke();
                } else if (kind === 'shock') {
                    ctx.globalAlpha = fade;
                    ctx.strokeStyle = style.color;
                    ctx.lineWidth = 4 * (1 - t);
                    for (let i = 0; i < 8; i++) {
                        const a = (i / 8) * TAU;
                        ctx.beginPath();
                        ctx.moveTo(x + Math.cos(a) * (6 + t * 10), y + Math.sin(a) * (6 + t * 10));
                        ctx.lineTo(x + Math.cos(a) * (18 + t * 40), y + Math.sin(a) * (18 + t * 40));
                        ctx.stroke();
                    }
                    ctx.globalAlpha = fade * 0.8;
                    ctx.fillStyle = '#ffffff';
                    ctx.beginPath(); ctx.arc(x, y, 14 * (1 - t), 0, TAU); ctx.fill();
                } else if (kind === 'droplets') {
                    ctx.globalAlpha = fade;
                    for (let i = 0; i < 12; i++) {
                        const a = -Math.PI / 2 + (i / 12 - 0.5) * 2.6;
                        const d = t * 70;
                        const px = x + Math.cos(a) * d;
                        const py = y + Math.sin(a) * d + t * t * 46;
                        ctx.fillStyle = i % 3 ? style.color : '#ffffff';
                        ctx.beginPath(); ctx.arc(px, py, 4.5 * (1 - t * 0.5), 0, TAU); ctx.fill();
                    }
                }
                ctx.restore();
            }

            drawSkillProjectile(x, y, style, t, seed) {
                const ctx = this.ctx;
                const TAU = Math.PI * 2;
                const shape = style.shape;
                seed = seed || 0;
                ctx.save();

                switch (shape) {
                    case 'fire': {
                        // 불꽃: 겹쳐진 주황/노랑 화염 덩어리 + 흔들리는 불티
                        for (let i = 0; i < 3; i++) {
                            const r = 12 - i * 3;
                            ctx.globalAlpha = 0.85 - i * 0.2;
                            ctx.fillStyle = i === 0 ? style.glow : style.color;
                            ctx.beginPath();
                            ctx.arc(x + Math.sin((t * 12) + i) * 3, y - i * 2, r, 0, Math.PI * 2);
                            ctx.fill();
                        }
                        break;
                    }
                    case 'water': {
                        // 물방울: 눈물 모양 (원 + 위로 뾰족한 삼각)
                        ctx.fillStyle = style.color;
                        ctx.globalAlpha = 0.85;
                        ctx.beginPath();
                        ctx.arc(x, y + 4, 9, 0, Math.PI * 2);
                        ctx.moveTo(x, y - 14);
                        ctx.lineTo(x - 7, y);
                        ctx.lineTo(x + 7, y);
                        ctx.closePath();
                        ctx.fill();
                        ctx.fillStyle = style.glow;
                        ctx.globalAlpha = 0.6;
                        ctx.beginPath();
                        ctx.arc(x - 3, y + 2, 3, 0, Math.PI * 2);
                        ctx.fill();
                        break;
                    }
                    case 'bolt': {
                        // 전기: 지그재그 번개 + 발광 코어
                        ctx.strokeStyle = style.color;
                        ctx.lineWidth = 3;
                        ctx.globalAlpha = 0.9;
                        ctx.beginPath();
                        ctx.moveTo(x - 14, y - 14);
                        ctx.lineTo(x - 2, y - 4);
                        ctx.lineTo(x - 10, y);
                        ctx.lineTo(x + 14, y + 14);
                        ctx.stroke();
                        ctx.fillStyle = style.glow;
                        ctx.beginPath();
                        ctx.arc(x, y, 6, 0, Math.PI * 2);
                        ctx.fill();
                        break;
                    }
                    case 'leaf': {
                        // 풀/벌레: 회전하는 나뭇잎 모양
                        ctx.translate(x, y);
                        ctx.rotate(t * Math.PI * 4);
                        ctx.fillStyle = style.color;
                        ctx.globalAlpha = 0.9;
                        ctx.beginPath();
                        ctx.ellipse(0, 0, 11, 5, 0, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.strokeStyle = style.glow;
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(-11, 0); ctx.lineTo(11, 0);
                        ctx.stroke();
                        break;
                    }
                    case 'ice': {
                        // 얼음: 반짝이는 육각 결정
                        ctx.translate(x, y);
                        ctx.rotate(t * Math.PI * 2);
                        ctx.fillStyle = style.color;
                        ctx.globalAlpha = 0.9;
                        ctx.beginPath();
                        for (let i = 0; i < 6; i++) {
                            const ang = (Math.PI / 3) * i;
                            const px = Math.cos(ang) * 10, py = Math.sin(ang) * 10;
                            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
                        }
                        ctx.closePath();
                        ctx.fill();
                        break;
                    }
                    case 'rock': {
                        // 땅/바위/강철: 회전하는 각진 돌덩이
                        ctx.translate(x, y);
                        ctx.rotate(t * Math.PI * 3);
                        ctx.fillStyle = style.color;
                        ctx.globalAlpha = 0.9;
                        ctx.beginPath();
                        ctx.moveTo(-9, -6); ctx.lineTo(6, -9); ctx.lineTo(9, 4); ctx.lineTo(-4, 9); ctx.lineTo(-9, -6);
                        ctx.closePath();
                        ctx.fill();
                        break;
                    }
                    case 'feather': {
                        // 비행: 스치듯 지나가는 깃털 궤적
                        ctx.strokeStyle = style.color;
                        ctx.lineWidth = 3;
                        ctx.globalAlpha = 0.8;
                        ctx.beginPath();
                        ctx.moveTo(x - 16, y + 6);
                        ctx.quadraticCurveTo(x, y - 12, x + 16, y - 6);
                        ctx.stroke();
                        break;
                    }
                    case 'fist': {
                        // 격투: 강한 임팩트 별 모양
                        ctx.translate(x, y);
                        ctx.rotate(t * Math.PI * 2);
                        ctx.fillStyle = style.color;
                        ctx.globalAlpha = 0.9;
                        ctx.beginPath();
                        for (let i = 0; i < 8; i++) {
                            const ang = (Math.PI / 4) * i;
                            const r = i % 2 === 0 ? 12 : 5;
                            const px = Math.cos(ang) * r, py = Math.sin(ang) * r;
                            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
                        }
                        ctx.closePath();
                        ctx.fill();
                        break;
                    }
                    // ===== 기술별 전용 이펙트 모양 (아래는 전부 신규 추가) =====
                    case 'dash': { // 몸통박치기/이판사판태클 - 돌진 잔상
                        ctx.globalAlpha = 0.85;
                        for (let i = 0; i < 4; i++) {
                            ctx.fillStyle = i === 0 ? '#ffffff' : style.color;
                            ctx.globalAlpha = 0.7 - i * 0.16;
                            ctx.beginPath();
                            ctx.ellipse(x - i * 13, y, 15 - i * 2.5, 9 - i * 1.4, 0, 0, TAU);
                            ctx.fill();
                        }
                        break;
                    }
                    case 'streak': { // 전광석화/신속 - 가느다란 속도선
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 4;
                        ctx.lineCap = 'round';
                        ctx.globalAlpha = 0.9;
                        for (let i = 0; i < 3; i++) {
                            ctx.beginPath();
                            ctx.moveTo(x - 46 - i * 10, y + (i - 1) * 9);
                            ctx.lineTo(x + 8, y + (i - 1) * 3);
                            ctx.stroke();
                        }
                        ctx.fillStyle = style.glow;
                        ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.fill();
                        break;
                    }
                    case 'claw': { // 할퀴기 - 세 줄기 발톱 자국
                        ctx.strokeStyle = style.glow;
                        ctx.lineWidth = 3.4;
                        ctx.lineCap = 'round';
                        ctx.globalAlpha = 0.95;
                        for (let i = 0; i < 3; i++) {
                            ctx.beginPath();
                            ctx.moveTo(x - 16 + i * 7, y - 20);
                            ctx.quadraticCurveTo(x + i * 6, y, x - 8 + i * 7, y + 20);
                            ctx.stroke();
                        }
                        break;
                    }
                    case 'comet': { // 기가임팩트/화룡점정 - 꼬리 달린 혜성
                        const g = ctx.createLinearGradient(x - 60, y, x + 14, y);
                        g.addColorStop(0, 'rgba(255,255,255,0)');
                        g.addColorStop(1, style.color);
                        ctx.fillStyle = g;
                        ctx.globalAlpha = 0.9;
                        ctx.beginPath();
                        ctx.moveTo(x - 62, y);
                        ctx.lineTo(x, y - 14);
                        ctx.lineTo(x, y + 14);
                        ctx.closePath();
                        ctx.fill();
                        ctx.fillStyle = '#ffffff';
                        ctx.beginPath(); ctx.arc(x, y, 12, 0, TAU); ctx.fill();
                        ctx.fillStyle = style.glow;
                        ctx.globalAlpha = 0.75;
                        ctx.beginPath(); ctx.arc(x, y, 18, 0, TAU); ctx.fill();
                        break;
                    }
                    case 'meteor': { // 플레어드라이브/용성군 - 불타는 운석
                        ctx.globalAlpha = 0.85;
                        for (let i = 0; i < 5; i++) {
                            ctx.fillStyle = i % 2 ? style.glow : style.color;
                            ctx.globalAlpha = 0.7 - i * 0.1;
                            ctx.beginPath();
                            ctx.arc(x - i * 9, y - i * 9, 14 - i * 2.2, 0, TAU);
                            ctx.fill();
                        }
                        ctx.globalAlpha = 1;
                        ctx.fillStyle = '#fff7ed';
                        ctx.beginPath(); ctx.arc(x, y, 8, 0, TAU); ctx.fill();
                        break;
                    }
                    case 'sacredfire': { // 성스러운불꽃 - 성스러운 금빛 화염 기둥
                        ctx.globalAlpha = 0.9;
                        for (let i = 0; i < 4; i++) {
                            ctx.fillStyle = i % 2 ? '#fff7ed' : '#fbbf24';
                            ctx.beginPath();
                            ctx.moveTo(x, y - 30 - i * 4);
                            ctx.quadraticCurveTo(x + 16 - i * 3, y, x, y + 16);
                            ctx.quadraticCurveTo(x - 16 + i * 3, y, x, y - 30 - i * 4);
                            ctx.fill();
                        }
                        break;
                    }
                    case 'firefist': case 'boltfist': case 'icefist': case 'steelfist': case 'punch': {
                        const tint = shape === 'firefist' ? '#f97316' : shape === 'boltfist' ? '#facc15'
                                   : shape === 'icefist' ? '#67e8f9' : shape === 'steelfist' ? '#cbd5e1' : style.color;
                        ctx.globalAlpha = 0.35;
                        ctx.fillStyle = tint;
                        ctx.beginPath(); ctx.arc(x, y, 24, 0, TAU); ctx.fill();
                        ctx.globalAlpha = 1;
                        ctx.fillStyle = '#fde68a';
                        ctx.strokeStyle = '#7c2d12';
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.roundRect ? ctx.roundRect(x - 13, y - 11, 26, 22, 7) : ctx.rect(x - 13, y - 11, 26, 22);
                        ctx.fill(); ctx.stroke();
                        ctx.fillStyle = tint;
                        ctx.globalAlpha = 0.8;
                        for (let i = 0; i < 4; i++) {
                            ctx.beginPath();
                            ctx.arc(x - 20 - i * 6, y - 12 + i * 8, 4 - i * 0.5, 0, TAU);
                            ctx.fill();
                        }
                        break;
                    }
                    case 'wisp': { // 도깨비불 - 파란 혼불
                        ctx.globalAlpha = 0.85;
                        const flick = Math.sin(t * 24 + seed) * 3;
                        ctx.fillStyle = '#60a5fa';
                        ctx.beginPath();
                        ctx.moveTo(x, y - 16 + flick);
                        ctx.quadraticCurveTo(x + 10, y, x, y + 12);
                        ctx.quadraticCurveTo(x - 10, y, x, y - 16 + flick);
                        ctx.fill();
                        ctx.fillStyle = '#dbeafe';
                        ctx.beginPath(); ctx.arc(x, y + 2, 4.5, 0, TAU); ctx.fill();
                        break;
                    }
                    case 'wavefront': { // 파도타기 - 밀려오는 파도 벽
                        ctx.globalAlpha = 0.85;
                        const g = ctx.createLinearGradient(0, y - 40, 0, y + 24);
                        g.addColorStop(0, '#bae6fd');
                        g.addColorStop(1, '#0369a1');
                        ctx.fillStyle = g;
                        ctx.beginPath();
                        ctx.moveTo(x - 70, y + 24);
                        for (let i = -70; i <= 70; i += 10) {
                            ctx.lineTo(x + i, y - 26 + Math.sin(i / 14 + t * 10) * 9);
                        }
                        ctx.lineTo(x + 70, y + 24);
                        ctx.closePath();
                        ctx.fill();
                        ctx.fillStyle = '#ffffff';
                        ctx.globalAlpha = 0.8;
                        for (let i = 0; i < 6; i++) {
                            ctx.beginPath();
                            ctx.arc(x - 55 + i * 22, y - 26 + Math.sin(i + t * 10) * 8, 5, 0, TAU);
                            ctx.fill();
                        }
                        break;
                    }
                    case 'drain': { // 흡수/기가드레인 - 빨려 들어가는 초록 구슬
                        ctx.globalAlpha = 0.9;
                        ctx.fillStyle = style.color;
                        ctx.beginPath(); ctx.arc(x, y, 9 + Math.sin(t * 14 + seed) * 2, 0, TAU); ctx.fill();
                        ctx.strokeStyle = style.glow;
                        ctx.lineWidth = 2;
                        for (let i = 0; i < 3; i++) {
                            ctx.beginPath();
                            ctx.arc(x, y, 14 + i * 7, t * 12 + i, t * 12 + i + 1.6);
                            ctx.stroke();
                        }
                        break;
                    }
                    case 'slash': { // 리프블레이드/에어슬래시 - 초승달 참격
                        ctx.globalAlpha = 0.95;
                        ctx.fillStyle = style.glow;
                        ctx.save();
                        ctx.translate(x, y);
                        ctx.rotate(seed * 0.6 + t * 1.2);
                        ctx.beginPath();
                        ctx.arc(0, 0, 26, -0.9, 0.9);
                        ctx.arc(10, 0, 26, 0.85, -0.85, true);
                        ctx.closePath();
                        ctx.fill();
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 2;
                        ctx.stroke();
                        ctx.restore();
                        break;
                    }
                    case 'vine': { // 덩굴채찍 - 휘어지는 덩굴
                        ctx.strokeStyle = style.color;
                        ctx.lineWidth = 6;
                        ctx.lineCap = 'round';
                        ctx.beginPath();
                        ctx.moveTo(x - 60, y + 16);
                        ctx.quadraticCurveTo(x - 24, y - 26 + Math.sin(t * 10) * 10, x + 10, y);
                        ctx.stroke();
                        ctx.fillStyle = style.glow;
                        for (let i = 0; i < 3; i++) {
                            ctx.beginPath();
                            ctx.ellipse(x - 40 + i * 20, y + 4 - i * 6, 6, 3.2, -0.5, 0, TAU);
                            ctx.fill();
                        }
                        break;
                    }
                    case 'seed': { // 씨앗폭탄
                        ctx.fillStyle = '#65a30d';
                        ctx.save();
                        ctx.translate(x, y); ctx.rotate(t * 10 + seed);
                        ctx.beginPath(); ctx.ellipse(0, 0, 11, 8, 0, 0, TAU); ctx.fill();
                        ctx.fillStyle = '#365314';
                        ctx.fillRect(-9, -1.4, 18, 2.8);
                        ctx.restore();
                        break;
                    }
                    case 'solar': { // 솔라빔 충전 코어
                        ctx.globalAlpha = 0.9;
                        ctx.fillStyle = '#fef08a';
                        ctx.beginPath(); ctx.arc(x, y, 16, 0, TAU); ctx.fill();
                        break;
                    }
                    case 'lightning': { // 천둥 - 하늘에서 내리꽂는 번개
                        ctx.strokeStyle = '#fef08a';
                        ctx.lineWidth = 6;
                        ctx.lineJoin = 'round';
                        ctx.globalAlpha = 0.95;
                        ctx.beginPath();
                        let ly = y - 120;
                        ctx.moveTo(x, ly);
                        for (let i = 0; i < 6; i++) {
                            ly += 20;
                            ctx.lineTo(x + (i % 2 ? 12 : -12) + Math.sin(seed + i) * 5, ly);
                        }
                        ctx.stroke();
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 2.4;
                        ctx.stroke();
                        break;
                    }
                    case 'ripple': { // 전기자석파/벌레의야단법석 - 퍼지는 파문
                        ctx.globalAlpha = 0.8;
                        ctx.strokeStyle = style.color;
                        ctx.lineWidth = 3;
                        for (let i = 0; i < 3; i++) {
                            ctx.beginPath();
                            ctx.arc(x, y, 8 + i * 9 + Math.sin(t * 12 + i) * 3, 0, TAU);
                            ctx.stroke();
                        }
                        break;
                    }
                    case 'aurora': { // 오로라베일 - 오로라 커튼
                        ctx.globalAlpha = 0.6;
                        for (let i = 0; i < 4; i++) {
                            const g = ctx.createLinearGradient(x - 40 + i * 20, y - 50, x - 40 + i * 20, y + 40);
                            g.addColorStop(0, 'rgba(165,243,252,0)');
                            g.addColorStop(0.5, i % 2 ? '#a5f3fc' : '#c4b5fd');
                            g.addColorStop(1, 'rgba(165,243,252,0)');
                            ctx.fillStyle = g;
                            ctx.fillRect(x - 42 + i * 21, y - 50 + Math.sin(t * 6 + i) * 6, 14, 92);
                        }
                        break;
                    }
                    case 'quake': { // 지진 - 갈라지는 지면
                        ctx.globalAlpha = 0.9;
                        ctx.fillStyle = '#3f2a12';
                        ctx.strokeStyle = '#a16207';
                        ctx.lineWidth = 3;
                        ctx.beginPath();
                        let qx = x - 70;
                        ctx.moveTo(qx, y);
                        for (let i = 0; i < 7; i++) {
                            qx += 20;
                            ctx.lineTo(qx, y + (i % 2 ? 9 : -9));
                        }
                        ctx.stroke();
                        for (let i = 0; i < 6; i++) {
                            ctx.fillStyle = '#78350f';
                            ctx.beginPath();
                            ctx.moveTo(x - 60 + i * 24, y);
                            ctx.lineTo(x - 52 + i * 24, y - 18 - (i % 3) * 8);
                            ctx.lineTo(x - 44 + i * 24, y);
                            ctx.closePath();
                            ctx.fill();
                        }
                        break;
                    }
                    case 'earthblade': { // 단애의칼 - 솟아오르는 대지의 칼날
                        ctx.globalAlpha = 0.95;
                        for (let i = 0; i < 5; i++) {
                            const bx = x - 60 + i * 30;
                            const h = 26 + (i % 3) * 14;
                            ctx.fillStyle = i % 2 ? '#f59e0b' : '#b45309';
                            ctx.beginPath();
                            ctx.moveTo(bx, y + 10);
                            ctx.lineTo(bx + 7, y + 10 - h);
                            ctx.lineTo(bx + 14, y + 10);
                            ctx.closePath();
                            ctx.fill();
                        }
                        break;
                    }
                    case 'spike': { // 스톤에지 - 솟구치는 바위 가시
                        ctx.globalAlpha = 0.95;
                        for (let i = 0; i < 6; i++) {
                            const a = (i / 6) * TAU;
                            const d = 22 + t * 26;
                            const sx = x + Math.cos(a) * d, sy = y + Math.sin(a) * d * 0.55;
                            ctx.fillStyle = i % 2 ? '#a8a29e' : '#78716c';
                            ctx.save();
                            ctx.translate(sx, sy);
                            ctx.rotate(a + Math.PI / 2);
                            ctx.beginPath();
                            ctx.moveTo(0, -24); ctx.lineTo(8, 10); ctx.lineTo(-8, 10);
                            ctx.closePath(); ctx.fill();
                            ctx.restore();
                        }
                        break;
                    }
                    case 'steel': { // 아이언헤드/플래시캐논 - 금속 광택 덩어리
                        const g = ctx.createLinearGradient(x - 16, y - 16, x + 16, y + 16);
                        g.addColorStop(0, '#f8fafc');
                        g.addColorStop(0.5, '#94a3b8');
                        g.addColorStop(1, '#475569');
                        ctx.fillStyle = g;
                        ctx.beginPath(); ctx.arc(x, y, 15, 0, TAU); ctx.fill();
                        ctx.strokeStyle = '#e2e8f0';
                        ctx.lineWidth = 2.6;
                        for (let i = 0; i < 3; i++) {
                            ctx.beginPath();
                            ctx.moveTo(x - 26 - i * 8, y - 10 + i * 10);
                            ctx.lineTo(x - 12 - i * 8, y - 10 + i * 10);
                            ctx.stroke();
                        }
                        break;
                    }
                    case 'gust': { // 바람일으키기 - 소용돌이 바람
                        ctx.strokeStyle = style.glow;
                        ctx.lineWidth = 3;
                        ctx.globalAlpha = 0.85;
                        for (let i = 0; i < 3; i++) {
                            ctx.beginPath();
                            for (let a = 0; a < 5; a += 0.2) {
                                const rr = 4 + a * 4;
                                const ang = a + t * 12 + i * 2.1;
                                const px = x + Math.cos(ang) * rr;
                                const py = y + Math.sin(ang) * rr * 0.6;
                                a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
                            }
                            ctx.stroke();
                        }
                        break;
                    }
                    case 'aura': { // 파동탄
                        ctx.globalAlpha = 0.85;
                        const g = ctx.createRadialGradient(x, y, 2, x, y, 20);
                        g.addColorStop(0, '#ffffff');
                        g.addColorStop(0.5, '#60a5fa');
                        g.addColorStop(1, 'rgba(37,99,235,0)');
                        ctx.fillStyle = g;
                        ctx.beginPath(); ctx.arc(x, y, 20, 0, TAU); ctx.fill();
                        ctx.strokeStyle = '#bfdbfe';
                        ctx.lineWidth = 2;
                        ctx.beginPath(); ctx.arc(x, y, 13 + Math.sin(t * 18) * 3, 0, TAU); ctx.stroke();
                        break;
                    }
                    case 'sludge': { // 오물폭탄/맹독
                        ctx.globalAlpha = 0.9;
                        ctx.fillStyle = '#7e22ce';
                        ctx.beginPath();
                        for (let i = 0; i < 8; i++) {
                            const a = (i / 8) * TAU;
                            const rr = 12 + Math.sin(a * 3 + t * 9 + seed) * 4;
                            const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
                            i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
                        }
                        ctx.closePath(); ctx.fill();
                        ctx.fillStyle = '#d8b4fe';
                        ctx.beginPath(); ctx.arc(x - 4, y - 4, 4, 0, TAU); ctx.fill();
                        break;
                    }
                    case 'fang': { // 물기 - 맞물리는 송곳니
                        ctx.fillStyle = '#ffffff';
                        ctx.strokeStyle = '#334155';
                        ctx.lineWidth = 1.6;
                        const gap = 14 - Math.abs(Math.sin(t * Math.PI)) * 10;
                        for (let i = 0; i < 3; i++) {
                            ctx.beginPath();
                            ctx.moveTo(x - 18 + i * 16, y - gap - 12);
                            ctx.lineTo(x - 12 + i * 16, y - gap);
                            ctx.lineTo(x - 24 + i * 16, y - gap);
                            ctx.closePath(); ctx.fill(); ctx.stroke();
                            ctx.beginPath();
                            ctx.moveTo(x - 18 + i * 16, y + gap + 12);
                            ctx.lineTo(x - 12 + i * 16, y + gap);
                            ctx.lineTo(x - 24 + i * 16, y + gap);
                            ctx.closePath(); ctx.fill(); ctx.stroke();
                        }
                        break;
                    }
                    case 'shadow': { // 섀도볼 - 흔들리는 그림자 구체
                        ctx.globalAlpha = 0.9;
                        ctx.fillStyle = '#2e1065';
                        ctx.beginPath();
                        for (let i = 0; i < 10; i++) {
                            const a = (i / 10) * TAU;
                            const rr = 15 + Math.sin(a * 4 + t * 16) * 4;
                            const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
                            i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
                        }
                        ctx.closePath(); ctx.fill();
                        ctx.fillStyle = '#a78bfa';
                        ctx.globalAlpha = 0.6;
                        ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.fill();
                        break;
                    }
                    case 'psywave': { // 사이코키네시스 - 겹치는 분홍 파문
                        ctx.globalAlpha = 0.7;
                        for (let i = 0; i < 4; i++) {
                            ctx.strokeStyle = i % 2 ? '#f9a8d4' : '#ec4899';
                            ctx.lineWidth = 4 - i * 0.7;
                            ctx.beginPath();
                            ctx.ellipse(x, y, 16 + i * 16 + t * 24, (16 + i * 16 + t * 24) * 0.55, t * 3 + i, 0, TAU);
                            ctx.stroke();
                        }
                        break;
                    }
                    case 'moon': { // 문포스 - 초승달
                        ctx.globalAlpha = 0.95;
                        ctx.fillStyle = '#fce7f3';
                        ctx.beginPath(); ctx.arc(x, y, 16, 0, TAU); ctx.fill();
                        ctx.globalCompositeOperation = 'destination-out';
                        ctx.beginPath(); ctx.arc(x + 8, y - 4, 14, 0, TAU); ctx.fill();
                        ctx.globalCompositeOperation = 'source-over';
                        ctx.fillStyle = '#f9a8d4';
                        for (let i = 0; i < 4; i++) {
                            ctx.beginPath();
                            ctx.arc(x - 20 + i * 12, y + 16 - i * 6, 2.4, 0, TAU);
                            ctx.fill();
                        }
                        break;
                    }
                    case 'sparkle': { // 매지컬샤인 - 반짝이는 별
                        ctx.globalAlpha = 0.95;
                        ctx.fillStyle = '#ffffff';
                        ctx.save();
                        ctx.translate(x, y);
                        ctx.rotate(t * 5 + seed);
                        ctx.beginPath();
                        for (let i = 0; i < 8; i++) {
                            const a = (i / 8) * TAU;
                            const rr = i % 2 ? 5 : 15;
                            const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
                            i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
                        }
                        ctx.closePath();
                        ctx.fill();
                        ctx.restore();
                        break;
                    }
                    case 'heart': { // 치근거리기 - 하트
                        ctx.globalAlpha = 0.95;
                        ctx.fillStyle = '#f472b6';
                        ctx.save();
                        ctx.translate(x, y);
                        ctx.rotate(Math.sin(t * 8 + seed) * 0.3);
                        ctx.beginPath();
                        ctx.moveTo(0, 8);
                        ctx.bezierCurveTo(-14, -4, -8, -16, 0, -8);
                        ctx.bezierCurveTo(8, -16, 14, -4, 0, 8);
                        ctx.fill();
                        ctx.restore();
                        break;
                    }
                    case 'cross': { // 시저크로스 - X자 참격
                        ctx.globalAlpha = 0.95;
                        ctx.strokeStyle = style.glow;
                        ctx.lineWidth = 7;
                        ctx.lineCap = 'round';
                        ctx.beginPath();
                        ctx.moveTo(x - 22, y - 22); ctx.lineTo(x + 22, y + 22);
                        ctx.moveTo(x + 22, y - 22); ctx.lineTo(x - 22, y + 22);
                        ctx.stroke();
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 2.6;
                        ctx.stroke();
                        break;
                    }
                    case 'dragonwave': { // 용의파동
                        ctx.globalAlpha = 0.85;
                        for (let i = 0; i < 3; i++) {
                            ctx.strokeStyle = i % 2 ? '#c4b5fd' : '#7c3aed';
                            ctx.lineWidth = 5 - i;
                            ctx.beginPath();
                            ctx.arc(x, y, 12 + i * 10, -1.1 + Math.sin(t * 8) * 0.2, 1.1 + Math.sin(t * 8) * 0.2);
                            ctx.stroke();
                        }
                        ctx.fillStyle = '#ede9fe';
                        ctx.beginPath(); ctx.arc(x, y, 8, 0, TAU); ctx.fill();
                        break;
                    }
                    case 'dragonclaw': { // 역린 - 붉은 용 발톱
                        ctx.globalAlpha = 0.95;
                        ctx.strokeStyle = '#ef4444';
                        ctx.lineWidth = 5;
                        ctx.lineCap = 'round';
                        for (let i = 0; i < 3; i++) {
                            ctx.beginPath();
                            ctx.moveTo(x - 22 + i * 9, y - 24);
                            ctx.quadraticCurveTo(x + i * 5, y, x - 12 + i * 9, y + 24);
                            ctx.stroke();
                        }
                        ctx.strokeStyle = '#fecaca';
                        ctx.lineWidth = 1.8;
                        ctx.stroke();
                        break;
                    }
                    case 'rift': { // 시공절단 - 찢어지는 공간
                        ctx.globalAlpha = 0.95;
                        ctx.fillStyle = '#0b1020';
                        ctx.beginPath();
                        ctx.moveTo(x, y - 46 * (0.4 + t));
                        ctx.quadraticCurveTo(x + 16, y, x, y + 46 * (0.4 + t));
                        ctx.quadraticCurveTo(x - 16, y, x, y - 46 * (0.4 + t));
                        ctx.fill();
                        ctx.strokeStyle = '#c4b5fd';
                        ctx.lineWidth = 3;
                        ctx.stroke();
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 1.2;
                        ctx.stroke();
                        break;
                    }
                    case 'blades': { // 칼춤 - 주변을 도는 칼날
                        ctx.globalAlpha = 0.9;
                        for (let i = 0; i < 5; i++) {
                            const a = (i / 5) * TAU + t * 9;
                            const px = x + Math.cos(a) * 34, py = y + Math.sin(a) * 26;
                            ctx.save();
                            ctx.translate(px, py);
                            ctx.rotate(a + Math.PI / 2);
                            ctx.fillStyle = '#fef3c7';
                            ctx.beginPath();
                            ctx.moveTo(0, -14); ctx.lineTo(4, 8); ctx.lineTo(-4, 8);
                            ctx.closePath(); ctx.fill();
                            ctx.fillStyle = '#b45309';
                            ctx.fillRect(-4, 8, 8, 4);
                            ctx.restore();
                        }
                        break;
                    }
                    default: {
                        // 기본형(노말/드래곤/에스퍼/고스트/악/페어리/독 등): 발광하는 구슬
                        const grad = ctx.createRadialGradient(x, y, 0, x, y, 13);
                        grad.addColorStop(0, style.glow);
                        grad.addColorStop(1, style.color);
                        ctx.fillStyle = grad;
                        ctx.globalAlpha = 0.9;
                        ctx.beginPath();
                        ctx.arc(x, y, 9 + Math.sin(t * Math.PI) * 3, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }

                ctx.restore();
            }

            updateAndRenderParticles() {
                for (let i = this.particles.length - 1; i >= 0; i--) {
                    const p = this.particles[i];
                    p.x += p.vx;
                    p.y += p.vy;
                    p.life -= 0.04;

                    if (p.life <= 0) {
                        this.particles.splice(i, 1);
                        continue;
                    }

                    this.ctx.fillStyle = p.color;
                    this.ctx.globalAlpha = p.life;
                    this.ctx.beginPath();
                    this.ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                    this.ctx.fill();
                    this.ctx.globalAlpha = 1.0;
                }
            }

            /* ==========================================================================
               11-B. 실시간 날씨 시각 효과
               기존에는 HUD 텍스트("날씨: 비 🌧️")만 바뀌고 화면에는 아무 변화가 없었음.
               → weatherIdx(0맑음/1비/2모래바람/3눈/4쾌청)에 맞춰 캔버스 위에
               실제로 내리는 비, 흩날리는 눈, 뿌옇게 덮이는 모래바람, 아지랑이 쾌청 효과를 그려서
               "화면으로 체감되는 날씨"로 업그레이드.
               ========================================================================== */
            renderWeatherEffect() {
                const ctx = this.ctx;
                const w = this.canvas.width, h = this.canvas.height;
                const target = { 1: 90, 2: 60, 3: 70 }[this.weatherIdx] || 0;

                // 목표 파티클 수에 맞춰 부족하면 보충 생성
                while (this.weatherParticles.length < target) {
                    this.weatherParticles.push(this.spawnWeatherParticle(true));
                }
                if (this.weatherParticles.length > target) {
                    this.weatherParticles.length = target;
                }

                if (this.weatherIdx === 1) { // 비 🌧️
                    ctx.strokeStyle = 'rgba(191, 219, 254, 0.55)';
                    ctx.lineWidth = 2;
                    this.weatherParticles.forEach(p => {
                        p.y += p.speed;
                        p.x -= p.speed * 0.3;
                        if (p.y > h) Object.assign(p, this.spawnWeatherParticle(false));
                        ctx.beginPath();
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(p.x + 4, p.y + 14);
                        ctx.stroke();
                    });
                } else if (this.weatherIdx === 3) { // 눈 ❄️
                    ctx.fillStyle = 'rgba(255,255,255,0.85)';
                    this.weatherParticles.forEach(p => {
                        p.y += p.speed * 0.35;
                        p.x += Math.sin((p.y + p.seed) / 40) * 0.6;
                        if (p.y > h) Object.assign(p, this.spawnWeatherParticle(false));
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                        ctx.fill();
                    });
                } else if (this.weatherIdx === 2) { // 모래바람 🌪️
                    ctx.fillStyle = 'rgba(217, 119, 6, 0.16)';
                    ctx.fillRect(0, 0, w, h);
                    ctx.strokeStyle = 'rgba(180, 83, 9, 0.4)';
                    this.weatherParticles.forEach(p => {
                        p.x += p.speed;
                        p.y += Math.sin((p.x + p.seed) / 30) * 0.8;
                        if (p.x > w) Object.assign(p, this.spawnWeatherParticle(false), { x: -10 });
                        ctx.beginPath();
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(p.x + 16, p.y);
                        ctx.stroke();
                    });
                } else if (this.weatherIdx === 4) { // 쾌청 🔥 - 은은한 아지랑이/광선 연출
                    const t = Date.now() / 900;
                    ctx.strokeStyle = `rgba(251, 191, 36, ${0.08 + Math.abs(Math.sin(t)) * 0.05})`;
                    ctx.lineWidth = 40;
                    for (let i = 0; i < 4; i++) {
                        ctx.beginPath();
                        ctx.moveTo(w * 0.2 * i, 0);
                        ctx.lineTo(w * 0.2 * i + 60, h);
                        ctx.stroke();
                    }
                }
            }

            spawnWeatherParticle(randomY) {
                return {
                    x: Math.random() * this.canvas.width,
                    y: randomY ? Math.random() * this.canvas.height : -10,
                    speed: 4 + Math.random() * 5,
                    size: 1.5 + Math.random() * 2,
                    seed: Math.random() * 1000
                };
            }

            /* ==========================================================================
               12. UI & HUD REFRESH ENGINE
               ========================================================================== */
            updateUI() {
                if (this.player.party.length === 0) return;

                const curPkm = this.player.party[this.player.activeIdx];
                document.getElementById('hud-name').innerText = curPkm.species;
                document.getElementById('hud-level').innerText = curPkm.level;
                document.getElementById('hud-hp-val').innerText = `${curPkm.hp}/${curPkm.maxHp}`;
                document.getElementById('hud-nature').innerText = curPkm.nature.name;
                document.getElementById('hud-badges').innerText = this.player.badges;
                document.getElementById('hud-badges-max').innerText = GYM_COUNT + (this.player.championDefeated ? ' 👑' : '');
                document.getElementById('hud-gold').innerText = this.player.gold;
                document.getElementById('hud-weather').innerText = `날씨: ${WEATHERS[this.weatherIdx]}`;

                const hpPct = (curPkm.hp / curPkm.maxHp) * 100;
                const expPct = (curPkm.exp / curPkm.maxExp) * 100;

                const hpBar = document.getElementById('hud-hp-bar');
                hpBar.style.width = `${hpPct}%`;
                hpBar.className = `bar-fill ${hpPct > 50 ? 'bar-hp' : (hpPct > 20 ? 'bar-hp-warn' : 'bar-hp-danger')}`;

                document.getElementById('hud-exp-bar').style.width = `${expPct}%`;

                const tile = this.worldMap[this.player.y][this.player.x];
                // 마을이 시작 지점(오닉스 역전가) 하나뿐이던 시절엔 TOWN 타일이면 무조건
                // "오닉스 역전가"이라고 표시해도 됐지만, 이제 지역 마을이 4곳 더 생겼으므로
                // 실제 서 있는 좌표가 어느 마을 블록에 속하는지 찾아 이름을 붙여준다.
                let townName = (this.player.y < 24 && this.player.x < 24) ? '오닉스 역전가' : null;
                if (!townName) {
                    const site = EXTRA_TOWN_SITES.find(s =>
                        this.player.y >= s.rMin && this.player.y <= s.rMax &&
                        this.player.x >= s.cMin && this.player.x <= s.cMax);
                    if (site) townName = site.name;
                }
                const townLabel = townName || '마을';

                let locText = '평원 로드';
                if (tile === TILE_TYPES.TOWN) locText = townLabel;
                if (tile === TILE_TYPES.CENTER) locText = `포켓몬센터 (${townLabel})`;
                if (tile === TILE_TYPES.GYM) locText = `체육관 (${townLabel})`;
                if (tile === TILE_TYPES.MART) locText = `프렌들리 숍 (${townLabel})`;
                if (tile === TILE_TYPES.WATER) locText = '대해양';
                if (tile === TILE_TYPES.SAND) locText = '사막 지대';
                if (tile === TILE_TYPES.SNOW) locText = '설원 설산';
                if (tile === TILE_TYPES.VOLCANO) locText = '화산 지대';
                if (tile === TILE_TYPES.FOREST) locText = '울창한 숲';
                if (tile === TILE_TYPES.LAND_TEMPLE) locText = '⛩️ 대지의 사원';
                if (tile === TILE_TYPES.SEA_TEMPLE) locText = '⛩️ 바다의 사원';
                if (tile === TILE_TYPES.SKY_TEMPLE) locText = '⛩️ 하늘의 사원';
                if (tile === TILE_TYPES.ROCK) locText = '⛰️ 바위 고원';
                if (tile === TILE_TYPES.SWAMP) locText = '🪷 안개늪지';
                if (tile === TILE_TYPES.BEACH) locText = '🏖️ 모래사장';
                if (tile === TILE_TYPES.FLOWER) locText = '🌷 꽃밭 평원';
                if (tile === TILE_TYPES.CAVE) locText = '🕳️ 어둠의 동굴';
                if (tile === TILE_TYPES.RUINS) locText = '🏛️ 고대 유적';
                if (tile === TILE_TYPES.ICE_FIELD) locText = '🧊 빙결 호수';
                if (tile === TILE_TYPES.WASTELAND) locText = '🏜️ 메마른 황무지';
                if (tile === TILE_TYPES.BAMBOO) locText = '🎋 대나무 숲';
                if (tile === TILE_TYPES.CHERRY) locText = '🌸 벚꽃 숲';
                if (tile === TILE_TYPES.PATH) locText = '🛤️ 지역 도로 (포켓몬 없음)';
                document.getElementById('hud-location').innerText = locText;

                // [지역제] 이 지역에서 어느 정도 레벨이 나오는지 미리 보여준다.
                // 그래야 "여긴 아직 무리"라는 판단을 마주치기 전에 할 수 있다.
                // 스프레이 남은 시간
                const repelEl = document.getElementById('hud-repel');
                if (repelEl) {
                    const leftMs = this.repelRemainingMs();
                    repelEl.style.display = leftMs > 0 ? 'block' : 'none';
                    if (leftMs > 0) repelEl.innerHTML = `🧴 벌레퇴치 <b>${Math.ceil(leftMs / 1000)}초</b>`;
                }

                const regionEl = document.getElementById('hud-region');
                if (regionEl) {
                    const rg = getRegionAt(this.player.x, this.player.y);
                    const mine = this.player.party[0] ? this.player.party[0].level : 1;
                    const tough = rg.min > mine + 4;
                    regionEl.innerHTML = `${rg.name} 권역 · 야생 <b>Lv.${rg.min}~${rg.max}</b>`
                        + (rg.frontier > 0 ? ' <span style="opacity:.75">(변방 +' + rg.frontier + ')</span>' : '');
                    regionEl.style.color = tough ? 'var(--neon-pink)' : 'var(--neon-cyan)';
                }

                this.updateBattleHud();
            }

            /* 전투 화면에 실제 게임처럼 떠 있는 적/내 포켓몬 이름·레벨·HP바 정보창을 갱신한다 */
            updateBattleHud() {
                if (this.state !== GAME_STATES.BATTLE || !this.currentEnemy) return;
                const curPkm = this.player.party[this.player.activeIdx];
                if (!curPkm) return;

                const enemy = this.currentEnemy;
                const eHpPct = Math.max(0, (enemy.hp / enemy.maxHp) * 100);
                document.getElementById('enemy-info-name').textContent = enemy.species;
                document.getElementById('enemy-info-level').textContent = `Lv.${enemy.level}`;
                const eBar = document.getElementById('enemy-info-hp-bar');
                eBar.style.width = `${eHpPct}%`;
                eBar.className = `bar-fill ${eHpPct > 50 ? 'bar-hp' : (eHpPct > 20 ? 'bar-hp-warn' : 'bar-hp-danger')}`;
                document.getElementById('enemy-info-status').textContent = this.formatStatusBadge(enemy);

                const pHpPct = Math.max(0, (curPkm.hp / curPkm.maxHp) * 100);
                document.getElementById('player-info-name').textContent = curPkm.isMega ? '메가' + curPkm.species : curPkm.species;
                document.getElementById('player-info-level').textContent = `Lv.${curPkm.level}`;
                const pBar = document.getElementById('player-info-hp-bar');
                pBar.style.width = `${pHpPct}%`;
                pBar.className = `bar-fill ${pHpPct > 50 ? 'bar-hp' : (pHpPct > 20 ? 'bar-hp-warn' : 'bar-hp-danger')}`;
                document.getElementById('player-info-hp-text').textContent = `${Math.max(0, curPkm.hp)}/${curPkm.maxHp}`;
                document.getElementById('player-info-exp-bar').style.width = `${(curPkm.exp / curPkm.maxExp) * 100}%`;
                document.getElementById('player-info-status').textContent = this.formatStatusBadge(curPkm);
            }

            formatStatusBadge(pkm) {
                const tags = [];
                if (pkm.status && pkm.status !== STATUS_EFFECTS.NONE) tags.push(pkm.status);
                if (pkm.attracted) tags.push('매혹');
                if (pkm.confused) tags.push('혼란');
                return tags.join(' / ');
            }
        }

        /* ==========================================================================
           13. GLOBAL MODALS & UI HANDLERS
           ========================================================================== */
        let gameInstance = null;

        /* ==========================================================================
           14. 사운드 시스템 - 외부 음원 파일 없이 Web Audio API 오실레이터로 모든
           소리를 즉석 합성한다 (SFX + 오리지널 칩튠풍 배경음악). 실제 닌텐도 음원을
           사용하지 않고 이 게임만을 위해 새로 작곡한 8비트 스타일 멜로디다.
           ========================================================================== */
        let _audioMuted = false;

        function isAudioMuted() { return _audioMuted; }

        function toggleAudioMute() {
            _audioMuted = !_audioMuted;
            MusicEngine.setMuted(_audioMuted);
            const btn = document.getElementById('sound-toggle-btn');
            if (btn) btn.textContent = _audioMuted ? '🔇' : '🔊';
            showToast(_audioMuted ? '🔇 사운드를 껐습니다.' : '🔊 사운드를 켰습니다.');
            return _audioMuted;
        }

        /* 효과음 - hit: 피격음 / catch: 포획 성공 / fail: 포획 실패 / levelup: 레벨업
           miss: 빗나감 / status: 상태이상 부여 / faint: 기절 / switch: 포켓몬 교체
           menu: 메뉴 선택음 / victory: 승리 팡파레 / run: 도망 */
        let _sfxCtx = null;
        function playSfx(type) {
            if (_audioMuted) return;
            try {
                if (!_sfxCtx) _sfxCtx = new (window.AudioContext || window.webkitAudioContext)();
                const ctx = _sfxCtx;
                const now = ctx.currentTime;

                const beep = (freq, start, dur, gainVal = 0.12, wave = 'square') => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = wave;
                    osc.frequency.setValueAtTime(freq, now + start);
                    gain.gain.setValueAtTime(gainVal, now + start);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
                    osc.connect(gain).connect(ctx.destination);
                    osc.start(now + start);
                    osc.stop(now + start + dur);
                };

                if (type === 'hit') {
                    beep(180, 0, 0.12, 0.15, 'square');
                } else if (type === 'catch') {
                    beep(523, 0, 0.1); beep(659, 0.1, 0.1); beep(784, 0.2, 0.1); beep(1046, 0.32, 0.22, 0.14, 'triangle');
                } else if (type === 'fail') {
                    beep(300, 0, 0.15, 0.12, 'sawtooth'); beep(180, 0.15, 0.2, 0.12, 'sawtooth');
                } else if (type === 'levelup') {
                    beep(392, 0, 0.09); beep(494, 0.09, 0.09); beep(587, 0.18, 0.09); beep(784, 0.27, 0.25, 0.13, 'triangle');
                } else if (type === 'click') {
                    beep(600, 0, 0.05, 0.06, 'square');
                } else if (type === 'mega_charge') {
                    beep(220, 0, 0.9, 0.05, 'sawtooth');
                    beep(330, 0.15, 0.7, 0.045, 'sawtooth');
                    beep(440, 0.35, 0.5, 0.04, 'sawtooth');
                    beep(660, 0.55, 0.35, 0.035, 'triangle');
                } else if (type === 'mega_complete') {
                    beep(659, 0, 0.12, 0.16, 'triangle');
                    beep(880, 0.1, 0.12, 0.16, 'triangle');
                    beep(1108, 0.2, 0.12, 0.16, 'triangle');
                    beep(1318, 0.32, 0.35, 0.18, 'triangle');
                } else if (type === 'miss') {
                    beep(220, 0, 0.1, 0.08, 'triangle'); beep(180, 0.08, 0.16, 0.07, 'triangle');
                } else if (type === 'status') {
                    beep(330, 0, 0.08, 0.1, 'square'); beep(262, 0.08, 0.14, 0.09, 'square');
                } else if (type === 'faint') {
                    beep(392, 0, 0.12, 0.12, 'sawtooth'); beep(330, 0.1, 0.12, 0.11, 'sawtooth');
                    beep(262, 0.2, 0.12, 0.1, 'sawtooth'); beep(196, 0.3, 0.3, 0.1, 'sawtooth');
                } else if (type === 'switch_pkm') {
                    beep(440, 0, 0.06, 0.09, 'square'); beep(587, 0.06, 0.1, 0.09, 'square');
                } else if (type === 'menu') {
                    beep(700, 0, 0.04, 0.05, 'square');
                } else if (type === 'run') {
                    beep(300, 0, 0.06, 0.08, 'triangle'); beep(400, 0.06, 0.06, 0.08, 'triangle'); beep(500, 0.12, 0.08, 0.08, 'triangle');
                } else if (type === 'save') {
                    beep(784, 0, 0.07, 0.09, 'triangle'); beep(1046, 0.07, 0.16, 0.1, 'triangle');
                } else if (type === 'achievement') {
                    beep(659, 0, 0.09, 0.11, 'triangle'); beep(880, 0.09, 0.09, 0.11, 'triangle');
                    beep(1046, 0.18, 0.09, 0.12, 'triangle'); beep(1318, 0.27, 0.34, 0.13, 'triangle');
                } else if (type === 'encounter') {
                    beep(880, 0, 0.06, 0.1, 'square'); beep(660, 0.07, 0.06, 0.1, 'square');
                    beep(880, 0.14, 0.06, 0.1, 'square'); beep(1175, 0.21, 0.26, 0.12, 'square');
                } else if (type === 'heal') {
                    [523, 659, 784, 1046].forEach((f, i) => beep(f, i * 0.1, 0.16, 0.1, 'sine'));
                } else if (type === 'victory') {
                    [523, 523, 523, 659, 784].forEach((f, i) => beep(f, i * 0.14, 0.13, 0.13, 'triangle'));
                    beep(1046, 0.7, 0.5, 0.16, 'triangle');
                }
            } catch (e) { /* 오디오 미지원 환경에서는 조용히 무시 */ }
        }

        /* ==========================================================================
           14-A. 오리지널 칩튠 배경음악 시퀀서
           멜로디+베이스 2채널을 오실레이터로 반복 재생한다. 실제 게임 음원을 그대로
           쓰는 대신, 이 게임만을 위한 짧은 루프를 새로 작곡했다 (필드/야생전투/보스전).
           ========================================================================== */
        const MusicEngine = (() => {
            let ctx = null;
            let masterGain = null;
            let stepTimer = null;
            let stepIndex = 0;
            let currentTrack = null;
            let muted = false;

            // 각 트랙: stepSec(한 스텝 길이, 초) / melody·bass(주파수 배열, 0은 쉼표)
            const TRACKS = {
                FIELD: {
                    stepSec: 0.26,
                    melody: [392, 0, 440, 0, 494, 440, 392, 0, 330, 0, 392, 0, 440, 392, 330, 0],
                    bass: [196, 0, 196, 0, 165, 0, 165, 0, 220, 0, 220, 0, 196, 0, 196, 0]
                },
                BATTLE: {
                    stepSec: 0.16,
                    melody: [523, 587, 523, 440, 0, 440, 523, 0, 587, 659, 587, 494, 0, 494, 587, 0],
                    bass: [131, 131, 0, 131, 165, 165, 0, 165, 131, 131, 0, 131, 147, 147, 0, 147]
                },
                BOSS: {
                    stepSec: 0.14,
                    melody: [330, 330, 392, 330, 294, 330, 392, 440, 330, 330, 392, 330, 294, 262, 294, 330],
                    bass: [110, 0, 110, 116, 98, 0, 98, 104, 110, 0, 110, 116, 87, 0, 87, 92]
                },
                // 마을 테마 - 포근하고 느긋한 장조 진행 (마을/센터/상점/체육관 타일)
                TOWN: {
                    stepSec: 0.30,
                    melody: [523, 0, 587, 659, 0, 659, 587, 523, 494, 0, 523, 587, 0, 523, 0, 0,
                             440, 0, 494, 523, 0, 587, 523, 494, 440, 0, 392, 440, 0, 494, 0, 0],
                    bass:   [262, 0, 262, 0, 196, 0, 196, 0, 220, 0, 220, 0, 247, 0, 247, 0,
                             175, 0, 175, 0, 196, 0, 196, 0, 220, 0, 220, 0, 262, 0, 262, 0]
                },
                // 전설의 사원 테마 - 낮고 공허한 단조 진행으로 신성한 유적의 긴장감을 표현
                TEMPLE: {
                    stepSec: 0.40,
                    melody: [349, 0, 0, 392, 0, 0, 466, 0, 415, 0, 0, 349, 0, 0, 0, 0,
                             311, 0, 0, 349, 0, 0, 415, 0, 392, 0, 0, 311, 0, 0, 0, 0],
                    bass:   [87, 0, 0, 0, 87, 0, 0, 0, 104, 0, 0, 0, 104, 0, 0, 0,
                             78, 0, 0, 0, 78, 0, 0, 0, 98, 0, 0, 0, 98, 0, 0, 0]
                },
                // 준전설/환상/전설의 포켓몬 전용 - 장엄하고 신비로운 분위기를 위해
                // 느린 템포와 5음 음계(펜타토닉)풍 진행을 사용한 오리지널 곡
                LEGEND: {
                    stepSec: 0.34,
                    melody: [440, 0, 494, 0, 587, 0, 659, 587, 494, 0, 440, 0, 392, 0, 440, 0, 587, 0, 659, 0, 784, 659, 587, 0, 494, 0, 440, 0, 392, 0, 0, 0],
                    bass: [110, 0, 0, 0, 131, 0, 0, 0, 147, 0, 0, 0, 98, 0, 0, 0, 147, 0, 0, 0, 165, 0, 0, 0, 131, 0, 0, 0, 110, 0, 0, 0]
                }
            };

            function ensureCtx() {
                if (!ctx) {
                    ctx = new (window.AudioContext || window.webkitAudioContext)();
                    masterGain = ctx.createGain();
                    masterGain.gain.value = muted ? 0 : 0.11;
                    masterGain.connect(ctx.destination);
                }
                return ctx;
            }

            function playNote(freq, dur, wave, gainVal, when) {
                if (!freq) return; // 0 = 쉼표
                const osc = ctx.createOscillator();
                const g = ctx.createGain();
                osc.type = wave;
                osc.frequency.setValueAtTime(freq, when);
                g.gain.setValueAtTime(0, when);
                g.gain.linearRampToValueAtTime(gainVal, when + 0.008);
                g.gain.exponentialRampToValueAtTime(0.0001, when + dur * 0.95);
                osc.connect(g).connect(masterGain);
                osc.start(when);
                osc.stop(when + dur);
            }

            function step() {
                const track = TRACKS[currentTrack];
                if (!track || !ctx) return;
                const when = ctx.currentTime + 0.03;
                const m = track.melody[stepIndex % track.melody.length];
                const b = track.bass[stepIndex % track.bass.length];
                playNote(m, track.stepSec * 0.9, 'square', 0.05, when);
                playNote(b, track.stepSec * 0.95, 'triangle', 0.065, when);
                stepIndex++;
            }

            return {
                start(name) {
                    if (currentTrack === name && stepTimer) return; // 이미 재생 중
                    try {
                        ensureCtx();
                        clearInterval(stepTimer);
                        currentTrack = name;
                        stepIndex = 0;
                        const track = TRACKS[name];
                        if (!track) return;
                        stepTimer = setInterval(step, track.stepSec * 1000);
                    } catch (e) { /* 오디오 미지원 환경 무시 */ }
                },
                stop() {
                    clearInterval(stepTimer);
                    stepTimer = null;
                    currentTrack = null;
                },
                setMuted(v) {
                    muted = v;
                    if (masterGain) masterGain.gain.value = muted ? 0 : 0.11;
                }
            };
        })();

        /* 열려 있는 창 중 가장 위의 것을 닫는다 (ESC 키). 타이틀 화면과 스타팅
           선택, 기절 후 강제 교체 창처럼 "반드시 선택해야 하는" 창은 닫지 않는다. */
        /* 창을 닫을 때 입력칸에 남아 있던 포커스를 반드시 놓아준다.
           도감 검색창처럼 input이 있는 창을 닫으면 포커스가 그 안에 남는데,
           게임 단축키는 입력 중일 때 동작하지 않도록 막아두었기 때문에
           그대로 두면 [F] 저장도 [I] 가방도 전부 먹통이 되어 버린다. */
        function releaseFocus() {
            const el = document.activeElement;
            if (el && el !== document.body && typeof el.blur === 'function') el.blur();
        }

        function closeTopModal() {
            const closable = ['help-modal', 'detail-modal', 'gem-modal', 'mega-guide-modal', 'shop-modal', 'pokedex-modal', 'bag-modal', 'box-modal', 'record-modal', 'party-modal'];
            for (const id of closable) {
                const el = document.getElementById(id);
                if (el && el.style.display === 'flex') {
                    if (id === 'party-modal' && gameInstance && gameInstance.forcedPartySwitch) return;
                    el.style.display = 'none';
                    releaseFocus();
                    playSfx('menu');
                    return;
                }
            }
        }

        function showToast(text) {
            const toast = document.getElementById('toast-msg');
            toast.innerText = text;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2200);
        }

        function openPartyModal() {
            const modal = document.getElementById('party-modal');
            const container = document.getElementById('party-list-container');
            container.innerHTML = '';

            // 내 포켓몬이 기절해 강제로 교체해야 하는 상황(forcedPartySwitch)에서는
            // 실제 게임처럼 다른 포켓몬을 고르기 전까지 이 창을 닫을 수 없다.
            // (예전엔 닫기 버튼으로 그냥 창만 닫혀버려서, 기절한 포켓몬이 그대로
            // 전투에 남은 채 아무 조작도 먹히지 않는 먹통 상태가 되는 버그가 있었다.)
            const forced = !!gameInstance.forcedPartySwitch;
            const titleEl = document.getElementById('party-modal-title');
            const closeBtnX = document.getElementById('party-modal-closebtn');
            const closeBtnBottom = document.getElementById('party-modal-bottom-close');
            if (titleEl) titleEl.textContent = forced ? '⚠️ 다음 포켓몬을 선택하세요!' : '🎒 포켓몬 파티 (최대 6마리)';
            if (closeBtnX) closeBtnX.style.visibility = forced ? 'hidden' : 'visible';
            if (closeBtnBottom) closeBtnBottom.style.display = forced ? 'none' : 'block';

            gameInstance.player.party.forEach((pkm, idx) => {
                const item = document.createElement('div');
                item.className = 'party-item';

                const isCurrent = idx === gameInstance.player.activeIdx;
                const isFainted = pkm.hp <= 0;

                let actionBtnHtml = '<button class="btn-action detail-btn" style="padding:4px 8px; font-size:11px; margin-right:5px;">정보</button>';
                if (isFainted) {
                    actionBtnHtml += '<span style="color:var(--neon-pink); font-weight:bold;">[기절함]</span>';
                } else if (isCurrent) {
                    actionBtnHtml += '<span style="color:var(--neon-amber); font-weight:bold;">[참전 중]</span>';
                } else {
                    actionBtnHtml += `<button class="btn-action" style="padding:4px 8px; font-size:11px;">교체</button>`;
                }

                item.innerHTML = `
                    <div style="display:flex; align-items:center; gap:10px; flex:1;">
                        <div class="party-icon-frame">
                            <img src="${pkm.frontSprite}" class="pixel-sprite-fit ${pkm.isShiny ? 'shiny-mon' : ''}" alt="${pkm.species}">
                        </div>
                        <div style="flex:1;">
                            <strong>${pkm.isShiny ? '✨' : ''}${pkm.species}</strong>${pkm.megaSprite ? ' <span style="color:#c084fc; font-size:11px;" title="메가진화 가능">⚡메가</span>' : ''} (Lv.${pkm.level}) - <span style="color:var(--neon-cyan)">${pkm.nature.name}</span> [상태: ${pkm.status}${pkm.attracted ? '/매혹' : ''}${pkm.confused ? '/혼란' : ''}]
                            <div style="font-size:10px; color:#8b5cf6;">특성: ${(ABILITY_DATABASE[pkm.ability] || {}).name || '없음'}</div>
                            <div class="bar-container" style="margin-top:5px; max-width:220px;">
                                <div class="bar-fill ${pkm.hp / pkm.maxHp <= 0.2 ? 'bar-hp-danger' : (pkm.hp / pkm.maxHp <= 0.5 ? 'bar-hp-warn' : 'bar-hp')}" style="width:${Math.max(0, pkm.hp / pkm.maxHp * 100)}%"></div>
                            </div>
                            <div style="font-size:11px; color:var(--text-sub); margin-top:3px;">
                                HP: ${pkm.hp}/${pkm.maxHp} | 공격:${pkm.atk} | 방어:${pkm.def} | 특공:${pkm.spAtk} | 특방:${pkm.spDef} | 스피드:${pkm.spe}
                            </div>
                        </div>
                    </div>
                    <div>${actionBtnHtml}</div>
                `;

                item.onclick = (ev) => {
                    // [정보] 버튼을 누르면 교체 대신 상세 정보를 연다
                    if (ev && ev.target && ev.target.classList && ev.target.classList.contains('detail-btn')) {
                        openDetailModal(idx, false);
                        return;
                    }
                    if (gameInstance.state === GAME_STATES.BATTLE) {
                        gameInstance.switchPokemonInBattle(idx);
                    } else {
                        // [버그 수정] 필드에서 기절한 포켓몬을 선봉으로 지정할 수 있었던 문제.
                        // 이 상태로 야생 조우가 시작되면 이미 쓰러진(HP 0) 포켓몬이 그대로
                        // 전투에 나서버려서, 배틀 시작 직후 정상적으로 기절 처리가 되지 않고
                        // 조작 불능에 가까운 상태가 되는 버그로 이어졌다. 필드에서는 기절하지
                        // 않은 포켓몬만 선봉으로 세울 수 있게 막는다.
                        if (isFainted) {
                            showToast("기절한 포켓몬은 선두에 세울 수 없습니다! 포켓몬 센터에서 치료해주세요.");
                            return;
                        }
                        gameInstance.player.activeIdx = idx;
                        gameInstance.updateUI();
                        openPartyModal();
                    }
                };
                container.appendChild(item);
            });

            // PC 보관함: 파티가 가득 찼을 때 포획된 포켓몬이 여기 보관된다. 전투 중에는
            // (강제 교체 상황 포함) 꺼낼 수 없고, 필드에서 파티에 빈 자리가 있을 때만 꺼낼 수 있다.
            if (gameInstance.player.box.length > 0) {
                const boxHeader = document.createElement('div');
                boxHeader.style.cssText = 'font-weight:bold; margin:14px 0 6px; color:var(--neon-purple); font-size:13px;';
                boxHeader.textContent = `💾 PC 보관함 (${gameInstance.player.box.length}마리)`;
                container.appendChild(boxHeader);

                gameInstance.player.box.forEach((pkm, boxIdx) => {
                    const item = document.createElement('div');
                    item.className = 'party-item';
                    const canWithdraw = gameInstance.state !== GAME_STATES.BATTLE && gameInstance.player.party.length < 6;
                    item.innerHTML = `
                        <div style="display:flex; align-items:center; gap:10px; flex:1;">
                            <div class="party-icon-frame">
                                <img src="${pkm.frontSprite}" class="pixel-sprite-fit" alt="${pkm.species}">
                            </div>
                            <div style="flex:1;">
                                <strong>${pkm.species}</strong> (Lv.${pkm.level}) - <span style="color:var(--neon-cyan)">${pkm.nature.name}</span>
                            </div>
                        </div>
                        <div><button class="btn-action" style="padding:4px 8px; font-size:11px;" ${canWithdraw ? '' : 'disabled'}>${canWithdraw ? '파티로' : (gameInstance.state === GAME_STATES.BATTLE ? '전투 중' : '파티 가득참')}</button></div>
                    `;
                    if (canWithdraw) item.onclick = () => withdrawFromBox(boxIdx);
                    container.appendChild(item);
                });
            }

            modal.style.display = 'flex';
        }

        function withdrawFromBox(boxIdx) {
            if (gameInstance.state === GAME_STATES.BATTLE) return;
            if (gameInstance.player.party.length >= 6) {
                showToast('파티에 빈 자리가 없습니다.');
                return;
            }
            const [pkm] = gameInstance.player.box.splice(boxIdx, 1);
            gameInstance.player.party.push(pkm);
            showToast(`[${pkm.species}]을(를) 파티로 데려왔습니다!`);
            playSfx('menu');
            gameInstance.updateUI();
            gameInstance.saveGame(true);
            if (document.getElementById('box-modal').style.display === 'flex') openBoxModal();
            else openPartyModal();
        }

        /* ==========================================================================
           20. NPC 대화창 - 여러 줄을 스페이스로 넘기고, 마지막에 콜백을 실행한다
           ========================================================================== */
        let _npcDialogQueue = [];
        let _npcDialogDone = null;

        function isNpcDialogOpen() {
            const el = document.getElementById('npc-dialog');
            return !!(el && el.classList.contains('show'));
        }

        function showNpcDialog(name, textOrLines, onDone) {
            const el = document.getElementById('npc-dialog');
            if (!el) { if (onDone) onDone(); return; }
            _npcDialogQueue = Array.isArray(textOrLines) ? [...textOrLines] : [textOrLines];
            _npcDialogDone = onDone || null;
            document.getElementById('npc-dialog-name').textContent = name;
            document.getElementById('npc-dialog-text').textContent = _npcDialogQueue.shift() || '...';
            document.getElementById('npc-dialog-hint').textContent =
                _npcDialogQueue.length ? '[스페이스] 계속' : '[스페이스] 닫기';
            el.classList.add('show');
            playSfx('click');
        }

        function advanceNpcDialog() {
            const el = document.getElementById('npc-dialog');
            if (!el || !el.classList.contains('show')) return;
            if (_npcDialogQueue.length) {
                document.getElementById('npc-dialog-text').textContent = _npcDialogQueue.shift();
                document.getElementById('npc-dialog-hint').textContent =
                    _npcDialogQueue.length ? '[스페이스] 계속' : '[스페이스] 닫기';
                playSfx('click');
                return;
            }
            el.classList.remove('show');
            const cb = _npcDialogDone;
            _npcDialogDone = null;
            if (cb) setTimeout(cb, 120);
        }

        /* ==========================================================================
           18. 기술 습득 선택창
           레벨업으로 새 기술을 배우려는데 이미 4개를 익혔다면, 실제 게임처럼 어떤
           기술을 잊을지 직접 고르게 한다. 전투 중에 창을 띄우면 턴 흐름이 끊기므로
           전투가 끝난 뒤에 밀린 것을 하나씩 처리한다.
           ========================================================================== */
        function flushPendingMoveLearns() {
            if (!gameInstance || !gameInstance.pendingMoveLearns || !gameInstance.pendingMoveLearns.length) return;
            if (gameInstance.state === GAME_STATES.BATTLE) return;

            const job = gameInstance.pendingMoveLearns[0];
            const pkm = job.pkmRef;
            const mv = SKILL_DATABASE[job.moveKey];
            if (!pkm || !mv || pkm.skills.some(sk => sk.name === mv.name) || pkm.skills.length < 4) {
                gameInstance.pendingMoveLearns.shift();
                if (pkm && mv && pkm.skills.length < 4 && !pkm.skills.some(sk => sk.name === mv.name)) {
                    pkm.skills.push(instantiateSkills([mv])[0]);
                    showToast(`📘 ${pkm.species}이(가) [${mv.name}]을(를) 배웠다!`);
                }
                return flushPendingMoveLearns();
            }

            const moveLine = (m) => `${typeBadgeHtml(m.type)} <span class="lm-stat">위력 ${m.power || '-'} · 명중 ${m.accuracy >= 999 ? '필중' : m.accuracy} · ${m.category}</span>`;

            document.getElementById('learn-move-desc').textContent =
                `${pkm.species}은(는) 이미 4개의 기술을 익혔습니다. [${mv.name}]을(를) 배우려면 하나를 잊어야 합니다.`;
            document.getElementById('learn-move-new').innerHTML =
                `<div class="dm-top" style="font-size:14px;">✨ ${mv.name}</div><div style="margin-top:4px;">${moveLine(mv)}</div>`;

            const list = document.getElementById('learn-move-list');
            list.innerHTML = '';
            pkm.skills.forEach((sk, idx) => {
                const row = document.createElement('div');
                row.className = 'learn-move-row';
                row.innerHTML = `<div style="flex:1;"><div class="lm-name">${sk.name}</div><div style="margin-top:3px;">${moveLine(sk)}</div></div><span style="font-size:11px; color:var(--neon-pink); font-weight:bold;">잊기</span>`;
                row.onclick = () => {
                    const forgotten = pkm.skills[idx].name;
                    pkm.skills[idx] = instantiateSkills([mv])[0];
                    gameInstance.pendingMoveLearns.shift();
                    document.getElementById('learn-move-modal').style.display = 'none';
                    showToast(`📘 ${pkm.species}은(는) [${forgotten}]을(를) 잊고 [${mv.name}]을(를) 배웠다!`);
                    playSfx('levelup');
                    gameInstance.updateUI();
                    gameInstance.saveGame(true);
                    setTimeout(() => flushPendingMoveLearns(), 700);
                };
                list.appendChild(row);
            });
            document.getElementById('learn-move-modal').style.display = 'flex';
        }

        function skipMoveLearn() {
            if (!gameInstance || !gameInstance.pendingMoveLearns) return;
            const job = gameInstance.pendingMoveLearns.shift();
            document.getElementById('learn-move-modal').style.display = 'none';
            if (job) {
                const mv = SKILL_DATABASE[job.moveKey];
                showToast(`${job.pkmRef.species}은(는) [${mv ? mv.name : '새 기술'}]을(를) 배우지 않았습니다.`);
            }
            playSfx('menu');
            setTimeout(() => flushPendingMoveLearns(), 500);
        }

        /* ==========================================================================
           19. 포켓몬 상세 정보 화면
           실제 게임의 "포켓몬 정보" 페이지처럼 종족값 막대, 성격 보정, 특성, 개체값,
           경험치, 기술 목록(타입/위력/명중/PP)을 한눈에 보여준다.
           ========================================================================== */
        function openDetailModal(partyIdx, fromBox) {
            if (!gameInstance) return;
            const pkm = fromBox ? gameInstance.player.box[partyIdx] : gameInstance.player.party[partyIdx];
            if (!pkm) return;

            const natureMod = (key) => {
                const n = pkm.nature || {};
                const map = { atk: 'atkMod', def: 'defMod', spAtk: 'spAtkMod', spDef: 'spDefMod', spe: 'speMod' };
                return map[key] ? (n[map[key]] || 1) : 1;
            };
            const statDefs = [
                ['HP', 'hp', pkm.maxHp, '#22c55e'],
                ['공격', 'atk', pkm.atk, '#ef4444'],
                ['방어', 'def', pkm.def, '#f59e0b'],
                ['특공', 'spAtk', pkm.spAtk, '#3b82f6'],
                ['특방', 'spDef', pkm.spDef, '#8b5cf6'],
                ['스피드', 'spe', pkm.spe, '#ec4899']
            ];
            const maxStat = Math.max(...statDefs.map(d => d[2]), 1);

            const statHtml = statDefs.map(([label, key, val, col]) => {
                const mod = natureMod(key);
                let mark = '';
                if (mod > 1.001) mark = '<span class="stat-up">▲</span>';
                else if (mod < 0.999) mark = '<span class="stat-down">▼</span>';
                const iv = (pkm.ivs && pkm.ivs[key] !== undefined) ? pkm.ivs[key] : '-';
                return `<div class="stat-row">
                    <span class="st-label">${label}${mark}</span>
                    <span class="st-bar"><span class="st-fill" style="width:${Math.round(val / maxStat * 100)}%; background:${col};"></span></span>
                    <span class="st-val">${val}</span>
                    <span class="lm-stat" style="width:44px; text-align:right;">개체 ${iv}</span>
                </div>`;
            }).join('');

            const moveHtml = (pkm.skills || []).map(sk => {
                const gem = pkm.gemSlots && pkm.gemSlots[sk.name];
                const gemName = gem && GEM_DATABASE[gem] ? ` · 💎${GEM_DATABASE[gem].name}` : '';
                return `<div class="detail-move">
                    <div class="dm-top">${typeBadgeHtml(sk.type)} ${sk.name}</div>
                    <div class="dm-sub">위력 ${sk.power || '-'} · 명중 ${sk.accuracy >= 999 ? '필중' : sk.accuracy} · ${sk.category} · PP ${sk.pp}/${sk.maxPp}${gemName}</div>
                </div>`;
            }).join('') || '<div class="lm-stat">배운 기술이 없습니다.</div>';

            const nextLearn = (pkm.learnset || []).filter(L => L.lv > pkm.level).sort((a, b) => a.lv - b.lv)[0];
            const nextLearnHtml = nextLearn && SKILL_DATABASE[nextLearn.key]
                ? `<div class="lm-stat" style="margin-top:6px;">📘 Lv.${nextLearn.lv}에 [${SKILL_DATABASE[nextLearn.key].name}] 습득 예정</div>` : '';

            const ability = (ABILITY_DATABASE[pkm.ability] || {});
            const expPct = Math.round((pkm.exp / pkm.maxExp) * 100);

            document.getElementById('detail-title').textContent = `${pkm.isShiny ? '✨ ' : ''}${pkm.species} 정보`;
            document.getElementById('detail-body').innerHTML = `
                <div class="detail-head">
                    <img src="${pkm.frontSprite}" class="${pkm.isShiny ? 'shiny-mon' : ''}" alt="${pkm.species}">
                    <div style="flex:1;">
                        <div class="detail-name">No.${pkm.id} ${pkm.species} ${pkm.isShiny ? '<span style="color:#f59e0b;">✨색이 다른 개체</span>' : ''}</div>
                        <div style="margin-top:4px;">${typeBadgeHtml(pkm.type1)}${typeBadgeHtml(pkm.type2)}</div>
                        <div class="detail-sub">Lv.${pkm.level} · 성격 ${pkm.nature.name} · 상태 ${pkm.status}</div>
                        <div class="detail-sub">특성: <b>${ability.name || '없음'}</b> ${ability.desc ? '- ' + ability.desc : ''}</div>
                        <div class="bar-container" style="margin-top:6px; max-width:240px;">
                            <div class="bar-fill bar-exp" style="width:${expPct}%"></div>
                        </div>
                        <div class="detail-sub">경험치 ${pkm.exp} / ${pkm.maxExp} (${expPct}%)</div>
                    </div>
                </div>
                <div class="detail-grid">
                    <div>
                        <div class="record-section-title" style="margin-top:0;">능력치</div>
                        ${statHtml}
                        <div class="lm-stat" style="margin-top:6px;">▲ 성격으로 오른 능력 · ▼ 내려간 능력</div>
                    </div>
                    <div>
                        <div class="record-section-title" style="margin-top:0;">기술</div>
                        ${moveHtml}
                        ${nextLearnHtml}
                    </div>
                </div>`;
            document.getElementById('detail-modal').style.display = 'flex';
            playSfx('menu');
        }

        function closeDetailModal() { document.getElementById('detail-modal').style.display = 'none'; }

        function closePartyModal() {
            // 기절 후 강제 교체 상황에서는 다른 포켓몬을 선택하기 전까지 닫히지 않는다
            // (버튼 자체를 숨겨두지만, 만약을 대비해 로직으로도 한 번 더 막아둔다).
            if (gameInstance && gameInstance.forcedPartySwitch) {
                showToast("교체할 포켓몬을 선택해야 합니다!");
                return;
            }
            document.getElementById('party-modal').style.display = 'none';
        }

        /* 볼 아이템은 이모지 대신 BALL_CATALOG에서 구운 실제 볼 그림을 보여준다.
           27종이 전부 서로 다른 무늬를 갖고 있으므로 이름을 읽지 않아도 구분된다. */
        function itemIconHtml(item) {
            if (!item) return '';
            const key = item.ballKey || BALL_KEY_BY_ID[item.id];
            if (key) return `<img class="ball-chip-img" src="${ballIconDataUrl(key, 44)}" alt="" title="${item.name}">`;
            return item.emoji ? `${item.emoji} ` : '';
        }

        function openBagModal() {
            const modal = document.getElementById('bag-modal');
            const container = document.getElementById('bag-list-container');
            container.innerHTML = '';

            // 트레이너(체육관 관장)전에서는 몬스터볼이 통하지 않는다는 것을, 던지고 나서야
            // 알기보다 가방을 여는 순간 미리 알 수 있게 안내 문구를 띄운다.
            const inTrainerBattle = gameInstance.state === GAME_STATES.BATTLE && gameInstance.currentEnemy && gameInstance.currentEnemy.isBoss;
            if (inTrainerBattle) {
                const notice = document.createElement('div');
                notice.style.cssText = 'font-size:11px; color:var(--neon-pink); margin-bottom:10px; line-height:1.5;';
                notice.textContent = '⚠️ 트레이너와의 정식 대결 중에는 몬스터볼로 상대 포켓몬을 포획할 수 없습니다.';
                container.appendChild(notice);
            }

            gameInstance.player.inventory.forEach((slot, idx) => {
                const item = document.createElement('div');
                item.className = 'bag-item';
                const emojiPrefix = itemIconHtml(slot.item);
                const ballBlocked = inTrainerBattle && !!slot.item.catchRate;
                const fieldOnly = !!slot.item.repelSec && gameInstance.state === GAME_STATES.BATTLE;
                if (ballBlocked || fieldOnly) item.style.opacity = '0.55';
                item.innerHTML = `
                    <div>
                        <strong>${emojiPrefix}${slot.item.name}</strong> <span style="color:var(--neon-amber)">x${slot.count}</span>
                        <div style="font-size:11px; color:var(--text-sub);">${slot.item.desc}</div>
                    </div>
                    <button class="btn-action" style="padding:4px 10px; font-size:11px;" ${(slot.count <= 0 || ballBlocked || fieldOnly) ? 'disabled' : ''}>${slot.item.isSummonOrb ? '휴대' : (ballBlocked ? '포획 불가' : (slot.item.repelSec && gameInstance.state === GAME_STATES.BATTLE ? '필드 전용' : '사용'))}</button>
                `;
                item.onclick = () => {
                    if (slot.item.isSummonOrb) {
                        showToast("이 성물은 해당 전설의 사원 타일 위에서 [E]키로 사용해야 합니다.");
                    } else if (ballBlocked) {
                        showToast("트레이너가 소유한 포켓몬은 포획할 수 없습니다!");
                    } else if (gameInstance.state === GAME_STATES.BATTLE) {
                        gameInstance.useItemInBattle(idx);
                    } else if (fieldOnly) {
                        showToast('벌레퇴치스프레이는 필드에서만 사용할 수 있습니다.');
                    } else if (slot.item.repelSec) {
                        // 스프레이는 필드 전용이다
                        gameInstance.useItemInField(idx);
                        closeBagModal();
                    } else {
                        showToast("전투 중에 사용하여 포획 및 치유 효과를 볼 수 있습니다.");
                    }
                };
                container.appendChild(item);
            });

            modal.style.display = 'flex';
        }

        function closeBagModal() { document.getElementById('bag-modal').style.display = 'none'; }

        /* [전국도감 대응] 수록 종이 351종 → 1025종으로 늘어나면서, 그냥 전부
           나열하면 원하는 포켓몬을 찾을 수가 없다. 이름/도감번호 검색, 타입 필터,
           "발견한 종만" 보기를 붙이고, 스프라이트는 lazy 로딩으로 바꿔 한 번에
           수백 장의 gif를 내려받지 않도록 했다. */
        function openPokedexModal() {
            const typeSel = document.getElementById('pokedex-type');
            if (typeSel && !typeSel.options.length) {
                const types = Object.keys(TYPE_ANIM_STYLES);
                typeSel.innerHTML = '<option value="">모든 타입</option>' +
                    types.map(t => `<option value="${t}">${t}</option>`).join('');
            }
            renderPokedexList();
            document.getElementById('pokedex-modal').style.display = 'flex';
        }

        function renderPokedexList() {
            if (!gameInstance) return;
            const container = document.getElementById('pokedex-list-container');
            const qEl = document.getElementById('pokedex-search');
            const tEl = document.getElementById('pokedex-type');
            const fEl = document.getElementById('pokedex-found-only');
            const q = (qEl ? qEl.value : '').trim();
            const typeFilter = tEl ? tEl.value : '';
            const foundOnly = fEl ? fEl.checked : false;

            const found = gameInstance.player.pokedex;
            const progressEl = document.getElementById('pokedex-progress');
            if (progressEl) {
                const pct = ((found.size / POKEMON_DATABASE.length) * 100).toFixed(1);
                progressEl.textContent = `(${found.size} / ${POKEMON_DATABASE.length}종 · ${pct}%)`;
            }

            const list = POKEMON_DATABASE.filter(pkm => {
                const isFound = found.has(pkm.id);
                if (foundOnly && !isFound) return false;
                if (typeFilter && pkm.type1 !== typeFilter && pkm.type2 !== typeFilter) return false;
                if (q) {
                    const byNum = String(pkm.id) === q.replace(/^0+/, '');
                    const byName = isFound && pkm.species.includes(q);
                    if (!byNum && !byName) return false;
                }
                return true;
            });

            if (list.length === 0) {
                container.innerHTML = '<div class="pokedex-empty">조건에 맞는 포켓몬이 없습니다.</div>';
                return;
            }

            container.innerHTML = list.map(pkm => {
                if (found.has(pkm.id)) {
                    return `<div class="pokedex-card">
                        <img src="${pkm.frontSprite}" class="pixel-sprite-fit" alt="${pkm.species}" loading="lazy"><br>
                        <strong>No.${pkm.id} ${pkm.species}</strong>${pkm.megaSprite ? ' <span style="color:#c084fc;" title="메가진화 가능">⚡</span>' : ''}${pkm.isLegend ? ' <span style="color:#f59e0b;" title="전설·환상">★</span>' : (pkm.isRareTier ? ' <span style="color:#a855f7;" title="준전설급">✦</span>' : '')}<br>
                        <div style="margin-top:3px;">${typeBadgeHtml(pkm.type1)}${typeBadgeHtml(pkm.type2)}</div>
                    </div>`;
                }
                return `<div class="pokedex-card">
                    <div style="height:60px; line-height:60px; font-size:24px;">❓</div>
                    <strong>No.${pkm.id} ???</strong><br>
                    <span style="color:var(--text-sub);">미발견</span>
                </div>`;
            }).join('');
        }

        function closePokedexModal() { document.getElementById('pokedex-modal').style.display = 'none'; releaseFocus(); }

        /* 메가진화 도감: 발견한(pokedex에 등록된) 포켓몬 중 megaSprite를 가진 종만 필터링해서
           일반 모습과 메가진화 모습을 카드 형태로 나란히 보여준다. 아직 하나도 발견하지 못했다면
           안내 문구를 대신 표시한다. */
        function openMegaGuideModal() {
            const modal = document.getElementById('mega-guide-modal');
            const container = document.getElementById('mega-guide-list-container');
            container.innerHTML = '';

            const megaCapable = POKEMON_DATABASE.filter(p => p.megaSprite);
            const discoveredMegas = megaCapable.filter(p => gameInstance.player.pokedex.has(p.id));

            if (discoveredMegas.length === 0) {
                container.innerHTML = `
                    <div style="grid-column: 1 / -1; text-align:center; padding: 24px; color: var(--text-sub);">
                        아직 메가진화가 가능한 포켓몬을 발견하지 못했습니다.<br>
                        필드를 탐험하며 새로운 포켓몬을 만나보세요! (전체 ${megaCapable.length}종 중 0종 발견)
                    </div>`;
            } else {
                discoveredMegas.forEach(pkm => {
                    const card = document.createElement('div');
                    card.className = 'pokedex-card';
                    card.style.padding = '8px 4px';
                    card.innerHTML = `
                        <div style="display:flex; align-items:center; justify-content:center; gap:4px;">
                            <img src="${pkm.frontSprite}" class="pixel-sprite-fit" style="width:44px; height:44px;" alt="${pkm.species}">
                            <span style="color:var(--neon-purple); font-size:14px;">➜</span>
                            <img src="${pkm.megaSprite}" onerror="this.onerror=null;this.src='${pkm.frontSprite}';" class="pixel-sprite-fit" style="width:44px; height:44px;" alt="메가${pkm.species}">
                        </div>
                        <strong style="font-size:12px;">No.${pkm.id} 메가${pkm.species}</strong><br>
                        <div style="margin-top:3px;">${typeBadgeHtml(pkm.type1)}${typeBadgeHtml(pkm.type2)}</div>
                    `;
                    container.appendChild(card);
                });
                if (discoveredMegas.length < megaCapable.length) {
                    const remain = document.createElement('div');
                    remain.style.cssText = 'grid-column: 1 / -1; text-align:center; padding: 8px; color: var(--text-sub); font-size:12px;';
                    remain.innerText = `그 외 ${megaCapable.length - discoveredMegas.length}종의 메가진화 가능 포켓몬이 미발견 상태입니다.`;
                    container.appendChild(remain);
                }
            }

            modal.style.display = 'flex';
        }

        function closeMegaGuideModal() { document.getElementById('mega-guide-modal').style.display = 'none'; }

        /* 상점 - 취급 품목이 볼 27종을 포함해 40개가 넘어가면서, 예전처럼 전부
           한 줄로 늘어놓으면 원하는 걸 찾기가 어려워졌다. 이제는 [볼 / 회복 / 상태이상 /
           성물] 분류 탭으로 나누고, 볼은 체육관 뱃지 수(ballTier)에 따라 단계적으로
           풀린다 - 초반 상점에는 몬스터볼·수퍼볼·프리미어볼만 진열된다. */
        let _shopTab = 'ball';
        function shopCategoryOf(item) {
            if (item.ballKey || BALL_KEY_BY_ID[item.id]) return 'ball';
            if (item.isSummonOrb) return 'orb';
            if (item.cures) return 'cure';
            if (item.repelSec) return 'tool';
            return 'heal';
        }
        function setShopTab(tab) { _shopTab = tab; openShopModal(); }

        function openShopModal() {
            const modal = document.getElementById('shop-modal');
            const container = document.getElementById('shop-list-container');
            const badges = gameInstance.player.badges;
            container.innerHTML = '';

            const TABS = [
                { key: 'ball', label: '몬스터볼' },
                { key: 'heal', label: '회복' },
                { key: 'cure', label: '상태이상' },
                { key: 'tool', label: '도구' },
                { key: 'orb', label: '성물' }
            ];
            const tabBar = document.createElement('div');
            tabBar.className = 'shop-tabs';
            TABS.forEach(t => {
                const b = document.createElement('button');
                b.className = 'shop-tab' + (_shopTab === t.key ? ' active' : '');
                b.textContent = t.label;
                b.onclick = (e) => { e.stopPropagation(); setShopTab(t.key); };
                tabBar.appendChild(b);
            });
            container.appendChild(tabBar);

            const list = Object.values(ITEM_DATABASE).filter(it => shopCategoryOf(it) === _shopTab);
            let lockedCount = 0;

            list.forEach(itemData => {
                const ballKey = itemData.ballKey || BALL_KEY_BY_ID[itemData.id];
                // 볼은 뱃지 수(tier)로, 성물은 뱃지 1개로 해금한다
                const needBadges = ballKey ? (itemData.ballTier || 0) : (itemData.isSummonOrb ? 1 : 0);
                const isLocked = badges < needBadges;
                if (isLocked) lockedCount++;

                const card = document.createElement('div');
                card.className = 'shop-item' + (isLocked ? ' locked' : '');
                const lockNotice = isLocked
                    ? `<div style="font-size:10px; color:var(--neon-pink); margin-top:2px;">🔒 체육관 뱃지 ${needBadges}개 필요 (현재 ${badges}개)</div>`
                    : '';

                card.innerHTML = `
                    <div>
                        <strong>${itemIconHtml(itemData)}${itemData.name}</strong> - <span style="color:var(--neon-amber)">${itemData.price}G</span>
                        <div style="font-size:11px; color:var(--text-sub);">${itemData.desc}</div>
                        ${lockNotice}
                    </div>
                    <button class="btn-action" style="padding:4px 10px; font-size:11px;" ${isLocked ? 'disabled' : ''}>${isLocked ? '잠김' : '구매'}</button>
                `;
                card.onclick = () => {
                    if (isLocked) {
                        showToast(`🔒 체육관 뱃지 ${needBadges}개를 모아야 구매할 수 있습니다.`);
                        return;
                    }
                    if (gameInstance.player.gold >= itemData.price) {
                        gameInstance.player.gold -= itemData.price;
                        setTimeout(() => gameInstance.saveGame(true), 0);
                        let slot = gameInstance.player.inventory.find(s => s.item.id === itemData.id);
                        if (slot) slot.count++;
                        else gameInstance.player.inventory.push({ item: itemData, count: 1 });
                        showToast(`[${itemData.name}]을(를) 구매했습니다!`);
                        gameInstance.updateUI();
                        openShopModal();
                    } else {
                        showToast("소지금이 부족합니다!");
                    }
                };
                container.appendChild(card);
            });

            if (_shopTab === 'ball' && lockedCount > 0) {
                const note = document.createElement('div');
                note.className = 'shop-note';
                note.textContent = `체육관 뱃지를 모을수록 특수한 볼이 해금됩니다. (잠긴 볼 ${lockedCount}종)`;
                container.appendChild(note);
            }

            modal.style.display = 'flex';
        }

        function closeShopModal() { document.getElementById('shop-modal').style.display = 'none'; releaseFocus(); }

        /* ==========================================================================
           마음의 엠블럼(GEM) 스킬 커스텀 모달
           HTML/CSS에는 이미 이 UI를 위한 구조(gem-modal, .gem-row, .gem-chip 등)가
           준비되어 있었지만, 이를 열고 닫고 실제로 젬을 장착/해제하는 로직 자체가
           빠져 있었다(버튼을 눌러도 반응이 없고, 여는 단축키도 없었음). 배틀 로직
           (gemSlots, applyGemPreDamage/applyGemPostDamage)은 이미 정상 동작하므로,
           여기서는 그 위에 빠져 있던 UI만 새로 연결한다.
           ========================================================================== */
        function openGemModal() {
            const modal = document.getElementById('gem-modal');
            const container = document.getElementById('gem-list-container');
            container.innerHTML = '';

            const invSummary = document.createElement('div');
            invSummary.style.cssText = 'font-size:11px; color:var(--text-sub); margin-bottom:10px; line-height:1.6;';
            invSummary.innerHTML = '보유 중: ' + Object.entries(GEM_DATABASE).map(([key, gem]) => {
                const slot = gameInstance.player.gemInventory.find(g => g.key === key);
                const count = slot ? slot.count : 0;
                return `<span style="margin-right:8px;">${gem.icon}${gem.name} ×${count}</span>`;
            }).join('');
            container.appendChild(invSummary);

            gameInstance.player.party.forEach((pkm, pkmIdx) => {
                const header = document.createElement('div');
                header.style.cssText = 'font-weight:bold; margin:10px 0 4px; color:var(--neon-purple);';
                header.textContent = `${pkm.species} (Lv.${pkm.level})`;
                container.appendChild(header);

                (pkm.skills || []).forEach(move => {
                    const equippedKey = pkm.gemSlots && pkm.gemSlots[move.name];
                    const equippedGem = equippedKey ? GEM_DATABASE[equippedKey] : null;

                    const row = document.createElement('div');
                    row.className = 'gem-row';

                    const headerRow = document.createElement('div');
                    headerRow.className = 'gem-row-header';
                    headerRow.innerHTML = `<strong>${move.name}</strong> <span style="font-size:10px; color:var(--text-sub);">(${move.type})</span>`;
                    if (equippedGem) {
                        const unequipBtn = document.createElement('button');
                        unequipBtn.className = 'gem-unequip-btn';
                        unequipBtn.textContent = '해제';
                        unequipBtn.onclick = () => unequipGem(pkmIdx, move.name);
                        headerRow.appendChild(unequipBtn);
                    }
                    row.appendChild(headerRow);

                    const equippedInfo = document.createElement('div');
                    equippedInfo.className = 'gem-row-equipped';
                    equippedInfo.textContent = equippedGem
                        ? `${equippedGem.icon} ${equippedGem.name} 장착 중 — ${equippedGem.desc}`
                        : '장착된 젬 없음';
                    row.appendChild(equippedInfo);

                    const chipList = document.createElement('div');
                    chipList.className = 'gem-chip-list';
                    Object.entries(GEM_DATABASE).forEach(([key, gem]) => {
                        const slot = gameInstance.player.gemInventory.find(g => g.key === key);
                        const owned = slot ? slot.count : 0;
                        const isEquippedHere = equippedKey === key;
                        const chip = document.createElement('button');
                        chip.className = 'gem-chip';
                        chip.textContent = `${gem.icon} ${gem.name} ×${owned}`;
                        chip.disabled = isEquippedHere || owned <= 0;
                        if (isEquippedHere) chip.style.borderColor = 'var(--neon-purple)';
                        chip.onclick = () => equipGem(pkmIdx, move.name, key);
                        chipList.appendChild(chip);
                    });
                    row.appendChild(chipList);

                    container.appendChild(row);
                });
            });

            modal.style.display = 'flex';
        }

        function closeGemModal() { document.getElementById('gem-modal').style.display = 'none'; }

        function equipGem(pkmIdx, moveName, gemKey) {
            const pkm = gameInstance.player.party[pkmIdx];
            const inv = gameInstance.player.gemInventory;
            const invSlot = inv.find(g => g.key === gemKey);
            if (!invSlot || invSlot.count <= 0) {
                showToast('보유한 젬이 없습니다.');
                return;
            }

            const prevKey = pkm.gemSlots[moveName];
            invSlot.count--;
            if (prevKey && prevKey !== gemKey) {
                const prevSlot = inv.find(g => g.key === prevKey);
                if (prevSlot) prevSlot.count++;
                else inv.push({ key: prevKey, count: 1 });
            }
            pkm.gemSlots[moveName] = gemKey;

            showToast(`💎 [${pkm.species}]의 [${moveName}]에 [${GEM_DATABASE[gemKey].name}]을(를) 장착했습니다!`);
            playSfx('menu');
            openGemModal();
        }

        function unequipGem(pkmIdx, moveName) {
            const pkm = gameInstance.player.party[pkmIdx];
            const prevKey = pkm.gemSlots && pkm.gemSlots[moveName];
            if (!prevKey) return;

            const inv = gameInstance.player.gemInventory;
            const slot = inv.find(g => g.key === prevKey);
            if (slot) slot.count++;
            else inv.push({ key: prevKey, count: 1 });
            delete pkm.gemSlots[moveName];

            showToast(`[${moveName}]에서 젬을 해제했습니다.`);
            playSfx('menu');
            openGemModal();
        }

        /* ==========================================================================
           14-Z. 계정 시스템 (로그인 / 회원가입)
           서버가 없는 브라우저 게임이므로 계정은 이 기기의 localStorage에만 저장된다.
           비밀번호는 원문을 절대 남기지 않고, 계정마다 다른 무작위 소금(salt)을 섞어
           512회 반복한 해시만 보관한다. 저장 데이터도 계정별로 분리되므로 한 브라우저
           에서 여러 트레이너가 각자의 모험을 이어갈 수 있다.
           ========================================================================== */
        /* ==========================================================================
           14-Y. 저장 가능 여부 점검
           파일을 더블클릭해서 여는 방식(file://)이나 시크릿 창에서는 브라우저가
           localStorage를 막아버리는 경우가 있다. 그러면 로그인도 저장도 조용히
           실패하는데, 아무 설명이 없으면 "가입했는데 다음에 오니 사라졌다"는
           최악의 경험이 된다. 부팅 때 미리 확인해서 이유와 해결책을 알려준다.
           ========================================================================== */
        let _storageOk = null;
        function storageAvailable() {
            if (_storageOk !== null) return _storageOk;
            try {
                const probe = '__pue_storage_probe__';
                localStorage.setItem(probe, '1');
                const ok = localStorage.getItem(probe) === '1';
                localStorage.removeItem(probe);
                _storageOk = ok;
            } catch (e) {
                _storageOk = false;
            }
            return _storageOk;
        }

        function storageHelpText() {
            const isFile = location.protocol === 'file:';
            return isFile
                ? '이 브라우저는 파일을 직접 열었을 때 저장을 막고 있습니다. Chrome·Edge·Firefox로 열면 정상 저장됩니다. (Safari는 파일 직접 실행 시 저장이 제한됩니다)'
                : '시크릿/사생활 보호 창이거나 브라우저가 사이트 데이터를 차단하고 있습니다. 일반 창에서 열어주세요.';
        }
        const GUEST_ID = 'guest';
        const RESERVED_IDS = ['guest', 'admin', 'null', 'undefined'];
        const ACCOUNT_KEY = 'pokemon_ultra_expansion_accounts_v1';
        const SESSION_KEY = 'pokemon_ultra_expansion_session_v1';
        let currentUser = null;

        function loadAccounts() {
            try {
                const raw = localStorage.getItem(ACCOUNT_KEY);
                const data = raw ? JSON.parse(raw) : null;
                if (!data || typeof data !== 'object') return { users: {}, legacyClaimed: false };
                if (!data.users) data.users = {};
                return data;
            } catch (e) { return { users: {}, legacyClaimed: false }; }
        }

        function storeAccounts(data) {
            try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(data)); return true; }
            catch (e) { return false; }
        }

        function makeSalt() {
            let s = '';
            for (let i = 0; i < 4; i++) s += Math.floor(Math.random() * 0xffffffff).toString(36);
            return s;
        }

        /* 로컬 저장 전용 해시 - 비밀번호 원문을 남기지 않기 위한 장치다.
           (서버 없는 단일 기기 게임이므로 암호학적 강도를 목표로 하지는 않는다) */
        function hashPassword(pw, salt) {
            const src = String(salt) + ' ' + String(pw);
            let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
            for (let round = 0; round < 512; round++) {
                for (let i = 0; i < src.length; i++) {
                    const c = src.charCodeAt(i) + round;
                    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
                    h2 = Math.imul((h2 + c) ^ (h2 >>> 13), 0x85ebca6b) >>> 0;
                }
                h1 = (h1 ^ (h2 >>> 7)) >>> 0;
                h2 = (h2 ^ (h1 >>> 11)) >>> 0;
            }
            return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
        }

        function normalizeId(id) { return String(id || '').trim().toLowerCase(); }

        function validateCredentials(id, pw) {
            if (!/^[A-Za-z0-9_]{4,16}$/.test(id)) return '아이디는 영문·숫자·밑줄 4~16자여야 합니다.';
            if (RESERVED_IDS.includes(normalizeId(id))) return '사용할 수 없는 아이디입니다. 다른 아이디를 골라주세요.';
            if (String(pw).length < 4) return '비밀번호는 4자 이상이어야 합니다.';
            return null;
        }

        /* 계정별 세이브 키. 로그인 전에는 예전(단일 세이브) 키를 그대로 쓴다. */
        function applySaveScope(userId) {
            SAVE_KEY = userId ? `${SAVE_KEY_BASE}::${userId}` : SAVE_KEY_BASE;
        }

        /* 계정 기능이 없던 시절의 저장 데이터를 첫 계정이 그대로 물려받는다.
           (업데이트 한 번에 기존 모험이 사라지는 일이 없도록) */
        function claimLegacySave(store, userId) {
            if (store.legacyClaimed) return false;
            let legacy = null;
            try { legacy = localStorage.getItem(SAVE_KEY_BASE); } catch (e) { return false; }
            store.legacyClaimed = true;
            if (!legacy) { storeAccounts(store); return false; }
            try {
                const key = `${SAVE_KEY_BASE}::${userId}`;
                if (!localStorage.getItem(key)) localStorage.setItem(key, legacy);
                localStorage.removeItem(SAVE_KEY_BASE);
            } catch (e) { /* 용량 부족 등 - 무시하고 진행 */ }
            storeAccounts(store);
            return true;
        }

        function setAuthMessage(elId, text, ok) {
            const el = document.getElementById(elId);
            if (!el) return;
            el.textContent = text || '';
            el.className = 'login-msg' + (ok ? ' ok' : '');
        }

        function switchAuthTab(tab) {
            const isLogin = tab === 'login';
            document.getElementById('auth-tab-login').classList.toggle('active', isLogin);
            document.getElementById('auth-tab-signup').classList.toggle('active', !isLogin);
            document.getElementById('auth-login-form').style.display = isLogin ? 'flex' : 'none';
            document.getElementById('auth-signup-form').style.display = isLogin ? 'none' : 'flex';
            setAuthMessage('login-msg', '');
            setAuthMessage('signup-msg', '');
            const focus = document.getElementById(isLogin ? 'login-id' : 'signup-id');
            if (focus) setTimeout(() => focus.focus(), 40);
            playSfx('menu');
        }

        function renderAccountChips() {
            const box = document.getElementById('login-accounts');
            if (!box) return;
            const users = Object.values(loadAccounts().users);
            if (!users.length) {
                box.innerHTML = '<span class="login-foot" style="margin:0;">아직 계정이 없습니다. [회원가입]으로 트레이너를 등록하세요.</span>';
                return;
            }
            users.sort((a, b) => (b.lastLogin || 0) - (a.lastLogin || 0));
            box.innerHTML = '';
            users.slice(0, 6).forEach(u => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'login-account-chip';
                chip.textContent = `${u.name || u.id} (@${u.id})`;
                chip.onclick = () => {
                    document.getElementById('login-id').value = u.id;
                    document.getElementById('login-pw').value = '';
                    document.getElementById('login-pw').focus();
                    switchAuthTab('login');
                };
                box.appendChild(chip);
            });
        }

        function showLoginScreen() {
            const modal = document.getElementById('login-modal');
            modal.style.display = 'flex';

            // 게스트 기록이 남아 있으면 회원가입 폼에 [기록 가져오기]를 띄운다
            let upgrading = false;
            try {
                upgrading = sessionStorage.getItem('pue_guest_upgrade') === '1';
                if (upgrading) sessionStorage.removeItem('pue_guest_upgrade');
            } catch (e) { upgrading = false; }
            const guestSave = readGuestSaveSummary();
            const importRow = document.getElementById('signup-import-row');
            const importBox = document.getElementById('signup-import-guest');
            if (importRow) importRow.style.display = guestSave ? 'flex' : 'none';
            if (importBox) importBox.checked = !!(guestSave && upgrading);

            // 저장이 막힌 환경이면 가입 전에 먼저 알려준다
            const warnEl = document.getElementById('storage-warning');
            if (warnEl) {
                const ok = storageAvailable();
                warnEl.style.display = ok ? 'none' : 'block';
                if (!ok) warnEl.innerHTML = `⚠️ <b>이 환경에서는 진행 상황이 저장되지 않습니다.</b><br>${storageHelpText()}<br>지금 그대로 해보려면 아래 <b>[게스트로 시작]</b>을 누르세요 (이번 판만 즐길 수 있습니다).`;
            }

            switchAuthTab(upgrading && guestSave ? 'signup' : 'login');
            renderAccountChips();
            if (upgrading && guestSave) {
                setAuthMessage('signup-msg', `게스트 기록(${guestSave.lead})을 새 계정으로 옮깁니다. 아이디와 비밀번호를 정해주세요.`, true);
            }
            const last = (() => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } })();
            if (last && last.id) document.getElementById('login-id').value = last.id;
        }

        function submitLogin(ev) {
            if (ev) ev.preventDefault();
            const id = normalizeId(document.getElementById('login-id').value);
            const pw = document.getElementById('login-pw').value;
            const store = loadAccounts();
            const user = store.users[id];
            if (!user) {
                setAuthMessage('login-msg', '등록되지 않은 아이디입니다. 회원가입을 먼저 진행하세요.');
                playSfx('fail');
                return false;
            }
            if (hashPassword(pw, user.salt) !== user.hash) {
                setAuthMessage('login-msg', '비밀번호가 일치하지 않습니다.');
                playSfx('fail');
                return false;
            }
            user.lastLogin = Date.now();
            storeAccounts(store);
            const remember = document.getElementById('login-remember').checked;
            finishAuth(user, remember, store);
            return false;
        }

        function submitSignup(ev) {
            if (ev) ev.preventDefault();
            const rawId = document.getElementById('signup-id').value.trim();
            const id = normalizeId(rawId);
            const name = document.getElementById('signup-name').value.trim() || rawId;
            const pw = document.getElementById('signup-pw').value;
            const pw2 = document.getElementById('signup-pw2').value;

            const invalid = validateCredentials(rawId, pw);
            if (invalid) { setAuthMessage('signup-msg', invalid); playSfx('fail'); return false; }
            if (pw !== pw2) { setAuthMessage('signup-msg', '비밀번호 확인이 일치하지 않습니다.'); playSfx('fail'); return false; }
            if (name.length > 10) { setAuthMessage('signup-msg', '트레이너 이름은 10자 이하로 지어주세요.'); playSfx('fail'); return false; }

            const store = loadAccounts();
            if (store.users[id]) { setAuthMessage('signup-msg', '이미 사용 중인 아이디입니다.'); playSfx('fail'); return false; }

            const salt = makeSalt();
            const user = { id, name, salt, hash: hashPassword(pw, salt), createdAt: Date.now(), lastLogin: Date.now() };
            store.users[id] = user;
            if (!storeAccounts(store)) {
                setAuthMessage('signup-msg', '브라우저 저장 공간에 접근할 수 없어 계정을 만들지 못했습니다.');
                return false;
            }
            const wantImport = document.getElementById('signup-import-guest');
            const imported = (wantImport && wantImport.checked) ? importGuestSave(id) : false;
            setAuthMessage('signup-msg', `[${name}] 트레이너 등록 완료! 바로 모험을 시작합니다.`, true);
            playSfx('achievement');
            finishAuth(user, true, store);
            if (imported) showToast('🎫 게스트로 진행한 기록을 새 계정으로 옮겼습니다.');
            return false;
        }

        function finishAuth(user, remember, store) {
            currentUser = user;
            applySaveScope(user.id);
            if (!user.guest) claimLegacySave(store || loadAccounts(), user.id);
            try {
                if (remember) localStorage.setItem(SESSION_KEY, JSON.stringify({ id: user.id, guest: !!user.guest, at: Date.now() }));
                else localStorage.removeItem(SESSION_KEY);
            } catch (e) { /* 저장 불가 환경 - 자동 로그인만 포기한다 */ }

            document.getElementById('login-modal').style.display = 'none';
            document.getElementById('login-pw').value = '';
            document.getElementById('signup-pw').value = '';
            document.getElementById('signup-pw2').value = '';

            document.getElementById('title-modal').style.display = 'flex';
            if (gameInstance) gameInstance.titleScreenActive = true;
            refreshTitleScreen();
            updateTrainerHud();
            playSfx('menu');
        }

        function updateTrainerHud() {
            const el = document.getElementById('hud-trainer');
            if (el) el.textContent = currentUser ? currentUser.name : '트레이너';
        }

        function renderTitleAccount() {
            const el = document.getElementById('title-account');
            const upgradeBtn = document.getElementById('title-upgrade');
            const deleteBtn = document.getElementById('title-delete-account');
            const logoutBtn = document.getElementById('title-logout');
            const guest = !!(currentUser && currentUser.guest);

            if (upgradeBtn) upgradeBtn.style.display = guest ? 'block' : 'none';
            if (deleteBtn) deleteBtn.style.display = guest ? 'none' : 'block';
            if (logoutBtn) logoutBtn.textContent = guest ? '👤 계정으로 로그인' : '👤 계정 전환 / 로그아웃';

            if (!el) return;
            if (!currentUser) { el.style.display = 'none'; return; }
            el.style.display = 'inline-flex';
            el.classList.toggle('guest', guest);
            el.innerHTML = guest
                ? '🎫 <b>게스트 모드</b> <span style="opacity:0.75">— 기록이 보호되지 않습니다</span>'
                : `👤 <b>${currentUser.name}</b> <span style="opacity:0.7">@${currentUser.id}</span>`;
        }

        /* 로그아웃/계정 삭제는 페이지를 새로 띄운다. 그냥 로그인 화면만 다시 보여주면
           이전 계정의 파티·세계·진행도가 엔진에 그대로 남아, 다음 사람이 [새로운 모험]을
           골랐을 때 남의 포켓몬을 데리고 시작하게 된다. 부팅 연출은 한 번 봤으므로
           sessionStorage 표식을 남겨 건너뛴다. */
        function restartSession() {
            try { sessionStorage.setItem('pue_skip_boot', '1'); } catch (e) {}
            location.reload();
        }

        function logoutAccount() {
            if (gameInstance && gameInstance.state === GAME_STATES.FIELD && gameInstance.player.party.length) {
                gameInstance.saveGame(true);
            }
            try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
            playSfx('menu');
            restartSession();
        }

        function deleteCurrentAccount() {
            if (!currentUser || currentUser.guest) return;
            const id = currentUser.id;
            if (!confirm(`계정 [${id}]과(와) 이 계정의 모든 모험 데이터를 삭제할까요? 되돌릴 수 없습니다.`)) return;
            const pw = prompt('확인을 위해 비밀번호를 입력하세요.');
            if (pw === null) return;
            const store = loadAccounts();
            const user = store.users[id];
            if (!user || hashPassword(pw, user.salt) !== user.hash) {
                showToast('비밀번호가 일치하지 않아 삭제를 취소했습니다.');
                playSfx('fail');
                return;
            }
            delete store.users[id];
            storeAccounts(store);
            try { localStorage.removeItem(`${SAVE_KEY_BASE}::${id}`); } catch (e) {}
            try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
            currentUser = null;
            applySaveScope(null);
            playSfx('fail');
            alert(`계정 [${id}]을(를) 삭제했습니다.`);
            restartSession();
        }

        /* ==========================================================================
           14-Z2. 게스트 모드
           계정을 만들지 않고 바로 시작할 수 있지만, 기록이 비밀번호로 보호되지 않고
           다음 게스트에게 덮어써질 수 있다. 그래서 [게스트로 시작]을 누르면 곧바로
           들어가지 않고 무엇을 감수하는지 보여준 뒤 한 번 더 확인을 받는다.
           나중에 계정을 만들 때 게스트 기록을 그대로 옮길 수 있다.
           ========================================================================== */
        function makeGuestUser() {
            return { id: GUEST_ID, name: '게스트', guest: true, lastLogin: Date.now() };
        }

        function guestSaveKey() { return `${SAVE_KEY_BASE}::${GUEST_ID}`; }

        /* 게스트로 진행한 기록이 남아 있으면 요약을 돌려준다 (없으면 null) */
        function readGuestSaveSummary() {
            try {
                const raw = localStorage.getItem(guestSaveKey());
                if (!raw) return null;
                const data = JSON.parse(raw);
                const lead = data && data.player && data.player.party && data.player.party[0];
                if (!lead) return null;
                return {
                    lead: `${lead.species} Lv.${lead.level}`,
                    party: data.player.party.length,
                    badges: data.player.badges || 0
                };
            } catch (e) { return null; }
        }

        function askGuestLogin() {
            const box = document.getElementById('guest-existing');
            const prev = readGuestSaveSummary();
            if (!storageAvailable()) {
                // 저장 자체가 막힌 환경 - 이번 판만 즐기는 체험 모드가 된다
                box.innerHTML = '<span style="color:#fca5a5">이 환경에서는 저장이 되지 않습니다. 창을 닫으면 진행이 사라집니다.</span>';
            } else {
                box.innerHTML = prev
                    ? `이 브라우저에 게스트 기록이 있습니다 — ${prev.lead} · 파티 ${prev.party}마리 · 뱃지 ${prev.badges}개<br><span style="color:#bdd0e8">시작하면 이 기록을 이어서 진행합니다.</span>`
                    : '';
            }
            document.getElementById('guest-confirm').style.display = 'flex';
            playSfx('menu');
        }

        function cancelGuestLogin() {
            document.getElementById('guest-confirm').style.display = 'none';
            playSfx('menu');
        }

        function confirmGuestLogin() {
            document.getElementById('guest-confirm').style.display = 'none';
            finishAuth(makeGuestUser(), true, loadAccounts());
            showToast('🎫 게스트로 시작합니다. 기록은 이 브라우저에만 저장됩니다.');
        }

        /* 게스트 → 정식 계정 전환. 페이지를 새로 띄우면서 회원가입 탭이 열리고
           [게스트 기록 가져오기]가 미리 체크된 상태로 시작한다. */
        function startGuestUpgrade() {
            if (gameInstance && gameInstance.state === GAME_STATES.FIELD && gameInstance.player.party.length) {
                gameInstance.saveGame(true);
            }
            try {
                sessionStorage.setItem('pue_guest_upgrade', '1');
                localStorage.removeItem(SESSION_KEY);
            } catch (e) {}
            playSfx('menu');
            restartSession();
        }

        /* 회원가입 시 게스트 기록을 새 계정으로 옮긴다 */
        function importGuestSave(newId) {
            try {
                const raw = localStorage.getItem(guestSaveKey());
                if (!raw) return false;
                localStorage.setItem(`${SAVE_KEY_BASE}::${newId}`, raw);
                localStorage.removeItem(guestSaveKey());
                return true;
            } catch (e) { return false; }
        }

        /* ==========================================================================
           14-Z1. 부팅 인트로
           게임기에 전원이 들어오며 화면이 켜지고, 시스템 점검이 흐른 뒤 로그인 화면이
           뜬다. 아무 키나 누르거나 화면을 클릭하면 즉시 건너뛴다.
           ========================================================================== */
        const BOOT_LINES = [
            'SYSTEM CHECK',
            'LOADING POKéDEX  1025 ENTRIES',
            'MOUNTING WORLD  320 x 320',
            'CALIBRATING BATTLE STAGE',
            'READY'
        ];
        let _bootDone = false;

        function runBootSequence() {
            const screen = document.getElementById('boot-screen');
            if (!screen) { autoLoginOrPrompt(); return; }

            // 계정 전환으로 다시 띄운 경우엔 전원 연출을 생략하고 바로 로그인으로 간다
            let skipBoot = false;
            try {
                skipBoot = sessionStorage.getItem('pue_skip_boot') === '1';
                if (skipBoot) sessionStorage.removeItem('pue_skip_boot');
            } catch (e) { skipBoot = false; }
            if (skipBoot) {
                _bootDone = true;
                screen.classList.add('done');
                autoLoginOrPrompt();
                return;
            }

            const fill = document.getElementById('boot-bar-fill');
            const status = document.getElementById('boot-status');
            screen.classList.add('on');

            const timers = [];
            const at = (ms, fn) => timers.push(setTimeout(fn, ms));

            BOOT_LINES.forEach((line, i) => {
                at(900 + i * 360, () => {
                    status.textContent = line;
                    fill.style.width = `${Math.round(((i + 1) / BOOT_LINES.length) * 100)}%`;
                });
            });
            at(900 + BOOT_LINES.length * 360 + 260, () => finishBoot());

            const skip = () => finishBoot();
            const onKey = (e) => { if (e.key !== 'F5' && e.key !== 'F12') skip(); };
            document.addEventListener('keydown', onKey);
            screen.addEventListener('click', skip);

            function finishBoot() {
                if (_bootDone) return;
                _bootDone = true;
                timers.forEach(clearTimeout);
                document.removeEventListener('keydown', onKey);
                screen.removeEventListener('click', skip);
                status.textContent = 'READY';
                fill.style.width = '100%';
                screen.classList.add('flash');
                playSfx('menu');
                setTimeout(() => {
                    screen.classList.add('done');
                    autoLoginOrPrompt();
                }, 380);
            }
        }

        /* 자동 로그인이 켜져 있으면 로그인 화면을 건너뛰고 바로 타이틀로 넘어간다 */
        function autoLoginOrPrompt() {
            let session = null;
            try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { session = null; }
            const store = loadAccounts();
            if (session && session.guest) {
                finishAuth(makeGuestUser(), true, store);
                showToast('🎫 게스트 모드로 이어서 시작합니다.');
                return;
            }
            if (session && session.id && store.users[session.id]) {
                const user = store.users[session.id];
                user.lastLogin = Date.now();
                storeAccounts(store);
                finishAuth(user, true, store);
                showToast(`👤 [${user.name}] 트레이너로 자동 로그인했습니다.`);
                return;
            }
            showLoginScreen();
        }

        /* ==========================================================================
           15. 타이틀 화면 · 세이브 관리
           실제 상용 게임처럼 부팅 직후 타이틀 화면이 먼저 뜨고, 저장 데이터가 있으면
           [이어하기]로 그 자리에서 모험을 재개할 수 있다.
           ========================================================================== */
        function readSaveData() {
            try {
                const raw = localStorage.getItem(SAVE_KEY);
                if (!raw) return null;
                const data = JSON.parse(raw);
                if (!data || !data.player || !data.player.party || data.player.party.length === 0) return null;
                return data;
            } catch (e) { return null; }
        }

        function formatPlaytime(sec) {
            const s = Math.max(0, Math.floor(sec || 0));
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            return `${h}시간 ${String(m).padStart(2, '0')}분`;
        }

        function refreshTitleScreen() {
            renderTitleAccount();
            const data = readSaveData();
            const infoEl = document.getElementById('title-save-info');
            const contBtn = document.getElementById('title-continue');
            const eraseBtn = document.getElementById('title-erase');

            if (!data) {
                infoEl.className = 'title-save-info empty';
                infoEl.innerHTML = '저장된 모험이 없습니다. <b>새로운 모험</b>을 시작하세요.';
                contBtn.disabled = true;
                eraseBtn.disabled = true;
                return;
            }

            const lead = data.player.party[0];
            const when = new Date(data.savedAt || Date.now());
            const stamp = `${when.getFullYear()}.${String(when.getMonth() + 1).padStart(2, '0')}.${String(when.getDate()).padStart(2, '0')} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
            infoEl.className = 'title-save-info';
            infoEl.innerHTML = `
                <b style="color:var(--poke-yellow)">${lead.species} Lv.${lead.level}</b> ·
                파티 ${data.player.party.length}마리 · 도감 ${(data.player.pokedex || []).length}종<br>
                뱃지 ${data.player.badges}/${GYM_COUNT} · 소지금 ${data.player.gold}G ·
                플레이 ${formatPlaytime((data.stats || {}).playSec)}<br>
                <span style="color:#7f93ad; font-size:11px;">마지막 저장: ${stamp}</span>
            `;
            contBtn.disabled = false;
            eraseBtn.disabled = false;
        }

        function hideTitleScreen() {
            document.getElementById('title-modal').style.display = 'none';
            if (gameInstance) gameInstance.titleScreenActive = false;
        }

        function titleNewGame() {
            const data = readSaveData();
            if (data && !confirm('저장된 모험이 있습니다. 새로 시작하면 지금 저장된 데이터는 덮어써집니다. 계속할까요?')) return;
            playSfx('menu');
            try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
            hideTitleScreen();
            gameInstance.state = GAME_STATES.STARTER_SELECT;
            document.getElementById('starter-modal').style.display = 'flex';
        }

        function titleContinue() {
            const data = readSaveData();
            if (!data) { showToast('불러올 저장 데이터가 없습니다.'); return; }
            playSfx('menu');
            if (!gameInstance.applySave(data)) {
                showToast('⚠️ 저장 데이터를 불러오지 못했습니다.');
                return;
            }
            hideTitleScreen();
            showToast(`💾 모험을 이어서 시작합니다! (플레이 ${formatPlaytime(gameInstance.stats.playSec)})`);
            gameInstance.refreshFieldMusic(true);
        }

        function titleEraseSave() {
            if (!confirm('저장된 모험 데이터를 완전히 삭제할까요? 되돌릴 수 없습니다.')) return;
            try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
            playSfx('fail');
            refreshTitleScreen();
        }

        /* ==========================================================================
           16-B. 조작 방법 도움말
           예전에는 게임기 바깥 아래에 조작키가 두 줄로 죽 늘어서 있어 화면이 산만했다.
           이제 화면 우상단 [?] 버튼(또는 ? / F1 키)으로 여는 창 하나로 옮기고,
           용도별로 묶어 키캡 모양으로 보여준다.
           ========================================================================== */
        const HELP_SECTIONS = [
            {
                title: '이동',
                rows: [
                    { keys: ['W', 'A', 'S', 'D'], desc: '상하좌우 이동' },
                    { keys: ['Z'], desc: '자전거 탑승 / 해제 (이동 속도 증가)' },
                    { keys: ['Space'], desc: '앞에 있는 NPC와 대화' }
                ]
            },
            {
                title: '포켓몬',
                rows: [
                    { keys: ['P'], desc: '파티 확인 · 선두 교체' },
                    { keys: ['B'], desc: 'PC 보관함' },
                    { keys: ['V'], desc: '포켓몬 도감' },
                    { keys: ['X'], desc: '메가진화 도감' },
                    { keys: ['U'], desc: '마음의 엠블럼(젬) 장착' }
                ]
            },
            {
                title: '아이템 · 시설',
                rows: [
                    { keys: ['I'], desc: '가방 열기' },
                    { keys: ['M'], desc: '상점 (프렌들리 숍)' },
                    { keys: ['H'], desc: '포켓몬센터에서 회복' },
                    { keys: ['G'], desc: '체육관 도전' },
                    { keys: ['E'], desc: '사원에서 성물 사용' }
                ]
            },
            {
                title: '시스템',
                rows: [
                    { keys: ['F'], desc: '지금 바로 저장' },
                    { keys: ['R'], desc: '모험 기록 · 업적' },
                    { keys: ['T'], desc: '화면 효과(셰이더) 켜기 / 끄기' },
                    { keys: ['?'], desc: '이 도움말 열기 / 닫기' },
                    { keys: ['Esc'], desc: '열려 있는 창 닫기' }
                ]
            }
        ];

        function renderHelpGrid() {
            const grid = document.getElementById('help-grid');
            if (!grid || grid.dataset.built === '1') return;
            grid.innerHTML = HELP_SECTIONS.map(sec => `
                <div class="help-group">
                    <div class="help-group-title">${sec.title}</div>
                    ${sec.rows.map(r => `
                        <div class="help-row">
                            <span class="help-keys">${r.keys.map(k => `<span class="help-key">${k}</span>`).join('')}</span>
                            <span>${r.desc}</span>
                        </div>`).join('')}
                </div>`).join('');
            grid.dataset.built = '1';
        }

        function openHelpModal() {
            renderHelpGrid();
            document.getElementById('help-modal').style.display = 'flex';
            playSfx('menu');
        }

        function closeHelpModal() {
            document.getElementById('help-modal').style.display = 'none';
            playSfx('menu');
        }

        function toggleHelpModal() {
            const el = document.getElementById('help-modal');
            if (el && el.style.display === 'flex') closeHelpModal();
            else openHelpModal();
        }

        /* ==========================================================================
           16. 업적 팝업 / 모험 기록 화면
           ========================================================================== */
        function showAchievementPopup(a) {
            const pop = document.getElementById('achievement-popup');
            if (!pop) return;
            document.getElementById('ach-pop-icon').textContent = a.icon;
            document.getElementById('ach-pop-name').textContent = a.name;
            document.getElementById('ach-pop-desc').textContent = a.desc;
            pop.classList.remove('show');
            void pop.offsetWidth;
            pop.classList.add('show');
            playSfx('achievement');
        }

        function openRecordModal() {
            if (!gameInstance || gameInstance.player.party.length === 0) return;
            const g = gameInstance;
            const dexTotal = POKEMON_DATABASE.length;
            const dexPct = ((g.player.pokedex.size / dexTotal) * 100).toFixed(1);
            const best = g.player.party.concat(g.player.box).reduce((m, p) => Math.max(m, p.level), 0);

            const cells = [
                ['플레이 시간', formatPlaytime(g.stats.playSec)],
                ['걸음 수', g.stats.steps.toLocaleString()],
                ['포획한 포켓몬', `${g.stats.captures}마리`],
                ['전투 승리', `${g.stats.battlesWon}회`],
                ['체육관 제패', `${g.player.badges}/${GYM_COUNT}`],
                ['도감 등록', `${g.player.pokedex.size}종 (${dexPct}%)`],
                ['최고 레벨', `Lv.${best}`],
                ['소지금', `${g.player.gold.toLocaleString()}G`],
                ['전설 포획', `${g.stats.legendsCaught}마리`],
                ['트레이너 격파', `${g.stats.trainersBeaten || 0}명`],
                ['✨ 이로치 포획', `${g.stats.shiniesCaught || 0}마리`],
                ['메가진화', `${g.stats.megaEvolutions}회`],
                ['보관 중', `${g.player.box.length}마리`],
                ['챔피언', g.player.championDefeated ? '👑 격파' : '미도전']
            ];

            document.getElementById('record-stats-grid').innerHTML = cells.map(([l, v]) =>
                `<div class="record-stat"><div class="rs-label">${l}</div><div class="rs-value">${v}</div></div>`).join('');

            const got = g.unlockedAchievements.size;
            document.getElementById('record-ach-count').textContent = `(${got}/${ACHIEVEMENTS.length})`;
            document.getElementById('record-ach-grid').innerHTML = ACHIEVEMENTS.map(a => {
                const done = g.unlockedAchievements.has(a.id);
                return `<div class="record-ach ${done ? 'done' : 'locked'}">
                    <div class="ra-icon">${done ? a.icon : '🔒'}</div>
                    <div><div class="ra-name">${a.name}</div><div class="ra-desc">${a.desc}</div></div>
                </div>`;
            }).join('');

            document.getElementById('record-modal').style.display = 'flex';
            playSfx('menu');
        }

        function closeRecordModal() { document.getElementById('record-modal').style.display = 'none'; }

        /* ==========================================================================
           17. PC 보관 시스템 - 파티↔보관함을 양방향으로 옮길 수 있는 전용 화면.
           예전에는 파티가 가득 찼을 때 자동 전송된 포켓몬을 꺼내오는 것만 가능했고,
           반대로 파티의 포켓몬을 맡길 수는 없었다.
           ========================================================================== */
        function openBoxModal() {
            if (!gameInstance || gameInstance.state === GAME_STATES.BATTLE) {
                showToast('전투 중에는 보관함을 열 수 없습니다.');
                return;
            }
            const g = gameInstance;
            const entry = (pkm, actionLabel) => `
                <div class="box-entry">
                    <img src="${pkm.frontSprite}" alt="${pkm.species}">
                    <div style="flex:1;">
                        <div class="be-name">${pkm.species} ${pkm.megaSprite ? '<span style="color:#a855f7;">⚡</span>' : ''}</div>
                        <div class="be-sub">Lv.${pkm.level} · ${pkm.nature.name} · HP ${pkm.hp}/${pkm.maxHp}</div>
                    </div>
                    <span style="font-size:11px; color:var(--neon-blue); font-weight:bold;">${actionLabel}</span>
                </div>`;

            document.getElementById('box-party-count').textContent = `(${g.player.party.length}/6)`;
            document.getElementById('box-storage-count').textContent = `(${g.player.box.length}마리)`;

            const partyEl = document.getElementById('box-party-list');
            partyEl.innerHTML = '';
            g.player.party.forEach((pkm, idx) => {
                const div = document.createElement('div');
                div.innerHTML = entry(pkm, g.player.party.length > 1 ? '맡기기 →' : '마지막');
                const node = div.firstElementChild;
                node.onclick = () => depositToBox(idx);
                partyEl.appendChild(node);
            });

            const boxEl = document.getElementById('box-storage-list');
            boxEl.innerHTML = '';
            if (g.player.box.length === 0) {
                boxEl.innerHTML = '<div class="box-empty">보관 중인 포켓몬이 없습니다.<br>파티가 가득 찬 상태로 포획하면 이곳에 보관됩니다.</div>';
            } else {
                g.player.box.forEach((pkm, idx) => {
                    const div = document.createElement('div');
                    div.innerHTML = entry(pkm, '← 데려가기');
                    const node = div.firstElementChild;
                    node.onclick = () => withdrawFromBox(idx);
                    boxEl.appendChild(node);
                });
            }
            document.getElementById('box-modal').style.display = 'flex';
        }

        function closeBoxModal() { document.getElementById('box-modal').style.display = 'none'; }

        function depositToBox(partyIdx) {
            const g = gameInstance;
            if (g.state === GAME_STATES.BATTLE) return;
            if (g.player.party.length <= 1) {
                showToast('마지막 남은 포켓몬은 맡길 수 없습니다.');
                return;
            }
            const [pkm] = g.player.party.splice(partyIdx, 1);
            g.player.box.push(pkm);
            if (g.player.activeIdx >= g.player.party.length) g.player.activeIdx = 0;
            else if (partyIdx < g.player.activeIdx) g.player.activeIdx--;
            if (g.player.party[g.player.activeIdx].hp <= 0) {
                const alive = g.player.party.findIndex(p => p.hp > 0);
                if (alive >= 0) g.player.activeIdx = alive;
            }
            showToast(`[${pkm.species}]을(를) 보관함에 맡겼습니다.`);
            playSfx('menu');
            g.updateUI();
            g.saveGame(true);
            openBoxModal();
        }

        window.addEventListener('load', () => {
            gameInstance = new GameEngine();
            gameInstance.titleScreenActive = true;
            gameInstance.render();
            // 전원이 들어오는 부팅 연출 → 로그인(또는 자동 로그인) → 타이틀 화면 순서
            runBootSequence();
        });

        // 창을 닫거나 탭을 전환할 때 진행 상황을 놓치지 않도록 마지막으로 한 번 더 저장
        window.addEventListener('beforeunload', () => {
            if (gameInstance && gameInstance.state === GAME_STATES.FIELD) gameInstance.saveGame(true);
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && gameInstance && gameInstance.state === GAME_STATES.FIELD) gameInstance.saveGame(true);
        });