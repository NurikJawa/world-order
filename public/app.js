const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const app = {
  socket: null,
  state: null,
  mapData: null,
  pathsReady: false,
  selectedCode: null,
  modalCode: null,
  activeTab: 'overview',
  layer: 'terrain',
  transform: { x: 0, y: 0, k: 1 },
  drag: null,
  reconnectTimer: null,
  connectionTimer: null,
  connection: null,
  visualOccupations: {},
  warRenderStep: 0
};

const PUBLIC_GAME_URL = 'https://world-order-game.onrender.com';
const isLocalGame = ['127.0.0.1', 'localhost', '0.0.0.0'].includes(location.hostname);

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function formatNumber(value, digits = 0) {
  if (value == null) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
}
function money(value) { return `${formatNumber(value, 1)} млрд`; }
function catalog(code) { return app.state?.catalog.find((c) => c.code === code); }
function country(code) { return app.state?.world.countries[code]; }
function me() { return app.state?.players.find((p) => p.id === app.state.viewerId); }
function myCountry() { return country(me()?.countryCode); }
function ownerOf(code) { return app.state?.players.find((p) => p.countryCode === code); }
function relationText(value) {
  if (value >= 70) return 'Близкие союзники';
  if (value >= 35) return 'Дружественные';
  if (value >= 10) return 'Положительные';
  if (value > -10) return 'Нейтральные';
  if (value > -40) return 'Напряжённые';
  if (value > -70) return 'Враждебные';
  return 'Критический конфликт';
}
function regionName(region) {
  return ({ Africa: 'Африка', Americas: 'Америка', Asia: 'Азия', Europe: 'Европа', Oceania: 'Океания', Antarctic: 'Антарктика' })[region] || region;
}
function activeWarForCountry(code) {
  return (app.state?.world?.wars || []).find((war) => war.status === 'active' && (war.a === code || war.b === code));
}
function warSide(war, code) {
  if (!war) return null;
  if (war.a === code || war.supporters?.a?.some((support) => support.code === code)) return 'a';
  if (war.b === code || war.supporters?.b?.some((support) => support.code === code)) return 'b';
  return null;
}
function supportCostFor(c) { return Math.round(Math.max(80, Math.min(260, 70 + (c?.militaryPower || 0) * .55))); }

function theftChanceFor(attacker, target) {
  if (!attacker || !target) return 0;
  const policeBase = target.police < 45 ? 50 : 50 - (target.police - 45) * .9;
  const cyberEdge = (attacker.cyber - target.cyber) * .15;
  const intelligence = (myTechBonuses().intelPct || 0) * 50;
  return Math.max(12, Math.min(75, Math.round((policeBase + cyberEdge + intelligence) * 10) / 10));
}

function myTechBonuses() {
  const result = {};
  const c = myCountry();
  if (!c || !app.state?.definitions?.technologies) return result;
  for (const branch of app.state.definitions.technologies) for (const node of branch.nodes) {
    if (!c.techs?.[node.id]) continue;
    for (const [key, value] of Object.entries(node.effect || {})) result[key] = (result[key] || 0) + value;
  }
  return result;
}

function toast(message, error = false) {
  const element = document.createElement('div');
  element.className = `toast${error ? ' error' : ''}`;
  element.textContent = message;
  $('#toastStack').append(element);
  setTimeout(() => element.remove(), 3600);
}

function setConnected(connected) {
  const status = $('#connectionStatus');
  status.classList.toggle('offline', !connected);
  status.lastChild.textContent = connected ? ' В СЕТИ' : ' НЕТ СВЯЗИ';
}

function setEntryBusy(busy, action = 'join') {
  $('#createRoom').disabled = busy;
  $('#joinRoom').disabled = busy;
  $('#playerName').disabled = busy;
  $('#roomCode').disabled = busy;
  $('#createRoom').innerHTML = busy && action === 'create' ? '<span>Создаём общий мир…</span><b>◌</b>' : '<span>Создать новый мир</span><b>→</b>';
  $('#joinRoom').textContent = busy && action === 'join' ? 'Входим…' : 'Войти';
}

