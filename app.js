(function(){
'use strict';

const CFG = {
  USER: 'opcom',
  PASS: 'rede@2026',

  FORM_URL: 'https://docs.google.com/forms/d/e/1FAIpQLSfQNssgIdx2RV_ceeiXb4dErkQ63sEcbv6OkuFCCtyzU6xuTg/viewform',
  F_SERIAL: 'entry.1200362869',
  F_TERMINAL: 'entry.1074209161',

  // JSON de status publicado pelo robô. Se ficar vazio ou inacessível,
  // o histórico local continua funcionando normalmente.
  STATUS_URL: 'https://redeflex-my.sharepoint.com/:u:/g/personal/joao_delima_redeflex_com_br/IQD3dQvKmROtSrxjVGv-ZpY2ATfobekgXS3w1IVUEGZRreA?e=dlpmWT&download=1',

  WAIT_SECONDS: 10,      // = ciclo do robô
  POLL_MS: 2000,
  STORE_KEY: 'opcom_desalocacao_hist_v1',
};

const $ = id => document.getElementById(id);

/* ---------------- histórico local ---------------- */
const Hist = {
  all(){
    try{ return JSON.parse(localStorage.getItem(CFG.STORE_KEY)) || []; }
    catch{ return []; }
  },
  add(entry){
    const list = Hist.all();
    list.unshift(entry);
    try{ localStorage.setItem(CFG.STORE_KEY, JSON.stringify(list.slice(0, 100))); }
    catch(e){ console.warn('Não foi possível salvar o histórico local:', e); }
  },
  update(ts, patch){
    const list = Hist.all();
    const i = list.findIndex(x => x.ts === ts);
    if(i > -1){
      Object.assign(list[i], patch);
      try{ localStorage.setItem(CFG.STORE_KEY, JSON.stringify(list)); }catch{}
    }
  }
};

/* ---------------- navegação ---------------- */
function show(view){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $(view).classList.add('active');
  $('header').style.display = view === 'loginView' ? 'none' : '';
  $('navConsole').classList.toggle('active', view === 'consoleView');
  $('navHistory').classList.toggle('active', view === 'historyView');
  if(view === 'historyView') renderHistory();
}

function fail(fieldId){
  const f = $(fieldId);
  f.classList.add('invalid', 'shake');
  setTimeout(() => f.classList.remove('shake'), 320);
}
function clearFails(){
  document.querySelectorAll('.field').forEach(f => f.classList.remove('invalid'));
}

/* ---------------- login ---------------- */
$('loginForm').addEventListener('submit', e => {
  e.preventDefault();
  const btn = $('loginBtn'), label = $('loginLabel');
  clearFails();
  $('loginErr').hidden = true;

  btn.disabled = true;
  label.innerHTML = '<span class="spinner"></span>';

  setTimeout(() => {
    btn.disabled = false;
    label.textContent = 'Entrar';

    if($('user').value.trim() === CFG.USER && $('pass').value === CFG.PASS){
      show('consoleView');
    } else {
      $('loginErr').hidden = false;
      fail('fUser'); fail('fPass');
    }
  }, 450);
});

$('navLogout').addEventListener('click', () => {
  $('user').value = ''; $('pass').value = '';
  $('loginErr').hidden = true;
  resetFlow();
  show('loginView');
});
$('navConsole').addEventListener('click', () => show('consoleView'));
$('navHistory').addEventListener('click', () => show('historyView'));

/* ---------------- fluxo 1 → 2 ---------------- */
let current = null;
let loads = 0;

$('dataForm').addEventListener('submit', e => {
  e.preventDefault();
  clearFails();
  $('dataErr').hidden = true;

  const serial = $('serial').value.trim();
  const terminal = $('terminal').value.trim();

  if(!serial || !terminal){
    $('dataErr').hidden = false;
    if(!serial) fail('fSerial');
    if(!terminal) fail('fTerm');
    return;
  }

  current = { serial, terminal };

  $('chips').innerHTML =
    `<span class="chip"><span class="chip-key">Série</span><span class="chip-val">${esc(serial)}</span></span>` +
    `<span class="chip"><span class="chip-key">Terminal</span><span class="chip-val">${esc(terminal)}</span></span>`;

  $('embed').classList.remove('ready');
  $('watch').style.display = '';
  $('watchText').textContent = 'Aguardando o envio do formulário…';
  loads = 0;
  $('frame').src = `${CFG.FORM_URL}?${CFG.F_SERIAL}=${encodeURIComponent(serial)}&${CFG.F_TERMINAL}=${encodeURIComponent(terminal)}&embedded=true`;

  $('panelA').style.display = 'none';
  $('panelB').style.display = '';
  $('stepA').classList.replace('on', 'done');
  $('stepB').classList.add('on');
});

$('backBtn').addEventListener('click', resetFlow);

function resetFlow(){
  $('panelB').style.display = 'none';
  $('panelA').style.display = '';
  $('stepA').classList.remove('done'); $('stepA').classList.add('on');
  $('stepB').classList.remove('on');
  loads = 0;
  $('frame').src = 'about:blank';
  $('linkViz').classList.remove('severed');
  if(timer){ clearInterval(timer); timer = null; }
  if(poller){ clearInterval(poller); poller = null; }
}

/* ---------------- detecção automática do envio ----------------
   O Google Forms faz uma navegação real dentro do iframe ao enviar
   (vai pra tela "Sua resposta foi registrada"), o que dispara um novo
   evento 'load'. Não conseguimos LER o conteúdo do iframe (outro
   domínio), mas conseguimos CONTAR os loads:
     load #1 = formulário pré-preenchido carregou
     load #2 = resposta enviada  → dispara o fluxo automático
------------------------------------------------------------------ */
$('frame').addEventListener('load', () => {
  const src = $('frame').src;
  if(!src || src === 'about:blank') return;

  loads++;

  if(loads === 1){
    $('embed').classList.add('ready');
    return;
  }

  // envio detectado
  if(!current) return;
  $('watchText').textContent = 'Envio detectado — processando…';

  const entry = {
    ts: Date.now(),
    serial: current.serial,
    terminal: current.terminal,
    status: 'pendente',
    msg: 'Aguardando processamento da automação.',
  };
  Hist.add(entry);
  startWait(entry);
});

/* ---------------- countdown ---------------- */
const CIRC = 2 * Math.PI * 34;
let timer = null, poller = null;

function startWait(entry){
  $('mResult').style.display = 'none';
  $('mWait').style.display = '';
  $('overlay').classList.add('open');

  let left = CFG.WAIT_SECONDS;
  $('cdNum').textContent = left;
  $('cdFill').style.strokeDasharray = CIRC;
  $('cdFill').style.strokeDashoffset = 0;

  timer = setInterval(() => {
    left--;
    $('cdNum').textContent = Math.max(left, 0);
    $('cdFill').style.strokeDashoffset = CIRC * (1 - left / CFG.WAIT_SECONDS);
    if(left <= 0){
      clearInterval(timer); timer = null;
      if(poller){ clearInterval(poller); poller = null; }
      finish(entry, null);
    }
  }, 1000);

  if(CFG.STATUS_URL){
    poller = setInterval(async () => {
      const found = await lookup(entry.serial, entry.terminal);
      if(found){
        if(timer){ clearInterval(timer); timer = null; }
        clearInterval(poller); poller = null;
        finish(entry, found);
      }
    }, CFG.POLL_MS);
  }
}

async function lookup(serial, terminal){
  try{
    const r = await fetch(`${CFG.STATUS_URL}&_=${Date.now()}`, { cache:'no-store' });
    if(!r.ok) return null;
    const list = await r.json();
    return (list || [])
      .filter(x => String(x.serial) === serial && String(x.terminalId) === terminal)
      .sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))[0] || null;
  }catch(e){
    console.warn('[status] indisponível:', e.message);
    return null;
  }
}

