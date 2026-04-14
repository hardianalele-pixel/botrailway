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

const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

const AUTH_DIR = process.env.AUTH_DIR || './auth';
const BOT_NAME = process.env.BOT_NAME || 'PanelSosial CS';
const ADMIN_CONTACT = process.env.ADMIN_CONTACT || '-';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let isConnected = false;

// 🔐 SYSTEM PROMPT (INI OTAK BOT)
const SYSTEM_PROMPT = `
Kamu adalah customer service profesional, ramah, dan sopan dari PanelSosial.

Gaya bicara:
- Gunakan bahasa Indonesia santai tapi sopan
- Gunakan kata "kak"
- Ramah, membantu, tidak kaku
- Jangan terlalu panjang

WAJIB IKUTI RULE INI:
- Kita menjual OTP / nomor virtual, bukan akun
- Jangan pernah bilang kita jual akun
- OTP masuk = transaksi selesai
- Refund hanya jika OTP tidak masuk sampai masa aktif habis
- Banned/suspend/limit akun adalah tanggung jawab user
- Jangan janji OTP pasti masuk
- Jangan janji akun aman

Jika user marah:
- tetap tenang
- jangan defensif
- bantu arahkan solusi

Jika tidak yakin:
- arahkan ke admin: ${ADMIN_CONTACT}

Gunakan informasi berikut sebagai dasar:

${`Ketentuan Layanan:
- PanelSosial hanya menyediakan nomor virtual untuk OTP
- Tidak menjamin semua OTP berhasil
- Nomor bersifat sementara
- Refund hanya jika OTP tidak masuk
- Setelah OTP masuk atau 20 menit → selesai
- Semua risiko akun ditanggung user
- Dilarang penggunaan ilegal
- Kami menjaga privasi user
`}

Selalu tekankan:
"Kami menyediakan OTP, bukan akun"
`;

// 🤖 CALL GEMINI
async function askAI(text) {
  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [
          {
            parts: [
              { text: SYSTEM_PROMPT },
              { text: text }
            ]
          }
        ]
      }
    );

    return res.data.candidates?.[0]?.content?.parts?.[0]?.text || 'Maaf kak, sistem sedang sibuk. Coba lagi ya 🙏';
  } catch (err) {
    console.error(err.message);
    return 'Maaf kak, sistem sedang error. Silakan hubungi admin 🙏';
  }
}

// 🚀 START BOT
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version
  });

  sock.ev.on('connection.update', ({ connection }) => {
    if (connection === 'open') {
      isConnected = true;
      console.log('✅ Bot connected');
    }

    if (connection === 'close') {
      isConnected = false;
      setTimeout(startBot, 5000);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    try {
      const m = messages[0];
      if (!m.message || m.key.fromMe) return;

      const jid = m.key.remoteJid;

      const text =
        m.message.conversation ||
        m.message.extendedTextMessage?.text;

      if (!text) return;

      console.log('📩', text);

      const reply = await askAI(text);

      await sock.sendMessage(jid, { text: reply });

    } catch (err) {
      console.error(err);
    }
  });
}

// 🌐 WEB
app.get('/', (req, res) => {
  res.send('Bot aktif');
});

startBot();

app.listen(PORT, () => {
  console.log('Server running', PORT);
});
