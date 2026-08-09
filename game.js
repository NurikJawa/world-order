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
  green_transition: { name: 'Зелёный переход', icon: '❋', cost: 96, duration: 4, description: 'Возобновляемая энергетика и восстановление экосистем.', rewards: { energy: 9, happiness: 4, influence: 3 } }
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
    news: [{ id: crypto.randomUUID(), turn: 1, tone: 'blue', text: 'Началась новая эпоха мировой политики. Все государства выбрали осторожный курс.' }],
    nextTurnAt: Date.now() + 60000
  };
  calculateScores(world);
  return world;
}

function migrateWorld(world) {
  world.relations ||= {};
  world.wars ||= [];
  world.warInvites ||= [];
  for (const country of Object.values(world.countries || {})) {
    country.army ||= {};
    country.army.reserve ??= round(clamp((country.population || 1) * 1.2, 8, 999), 1);
    country.army.supplies ??= 78;
    country.army.morale ??= clamp(country.happiness || 65, 25, 90);
    country.army.experience ??= 15;
    country.army.medical ??= 12;
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
    country.absorbedBy ??= country.defeated && country.controllerCode && country.occupation?.percent >= 100 ? country.controllerCode : null;
    country.eliminated ??= Boolean(country.absorbedBy);
    if (country.occupation) {
      country.occupation.resistance ??= round(clamp(12 + country.occupation.percent * .28, 8, 70), 1);
      country.occupation.resistanceChecks ??= 0;
      country.occupation.nextResistanceAt ??= Date.now() + 12000;
      country.occupation.revolt ??= null;
    }
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
  if (!winner.annexed.includes(loser.code)) winner.annexed.push(loser.code);
  for (const territory of Object.values(world.countries)) {
    if (territory.code === loser.code) continue;
    if (territory.absorbedBy === loser.code) {
      territory.absorbedBy = winner.code;
      territory.controllerCode = winner.code;
      if (territory.occupation) territory.occupation.by = winner.code;
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
  return militaryPower(country) * member.fraction * mode * technology * exhaustion * roleCoordination;
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
    const saved = clamp((tech.manpowerSave || 0) + medicalSave, 0, .65);
    const losses = Math.min(country.army.manpower, totalLosses * share * (1 - saved));
    actualLosses += losses;
    country.army.manpower = clamp(round(country.army.manpower - losses, 1), 0, 999);
    country.army.equipment = clamp(round(country.army.equipment - equipmentLoss * share, 1), 0, 100);
    const memberSupplyUse = member.role === 'main' ? supplyUse : supplyUse * Math.max(.35, member.fraction);
    country.army.supplies = clamp(round(country.army.supplies - memberSupplyUse, 1), 0, 100);
    country.army.morale = clamp(round(country.army.morale + moraleDelta, 1), 0, 100);
    country.army.experience = clamp(round(country.army.experience + experienceGain, 1), 0, 100);
    country.army.readiness = clamp(round(country.army.readiness - Math.max(1, supplyUse * .2), 1), 0, 100);
  }
  return round(actualLosses, 1);
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
  war.kind ||= 'territorial'; war.surgeCooldowns ||= { a: 0, b: 0 }; war.weather ||= 'clear';
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
  a.power *= weather.power; b.power *= weather.power;
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
  const movement = round(clamp((.14 + Math.abs(pressure) * .92 + Math.abs(Math.log2(Math.max(.05, troopRatio))) * .12) * captureMultiplier * weather.capture * breakthrough, .1, 2.65), 1);
  const previousFront = war.front;
  war.front = round(clamp(war.front + (winningSide === 'a' ? movement : -movement), -100, 100), 1);
  if (war.kind === 'uprising') war.front = Math.max(0, war.front);

  const intensity = .0011 + clamp(Math.abs(pressure) * .00045, 0, .0012);
  const aLossPool = Math.max(.02, a.offense.troops * intensity * clamp(b.power / Math.max(1, a.power), .62, 1.9));
  const bLossPool = Math.max(.02, b.offense.troops * intensity * clamp(a.power / Math.max(1, b.power), .62, 1.9));
  const aLosses = applyCoalitionLosses(a.members, aLossPool, .045, .11 * weather.supply, winningSide === 'a' ? .12 : -.18, .08);
  const bLosses = applyCoalitionLosses(b.members, bLossPool, .045, .11 * weather.supply, winningSide === 'b' ? .12 : -.18, .08);
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
    supplyUsed: round(.11 * weather.supply, 2), distancePenalty: round((1 - winner.distance) * 100), weather: war.weather
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
    surgeCooldowns: { a: 0, b: 0 }, surge: null, weather: 'clear', weatherChangedAtTick: 0
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
  world.news.unshift({ id: crypto.randomUUID(), turn: world.turn, tone, text });
  world.news = world.news.slice(0, 24);
}

function incomeFor(country) {
  if (country.eliminated || country.absorbedBy) return 0;
  const base = Math.sqrt(country.gdp) * 0.7;
  const systems = (country.industry + country.infrastructure + country.energy) / 210;
  const taxes = country.taxRate / 24;
  const warPenalty = country.atWar.length ? .72 : country.supportingWarId ? .88 : 1;
  const bonuses = technologyBonuses(country);
  const tradeDeals = country.treaties.filter((treaty) => treaty.startsWith('trade:')).length;
  const tradeMultiplier = 1 + tradeDeals * (.015 + (bonuses.tradeBonus || 0) * .01);
  const occupationPenalty = 1 - clamp((country.occupation?.percent || 0) * .004, 0, .4);
  return round(clamp(base * systems * taxes * warPenalty * occupationPenalty * tradeMultiplier * (1 + (bonuses.incomePct || 0)), 3, 180), 1);
}

function militaryPower(c) {
  const raw = c.army.manpower * .55 + c.army.equipment * .9 + c.army.readiness * .5 + c.army.air * .7 + c.army.navy * .35 + c.army.defense * .5;
  const condition = (.78 + (c.army.morale ?? 60) / 450) * (.82 + (c.army.supplies ?? 60) / 550) * (1 + (c.army.experience ?? 0) / 500);
  return Math.round(raw * condition);
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
    const progress = Object.keys(country.techs || {}).length * 5 + (country.completedProjects?.length || 0) * 12;
    const territory = Math.sqrt(Math.max(1, country.territoryArea)) / 18;
    country.score = country.eliminated ? 0 : Math.round(country.gdp * 0.025 + country.stability + country.happiness + country.influence * 1.5 + country.reputation * .45 + country.police * .2 + country.militaryPower * 0.45 + progress + territory);
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

function performAction(world, player, message) {
  migrateWorld(world);
  const country = world.countries[player.countryCode];
  if (!country) return { ok: false, error: 'Сначала выберите страну' };
  if (country.eliminated || country.absorbedBy) return { ok: false, error: `Ваша страна полностью присоединена к государству ${CATALOG_BY_CODE[country.absorbedBy]?.name || country.absorbedBy}. Вы продолжаете наблюдать за миром.` };
  const meta = CATALOG_BY_CODE[country.code];

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

  if (message.action === 'occupation') {
    const occupation = target.occupation;
    if (!occupation || occupation.by !== country.code || !occupation.permanent || occupation.absorbed) return { ok: false, error: 'У вас нет закреплённой оккупации этой страны' };
    if (message.id === 'release') {
      if (activeWarFor(world, country.code, target.code)) return { ok: false, error: 'Сначала завершите активные бои' };
      releaseOccupation(world, country, target, 'released');
      pushNews(world, `${meta.name} возвращает независимость государству ${targetMeta.name}. Оккупационный режим прекращён.`, 'green');
      return { ok: true, toast: 'Страна освобождена · репутация +6 · доверие +28' };
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
    if (!spend(country, 12)) return { ok: false, error: 'Для операции нужно 12 млрд' };
    const chance = clamp(38 + country.cyber * 0.55 - target.cyber * 0.32 + (technologyBonuses(country).intelPct || 0) * 100, 15, 92);
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
      const war = { id: crypto.randomUUID(), kind: 'territorial', a: country.code, b: target.code, front: occupiedFront(world, country.code, target.code), status: 'active', startedAt: world.turn, startedAtMs: Date.now(), nextBattleAt: Date.now() + 900, battleTicks: 0, lastReportedMilestone: '', operations: 0, lastOperation: null, supporters: { a: [], b: [] }, operationsByTurn: {}, battles: [], casualties: { a: 0, b: 0 }, surgeCooldowns: { a: 0, b: 0 }, surge: null, weather: 'clear', weatherChangedAtTick: 0 };
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
  for (const occupied of Object.values(world.countries)) {
    const controller = world.countries[occupied.occupation?.by];
    if (!controller || controller.eliminated || occupied.eliminated || !occupied.occupation?.permanent || occupied.occupation?.absorbed || occupied.occupation?.revolt || !occupied.occupation?.percent) continue;
    const tribute = round(Math.min(occupied.treasury, incomeFor(occupied) * occupied.occupation.percent / 100 * .10), 1);
    if (tribute <= 0) continue;
    occupied.treasury = round(occupied.treasury - tribute, 1);
    controller.treasury = round(controller.treasury + tribute, 1);
    occupied.lastTribute = { to: controller.code, amount: tribute, turn: world.turn };
  }
  if (world.turn % 3 === 0) pushNews(world, `Мировая экономика завершила ${world.quarter} квартал ${world.year} года. Дипломатия остаётся главным инструментом держав.`, 'blue');
  world.nextTurnAt = Date.now() + 60000;
  calculateScores(world);
}

function ranking(world) {
  return Object.values(world.countries)
    .filter((country) => !country.eliminated && !country.absorbedBy)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((c, index) => ({ rank: index + 1, code: c.code, score: c.score }));
}

module.exports = {
  CATALOG, CATALOG_BY_CODE, DEVELOPMENT_ACTIONS, MILITARY_ACTIONS, BATTLE_TACTICS, MILITARY_DOCTRINES, TECHNOLOGY_TREE, NATIONAL_PROJECTS, DECISIONS, STEALABLE_ASSETS,
  createWorld, migrateWorld, selectCountry, performAction, advanceTurn, advanceWars, advanceResistance, calculateScores,
  getRelation, incomeFor, militaryPower, ranking, clamp, technologyBonuses, theftChance, hostileCooldownRemaining
};