function connect(connection) {
  app.connection = connection;
  clearTimeout(app.reconnectTimer);
  clearTimeout(app.connectionTimer);
  if (app.socket && app.socket.readyState < 2) app.socket.close();
  if (!$('#landing').classList.contains('hidden')) setEntryBusy(true, connection.action);
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${location.host}`);
  app.socket = socket;
  setConnected(false);
  app.connectionTimer = setTimeout(() => {
    if (socket !== app.socket || $('#landing').classList.contains('hidden')) return;
    $('#landingError').textContent = 'Сервер не ответил за 20 секунд. Обновите страницу и попробуйте ещё раз.';
    setEntryBusy(false);
    socket.close();
  }, 20000);
  socket.addEventListener('open', () => {
    const knownRoom = connection.roomCode?.toUpperCase();
    const token = knownRoom ? localStorage.getItem(`world-order:${knownRoom}`) : null;
    socket.send(JSON.stringify({ type: 'hello', ...connection, playerToken: token }));
    setConnected(true);
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === 'welcome') {
      clearTimeout(app.connectionTimer); setEntryBusy(false);
      localStorage.setItem(`world-order:${message.roomCode}`, message.playerToken);
      app.connection = { action: 'join', roomCode: message.roomCode, name: $('#playerName').value.trim() };
      showGame();
      if (message.resumed) toast('Сохранённая сессия восстановлена');
    }
    if (message.type === 'state') { app.state = message; render(); }
    if (message.type === 'warTick' && app.state) {
      for (const [code, state] of Object.entries(message.countries || {})) app.state.world.countries[code] = state;
      for (const changedWar of message.wars || []) {
        const index = app.state.world.wars.findIndex((war) => war.id === changedWar.id);
        if (index >= 0) app.state.world.wars[index] = changedWar; else app.state.world.wars.push(changedWar);
      }
      app.state.world.news = message.news || app.state.world.news;
      app.state.ranking = message.ranking || app.state.ranking;
      app.state.savedAt = message.savedAt || app.state.savedAt;
      renderTop(); renderMapStyles(); renderInspector(); renderNews();
      app.warRenderStep += 1;
      if (app.warRenderStep % 4 === 0 && ['overview','military','rating'].includes(app.activeTab)) renderPanel();
      music.setMode(myCountry()?.atWar?.length || myCountry()?.supportingWarId ? 'war' : 'calm');
    }
    if (message.type === 'toast') toast(message.message);
    if (message.type === 'error') {
      clearTimeout(app.connectionTimer); setEntryBusy(false);
      $('#landingError').textContent = message.message;
      toast(message.message, true);
    }
  });
  socket.addEventListener('close', (event) => {
    setConnected(false);
    if (!$('#landing').classList.contains('hidden') && socket === app.socket) {
      clearTimeout(app.connectionTimer); setEntryBusy(false);
      if (!$('#landingError').textContent) $('#landingError').textContent = 'Соединение не установлено. Проверьте интернет и адрес сайта.';
    }
    if (event.code !== 4001 && !$('#game').classList.contains('hidden')) {
      app.reconnectTimer = setTimeout(() => connect(app.connection), 1800);
    }
  });
}

function send(payload) {
  if (app.socket?.readyState === WebSocket.OPEN) app.socket.send(JSON.stringify(payload));
  else toast('Нет соединения с сервером', true);
}

function showGame() {
  $('#landing').classList.add('hidden');
  $('#game').classList.remove('hidden');
}

$('#createRoom').addEventListener('click', () => {
  music.start();
  $('#landingError').textContent = '';
  connect({ action: 'create', name: $('#playerName').value.trim() });
});
$('#joinRoom').addEventListener('click', () => {
  const roomCode = $('#roomCode').value.trim().toUpperCase();
  if (roomCode.length !== 6) { $('#landingError').textContent = 'Введите шестизначный код мира'; return; }
  $('#landingError').textContent = ''; music.start();
  connect({ action: 'join', roomCode, name: $('#playerName').value.trim() });
});
$('#roomCode').addEventListener('input', (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
$('#roomCode').addEventListener('keydown', (event) => { if (event.key === 'Enter') $('#joinRoom').click(); });
$('#copyRoom').addEventListener('click', async () => {
  if (!app.state) return;
  if (isLocalGame) {
    toast('Это локальная комната: друг из интернета её не увидит. Создайте мир на world-order-game.onrender.com', true);
    return;
  }
  const invite = new URL(location.origin); invite.searchParams.set('room', app.state.roomCode);
  try { await navigator.clipboard.writeText(invite.toString()); toast('Ссылка-приглашение скопирована'); }
  catch { toast(`Код мира: ${app.state.roomCode}`); }
});
$('#mobileMenu').addEventListener('click', () => $('#controlPanel').classList.toggle('open'));

async function loadMap() {
  try {
    const response = await fetch('/api/map?v=4');
    app.mapData = await response.json();
    if (app.state) buildMap();
  } catch { toast('Не удалось загрузить географию карты', true); }
}
loadMap();

const invitedRoom = new URLSearchParams(location.search).get('room')?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
if (invitedRoom?.length === 6) {
  $('#roomCode').value = invitedRoom;
  $('#landingError').textContent = `Получено приглашение в мир ${invitedRoom}. Введите имя и нажмите «Войти».`;
}
if (isLocalGame) {
  $('.entry-note').innerHTML = `⚠ Открыта локальная версия. Игроки из интернета сюда не войдут. Для мультиплеера используйте <a href="${PUBLIC_GAME_URL}">${PUBLIC_GAME_URL.replace('https://','')}</a>.`;
  $('.entry-note').classList.add('local-warning');
}

function project(coordinates) {
  const [lon, lat] = coordinates;
  return [((lon + 180) / 360) * 1200, ((90 - lat) / 180) * 600];
}

function ringPath(ring) {
  if (ring.length < 3) return '';
  const points = [];
  for (const raw of ring) {
    let lon = raw[0]; const lat = raw[1];
    if (points.length) {
      const previous = points.at(-1)[0];
      while (lon - previous > 180) lon -= 360;
      while (lon - previous < -180) lon += 360;
    }
    points.push([lon, lat]);
  }
  if (points.length > 1 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1]) points.pop();

  const clipAt = (polygon, boundary, keepGreater) => {
    const output = [];
    if (!polygon.length) return output;
    const inside = (point) => keepGreater ? point[0] >= boundary : point[0] <= boundary;
    const intersection = (start, end) => {
      const ratio = (boundary - start[0]) / (end[0] - start[0]);
      return [boundary, start[1] + (end[1] - start[1]) * ratio];
    };
    let start = polygon.at(-1);
    for (const end of polygon) {
      const startInside = inside(start); const endInside = inside(end);
      if (endInside) {
        if (!startInside && end[0] !== start[0]) output.push(intersection(start, end));
        output.push(end);
      } else if (startInside && end[0] !== start[0]) output.push(intersection(start, end));
      start = end;
    }
    return output;
  };

  let path = '';
  for (let shift = -2; shift <= 2; shift += 1) {
    let polygon = points.map(([lon, lat]) => [lon + shift * 360, lat]);
    if (Math.max(...polygon.map((point) => point[0])) < -180 || Math.min(...polygon.map((point) => point[0])) > 180) continue;
    polygon = clipAt(clipAt(polygon, -180, true), 180, false);
    if (polygon.length < 3) continue;
    path += polygon.map((point, index) => { const [x, y] = project(point); return `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`; }).join('') + 'Z';
  }
  return path;
}
function geometryPath(geometry) {
  if (!geometry) return '';
  if (geometry.type === 'Polygon') return geometry.coordinates.map(ringPath).join('');
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flatMap((polygon) => polygon.map(ringPath)).join('');
  return '';
}

function buildMap() {
  if (!app.mapData || !app.state) return;
  const group = $('#mapGroup');
  group.innerHTML = '';
  const defs = $('#mapDefs');
  defs.querySelectorAll('[data-front-clip]').forEach((node) => node.remove());
  $('#frontGroup').innerHTML = '';
  const markerGroup = $('#markerGroup');
  markerGroup.innerHTML = '';
  const mappedCodes = new Set();
  for (const feature of app.mapData.features) {
    const code = feature.properties.code;
    const pathData = geometryPath(feature.geometry);
    if (feature.properties.terrainOnly) {
      const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      outline.setAttribute('d', pathData); outline.setAttribute('class', 'terrain-outline');
      group.append(outline); continue;
    }
    mappedCodes.add(code);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('data-code', code);
    path.setAttribute('class', 'country');
    path.addEventListener('pointerenter', (event) => showTooltip(event, code));
    path.addEventListener('pointermove', (event) => moveTooltip(event));
    path.addEventListener('pointerleave', hideTooltip);
    group.append(path);
    const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    clip.setAttribute('id', `front-clip-${code}`); clip.setAttribute('data-front-clip', code);
    const clipPath = path.cloneNode(false);
    clipPath.removeAttribute('data-code'); clipPath.removeAttribute('class'); clipPath.removeAttribute('style');
    clipPath.setAttribute('clip-rule', 'evenodd');
    clip.append(clipPath); defs.append(clip);
  }
  for (const meta of app.state.catalog.filter((item) => !mappedCodes.has(item.code))) {
    const [x, y] = project([meta.latlng[1], meta.latlng[0]]);
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    marker.setAttribute('cx', x); marker.setAttribute('cy', y); marker.setAttribute('r', '2.25');
    marker.setAttribute('data-code', meta.code); marker.setAttribute('class', 'country-marker');
    marker.addEventListener('pointerenter', (event) => showTooltip(event, meta.code));
    marker.addEventListener('pointermove', moveTooltip); marker.addEventListener('pointerleave', hideTooltip);
    markerGroup.append(marker);
  }
  app.pathsReady = true;
  renderMapStyles();
}

function chooseMapCountry(code) {
  if (!me()?.countryCode) {
    app.modalCode = code;
    renderCountryGrid($('#modalCountrySearch').value);
    renderModalConfirm();
    return;
  }
  app.selectedCode = code;
  renderInspector();
  renderMapStyles();
  if (innerWidth <= 1150) $('#inspector').classList.add('open');
}

function showTooltip(event, code) {
  if (!app.state) return;
  const meta = catalog(code); const c = country(code); const owner = ownerOf(code);
  const tooltip = $('#mapTooltip');
  const occupation = c?.occupation;
  tooltip.innerHTML = `<em>${owner ? 'ИГРОК' : 'ИИ'}</em><b>${meta?.flag || ''} ${esc(meta?.name || code)}</b><small>${esc(meta?.capital || '—')} · СИЛА ${formatNumber(c?.score)}</small>${occupation ? `<small class="occupied-tip">⚑ ${formatNumber(occupation.percent,1)}% под контролем ${esc(catalog(occupation.by)?.name || occupation.by)}</small>` : ''}`;
  tooltip.classList.remove('hidden'); moveTooltip(event);
}
function moveTooltip(event) {
  const tooltip = $('#mapTooltip');
  tooltip.style.left = `${Math.min(innerWidth - 190, event.clientX + 14)}px`;
  tooltip.style.top = `${Math.min(innerHeight - 75, event.clientY + 12)}px`;
}
function hideTooltip() { $('#mapTooltip').classList.add('hidden'); }

function colorScale(value, min, max, low, high) {
  const t = Math.max(0, Math.min(1, (value - min) / Math.max(1, max - min)));
  const a = low.match(/\w\w/g).map((x) => parseInt(x, 16));
  const b = high.match(/\w\w/g).map((x) => parseInt(x, 16));
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
}

function politicalColor(code) {
  let hash = 17;
  for (const char of String(code || 'WORLD')) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${hash} 38% 42%)`;
}

function frontGeometry(box, share, source, destination) {
  let x=box.x; let y=box.y; let width=box.width; let height=box.height; let line; let advance={x:0,y:0}; let vertical=false;
  if (Math.abs(source[0]-destination[0])>=Math.abs(source[1]-destination[1])) {
    vertical=true; width=Math.max(.1,box.width*share);
    if (source[0]>destination[0]) x=box.x+box.width-width;
    const edge=source[0]>destination[0]?x:x+width; line=[edge,box.y,edge,box.y+box.height]; advance.x=source[0]>destination[0]?-3:3;
  } else {
    height=Math.max(.1,box.height*share);
    if (source[1]>destination[1]) y=box.y+box.height-height;
    const edge=source[1]>destination[1]?y:y+height; line=[box.x,edge,box.x+box.width,edge]; advance.y=source[1]>destination[1]?-3:3;
  }
  return {x,y,width,height,line,vertical,advance};
}

function animateSvg(node, attribute, from, to, duration = 1.35) {
  if (!Number.isFinite(from)||!Number.isFinite(to)||Math.abs(from-to)<.001) return;
  const animation=document.createElementNS('http://www.w3.org/2000/svg','animate');
  animation.setAttribute('attributeName',attribute); animation.setAttribute('from',from); animation.setAttribute('to',to); animation.setAttribute('dur',`${duration}s`); animation.setAttribute('fill','freeze'); animation.setAttribute('calcMode','spline'); animation.setAttribute('keySplines','.22 .8 .25 1');
  node.append(animation);
}

