const crypto = require('node:crypto');
const worldCountries = require('world-countries');

const PLAYABLE_CODES = new Set(['VAT', 'PSE', 'XKX']);
const CATALOG = worldCountries
  .filter((c) => c.independent || c.unMember || PLAYABLE_CODES.has(c.cca3))
  .map((c) => ({
    code: c.cca3,
    cca2: c.cca2,
    numeric: c.ccn3,
    name: c.translations?.rus?.common || c.name.common,
    officialName: c.translations?.rus?.official || c.name.official,
    englishName: c.name.common,
    capital: c.capital?.[0] || '—',
    region: c.region,
    subregion: c.subregion,
    borders: c.borders || [],
    area: c.area || 1,
    landlocked: Boolean(c.landlocked),
    latlng: c.latlng || [0, 0],
    flag: c.flag || '🏳️'
  }))
  .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

const CATALOG_BY_CODE = Object.fromEntries(CATALOG.map((c) => [c.code, c]));
const MAJOR_POWERS = {
  USA: [340, 28500, 91], CHN: [1410, 18500, 89], IND: [1430, 3900, 74],
  RUS: [144, 2200, 84], JPN: [124, 4200, 83], DEU: [84, 4700, 82],
  GBR: [69, 3600, 82], FRA: [68, 3200, 81], BRA: [216, 2300, 72],
  CAN: [41, 2300, 79], ITA: [59, 2400, 75], KOR: [52, 1900, 81],
  AUS: [27, 1800, 76], IDN: [279, 1500, 68], MEX: [130, 1900, 67],
  TUR: [86, 1200, 70], SAU: [37, 1100, 72], ESP: [49, 1700, 73],
  KAZ: [20, 290, 63], UKR: [38, 190, 61], POL: [38, 850, 70]
};

const DEVELOPMENT_ACTIONS = {
  industry: { label: 'Промышленный кластер', cost: 24, field: 'industry', gain: 2, note: '+доход и производство' },
  infrastructure: { label: 'Транспортный коридор', cost: 18, field: 'infrastructure', gain: 2, note: '+торговля и снабжение' },
  science: { label: 'Научный грант', cost: 22, field: 'science', gain: 2, note: '+технологии' },
  education: { label: 'Реформа образования', cost: 16, field: 'education', gain: 2, note: '+стабильность и наука' },
  healthcare: { label: 'Модернизация медицины', cost: 16, field: 'healthcare', gain: 2, note: '+население и счастье' },
  energy: { label: 'Энергосистема', cost: 20, field: 'energy', gain: 2, note: '+энергетическая безопасность' },
  cyber: { label: 'Цифровая связь', cost: 19, field: 'cyber', gain: 2, note: '+разведка и влияние' },
  police: { label: 'Модернизация полиции', cost: 22, field: 'police', gain: 2, note: '+защита хранилища и репутация' }
};

const STEALABLE_ASSETS = {
  gold_reserve: { name: 'Золотой резерв', icon: '◈', description: 'Переводит часть казны жертвы в вашу.' },
  research_prototype: { name: 'Научный прототип', icon: '⌬', description: 'Передаёт 3 ед. научного потенциала.' },
  military_blueprints: { name: 'Военные чертежи', icon: '✦', description: 'Даёт оснащение и боевой опыт.' },
  cipher_keys: { name: 'Ключи шифрования', icon: '⌁', description: 'Передаёт 3 ед. киберпотенциала.' },
  cultural_relic: { name: 'Национальная реликвия', icon: '♛', description: 'Даёт влияние и престиж.' }
};

const MILITARY_ACTIONS = {
  recruit: { label: 'Подготовить бригаду', cost: 20, manpower: 12, readiness: 1, note: '+12 тыс. бойцов · +1 готовность' },
  training: { label: 'Полевые сборы резервистов', cost: 30, manpower: 18, readiness: 5, experience: 2, happiness: -1, note: '+18 тыс. из резерва · +5 готовность · +2 опыт' },
  mobilize: { label: 'Национальная мобилизация', cost: 42, manpower: 35, readiness: 3, morale: -3, stability: -2, happiness: -4, note: 'до +35 тыс. из резерва · удар по обществу' },
  modernize: { label: 'Модернизировать технику', cost: 28, equipment: 3, readiness: 2, note: '+3 оснащение · +2 готовность' },
  airforce: { label: 'Обновить авиацию', cost: 35, air: 2, readiness: 1, note: '+2 авиация · наступательный потенциал' },
  navy: { label: 'Усилить флот', cost: 38, navy: 2, readiness: 1, note: '+2 флот · морская проекция силы' },
  defense: { label: 'Укрепить границы', cost: 25, defense: 3, readiness: 1, note: '+3 оборона · фронт сложнее прорвать' },
  stockpile: { label: 'Создать фронтовые запасы', cost: 34, supplies: 24, note: '+24 снабжение · позволяет вести наступления' },
  medical: { label: 'Развернуть полевые госпитали', cost: 36, medical: 6, morale: 2, note: '+6 медицина · меньше безвозвратных потерь' },
  propaganda: { label: 'Поднять боевой дух', cost: 24, morale: 9, readiness: 2, influence: -1, note: '+9 мораль · +2 готовность' }
};

const BATTLE_TACTICS = {
  cautious: { name: 'Осторожное наступление', description: 'Меньше потерь и расхода снабжения, но медленный фронт.', attack: .88, capture: .7, casualties: .62, supply: .72, minDeployment: 10 },
  standard: { name: 'Плановая операция', description: 'Сбалансированное наступление без особых модификаторов.', attack: 1, capture: 1, casualties: 1, supply: 1, minDeployment: 10 },
  breakthrough: { name: 'Массированный прорыв', description: 'Максимальная ударная сила ценой снабжения и высоких потерь.', attack: 1.2, capture: 1.25, casualties: 1.28, supply: 1.35, minDeployment: 60 },
  encirclement: { name: 'Операция на окружение', description: 'Манёвр даёт много территории и усиливает потери противника.', attack: 1.08, capture: 1.38, casualties: .9, enemyCasualties: 1.25, supply: 1.18, minDeployment: 40, requires: 'combined_arms' }
};

const WAR_TICK_MS = 1400;
const HOSTILE_COOLDOWN_MS = 120000;
const WAR_WEATHER = {
  clear: { name: 'Ясная погода', icon: '☀', power: 1, capture: 1, supply: 1 },
  rain: { name: 'Ливни', icon: '☂', power: .96, capture: .84, supply: 1.12 },
  mud: { name: 'Распутица', icon: '≈', power: .9, capture: .66, supply: 1.24 },
  snow: { name: 'Снегопад', icon: '❄', power: .92, capture: .76, supply: 1.18 },
  storm: { name: 'Штормовой фронт', icon: 'ϟ', power: .86, capture: .58, supply: 1.3 }
};
const WAR_TERRAINS = {
  plains: { name: 'равнины и степи', icon: '≈', attack: 1.04, defense: .96, capture: 1.1, supply: .95 },
  mountains: { name: 'горная местность', icon: '▲', attack: .83, defense: 1.2, capture: .7, supply: 1.25 },
  desert: { name: 'пустыня', icon: '◇', attack: .91, defense: 1.02, capture: .84, supply: 1.3 },
  jungle: { name: 'джунгли', icon: '♣', attack: .86, defense: 1.13, capture: .72, supply: 1.22 },
  arctic: { name: 'арктическая зона', icon: '❄', attack: .82, defense: 1.1, capture: .66, supply: 1.32 },
  coast: { name: 'прибрежный театр', icon: '≈', attack: .96, defense: 1.05, capture: .94, supply: 1.05 }
};
const PLAYER_NEWS_COOLDOWN_MS = 30000;
const PLAYER_NEWS_CATEGORIES = {
  politics: { name: 'Политика', icon: '◎', tone: 'blue' },
  economy: { name: 'Экономика', icon: '◆', tone: 'green' },
  military: { name: 'Армия', icon: '✦', tone: 'red' },
  society: { name: 'Общество', icon: '◉', tone: 'gold' },
  statement: { name: 'Заявление лидера', icon: '◈', tone: 'violet' }
};

const MILITARY_DOCTRINES = {
  balanced: { name: 'Сбалансированная доктрина', description: 'Без штрафов и узкой специализации.', attack: 1, defense: 1, capture: 1, casualties: 1 },
  maneuver: { name: 'Манёвренная война', description: '+8% атака и +14% продвижение, −6% оборона.', attack: 1.08, defense: .94, capture: 1.14, casualties: 1.05 },
  firepower: { name: 'Огневая мощь', description: '+12% атака, меньше своих потерь, выше расход снабжения.', attack: 1.12, defense: 1, capture: 1.04, casualties: .86, supply: 1.15 },
  defense: { name: 'Глубокая оборона', description: '+18% оборона и меньше потерь, но слабее наступление.', attack: .9, defense: 1.18, capture: .82, casualties: .78 }
};

const TECHNOLOGY_TREE = [
  {
    id: 'economy', name: 'Экономическая мощь', icon: '◆', color: '#60d6a7', description: 'Капитал, индустрия и глобальные рынки',
    nodes: [
      { id: 'modern_taxation', name: 'Современная налоговая система', tier: 1, cost: 2, money: 18, effect: { incomePct: .06 }, effectText: '+6% доход государства' },
      { id: 'industrial_clusters', name: 'Индустриальные кластеры', tier: 2, cost: 3, money: 26, requires: ['modern_taxation'], effect: { developmentDiscount: .08, gdpGrowthPct: .08 }, effectText: '−8% стоимость развития · рост ВВП' },
      { id: 'continental_logistics', name: 'Континентальная логистика', tier: 3, cost: 4, money: 34, requires: ['industrial_clusters'], effect: { incomePct: .08, projectSpeed: 1 }, effectText: '+8% доход · национальные проекты быстрее' },
      { id: 'global_markets', name: 'Глобальные рынки', tier: 4, cost: 5, money: 46, requires: ['continental_logistics'], effect: { incomePct: .1, tradeBonus: .35 }, effectText: '+10% доход · усиление торговых договоров' },
      { id: 'robotic_production', name: 'Роботизированное производство', tier: 5, cost: 6, money: 62, requires: ['global_markets'], effect: { developmentDiscount: .1, industryPerTurn: .5 }, effectText: '−10% стоимость развития · индустрия каждый ход' },
      { id: 'sovereign_fund', name: 'Суверенный фонд будущего', tier: 6, cost: 8, money: 85, requires: ['robotic_production'], effect: { incomePct: .16, stabilityPerTurn: .15 }, effectText: '+16% доход · финансовая устойчивость' },
      { id: 'post_scarcity', name: 'Экономика изобилия', tier: 7, cost: 10, money: 120, requires: ['sovereign_fund', 'artificial_governance'], effect: { incomePct: .22, developmentPoints: 1 }, effectText: '+22% доход · +1 очко развития за ход' }
    ]
  },
  {
    id: 'science', name: 'Наука и технологии', icon: '⌬', color: '#63c9f3', description: 'Исследования, космос и искусственный интеллект',
    nodes: [
      { id: 'research_universities', name: 'Исследовательские университеты', tier: 1, cost: 2, money: 18, effect: { sciencePerTurn: .3 }, effectText: '+0,3 науки каждый ход' },
      { id: 'national_laboratories', name: 'Национальные лаборатории', tier: 2, cost: 3, money: 28, requires: ['research_universities'], effect: { developmentPoints: .3, sciencePerTurn: .25 }, effectText: 'Больше очков развития и науки' },
      { id: 'supercomputing', name: 'Суперкомпьютерная сеть', tier: 3, cost: 4, money: 38, requires: ['national_laboratories'], effect: { cyberPerTurn: .35, intelPct: .12 }, effectText: '+киберпотенциал · +12% к разведке' },
      { id: 'orbital_network', name: 'Орбитальная сеть', tier: 4, cost: 5, money: 52, requires: ['supercomputing'], effect: { influencePerTurn: .25, attackPct: .06 }, effectText: '+влияние · точность военных операций' },
      { id: 'artificial_governance', name: 'ИИ в государственном управлении', tier: 5, cost: 6, money: 68, requires: ['orbital_network'], effect: { incomePct: .08, developmentDiscount: .06 }, effectText: '+8% доход · −6% стоимость развития' },
      { id: 'quantum_networks', name: 'Квантовые коммуникации', tier: 6, cost: 8, money: 88, requires: ['artificial_governance'], effect: { intelPct: .22, cyberPerTurn: .5 }, effectText: '+22% к разведке · защищённая связь' },
      { id: 'frontier_science', name: 'Наука за горизонтом', tier: 7, cost: 10, money: 125, requires: ['quantum_networks', 'space_command'], effect: { developmentPoints: 1.5, influencePerTurn: .5 }, effectText: '+1,5 очка развития · мировое влияние' }
    ]
  },
  {
    id: 'society', name: 'Общество и государство', icon: '◉', color: '#e6c777', description: 'Стабильность, здоровье и человеческий капитал',
    nodes: [
      { id: 'civil_service', name: 'Профессиональная госслужба', tier: 1, cost: 2, money: 16, effect: { stabilityPerTurn: .22 }, effectText: '+стабильность каждый ход' },
      { id: 'universal_health', name: 'Всеобщая медицина', tier: 2, cost: 3, money: 26, requires: ['civil_service'], effect: { happinessPerTurn: .25, populationGrowth: .001 }, effectText: '+счастье и прирост населения' },
      { id: 'social_contract', name: 'Новый общественный договор', tier: 3, cost: 4, money: 34, requires: ['universal_health'], effect: { stabilityPerTurn: .3, happinessPerTurn: .2 }, effectText: '+стабильность и доверие' },
      { id: 'green_metropolis', name: 'Зелёные мегаполисы', tier: 4, cost: 5, money: 44, requires: ['social_contract'], effect: { incomePct: .04, happinessPerTurn: .28 }, effectText: '+4% доход · качество жизни' },
      { id: 'talent_nation', name: 'Нация талантов', tier: 5, cost: 6, money: 60, requires: ['green_metropolis'], effect: { sciencePerTurn: .4, influencePerTurn: .18 }, effectText: '+наука · культурное влияние' },
      { id: 'demographic_future', name: 'Демографическое будущее', tier: 6, cost: 8, money: 82, requires: ['talent_nation'], effect: { populationGrowth: .0025, happinessPerTurn: .35 }, effectText: 'Ускоренный рост населения' },
      { id: 'national_harmony', name: 'Национальная гармония', tier: 7, cost: 10, money: 110, requires: ['demographic_future', 'global_institutions'], effect: { stabilityPerTurn: .6, happinessPerTurn: .5 }, effectText: 'Сильнейший рост стабильности и счастья' }
    ]
  },
  {
    id: 'army', name: 'Военная модернизация', icon: '✦', color: '#ef786f', description: 'Профессиональная армия и высокоточное оружие',
    nodes: [
      { id: 'professional_army', name: 'Профессиональная армия', tier: 1, cost: 2, money: 20, effect: { militaryDiscount: .06, readinessPerTurn: .2, recruitPct: .15 }, effectText: '−6% стоимость армии · +15% пополнение' },
      { id: 'combined_arms', name: 'Общевойсковая доктрина', tier: 2, cost: 3, money: 30, requires: ['professional_army'], effect: { attackPct: .08, capturePct: .1 }, effectText: '+8% атака · +10% продвижение фронта' },
      { id: 'air_superiority', name: 'Воздушное превосходство', tier: 3, cost: 4, money: 42, requires: ['combined_arms'], effect: { attackPct: .08, airPerTurn: .2 }, effectText: '+авиация · эффективность операций' },
      { id: 'precision_weapons', name: 'Высокоточное вооружение', tier: 4, cost: 5, money: 54, requires: ['air_superiority'], effect: { attackPct: .12, militaryDiscount: .05, supplyUsePct: .08 }, effectText: '+12% атака · −8% расход снабжения · дешевле армия' },
      { id: 'autonomous_forces', name: 'Автономные боевые системы', tier: 5, cost: 6, money: 70, requires: ['precision_weapons', 'supercomputing'], effect: { attackPct: .13, manpowerSave: .3, capturePct: .15 }, effectText: '+13% атака · +15% захват · на 30% меньше потерь' },
      { id: 'hypersonic_complex', name: 'Гиперзвуковой комплекс', tier: 6, cost: 8, money: 94, requires: ['autonomous_forces'], effect: { attackPct: .18, influencePerTurn: .2, capturePct: .15 }, effectText: '+18% атака · +15% захват территории' },
      { id: 'future_army', name: 'Армия будущего', tier: 7, cost: 10, money: 130, requires: ['hypersonic_complex', 'space_command'], effect: { attackPct: .25, militaryDiscount: .12, capturePct: .25 }, effectText: '+25% атака · +25% захват · −12% стоимость армии' }
    ]
  },
  {
    id: 'defense', name: 'Стратегическая оборона', icon: '⬡', color: '#b693ef', description: 'Логистика, резервы и защита территории',
    nodes: [
      { id: 'logistics_corps', name: 'Корпус военной логистики', tier: 1, cost: 2, money: 20, effect: { readinessPerTurn: .25, capturePct: .05, supplyPerTurn: 3, supplyUsePct: .1 }, effectText: '+3 снабжения/ход · −10% расход · +5% продвижение' },
      { id: 'layered_fortifications', name: 'Эшелонированная оборона', tier: 2, cost: 3, money: 30, requires: ['logistics_corps'], effect: { defensePct: .1, defensePerTurn: .2 }, effectText: '+10% оборона · укрепления' },
      { id: 'strategic_reserve', name: 'Стратегический резерв', tier: 3, cost: 4, money: 40, requires: ['layered_fortifications'], effect: { defensePct: .1, manpowerPerTurn: .4, reservePerTurn: 1.2 }, effectText: '+10% оборона · пополнение армии и резерва' },
      { id: 'missile_shield', name: 'Противоракетный щит', tier: 4, cost: 5, money: 56, requires: ['strategic_reserve'], effect: { defensePct: .16 }, effectText: '+16% эффективность обороны' },
      { id: 'total_defense', name: 'Доктрина тотальной обороны', tier: 5, cost: 6, money: 72, requires: ['missile_shield'], effect: { defensePct: .18, stabilityPerTurn: .15 }, effectText: '+18% оборона · устойчивость' },
      { id: 'space_command', name: 'Космическое командование', tier: 6, cost: 8, money: 96, requires: ['total_defense', 'orbital_network'], effect: { defensePct: .16, intelPct: .1 }, effectText: '+16% оборона · разведданные' },
      { id: 'strategic_deterrence', name: 'Абсолютное сдерживание', tier: 7, cost: 10, money: 135, requires: ['space_command'], effect: { defensePct: .3, influencePerTurn: .4 }, effectText: '+30% оборона · глобальное влияние' }
    ]
  },
  {
    id: 'diplomacy', name: 'Мировое влияние', icon: '◎', color: '#f19bd3', description: 'Мягкая сила, разведка и международные институты',
    nodes: [
      { id: 'diplomatic_corps', name: 'Дипломатический корпус', tier: 1, cost: 2, money: 16, effect: { relationBonus: 2, influencePerTurn: .12 }, effectText: 'Сильнее дипломатия · +влияние' },
      { id: 'cultural_exports', name: 'Культурный экспорт', tier: 2, cost: 3, money: 26, requires: ['diplomatic_corps'], effect: { influencePerTurn: .28 }, effectText: '+мягкая сила каждый ход' },
      { id: 'trade_missions', name: 'Торговые миссии', tier: 3, cost: 4, money: 36, requires: ['cultural_exports'], effect: { tradeBonus: .25, incomePct: .04 }, effectText: '+торговля · +4% доход' },
      { id: 'intelligence_web', name: 'Глобальная агентурная сеть', tier: 4, cost: 5, money: 48, requires: ['trade_missions'], effect: { intelPct: .2 }, effectText: '+20% успех разведопераций' },
      { id: 'collective_security', name: 'Коллективная безопасность', tier: 5, cost: 6, money: 64, requires: ['intelligence_web'], effect: { defensePct: .08, relationBonus: 3 }, effectText: '+8% оборона · дипломатический бонус' },
      { id: 'global_institutions', name: 'Глобальные институты', tier: 6, cost: 8, money: 86, requires: ['collective_security'], effect: { influencePerTurn: .45, developmentPoints: .4 }, effectText: '+влияние · очки развития' },
      { id: 'world_architect', name: 'Архитектор мирового порядка', tier: 7, cost: 10, money: 120, requires: ['global_institutions', 'sovereign_fund'], effect: { influencePerTurn: .8, relationBonus: 5 }, effectText: 'Максимальная дипломатическая мощь' }
    ]
  }
];

const TECH_BY_ID = Object.fromEntries(TECHNOLOGY_TREE.flatMap((branch) => branch.nodes.map((node) => [node.id, { ...node, branch: branch.id }])));

const NATIONAL_PROJECTS = {
  rail_network: { name: 'Скоростной транспортный пояс', icon: '⌁', cost: 78, duration: 3, description: 'Соединяет промышленные центры и ускоряет внутреннюю торговлю.', rewards: { infrastructure: 8, gdpPct: .035, stability: 2 } },
  semiconductor: { name: 'Национальная микроэлектроника', icon: '⌬', cost: 112, duration: 4, description: 'Создаёт независимую технологическую базу.', rewards: { science: 8, industry: 5, cyber: 4 } },
  energy_ring: { name: 'Единое энергетическое кольцо', icon: 'ϟ', cost: 92, duration: 4, description: 'Повышает надёжность и доступность энергии.', rewards: { energy: 10, industry: 3, happiness: 2 } },
  space_program: { name: 'Национальная космическая программа', icon: '◌', cost: 145, duration: 5, description: 'Спутники связи, наблюдения и научные миссии.', rewards: { science: 9, influence: 9, cyber: 3 } },
  health_nation: { name: 'Здоровая нация', icon: '✚', cost: 84, duration: 3, description: 'Новые клиники, профилактика и биомедицинские центры.', rewards: { healthcare: 10, happiness: 5, stability: 2 } },
  smart_cities: { name: 'Умные города', icon: '▦', cost: 104, duration: 4, description: 'Цифровое управление крупнейшими агломерациями.', rewards: { cyber: 9, infrastructure: 6, gdpPct: .02 } },
  defense_complex: { name: 'Оборонно-промышленный комплекс', icon: '⬡', cost: 124, duration: 4, description: 'Собственное производство техники и систем защиты.', rewards: { industry: 5, equipment: 9, defense: 6 } },
  green_transition: { name: 'Зелёный переход', icon: '❋', cost: 96, duration: 4, description: 'Возобновляемая энергетика и восстановление экосистем.', rewards: { energy: 9, happiness: 4, influence: 3 } },
  nuclear_program: { name: 'Стратегическая ядерная программа', icon: '☢', cost: 188, duration: 6, description: 'Создаёт дорогое стратегическое сдерживание и резко повышает международное влияние.', requirements: { science: 60, energy: 60 }, rewards: { science: 7, influence: 14, defense: 10 } },
  global_port: { name: 'Глобальный торговый порт', icon: '⚓', cost: 138, duration: 5, description: 'Узел морских маршрутов, складов и международной торговли.', requirements: { infrastructure: 55, coastal: true }, rewards: { infrastructure: 8, industry: 5, gdpPct: .055 } },
  orbital_constellation: { name: 'Орбитальная группировка', icon: '◉', cost: 174, duration: 6, description: 'Спутники разведки, навигации и защищённой связи для экономики и армии.', requirements: { science: 65, cyber: 55 }, rewards: { cyber: 10, science: 8, influence: 7 } },
  sovereign_ai: { name: 'Суверенный искусственный интеллект', icon: '◇', cost: 166, duration: 5, description: 'Автоматизирует промышленность, управление и стратегическое планирование.', requirements: { science: 70, cyber: 65 }, rewards: { cyber: 8, science: 9, industry: 7, stability: 3 } }
};

