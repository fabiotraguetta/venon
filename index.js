// // no topo do seu index.js
// const cors = require('cors');
// app.use(cors({ origin: ['http://localhost:4200'], credentials: false }));

require('dotenv').config();

if (typeof fetch === 'undefined') {
  global.fetch = require('node-fetch');
}

console.log('[BOOT] Iniciando aplicação...');

process.on('unhandledRejection', (err) => {
  console.error('[UNHANDLED REJECTION]', err);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});

const fs = require('fs');
const path = require('path');
const venom = require('venom-bot');
const express = require('express');

const app = express();
app.use((req, _res, next) => {
  console.log(`[HTTP] ${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// --- [NOVO] store de sessões em memória ---
const sessions = new Map();
function upsertSession(name, patch) {
  const prev = sessions.get(name) || { name, status: 'starting', stream: '-', connected: false, phone: '-', pushname: '-', battery: null };
  const next = { ...prev, ...patch };
  sessions.set(name, next);
  return next;
}
// ------------------------------------------

let client;

const QR_DIR = process.env.QR_DIR || path.resolve(__dirname, 'qr');
if (!fs.existsSync(QR_DIR)) fs.mkdirSync(QR_DIR, { recursive: true });

// nome da sessão (se quiser várias, transforme isso num array e chame create por nome)
const SESSION_NAME = 'session-vendas';

console.log('[VENOM] Chamando venom.create...');
venom.create(
  {
    session: SESSION_NAME,
    folderNameToken: 'tokens',
    multidevice: true,
    headless: false,         // volta pro headless moderno
    useChrome: true,         // força usar Chrome instalado
    executablePath: undefined,
    logQR: true,
    disableSpins: true,
    autoClose: 0,
    browserArgs: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-gpu',
      '--window-size=1280,800',
      '--remote-allow-origins=*',
      '--disable-features=Translate,AutomationControlled',
    ],
    debug: false,
  },
  (base64Qrimg, asciiQR) => {
    console.log('QR ASCII:\n', asciiQR);
    const svg = base64Qrimg.replace('data:image/svg+xml;base64,', '');
    fs.writeFileSync(path.join(QR_DIR, 'qr.svg'), Buffer.from(svg, 'base64'));
    console.log('QR salvo em', path.join(QR_DIR, 'qr.svg'));
  },
  (statusSession, sessionName) => {
    console.log('Status da sessão:', statusSession, sessionName);
    upsertSession(sessionName, { status: statusSession });
  }
)
.then(async (c) => {
   console.log('[VENOM] Cliente criado, configurando handlers...');
   console.log(process.env.N8N_WEBHOOK_URL);
  client = c;

  client.onAnyMessage((msg) => {
  console.log('[ANY]', msg.type, msg.from, (msg.body || '').slice(0, 80));
});

  // --- [NOVO] atualiza infos da sessão periodicamente ---
  const refreshInfo = async () => {
    try {
      const connected = await client.isConnected(); // true/false
      let phone = '-', pushname = '-', battery = null;

      // getHostDevice traz infos do próprio aparelho logado
      try {
        const host = await client.getHostDevice();
        // host?.wid?._serialized por ex. "5511999999999@c.us"
        if (host?.wid?._serialized) phone = host.wid._serialized.replace('@c.us','');
        if (host?.pushname) pushname = host.pushname;
        if (typeof host?.battery === 'number') battery = host.battery;
      } catch (_) {}

      upsertSession(SESSION_NAME, { connected, phone, pushname, battery });
    } catch (e) {
      upsertSession(SESSION_NAME, { connected: false });
    }
  };
  await refreshInfo();
  setInterval(refreshInfo, 3000);

  try {
  const chats = await client.getAllChats();
  console.log('[VENOM] Quantidade de chats:', chats.length);
} catch (e) {
  console.error('[VENOM] Erro ao ler chats:', e);
}
  // ------------------------------------------------------

  client.onStateChange((state) => {
    console.log('Estado WhatsApp:', state);
    upsertSession(SESSION_NAME, { status: state });
  });

  client.onStreamChange((s) => {
    console.log('Stream:', s);
    upsertSession(SESSION_NAME, { stream: s });
  });

  

 client.onMessage(async (message) => {
  console.log('Mensagem recebida:', message.type, message.from, message.body?.slice?.(0,200));
  try {
    const res = await fetch(process.env.N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.N8N_WEBHOOK_TOKEN ? {'x-webhook-token': process.env.N8N_WEBHOOK_TOKEN} : {}) },
      body: JSON.stringify({
        event: 'message',
        session: 'session-vendas',
        timestamp: Date.now(),
        // envie só o essencial (evita payloads grandes)
        message: {
          id: message.id,
          from: message.from,
          to: message.to,
          body: message.body,
          type: message.type,
          isGroupMsg: message.isGroupMsg
        }
      }),
    });

    const text = await res.text().catch(() => '');
    console.log('[n8n] status:', res.status, 'body:', text?.slice(0, 400));

    if (!res.ok) {
      console.error('[n8n] HTTP não-OK. Verifique URL (test/prod), auth e se o workflow está ativo.');
    }
  } catch (err) {
    console.error('Falha ao enviar para n8n:', err);
  }
});


  app.post('/send', async (req, res) => {
    const { to, text } = req.body;
    try {
      await client.sendText(to, text);
      res.json({ success: true });
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.get('/health', (_req, res) => res.send('ok'));

  // --- [NOVO] API para o dashboard ---
  app.get('/sessions.json', (_req, res) => {
    res.json(Array.from(sessions.values()));
  });


  app.get('/api/sessions', (_req, res) => {
  res.json(Array.from(sessions.values()));
});

// testa conexão com o n8n (manda payload fictício)
app.post('/debug/ping-n8n', async (_req, res) => {
  try {
    const headerName = process.env.N8N_WEBHOOK_HEADER || 'x-webhook-token';
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.N8N_WEBHOOK_TOKEN) headers[headerName] = process.env.N8N_WEBHOOK_TOKEN;

    const r = await fetch(process.env.N8N_WEBHOOK_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ event: 'ping', at: new Date().toISOString() }),
    });
    const text = await r.text().catch(() => '');
    console.log('[n8n/ping] status:', r.status, 'body:', text.slice(0, 400));
    res.json({ ok: r.ok, status: r.status, body: text });
  } catch (e) {
    console.error('[n8n/ping] erro:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// eco local para comparar (100% deve retornar 200)
app.post('/debug/echo', express.json(), (req, res) => {
  console.log('[echo] payload recebido:', req.body);
  res.json({ received: req.body });
});

  // --- [NOVO] Página simples com auto-refresh ---
  app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Status das Sessões WhatsApp</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 24px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; }
  th { background: #f3f4f6; }
  .pill { padding: 2px 8px; border-radius: 999px; display: inline-block; font-size: 12px; }
  .ok { background: #dcfce7; color: #166534; }
  .bad { background: #fee2e2; color: #991b1b; }
  .warn { background: #fef9c3; color: #854d0e; }
  caption { text-align:left; margin-bottom:8px; font-weight:600; }
</style>
</head>
<body>
  <h1>Status das Sessões WhatsApp</h1>
  <table id="tbl"><caption>atualiza a cada 3s</caption>
    <thead>
      <tr>
        <th>Nome</th>
        <th>Telefone</th>
        <th>Nome WhatsApp</th>
        <th>Bateria</th>
        <th>Conectado</th>
        <th>Status</th>
        <th>Stream</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>
<script>
async function load() {
  try {
    const res = await fetch('/sessions.json');
    const data = await res.json();
    const tbody = document.querySelector('#tbl tbody');
    tbody.innerHTML = '';
    for (const s of data) {
      const tr = document.createElement('tr');
      const pill = (ok, txt) => '<span class="pill ' + (ok ? 'ok' : 'bad') + '">' + txt + '</span>';
      tr.innerHTML = \`
        <td>\${s.name || '-'}</td>
        <td>\${s.phone || '-'}</td>
        <td>\${s.pushname || '-'}</td>
        <td>\${typeof s.battery === 'number' ? s.battery + '%' : '-'}</td>
        <td>\${pill(!!s.connected, s.connected ? 'ONLINE' : 'OFFLINE')}</td>
        <td><span class="pill warn">\${s.status || '-'}</span></td>
        <td>\${s.stream || '-'}</td>
      \`;
      tbody.appendChild(tr);
    }
  } catch (e) {
    console.error(e);
  }
}
load();
setInterval(load, 3000);
</script>
</body>
</html>`);
  });
  // ------------------------------------

  const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  console.log(`[LISTEN] Servidor on: http://localhost:${PORT}/`);
});

server.on('error', (err) => {
  console.error('[LISTEN ERROR]', err);
});
})
.catch((e) => console.error('Falha ao iniciar Venom:', e));
