const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_DIR = process.env.AUTH_DIR || './auth';
const BRAND_NAME = process.env.BRAND_NAME || 'PanelSosial';
const BOT_NAME = process.env.BOT_NAME || `${BRAND_NAME} CS`;
const ADMIN_CONTACT = process.env.ADMIN_CONTACT || '-';

let qrCodeString = null;
let isConnected = false;
let startTime = Date.now();
const recentMessages = new Map();

const SHORT_DISCLAIMER = [
  '⚠️ Penting:',
  `Kami hanya menjual OTP/nomor virtual, bukan akun.`,
  'Jika OTP sudah masuk, maka layanan dianggap selesai.',
  'Banned, suspend, limit, atau kendala akun menjadi tanggung jawab pengguna.'
].join('\n');

function normalizeText(text = '') {
  return text
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(text, keywords = []) {
  return keywords.some((keyword) => text.includes(keyword));
}

function getUptime() {
  const total = Math.floor((Date.now() - startTime) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}j ${minutes}m ${seconds}d`;
}

function greetingMessage() {
  return [
    `Halo, selamat datang di *${BOT_NAME}* 👋`,
    '',
    `${BRAND_NAME} menyediakan layanan nomor virtual / temporary number untuk menerima kode OTP dari berbagai platform pihak ketiga.`,
    '',
    SHORT_DISCLAIMER,
    '',
    'Ketik salah satu menu berikut:',
    '• *menu* - daftar bantuan',
    '• *otp* - info layanan OTP',
    '• *cara beli* - cara order',
    '• *refund* - ketentuan refund',
    '• *komplain* - jika OTP belum masuk',
    '• *banned* - jika akun kena limit/suspend',
    '• *tos* - syarat & ketentuan',
    '• *admin* - info kontak admin'
  ].join('\n');
}

function menuMessage() {
  return [
    `📋 *Menu ${BOT_NAME}*`,
    '',
    '1. *otp* → penjelasan layanan OTP',
    '2. *cara beli* → alur pembelian',
    '3. *cara pakai* → cara menggunakan nomor',
    '4. *refund* → aturan refund',
    '5. *komplain* → jika OTP belum masuk',
    '6. *banned* → jika akun kena banned / suspend',
    '7. *platform* → bisa dipakai di platform apa',
    '8. *nomor* → info nomor fresh / temporary',
    '9. *tos* → syarat & ketentuan layanan',
    '10. *privasi* → kebijakan privasi',
    '11. *admin* → kontak admin',
    '',
    'Contoh pertanyaan yang bisa dikirim:',
    '• "OTP saya belum masuk"',
    '• "Kalau OTP tidak masuk bisa refund?"',
    '• "Kalau akun kena banned gimana?"',
    '• "Ini jual akun atau OTP?"'
  ].join('\n');
}

function otpMessage() {
  return [
    `📩 *Layanan OTP ${BRAND_NAME}*`,
    '',
    `${BRAND_NAME} menyediakan layanan nomor virtual / temporary number untuk menerima SMS OTP dari platform pihak ketiga.`,
    '',
    'Penegasan penting:',
    '• Kami hanya menjual OTP / nomor virtual',
    '• Kami tidak menjual akun',
    '• Kami tidak membuat atau menjamin akun',
    '• OTP masuk = layanan selesai',
    '',
    'Nomor bersifat sementara dan dapat digunakan kembali setelah masa aktif berakhir.'
  ].join('\n');
}

function caraBeliMessage() {
  return [
    '🛒 *Cara Beli / Order OTP*',
    '',
    '1. Pilih layanan / platform yang ingin digunakan.',
    '2. Pastikan saldo mencukupi.',
    '3. Beli nomor sesuai layanan yang dipilih.',
    '4. Tunggu OTP masuk lewat notifikasi atau cek detail riwayat order.',
    '5. Jika OTP masuk, transaksi selesai.',
    '6. Jika OTP tidak masuk sampai masa aktif habis, refund mengikuti sistem.',
    '',
    'Mohon pastikan layanan yang dipilih sudah benar sebelum membeli.'
  ].join('\n');
}

function caraPakaiMessage() {
  return [
    '📲 *Cara Pakai OTP*',
    '',
    '1. Salin nomor yang sudah dibeli.',
    '2. Masukkan nomor ke platform tujuan.',
    '3. Tunggu OTP masuk selama masa aktif nomor berjalan.',
    '4. Cek notifikasi atau detail riwayat order secara berkala.',
    '5. Gunakan OTP yang diterima.',
    '',
    SHORT_DISCLAIMER
  ].join('\n');
}

function refundMessage() {
  return [
    '💰 *Ketentuan Refund*',
    '',
    '• Saldo akan terpotong otomatis saat nomor berhasil dibeli.',
    '• Refund hanya berlaku apabila OTP tidak diterima selama masa aktif nomor.',
    '• Jika OTP tidak masuk sampai masa aktif habis, saldo akan direfund otomatis sesuai sistem saat pengecekan SMS dilakukan.',
    '• Tombol batal akan mengirim pembatalan ke provider dan saldo dikembalikan apabila pembatalan berhasil.',
    '• Jika OTP sudah diterima, tidak ada refund.',
    '• Jika sudah melewati 20 menit sejak pembelian, layanan dianggap selesai dan tidak ada pengembalian saldo.',
    '• Salah beli layanan, salah pilih layanan, atau kesalahan penggunaan tidak termasuk refund.'
  ].join('\n');
}

function komplainMessage() {
  return [
    '🧾 *Jika OTP Belum Masuk*',
    '',
    'Sebelum komplain, mohon lakukan langkah berikut:',
    '1. Cek notifikasi masuk.',
    '2. Cek menu riwayat order.',
    '3. Buka detail transaksi / detail order.',
    '4. Tunggu sampai masa aktif nomor selesai.',
    '',
    'Catatan:',
    '• OTP tidak selalu instan karena bergantung pada sistem dan kebijakan pihak ketiga.',
    '• Jika OTP tidak diterima sampai masa aktif habis, refund mengikuti sistem.',
    '• Jika OTP sudah masuk, transaksi dianggap selesai.'
  ].join('\n');
}

function bannedMessage() {
  return [
    '🚫 *Info Banned / Suspend / Limit Akun*',
    '',
    'Segala bentuk banned, suspend, limit, pemblokiran, pembatasan, atau kehilangan akses akun sepenuhnya menjadi tanggung jawab pengguna.',
    '',
    `Kami hanya menyediakan layanan OTP, bukan akun. ${BRAND_NAME} tidak menjamin akun akan aman, lolos, tahan lama, atau bebas pembatasan dari platform pihak ketiga.`
  ].join('\n');
}

function platformMessage() {
  return [
    '🌐 *Dukungan Platform*',
    '',
    'Kami tidak menjamin seluruh nomor atau layanan akan selalu berhasil menerima OTP pada semua platform.',
    'Keberhasilan bergantung pada sistem, kebijakan, filter, dan pembatasan pihak ketiga.',
    '',
    'Jika OTP tidak diterima sampai masa aktif nomor berakhir, refund mengikuti ketentuan sistem.'
  ].join('\n');
}

function nomorMessage() {
  return [
    '🔢 *Info Nomor*',
    '',
    'Nomor yang disediakan bersifat sementara / temporary.',
    'Nomor dapat digunakan kembali setelah masa aktif berakhir.',
    '',
    'Karena itu, kami tidak dapat menjamin nomor selalu fresh, selalu aman, atau selalu cocok untuk semua platform.'
  ].join('\n');
}

function privasiMessage() {
  return [
    '🔒 *Privasi*',
    '',
    'Kami menjaga privasi pengguna dengan serius dan berupaya melindungi informasi pribadi yang diberikan ke sistem.',
    'Informasi yang diberikan hanya digunakan untuk keperluan operasional layanan.',
    'Kami tidak menjual atau mendistribusikan data pribadi pengguna kepada pihak lain, kecuali apabila diwajibkan oleh hukum yang berlaku.'
  ].join('\n');
}

function adminMessage() {
  return [
    '👨‍💼 *Kontak Admin*',
    '',
    `Silakan hubungi admin: ${ADMIN_CONTACT}`,
    '',
    'Sebelum menghubungi admin untuk komplain OTP, mohon cek terlebih dahulu:',
    '• riwayat order',
    '• detail transaksi',
    '• status OTP selama masa aktif nomor'
  ].join('\n');
}

function tosMessage() {
  return [
    `📜 *Ketentuan Layanan ${BRAND_NAME}*`,
    '',
    '*1. Umum*',
    'Dengan mendaftar dan menggunakan layanan, pengguna dianggap telah membaca, memahami, dan menyetujui seluruh ketentuan yang berlaku. Kami berhak mengubah, menambah, atau menghapus ketentuan sewaktu-waktu tanpa pemberitahuan terlebih dahulu. Kami tidak bertanggung jawab atas kerugian dalam bentuk apa pun yang timbul dari penggunaan layanan.',
    '',
    '*2. Layanan*',
    `${BRAND_NAME} menyediakan layanan nomor virtual / temporary number untuk menerima SMS OTP dari platform pihak ketiga. Kami bukan operator telekomunikasi resmi dan tidak terafiliasi dengan operator seluler mana pun. Kami tidak menjamin semua nomor akan selalu berhasil menerima OTP di semua platform. Nomor bersifat sementara dan dapat digunakan kembali setelah masa aktif berakhir. Harga yang tampil adalah harga final saat pembelian.`,
    '',
    '*3. Pembelian dan Refund*',
    'Saldo dipotong otomatis saat nomor berhasil dibeli. Jika OTP tidak masuk sampai masa aktif berakhir, saldo akan direfund otomatis sesuai sistem saat pengecekan SMS dilakukan. Tombol batal akan mengirim pembatalan ke provider dan saldo akan dikembalikan apabila pembatalan berhasil. Refund hanya berlaku jika OTP tidak diterima selama masa aktif nomor. Setelah OTP diterima atau setelah melewati 20 menit sejak pembelian, layanan dianggap selesai dan tidak ada pengembalian saldo dalam bentuk apa pun.',
    '',
    '*4. Tanggung Jawab Pengguna*',
    'Pengguna wajib memastikan layanan digunakan untuk tujuan yang sah dan tidak melanggar hukum. Pengguna bertanggung jawab penuh atas seluruh aktivitas yang dilakukan menggunakan layanan ini. Jika OTP tidak muncul, pengguna wajib mengecek menu riwayat order dan detail transaksi sebelum mengajukan komplain. Banned, suspend, pemblokiran, pembatasan, atau kehilangan akses akun oleh platform pihak ketiga sepenuhnya menjadi tanggung jawab pengguna.',
    '',
    '*5. Ketentuan Penggunaan OTP*',
    'Layanan ini hanya diperuntukkan bagi penggunaan yang sah dan legal. Dilarang keras menggunakan layanan untuk aktivitas ilegal, termasuk penipuan, spam, pembuatan akun massal tanpa izin, penyalahgunaan identitas, atau aktivitas lain yang merugikan pihak mana pun. Kami tidak bertanggung jawab atas kerugian, kehilangan akun, banned, suspend, pemblokiran nomor, atau tindakan lain dari pihak ketiga akibat penggunaan layanan ini. Setelah OTP diterima atau setelah melewati 20 menit sejak pembelian, seluruh risiko menjadi tanggung jawab pengguna. Kami berhak menolak layanan, membatasi akses, membatalkan transaksi, menangguhkan, atau menonaktifkan akun pengguna tanpa pemberitahuan terlebih dahulu apabila ditemukan indikasi penyalahgunaan layanan.',
    '',
    '*6. Privasi*',
    'Kami menjaga privasi pengguna dengan serius. Informasi yang diberikan pengguna hanya digunakan untuk keperluan operasional layanan dan tidak dijual atau didistribusikan kepada pihak lain, kecuali apabila diwajibkan oleh hukum yang berlaku.',
    '',
    '*Penegasan Utama*',
    'Kami menjual OTP, bukan akun. Jika OTP sudah masuk, maka layanan dianggap selesai.'
  ].join('\n');
}

function statusMessage() {
  return [
    `🤖 *Status ${BOT_NAME}*`,
    '',
    `Status koneksi: ${isConnected ? 'terhubung' : 'belum terhubung'}`,
    `Uptime: ${getUptime()}`,
    `Admin: ${ADMIN_CONTACT}`,
    '',
    'Ketik *menu* untuk melihat semua bantuan.'
  ].join('\n');
}

function defaultMessage() {
  return [
    'Terima kasih, pesan Anda sudah kami terima.',
    '',
    'Untuk mempercepat bantuan, silakan kirim salah satu kata kunci berikut:',
    '• *menu*',
    '• *otp*',
    '• *refund*',
    '• *komplain*',
    '• *banned*',
    '• *tos*',
    '',
    SHORT_DISCLAIMER
  ].join('\n');
}

const intents = [
  {
    name: 'greeting',
    keywords: ['halo', 'hai', 'hi', 'p', 'assalamualaikum', 'permisi', 'selamat pagi', 'selamat siang', 'selamat sore', 'selamat malam'],
    response: greetingMessage
  },
  {
    name: 'menu',
    keywords: ['menu', 'help', 'bantuan', 'list', 'daftar menu'],
    response: menuMessage
  },
  {
    name: 'otp',
    keywords: ['otp', 'jual otp', 'nomor otp', 'temporary number', 'nomor virtual', 'ini jual apa', 'jual akun atau otp', 'akun atau otp'],
    response: otpMessage
  },
  {
    name: 'cara beli',
    keywords: ['cara beli', 'cara order', 'gimana beli', 'bagaimana beli', 'mau beli', 'cara membeli', 'order otp'],
    response: caraBeliMessage
  },
  {
    name: 'cara pakai',
    keywords: ['cara pakai', 'cara gunakan', 'gimana pakai', 'bagaimana pakai', 'cara menggunakan', 'pakai otp'],
    response: caraPakaiMessage
  },
  {
    name: 'refund',
    keywords: ['refund', 'pengembalian', 'saldo balik', 'saldo kembali', 'balikin saldo', 'uang kembali'],
    response: refundMessage
  },
  {
    name: 'komplain',
    keywords: ['otp belum masuk', 'otp ga masuk', 'otp gak masuk', 'belum masuk', 'tidak masuk', 'komplain', 'keluhan', 'kode belum masuk', 'sms belum masuk'],
    response: komplainMessage
  },
  {
    name: 'banned',
    keywords: ['banned', 'suspend', 'akun kena limit', 'akun diblokir', 'akun kena banned', 'akun kena suspend', 'kehilangan akun', 'akun hilang', 'limit akun'],
    response: bannedMessage
  },
  {
    name: 'platform',
    keywords: ['platform', 'aplikasi', 'semua aplikasi', 'semua platform', 'bisa dipakai dimana', 'support platform', 'bisa untuk apa'],
    response: platformMessage
  },
  {
    name: 'nomor',
    keywords: ['nomor', 'fresh', 'nomor fresh', 'nomornya fresh', 'nomor bekas', 'temporary', 'sementara'],
    response: nomorMessage
  },
  {
    name: 'privasi',
    keywords: ['privasi', 'data aman', 'keamanan data', 'data saya aman'],
    response: privasiMessage
  },
  {
    name: 'tos',
    keywords: ['tos', 'syarat', 'ketentuan', 'syarat layanan', 'ketentuan layanan', 'terms', 'aturan'],
    response: tosMessage
  },
  {
    name: 'admin',
    keywords: ['admin', 'cs', 'customer service', 'kontak', 'hubungi admin'],
    response: adminMessage
  },
  {
    name: 'status',
    keywords: ['status bot', 'status', 'cek bot', 'bot aktif'],
    response: statusMessage
  },
  {
    name: 'thanks',
    keywords: ['makasih', 'terima kasih', 'thanks', 'thank you'],
    response: () => 'Sama-sama 🙏 Jika masih ada pertanyaan, silakan ketik *menu*.'
  }
];

function resolveReply(messageText) {
  const normalized = normalizeText(messageText);

  for (const intent of intents) {
    const normalizedKeywords = intent.keywords.map(normalizeText);
    if (includesAny(normalized, normalizedKeywords)) {
      return typeof intent.response === 'function' ? intent.response() : intent.response;
    }
  }

  if (normalized.includes('akun') && normalized.includes('otp')) {
    return otpMessage();
  }

  if ((normalized.includes('otp') || normalized.includes('kode')) && (normalized.includes('masuk') || normalized.includes('belum'))) {
    return komplainMessage();
  }

  return defaultMessage();
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
    console.error('Gagal mengambil versi WA terbaru, lanjut pakai default Baileys:', err?.message || err);
  }

  const sock = makeWASocket({
    auth: state,
    ...(version ? { version } : {})
  });

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
      const m = messages[0];
      if (!m?.message || m.key.fromMe) return;

      let messageText = '';
      if (m.message.conversation) {
        messageText = m.message.conversation;
      } else if (m.message.extendedTextMessage?.text) {
        messageText = m.message.extendedTextMessage.text;
      }

      if (!messageText) return;

      const jid = m.key.remoteJid;
      const normalized = normalizeText(messageText);
      const last = recentMessages.get(jid);
      if (last && last.text === normalized && Date.now() - last.time < 2000) {
        return;
      }
      recentMessages.set(jid, { text: normalized, time: Date.now() });

      console.log(`📩 Pesan dari ${jid}: ${messageText}`);
      const reply = resolveReply(messageText);
      await sock.sendMessage(jid, { text: reply });
      console.log(`✅ Reply terkirim ke ${jid}`);
    } catch (error) {
      console.error('❌ Gagal memproses pesan:', error);
    }
  });
}


const baseStyle = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Arial, sans-serif;
    background: #0f172a;
    color: #e5e7eb;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .container {
    width: 100%;
    max-width: 720px;
    background: #111827;
    border: 1px solid #374151;
    border-radius: 16px;
    padding: 28px;
    box-shadow: 0 10px 30px rgba(0,0,0,.25);
    text-align: center;
  }
  h1 { margin-top: 0; margin-bottom: 8px; }
  p { line-height: 1.6; }
  .muted { color: #9ca3af; font-size: 14px; }
  .badge {
    display: inline-block;
    margin: 8px 0 16px;
    padding: 8px 12px;
    border-radius: 999px;
    background: #1f2937;
    border: 1px solid #374151;
    font-size: 14px;
  }
  .ok { color: #86efac; }
  .warn { color: #fcd34d; }
  .qr {
    background: white;
    padding: 16px;
    border-radius: 12px;
    display: inline-block;
    margin: 12px 0;
  }
  img { max-width: 100%; height: auto; }
  code, pre {
    background: #0b1220;
    border: 1px solid #243041;
    border-radius: 10px;
    padding: 12px;
    display: block;
    white-space: pre-wrap;
    word-break: break-word;
    text-align: left;
  }
  a { color: #93c5fd; text-decoration: none; }
`;

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    connected: isConnected,
    hasQr: !!qrCodeString,
    uptime: getUptime(),
    bot: BOT_NAME
  });
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
          <div class="badge ok">Bot terhubung ke WhatsApp</div>
          <p>Bot aktif dan siap membalas pesan.</p>
          <p class="muted">Uptime: ${getUptime()}</p>
          <p class="muted">Admin: ${ADMIN_CONTACT}</p>
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
          <p>Buka WhatsApp → Perangkat tertaut → Tautkan perangkat, lalu scan QR ini.</p>
          <div class="qr">
            <img src="${qrUrl}" alt="QR Code WhatsApp" />
          </div>
          <p class="muted">Halaman akan refresh otomatis.</p>
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
        <p class="muted">Halaman ini refresh otomatis.</p>
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