function renderFronts() {
  const group=$('#frontGroup');
  if(!group||!app.pathsReady||!app.state)return;
  group.innerHTML=''; const active=new Set();
  for(const target of Object.values(app.state.world.countries)){
    const occupation=target.occupation;
    if(!occupation?.by||occupation.percent<=0)continue;
    active.add(target.code); const color=politicalColor(occupation.by);
    const previous=app.visualOccupations[target.code]; const previousPercent=previous?.by===occupation.by?previous.percent:Math.min(.1,occupation.percent);
    app.visualOccupations[target.code]={by:occupation.by,percent:occupation.percent};
    const marker=document.querySelector(`.country-marker[data-code="${target.code}"]`);
    if(marker){
      const ring=document.createElementNS('http://www.w3.org/2000/svg','circle'); ring.setAttribute('cx',marker.getAttribute('cx'));ring.setAttribute('cy',marker.getAttribute('cy'));ring.setAttribute('r',occupation.percent>=100?'3.5':'3');ring.setAttribute('class','occupation-marker');ring.style.fill=color;ring.style.opacity=String(.55+occupation.percent/250);group.append(ring);continue;
    }
    const path=document.querySelector(`.country[data-code="${target.code}"]`); if(!path)continue;
    const box=path.getBBox(); const share=Math.max(0,Math.min(1,occupation.percent/100)); const previousShare=Math.max(0,Math.min(1,previousPercent/100));
    const attackerMeta=catalog(occupation.by);const targetMeta=catalog(target.code);const source=attackerMeta?project([attackerMeta.latlng[1],attackerMeta.latlng[0]]):[box.x,box.y];const destination=targetMeta?project([targetMeta.latlng[1],targetMeta.latlng[0]]):[box.x+box.width/2,box.y+box.height/2];
    const geometry=frontGeometry(box,share,source,destination);const before=frontGeometry(box,previousShare,source,destination);const duration=occupation.permanent?.1:1.35;
    const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
    for(const key of ['x','y','width','height']){rect.setAttribute(key,geometry[key]);animateSvg(rect,key,before[key],geometry[key],duration);}
    rect.setAttribute('clip-path',`url(#front-clip-${target.code})`);rect.setAttribute('class',`occupation-fill${occupation.permanent?' permanent':''}`);rect.style.fill=color;group.append(rect);
    if(share<.995&&!occupation.permanent){
      for(let index=0;index<9;index+=1){
        const progress=(index+.45)/9;const wave=Math.sin((index+target.code.charCodeAt(0))*.9)*1.6;const bulge=document.createElementNS('http://www.w3.org/2000/svg','circle');
        const cx=geometry.vertical?geometry.line[0]+geometry.advance.x*(.25+((index*7)%5)/5)+wave:geometry.line[0]+(geometry.line[2]-geometry.line[0])*progress;
        const cy=geometry.vertical?geometry.line[1]+(geometry.line[3]-geometry.line[1])*progress:geometry.line[1]+geometry.advance.y*(.25+((index*7)%5)/5)+wave;
        bulge.setAttribute('cx',cx);bulge.setAttribute('cy',cy);bulge.setAttribute('r',String(1.5+(index%4)*.48));bulge.setAttribute('clip-path',`url(#front-clip-${target.code})`);bulge.setAttribute('class','front-bulge');bulge.style.fill=color;group.append(bulge);
      }
      const front=document.createElementNS('http://www.w3.org/2000/svg','line');
      ['x1','y1','x2','y2'].forEach((name,index)=>{front.setAttribute(name,geometry.line[index]);animateSvg(front,name,before.line[index],geometry.line[index],duration);});
      front.setAttribute('clip-path',`url(#front-clip-${target.code})`);front.setAttribute('class','front-line');group.append(front);
      const attackingArmy=country(occupation.by)?.army?.manpower||40;const unitCount=Math.round(Math.max(5,Math.min(16,attackingArmy/18)));
      for(let index=0;index<unitCount;index+=1){
        const progress=(index+.55)/unitCount;const unit=document.createElementNS('http://www.w3.org/2000/svg','circle');
        const cx=geometry.vertical?geometry.line[0]+(index%3-1)*1.25:geometry.line[0]+(geometry.line[2]-geometry.line[0])*progress;
        const cy=geometry.vertical?geometry.line[1]+(geometry.line[3]-geometry.line[1])*progress:geometry.line[1]+(index%3-1)*1.25;
        const beforeCx=geometry.vertical?before.line[0]+(index%3-1)*1.25:cx;const beforeCy=geometry.vertical?cy:before.line[1]+(index%3-1)*1.25;
        unit.setAttribute('cx',cx);unit.setAttribute('cy',cy);unit.setAttribute('r',index%4===0?'1':'0.72');unit.setAttribute('clip-path',`url(#front-clip-${target.code})`);unit.setAttribute('class','front-unit');unit.style.fill=color;unit.style.setProperty('--mx',`${geometry.advance.x}px`);unit.style.setProperty('--my',`${geometry.advance.y}px`);unit.style.animationDelay=`-${(index%7)*.13}s`;animateSvg(unit,'cx',beforeCx,cx,duration);animateSvg(unit,'cy',beforeCy,cy,duration);group.append(unit);
      }
      for(let index=0;index<3;index+=1){
        const progress=(index+.7)/3;const impact=document.createElementNS('http://www.w3.org/2000/svg','circle');impact.setAttribute('cx',geometry.vertical?geometry.line[0]:geometry.line[0]+(geometry.line[2]-geometry.line[0])*progress);impact.setAttribute('cy',geometry.vertical?geometry.line[1]+(geometry.line[3]-geometry.line[1])*progress:geometry.line[1]);impact.setAttribute('r','1.1');impact.setAttribute('clip-path',`url(#front-clip-${target.code})`);impact.setAttribute('class','front-impact');impact.style.animationDelay=`-${index*.37}s`;group.append(impact);
      }
    }
  }
  for(const code of Object.keys(app.visualOccupations))if(!active.has(code))delete app.visualOccupations[code];
}

function renderMapStyles() {
  if (!app.pathsReady || !app.state) return;
  const values = Object.values(app.state.world.countries);
  const maxGdp = Math.max(...values.map((c) => Math.log10(c.gdp + 1)));
  const maxPower = Math.max(...values.map((c) => c.militaryPower));
  const viewerCode=me()?.countryCode;
  const viewerWar=(app.state.world.wars||[]).find((war)=>war.status==='active'&&warSide(war,viewerCode));
  const viewerSide=warSide(viewerWar,viewerCode);
  $$('.country, .country-marker').forEach((path) => {
    const code = path.dataset.code; const c = country(code); const owner = ownerOf(code);
    const isMarker = path.classList.contains('country-marker');
    const side=warSide(viewerWar,code); const coalitionClass=side&&side===viewerSide&&code!==viewerCode?' coalition-ally':side&&side!==viewerSide?' coalition-enemy':'';
    path.className.baseVal = `${isMarker ? 'country-marker' : 'country'}${owner ? ' human' : ''}${code === viewerCode ? ' self' : ''}${code === app.selectedCode ? ' target' : ''}${coalitionClass}`;
    let fill = app.layer === 'terrain' ? (isMarker ? '#f0cc72' : 'rgba(10,28,30,.08)') : '';
    if (app.layer === 'political') fill = politicalColor(c?.controllerCode || code);
    if (app.layer === 'economy') fill = colorScale(Math.log10((c?.gdp || 0) + 1), 0, maxGdp, '203039', '42b99c');
    if (app.layer === 'military') fill = colorScale(c?.militaryPower || 0, 0, maxPower, '26343b', 'cb685f');
    if (app.layer === 'relations' && me()?.countryCode) {
      const rel = code === me().countryCode ? 100 : app.state.relations[code] || 0;
      fill = rel >= 0 ? colorScale(rel, 0, 100, '293a40', '4eaaa2') : colorScale(-rel, 0, 100, '34373b', 'b45555');
    }
    path.style.fill = fill;
  });
  $('#biomeLayer').style.opacity = app.layer === 'terrain' ? '1' : '.12';
  renderFronts();
}

function applyMapTransform() {
  const { x, y, k } = app.transform;
  $('#mapGroup').setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
  $('#terrainGroup').setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
  $('#frontGroup').setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
  $('#markerGroup').setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
}
function zoomMap(factor, cx = 600, cy = 300) {
  const old = app.transform.k;
  const next = Math.max(1, Math.min(6, old * factor));
  app.transform.x = cx - (cx - app.transform.x) * (next / old);
  app.transform.y = cy - (cy - app.transform.y) * (next / old);
  app.transform.k = next; applyMapTransform();
}
$('#zoomIn').addEventListener('click', () => zoomMap(1.35));
$('#zoomOut').addEventListener('click', () => zoomMap(1 / 1.35));
$('#resetMap').addEventListener('click', () => { app.transform = { x: 0, y: 0, k: 1 }; applyMapTransform(); });
$('#mapViewport').addEventListener('wheel', (event) => {
  event.preventDefault(); const rect = $('#worldMap').getBoundingClientRect();
  const cx = (event.clientX - rect.left) / rect.width * 1200; const cy = (event.clientY - rect.top) / rect.height * 600;
  zoomMap(event.deltaY < 0 ? 1.18 : .85, cx, cy);
}, { passive: false });
$('#mapViewport').addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('button, input')) return;
  app.drag = {
    px: event.clientX, py: event.clientY, x: app.transform.x, y: app.transform.y,
    code: event.target.closest('[data-code]')?.dataset.code || null,
    moved: false
  };
});
$('#mapViewport').addEventListener('pointermove', (event) => {
  if (!app.drag) return;
  const distance = Math.hypot(event.clientX - app.drag.px, event.clientY - app.drag.py);
  if (distance < 4) return;
  app.drag.moved = true;
  $('#mapViewport').classList.add('dragging');
  if (app.transform.k === 1) return;
  const rect = $('#worldMap').getBoundingClientRect();
  app.transform.x = app.drag.x + (event.clientX - app.drag.px) / rect.width * 1200;
  app.transform.y = app.drag.y + (event.clientY - app.drag.py) / rect.height * 600;
  applyMapTransform();
});
$('#mapViewport').addEventListener('pointerup', () => {
  const gesture = app.drag;
  app.drag = null;
  $('#mapViewport').classList.remove('dragging');
  if (gesture?.code && !gesture.moved) chooseMapCountry(gesture.code);
});
$('#mapViewport').addEventListener('pointercancel', () => { app.drag = null; $('#mapViewport').classList.remove('dragging'); });

