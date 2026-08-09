const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOG, createWorld, selectCountry } = require('../game');
const { resumeHash, recoverRoomState } = require('../recovery');

function recoveryFixture() {
  const world = createWorld('ABC123');
  const first = { id: 'player-one-id', token: 'a'.repeat(48), name: 'Первый', countryCode: null, joinedAt: 100 };
  const second = { id: 'player-two-id', token: 'b'.repeat(48), name: 'Второй', countryCode: null, joinedAt: 200 };
  selectCountry(world, first, 'KAZ'); selectCountry(world, second, 'UZB');
  return {
    world,
    first,
    second,
    snapshot: {
      version: 1, roomCode: 'ABC123', createdAt: 50, hostId: first.id, savedAt: 300,
      players: [first, second].map((player) => ({ id: player.id, name: player.name, countryCode: player.countryCode, joinedAt: player.joinedAt, resumeHash: resumeHash(player.token) })),
      world
    }
  };
}

test('a browser snapshot restores the same room and securely resumes its owner', () => {
  const { first, second, snapshot } = recoveryFixture();
  const room = recoverRoomState({ code: 'ABC123', snapshot, requestedToken: first.token, catalogCodes: new Set(CATALOG.map((country) => country.code)), now: 1000 });
  assert.equal(room.code, 'ABC123');
  assert.equal(room.hostId, first.id);
  assert.equal(room.players.find((player) => player.id === first.id).token, first.token);
  assert.equal(room.players.find((player) => player.id === second.id).token, null);
  assert.equal(room.world.countries.KAZ.ownerId, first.id);
  assert.equal(room.world.countries.UZB.ownerId, second.id);
  assert.equal(room.world.nextTurnAt >= 6000, true);
  assert.match(room.world.news[0].text, /восстановлена/);
});

test('a player cannot restore somebody else snapshot without the original device token', () => {
  const { snapshot } = recoveryFixture();
  assert.throws(() => recoverRoomState({ code: 'ABC123', snapshot, requestedToken: 'c'.repeat(48), catalogCodes: new Set(CATALOG.map((country) => country.code)) }), /не принадлежит/);
});

test('a truncated world snapshot is rejected instead of creating a broken room', () => {
  const { first, snapshot } = recoveryFixture();
  delete snapshot.world.countries.FRA;
  assert.throws(() => recoverRoomState({ code: 'ABC123', snapshot, requestedToken: first.token, catalogCodes: new Set(CATALOG.map((country) => country.code)) }), /Список стран/);
});
