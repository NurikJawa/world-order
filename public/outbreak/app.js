const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const app = {
  socket: null, state: null, connection: null, reconnectTimer: null, selectedCode: null, panel: 'command', chatChannel: 'team',
  layer: 'spread', mapData: null, pathsReady: false, transform: { x: 0, y: 0, k: 1 }, drag: null,
  entryTeam: 'pathogen', endShown: false, headlineIndex: 0, lastRecoverySave: 0, recoveryTimer: null
};
const PUBLIC_URL = 'https://world-order-game.onrender.com/outbreak';
const isLocal = ['127.0.0.1','localhost','0.0.0.0'].includes(location.hostname);

function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char])); }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function formatNumber(value, digits = 0) {
  const number = Number(value) || 0;
  if (Math.abs(number) >= 1e9) return `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:digits||2}).format(number/1e9)} млрд`;
  if (Math.abs(number) >= 1e6) return `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:digits||2}).format(number/1e6)} млн`;
  if (Math.abs(number) >= 1e3) return `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:digits||1}).format(number/1e3)} тыс.`;
  return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:digits}).format(number);
}
function percent(value, total, digits = 2) { return `${formatNumber(total ? value / total * 100 : 0, digits)}%`; }
function country(code) { return app.state?.world?.countries?.[code]; }
function catalog(code) { return app.state?.catalog?.find((item) => item.code === code); }
function me() { return app.state?.players?.find((player) => player.id === app.state.viewerId); }
function team() { return me()?.team || app.entryTeam; }
function teamState() { return app.state?.world?.[team()]; }
function specialty() { return app.state?.definitions?.specialties?.[team()]?.find((item) => item.id === me()?.specialty); }
function toast(message, error = false) { const node=document.createElement('div');node.className=`toast${error?' error':''}`;node.textContent=message;$('#toastStack').append(node);setTimeout(()=>node.remove(),3800); }

function applyDisplayScale() {
  const scaleValue=Math.min(innerWidth/1920,innerHeight/1080);const scale=scaleValue>=1.08?Math.min(4,Math.round(scaleValue*100)/100):1;
  const root=document.documentElement;root.style.setProperty('--display-scale',scale);root.style.setProperty('--app-w',`${innerWidth/scale}px`);root.style.setProperty('--app-h',`${innerHeight/scale}px`);root.classList.toggle('display-scaled',scale>1);
}
applyDisplayScale();let resizeFrame=0;window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(applyDisplayScale)});

function setConnected(connected) { $('#connectionStatus').classList.toggle('offline',!connected);$('#connectionStatus span').textContent=connected?'В СЕТИ':'НЕТ СВЯЗИ'; }
function setEntryBusy(busy) { for(const id of ['createRoom','joinRoom','playerName','roomCode'])$(`#${id}`).disabled=busy; }
function tokenKey(code) { return `outbreak-token:${String(code||'').toUpperCase()}`; }
function recoveryKey(code) { return `outbreak-recovery:${String(code||'').toUpperCase()}`; }
function loadRecovery(code) { try{return JSON.parse(localStorage.getItem(recoveryKey(code))||'null')}catch{return null} }
function scheduleRecovery() {
  if(!app.state?.recoverySnapshot||app.recoveryTimer)return;
  const wait=Math.max(300,6000-(Date.now()-app.lastRecoverySave));
  app.recoveryTimer=setTimeout(()=>{app.recoveryTimer=null;try{localStorage.setItem(recoveryKey(app.state.roomCode),JSON.stringify(app.state.recoverySnapshot));app.lastRecoverySave=Date.now()}catch{toast('Не удалось записать резервную копию',true)}},wait);
}

