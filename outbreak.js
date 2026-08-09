const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const worldCountries = require('world-countries');
const { CATALOG } = require('./game');
const { COUNTRY_POPULATIONS } = require('./country-populations');
const { resumeHash } = require('./recovery');

const MAX_PLAYERS = 10;
const MAX_TEAM_PLAYERS = 5;
const TICK_MS = 1500;
const TEAM_NAMES = { pathogen: 'Синдикат патогена', response: 'Глобальный штаб' };

const PATHOGEN_UPGRADES = [
  { id: 'transmission', name: 'Передача', icon: '⌁', color: '#ff5f72', nodes: [
    { id: 'microdroplets', name: 'Микрокапельная взвесь', cost: 8, effectText: '+18% заражаемость', effect: { infectivity: .18 } },
    { id: 'surface_shell', name: 'Стойкая оболочка', cost: 11, requires: ['microdroplets'], effectText: '+16% заражаемость, устойчивость к ограничениям', effect: { infectivity: .16, containmentResistance: .1 } },
    { id: 'water_cycle', name: 'Водный цикл', cost: 14, requires: ['surface_shell'], effectText: 'Усиление морских и бедных регионов', effect: { infectivity: .13, water: .32 } },
    { id: 'silent_carriers', name: 'Скрытые носители', cost: 18, requires: ['water_cycle'], effectText: '+20% скрытность и международное распространение', effect: { stealth: .2, travel: .25 } },
    { id: 'global_vector', name: 'Глобальный вектор', cost: 25, requires: ['silent_carriers'], effectText: '+32% заражаемость и авиационная передача', effect: { infectivity: .32, travel: .35 } }
  ] },
  { id: 'symptoms', name: 'Симптомы', icon: 'ϟ', color: '#ff9c65', nodes: [
    { id: 'fever', name: 'Лихорадочный синдром', cost: 7, effectText: '+8% тяжесть, болезнь заметнее', effect: { severity: .08, stealth: -.05 } },
    { id: 'lung_injury', name: 'Поражение дыхания', cost: 12, requires: ['fever'], effectText: '+17% тяжесть, +1,2% летальность', effect: { severity: .17, lethality: .012 } },
    { id: 'vascular_storm', name: 'Сосудистый шторм', cost: 18, requires: ['lung_injury'], effectText: '+20% тяжесть, +2,2% летальность', effect: { severity: .2, lethality: .022 } },
    { id: 'neural_collapse', name: 'Нейронный коллапс', cost: 25, requires: ['vascular_storm'], effectText: '+3,5% летальность, снижает соблюдение мер', effect: { lethality: .035, complianceDamage: .18 } },
    { id: 'systemic_failure', name: 'Системный отказ', cost: 34, requires: ['neural_collapse'], effectText: '+6% летальность, перегружает больницы', effect: { lethality: .06, careResistance: .25 } }
  ] },
  { id: 'adaptation', name: 'Адаптация', icon: '✣', color: '#b875ff', nodes: [
    { id: 'cold_tolerance', name: 'Холодовая устойчивость', cost: 8, effectText: 'Лучшее распространение в холодном климате', effect: { cold: .35 } },
    { id: 'heat_tolerance', name: 'Тепловая устойчивость', cost: 8, effectText: 'Лучшее распространение в жарком климате', effect: { heat: .35 } },
    { id: 'drug_resistance', name: 'Лекарственная устойчивость', cost: 15, requiresAny: ['cold_tolerance', 'heat_tolerance'], effectText: 'Лечение на 24% слабее', effect: { medicineResistance: .24 } },
    { id: 'antigen_drift', name: 'Антигенный дрейф', cost: 21, requires: ['drug_resistance'], effectText: 'Замедляет исследование вакцины', effect: { researchResistance: .22 } },
    { id: 'genomic_veil', name: 'Геномная маскировка', cost: 29, requires: ['antigen_drift'], effectText: '+30% скрытность, вакцина менее эффективна', effect: { stealth: .3, vaccineEscape: .22 } }
  ] }
];

const RESPONSE_UPGRADES = [
  { id: 'detection', name: 'Наблюдение', icon: '◎', color: '#54d9ff', nodes: [
    { id: 'diagnostic_network', name: 'Диагностическая сеть', cost: 8, effectText: '+28% скорость обнаружения', effect: { detection: .28 } },
    { id: 'open_surveillance', name: 'Открытый обмен данными', cost: 12, requires: ['diagnostic_network'], effectText: '+22% обнаружение, +4 доверие', effect: { detection: .22, trust: 4 } },
    { id: 'genomic_sentinels', name: 'Геномные дозоры', cost: 17, requires: ['open_surveillance'], effectText: 'Раскрывает адаптации патогена', effect: { detection: .18, intelligence: 1 } },
    { id: 'predictive_grid', name: 'Предиктивная сеть', cost: 24, requires: ['genomic_sentinels'], effectText: '+35% обнаружение и ранние предупреждения', effect: { detection: .35, intelligence: 1 } }
  ] },
  { id: 'containment', name: 'Сдерживание', icon: '⬡', color: '#66e0b2', nodes: [
    { id: 'local_tracing', name: 'Локальный трейсинг', cost: 9, effectText: '+15% эффективность мер', effect: { containment: .15 } },
    { id: 'rapid_teams', name: 'Мобильные бригады', cost: 13, requires: ['local_tracing'], effectText: 'Действия по странам дешевле на 15%', effect: { containment: .12, actionDiscount: .15 } },
    { id: 'isolation_hubs', name: 'Центры изоляции', cost: 18, requires: ['rapid_teams'], effectText: '+22% сдерживание, меньше тяжёлых случаев', effect: { containment: .22, care: .08 } },
    { id: 'adaptive_protocol', name: 'Адаптивный протокол', cost: 26, requires: ['isolation_hubs'], effectText: '+30% сдерживание без сильного удара по доверию', effect: { containment: .3, trustProtection: .35 } }
  ] },
  { id: 'medicine', name: 'Медицина', icon: '✚', color: '#77a8ff', nodes: [
    { id: 'surge_beds', name: 'Резерв коек', cost: 9, effectText: '-16% смертность при перегрузке', effect: { care: .16 } },
    { id: 'antiviral_protocol', name: 'Противовирусный протокол', cost: 14, requires: ['surge_beds'], effectText: '+18% выздоровление, -10% смертность', effect: { recovery: .18, care: .1 } },
    { id: 'oxygen_reserve', name: 'Кислородный резерв', cost: 19, requires: ['antiviral_protocol'], effectText: '-20% тяжёлые исходы', effect: { care: .2 } },
    { id: 'mortality_shield', name: 'Щит интенсивной терапии', cost: 27, requires: ['oxygen_reserve'], effectText: '-32% смертность', effect: { care: .32 } }
  ] },
  { id: 'vaccine', name: 'Вакцина', icon: '⌬', color: '#e0c36b', nodes: [
    { id: 'platform_labs', name: 'Платформенные лаборатории', cost: 10, effectText: '+20% исследования', effect: { research: .2 } },
    { id: 'parallel_trials', name: 'Параллельные испытания', cost: 15, requires: ['platform_labs'], effectText: '+28% исследования', effect: { research: .28 } },
    { id: 'mass_manufacturing', name: 'Массовое производство', cost: 21, requires: ['parallel_trials'], effectText: '+55% выпуск доз', effect: { production: .55 } },
    { id: 'cold_chain', name: 'Планетарная холодовая цепь', cost: 28, requires: ['mass_manufacturing'], effectText: '+45% распределение, вакцина эффективнее', effect: { distribution: .45, vaccinePower: .12 } }
  ] }
];

