const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { WebSocketServer, WebSocket } = require('ws');
const topojson = require('topojson-client');
const { resumeHash, recoverRoomState } = require('./recovery');
const { OutbreakService } = require('./outbreak');
const {
  CATALOG, CATALOG_BY_CODE, DEVELOPMENT_ACTIONS, MILITARY_ACTIONS, BATTLE_TACTICS, MILITARY_DOCTRINES, TECHNOLOGY_TREE, NATIONAL_PROJECTS, DECISIONS, STEALABLE_ASSETS, PLAYER_NEWS_CATEGORIES,
  STRATEGIC_RESOURCES, EXTRACTION_COMMODITIES, POLITICAL_FACTIONS, ADVISORS, UNIT_PROGRAMS, GLOBAL_CRISES, VICTORY_PATHS, WAR_TERRAINS,
  createWorld, migrateWorld, selectCountry, performAction, advanceTurn, advanceWars, advanceResistance, calculateScores, getRelation, ranking, updateCommodityMarket
} = require('./game');

const PORT = Number(process.env.PORT) || 3080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SAVE_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data', 'rooms');
const OUTBREAK_SAVE_DIR = process.env.DATA_DIR ? path.join(path.resolve(process.env.DATA_DIR), 'outbreak') : path.join(__dirname, 'data', 'outbreak');
const rooms = new Map();
fs.mkdirSync(SAVE_DIR, { recursive: true });
const outbreakService = new OutbreakService({ saveDir: OUTBREAK_SAVE_DIR });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon'
};

function cleanName(value) {
  return String(value || 'Лидер').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 24) || 'Лидер';
}
function cleanCode(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); }
function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from(crypto.randomBytes(6), (b) => alphabet[b % alphabet.length]).join(''); } while (rooms.has(code));
  return code;
}
function send(socket, payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function safeRoom(room) {
  return {
    code: room.code, createdAt: room.createdAt, updatedAt: Date.now(), hostId: room.hostId,
    players: room.players.map(({ id, token, resumeHash: hash, name, countryCode, joinedAt }) => ({ id, token, resumeHash: hash || resumeHash(token), name, countryCode, joinedAt })),
    world: room.world
  };
}
function saveRoom(room) {
  room.updatedAt = Date.now();
  const target = path.join(SAVE_DIR, `${room.code}.json`);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(safeRoom(room)));
  fs.renameSync(temporary, target);
}
function loadRooms() {
  for (const file of fs.readdirSync(SAVE_DIR).filter((name) => /^[A-Z0-9]{6}\.json$/.test(name))) {
    try {
      const room = JSON.parse(fs.readFileSync(path.join(SAVE_DIR, file), 'utf8'));
      room.connections = new Map();
      for (const player of room.players || []) player.resumeHash ||= resumeHash(player.token);
      migrateWorld(room.world);
      room.world.nextTurnAt = Math.max(Date.now() + 5000, room.world.nextTurnAt || 0);
      if (room.world?.countries && room.players) rooms.set(room.code, room);
    } catch (error) { console.warn(`Не удалось загрузить ${file}:`, error.message); }
  }
}

function mapGeoJson() {
  // 1:110m keeps the shared world responsive on integrated GPUs and older laptops.
  // Tiny states absent at this scale are rendered as interactive capital markers.
  const topology = JSON.parse(fs.readFileSync(require.resolve('world-atlas/countries-110m.json'), 'utf8'));
  const source = topojson.feature(topology, topology.objects.countries);
  const byNumeric = Object.fromEntries(CATALOG.map((country) => [country.numeric, country]));
  const features = source.features.map((feature) => {
    const playable = byNumeric[feature.id];
    if (playable) return { ...feature, properties: { code: playable.code, name: playable.name } };
    return { ...feature, properties: { code: `GEO_${feature.id}`, name: feature.properties?.name || 'Территория', terrainOnly: true } };
  });
  return JSON.stringify({ type: 'FeatureCollection', features });
}
const MAP_JSON = mapGeoJson();
const MAP_GZIP = zlib.gzipSync(MAP_JSON, { level: 9 });

function createRoom() {
  const code = makeCode();
  const room = { code, createdAt: Date.now(), updatedAt: Date.now(), hostId: null, players: [], connections: new Map(), world: createWorld(code) };
  rooms.set(code, room);
  saveRoom(room);
  return room;
}

