const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CATALOG, createWorld, selectCountry, performAction, advanceTurn, getRelation, incomeFor, theftChance
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
  assert.ok(world.countries.UZB.lastTribute.amount > 0);
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

test('ultimatums and treaty breaks clearly lower trust toward war threshold', () => {
  const world = createWorld('trust-test');
  const player = { id: 'p1', name: 'Лидер', countryCode: null };
  selectCountry(world, player, 'KAZ');
  world.countries.KAZ.treasury = 100;
  const before = getRelation(world, 'KAZ', 'UZB');
  assert.equal(performAction(world, player, { action: 'diplomacy', id: 'pressure', target: 'UZB' }).ok, true);
  assert.equal(getRelation(world, 'KAZ', 'UZB'), before - 18);
  world.countries.KAZ.treaties.push('trade:UZB');
  world.countries.UZB.treaties.push('trade:KAZ');
  assert.equal(performAction(world, player, { action: 'diplomacy', id: 'break_treaties', target: 'UZB' }).ok, true);
  assert.equal(world.countries.KAZ.treaties.includes('trade:UZB'), false);
  assert.equal(getRelation(world, 'KAZ', 'UZB'), before - 38);
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