$('#mapLayers').addEventListener('click', (event) => {
  const button = event.target.closest('[data-layer]'); if (!button) return;
  app.layer = button.dataset.layer; $$('#mapLayers button').forEach((b) => b.classList.toggle('active', b === button)); renderMapStyles();
});

function searchCountries(query) {
  const text = query.trim().toLocaleLowerCase('ru');
  if (!text) return [];
  return app.state.catalog.filter((c) => c.name.toLocaleLowerCase('ru').includes(text) || c.englishName.toLowerCase().includes(text) || c.code.toLowerCase().includes(text)).slice(0, 10);
}
$('#countrySearch').addEventListener('input', (event) => {
  const results = searchCountries(event.target.value); const box = $('#searchResults');
  box.innerHTML = results.map((c) => `<button data-code="${c.code}"><span>${c.flag}</span><span>${esc(c.name)}</span></button>`).join('');
  box.classList.toggle('hidden', !results.length);
});
$('#searchResults').addEventListener('click', (event) => {
  const button = event.target.closest('[data-code]'); if (!button) return;
  chooseMapCountry(button.dataset.code); $('#searchResults').classList.add('hidden'); $('#countrySearch').value = '';
});

function renderTop() {
  const state = app.state; const player = me(); const c = myCountry(); const meta = catalog(player?.countryCode);
  $('#roomBadge').textContent = state.roomCode;
  $('#worldDate').textContent = `${['I', 'II', 'III', 'IV'][state.world.quarter - 1]} кв. ${state.world.year}`;
  $('#advanceTurn').title = 'Ходы синхронно обновляются по общему таймеру';
  $('#myFlag').textContent = meta?.flag || '🌐'; $('#myCountryName').textContent = meta?.name || 'Страна не выбрана';
  $('#myLeader').textContent = player?.countryCode ? `ЛИДЕР · ${player.name}` : 'ВЫБЕРИТЕ ГОСУДАРСТВО';
  $('#treasury').textContent = c ? money(c.treasury) : '—'; $('#income').textContent = c ? `+${money(c.income)}` : '—';
  $('#gdp').textContent = c ? `$${formatNumber(c.gdp)} млрд` : '—'; $('#influence').textContent = c ? formatNumber(c.influence) : '—'; $('#stability').textContent = c ? `${formatNumber(c.stability)}%` : '—';
  $('#techPoints').textContent = c ? formatNumber(c.techPoints, 1) : '—';
  const techGain = c ? 1 + c.science / 100 + (myTechBonuses().developmentPoints || 0) : 0;
  $('#techPerTurn').textContent = c ? `+${formatNumber(techGain, 1)}/ход` : '—';
  $('#techPointBadge').textContent = c ? formatNumber(c.techPoints, 0) : '0';
}

function metric(label, value) {
  return `<div class="metric-card"><div class="metric-head"><span>${label}</span><b>${formatNumber(value)} / 100</b></div><div class="bar"><i style="width:${Math.max(0, Math.min(100, value))}%"></i></div></div>`;
}
function noCountry() {
  return `<div class="panel-kicker"><span>ЦЕНТР УПРАВЛЕНИЯ</span></div><h2 class="panel-title">Страна не выбрана</h2><p class="panel-subtitle">Выберите государство, чтобы получить доступ к экономике, армии и дипломатии.</p><div class="empty-state">Каждая страна уникальна и может принадлежать только одному игроку.</div><button class="primary-btn select-country-inline" data-open-countries><span>Выбрать страну</span><b>→</b></button>`;
}

