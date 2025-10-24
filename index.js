if (typeof fetch === 'undefined') {
  global.fetch = require('node-fetch');
}

const fs = require('fs');
const path = require('path');
const venom = require('venom-bot');
const express = require('express');

const app = express();
app.use(express.json());

let client;

const QR_DIR = process.env.QR_DIR || path.resolve(__dirname, 'qr');
if (!fs.existsSync(QR_DIR)) fs.mkdirSync(QR_DIR, { recursive: true });

venom.create(
  {
    session: 'session-vendas',
    folderNameToken: 'tokens',
    multidevice: true,
    // ↓↓↓ TROQUE estas duas linhas
    headless: false,               // abre janela visível
    executablePath: undefined,     // deixe o Puppeteer usar o Chromium dele
    // ↑↑↑
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
  }
)
.then((c) => {
  client = c;

  client.onStateChange((state) => console.log('Estado WhatsApp:', state));
  client.onStreamChange((s) => console.log('Stream:', s));

  client.onMessage(async (message) => {
    console.log('Mensagem recebida:', message.type, message.from, message.body?.slice?.(0,200));
    // encaminha para n8n como antes
    try {
      await fetch('https://primary-production-6341.up.railway.app/webhook-test/c3411b73-2b0a-4395-9d9b-1be75f4ed35f', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });
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

  app.listen(3000, () => console.log('Venom Bot API rodando na porta 3000'));
})
.catch((e) => console.error('Falha ao iniciar Venom:', e));