const DECISIONS = [
  { id: 'budget_debate', title: 'Большие дебаты о бюджете', text: 'Правительство спорит, куда направить неожиданные доходы.', options: [
    { id: 'industry', label: 'Субсидировать промышленность', note: '+4 индустрии, −18 млрд', cost: 18, effects: { industry: 4 } },
    { id: 'people', label: 'Вернуть средства гражданам', note: '+6 счастья, +2 стабильности', effects: { happiness: 6, stability: 2 } }
  ] },
  { id: 'energy_crisis', title: 'Энергетический вызов', text: 'Пиковое потребление испытывает энергосистему на прочность.', options: [
    { id: 'emergency', label: 'Экстренные мощности', note: '+5 энергии, −16 млрд', cost: 16, effects: { energy: 5 } },
    { id: 'saving', label: 'Программа экономии', note: '+3 стабильности, −2 счастья', effects: { stability: 3, happiness: -2 } }
  ] },
  { id: 'young_scientists', title: 'Поколение исследователей', text: 'Молодые учёные предлагают рискованную программу прорывных грантов.', options: [
    { id: 'fund', label: 'Поддержать программу', note: '+5 науки, +1 очко развития, −20 млрд', cost: 20, techPoints: 1, effects: { science: 5 } },
    { id: 'careful', label: 'Провести аудит', note: '+10 млрд, +1 стабильности', treasury: 10, effects: { stability: 1 } }
  ] },
  { id: 'mass_media', title: 'Информационная эпоха', text: 'Новые медиа стремительно меняют общественную дискуссию.', options: [
    { id: 'open', label: 'Поддержать открытость', note: '+5 счастья, +2 влияния', effects: { happiness: 5, influence: 2 } },
    { id: 'control', label: 'Усилить регулирование', note: '+5 стабильности, −3 счастья', effects: { stability: 5, happiness: -3 } }
  ] },
  { id: 'migration_wave', title: 'Новая волна миграции', text: 'Экономический рост привлекает людей из соседних государств.', options: [
    { id: 'welcome', label: 'Открыть программу интеграции', note: '+0,8 млн населения, +2 индустрии', population: .8, effects: { industry: 2 } },
    { id: 'limit', label: 'Ограничить поток', note: '+3 стабильности', effects: { stability: 3 } }
  ] },
  { id: 'military_reform', title: 'Спор о военной реформе', text: 'Генеральный штаб представил два варианта модернизации.', options: [
    { id: 'quality', label: 'Ставка на технологии', note: '+5 оснащения, −22 млрд', cost: 22, army: { equipment: 5 } },
    { id: 'reserve', label: 'Расширить резерв', note: '+18 тыс. личного состава, −12 млрд', cost: 12, army: { manpower: 18 } }
  ] }
];

const STRATEGIC_RESOURCES = {
  food: { name: 'Продовольствие', icon: '❋', price: 4, description: 'Поддерживает население и устойчивость во время кризисов.' },
  fuel: { name: 'Топливо', icon: '◆', price: 7, description: 'Нужно бронетехнике, авиации и непрерывному фронту.' },
  metals: { name: 'Металлы', icon: '⬡', price: 6, description: 'Расходуются на тяжёлую технику и мегапроекты.' },
  rare: { name: 'Редкие материалы', icon: '◇', price: 9, description: 'Основа электроники, ПВО и высоких технологий.' },
  energy: { name: 'Энергия', icon: 'ϟ', price: 5, description: 'Питает промышленность, города и цифровую инфраструктуру.' }
};

const COMMODITY_MARKET_INTERVAL_MS = 10 * 60 * 1000;
const EXTRACTION_COMMODITIES = {
  iron: { name: 'Железная руда', shortName: 'Железо', icon: '⬢', color: '#a9b3b4', basePrice: 5.4, purchaseCost: 42, rate: .34, capacity: 8, strategicResource: 'metals', conversion: 2.2, supplier: 'Atlas Steel' },
  gold: { name: 'Золотая руда', shortName: 'Золото', icon: '◆', color: '#edc75f', basePrice: 13.5, purchaseCost: 86, rate: .13, capacity: 4.5, strategicResource: null, conversion: 0, supplier: 'Aurum Reserve' },
  oil: { name: 'Сырая нефть', shortName: 'Нефть', icon: '●', color: '#32383b', basePrice: 8.2, purchaseCost: 64, rate: .27, capacity: 7, strategicResource: 'fuel', conversion: 2.4, supplier: 'Helios Energy' },
  copper: { name: 'Медная руда', shortName: 'Медь', icon: '⬡', color: '#d18455', basePrice: 6.6, purchaseCost: 49, rate: .3, capacity: 7.5, strategicResource: 'metals', conversion: 1.8, supplier: 'Meridian Works' },
  uranium: { name: 'Урановый концентрат', shortName: 'Уран', icon: '☢', color: '#a5e66c', basePrice: 15.2, purchaseCost: 102, rate: .1, capacity: 3.5, strategicResource: 'energy', conversion: 3, supplier: 'Orion Atomics' },
  rare_earth: { name: 'Редкоземельная руда', shortName: 'Редкие земли', icon: '◇', color: '#9f84df', basePrice: 11.8, purchaseCost: 78, rate: .16, capacity: 5, strategicResource: 'rare', conversion: 1.7, supplier: 'Nova Components' },
  coal: { name: 'Энергетический уголь', shortName: 'Уголь', icon: '■', color: '#707a7d', basePrice: 4.1, purchaseCost: 34, rate: .43, capacity: 10, strategicResource: 'energy', conversion: 1.7, supplier: 'Continental Power' }
};

const GEOLOGY_BONUSES = {
  oil: new Set(['SAU','RUS','USA','CAN','IRN','IRQ','ARE','QAT','KWT','VEN','NGA','NOR','KAZ','AZE','DZA','LBY','BRA']),
  gold: new Set(['CHN','AUS','RUS','USA','CAN','ZAF','GHA','MEX','BRA','IDN','KAZ','UZB']),
  iron: new Set(['AUS','BRA','CHN','IND','RUS','ZAF','CAN','UKR','SWE','KAZ']),
  copper: new Set(['CHL','PER','COD','CHN','USA','AUS','ZMB','RUS','MEX','KAZ']),
  uranium: new Set(['KAZ','CAN','NAM','AUS','UZB','RUS','NER','CHN','ZAF']),
  rare_earth: new Set(['CHN','VNM','BRA','RUS','IND','AUS','USA','GRL','KAZ','MNG']),
  coal: new Set(['CHN','IND','IDN','USA','AUS','RUS','ZAF','DEU','POL','KAZ'])
};

const POLITICAL_FACTIONS = {
  people: { name: 'Граждане', icon: '◉', description: 'Хотят доступных услуг, низких налогов и мира.' },
  business: { name: 'Бизнес', icon: '◆', description: 'Требует торговли, инфраструктуры и предсказуемых правил.' },
  military: { name: 'Военные', icon: '✦', description: 'Ценят готовность армии, снабжение и сильную оборону.' },
  elites: { name: 'Элиты', icon: '♛', description: 'Поддерживают стабильность, но сопротивляются антикоррупционным реформам.' },
  opposition: { name: 'Оппозиция', icon: '◎', description: 'Растёт при бедности, поражениях, цензуре и низком доверии.' }
};

const ADVISORS = {
  reformer: { name: 'Анна Мирова', role: 'Реформатор', icon: '◎', cost: 34, effects: 'Оппозиция растёт медленнее, стабильность +0,3/ход', bonuses: { stabilityPerTurn: .3, oppositionControl: .25 } },
  economist: { name: 'Дамир Садыков', role: 'Экономист', icon: '◆', cost: 42, effects: '+8% государственный доход, выгоднее торговля', bonuses: { incomePct: .08, tradeIncome: 1 } },
  general: { name: 'Мария Волкова', role: 'Генерал', icon: '✦', cost: 46, effects: '+8% сила армии, −8% военные потери', bonuses: { combatPct: .08, casualtyReduction: .08 } },
  diplomat: { name: 'Леон Арден', role: 'Дипломат', icon: '♜', cost: 38, effects: '+3 к дипломатическим действиям, +0,25 влияния/ход', bonuses: { relationBonus: 3, influencePerTurn: .25 } },
  spymaster: { name: 'София Норд', role: 'Глава разведки', icon: '⌁', cost: 44, effects: '+14% успех операций, лучше контрразведка', bonuses: { intelPct: .14, counterIntel: 10 } }
};

const UNIT_PROGRAMS = {
  infantry: { name: 'Механизированная пехота', icon: '♟', cost: 28, resources: { food: 4, metals: 3 }, gain: 8, description: 'Удерживает землю и снижает риск быстрого отката фронта.' },
  armor: { name: 'Бронетанковые корпуса', icon: '▰', cost: 42, resources: { fuel: 7, metals: 8 }, gain: 6, description: 'Усиливает прорыв, но постоянно требует топлива.' },
  airWings: { name: 'Тактическая авиация', icon: '▲', cost: 48, resources: { fuel: 8, rare: 5 }, gain: 5, description: 'Подавляет снабжение и ускоряет наступление.' },
  airDefense: { name: 'Эшелонированная ПВО', icon: '⬡', cost: 39, resources: { metals: 5, rare: 5 }, gain: 6, description: 'Снижает преимущество чужой авиации и защищает города.' },
  fleet: { name: 'Экспедиционный флот', icon: '≈', cost: 52, resources: { fuel: 9, metals: 8 }, gain: 5, naval: true, description: 'Усиливает блокаду портов и дальние операции.' }
};

const GLOBAL_CRISES = [
  { id: 'oil_shock', name: 'Мировой топливный шок', icon: '◆', description: 'Поставки нефти сорваны, армия и промышленность требуют срочных резервов.', duration: 3, modifiers: { fuelUse: 1.35, incomePct: -.05 }, options: [
    { id: 'reserves', label: 'Открыть стратегические резервы', note: '−12 топлива · стабильность +4', resources: { fuel: -12 }, effects: { stability: 4 } },
    { id: 'rationing', label: 'Ввести нормирование', note: 'счастье −4 · энергия +6', effects: { happiness: -4 }, resources: { energy: 6 } },
    { id: 'market', label: 'Субсидировать импорт', note: '−24 млрд · влияние +2', cost: 24, effects: { influence: 2 } }
  ] },
  { id: 'food_crisis', name: 'Глобальный продовольственный кризис', icon: '❋', description: 'Неурожай поднимает цены и усиливает протестные настроения.', duration: 3, modifiers: { foodUse: 1.4, happinessPerTurn: -1.2 }, options: [
    { id: 'stockpile', label: 'Раздать государственные запасы', note: '−14 продовольствия · счастье +6', resources: { food: -14 }, effects: { happiness: 6 } },
    { id: 'farmers', label: 'Поддержать фермеров', note: '−20 млрд · производство еды +2', cost: 20, production: { food: 2 } },
    { id: 'borders', label: 'Ограничить экспорт', note: 'стабильность +3 · репутация −4', effects: { stability: 3, reputation: -4 } }
  ] },
  { id: 'financial_crash', name: 'Мировой финансовый обвал', icon: '◇', description: 'Рынки падают, банки замораживают кредитование крупных проектов.', duration: 3, modifiers: { incomePct: -.12, projectSpeed: -.25 }, options: [
    { id: 'banks', label: 'Спасти системные банки', note: '−32 млрд · стабильность +6', cost: 32, effects: { stability: 6 } },
    { id: 'stimulus', label: 'Запустить инфраструктурный стимул', note: '−25 млрд · индустрия +3', cost: 25, effects: { industry: 3 } },
    { id: 'default', label: 'Не вмешиваться', note: 'казна сохранена · счастье −5', effects: { happiness: -5 } }
  ] },
  { id: 'pandemic', name: 'Новая пандемия', icon: '✚', description: 'Система здравоохранения перегружена, границы и торговля замедляются.', duration: 4, modifiers: { incomePct: -.07, happinessPerTurn: -.7 }, options: [
    { id: 'medicine', label: 'Массовая медицинская программа', note: '−28 млрд · здоровье +5', cost: 28, effects: { healthcare: 5 } },
    { id: 'lockdown', label: 'Жёсткий карантин', note: 'стабильность +3 · счастье −5', effects: { stability: 3, happiness: -5 } },
    { id: 'open', label: 'Сохранить открытые границы', note: 'ВВП сохранён · стабильность −5', effects: { stability: -5 } }
  ] },
  { id: 'cyber_blackout', name: 'Международный киберблэкаут', icon: '⌁', description: 'Вредоносная сеть атакует энергетику, банки и военную связь.', duration: 3, modifiers: { cyberPenalty: .12, energyUse: 1.25 }, options: [
    { id: 'shield', label: 'Изолировать государственные сети', note: '−18 млрд · киберзащита +4', cost: 18, effects: { cyber: 4 } },
    { id: 'allies', label: 'Общий центр с союзниками', note: '−3 редких материала · влияние +4', resources: { rare: -3 }, effects: { influence: 4 } },
    { id: 'counter', label: 'Ответная кибероперация', note: 'киберпотенциал +2 · репутация −2', effects: { cyber: 2, reputation: -2 } }
  ] }
];

const VICTORY_PATHS = {
  economy: { name: 'Экономическая сверхдержава', icon: '◆', description: 'Достигните ВВП 2500 млрд, дохода 55 млрд и четырёх торговых маршрутов.' },
  science: { name: 'Научное лидерство', icon: '⌬', description: 'Изучите 12 технологий и завершите три мегапроекта.' },
  diplomacy: { name: 'Архитектор мира', icon: '◎', description: 'Наберите 82 влияния, возглавьте блок из четырёх стран и сохраните репутацию 65.' },
  military: { name: 'Военная гегемония', icon: '✦', description: 'Достигните военной силы 300 и контролируйте чужую территорию.' },
  peace: { name: 'Миротворческая держава', icon: '❋', description: 'Добейтесь стабильности и счастья 82, пяти договоров и ни одной активной войны.' }
};

function technologyBonuses(country) {
  const result = {};
  for (const [id, unlocked] of Object.entries(country.techs || {})) {
    if (!unlocked) continue;
    for (const [key, value] of Object.entries(TECH_BY_ID[id]?.effect || {})) result[key] = (result[key] || 0) + value;
  }
  return result;
}

function hashFloat(text) {
  const hash = crypto.createHash('sha256').update(text).digest();
  return hash.readUInt32BE(0) / 0xffffffff;
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value, digits = 0) { const p = 10 ** digits; return Math.round(value * p) / p; }

function advisorBonuses(country) {
  const result = {};
  for (const id of Object.values(country.advisors || {})) {
    for (const [key, value] of Object.entries(ADVISORS[id]?.bonuses || {})) result[key] = (result[key] || 0) + value;
  }
  return result;
}

function initialStrategicEconomy(meta, seed, development) {
  const area = clamp(Math.log10((meta.area || 1) + 10), 1, 7);
  const latitude = Math.abs(meta.latlng?.[0] || 0);
  const roll = (id) => hashFloat(`${seed}:resource:${meta.code}:${id}`);
  const fuelPowers = new Set(['SAU','RUS','USA','CAN','IRN','IRQ','ARE','QAT','KWT','VEN','NGA','NOR','KAZ','AZE','DZA','LBY']);
  const farmPowers = new Set(['USA','CAN','BRA','ARG','UKR','RUS','IND','CHN','FRA','AUS','KAZ']);
  const rarePowers = new Set(['CHN','COD','AUS','BRA','RUS','ZAF','CAN','CHL','BOL','KAZ','MNG']);
  const production = {
    food: round(clamp(2 + area * .55 + roll('food') * 4 + (farmPowers.has(meta.code) ? 4 : 0) - Math.max(0, latitude - 55) * .04, 1, 13), 1),
    fuel: round(clamp(1 + area * .35 + roll('fuel') * 3 + (fuelPowers.has(meta.code) ? 7 : 0), .5, 14), 1),
    metals: round(clamp(1 + area * .5 + roll('metals') * 4, 1, 11), 1),
    rare: round(clamp(.4 + area * .2 + roll('rare') * 2 + (rarePowers.has(meta.code) ? 4 : 0), .3, 8), 1),
    energy: round(clamp(2 + development / 15 + roll('energy') * 3, 2, 12), 1)
  };
  const stock = Object.fromEntries(Object.keys(STRATEGIC_RESOURCES).map((id) => [id, round(18 + production[id] * 2.8, 1)]));
  return { production, stock };
}

function commodityMarketForTime(now = Date.now()) {
  const cycle = Math.floor(now / COMMODITY_MARKET_INTERVAL_MS);
  const multipliers = Object.fromEntries(Object.keys(EXTRACTION_COMMODITIES).map((id) => [id, round(.7 + hashFloat(`global-commodity-market:${cycle}:${id}`) * 1.3, 2)]));
  return {
    cycle,
    openedAt: cycle * COMMODITY_MARKET_INTERVAL_MS,
    nextUpdateAt: (cycle + 1) * COMMODITY_MARKET_INTERVAL_MS,
    multipliers
  };
}

function updateCommodityMarket(world, now = Date.now(), announce = true) {
  const currentCycle = Math.floor(now / COMMODITY_MARKET_INTERVAL_MS);
  if (world.commodityMarket?.cycle === currentCycle) return false;
  world.commodityMarket = commodityMarketForTime(now);
  if (announce && Array.isArray(world.news)) {
    const hottest = Object.entries(world.commodityMarket.multipliers).sort(([, a], [, b]) => b - a)[0];
    const commodity = EXTRACTION_COMMODITIES[hottest[0]];
    pushNews(world, `Сырьевая биржа обновила десятминутные контракты. Лучший спрос: ${commodity.name} по коэффициенту ×${hottest[1]}.`, hottest[1] >= 1.6 ? 'gold' : 'blue');
  }
  return true;
}

function initialExtractionSites(meta, seed, now = Date.now()) {
  const area = Number(meta.area) || 1;
  const count = area < 1500 ? 1 : area < 120000 ? 2 : 3;
  const ranked = Object.keys(EXTRACTION_COMMODITIES).map((type) => {
    let geology = GEOLOGY_BONUSES[type]?.has(meta.code) ? 1.25 : 0;
    if (type === 'oil' && ['Asia','Africa'].includes(meta.region)) geology += .18;
    if (type === 'gold' && ['Africa','Americas','Oceania'].includes(meta.region)) geology += .14;
    if (type === 'coal' && ['Asia','Europe'].includes(meta.region)) geology += .12;
    return { type, score: hashFloat(`${seed}:deposit:${meta.code}:${type}`) + geology };
  }).sort((a, b) => b.score - a.score).slice(0, count);
  return ranked.map(({ type }, index) => {
    const definition = EXTRACTION_COMMODITIES[type];
    const quality = round(.82 + hashFloat(`${seed}:deposit-quality:${meta.code}:${index}:${type}`) * .5, 2);
    return {
      id: `${meta.code}-${index + 1}-${type}`, type, level: 1, ownerCode: null,
      quality, purchaseCost: Math.round(definition.purchaseCost * (.88 + quality * .18)),
      baseRate: round(definition.rate * quality, 3), baseCapacity: round(definition.capacity * (.9 + quality * .16), 2),
      stored: 0, lastAccruedAt: now, lastCollectedAt: 0, producedTotal: 0,
      position: { u: hashFloat(`${seed}:deposit-x:${meta.code}:${index}`), v: hashFloat(`${seed}:deposit-y:${meta.code}:${index}`) }
    };
  });
}

function extractionRate(site) { return round((site.baseRate || EXTRACTION_COMMODITIES[site.type]?.rate || .1) * (1 + Math.max(0, (site.level || 1) - 1) * .68), 3); }
function extractionCapacity(site) { return round((site.baseCapacity || EXTRACTION_COMMODITIES[site.type]?.capacity || 5) * (1 + Math.max(0, (site.level || 1) - 1) * .72), 2); }
function extractionUpgradeCost(site) { return Math.round((site.purchaseCost || 50) * (.55 + (site.level || 1) * .32)); }

function accrueExtractionSite(site, now = Date.now()) {
  const previous = Number(site.lastAccruedAt) || now;
  site.lastAccruedAt = now;
  if (!site.ownerCode) return Number(site.stored) || 0;
  const elapsedMinutes = clamp((now - previous) / 60000, 0, 24 * 60);
  const before = Number(site.stored) || 0;
  site.stored = round(Math.min(extractionCapacity(site), before + elapsedMinutes * extractionRate(site)), 3);
  site.producedTotal = round((site.producedTotal || 0) + Math.max(0, site.stored - before), 3);
  return site.stored;
}

function extractionTerritory(world, country, targetCode) {
  const territory = world.countries[targetCode];
  return territory && (territory.code === country.code || territory.absorbedBy === country.code) ? territory : null;
}

function performExtractionAction(world, country, message, now = Date.now()) {
  updateCommodityMarket(world, now);
  if (message.id === 'sell') {
    const type = EXTRACTION_COMMODITIES[message.commodity] ? message.commodity : null;
    if (!type) return { ok: false, error: 'Неизвестный вид сырья' };
    const available = Number(country.commodityStorage?.[type]) || 0;
    const requested = Number(message.amount);
    const amount = round(Math.min(available, Number.isFinite(requested) && requested > 0 ? requested : available), 3);
    if (amount < .05) return { ok: false, error: 'На складе пока нет сырья для продажи' };
    const definition = EXTRACTION_COMMODITIES[type];
    const multiplier = world.commodityMarket.multipliers[type];
    const tradeTechnology = Math.min(.18, (technologyBonuses(country).tradeBonus || 0) * .2);
    const revenue = round(amount * definition.basePrice * multiplier * (1 + tradeTechnology), 1);
    country.commodityStorage[type] = round(available - amount, 3);
    country.treasury = round(country.treasury + revenue, 1);
    country.commoditySales = round((country.commoditySales || 0) + revenue, 1);
    country.lastAction = `Продажа сырья компании ${definition.supplier}: +${revenue} млрд`;
    return { ok: true, toast: `${definition.supplier} купила ${round(amount, 2)} ед. · ×${multiplier} · +${revenue} млрд` };
  }
  if (message.id === 'refine') {
    const type = EXTRACTION_COMMODITIES[message.commodity] ? message.commodity : null;
    const definition = EXTRACTION_COMMODITIES[type];
    if (!definition?.strategicResource) return { ok: false, error: 'Это сырьё можно только продать поставщику' };
    const available = Number(country.commodityStorage?.[type]) || 0;
    const amount = round(Math.min(available, Math.max(.1, Number(message.amount) || available)), 3);
    if (amount < .05) return { ok: false, error: 'На складе нет сырья для переработки' };
    const strategic = definition.strategicResource; const free = Math.max(0, 150 - (country.resources[strategic] || 0));
    const used = Math.min(amount, free / definition.conversion);
    if (used < .05) return { ok: false, error: 'Стратегический склад уже заполнен' };
    country.commodityStorage[type] = round(available - used, 3);
    const gained = round(used * definition.conversion, 1);
    country.resources[strategic] = round((country.resources[strategic] || 0) + gained, 1);
    return { ok: true, toast: `${definition.shortName}: переработано ${round(used, 2)} ед. · получено ${gained} ед. ресурса` };
  }

  const territory = extractionTerritory(world, country, String(message.target || '').slice(0, 3));
  if (!territory) return { ok: false, error: 'Разрабатывать можно только свою или полностью присоединённую территорию' };
  const site = territory.extractionSites?.find((item) => item.id === message.siteId);
  if (!site) return { ok: false, error: 'Месторождение больше не существует' };
  const definition = EXTRACTION_COMMODITIES[site.type];
  if (message.id === 'buy') {
    if (site.ownerCode) return { ok: false, error: 'Предприятие уже принадлежит государству' };
    if (!spend(country, site.purchaseCost)) return { ok: false, error: `Для покупки нужно ${site.purchaseCost} млрд` };
    site.ownerCode = country.code; site.lastAccruedAt = now; site.stored = 0;
    country.lastAction = `Приобретено предприятие «${definition.name}»`;
    return { ok: true, toast: `${definition.name}: предприятие куплено за ${site.purchaseCost} млрд` };
  }
  if (site.ownerCode !== country.code) return { ok: false, error: 'Это предприятие не принадлежит вашей стране' };
  accrueExtractionSite(site, now);
  if (message.id === 'collect') {
    const amount = round(site.stored, 3);
    if (amount < .03) return { ok: false, error: 'Добыча ещё не накопилась' };
    country.commodityStorage[site.type] = round((country.commodityStorage[site.type] || 0) + amount, 3);
    site.stored = 0; site.lastCollectedAt = now;
    return { ok: true, toast: `${definition.icon} Собрано ${round(amount, 2)} ед. · сырьё перемещено на государственный склад` };
  }
  if (message.id === 'upgrade') {
    if (site.level >= 3) return { ok: false, error: 'Предприятие уже достигло максимального уровня' };
    const cost = extractionUpgradeCost(site);
    if (!spend(country, cost)) return { ok: false, error: `Для модернизации нужно ${cost} млрд` };
    site.level += 1; site.lastAccruedAt = now;
    return { ok: true, toast: `${definition.shortName}: предприятие улучшено до уровня ${site.level}` };
  }
  return { ok: false, error: 'Неизвестная операция с месторождением' };
}

