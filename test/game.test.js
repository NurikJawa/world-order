const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CATALOG, createWorld, selectCountry, performAction, advanceTurn, advanceWars, advanceResistance, getRelation, incomeFor, ranking, theftChance
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