function renderPanel() {
  const content = $('#panelContent'); const c = myCountry(); const meta = catalog(me()?.countryCode);
  if (!c) { content.innerHTML = noCountry(); return; }
  if (app.activeTab === 'overview') {
    const decision = app.state.definitions.decisions?.find((item) => item.id === c.pendingDecision);
    const decisionHtml = decision ? `<article class="decision-card"><small>ГОСУДАРСТВЕННОЕ СОБЫТИЕ · ТРЕБУЕТ РЕШЕНИЯ</small><h3>${esc(decision.title)}</h3><p>${esc(decision.text)}</p><div class="decision-options">${decision.options.map((option) => `<button data-decision="${option.id}"><b>${esc(option.label)}</b><span>${esc(option.note)}</span></button>`).join('')}</div></article>` : '';
    const invites = (app.state.world.warInvites || []).filter((invite) => invite.to === c.code && invite.status === 'pending');
    const inviteHtml = invites.map((invite) => { const war=(app.state.world.wars||[]).find((item)=>item.id===invite.warId); const from=catalog(invite.from); const enemy=catalog(invite.side==='a'?war?.b:war?.a); return `<article class="coalition-invite"><small>СРОЧНОЕ ПРЕДЛОЖЕНИЕ · ВОЕННАЯ КОАЛИЦИЯ</small><h3>${from?.flag||''} ${esc(from?.name||invite.from)} зовёт на помощь</h3><p>Экспедиционный корпус выступит против ${esc(enemy?.name||'противника')}. За участие страна получит 65% контракта.</p><div><b>◈ ${invite.cost} млрд</b><span>Решение остаётся за игроком</span></div><footer><button data-war-invite="${invite.id}" data-answer="accept">Принять</button><button data-war-invite="${invite.id}" data-answer="decline">Отказаться</button></footer></article>`; }).join('');
    const supportWar = (app.state.world.wars || []).find((war) => war.status === 'active' && warSide(war,c.code) && war.a!==c.code && war.b!==c.code);
    const supportHtml = supportWar ? (() => { const side=warSide(supportWar,c.code); const leader=catalog(supportWar[side]); const enemy=catalog(supportWar[side==='a'?'b':'a']); return `<article class="coalition-status"><small>ЭКСПЕДИЦИОННЫЙ КОРПУС РАЗВЁРНУТ</small><b>${leader?.flag||''} Коалиция: ${esc(leader?.name||'—')}</b><p>Ваши войска участвуют в боях против ${esc(enemy?.name||'—')}, расходуют снабжение и несут реальные потери.</p><button data-war-withdraw>Отозвать корпус · доверие −10</button></article>`; })() : '';
    const stolenCollection = c.stolenItems?.length ? `<div class="section-divider">КОЛЛЕКЦИЯ ТАЙНЫХ ТРОФЕЕВ</div><div class="stolen-collection">${c.stolenItems.slice(0,6).map((item) => { const asset=app.state.definitions.assets?.[item.type]||{}; const source=catalog(item.from); return `<article><i>${asset.icon||'◇'}</i><div><b>${esc(item.name||asset.name)}</b><small>${source?.flag||''} ${esc(source?.name||item.from)} · ход ${item.turn}</small></div></article>`; }).join('')}</div>` : `<div class="section-divider">КОЛЛЕКЦИЯ ТАЙНЫХ ТРОФЕЕВ</div><div class="empty-collection">Пока пусто. Выберите чужую страну на карте и откройте её государственное хранилище.</div>`;
    const missions = [
      { name: 'Технологическая держава', progress: Object.keys(c.techs || {}).length, goal: 8, unit: 'технологий' },
      { name: 'Экономический центр', progress: Math.round(c.gdp), goal: 1000, unit: 'млрд ВВП' },
      { name: 'Сеть союзников', progress: c.treaties.length, goal: 5, unit: 'договоров' }
    ];
    const missionsHtml = `<div class="section-divider">НАЦИОНАЛЬНЫЕ ЦЕЛИ</div><div class="mission-list">${missions.map((mission) => `<div class="mission ${mission.progress >= mission.goal ? 'done' : ''}"><div><b>${esc(mission.name)}</b><span>${Math.min(mission.progress,mission.goal)} / ${mission.goal}</span></div><small>${mission.progress >= mission.goal ? 'Цель достигнута · престиж державы повышен' : `Прогресс: ${esc(mission.unit)}`}</small></div>`).join('')}</div>`;
    content.innerHTML = `<div class="panel-kicker"><span>НАЦИОНАЛЬНЫЙ ОБЗОР</span><i>ХОД ${app.state.world.turn}</i></div>${inviteHtml}${supportHtml}${decisionHtml}<h2 class="panel-title">${esc(meta.name)}</h2><p class="panel-subtitle">${esc(c.lastAction)}</p><div class="quick-grid"><div class="quick-stat"><small>НАСЕЛЕНИЕ</small><b>${formatNumber(c.population,1)} млн</b></div><div class="quick-stat"><small>МИРОВОЙ СЧЁТ</small><b>${formatNumber(c.score)}</b></div><div class="quick-stat"><small>ТЕРРИТОРИЯ</small><b>${formatNumber(c.territoryArea)} км²</b></div><div class="quick-stat"><small>ВОЕННАЯ СИЛА</small><b>${formatNumber(c.militaryPower)}</b></div><div class="quick-stat"><small>ПОЛИЦИЯ</small><b>${formatNumber(c.police)} / 100</b></div><div class="quick-stat"><small>РЕПУТАЦИЯ</small><b>${formatNumber(c.reputation)} / 100</b></div></div>${metric('Промышленность', c.industry)}${metric('Инфраструктура', c.infrastructure)}${metric('Научный потенциал', c.science)}${stolenCollection}${missionsHtml}<div class="tax-line"><span>Налоговая ставка</span><b id="taxValue">${c.taxRate}%</b></div><input id="taxRange" type="range" min="12" max="42" value="${c.taxRate}"><div class="tax-line"><span>Национальный приоритет</span></div><select id="focusSelect" class="focus-select"><option value="balanced">Сбалансированный рост</option><option value="economy">Экономический рывок</option><option value="science">Научное лидерство</option><option value="defense">Национальная оборона</option><option value="welfare">Благосостояние</option></select>`;
    $('#focusSelect').value = c.focus;
    $('#taxRange').addEventListener('input', (e) => $('#taxValue').textContent = `${e.target.value}%`);
    $('#taxRange').addEventListener('change', (e) => send({ type: 'action', action: 'policy', id: 'tax', value: Number(e.target.value) }));
    $('#focusSelect').addEventListener('change', (e) => send({ type: 'action', action: 'policy', id: 'focus', value: e.target.value }));
  }
  if (app.activeTab === 'development') {
    const discount = myTechBonuses().developmentDiscount || 0;
    const actions = Object.entries(app.state.definitions.development).map(([id, item]) => { const cost=Math.max(1,Math.round(item.cost*(1-discount))); return `<button class="action-card" data-action="develop" data-id="${id}" ${c.treasury < cost ? 'disabled' : ''}><div><b>${esc(item.label)}</b><strong>◈ ${cost} млрд</strong></div><small>${esc(item.note)}${discount ? ` · скидка ${Math.round(discount*100)}%` : ''}</small></button>`; }).join('');
    const projects = app.state.definitions.projects || {};
    let active = '';
    if (c.activeProject && projects[c.activeProject.id]) { const p=projects[c.activeProject.id]; const complete=Math.max(0,Math.min(100,(p.duration-c.activeProject.remaining)/p.duration*100)); active=`<div class="active-project"><header><span>${p.icon}</span><div><small>НАЦИОНАЛЬНЫЙ ПРОЕКТ СТРОИТСЯ</small><h3>${esc(p.name)}</h3></div></header><div class="bar"><i style="width:${complete}%"></i></div><p>Осталось ходов: ${Math.max(1,Math.ceil(c.activeProject.remaining))}</p></div>`; }
    const projectCards = Object.entries(projects).map(([id,p]) => { const done=c.completedProjects.includes(id); return `<button class="project-card" data-project="${id}" ${c.activeProject || done || c.treasury<p.cost ? 'disabled' : ''}><header><span>${p.icon}</span><h4>${esc(p.name)}</h4><strong>${done?'ГОТОВО':`◈ ${p.cost}`}</strong></header><p>${esc(p.description)}</p><footer><span>${p.duration} ХОДА</span><span>${done?'РЕАЛИЗОВАНО':'МЕГАПРОЕКТ'}</span></footer></button>`; }).join('');
    content.innerHTML = `<div class="panel-kicker"><span>ГОСУДАРСТВЕННЫЕ ПРОЕКТЫ</span><i>${formatNumber(c.treasury)} В КАЗНЕ</i></div><h2 class="panel-title">Развитие</h2><p class="panel-subtitle">Инвестиции дают постоянный эффект. Мегапроекты требуют нескольких кварталов, но меняют страну намного сильнее.</p>${active}<div class="action-list">${actions}</div><div class="section-divider">НАЦИОНАЛЬНЫЕ МЕГАПРОЕКТЫ</div><div class="project-grid">${projectCards}</div>`;
  }
  if (app.activeTab === 'military') {
    const discount=myTechBonuses().militaryDiscount||0;
    const actions = Object.entries(app.state.definitions.military).map(([id, item]) => { const cost=Math.max(1,Math.round(item.cost*(1-discount))); return `<button class="action-card" data-action="military" data-id="${id}" ${c.treasury < cost ? 'disabled' : ''}><div><b>${esc(item.label)}</b><strong>◈ ${cost} млрд</strong></div><small>${esc(item.note || 'Повышает обороноспособность')}${discount?` · скидка ${Math.round(discount*100)}%`:''}</small></button>`; }).join('');
    const doctrines = Object.entries(app.state.definitions.doctrines || {}).map(([id,item])=>`<option value="${id}">${esc(item.name)} — ${esc(item.description)}</option>`).join('');
    content.innerHTML = `<div class="panel-kicker"><span>МИНИСТЕРСТВО ОБОРОНЫ</span><i>СИЛА ${c.militaryPower}</i></div><h2 class="panel-title">Вооружённые силы</h2><p class="panel-subtitle">В сражении побеждает не казна, а боеспособная армия. Пополняйте резерв, снабжение и мораль до начала войны.</p><div class="quick-grid army-grid"><div class="quick-stat"><small>В СТРОЮ</small><b>${formatNumber(c.army.manpower,1)} тыс.</b></div><div class="quick-stat"><small>РЕЗЕРВ</small><b>${formatNumber(c.army.reserve,1)} тыс.</b></div><div class="quick-stat"><small>АВИАЦИЯ</small><b>${formatNumber(c.army.air,1)}</b></div><div class="quick-stat"><small>ФЛОТ</small><b>${formatNumber(c.army.navy,1)}</b></div></div>${metric('Готовность', c.army.readiness)}${metric('Снабжение', c.army.supplies)}${metric('Мораль', c.army.morale)}${metric('Боевой опыт', c.army.experience)}${metric('Оснащение', c.army.equipment)}${metric('Оборона', c.army.defense)}${metric('Полевая медицина', c.army.medical)}${metric('Военное истощение', c.warExhaustion)}<div class="section-divider">ВОЕННАЯ ДОКТРИНА</div><select id="doctrineSelect" class="focus-select">${doctrines}</select><p id="doctrineDescription" class="doctrine-description"></p><div class="section-divider">ПРОГРАММЫ АРМИИ</div><div class="action-list">${actions}</div>`;
    $('#doctrineSelect').value=c.doctrine||'balanced';
    const describeDoctrine=()=>{ $('#doctrineDescription').textContent=app.state.definitions.doctrines?.[$('#doctrineSelect').value]?.description||''; }; describeDoctrine();
    $('#doctrineSelect').addEventListener('change',(event)=>send({type:'action',action:'doctrine',id:event.target.value}));
  }
  if (app.activeTab === 'diplomacy') {
    const borders = meta.borders.filter((code) => country(code)).sort((a,b) => (app.state.relations[b] || 0) - (app.state.relations[a] || 0));
    content.innerHTML = `<div class="panel-kicker"><span>МИНИСТЕРСТВО ИНОСТРАННЫХ ДЕЛ</span></div><h2 class="panel-title">Дипломатия</h2><p class="panel-subtitle">Выберите государство на карте или откройте одного из соседей.</p><div class="action-list">${borders.slice(0,10).map((code) => { const m=catalog(code); const r=app.state.relations[code]; return `<button class="action-card" data-inspect="${code}"><div><b>${m.flag} ${esc(m.name)}</b><strong>${r > 0 ? '+' : ''}${r}</strong></div><small>${relationText(r)}</small></button>`; }).join('') || '<div class="empty-state">У государства нет сухопутных соседей</div>'}</div>`;
  }
  if (app.activeTab === 'rating') {
    content.innerHTML = `<div class="panel-kicker"><span>ГЛОБАЛЬНЫЙ ИНДЕКС</span><i>TOP 12</i></div><h2 class="panel-title">Мировой рейтинг</h2><p class="panel-subtitle">Учитывает экономику, стабильность, влияние и вооружённые силы.</p><div class="rank-list">${app.state.ranking.map((row) => { const m=catalog(row.code); return `<div class="rank-row" data-inspect="${row.code}"><span>${row.rank}</span><span>${m.flag}</span><b>${esc(m.name)}</b><small>${formatNumber(row.score)}</small></div>`; }).join('')}</div>`;
  }
}