function spendResources(country, costs = {}) {
  for (const [id, amount] of Object.entries(costs)) if ((country.resources?.[id] || 0) < amount) return false;
  for (const [id, amount] of Object.entries(costs)) country.resources[id] = round(country.resources[id] - amount, 1);
  return true;
}

function strategicGoalProgress(world, country) {
  const routes = (world.tradeRoutes || []).filter((route) => route.status === 'active' && (route.from === country.code || route.to === country.code)).length;
  const alliance = (world.alliances || []).find((item) => item.id === country.allianceId);
  const occupied = Object.values(world.countries).some((target) => target.occupation?.by === country.code && target.occupation.percent > 0);
  const values = {
    economy: Math.min(1, country.gdp / 2500, country.income / 55, routes / 4),
    science: Math.min(1, Object.keys(country.techs || {}).length / 12, (country.completedProjects || []).length / 3),
    diplomacy: Math.min(1, country.influence / 82, (alliance?.members?.length || 0) / 4, country.reputation / 65),
    military: Math.min(1, country.militaryPower / 300, occupied ? 1 : 0),
    peace: Math.min(1, country.stability / 82, country.happiness / 82, (country.treaties || []).length / 5, country.atWar.length ? 0 : 1)
  };
  return round(clamp(values[country.victoryPath] || 0, 0, 1) * 100, 1);
}

function initialVault(seed, code) {
  return Object.fromEntries(Object.keys(STEALABLE_ASSETS).map((id, index) => [id, 1 + Math.floor(hashFloat(`${seed}:vault:${code}:${id}:${index}`) * 2)]));
}

function theftChance(attacker, target) {
  const policeBase = target.police < 45 ? 50 : 50 - (target.police - 45) * 0.9;
  const cyberEdge = (attacker.cyber - target.cyber) * 0.15;
  const intelligence = (technologyBonuses(attacker).intelPct || 0) * 50;
  return round(clamp(policeBase + cyberEdge + intelligence, 12, 75), 1);
}

function initialCountry(meta, seed) {
  const r = hashFloat(`${seed}:${meta.code}`);
  const scale = clamp(Math.log10(meta.area + 100) / 6.5, 0.18, 0.92);
  const major = MAJOR_POWERS[meta.code];
  const population = major?.[0] || round(clamp((meta.area ** 0.48) * (0.12 + r * 0.52), 0.08, 230), 1);
  const gdp = major?.[1] || Math.round(clamp(population * (3 + r * 34), 1, 1800));
  const development = major?.[2] || Math.round(28 + scale * 35 + r * 18);
  const military = Math.round(clamp(8 + scale * 26 + r * 20 + (major ? 18 : 0), 5, 88));
  const strategic = initialStrategicEconomy(meta, seed, development);
  const victoryIds = Object.keys(VICTORY_PATHS);
  return {
    code: meta.code,
    ownerId: null,
    isBot: true,
    treasury: Math.round(45 + Math.sqrt(gdp) * 4),
    gdp,
    population,
    stability: Math.round(55 + r * 30),
    happiness: Math.round(52 + r * 28),
    influence: Math.round(development * 0.55 + military * 0.45),
    industry: Math.round(development * 0.9),
    infrastructure: Math.round(development),
    science: Math.round(development * (0.78 + r * 0.24)),
    education: Math.round(development * (0.86 + r * 0.18)),
    healthcare: Math.round(development * (0.82 + r * 0.22)),
    energy: Math.round(38 + scale * 40 + r * 15),
    cyber: Math.round(development * 0.72),
    police: Math.round(clamp(development * (0.68 + r * 0.2), 18, 86)),
    reputation: Math.round(clamp(48 + development * 0.22 + r * 20, 35, 92)),
    vault: initialVault(seed, meta.code),
    stolenItems: [],
    lastTheftTurn: null,
    lastHostileActionAt: 0,
    absorbedBy: null,
    eliminated: false,
    army: {
      manpower: Math.round(clamp(population * (0.32 + r * 0.38), 4, 520)),
      reserve: Math.round(clamp(population * (0.9 + r), 8, 999)),
      equipment: military,
      readiness: Math.round(45 + r * 35),
      air: Math.round(military * 0.72),
      navy: meta.landlocked ? 0 : Math.round(military * 0.55),
      defense: Math.round(military * 0.75),
      supplies: Math.round(68 + r * 24),
      morale: Math.round(58 + r * 28),
      experience: Math.round(8 + military * .24),
      medical: Math.round(8 + development * .16)
    },
    units: {
      infantry: round(clamp(military * .45, 3, 40), 1),
      armor: round(clamp(military * .25, 1, 28), 1),
      airWings: round(clamp(military * .18, 1, 24), 1),
      airDefense: round(clamp(military * .2, 1, 26), 1),
      fleet: meta.landlocked ? 0 : round(clamp(military * .15, 1, 22), 1)
    },
    resources: strategic.stock,
    resourceProduction: strategic.production,
    commodityStorage: Object.fromEntries(Object.keys(EXTRACTION_COMMODITIES).map((id) => [id, 0])),
    extractionSites: initialExtractionSites(meta, seed),
    commoditySales: 0,
    factions: {
      people: round(clamp(44 + r * 30, 25, 82), 1),
      business: round(clamp(42 + development * .28 + r * 18, 28, 84), 1),
      military: round(clamp(42 + military * .38 + r * 15, 30, 86), 1),
      elites: round(clamp(48 + r * 28, 30, 82), 1),
      opposition: round(clamp(28 + (70 - development) * .22 + (1 - r) * 12, 18, 58), 1)
    },
    advisors: {},
    media: { credibility: round(clamp(52 + development * .25, 45, 78), 1), propaganda: 0, warSupport: 50 },
    allianceId: null,
    intelligenceReports: [],
    lastIntelTurn: null,
    lastMediaTurn: null,
    crisisChoices: {},
    politicalCrisis: null,
    victoryPath: victoryIds[Math.floor(hashFloat(`${seed}:victory:${meta.code}`) * victoryIds.length)],
    victoryProgress: 0,
    victoryAchieved: false,
    taxRate: 24,
    focus: 'balanced',
    doctrine: 'balanced',
    warExhaustion: 0,
    treaties: [],
    sanctions: [],
    atWar: [],
    warScore: {},
    occupation: null,
    controllerCode: null,
    annexed: [],
    defeated: false,
    territoryArea: meta.area,
    techPoints: 3,
    techs: {},
    activeProject: null,
    completedProjects: [],
    pendingDecision: null,
    decisionHistory: [],
    score: 0,
    lastAction: 'Страна развивается по сбалансированной стратегии'
  };
}

function createWorld(seed = crypto.randomUUID()) {
  const countries = Object.fromEntries(CATALOG.map((meta) => [meta.code, initialCountry(meta, seed)]));
  const world = {
    seed,
    year: 2026,
    quarter: 1,
    turn: 1,
    countries,
    relations: {},
    wars: [],
    warInvites: [],
    alliances: [],
    allianceInvites: [],
    tradeOffers: [],
    tradeRoutes: [],
    commodityMarket: commodityMarketForTime(),
    globalCrisis: null,
    crisisHistory: [],
    hallOfFame: [],
    news: [{ id: crypto.randomUUID(), turn: 1, tone: 'blue', text: 'Началась новая эпоха мировой политики. Все государства выбрали осторожный курс.', createdAt: Date.now() }],
    playerNews: [],
    nextTurnAt: Date.now() + 60000
  };
  calculateScores(world);
  return world;
}

function migrateWorld(world) {
  world.relations ||= {};
  world.wars ||= [];
  world.warInvites ||= [];
  world.playerNews ||= [];
  world.alliances ||= [];
  world.allianceInvites ||= [];
  world.tradeOffers ||= [];
  world.tradeRoutes ||= [];
  world.commodityMarket ||= commodityMarketForTime();
  world.globalCrisis ??= null;
  world.crisisHistory ||= [];
  world.hallOfFame ||= [];
  for (const [index, item] of (world.news || []).entries()) item.createdAt ??= Date.now() - index * 1000;
  for (const country of Object.values(world.countries || {})) {
    const meta = CATALOG_BY_CODE[country.code];
    const strategic = initialStrategicEconomy(meta, world.seed || 'legacy', (country.industry + country.infrastructure + country.science) / 3 || 45);
    country.army ||= {};
    country.army.reserve ??= round(clamp((country.population || 1) * 1.2, 8, 999), 1);
    country.army.supplies ??= 78;
    country.army.morale ??= clamp(country.happiness || 65, 25, 90);
    country.army.experience ??= 15;
    country.army.medical ??= 12;
    country.units ||= {
      infantry: round(clamp((country.army.equipment || 20) * .45, 3, 40), 1),
      armor: round(clamp((country.army.equipment || 20) * .25, 1, 28), 1),
      airWings: round(clamp((country.army.air || 15) * .25, 1, 24), 1),
      airDefense: round(clamp((country.army.defense || 20) * .22, 1, 26), 1),
      fleet: meta?.landlocked ? 0 : round(clamp((country.army.navy || 10) * .25, 1, 22), 1)
    };
    for (const id of Object.keys(UNIT_PROGRAMS)) country.units[id] ??= id === 'fleet' && meta?.landlocked ? 0 : 1;
    country.resources ||= strategic.stock;
    country.resourceProduction ||= strategic.production;
    for (const id of Object.keys(STRATEGIC_RESOURCES)) {
      country.resources[id] ??= strategic.stock[id];
      country.resourceProduction[id] ??= strategic.production[id];
    }
    country.commodityStorage ||= {};
    for (const id of Object.keys(EXTRACTION_COMMODITIES)) country.commodityStorage[id] ??= 0;
    country.extractionSites ||= initialExtractionSites(meta, world.seed || 'legacy');
    for (const site of country.extractionSites) {
      const definition = EXTRACTION_COMMODITIES[site.type] || EXTRACTION_COMMODITIES.iron;
      site.level ??= 1; site.ownerCode ??= null; site.quality ??= 1;
      site.purchaseCost ??= definition.purchaseCost; site.baseRate ??= definition.rate; site.baseCapacity ??= definition.capacity;
      site.stored ??= 0; site.lastAccruedAt ??= Date.now(); site.lastCollectedAt ??= 0; site.producedTotal ??= 0;
      site.position ||= { u: hashFloat(`${world.seed}:legacy-site-x:${site.id}`), v: hashFloat(`${world.seed}:legacy-site-y:${site.id}`) };
      if (country.absorbedBy && site.ownerCode === country.code) site.ownerCode = country.absorbedBy;
    }
    country.commoditySales ??= 0;
    country.factions ||= { people: 58, business: 55, military: 55, elites: 58, opposition: 35 };
    for (const id of Object.keys(POLITICAL_FACTIONS)) country.factions[id] ??= id === 'opposition' ? 35 : 55;
    country.advisors ||= {};
    country.media ||= { credibility: 58, propaganda: 0, warSupport: 50 };
    country.media.credibility ??= 58; country.media.propaganda ??= 0; country.media.warSupport ??= 50;
    country.allianceId ??= null;
    country.intelligenceReports ||= [];
    country.lastIntelTurn ??= null;
    country.lastMediaTurn ??= null;
    country.crisisChoices ||= {};
    country.politicalCrisis ??= null;
    country.victoryPath ||= Object.keys(VICTORY_PATHS)[Math.floor(hashFloat(`${world.seed}:victory:${country.code}`) * Object.keys(VICTORY_PATHS).length)];
    country.victoryProgress ??= 0;
    country.victoryAchieved ??= false;
    country.doctrine ??= 'balanced';
    country.warExhaustion ??= 0;
    country.supportingWarId ??= null;
    country.atWar ||= [];
    country.warScore ||= {};
    country.occupation ??= null;
    country.controllerCode ??= null;
    country.annexed ||= [];
    country.defeated ??= false;
    country.territoryArea ??= CATALOG_BY_CODE[country.code]?.area || 1;
    country.techPoints ??= 3;
    country.techs ||= {};
    country.activeProject ??= null;
    country.completedProjects ||= [];
    country.pendingDecision ??= null;
    country.decisionHistory ||= [];
    country.police ??= Math.round(clamp(((country.infrastructure || 45) + (country.cyber || 35)) * 0.48, 18, 86));
    country.reputation ??= Math.round(clamp(((country.stability || 60) + (country.influence || 45)) * 0.55, 25, 92));
    country.vault ||= initialVault(world.seed || 'legacy', country.code);
    for (const id of Object.keys(STEALABLE_ASSETS)) country.vault[id] ??= 1;
    country.stolenItems ||= [];
    country.lastTheftTurn ??= null;
    country.lastHostileActionAt ??= 0;
    country.lastPlayerNewsAt ??= 0;
    country.absorbedBy ??= country.defeated && country.controllerCode && country.occupation?.percent >= 100 ? country.controllerCode : null;
    country.eliminated ??= Boolean(country.absorbedBy);
    if (country.occupation) {
      country.occupation.resistance ??= round(clamp(12 + country.occupation.percent * .28, 8, 70), 1);
      country.occupation.resistanceChecks ??= 0;
      country.occupation.nextResistanceAt ??= Date.now() + 12000;
      country.occupation.revolt ??= null;
    }
  }
  for (const alliance of world.alliances) {
    alliance.members ||= [alliance.founder].filter(Boolean);
    alliance.budget ??= 0;
    alliance.createdAt ??= world.turn;
    alliance.color ||= '#65d3aa';
  }
  for (const route of world.tradeRoutes) {
    route.status ||= 'active';
    route.amount ??= 4;
    route.price ??= (STRATEGIC_RESOURCES[route.resource]?.price || 5) * route.amount;
  }
  for (const war of world.wars) {
    war.supporters ||= { a: [], b: [] };
    war.supporters.a ||= []; war.supporters.b ||= [];
    war.operationsByTurn ||= {};
    war.battles ||= [];
    war.casualties ||= { a: 0, b: 0 };
    war.battleTicks ??= 0;
    war.nextBattleAt ??= Date.now() + 900;
    war.lastReportedMilestone ??= '';
    war.kind ??= 'territorial';
    war.surgeCooldowns ||= { a: 0, b: 0 };
    war.surge ??= null;
    war.weather ??= 'clear';
    war.weatherChangedAtTick ??= 0;
    war.terrain ??= theaterTerrain(war.b);
  }
  const activePairs = new Set(world.wars.filter((war) => war.status === 'active').map((war) => relationKey(war.a, war.b)));
  for (const country of Object.values(world.countries || {})) {
    for (const targetCode of country.atWar) {
      const key = relationKey(country.code, targetCode);
      if (activePairs.has(key) || !world.countries[targetCode]) continue;
      const [a, b] = key.split(':');
      world.wars.push({ id: `legacy-${key}-${world.turn}`, a, b, front: 0, status: 'active', startedAt: world.turn, operations: 0, lastOperation: null, supporters: { a: [], b: [] }, operationsByTurn: {}, battles: [], casualties: { a: 0, b: 0 } });
      activePairs.add(key);
    }
  }
  return world;
}

function relationKey(a, b) { return [a, b].sort().join(':'); }
function baseRelation(a, b) {
  const ma = CATALOG_BY_CODE[a]; const mb = CATALOG_BY_CODE[b];
  if (!ma || !mb) return 0;
  let value = ma.region === mb.region ? 12 : -2;
  if (ma.borders.includes(b) || mb.borders.includes(a)) value += 16;
  return value + Math.round((hashFloat(`relation:${relationKey(a, b)}`) - 0.5) * 22);
}
function getRelation(world, a, b) { return world.relations[relationKey(a, b)] ?? baseRelation(a, b); }
function changeRelation(world, a, b, amount) {
  world.relations[relationKey(a, b)] = clamp(getRelation(world, a, b) + amount, -100, 100);
  return world.relations[relationKey(a, b)];
}

function activeWarFor(world, a, b) {
  const key = relationKey(a, b);
  return (world.wars || []).find((war) => war.status === 'active' && relationKey(war.a, war.b) === key);
}

function occupiedFront(world, a, b) {
  const first = world.countries[a]; const second = world.countries[b];
  if (second?.occupation?.by === a) return clamp(Number(second.occupation.percent) || 0, 0, 100);
  if (first?.occupation?.by === b) return -clamp(Number(first.occupation.percent) || 0, 0, 100);
  return 0;
}

function occupationSnapshot(previous, by, percent, war) {
  const sameController = previous?.by === by;
  return {
    ...(sameController ? previous : {}),
    by,
    percent: round(percent, 1),
    permanent: false,
    warId: war.id,
    resistance: sameController ? (previous.resistance ?? 18) : round(clamp(10 + percent * .24, 8, 48), 1),
    resistanceChecks: sameController ? (previous.resistanceChecks || 0) : 0,
    nextResistanceAt: sameController ? (previous.nextResistanceAt || Date.now() + 12000) : Date.now() + 12000,
    revolt: sameController ? (previous.revolt || null) : null
  };
}

function syncWarOccupation(world, war) {
  const first = world.countries[war.a]; const second = world.countries[war.b];
  if (!first || !second) return;
  const firstOccupation = first.occupation; const secondOccupation = second.occupation;
  if (first.occupation?.by === war.b) first.occupation = null;
  if (second.occupation?.by === war.a) second.occupation = null;
  if (first.controllerCode === second.code && war.front > -100) { first.controllerCode = null; first.defeated = false; }
  if (second.controllerCode === first.code && war.front < 100) { second.controllerCode = null; second.defeated = false; }
  if (war.front > 0) second.occupation = occupationSnapshot(secondOccupation, war.a, war.front, war);
  if (war.front < 0 && war.kind !== 'uprising') first.occupation = occupationSnapshot(firstOccupation, war.b, -war.front, war);
}

function endWar(world, war, status = 'peace') {
  const first = world.countries[war.a]; const second = world.countries[war.b];
  if (!first || !second) return;
  first.atWar = first.atWar.filter((code) => code !== second.code);
  second.atWar = second.atWar.filter((code) => code !== first.code);
  war.status = status;
  war.endedAt = world.turn;
  world.warInvites = (world.warInvites || []).filter((invite) => invite.warId !== war.id);
  for (const support of [...(war.supporters?.a || []), ...(war.supporters?.b || [])]) {
    const ally = world.countries[support.code];
    if (ally?.supportingWarId === war.id) ally.supportingWarId = null;
  }
  for (const state of [first, second]) {
    if (state.occupation?.warId === war.id) state.occupation.permanent = true;
  }
}

function releaseOccupation(world, controller, subject, reason = 'released') {
  if (!controller || !subject) return;
  subject.occupation = null;
  subject.controllerCode = null;
  subject.absorbedBy = null;
  subject.eliminated = false;
  subject.defeated = false;
  subject.stability = clamp(round(subject.stability + 8, 1), 0, 100);
  subject.happiness = clamp(round(subject.happiness + 10, 1), 0, 100);
  subject.army.morale = clamp(round(subject.army.morale + 12, 1), 0, 100);
  controller.annexed = (controller.annexed || []).filter((code) => code !== subject.code);
  if (reason === 'released') {
    controller.reputation = clamp(round(controller.reputation + 6, 1), 0, 100);
    controller.influence = clamp(round(controller.influence + 3, 1), 0, 100);
    changeRelation(world, controller.code, subject.code, 28);
  }
}

function annexCountry(world, war, winner, loser) {
  war.front = winner.code === war.a ? 100 : -100;
  syncWarOccupation(world, war);
  const firstAnnexation = loser.controllerCode !== winner.code;
  const loot = firstAnnexation ? round(Math.min(loser.treasury, loser.treasury * .45), 1) : 0;
  loser.treasury = round(loser.treasury - loot, 1);
  winner.treasury = round(winner.treasury + loot, 1);
  const absorbedEconomy = firstAnnexation ? round(loser.gdp * .12, 1) : 0;
  winner.gdp = round(winner.gdp + absorbedEconomy, 1);
  if (firstAnnexation) loser.gdp = round(Math.max(1, loser.gdp * .72), 1);
  loser.controllerCode = winner.code;
  loser.defeated = true;
  loser.absorbedBy = winner.code;
  loser.eliminated = true;
  loser.occupation = {
    by: winner.code, percent: 100, permanent: true, absorbed: true, warId: war.id,
    resistance: 0, resistanceChecks: 0, nextResistanceAt: 0, revolt: null
  };
  winner.commodityStorage ||= {};
  for (const [type, amount] of Object.entries(loser.commodityStorage || {})) {
    winner.commodityStorage[type] = round((winner.commodityStorage[type] || 0) + (Number(amount) || 0), 3);
    loser.commodityStorage[type] = 0;
  }
  for (const site of loser.extractionSites || []) if (site.ownerCode === loser.code) site.ownerCode = winner.code;
  if (!winner.annexed.includes(loser.code)) winner.annexed.push(loser.code);
  for (const territory of Object.values(world.countries)) {
    if (territory.code === loser.code) continue;
    if (territory.absorbedBy === loser.code) {
      territory.absorbedBy = winner.code;
      territory.controllerCode = winner.code;
      if (territory.occupation) territory.occupation.by = winner.code;
      for (const site of territory.extractionSites || []) if (site.ownerCode === loser.code) site.ownerCode = winner.code;
      if (!winner.annexed.includes(territory.code)) winner.annexed.push(territory.code);
    } else if (territory.occupation?.by === loser.code) {
      territory.occupation.by = winner.code;
      territory.occupation.resistance = clamp(round((territory.occupation.resistance || 20) + 12, 1), 0, 100);
      territory.occupation.nextResistanceAt = Date.now() + 8000;
    }
  }
  winner.influence = clamp(winner.influence + 10, 0, 100);
  loser.stability = clamp(loser.stability - 18, 0, 100);
  endWar(world, war, 'annexed');
  const winnerMeta = CATALOG_BY_CODE[winner.code]; const loserMeta = CATALOG_BY_CODE[loser.code];
  pushNews(world, `${winnerMeta.name} завершает захват государства ${loserMeta.name}: присоединена вся территория и получено ${loot} млрд трофеев.`, 'red');
  return loot;
}