function publicState(room, viewerId) {
  const viewer = room.players.find((p) => p.id === viewerId);
  const viewerCode = viewer?.countryCode;
  const relations = viewerCode
    ? Object.fromEntries(CATALOG.filter((c) => c.code !== viewerCode).map((c) => [c.code, getRelation(room.world, viewerCode, c.code)]))
    : {};
  return {
    type: 'state', roomCode: room.code, viewerId, hostId: room.hostId, createdAt: room.createdAt, isHost: room.hostId === viewerId, recoveryVersion: 1,
    players: room.players.map((p) => ({ id: p.id, name: p.name, countryCode: p.countryCode, joinedAt: p.joinedAt, resumeHash: p.resumeHash || resumeHash(p.token), connected: room.connections.has(p.id) })),
    catalog: CATALOG,
    world: room.world,
    relations,
    ranking: ranking(room.world),
    definitions: { development: DEVELOPMENT_ACTIONS, military: MILITARY_ACTIONS, tactics: BATTLE_TACTICS, doctrines: MILITARY_DOCTRINES, technologies: TECHNOLOGY_TREE, projects: NATIONAL_PROJECTS, decisions: DECISIONS, assets: STEALABLE_ASSETS, playerNewsCategories: PLAYER_NEWS_CATEGORIES, resources: STRATEGIC_RESOURCES, commodities: EXTRACTION_COMMODITIES, factions: POLITICAL_FACTIONS, advisors: ADVISORS, unitPrograms: UNIT_PROGRAMS, crises: GLOBAL_CRISES, victoryPaths: VICTORY_PATHS, terrains: WAR_TERRAINS },
    savedAt: room.updatedAt
  };
}

function broadcast(room) {
  for (const [playerId, socket] of room.connections) send(socket, publicState(room, playerId));
}

function broadcastWorldDelta(room, outcome) {
  const basePayload = {
    type: 'worldDelta', at: Date.now(), savedAt: room.updatedAt,
    wars: outcome.wars.map((id) => room.world.wars.find((war) => war.id === id)).filter(Boolean),
    countries: Object.fromEntries(outcome.countries.map((code) => [code, room.world.countries[code]]).filter(([, country]) => country)),
    news: room.world.news,
    ranking: ranking(room.world)
  };
  for (const [playerId, socket] of room.connections) {
    const viewerCode = room.players.find((player) => player.id === playerId)?.countryCode;
    const relations = viewerCode ? Object.fromEntries(CATALOG.filter((item) => item.code !== viewerCode).map((item) => [item.code, getRelation(room.world, viewerCode, item.code)])) : {};
    send(socket, { ...basePayload, relations });
  }
}

function welcome(socket, room, player, resumed) {
  socket.roomCode = room.code; socket.playerId = player.id;
  const oldSocket = room.connections.get(player.id);
  if (oldSocket && oldSocket !== socket) oldSocket.close(4001, 'Вход с другого устройства');
  room.connections.set(player.id, socket);
  send(socket, { type: 'welcome', playerToken: player.token, roomCode: room.code, resumed });
  saveRoom(room); broadcast(room);
}

function hello(socket, message) {
  const action = message.action === 'create' ? 'create' : 'join';
  const requestedToken = String(message.playerToken || '').slice(0, 80);
  const roomCode = cleanCode(message.roomCode);
  let room = action === 'create' ? createRoom() : rooms.get(roomCode);
  if (!room && action === 'join' && message.recovery) {
    try {
      room = recoverRoomState({ code: roomCode, snapshot: message.recovery, requestedToken, catalogCodes: new Set(CATALOG.map((country) => country.code)) });
      room.connections = new Map();
      migrateWorld(room.world);
      rooms.set(room.code, room);
      saveRoom(room);
      console.log(`Комната ${room.code} восстановлена из браузерной копии игрока ${room.recoveredBy}`);
    } catch (error) {
      return send(socket, { type: 'error', message: `Не удалось восстановить комнату: ${error.message}` });
    }
  }
  if (!room) return send(socket, { type: 'error', code: 'ROOM_MISSING', roomCode, message: 'Комната исчезла после перезапуска сервера. Ищем резервную копию на этом устройстве…' });

  let player = requestedToken ? room.players.find((item) => item.token === requestedToken || item.resumeHash === resumeHash(requestedToken)) : null;
  const resumed = Boolean(player);
  if (!player) {
    if (room.players.length >= 24) return send(socket, { type: 'error', message: 'В этой комнате уже 24 игрока.' });
    const token = crypto.randomBytes(24).toString('hex');
    player = { id: crypto.randomUUID(), token, resumeHash: resumeHash(token), name: cleanName(message.name), countryCode: null, joinedAt: Date.now() };
    room.players.push(player);
    if (!room.hostId) room.hostId = player.id;
  } else {
    player.token = requestedToken;
    player.resumeHash = resumeHash(requestedToken);
    if (message.name) player.name = cleanName(message.name);
  }
  welcome(socket, room, player, resumed);
}

