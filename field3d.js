/* ==========================================================================
   3D 필드 렌더러 - 포켓몬스터 블랙·화이트 스타일 (도트 텍스처 + 원근 3D 시점)

   게임 로직(이동/충돌/조우/NPC/세이브)은 기존 타일맵 그대로이고, 화면에
   그리는 방식만 바꾼다.

     · 지면      : 타일마다 16×16 도트 타일을 코드로 그려 한 장의 텍스처로 구운 뒤
                   바닥 평면에 입힌다 (잔디 테두리·물가 포말 같은 경계선 포함).
     · 나무/풀숲 : 외곽선이 있는 도트 그림을 카메라 쪽으로 세운 판으로 배치.
     · 건물/절벽 : 도트 텍스처를 입힌 3D 상자·지붕.
     · 캐릭터    : 게임의 도트 캐릭터를 그대로 3D 공간에 세운다.
     · 조명 없이 텍스처 색을 그대로 보여주고, 시간대는 전체 색조로 표현한다.
     · DS 해상도로 렌더링 후 도트 그대로 확대.

   [3] 키로 3D / 2D 필드를 전환할 수 있다. 아트는 모두 코드로 새로 그린 것이다.
   ========================================================================== */
(function () {
    'use strict';

    const F3 = window.RB3D = {};
    const S = 2;                      // 타일 1칸 = 2 월드 단위
    const TP = 16;                    // 타일 도트 크기 (px)
    const PPU = TP / S;               // 월드 1단위당 도트 수
    const WIN = { up: 21, down: 13, side: 20 };
    const REBUILD_DIST = 6;
    const DS_W = 432, DS_H = 312;     // DS 느낌 저해상도
    const CAM = { h: 30, back: 22, fov: 40 };   // 블랙·화이트풍: 가깝고 원근이 강한 시점
    const TILT = -Math.atan2(CAM.h, CAM.back);
    // 건물 크기 (월드 단위, 1칸 = 2)
    const HOUSE = { w: 4.4, h: 2.9, d: 2.8 };
    const BIG = { w: 5.2, h: 3.0, d: 3.4 };
    const GYM = { w: 5.6, h: 3.6, d: 3.6 };   // 세워 둔 그림을 카메라 정면으로 향하게 하는 각도

    let enabled = true;
    try { enabled = localStorage.getItem('pue_field3d') !== 'off'; } catch (e) { }
    F3.isEnabled = () => enabled;

    /* ================================================================ 도트 그리기 도구 */
    function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
    function px(x, X, Y, W, H, col) { x.fillStyle = col; x.fillRect(X, Y, W, H); }
    function disc(x, cx, cy, r, col) {
        x.fillStyle = col;
        for (let y = -r; y <= r; y++) {
            const w = Math.floor(Math.sqrt(r * r - y * y) + 0.35);
            x.fillRect(cx - w, cy + y, w * 2 + 1, 1);
        }
    }
    function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
    function tex(cv) {
        const t = new THREE.CanvasTexture(cv);
        t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
        return t;
    }

    /* ================================================================ 팔레트 (하트골드풍) */
    const PAL = {
        grass: '#5eb465', grass2: '#74c47a', grassDark: '#47984f', grassEdge: '#2f6e3a', grassLight: '#96d89a',
        lawn: '#68bc6c', lawn2: '#7bca7e',
        dirt: '#d9c196', dirt2: '#c4a878', dirt3: '#ead6ae', dirtEdge: '#9c8058',
        tall: '#47a052', tallDark: '#2e7c3c', tallLight: '#72c474',
        leaf: '#2f7a3f', leafDark: '#1d5a2c', leafLight: '#4a9a4e', leafHi: '#7cc47c', ink: '#1c1c22',
        tileA: '#d8b49a', tileB: '#c8a086', tileHi: '#ecd0b8', tileLo: '#a47e66',
        trunk: '#8a5a32', trunkDark: '#5c3a1e',
        water: '#5ab2ea', water2: '#86cdf4', waterDark: '#3f93cf', foam: '#e8f7ff',
        sand: '#f2dea2', sand2: '#e3cb86', snow: '#f4f8fc', snow2: '#dde8f3', ice: '#c4eaf8', ice2: '#eaf8ff',
        cave: '#b09a7a', cave2: '#9a8466', rockTop: '#b7a88c', rockSide: '#a08064', rockSide2: '#7c624c', rockInk: '#4a3a2c',
        ruins: '#d4c9a8', ruins2: '#b9ad8a', pave: '#ece2c6', pave2: '#d6caa8',
        swamp: '#5f7a55', volcano: '#7a4636', waste: '#c9b08a', forest: '#3a8f55'
    };

    /* ================================================================ 지면 타일 (16×16) */
    const TILE_CACHE = {};
    function groundTile(key, variant) {
        const id = key + ':' + variant;
        if (TILE_CACHE[id]) return TILE_CACHE[id];
        const cv = canvas(TP, TP), x = cv.getContext('2d');
        const R = rng(variant * 7919 + key.length * 131 + key.charCodeAt(0));
        const speck = (col, n, w = 1, h = 1) => { for (let i = 0; i < n; i++) px(x, Math.floor(R() * TP), Math.floor(R() * TP), w, h, col); };
        const blades = (col, n) => { for (let i = 0; i < n; i++) { const X = Math.floor(R() * 14) + 1, Y = Math.floor(R() * 13) + 2; px(x, X, Y, 1, 2, col); px(x, X + 1, Y - 1, 1, 1, col); } };
        switch (key) {
            case 'grass': px(x, 0, 0, TP, TP, PAL.grass); blades(PAL.grassDark, 4); blades(PAL.grass2, 3); break;
            case 'lawn': px(x, 0, 0, TP, TP, PAL.lawn); for (let i = 0; i < TP; i += 4) for (let j = (i / 4) % 2 * 2; j < TP; j += 4) px(x, j, i, 2, 2, PAL.lawn2); break;
            case 'dirt': px(x, 0, 0, TP, TP, PAL.dirt); speck(PAL.dirt2, 6); speck(PAL.dirt3, 4); break;
            case 'pave':
                // 블랙·화이트 바닥처럼 2×2 체크 타일, 칸마다 밝은 윗선·어두운 아랫선(베벨)
                for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
                    const X = bx * 8, Y = by * 8, col = (bx + by) % 2 ? PAL.tileB : PAL.tileA;
                    px(x, X, Y, 8, 8, col);
                    px(x, X, Y, 8, 1, PAL.tileHi); px(x, X, Y, 1, 8, PAL.tileHi);
                    px(x, X, Y + 7, 8, 1, PAL.tileLo); px(x, X + 7, Y, 1, 8, PAL.tileLo);
                }
                break;
            case 'tall':
                px(x, 0, 0, TP, TP, PAL.tall);
                for (let i = 0; i < 6; i++) { const X = Math.floor(R() * 13), Y = Math.floor(R() * 12) + 3; px(x, X, Y, 3, 1, PAL.tallDark); px(x, X + 1, Y - 2, 1, 2, PAL.tallLight); }
                break;
            case 'forest': px(x, 0, 0, TP, TP, PAL.forest); speck(PAL.leafDark, 8, 2, 1); break;
            case 'flower': {
                px(x, 0, 0, TP, TP, PAL.grass); blades(PAL.grassDark, 3);
                const cols = ['#ff6b6b', '#ffd84d', '#ffffff', '#ff9ad5'];
                for (let i = 0; i < 3; i++) { const X = 2 + Math.floor(R() * 11), Y = 2 + Math.floor(R() * 11), c = cols[Math.floor(R() * 4)]; px(x, X, Y - 1, 1, 1, c); px(x, X - 1, Y, 3, 1, c); px(x, X, Y + 1, 1, 1, c); px(x, X, Y, 1, 1, '#ffe27a'); }
                break;
            }
            case 'sand': px(x, 0, 0, TP, TP, PAL.sand); speck(PAL.sand2, 7); break;
            case 'beach': px(x, 0, 0, TP, TP, '#f6e6bc'); speck(PAL.sand2, 4); break;
            case 'snow': px(x, 0, 0, TP, TP, PAL.snow); speck(PAL.snow2, 6, 2, 1); break;
            case 'ice': px(x, 0, 0, TP, TP, PAL.ice); for (let i = 0; i < 3; i++) { const X = Math.floor(R() * 10), Y = Math.floor(R() * 14); px(x, X, Y, 5, 1, PAL.ice2); } break;
            case 'cave': px(x, 0, 0, TP, TP, PAL.cave); speck(PAL.cave2, 7, 2, 1); speck('#c8b494', 3); break;
            case 'rockfloor': px(x, 0, 0, TP, TP, PAL.rockTop); speck('#9c8c70', 6, 2, 1); break;
            case 'ruins':
                px(x, 0, 0, TP, TP, PAL.ruins);
                for (let y = 0; y < TP; y += 5) { px(x, 0, y, TP, 1, PAL.ruins2); px(x, (y / 5) % 2 ? 3 : 10, y, 1, 5, PAL.ruins2); }
                break;
            case 'swamp': px(x, 0, 0, TP, TP, PAL.swamp); speck('#4a6444', 8, 2, 1); break;
            case 'volcano': px(x, 0, 0, TP, TP, PAL.volcano); speck('#5a3226', 7, 2, 1); speck('#ff8a4d', 2); break;
            case 'waste': px(x, 0, 0, TP, TP, PAL.waste); speck('#b0966e', 7); break;
            case 'cherry': px(x, 0, 0, TP, TP, PAL.grass); blades(PAL.grassDark, 3); speck('#ffc2d9', 4); break;
            case 'water0': case 'water1': {
                px(x, 0, 0, TP, TP, PAL.water);
                const o = key === 'water1' ? 4 : 0;
                for (let y = 2; y < TP; y += 5) { const X = ((y * 3 + o + variant * 5) % 12); px(x, X, y, 4, 1, PAL.water2); px(x, (X + 8) % 14, y + 2, 3, 1, PAL.waterDark); }
                break;
            }
            default: px(x, 0, 0, TP, TP, PAL.grass);
        }
        TILE_CACHE[id] = cv;
        return cv;
    }

    function groundKey(T, t, r, c) {
        switch (t) {
            case T.GRASS: return 'grass';
            case T.TALL_GRASS: return 'tall';
            case T.PATH: return 'dirt';
            case T.TOWN: return ((r % 5) === 0 || (c % 6) === 0) ? 'pave' : 'lawn';
            case T.CENTER: case T.MART: case T.GYM: return 'pave';
            case T.FOREST: case T.BAMBOO: return 'forest';
            case T.FLOWER: return 'flower';
            case T.SAND: return 'sand';
            case T.BEACH: return 'beach';
            case T.SNOW: return 'snow';
            case T.ICE_FIELD: return 'ice';
            case T.CAVE: return 'cave';
            case T.ROCK: return 'rockfloor';
            case T.RUINS: return 'ruins';
            case T.SWAMP: return 'swamp';
            case T.VOLCANO: return 'volcano';
            case T.WASTELAND: return 'waste';
            case T.CHERRY: return 'cherry';
            case T.WATER: return 'water';
            default: return 'dirt';
        }
    }
    const GROUP = { grass: 'g', lawn: 'g', tall: 'g', flower: 'g', forest: 'g', cherry: 'g', water: 'w' };
    const groupOf = (k) => GROUP[k] || 'd';

    /* 경계선: 잔디가 흙/포장과 만나는 쪽에 진한 테두리 + 밝은 안쪽 선, 물가엔 포말 */
    function drawEdges(x, ox, oy, key, nb) {
        const g = groupOf(key);
        const sides = [['n', 0, 0, TP, 1, 0, 1], ['s', 0, TP - 1, TP, 1, 0, -1], ['w', 0, 0, 1, TP, 1, 0], ['e', TP - 1, 0, 1, TP, -1, 0]];
        sides.forEach(([dir, X, Y, W, H, ix, iy]) => {
            const ng = nb[dir];
            if (!ng || ng === g) return;
            if (g === 'g' && ng === 'd') {
                px(x, ox + X, oy + Y, W, H, PAL.grassEdge);
                px(x, ox + X + ix, oy + Y + iy, W, H, PAL.grassLight);
            } else if (g === 'w') {
                px(x, ox + X, oy + Y, W, H, PAL.foam);
                px(x, ox + X + ix, oy + Y + iy, W, H, PAL.water2);
            } else if (g === 'd' && ng === 'w') {
                px(x, ox + X, oy + Y, W, H, PAL.dirtEdge);
            }
        });
    }

    /* ================================================================ 세워 두는 도트 그림 */
    const SPRITES = {};
    function outlineDiscs(x, discs, fill, dark, light, hi) {
        discs.forEach(([cx, cy, r]) => disc(x, cx, cy, r + 1, PAL.ink));
        discs.forEach(([cx, cy, r]) => disc(x, cx, cy, r, fill));
        discs.forEach(([cx, cy, r]) => disc(x, cx + 1, cy + Math.ceil(r / 2), Math.max(1, r - 3), dark));
        discs.forEach(([cx, cy, r]) => disc(x, cx - Math.ceil(r / 3), cy - Math.ceil(r / 3), Math.max(1, Math.floor(r / 2.2)), light));
        if (hi) discs.forEach(([cx, cy, r]) => px(x, cx - Math.ceil(r / 2), cy - Math.ceil(r / 2), 2, 1, hi));
    }
    function makeSprite(name, w, h, drawFn) {
        const cv = canvas(w, h), x = cv.getContext('2d');
        drawFn(x, w, h);
        SPRITES[name] = { cv, w, h };
    }
    function buildSprites() {
        if (SPRITES.tree0) return;
        const tree = (name, fill, dark, light, hi) => makeSprite(name, 32, 42, (x) => {
            px(x, 13, 30, 6, 11, PAL.ink); px(x, 14, 30, 4, 10, PAL.trunk); px(x, 16, 31, 2, 9, PAL.trunkDark);
            outlineDiscs(x, [[16, 26, 10], [9, 20, 8], [23, 20, 8], [16, 12, 9]], fill, dark, light, hi);
        });
        tree('tree0', PAL.leaf, PAL.leafDark, PAL.leafLight, PAL.leafHi);
        tree('tree1', '#33964f', '#227040', '#57c06c', PAL.leafHi);
        tree('tree2', '#2a8446', '#1b6034', '#4aad5f', '#7fd497');
        tree('cherry', '#f29cbc', '#d06f95', '#ffc3d8', '#fff0f5');
        makeSprite('pine', 26, 40, (x) => {
            px(x, 11, 32, 4, 7, PAL.ink); px(x, 12, 32, 2, 6, PAL.trunk);
            [[13, 30, 12], [13, 22, 10], [13, 14, 7]].forEach(([cx, by, hw]) => {
                for (let i = 0; i < 12; i++) { const w = Math.round(hw * i / 11); px(x, cx - w - 1, by - 12 + i, w * 2 + 3, 1, PAL.ink); }
                for (let i = 0; i < 11; i++) { const w = Math.round(hw * i / 11); px(x, cx - w, by - 11 + i, w * 2 + 1, 1, i > 7 ? '#2a6b4c' : '#3a8a62'); px(x, cx - w, by - 11 + i, 1, 1, '#f4f8fc'); }
            });
        });
        makeSprite('bush', 18, 14, (x) => outlineDiscs(x, [[6, 8, 5], [12, 8, 5], [9, 5, 4]], PAL.leafLight, PAL.leaf, PAL.leafHi));
        // 블랙·화이트풍 풀숲: 끝이 뾰족한 잎사귀 덩어리가 겹겹이 (검정 대신 짙은 초록 외곽선)
        makeSprite('tuft', 18, 14, (x) => {
            const edge = '#1e5a2c', base = '#3ea24c', mid = '#5cbc5e', hi = '#9ee08a';
            const leaf = (bx, by, h, col, tip) => {
                for (let i = 0; i < h; i++) { const w = Math.floor((h - i) / 2.2); px(x, bx - w - 1, by - i, w * 2 + 3, 1, edge); }
                for (let i = 0; i < h - 1; i++) { const w = Math.floor((h - i) / 2.2) - 1; if (w >= 0) px(x, bx - w, by - i, w * 2 + 1, 1, col); }
                px(x, bx, by - h + 2, 1, 1, tip);
            };
            leaf(3, 13, 8, base, mid); leaf(15, 13, 8, base, mid);
            leaf(9, 13, 11, mid, hi);
            leaf(6, 13, 7, mid, hi); leaf(12, 13, 7, mid, hi);
            px(x, 0, 13, 18, 1, edge);
        });
        makeSprite('rock', 18, 14, (x) => outlineDiscs(x, [[9, 8, 6], [5, 9, 3], [13, 9, 3]], '#b2aca2', '#8a847a', '#d8d2c8'));
        makeSprite('stala', 12, 20, (x) => { for (let i = 0; i < 18; i++) { const w = Math.floor(i / 3.4); px(x, 6 - w - 1, i + 1, w * 2 + 2, 1, PAL.rockInk); px(x, 6 - w, i + 1, w * 2, 1, i > 12 ? '#8a7560' : '#a8927a'); } });
        makeSprite('pillar', 14, 28, (x) => { px(x, 2, 2, 10, 25, PAL.rockInk); px(x, 3, 3, 8, 23, '#e6dcc2'); px(x, 3, 3, 2, 23, '#fff6de'); px(x, 9, 3, 2, 23, '#c8bc9e'); px(x, 1, 1, 12, 3, PAL.rockInk); px(x, 2, 2, 10, 1, '#fff6de'); });
        makeSprite('cactus', 16, 22, (x) => { px(x, 5, 2, 6, 20, PAL.ink); px(x, 6, 3, 4, 19, '#4f9a3a'); px(x, 1, 8, 5, 3, PAL.ink); px(x, 1, 5, 3, 5, PAL.ink); px(x, 2, 6, 1, 4, '#4f9a3a'); px(x, 10, 10, 5, 3, PAL.ink); px(x, 12, 6, 3, 6, PAL.ink); px(x, 13, 7, 1, 5, '#4f9a3a'); px(x, 7, 4, 1, 16, '#79c45c'); });
        makeSprite('bamboo', 16, 34, (x) => { [3, 8, 12].forEach((bx, i) => { px(x, bx - 1, 2 + i * 2, 3, 32 - i * 2, PAL.ink); px(x, bx, 3 + i * 2, 1, 30 - i * 2, '#86c45a'); for (let y = 8; y < 32; y += 7) px(x, bx - 1, y, 3, 1, '#4a7a30'); }); });
        makeSprite('lamp', 10, 30, (x) => { px(x, 4, 8, 2, 21, '#3b4656'); px(x, 3, 27, 4, 2, '#3b4656'); disc(x, 5, 5, 4, PAL.ink); disc(x, 5, 5, 3, '#fff1a8'); px(x, 4, 3, 1, 1, '#ffffff'); });
        makeSprite('glow', 24, 24, (x) => { const g = x.createRadialGradient(12, 12, 1, 12, 12, 12); g.addColorStop(0, 'rgba(255,230,150,0.9)'); g.addColorStop(1, 'rgba(255,230,150,0)'); x.fillStyle = g; x.fillRect(0, 0, 24, 24); });
        Object.values(SPRITES).forEach(s => { s.tex = tex(s.cv); });
    }

    /* ================================================================ 건물 텍스처 */
    const MATS = [];                        // 시간대 색조를 적용할 재질 목록
    function basic(opts) { const m = new THREE.MeshBasicMaterial(Object.assign({ color: 0xffffff }, opts || {})); MATS.push(m); return m; }
    function wallTex(base, trim, opts) {
        const W = opts.w || 32, H = opts.h || 24;
        const cv = canvas(W, H), x = cv.getContext('2d');
        px(x, 0, 0, W, H, PAL.ink); px(x, 1, 1, W - 2, H - 2, base);
        // 블랙·화이트풍 가로 판자 줄
        for (let y = 5; y < H - 4; y += 3) px(x, 1, y, W - 2, 1, shadeHex(base, -0.06));
        px(x, 1, 1, W - 2, 2, trim);
        if (opts.stripe) px(x, 1, 3, W - 2, 3, opts.stripe);
        // 아래쪽 기초 (나무/돌 띠)
        px(x, 1, H - 4, W - 2, 3, opts.base || '#8a6a4a'); px(x, 1, H - 4, W - 2, 1, shadeHex(opts.base || '#8a6a4a', 0.2));
        const win = (wx, wy, ww, wh) => {
            px(x, wx - 1, wy - 1, ww + 2, wh + 2, PAL.ink); px(x, wx, wy, ww, wh, '#7cc4ec');
            px(x, wx, wy, Math.ceil(ww / 2) - 1, 2, '#e6f8ff'); px(x, wx + Math.floor(ww / 2), wy, 1, wh, PAL.ink);
            px(x, wx - 1, wy + wh + 1, ww + 2, 1, shadeHex(base, -0.25));
        };
        (opts.windows || []).forEach(wx => win(wx, Math.round(H * 0.3), opts.ww || 6, opts.wh || 5));
        if (opts.door) {
            const dw = opts.dw || 8, dx = Math.floor(W / 2 - dw / 2), dy = Math.round(H * 0.38);
            px(x, dx - 1, dy - 1, dw + 2, H - dy - 3, PAL.ink); px(x, dx, dy, dw, H - dy - 4, opts.door);
            px(x, dx + 1, dy + 1, dw - 2, 1, shadeHex(opts.door, 0.25)); px(x, dx + dw - 3, dy + Math.floor((H - dy) / 2), 1, 2, '#ffd84d');
            px(x, dx - 2, H - 3, dw + 4, 2, '#b8b0a0');   // 문턱 돌계단
        }
        if (opts.glass) {
            const gw = Math.round(W * 0.42), gx = Math.floor(W / 2 - gw / 2), gy = Math.round(H * 0.34);
            px(x, gx - 1, gy - 1, gw + 2, H - gy - 3, PAL.ink); px(x, gx, gy, gw, H - gy - 4, '#8fd6f6');
            px(x, gx + Math.floor(gw / 2), gy, 1, H - gy - 4, PAL.ink); px(x, gx + 1, gy + 1, 2, 5, '#e6f8ff'); px(x, gx + Math.floor(gw / 2) + 2, gy + 1, 2, 5, '#e6f8ff');
        }
        return tex(cv);
    }
    function shadeHex(hex, k) {
        const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
        const f = v => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
        return '#' + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
    }
    function roofTex(col, dark, light, transpose) {
        const cv0 = roofCanvas(col, dark, light);
        if (!transpose) return tex(cv0);
        const cv = canvas(cv0.height, cv0.width), x = cv.getContext('2d');
        x.translate(cv.width, 0); x.rotate(Math.PI / 2); x.drawImage(cv0, 0, 0);
        return tex(cv);
    }
    function roofCanvas(col, dark, light) {
        const cv = canvas(48, 32), x = cv.getContext('2d');
        px(x, 0, 0, 48, 32, col);
        for (let y = 3; y < 32; y += 4) {
            px(x, 0, y, 48, 1, dark);
            for (let xx = (y / 4) % 2 ? 2 : 6; xx < 48; xx += 8) px(x, xx, y - 3, 1, 3, dark);
            px(x, 0, y - 3, 48, 1, shadeHex(col, 0.12));
        }
        px(x, 0, 0, 48, 1, light); px(x, 0, 31, 48, 1, PAL.ink);
        return cv;
    }
    function flatTex(col, edge) { const cv = canvas(16, 16), x = cv.getContext('2d'); px(x, 0, 0, 16, 16, edge || PAL.ink); px(x, 1, 1, 14, 14, col); return tex(cv); }
    function rockSideTex() {
        const cv = canvas(16, 24), x = cv.getContext('2d');
        px(x, 0, 0, 16, 24, PAL.rockSide);
        const R = rng(99);
        for (let i = 0; i < 7; i++) { const X = Math.floor(R() * 14), Y = Math.floor(R() * 20); px(x, X, Y, 1, 4, PAL.rockSide2); px(x, X + 1, Y, 1, 1, '#c09c7c'); }
        px(x, 0, 0, 16, 2, '#6b8f4e'); px(x, 0, 2, 16, 1, PAL.rockInk);
        px(x, 0, 23, 16, 1, PAL.rockInk);
        return tex(cv);
    }
    function rockTopTex() {
        const cv = canvas(16, 16), x = cv.getContext('2d');
        px(x, 0, 0, 16, 16, '#7fae5e');
        const R = rng(7);
        for (let i = 0; i < 6; i++) px(x, Math.floor(R() * 15), Math.floor(R() * 15), 2, 1, '#5f8e46');
        for (let i = 0; i < 3; i++) px(x, Math.floor(R() * 15), Math.floor(R() * 15), 2, 2, '#b7a88c');
        return tex(cv);
    }
    function signTex(bg, text) {
        const cv = canvas(32, 20), x = cv.getContext('2d');
        px(x, 0, 0, 32, 20, PAL.ink); px(x, 1, 1, 30, 18, bg);
        x.fillStyle = '#fff'; x.font = `bold ${text.length > 2 ? 9 : 14}px monospace`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 16, 11);
        return tex(cv);
    }

    /* ================================================================ 지오메트리/재질 세트 */
    let K = null;
    function initKinds() {
        buildSprites();
        const boardGeo = (wPx, hPx, liftPx) => {
            const g = new THREE.PlaneGeometry(wPx / PPU, hPx / PPU);
            g.translate(0, hPx / PPU / 2 - (liftPx || 0) / PPU, 0);
            g.rotateX(TILT);
            return g;
        };
        const board = (name, lift) => ({ geo: boardGeo(SPRITES[name].w, SPRITES[name].h, lift), mat: basic({ map: SPRITES[name].tex, alphaTest: 0.5 }) });

        // 집: 가로 2.2칸 × 깊이 1.4칸, 벽 높이 1.2칸 + 박공지붕 (블랙·화이트처럼 캐릭터보다 훨씬 크게)
        const wallGeo = new THREE.BoxGeometry(HOUSE.w, HOUSE.h, HOUSE.d); wallGeo.translate(0, HOUSE.h / 2, 0);
        const roofGeo = new THREE.CylinderGeometry(1.0, 1.0, 2.0, 3);
        roofGeo.rotateZ(-Math.PI / 2); roofGeo.rotateX(-Math.PI / 2);
        roofGeo.scale((HOUSE.w + 0.6) / 2, 0.85, (HOUSE.d + 0.35) / 1.732); roofGeo.translate(0, HOUSE.h + 0.42, 0);
        // 센터/숍: 가로 2.6칸 × 깊이 1.8칸, 평지붕 + 처마
        const bigWallGeo = new THREE.BoxGeometry(BIG.w, BIG.h, BIG.d); bigWallGeo.translate(0, BIG.h / 2, 0);
        const bigRoofGeo = new THREE.BoxGeometry(BIG.w + 0.5, 0.55, BIG.d + 0.5); bigRoofGeo.translate(0, BIG.h + 0.27, 0);
        const signGeo = new THREE.PlaneGeometry(2.0, 1.1); signGeo.translate(0, BIG.h - 0.2, BIG.d / 2 + 0.02);
        const gymWallGeo = new THREE.BoxGeometry(GYM.w, GYM.h, GYM.d); gymWallGeo.translate(0, GYM.h / 2, 0);
        const gymRoofGeo = new THREE.ConeGeometry(GYM.w * 0.8, 2.2, 4, 1); gymRoofGeo.rotateY(Math.PI / 4); gymRoofGeo.scale(1, 1, GYM.d / GYM.w); gymRoofGeo.translate(0, GYM.h + 1.1, 0);
        const shadowGeo = new THREE.PlaneGeometry(1, 1); shadowGeo.rotateX(-Math.PI / 2); shadowGeo.translate(0, 0.03, 0);
        const cliffGeo = new THREE.BoxGeometry(S, 1, S); cliffGeo.translate(0, 0.5, 0);
        const templeGeo = new THREE.BoxGeometry(2.6, 1.6, 2.6); templeGeo.translate(0, 0.8, 0);
        const templeTopGeo = new THREE.ConeGeometry(2.0, 1.6, 4); templeTopGeo.rotateY(Math.PI / 4); templeTopGeo.translate(0, 2.4, 0);

        const wallPlain = wallTex('#fff4de', '#e8d6b0', { w: 24, h: 24, windows: [9], ww: 7 });
        const wallFront = wallTex('#fff4de', '#e8d6b0', { w: 36, h: 24, door: '#8a4a26', windows: [5, 25], ww: 7 });
        const gable = flatTex('#fff4de');
        const ROOFS = [['#e0643a', '#b0472a', '#f59a6a'], ['#3f7fd8', '#2a5aa8', '#7fb0f0'], ['#3fa860', '#2a7a44', '#7fd494'], ['#9a6ae0', '#6f45b0', '#c4a2f4'], ['#e0a63a', '#b07a22', '#f5cc7a']];
        const houseKinds = {};
        ROOFS.forEach((rc, i) => {
            const side = basic({ map: wallPlain }), front = basic({ map: wallFront }), back = basic({ map: wallPlain }), top = basic({ color: 0xfff4de });
            houseKinds['wall' + i] = { geo: wallGeo, mat: [side, side, top, top, front, back] };
            houseKinds['roof' + i] = { geo: roofGeo, mat: [basic({ map: roofTex(rc[0], rc[1], rc[2], true) }), basic({ map: gable }), basic({ map: gable })] };
        });
        const pcFront = basic({ map: wallTex('#fbf8f2', '#e33b3b', { w: 42, h: 22, glass: true, stripe: '#e33b3b', base: '#9a9aa6', windows: [4, 33] }) });
        const pcSide = basic({ map: wallTex('#fbf8f2', '#e33b3b', { w: 30, h: 22, windows: [6, 18], stripe: '#e33b3b', base: '#9a9aa6' }) });
        const pcRoof = basic({ map: roofTex('#e33b3b', '#b82626', '#ff7a7a') });
        const mtFront = basic({ map: wallTex('#f4f7fb', '#2f6fd0', { w: 42, h: 22, glass: true, stripe: '#2f6fd0', base: '#9a9aa6', windows: [4, 33] }) });
        const mtSide = basic({ map: wallTex('#f4f7fb', '#2f6fd0', { w: 30, h: 22, windows: [6, 18], stripe: '#2f6fd0', base: '#9a9aa6' }) });
        const mtRoof = basic({ map: roofTex('#2f6fd0', '#2152a8', '#7fb0f0') });
        const gyFront = basic({ map: wallTex('#f0e2c4', '#8a6a4a', { w: 48, h: 26, door: '#5a6472', dw: 12, windows: [5, 14, 30, 39], ww: 5, base: '#6a6a78' }) });
        const gySide = basic({ map: wallTex('#f0e2c4', '#8a6a4a', { w: 40, h: 26, windows: [6, 17, 28], ww: 5, base: '#6a6a78' }) });
        const rockSide = basic({ map: rockSideTex() }), rockTop = basic({ map: rockTopTex() });

        K = Object.assign({
            tree0: board('tree0', 2), tree1: board('tree1', 2), tree2: board('tree2', 2), cherry: board('cherry', 2),
            pine: board('pine', 2), bush: board('bush', 1), tuft: board('tuft', 0), rock: board('rock', 1),
            stala: board('stala', 1), pillar: board('pillar', 1), cactus: board('cactus', 1), bamboo: board('bamboo', 1),
            lamp: board('lamp', 1),
            shadow: { geo: shadowGeo, mat: new THREE.MeshBasicMaterial({ color: 0x0c2a14, transparent: true, opacity: 0.28, depthWrite: false }) },
            glow: { geo: boardGeo(24, 24, 18), mat: new THREE.MeshBasicMaterial({ map: SPRITES.glow.tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }) },
            cliff: { geo: cliffGeo, mat: [rockSide, rockSide, rockTop, rockTop, rockSide, rockSide] },
            pcWall: { geo: bigWallGeo, mat: [pcSide, pcSide, pcRoof, pcRoof, pcFront, pcSide] },
            pcRoof: { geo: bigRoofGeo, mat: pcRoof },
            pcSign: { geo: signGeo, mat: basic({ map: signTex('#e33b3b', 'P') }) },
            mtWall: { geo: bigWallGeo, mat: [mtSide, mtSide, mtRoof, mtRoof, mtFront, mtSide] },
            mtRoof: { geo: bigRoofGeo, mat: mtRoof },
            mtSign: { geo: signGeo, mat: basic({ map: signTex('#2f6fd0', 'MART') }) },
            gyWall: { geo: gymWallGeo, mat: [gySide, gySide, gySide, gySide, gyFront, gySide] },
            gyRoof: { geo: gymRoofGeo, mat: basic({ map: roofTex('#e07a2a', '#b0561a', '#f5a86a') }) },
            templeBase: { geo: templeGeo, mat: basic({ map: flatTex('#9a9aa6', '#4a4a56') }) },
            templeTopL: { geo: templeTopGeo, mat: basic({ map: roofTex('#f59e0b', '#b07008', '#ffd27a') }) },
            templeTopS: { geo: templeTopGeo, mat: basic({ map: roofTex('#38bdf8', '#2a8ac0', '#a0e0ff') }) },
            templeTopK: { geo: templeTopGeo, mat: basic({ map: roofTex('#fde68a', '#d0b050', '#fff6c8') }) }
        }, houseKinds);
    }

    /* 포켓몬센터·숍·체육관 건물이 차지하는 칸 (시설 칸의 북쪽 2줄 × 3칸) */
    F3.buildingAt = function (r, c) {
        const towns = (window.RB && RB.TOWNS) || [];
        for (const t of towns) {
            if (r < t.rMin - 1 || r > t.rMax || c < t.cMin - 2 || c > t.cMax + 2) continue;
            for (const b of [t.center, t.mart, t.gym]) {
                if (!b) continue;
                if ((r === b[0] - 1 || r === b[0] - 2) && Math.abs(c - b[1]) <= 1) return true;
            }
        }
        return false;
    };
    /* 집: 도로가 아닌 구획마다 가로 3칸 × 세로 2칸을 차지하는 큰 집 (블랙·화이트 비율).
       기준 칸(r%5==2, c%6==2)이 오른쪽 아래 중앙이고, 시설 근처와 마을 밖으로는 짓지 않는다. */
    const HOUSE_CACHE = new Map(); let houseSeed = null;
    function houseAnchor(r, c, gg) {
        const g = gg || (typeof gameInstance !== 'undefined' ? gameInstance : null);
        if (!g || !g.worldMap) return false;
        if (houseSeed !== g.worldSeed) { HOUSE_CACHE.clear(); houseSeed = g.worldSeed; }
        const key = r * 4096 + c;
        if (HOUSE_CACHE.has(key)) return HOUSE_CACHE.get(key);
        let ok = (r % 5) === 2 && (c % 6) === 2;
        if (ok) {
            const T = TILE_TYPES;
            for (let rr = r - 1; rr <= r && ok; rr++) for (let cc = c - 1; cc <= c + 1 && ok; cc++) {
                if (!g.worldMap[rr] || g.worldMap[rr][cc] !== T.TOWN || F3.buildingAt(rr, cc)) ok = false;
            }
            if (ok) {
                const towns = (window.RB && RB.TOWNS) || [];
                for (const t of towns) {
                    if (r < t.rMin - 3 || r > t.rMax + 3 || c < t.cMin - 3 || c > t.cMax + 3) continue;
                    for (const b of [t.center, t.mart, t.gym]) {
                        if (b && r - 1 <= b[0] + 2 && r >= b[0] - 3 && Math.abs(c - b[1]) <= 3) ok = false;
                    }
                }
            }
        }
        HOUSE_CACHE.set(key, ok);
        return ok;
    }
    F3.houseAnchor = houseAnchor;
    F3.houseAt = function (r, c, g) {
        for (let ar = r; ar <= r + 1; ar++) for (let ac = c - 1; ac <= c + 1; ac++) if (houseAnchor(ar, ac, g)) return true;
        return false;
    };
    /* 집과 큰 건물은 통과할 수 없다 */
    if (window.RB && RB.isSolid) {
        const baseSolid = RB.isSolid;
        RB.isSolid = function (r, c) {
            if (baseSolid(r, c)) return true;
            const g = typeof gameInstance !== 'undefined' ? gameInstance : null;
            if (!g || !g.worldMap || !g.worldMap[r]) return false;
            const t = g.worldMap[r][c];
            if (t === TILE_TYPES.TOWN) {
                if (enabled) { if (F3.houseAt(r, c, g)) return true; }
                else if ((r % 5) === 2 && (c % 3) === 1) return true;   // 2D 필드의 작은 집
            }
            return F3.buildingAt(r, c);
        };
    }


    /* ================================================================ 캐릭터 도트 (블랙·화이트풍 2등신) */
    /* 32×40 캔버스에 머리가 큰 2등신 트레이너를 그린다. 방향 4개 × 걸음 3프레임.
       모든 도트를 그린 뒤 바깥쪽에 검은 외곽선을 한 번 둘러 또렷하게 만든다. */
    const CH_W = 32, CH_H = 40, CH_FOOT = 38;
    const CH_CACHE = {};
    function shade(hex, k) {
        const c = new THREE.Color(hex);
        if (k > 0) c.lerp(new THREE.Color(1, 1, 1), k); else c.multiplyScalar(1 + k);
        return '#' + c.getHexString();
    }
    function outlinePass(x) {
        const img = x.getImageData(0, 0, CH_W, CH_H), d = img.data;
        const solid = (X, Y) => X >= 0 && Y >= 0 && X < CH_W && Y < CH_H && d[(Y * CH_W + X) * 4 + 3] > 40;
        const mark = [];
        for (let Y = 0; Y < CH_H; Y++) for (let X = 0; X < CH_W; X++) {
            if (solid(X, Y)) continue;
            if (solid(X - 1, Y) || solid(X + 1, Y) || solid(X, Y - 1) || solid(X, Y + 1)) mark.push(X, Y);
        }
        x.fillStyle = '#1c1c22';
        for (let i = 0; i < mark.length; i += 2) x.fillRect(mark[i], mark[i + 1], 1, 1);
    }
    function charStyle(kind, n) {
        if (kind === 'player') return { hat: 'cap', hatCol: '#e23a3a', hatCol2: '#f4f4f4', hair: '#2a2430', skin: '#ffd8b4', top: '#3a4a8a', top2: '#e8e8e8', pants: '#2c2c3c', shoes: '#d23a3a', bag: '#f2b441' };
        const h = (n.id * 2654435761) >>> 0;
        const hairs = ['#3a2a1e', '#1f1f2a', '#7a4a22', '#caa04a', '#5a3a6a'];
        const title = n.title || '';
        let hat = 'none', hair = hairs[h % hairs.length], hairStyle = (h >> 3) % 3 === 0 ? 'long' : 'short';
        if (/할머니/.test(title)) { hair = '#c8c8d0'; hairStyle = 'bun'; }
        if (/꼬마|소년|단거리|낚시꾼|캠핑객|등산가|상인/.test(title)) hat = 'cap';
        if (/연구원/.test(title)) hairStyle = 'short';
        return {
            hat, hatCol: n.cap || '#c33', hatCol2: '#f4f4f4', hair, hairStyle, skin: (h >> 5) % 4 === 0 ? '#e8b48a' : '#ffd8b4',
            top: /연구원/.test(title) ? '#f4f4f4' : (n.body || '#6a8ad0'), top2: n.trim || '#333', pants: n.trim || '#333', shoes: '#3a3a44', bag: null
        };
    }
    function drawChar(x, st, dir, frame) {
        const P = (X, Y, W, H, c) => { x.fillStyle = c; x.fillRect(X, Y, W, H); };
        const bob = frame === 0 ? 0 : 1;
        const legA = frame === 1 ? -1 : 0, legB = frame === 2 ? -1 : 0;
        // 발밑 그림자 (외곽선 뒤에 따로 그린다)
        const side = dir === 'left' || dir === 'right';
        const flip = dir === 'left';
        x.save();
        if (flip) { x.translate(CH_W, 0); x.scale(-1, 1); }
        const oy = bob;
        // 다리 / 신발
        if (side) {
            P(13, 29 + oy + legA, 4, 6 - legA, st.pants); P(16, 29 + oy + legB, 4, 6 - legB, shade(st.pants, -0.25));
            P(13, 35 + oy, 5, 2, st.shoes); P(16, 35 + oy, 5, 2, shade(st.shoes, -0.2));
        } else {
            P(11, 29 + oy + legA, 4, 6 - legA, st.pants); P(17, 29 + oy + legB, 4, 6 - legB, shade(st.pants, -0.2));
            P(11, 35 + oy + legA, 4, 2, st.shoes); P(17, 35 + oy + legB, 4, 2, st.shoes);
        }
        // 가방 (뒷모습/옆모습)
        if (st.bag && dir === 'up') { P(10, 20 + oy, 12, 9, st.bag); P(10, 20 + oy, 12, 2, shade(st.bag, 0.3)); P(11, 27 + oy, 10, 1, shade(st.bag, -0.3)); }
        if (st.bag && side) { P(9, 20 + oy, 5, 8, st.bag); }
        // 몸통 + 팔
        P(10, 19 + oy, 12, 11, st.top);
        P(10, 19 + oy, 12, 2, shade(st.top, 0.25));
        P(19, 21 + oy, 3, 9, shade(st.top, -0.2));
        if (dir === 'down') { P(14, 19 + oy, 4, 6, st.top2); P(15, 19 + oy, 2, 11, shade(st.top2, -0.1)); }
        const swing = frame === 1 ? 1 : frame === 2 ? -1 : 0;
        if (side) { P(15, 21 + oy + swing, 3, 7, shade(st.top, -0.1)); P(15, 27 + oy + swing, 3, 2, st.skin); }
        else { P(7, 20 + oy + swing, 3, 8, st.top); P(22, 20 + oy - swing, 3, 8, shade(st.top, -0.15)); P(7, 27 + oy + swing, 3, 2, st.skin); P(22, 27 + oy - swing, 3, 2, st.skin); }
        // 머리 (크게)
        const hx = 16, hy = 12 + oy;
        disc(x, hx, hy, 8, st.skin);
        P(8, hy + 3, 16, 3, st.skin);
        // 머리카락
        if (dir === 'up') {
            disc(x, hx, hy, 8, st.hair);
            P(8, hy, 16, 7, st.hair);
            if (st.hairStyle === 'long') P(9, hy + 5, 14, 6, st.hair);
        } else if (side) {
            discClip(x, hx, hy, 8, st.hair, hy - 2);                   // 정수리
            discClip(x, hx, hy, 8, st.hair, hy + 6, null, hx - 2);     // 뒷머리
            P(hx + 4, hy - 2, 4, 2, st.hair);                          // 앞머리
            P(20, hy + 1, 2, 2, '#1c1c22');                  // 눈
            P(21, hy + 4, 1, 1, shade(st.skin, -0.15));
            if (st.hairStyle === 'long') P(8, hy + 4, 5, 8, st.hair);
        } else {
            discClip(x, hx, hy, 8, st.hair, hy - 2);                   // 정수리
            P(8, hy - 2, 3, 6, st.hair); P(21, hy - 2, 3, 6, st.hair); // 옆머리
            P(10, hy - 2, 12, 2, st.hair);                             // 앞머리
            P(12, hy + 1, 2, 3, '#1c1c22'); P(18, hy + 1, 2, 3, '#1c1c22');   // 눈
            P(12, hy + 1, 1, 1, '#ffffff'); P(18, hy + 1, 1, 1, '#ffffff');
            P(11, hy + 4, 2, 1, '#f4a0a0'); P(19, hy + 4, 2, 1, '#f4a0a0');   // 볼
            if (st.hairStyle === 'long') { P(7, hy, 3, 10, st.hair); P(22, hy, 3, 10, st.hair); }
        }
        if (st.hairStyle === 'bun' && dir !== 'down') disc(x, hx, hy - 8, 3, st.hair);
        if (st.hairStyle === 'bun' && dir === 'down') disc(x, hx, hy - 9, 3, st.hair);
        // 모자
        if (st.hat === 'cap') {
            discClip(x, hx, hy - 1, 9, st.hatCol, hy - 2);             // 모자 윗부분만 (얼굴은 보이게)
            P(10, hy - 9, 12, 2, shade(st.hatCol, 0.25));
            if (dir === 'down') { P(8, hy - 2, 16, 2, shade(st.hatCol, -0.3)); P(13, hy - 8, 6, 4, st.hatCol2); }
            else if (side) { P(hx + 2, hy - 2, 8, 2, shade(st.hatCol, -0.3)); P(hx - 3, hy - 8, 5, 4, st.hatCol2); }
            else { P(9, hy - 3, 14, 1, shade(st.hatCol, -0.2)); P(12, hy - 2, 8, 2, st.hatCol2); }
        }
        x.restore();
        outlinePass(x);
        // 그림자는 외곽선 없이 맨 아래에
        x.globalCompositeOperation = 'destination-over';
        x.fillStyle = 'rgba(0,0,0,0.28)';
        x.beginPath(); x.ellipse(16, CH_FOOT, 8, 2.5, 0, 0, Math.PI * 2); x.fill();
        x.globalCompositeOperation = 'source-over';
    }
    function discClip(x, cx, cy, r, col, yMax, xMin, xMax) {
        x.fillStyle = col;
        for (let y = -r; y <= r; y++) {
            if (cy + y > yMax) break;
            const w = Math.floor(Math.sqrt(r * r - y * y) + 0.35);
            const a = Math.max(cx - w, xMin == null ? -99 : xMin), b = Math.min(cx + w, xMax == null ? 99 : xMax);
            if (b >= a) x.fillRect(a, cy + y, b - a + 1, 1);
        }
    }
    function charFrame(key, st, dir, frame) {
        const id = key + '|' + dir + '|' + frame;
        if (CH_CACHE[id]) return CH_CACHE[id];
        const cv = canvas(CH_W, CH_H);
        drawChar(cv.getContext('2d'), st, dir, frame);
        CH_CACHE[id] = cv;
        return cv;
    }

    /* ================================================================ 캐릭터 슬롯 */
    // 캐릭터를 카메라 시선 방향으로 살짝 당겨 뒤쪽 건물 지붕에 파묻히지 않게 한다 (화면상 위치는 동일)
    const LIFT = 1.6, LIFT_L = Math.hypot(CAM.h, CAM.back);
    const LIFT_Y = LIFT * CAM.h / LIFT_L, LIFT_Z = LIFT * CAM.back / LIFT_L;
    function makeSpriteSlot() {
        const cv = canvas(CH_W, CH_H);
        const t = tex(cv);
        const mat = new THREE.SpriteMaterial({ map: t, alphaTest: 0.1 });
        const sp = new THREE.Sprite(mat);
        sp.center.set(0.5, (CH_H - CH_FOOT - 1) / CH_H);
        sp.scale.set(CH_W / PPU * 0.72, CH_H / PPU * 0.72, 1);   // 지면과 같은 도트 밀도
        return { cv, ctx: cv.getContext('2d'), tex: t, sp, mat, cur: null };
    }
    function paintChar(slot, key, st, dir, frame) {
        const id = key + '|' + dir + '|' + frame;
        if (slot.cur === id) return;
        slot.cur = id;
        slot.ctx.clearRect(0, 0, CH_W, CH_H);
        slot.ctx.drawImage(charFrame(key, st, dir, frame), 0, 0);
        slot.tex.needsUpdate = true;
    }
    F3._charFrame = charFrame; F3._charStyle = charStyle;
    const walkFrame = (moving, t) => moving ? [1, 0, 2, 0][Math.floor(t / 130) % 4] : 0;
    function makeBang() {
        const cv = canvas(16, 16), x = cv.getContext('2d');
        disc(x, 8, 8, 7, PAL.ink); disc(x, 8, 8, 6, '#ffffff');
        px(x, 7, 3, 2, 7, '#ef4444'); px(x, 7, 11, 2, 2, '#ef4444');
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(cv), depthTest: false }));
        sp.scale.set(1.1, 1.1, 1); sp.position.y = 3.4; sp.visible = false;
        return sp;
    }

    /* ================================================================ 씬 */
    let scene = null, camera = null, chunkGroup, player, npcMeshes = new Map(), chunk = null, groundMesh = null;
    const DAY = new THREE.Color(1, 1, 1);
    function init() {
        if (scene) return;
        initKinds();
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x173622);
        camera = new THREE.PerspectiveCamera(CAM.fov, DS_W / DS_H, 0.5, 200);
        chunkGroup = new THREE.Group(); scene.add(chunkGroup);
        player = makeSpriteSlot();
        scene.add(player.sp);
    }
    function clearChunk() {
        while (chunkGroup.children.length) {
            const o = chunkGroup.children.pop();
            if (o === groundMesh) continue;
            if (o.dispose) o.dispose();
        }
        if (groundMesh) {
            groundMesh.userData.maps.forEach(t => t.dispose());
            groundMesh.material.dispose();
            groundMesh.geometry.dispose();
            groundMesh = null;
        }
    }

    function buildChunk(g, pr, pc) {
        const T = TILE_TYPES;
        const map = g.worldMap;
        const r0 = Math.max(0, pr - WIN.up), r1 = Math.min(MAP_ROWS - 1, pr + WIN.down);
        const c0 = Math.max(0, pc - WIN.side), c1 = Math.min(MAP_COLS - 1, pc + WIN.side);
        const cols = c1 - c0 + 1, rows = r1 - r0 + 1;
        clearChunk();

        // ---- 1) 지면 텍스처 (물은 2프레임으로 일렁인다) ----
        const cvA = canvas(cols * TP, rows * TP), cvB = canvas(cols * TP, rows * TP);
        const xa = cvA.getContext('2d'), xb = cvB.getContext('2d');
        const keyAt = (r, c) => (r < 0 || c < 0 || r >= MAP_ROWS || c >= MAP_COLS) ? null : groundKey(T, map[r][c], r, c);
        const waterCells = [];
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
            const key = keyAt(r, c);
            const h = g.tileHash(r, c);
            const ox = (c - c0) * TP, oy = (r - r0) * TP;
            const nb = {};
            [['n', -1, 0], ['s', 1, 0], ['w', 0, -1], ['e', 0, 1]].forEach(([d, dr, dc]) => { const k = keyAt(r + dr, c + dc); nb[d] = k ? groupOf(k) : null; });
            if (key === 'water') {
                xa.drawImage(groundTile('water0', h % 3), ox, oy);
                drawEdges(xa, ox, oy, key, nb);
                waterCells.push([ox, oy, h, nb]);
            } else {
                xa.drawImage(groundTile(key, h % 4), ox, oy);
                drawEdges(xa, ox, oy, key, nb);
            }
        }
        xb.drawImage(cvA, 0, 0);
        waterCells.forEach(([ox, oy, h, nb]) => { xb.drawImage(groundTile('water1', h % 3), ox, oy); drawEdges(xb, ox, oy, 'water', nb); });
        const tA = tex(cvA), tB = tex(cvB);
        const gGeo = new THREE.PlaneGeometry(cols * S, rows * S); gGeo.rotateX(-Math.PI / 2);
        const gMat = new THREE.MeshBasicMaterial({ map: tA, color: DAY.clone() });
        groundMesh = new THREE.Mesh(gGeo, gMat);
        groundMesh.position.set(((c0 + c1) / 2) * S, 0, ((r0 + r1) / 2) * S);
        groundMesh.userData.maps = [tA, tB];
        chunkGroup.add(groundMesh);

        // ---- 2) 세워진 물체 / 건물 ----
        const B = {};
        const add = (kind, x, y, z, sx, sy, sz) => { (B[kind] || (B[kind] = [])).push([x, y, z, sx || 1, sy || 1, sz || 1]); };
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
            const t = map[r][c];
            const h = g.tileHash(r, c);
            const x = c * S, z = r * S;
            const jx = ((h % 11) / 11 - 0.5) * 0.5, jz = (((h >> 4) % 11) / 11 - 0.5) * 0.4;
            switch (t) {
                case T.FOREST: add('tree' + (h % 3), x + jx * 0.4, 0, z + 0.3, 0.9, 0.9, 0.9); break;
                case T.ROCK: add('cliff', x, 0, z, 1, 1.4 + (h % 4) * 0.35, 1); break;
                case T.TALL_GRASS: add('tuft', x, 0, z + 0.65); add('tuft', x + (h % 2 ? 0.4 : -0.4), 0, z - 0.3, 0.9, 0.9, 0.9); break;
                case T.SNOW: if (h % 8 === 0) add('pine', x + jx, 0, z + jz); break;
                case T.ICE_FIELD: if (h % 19 === 0) add('rock', x + jx, 0, z + jz); break;
                case T.CAVE: if (h % 6 === 0) add('stala', x + jx, 0, z + jz); else if (h % 9 === 0) add('rock', x + jx, 0, z + jz); break;
                case T.RUINS: if (h % 7 === 0) add('pillar', x + jx * 0.4, 0, z + jz * 0.4); else if (h % 12 === 0) add('rock', x + jx, 0, z + jz); break;
                case T.SAND: if (h % 14 === 0) add('cactus', x + jx, 0, z + jz); break;
                case T.BAMBOO: add('bamboo', x + jx, 0, z + jz); break;
                case T.CHERRY: if (h % 4 === 0) add('cherry', x + jx, 0, z + jz); break;
                case T.GRASS: if (h % 17 === 0) add('bush', x + jx, 0, z + jz, 0.8, 0.8, 0.8); break;
                case T.TOWN: {
                    if (houseAnchor(r, c, g)) {
                        const p = h % 5, hz = z - S / 2;
                        add('shadow', x + 0.45, 0, hz + 0.55, HOUSE.w + 0.3, 1, HOUSE.d + 0.5);
                        add('wall' + p, x, 0, hz); add('roof' + p, x, 0, hz);
                        break;
                    }
                    if (F3.buildingAt(r, c) || F3.houseAt(r, c, g)) break;
                    if ((r % 5) === 0 && (c % 6) === 0) { add('lamp', x + 0.7, 0, z + 0.7); add('glow', x + 0.7, 0, z + 0.7); break; }
                    if ((r % 5) === 0 || (c % 6) === 0) break;
                    if (F3.houseAt(r - 1, c, g) || F3.houseAt(r - 2, c, g)) { if (h % 7 === 0) add('bush', x + jx, 0, z + jz, 0.7, 0.7, 0.7); break; }
                    const k = h % 10;
                    if (k === 0) add('tree' + (h % 3), x + jx * 0.3, 0, z + 0.2, 0.75, 0.75, 0.75);
                    else if (k === 2) add('bush', x + jx, 0, z + jz, 0.75, 0.75, 0.75);
                    break;
                }
                case T.CENTER: add('shadow', x + 0.5, 0, z - 2.4, BIG.w + 0.4, 1, BIG.d + 0.6); add('pcWall', x, 0, z - 3); add('pcRoof', x, 0, z - 3); add('pcSign', x, 0, z - 3); break;
                case T.MART: add('shadow', x + 0.5, 0, z - 2.4, BIG.w + 0.4, 1, BIG.d + 0.6); add('mtWall', x, 0, z - 3); add('mtRoof', x, 0, z - 3); add('mtSign', x, 0, z - 3); break;
                case T.GYM: add('shadow', x + 0.5, 0, z - 2.4, GYM.w + 0.4, 1, GYM.d + 0.6); add('gyWall', x, 0, z - 3); add('gyRoof', x, 0, z - 3); break;
                case T.LAND_TEMPLE: add('templeBase', x, 0, z - 1); add('templeTopL', x, 0, z - 1); break;
                case T.SEA_TEMPLE: add('templeBase', x, 0, z - 1); add('templeTopS', x, 0, z - 1); break;
                case T.SKY_TEMPLE: add('templeBase', x, 0, z - 1); add('templeTopK', x, 0, z - 1); break;
            }
        }
        const dummy = new THREE.Object3D();
        Object.entries(B).forEach(([kind, list]) => {
            const def = K[kind];
            if (!def || !list.length) return;
            const mesh = new THREE.InstancedMesh(def.geo, def.mat, list.length);
            list.forEach((it, i) => {
                dummy.position.set(it[0], it[1], it[2]);
                dummy.scale.set(it[3], it[4], it[5]);
                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);
            });
            mesh.instanceMatrix.needsUpdate = true;
            if (kind === 'glow') mesh.userData.isGlow = true;
            chunkGroup.add(mesh);
        });
        chunk = { r: pr, c: pc, seed: g.worldSeed };
    }

    function syncNpcs(g, pr, pc, now) {
        const seen = new Set();
        (g.npcs || []).forEach(n => {
            if (Math.abs(n.r - pr) > WIN.up || Math.abs(n.c - pc) > WIN.side) return;
            seen.add(n.id);
            let m = npcMeshes.get(n.id);
            if (!m) {
                const slot = makeSpriteSlot();
                m = new THREE.Group();
                m.add(slot.sp);
                m.userData.slot = slot;
                m.userData.bang = makeBang();
                m.add(m.userData.bang);
                m.userData.last = { r: n.r, c: n.c, t: 0 };
                npcMeshes.set(n.id, m);
                scene.add(m);
            }
            const last = m.userData.last;
            if (last.r !== n.r || last.c !== n.c) { last.fr = m.position.z / S; last.fc = m.position.x / S; last.r = n.r; last.c = n.c; last.t = now; }
            const k = Math.min(1, (now - last.t) / 170);
            const vr = last.fr !== undefined && k < 1 ? last.fr + (n.r - last.fr) * k : n.r;
            const vc = last.fc !== undefined && k < 1 ? last.fc + (n.c - last.fc) * k : n.c;
            m.position.set(vc * S, LIFT_Y, vr * S + LIFT_Z);
            if (!m.userData.style) m.userData.style = charStyle('npc', n);
            paintChar(m.userData.slot, 'npc' + n.id, m.userData.style, n.dir || 'down', walkFrame(k < 1, now));
            m.userData.slot.mat.color.copy(DAY);
            m.userData.bang.visible = !!n.alerted;
            m.visible = true;
        });
        npcMeshes.forEach((m, id) => { if (!seen.has(id)) m.visible = false; });
    }

    /* 시간대 - 조명 대신 전체 색조를 곱한다 (도트 색을 그대로 살리기 위해) */
    function applyTime(g, now) {
        const phase = g.timePhase || sampleTimePhase(g.timeOfDay || 0.42);
        const a = Math.min(0.72, phase.alpha);
        const tint = new THREE.Color(phase.tint[0] / 255, phase.tint[1] / 255, phase.tint[2] / 255);
        const k = Math.min(1, a * 1.25);
        DAY.setRGB(1, 1, 1).lerp(tint, k * 0.55).multiplyScalar(1 - k * 0.5);
        MATS.forEach(m => m.color.copy(DAY));
        if (groundMesh) {
            groundMesh.material.color.copy(DAY);
            const frame = Math.floor(now / 520) % 2;
            const want = groundMesh.userData.maps[frame];
            if (groundMesh.material.map !== want) { groundMesh.material.map = want; groundMesh.material.needsUpdate = true; }
        }
        player.mat.color.copy(DAY);
        const glowOn = a > 0.28;
        chunkGroup.children.forEach(o => { if (o.userData.isGlow) o.visible = glowOn; });
        scene.background.setHex(0x173622).multiply(DAY);
    }

    /* ================================================================ 매 프레임 */
    F3.render = function (g) {
        init();
        const r = g.renderer3D;
        if (g._rendererSize !== 'ds') {
            F3._basePR = F3._basePR || r.getPixelRatio();
            r.setPixelRatio(1);
            r.setSize(DS_W, DS_H, false);
            g._rendererSize = 'ds';
        }
        const cv = g.threeCanvas;
        cv.classList.remove('fx-light-layer');
        cv.classList.add('rb-ds-pixel');
        if (cv.style.display !== 'block') cv.style.display = 'block';
        g._postFxVisible = null;

        const vx = g.getVisualX(), vy = g.getVisualY();
        const pr = g.player.y, pc = g.player.x;
        if (!chunk || chunk.seed !== g.worldSeed || Math.abs(chunk.r - pr) > REBUILD_DIST || Math.abs(chunk.c - pc) > REBUILD_DIST) buildChunk(g, pr, pc);

        const now = performance.now();
        const px3 = vx * S, pz3 = vy * S;
        player.sp.position.set(px3, LIFT_Y, pz3 + LIFT_Z);
        const moving = g.getMoveProgress() < 1 || (g.heldMoveKeys && g.heldMoveKeys.size > 0 && g.state === GAME_STATES.FIELD);
        if (!F3._pstyle) F3._pstyle = charStyle('player');
        paintChar(player, 'player', F3._pstyle, g.player.direction || 'down', walkFrame(moving, now));
        syncNpcs(g, pr, pc, now);
        applyTime(g, now);

        camera.position.set(px3, CAM.h, pz3 + CAM.back);
        camera.lookAt(px3, 0, pz3);
        r.render(scene, camera);
    };

    F3.invalidate = function () { chunk = null; npcMeshes.forEach(m => scene && scene.remove(m)); npcMeshes.clear(); };

    F3.toggle = function (g) {
        enabled = !enabled;
        try { localStorage.setItem('pue_field3d', enabled ? 'on' : 'off'); } catch (e) { }
        if (!enabled && g) {
            if (g._rendererSize === 'ds') { g.renderer3D.setPixelRatio(F3._basePR || 1); g._rendererSize = null; }
            g.threeCanvas.classList.remove('rb-ds-pixel');
            g.threeCanvas.style.display = 'none';
            g._postFxVisible = null;
        }
        showToast(enabled ? '🧊 3D 필드로 전환했습니다. ([3] 키로 2D 전환)' : '🗺️ 2D 필드로 전환했습니다. ([3] 키로 3D 전환)');
    };

    /* ================================================================ GameEngine 연결 */
    const P = GameEngine.prototype;
    const origRender = P.render;
    P.render = function () {
        if (!enabled || this.state !== GAME_STATES.FIELD || !this.worldMap || !this.worldMap.length) {
            return origRender.call(this);
        }
        this.processMovementInput();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        try { F3.render(this); } catch (e) { console.error(e); enabled = false; return origRender.call(this); }
        this.renderWeatherEffect();
        this.renderFieldVignette();
        this.renderMinimap();
        this.updateAndRenderParticles();
        requestAnimationFrame(() => this.render());
    };
    const origEnter = P._enterBattle;
    P._enterBattle = function () {
        const r = this.renderer3D;
        if (this._rendererSize === 'ds') {
            r.setPixelRatio(F3._basePR || Math.min(window.devicePixelRatio || 1, 2));
            this._rendererSize = null;
        }
        this.threeCanvas.classList.remove('rb-ds-pixel');
        return origEnter.apply(this, arguments);
    };
    const origInitWorld = P.initWorldMap;
    P.initWorldMap = function () {
        const r = origInitWorld.apply(this, arguments);
        F3.invalidate();
        return r;
    };

    window.addEventListener('keydown', (e) => {
        if (e.key !== '3') return;
        const tag = (e.target && e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        const g = typeof gameInstance !== 'undefined' ? gameInstance : null;
        if (!g || g.state !== GAME_STATES.FIELD || g.titleScreenActive) return;
        F3.toggle(g);
    });

    window.addEventListener('load', () => {
        try {
            const sys = HELP_SECTIONS.find(s => s.title === '시스템');
            if (sys && !sys.rows.some(r => r.keys[0] === '3')) sys.rows.unshift({ keys: ['3'], desc: '3D / 2D 필드 전환' });
            const grid = document.getElementById('help-grid');
            if (grid) grid.dataset.built = '';
        } catch (e) { }
    });
})();