function warSideFor(war, code) {
  if (war.a === code || war.supporters?.a?.some((support) => support.code === code)) return 'a';
  if (war.b === code || war.supporters?.b?.some((support) => support.code === code)) return 'b';
  return null;
}

function supportCost(country) {
  return Math.round(clamp(70 + militaryPower(country) * .55, 80, 260));
}

function countryBusyInWar(world, code) {
  return (world.wars || []).some((war) => war.status === 'active' && Boolean(warSideFor(war, code)));
}

function joinWarSupport(world, war, side, caller, ally, cost) {
  if (countryBusyInWar(world, ally.code)) return { ok: false, error: 'Эта страна уже участвует в другой войне' };
  if (!spend(caller, cost)) return { ok: false, error: `Для военной помощи нужно ${cost} млрд` };
  const relation = getRelation(world, caller.code, ally.code);
  const contribution = round(clamp(.38 + relation / 400, .4, .64), 2);
  ally.treasury = round(ally.treasury + cost * .65, 1);
  ally.supportingWarId = war.id;
  war.supporters[side].push({ code: ally.code, contribution, paid: cost, joinedAt: world.turn });
  changeRelation(world, caller.code, ally.code, 6);
  ally.army.morale = clamp(ally.army.morale + 3, 0, 100);
  const callerMeta = CATALOG_BY_CODE[caller.code]; const allyMeta = CATALOG_BY_CODE[ally.code];
  const enemyCode = side === 'a' ? war.b : war.a;
  pushNews(world, `${allyMeta.name} вступает в коалицию государства ${callerMeta.name} против ${CATALOG_BY_CODE[enemyCode].name}. Военный контракт: ${cost} млрд.`, 'gold');
  return { ok: true, toast: `Государство ${allyMeta.name} вступило в коалицию · сила участия ${Math.round(contribution * 100)}%` };
}

function handleWarSupport(world, country, message) {
  if (message.id === 'accept' || message.id === 'decline') {
    const invite = world.warInvites.find((item) => item.id === message.inviteId && item.to === country.code && item.status === 'pending');
    if (!invite) return { ok: false, error: 'Это приглашение уже неактуально' };
    const war = world.wars.find((item) => item.id === invite.warId && item.status === 'active');
    if (!war) { world.warInvites = world.warInvites.filter((item) => item.id !== invite.id); return { ok: false, error: 'Война уже завершена' }; }
    if (message.id === 'decline') {
      world.warInvites = world.warInvites.filter((item) => item.id !== invite.id);
      changeRelation(world, invite.from, country.code, -4);
      return { ok: true, toast: 'Военная помощь отклонена' };
    }
    const caller = world.countries[invite.from];
    if (!caller) return { ok: false, error: 'Инициатор коалиции больше недоступен' };
    const joined = joinWarSupport(world, war, invite.side, caller, country, invite.cost);
    if (joined.ok) world.warInvites = world.warInvites.filter((item) => item.id !== invite.id);
    return joined;
  }
  if (message.id === 'withdraw') {
    const war = world.wars.find((item) => item.status === 'active' && warSideFor(item, country.code));
    const side = war && warSideFor(war, country.code);
    if (!war || !side || war[side] === country.code) return { ok: false, error: 'Страна не является союзником коалиции' };
    war.supporters[side] = war.supporters[side].filter((support) => support.code !== country.code);
    country.supportingWarId = null;
    changeRelation(world, country.code, war[side], -10);
    return { ok: true, toast: 'Экспедиционный корпус отозван' };
  }
  if (message.id !== 'invite') return { ok: false, error: 'Неизвестное коалиционное действие' };
  const enemyCode = country.atWar[0]; const war = enemyCode && activeWarFor(world, country.code, enemyCode);
  if (!war) return { ok: false, error: 'Сначала вступите в войну' };
  const side = country.code === war.a ? 'a' : country.code === war.b ? 'b' : null;
  if (!side) return { ok: false, error: 'Союзников приглашает основная сторона войны' };
  const ally = world.countries[message.target];
  if (!ally || ally.code === country.code || ally.code === enemyCode) return { ok: false, error: 'Выберите третью страну для помощи' };
  if (war.supporters[side].length >= 3) return { ok: false, error: 'В коалиции уже максимальные три союзника' };
  if (countryBusyInWar(world, ally.code)) return { ok: false, error: 'Эта страна уже участвует в другой войне' };
  const relation = getRelation(world, country.code, ally.code);
  if (relation < 35) return { ok: false, error: 'Для приглашения в войну нужно доверие не ниже +35' };
  const cost = supportCost(ally);
  if (country.treasury < cost) return { ok: false, error: `Военный контракт требует ${cost} млрд` };
  if (ally.isBot) {
    const willingness = relation + hashFloat(`${world.seed}:coalition:${world.turn}:${country.code}:${ally.code}`) * 35;
    if (relation < 55 && willingness < 67) {
      changeRelation(world, country.code, ally.code, -2);
      return { ok: true, toast: `Государство ${CATALOG_BY_CODE[ally.code].name} отказалось вступать в войну` };
    }
    return joinWarSupport(world, war, side, country, ally, cost);
  }
  if (world.warInvites.some((invite) => invite.status === 'pending' && invite.warId === war.id && invite.to === ally.code)) return { ok: false, error: 'Приглашение уже отправлено' };
  world.warInvites.push({ id: crypto.randomUUID(), warId: war.id, from: country.code, to: ally.code, side, cost, createdAt: world.turn, status: 'pending' });
  pushNews(world, `${CATALOG_BY_CODE[country.code].name} предлагает государству ${CATALOG_BY_CODE[ally.code].name} военный контракт на ${cost} млрд.`, 'blue');
  return { ok: true, toast: `Игроку отправлено предложение на ${cost} млрд` };
}

function coalitionMembers(world, war, side, main, mainFraction) {
  const members = [{ country: main, fraction: mainFraction, role: 'main' }];
  for (const support of war.supporters?.[side] || []) {
    const ally = world.countries[support.code];
    if (ally) members.push({ country: ally, fraction: clamp(support.contribution || .45, .25, .7), role: 'ally' });
  }
  return members;
}

function doctrineFor(country) { return MILITARY_DOCTRINES[country.doctrine] || MILITARY_DOCTRINES.balanced; }

function memberCombatPower(member, attacking) {
  const country = member.country; const tech = technologyBonuses(country); const doctrine = doctrineFor(country);
  const exhaustion = 1 - clamp(country.warExhaustion / 180, 0, .42);
  const roleCoordination = member.role === 'ally' ? .9 : 1;
  const mode = attacking ? doctrine.attack : doctrine.defense;
  const technology = 1 + (attacking ? (tech.attackPct || 0) : (tech.defensePct || 0));
  const formations = attacking
    ? 1 + clamp((country.units.armor || 0) * .0025 + (country.units.airWings || 0) * .0022, 0, .24)
    : 1 + clamp((country.units.infantry || 0) * .0015 + (country.units.airDefense || 0) * .0028, 0, .22);
  return militaryPower(country) * member.fraction * mode * technology * formations * exhaustion * roleCoordination;
}

function coalitionSummary(members, attacking) {
  return {
    troops: round(members.reduce((sum, member) => sum + member.country.army.manpower * member.fraction, 0), 1),
    power: round(members.reduce((sum, member) => sum + memberCombatPower(member, attacking), 0), 1),
    allies: members.filter((member) => member.role === 'ally').map((member) => member.country.code)
  };
}

function applyCoalitionLosses(members, totalLosses, equipmentLoss, supplyUse, moraleDelta, experienceGain) {
  const totalCommitted = Math.max(.1, members.reduce((sum, member) => sum + member.country.army.manpower * member.fraction, 0));
  let actualLosses = 0;
  for (const member of members) {
    const country = member.country; const committed = country.army.manpower * member.fraction;
    const share = committed / totalCommitted; const tech = technologyBonuses(country);
    const medicalSave = clamp((country.army.medical || 0) / 300, 0, .28);
    const saved = clamp((tech.manpowerSave || 0) + medicalSave + (advisorBonuses(country).casualtyReduction || 0), 0, .7);
    const losses = Math.min(country.army.manpower, totalLosses * share * (1 - saved));
    actualLosses += losses;
    country.army.manpower = clamp(round(country.army.manpower - losses, 1), 0, 999);
    country.army.equipment = clamp(round(country.army.equipment - equipmentLoss * share, 1), 0, 100);
    const memberSupplyUse = member.role === 'main' ? supplyUse : supplyUse * Math.max(.35, member.fraction);
    country.army.supplies = clamp(round(country.army.supplies - memberSupplyUse, 1), 0, 100);
    country.resources.fuel = clamp(round(country.resources.fuel - memberSupplyUse * .16, 1), 0, 150);
    country.resources.food = clamp(round(country.resources.food - memberSupplyUse * .08, 1), 0, 150);
    country.army.morale = clamp(round(country.army.morale + moraleDelta, 1), 0, 100);
    country.army.experience = clamp(round(country.army.experience + experienceGain, 1), 0, 100);
    country.army.readiness = clamp(round(country.army.readiness - Math.max(1, supplyUse * .2), 1), 0, 100);
  }
  return round(actualLosses, 1);
}

function theaterTerrain(code) {
  const meta = CATALOG_BY_CODE[code];
  const mountains = new Set(['AFG','ARM','AUT','BTN','CHE','CHL','COL','ECU','ETH','GEO','KGZ','LBN','NPL','PAK','PER','TJK']);
  const deserts = new Set(['DZA','EGY','IRQ','IRN','JOR','KWT','LBY','MAR','MRT','NAM','OMN','QAT','SAU','ARE','YEM']);
  const jungles = new Set(['BRA','COD','COG','COL','ECU','GAB','IDN','MYS','PNG','PER','VEN']);
  if (mountains.has(code)) return 'mountains';
  if (deserts.has(code)) return 'desert';
  if (jungles.has(code)) return 'jungle';
  if (Math.abs(meta?.latlng?.[0] || 0) > 58) return 'arctic';
  if (!meta?.landlocked && (meta?.area || 0) < 500000) return 'coast';
  return 'plains';
}

function frontDistanceFactor(attacker, defender) {
  const attackerMeta = CATALOG_BY_CODE[attacker.code]; const defenderMeta = CATALOG_BY_CODE[defender.code];
  const isNeighbor = attackerMeta.borders.includes(defender.code) || defenderMeta.borders.includes(attacker.code);
  return isNeighbor ? 1 : attackerMeta.region === defenderMeta.region ? .88 : clamp(.68 + (attacker.army.air + attacker.army.navy) / 700, .68, .9);
}

function automaticCoalition(world, war, side) {
  const country = world.countries[war[side]];
  const enemy = world.countries[war[side === 'a' ? 'b' : 'a']];
  const members = coalitionMembers(world, war, side, country, .78);
  const offense = coalitionSummary(members, true); const defense = coalitionSummary(members, false);
  const supplyCondition = .58 + clamp(country.army.supplies, 0, 100) / 238;
  const moraleCondition = .72 + clamp(country.army.morale, 0, 100) / 360;
  const distance = frontDistanceFactor(country, enemy);
  let power = Math.sqrt(Math.max(1, offense.power) * Math.max(1, defense.power)) * supplyCondition * moraleCondition * distance;
  if (side === 'a' && war.front > 0) power *= 1 - clamp(war.front / 430, 0, .24);
  if (side === 'b' && war.front < 0) power *= 1 - clamp(-war.front / 430, 0, .24);
  if (side === 'a' && war.front < 0) power *= 1 + clamp(-war.front / 620, 0, .16);
  if (side === 'b' && war.front > 0) power *= 1 + clamp(war.front / 620, 0, .16);
  if (war.surge?.side === side && (war.surge.expiresAtTick || 0) >= (war.battleTicks || 0)) power *= war.surge.multiplier || 1.65;
  if (war.kind === 'uprising' && side === 'b') power *= 1.12;
  return { country, enemy, members, offense, defense, power, distance };
}

function resolveWarTick(world, war, now = Date.now()) {
  if (!war || war.status !== 'active' || now < (war.nextBattleAt || 0)) return null;
  const first = world.countries[war.a]; const second = world.countries[war.b];
  if (!first || !second) return null;
  war.kind ||= 'territorial'; war.surgeCooldowns ||= { a: 0, b: 0 }; war.weather ||= 'clear'; war.terrain ||= theaterTerrain(war.b);
  war.nextBattleAt = now + WAR_TICK_MS;
  war.battleTicks = (war.battleTicks || 0) + 1;
  if (!WAR_WEATHER[war.weather]) war.weather = 'clear';
  if (war.battleTicks - (war.weatherChangedAtTick || 0) >= 12) {
    const weatherIds = Object.keys(WAR_WEATHER);
    war.weather = weatherIds[Math.floor(hashFloat(`${world.seed}:weather:${war.id}:${war.battleTicks}`) * weatherIds.length)];
    war.weatherChangedAtTick = war.battleTicks;
    pushNews(world, `${WAR_WEATHER[war.weather].icon} На фронте ${CATALOG_BY_CODE[war.a].name} — ${CATALOG_BY_CODE[war.b].name} меняется погода: ${WAR_WEATHER[war.weather].name.toLowerCase()}.`, 'blue');
  }
  if (war.surge && war.battleTicks > (war.surge.expiresAtTick || 0)) war.surge = null;
  const pressuredSide = war.front >= 10 ? 'b' : war.front <= -10 ? 'a' : null;
  if (pressuredSide) {
    const pressured = world.countries[war[pressuredSide]];
    const botRoll = hashFloat(`${world.seed}:bot-surge:${war.id}:${war.battleTicks}`);
    if (pressured?.isBot && !war.surge && now >= (war.surgeCooldowns?.[pressuredSide] || 0) && pressured.army.supplies >= 15 && botRoll < .075) {
      pressured.army.supplies = round(pressured.army.supplies - 15, 1);
      pressured.army.morale = clamp(round(pressured.army.morale + 8, 1), 0, 100);
      war.surge = { side: pressuredSide, startedAtTick: war.battleTicks, expiresAtTick: war.battleTicks + 6, multiplier: 1.68 };
      war.surgeCooldowns[pressuredSide] = now + 60000;
      pushNews(world, `${CATALOG_BY_CODE[pressured.code].name} бросает стратегические резервы в контрнаступление и пытается отбить захваченные земли.`, 'gold');
    }
  }
  const a = automaticCoalition(world, war, 'a'); const b = automaticCoalition(world, war, 'b');
  const weather = WAR_WEATHER[war.weather] || WAR_WEATHER.clear;
  const terrain = WAR_TERRAINS[war.terrain] || WAR_TERRAINS.plains;
  a.power *= weather.power * terrain.attack; b.power *= weather.power * terrain.defense;
  const variation = .97 + hashFloat(`${world.seed}:live-front:${war.id}:${war.battleTicks}`) * .06;
  const ratio = Math.max(.03, a.power * variation / Math.max(1, b.power));
  const pressure = Math.log2(ratio);
  let winningSide;
  if (Math.abs(pressure) < .025) winningSide = hashFloat(`${world.seed}:stalemate:${war.id}:${war.battleTicks}`) >= .5 ? 'a' : 'b';
  else winningSide = pressure > 0 ? 'a' : 'b';
  const troopRatio = a.offense.troops / Math.max(.1, b.offense.troops);
  const winner = winningSide === 'a' ? a : b; const loser = winningSide === 'a' ? b : a;
  const winningTech = technologyBonuses(winner.country); const winningDoctrine = doctrineFor(winner.country);
  const captureMultiplier = (1 + (winningTech.capturePct || 0)) * (winningDoctrine.capture || 1);
  const breakthrough = hashFloat(`${world.seed}:breakthrough:${war.id}:${war.battleTicks}`) > .94 ? 1.45 : 1;
  const terrainCapture = winningSide === 'a' ? terrain.capture : clamp(2 - terrain.capture, .8, 1.3);
  const movement = round(clamp((.14 + Math.abs(pressure) * .92 + Math.abs(Math.log2(Math.max(.05, troopRatio))) * .12) * captureMultiplier * weather.capture * terrainCapture * breakthrough, .1, 2.65), 1);
  const previousFront = war.front;
  war.front = round(clamp(war.front + (winningSide === 'a' ? movement : -movement), -100, 100), 1);
  if (war.kind === 'uprising') war.front = Math.max(0, war.front);

  const intensity = .0011 + clamp(Math.abs(pressure) * .00045, 0, .0012);
  const aLossPool = Math.max(.02, a.offense.troops * intensity * clamp(b.power / Math.max(1, a.power), .62, 1.9));
  const bLossPool = Math.max(.02, b.offense.troops * intensity * clamp(a.power / Math.max(1, b.power), .62, 1.9));
  const aLosses = applyCoalitionLosses(a.members, aLossPool, .045, .11 * weather.supply * terrain.supply, winningSide === 'a' ? .12 : -.18, .08);
  const bLosses = applyCoalitionLosses(b.members, bLossPool, .045, .11 * weather.supply * terrain.supply, winningSide === 'b' ? .12 : -.18, .08);
  first.warExhaustion = clamp(round(first.warExhaustion + .08 + aLosses * .08, 1), 0, 100);
  second.warExhaustion = clamp(round(second.warExhaustion + .08 + bLosses * .08, 1), 0, 100);
  syncWarOccupation(world, war);

  const attacker = winner.country; const defender = loser.country;
  const priorHeld = winningSide === 'a' ? Math.max(0, previousFront) : Math.max(0, -previousFront);
  const nowHeld = defender.occupation?.by === attacker.code ? defender.occupation.percent : 0;
  const newlyCaptured = Math.max(0, nowHeld - priorHeld);
  const loot = newlyCaptured > 0 ? round(Math.min(.8, defender.treasury, defender.treasury * newlyCaptured / 520), 1) : 0;
  if (loot > 0) { defender.treasury = round(defender.treasury - loot, 1); attacker.treasury = round(attacker.treasury + loot, 1); }
  first.warScore[second.code] = round(war.front, 1); second.warScore[first.code] = round(-war.front, 1);
  war.casualties.a = round((war.casualties.a || 0) + aLosses, 1); war.casualties.b = round((war.casualties.b || 0) + bLosses, 1);
  const battle = {
    id: crypto.randomUUID(), automatic: true, timestamp: now, attacker: attacker.code, defender: defender.code,
    tactic: 'live', tacticName: breakthrough > 1 ? 'Прорыв фронта' : war.surge?.side === winningSide ? 'Контрнаступление' : 'Непрерывный фронт', deployment: 78, movement, won: true, loot, turn: world.turn,
    attackerTroops: winner.offense.troops, defenderTroops: loser.offense.troops,
    attackerPower: round(winner.power, 1), defenderPower: round(loser.power, 1),
    attackerLosses: winningSide === 'a' ? aLosses : bLosses, defenderLosses: winningSide === 'a' ? bLosses : aLosses,
    attackerAllies: winner.offense.allies, defenderAllies: loser.offense.allies,
    supplyUsed: round(.11 * weather.supply * terrain.supply, 2), distancePenalty: round((1 - winner.distance) * 100), weather: war.weather, terrain: war.terrain
  };
  war.lastOperation = battle;
  war.battles.push(battle); war.battles = war.battles.slice(-16);
  first.lastAction = `Непрерывные бои на фронте против ${CATALOG_BY_CODE[second.code].name}`;
  second.lastAction = `Непрерывные бои на фронте против ${CATALOG_BY_CODE[first.code].name}`;

  const milestone = String(Math.trunc(war.front / 10));
  if (milestone !== war.lastReportedMilestone && Math.abs(war.front) >= 10) {
    war.lastReportedMilestone = milestone;
    pushNews(world, `${CATALOG_BY_CODE[attacker.code].name} продвигает живой фронт: под контролем ${Math.abs(war.front)}% территории государства ${CATALOG_BY_CODE[defender.code].name}. Потери сторон: ${war.casualties.a}/${war.casualties.b} тыс.`, 'red');
  }
  if (war.kind === 'uprising' && war.front <= 0) {
    const controller = first; const subject = second;
    endWar(world, war, 'liberated');
    releaseOccupation(world, controller, subject, 'revolt');
    pushNews(world, `${CATALOG_BY_CODE[subject.code].name} побеждает в восстании, возвращает всю занятую землю и снова становится полностью независимым государством.`, 'gold');
  } else if (war.kind === 'uprising' && war.front >= (war.suppressionTarget || 100)) {
    endWar(world, war, 'suppressed');
    if (second.occupation?.by === first.code) {
      second.occupation.permanent = true;
      second.occupation.resistance = 18;
      second.occupation.resistanceChecks = 0;
      second.occupation.nextResistanceAt = now + 30000;
      second.occupation.revolt = null;
    }
    first.reputation = clamp(round(first.reputation - 5, 1), 0, 100);
    second.stability = clamp(round(second.stability - 7, 1), 0, 100);
    pushNews(world, `${CATALOG_BY_CODE[first.code].name} подавляет восстание в государстве ${CATALOG_BY_CODE[second.code].name}. Оккупационный режим сохранён, но репутация контролёра падает.`, 'red');
  } else if (war.kind !== 'uprising' && Math.abs(war.front) >= 100) {
    const annexWinner = war.front > 0 ? first : second; const annexLoser = war.front > 0 ? second : first;
    annexCountry(world, war, annexWinner, annexLoser);
  }
  const codes = new Set([war.a, war.b, ...(war.supporters?.a || []).map((item) => item.code), ...(war.supporters?.b || []).map((item) => item.code)]);
  return { warId: war.id, countries: [...codes], ended: war.status !== 'active' };
}

function advanceWars(world, now = Date.now()) {
  migrateWorld(world);
  const results = [];
  for (const war of world.wars) {
    const result = resolveWarTick(world, war, now);
    if (result) results.push(result);
  }
  if (!results.length) return { changed: false, wars: [], countries: [], ended: false };
  calculateScores(world);
  return {
    changed: true,
    wars: [...new Set(results.map((result) => result.warId))],
    countries: [...new Set(results.flatMap((result) => result.countries))],
    ended: results.some((result) => result.ended)
  };
}

function startUprisingWar(world, controller, subject, now = Date.now()) {
  const occupation = subject.occupation;
  if (!occupation || occupation.by !== controller.code || !occupation.permanent) return { ok: false, error: 'Нет закреплённой оккупации для подавления' };
  if (activeWarFor(world, controller.code, subject.code)) return { ok: false, error: 'Бои с этой страной уже идут' };
  if (countryBusyInWar(world, controller.code) || countryBusyInWar(world, subject.code)) return { ok: false, error: 'Одна из стран уже занята другой войной' };
  const front = clamp(Number(occupation.percent) || 0, 1, 99);
  controller.atWar.push(subject.code); subject.atWar.push(controller.code);
  subject.eliminated = false; subject.absorbedBy = null; subject.defeated = false;
  const reinforcement = Math.min(subject.army.reserve, Math.max(8, subject.population * .18));
  subject.army.reserve = round(subject.army.reserve - reinforcement, 1);
  subject.army.manpower = clamp(round(subject.army.manpower + reinforcement, 1), 0, 999);
  subject.army.morale = clamp(round(subject.army.morale + 16, 1), 0, 100);
  subject.army.readiness = clamp(round(subject.army.readiness + 12, 1), 0, 100);
  const war = {
    id: crypto.randomUUID(), kind: 'uprising', a: controller.code, b: subject.code, front, status: 'active',
    suppressionTarget: round(Math.min(99, front + clamp(16 + occupation.resistance * .16, 18, 30)), 1),
    startedAt: world.turn, startedAtMs: now, nextBattleAt: now + 900, battleTicks: 0, lastReportedMilestone: '',
    operations: 0, lastOperation: null, supporters: { a: [], b: [] }, operationsByTurn: {}, battles: [], casualties: { a: 0, b: 0 },
    surgeCooldowns: { a: 0, b: 0 }, surge: null, weather: 'clear', weatherChangedAtTick: 0, terrain: theaterTerrain(subject.code)
  };
  occupation.permanent = false; occupation.warId = war.id;
  occupation.revolt = { ...(occupation.revolt || {}), status: 'fighting', warId: war.id, startedAt: now };
  world.wars.push(war);
  controller.warScore[subject.code] = front; subject.warScore[controller.code] = -front;
  pushNews(world, `${CATALOG_BY_CODE[subject.code].name} поднимает вооружённое восстание. Повстанцы пытаются отвоевать ${front}% занятой территории у государства ${CATALOG_BY_CODE[controller.code].name}.`, 'red');
  return { ok: true, toast: 'Началась автоматическая операция по подавлению восстания' };
}