$('#gameTabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]'); if (!button) return;
  app.activeTab = button.dataset.tab; $$('#gameTabs button').forEach((b) => b.classList.toggle('active', b === button)); renderPanel();
});
$('#panelContent').addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]');
  if (action) send({ type: 'action', action: action.dataset.action, id: action.dataset.id });
  const inspect = event.target.closest('[data-inspect]'); if (inspect) chooseMapCountry(inspect.dataset.inspect);
  if (event.target.closest('[data-open-countries]')) openCountryModal();
  const decision = event.target.closest('[data-decision]'); if (decision) send({ type:'action', action:'decision', id:decision.dataset.decision });
  const project = event.target.closest('[data-project]'); if (project) send({ type:'action', action:'project', id:project.dataset.project });
  const invite = event.target.closest('[data-war-invite]'); if (invite) send({ type:'action', action:'war_support', id:invite.dataset.answer, inviteId:invite.dataset.warInvite });
  if (event.target.closest('[data-war-withdraw]')) send({ type:'action', action:'war_support', id:'withdraw' });
});

function renderInspector() {
  const box = $('#countryInspector');
  if (!app.selectedCode) {
    box.innerHTML = `<div class="inspector-empty"><span>◎</span><p>Выберите государство на карте, чтобы открыть досье и дипломатические действия.</p></div>`;
    return;
  }
  const c = country(app.selectedCode); const meta = catalog(app.selectedCode); const owner = ownerOf(app.selectedCode); const mine = me()?.countryCode; const own = myCountry();
  if (!c || !meta) return;
  const relation = mine && mine !== app.selectedCode ? app.state.relations[app.selectedCode] : null;
  const atWar = mine && c.atWar.includes(mine);
  const controller = c.controllerCode ? catalog(c.controllerCode) : null;
  const occupationNote = c.occupation ? `<div class="occupation-notice"><b>⚑ КОНТРОЛЬ ТЕРРИТОРИИ</b><span>${formatNumber(c.occupation.percent,1)}% удерживает ${esc(catalog(c.occupation.by)?.name || c.occupation.by)}${c.occupation.permanent ? ' · закреплено миром' : ' · активный фронт'}</span></div>` : '';
  const theftChance = relation != null ? theftChanceFor(own, c) : 0;
  const alreadyAttempted = own?.lastTheftTurn === app.state.world.turn;
  const theftAssets = relation != null ? Object.entries(app.state.definitions.assets || {}).filter(([id]) => (c.vault?.[id] || 0) > 0) : [];
  const theftHtml = relation != null ? `<section class="theft-box"><header><div><small>ТАЙНАЯ СЛУЖБА · ХРАНИЛИЩЕ ЦЕЛИ</small><h3>Операция «Тихие руки»</h3></div><strong>${formatNumber(theftChance,1)}%</strong></header><div class="security-line"><span>Полиция цели: <b>${formatNumber(c.police)} / 100</b></span><span>Ваша репутация: <b>${formatNumber(own.reputation)} / 100</b></span></div><p>${c.police < 45 ? 'Полиция развита слабо: базовый шанс кражи — 50%.' : 'Сильная полиция снижает базовый шанс.'} Киберразведка и технологии корректируют итог. При поимке: штраф 12–35 млрд, репутация −10 и доверие −18.</p><div class="vault-assets">${theftAssets.length ? theftAssets.map(([id,asset]) => `<button data-theft="${id}" ${alreadyAttempted?'disabled':''}><i>${asset.icon}</i><span><b>${esc(asset.name)}</b><small>${esc(asset.description)} · в наличии ${c.vault[id]}</small></span></button>`).join('') : '<div class="vault-empty">Хранилище опустошено. Новые ценности появляются каждые 6 ходов.</div>'}</div>${alreadyAttempted?'<footer>АГЕНТЫ УЖЕ ДЕЙСТВОВАЛИ В ЭТОМ КВАРТАЛЕ</footer>':'<footer>МОЖНО ВЫБРАТЬ ОДНУ ЦЕННОСТЬ ЗА ХОД</footer>'}</section>` : '';
  let relationsHtml = '';
  if (relation != null && atWar) {
    const war = (app.state.world.wars || []).find((item) => item.status === 'active' && [item.a,item.b].includes(mine) && [item.a,item.b].includes(app.selectedCode));
    const ourControl = c.occupation?.by === mine ? c.occupation.percent : 0;
    const enemyControl = own.occupation?.by === app.selectedCode ? own.occupation.percent : 0;
    const frontValue = ourControl || enemyControl;
    const frontText = ourControl ? `Мы контролируем ${formatNumber(ourControl,1)}% территории противника` : enemyControl ? `Противник контролирует ${formatNumber(enemyControl,1)}% нашей территории` : 'Линия фронта проходит по государственной границе';
    const last = war?.lastOperation;
    const side=mine===war?.a?'a':'b'; const enemySide=side==='a'?'b':'a';
    const ourSupport=war?.supporters?.[side]||[]; const enemySupport=war?.supporters?.[enemySide]||[];
    const coalitionPower=(leader,support)=>Math.round((leader?.militaryPower||0)+support.reduce((sum,item)=>sum+(country(item.code)?.militaryPower||0)*(item.contribution||.45),0));
    const ourPower=coalitionPower(own,ourSupport); const theirPower=coalitionPower(c,enemySupport);
    const allyNames=(support)=>support.map((item)=>`${catalog(item.code)?.flag||''} ${esc(catalog(item.code)?.name||item.code)} ${Math.round((item.contribution||.45)*100)}%`).join(' · ')||'нет';
    const lastWasOurs=last?.attacker===mine; const lastOurSuccess=last ? (lastWasOurs ? last.won : !last.won) : false;
    const battleReport=last?`<article class="battle-report ${lastOurSuccess?'victory':'defeat'}"><header><small>ПОСЛЕДНИЙ БОЕВОЙ ТАКТ · ${esc(last.tacticName||'живой фронт')}</small><b>${lastOurSuccess?'ПРОДВИЖЕНИЕ':'ДАВЛЕНИЕ ПРОТИВНИКА'}</b></header><div class="battle-numbers"><span><small>СИЛА НАСТУПЛЕНИЯ</small><b>${formatNumber(last.attackerPower)}</b></span><span><small>СИЛА СОПРОТИВЛЕНИЯ</small><b>${formatNumber(last.defenderPower)}</b></span><span><small>ВОЙСКА</small><b>${formatNumber(last.attackerTroops,1)} / ${formatNumber(last.defenderTroops,1)} тыс.</b></span><span><small>ПОТЕРИ ЗА ТАКТ</small><b>${formatNumber(last.attackerLosses,2)} / ${formatNumber(last.defenderLosses,2)} тыс.</b></span></div><p>${catalog(last.attacker)?.name||last.attacker} продвигает фронт на ${formatNumber(last.movement,1)}% · обновление идёт автоматически${last.distancePenalty?` · штраф расстояния ${last.distancePenalty}%`:''}</p></article>`:'';
    const trend=last?(last.attacker===mine?`Наши части продвигаются на ${formatNumber(last.movement,1)}%`:`Противник продвигается на ${formatNumber(last.movement,1)}%`):'Армии занимают позиции';
    relationsHtml = `<div class="relation-box war-relation"><small>ВОЙНА · ЖИВОЙ ФРОНТ</small><b>${formatNumber(own.warScore[app.selectedCode] || 0,1)}</b><p>${frontText}</p></div><div class="front-progress ${enemyControl ? 'losing' : ''}"><i style="width:${frontValue}%"></i></div><div class="live-war-status"><header><span><i></i> БОИ ИДУТ В РЕАЛЬНОМ ВРЕМЕНИ</span><b>${esc(trend)}</b></header><p>Ничего нажимать не нужно. Сервер сам сталкивает армии каждые 1,4 секунды; более сильная коалиция непрерывно закрашивает землю на карте, обе стороны теряют солдат, технику, мораль и снабжение.</p><div><span>Наши войска <b>${formatNumber(own.army.manpower,1)} тыс.</b></span><span>Снабжение <b>${formatNumber(own.army.supplies,1)}</b></span><span>Мораль <b>${formatNumber(own.army.morale,1)}</b></span></div></div><div class="coalition-board"><div><small>НАША КОАЛИЦИЯ</small><b>${formatNumber(ourPower)} силы</b><span>${allyNames(ourSupport)}</span></div><i>VS</i><div><small>ПРОТИВНИК</small><b>${formatNumber(theirPower)} силы</b><span>${allyNames(enemySupport)}</span></div></div>${battleReport}<div class="war-benefits"><b>ИТОГ ВОЙНЫ</b><span>Скорость продвижения зависит от войск, оснащения, готовности, авиации, обороны, снабжения, морали, технологий и союзников. При 100% контроля победитель получает территорию, 45% оставшейся казны и 12% ВВП.</span></div><div class="diplomacy-actions war-actions"><button data-conflict="fortify" ${own.army.supplies<6?'disabled':''}>Усилить оборону · 6 снабжения</button><button data-diplomacy="peace">Предложить мир по линии фронта</button></div>`;
  } else if (relation != null) {
    const relationBonus = myTechBonuses().relationBonus || 0;
    const blockingTreaty = own.treaties.some((treaty) => treaty === `alliance:${c.code}` || treaty === `nonaggression:${c.code}`);
    const hasTreaty = own.treaties.some((treaty) => treaty.endsWith(`:${c.code}`));
    const ownWar=activeWarForCountry(mine); const selectedBusy=(app.state.world.wars||[]).some((war)=>war.status==='active'&&warSide(war,c.code));
    const alreadyHelping=ownWar&&Boolean(warSide(ownWar,c.code)); const allyCost=supportCostFor(c);
    const canInvite=ownWar&&!selectedBusy&&relation>=35&&own.treasury>=allyCost&&((ownWar.supporters?.[mine===ownWar.a?'a':'b']||[]).length<3);
    const canDeclare = relation <= -45 && !blockingTreaty && !ownWar && !selectedBusy;
    const coalitionInvite=ownWar&&!alreadyHelping?`<div class="coalition-call"><small>ПРИЗВАТЬ В ТЕКУЩУЮ ВОЙНУ</small><b>${meta.flag} ${esc(meta.name)} · контракт ${allyCost} млрд</b><p>Нужно доверие +35. Бот решает по отношениям; живой игрок получает выбор. Союзная армия будет сражаться и нести потери.</p><button data-war-support="invite" ${canInvite?'':'disabled'}>${relation<35?'Недостаточно доверия':own.treasury<allyCost?'Не хватает казны':selectedBusy?'Страна уже воюет':'Предложить военную помощь'}</button></div>`:'';
    relationsHtml = `<div class="relation-box"><small>ДОВЕРИЕ МЕЖДУ СТРАНАМИ</small><b>${relation > 0 ? '+' : ''}${relation}</b><p>${relationText(relation)} · для войны нужно ≤ −45</p></div>${coalitionInvite}<div class="trust-guide"><div><span>УЛУЧШИТЬ</span><b>миссия +${12+relationBonus} · помощь +18</b></div><div><span>УХУДШИТЬ</span><b>санкции −22 · ультиматум −18 · учения −7</b></div><p>${ownWar?'Пока идёт война, выбирайте дружественные страны и зовите их в коалицию.':canDeclare?'Условия для объявления войны выполнены.':blockingTreaty?'Сначала разорвите союз или пакт о ненападении.':`Нужно снизить доверие ещё на ${relation + 45} пунктов.`}</p></div><div class="diplomacy-actions"><button data-diplomacy="embassy">Миссия +${12+relationBonus} · 8</button><button data-diplomacy="aid">Помощь +18 · 15</button><button data-diplomacy="trade">Торговый договор</button><button data-diplomacy="nonaggression">Пакт о ненападении</button><button data-diplomacy="alliance">Оборонный союз</button><button data-intelligence="operation">Разведоперация · 12</button><button class="hostile" data-diplomacy="sanction">Санкции −22</button><button class="hostile" data-diplomacy="pressure">Ультиматум −18 · 5</button><button class="hostile" data-conflict="exercise">Учения −7 · 12</button>${hasTreaty ? '<button class="hostile" data-diplomacy="break_treaties">Разорвать договоры −20</button>' : ''}<button class="declare-button" data-conflict="declare" ${canDeclare ? '' : 'disabled'}>Объявить войну</button></div>`;
  }
  box.innerHTML = `<div class="country-heading"><span>${meta.flag}</span><div><h2>${esc(meta.name)}</h2><p>${esc(meta.capital)} · ${esc(regionName(meta.region))}</p></div></div><span class="owner-tag ${owner ? '' : 'bot'}">${owner ? `ИГРОК · ${esc(owner.name)}` : 'УПРАВЛЕНИЕ · МИРНЫЙ ИИ'}</span>${controller ? `<span class="controller-tag">ПОД КОНТРОЛЕМ · ${esc(controller.name)}</span>` : ''}<div class="country-stats"><div><small>ВВП</small><b>$${formatNumber(c.gdp)}</b></div><div><small>АРМИЯ</small><b>${c.militaryPower}</b></div><div><small>ЗЕМЛЯ</small><b>${formatNumber(c.territoryArea)} км²</b></div></div>${occupationNote}${relationsHtml}${theftHtml}<div class="quick-grid"><div class="quick-stat"><small>НАСЕЛЕНИЕ</small><b>${formatNumber(c.population,1)} млн</b></div><div class="quick-stat"><small>КАЗНА</small><b>${formatNumber(c.treasury,1)} млрд</b></div><div class="quick-stat"><small>ПОЛИЦИЯ</small><b>${formatNumber(c.police)} / 100</b></div><div class="quick-stat"><small>РЕПУТАЦИЯ</small><b>${formatNumber(c.reputation)} / 100</b></div></div>`;
  const deployment = $('#deploymentRange');
  const tacticSelect = $('#tacticSelect');
  const updateBattlePlan=()=>{ if(!deployment||!tacticSelect)return; const tactic=app.state.definitions.tactics?.[tacticSelect.value]||{}; const fraction=Number(deployment.value)/100; const tech=myTechBonuses(); const doctrine=app.state.definitions.doctrines?.[own.doctrine]||{}; const supply=(4+fraction*10)*(tactic.supply||1)*(doctrine.supply||1)*(1-(tech.supplyUsePct||0)); $('#deploymentValue').textContent=`${deployment.value}% · ${formatNumber(own.army.manpower*fraction,1)} тыс.`; $('#supplyCost').textContent=formatNumber(supply,1); $('#tacticDescription').textContent=`${tactic.description||''}${Number(deployment.value)<(tactic.minDeployment||10)?` Минимум: ${tactic.minDeployment}% армии.`:''}`; };
  if (deployment) deployment.addEventListener('input',updateBattlePlan);
  if (tacticSelect) tacticSelect.addEventListener('change',updateBattlePlan);
  updateBattlePlan();
}
$('#countryInspector').addEventListener('click', (event) => {
  const diplo = event.target.closest('[data-diplomacy]');
  if (diplo) send({ type: 'action', action: 'diplomacy', id: diplo.dataset.diplomacy, target: app.selectedCode });
  const conflict = event.target.closest('[data-conflict]');
  if (conflict) send({ type: 'action', action: 'conflict', id: conflict.dataset.conflict, target: app.selectedCode, units: conflict.dataset.conflict === 'attack' ? Number($('#deploymentRange')?.value || 60) : undefined, tactic: conflict.dataset.conflict === 'attack' ? ($('#tacticSelect')?.value || 'standard') : undefined });
  const intelligence = event.target.closest('[data-intelligence]');
  if (intelligence) send({ type: 'action', action: 'intelligence', id: intelligence.dataset.intelligence, target: app.selectedCode });
  const theft = event.target.closest('[data-theft]');
  if (theft) send({ type: 'action', action: 'theft', id: theft.dataset.theft, target: app.selectedCode });
  if (event.target.closest('[data-war-support]')) send({ type:'action', action:'war_support', id:'invite', target:app.selectedCode });
});