function send(payload) { if(app.socket?.readyState===WebSocket.OPEN)app.socket.send(JSON.stringify(payload));else toast('Нет соединения с сервером',true); }
function showGame() { $('#landing').classList.add('hidden');$('#game').classList.remove('hidden'); }
function connect(config) {
  app.connection=config;clearTimeout(app.reconnectTimer);if(app.socket&&app.socket.readyState<2)app.socket.close();setEntryBusy(true);setConnected(false);
  const socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}`);app.socket=socket;
  socket.addEventListener('open',()=>{const code=config.roomCode?.toUpperCase();const playerToken=code?localStorage.getItem(tokenKey(code)):null;socket.send(JSON.stringify({type:'outbreakHello',...config,playerToken}));setConnected(true)});
  socket.addEventListener('message',({data})=>{
    let message;try{message=JSON.parse(data)}catch{return}
    if(message.type==='outbreakWelcome'){
      localStorage.setItem(tokenKey(message.roomCode),message.playerToken);app.connection={action:'join',roomCode:message.roomCode,name:$('#playerName').value.trim(),team:app.entryTeam};setEntryBusy(false);showGame();if(message.resumed)toast('Вы вернулись к своей роли');
    }
    if(message.type==='outbreakState'){app.state=message;showGame();render();scheduleRecovery()}
    if(message.type==='outbreakTick'&&app.state){const countries=message.world.countries||{};const world={...message.world};delete world.countries;Object.assign(app.state.world,world);for(const[code,delta]of Object.entries(countries))Object.assign(app.state.world.countries[code],delta);render({tickCodes:Object.keys(countries)})}
    if(message.type==='outbreakToast')toast(message.message);
    if(message.type==='outbreakError'){setEntryBusy(false);$('#landingError').textContent=message.message;toast(message.message,true)}
    if(message.type==='outbreakMissing'){
      const recovery=loadRecovery(message.roomCode);if(recovery&&!app.connection?.recoveryAttempted){toast('Восстанавливаем операцию из резервной копии…');return connect({...app.connection,roomCode:message.roomCode,recovery,recoveryAttempted:true})}
      setEntryBusy(false);$('#landingError').textContent=`${message.message} На этом устройстве нет подходящего сохранения.`;toast($('#landingError').textContent,true);
    }
  });
  socket.addEventListener('close',(event)=>{setConnected(false);if(socket===app.socket&&event.code!==4001&&!$('#game').classList.contains('hidden'))app.reconnectTimer=setTimeout(()=>connect(app.connection),1700);else setEntryBusy(false)});
  socket.addEventListener('error',()=>setConnected(false));
}

$('#entryTeamChoice').addEventListener('click',(event)=>{const button=event.target.closest('[data-entry-team]');if(!button)return;app.entryTeam=button.dataset.entryTeam;$$('[data-entry-team]').forEach((item)=>item.classList.toggle('active',item===button))});
$('#createRoom').addEventListener('click',()=>{music.start();$('#landingError').textContent='';connect({action:'create',name:$('#playerName').value.trim(),team:app.entryTeam})});
$('#joinRoom').addEventListener('click',()=>{const roomCode=$('#roomCode').value.trim().toUpperCase();if(roomCode.length!==6)return $('#landingError').textContent='Введите шестизначный код комнаты';music.start();$('#landingError').textContent='';connect({action:'join',roomCode,name:$('#playerName').value.trim(),team:app.entryTeam})});
$('#roomCode').addEventListener('input',(event)=>event.target.value=event.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6));
$('#roomCode').addEventListener('keydown',(event)=>{if(event.key==='Enter')$('#joinRoom').click()});
const invited=new URLSearchParams(location.search).get('room')?.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);if(invited?.length===6){$('#roomCode').value=invited;$('#landingError').textContent=`Приглашение в операцию ${invited}. Введите имя и войдите.`}
if(isLocal)$('.entry-note').innerHTML=`Локальная версия доступна только на этом компьютере. Для игры с друзьями откройте <a href="${PUBLIC_URL}">${PUBLIC_URL.replace('https://','')}</a>.`;

async function loadMap(){try{const response=await fetch('/api/map?v=4');app.mapData=await response.json();if(app.state)buildMap()}catch{toast('Не удалось загрузить карту мира',true)}}
loadMap();
function project([lon,lat]){return[((lon+180)/360)*1200,((90-lat)/180)*600]}
function ringPath(ring){
  if(ring.length<3)return'';const points=[];
  for(const raw of ring){let lon=raw[0];const lat=raw[1];if(points.length){const previous=points.at(-1)[0];while(lon-previous>180)lon-=360;while(lon-previous<-180)lon+=360}points.push([lon,lat])}
  if(points.length>1&&points[0][0]===points.at(-1)[0]&&points[0][1]===points.at(-1)[1])points.pop();
  const clip=(polygon,boundary,greater)=>{const output=[];if(!polygon.length)return output;const inside=(point)=>greater?point[0]>=boundary:point[0]<=boundary;const intersection=(start,end)=>{const ratio=(boundary-start[0])/(end[0]-start[0]);return[boundary,start[1]+(end[1]-start[1])*ratio]};let start=polygon.at(-1);for(const end of polygon){const a=inside(start),b=inside(end);if(b){if(!a&&end[0]!==start[0])output.push(intersection(start,end));output.push(end)}else if(a&&end[0]!==start[0])output.push(intersection(start,end));start=end}return output};
  let path='';for(let shift=-2;shift<=2;shift+=1){let polygon=points.map(([lon,lat])=>[lon+shift*360,lat]);if(Math.max(...polygon.map((point)=>point[0]))<-180||Math.min(...polygon.map((point)=>point[0]))>180)continue;polygon=clip(clip(polygon,-180,true),180,false);if(polygon.length<3)continue;path+=polygon.map((point,index)=>{const[x,y]=project(point);return`${index?'L':'M'}${x.toFixed(2)},${y.toFixed(2)}`}).join('')+'Z'}return path
}
function geometryPath(geometry){if(!geometry)return'';if(geometry.type==='Polygon')return geometry.coordinates.map(ringPath).join('');if(geometry.type==='MultiPolygon')return geometry.coordinates.flatMap((polygon)=>polygon.map(ringPath)).join('');return''}
function buildMap(){
  if(!app.mapData||!app.state)return;const group=$('#mapGroup');group.innerHTML='';$('#markerGroup').innerHTML='';const mapped=new Set();
  for(const feature of app.mapData.features){const code=feature.properties.code;const pathData=geometryPath(feature.geometry);const node=document.createElementNS('http://www.w3.org/2000/svg','path');node.setAttribute('d',pathData);
    if(feature.properties.terrainOnly){node.setAttribute('class','terrain-outline');group.append(node);continue}
    mapped.add(code);node.setAttribute('data-code',code);node.setAttribute('class','country');node.addEventListener('pointerenter',(event)=>showTooltip(event,code));node.addEventListener('pointermove',moveTooltip);node.addEventListener('pointerleave',hideTooltip);group.append(node)
  }
  for(const meta of app.state.catalog.filter((item)=>!mapped.has(item.code))){const[x,y]=project([meta.latlng[1],meta.latlng[0]]);const node=document.createElementNS('http://www.w3.org/2000/svg','circle');node.setAttribute('cx',x);node.setAttribute('cy',y);node.setAttribute('r','2.2');node.setAttribute('data-code',meta.code);node.setAttribute('class','country-marker');node.addEventListener('pointerenter',(event)=>showTooltip(event,meta.code));node.addEventListener('pointermove',moveTooltip);node.addEventListener('pointerleave',hideTooltip);$('#markerGroup').append(node)}
  app.pathsReady=true;applyMapTransform();renderMapStyles()
}
function colorMix(low,high,t){const parse=(color)=>color.match(/\w\w/g).map((item)=>parseInt(item,16));const a=parse(low),b=parse(high);return`rgb(${a.map((value,index)=>Math.round(value+(b[index]-value)*clamp(t,0,1))).join(',')})`}
function mapFill(state){
  if(!state)return'#2d3a3d';
  if(app.layer==='spread'){
    if(team()==='response'&&!state.known)return'#314044';
    const ratio=state.infected/Math.max(1,state.population);const level=clamp(Math.log10(1+ratio*100000)/4.5,0,1);return colorMix('394447','f23f58',level)
  }
  if(app.layer==='detection')return state.known?colorMix('31434a','45c9ef',state.detection/100):'#2e3c40';
  if(app.layer==='health'){const score=clamp((state.healthcare+state.measures.hospital*8-state.severe/Math.max(1,state.population)*300)/100,0,1);return colorMix('a84b54','45bfa0',score)}
  const vaccinated=state.vaccinated/Math.max(1,state.population);return colorMix('3a4445','dec25f',vaccinated/.7)
}
function renderMapStyles(codes=null){
  if(!app.pathsReady||!app.state)return;
  const selector=Array.isArray(codes)?codes.flatMap((code)=>[`#mapGroup [data-code="${code}"]`,`#markerGroup [data-code="${code}"]`]).join(','):'#mapGroup [data-code], #markerGroup [data-code]';
  if(selector)$$(selector).forEach((node)=>{const code=node.dataset.code;const state=country(code);const marker=node.classList.contains('country-marker');node.setAttribute('class',`${marker?'country-marker':'country'}${team()==='response'&&!state?.known?' unknown':''}${code===app.selectedCode?' selected':''}${code===app.state.world.originCode&&app.state.world.status==='lobby'?' origin':''}`);node.style.fill=mapFill(state)});
  $('#biomeLayer').style.opacity=app.layer==='health'?'.75':'.42';renderPulses()
}
function renderPulses(){
  const group=$('#pulseGroup');if(!group||!app.state)return;group.innerHTML='';
  const targets=Object.values(app.state.world.countries).filter((item)=>item.infected>50&&(team()==='pathogen'||item.known)).sort((a,b)=>b.infected/b.population-a.infected/a.population).slice(0,14);
  for(const item of targets){const meta=catalog(item.code);if(!meta)continue;const[x,y]=project([meta.latlng[1],meta.latlng[0]]);const pulse=document.createElementNS('http://www.w3.org/2000/svg','circle');pulse.setAttribute('cx',x);pulse.setAttribute('cy',y);pulse.setAttribute('r','1');pulse.setAttribute('class',team()==='response'?'detection-pulse':'infection-pulse');pulse.style.animationDelay=`-${Math.abs(item.code.charCodeAt(0)%10)/10}s`;group.append(pulse)}
}
function chooseCountry(code){app.selectedCode=code;renderInspector();renderMapStyles();if(innerWidth<=1150)$('#inspector').classList.add('open')}
function showTooltip(event,code){const meta=catalog(code),state=country(code);if(!meta||!state)return;const unknown=team()==='response'&&!state.known;$('#mapTooltip').innerHTML=`<em>${unknown?'НЕТ ДАННЫХ':state.actual?'ТОЧНЫЕ ДАННЫЕ':`ПОГРЕШНОСТЬ ${state.uncertainty||0}%`}</em><b>${meta.flag} ${esc(meta.name)}</b><small>${unknown?'В стране пока не подтверждены случаи':`Заражено: ${formatNumber(state.infected)} · ${percent(state.infected,state.population)}`}</small><small>Население: ${formatNumber(state.population)}</small>`;$('#mapTooltip').classList.remove('hidden');moveTooltip(event)}
function moveTooltip(event){const scale=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--display-scale'))||1;const tip=$('#mapTooltip');tip.style.left=`${Math.min(innerWidth/scale-210,event.clientX/scale+13)}px`;tip.style.top=`${Math.min(innerHeight/scale-90,event.clientY/scale+10)}px`}
function hideTooltip(){$('#mapTooltip').classList.add('hidden')}
function applyMapTransform(){const{x,y,k}=app.transform;for(const id of ['terrainGroup','mapGroup','pulseGroup','markerGroup'])$(`#${id}`).setAttribute('transform',`translate(${x} ${y}) scale(${k})`)}
function zoomMap(factor,cx=600,cy=300){const old=app.transform.k,next=clamp(old*factor,1,6);app.transform.x=cx-(cx-app.transform.x)*(next/old);app.transform.y=cy-(cy-app.transform.y)*(next/old);app.transform.k=next;applyMapTransform()}
$('#zoomIn').addEventListener('click',()=>zoomMap(1.35));$('#zoomOut').addEventListener('click',()=>zoomMap(1/1.35));$('#resetMap').addEventListener('click',()=>{app.transform={x:0,y:0,k:1};applyMapTransform()});
$('#mapViewport').addEventListener('wheel',(event)=>{event.preventDefault();const rect=$('#worldMap').getBoundingClientRect(),cx=(event.clientX-rect.left)/rect.width*1200,cy=(event.clientY-rect.top)/rect.height*600;zoomMap(event.deltaY<0?1.18:.85,cx,cy)},{passive:false});
$('#mapViewport').addEventListener('pointerdown',(event)=>{if(event.button!==0||event.target.closest('button,input'))return;app.drag={px:event.clientX,py:event.clientY,x:app.transform.x,y:app.transform.y,code:event.target.closest('[data-code]')?.dataset.code||null,moved:false}});
$('#mapViewport').addEventListener('pointermove',(event)=>{if(!app.drag)return;const distance=Math.hypot(event.clientX-app.drag.px,event.clientY-app.drag.py);if(distance<4)return;app.drag.moved=true;$('#mapViewport').classList.add('dragging');if(app.transform.k===1)return;const rect=$('#worldMap').getBoundingClientRect();app.transform.x=app.drag.x+(event.clientX-app.drag.px)/rect.width*1200;app.transform.y=app.drag.y+(event.clientY-app.drag.py)/rect.height*600;applyMapTransform()});
$('#mapViewport').addEventListener('pointerup',()=>{const gesture=app.drag;app.drag=null;$('#mapViewport').classList.remove('dragging');if(gesture?.code&&!gesture.moved)chooseCountry(gesture.code)});$('#mapViewport').addEventListener('pointercancel',()=>{app.drag=null;$('#mapViewport').classList.remove('dragging')});
$('#mapLayers').addEventListener('click',(event)=>{const button=event.target.closest('[data-layer]');if(!button)return;app.layer=button.dataset.layer;$$('#mapLayers button').forEach((item)=>item.classList.toggle('active',item===button));renderMapStyles()});
function searchCountries(query){const text=query.trim().toLocaleLowerCase('ru');if(!text)return[];return app.state.catalog.filter((item)=>item.name.toLocaleLowerCase('ru').includes(text)||item.englishName.toLowerCase().includes(text)||item.code.toLowerCase().includes(text)).slice(0,10)}
$('#countrySearch').addEventListener('input',(event)=>{const results=searchCountries(event.target.value),box=$('#searchResults');box.innerHTML=results.map((item)=>`<button data-code="${item.code}"><span>${item.flag}</span><span>${esc(item.name)}</span></button>`).join('');box.classList.toggle('hidden',!results.length)});$('#searchResults').addEventListener('click',(event)=>{const button=event.target.closest('[data-code]');if(!button)return;chooseCountry(button.dataset.code);$('#searchResults').classList.add('hidden');$('#countrySearch').value=''});

function renderTop(){
  const state=app.state,world=state.world,side=team(),points=teamState()?.points??0;document.body.classList.toggle('team-response',side==='response');
  $('#roomBadge').textContent=state.roomCode;$('#worldDay').textContent=String(world.day).padStart(3,'0');$('#teamPointBadge').textContent=formatNumber(points,1);
  const identity=$('#teamIdentity');identity.className=`team-identity ${side}`;identity.querySelector('span').textContent=side==='pathogen'?'✣':'✚';identity.querySelector('b').textContent=state.definitions.teamNames[side];
  $('#evolutionIcon').textContent=side==='pathogen'?'✣':'⌬';$('#evolutionLabel').textContent=side==='pathogen'?'ЭВОЛЮЦИЯ':'ПРОТОКОЛЫ';
  const totals=world.totals;$('#globalInfected').textContent=formatNumber(totals.infected);$('#infectedPercent').textContent=percent(totals.infected,world.totalPopulation);$('#globalSevere').textContent=formatNumber(totals.severe);$('#globalDeaths').textContent=formatNumber(totals.deaths);$('#vaccineProgress').textContent=`${formatNumber(world.response.research,1)}%`;$('#vaccineBar').style.width=`${world.response.research}%`;$('#globalTrust').textContent=`${formatNumber(world.response.trust,1)}%`;
  const event=world.events[app.headlineIndex%Math.max(1,world.events.length)];$('#headline').textContent=event?.text||'Оперативная сводка обновляется…';$('#headlineDay').textContent=`ДЕНЬ ${event?.day??world.day}`;$('#mapStatusText').textContent=side==='response'?'КАРТА ПОКАЗЫВАЕТ ТОЛЬКО ОБНАРУЖЕННЫЕ СЛУЧАИ':'СИНДИКАТ ВИДИТ РЕАЛЬНОЕ РАСПРОСТРАНЕНИЕ';
}
function playerCard(player){const role=app.state.definitions.specialties[player.team].find((item)=>item.id===player.specialty);return`<article class="team-player"><span>${role?.icon||'○'}</span><div><b>${esc(player.name)}${player.id===app.state.viewerId?' · ВЫ':''}</b><small>${esc(role?.name||'Роль не выбрана')} · ${player.actions||0} действий</small></div><i class="${player.connected?'online':''}"></i></article>`}
function renderLobby(){
  const lobby=$('#lobbyModal'),world=app.state.world,isLobby=world.status==='lobby';lobby.classList.toggle('hidden',!isLobby);if(!isLobby)return;
  const sides={pathogen:app.state.players.filter((item)=>item.team==='pathogen'),response:app.state.players.filter((item)=>item.team==='response')};
  $('#pathogenCount').textContent=`${sides.pathogen.length} / 5`;$('#responseCount').textContent=`${sides.response.length} / 5`;$('#pathogenPlayers').innerHTML=sides.pathogen.map(playerCard).join('');$('#responsePlayers').innerHTML=sides.response.map(playerCard).join('');$('#lobbyCopyCode').textContent=`${app.state.roomCode} ⧉`;
  const player=me(),specialties=app.state.definitions.specialties[player.team],taken=new Set(app.state.players.filter((item)=>item.team===player.team&&item.id!==player.id).map((item)=>item.specialty));
  $('#specialtyOptions').innerHTML=specialties.map((item)=>`<button class="specialty-option${player.specialty===item.id?' active':''}" data-specialty="${item.id}" ${taken.has(item.id)?'disabled':''}><span>${item.icon}</span><b>${esc(item.name)}</b><small>${esc(item.abilityName)}</small></button>`).join('');
  if(document.activeElement!==$('#pathogenName'))$('#pathogenName').value=world.pathogenName;
  const originSelect=$('#originSelect');if(!originSelect.options.length)originSelect.innerHTML=app.state.catalog.map((item)=>`<option value="${item.code}">${item.flag} ${esc(item.name)}</option>`).join('');originSelect.value=world.originCode;originSelect.disabled=player.team!=='pathogen';$('#savePathogenName').disabled=player.team!=='pathogen';$('#pathogenName').disabled=player.team!=='pathogen';
  const origin=catalog(world.originCode);$('#originLabel').textContent=`Нулевой пациент: ${origin?.flag||''} ${origin?.name||world.originCode}`;
  const ready=sides.pathogen.length>0&&sides.response.length>0;$('#lobbyReadyDot').classList.toggle('ready',ready);$('#lobbyStatus').textContent=ready?app.state.isHost?'Обе команды готовы — можно запускать':'Ожидаем запуска от создателя комнаты':'Нужен минимум один игрок в каждой команде';$('#startOutbreak').disabled=!ready||!app.state.isHost;$('#startOutbreak').textContent=app.state.isHost?'НАЧАТЬ ОПЕРАЦИЮ':'ОЖИДАЕМ СОЗДАТЕЛЯ';
}
function abilityCard(){
  const role=specialty();if(!role)return'';const readyAt=me()?.abilityReadyAt||0,seconds=Math.max(0,Math.ceil((readyAt-Date.now())/1000));return`<article class="ability-card"><header><span>${role.icon}</span><div><small>ЛИЧНАЯ СПЕЦИАЛИЗАЦИЯ</small><b>${esc(role.name)}</b></div></header><p>${esc(role.description)}</p><button data-ability ${seconds?'disabled':''}>${seconds?`ПЕРЕЗАРЯДКА · ${seconds} СЕК.`:`${esc(role.abilityName)}${['route_jump','blind_spot','stable_reservoir','deep_scan','medical_surge'].includes(role.ability)?' · НУЖНА СТРАНА':''}`}</button></article>`
}
function renderCommandPanel(){
  const side=team(),points=teamState()?.points||0,actions=app.state.definitions.globalActions[side];const goal=side==='pathogen'?'Распространяйте инфекцию скрытно, собирайте очки мутации и эволюционируйте до того, как вакцина охватит планету.':'Находите настоящие очаги, удерживайте доверие, спасайте перегруженные страны и доведите вакцину до массового покрытия.';
  return`<div class="panel-kicker"><span>${side==='pathogen'?'УПРАВЛЕНИЕ ЭПИДЕМИЕЙ':'ЦЕНТР РЕАГИРОВАНИЯ'}</span><i>ДЕНЬ ${app.state.world.day}</i></div><h2 class="panel-title">${side==='pathogen'?esc(app.state.world.pathogenName):'Спасти человечество'}</h2><p class="panel-subtitle">${goal}</p><article class="resource-card"><span>${side==='pathogen'?'✣':'⬡'}</span><div><small>${side==='pathogen'?'ОЧКИ МУТАЦИИ':'ОПЕРАТИВНЫЙ РЕЗЕРВ'}</small><b>Общий ресурс команды</b></div><strong>${formatNumber(points,1)}</strong></article>${abilityCard()}<div class="section-label">ГЛОБАЛЬНЫЕ ОПЕРАЦИИ</div><div class="action-list">${actions.map((item)=>`<button class="action-button" data-global-action="${item.id}" ${points<item.cost?'disabled':''}><i>${side==='pathogen'?'ϟ':'◎'}</i><span><b>${esc(item.name)}</b><small>${esc(item.description)}</small></span><strong>${item.cost}</strong></button>`).join('')}</div><div class="section-label">СТРАТЕГИЧЕСКАЯ ЦЕЛЬ</div>${side==='pathogen'?`<div class="uncertainty">Заражено стран: <b>${app.state.world.pathogen.infectedCountries}</b><br>Пиковое число активных случаев: <b>${formatNumber(app.state.world.pathogen.peakInfected)}</b></div>`:`<div class="uncertainty">Известно очагов: <b>${app.state.world.totals.detectedCountries}</b><br>Запас готовых доз: <b>${formatNumber(app.state.world.response.productionStock||0)}</b></div>`}`;
}
function renderTeamPanel(){const definitions=app.state.definitions;return`<div class="panel-kicker"><span>СОСТАВ ОПЕРАЦИИ</span><i>${app.state.players.length} / 10</i></div><h2 class="panel-title">Две стороны мира</h2><p class="panel-subtitle">У каждого игрока уникальная способность с общей целью команды.</p><div class="section-label">${definitions.teamNames.pathogen}</div><div class="team-list">${app.state.players.filter((item)=>item.team==='pathogen').map(playerCard).join('')}</div><div class="section-label">${definitions.teamNames.response}</div><div class="team-list">${app.state.players.filter((item)=>item.team==='response').map(playerCard).join('')}</div>`}
function chatMessages(){const list=app.state.world.chat.filter((item)=>app.chatChannel==='global'?item.channel==='global':item.channel==='team');return list.map((item)=>`<article class="chat-message ${item.team}"><header><b>${esc(item.author)}</b><span>${new Date(item.createdAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span></header><p>${esc(item.text)}</p></article>`).join('')||'<div class="empty-inspector"><b>КАНАЛ ПУСТ</b><p>Согласуйте следующую операцию с союзниками.</p></div>'}
function renderChatPanel(){
  const content=$('#panelContent'),existing=$('#teamChatForm');if(existing){const log=$('#chatLog');if(log)log.innerHTML=chatMessages();return null}
  return`<div class="panel-kicker"><span>ЗАЩИЩЁННАЯ СВЯЗЬ</span><i>LIVE</i></div><h2 class="panel-title">Командный канал</h2><p class="panel-subtitle">Командные сообщения видят только союзники. Общий канал доступен обеим сторонам.</p><div class="chat-channel"><button data-chat-channel="team" class="${app.chatChannel==='team'?'active':''}">КОМАНДА</button><button data-chat-channel="global" class="${app.chatChannel==='global'?'active':''}">ОБЩИЙ</button></div><div id="chatLog" class="chat-log">${chatMessages()}</div><form id="teamChatForm" class="chat-form"><textarea id="chatText" maxlength="240" placeholder="Сообщение команде…"></textarea><button>→</button></form>`
}
function renderPanel(){const content=$('#panelContent');$$('#panelTabs button').forEach((button)=>button.classList.toggle('active',button.dataset.panel===app.panel));let html=app.panel==='command'?renderCommandPanel():app.panel==='team'?renderTeamPanel():renderChatPanel();if(html!==null)content.innerHTML=html}

function renderInspector(){
  const box=$('#countryInspector');if(!app.selectedCode){box.innerHTML='<div class="empty-inspector"><span>◎</span><b>ВЫБЕРИТЕ СТРАНУ</b><p>Нажмите на государство, чтобы изучить вспышку и провести локальную операцию.</p></div>';return}
  const state=country(app.selectedCode),meta=catalog(app.selectedCode);if(!state||!meta)return;const unknown=team()==='response'&&!state.known,points=teamState()?.points||0,actions=app.state.definitions.countryActions[team()];
  const measure=(label,value)=>`<span>${label}<b>${'●'.repeat(value)}${'○'.repeat(3-value)}</b></span>`;
  const actionHtml=actions.map((item)=>{const discount=app.state.world.response.upgrades.includes('rapid_teams')?0.85:1;const cost=team()==='response'?Math.max(1,Math.round(item.cost*discount)):item.cost;const blocked=points<cost||(team()==='pathogen'&&!state.infected&&item.id!=='aerosol_burst')||(item.id==='vaccine_campaign'&&app.state.world.response.research<100);return`<button data-country-action="${item.id}" ${blocked?'disabled':''}><i>${item.icon}</i><span>${esc(item.name)}</span><strong>${cost}</strong></button>`}).join('');
  box.innerHTML=`<header class="country-head"><span>${meta.flag}</span><div><h2>${esc(meta.name)}</h2><small>${esc(meta.capital)} · ${unknown?'СИТУАЦИЯ НЕИЗВЕСТНА':state.actual?'ТОЧНЫЕ ДАННЫЕ':`ПОГРЕШНОСТЬ ${state.uncertainty||0}%`}</small></div><i class="${state.known?'known':''}"></i></header><div class="country-summary"><div><small>НАСЕЛЕНИЕ</small><b>${formatNumber(state.population)}</b></div><div class="danger"><small>ЗАРАЖЕНО</small><b>${unknown?'—':formatNumber(state.infected)}</b></div><div><small>ТЯЖЁЛЫЕ</small><b>${unknown?'—':formatNumber(state.severe)}</b></div><div><small>ПОГИБЛО</small><b>${formatNumber(state.deaths)}</b></div><div><small>ВАКЦИНИРОВАНО</small><b>${formatNumber(state.vaccinated)}</b></div><div><small>ОБНАРУЖЕНИЕ</small><b>${unknown?'0%':`${formatNumber(state.detection,1)}%`}</b></div></div>${unknown?'<div class="uncertainty">У штаба нет подтверждённых данных. Проведите массовый скрининг или дождитесь сигнала национальной системы.</div>':!state.actual&&team()==='response'?`<div class="uncertainty">Это эпидемиологическая оценка с погрешностью ${state.uncertainty||0}%. Точный скрининг улучшит данные.</div>`:''}<div class="measure-grid">${measure('ТЕСТЫ',state.measures.testing)}${measure('ТРЕЙСИНГ',state.measures.tracing)}${measure('ГОСПИТАЛИ',state.measures.hospital)}${measure('ГРАНИЦЫ',state.measures.border)}</div><div class="section-label">ДЕЙСТВИЯ В СТРАНЕ</div><div class="country-actions">${actionHtml}</div>`;
}
function renderEvents(){$('#eventFeed').innerHTML=app.state.world.events.slice(0,30).map((item)=>`<article class="event-item ${item.tone}"><p>${esc(item.text)}</p><small>ДЕНЬ ${item.day}</small></article>`).join('')}
function renderEvolution(){
  if($('#evolutionModal').classList.contains('hidden')||!app.state)return;const side=team(),branches=app.state.definitions.upgrades[side],owned=app.state.world[side].upgrades||[],points=app.state.world[side].points||0;
  $('#treeTeamKicker').textContent=app.state.definitions.teamNames[side];$('#treeTitle').textContent=side==='pathogen'?'Эволюция патогена':'Глобальные протоколы';$('#treeDescription').textContent=side==='pathogen'?'Меняйте свойства патогена всей командой. Высокая летальность до распространения может уничтожить ваши последние цепочки.':'Постройте единую систему обнаружения, сдерживания, лечения и производства вакцины.';$('#treePoints').textContent=formatNumber(points,1);
  $('#evolutionTree').innerHTML=branches.map((branch)=>`<section class="evolution-branch" style="--branch:${branch.color}"><header class="branch-head"><span>${branch.icon}</span><div><h3>${esc(branch.name)}</h3></div><p>Общая ветка команды</p></header><div class="upgrade-nodes">${branch.nodes.map((node,index)=>{const learned=owned.includes(node.id),requires=(node.requires||[]).every((id)=>owned.includes(id)),any=!node.requiresAny?.length||node.requiresAny.some((id)=>owned.includes(id)),available=requires&&any;return`<article class="upgrade-node ${learned?'learned':available?'available':'locked'}"><header><span>УРОВЕНЬ ${index+1}</span><b>${learned?'ИЗУЧЕНО':available?'ДОСТУПНО':'ЗАКРЫТО'}</b></header><h4>${esc(node.name)}</h4><p>${esc(node.effectText)}</p>${learned?'':`<button data-upgrade="${node.id}" ${!available||points<node.cost?'disabled':''}>${points<node.cost&&available?'НЕ ХВАТАЕТ ОЧКОВ':`ИЗУЧИТЬ · ${node.cost}`}</button>`}</article>`}).join('')}</div></section>`).join('')
}
const GUIDE_CONTENT={
  rules:{icon:'01',title:'Один живой мир и две противоположные победы',lead:'Матч идёт непрерывно: один игровой день проходит каждые 1,5 секунды. Ручной пропуск времени невозможен.',cards:[['Победа патогена','Добейтесь глобального коллапса: массового заражения и перегрузки здравоохранения либо критической смертности.'],['Победа врачей','Разорвите все цепочки передачи или вакцинируйте 68% мира и сократите активные случаи ниже 1,2%.'],['Общий ресурс','Очки мутации и оперативный резерв принадлежат всей команде. Дорогая покупка одного игрока влияет на планы союзников.'],['Непрерывная симуляция','Страны сами тестируют, вводят меры и реагируют на угрозу. Игроки ускоряют и направляют процесс.']]},
  pathogen:{icon:'02',title:'Распространяйтесь раньше, чем станете заметны',lead:'Синдикат видит реальные заражения. Очки мутации приходят за новые случаи и страны, а свойства патогена работают глобально.',cards:[['Передача','Воздушные, водные и скрытые носители ускоряют экспорт инфекции между соседями и транспортными узлами.'],['Симптомы','Тяжёлые симптомы перегружают больницы, но помогают врачам быстрее обнаружить угрозу.'],['Адаптация','Климатическая и лекарственная устойчивость поддерживает очаги, а антигенный дрейф замедляет вакцину.'],['Риск вымирания','Если сделать патоген смертельным слишком рано, заражённые могут умереть или выздороветь до выхода в другие страны.']]},
  response:{icon:'03',title:'Сначала найдите угрозу, затем бейте точно',lead:'Штаб не видит скрытые случаи. Данные появляются после тестирования и всегда имеют погрешность, пока обнаружение не достигнет 92%.',cards:[['Наблюдение','Скрининг и диагностические сети раскрывают очаги. Голые серые страны не обязательно безопасны.'],['Сдерживание','Трейсинг, ограничения и границы снижают передачу, но чрезмерные меры разрушают мировое доверие.'],['Медицина','Госпитали и протоколы лечения сокращают смертность, особенно во время перегрузки коек.'],['Вакцина','Исследование — только первый этап. После 100% нужны производство, распределение и кампании по странам.']]},
  map:{icon:'04',title:'Четыре слоя превращают карту в прибор',lead:'Переключайте распространение, обнаружение, медицину и вакцинацию. Цвет зависит от выбранного слоя и знаний вашей команды.',cards:[['Туман информации','Патоген знает точные цифры. Врачи видят только подтверждённые оценки — это главное асимметричное правило.'],['Импорт случаев','Инфекция путешествует через сухопутные границы и крупные авиационные узлы. Пограничные меры уменьшают, но не исключают риск.'],['Пульс очага','Пульсирующие точки показывают самые активные известные очаги без создания тяжёлых сотен анимаций.'],['Выбор страны','ЛКМ открывает досье и локальные операции. Колесо масштабирует карту, перетаскивание работает после увеличения.']]},
  multiplayer:{icon:'05',title:'До пяти специалистов на каждой стороне',lead:'Роли уникальны внутри команды и имеют сильную способность с перезарядкой 90 секунд. Координация важнее количества кликов.',cards:[['Командный чат','Закрытый канал видят только союзники. Общий канал подходит для переговоров и психологической игры.'],['Специализации','Генетик, диверсант и архитекторы патогена против эпидемиолога, врача, исследователя, координатора и коммуникатора.'],['Переподключение','Личный ключ возвращает вашу сторону и роль. Создатель дополнительно хранит резервную копию комнаты в браузере.'],['Честный баланс','В каждой стороне максимум пять человек. Все сильные решения проходят серверную проверку ресурсов и перезарядок.']]}
};
function renderGuide(page='rules'){const data=GUIDE_CONTENT[page];$('#guidePages').innerHTML=`<article class="guide-page"><header><span>${data.icon}</span><div><h3>${data.title}</h3><p>${data.lead}</p></div></header><div class="guide-grid">${data.cards.map(([title,text])=>`<section><b>${title}</b><p>${text}</p></section>`).join('')}</div></article>`;$$('#guideTabs button').forEach((button)=>button.classList.toggle('active',button.dataset.guide===page))}
function renderEnd(){const world=app.state.world;if(world.status!=='ended'||app.endShown)return;app.endShown=true;const response=world.winner==='response';$('#endModal').classList.remove('hidden');$('.end-card').classList.toggle('response',response);$('#endIcon').textContent=response?'✚':'✣';$('#endTitle').textContent=response?'Мир спасён':'Системный коллапс';$('#endReason').textContent=world.endReason;$('#endStats').innerHTML=`<span><small>ДНЕЙ</small><b>${world.day}</b></span><span><small>ЗАРАЖЕНО</small><b>${formatNumber(world.totals.infected)}</b></span><span><small>ВАКЦИНА</small><b>${formatNumber(world.response.research,1)}%</b></span>`}
function render({tickCodes=null}={}){
  if(!app.state)return;if(!app.pathsReady&&app.mapData)buildMap();renderTop();renderLobby();if(!tickCodes||app.panel==='command')renderPanel();renderInspector();renderEvents();renderMapStyles(tickCodes);renderEvolution();renderEnd();
}

async function copyInvite(){if(!app.state)return;const invite=new URL('/outbreak',location.origin);invite.searchParams.set('room',app.state.roomCode);try{await navigator.clipboard.writeText(invite.toString());toast('Ссылка на операцию скопирована')}catch{toast(`Код комнаты: ${app.state.roomCode}`)}}
$('#copyRoom').addEventListener('click',copyInvite);$('#lobbyCopyCode').addEventListener('click',copyInvite);
$('#mobilePanel').addEventListener('click',()=>$('#controlPanel').classList.toggle('open'));
$('#panelTabs').addEventListener('click',(event)=>{const button=event.target.closest('[data-panel]');if(!button)return;app.panel=button.dataset.panel;renderPanel()});
$('#panelContent').addEventListener('click',(event)=>{
  const global=event.target.closest('[data-global-action]');if(global)send({type:'outbreakAction',action:'global',id:global.dataset.globalAction});
  if(event.target.closest('[data-ability]'))send({type:'outbreakAction',action:'ability',target:app.selectedCode});
  const channel=event.target.closest('[data-chat-channel]');if(channel){app.chatChannel=channel.dataset.chatChannel;$('#panelContent').innerHTML='';renderPanel()}
});
$('#panelContent').addEventListener('submit',(event)=>{if(event.target.id!=='teamChatForm')return;event.preventDefault();const input=$('#chatText'),text=input.value.trim();if(!text)return;send({type:'outbreakChat',channel:app.chatChannel,text});input.value='';input.focus()});
$('#countryInspector').addEventListener('click',(event)=>{const button=event.target.closest('[data-country-action]');if(button)send({type:'outbreakAction',action:'country',id:button.dataset.countryAction,target:app.selectedCode})});
$('#lobbyModal').addEventListener('click',(event)=>{const teamButton=event.target.closest('[data-switch-team]');if(teamButton)send({type:'outbreakTeam',team:teamButton.dataset.switchTeam});const role=event.target.closest('[data-specialty]');if(role)send({type:'outbreakSpecialty',id:role.dataset.specialty})});
$('#originSelect').addEventListener('change',(event)=>send({type:'outbreakOrigin',code:event.target.value}));$('#savePathogenName').addEventListener('click',()=>send({type:'outbreakName',name:$('#pathogenName').value}));$('#pathogenName').addEventListener('keydown',(event)=>{if(event.key==='Enter')$('#savePathogenName').click()});$('#startOutbreak').addEventListener('click',()=>send({type:'outbreakStart'}));
function openEvolution(){$('#evolutionModal').classList.remove('hidden');renderEvolution()}function closeEvolution(){$('#evolutionModal').classList.add('hidden')}
$('#openEvolution').addEventListener('click',openEvolution);$('#closeEvolution').addEventListener('click',closeEvolution);$('#evolutionModal').addEventListener('click',(event)=>{if(event.target.closest('[data-close-evolution]'))closeEvolution();const button=event.target.closest('[data-upgrade]');if(button)send({type:'outbreakAction',action:'upgrade',id:button.dataset.upgrade})});
function openGuide(){renderGuide('rules');$('#guideModal').classList.remove('hidden')}function closeGuide(){$('#guideModal').classList.add('hidden')}
$('#openGuide').addEventListener('click',openGuide);$('#closeGuide').addEventListener('click',closeGuide);$('#guideModal').addEventListener('click',(event)=>{if(event.target.closest('[data-close-guide]'))closeGuide()});$('#guideTabs').addEventListener('click',(event)=>{const button=event.target.closest('[data-guide]');if(button)renderGuide(button.dataset.guide)});$('#closeEnd').addEventListener('click',()=>$('#endModal').classList.add('hidden'));
window.addEventListener('keydown',(event)=>{if(event.key!=='Escape')return;closeEvolution();closeGuide();$('#inspector').classList.remove('open');$('#controlPanel').classList.remove('open')});

class MusicEngine{
  constructor(){this.context=null;this.master=null;this.timer=null;this.enabled=false;this.step=0}
  async start(){try{this.context||=new(window.AudioContext||window.webkitAudioContext)();await this.context.resume();if(!this.master){this.master=this.context.createGain();this.master.gain.value=.16;this.master.connect(this.context.destination)}if(this.enabled)return;this.enabled=true;$('#musicToggle').classList.add('active');$('#musicNow').classList.remove('hidden');this.schedule()}catch{toast('Браузер заблокировал звук — нажмите ♪ ещё раз',true)}}
  stop(){this.enabled=false;clearInterval(this.timer);this.timer=null;$('#musicToggle').classList.remove('active');$('#musicNow').classList.add('hidden')}
  tone(frequency,duration,volume,type='sine',delay=0){if(!this.enabled||!this.context)return;const at=this.context.currentTime+delay,osc=this.context.createOscillator(),gain=this.context.createGain();osc.type=type;osc.frequency.value=frequency;gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(volume,at+.08);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);osc.connect(gain);gain.connect(this.master);osc.start(at);osc.stop(at+duration+.05)}
  phrase(){const side=team(),danger=app.state?app.state.world.totals.infected/Math.max(1,app.state.world.totalPopulation):0;if(side==='pathogen'){const roots=[55,65.41,49,58.27],root=roots[this.step%4];this.tone(root,2.8,.1,'sawtooth');this.tone(root*2,1.2,.045,'triangle',.35);this.tone(root*3,1.8,.035,'sine',1.05);if(danger>.05)this.tone(root*4,.28,.04,'square',1.7)}else{const chords=[[130.8,164.8,196],[146.8,174.6,220],[123.5,164.8,207.6],[110,146.8,196]],chord=chords[this.step%4];chord.forEach((note,index)=>this.tone(note,3.5,.055-index*.008,index?'sine':'triangle',index*.1));this.tone(chord[1]*2,1.1,.035,'sine',1.25)}this.step+=1;const title=$('#musicNow b');if(title)title.textContent=side==='pathogen'?'Невидимый вектор':'Последний рубеж'}
  schedule(){clearInterval(this.timer);this.step=0;this.phrase();this.timer=setInterval(()=>this.phrase(),3100)}
  refresh(){if(this.enabled)this.schedule()}
}
const music=new MusicEngine();$('#musicToggle').addEventListener('click',()=>music.enabled?music.stop():music.start());document.addEventListener('pointerdown',()=>{if(music.enabled&&music.context?.state==='suspended')music.start()},{capture:true});

setInterval(()=>{
  if(!app.state)return;const role=specialty(),button=$('[data-ability]');if(button&&role){const seconds=Math.max(0,Math.ceil(((me()?.abilityReadyAt||0)-Date.now())/1000));button.disabled=seconds>0;button.textContent=seconds?`ПЕРЕЗАРЯДКА · ${seconds} СЕК.`:`${role.abilityName}${['route_jump','blind_spot','stable_reservoir','deep_scan','medical_surge'].includes(role.ability)?' · НУЖНА СТРАНА':''}`}
  if(app.state.world.events.length){app.headlineIndex=(app.headlineIndex+1)%Math.min(8,app.state.world.events.length);const item=app.state.world.events[app.headlineIndex];$('#headline').textContent=item.text;$('#headlineDay').textContent=`ДЕНЬ ${item.day}`}
},5000);