function advanceResistance(world, now = Date.now()) {
  migrateWorld(world);
  const changed = new Set();
  for (const subject of Object.values(world.countries)) {
    const occupation = subject.occupation;
    const controller = occupation && world.countries[occupation.by];
    if (!occupation?.permanent || occupation.absorbed || subject.eliminated || !controller || occupation.percent <= 0 || occupation.percent >= 100) continue;
    if (occupation.revolt?.status === 'active') {
      if (controller.isBot && now - (occupation.revolt.startedAt || now) >= 6000) {
        const release = controller.army.supplies < 12 || controller.stability < 38 || controller.reputation > 74;
        if (release) {
          releaseOccupation(world, controller, subject, 'released');
          pushNews(world, `${CATALOG_BY_CODE[controller.code].name} не идёт на эскалацию и возвращает независимость государству ${CATALOG_BY_CODE[subject.code].name}.`, 'green');
        } else {
          startUprisingWar(world, controller, subject, now);
        }
        changed.add(controller.code); changed.add(subject.code);
      }
      continue;
    }
    if (now < (occupation.nextResistanceAt || 0)) continue;
    occupation.resistanceChecks = (occupation.resistanceChecks || 0) + 1;
    occupation.nextResistanceAt = now + 12000 + Math.floor(hashFloat(`${world.seed}:resistance-delay:${subject.code}:${occupation.resistanceChecks}`) * 6000);
    const localAnger = (100 - subject.happiness) * .022 + (100 - subject.stability) * .026;
    const occupationPressure = occupation.percent * .025;
    const policing = controller.police * .018 + controller.reputation * .006;
    const growth = clamp(.35 + localAnger + occupationPressure - policing, .15, 4.2);
    occupation.resistance = round(clamp((occupation.resistance || 10) + growth, 0, 100), 1);
    changed.add(subject.code);
    const roll = hashFloat(`${world.seed}:resistance:${subject.code}:${occupation.by}:${occupation.resistanceChecks}`) * 100;
    const protestChance = clamp((occupation.resistance - 32) * 1.25 + occupation.percent * .08, 0, 78);
    if (roll <= protestChance) {
      subject.stability = clamp(round(subject.stability - 1.2, 1), 0, 100);
      controller.reputation = clamp(round(controller.reputation - .8, 1), 0, 100);
      controller.influence = clamp(round(controller.influence - .4, 1), 0, 100);
      occupation.lastProtestAt = now;
      changed.add(controller.code);
      if (occupation.resistance >= 58 && roll <= clamp((occupation.resistance - 50) * 2.2, 8, 62)) {
        occupation.revolt = { status: 'active', startedAt: now, ultimatumUntil: now + 45000 };
        pushNews(world, `${CATALOG_BY_CODE[subject.code].name}: протесты перерастают в национальное восстание. ${CATALOG_BY_CODE[controller.code].name} должно отпустить страну или подавить мятеж войсками.`, 'gold');
      } else {
        pushNews(world, `${CATALOG_BY_CODE[subject.code].name}: жители протестуют против контроля государства ${CATALOG_BY_CODE[controller.code].name}. Сопротивление — ${occupation.resistance}%.`, 'blue');
      }
    }
  }
  if (!changed.size) return { changed: false, countries: [], wars: [], ended: false };
  calculateScores(world);
  return { changed: true, countries: [...changed], wars: world.wars.filter((war) => war.status === 'active' && [...changed].some((code) => war.a === code || war.b === code)).map((war) => war.id), ended: false };
}

function hostileCooldownRemaining(country, now = Date.now()) {
  return Math.max(0, HOSTILE_COOLDOWN_MS - (now - (country.lastHostileActionAt || 0)));
}

function requireHostileCooldown(country, now = Date.now()) {
  const remaining = hostileCooldownRemaining(country, now);
  return remaining > 0 ? { ok: false, error: `Следующую враждебную акцию можно провести через ${Math.ceil(remaining / 1000)} сек.` } : null;
}

function resolveAttack(world, attacker, defender, deploymentValue = 60, tacticId = 'standard') {
  const war = activeWarFor(world, attacker.code, defender.code);
  if (!war) return { ok: false, error: 'Активный фронт не найден' };
  const side = attacker.code === war.a ? 'a' : attacker.code === war.b ? 'b' : null;
  if (!side) return { ok: false, error: 'Наступление может начать только основная сторона войны' };
  const operationKey = `${world.turn}:${side}`;
  if ((war.operationsByTurn[operationKey] || 0) >= 2) return { ok: false, error: 'Лимит: две крупные операции стороны за квартал' };
  const tactic = BATTLE_TACTICS[tacticId] || BATTLE_TACTICS.standard;
  const deployment = clamp(Number(deploymentValue) || 60, 10, 100) / 100;
  if (deployment * 100 < tactic.minDeployment) return { ok: false, error: `Для тактики «${tactic.name}» нужно задействовать минимум ${tactic.minDeployment}% армии` };
  if (tactic.requires && !attacker.techs?.[tactic.requires]) return { ok: false, error: 'Для окружения изучите «Общевойсковую доктрину»' };
  const attackerTech = technologyBonuses(attacker);
  const attackerDoctrine = doctrineFor(attacker); const defenderDoctrine = doctrineFor(defender);
  const supplyNeeded = round((4 + deployment * 10) * tactic.supply * (attackerDoctrine.supply || 1) * (1 - (attackerTech.supplyUsePct || 0)), 1);
  if (attacker.army.supplies < supplyNeeded) return { ok: false, error: `Не хватает снабжения: нужно ${supplyNeeded}, доступно ${attacker.army.supplies}` };
  if (attacker.army.manpower < 1) return { ok: false, error: 'Армия утратила боеспособность — пополните личный состав' };
  const defenderSide = side === 'a' ? 'b' : 'a';
  const attackers = coalitionMembers(world, war, side, attacker, deployment);
  const defenders = coalitionMembers(world, war, defenderSide, defender, .92);
  const attackCoalition = coalitionSummary(attackers, true); const defenseCoalition = coalitionSummary(defenders, false);
  const attackerMeta = CATALOG_BY_CODE[attacker.code]; const defenderMeta = CATALOG_BY_CODE[defender.code];
  const isNeighbor = attackerMeta.borders.includes(defender.code) || defenderMeta.borders.includes(attacker.code);
  const distanceFactor = isNeighbor ? 1 : attackerMeta.region === defenderMeta.region ? .88 : clamp(.68 + (attacker.army.air + attacker.army.navy) / 700, .68, .9);
  const occupiedSupply = defender.occupation?.by === attacker.code ? 1 - clamp(defender.occupation.percent / 250, 0, .35) : 1;
  war.operations = (war.operations || 0) + 1;
  war.operationsByTurn[operationKey] = (war.operationsByTurn[operationKey] || 0) + 1;
  const tacticalVariation = .99 + hashFloat(`${world.seed}:battle:${world.turn}:${war.operations}:${attacker.code}:${defender.code}`) * .02;
  const troopFactor = clamp(Math.pow(Math.max(.05, attackCoalition.troops / Math.max(.1, defenseCoalition.troops)), .22), .68, 1.35);
  const attackerPower = attackCoalition.power * tactic.attack * distanceFactor * tacticalVariation * troopFactor;
  const defenderPower = defenseCoalition.power * occupiedSupply;
  const ratio = attackerPower / Math.max(1, defenderPower);
  const troopRatio = attackCoalition.troops / Math.max(.1, defenseCoalition.troops);
  const won = ratio >= 1;
  const captureBonus = (1 + (attackerTech.capturePct || 0)) * tactic.capture * (attackerDoctrine.capture || 1);
  const advance = won ? clamp(((ratio - .78) * 9 + Math.max(0, Math.log2(Math.max(1, troopRatio))) * 2.5 + deployment * 5) * captureBonus, .6, 26) : 0;
  const retreat = won ? 0 : clamp((1.08 - ratio) * 9 + Math.max(0, Math.log2(Math.max(1, 1 / troopRatio))) * 2, .6, 8);
  const direction = attacker.code === war.a ? 1 : -1;
  const previousFront = war.front;
  war.front = round(clamp(war.front + direction * (won ? advance : -retreat), -100, 100), 1);

  const attackerLossPool = Math.max(.2, attackCoalition.troops * (won ? .018 : .052) * tactic.casualties * (attackerDoctrine.casualties || 1));
  const defenderLossPool = Math.max(.2, defenseCoalition.troops * (won ? .052 : .019) * (tactic.enemyCasualties || 1) * (defenderDoctrine.casualties || 1));
  const attackerLosses = applyCoalitionLosses(attackers, attackerLossPool, won ? 1.1 : 2.1, supplyNeeded, won ? 3 : -5, won ? 2.2 : 1.1);
  const defenderLosses = applyCoalitionLosses(defenders, defenderLossPool, won ? 2.2 : 1, 3.5, won ? -6 : 3, won ? 1.2 : 2);
  attacker.warExhaustion = clamp(round(attacker.warExhaustion + 1.5 + attackerLosses * .35, 1), 0, 100);
  defender.warExhaustion = clamp(round(defender.warExhaustion + 1 + defenderLosses * .3, 1), 0, 100);
  if (won) {
    defender.stability = clamp(defender.stability - 3, 0, 100);
    attacker.influence = clamp(attacker.influence + 2, 0, 100);
  } else {
    attacker.stability = clamp(attacker.stability - 2, 0, 100);
    defender.influence = clamp(defender.influence + 1, 0, 100);
  }
  syncWarOccupation(world, war);
  const priorHeld = attacker.code === war.a ? Math.max(0, previousFront) : Math.max(0, -previousFront);
  const nowHeld = defender.occupation?.by === attacker.code ? defender.occupation.percent : 0;
  const newlyCaptured = Math.max(0, nowHeld - priorHeld);
  const loot = newlyCaptured > 0 ? round(Math.min(12, defender.treasury, defender.treasury * Math.min(.06, newlyCaptured / 250)), 1) : 0;
  if (loot > 0) { defender.treasury = round(defender.treasury - loot, 1); attacker.treasury = round(attacker.treasury + loot, 1); }
  attacker.warScore[defender.code] = round(attacker.code === war.a ? war.front : -war.front, 1);
  defender.warScore[attacker.code] = -attacker.warScore[defender.code];
  war.casualties[side] = round((war.casualties[side] || 0) + attackerLosses, 1);
  war.casualties[defenderSide] = round((war.casualties[defenderSide] || 0) + defenderLosses, 1);
  const battle = {
    id: crypto.randomUUID(), attacker: attacker.code, tactic: tacticId, tacticName: tactic.name,
    deployment: Math.round(deployment * 100), movement: round(won ? advance : -retreat, 1), won, loot, turn: world.turn,
    attackerTroops: attackCoalition.troops, defenderTroops: defenseCoalition.troops,
    attackerPower: round(attackerPower, 1), defenderPower: round(defenderPower, 1),
    attackerLosses, defenderLosses, attackerAllies: attackCoalition.allies, defenderAllies: defenseCoalition.allies,
    supplyUsed: supplyNeeded, distancePenalty: round((1 - distanceFactor) * 100)
  };
  war.lastOperation = battle;
  war.battles.push(battle); war.battles = war.battles.slice(-16);
  attacker.lastAction = `Наступление против ${CATALOG_BY_CODE[defender.code].name}: ${won ? `фронт продвинулся на ${round(advance, 1)}%` : `отступление на ${round(retreat, 1)}%`}`;
  if (Math.abs(war.front) >= 100) {
    const winner = war.front > 0 ? world.countries[war.a] : world.countries[war.b];
    const loser = war.front > 0 ? world.countries[war.b] : world.countries[war.a];
    const annexLoot = annexCountry(world, war, winner, loser);
    return { ok: true, won, annexed: true, movement: round(won ? advance : -retreat, 1), loot: round(loot + annexLoot, 1) };
  }
  pushNews(world, `${attackerMeta.name} атакует ${defenderMeta.name}: ${won ? `захвачено ${round(advance, 1)}% территории` : `оборона отбросила войска на ${round(retreat, 1)}%`}. Силы ${Math.round(attackerPower)} против ${Math.round(defenderPower)}, потери ${attackerLosses}/${defenderLosses} тыс.${loot ? ` Трофеи ${loot} млрд.` : ''}`, 'red');
  return { ok: true, won, annexed: false, movement: round(won ? advance : -retreat, 1), loot, battle };
}

function pushNews(world, text, tone = 'blue') {
  world.news.unshift({ id: crypto.randomUUID(), turn: world.turn, tone, text, createdAt: Date.now() });
  world.news = world.news.slice(0, 24);
}

function incomeFor(country) {
  if (country.eliminated || country.absorbedBy) return 0;
  const base = Math.sqrt(country.gdp) * 0.7;
  const systems = (country.industry + country.infrastructure + country.energy) / 210;
  const taxes = country.taxRate / 24;
  const warPenalty = country.atWar.length ? .72 : country.supportingWarId ? .88 : 1;
  const bonuses = technologyBonuses(country);
  const advisors = advisorBonuses(country);
  const tradeDeals = country.treaties.filter((treaty) => treaty.startsWith('trade:')).length;
  const tradeMultiplier = 1 + tradeDeals * (.015 + (bonuses.tradeBonus || 0) * .01);
  const occupationPenalty = 1 - clamp((country.occupation?.percent || 0) * .004, 0, .4);
  const resourceSecurity = (country.resources?.energy || 0) < 4 || (country.resources?.food || 0) < 4 ? .78 : 1;
  return round(clamp(base * systems * taxes * warPenalty * occupationPenalty * tradeMultiplier * resourceSecurity * (1 + (bonuses.incomePct || 0) + (advisors.incomePct || 0)), 3, 180), 1);
}

function militaryPower(c) {
  const raw = c.army.manpower * .55 + c.army.equipment * .9 + c.army.readiness * .5 + c.army.air * .7 + c.army.navy * .35 + c.army.defense * .5;
  const specialized = (c.units?.infantry || 0) * .35 + (c.units?.armor || 0) * .85 + (c.units?.airWings || 0) * 1.05 + (c.units?.airDefense || 0) * .7 + (c.units?.fleet || 0) * .55;
  const condition = (.78 + (c.army.morale ?? 60) / 450) * (.82 + (c.army.supplies ?? 60) / 550) * (1 + (c.army.experience ?? 0) / 500);
  const fuel = (c.resources?.fuel || 0) < 3 ? .72 : 1;
  const advisor = 1 + (advisorBonuses(c).combatPct || 0);
  return Math.round((raw + specialized) * condition * fuel * advisor);
}

function calculateScores(world) {
  migrateWorld(world);
  for (const country of Object.values(world.countries)) {
    const ownArea = CATALOG_BY_CODE[country.code]?.area || 1;
    const retainedArea = country.eliminated ? 0 : ownArea * (1 - (country.occupation?.percent || 0) / 100);
    const controlledArea = Object.values(world.countries).reduce((sum, target) => target.occupation?.by === country.code
      ? sum + (CATALOG_BY_CODE[target.code]?.area || 1) * target.occupation.percent / 100 : sum, 0);
    country.territoryArea = Math.round(retainedArea + controlledArea);
    country.income = incomeFor(country);
    country.militaryPower = militaryPower(country);
    country.victoryProgress = strategicGoalProgress(world, country);
    const progress = Object.keys(country.techs || {}).length * 5 + (country.completedProjects?.length || 0) * 12;
    const territory = Math.sqrt(Math.max(1, country.territoryArea)) / 18;
    const strategic = (country.victoryProgress || 0) * .45 + Object.keys(country.advisors || {}).length * 5 + (country.allianceId ? 8 : 0);
    country.score = country.eliminated ? 0 : Math.round(country.gdp * 0.025 + country.stability + country.happiness + country.influence * 1.5 + country.reputation * .45 + country.police * .2 + country.militaryPower * 0.45 + progress + territory + strategic);
  }
}

function selectCountry(world, player, code) {
  if (player.countryCode) return { ok: false, error: 'Страна уже выбрана навсегда для этой партии' };
  const country = world.countries[code];
  if (!country || !CATALOG_BY_CODE[code]) return { ok: false, error: 'Такой страны нет в мире' };
  if (country.eliminated || country.absorbedBy) return { ok: false, error: 'Эта страна уже полностью присоединена к другой державе' };
  if (country.ownerId) return { ok: false, error: 'Эта страна уже занята другим игроком' };
  player.countryCode = code;
  country.ownerId = player.id;
  country.isBot = false;
  country.pendingDecision ||= 'budget_debate';
  country.lastAction = `Лидер ${player.name} принял управление страной`;
  pushNews(world, `${CATALOG_BY_CODE[code].flag} ${player.name} возглавил государство ${CATALOG_BY_CODE[code].name}.`, 'gold');
  return { ok: true };
}

function spend(country, amount) {
  if (country.treasury < amount) return false;
  country.treasury = round(country.treasury - amount, 1);
  return true;
}

function applyStrategicEffects(country, option) {
  if (option.treasury) country.treasury = round(country.treasury + option.treasury, 1);
  for (const [key, value] of Object.entries(option.effects || {})) country[key] = clamp(round((country[key] || 0) + value, 1), 0, 100);
  for (const [key, value] of Object.entries(option.production || {})) country.resourceProduction[key] = round((country.resourceProduction[key] || 0) + value, 1);
  for (const [key, value] of Object.entries(option.resources || {})) country.resources[key] = clamp(round((country.resources[key] || 0) + value, 1), 0, 150);
}

function addAllianceMember(world, alliance, country) {
  if (!alliance.members.includes(country.code)) alliance.members.push(country.code);
  country.allianceId = alliance.id;
  for (const memberCode of alliance.members) {
    if (memberCode === country.code) continue;
    const member = world.countries[memberCode];
    if (!member) continue;
    const forward = `alliance:${memberCode}`; const reverse = `alliance:${country.code}`;
    if (!country.treaties.includes(forward)) country.treaties.push(forward);
    if (!member.treaties.includes(reverse)) member.treaties.push(reverse);
    changeRelation(world, country.code, memberCode, 12);
  }
}

function removeAllianceMember(world, alliance, country) {
  alliance.members = alliance.members.filter((code) => code !== country.code);
  country.allianceId = null;
  for (const memberCode of alliance.members) {
    const member = world.countries[memberCode];
    if (!member) continue;
    country.treaties = country.treaties.filter((treaty) => treaty !== `alliance:${memberCode}`);
    member.treaties = member.treaties.filter((treaty) => treaty !== `alliance:${country.code}`);
  }
}

function createTradeRoute(world, buyer, seller, resource) {
  const definition = STRATEGIC_RESOURCES[resource];
  if (!definition) return { ok: false, error: 'Неизвестный стратегический ресурс' };
  if (world.tradeRoutes.filter((route) => route.status !== 'closed' && route.to === buyer.code).length >= 4) return { ok: false, error: 'Страна уже использует четыре импортных маршрута' };
  const existing = world.tradeRoutes.find((route) => route.status === 'active' && route.from === seller.code && route.to === buyer.code && route.resource === resource);
  if (existing) return { ok: false, error: 'Такой маршрут уже работает' };
  const amount = 3;
  const price = definition.price * amount;
  const route = { id: crypto.randomUUID(), from: seller.code, to: buyer.code, resource, amount, price, status: 'active', createdAt: world.turn, delivered: 0 };
  world.tradeRoutes.push(route);
  const tradeForward = `trade:${seller.code}`; const tradeReverse = `trade:${buyer.code}`;
  if (!buyer.treaties.includes(tradeForward)) buyer.treaties.push(tradeForward);
  if (!seller.treaties.includes(tradeReverse)) seller.treaties.push(tradeReverse);
  changeRelation(world, buyer.code, seller.code, 7);
  pushNews(world, `${CATALOG_BY_CODE[seller.code].name} начинает поставки ресурса «${definition.name}» в государство ${CATALOG_BY_CODE[buyer.code].name}.`, 'green');
  return { ok: true, toast: `Маршрут создан · ${amount} ед. за ${price} млрд каждый ход` };
}

function politicalSupport(country) {
  return round(((country.factions.people || 0) + (country.factions.business || 0) + (country.factions.military || 0) + (country.factions.elites || 0)) / 4 - (country.factions.opposition || 0) * .35, 1);
}

