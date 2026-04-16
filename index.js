const nodeCrypto = require('crypto');
if (!globalThis.crypto) {
  globalThis.crypto = nodeCrypto.webcrypto;
}

const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const qrcode = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');

const app = express();

const PORT = process.env.PORT || 3000;
const AUTH_DIR = process.env.AUTH_DIR || './auth';
const BRAND_NAME = process.env.BRAND_NAME || 'PanelSosial';
const BOT_NAME = process.env.BOT_NAME || `${BRAND_NAME} CS`;
const ADMIN_CONTACT = process.env.ADMIN_CONTACT || '-';

const AI_ENDPOINT = process.env.AI_ENDPOINT || 'https://ai.hardianalele.workers.dev/chat';
const AI_TOKEN = process.env.AI_TOKEN || '123123';

let qrCodeString = null;
let isConnected = false;
let startTime = Date.now();
let activeSocket = null;

const recentMessages = new Map();
const conversationMemory = new Map();

const MAX_HISTORY = 8;
const DUPLICATE_WINDOW_MS = 2000;
const MEMORY_TTL_MS = 1000 * 60 * 30;

const STATIC_RESPONSES = {
  menu: [
    `📋 *Menu Bantuan ${BOT_NAME}*`,
    '',
    'Silakan pilih topik yang ingin ditanyakan:',
    '• *otp* → info layanan OTP',
    '• *cara beli* → cara order',
    '• *refund* → aturan refund',
    '• *komplain* → OTP belum masuk',
    '• *banned* → akun kena suspend / limit',
    '• *admin* → hubungi CS',
    '• *tos* → syarat & ketentuan',
    '',
    'Atau tinggal tulis pertanyaan kakak seperti biasa ya 😊'
  ].join('\n'),
  admin: [
    '👨‍💼 *Kontak Admin*',
    '',
    `Silakan hubungi admin di: ${ADMIN_CONTACT}`,
    '',
    'Agar dibantu lebih cepat, mohon sertakan:',
    '• layanan yang dibeli',
    '• waktu order',
    '• status di riwayat order',
    '• kendala yang dialami'
  ].join('\n'),
  status: () => [
    `🤖 *Status ${BOT_NAME}*`,
    '',
    `• Koneksi WhatsApp: ${isConnected ? 'terhubung' : 'belum terhubung'}`,
    `• Uptime: ${getUptime()}`,
    `• Admin: ${ADMIN_CONTACT}`,
    '',
    'Bot aktif dan siap membantu pelanggan.'
  ].join('\n'),
  tos: () => buildTosText()
};

function buildTosText() {
  return [
    `📜 *Ketentuan Layanan ${BRAND_NAME}*`,
    '',
    '*1. Umum*',
    'Dengan menggunakan layanan ini, pengguna dianggap telah membaca, memahami, dan menyetujui seluruh ketentuan yang berlaku.',
    '',
    '*2. Layanan*',
    `${BRAND_NAME} menyediakan layanan nomor virtual / temporary number untuk menerima SMS OTP dari platform pihak ketiga. Kami bukan penyedia layanan telekomunikasi resmi dan tidak terafiliasi dengan operator seluler manapun.`,
    '',
    '*3. Pembelian dan Refund*',
    'Saldo dipotong saat nomor berhasil dibeli. Refund hanya berlaku jika OTP tidak diterima sampai masa aktif nomor berakhir. Jika OTP sudah diterima atau sudah melewati 20 menit sejak pembelian, layanan dianggap selesai.',
    '',
    '*4. Tanggung Jawab Pengguna*',
    'Segala bentuk banned, suspend, pemblokiran, pembatasan, kehilangan akses akun, atau kendala dari platform pihak ketiga menjadi tanggung jawab pengguna.',
    '',
    '*5. Penegasan Utama*',
    'Kami menyediakan jasa OTP / nomor virtual, *bukan jual akun*.',
    '',
    '*6. Privasi*',
    'Data pengguna hanya digunakan untuk keperluan operasional layanan dan tidak dijual kepada pihak lain, kecuali bila diwajibkan oleh hukum.'
  ].join('\n');
}

