const crypto = require('node:crypto');

function resumeHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function cleanPlayerName(value) {
  return String(value || 'Лидер').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 24) || 'Лидер';
}

function recoverRoomState({ code, snapshot, requestedToken, catalogCodes, now = Date.now() }) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Резервная копия отсутствует');
  if (snapshot.version !== 1 || snapshot.roomCode !== code) throw new Error('Резервная копия относится к другой комнате');
  if (!requestedToken || requestedToken.length < 20) throw new Error('На устройстве нет ключа игрока для восстановления');
  if (!snapshot.world?.countries || typeof snapshot.world.countries !== 'object') throw new Error('В резервной копии нет состояния мира');
  const availableCodes = catalogCodes instanceof Set ? catalogCodes : new Set(catalogCodes || []);
  const worldCodes = Object.keys(snapshot.world.countries);
  if (worldCodes.length !== availableCodes.size || worldCodes.some((countryCode) => !availableCodes.has(countryCode))) throw new Error('Список стран в резервной копии повреждён');
  if (!Array.isArray(snapshot.players) || !snapshot.players.length || snapshot.players.length > 24) throw new Error('Список игроков в резервной копии повреждён');

  const expectedHash = resumeHash(requestedToken);
  const ids = new Set(); const countries = new Set(); const hashes = new Set();
  const players = snapshot.players.map((item) => {
    const id = String(item?.id || '').slice(0, 80);
    const countryCode = item?.countryCode == null ? null : String(item.countryCode).slice(0, 3);
    const hash = String(item?.resumeHash || '').toLowerCase();
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(id) || ids.has(id)) throw new Error('Идентификаторы игроков повреждены');
    if (!/^[a-f0-9]{64}$/.test(hash) || hashes.has(hash)) throw new Error('Ключи восстановления игроков повреждены');
    if (countryCode && (!availableCodes.has(countryCode) || countries.has(countryCode))) throw new Error('Выбор стран игроков повреждён');
    ids.add(id); hashes.add(hash); if (countryCode) countries.add(countryCode);
    return {
      id,
      token: hash === expectedHash ? requestedToken : null,
      resumeHash: hash,
      name: cleanPlayerName(item.name),
      countryCode,
      joinedAt: Number(item.joinedAt) || now
    };
  });
  const recoveringPlayer = players.find((player) => player.resumeHash === expectedHash);
  if (!recoveringPlayer) throw new Error('Эта копия не принадлежит вашему игроку');

  const world = JSON.parse(JSON.stringify(snapshot.world));
  for (const [countryCode, country] of Object.entries(world.countries)) {
    const owner = players.find((player) => player.countryCode === countryCode);
    country.ownerId = owner?.id || null;
    country.isBot = !owner;
  }
  world.nextTurnAt = Math.max(now + 5000, Number(world.nextTurnAt) || 0);
  world.news ||= [];
  world.news.unshift({
    id: crypto.randomUUID(), turn: Number(world.turn) || 1, tone: 'gold', createdAt: now,
    text: 'Комната автоматически восстановлена из резервной копии игрока после перезапуска сервера.'
  });
  world.news = world.news.slice(0, 24);

  return {
    code,
    createdAt: Number(snapshot.createdAt) || now,
    updatedAt: now,
    hostId: players.some((player) => player.id === snapshot.hostId) ? snapshot.hostId : recoveringPlayer.id,
    players,
    world,
    recoveredBy: recoveringPlayer.id
  };
}

module.exports = { resumeHash, recoverRoomState };