function handleMessage(socket, raw) {
  let message;
  try { message = JSON.parse(raw.toString()); } catch { return send(socket, { type: 'error', message: 'Некорректное сообщение.' }); }
  if (message.type === 'outbreakHello' || socket.gameMode === 'outbreak') return outbreakService.handle(socket, message);
  if (message.type === 'hello') return hello(socket, message);
  const room = rooms.get(socket.roomCode);
  const player = room?.players.find((p) => p.id === socket.playerId);
  if (!room || !player) return send(socket, { type: 'error', message: 'Сначала войдите в комнату.' });

  let result = { ok: false, error: 'Неизвестная команда.' };
  if (message.type === 'selectCountry') result = selectCountry(room.world, player, cleanCode(message.code).slice(0, 3));
  if (message.type === 'action') result = performAction(room.world, player, message);
  if (message.type === 'advanceTurn') {
    result = { ok: false, error: 'Ручной пропуск хода отключён: все игроки ждут общий таймер.' };
  }
  if (!result.ok) return send(socket, { type: 'error', message: result.error });
  calculateScores(room.world);
  saveRoom(room);
  if (result.toast) send(socket, { type: 'toast', message: result.toast });
  broadcast(room);
}

function serve(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/health') {
    response.writeHead(200, { 'content-type': MIME['.json'] });
    return response.end(JSON.stringify({ ok: true, rooms: rooms.size, outbreakRooms: outbreakService.rooms.size, countries: CATALOG.length }));
  }
  if (url.pathname === '/api/map') {
    const acceptsGzip = /\bgzip\b/.test(request.headers['accept-encoding'] || '');
    response.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'public, max-age=86400', ...(acceptsGzip ? { 'content-encoding': 'gzip' } : {}) });
    return response.end(acceptsGzip ? MAP_GZIP : MAP_JSON);
  }
  const requested = url.pathname === '/' ? '/index.html' : ['/outbreak','/outbreak/'].includes(url.pathname) ? '/outbreak/index.html' : decodeURIComponent(url.pathname);
  const target = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!target.startsWith(PUBLIC_DIR)) { response.writeHead(403); return response.end('Forbidden'); }
  fs.readFile(target, (error, data) => {
    if (error) { response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return response.end('Не найдено'); }
    response.writeHead(200, { 'content-type': MIME[path.extname(target)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    response.end(data);
  });
}

loadRooms();
const server = http.createServer(serve);
const wss = new WebSocketServer({ server, maxPayload: 2 * 1024 * 1024 });
wss.on('connection', (socket) => {
  socket.on('message', (raw) => handleMessage(socket, raw));
  socket.on('close', () => {
    if (socket.gameMode === 'outbreak') return outbreakService.disconnect(socket);
    const room = rooms.get(socket.roomCode);
    if (room?.connections.get(socket.playerId) === socket) { room.connections.delete(socket.playerId); broadcast(room); }
  });
  socket.on('error', () => {});
});

setInterval(() => {
  const now = Date.now();
  outbreakService.tick();
  for (const room of rooms.values()) {
    const marketChanged = updateCommodityMarket(room.world, now);
    if (room.world.nextTurnAt <= now) { advanceTurn(room.world); saveRoom(room); broadcast(room); continue; }
    if (marketChanged) { saveRoom(room); broadcast(room); }
    const hasWar = room.world.wars?.some((war) => war.status === 'active');
    const hasOccupation = Object.values(room.world.countries || {}).some((country) => country.occupation?.permanent && !country.occupation.absorbed);
    if (!hasWar && !hasOccupation) continue;
    const warOutcome = hasWar ? advanceWars(room.world, now) : { changed: false, wars: [], countries: [], ended: false };
    let resistanceOutcome = { changed: false, wars: [], countries: [], ended: false };
    if (hasOccupation && now >= (room.nextResistanceSweepAt || 0)) {
      resistanceOutcome = advanceResistance(room.world, now);
      room.nextResistanceSweepAt = now + 2000;
    }
    const outcome = {
      changed: warOutcome.changed || resistanceOutcome.changed,
      wars: [...new Set([...(warOutcome.wars || []), ...(resistanceOutcome.wars || [])])],
      countries: [...new Set([...(warOutcome.countries || []), ...(resistanceOutcome.countries || [])])],
      ended: warOutcome.ended || resistanceOutcome.ended
    };
    if (!outcome.changed) continue;
    room.updatedAt = now;
    room.warTicksSinceSave = (room.warTicksSinceSave || 0) + 1;
    if (outcome.ended || room.warTicksSinceSave >= 5) { saveRoom(room); room.warTicksSinceSave = 0; }
    broadcastWorldDelta(room, outcome);
  }
}, 500).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`WORLD ORDER запущен: http://localhost:${PORT}`);
  console.log(`Загружено стран: ${CATALOG.length}, сохранённых миров: ${rooms.size}`);
});

module.exports = { server, rooms, publicState, saveRoom };
