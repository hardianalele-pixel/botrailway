const nodeCrypto = require('crypto');
if (!globalThis.crypto) {
  globalThis.crypto = nodeCrypto.webcrypto;
}
const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_DIR = process.env.AUTH_DIR || './auth';
const BRAND_NAME = process.env.BRAND_NAME || 'PanelSosial';
const BOT_NAME = process.env.BOT_NAME || `${BRAND_NAME} CS`;
const ADMIN_CONTACT = process.env.ADMIN_CONTACT || '-';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let qrCodeString = null;
let isConnected = false;
let startTime = Date.now();

// 🔐 SYSTEM PROMPT (Otak AI)
const SYSTEM_PROMPT = `
Kamu adalah customer service profesional, ramah, dan sopan dari ${BRAND_NAME}.
Nama bot kamu adalah ${BOT_NAME}.

Gaya bicara:
- Gunakan bahasa Indonesia santai tapi sopan.
- Selalu panggil "kak" kepada user.
- Jangan terlalu panjang lebar, singkat dan jelas lebih baik.

WAJIB IKUTI ATURAN KERAS INI:
1. Kita menjual OTP / nomor virtual, BUKAN JUAL AKUN. Jangan pernah bilang kita jual akun.
2. OTP masuk = transaksi dianggap SELESAI.
3. Refund HANYA berlaku jika OTP tidak masuk sampai masa aktif nomor habis (20 menit).
4. Masalah akun seperti Banned, Suspend, Limit, atau Checkpoint setelah OTP masuk adalah TANGGUNG JAWAB USER sepenuhnya. Kita tidak ada garansi akun.
5. Jangan menjamin nomor pasti fresh atau pasti berhasil, karena tergantung sistem platform (WhatsApp/Tele/dll).
6. Jika user bertanya hal teknis yang rumit atau marah-marah, arahkan hubungi Admin: ${ADMIN_CONTACT}.

Informasi Layanan:
- Nomor bersifat temporary (sementara).
- Harga sesuai yang tertera di panel/web.
- Pembatalan nomor (cancel) sebelum OTP masuk akan mengembalikan saldo otomatis.
`;

function getUptime() {
  const total = Math.floor((Date.now() - startTime) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}j ${minutes}m ${seconds}d`;
}

// 🤖 FUNGSI PANGGIL AI
async function askAI(userText) {
  try {
    if (!GEMINI_API_KEY) return "Maaf kak, API Key AI belum dikonfigurasi oleh admin 🙏";

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{
          role: "user",
          parts: [{ text: `${SYSTEM_PROMPT}\n\nPertanyaan User: ${userText}` }]
        }]
      }
    );

    return response.data.candidates?.[0]?.content?.parts?.[0]?.text || "Maaf kak, AI sedang bingung. Coba tanya lagi ya 🙏";
  } catch (error) {
    console.error('Gemini Error:', error.response?.data || error.message);
    return "Maaf kak, otak AI saya sedang gangguan. Silakan hubungi admin atau coba lagi nanti ya 🙏";
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: 'silent' }), // Biar log gak berantakan
    printQRInTerminal: false
  });

  sock.ev.on('connection.update', (update) => {
    const { qr, connection, lastDisconnect } = update;

    if (qr) {
      qrCodeString = qr;
      isConnected = false;
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      isConnected = true;
      qrCodeString = null;
      console.log(`✅ ${BOT_NAME} Terhubung!`);
    }

    if (connection === 'close') {
      isConnected = false;
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) setTimeout(startBot, 5000);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    try {
      const m = messages[0];
      if (!m?.message || m.key.fromMe) return;

      const jid = m.key.remoteJid;
      const messageText = m.message.conversation || m.message.extendedTextMessage?.text;

      if (!messageText) return;

      console.log(`📩 Dari ${jid}: ${messageText}`);

      // Munculkan status "sedang mengetik"
      await sock.sendPresenceUpdate('composing', jid);
      
      // Ambil jawaban dari AI
      const reply = await askAI(messageText);
      
      // Kirim jawaban
      await sock.sendMessage(jid, { text: reply });
      await sock.sendPresenceUpdate('paused', jid);
      
      console.log(`✅ Reply AI Terkirim.`);
    } catch (error) {
      console.error('❌ Gagal memproses pesan:', error);
    }
  });
}

// --- BAGIAN WEB (RAILWAY FRIENDLY) ---

const baseStyle = `
  body { background: #0f172a; color: #e5e7eb; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
  .card { background: #1e293b; padding: 2rem; border-radius: 1rem; box-shadow: 0 10px 25px rgba(0,0,0,0.3); max-width: 400px; width: 90%; }
  .qr-box { background: white; padding: 1rem; border-radius: 0.5rem; display: inline-block; margin: 1rem 0; }
  .status-ok { color: #4ade80; font-weight: bold; }
  .status-wait { color: #facc15; font-weight: bold; }
`;

app.get('/', (req, res) => {
  if (isConnected) {
    res.send(`<style>${baseStyle}</style><div class="card"><h1>${BOT_NAME}</h1><p class="status-ok">✅ BOT TERHUBUNG</p><p>Bot sedang aktif melayani pelanggan.</p><small>Uptime: ${getUptime()}</small></div>`);
  } else if (qrCodeString) {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCodeString)}`;
    res.send(`<style>${baseStyle}</style><div class="card"><h1>Scan QR Code</h1><p class="status-wait">Silakan scan untuk login</p><div class="qr-box"><img src="${qrUrl}" /></div><p>Halaman refresh otomatis setiap 20 detik.</p><script>setTimeout(()=>location.reload(), 20000)</script></div>`);
  } else {
    res.send(`<style>${baseStyle}</style><div class="card"><h1>Memulai...</h1><p>Sedang menyiapkan sesi, tunggu sebentar.</p><script>setTimeout(()=>location.reload(), 5000)</script></div>`);
  }
});

startBot().catch(console.error);
app.listen(PORT, '0.0.0.0', () => console.log(`Server jalan di port ${PORT}`));