const SVG_OK   = '<path d="M4 12.5 L9.5 18 L20 5.5" fill="none" stroke="var(--ok-text)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
const SVG_ERR  = '<path d="M6 6 L18 18" fill="none" stroke="var(--red-text)" stroke-width="2.5" stroke-linecap="round"/><path d="M18 6 L6 18" fill="none" stroke="var(--red-text)" stroke-width="2.5" stroke-linecap="round"/>';
const SVG_WARN = '<path d="M12 7 L12 13" fill="none" stroke="var(--warn)" stroke-width="2.5" stroke-linecap="round"/><path d="M12 17 L12 17.01" fill="none" stroke="var(--warn)" stroke-width="2.5" stroke-linecap="round"/>';

function finish(entry, found){
  $('mWait').style.display = 'none';
  $('mResult').style.display = '';

  let kind, title, text;

  if(found && String(found.status).toLowerCase().startsWith('suc')){
    kind = 'ok';
    title = 'Terminal desalocado';
    text = found.mensagem || 'Desalocação concluída com sucesso.';
    $('linkViz').classList.add('severed');
  } else if(found){
    kind = 'err';
    title = 'Não foi possível desalocar';
    text = found.mensagem || 'A API retornou um erro ao processar.';
  } else {
    kind = 'warn';
    title = 'Pedido em processamento';
    text = 'O pedido foi registrado e está na fila da automação. Confira o histórico em instantes para ver o resultado final.';
  }

  Hist.update(entry.ts, { status: kind === 'ok' ? 'ok' : (kind === 'err' ? 'err' : 'pendente'), msg: text });

  $('rIcon').className = 'result-icon ' + kind;
  $('rSvg').innerHTML = kind === 'ok' ? SVG_OK : (kind === 'err' ? SVG_ERR : SVG_WARN);
  $('rTitle').textContent = title;
  $('rText').textContent = text;
  $('rCode').style.display = 'block';
  $('rCode').textContent = `serial: ${entry.serial}\nterminal: ${entry.terminal}`;
}