function normalizeText(text = '') {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getUptime() {
  const total = Math.floor((Date.now() - startTime) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}j ${minutes}m ${seconds}d`;
}

function pruneMemory() {
  const now = Date.now();
  for (const [jid, memory] of conversationMemory.entries()) {
    if (!memory?.updatedAt || now - memory.updatedAt > MEMORY_TTL_MS) {
      conversationMemory.delete(jid);
    }
  }
}

function getConversation(jid) {
  pruneMemory();
  if (!conversationMemory.has(jid)) {
    conversationMemory.set(jid, {
      messages: [],
      updatedAt: Date.now()
    });
  }
  return conversationMemory.get(jid);
}

function pushConversation(jid, role, text) {
  const memory = getConversation(jid);
  memory.messages.push({ role, text });
  if (memory.messages.length > MAX_HISTORY) {
    memory.messages.splice(0, memory.messages.length - MAX_HISTORY);
  }
  memory.updatedAt = Date.now();
}

function detectQuickReply(text) {
  const normalized = normalizeText(text);

  if (['menu', 'help', 'bantuan'].includes(normalized)) return STATIC_RESPONSES.menu;
  if (['admin', 'cs', 'kontak admin'].includes(normalized)) return STATIC_RESPONSES.admin;
  if (['status', 'status bot', 'cek bot'].includes(normalized)) {
    return typeof STATIC_RESPONSES.status === 'function'
      ? STATIC_RESPONSES.status()
      : STATIC_RESPONSES.status;
  }
  if (['tos', 'syarat', 'ketentuan', 'terms'].includes(normalized)) {
    return typeof STATIC_RESPONSES.tos === 'function'
      ? STATIC_RESPONSES.tos()
      : STATIC_RESPONSES.tos;
  }

  return null;
}

function extractIncomingText(message = {}) {
  const m = message.message || {};
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.videoMessage?.caption) return m.videoMessage.caption;
  if (m.buttonsResponseMessage?.selectedDisplayText) return m.buttonsResponseMessage.selectedDisplayText;
  if (m.templateButtonReplyMessage?.selectedDisplayText) return m.templateButtonReplyMessage.selectedDisplayText;
  if (m.listResponseMessage?.title) return m.listResponseMessage.title;
  return '';
}

function buildAiHistory(jid) {
  const memory = getConversation(jid);
  return memory.messages.map((item) => ({
    role: item.role,
    content: item.text
  }));
}

async function askAI(jid, userText) {
  if (!AI_ENDPOINT || !AI_TOKEN) {
    return `Maaf kak, fitur AI belum aktif. Silakan hubungi admin di ${ADMIN_CONTACT} ya 🙏`;
  }

  try {
    const history = buildAiHistory(jid);

    const response = await axios.post(
      AI_ENDPOINT,
      {
        message: userText,
        history
      },
      {
        timeout: 30000,
        headers: {
          Authorization: `Bearer ${AI_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const reply = String(response.data?.reply || '').trim();

    if (!reply) {
      return `Maaf kak, saya belum bisa jawab itu sekarang. Silakan hubungi admin di ${ADMIN_CONTACT} ya 🙏`;
    }

    return reply;
  } catch (error) {
    const detail = error.response?.data || error.message;
    console.error('AI endpoint error:', detail);
    return `Maaf kak, sistem sedang gangguan. Silakan coba lagi sebentar atau hubungi admin di ${ADMIN_CONTACT} ya 🙏`;
  }
}

async function sendMainMenu(sock, jid) {
  const text = [
    `Halo kak 👋 Selamat datang di *${BOT_NAME}*`,
    '',
    `Kami siap bantu seputar jasa OTP / nomor virtual dari *${BRAND_NAME}*.`,
    '',
    'Silakan pilih menu di bawah atau langsung ketik pertanyaannya ya 😊'
  ].join('\n');

  try {
    await sock.sendMessage(jid, {
      text,
      footer: `${BRAND_NAME} • jasa OTP, bukan jual akun`,
      buttons: [
        { buttonId: 'menu', buttonText: { displayText: 'Menu' }, type: 1 },
        { buttonId: 'refund', buttonText: { displayText: 'Refund' }, type: 1 },
        { buttonId: 'admin', buttonText: { displayText: 'Admin' }, type: 1 }
      ],
      headerType: 1
    });
  } catch (error) {
    console.warn('Gagal kirim tombol, fallback ke menu teks:', error?.message || error);
    await sock.sendMessage(jid, { text: STATIC_RESPONSES.menu });
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  let version;
  let isLatest = false;

  try {
    const latest = await fetchLatestBaileysVersion();
    version = latest.version;
    isLatest = latest.isLatest;
    console.log('Baileys WA version:', version.join('.'), 'isLatest:', isLatest);
  } catch (err) {
    console.error('Gagal mengambil versi WA terbaru, lanjut pakai default:', err?.message || err);
  }

  const sock = makeWASocket({
    auth: state,
    ...(version ? { version } : {})
  });

  activeSocket = sock;

  sock.ev.on('connection.update', (update) => {
    const { qr, connection, lastDisconnect } = update;

    console.log('connection.update:', {
      connection,
      hasQr: !!qr,
      statusCode: lastDisconnect?.error?.output?.statusCode,
      error: lastDisconnect?.error?.message
    });

    if (qr) {
      qrCodeString = qr;
      isConnected = false;
      console.log('\n═══════════════════════════════════════════');
      console.log(`📱 QR Code ${BOT_NAME}`);
      console.log('═══════════════════════════════════════════\n');
      qrcode.generate(qr, { small: true });
      console.log('\nScan QR dari WhatsApp > Perangkat tertaut > Tautkan perangkat\n');
    }

    if (connection === 'open') {
      isConnected = true;
      qrCodeString = null;
      console.log(`✅ ${BOT_NAME} terhubung dan siap digunakan.`);
    }

    if (connection === 'close') {
      isConnected = false;
      qrCodeString = null;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`⚠️ Koneksi terputus. Reconnect: ${shouldReconnect ? 'ya' : 'tidak'}`);
      if (shouldReconnect) {
        setTimeout(startBot, 5000);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    try {
      const m = messages?.[0];
      if (!m?.message || m.key.fromMe) return;

      const jid = m.key.remoteJid;
      const messageText = extractIncomingText(m);
      if (!messageText) return;

      const normalized = normalizeText(messageText);
      const last = recentMessages.get(jid);
      if (last && last.text === normalized && Date.now() - last.time < DUPLICATE_WINDOW_MS) {
        return;
      }
      recentMessages.set(jid, { text: normalized, time: Date.now() });

      console.log(`📩 Pesan dari ${jid}: ${messageText}`);

      const quickReply = detectQuickReply(messageText);
      if (quickReply) {
        await sock.sendMessage(jid, { text: quickReply });
        if (normalized in { menu: 1, help: 1, bantuan: 1 }) {
          await sendMainMenu(sock, jid);
        }
        console.log(`✅ Quick reply terkirim ke ${jid}`);
        return;
      }

      if (['halo', 'hai', 'hi', 'p', 'permisi', 'assalamualaikum'].includes(normalized)) {
        await sendMainMenu(sock, jid);
        console.log(`✅ Greeting menu terkirim ke ${jid}`);
        return;
      }

      pushConversation(jid, 'user', messageText);
      const reply = await askAI(jid, messageText);
      pushConversation(jid, 'assistant', reply);

      await sock.sendMessage(jid, { text: reply });
      console.log(`✅ Reply AI terkirim ke ${jid}`);
    } catch (error) {
      console.error('❌ Gagal memproses pesan:', error);
      try {
        const jid = messages?.[0]?.key?.remoteJid;
        if (jid) {
          await activeSocket.sendMessage(jid, {
            text: `Maaf kak, sistem sedang gangguan. Silakan coba lagi atau hubungi admin di ${ADMIN_CONTACT} ya 🙏`
          });
        }
      } catch (_) {}
    }
  });
}

const baseStyle = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Inter, Arial, sans-serif;
    background: radial-gradient(circle at top, #0f172a 0%, #020617 100%);
    color: #e5e7eb;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .container {
    width: 100%;
    max-width: 780px;
    background: rgba(17, 24, 39, 0.95);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 24px;
    padding: 32px;
    box-shadow: 0 20px 60px rgba(0,0,0,.35);
    text-align: center;
    backdrop-filter: blur(14px);
  }
  h1 { margin-top: 0; margin-bottom: 8px; font-size: 30px; }
  p { line-height: 1.7; }
  .muted { color: #94a3b8; font-size: 14px; }
  .badge {
    display: inline-block;
    margin: 10px 0 18px;
    padding: 10px 14px;
    border-radius: 999px;
    background: rgba(30, 41, 59, 0.9);
    border: 1px solid rgba(148, 163, 184, 0.2);
    font-size: 14px;
  }
  .ok { color: #86efac; }
  .warn { color: #fcd34d; }
  .qr {
    background: white;
    padding: 16px;
    border-radius: 18px;
    display: inline-block;
    margin: 14px 0;
  }
  img { max-width: 100%; height: auto; border-radius: 10px; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    text-align: left;
    margin-top: 22px;
  }
  .card {
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid rgba(148, 163, 184, 0.12);
    border-radius: 16px;
    padding: 14px;
  }
`;

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    connected: isConnected,
    hasQr: !!qrCodeString,
    uptime: getUptime(),
    bot: BOT_NAME,
    aiEnabled: !!AI_ENDPOINT && !!AI_TOKEN,
    aiEndpoint: AI_ENDPOINT
  });
});

app.get('/check', async (req,res)=>{
  try{
    const number = req.query.number;

    if(!number){
      return res.json({
        status:false,
        error:'number wajib'
      });
    }

    if(!activeSocket || !isConnected){
      return res.json({
        status:false,
        error:'WhatsApp belum terhubung'
      });
    }

    const jid = number.replace(/\D/g,'') + '@s.whatsapp.net';

    const result = await activeSocket.onWhatsApp(jid);

    if(!result || result.length === 0){
      return res.json({
        status:true,
        number,
        exists:false
      });
    }

    res.json({
      status:true,
      number,
      exists: result[0].exists || false
    });

  }catch(e){
    res.json({
      status:false,
      error:e.message
    });
  }
});

app.get('/', (req, res) => {
  if (isConnected) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${BOT_NAME}</title>
        <style>${baseStyle}</style>
      </head>
      <body>
        <div class="container">
          <h1>${BOT_NAME}</h1>
          <div class="badge ok">Bot terhubung ke WhatsApp ✅</div>
          <p>Bot aktif dan siap membalas pesan pelanggan dengan bantuan AI.</p>
          <div class="grid">
            <div class="card"><strong>Status</strong><br/>Online & siap menerima chat</div>
            <div class="card"><strong>Uptime</strong><br/>${getUptime()}</div>
            <div class="card"><strong>AI Endpoint</strong><br/>${AI_ENDPOINT}</div>
            <div class="card"><strong>Admin</strong><br/>${ADMIN_CONTACT}</div>
          </div>
          <p class="muted" style="margin-top:18px;">Catatan: ${BRAND_NAME} menyediakan jasa OTP / nomor virtual, bukan jual akun.</p>
        </div>
      </body>
      </html>
    `);
  }

  if (qrCodeString) {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrCodeString)}`;
    return res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${BOT_NAME}</title>
        <style>${baseStyle}</style>
        <meta http-equiv="refresh" content="15" />
      </head>
      <body>
        <div class="container">
          <h1>${BOT_NAME}</h1>
          <div class="badge warn">Scan QR WhatsApp</div>
          <p>Buka WhatsApp → <strong>Perangkat tertaut</strong> → <strong>Tautkan perangkat</strong>, lalu scan QR ini.</p>
          <div class="qr">
            <img src="${qrUrl}" alt="QR Code WhatsApp" />
          </div>
          <p class="muted">Halaman akan refresh otomatis. Jika QR berubah, silakan scan QR terbaru.</p>
        </div>
      </body>
      </html>
    `);
  }

  return res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${BOT_NAME}</title>
      <style>${baseStyle}</style>
      <meta http-equiv="refresh" content="3" />
    </head>
    <body>
      <div class="container">
        <h1>${BOT_NAME}</h1>
        <div class="badge">Menyiapkan sesi WhatsApp</div>
        <p>Bot sedang menyiapkan sesi. Tunggu beberapa detik sampai QR muncul.</p>
        <p class="muted">AI mode aktif. Kami menyediakan jasa OTP / nomor virtual, bukan jual akun.</p>
      </div>
    </body>
    </html>
  `);
});

startBot().catch((err) => {
  console.error('❌ Gagal menjalankan bot:', err);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
