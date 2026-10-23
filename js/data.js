/* WARWORLD — static game data: resources, terrain, buildings, units, technology. */
(function () {
  'use strict';
  const WW = window.WW;
  const U = WW.U;
  const D = {};

  D.VERSION = 1;
  D.DAY_SECONDS = 7; // one in-game day at normal speed
  D.YEAR_DAYS = 360;

  // ---------- Resources ----------
  D.RES = {
    food:      { name: '食物',   short: '食', color: '#c8a34a', baseCap: 300, value: 1,   cls: 'food' },
    wood:      { name: '木材',   short: '木', color: '#9a6b3f', baseCap: 300, value: 1,   cls: 'wood' },
    stone:     { name: '石材',   short: '石', color: '#9b9a8d', baseCap: 180, value: 1.4, cls: 'stone' },
    ironOre:   { name: '铁矿',   short: '铁矿', color: '#7f8790', baseCap: 90, value: 2.2, cls: 'ore' },
    goldOre:   { name: '金矿',   short: '金矿', color: '#c59635', baseCap: 50, value: 6,   cls: 'ore' },
    silverOre: { name: '银矿',   short: '银矿', color: '#aab7bd', baseCap: 70, value: 4,   cls: 'ore' },
    herb:      { name: '草药',   short: '药', color: '#729d5c', baseCap: 60, value: 2.5, cls: 'rare' },
    leather:   { name: '皮革',   short: '革', color: '#a87952', baseCap: 60, value: 2,   cls: 'rare' },
    iron:      { name: '铁',     short: '铁', color: '#87919e', baseCap: 80, value: 4,   cls: 'metal' },
    gold:      { name: '金',     short: '金', color: '#e0b84c', baseCap: 40, value: 11,  cls: 'metal' },
    silver:    { name: '银',     short: '银', color: '#c4d3d9', baseCap: 60, value: 7,   cls: 'metal' },
    coin:      { name: '银币',   short: '币', color: '#d6c06c', baseCap: 180, value: 1,   cls: 'coin' }
  };
  D.RES_KEYS = Object.keys(D.RES);
  D.RESOURCE_GROUPS = {
    basic: ['food', 'wood', 'stone'],
    ore: ['ironOre', 'goldOre', 'silverOre'],
    rare: ['herb', 'leather'],
    refined: ['iron', 'gold', 'silver', 'coin']
  };
  D.INITIAL_RESOURCES = {
    food: 165, wood: 180, stone: 65, ironOre: 0, goldOre: 0, silverOre: 0,
    herb: 10, leather: 8, iron: 0, gold: 0, silver: 0, coin: 55
  };
  D.COLONY_RESOURCES = {
    food: 45, wood: 35, stone: 8, ironOre: 0, goldOre: 0, silverOre: 0,
    herb: 3, leather: 2, iron: 0, gold: 0, silver: 0, coin: 8
  };
  D.WAREHOUSE_STORAGE = [null,
    { food: 150, wood: 150, stone: 105, ironOre: 45, goldOre: 25, silverOre: 35, herb: 28, leather: 28, iron: 40, gold: 18, silver: 28, coin: 90 },
    { food: 290, wood: 290, stone: 205, ironOre: 85, goldOre: 45, silverOre: 65, herb: 52, leather: 52, iron: 75, gold: 32, silver: 50, coin: 170 },
    { food: 470, wood: 470, stone: 335, ironOre: 135, goldOre: 75, silverOre: 105, herb: 80, leather: 80, iron: 120, gold: 50, silver: 80, coin: 270 },
    { food: 720, wood: 720, stone: 520, ironOre: 210, goldOre: 115, silverOre: 165, herb: 125, leather: 125, iron: 185, gold: 78, silver: 125, coin: 420 }
  ];
  D.RES_ICON = {
    food: '<path d="M12 21V9M12 13c-2.6 0-5-1.7-5-4.5C9.6 8.5 12 10 12 13Zm0-3c2.4 0 4.6-1.6 4.6-4.1C13 6.2 12 7.7 12 10ZM12 9V3m-3 3c1.6 0 3-1.1 3-2.8C10.2 3.2 9 4.4 9 6Zm3-3c1.5 0 2.8-1 2.8-2.6C15.8.7 15 1.4 15 3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    wood: '<path d="M4 16.5 10 6l10 2-6 10.5-10-2Z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="10.5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M14 8.5 18 9M12.5 12l4 .8" stroke="currentColor" stroke-width="1.3"/>',
    stone: '<path d="m4 16 2-7 6-4 7 5-2 7-9 2-4-3Z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m7 15 3-6 5 2 2 4-6 2-4-2Z" fill="none" stroke="currentColor" stroke-width="1.1"/>',
    ironOre: '<path d="m4 17 2-8 6-5 8 5-2 8-7 2-7-2Z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m7 14 3-2 3 2M13 9l3 1M10 18l2-4 5-2" stroke="currentColor" stroke-width="1.2"/>',
    goldOre: '<path d="m4 17 2-8 6-5 8 5-2 8-7 2-7-2Z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m8 12 2-3 4 1 2 4-4 2-4-4Z" fill="currentColor" opacity=".45"/><path d="m14 7 1 2M16 13l1 2" stroke="currentColor" stroke-width="1.3"/>',
    silverOre: '<path d="m4 17 2-8 6-5 8 5-2 8-7 2-7-2Z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m9 9 3-2 4 4-3 3-4-1V9Z" fill="currentColor" opacity=".35"/><path d="m7 14 3-1M14 9l2 2" stroke="currentColor" stroke-width="1.2"/>',
    herb: '<path d="M12 21V8m0 4c-3.2.1-6-2.4-6-5.4 3.4-.1 6 2.2 6 5.4Zm0-2c2.8 0 5.1-2.2 5.1-5.1-3 0-5.1 2.1-5.1 5.1ZM12 12c-1.8-4 0-7 3.5-8.2.7 3.8-1 6.8-3.5 8.2Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
    leather: '<path d="M6 5h8l4 3-2 4 3 5-4 3H7l-3-4 2-6-1-3 1-2Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m9 9 3 3 3-3M12 12v5" stroke="currentColor" stroke-width="1.1"/>',
    iron: '<path d="m4 15 3-7h9l4 4-3 6H7l-3-3Z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m7 15 3-4h7l-2 4H7Z" fill="currentColor" opacity=".25"/>',
    gold: '<path d="m4 15 3-8h10l3 5-3 6H7l-3-3Z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m7 15 3-5h7l-2 5H7Z" fill="currentColor" opacity=".3"/><path d="M9 5.5V3M15 5.5V3" stroke="currentColor" stroke-width="1.2"/>',
    silver: '<path d="m4 15 3-8h10l3 5-3 6H7l-3-3Z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m7 15 3-5h7l-2 5H7Z" fill="currentColor" opacity=".22"/>',
    coin: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="5.4" fill="none" stroke="currentColor" stroke-width=".9" opacity=".6"/><path d="M12 8.2v7.6M9.5 10h5M9.5 14h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'
  };
  D.resIcon = (key, size = 20) => `<svg class="res-svg res-${key}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${D.RES_ICON[key] || ''}</svg>`;

  // ---------- Terrain ----------
  D.TERRAIN = [
    { id: 0, key: 'ocean',   name: '海洋', pass: false, water: true,  sea: true,  speed: 0,   color: '#294b58', effect: '只能由船只航行。' },
    { id: 1, key: 'lake',    name: '湖泊', pass: false, water: true,  lake: true,  speed: 0,   color: '#345b66', effect: '只能由船只航行，岸边可建渔场与码头。' },
    { id: 2, key: 'river',   name: '河流', pass: false, water: true,  river: true, speed: 0,   color: '#3b6975', effect: '单位无法涉水，需建造桥梁或乘船。' },
    { id: 3, key: 'plains',  name: '平原', pass: true, water: false, speed: 1,   color: '#778b4f', effect: '行军与建造的正常地形。' },
    { id: 4, key: 'forest',  name: '森林', pass: true, water: false, speed: 0.78, color: '#516940', effect: '移动减速 22%，可为远程单位提供掩护。' },
    { id: 5, key: 'hills',   name: '丘陵', pass: true, water: false, speed: 0.62, color: '#8a8456', effect: '移动速度降低 38%。视野开阔。' },
    { id: 6, key: 'mountain',name: '高山', pass: false, water: false, mountain: true, speed: 0, color: '#716e67', effect: '无法通行，需建造隧道。' }
  ];
  D.TERRAIN_BY_KEY = {};
  D.TERRAIN.forEach((t) => { D.TERRAIN_BY_KEY[t.key] = t; });
  D.WATER_IDS = [0, 1, 2];
  D.LAND_IDS = [3, 4, 5, 6];

  D.SETTLEMENT_UPKEEP = [null,
    { food: 2.2 },
    { food: 4.0, wood: 2.1 },
    { food: 6.4, wood: 3.5, stone: 2.0 },
    { food: 9.0, wood: 4.8, stone: 3.2, coin: 1.8 }
  ];

  D.STAGE_NAMES = ['', '村庄', '小镇', '城市', '首都'];
  D.STAGE_HALL_NAMES = ['', '村庄大厅', '镇长大厅', '市政厅', '王宫'];
  D.RANK_NAMES = ['', '伯国', '公国', '王国', '帝国'];
  D.RANK_ORDER = ['', '伯爵', '公爵', '国王', '皇帝'];

  D.crestPalettes = [
    { primary: '#7a2e2e', secondary: '#e0c26a', accent: '#f3e5b6' },
    { primary: '#274a6b', secondary: '#d5b96a', accent: '#eef2ee' },
    { primary: '#315a3e', secondary: '#d6c37a', accent: '#f1edd5' },
    { primary: '#4f355e', secondary: '#d7b85e', accent: '#f3e7c1' },
    { primary: '#7a5a24', secondary: '#eddc9d', accent: '#2d261c' },
    { primary: '#5b2f3b', secondary: '#cdb77a', accent: '#f0e8d4' },
    { primary: '#2e595c', secondary: '#cbb266', accent: '#f0e9d0' },
    { primary: '#603d25', secondary: '#dfc477', accent: '#f4ecd6' }
  ];
  D.crestSymbols = ['eagle', 'lion', 'cross', 'stag', 'tower', 'fleur', 'raven', 'sun', 'sword', 'oak'];
  D.factionNames = [
    '阿尔比恩', '勃艮第', '阿基坦', '诺森布里亚', '卡斯蒂利亚', '阿拉贡', '莱昂', '纳瓦拉',
    '洛林', '巴伐利亚', '萨克森', '施瓦本', '波希米亚', '摩拉维亚', '诺夫哥罗德', '基辅',
    '瓦拉几亚', '匈牙利', '克罗地亚', '塞尔维亚', '米兰', '威尼斯', '热那亚', '托斯卡纳',
    '西西里', '那不勒斯', '布列塔尼', '诺曼底', '弗兰德斯', '荷兰', '丹麦', '挪威',
    '瑞典', '苏格兰', '爱尔兰', '威尔士', '梅尔西亚', '威塞克斯', '东盎格利亚', '特兰西瓦尼亚',
    '安达卢西亚', '格拉纳达', '葡萄牙', '加利西亚', '阿斯图里亚斯', '图卢兹', '普罗旺斯', '萨伏依',
    '奥地利', '蒂罗尔', '卡林西亚', '波美拉尼亚', '普鲁士', '库尔兰', '利沃尼亚', '弗拉基米尔',
    '梁赞', '特维尔', '斯摩棱斯克', '切尔尼戈夫', '加利奇', '摩尔达维亚', '阿普利亚', '翁布里亚',
    '坎特伯雷', '约克', '康沃尔', '埃塞克斯', '勃兰登堡', '黑森', '符腾堡', '洛泰尔',
    '里昂', '香槟', '安茹', '曼恩', '皮卡第', '阿图瓦', '布拉班特', '海尔德兰'
  ];
  D.settlementNames = [
    '橡木港', '白鹿堡', '石桥镇', '河湾城', '金穗村', '鸦巢', '铁砧堡', '圣艾丹',
    '米德堡', '麦田镇', '灰石城', '鹿角渡', '钟塔镇', '黑水港', '银溪', '牧羊丘',
    '圣米迦勒', '布雷德', '龙脊堡', '风车村', '羊皮镇', '紫杉堡', '南门镇', '老橡树',
    '玫瑰谷', '灰衣修士', '高塔镇', '芦苇渡', '白垩岩', '石楠原', '狮心堡', '金雀花',
    '冬青镇', '法尔肯', '铁桥', '天鹅湖', '圣维拉', '卡尔卡松', '蒙福特', '奥克港',
    '新堡', '旧磨坊', '塔恩', '布雷斯特', '洛里昂', '阿维尼翁', '维罗纳', '蒙扎',
    '帕维亚', '阿马尔菲', '比萨', '卢卡', '锡耶纳', '拉韦纳', '安科纳', '斯波莱托',
    '美因茨', '科隆', '亚琛', '特里尔', '纽伦堡', '奥格斯堡', '雷根斯堡', '维尔茨堡',
    '格但斯克', '托伦', '克拉科夫', '卢布林', '普热梅希尔', '利沃夫', '哈利奇', '切尔文'
  ];

  // ---------- Node types ----------
  D.NODES = {
    tree:   { key: 'tree', name: '树林', resource: 'wood', colors: ['#3e5d35', '#53733f', '#2f492b'], min: 90, max: 260, regen: 0.014, gather: 3.2, clearDays: 3, desc: '出产木材。采集时有概率获得浆果与草药。' },
    berry:  { key: 'berry', name: '浆果丛', resource: 'food', colors: ['#4d7036', '#6c8742', '#9b3c45'], min: 55, max: 145, regen: 0.022, gather: 2.8, clearDays: 2, desc: '出产食物。采集时有概率获得草药。' },
    iron:   { key: 'iron', name: '铁矿脉', resource: 'ironOre', colors: ['#707b7e', '#8b918c', '#4d585b'], min: 130, max: 330, regen: 0.006, gather: 0.8, clearDays: 7, desc: '可开采铁矿。铁矿需在冶炼厂加工为铁。' },
    gold:   { key: 'gold', name: '金矿脉', resource: 'goldOre', colors: ['#8f7a47', '#b99c53', '#665837'], min: 70, max: 190, regen: 0.004, gather: 0.45, clearDays: 8, desc: '稀有矿脉，出产金矿。城市阶段方可开采。' },
    silver: { key: 'silver', name: '银矿脉', colors: ['#77858a', '#aab4b2', '#596467'], resource: 'silverOre', min: 90, max: 240, regen: 0.005, gather: 0.7, clearDays: 7, desc: '出产银矿。银可铸成银币。' }
  };

  // ---------- Building definitions ----------
  D.BUILD_CATS = [
    { id: 'gov', name: '政府建筑', icon: 'crown' },
    { id: 'resource', name: '资源建筑', icon: 'axe' },
    { id: 'civic', name: '功能建筑', icon: 'hamlet' },
    { id: 'military', name: '战争建筑', icon: 'sword' },
    { id: 'tech', name: '科技建筑', icon: 'book' },
    { id: 'special', name: '特殊工程', icon: 'bridge' }
  ];

  const COST_MUL = [0, 1, 2.15, 3.75, 6.1];
  const DAYS_MUL = [0, 1, 1.65, 2.55, 3.8];
  const HP_MUL = [0, 1, 1.75, 2.7, 3.9];
  D.COST_MUL = COST_MUL;

  const B = {};
  function building(id, opts) {
    const def = Object.assign({
      id, cat: 'civic', foot: [2, 2], maxLevel: 4, minLevel: 1, unique: false,
      baseCost: { wood: 40, stone: 10 }, baseDays: 4, baseHp: 260,
      slots: [0, 0, 0, 0, 0], workers: false, levelNames: null,
      desc: '', effect: '', requires: null, buildMode: 'single'
    }, opts);
    B[id] = def;
  }

  building('hall', {
    cat: 'gov', name: '村庄大厅', foot: [3, 3], unique: true, maxLevel: 4,
    cost: [null, null,
      { food: 80, wood: 180, stone: 120 },
      { food: 180, wood: 320, stone: 260, coin: 35 },
      { food: 300, wood: 500, stone: 420, iron: 50, coin: 90 }],
    buildDays: [0, 0, 14, 25, 38],
    hp: [0, 1500, 2500, 4000, 6500], radius: [0, 9, 12, 16, 20], popBonus: [0, 6, 9, 13, 20],
    levelNames: ['', '村庄大厅', '镇长大厅', '市政厅', '王宫'],
    desc: '定居点的核心与权力象征。王宫每个阵营只能拥有一座。',
    effect: '决定定居点阶段、领地范围与人口基础上限。升级后需重新建造。'
  });
  building('house', {
    cat: 'gov', name: '民宅', foot: [2, 2], baseCost: { wood: 34, stone: 6 }, baseDays: 3, baseHp: 210,
    popByLevel: [0, 3, 4, 6, 8], growthDays: [0, 11, 9, 7, 5],
    desc: '为臣民提供居所，提升人口上限，并会随着时间孕育新的居民。',
    effect: '每座民宅独立增长人口；人口总数包括所有居民和士兵。'
  });
  building('lumber', {
    cat: 'resource', name: '伐木场', foot: [2, 2], baseCost: { wood: 48, stone: 12 }, baseDays: 4, baseHp: 300,
    slots: [0, 2, 3, 4, 5], requires: { type: 'tree', range: 3, label: '树林' },
    prod: { wood: 5.2 }, prodMul: [0, 1, 1.24, 1.5, 1.82], regenBoost: [0, 2, 2.25, 2.5, 2.8],
    desc: '必须建于树林旁。工人进入后会持续采伐附近的森林，并使附近树林的再生速度大幅加快。',
    effect: '每名工人每日常规产出木材；等级越高，工人上限、产量与森林再生倍率越高。'
  });
  building('hunter', {
    cat: 'resource', name: '猎人小屋', foot: [2, 2], baseCost: { wood: 38, stone: 8 }, baseDays: 3.5, baseHp: 280,
    slots: [0, 1, 2, 3, 4], requires: { type: 'tree', range: 3, label: '树林' },
    prod: { food: 1.75, leather: 0.55 }, prodMul: [0, 1, 1.2, 1.42, 1.68],
    desc: '必须建于树林旁。猎人在林缘狩猎，定期带回食物与皮革。',
    effect: '皮革可用于军事建筑、贸易与外交。'
  });
  building('fishery', {
    cat: 'resource', name: '渔场', foot: [2, 2], baseCost: { wood: 42, stone: 14 }, baseDays: 3.5, baseHp: 270,
    slots: [0, 2, 3, 4, 5], requires: { water: true, range: 2, label: '海洋、湖泊或河流' },
    prod: { food: 2.65 }, prodMul: [0, 1, 1.22, 1.47, 1.76],
    desc: '必须建在海洋、湖泊或河流旁。渔民每日带回食物。',
    effect: '食物产出稳定，不受陆地资源枯竭影响。'
  });
  building('gatherer', {
    cat: 'resource', name: '采摘屋', foot: [2, 2], baseCost: { wood: 42, stone: 8 }, baseDays: 3.5, baseHp: 260,
    slots: [0, 2, 3, 4, 5], requires: { type: 'berry', range: 3, label: '浆果丛' },
    prod: { food: 4.5, herb: 0.42 }, prodMul: [0, 1, 1.22, 1.45, 1.72], regenBoost: [0, 2, 2.25, 2.5, 2.8],
    desc: '必须建于浆果丛旁。采集者会采集浆果并偶然发现草药，同时照料附近浆果丛。',
    effect: '提高附近浆果丛的再生速度，并稳定产出草药。'
  });
  building('quarry', {
    cat: 'resource', name: '采石场', foot: [3, 2], baseCost: { wood: 42, stone: 0 }, baseDays: 5, baseHp: 360,
    slots: [0, 2, 3, 4, 5], prod: { stone: 1.55 }, prodMul: [0, 1, 1.18, 1.4, 1.65],
    desc: '建于空地，开采石料。只需木材即可搭起采石场，石材取之不尽，但开采缓慢。靠近高山时，开采速度提高 50%。',
    effect: '靠近高山有额外产量加成。修建高级建筑与墙体需要大量石材。'
  });
  building('ironMine', {
    cat: 'resource', name: '铁矿场', foot: [2, 2], minLevel: 2, baseCost: { wood: 62, stone: 42 }, baseDays: 5.5, baseHp: 380,
    slots: [0, 0, 2, 3, 4], requires: { type: 'iron', range: 3, label: '铁矿脉' }, prod: { ironOre: 0.8 },
    prodMul: [0, 0, 1, 1.24, 1.5],
    desc: '小镇阶段解锁。必须建在铁矿脉旁，缓慢开采铁矿。',
    effect: '铁矿无法直接使用，需通过冶炼厂加工。'
  });
  building('goldMine', {
    cat: 'resource', name: '金矿场', foot: [2, 2], minLevel: 3, baseCost: { wood: 95, stone: 70, iron: 12 }, baseDays: 7, baseHp: 420,
    slots: [0, 0, 0, 2, 3], requires: { type: 'gold', range: 3, label: '金矿脉' }, prod: { goldOre: 0.42 },
    prodMul: [0, 0, 0, 1, 1.28],
    desc: '城市阶段解锁。必须建在金矿脉旁，开采极为缓慢。',
    effect: '金矿需在冶炼厂加工为金，是宫廷与圣骑士所需的贵重资源。'
  });
  building('silverMine', {
    cat: 'resource', name: '银矿场', foot: [2, 2], minLevel: 3, baseCost: { wood: 82, stone: 60, iron: 8 }, baseDays: 6.5, baseHp: 400,
    slots: [0, 0, 0, 2, 3], requires: { type: 'silver', range: 3, label: '银矿脉' }, prod: { silverOre: 0.65 },
    prodMul: [0, 0, 0, 1, 1.26],
    desc: '城市阶段解锁。必须建在银矿脉旁，开采缓慢。',
    effect: '银矿可冶炼为银，或由铸币厂铸成银币。'
  });
  building('farm', {
    cat: 'resource', name: '农田', foot: [3, 2], maxLevel: 1, baseCost: { wood: 24, stone: 2 }, baseDays: 3, baseHp: 180,
    slots: [0, 4, 4, 4, 4], prod: { food: 2.15 }, prodMul: [0, 1, 1, 1, 1],
    desc: '建在任何空地上。农夫耕作，定期收获食物。不随定居点阶段升级。',
    effect: '稳定的食物来源，可容纳 4 名农夫。'
  });
  building('mill', {
    cat: 'resource', name: '磨坊', foot: [2, 2], maxLevel: 1, baseCost: { wood: 52, stone: 14 }, baseDays: 4, baseHp: 240,
    slots: [0, 3, 3, 3, 3], prod: { food: 1.65 }, prodMul: [0, 1, 1, 1, 1], requiresFarm: true,
    desc: '建在任何空地上，但定居点内必须至少有一座农田。磨坊工人将谷物磨成更多食物。',
    effect: '与农田形成粮食组合，可容纳 3 名工人。不随阶段升级。'
  });
  building('smelter', {
    cat: 'resource', name: '冶炼厂', foot: [3, 2], minLevel: 2, baseCost: { wood: 68, stone: 52 }, baseDays: 5.5, baseHp: 350,
    slots: [0, 0, 1, 2, 3], prodMul: [0, 0, 1, 1.35, 1.75], convert: true,
    desc: '小镇阶段解锁。消耗木材，将铁矿、金矿或银矿冶炼为对应的金属。',
    effect: '在建筑面板中选择冶炼配方。没有工人或原料时停止生产。'
  });
  building('mint', {
    cat: 'resource', name: '铸币厂', foot: [2, 2], minLevel: 3, baseCost: { wood: 80, stone: 65, iron: 10 }, baseDays: 6, baseHp: 330,
    slots: [0, 0, 0, 2, 3], prodMul: [0, 0, 0, 1, 1.4], convert: true,
    desc: '城市阶段解锁。消耗木材与银，铸造银币。',
    effect: '银币用于外交赠礼、救助金、雇佣商人与部分精锐部队。'
  });
  building('warehouse', {
    cat: 'civic', name: '仓库', foot: [2, 2], baseCost: { wood: 58, stone: 22 }, baseDays: 4, baseHp: 300,
    desc: '拓展本定居点所有资源的储存上限。资源不能跨定居点直接使用。',
    effect: '每级为本定居点增加大量储存空间，多个仓库可叠加。'
  });
  building('church', {
    cat: 'civic', name: '教堂', foot: [3, 3], unique: true, baseCost: { wood: 60, stone: 80, coin: 20 }, baseDays: 7, baseHp: 420,
    stability: [0, 10, 16, 22, 30],
    desc: '每个定居点只能建造一座。钟声安抚人心，大幅提升稳定度。',
    effect: '提升稳定度目标。可随定居点阶段升级。'
  });
  building('market', {
    cat: 'civic', name: '集市', foot: [3, 2], unique: true, minLevel: 2, baseCost: { wood: 62, stone: 26 }, baseDays: 5, baseHp: 300,
    merchantCap: [0, 0, 20, 30, 45], toll: [0, 0, 0.6, 0.9, 1.25],
    desc: '小镇阶段解锁。可花费食物与银币雇佣商人。商人能运送资源，并在不同阵营的集市之间完成交易。',
    effect: '每个阵营只能通过集市与外界交易。市场等级决定商人的载货上限，并带来少量过路税。'
  });
  building('tavern', {
    cat: 'civic', name: '酒馆', foot: [2, 2], unique: true, minLevel: 2, baseCost: { wood: 48, stone: 20 }, baseDays: 4, baseHp: 260,
    upkeepFood: [0, 0, 0.9, 1.3, 1.8], stability: [0, 0, 5, 8, 11], mercChance: [0, 0, 0.012, 0.022, 0.035],
    desc: '小镇阶段解锁。燃烧的食物与麦酒换来看不见的忠诚，也可能吸引雇佣兵。',
    effect: '营业时每日消耗食物并提升稳定度；有概率吸引雇佣兵加入。'
  });
  building('clinic', {
    cat: 'civic', name: '诊所', foot: [2, 2], maxLevel: 3, baseCost: { wood: 42, stone: 22, herb: 4 }, baseDays: 4, baseHp: 260,
    patientCap: [0, 2, 3, 4], healRate: [0, 0.22, 0.28, 0.36], healHerb: 0.45,
    desc: '伤员可以进入诊所，消耗草药治疗伤势。最多升级至城市阶段的诊所。',
    effect: '可同时容纳数名士兵，恢复速度高于医院。'
  });
  building('hospital', {
    cat: 'civic', name: '医院', foot: [3, 3], unique: true, minLevel: 3, baseCost: { wood: 100, stone: 110, herb: 18, coin: 30 }, baseDays: 8, baseHp: 450,
    auraRadius: [0, 0, 0, 6, 8], auraHeal: [0, 0, 0, 0.12, 0.17], auraHerb: 0.3,
    desc: '城市阶段解锁，每个定居点只能建造一座，必须建在定居点内。医院会治疗周围一定范围内的友军。',
    effect: '恢复速度略慢于同阶段诊所，但无需伤员入内，作用范围广。'
  });
  building('dock', {
    cat: 'civic', name: '码头', foot: [3, 2], minLevel: 2, baseCost: { wood: 65, stone: 25 }, baseDays: 5, baseHp: 310,
    requires: { water: true, range: 2, label: '海洋、湖泊或河流' }, shipLevel: [0, 0, 2, 3, 4], training: true,
    desc: '小镇阶段解锁，必须建于水域旁。可消耗资源建造船只。船只可运载居民与士兵渡水。',
    effect: '码头等级决定可建造的船型与运载量。船只可被远程单位击毁。'
  });
  building('barracks', {
    cat: 'military', name: '兵营', foot: [3, 2], baseCost: { wood: 55, stone: 22 }, baseDays: 4.5, baseHp: 330,
    training: true,
    desc: '训练近战士兵。随定居点阶段可训练更强的兵种：民兵、训练民兵、卫兵、禁军。',
    effect: '士兵占用人口，无法自然恢复生命。'
  });
  building('archery', {
    cat: 'military', name: '靶场', foot: [3, 2], minLevel: 2, baseCost: { wood: 62, stone: 18, leather: 8 }, baseDays: 5, baseHp: 300,
    training: true,
    desc: '小镇阶段解锁。训练远程士兵：弓箭手、长弓手、神射手。',
    effect: '远程士兵可以在城墙后射击，射程越高级越远。'
  });
  building('stable', {
    cat: 'military', name: '马厩', foot: [3, 2], minLevel: 3, baseCost: { wood: 80, stone: 32, leather: 18, coin: 20 }, baseDays: 6, baseHp: 360,
    training: true,
    desc: '城市阶段解锁。训练近战骑兵：骑兵、重骑兵。',
    effect: '骑兵移动速度快，适合包抄与追击。'
  });
  building('wall', {
    cat: 'military', name: '围墙', foot: [1, 1], baseCost: { wood: 8, stone: 2 }, baseDays: 0.2, baseHp: 360,
    buildMode: 'line', levelNames: ['', '木栅栏围墙', '石质窄墙', '石质厚墙', '雕文石质厚墙'],
    desc: '拖动建造，阻挡单位通行。点击已建成的围墙可升级为对应阶段的新墙。',
    effect: '围墙的耐久与外观随定居点阶段变化。可被敌军摧毁。'
  });
  building('gate', {
    cat: 'military', name: '大门', foot: [1, 1], baseCost: { wood: 8, stone: 2 }, baseDays: 0.2, baseHp: 420,
    levelNames: ['', '木栅栏门', '石质大门', '雕文石质大门', '王城雕文大门'],
    desc: '点击围墙即可转化为同阶段大门。大门可开启或关闭：开启时单位自由通过，关闭时等同围墙。',
    effect: '大门是围墙防线的关键弱点，也是守军出击的通道。'
  });
  building('tower', {
    cat: 'military', name: '箭塔', foot: [2, 2], baseCost: { wood: 46, stone: 32 }, baseDays: 4, baseHp: 430,
    towerRange: [0, 5.5, 6.5, 7.5, 8.5], towerDamage: [0, 9, 15, 23, 32], towerInterval: 1.7,
    levelNames: ['', '木制箭塔', '石质箭塔', '雕文石塔', '王城雕文塔楼'],
    desc: '自动攻击附近敌人。外观、攻击力和射程随等级变化。',
    effect: '无需驻军。可攻击敌方士兵与船只。'
  });
  building('knightOrder', {
    cat: 'military', name: '骑士团总部', foot: [3, 3], minLevel: 4, unique: true, baseCost: { food: 100, wood: 120, stone: 150, iron: 50, gold: 20, coin: 100 }, baseDays: 12, baseHp: 700,
    training: true,
    desc: '首都阶段解锁，每个定居点只能建造一座。可训练圣骑士。',
    effect: '圣骑士是攻防兼备的重装骑兵，训练成本极高。'
  });
  building('library', {
    cat: 'tech', name: '图书馆', foot: [2, 2], unique: true, minLevel: 2, baseCost: { wood: 50, stone: 35 }, baseDays: 5, baseHp: 280,
    slots: [0, 0, 1, 2, 3], researchTier: 1, researchBase: [0, 0, 0.45, 0.6, 0.8], researchPerWorker: [0, 0, 0.6, 0.65, 0.7],
    desc: '小镇阶段解锁，每个定居点只能建造一座。学者进入后研究一级科技。',
    effect: '基础研究缓慢；进入的学者越多，研究越快。'
  });
  building('university', {
    cat: 'tech', name: '大学', foot: [3, 2], unique: true, minLevel: 3, baseCost: { wood: 90, stone: 90, coin: 15 }, baseDays: 7, baseHp: 380,
    slots: [0, 0, 0, 2, 3], researchTier: 2, researchBase: [0, 0, 0, 0.65, 0.85], researchPerWorker: [0, 0, 0, 0.62, 0.68],
    desc: '城市阶段解锁，每个定居点只能建造一座。研究二级科技，必须以前置一级科技为基础。',
    effect: '二级科技需要大学中的学者推进。'
  });
  building('royalUniversity', {
    cat: 'tech', name: '皇家大学', foot: [3, 3], unique: true, minLevel: 4, baseCost: { food: 80, wood: 150, stone: 140, gold: 20, coin: 80 }, baseDays: 11, baseHp: 520,
    slots: [0, 0, 0, 0, 3], researchTier: 3, researchBase: [0, 0, 0, 0, 1.0], researchPerWorker: [0, 0, 0, 0, 0.7],
    desc: '首都阶段解锁，每个定居点只能建造一座。研究三级科技，必须以前置二级科技为基础。',
    effect: '帝国智慧的顶点，可解锁强大的终局加成。'
  });
  building('bridge', {
    cat: 'special', name: '桥梁', foot: [1, 1], baseCost: { wood: 16, stone: 9 }, buildMode: 'line', buildOutside: true, instant: true, baseHp: 340,
    desc: '在河流或湖泊最窄处拖拽修建，使单位可以通行。无需建在定居点内。',
    effect: '桥梁本身可被敌军摧毁。只能建于水面。'
  });
  building('tunnel', {
    cat: 'special', name: '隧道', foot: [1, 1], baseCost: { wood: 12, stone: 22 }, buildMode: 'line', buildOutside: true, instant: true, baseHp: 520,
    desc: '在高山地形中拖拽开凿隧道，使单位可以穿越山脉。无需建在定居点内。',
    effect: '隧道可被摧毁，失去通行能力。'
  });
  building('road', {
    cat: 'special', name: '道路', foot: [1, 1], baseCost: { stone: 2, wood: 1 }, buildMode: 'line', buildOutside: true, instant: true, baseHp: 60,
    desc: '在陆地上拖拽铺设道路。道路上的单位移动速度提高 35%。无需建在定居点内。',
    effect: '道路不阻挡通行。可协助商队与军队快速调动。'
  });
  D.BUILD = B;

  D.buildingCost = (def, level) => {
    if (def.cost && def.cost[level]) return Object.assign({}, def.cost[level]);
    if (def.cost || def.id === 'hall') return null;
    const mul = COST_MUL[level] || 1;
    const out = {};
    for (const [k, v] of Object.entries(def.baseCost || {})) out[k] = Math.max(1, Math.round(v * mul));
    return out;
  };
  D.buildingDays = (def, level) => {
    if (def.buildDays && def.buildDays[level] != null) return def.buildDays[level];
    if (def.id === 'hall') return 10;
    return Math.max(0.2, U.round((def.baseDays || 4) * (DAYS_MUL[level] || 1), 1));
  };
  D.buildingHp = (def, level) => {
    if (def.hp) return def.hp[level] || 100;
    return Math.round((def.baseHp || 260) * (HP_MUL[level] || 1));
  };
  D.buildingSlots = (def, level) => {
    if (!def.slots) return 0;
    const s = def.slots[level] || 0;
    return def.id === 'farm' || def.id === 'mill' ? s : s;
  };
  D.buildingName = (def, level) => {
    if (def.levelNames) return def.levelNames[level] || def.name;
    if (def.id === 'hall') return D.STAGE_HALL_NAMES[level] || def.name;
    if (def.id === 'house') return `${def.name}（${D.STAGE_NAMES[level]}）`;
    if (def.maxLevel === 1) return def.name;
    return `${def.name}（${D.STAGE_NAMES[level]}）`;
  };
  D.buildingDescription = (def, level) => {
    let desc = def.desc;
    if (def.effect) desc += ' ' + def.effect;
    return desc;
  };

  // ---------- Units ----------
  const UD = {};
  function unit(id, o) { UD[id] = Object.assign({ id, cls: 'soldier', range: 0.8, atk: 0, def: 0, interval: 1.25, speed: 1.8, radius: 0.3, military: false }, o); }
  unit('resident', {
    name: '居民', cls: 'civilian', hp: 50, atk: 0, def: 0, speed: 1.75, radius: 0.3,
    desc: '王国的根基。可采集资源、建造建筑，也可转职为建筑工。', carry: 20
  });
  unit('builder', {
    name: '建筑工', cls: 'civilian', hp: 55, atk: 0, def: 0, speed: 1.68, radius: 0.3, buildPower: 2,
    desc: '专注建造的职业工匠，建造速度是普通居民的两倍。无法采集资源，无法转回居民。', carry: 0
  });
  unit('merchant', {
    name: '商人', cls: 'civilian', hp: 58, atk: 0, def: 0, speed: 1.55, radius: 0.32, carry: 20,
    desc: '在集市间运送资源的特殊居民。可穿越阵营边界，但无法在敌军领土中安全通行。'
  });
  unit('militia', {
    name: '民兵', cls: 'soldier', military: true, costLevel: 1, hp: 110, atk: 8, def: 1, speed: 1.7, range: 0.8, interval: 1.2,
    trainCost: { food: 22, wood: 8, coin: 2 }, trainDays: 3, from: 'barracks', desc: '拿起长矛与木盾的农夫，守卫家园。'
  });
  unit('trainedMilitia', {
    name: '训练民兵', cls: 'soldier', military: true, costLevel: 2, hp: 148, atk: 13, def: 2, speed: 1.72, range: 0.82, interval: 1.18,
    trainCost: { food: 38, wood: 15, iron: 4, coin: 6 }, trainDays: 4.2, from: 'barracks', desc: '受过操练的持矛步兵，比民兵更坚韧。'
  });
  unit('guard', {
    name: '卫兵', cls: 'soldier', military: true, costLevel: 3, hp: 205, atk: 19, def: 4, speed: 1.78, range: 0.85, interval: 1.12,
    trainCost: { food: 55, wood: 22, iron: 12, coin: 16 }, trainDays: 5.5, from: 'barracks', desc: '披挂链甲的城市卫兵，是王国军队的支柱。'
  });
  unit('imperialGuard', {
    name: '禁军', cls: 'soldier', military: true, costLevel: 4, hp: 275, atk: 27, def: 6, speed: 1.82, range: 0.88, interval: 1.05,
    trainCost: { food: 80, wood: 34, iron: 28, silver: 8, coin: 30 }, trainDays: 7, from: 'barracks', desc: '帝国精锐重步兵，直属于王宫。'
  });
  unit('archer', {
    name: '弓箭手', cls: 'soldier', military: true, costLevel: 2, hp: 82, atk: 10, def: 0, speed: 1.74, range: 5.2, interval: 1.55,
    trainCost: { food: 26, wood: 22, leather: 3, coin: 5 }, trainDays: 3.8, from: 'archery', ranged: true, desc: '轻装弓手，能在安全距离抛射箭矢。'
  });
  unit('longbow', {
    name: '长弓手', cls: 'soldier', military: true, costLevel: 3, hp: 108, atk: 15, def: 1, speed: 1.7, range: 6.4, interval: 1.7,
    trainCost: { food: 42, wood: 34, iron: 4, leather: 7, coin: 12 }, trainDays: 5, from: 'archery', ranged: true, desc: '长弓射出的锥形箭可洞穿皮甲，射程极远。'
  });
  unit('sharpshooter', {
    name: '神射手', cls: 'soldier', military: true, costLevel: 4, hp: 148, atk: 23, def: 2, speed: 1.72, range: 7.4, interval: 1.8,
    trainCost: { food: 65, wood: 48, iron: 18, gold: 4, coin: 28 }, trainDays: 6.5, from: 'archery', ranged: true, desc: '百步穿杨的精锐射手，是攻城与守城的利器。'
  });
  unit('cavalry', {
    name: '骑兵', cls: 'soldier', military: true, costLevel: 3, hp: 190, atk: 18, def: 3, speed: 2.65, range: 0.9, interval: 1.15,
    trainCost: { food: 62, leather: 12, iron: 14, coin: 20 }, trainDays: 5.5, from: 'stable', cavalry: true, desc: '轻装骑兵，擅长冲散弓手与追击溃军。'
  });
  unit('heavyCavalry', {
    name: '重骑兵', cls: 'soldier', military: true, costLevel: 4, hp: 285, atk: 29, def: 6, speed: 2.32, range: 0.92, interval: 1.22,
    trainCost: { food: 92, leather: 24, iron: 34, silver: 6, coin: 42 }, trainDays: 7.5, from: 'stable', cavalry: true, desc: '具装重骑，马蹄与长枪足以撼动任何阵线。'
  });
  unit('paladin', {
    name: '圣骑士', cls: 'soldier', military: true, costLevel: 4, hp: 410, atk: 39, def: 9, speed: 2.55, range: 0.95, interval: 1.1,
    trainCost: { food: 140, leather: 40, iron: 55, gold: 22, coin: 120 }, trainDays: 11, from: 'knightOrder', cavalry: true,
    desc: '立下誓约的骑士团精锐，攻防俱佳，训练昂贵。'
  });
  unit('mercenary', {
    name: '雇佣兵', cls: 'soldier', military: true, costLevel: 2, hp: 138, atk: 12, def: 2, speed: 1.76, range: 0.82, interval: 1.15,
    trainCost: {}, trainDays: 0, from: 'tavern', desc: '为银币与麦酒而战的亡命之徒，被酒馆的喧闹吸引而来。'
  });
  unit('ship_boat', {
    name: '内河帆船', cls: 'ship', military: false, isShip: true, hp: 300, speed: 2.1, radius: 0.65, capacity: 6, atk: 0, def: 1,
    trainCost: { wood: 55, coin: 8 }, trainDays: 5, from: 'dock', desc: '小巧的河船，可在海洋、湖泊与河流中航行，运载少量人员。'
  });
  unit('ship_cog', {
    name: '柯克帆船', cls: 'ship', military: false, isShip: true, hp: 540, speed: 2.0, radius: 0.72, capacity: 12, atk: 0, def: 2,
    trainCost: { wood: 110, iron: 8, coin: 24 }, trainDays: 8, from: 'dock', desc: '拥有货舱与坚固船壳的商贸帆船。'
  });
  unit('ship_carrack', {
    name: '卡拉克帆船', cls: 'ship', military: false, isShip: true, hp: 900, speed: 1.9, radius: 0.8, capacity: 20, atk: 0, def: 3,
    trainCost: { wood: 210, iron: 30, silver: 10, coin: 60 }, trainDays: 12, from: 'dock', desc: '海上的移动堡垒，能运载整支军队渡海。'
  });
  UD.resident.role = 'laborer';
  D.UNITS = UD;

  D.TRAIN = {
    barracks: ['militia', 'trainedMilitia', 'guard', 'imperialGuard'],
    archery: ['archer', 'longbow', 'sharpshooter'],
    stable: ['cavalry', 'heavyCavalry'],
    knightOrder: ['paladin'],
    dock: ['ship_boat', 'ship_cog', 'ship_carrack']
  };
  D.unitsForBuilding = (b) => {
    const list = D.TRAIN[b.defId] || [];
    return list.filter((u, idx) => {
      const ud = UD[u];
      if (b.defId === 'dock') return ud.costLevel <= b.level && (b.defId !== 'dock' || idx === Math.max(0, b.level - 2));
      return ud.costLevel <= b.level;
    });
  };
  D.shipForDockLevel = (level) => UD['ship_' + (level >= 4 ? 'carrack' : level >= 3 ? 'cog' : 'boat')];

  // ---------- Technology ----------
  const TECH_BRANCHES = [
    { id: 'logging', name: '伐木术', icon: 'tree', desc: '提高木材采集与森林再生效率。', effectName: '木材采集' },
    { id: 'farming', name: '农耕术', icon: 'wheat', desc: '提高食物采集与农田收成。', effectName: '食物采集' },
    { id: 'masonry', name: '石工术', icon: 'stone', desc: '提高石材采集与建筑效率。', effectName: '石材采集 / 建造' },
    { id: 'metallurgy', name: '冶金学', icon: 'anvil', desc: '提高矿石与金属产量，强化护甲。', effectName: '矿产 / 护甲' },
    { id: 'drill', name: '军纪', icon: 'sword', desc: '提高近战士兵的攻击与生命。', effectName: '近战攻防' },
    { id: 'archeryTech', name: '弓术', icon: 'bow', desc: '提高远程士兵的伤害和射程。', effectName: '远程伤害' },
    { id: 'cavalryTech', name: '骑术', icon: 'horse', desc: '提高骑兵的移动速度与生命。', effectName: '骑兵' },
    { id: 'administration', name: '内政学', icon: 'seal', desc: '提升稳定度和仓储上限。', effectName: '稳定 / 仓储' },
    { id: 'medicine', name: '医学', icon: 'herb', desc: '提高诊所与医院的疗效。', effectName: '治疗效率' },
    { id: 'tradeTech', name: '贸易学', icon: 'coin', desc: '增加商队载货量、贸易收益与外交好感。', effectName: '贸易 / 外交' }
  ];
  D.TECH_BRANCHES = TECH_BRANCHES;
  D.TECHS = {};
  const tierEffects = {
    logging: [{ wood: 0.16 }, { wood: 0.18 }, { wood: 0.22 }],
    farming: [{ food: 0.16 }, { food: 0.18 }, { food: 0.22 }],
    masonry: [{ stone: 0.18, build: 0.08 }, { stone: 0.2, build: 0.1 }, { stone: 0.24, build: 0.12 }],
    metallurgy: [{ ore: 0.15, armor: 1 }, { ore: 0.18, armor: 2 }, { ore: 0.22, armor: 3 }],
    drill: [{ meleeAtk: 0.12, hp: 0.08 }, { meleeAtk: 0.15, hp: 0.1 }, { meleeAtk: 0.18, hp: 0.12 }],
    archeryTech: [{ rangedAtk: 0.14, range: 0.4 }, { rangedAtk: 0.17, range: 0.5 }, { rangedAtk: 0.2, range: 0.6 }],
    cavalryTech: [{ cavSpeed: 0.1, hp: 0.08 }, { cavSpeed: 0.12, hp: 0.1 }, { cavSpeed: 0.14, hp: 0.1 }],
    administration: [{ stability: 5, storage: 0.1 }, { stability: 6, storage: 0.12 }, { stability: 8, storage: 0.15 }],
    medicine: [{ heal: 0.18 }, { heal: 0.22 }, { heal: 0.26 }],
    tradeTech: [{ merchantCap: 0.2, relation: 2 }, { merchantCap: 0.25, relation: 3 }, { merchantCap: 0.3, relation: 4 }]
  };
  const techNames = {
    logging: ['细木工', '锯木坊', '王室林务'],
    farming: ['轮作制', '重犁', '王室农庄'],
    masonry: ['方石砌法', '拱券技术', '建筑大师'],
    metallurgy: ['坩埚冶炼', '水力锻锤', '高炉'],
    drill: ['队列操典', '长矛方阵', '常备军制'],
    archeryTech: ['弓弦改良', '长弓训练', '箭术大师'],
    cavalryTech: ['马镫改良', '长枪冲刺', '骑士冲锋'],
    administration: ['文书行政', '地籍册', '中央集权'],
    medicine: ['草药学', '外科手术', '四体液学说'],
    tradeTech: ['商路图志', '复式账簿', '汉萨同盟']
  };
  const tierCosts = [[26, 32, 38], [58, 66, 74], [100, 112, 124]];
  let techOrderSeed = 1;
  TECH_BRANCHES.forEach((branch) => {
    for (let tier = 1; tier <= 3; tier++) {
      const id = branch.id + tier;
      const reqTier = tier;
      const costs = {};
      const baseCostByTier = [
        { food: 12, wood: 24, coin: 4 },
        { food: 24, wood: 36, stone: 20, coin: 12 },
        { food: 40, wood: 50, stone: 40, iron: 8, coin: 30 }
      ][tier - 1];
      for (const [k, v] of Object.entries(baseCostByTier)) costs[k] = Math.round(v * (1 + (techOrderSeed % 3) * 0.08));
      const effect = tierEffects[branch.id][tier - 1];
      const parts = [];
      for (const [k, v] of Object.entries(effect)) {
        const labels = {
          wood: '木材采集 +', food: '食物采集 +', stone: '石材采集 +', ore: '矿产采集 +',
          build: '建造速度 +', armor: '护甲 +', meleeAtk: '近战攻击 +', hp: '生命 +',
          rangedAtk: '远程攻击 +', range: '射程 +', cavSpeed: '骑兵速度 +',
          stability: '稳定度 +', storage: '储存上限 +', heal: '治疗效率 +',
          merchantCap: '商队载货 +', relation: '外交好感获取 +'
        };
        const isPct = ['wood', 'food', 'stone', 'ore', 'build', 'meleeAtk', 'hp', 'rangedAtk', 'cavSpeed', 'storage', 'heal', 'merchantCap'].includes(k);
        parts.push(labels[k] + (isPct ? Math.round(v * 100) + '%' : v));
      }
      D.TECHS[id] = {
        id, branch: branch.id, tier, name: techNames[branch.id][tier - 1],
        desc: branch.desc, effectText: parts.join(' · '), effects: effect,
        points: tierCosts[tier - 1][(techOrderSeed++) % 3],
        cost: costs, requires: tier > 1 ? branch.id + (tier - 1) : null,
        requiresTier: reqTier, branchName: branch.name, icon: branch.icon
      };
    }
  });
  D.TECH_BY_TIER = [[], [], [], []];
  Object.values(D.TECHS).forEach((t) => D.TECH_BY_TIER[t.tier].push(t));

  // ---------- Combat / mood labels ----------
  D.relationLabel = (v, atWar) => {
    if (atWar) return '交战中';
    if (v < 20) return '敌视';
    if (v < 40) return '冷淡';
    if (v < 60) return '中立';
    if (v < 80) return '友好';
    return '亲密';
  };
  D.relationColor = (v, atWar) => {
    if (atWar) return '#a1483d';
    if (v < 20) return '#9c4d42';
    if (v < 40) return '#9c7a4c';
    if (v < 60) return '#8f896c';
    if (v < 80) return '#66855c';
    return '#4d7c65';
  };
  D.CAUSE_LABEL = {
    border: '边界冲突',
    conquest: '征服',
    independence: '独立',
    none: '无端战争'
  };
  D.DIFFICULTIES = {
    easy: { name: '侍从', label: '简单', aiEco: 0.78, aiAggro: 0.55, aiStart: 0.9, graceDays: 180, desc: 'AI发展较慢，前180天不会主动对你宣战。适合熟悉系统。' },
    normal: { name: '骑士', label: '普通', aiEco: 1.0, aiAggro: 1.0, aiStart: 1.0, graceDays: 110, desc: 'AI会扩张、结盟和争夺土地。你有约110天备战期。' },
    hard: { name: '男爵', label: '困难', aiEco: 1.25, aiAggro: 1.35, aiStart: 1.15, graceDays: 70, desc: 'AI经济更快、更早开战。备战期只有70天。' },
    legendary: { name: '国王', label: '传奇', aiEco: 1.55, aiAggro: 1.8, aiStart: 1.35, graceDays: 45, desc: 'AI拥有显著经济优势，45天后便会寻找猎物。' }
  };
  D.MAP_SIZES = {
    broad: { name: '广袤', w: 160, h: 120, desc: '适合初次游玩 · 3–4 个阵营' },
    vast: { name: '辽阔', w: 224, h: 164, desc: '完整的战争世界 · 推荐' },
    endless: { name: '无垠', w: 300, h: 214, desc: '漫长史诗 · 对电脑要求较高' }
  };

  // ---------- Realm / AI name helpers ----------
  D.realmFullName = (faction) => faction.name + (D.RANK_NAMES[faction.rank || 1] || '');
  D.settlementOwnerName = (game, settlement) => {
    const f = game.getFaction(settlement.owner);
    return f ? D.realmFullName(f) : '无主之地';
  };

  // Full pop / storage helpers
  D.storageCaps = (settlement, warehouses) => {
    const caps = {};
    for (const k of D.RES_KEYS) caps[k] = D.RES[k].baseCap;
    for (const w of warehouses || []) {
      const add = D.WAREHOUSE_STORAGE[w.level] || {};
      for (const k of D.RES_KEYS) caps[k] += add[k] || 0;
    }
    return caps;
  };

  D.factionColor = (faction) => faction ? faction.colors.primary : '#777';
  D.unitName = (kind) => (D.UNITS[kind] || {}).name || kind;
  D.unitIcon = (kind) => (D.UNITS[kind] || {}).icon || '';

  WW.D = D;
})();