$('rClose').addEventListener('click', () => {
  $('overlay').classList.remove('open');
  resetFlow();
  $('serial').value = ''; $('terminal').value = '';
  current = null;
});
$('rHistory').addEventListener('click', () => {
  $('overlay').classList.remove('open');
  resetFlow();
  $('serial').value = ''; $('terminal').value = '';
  current = null;
  show('historyView');
});

/* ---------------- render histórico ---------------- */
async function renderHistory(){
  const list = Hist.all();
  $('histCount').textContent = list.length ? `${list.length} registro${list.length > 1 ? 's' : ''}` : '';

  if(!list.length){
    $('histTable').innerHTML = '<div class="empty">Nenhuma solicitação registrada ainda.</div>';
    return;
  }

  // tenta enriquecer os pendentes com o status real do robô
  if(CFG.STATUS_URL){
    for(const item of list){
      if(item.status === 'pendente'){
        const found = await lookup(item.serial, item.terminal);
        if(found){
          const ok = String(found.status).toLowerCase().startsWith('suc');
          Hist.update(item.ts, { status: ok ? 'ok' : 'err', msg: found.mensagem || '' });
          item.status = ok ? 'ok' : 'err';
          item.msg = found.mensagem || item.msg;
        }
      }
    }
  }

  $('histTable').innerHTML =
    `<div class="trow thead">
       <span></span><span>Terminal</span><span>Resultado</span><span>Quando</span>
     </div>` +
    Hist.all().map(x => `
      <div class="trow">
        <span class="dot ${x.status === 'ok' ? 'ok' : (x.status === 'err' ? 'err' : 'warn')}"></span>
        <span class="tcell-mono">${esc(x.serial)} · ${esc(x.terminal)}</span>
        <span class="tcell-msg" title="${esc(x.msg || '')}">${esc(x.msg || '—')}</span>
        <span class="tcell-time">${fmt(x.ts)}</span>
      </div>`).join('');
}

function fmt(ts){
  const d = new Date(ts);
  return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function esc(s){
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

})();