function renderNews() {
  $('#newsFeed').innerHTML = app.state.world.news.map((item) => `<article class="news-item ${item.tone}"><i></i><div><p>${esc(item.text)}</p><small>ХОД ${item.turn}</small></div></article>`).join('');
}

function openCountryModal() {
  $('#countryModal').classList.remove('hidden');
  renderCountryGrid($('#modalCountrySearch').value);
}
function renderCountryGrid(query = '') {
  if (!app.state) return;
  const text = query.trim().toLocaleLowerCase('ru');
  const list = app.state.catalog.filter((c) => !text || c.name.toLocaleLowerCase('ru').includes(text) || regionName(c.region).toLocaleLowerCase('ru').includes(text) || c.englishName.toLowerCase().includes(text));
  $('#countryGrid').innerHTML = list.map((meta) => {
    const owner = ownerOf(meta.code); const selected = app.modalCode === meta.code;
    return `<button class="country-option${selected ? ' selected' : ''}" data-country="${meta.code}" ${owner ? 'disabled' : ''}><span>${meta.flag}</span><div><b>${esc(meta.name)}</b><small>${owner ? `ЗАНЯТА · ${esc(owner.name)}` : `${esc(regionName(meta.region))} · СВОБОДНА`}</small></div></button>`;
  }).join('');
}
function renderModalConfirm() {
  const meta = catalog(app.modalCode); const panel = $('#countryConfirm');
  panel.classList.toggle('hidden', !meta); if (!meta) return;
  $('#confirmFlag').textContent = meta.flag; $('#confirmName').textContent = meta.name;
}
$('#modalCountrySearch').addEventListener('input', (event) => renderCountryGrid(event.target.value));
$('#countryGrid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-country]'); if (!button) return;
  app.modalCode = button.dataset.country; renderCountryGrid($('#modalCountrySearch').value); renderModalConfirm();
});
$('#confirmCountry').addEventListener('click', () => { if (app.modalCode) send({ type: 'selectCountry', code: app.modalCode }); });

function techName(id) {
  for (const branch of app.state?.definitions?.technologies || []) {
    const node = branch.nodes.find((item) => item.id === id);
    if (node) return node.name;
  }
  return id;
}