function performAction(world, player, message) {
  migrateWorld(world);
  const country = world.countries[player.countryCode];
  if (!country) return { ok: false, error: 'Сначала выберите страну' };
  const meta = CATALOG_BY_CODE[country.code];

  if (message.action === 'publish_news') {
    const now = Date.now();
    const remaining = Math.max(0, PLAYER_NEWS_COOLDOWN_MS - (now - (country.lastPlayerNewsAt || 0)));
    if (remaining > 0) return { ok: false, error: `Следующую новость можно опубликовать через ${Math.ceil(remaining / 1000)} сек.` };
    const category = PLAYER_NEWS_CATEGORIES[message.category] ? message.category : 'statement';
    const headline = String(message.headline || '').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
    const text = String(message.text || '').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 420);
    if (headline.length < 5) return { ok: false, error: 'Заголовок должен содержать не менее 5 символов' };
    if (text.length < 12) return { ok: false, error: 'Текст новости должен содержать не менее 12 символов' };
    const article = {
      id: crypto.randomUUID(), turn: world.turn, createdAt: now, category,
      headline, text, authorCode: country.code, authorName: player.name, playerId: player.id
    };
    world.playerNews.unshift(article);
    world.playerNews = world.playerNews.slice(0, 80);
    country.lastPlayerNewsAt = now;
    country.media.credibility = clamp(round(country.media.credibility + (category === 'statement' ? -.2 : .4), 1), 0, 100);
    if (category === 'economy') country.factions.business = clamp(round(country.factions.business + .6, 1), 0, 100);
    if (category === 'society') country.factions.people = clamp(round(country.factions.people + .6, 1), 0, 100);
    if (category === 'military' && country.atWar.length) country.media.warSupport = clamp(round(country.media.warSupport + 1, 1), 0, 100);
    if (category === 'politics') country.influence = clamp(round(country.influence + .3, 1), 0, 100);
    country.lastAction = `Опубликовано заявление «${headline}»`;
    return { ok: true, toast: 'Новость опубликована для всех игроков' };
  }

  if (country.eliminated || country.absorbedBy) return { ok: false, error: `Ваша страна полностью присоединена к государству ${CATALOG_BY_CODE[country.absorbedBy]?.name || country.absorbedBy}. Вы продолжаете наблюдать за миром.` };

  if (message.action === 'extraction') return performExtractionAction(world, country, message);

  if (message.action === 'internal_policy') {
    const plans = {
      people: { cost: 18, effects: { happiness: 4, stability: 1 }, factions: { people: 10, business: -3, opposition: -3 }, text: 'социальный пакет для граждан' },
      business: { cost: 20, effects: { industry: 3, stability: -1 }, factions: { business: 11, people: -3, elites: 2 }, text: 'пакет свободы предпринимательства' },
      military: { cost: 22, army: { readiness: 4, morale: 3 }, factions: { military: 11, people: -2, opposition: 2 }, text: 'расширение полномочий генерального штаба' },
      anti_corruption: { cost: 30, effects: { reputation: 5, police: 3, stability: 2 }, factions: { people: 7, business: 4, elites: -10, opposition: -5 }, text: 'антикоррупционную реформу' },
      emergency: { cost: 14, effects: { stability: 6, happiness: -5, reputation: -4 }, factions: { military: 7, elites: 5, people: -7, opposition: 9 }, text: 'чрезвычайное положение' }
    };
    const plan = plans[message.id];
    if (!plan) return { ok: false, error: 'Неизвестная внутренняя реформа' };
    if (country.lastPoliticalTurn === world.turn) return { ok: false, error: 'Политический капитал этого квартала уже использован' };
    if (!spend(country, plan.cost)) return { ok: false, error: `Для реформы нужно ${plan.cost} млрд` };
    for (const [key, value] of Object.entries(plan.effects || {})) country[key] = clamp(round(country[key] + value, 1), 0, 100);
    for (const [key, value] of Object.entries(plan.factions || {})) country.factions[key] = clamp(round(country.factions[key] + value, 1), 0, 100);
    for (const [key, value] of Object.entries(plan.army || {})) country.army[key] = clamp(round(country.army[key] + value, 1), 0, 100);
    country.lastPoliticalTurn = world.turn;
    country.lastAction = `Правительство проводит ${plan.text}`;
    return { ok: true, toast: `Реформа принята · поддержка правительства ${politicalSupport(country)}` };
  }

  if (message.action === 'political_crisis') {
    if (!country.politicalCrisis) return { ok: false, error: 'Острого внутреннего кризиса сейчас нет' };
    const responses = {
      negotiate: { cost: 24, opposition: -18, stability: 4, happiness: 5, reputation: 2, text: 'Правительство начало переговоры и согласилось на ограниченные реформы' },
      elections: { cost: 34, opposition: -28, stability: 7, happiness: 8, reputation: 5, text: 'Проведены досрочные выборы и сформировано новое правительство' },
      suppress: { cost: 18, opposition: -12, stability: 8, happiness: -9, reputation: -8, text: 'Силовые структуры разогнали протесты' }
    };
    const response = responses[message.id];
    if (!response) return { ok: false, error: 'Неизвестный ответ на политический кризис' };
    if (!spend(country, response.cost)) return { ok: false, error: `Для решения нужно ${response.cost} млрд` };
    country.factions.opposition = clamp(round(country.factions.opposition + response.opposition, 1), 0, 100);
    for (const key of ['stability','happiness','reputation']) country[key] = clamp(round(country[key] + response[key], 1), 0, 100);
    country.politicalCrisis = null; country.lastAction = response.text;
    pushNews(world, `${meta.name}: ${response.text.toLowerCase()}.`, message.id === 'suppress' ? 'red' : 'green');
    return { ok: true, toast: 'Острый политический кризис завершён' };
  }

  if (message.action === 'advisor') {
    const advisor = ADVISORS[message.id];
    if (!advisor) return { ok: false, error: 'Неизвестный кандидат' };
    if (Object.values(country.advisors).includes(message.id)) return { ok: false, error: 'Этот советник уже работает в правительстве' };
    if (!spend(country, advisor.cost)) return { ok: false, error: `Для контракта нужно ${advisor.cost} млрд` };
    country.advisors[advisor.role] = message.id;
    country.lastAction = `${advisor.name} назначен на должность «${advisor.role}»`;
    return { ok: true, toast: `${advisor.name} вошёл в совет правительства` };
  }

  if (message.action === 'unit_program') {
    const program = UNIT_PROGRAMS[message.id];
    if (!program) return { ok: false, error: 'Неизвестная военная специализация' };
    if (program.naval && meta.landlocked) return { ok: false, error: 'Государство без выхода к морю не может строить экспедиционный флот' };
    if (country.treasury < program.cost) return { ok: false, error: `Для программы нужно ${program.cost} млрд` };
    if (!spendResources(country, program.resources)) return { ok: false, error: 'Не хватает стратегических ресурсов для производства' };
    spend(country, program.cost);
    country.units[message.id] = clamp(round(country.units[message.id] + program.gain, 1), 0, 100);
    if (message.id === 'infantry') country.army.manpower = clamp(round(country.army.manpower + 6, 1), 0, 999);
    if (message.id === 'armor') country.army.equipment = clamp(round(country.army.equipment + 4, 1), 0, 100);
    if (message.id === 'airWings') country.army.air = clamp(round(country.army.air + 4, 1), 0, 100);
    if (message.id === 'airDefense') country.army.defense = clamp(round(country.army.defense + 4, 1), 0, 100);
    if (message.id === 'fleet') country.army.navy = clamp(round(country.army.navy + 4, 1), 0, 100);
    country.lastAction = `Развёрнута программа «${program.name}»`;
    return { ok: true, toast: `${program.name}: сформировано +${program.gain}` };
  }

  if (message.action === 'crisis_response') {
    const crisis = world.globalCrisis;
    const option = crisis && GLOBAL_CRISES.find((item) => item.id === crisis.id)?.options.find((item) => item.id === message.id);
    if (!crisis || crisis.endsAt < world.turn || !option) return { ok: false, error: 'Это кризисное решение уже неактуально' };
    if (country.crisisChoices[crisis.id]) return { ok: false, error: 'Страна уже выбрала ответ на этот кризис' };
    if (option.cost && country.treasury < option.cost) return { ok: false, error: `Для решения нужно ${option.cost} млрд` };
    for (const [id, value] of Object.entries(option.resources || {})) if (value < 0 && (country.resources[id] || 0) < Math.abs(value)) return { ok: false, error: `Не хватает ресурса «${STRATEGIC_RESOURCES[id].name}»` };
    if (option.cost) spend(country, option.cost);
    applyStrategicEffects(country, option);
    country.crisisChoices[crisis.id] = { option: option.id, turn: world.turn };
    country.lastAction = `${crisis.name}: ${option.label}`;
    return { ok: true, toast: 'Кризисная стратегия утверждена' };
  }

  if (message.action === 'alliance_bloc' && message.id === 'create') {
    if (country.allianceId) return { ok: false, error: 'Страна уже состоит в международном блоке' };
    if (!spend(country, 40)) return { ok: false, error: 'Для учреждения блока нужно 40 млрд' };
    const rawName = String(message.name || '').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
    const name = rawName.length >= 3 ? rawName : `Союз ${meta.name}`;
    const alliance = { id: crypto.randomUUID(), name, founder: country.code, members: [country.code], budget: 0, createdAt: world.turn, color: ['#65d3aa','#67bce8','#d7b862','#be8be8'][world.alliances.length % 4] };
    world.alliances.push(alliance); country.allianceId = alliance.id;
    pushNews(world, `${meta.name} учреждает международный блок «${name}».`, 'gold');
    return { ok: true, toast: `Международный блок «${name}» создан` };
  }

  if (message.action === 'alliance_bloc' && ['accept','decline'].includes(message.id)) {
    const invite = world.allianceInvites.find((item) => item.id === message.inviteId && item.to === country.code);
    if (!invite) return { ok: false, error: 'Приглашение уже неактуально' };
    world.allianceInvites = world.allianceInvites.filter((item) => item.id !== invite.id);
    if (message.id === 'decline') return { ok: true, toast: 'Приглашение в блок отклонено' };
    if (country.allianceId) return { ok: false, error: 'Страна уже состоит в другом блоке' };
    const alliance = world.alliances.find((item) => item.id === invite.allianceId);
    if (!alliance) return { ok: false, error: 'Международный блок больше не существует' };
    if (alliance.members.length >= 8) return { ok: false, error: 'В международном блоке больше нет свободных мест' };
    addAllianceMember(world, alliance, country);
    pushNews(world, `${meta.name} вступает в международный блок «${alliance.name}».`, 'gold');
    return { ok: true, toast: `Страна вступила в блок «${alliance.name}»` };
  }

  if (message.action === 'alliance_bloc' && message.id === 'leave') {
    const alliance = world.alliances.find((item) => item.id === country.allianceId);
    if (!alliance) return { ok: false, error: 'Страна не состоит в международном блоке' };
    if (alliance.founder === country.code && alliance.members.length > 1) return { ok: false, error: 'Основатель должен сначала остаться единственным участником блока' };
    removeAllianceMember(world, alliance, country);
    country.reputation = clamp(country.reputation - 4, 0, 100);
    if (!alliance.members.length) world.alliances = world.alliances.filter((item) => item.id !== alliance.id);
    return { ok: true, toast: 'Страна вышла из международного блока' };
  }

  if (message.action === 'alliance_bloc' && message.id === 'disband') {
    const alliance = world.alliances.find((item) => item.id === country.allianceId);
    if (!alliance || alliance.founder !== country.code) return { ok: false, error: 'Распустить блок может только основатель' };
    for (const code of [...alliance.members]) { const member = world.countries[code]; if (member) removeAllianceMember(world, alliance, member); }
    world.alliances = world.alliances.filter((item) => item.id !== alliance.id);
    world.allianceInvites = world.allianceInvites.filter((item) => item.allianceId !== alliance.id);
    pushNews(world, `${meta.name} распускает международный блок «${alliance.name}».`, 'red');
    return { ok: true, toast: 'Международный блок распущен' };
  }

  if (message.action === 'alliance_bloc' && message.id === 'contribute') {
    const alliance = world.alliances.find((item) => item.id === country.allianceId);
    if (!alliance) return { ok: false, error: 'Страна не состоит в международном блоке' };
    if (!spend(country, 15)) return { ok: false, error: 'Взнос в общий бюджет составляет 15 млрд' };
    alliance.budget = round(alliance.budget + 15, 1); country.influence = clamp(round(country.influence + 1, 1), 0, 100);
    return { ok: true, toast: 'В общий бюджет блока внесено 15 млрд' };
  }

  if (message.action === 'trade_route' && ['accept','decline'].includes(message.id)) {
    const offer = world.tradeOffers.find((item) => item.id === message.offerId && item.to === country.code);
    if (!offer) return { ok: false, error: 'Торговое предложение уже неактуально' };
    world.tradeOffers = world.tradeOffers.filter((item) => item.id !== offer.id);
    if (message.id === 'decline') return { ok: true, toast: 'Торговое предложение отклонено' };
    const buyer = world.countries[offer.from];
    if (!buyer) return { ok: false, error: 'Покупатель больше недоступен' };
    return createTradeRoute(world, buyer, country, offer.resource);
  }

  if (message.action === 'trade_route' && message.id === 'cancel') {
    const route = world.tradeRoutes.find((item) => item.id === message.routeId && item.status !== 'closed' && (item.from === country.code || item.to === country.code));
    if (!route) return { ok: false, error: 'Торговый маршрут уже закрыт' };
    route.status = 'closed'; route.closedAt = world.turn;
    changeRelation(world, route.from, route.to, -3);
    return { ok: true, toast: 'Регулярный торговый маршрут закрыт' };
  }

  if (message.action === 'media_campaign' && ['unity','war'].includes(message.id)) {
    if (country.lastMediaTurn === world.turn) return { ok: false, error: 'Информационная кампания в этом квартале уже проводилась' };
    if (message.id === 'war' && !country.atWar.length) return { ok: false, error: 'Военная мобилизация прессы доступна только во время войны' };
    if (!spend(country, message.id === 'war' ? 22 : 16)) return { ok: false, error: 'Не хватает средств на информационную кампанию' };
    country.lastMediaTurn = world.turn;
    if (message.id === 'unity') {
      country.happiness = clamp(country.happiness + 3, 0, 100); country.factions.opposition = clamp(country.factions.opposition - 4, 0, 100); country.media.credibility = clamp(country.media.credibility + 1, 0, 100);
    } else {
      country.army.morale = clamp(country.army.morale + 7, 0, 100); country.media.warSupport = clamp(country.media.warSupport + 10, 0, 100); country.media.credibility = clamp(country.media.credibility - 2, 0, 100);
    }
    return { ok: true, toast: message.id === 'unity' ? 'Кампания общественного единства запущена' : 'Поддержка военных действий выросла' };
  }

  if (message.action === 'technology') {
    const node = TECH_BY_ID[message.id];
    if (!node) return { ok: false, error: 'Неизвестная технология' };
    if (country.techs[node.id]) return { ok: false, error: 'Эта технология уже изучена' };
    if (!(node.requires || []).every((id) => country.techs[id])) return { ok: false, error: 'Сначала изучите предыдущие технологии' };
    if (country.techPoints < node.cost) return { ok: false, error: `Нужно ${node.cost} очков развития` };
    if (country.treasury < node.money) return { ok: false, error: `Нужно ${node.money} млрд в казне` };
    country.techPoints = round(country.techPoints - node.cost, 1);
    country.treasury = round(country.treasury - node.money, 1);
    country.techs[node.id] = world.turn;
    country.lastAction = `Освоена технология «${node.name}»`;
    country.influence = clamp(country.influence + Math.ceil(node.tier / 2), 0, 100);
    if (node.tier >= 5) pushNews(world, `${meta.name} совершает технологический прорыв: «${node.name}».`, 'gold');
    return { ok: true, toast: `Изучено: ${node.name}` };
  }

  if (message.action === 'project') {
    const project = NATIONAL_PROJECTS[message.id];
    if (!project) return { ok: false, error: 'Неизвестный национальный проект' };
    if (country.activeProject) return { ok: false, error: 'Сначала завершите текущий национальный проект' };
    if (country.completedProjects.includes(message.id)) return { ok: false, error: 'Этот проект уже реализован' };
    if (project.requirements?.coastal && meta.landlocked) return { ok: false, error: 'Для этого мегапроекта нужен выход к морю' };
    const requirementNames = { science: 'наука', cyber: 'киберпотенциал', energy: 'энергетика', infrastructure: 'инфраструктура' };
    for (const [field,value] of Object.entries(project.requirements || {})) if (field !== 'coastal' && (country[field] || 0) < value) return { ok: false, error: `Для проекта нужно: ${requirementNames[field] || field} не ниже ${value}` };
    if (!spend(country, project.cost)) return { ok: false, error: `Для проекта нужно ${project.cost} млрд` };
    country.activeProject = { id: message.id, remaining: project.duration, startedAt: world.turn };
    country.lastAction = `Начат проект «${project.name}»`;
    pushNews(world, `${meta.name} запускает национальный проект «${project.name}».`, 'blue');
    return { ok: true, toast: `Проект запущен на ${project.duration} хода` };
  }

  if (message.action === 'decision') {
    const decision = DECISIONS.find((item) => item.id === country.pendingDecision);
    const option = decision?.options.find((item) => item.id === message.id);
    if (!decision || !option) return { ok: false, error: 'Это решение уже неактуально' };
    if (option.cost && !spend(country, option.cost)) return { ok: false, error: `Для решения нужно ${option.cost} млрд` };
    if (option.treasury) country.treasury += option.treasury;
    if (option.techPoints) country.techPoints += option.techPoints;
    if (option.population) country.population = round(country.population + option.population, 2);
    for (const [key, value] of Object.entries(option.effects || {})) country[key] = clamp(round(country[key] + value, 2), 0, 100);
    for (const [key, value] of Object.entries(option.army || {})) country.army[key] = clamp(country.army[key] + value, 0, key === 'manpower' ? 999 : 100);
    country.decisionHistory.push({ id: decision.id, option: option.id, turn: world.turn });
    country.pendingDecision = null;
    country.lastAction = `${decision.title}: ${option.label}`;
    return { ok: true, toast: 'Государственное решение принято' };
  }

  if (message.action === 'develop') {
    const item = DEVELOPMENT_ACTIONS[message.id];
    if (!item) return { ok: false, error: 'Неизвестный проект' };
    const cost = Math.max(1, Math.round(item.cost * (1 - (technologyBonuses(country).developmentDiscount || 0))));
    if (!spend(country, cost)) return { ok: false, error: 'Недостаточно средств в казне' };
    country[item.field] = clamp(country[item.field] + item.gain, 0, 100);
    country.gdp = round(country.gdp * 1.006 + item.gain * 0.4, 1);
    if (item.field === 'education') country.stability = clamp(country.stability + 1, 0, 100);
    if (item.field === 'healthcare') country.happiness = clamp(country.happiness + 2, 0, 100);
    country.lastAction = item.label;
    return { ok: true, toast: `${item.label}: проект запущен` };
  }

  if (message.action === 'military') {
    const item = MILITARY_ACTIONS[message.id];
    if (!item) return { ok: false, error: 'Неизвестная военная программа' };
    const bonuses = technologyBonuses(country);
    const cost = Math.max(1, Math.round(item.cost * (1 - (bonuses.militaryDiscount || 0))));
    if (item.manpower && country.army.reserve <= 0) return { ok: false, error: 'Мобилизационный резерв исчерпан' };
    if (!spend(country, cost)) return { ok: false, error: 'Недостаточно средств в казне' };
    for (const key of ['manpower', 'equipment', 'readiness', 'air', 'navy', 'defense', 'supplies', 'morale', 'experience', 'medical']) {
      let gain = key === 'manpower' ? (item[key] || 0) * (1 + (bonuses.recruitPct || 0)) : item[key];
      if (key === 'manpower' && gain) {
        gain = Math.min(gain, country.army.reserve);
        country.army.reserve = clamp(round(country.army.reserve - gain, 1), 0, 999);
      }
      if (gain) country.army[key] = clamp(round(country.army[key] + gain, 1), 0, key === 'manpower' ? 999 : 100);
    }
    country.happiness = clamp(country.happiness + (item.happiness ?? -1), 0, 100);
    country.stability = clamp(country.stability + (item.stability || 0), 0, 100);
    country.influence = clamp(country.influence + (item.influence || 0), 0, 100);
    country.lastAction = item.label;
    return { ok: true, toast: `${item.label}: приказ выполнен` };
  }

  if (message.action === 'policy') {
    if (message.id === 'tax') {
      const rate = clamp(Number(message.value), 12, 42);
      country.taxRate = rate;
      country.happiness = clamp(country.happiness - Math.max(0, rate - 28) * 0.15, 0, 100);
      country.lastAction = `Налоговая ставка изменена: ${rate}%`;
      return { ok: true, toast: 'Экономическая политика обновлена' };
    }
    if (['balanced', 'economy', 'science', 'defense', 'welfare'].includes(message.value)) {
      country.focus = message.value;
      country.lastAction = 'Утверждён новый национальный приоритет';
      return { ok: true, toast: 'Национальный приоритет изменён' };
    }
  }

  if (message.action === 'doctrine') {
    if (!MILITARY_DOCTRINES[message.id]) return { ok: false, error: 'Неизвестная военная доктрина' };
    country.doctrine = message.id;
    country.lastAction = `Принята доктрина «${MILITARY_DOCTRINES[message.id].name}»`;
    return { ok: true, toast: 'Военная доктрина обновлена' };
  }

  if (message.action === 'war_support') return handleWarSupport(world, country, message);

  const target = world.countries[message.target];
  const targetMeta = CATALOG_BY_CODE[message.target];
  if (!target || target.code === country.code) return { ok: false, error: 'Выберите другое государство' };
  if (target.eliminated || target.absorbedBy) return { ok: false, error: `Эта территория уже является частью государства ${CATALOG_BY_CODE[target.absorbedBy]?.name || target.absorbedBy}` };

  if (message.action === 'alliance_bloc' && message.id === 'invite') {
    const alliance = world.alliances.find((item) => item.id === country.allianceId);
    if (!alliance || alliance.founder !== country.code) return { ok: false, error: 'Приглашения отправляет основатель международного блока' };
    if (target.allianceId) return { ok: false, error: 'Страна уже состоит в международном блоке' };
    if (alliance.members.length >= 8) return { ok: false, error: 'В блоке уже максимальные восемь участников' };
    if (getRelation(world, country.code, target.code) < 55) return { ok: false, error: 'Для приглашения нужно доверие не ниже +55' };
    if (world.allianceInvites.some((item) => item.to === target.code && item.allianceId === alliance.id)) return { ok: false, error: 'Приглашение уже отправлено' };
    if (!spend(country, 8)) return { ok: false, error: 'Дипломатическая конференция стоит 8 млрд' };
    if (target.isBot) {
      addAllianceMember(world, alliance, target);
      pushNews(world, `${targetMeta.name} вступает в международный блок «${alliance.name}».`, 'gold');
      return { ok: true, toast: `${targetMeta.name} вступает в ваш международный блок` };
    }
    world.allianceInvites.push({ id: crypto.randomUUID(), allianceId: alliance.id, from: country.code, to: target.code, createdAt: world.turn });
    return { ok: true, toast: 'Игрок получил приглашение в международный блок' };
  }

  if (message.action === 'alliance_bloc' && message.id === 'kick') {
    const alliance = world.alliances.find((item) => item.id === country.allianceId);
    if (!alliance || alliance.founder !== country.code) return { ok: false, error: 'Исключать участников может только основатель блока' };
    if (target.allianceId !== alliance.id || target.code === country.code) return { ok: false, error: 'Эта страна не является участником вашего блока' };
    removeAllianceMember(world, alliance, target);
    target.reputation = clamp(round(target.reputation - 2, 1), 0, 100); changeRelation(world, country.code, target.code, -12);
    pushNews(world, `${targetMeta.name} исключено из международного блока «${alliance.name}».`, 'red');
    return { ok: true, toast: `${targetMeta.name} исключено из международного блока` };
  }

  if (message.action === 'trade_route' && message.id === 'propose') {
    const resource = STRATEGIC_RESOURCES[message.resource] ? message.resource : null;
    if (!resource) return { ok: false, error: 'Выберите стратегический ресурс' };
    if (getRelation(world, country.code, target.code) < 10) return { ok: false, error: 'Для маршрута нужно доверие не ниже +10' };
    const activeRoutes = world.tradeRoutes.filter((route) => route.status === 'active' && route.to === country.code).length;
    if (activeRoutes >= 4) return { ok: false, error: 'Страна уже использует четыре импортных маршрута' };
    if ((target.resourceProduction[resource] || 0) < 2) return { ok: false, error: 'У выбранной страны недостаточно производства этого ресурса' };
    if (target.isBot) return createTradeRoute(world, country, target, resource);
    if (world.tradeOffers.some((offer) => offer.from === country.code && offer.to === target.code && offer.resource === resource)) return { ok: false, error: 'Такое предложение уже отправлено' };
    world.tradeOffers.push({ id: crypto.randomUUID(), from: country.code, to: target.code, resource, createdAt: world.turn });
    return { ok: true, toast: 'Игрок получил предложение о регулярных поставках' };
  }

  if (message.action === 'media_campaign' && message.id === 'discredit') {
    if (country.lastMediaTurn === world.turn) return { ok: false, error: 'Информационная кампания в этом квартале уже проводилась' };
    if (!spend(country, 20)) return { ok: false, error: 'Для международной кампании нужно 20 млрд' };
    country.lastMediaTurn = world.turn;
    const chance = clamp(35 + country.media.credibility * .35 + country.cyber * .2 - target.media.credibility * .25, 18, 82);
    const roll = hashFloat(`${world.seed}:media:${world.turn}:${country.code}:${target.code}`) * 100;
    if (roll <= chance) {
      target.reputation = clamp(round(target.reputation - 6, 1), 0, 100); target.factions.opposition = clamp(round(target.factions.opposition + 5, 1), 0, 100);
      country.influence = clamp(round(country.influence + 3, 1), 0, 100); country.media.propaganda = clamp(round(country.media.propaganda + 4, 1), 0, 100);
      return { ok: true, toast: `Кампания сработала (${round(chance)}%) · репутация цели −6` };
    }
    country.media.credibility = clamp(round(country.media.credibility - 7, 1), 0, 100); country.reputation = clamp(round(country.reputation - 3, 1), 0, 100);
    changeRelation(world, country.code, target.code, -10);
    pushNews(world, `${targetMeta.name} публикует доказательства информационной атаки государства ${meta.name}.`, 'red');
    return { ok: true, toast: 'Манипуляция раскрыта · доверие к вашим СМИ упало' };
  }

  if (message.action === 'intelligence' && ['recon','sabotage','steal_tech','unrest'].includes(message.id)) {
    if (country.lastIntelTurn === world.turn) return { ok: false, error: 'Разведывательная сеть уже проводила операцию в этом квартале' };
    const costs = { recon: 10, sabotage: 18, steal_tech: 24, unrest: 22 };
    if (!spend(country, costs[message.id])) return { ok: false, error: `Для операции нужно ${costs[message.id]} млрд` };
    country.lastIntelTurn = world.turn;
    const advisors = advisorBonuses(country); const defense = advisorBonuses(target);
    const chance = clamp(34 + country.cyber * .48 - target.cyber * .27 - target.police * .12 + (technologyBonuses(country).intelPct || 0) * 100 + (advisors.intelPct || 0) * 100 - (defense.counterIntel || 0), 12, 88);
    const roll = hashFloat(`${world.seed}:strategic-intel:${world.turn}:${country.code}:${target.code}:${message.id}`) * 100;
    if (roll > chance) {
      country.reputation = clamp(round(country.reputation - 4, 1), 0, 100); changeRelation(world, country.code, target.code, -12);
      pushNews(world, `${targetMeta.name} разоблачает тайную операцию государства ${meta.name}.`, 'red');
      return { ok: true, toast: `Операция провалена (${round(chance)}% шанс) · агенты раскрыты` };
    }
    let report = '';
    if (message.id === 'recon') report = `Армия ${target.militaryPower}, снабжение ${round(target.army.supplies)}, топливо ${round(target.resources.fuel)}, стабильность ${round(target.stability)}`;
    if (message.id === 'sabotage') {
      target.army.supplies = clamp(round(target.army.supplies - 10, 1), 0, 100); target.resources.fuel = clamp(round(target.resources.fuel - 6, 1), 0, 150); target.infrastructure = clamp(round(target.infrastructure - 2, 1), 0, 100);
      report = 'Повреждены склады снабжения и транспортная инфраструктура';
    }
    if (message.id === 'steal_tech') {
      const available = Object.keys(target.techs || {}).filter((id) => target.techs[id] && !country.techs[id] && (TECH_BY_ID[id]?.requires || []).every((required) => country.techs[required]));
      const stolen = available[Math.floor(hashFloat(`${world.seed}:tech-loot:${world.turn}:${target.code}`) * Math.max(1, available.length))];
      if (stolen) { country.techs[stolen] = world.turn; report = `Получена технология «${TECH_BY_ID[stolen].name}»`; }
      else { country.techPoints = round(country.techPoints + 2, 1); report = 'Подходящей технологии нет: получено 2 очка развития'; }
    }
    if (message.id === 'unrest') {
      target.stability = clamp(round(target.stability - 4, 1), 0, 100); target.factions.opposition = clamp(round(target.factions.opposition + 7, 1), 0, 100); report = 'Оппозиционные группы усилились, стабильность цели снижена';
    }
    country.intelligenceReports.unshift({ id: crypto.randomUUID(), target: target.code, type: message.id, report, turn: world.turn });
    country.intelligenceReports = country.intelligenceReports.slice(0, 12);
    return { ok: true, toast: `Операция успешна (${round(chance)}%): ${report}` };
  }

  if (message.action === 'occupation') {
    const occupation = target.occupation;
    if (!occupation || occupation.by !== country.code || !occupation.permanent || occupation.absorbed) return { ok: false, error: 'У вас нет закреплённой оккупации этой страны' };
    if (message.id === 'release') {
      if (activeWarFor(world, country.code, target.code)) return { ok: false, error: 'Сначала завершите активные бои' };
      releaseOccupation(world, country, target, 'released');
      pushNews(world, `${meta.name} возвращает независимость государству ${targetMeta.name}. Оккупационный режим прекращён.`, 'green');
      return { ok: true, toast: 'Страна освобождена · репутация +6 · доверие +28' };
    }
    if (['autonomy','invest','exploit'].includes(message.id)) {
      if (occupation.lastPolicyTurn === world.turn) return { ok: false, error: 'Политика оккупации уже менялась в этом квартале' };
      if (message.id === 'autonomy') {
        occupation.tributeRate = .06; occupation.resistance = clamp(round(occupation.resistance - 14, 1), 0, 100);
        target.happiness = clamp(round(target.happiness + 5, 1), 0, 100); country.reputation = clamp(round(country.reputation + 2, 1), 0, 100);
      }
      if (message.id === 'invest') {
        if (!spend(country, 25)) return { ok: false, error: 'Для восстановления региона нужно 25 млрд' };
        target.treasury = round(target.treasury + 18, 1); target.infrastructure = clamp(round(target.infrastructure + 3, 1), 0, 100);
        occupation.resistance = clamp(round(occupation.resistance - 12, 1), 0, 100); occupation.tributeRate = Math.min(occupation.tributeRate || .10, .10);
      }
      if (message.id === 'exploit') {
        occupation.tributeRate = .16; occupation.resistance = clamp(round(occupation.resistance + 15, 1), 0, 100);
        target.happiness = clamp(round(target.happiness - 6, 1), 0, 100); country.reputation = clamp(round(country.reputation - 4, 1), 0, 100);
      }
      occupation.lastPolicyTurn = world.turn;
      return { ok: true, toast: message.id === 'autonomy' ? 'Автономия расширена · сопротивление падает, дань снижена' : message.id === 'invest' ? 'Начато восстановление оккупированной территории' : 'Дань повышена до 16% · риск восстания резко вырос' };
    }
    if (message.id === 'suppress') {
      if (occupation.revolt?.status !== 'active') return { ok: false, error: 'Вооружённого восстания сейчас нет' };
      if (countryBusyInWar(world, country.code) || countryBusyInWar(world, target.code)) return { ok: false, error: 'Одна из стран уже занята другой войной' };
      if (country.army.supplies < 12) return { ok: false, error: 'Для операции нужно 12 снабжения' };
      if (!spend(country, 18)) return { ok: false, error: 'Для подавления нужно 18 млрд' };
      country.army.supplies = round(country.army.supplies - 12, 1);
      return startUprisingWar(world, country, target);
    }
    return { ok: false, error: 'Неизвестное решение по оккупированной территории' };
  }

  if (message.action === 'theft') {
    const asset = STEALABLE_ASSETS[message.id];
    if (!asset) return { ok: false, error: 'Неизвестная ценность' };
    if (country.lastTheftTurn === world.turn) return { ok: false, error: 'Агенты уже проводили кражу в этом квартале' };
    if ((target.vault[message.id] || 0) < 1) return { ok: false, error: 'Этой ценности больше нет в хранилище' };
    const chance = theftChance(country, target);
    const attempt = country.stolenItems.length + (country.theftFailures || 0);
    const roll = hashFloat(`${world.seed}:theft:${world.turn}:${country.code}:${target.code}:${message.id}:${attempt}`) * 100;
    country.lastTheftTurn = world.turn;
    if (roll <= chance) {
      target.vault[message.id] -= 1;
      const record = { id: crypto.randomUUID(), type: message.id, name: asset.name, from: target.code, turn: world.turn };
      country.stolenItems.unshift(record);
      country.stolenItems = country.stolenItems.slice(0, 30);
      let reward = '';
      if (message.id === 'gold_reserve') {
        const captured = round(Math.min(target.treasury, clamp(8 + target.treasury * .04, 8, 22)), 1);
        target.treasury = round(target.treasury - captured, 1); country.treasury = round(country.treasury + captured, 1);
        reward = `получено ${captured} млрд`;
      } else if (message.id === 'research_prototype') {
        const captured = Math.min(3, target.science); target.science = round(target.science - captured, 1); country.science = clamp(round(country.science + captured, 1), 0, 100);
        reward = `наука +${captured}`;
      } else if (message.id === 'military_blueprints') {
        const captured = Math.min(3, target.army.equipment); target.army.equipment = round(target.army.equipment - captured, 1); country.army.equipment = clamp(round(country.army.equipment + captured, 1), 0, 100); country.army.experience = clamp(round(country.army.experience + 1.5, 1), 0, 100);
        reward = `оснащение +${captured} · опыт +1,5`;
      } else if (message.id === 'cipher_keys') {
        const captured = Math.min(3, target.cyber); target.cyber = round(target.cyber - captured, 1); country.cyber = clamp(round(country.cyber + captured, 1), 0, 100);
        reward = `киберпотенциал +${captured}`;
      } else {
        target.influence = clamp(round(target.influence - 4, 1), 0, 100); target.reputation = clamp(round(target.reputation - 2, 1), 0, 100);
        country.influence = clamp(round(country.influence + 4, 1), 0, 100); country.reputation = clamp(round(country.reputation + 2, 1), 0, 100);
        reward = 'влияние +4 · репутация +2';
      }
      country.lastAction = `Тайная операция: похищено «${asset.name}»`;
      return { ok: true, toast: `Кража удалась (${chance}%): ${asset.name} · ${reward}` };
    }
    const fine = round(Math.min(country.treasury, clamp(8 + target.police * .28, 12, 35)), 1);
    country.treasury = round(country.treasury - fine, 1); target.treasury = round(target.treasury + fine, 1);
    country.reputation = clamp(round(country.reputation - 10, 1), 0, 100);
    country.influence = clamp(round(country.influence - 3, 1), 0, 100);
    country.theftFailures = (country.theftFailures || 0) + 1;
    changeRelation(world, country.code, target.code, -18);
    country.lastAction = `Агенты задержаны полицией государства ${targetMeta.name}`;
    pushNews(world, `${targetMeta.name} задерживает агентов государства ${meta.name}. Нарушитель выплачивает штраф и теряет международную репутацию.`, 'red');
    return { ok: true, toast: `Агентов поймали: штраф ${fine} млрд · репутация −10 · доверие −18` };
  }

  if (message.action === 'diplomacy') {
    if (message.id === 'embassy') {
      if (!spend(country, 8)) return { ok: false, error: 'Нужно 8 млрд в казне' };
      const value = changeRelation(world, country.code, target.code, 12 + (technologyBonuses(country).relationBonus || 0));
      country.influence = clamp(country.influence + 2, 0, 100);
      pushNews(world, `${meta.name} и ${targetMeta.name} расширяют дипломатические связи.`, 'blue');
      return { ok: true, toast: `Отношения улучшены до ${value}` };
    }
    if (message.id === 'trade') {
      if (getRelation(world, country.code, target.code) < 5) return { ok: false, error: 'Для торгового соглашения нужны отношения выше 5' };
      const key = `trade:${target.code}`;
      if (!country.treaties.includes(key)) country.treaties.push(key);
      const reverse = `trade:${country.code}`;
      if (!target.treaties.includes(reverse)) target.treaties.push(reverse);
      country.gdp = round(country.gdp * 1.012, 1); target.gdp = round(target.gdp * 1.006, 1);
      changeRelation(world, country.code, target.code, 8);
      pushNews(world, `${meta.name} и ${targetMeta.name} заключили торговое соглашение.`, 'green');
      return { ok: true, toast: 'Торговое соглашение заключено' };
    }
    if (message.id === 'alliance') {
      if (getRelation(world, country.code, target.code) < 55) return { ok: false, error: 'Для союза нужны отношения не ниже 55' };
      const key = `alliance:${target.code}`;
      if (!country.treaties.includes(key)) country.treaties.push(key);
      changeRelation(world, country.code, target.code, 15);
      pushNews(world, `${meta.name} и ${targetMeta.name} подписали оборонный союз.`, 'gold');
      return { ok: true, toast: 'Оборонный союз создан' };
    }
    if (message.id === 'nonaggression') {
      if (getRelation(world, country.code, target.code) < 25) return { ok: false, error: 'Для пакта нужны отношения не ниже 25' };
      const key = `nonaggression:${target.code}`; const reverse = `nonaggression:${country.code}`;
      if (!country.treaties.includes(key)) country.treaties.push(key);
      if (!target.treaties.includes(reverse)) target.treaties.push(reverse);
      changeRelation(world, country.code, target.code, 7);
      pushNews(world, `${meta.name} и ${targetMeta.name} подписали пакт о ненападении.`, 'green');
      return { ok: true, toast: 'Пакт о ненападении подписан' };
    }
    if (message.id === 'aid') {
      if (!spend(country, 15)) return { ok: false, error: 'Для помощи нужно 15 млрд' };
      target.treasury += 13;
      changeRelation(world, country.code, target.code, 18);
      country.influence = clamp(country.influence + 3, 0, 100);
      pushNews(world, `${meta.name} направляет экономическую помощь государству ${targetMeta.name}.`, 'green');
      return { ok: true, toast: 'Пакет помощи отправлен' };
    }
    if (message.id === 'sanction') {
      const cooldown = requireHostileCooldown(country);
      if (cooldown) return cooldown;
      if (!country.sanctions.includes(target.code)) country.sanctions.push(target.code);
      changeRelation(world, country.code, target.code, -22);
      target.gdp = round(target.gdp * 0.995, 1); country.influence = clamp(country.influence + 1, 0, 100);
      country.lastHostileActionAt = Date.now();
      pushNews(world, `${meta.name} вводит санкции против государства ${targetMeta.name}.`, 'red');
      return { ok: true, toast: 'Санкции введены' };
    }
    if (message.id === 'pressure') {
      const cooldown = requireHostileCooldown(country);
      if (cooldown) return cooldown;
      if (!spend(country, 5)) return { ok: false, error: 'Для ультиматума нужно 5 млрд' };
      const value = changeRelation(world, country.code, target.code, -18);
      target.stability = clamp(target.stability - 1, 0, 100);
      country.lastHostileActionAt = Date.now();
      pushNews(world, `${meta.name} выдвигает ультиматум государству ${targetMeta.name}. Доверие между странами падает.`, 'red');
      return { ok: true, toast: `Ультиматум: доверие снижено до ${value}` };
    }
    if (message.id === 'break_treaties') {
      const kinds = ['trade', 'alliance', 'nonaggression'];
      const hadTreaty = kinds.some((kind) => country.treaties.includes(`${kind}:${target.code}`) || target.treaties.includes(`${kind}:${country.code}`));
      if (!hadTreaty) return { ok: false, error: 'Между странами нет действующих договоров' };
      const cooldown = requireHostileCooldown(country);
      if (cooldown) return cooldown;
      country.treaties = country.treaties.filter((treaty) => !kinds.some((kind) => treaty === `${kind}:${target.code}`));
      target.treaties = target.treaties.filter((treaty) => !kinds.some((kind) => treaty === `${kind}:${country.code}`));
      const value = changeRelation(world, country.code, target.code, -20);
      country.lastHostileActionAt = Date.now();
      pushNews(world, `${meta.name} разрывает все договоры с государством ${targetMeta.name}.`, 'red');
      return { ok: true, toast: `Договоры разорваны · доверие ${value}` };
    }
    if (message.id === 'peace') {
      if (!country.atWar.includes(target.code)) return { ok: false, error: 'Между странами нет войны' };
      const war = activeWarFor(world, country.code, target.code);
      if (war?.kind === 'uprising') return { ok: false, error: 'Восстание заканчивается только освобождением территории или военным подавлением' };
      if (war) endWar(world, war, 'peace');
      else {
        country.atWar = country.atWar.filter((code) => code !== target.code);
        target.atWar = target.atWar.filter((code) => code !== country.code);
      }
      changeRelation(world, country.code, target.code, 35);
      const ceded = target.occupation?.by === country.code ? target.occupation.percent : country.occupation?.by === target.code ? -country.occupation.percent : 0;
      pushNews(world, `${meta.name} и ${targetMeta.name} заключили мирное соглашение${ceded ? `: линия контроля закреплена на ${Math.abs(ceded)}% территории` : ''}.`, 'green');
      return { ok: true, toast: ceded ? 'Мир заключён · занятые земли сохранены' : 'Мирный договор вступил в силу' };
    }
  }

  if (message.action === 'intelligence' && message.id === 'operation') {
    if (country.lastIntelTurn === world.turn) return { ok: false, error: 'Разведывательная сеть уже проводила операцию в этом квартале' };
    if (!spend(country, 12)) return { ok: false, error: 'Для операции нужно 12 млрд' };
    country.lastIntelTurn = world.turn;
    const chance = clamp(38 + country.cyber * 0.55 - target.cyber * 0.32 + (technologyBonuses(country).intelPct || 0) * 100 + (advisorBonuses(country).intelPct || 0) * 100 - (advisorBonuses(target).counterIntel || 0), 15, 92);
    const roll = hashFloat(`${world.seed}:intel:${world.turn}:${country.code}:${target.code}`) * 100;
    if (roll <= chance) {
      const captured = Math.min(8, target.treasury);
      target.treasury -= captured; country.treasury += captured;
      country.science = clamp(country.science + 1, 0, 100);
      country.influence = clamp(country.influence + 2, 0, 100);
      changeRelation(world, country.code, target.code, -5);
      return { ok: true, toast: `Операция успешна: получено ${captured} млрд и технологии` };
    }
    changeRelation(world, country.code, target.code, -14);
    country.influence = clamp(country.influence - 2, 0, 100);
    pushNews(world, `${targetMeta.name} разоблачает разведывательную операцию государства ${meta.name}.`, 'red');
    return { ok: true, toast: 'Операция провалена и раскрыта' };
  }

  if (message.action === 'conflict') {
    if (message.id === 'exercise') {
      const cooldown = requireHostileCooldown(country);
      if (cooldown) return cooldown;
      if (!spend(country, 12)) return { ok: false, error: 'Для учений нужно 12 млрд' };
      country.army.readiness = clamp(country.army.readiness + 4, 0, 100);
      changeRelation(world, country.code, target.code, -7);
      country.lastHostileActionAt = Date.now();
      pushNews(world, `${meta.name} проводит военные учения у границ государства ${targetMeta.name}.`, 'red');
      return { ok: true, toast: 'Военные учения начались' };
    }
    if (message.id === 'surge') {
      const war = activeWarFor(world, country.code, target.code);
      if (!war) return { ok: false, error: 'У стран нет активного фронта' };
      const side = country.code === war.a ? 'a' : country.code === war.b ? 'b' : null;
      if (!side) return { ok: false, error: 'Контрудар проводит основная сторона войны' };
      const pressure = side === 'a' ? -war.front : war.front;
      if (pressure < 10) return { ok: false, error: 'Стратегический резерв доступен, когда противник занял не менее 10% вашей земли' };
      if (war.surge) return { ok: false, error: 'На фронте уже идёт усиленная операция' };
      const remaining = Math.max(0, (war.surgeCooldowns?.[side] || 0) - Date.now());
      if (remaining > 0) return { ok: false, error: `Резервы восстановятся через ${Math.ceil(remaining / 1000)} сек.` };
      if (country.army.supplies < 15) return { ok: false, error: 'Для контрнаступления нужно 15 снабжения' };
      country.army.supplies = round(country.army.supplies - 15, 1);
      country.army.morale = clamp(round(country.army.morale + 8, 1), 0, 100);
      country.warExhaustion = clamp(round(country.warExhaustion + 4, 1), 0, 100);
      war.surge = { side, startedAtTick: war.battleTicks || 0, expiresAtTick: (war.battleTicks || 0) + 6, multiplier: 1.68 };
      war.surgeCooldowns ||= { a: 0, b: 0 }; war.surgeCooldowns[side] = Date.now() + 60000;
      pushNews(world, `${meta.name} бросает стратегический резерв в контрнаступление. Следующие шесть боевых тактов армия сражается с повышенной силой.`, 'gold');
      return { ok: true, toast: 'Контрнаступление началось · сила ×1,68 на 6 боевых тактов' };
    }
    if (message.id === 'fortify') {
      const war = activeWarFor(world, country.code, target.code);
      if (!war) return { ok: false, error: 'У стран нет активного фронта' };
      const side = country.code === war.a ? 'a' : country.code === war.b ? 'b' : null;
      if (!side) return { ok: false, error: 'Укреплять фронт может основная сторона войны' };
      const operationKey = `${world.turn}:${side}`;
      if ((war.operationsByTurn[operationKey] || 0) >= 2) return { ok: false, error: 'Все операции этого квартала уже использованы' };
      if (country.army.supplies < 6) return { ok: false, error: 'Для укреплений нужно 6 снабжения' };
      war.operationsByTurn[operationKey] = (war.operationsByTurn[operationKey] || 0) + 1;
      country.army.supplies = round(country.army.supplies - 6, 1);
      country.army.defense = clamp(country.army.defense + 2.5, 0, 100);
      country.army.readiness = clamp(country.army.readiness + 4, 0, 100);
      country.army.morale = clamp(country.army.morale + 2, 0, 100);
      country.warExhaustion = clamp(country.warExhaustion + 1, 0, 100);
      country.lastAction = `Инженерные войска укрепили фронт против ${targetMeta.name}`;
      pushNews(world, `${meta.name} возводит эшелонированные укрепления на фронте против государства ${targetMeta.name}.`, 'blue');
      return { ok: true, toast: 'Фронт укреплён · +2,5 обороны · +4 готовности' };
    }
    if (message.id === 'declare') {
      if (country.atWar.includes(target.code)) return { ok: false, error: 'Война уже идёт' };
      if (countryBusyInWar(world, country.code) || countryBusyInWar(world, target.code)) return { ok: false, error: 'Одна из стран уже участвует в другой территориальной войне' };
      if (getRelation(world, country.code, target.code) > -45) return { ok: false, error: 'Объявлению войны должны предшествовать отношения не выше −45' };
      if (country.treaties.some((treaty) => treaty === `alliance:${target.code}` || treaty === `nonaggression:${target.code}`)) return { ok: false, error: 'Сначала необходимо разорвать действующий договор' };
      if (country.occupation?.by && country.occupation.by !== target.code) return { ok: false, error: 'Страна уже находится под контролем другой державы' };
      if (target.occupation?.by && target.occupation.by !== country.code) return { ok: false, error: 'Эта территория уже занята другой державой' };
      if (target.occupation?.by === country.code && target.occupation.revolt) return { ok: false, error: 'Сначала выберите решение по восстанию: отпустить страну или подавить его' };
      country.atWar.push(target.code); target.atWar.push(country.code);
      changeRelation(world, country.code, target.code, -100);
      country.warScore ||= {}; target.warScore ||= {};
      const war = { id: crypto.randomUUID(), kind: 'territorial', a: country.code, b: target.code, front: occupiedFront(world, country.code, target.code), status: 'active', startedAt: world.turn, startedAtMs: Date.now(), nextBattleAt: Date.now() + 900, battleTicks: 0, lastReportedMilestone: '', operations: 0, lastOperation: null, supporters: { a: [], b: [] }, operationsByTurn: {}, battles: [], casualties: { a: 0, b: 0 }, surgeCooldowns: { a: 0, b: 0 }, surge: null, weather: 'clear', weatherChangedAtTick: 0, terrain: theaterTerrain(target.code) };
      world.wars.push(war);
      syncWarOccupation(world, war);
      country.warScore[target.code] = war.front; target.warScore[country.code] = -war.front;
      pushNews(world, `${meta.name} объявляет войну государству ${targetMeta.name}. Армии обеих стран вступают в непрерывные бои, живой фронт начинает движение.`, 'red');
      return { ok: true, toast: 'Война объявлена · войска сражаются автоматически' };
    }
    if (message.id === 'attack') {
      if (!country.atWar.includes(target.code)) return { ok: false, error: 'Сначала необходимо объявить войну' };
      const result = resolveAttack(world, country, target, message.units, message.tactic);
      if (!result.ok) return result;
      if (result.annexed) return { ok: true, toast: `Полная победа · страна присоединена · трофеи ${result.loot} млрд` };
      return { ok: true, toast: `${result.won ? `Победа: захвачено ${result.movement}%` : `Поражение: фронт отступил на ${Math.abs(result.movement)}%`} · потери ${result.battle.attackerLosses}/${result.battle.defenderLosses} тыс.${result.loot ? ` · трофеи ${result.loot} млрд` : ''}` };
    }
  }
  return { ok: false, error: 'Действие пока недоступно' };
}