const SPECIALTIES = {
  pathogen: [
    { id: 'vector', name: 'Архитектор передачи', icon: '⌁', ability: 'route_jump', abilityName: 'Транспортный скачок', description: 'Раз в 90 секунд создаёт очаг в выбранной стране.' },
    { id: 'geneticist', name: 'Генетик', icon: '✣', ability: 'dna_harvest', abilityName: 'Генный урожай', description: 'Раз в 90 секунд даёт команде 12 очков мутации.' },
    { id: 'shadow', name: 'Специалист маскировки', icon: '◌', ability: 'blind_spot', abilityName: 'Слепая зона', description: 'Сбрасывает обнаружение в выбранной стране.' },
    { id: 'disruptor', name: 'Диверсант', icon: 'ϟ', ability: 'lab_blackout', abilityName: 'Сбой лабораторий', description: 'Замедляет глобальное исследование вакцины.' },
    { id: 'architect', name: 'Архитектор резервуара', icon: '◇', ability: 'stable_reservoir', abilityName: 'Скрытый резервуар', description: 'На 35 дней защищает очаг от выздоровления.' }
  ],
  response: [
    { id: 'epidemiologist', name: 'Эпидемиолог', icon: '◎', ability: 'deep_scan', abilityName: 'Глубокий скрининг', description: 'Мгновенно раскрывает ситуацию в выбранной стране.' },
    { id: 'clinician', name: 'Полевой врач', icon: '✚', ability: 'medical_surge', abilityName: 'Медицинский резерв', description: 'Экстренно разворачивает два уровня госпиталей.' },
    { id: 'researcher', name: 'Исследователь', icon: '⌬', ability: 'research_sprint', abilityName: 'Научный спринт', description: 'Добавляет 9% к исследованию вакцины.' },
    { id: 'coordinator', name: 'Координатор', icon: '⬡', ability: 'supply_drop', abilityName: 'Глобальная логистика', description: 'Даёт штабу 20 оперативных очков.' },
    { id: 'communicator', name: 'Коммуникатор', icon: '◈', ability: 'trust_campaign', abilityName: 'Честный брифинг', description: 'Восстанавливает 14 пунктов мирового доверия.' }
  ]
};

const COUNTRY_ACTIONS = {
  pathogen: [
    { id: 'aerosol_burst', name: 'Аэрозольный выброс', icon: '⌁', cost: 13, description: 'Усиливает заражение в стране и создаёт экспортные случаи.' },
    { id: 'silent_wave', name: 'Тихая волна', icon: '◌', cost: 15, description: 'Снижает обнаружение и временно повышает скрытность.' },
    { id: 'relapse', name: 'Рецидив', icon: '↻', cost: 18, description: 'Возвращает часть выздоровевших в активную фазу.' },
    { id: 'research_interference', name: 'Антигенная помеха', icon: 'ϟ', cost: 22, description: 'Отбрасывает глобальное исследование вакцины.' }
  ],
  response: [
    { id: 'scan', name: 'Массовый скрининг', icon: '◎', cost: 6, description: 'Резко повышает точность данных о стране.' },
    { id: 'testing', name: 'Развернуть тестирование', icon: '⌬', cost: 8, description: 'Постоянно ускоряет обнаружение случаев.' },
    { id: 'tracing', name: 'Контактный трейсинг', icon: '⌁', cost: 10, description: 'Снижает внутреннюю передачу инфекции.' },
    { id: 'hospital', name: 'Полевой госпиталь', icon: '✚', cost: 12, description: 'Повышает вместимость и снижает смертность.' },
    { id: 'restrictions', name: 'Временные ограничения', icon: '⬡', cost: 14, description: 'Сильно режет заражение ценой мирового доверия.' },
    { id: 'close_borders', name: 'Пограничный протокол', icon: '║', cost: 16, description: 'Снижает завозные случаи ценой доверия.' },
    { id: 'vaccine_campaign', name: 'Кампания вакцинации', icon: '✣', cost: 10, description: 'Отправляет доступные дозы в выбранную страну.' }
  ]
};

const GLOBAL_ACTIONS = {
  pathogen: [
    { id: 'mutation_drive', name: 'Мутационный драйв', cost: 20, description: 'На 20 дней повышает скорость накопления очков.' },
    { id: 'panic_signal', name: 'Информационный хаос', cost: 18, description: 'Снижает доверие и соблюдение мер по всему миру.' }
  ],
  response: [
    { id: 'fund_research', name: 'Экстренный грант', cost: 16, description: '+3,5% исследования вакцины.' },
    { id: 'public_briefing', name: 'Открытый брифинг', cost: 14, description: 'Восстанавливает мировое доверие.' },
    { id: 'global_procurement', name: 'Общий заказ', cost: 22, description: 'Ускоряет выпуск вакцины на 35 дней.' }
  ]
};