function renderTechTree() {
  if (!app.state || $('#techModal').classList.contains('hidden')) return;
  const c = myCountry();
  if (!c) return;
  const branches = app.state.definitions.technologies || [];
  const learned = Object.keys(c.techs || {}).length;
  const total = branches.reduce((sum, branch) => sum + branch.nodes.length, 0);
  $('#treePoints').textContent = formatNumber(c.techPoints, 1);
  $('#treeProgress').textContent = `${learned} / ${total}`;
  $('#techTree').innerHTML = branches.map((branch) => `<section class="tech-branch" style="--branch:${branch.color}"><header class="branch-head"><span><i>${branch.icon}</i></span><h3>${esc(branch.name)}</h3><p>${esc(branch.description)}</p></header><div class="tech-nodes">${branch.nodes.map((node) => {
    const isLearned = Boolean(c.techs?.[node.id]);
    const prerequisites = node.requires || [];
    const requirementsMet = prerequisites.every((id) => c.techs?.[id]);
    const affordable = c.techPoints >= node.cost && c.treasury >= node.money;
    const stateClass = isLearned ? 'learned' : requirementsMet ? 'available' : 'locked';
    const requirementText = prerequisites.length ? `Требуется: ${prerequisites.map(techName).join(' · ')}` : 'Начальная технология';
    return `<article class="tech-node ${stateClass}"><div class="node-top"><span>УРОВЕНЬ ${node.tier}</span><b>${isLearned ? 'ИЗУЧЕНО' : requirementsMet ? 'ДОСТУПНО' : 'ЗАКРЫТО'}</b></div><h4>${esc(node.name)}</h4><p>${esc(node.effectText)}</p><div class="node-cost"><span>⌬ ${node.cost}</span><span>◈ ${node.money} млрд</span></div><div class="tech-cross-note">${esc(requirementText)}</div>${isLearned ? '' : `<button data-tech="${node.id}" ${!requirementsMet || !affordable ? 'disabled' : ''}>${requirementsMet ? affordable ? 'ИЗУЧИТЬ ТЕХНОЛОГИЮ' : 'НЕ ХВАТАЕТ РЕСУРСОВ' : 'НУЖНЫ ПРЕДЫДУЩИЕ УЗЛЫ'}</button>`}</article>`;
  }).join('')}</div></section>`).join('');
}

function openTechTree() {
  if (!myCountry()) { toast('Сначала выберите государство', true); return; }
  $('#techModal').classList.remove('hidden');
  renderTechTree();
}
$('#openTechTree').addEventListener('click', openTechTree);
$('#closeTechTree').addEventListener('click', () => $('#techModal').classList.add('hidden'));
$('#techTree').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tech]');
  if (button) send({ type: 'action', action: 'technology', id: button.dataset.tech });
});

class MusicEngine {
  constructor() { this.context = null; this.master = null; this.compressor = null; this.timer = null; this.enabled = false; this.mode = 'calm'; this.step = 0; this.volume = .3; }
  async start() {
    try {
      this.context ||= new (window.AudioContext || window.webkitAudioContext)();
      await this.context.resume();
      if (this.context.state !== 'running') throw new Error('AudioContext suspended');
      if (!this.master) {
        this.master = this.context.createGain();
        this.master.gain.value = 0;
        this.compressor = this.context.createDynamicsCompressor();
        this.compressor.threshold.value = -18;
        this.compressor.knee.value = 18;
        this.compressor.ratio.value = 4;
        this.compressor.attack.value = .02;
        this.compressor.release.value = .3;
        this.master.connect(this.compressor);
        this.compressor.connect(this.context.destination);
      }
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(this.master.gain.value, this.context.currentTime);
      this.master.gain.linearRampToValueAtTime(this.volume, this.context.currentTime + .35);
      if (this.enabled && this.timer) return;
      this.enabled = true;
      $('#musicToggle').classList.add('active');
      $('#musicToggle').title = 'Выключить музыку';
      $('#musicToggle small').textContent = 'ЗВУК ВКЛ';
      this.schedule();
    } catch {
      this.enabled = false;
      toast('Firefox заблокировал звук. Нажмите значок ♪ ещё раз и разрешите аудио для сайта.', true);
    }
  }
  stop() {
    this.enabled = false; clearInterval(this.timer); this.timer = null;
    if (this.master && this.context) this.master.gain.setTargetAtTime(0, this.context.currentTime, .18);
    $('#musicToggle').classList.remove('active'); $('#musicToggle').title = 'Включить музыку'; $('#musicToggle small').textContent = 'МУЗЫКА'; $('#musicNow').classList.add('hidden');
  }
  tone(frequency, duration, volume, type = 'sine', delay = 0, pan = 0) {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime + delay; const oscillator = this.context.createOscillator(); const gain = this.context.createGain();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), now + Math.min(.45, duration * .2)); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    oscillator.connect(gain);
    if (this.context.createStereoPanner) { const panner=this.context.createStereoPanner(); panner.pan.value=pan; gain.connect(panner); panner.connect(this.master); }
    else gain.connect(this.master);
    oscillator.start(now); oscillator.stop(now + duration + .05);
  }
  kick(delay = 0) {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime + delay; const oscillator = this.context.createOscillator(); const gain = this.context.createGain();
    oscillator.frequency.setValueAtTime(135, now); oscillator.frequency.exponentialRampToValueAtTime(45, now + .2);
    gain.gain.setValueAtTime(.32, now); gain.gain.exponentialRampToValueAtTime(.0001, now + .38); oscillator.connect(gain); gain.connect(this.master); oscillator.start(now); oscillator.stop(now + .4);
  }
  drum(duration = .16, volume = .09, delay = 0) {
    if (!this.enabled || !this.context) return;
    const length = Math.floor(this.context.sampleRate * duration); const buffer = this.context.createBuffer(1, length, this.context.sampleRate); const data = buffer.getChannelData(0);
    for (let index=0;index<length;index+=1) data[index]=(Math.random()*2-1)*(1-index/length);
    const source=this.context.createBufferSource(); const filter=this.context.createBiquadFilter(); const gain=this.context.createGain(); const now=this.context.currentTime+delay;
    source.buffer=buffer; filter.type='bandpass'; filter.frequency.value=1100; filter.Q.value=.75; gain.gain.setValueAtTime(volume,now); gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
    source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start(now);
  }
  calmPhrase() {
    const chords = [[130.81,164.81,196,246.94],[110,146.83,164.81,220],[98,130.81,164.81,196],[116.54,146.83,174.61,233.08]];
    const melodies = [[392,329.63,293.66],[329.63,293.66,246.94],[261.63,329.63,392],[349.23,293.66,261.63]];
    const index=this.step++%chords.length; const chord=chords[index];
    this.tone(chord[0]/2,5.4,.1,'triangle',0,-.12);
    chord.forEach((note,noteIndex)=>this.tone(note,5.2,.065-noteIndex*.006,noteIndex%2?'sine':'triangle',noteIndex*.09,-.55+noteIndex*.36));
    melodies[index].forEach((note,noteIndex)=>this.tone(note,1.5,.045,'sine',.55+noteIndex*1.15,noteIndex%2?.35:-.28));
  }
  warPhrase() {
    const bass = [55,55,65.41,49][this.step % 4]; this.kick(); this.tone(bass,.58,.12,'sawtooth',0,-.1);
    this.tone(bass*[2,3,2.5,3][this.step%4],.34,.055,'square',.1,.2);
    if (this.step%2===1) this.drum(.2,.13,.18);
    if (this.step%4===2) { this.kick(.3); this.tone(bass*4,.85,.07,'triangle',.2,.4); }
    if (this.step%8===7) [bass*4,bass*5,bass*6].forEach((note,index)=>this.tone(note,1.4,.06,'sawtooth',index*.12,-.35+index*.35));
    this.step++;
  }
  schedule() {
    clearInterval(this.timer); this.step = 0;
    const now = $('#musicNow'); now.classList.remove('hidden', 'war');
    now.querySelector('b').textContent = this.mode === 'war' ? 'Надвигается буря' : 'Спокойствие мира';
    if (this.mode === 'war') now.classList.add('war');
    const tick = () => this.mode === 'war' ? this.warPhrase() : this.calmPhrase(); tick();
    this.timer = setInterval(tick, this.mode === 'war' ? 620 : 4100);
  }
  setMode(mode) { if (this.mode === mode) return; this.mode = mode; if (this.enabled) this.schedule(); }
}
const music = new MusicEngine();
$('#musicToggle').addEventListener('click', () => music.enabled ? music.stop() : music.start());
document.addEventListener('pointerdown', () => { if (music.enabled && music.context?.state === 'suspended') music.start(); }, { capture:true });

function render() {
  const player = me();
  renderTop();
  if (!app.pathsReady && app.mapData) buildMap(); else renderMapStyles();
  renderPanel(); renderInspector(); renderNews();
  renderTechTree();
  music.setMode(myCountry()?.atWar?.length || myCountry()?.supportingWarId ? 'war' : 'calm');
  if (!player?.countryCode) openCountryModal();
  else $('#countryModal').classList.add('hidden');
}

setInterval(() => {
  if (!app.state) return;
  const seconds = Math.max(0, Math.ceil((app.state.world.nextTurnAt - Date.now()) / 1000));
  $('#turnTimer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}, 1000);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { $('#inspector').classList.remove('open'); $('#controlPanel').classList.remove('open'); $('#techModal').classList.add('hidden'); }
});
