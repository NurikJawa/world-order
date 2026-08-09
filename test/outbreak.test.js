const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  OutbreakService, createOutbreakWorld, startOutbreak, advanceOutbreak, validateUpgrade,
  performCountryAction, publicWorld, PATHOGEN_UPGRADES, RESPONSE_UPGRADES
} = require('../outbreak');

test('outbreak world starts with 195 countries and a hidden patient zero', () => {
  const world = createOutbreakWorld('TEST01');
  assert.equal(Object.keys(world.countries).length, 195);
  assert.ok(world.totalPopulation > 7_500_000_000 && world.totalPopulation < 8_500_000_000);
  assert.ok(world.countries.NGA.population > 200_000_000);
  assert.equal(world.status, 'lobby');
  startOutbreak(world);
  assert.equal(world.status, 'active');
  assert.ok(world.countries[world.originCode].infected >= 1000);
  assert.equal(world.totals.detectedCountries, 0);
});

test('continuous simulation grows infection and team resources without manual turns', () => {
  const world = createOutbreakWorld('TEST02');
  startOutbreak(world);
  const before = world.totals.infected;
  for (let day = 0; day < 35 && world.status === 'active'; day += 1) advanceOutbreak(world);
  assert.ok(world.day > 30);
  assert.ok(world.pathogen.peakInfected > before);
  assert.ok(world.pathogen.points > 20);
  assert.ok(world.response.points > 24);
});

test('both teams have prerequisite-based upgrade trees', () => {
  const world = createOutbreakWorld('TEST03');
  const locked = validateUpgrade('pathogen', world.pathogen, 'surface_shell');
  assert.match(locked.error, /предыдущие/i);
  const first = validateUpgrade('pathogen', world.pathogen, 'microdroplets');
  assert.equal(first.node.id, PATHOGEN_UPGRADES[0].nodes[0].id);
  world.pathogen.points -= first.node.cost; world.pathogen.upgrades.push(first.node.id);
  assert.equal(validateUpgrade('pathogen', world.pathogen, 'surface_shell').node.id, 'surface_shell');
  assert.equal(validateUpgrade('response', world.response, RESPONSE_UPGRADES[0].nodes[0].id).node.id, 'diagnostic_network');
});

test('country operations spend only the acting team resource', () => {
  const world = createOutbreakWorld('TEST04');
  startOutbreak(world);
  const pathogen = { team: 'pathogen', actions: 0, lastActionAt: 0 };
  const response = { team: 'response', actions: 0, lastActionAt: 0 };
  const origin = world.originCode;
  const dna = world.pathogen.points; const ops = world.response.points;
  assert.equal(performCountryAction(world, pathogen, { id: 'silent_wave', target: origin }).ok, true);
  assert.ok(world.pathogen.points < dna); assert.equal(world.response.points, ops);
  assert.equal(performCountryAction(world, response, { id: 'scan', target: origin }).ok, true);
  assert.ok(world.response.points < ops); assert.equal(world.countries[origin].known, true);
});

test('response players see fog-of-war estimates while pathogen players see actual cases', () => {
  const world = createOutbreakWorld('TEST05'); startOutbreak(world);
  const room = { world };
  const origin = world.originCode; const actual = world.countries[origin].infected;
  const hidden = publicWorld(room, { team: 'response' });
  const visible = publicWorld(room, { team: 'pathogen' });
  assert.equal(hidden.countries[origin].infected, 0);
  assert.equal(hidden.totals.infected, 0);
  assert.equal(visible.countries[origin].infected, actual);
  world.countries[origin].known = true; world.countries[origin].detection = 70;
  assert.ok(publicWorld(room, { team: 'response' }).countries[origin].infected > 0);
});

test('outbreak rooms cap the lobby at ten human players', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'outbreak-test-'));
  try {
    const service = new OutbreakService({ saveDir: temporary });
    const sockets = [];
    const socket = () => ({ readyState: 1, messages: [], send(value) { this.messages.push(JSON.parse(value)); }, close() {} });
    const creator = socket(); sockets.push(creator);
    service.handle(creator, { type: 'outbreakHello', action: 'create', name: 'Игрок 1', team: 'pathogen' });
    const code = creator.messages.find((message) => message.type === 'outbreakWelcome').roomCode;
    for (let index = 2; index <= 11; index += 1) {
      const client = socket(); sockets.push(client);
      service.handle(client, { type: 'outbreakHello', action: 'join', roomCode: code, name: `Игрок ${index}`, team: index % 2 ? 'pathogen' : 'response' });
    }
    assert.equal(service.rooms.get(code).players.length, 10);
    assert.match(sockets.at(-1).messages.at(-1).message, /10 участников/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('live ticks send a compact country delta instead of the full planet', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'outbreak-delta-test-'));
  try {
    const service = new OutbreakService({ saveDir: temporary });
    const socket = { readyState: 1, messages: [], send(value) { this.messages.push(JSON.parse(value)); }, close() {} };
    service.handle(socket, { type: 'outbreakHello', action: 'create', name: 'Создатель', team: 'pathogen' });
    const room = [...service.rooms.values()][0]; const fullBytes = JSON.stringify(service.publicState(room, room.hostId)).length;
    startOutbreak(room.world);
    service.broadcastTick(room, [room.world.originCode]);
    const delta = socket.messages.at(-1);
    assert.equal(delta.type, 'outbreakTick');
    assert.equal(Object.keys(delta.world.countries).length, 1);
    assert.equal(delta.world.countries[room.world.originCode].population, undefined);
    assert.ok(JSON.stringify(delta).length < fullBytes / 4);
    const responseSocket = { readyState: 1, messages: [], send(value) { this.messages.push(JSON.parse(value)); }, close() {} };
    service.handle(responseSocket, { type: 'outbreakHello', action: 'join', roomCode: room.code, name: 'Врач', team: 'response' });
    service.broadcastTick(room, [room.world.originCode]);
    assert.deepEqual(responseSocket.messages.at(-1).world.countries, {});
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('an empty saved room pauses instead of consuming simulation CPU', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'outbreak-pause-test-'));
  try {
    const service = new OutbreakService({ saveDir: temporary });
    const room = service.createRoom({}); startOutbreak(room.world); room.world.nextTickAt = 0;
    const day = room.world.day; service.tick();
    assert.equal(room.world.day, day);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