const RAW_COUNTRIES = Object.fromEntries(worldCountries.map((country) => [country.cca3, country]));
const UPGRADE_BY_ID = Object.fromEntries([...PATHOGEN_UPGRADES, ...RESPONSE_UPGRADES].flatMap((branch) => branch.nodes.map((node) => [node.id, node])));

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function round(value, digits = 0) { const power = 10 ** digits; return Math.round(value * power) / power; }
function hashFloat(key) {
  let hash = 2166136261;
  for (const char of String(key)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) / 4294967295;
}
function cleanText(value, length) { return String(value || '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, length); }
function countryPopulation(code) {
  const raw = RAW_COUNTRIES[code] || {};
  const fallback = Math.round(clamp((Number(raw.area) || 1) ** .48 * 22000, 20000, 180000000));
  return Math.max(20000, Number(COUNTRY_POPULATIONS[code]) || fallback);
}
function findSpecialty(team, id) { return SPECIALTIES[team]?.find((item) => item.id === id); }
function teamBonuses(teamState) {
  const result = {};
  for (const id of teamState.upgrades || []) {
    const node = UPGRADE_BY_ID[id];
    for (const [key, value] of Object.entries(node?.effect || {})) result[key] = (result[key] || 0) + value;
  }
  return result;
}

function createOutbreakWorld(seed) {
  const countries = {};
  for (const meta of CATALOG) {
    const raw = RAW_COUNTRIES[meta.code] || {};
    const population = countryPopulation(meta.code);
    const latitude = Math.abs(meta.latlng?.[0] || 20);
    const development = clamp(32 + hashFloat(`${seed}:health:${meta.code}`) * 54, 25, 88);
    countries[meta.code] = {
      code: meta.code, population, infected: 0, severe: 0, deaths: 0, recovered: 0, vaccinated: 0,
      detection: 0, healthcare: round(development, 1), compliance: round(43 + hashFloat(`${seed}:trust:${meta.code}`) * 43, 1),
      density: clamp(.75 + Math.log10(Math.max(1, population / Math.max(1, meta.area || raw.area || 1))) / 6, .75, 1.45),
      climate: latitude > 48 ? 'cold' : latitude < 20 ? 'hot' : 'temperate', hub: population > 45000000 || ['USA','GBR','FRA','DEU','ARE','SGP','JPN','AUS'].includes(meta.code),
      measures: { testing: 0, tracing: 0, hospital: 0, restrictions: 0, border: 0 },
      reservoirUntil: 0, stealthUntil: 0, lastAction: 'Обычная жизнь продолжается', known: false
    };
  }
  const originOptions = ['BRA', 'NGA', 'IND', 'CHN', 'USA', 'IDN', 'ZAF', 'MEX'];
  const originCode = originOptions[Math.floor(hashFloat(`${seed}:origin`) * originOptions.length)];
  const totalPopulation = Object.values(countries).reduce((sum, item) => sum + item.population, 0);
  return {
    version: 1, seed, status: 'lobby', winner: null, endReason: '', day: 0, nextTickAt: Date.now() + TICK_MS,
    originCode, pathogenName: 'NEXUS-0', countries, totalPopulation,
    pathogen: { points: 20, upgrades: [], mutationBoostUntil: 0, infectedCountries: 0, peakInfected: 0 },
    response: { points: 24, upgrades: [], trust: 78, research: 0, productionStock: 0, procurementUntil: 0, intelligence: 0 },
    totals: { infected: 0, severe: 0, deaths: 0, recovered: 0, vaccinated: 0, detectedCountries: 0, overloadedCountries: 0 },
    events: [{ id: crypto.randomUUID(), day: 0, tone: 'neutral', text: 'Глобальная система наблюдения работает в штатном режиме.' }],
    chat: [], milestones: {}, tick: 0
  };
}

function recalculateTotals(world) {
  const totals = { infected: 0, severe: 0, deaths: 0, recovered: 0, vaccinated: 0, detectedCountries: 0, overloadedCountries: 0 };
  for (const country of Object.values(world.countries)) {
    totals.infected += country.infected; totals.severe += country.severe; totals.deaths += country.deaths;
    totals.recovered += country.recovered; totals.vaccinated += country.vaccinated;
    if (country.known || country.detection >= 8) totals.detectedCountries += 1;
    const capacity = country.population * (.0012 + country.healthcare / 70000 + country.measures.hospital * .0007);
    if (country.severe > capacity) totals.overloadedCountries += 1;
  }
  for (const key of Object.keys(totals)) totals[key] = Math.round(totals[key]);
  world.totals = totals;
  world.pathogen.infectedCountries = Object.values(world.countries).filter((country) => country.infected >= 10).length;
  world.pathogen.peakInfected = Math.max(world.pathogen.peakInfected || 0, totals.infected);
  return totals;
}

function pushEvent(world, text, tone = 'neutral', scope = 'global') {
  world.events.unshift({ id: crypto.randomUUID(), day: world.day, tone, text, scope });
  world.events = world.events.slice(0, 80);
}

function startOutbreak(world) {
  if (world.status !== 'lobby') return;
  world.status = 'active'; world.day = 1; world.nextTickAt = Date.now() + TICK_MS;
  const origin = world.countries[world.originCode] || Object.values(world.countries)[0];
  origin.infected = Math.min(origin.population * .001, 5000);
  origin.lastAction = 'Зафиксированы первые необъяснимые случаи';
  pushEvent(world, `Неизвестный патоген начал скрыто распространяться в регионе: ${CATALOG.find((item) => item.code === origin.code)?.name || origin.code}.`, 'pathogen', 'pathogen');
  recalculateTotals(world);
}

function applyMilestones(world) {
  const ratio = world.totals.infected / world.totalPopulation;
  const milestones = [
    ['first_detection', world.totals.detectedCountries > 0, 'Медицинские службы подтвердили новую инфекционную угрозу.', 'response'],
    ['ten_countries', world.pathogen.infectedCountries >= 10, 'Заражение обнаружено уже в десяти странах.', 'warning'],
    ['pandemic', world.pathogen.infectedCountries >= 55, 'Всемирная сеть объявила глобальную чрезвычайную ситуацию.', 'warning'],
    ['one_percent', ratio >= .01, 'Активная инфекция охватила более 1% населения планеты.', 'pathogen'],
    ['research_half', world.response.research >= 50, 'Исследовательский консорциум завершил половину программы вакцины.', 'response'],
    ['vaccine_ready', world.response.research >= 100, 'Вакцина одобрена. Началось массовое производство и распределение.', 'response']
  ];
  for (const [id, reached, text, tone] of milestones) if (reached && !world.milestones[id]) { world.milestones[id] = world.day; pushEvent(world, text, tone); }
}

function advanceOutbreak(world) {
  if (world.status !== 'active') return { changed: [], ended: false };
  world.day += 1; world.tick += 1; world.nextTickAt = Date.now() + TICK_MS;
  const pathogenBonus = teamBonuses(world.pathogen);
  const responseBonus = teamBonuses(world.response);
  const before = Object.fromEntries(Object.values(world.countries).map((country) => [country.code, { ...country }]));
  const imports = {};
  const changed = new Set();
  let newInfectionsTotal = 0;
  let newlyInfectedCountries = 0;

  const globalHubs = ['USA','BRA','GBR','FRA','DEU','ARE','IND','CHN','SGP','JPN','AUS','ZAF'];
  for (const source of Object.values(before)) {
    if (source.infected < 50) continue;
    const meta = CATALOG.find((item) => item.code === source.code);
    const links = [...new Set([...(meta?.borders || []), ...(source.hub ? globalHubs.filter((code) => code !== source.code).slice(Math.floor(hashFloat(`${world.seed}:${world.day}:${source.code}`) * 6), 6 + Math.floor(hashFloat(`${world.seed}:${world.day}:${source.code}`) * 6)) : [])])];
    const sourceShare = source.infected / Math.max(1, source.population);
    if (sourceShare < .00002) continue;
    for (const targetCode of links) {
      const target = before[targetCode]; if (!target) continue;
      const travel = (source.hub && target.hub ? 2.2 : 1) * (1 + (pathogenBonus.travel || 0));
      const borderBlock = (1 - source.measures.border * .2) * (1 - target.measures.border * .22);
      const exported = Math.floor(source.infected * .0000028 * travel * borderBlock);
      if (exported > 0) imports[targetCode] = (imports[targetCode] || 0) + exported;
    }
  }

  for (const country of Object.values(world.countries)) {
    const old = before[country.code];
    const susceptible = Math.max(0, country.population - old.infected - old.recovered - old.vaccinated - old.deaths);
    const climateBonus = old.climate === 'cold' ? pathogenBonus.cold || 0 : old.climate === 'hot' ? pathogenBonus.heat || 0 : .08;
    const containment = old.measures.tracing * .1 + old.measures.restrictions * .16 + (responseBonus.containment || 0);
    const resistance = pathogenBonus.containmentResistance || 0;
    const infectivity = .1 * (1 + (pathogenBonus.infectivity || 0) + climateBonus) * old.density;
    const local = Math.floor(Math.min(susceptible, old.infected * infectivity * clamp(1 - containment + resistance, .12, 1.25) * (susceptible / Math.max(1, country.population))));
    const imported = Math.min(susceptible - local, imports[country.code] || 0);
    const recoveryRate = .025 * (1 + (responseBonus.recovery || 0)) * (country.reservoirUntil > world.day ? .35 : 1);
    const resolved = Math.min(old.infected, Math.floor(old.infected * recoveryRate));
    const severity = clamp(.035 + (pathogenBonus.severity || 0), .015, .65);
    const capacity = old.population * (.0012 + old.healthcare / 70000 + old.measures.hospital * .0007);
    const severe = Math.max(0, Math.floor(old.infected * severity));
    const overload = clamp(severe / Math.max(1, capacity), 1, 7);
    const medicalProtection = clamp((responseBonus.care || 0) + old.measures.hospital * .08, 0, .82);
    const drugResistance = pathogenBonus.medicineResistance || 0;
    const fatality = clamp(.0025 + (pathogenBonus.lethality || 0), .001, .35);
    const deaths = Math.min(resolved, Math.floor(resolved * fatality * overload * (1 - medicalProtection + drugResistance * .35)));
    const recovered = Math.max(0, resolved - deaths);

    if (old.infected < 10 && local + imported >= 10) newlyInfectedCountries += 1;
    country.infected = Math.max(0, Math.round(old.infected + local + imported - resolved));
    country.severe = Math.min(country.infected, severe);
    country.deaths = Math.min(country.population, Math.round(old.deaths + deaths));
    country.recovered = Math.min(country.population - country.deaths, Math.round(old.recovered + recovered));
    newInfectionsTotal += Math.max(0, local + imported);

    if (country.infected > 0) {
      const prevalence = country.infected / country.population;
      const testPower = .22 + country.measures.testing * .5 + (responseBonus.detection || 0);
      const visibleSymptoms = .25 + severity * 2.4;
      const stealth = clamp((pathogenBonus.stealth || 0) + (country.stealthUntil > world.day ? .3 : 0), 0, .8);
      country.detection = clamp(country.detection + (prevalence * 85 + visibleSymptoms) * testPower * (1 - stealth), 0, 100);
      if (country.detection >= 8) country.known = true;
      if (country.known && world.day % 8 === 0) {
        if (prevalence > .002 && country.measures.testing < 3) country.measures.testing += 1;
        if (prevalence > .01 && country.measures.tracing < 2) country.measures.tracing += 1;
        if (prevalence > .045 && country.measures.restrictions < 2) country.measures.restrictions += 1;
        if (prevalence > .08 && country.measures.border < 2) country.measures.border += 1;
      }
      country.lastAction = country.known ? `${round(prevalence * 100, 2)}% населения заражено` : 'Система наблюдения не видит угрозу';
    } else if (country.known) country.lastAction = 'Активных случаев не осталось';

    if (local || imported || resolved || deaths || country.detection !== old.detection) changed.add(country.code);
  }

  recalculateTotals(world);
  const detectionFactor = clamp(world.totals.detectedCountries / 12, 0, 1);
  const researchResistance = pathogenBonus.researchResistance || 0;
  if (world.totals.detectedCountries) {
    world.response.research = clamp(world.response.research + (.34 + detectionFactor * .22) * (1 + (responseBonus.research || 0)) * (1 - researchResistance), 0, 100);
  }
  if (world.response.research >= 100) {
    const production = world.totalPopulation * .00125 * (1 + (responseBonus.production || 0)) * (world.response.procurementUntil > world.day ? 1.6 : 1);
    world.response.productionStock += production;
    const targets = Object.values(world.countries).filter((country) => country.vaccinated < country.population - country.deaths).sort((a, b) => Number(b.known) - Number(a.known) || (b.infected / b.population) - (a.infected / a.population) || (a.vaccinated / a.population) - (b.vaccinated / b.population));
    let distributable = Math.min(world.response.productionStock, production * (1.4 + (responseBonus.distribution || 0)));
    for (const target of targets.slice(0, 20)) {
      if (distributable <= 0) break;
      const available = Math.max(0, target.population - target.deaths - target.infected - target.vaccinated);
      const doses = Math.min(available, distributable / Math.max(1, 20 - targets.indexOf(target)));
      target.vaccinated += Math.round(doses * (1 - (pathogenBonus.vaccineEscape || 0)) * (1 + (responseBonus.vaccinePower || 0)));
      world.response.productionStock -= doses; distributable -= doses; changed.add(target.code);
    }
  }

  const mutationMultiplier = world.pathogen.mutationBoostUntil > world.day ? 1.7 : 1;
  world.pathogen.points = clamp(world.pathogen.points + Math.min(6, newInfectionsTotal / 5500000 + newlyInfectedCountries * 1.5) * mutationMultiplier, 0, 240);
  world.response.points = clamp(world.response.points + .8 + world.totals.detectedCountries * .012, 0, 240);
  const restrictionBurden = Object.values(world.countries).reduce((sum, country) => sum + country.measures.restrictions + country.measures.border * .6, 0) / 195;
  const dailyDeaths = Math.max(0, world.totals.deaths - (world.lastDeaths || 0)); world.lastDeaths = world.totals.deaths;
  world.response.trust = clamp(world.response.trust - restrictionBurden * .025 - dailyDeaths / Math.max(1, world.totalPopulation) * 80, 0, 100);

  applyMilestones(world);
  const deadRatio = world.totals.deaths / world.totalPopulation;
  const infectedRatio = world.totals.infected / world.totalPopulation;
  const vaccinatedRatio = world.totals.vaccinated / world.totalPopulation;
  const overloadRatio = world.totals.overloadedCountries / 195;
  if (deadRatio >= .32 || (infectedRatio >= .68 && overloadRatio >= .45)) {
    world.status = 'ended'; world.winner = 'pathogen'; world.endReason = 'Системы здравоохранения потеряли контроль над глобальной вспышкой.';
  } else if (world.day > 25 && world.totals.infected < 10) {
    world.status = 'ended'; world.winner = 'response'; world.endReason = 'Все цепочки передачи были разорваны.';
  } else if (vaccinatedRatio >= .68 && infectedRatio < .012) {
    world.status = 'ended'; world.winner = 'response'; world.endReason = 'Вакцинация и локальное сдерживание остановили пандемию.';
  }
  if (world.status === 'ended') pushEvent(world, `${TEAM_NAMES[world.winner]} побеждает. ${world.endReason}`, world.winner);
  return { changed: [...changed], ended: world.status === 'ended' };
}

function validateUpgrade(team, state, id) {
  const branches = team === 'pathogen' ? PATHOGEN_UPGRADES : RESPONSE_UPGRADES;
  const node = branches.flatMap((branch) => branch.nodes).find((item) => item.id === id);
  if (!node) return { error: 'Неизвестное улучшение.' };
  if (state.upgrades.includes(id)) return { error: 'Это улучшение уже изучено.' };
  if ((node.requires || []).some((required) => !state.upgrades.includes(required))) return { error: 'Сначала изучите предыдущие узлы.' };
  if (node.requiresAny?.length && !node.requiresAny.some((required) => state.upgrades.includes(required))) return { error: 'Нужна хотя бы одна климатическая адаптация.' };
  if (state.points < node.cost) return { error: 'Команде не хватает очков.' };
  return { node };
}

function actionCost(world, team, baseCost) {
  if (team !== 'response') return baseCost;
  return Math.max(1, Math.round(baseCost * (1 - (teamBonuses(world.response).actionDiscount || 0))));
}

function performCountryAction(world, player, message) {
  if (world.status !== 'active') return { ok: false, error: 'Матч ещё не начался.' };
  const country = world.countries[message.target];
  if (!country) return { ok: false, error: 'Выберите страну на карте.' };
  const definitions = COUNTRY_ACTIONS[player.team] || [];
  const definition = definitions.find((item) => item.id === message.id);
  if (!definition) return { ok: false, error: 'Это действие недоступно вашей команде.' };
  const teamState = world[player.team]; const cost = actionCost(world, player.team, definition.cost);
  if (teamState.points < cost) return { ok: false, error: 'Команде не хватает очков.' };
  if (player.team === 'pathogen' && !country.infected && message.id !== 'aerosol_burst') return { ok: false, error: 'В стране ещё нет устойчивого очага.' };
  if (message.id === 'vaccine_campaign' && world.response.research < 100) return { ok: false, error: 'Вакцина ещё не готова.' };
  teamState.points -= cost;
  if (message.id === 'aerosol_burst') { country.infected += Math.min(country.population * .001, Math.max(2500, country.infected * .18)); country.lastAction = 'Зафиксирован резкий рост заражений'; }
  if (message.id === 'silent_wave') { country.detection = Math.max(0, country.detection - 34); country.stealthUntil = world.day + 24; }
  if (message.id === 'relapse') { const amount = Math.min(country.recovered, Math.max(1000, country.recovered * .18)); country.recovered -= amount; country.infected += amount; }
  if (message.id === 'research_interference') world.response.research = Math.max(0, world.response.research - 5);
  if (message.id === 'scan') { country.detection = Math.max(country.detection, 72); country.known = true; }
  if (message.id === 'testing') country.measures.testing = Math.min(3, country.measures.testing + 1);
  if (message.id === 'tracing') country.measures.tracing = Math.min(3, country.measures.tracing + 1);
  if (message.id === 'hospital') country.measures.hospital = Math.min(3, country.measures.hospital + 1);
  if (message.id === 'restrictions') { country.measures.restrictions = Math.min(3, country.measures.restrictions + 1); world.response.trust = Math.max(0, world.response.trust - 3 * (1 - (teamBonuses(world.response).trustProtection || 0))); }
  if (message.id === 'close_borders') { country.measures.border = Math.min(3, country.measures.border + 1); world.response.trust = Math.max(0, world.response.trust - 2.5); }
  if (message.id === 'vaccine_campaign') {
    const doses = Math.min(world.response.productionStock, country.population * .12, country.population - country.deaths - country.infected - country.vaccinated);
    world.response.productionStock -= doses; country.vaccinated += Math.max(0, Math.round(doses));
  }
  player.actions = (player.actions || 0) + 1; player.lastActionAt = Date.now();
  return { ok: true, toast: `${definition.name}: ${CATALOG.find((item) => item.code === country.code)?.name || country.code}` };
}

function performGlobalAction(world, player, id) {
  if (world.status !== 'active') return { ok: false, error: 'Матч ещё не начался.' };
  const definition = GLOBAL_ACTIONS[player.team]?.find((item) => item.id === id);
  if (!definition) return { ok: false, error: 'Неизвестная глобальная операция.' };
  const teamState = world[player.team]; const cost = actionCost(world, player.team, definition.cost);
  if (teamState.points < cost) return { ok: false, error: 'Команде не хватает очков.' };
  teamState.points -= cost;
  if (id === 'mutation_drive') world.pathogen.mutationBoostUntil = world.day + 20;
  if (id === 'panic_signal') { world.response.trust = Math.max(0, world.response.trust - 9); for (const country of Object.values(world.countries)) country.compliance = Math.max(15, country.compliance - 4); }
  if (id === 'fund_research') world.response.research = Math.min(100, world.response.research + 3.5);
  if (id === 'public_briefing') world.response.trust = Math.min(100, world.response.trust + 9);
  if (id === 'global_procurement') world.response.procurementUntil = world.day + 35;
  player.actions = (player.actions || 0) + 1; player.lastActionAt = Date.now();
  pushEvent(world, `${TEAM_NAMES[player.team]} проводит операцию «${definition.name}».`, player.team);
  return { ok: true, toast: definition.name };
}

function performAbility(world, player, targetCode) {
  if (world.status !== 'active') return { ok: false, error: 'Матч ещё не начался.' };
  const specialty = findSpecialty(player.team, player.specialty);
  if (!specialty) return { ok: false, error: 'Сначала выберите специализацию.' };
  const remaining = 90000 - (Date.now() - (player.lastAbilityAt || 0));
  if (remaining > 0) return { ok: false, error: `Способность будет готова через ${Math.ceil(remaining / 1000)} сек.` };
  const country = world.countries[targetCode];
  if (['route_jump','blind_spot','stable_reservoir','deep_scan','medical_surge'].includes(specialty.ability) && !country) return { ok: false, error: 'Выберите страну на карте.' };
  if (specialty.ability === 'route_jump') country.infected += Math.min(country.population * .0005, Math.max(3000, country.infected * .08));
  if (specialty.ability === 'dna_harvest') world.pathogen.points = Math.min(240, world.pathogen.points + 12);
  if (specialty.ability === 'blind_spot') { country.detection = Math.max(0, country.detection - 48); country.stealthUntil = world.day + 18; }
  if (specialty.ability === 'lab_blackout') world.response.research = Math.max(0, world.response.research - 7);
  if (specialty.ability === 'stable_reservoir') country.reservoirUntil = world.day + 35;
  if (specialty.ability === 'deep_scan') { country.detection = 100; country.known = true; }
  if (specialty.ability === 'medical_surge') country.measures.hospital = Math.min(3, country.measures.hospital + 2);
  if (specialty.ability === 'research_sprint') world.response.research = Math.min(100, world.response.research + 9);
  if (specialty.ability === 'supply_drop') world.response.points = Math.min(240, world.response.points + 20);
  if (specialty.ability === 'trust_campaign') world.response.trust = Math.min(100, world.response.trust + 14);
  player.lastAbilityAt = Date.now(); player.actions = (player.actions || 0) + 1;
  pushEvent(world, `${player.name} применяет способность «${specialty.abilityName}».`, player.team);
  return { ok: true, toast: `Способность активирована: ${specialty.abilityName}` };
}

function defaultSpecialty(players, team) {
  const used = new Set(players.filter((player) => player.team === team).map((player) => player.specialty));
  return SPECIALTIES[team].find((item) => !used.has(item.id))?.id || SPECIALTIES[team][0].id;
}

function createPlayer(name, team, token) {
  return {
    id: crypto.randomUUID(), name: cleanText(name, 24) || 'Участник', token, resumeHash: resumeHash(token),
    team, specialty: null, joinedAt: Date.now(), connected: true, actions: 0, lastActionAt: 0, lastAbilityAt: 0, lastChatAt: 0
  };
}

function safeRoom(room) {
  return {
    version: 1, code: room.code, createdAt: room.createdAt, updatedAt: room.updatedAt, hostId: room.hostId,
    players: room.players.map(({ id, name, resumeHash: hash, team, specialty, joinedAt, actions, lastActionAt, lastAbilityAt }) => ({ id, name, resumeHash: hash, team, specialty, joinedAt, actions, lastActionAt, lastAbilityAt })),
    world: room.world
  };
}

function publicCountry(country, viewerTeam) {
  if (viewerTeam === 'pathogen') return { ...country, actual: true };
  const visible = country.known || country.detection >= 8 || country.deaths > 0;
  const confidence = clamp(country.detection / 100, .18, 1);
  return {
    ...country,
    infected: visible ? Math.round(country.infected * (.65 + confidence * .35)) : 0,
    severe: visible ? Math.round(country.severe * (.72 + confidence * .28)) : 0,
    recovered: visible ? Math.round(country.recovered * confidence) : 0,
    detection: visible ? country.detection : 0,
    known: visible, actual: country.detection >= 92,
    uncertainty: visible ? Math.round((1 - confidence) * 100) : 100
  };
}

function publicWorld(room, viewer) {
  const world = room.world;
  const pathogenBonus = teamBonuses(world.pathogen); const responseBonus = teamBonuses(world.response);
  const intelligence = (responseBonus.intelligence || 0) + world.response.intelligence;
  const countries = Object.fromEntries(Object.values(world.countries).map((country) => [country.code, publicCountry(country, viewer.team)]));
  const reportedTotals = viewer.team === 'pathogen' ? { ...world.totals } : Object.values(countries).reduce((totals, country) => {
    totals.infected += country.infected; totals.severe += country.severe; totals.deaths += country.deaths; totals.recovered += country.recovered; totals.vaccinated += country.vaccinated;
    if (country.known) totals.detectedCountries += 1;
    const capacity = country.population * (.0012 + country.healthcare / 70000 + country.measures.hospital * .0007);
    if (country.known && country.severe > capacity) totals.overloadedCountries += 1;
    return totals;
  }, { infected: 0, severe: 0, deaths: 0, recovered: 0, vaccinated: 0, detectedCountries: 0, overloadedCountries: 0 });
  return {
    version: world.version, status: world.status, winner: world.winner, endReason: world.endReason, day: world.day, nextTickAt: world.nextTickAt,
    originCode: viewer.team === 'pathogen' || world.status === 'lobby' || world.countries[world.originCode]?.known ? world.originCode : null,
    pathogenName: world.pathogenName, totalPopulation: world.totalPopulation,
    countries,
    pathogen: {
      points: viewer.team === 'pathogen' ? round(world.pathogen.points, 1) : null,
      upgrades: viewer.team === 'pathogen' || intelligence >= 2 ? world.pathogen.upgrades : world.pathogen.upgrades.slice(0, intelligence ? Math.ceil(world.pathogen.upgrades.length / 2) : 0),
      infectedCountries: world.pathogen.infectedCountries, peakInfected: world.pathogen.peakInfected,
      profile: viewer.team === 'pathogen' || intelligence >= 2 ? pathogenBonus : null
    },
    response: {
      points: viewer.team === 'response' ? round(world.response.points, 1) : null,
      upgrades: world.response.upgrades, trust: round(world.response.trust, 1), research: round(world.response.research, 2),
      productionStock: viewer.team === 'response' ? Math.round(world.response.productionStock) : null
    },
    totals: reportedTotals, events: world.events.filter((event) => !event.scope || event.scope === 'global' || event.scope === viewer.team),
    chat: world.chat.filter((item) => item.channel === 'global' || item.team === viewer.team).slice(0, 80)
  };
}

class OutbreakService {
  constructor({ saveDir }) {
    this.saveDir = saveDir;
    this.rooms = new Map();
    fs.mkdirSync(saveDir, { recursive: true });
    this.loadRooms();
  }

  makeCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code;
    do { code = Array.from(crypto.randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join(''); } while (this.rooms.has(code));
    return code;
  }

  loadRooms() {
    for (const file of fs.readdirSync(this.saveDir).filter((name) => /^[A-Z0-9]{6}\.json$/.test(name))) {
      try {
        const room = JSON.parse(fs.readFileSync(path.join(this.saveDir, file), 'utf8'));
        if (room.version !== 1 || !room.world?.countries || !Array.isArray(room.players)) continue;
        room.connections = new Map(); room.updatedAt = Date.now(); room.world.nextTickAt = Date.now() + TICK_MS;
        for (const player of room.players) { player.token = null; player.connected = false; }
        this.rooms.set(room.code, room);
      } catch (error) { console.warn(`Не удалось загрузить эпидемиологическую комнату ${file}:`, error.message); }
    }
  }

  save(room) {
    room.updatedAt = Date.now();
    const target = path.join(this.saveDir, `${room.code}.json`); const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(safeRoom(room))); fs.renameSync(temporary, target);
  }

  send(socket, payload) { if (socket?.readyState === 1) socket.send(JSON.stringify(payload)); }

  createRoom(message) {
    const code = this.makeCode(); const world = createOutbreakWorld(code);
    const room = { version: 1, code, createdAt: Date.now(), updatedAt: Date.now(), hostId: null, players: [], connections: new Map(), world, ticksSinceSave: 0 };
    this.rooms.set(code, room); return room;
  }

  recoverRoom(message, requestedToken) {
    const snapshot = message.recovery;
    if (!snapshot || snapshot.version !== 1 || snapshot.code !== cleanText(message.roomCode, 6).toUpperCase() || !snapshot.world?.countries || !Array.isArray(snapshot.players)) return null;
    const hash = resumeHash(requestedToken);
    if (!snapshot.players.some((player) => player.resumeHash === hash)) return null;
    const room = JSON.parse(JSON.stringify(snapshot)); room.connections = new Map(); room.updatedAt = Date.now(); room.world.nextTickAt = Date.now() + TICK_MS;
    for (const player of room.players) { player.token = null; player.connected = false; }
    this.rooms.set(room.code, room); this.save(room); return room;
  }

  publicState(room, viewerId) {
    const viewer = room.players.find((player) => player.id === viewerId);
    if (!viewer) return null;
    const state = {
      type: 'outbreakState', roomCode: room.code, viewerId, hostId: room.hostId, isHost: viewerId === room.hostId,
      players: room.players.map((player) => ({ id: player.id, name: player.name, team: player.team, specialty: player.specialty, joinedAt: player.joinedAt, actions: player.actions || 0, connected: room.connections.has(player.id), abilityReadyAt: (player.lastAbilityAt || 0) + 90000 })),
      catalog: CATALOG, world: publicWorld(room, viewer),
      definitions: { upgrades: { pathogen: PATHOGEN_UPGRADES, response: RESPONSE_UPGRADES }, specialties: SPECIALTIES, countryActions: COUNTRY_ACTIONS, globalActions: GLOBAL_ACTIONS, teamNames: TEAM_NAMES },
      savedAt: room.updatedAt
    };
    if (viewerId === room.hostId) state.recoverySnapshot = safeRoom(room);
    return state;
  }

  broadcast(room) {
    for (const [playerId, socket] of room.connections) this.send(socket, this.publicState(room, playerId));
  }

  broadcastTick(room, changedCodes) {
    for (const [playerId, socket] of room.connections) {
      const viewer = room.players.find((player) => player.id === playerId);
      if (!viewer) continue;
      const visible = publicWorld(room, viewer);
      const allowedCodes = viewer.team === 'response' && room.world.response.research < 100
        ? changedCodes.filter((code) => visible.countries[code]?.known)
        : changedCodes;
      const countries = Object.fromEntries(allowedCodes.map((code) => {
        const country = visible.countries[code];
        if (!country) return null;
        return [code, {
          infected: country.infected, severe: country.severe, deaths: country.deaths,
          recovered: country.recovered, vaccinated: country.vaccinated, detection: country.detection,
          compliance: country.compliance, measures: country.measures, reservoirUntil: country.reservoirUntil,
          stealthUntil: country.stealthUntil, lastAction: country.lastAction, known: country.known,
          actual: country.actual, uncertainty: country.uncertainty
        }];
      }).filter(Boolean));
      const { countries: ignored, ...world } = visible;
      this.send(socket, { type: 'outbreakTick', world: { ...world, countries } });
    }
  }

  hello(socket, message) {
    const action = message.action === 'create' ? 'create' : 'join';
    const code = cleanText(message.roomCode, 6).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const requestedToken = String(message.playerToken || '').slice(0, 80);
    let room = action === 'create' ? this.createRoom(message) : this.rooms.get(code);
    if (!room && action === 'join' && requestedToken && message.recovery) room = this.recoverRoom(message, requestedToken);
    if (!room) return this.send(socket, { type: 'outbreakMissing', roomCode: code, message: 'Комната не найдена после перезапуска сервера.' });
    let player = requestedToken ? room.players.find((item) => item.token === requestedToken || item.resumeHash === resumeHash(requestedToken)) : null;
    const resumed = Boolean(player);
    if (!player) {
      if (room.players.length >= MAX_PLAYERS) return this.send(socket, { type: 'outbreakError', message: 'В комнате уже 10 участников.' });
      const preferred = ['pathogen','response'].includes(message.team) ? message.team : (room.players.filter((item) => item.team === 'pathogen').length <= room.players.filter((item) => item.team === 'response').length ? 'pathogen' : 'response');
      const teamCount = room.players.filter((item) => item.team === preferred).length;
      const team = teamCount < MAX_TEAM_PLAYERS ? preferred : preferred === 'pathogen' ? 'response' : 'pathogen';
      const token = crypto.randomBytes(24).toString('hex'); player = createPlayer(message.name, team, token);
      player.specialty = defaultSpecialty(room.players, team); room.players.push(player); if (!room.hostId) room.hostId = player.id;
    } else {
      player.token = requestedToken; player.resumeHash = resumeHash(requestedToken); player.name = cleanText(message.name, 24) || player.name;
    }
    socket.gameMode = 'outbreak'; socket.outbreakRoomCode = room.code; socket.outbreakPlayerId = player.id;
    const oldSocket = room.connections.get(player.id); if (oldSocket && oldSocket !== socket) oldSocket.close(4001, 'Повторный вход');
    room.connections.set(player.id, socket); player.connected = true;
    this.send(socket, { type: 'outbreakWelcome', roomCode: room.code, playerToken: player.token, resumed }); this.save(room); this.broadcast(room);
  }

  handle(socket, rawMessage) {
    const message = typeof rawMessage === 'string' ? JSON.parse(rawMessage) : rawMessage;
    if (message.type === 'outbreakHello') return this.hello(socket, message);
    const room = this.rooms.get(socket.outbreakRoomCode); const player = room?.players.find((item) => item.id === socket.outbreakPlayerId);
    if (!room || !player) return this.send(socket, { type: 'outbreakError', message: 'Сначала войдите в эпидемиологическую комнату.' });
    if (Date.now() - (player.lastActionAt || 0) < 350 && message.type === 'outbreakAction') return this.send(socket, { type: 'outbreakError', message: 'Слишком много команд подряд.' });
    let result = { ok: false, error: 'Неизвестная команда.' };
    if (message.type === 'outbreakTeam' && room.world.status === 'lobby') {
      const team = message.team; const count = room.players.filter((item) => item.team === team && item.id !== player.id).length;
      if (!['pathogen','response'].includes(team)) result = { ok: false, error: 'Неизвестная команда.' };
      else if (count >= MAX_TEAM_PLAYERS) result = { ok: false, error: 'В этой команде уже пять игроков.' };
      else { player.team = team; player.specialty = defaultSpecialty(room.players.filter((item) => item.id !== player.id), team); result = { ok: true, toast: `Вы вступили в команду «${TEAM_NAMES[team]}»` }; }
    }
    if (message.type === 'outbreakSpecialty' && room.world.status === 'lobby') {
      const specialty = findSpecialty(player.team, message.id); const taken = room.players.some((item) => item.id !== player.id && item.team === player.team && item.specialty === message.id);
      result = !specialty ? { ok: false, error: 'Неизвестная специализация.' } : taken ? { ok: false, error: 'Эту роль уже занял союзник.' } : (player.specialty = specialty.id, { ok: true, toast: `Роль выбрана: ${specialty.name}` });
    }
    if (message.type === 'outbreakOrigin' && room.world.status === 'lobby' && player.team === 'pathogen') {
      result = room.world.countries[message.code] ? (room.world.originCode = message.code, { ok: true, toast: 'Регион нулевого пациента выбран' }) : { ok: false, error: 'Неизвестная страна.' };
    }
    if (message.type === 'outbreakName' && room.world.status === 'lobby' && player.team === 'pathogen') {
      const name = cleanText(message.name, 22); result = name.length < 2 ? { ok: false, error: 'Название слишком короткое.' } : (room.world.pathogenName = name, { ok: true, toast: 'Патоген получил новое имя' });
    }
    if (message.type === 'outbreakStart') {
      const teams = { pathogen: room.players.filter((item) => item.team === 'pathogen').length, response: room.players.filter((item) => item.team === 'response').length };
      if (player.id !== room.hostId) result = { ok: false, error: 'Матч запускает создатель комнаты.' };
      else if (!teams.pathogen || !teams.response) result = { ok: false, error: 'Нужен минимум один игрок в каждой команде.' };
      else if (room.world.status !== 'lobby') result = { ok: false, error: 'Матч уже запущен.' };
      else { startOutbreak(room.world); result = { ok: true, toast: 'Операция началась' }; }
    }
    if (message.type === 'outbreakAction') {
      if (message.action === 'upgrade') {
        const teamState = room.world[player.team]; const validation = validateUpgrade(player.team, teamState, message.id);
        if (validation.error) result = { ok: false, error: validation.error };
        else { teamState.points -= validation.node.cost; teamState.upgrades.push(validation.node.id); player.actions += 1; player.lastActionAt = Date.now(); result = { ok: true, toast: `Изучено: ${validation.node.name}` }; }
      }
      if (message.action === 'country') result = performCountryAction(room.world, player, message);
      if (message.action === 'global') result = performGlobalAction(room.world, player, message.id);
      if (message.action === 'ability') result = performAbility(room.world, player, message.target);
    }
    if (message.type === 'outbreakChat') {
      const text = cleanText(message.text, 240); const channel = message.channel === 'global' ? 'global' : 'team';
      if (Date.now() - (player.lastChatAt || 0) < 1200) result = { ok: false, error: 'Сообщения можно отправлять раз в секунду.' };
      else if (text.length < 1) result = { ok: false, error: 'Введите сообщение.' };
      else { room.world.chat.unshift({ id: crypto.randomUUID(), playerId: player.id, author: player.name, team: player.team, channel, text, createdAt: Date.now() }); room.world.chat = room.world.chat.slice(0, 100); player.lastChatAt = Date.now(); result = { ok: true }; }
    }
    if (!result.ok) return this.send(socket, { type: 'outbreakError', message: result.error });
    this.save(room); if (result.toast) this.send(socket, { type: 'outbreakToast', message: result.toast }); this.broadcast(room);
  }

  disconnect(socket) {
    const room = this.rooms.get(socket.outbreakRoomCode); if (!room) return;
    if (room.connections.get(socket.outbreakPlayerId) === socket) { room.connections.delete(socket.outbreakPlayerId); const player = room.players.find((item) => item.id === socket.outbreakPlayerId); if (player) player.connected = false; this.broadcast(room); }
  }

  tick() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (!room.connections.size) continue;
      if (room.world.status !== 'active' || room.world.nextTickAt > now) continue;
      const outcome = advanceOutbreak(room.world); room.ticksSinceSave = (room.ticksSinceSave || 0) + 1;
      if (room.ticksSinceSave >= 5 || room.world.status === 'ended') { this.save(room); room.ticksSinceSave = 0; }
      // A compact country delta keeps ten-player rooms light. Periodic full states also refresh
      // the host's browser recovery snapshot and heal any missed client update.
      if (room.world.status === 'ended' || room.world.tick % 20 === 0) this.broadcast(room);
      else this.broadcastTick(room, outcome.changed);
    }
  }
}

module.exports = {
  OutbreakService, MAX_PLAYERS, MAX_TEAM_PLAYERS, TICK_MS, TEAM_NAMES, PATHOGEN_UPGRADES, RESPONSE_UPGRADES,
  SPECIALTIES, COUNTRY_ACTIONS, GLOBAL_ACTIONS, createOutbreakWorld, startOutbreak, advanceOutbreak,
  recalculateTotals, validateUpgrade, performCountryAction, performGlobalAction, performAbility, publicWorld, safeRoom
};