function botTurn(world, country) {
  const meta = CATALOG_BY_CODE[country.code];
  const r = hashFloat(`${world.seed}:${world.turn}:${country.code}`);
  const botSites = country.extractionSites || [];
  for (const site of botSites) {
    if (site.ownerCode !== country.code) continue;
    accrueExtractionSite(site);
    if (site.stored >= extractionCapacity(site) * .62) {
      country.commodityStorage[site.type] = round((country.commodityStorage[site.type] || 0) + site.stored, 3);
      site.stored = 0; site.lastCollectedAt = Date.now();
    }
  }
  const sale = Object.keys(EXTRACTION_COMMODITIES)
    .filter((type) => (country.commodityStorage?.[type] || 0) >= .05)
    .sort((a, b) => (world.commodityMarket?.multipliers?.[b] || 1) - (world.commodityMarket?.multipliers?.[a] || 1))[0];
  if (sale && ((world.commodityMarket?.multipliers?.[sale] || 1) >= 1.2 || country.commodityStorage[sale] >= 6)) {
    performExtractionAction(world, country, { id: 'sell', commodity: sale });
  }
  if (r < .16) {
    const license = botSites.filter((site) => !site.ownerCode && site.purchaseCost <= country.treasury * .48).sort((a, b) => a.purchaseCost - b.purchaseCost)[0];
    if (license) performExtractionAction(world, country, { id: 'buy', target: country.code, siteId: license.id });
  }
  if (country.atWar.length) {
    const enemy = world.countries[country.atWar[0]];
    const war = enemy && activeWarFor(world, country.code, enemy.code);
    const side = war && (war.a === country.code ? 'a' : 'b');
    if (war && side && war.supporters[side].length < 2 && r < .2) {
      const candidate = Object.values(world.countries)
        .filter((ally) => ally.isBot && ally.code !== country.code && ally.code !== enemy.code && !countryBusyInWar(world, ally.code) && getRelation(world, country.code, ally.code) >= 55)
        .sort((a, b) => getRelation(world, country.code, b.code) - getRelation(world, country.code, a.code))[0];
      if (candidate && country.treasury >= supportCost(candidate)) {
        joinWarSupport(world, war, side, country, candidate, supportCost(candidate));
        return;
      }
    }
    country.army.readiness = clamp(country.army.readiness + 1.5, 0, 100);
    country.army.defense = clamp(country.army.defense + .5, 0, 100);
    country.lastAction = 'Армия укрепляет фронт и готовит оборону';
    return;
  }
  if (r < .07 && Object.values(country.advisors || {}).length < 3) {
    const candidate = Object.entries(ADVISORS).find(([id,item]) => !Object.values(country.advisors).includes(id) && country.treasury >= item.cost);
    if (candidate) {
      const [id,item] = candidate; country.treasury = round(country.treasury - item.cost, 1); country.advisors[item.role] = id;
      country.lastAction = `В правительство приглашён советник ${item.name}`;
      return;
    }
  }
  if (r < .13) {
    const candidates = Object.entries(UNIT_PROGRAMS).filter(([,item]) => (!item.naval || !meta.landlocked) && country.treasury >= item.cost && Object.entries(item.resources).every(([id,value]) => country.resources[id] >= value));
    const candidate = candidates[Math.floor(r * 10000) % Math.max(1, candidates.length)];
    if (candidate) {
      const [id,item] = candidate; spend(country,item.cost); spendResources(country,item.resources); country.units[id] = clamp(round(country.units[id] + item.gain,1),0,100);
      country.lastAction = `Развёрнута программа «${item.name}»`;
      return;
    }
  }
  if (r < 0.18) {
    const availableTech = TECHNOLOGY_TREE.flatMap((branch) => branch.nodes)
      .filter((node) => !country.techs[node.id] && (node.requires || []).every((id) => country.techs[id]))
      .sort((a, b) => a.tier - b.tier || a.cost - b.cost)
      .find((node) => country.techPoints >= node.cost && country.treasury >= node.money);
    if (availableTech) {
      country.techPoints = round(country.techPoints - availableTech.cost, 1);
      country.treasury = round(country.treasury - availableTech.money, 1);
      country.techs[availableTech.id] = world.turn;
      country.lastAction = `Освоена технология «${availableTech.name}»`;
      return;
    }
  }
  if (r < 0.70 && country.treasury >= 16) {
    const ids = Object.keys(DEVELOPMENT_ACTIONS);
    const id = ids[Math.floor(r * 1000) % ids.length];
    const item = DEVELOPMENT_ACTIONS[id];
    if (spend(country, item.cost)) {
      country[item.field] = clamp(country[item.field] + 1, 0, 100);
      country.gdp = round(country.gdp * 1.003, 1);
      country.lastAction = item.label;
    }
  } else if (r < 0.86 && meta.borders.length) {
    const targetCode = meta.borders[Math.floor(r * 1000) % meta.borders.length];
    if (world.countries[targetCode]) {
      const relation = changeRelation(world, country.code, targetCode, 2);
      if (relation >= 45 && !country.treaties.includes(`trade:${targetCode}`)) {
        country.treaties.push(`trade:${targetCode}`);
        const target = world.countries[targetCode];
        if (!target.treaties.includes(`trade:${country.code}`)) target.treaties.push(`trade:${country.code}`);
        country.lastAction = `Торговое соглашение с ${CATALOG_BY_CODE[targetCode]?.name || targetCode}`;
      } else country.lastAction = `Улучшение связей с ${CATALOG_BY_CODE[targetCode]?.name || targetCode}`;
    }
  } else if (r < 0.96 && country.treasury >= 20) {
    spend(country, 20); country.army.readiness = clamp(country.army.readiness + 1, 0, 100);
    country.army.equipment = clamp(country.army.equipment + 1, 0, 100);
    country.lastAction = 'Плановая модернизация вооружённых сил';
  } else {
    country.treasury += 3; country.lastAction = 'Формирование резервного фонда';
  }
}

