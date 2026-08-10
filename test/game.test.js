const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CATALOG, EXTRACTION_COMMODITIES, COMMODITY_MARKET_INTERVAL_MS, createWorld, migrateWorld, selectCountry, performAction, advanceTurn, advanceWars, advanceResistance, getRelation, incomeFor, ranking, theftChance, commodityMarketForTime, updateCommodityMarket
} = require('../game');

test('catalog contains 195 unique playable states with Russian names', () => {
  assert.equal(CATALOG.length, 195);
  assert.equal(new Set(CATALOG.map((c) => c.code)).size, 195);
  assert.equal(CATALOG.find((c) => c.code === 'KAZ').name, 'Казахстан');
});

test('country selection is exclusive and irreversible', () => {
  const world = createWorld('selection-test');
  const first = { id: 'p1', name: 'Первый', countryCode: null };
  const second = { id: 'p2', name: 'Второй', countryCode: null };
  assert.equal(selectCountry(world, first, 'KAZ').ok, true);
  assert.equal(world.countries.KAZ.isBot, false);
  assert.equal(selectCountry(world, second, 'KAZ').ok, false);
  assert.equal(selectCountry(world, first, 'FRA').ok, false);
});

test('development action spends treasury and improves the country', () => {
  const world = createWorld('action-test');
  const player = { id: 'p1', name: 'Лидер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  world.countries.KAZ.treasury = 100;
  const before = world.countries.KAZ.industry;
  const result = performAction(world, player, { action: 'develop', id: 'industry' });
  assert.equal(result.ok, true);
  assert.equal(world.countries.KAZ.treasury, 76);
  assert.equal(world.countries.KAZ.industry, before + 2);
});

test('diplomacy changes bilateral relations symmetrically', () => {
  const world = createWorld('diplomacy-test');
  const player = { id: 'p1', name: 'Лидер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  world.countries.KAZ.treasury = 100;
  const before = getRelation(world, 'KAZ', 'UZB');
  assert.equal(performAction(world, player, { action: 'diplomacy', id: 'embassy', target: 'UZB' }).ok, true);
  assert.equal(getRelation(world, 'UZB', 'KAZ'), before + 12);
});

test('players can publish attributed world news with a server spam cooldown', () => {
  const world = createWorld('player-news-test');
  const player = { id: 'p1', name: 'Редактор', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const published = performAction(world, player, { action: 'publish_news', category: 'economy', headline: 'Новый торговый коридор', text: 'Казахстан объявляет об открытии большого международного торгового маршрута.' });
  assert.equal(published.ok, true);
  assert.equal(world.playerNews.length, 1);
  assert.equal(world.playerNews[0].authorCode, 'KAZ');
  assert.equal(world.playerNews[0].authorName, 'Редактор');
  assert.equal(world.playerNews[0].category, 'economy');
  const blocked = performAction(world, player, { action: 'publish_news', category: 'military', headline: 'Второй выпуск', text: 'Этот выпуск не должен пройти раньше серверного ограничения.' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /через/);
  world.countries.KAZ.lastPlayerNewsAt -= 30001;
  assert.equal(performAction(world, player, { action: 'publish_news', category: 'unknown', headline: '<b>Заявление лидера</b>', text: '<script>Опасная разметка удаляется сервером автоматически.</script>' }).ok, true);
  assert.equal(world.playerNews[0].category, 'statement');
  assert.equal(world.playerNews[0].headline.includes('<'), false);
  assert.equal(world.playerNews[0].text.includes('<'), false);
});

test('quarter advances the persistent world and peaceful bots act', () => {
  const world = createWorld('turn-test');
  const before = world.countries.FRA.treasury;
  advanceTurn(world);
  assert.equal(world.turn, 2);
  assert.equal(world.quarter, 2);
  assert.ok(world.countries.FRA.treasury !== before);
  assert.equal(world.countries.FRA.atWar.length, 0);
});

test('war requires poor relations and supports operations and peace', () => {
  const world = createWorld('war-test');
  const player = { id: 'p1', name: 'Лидер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  world.countries.KAZ.treasury = 200;
  assert.equal(performAction(world, player, { action: 'conflict', id: 'declare', target: 'UZB' }).ok, false);
  world.relations['KAZ:UZB'] = -60;
  assert.equal(performAction(world, player, { action: 'conflict', id: 'declare', target: 'UZB' }).ok, true);
  assert.equal(world.countries.KAZ.atWar.includes('UZB'), true);
  assert.equal(performAction(world, player, { action: 'conflict', id: 'attack', target: 'UZB' }).ok, true);
  assert.equal(performAction(world, player, { action: 'diplomacy', id: 'peace', target: 'UZB' }).ok, true);
  assert.equal(world.countries.KAZ.atWar.length, 0);
});

test('declaring war starts a continuous automatic front without a battle action', () => {
  const world = createWorld('automatic-front-test');
  const player = { id: 'p1', name: 'Лидер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const attacker = world.countries.KAZ; const defender = world.countries.UZB;
  Object.assign(attacker.army, { manpower: 240, equipment: 92, readiness: 92, air: 82, defense: 80, supplies: 100, morale: 92, experience: 45 });
  Object.assign(defender.army, { manpower: 70, equipment: 42, readiness: 52, air: 24, defense: 45, supplies: 82, morale: 66, experience: 14 });
  world.relations['KAZ:UZB'] = -70;
  assert.equal(performAction(world, player, { action: 'conflict', id: 'declare', target: 'UZB' }).ok, true);
  const war = world.wars[0]; const attackerBefore = attacker.army.manpower; const defenderBefore = defender.army.manpower;
  let now = war.nextBattleAt;
  for (let tick = 0; tick < 8; tick += 1) { assert.equal(advanceWars(world, now).changed, true); now = war.nextBattleAt; }
  assert.ok(war.front > 0);
  assert.equal(defender.occupation.by, 'KAZ');
  assert.ok(defender.occupation.percent > 0);
  assert.ok(attacker.army.manpower < attackerBefore);
  assert.ok(defender.army.manpower < defenderBefore);
  assert.equal(war.lastOperation.automatic, true);
});

test('a much stronger army automatically completes territorial conquest', () => {
  const world = createWorld('automatic-annexation-test');
  const player = { id: 'p1', name: 'Лидер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const attacker = world.countries.KAZ; const defender = world.countries.UZB;
  Object.assign(attacker.army, { manpower: 500, equipment: 100, readiness: 100, air: 100, defense: 100, supplies: 100, morale: 100, experience: 70 });
  Object.assign(defender.army, { manpower: 5, equipment: 10, readiness: 20, air: 2, defense: 10, supplies: 40, morale: 35, experience: 2 });
  world.relations['KAZ:UZB'] = -70;
  performAction(world, player, { action: 'conflict', id: 'declare', target: 'UZB' });
  const war = world.wars[0]; let now = war.nextBattleAt;
  for (let tick = 0; tick < 100 && war.status === 'active'; tick += 1) { advanceWars(world, now); now = war.nextBattleAt; }
  assert.equal(war.status, 'annexed');
  assert.equal(defender.controllerCode, 'KAZ');
  assert.equal(defender.occupation.percent, 100);
});

test('army deployment moves a persistent territorial front and captures treasury', () => {
  const runOperation = (units) => {
    const world = createWorld('deploy-test');
    const player = { id: 'p1', name: 'Лидер', countryCode: null };
    selectCountry(world, player, 'KAZ');
    world.countries.KAZ.treasury = 500;
    Object.assign(world.countries.KAZ.army, { manpower: 220, equipment: 90, readiness: 90, air: 80, defense: 80, supplies: 100, morale: 90, experience: 40 });
    world.relations['KAZ:UZB'] = -60;
    performAction(world, player, { action: 'conflict', id: 'declare', target: 'UZB' });
    const targetTreasury = world.countries.UZB.treasury;
    const result = performAction(world, player, { action: 'conflict', id: 'attack', target: 'UZB', units });
    return { world, result, targetTreasury };
  };
  const cautious = runOperation(20);
  const full = runOperation(100);
  assert.ok(full.world.wars[0].front > cautious.world.wars[0].front);
  assert.equal(full.world.countries.UZB.occupation.by, 'KAZ');
  assert.ok(full.world.countries.UZB.occupation.percent > 0);
  assert.ok(full.world.countries.UZB.treasury < full.targetTreasury);
  assert.ok(full.result.toast.includes('Победа'));
  assert.equal(full.world.countries.KAZ.treasury, 500 + full.world.wars[0].lastOperation.loot);
});

test('peace preserves occupied land and it pays tribute on later turns', () => {
  const world = createWorld('occupation-income-test');
  const player = { id: 'p1', name: 'Лидер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  world.countries.KAZ.treasury = 500;
  Object.assign(world.countries.KAZ.army, { manpower: 220, equipment: 90, readiness: 90, air: 80, defense: 80, supplies: 100, morale: 90, experience: 40 });
  world.relations['KAZ:UZB'] = -60;
  performAction(world, player, { action: 'conflict', id: 'declare', target: 'UZB' });
  performAction(world, player, { action: 'conflict', id: 'attack', target: 'UZB', units: 100 });
  assert.equal(performAction(world, player, { action: 'diplomacy', id: 'peace', target: 'UZB' }).ok, true);
  assert.equal(world.countries.UZB.occupation.permanent, true);
  advanceTurn(world);
  assert.equal(world.countries.UZB.lastTribute.to, 'KAZ');
  const expected = Math.round(incomeFor(world.countries.UZB) * world.countries.UZB.occupation.percent / 100 * .1 * 10) / 10;
  assert.equal(world.countries.UZB.lastTribute.amount, expected);
});

test('full occupation annexes land and transfers gold and part of the economy', () => {
  const world = createWorld('annexation-test');
  const player = { id: 'p1', name: 'Лидер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const attacker = world.countries.KAZ; const defender = world.countries.UZB;
  attacker.treasury = 1000;
  attacker.army = { manpower: 500, reserve: 500, equipment: 100, readiness: 100, air: 100, navy: 50, defense: 100, supplies: 100, morale: 100, experience: 70, medical: 40 };
  Object.assign(defender.army, { manpower: 8, equipment: 15, readiness: 35, air: 5, defense: 15, supplies: 60, morale: 45, experience: 5 });
  const beforeGdp = attacker.gdp; const availableGold = defender.treasury;
  world.relations['KAZ:UZB'] = -60;
  performAction(world, player, { action: 'conflict', id: 'declare', target: 'UZB' });
  for (let operation = 0; operation < 10 && attacker.atWar.includes('UZB'); operation += 1) {
    if (operation > 0 && operation % 2 === 0) advanceTurn(world);
    performAction(world, player, { action: 'conflict', id: 'attack', target: 'UZB', units: 100 });
  }
  assert.equal(defender.controllerCode, 'KAZ');
  assert.equal(defender.occupation.percent, 100);
  assert.equal(defender.defeated, true);
  assert.equal(defender.eliminated, true);
  assert.equal(defender.absorbedBy, 'KAZ');
  assert.equal(incomeFor(defender), 0);
  assert.equal(ranking(world).some((item) => item.code === 'UZB'), false);
  assert.equal(attacker.annexed.includes('UZB'), true);
  assert.ok(attacker.gdp > beforeGdp);
  assert.ok(defender.treasury < availableGold);
});

test('a friendly country can join a paid coalition and its troops fight and take losses', () => {
  const world = createWorld('coalition-test');
  const player = { id: 'p1', name: 'Лидер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const attacker = world.countries.KAZ; const ally = world.countries.TUR;
  attacker.treasury = 1000;
  world.relations['KAZ:UZB'] = -70;
  world.relations['KAZ:TUR'] = 90;
  performAction(world, player, { action: 'conflict', id: 'declare', target: 'UZB' });
  const beforePayment = attacker.treasury; const allyManpower = ally.army.manpower;
  const invitation = performAction(world, player, { action: 'war_support', id: 'invite', target: 'TUR' });
  assert.equal(invitation.ok, true);
  assert.equal(world.wars[0].supporters.a[0].code, 'TUR');
  assert.ok(attacker.treasury < beforePayment);
  performAction(world, player, { action: 'conflict', id: 'attack', target: 'UZB', units: 100 });
  assert.equal(world.wars[0].lastOperation.attackerAllies.includes('TUR'), true);
  assert.ok(ally.army.manpower < allyManpower);
});

test('a human ally chooses whether to accept a coalition invitation', () => {
  const world = createWorld('human-coalition-test');
  const leader = { id: 'p1', name: 'Лидер', countryCode: null };
  const allyPlayer = { id: 'p2', name: 'Союзник', countryCode: null };
  selectCountry(world, leader, 'KAZ'); selectCountry(world, allyPlayer, 'TUR');
  world.countries.KAZ.treasury = 1000;
  world.relations['KAZ:UZB'] = -70;
  world.relations['KAZ:TUR'] = 80;
  performAction(world, leader, { action: 'conflict', id: 'declare', target: 'UZB' });
  assert.equal(performAction(world, leader, { action: 'war_support', id: 'invite', target: 'TUR' }).ok, true);
  const invite = world.warInvites[0];
  assert.equal(performAction(world, allyPlayer, { action: 'war_support', id: 'accept', inviteId: invite.id }).ok, true);
  assert.equal(world.countries.TUR.supportingWarId, world.wars[0].id);
  assert.equal(world.wars[0].supporters.a.some((support) => support.code === 'TUR'), true);
});

test('a side has two battles per quarter and battles consume supplies, not gold', () => {
  const world = createWorld('operation-limit-test');
  const player = { id: 'p1', name: 'Лидер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const attacker = world.countries.KAZ;
  attacker.treasury = 500; attacker.army.supplies = 100;
  Object.assign(attacker.army, { manpower: 220, equipment: 90, readiness: 90, air: 80, defense: 80, morale: 90, experience: 40 });
  world.relations['KAZ:UZB'] = -70;
  performAction(world, player, { action: 'conflict', id: 'declare', target: 'UZB' });
  const gold = attacker.treasury; const supplies = attacker.army.supplies;
  assert.equal(performAction(world, player, { action: 'conflict', id: 'attack', target: 'UZB', units: 60 }).ok, true);
  assert.equal(performAction(world, player, { action: 'conflict', id: 'attack', target: 'UZB', units: 60 }).ok, true);
  const third = performAction(world, player, { action: 'conflict', id: 'attack', target: 'UZB', units: 60 });
  assert.equal(third.ok, false);
  assert.ok(attacker.army.supplies < supplies);
  assert.ok(attacker.treasury >= gold);
});

test('front fortification spends an operation and supplies but no gold', () => {
  const world = createWorld('fortification-test');
  const player = { id: 'p1', name: 'Лидер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const country = world.countries.KAZ;
  world.relations['KAZ:UZB'] = -70;
  performAction(world, player, { action: 'conflict', id: 'declare', target: 'UZB' });
  const before = { treasury: country.treasury, supplies: country.army.supplies, defense: country.army.defense };
  assert.equal(performAction(world, player, { action: 'conflict', id: 'fortify', target: 'UZB' }).ok, true);
  assert.equal(country.treasury, before.treasury);
  assert.equal(country.army.supplies, before.supplies - 6);
  assert.equal(country.army.defense, before.defense + 2.5);
  assert.equal(world.wars[0].operationsByTurn['1:a'], 1);
});

test('hostile diplomacy is limited to one relation-lowering button every two minutes', () => {
  const world = createWorld('trust-test');
  const player = { id: 'p1', name: 'Лидер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  world.countries.KAZ.treasury = 100;
  const before = getRelation(world, 'KAZ', 'UZB');
  assert.equal(performAction(world, player, { action: 'diplomacy', id: 'pressure', target: 'UZB' }).ok, true);
  assert.equal(getRelation(world, 'KAZ', 'UZB'), before - 18);
  world.countries.KAZ.treaties.push('trade:UZB');
  world.countries.UZB.treaties.push('trade:KAZ');
  const blocked = performAction(world, player, { action: 'diplomacy', id: 'break_treaties', target: 'UZB' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /через/);
  world.countries.KAZ.lastHostileActionAt -= 120001;
  assert.equal(performAction(world, player, { action: 'diplomacy', id: 'break_treaties', target: 'UZB' }).ok, true);
  assert.equal(world.countries.KAZ.treaties.includes('trade:UZB'), false);
  assert.equal(getRelation(world, 'KAZ', 'UZB'), before - 38);
});

test('a pressured defender can spend supplies on a six-tick counteroffensive', () => {
  const world = createWorld('surge-test');
  const player = { id: 'p1', name: 'Лидер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  world.relations['KAZ:UZB'] = -70;
  performAction(world, player, { action: 'conflict', id: 'declare', target: 'UZB' });
  const war = world.wars[0]; war.front = -25;
  world.countries.KAZ.army.supplies = 80;
  const result = performAction(world, player, { action: 'conflict', id: 'surge', target: 'UZB' });
  assert.equal(result.ok, true);
  assert.equal(war.surge.side, 'a');
  assert.equal(war.surge.expiresAtTick - war.surge.startedAtTick, 6);
  assert.equal(world.countries.KAZ.army.supplies, 65);
});

test('permanent occupation can erupt into revolt and be released peacefully', () => {
  const world = createWorld('resistance-test');
  const player = { id: 'p1', name: 'Лидер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const subject = world.countries.UZB;
  subject.occupation = { by: 'KAZ', percent: 62, permanent: true, warId: 'peace-line', resistance: 92, resistanceChecks: 0, nextResistanceAt: 0, revolt: null };
  let now = Date.now();
  for (let index = 0; index < 80 && !subject.occupation.revolt; index += 1) {
    now += 20000;
    advanceResistance(world, now);
  }
  assert.equal(subject.occupation.revolt.status, 'active');
  const result = performAction(world, player, { action: 'occupation', id: 'release', target: 'UZB' });
  assert.equal(result.ok, true);
  assert.equal(subject.occupation, null);
  assert.equal(subject.eliminated, false);
});

test('an occupation revolt can be suppressed only through a live uprising war', () => {
  const world = createWorld('suppression-test');
  const player = { id: 'p1', name: 'Лидер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const controller = world.countries.KAZ; const subject = world.countries.UZB;
  controller.treasury = 200; controller.army.supplies = 80;
  subject.occupation = { by: 'KAZ', percent: 46, permanent: true, warId: 'peace-line', resistance: 76, resistanceChecks: 4, nextResistanceAt: 0, revolt: { status: 'active', startedAt: Date.now() } };
  const result = performAction(world, player, { action: 'occupation', id: 'suppress', target: 'UZB' });
  assert.equal(result.ok, true);
  const war = world.wars.find((item) => item.status === 'active');
  assert.equal(war.kind, 'uprising');
  assert.equal(war.front, 46);
  assert.ok(war.suppressionTarget > war.front);
  assert.equal(subject.occupation.revolt.status, 'fighting');
});

test('a successful suppression keeps partial control while a successful revolt restores all land', () => {
  const scenario = (seed, controllerStrong) => {
    const world = createWorld(seed); const player = { id: 'p1', name: 'Лидер', countryCode: null };
    selectCountry(world, player, 'KAZ');
    const controller = world.countries.KAZ; const subject = world.countries.UZB;
    controller.treasury = 300; controller.army.supplies = 100;
    subject.occupation = { by: 'KAZ', percent: controllerStrong ? 42 : 12, permanent: true, warId: 'peace-line', resistance: 80, resistanceChecks: 5, nextResistanceAt: 0, revolt: { status: 'active', startedAt: Date.now() } };
    const strong = { manpower: 500, equipment: 100, readiness: 100, air: 100, navy: 80, defense: 100, supplies: 100, morale: 100, experience: 80, medical: 50 };
    const weak = { manpower: 5, equipment: 5, readiness: 15, air: 1, navy: 1, defense: 8, supplies: 35, morale: 25, experience: 2, medical: 2 };
    Object.assign(controller.army, controllerStrong ? strong : weak);
    Object.assign(subject.army, controllerStrong ? weak : strong);
    assert.equal(performAction(world, player, { action: 'occupation', id: 'suppress', target: 'UZB' }).ok, true);
    const war = world.wars[0]; let now = war.nextBattleAt;
    for (let index = 0; index < 120 && war.status === 'active'; index += 1) { advanceWars(world, now); now = war.nextBattleAt; }
    return { world, war, subject };
  };
  const suppressed = scenario('uprising-suppressed', true);
  assert.equal(suppressed.war.status, 'suppressed');
  assert.equal(suppressed.subject.occupation.permanent, true);
  assert.equal(suppressed.subject.occupation.revolt, null);
  assert.ok(suppressed.subject.occupation.percent < 100);
  const liberated = scenario('uprising-liberated', false);
  assert.equal(liberated.war.status, 'liberated');
  assert.equal(liberated.subject.occupation, null);
  assert.equal(liberated.subject.eliminated, false);
});

test('technology tree consumes strategic points and applies a permanent bonus', () => {
  const world = createWorld('technology-test');
  const player = { id: 'p1', name: 'Лидер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const kazakhstan = world.countries.KAZ;
  kazakhstan.treasury = 200;
  const beforeIncome = incomeFor(kazakhstan);
  const result = performAction(world, player, { action: 'technology', id: 'modern_taxation' });
  assert.equal(result.ok, true);
  assert.equal(kazakhstan.techs.modern_taxation, world.turn);
  assert.equal(kazakhstan.techPoints, 1);
  assert.ok(incomeFor(kazakhstan) > beforeIncome);
  assert.equal(performAction(world, player, { action: 'technology', id: 'modern_taxation' }).ok, false);
});

test('national project completes over several quarters and grants rewards', () => {
  const world = createWorld('project-test');
  const player = { id: 'p1', name: 'Лидер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const kazakhstan = world.countries.KAZ;
  kazakhstan.treasury = 300;
  const before = kazakhstan.infrastructure;
  assert.equal(performAction(world, player, { action: 'project', id: 'rail_network' }).ok, true);
  advanceTurn(world); advanceTurn(world); advanceTurn(world);
  assert.equal(kazakhstan.activeProject, null);
  assert.equal(kazakhstan.completedProjects.includes('rail_network'), true);
  assert.ok(kazakhstan.infrastructure >= before + 8);
});

test('state event offers a meaningful persistent choice', () => {
  const world = createWorld('decision-test');
  const player = { id: 'p1', name: 'Лидер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const before = world.countries.KAZ.happiness;
  assert.equal(world.countries.KAZ.pendingDecision, 'budget_debate');
  assert.equal(performAction(world, player, { action: 'decision', id: 'people' }).ok, true);
  assert.equal(world.countries.KAZ.pendingDecision, null);
  assert.equal(world.countries.KAZ.happiness, before + 6);
});

test('weak police gives a 50 percent theft chance at equal cyber level', () => {
  const world = createWorld('theft-chance-test');
  const attacker = world.countries.KAZ; const target = world.countries.UZB;
  attacker.cyber = 40; target.cyber = 40; target.police = 30;
  assert.equal(theftChance(attacker, target), 50);
  target.police = 80;
  assert.ok(theftChance(attacker, target) < 50);
});

test('a successful theft transfers an item and only one attempt is allowed per turn', () => {
  let scenario;
  for (let index = 0; index < 80 && !scenario; index += 1) {
    const world = createWorld(`theft-success-${index}`);
    const player = { id: 'p1', name: 'Агент', countryCode: null };
    selectCountry(world, player, 'KAZ');
    const attacker = world.countries.KAZ; const target = world.countries.UZB;
    attacker.cyber = 100; target.cyber = 0; target.police = 10; attacker.treasury = 100; target.treasury = 100;
    const beforeVault = target.vault.gold_reserve;
    const result = performAction(world, player, { action: 'theft', id: 'gold_reserve', target: 'UZB' });
    if (result.toast.includes('удалась')) scenario = { world, player, attacker, target, beforeVault };
  }
  assert.ok(scenario, 'deterministic seeds should include a successful operation');
  assert.equal(scenario.target.vault.gold_reserve, scenario.beforeVault - 1);
  assert.equal(scenario.attacker.stolenItems[0].from, 'UZB');
  assert.ok(scenario.attacker.treasury > 100);
  assert.equal(performAction(scenario.world, scenario.player, { action: 'theft', id: 'cipher_keys', target: 'UZB' }).ok, false);
});

test('a failed theft pays the target a fine and damages reputation and relations', () => {
  let scenario;
  for (let index = 0; index < 80 && !scenario; index += 1) {
    const world = createWorld(`theft-failure-${index}`);
    const player = { id: 'p1', name: 'Агент', countryCode: null };
    selectCountry(world, player, 'KAZ');
    const attacker = world.countries.KAZ; const target = world.countries.UZB;
    attacker.cyber = 0; target.cyber = 100; target.police = 100; attacker.treasury = 100; target.treasury = 100;
    const reputation = attacker.reputation; const relation = getRelation(world, 'KAZ', 'UZB');
    const result = performAction(world, player, { action: 'theft', id: 'research_prototype', target: 'UZB' });
    if (result.toast.includes('поймали')) scenario = { attacker, target, reputation, relation, world };
  }
  assert.ok(scenario, 'deterministic seeds should include a failed operation');
  assert.ok(scenario.attacker.treasury < 100);
  assert.ok(scenario.target.treasury > 100);
  assert.equal(scenario.attacker.reputation, scenario.reputation - 10);
  assert.equal(getRelation(scenario.world, 'KAZ', 'UZB'), scenario.relation - 18);
});

test('new worlds contain strategic resources, factions, formations and a victory path', () => {
  const world = createWorld('grand-strategy-model');
  const country = world.countries.KAZ;
  assert.deepEqual(Object.keys(country.resources).sort(), ['energy','food','fuel','metals','rare']);
  assert.ok(country.resourceProduction.fuel > 0);
  assert.ok(country.factions.people > 0);
  assert.ok(country.units.infantry > 0);
  assert.ok(country.victoryPath);
  assert.deepEqual(world.alliances, []);
  assert.deepEqual(world.tradeRoutes, []);
});

test('internal politics creates tradeoffs and is limited to one reform per quarter', () => {
  const world = createWorld('internal-politics');
  const player = { id: 'p1', name: 'Реформатор', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const country = world.countries.KAZ; country.treasury = 200;
  const people = country.factions.people; const business = country.factions.business;
  assert.equal(performAction(world, player, { action: 'internal_policy', id: 'people' }).ok, true);
  assert.ok(Math.abs(country.factions.people - (people + 10)) < .01);
  assert.ok(Math.abs(country.factions.business - (business - 3)) < .01);
  assert.equal(performAction(world, player, { action: 'internal_policy', id: 'anti_corruption' }).ok, false);
});

test('specialized unit programs consume both money and physical resources', () => {
  const world = createWorld('unit-programs');
  const player = { id: 'p1', name: 'Главком', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const country = world.countries.KAZ; country.treasury = 200; country.resources.fuel = 30; country.resources.metals = 30;
  const armor = country.units.armor;
  assert.equal(performAction(world, player, { action: 'unit_program', id: 'armor' }).ok, true);
  assert.equal(country.units.armor, armor + 6);
  assert.equal(country.resources.fuel, 23);
  assert.equal(country.resources.metals, 22);
});

test('a world crisis appears on schedule and accepts one national response', () => {
  const world = createWorld('crisis-cycle');
  const player = { id: 'p1', name: 'Премьер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  world.countries.KAZ.treasury = 500;
  while (world.turn < 5) advanceTurn(world);
  assert.ok(world.globalCrisis);
  const definition = require('../game').GLOBAL_CRISES.find((item) => item.id === world.globalCrisis.id);
  const affordable = definition.options.find((option) => !option.cost || world.countries.KAZ.treasury >= option.cost);
  assert.equal(performAction(world, player, { action: 'crisis_response', id: affordable.id }).ok, true);
  assert.equal(performAction(world, player, { action: 'crisis_response', id: affordable.id }).ok, false);
});

test('resource trade with a bot creates a route that delivers every quarter', () => {
  const world = createWorld('resource-trade');
  const player = { id: 'p1', name: 'Торговец', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const buyer = world.countries.KAZ; const seller = world.countries.RUS;
  buyer.treasury = 500; seller.resourceProduction.fuel = 10; seller.resources.fuel = 100;
  world.relations['KAZ:RUS'] = 60;
  assert.equal(performAction(world, player, { action: 'trade_route', id: 'propose', resource: 'fuel', target: 'RUS' }).ok, true);
  assert.equal(world.tradeRoutes.length, 1);
  const before = buyer.resources.fuel;
  advanceTurn(world);
  assert.ok(buyer.resources.fuel > before);
  assert.equal(world.tradeRoutes[0].lastDeliveryTurn, world.turn);
  assert.equal(performAction(world, player, { action: 'trade_route', id: 'cancel', routeId: world.tradeRoutes[0].id }).ok, true);
  assert.equal(world.tradeRoutes[0].status, 'closed');
});

test('a player can found a named bloc and invite a friendly bot', () => {
  const world = createWorld('international-bloc');
  const player = { id: 'p1', name: 'Дипломат', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const country = world.countries.KAZ; country.treasury = 300; world.relations['KAZ:UZB'] = 70;
  assert.equal(performAction(world, player, { action: 'alliance_bloc', id: 'create', name: 'Союз Великой степи' }).ok, true);
  assert.equal(world.alliances[0].name, 'Союз Великой степи');
  assert.equal(performAction(world, player, { action: 'alliance_bloc', id: 'invite', target: 'UZB' }).ok, true);
  assert.ok(world.alliances[0].members.includes('UZB'));
  assert.equal(world.countries.UZB.allianceId, world.alliances[0].id);
  assert.equal(performAction(world, player, { action: 'alliance_bloc', id: 'kick', target: 'UZB' }).ok, true);
  assert.equal(world.countries.UZB.allianceId, null);
  assert.equal(world.alliances[0].members.includes('UZB'), false);
});

test('advanced megaprojects enforce geographic and development requirements', () => {
  const world = createWorld('megaproject-requirements');
  const player = { id: 'p1', name: 'Архитектор', countryCode: null };
  selectCountry(world, player, 'KAZ');
  world.countries.KAZ.treasury = 500;
  const result = performAction(world, player, { action: 'project', id: 'global_port' });
  assert.equal(result.ok, false);
  assert.match(result.error, /морю/);
});

test('strategic intelligence produces a report and enforces one operation per turn', () => {
  let successful;
  for (let index = 0; index < 50 && !successful; index += 1) {
    const world = createWorld(`strategic-intel-${index}`);
    const player = { id: 'p1', name: 'Разведчик', countryCode: null };
    selectCountry(world, player, 'KAZ');
    const country = world.countries.KAZ; country.treasury = 300; country.cyber = 100;
    const target = world.countries.UZB; target.cyber = 0; target.police = 0;
    const result = performAction(world, player, { action: 'intelligence', id: 'recon', target: 'UZB' });
    if (country.intelligenceReports.length) successful = { world, player, country, result };
  }
  assert.ok(successful);
  assert.match(successful.country.intelligenceReports[0].report, /Армия/);
  assert.equal(performAction(successful.world, successful.player, { action: 'intelligence', id: 'sabotage', target: 'UZB' }).ok, false);
});

test('completing a non-military victory path records the country in the hall of fame', () => {
  const world = createWorld('peace-victory');
  const player = { id: 'p1', name: 'Миротворец', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const country = world.countries.KAZ;
  country.victoryPath = 'peace'; country.stability = 100; country.happiness = 100;
  country.treaties = ['trade:UZB','trade:KGZ','trade:RUS','nonaggression:CHN','alliance:TUR'];
  advanceTurn(world);
  assert.equal(country.victoryAchieved, true);
  assert.equal(world.hallOfFame[0].code, 'KAZ');
  assert.equal(world.hallOfFame[0].path, 'peace');
});

test('every country receives physical deposits with plausible bounded properties', () => {
  const world = createWorld('physical-deposits');
  for (const country of Object.values(world.countries)) {
    assert.ok(country.extractionSites.length >= 1 && country.extractionSites.length <= 3);
    assert.equal(new Set(country.extractionSites.map((site) => site.type)).size, country.extractionSites.length);
    for (const site of country.extractionSites) {
      assert.ok(EXTRACTION_COMMODITIES[site.type]);
      assert.equal(site.id.startsWith(`${country.code}-`), true);
      assert.ok(site.purchaseCost > 0 && site.baseRate > 0 && site.baseCapacity > 0);
      assert.ok(site.position.u >= 0 && site.position.u <= 1 && site.position.v >= 0 && site.position.v <= 1);
    }
  }
});

test('a player can buy a mine, accumulate output, collect it and sell to a supplier', () => {
  const world = createWorld('extraction-cycle');
  const player = { id: 'p1', name: 'Промышленник', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const country = world.countries.KAZ; const site = country.extractionSites[0];
  country.treasury = 1000;
  const beforePurchase = country.treasury;
  assert.equal(performAction(world, player, { action: 'extraction', id: 'buy', target: 'KAZ', siteId: site.id }).ok, true);
  assert.equal(site.ownerCode, 'KAZ');
  assert.equal(country.treasury, beforePurchase - site.purchaseCost);

  site.lastAccruedAt -= 10 * 60 * 1000;
  assert.equal(performAction(world, player, { action: 'extraction', id: 'collect', target: 'KAZ', siteId: site.id }).ok, true);
  const extracted = country.commodityStorage[site.type];
  assert.ok(extracted > 0);
  assert.equal(site.stored, 0);

  world.commodityMarket.multipliers[site.type] = 2;
  const beforeSale = country.treasury;
  assert.equal(performAction(world, player, { action: 'extraction', id: 'sell', commodity: site.type }).ok, true);
  assert.equal(country.commodityStorage[site.type], 0);
  assert.equal(country.treasury, Math.round((beforeSale + extracted * EXTRACTION_COMMODITIES[site.type].basePrice * 2) * 10) / 10);
});

test('foreign deposits cannot be bought and an owned mine can be upgraded', () => {
  const world = createWorld('extraction-permissions');
  const player = { id: 'p1', name: 'Недропользователь', countryCode: null };
  selectCountry(world, player, 'KAZ');
  const country = world.countries.KAZ; country.treasury = 1000;
  const foreignSite = world.countries.UZB.extractionSites[0];
  assert.equal(performAction(world, player, { action: 'extraction', id: 'buy', target: 'UZB', siteId: foreignSite.id }).ok, false);
  const ownSite = country.extractionSites[0];
  performAction(world, player, { action: 'extraction', id: 'buy', target: 'KAZ', siteId: ownSite.id });
  const oldRate = ownSite.baseRate;
  assert.equal(performAction(world, player, { action: 'extraction', id: 'upgrade', target: 'KAZ', siteId: ownSite.id }).ok, true);
  assert.equal(ownSite.level, 2);
  assert.ok(ownSite.baseRate * (1 + (ownSite.level - 1) * .68) > oldRate);
});

test('the commodity market is shared, deterministic and refreshes every ten minutes', () => {
  const start = Math.floor(2_000_000_000_000 / COMMODITY_MARKET_INTERVAL_MS) * COMMODITY_MARKET_INTERVAL_MS;
  const first = commodityMarketForTime(start);
  const same = commodityMarketForTime(start + COMMODITY_MARKET_INTERVAL_MS - 1);
  const next = commodityMarketForTime(start + COMMODITY_MARKET_INTERVAL_MS);
  assert.deepEqual(first, same);
  assert.notEqual(first.cycle, next.cycle);
  assert.ok(Object.values(first.multipliers).every((value) => value >= .7 && value <= 2));
  assert.notDeepEqual(first.multipliers, next.multipliers);
  const world = createWorld('market-rollover'); world.commodityMarket = first;
  assert.equal(updateCommodityMarket(world, start + COMMODITY_MARKET_INTERVAL_MS), true);
  assert.deepEqual(world.commodityMarket, next);
});

test('old saves migrate without losing countries and gain extraction storage', () => {
  const world = createWorld('legacy-extraction');
  delete world.commodityMarket;
  delete world.countries.KAZ.commodityStorage;
  delete world.countries.KAZ.extractionSites;
  migrateWorld(world);
  assert.ok(world.commodityMarket);
  assert.deepEqual(Object.keys(world.countries.KAZ.commodityStorage).sort(), Object.keys(EXTRACTION_COMMODITIES).sort());
  assert.ok(world.countries.KAZ.extractionSites.length >= 1);
});