function advanceStrategicSystems(world) {
  if (world.globalCrisis && world.turn > world.globalCrisis.endsAt) {
    const ended = GLOBAL_CRISES.find((item) => item.id === world.globalCrisis.id);
    if (ended) pushNews(world, `Мировой кризис «${ended.name}» завершён. Государства подсчитывают последствия.`, 'green');
    world.crisisHistory.unshift({ ...world.globalCrisis, endedAt: world.turn });
    world.crisisHistory = world.crisisHistory.slice(0, 12);
    world.globalCrisis = null;
  }
  if (!world.globalCrisis && world.turn % 5 === 0) {
    const recent = new Set(world.crisisHistory.slice(0, 2).map((item) => item.id));
    const available = GLOBAL_CRISES.filter((item) => !recent.has(item.id));
    const crisis = available[Math.floor(hashFloat(`${world.seed}:global-crisis:${world.turn}`) * available.length)] || GLOBAL_CRISES[0];
    world.globalCrisis = { id: crisis.id, name: crisis.name, startedAt: world.turn, endsAt: world.turn + crisis.duration - 1 };
    pushNews(world, `${crisis.icon} МИРОВОЙ КРИЗИС: ${crisis.name}. Каждое правительство должно выбрать собственный ответ.`, 'red');
  }
  const crisis = world.globalCrisis && GLOBAL_CRISES.find((item) => item.id === world.globalCrisis.id);

  world.tradeOffers = world.tradeOffers.filter((offer) => world.turn - offer.createdAt <= 3);
  world.allianceInvites = world.allianceInvites.filter((invite) => world.turn - invite.createdAt <= 4);
  world.tradeRoutes = world.tradeRoutes.filter((route) => route.status !== 'closed' || world.turn - (route.closedAt || world.turn) <= 8);
  for (const route of world.tradeRoutes) {
    const seller = world.countries[route.from]; const buyer = world.countries[route.to];
    if (!seller || !buyer || seller.eliminated || buyer.eliminated) { route.status = 'closed'; continue; }
    const blocked = seller.atWar.includes(buyer.code) || seller.sanctions.includes(buyer.code) || buyer.sanctions.includes(seller.code);
    if (blocked) { route.status = 'blocked'; continue; }
    if ((seller.resources[route.resource] || 0) < route.amount || buyer.treasury < route.price) { route.status = 'paused'; continue; }
    route.status = 'active';
    seller.resources[route.resource] = round(seller.resources[route.resource] - route.amount, 1);
    buyer.resources[route.resource] = clamp(round(buyer.resources[route.resource] + route.amount, 1), 0, 150);
    buyer.treasury = round(buyer.treasury - route.price, 1);
    const advisorTrade = advisorBonuses(seller).tradeIncome || 0;
    seller.treasury = round(seller.treasury + route.price * .88 + advisorTrade, 1);
    route.delivered = round((route.delivered || 0) + route.amount, 1); route.lastDeliveryTurn = world.turn;
  }

  for (const alliance of world.alliances) {
    const upkeep = alliance.members.length * 2;
    if (alliance.budget < upkeep) continue;
    alliance.budget = round(alliance.budget - upkeep, 1);
    for (const code of alliance.members) {
      const member = world.countries[code]; if (!member || member.eliminated) continue;
      member.influence = clamp(round(member.influence + .35, 2), 0, 100);
      member.army.readiness = clamp(round(member.army.readiness + .3, 2), 0, 100);
    }
  }

  for (const country of Object.values(world.countries)) {
    if (country.eliminated || country.absorbedBy) continue;
    const advisors = advisorBonuses(country);
    for (const id of Object.keys(STRATEGIC_RESOURCES)) country.resources[id] = clamp(round(country.resources[id] + country.resourceProduction[id], 1), 0, 150);
    const consumption = {
      food: clamp(1.4 + country.population / 160, 1.5, 10) * (crisis?.modifiers?.foodUse || 1),
      fuel: (1.2 + (country.atWar.length ? 3.8 : 0) + country.units.armor / 55 + country.units.airWings / 70) * (crisis?.modifiers?.fuelUse || 1),
      metals: .7 + (country.activeProject ? 1.4 : 0),
      rare: .35 + country.cyber / 180,
      energy: (1.8 + country.industry / 28 + country.cyber / 65) * (crisis?.modifiers?.energyUse || 1)
    };
    const shortages = [];
    for (const [id, amount] of Object.entries(consumption)) {
      country.resources[id] = round(country.resources[id] - amount, 1);
      if (country.resources[id] < 0) { shortages.push(id); country.resources[id] = 0; }
    }
    if (shortages.length) {
      country.happiness = clamp(round(country.happiness - shortages.length * 1.4, 1), 0, 100);
      country.stability = clamp(round(country.stability - shortages.length * .7, 1), 0, 100);
      country.army.readiness = clamp(round(country.army.readiness - (shortages.includes('fuel') ? 2 : .4), 1), 0, 100);
      country.lastShortage = { resources: shortages, turn: world.turn };
    } else country.lastShortage = null;

    if (crisis?.modifiers?.incomePct) country.treasury = round(Math.max(0, country.treasury + incomeFor(country) * crisis.modifiers.incomePct), 1);
    if (crisis?.modifiers?.happinessPerTurn) country.happiness = clamp(round(country.happiness + crisis.modifiers.happinessPerTurn, 1), 0, 100);
    if (crisis?.modifiers?.cyberPenalty) country.cyber = clamp(round(country.cyber - crisis.modifiers.cyberPenalty, 2), 0, 100);
    country.stability = clamp(round(country.stability + (advisors.stabilityPerTurn || 0), 2), 0, 100);
    country.influence = clamp(round(country.influence + (advisors.influencePerTurn || 0), 2), 0, 100);

    const routes = world.tradeRoutes.filter((route) => route.status === 'active' && (route.from === country.code || route.to === country.code)).length;
    country.factions.people = clamp(round(country.factions.people + clamp((country.happiness - 58) / 32 - Math.max(0, country.taxRate - 29) / 22, -2.5, 2.2), 1), 0, 100);
    country.factions.business = clamp(round(country.factions.business + clamp((country.industry - 48) / 65 + routes * .18 - (country.atWar.length ? .6 : 0), -2, 2.3), 1), 0, 100);
    country.factions.military = clamp(round(country.factions.military + clamp((country.army.readiness - 52) / 60 + (country.atWar.length ? .25 : 0), -1.8, 2), 1), 0, 100);
    country.factions.elites = clamp(round(country.factions.elites + clamp((country.stability - 58) / 70, -1.5, 1.5), 1), 0, 100);
    const oppositionChange = clamp((55 - country.happiness) / 30 + (55 - country.stability) / 32 + country.warExhaustion / 95 + Math.max(0, country.taxRate - 30) / 18 - (advisors.oppositionControl || 0), -2, 4);
    country.factions.opposition = clamp(round(country.factions.opposition + oppositionChange, 1), 0, 100);
    country.media.credibility = clamp(round(country.media.credibility + (country.lastMediaTurn === world.turn ? 0 : .25) - country.media.propaganda / 500, 1), 0, 100);
    country.media.propaganda = clamp(round(country.media.propaganda - .5, 1), 0, 100);
    country.media.warSupport = clamp(round(country.media.warSupport + (country.atWar.length ? -country.warExhaustion / 90 : (50 - country.media.warSupport) * .08), 1), 0, 100);

    if (country.factions.opposition >= 80 && !country.politicalCrisis) {
      country.politicalCrisis = { id: country.factions.opposition >= 92 ? 'coup_risk' : 'mass_protests', startedAt: world.turn };
      country.stability = clamp(round(country.stability - 7, 1), 0, 100);
      pushNews(world, `${CATALOG_BY_CODE[country.code].name}: массовые протесты перерастают в острый политический кризис.`, 'red');
    }
    if (country.isBot && country.politicalCrisis) {
      country.factions.opposition = clamp(round(country.factions.opposition - 16, 1), 0, 100);
      country.stability = clamp(round(country.stability + 3, 1), 0, 100);
      country.treasury = round(Math.max(0, country.treasury - 18), 1); country.politicalCrisis = null;
    }
    if (country.isBot && crisis && !country.crisisChoices[crisis.id]) {
      const choices = crisis.options.filter((option) => (!option.cost || country.treasury >= option.cost) && Object.entries(option.resources || {}).every(([id,value]) => value >= 0 || country.resources[id] >= Math.abs(value)));
      const option = choices[Math.floor(hashFloat(`${world.seed}:bot-crisis:${world.turn}:${country.code}`) * Math.max(1, choices.length))];
      if (option) { if (option.cost) spend(country, option.cost); applyStrategicEffects(country, option); country.crisisChoices[crisis.id] = { option: option.id, turn: world.turn }; }
    }
  }
}

function completeProject(world, country) {
  const project = NATIONAL_PROJECTS[country.activeProject?.id];
  if (!project) { country.activeProject = null; return; }
  for (const [key, value] of Object.entries(project.rewards)) {
    if (key === 'gdpPct') country.gdp = round(country.gdp * (1 + value), 1);
    else if (key === 'equipment' || key === 'defense') country.army[key] = clamp(country.army[key] + value, 0, 100);
    else country[key] = clamp(country[key] + value, 0, 100);
  }
  country.completedProjects.push(country.activeProject.id);
  country.activeProject = null;
  const meta = CATALOG_BY_CODE[country.code];
  country.lastAction = `Завершён проект «${project.name}»`;
  pushNews(world, `${meta.name} завершает национальный проект «${project.name}».`, 'green');
}

function assignDecision(world, country) {
  if (country.pendingDecision || country.isBot) return;
  const available = DECISIONS.filter((decision) => !country.decisionHistory.slice(-3).some((item) => item.id === decision.id));
  const index = Math.floor(hashFloat(`${world.seed}:decision:${world.turn}:${country.code}`) * available.length);
  country.pendingDecision = available[index]?.id || DECISIONS[0].id;
}

function advanceTurn(world) {
  migrateWorld(world);
  world.turn += 1;
  world.warInvites = world.warInvites.filter((invite) => world.turn - invite.createdAt <= 3 && world.wars.some((war) => war.id === invite.warId && war.status === 'active'));
  world.quarter += 1;
  if (world.quarter > 4) { world.quarter = 1; world.year += 1; }
  for (const country of Object.values(world.countries)) {
    if (country.eliminated || country.absorbedBy) continue;
    const tech = technologyBonuses(country);
    country.treasury = round(country.treasury + incomeFor(country), 1);
    const focusBonus = { economy: 'industry', science: 'science', defense: null, welfare: 'healthcare' }[country.focus];
    if (focusBonus) country[focusBonus] = clamp(country[focusBonus] + 0.35, 0, 100);
    if (country.focus === 'defense') country.army.readiness = clamp(country.army.readiness + 0.35, 0, 100);
    country.gdp = round(country.gdp * (1 + (country.stability - 45) / 10000), 1);
    country.happiness = clamp(round(country.happiness + (country.taxRate <= 24 ? 0.2 : -0.1), 1), 0, 100);
    country.techPoints = round(country.techPoints + 1 + country.science / 100 + (tech.developmentPoints || 0), 1);
    country.science = clamp(round(country.science + (tech.sciencePerTurn || 0), 2), 0, 100);
    country.cyber = clamp(round(country.cyber + (tech.cyberPerTurn || 0), 2), 0, 100);
    country.industry = clamp(round(country.industry + (tech.industryPerTurn || 0), 2), 0, 100);
    country.stability = clamp(round(country.stability + (tech.stabilityPerTurn || 0), 2), 0, 100);
    country.happiness = clamp(round(country.happiness + (tech.happinessPerTurn || 0), 2), 0, 100);
    country.influence = clamp(round(country.influence + (tech.influencePerTurn || 0), 2), 0, 100);
    country.reputation = clamp(round(country.reputation + (country.lastTheftTurn === world.turn - 1 ? 0 : .25), 2), 0, 100);
    country.population = round(country.population * (1 + (tech.populationGrowth || 0)), 2);
    const logistics = 3 + country.infrastructure / 25 + country.industry / 35 + (tech.supplyPerTurn || 0);
    country.army.supplies = clamp(round(country.army.supplies + logistics, 1), 0, 100);
    country.army.morale = clamp(round(country.army.morale + (country.atWar.length ? .4 : 2.2) - country.warExhaustion / 80, 1), 0, 100);
    country.army.reserve = clamp(round(country.army.reserve + .35 + (tech.reservePerTurn || 0), 1), 0, 999);
    country.warExhaustion = clamp(round(country.warExhaustion - (country.atWar.length || country.supportingWarId ? .8 : 4), 1), 0, 100);
    if (country.atWar.length && country.warExhaustion > 45) {
      country.happiness = clamp(round(country.happiness - country.warExhaustion / 220, 1), 0, 100);
      country.stability = clamp(round(country.stability - country.warExhaustion / 300, 1), 0, 100);
    }
    country.army.readiness = clamp(round(country.army.readiness + (tech.readinessPerTurn || 0), 2), 0, 100);
    country.army.air = clamp(round(country.army.air + (tech.airPerTurn || 0), 2), 0, 100);
    country.army.defense = clamp(round(country.army.defense + (tech.defensePerTurn || 0), 2), 0, 100);
    const passiveReinforcement = Math.min(country.army.reserve, tech.manpowerPerTurn || 0);
    country.army.manpower = clamp(round(country.army.manpower + passiveReinforcement, 2), 0, 999);
    country.army.reserve = clamp(round(country.army.reserve - passiveReinforcement, 2), 0, 999);
    if (country.activeProject) {
      country.activeProject.remaining -= 1 + (tech.projectSpeed || 0);
      if (country.activeProject.remaining <= 0) completeProject(world, country);
    }
    if (!country.isBot && world.turn % 3 === 0) assignDecision(world, country);
    if (world.turn % 6 === 0) {
      const assetIds = Object.keys(STEALABLE_ASSETS);
      const assetId = assetIds[Math.floor(hashFloat(`${world.seed}:vault-restock:${world.turn}:${country.code}`) * assetIds.length)];
      country.vault[assetId] = Math.min(3, (country.vault[assetId] || 0) + 1);
    }
    if (country.isBot) botTurn(world, country);
  }
  advanceStrategicSystems(world);
  for (const occupied of Object.values(world.countries)) {
    const controller = world.countries[occupied.occupation?.by];
    if (!controller || controller.eliminated || occupied.eliminated || !occupied.occupation?.permanent || occupied.occupation?.absorbed || occupied.occupation?.revolt || !occupied.occupation?.percent) continue;
    const tributeRate = clamp(occupied.occupation.tributeRate ?? .10, .04, .18);
    const tribute = round(Math.min(occupied.treasury, incomeFor(occupied) * occupied.occupation.percent / 100 * tributeRate), 1);
    if (tribute <= 0) continue;
    occupied.treasury = round(occupied.treasury - tribute, 1);
    controller.treasury = round(controller.treasury + tribute, 1);
    occupied.lastTribute = { to: controller.code, amount: tribute, turn: world.turn };
  }
  if (world.turn % 3 === 0) pushNews(world, `Мировая экономика завершила ${world.quarter} квартал ${world.year} года. Дипломатия остаётся главным инструментом держав.`, 'blue');
  world.nextTurnAt = Date.now() + 60000;
  calculateScores(world);
  for (const country of Object.values(world.countries)) {
    if (country.eliminated || country.victoryAchieved || country.victoryProgress < 100) continue;
    country.victoryAchieved = true;
    country.influence = clamp(round(country.influence + 12, 1), 0, 100);
    country.reputation = clamp(round(country.reputation + 8, 1), 0, 100);
    world.hallOfFame.unshift({ code: country.code, path: country.victoryPath, turn: world.turn, year: world.year, quarter: world.quarter });
    world.hallOfFame = world.hallOfFame.slice(0, 20);
    pushNews(world, `${CATALOG_BY_CODE[country.code].flag} ${CATALOG_BY_CODE[country.code].name} достигает стратегической победы: «${VICTORY_PATHS[country.victoryPath].name}». Мир вступает в новую эпоху соперничества.`, 'gold');
  }
}

function ranking(world) {
  return Object.values(world.countries)
    .filter((country) => !country.eliminated && !country.absorbedBy)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((c, index) => ({ rank: index + 1, code: c.code, score: c.score }));
}

module.exports = {
  CATALOG, CATALOG_BY_CODE, DEVELOPMENT_ACTIONS, MILITARY_ACTIONS, BATTLE_TACTICS, MILITARY_DOCTRINES, TECHNOLOGY_TREE, NATIONAL_PROJECTS, DECISIONS, STEALABLE_ASSETS, PLAYER_NEWS_CATEGORIES,
  STRATEGIC_RESOURCES, EXTRACTION_COMMODITIES, COMMODITY_MARKET_INTERVAL_MS, POLITICAL_FACTIONS, ADVISORS, UNIT_PROGRAMS, GLOBAL_CRISES, VICTORY_PATHS, WAR_TERRAINS,
  createWorld, migrateWorld, selectCountry, performAction, advanceTurn, advanceWars, advanceResistance, calculateScores,
  getRelation, incomeFor, militaryPower, ranking, clamp, technologyBonuses, theftChance, hostileCooldownRemaining, politicalSupport,
  commodityMarketForTime, updateCommodityMarket, initialExtractionSites, accrueExtractionSite, extractionRate, extractionCapacity, extractionUpgradeCost, performExtractionAction
};
