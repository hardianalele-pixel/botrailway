const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
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
  const { state, saveCreds } = await useMultiFileAuthState('./auth');

  const sock = makeWASocket({ auth: state });

  sock.ev.on('connection.update', ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      qrCodeString = qr;
      console.log('\n═══════════════════════════════════════════');
      console.log(`📱 QR Code ${BOT_NAME}`);
      console.log('═══════════════════════════════════════════\n');
      qrcode.generate(qr, { small: true });
      console.log('\nScan QR dari WhatsApp > Perangkat tertaut > Tautkan perangkat\n');
    }

    if (connection === 'open') {
      isConnected = true;
      console.log(`✅ ${BOT_NAME} terhubung dan siap digunakan.`);
    }

    if (connection === 'close') {
      isConnected = false;
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

startBot().catch((err) => {
  console.error('❌ Bot gagal dijalankan:', err);
});

app.get('/', (req, res) => {
  const baseStyle = `
    body {
      font-family: Arial, sans-serif;
      text-align: center;
      padding: 20px;
      margin: 0;
      background: linear-gradient(135deg, #075e54, #128c7e);
      color: white;
    }
    .container {
      background: white;
      color: #222;
      padding: 28px;
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      max-width: 760px;
      margin: 40px auto;
    }
    h1 { color: #128c7e; }
    .badge {
      display: inline-block;
      padding: 10px 16px;
      border-radius: 999px;
      background: #25d366;
      color: white;
      font-weight: bold;
      margin-bottom: 12px;
    }
    .card {
      text-align: left;
      background: #f6f8f8;
      border-radius: 12px;
      padding: 16px;
      margin-top: 16px;
      line-height: 1.6;
    }
    .muted { color: #666; }
    code {
      background: #eef4f3;
      padding: 2px 6px;
      border-radius: 6px;
    }
  `;

  if (isConnected) {
    res.send(`
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
          <div class="badge">✅ BOT TERHUBUNG</div>
          <h1>${BOT_NAME}</h1>
          <p>Bot WhatsApp aktif dan siap membalas chat customer.</p>
          <div class="card">
            <strong>Fitur utama:</strong><br />
            • Greeting otomatis<br />
            • FAQ OTP, refund, banned, komplain, TOS, privasi<br />
            • Penegasan layanan: jual OTP, bukan akun<br />
            • Cocok untuk customer service layanan OTP
          </div>
          <div class="card">
            <strong>Kata kunci yang tersedia:</strong><br />
            <code>menu</code> <code>otp</code> <code>cara beli</code> <code>cara pakai</code> <code>refund</code> <code>komplain</code> <code>banned</code> <code>platform</code> <code>nomor</code> <code>tos</code> <code>privasi</code> <code>admin</code>
          </div>
          <p class="muted">Admin: ${ADMIN_CONTACT}</p>
        </div>
      </body>
      </html>
    `);
    return;
  }

  if (qrCodeString) {
    res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Scan QR - ${BOT_NAME}</title>
        <style>${baseStyle}</style>
      </head>
      <body>
        <div class="container">
          <h1>Scan QR WhatsApp</h1>
          <p>Gunakan WhatsApp di ponsel Anda untuk menautkan bot.</p>
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrCodeString)}" alt="QR Code" style="border: 6px solid #25d366; border-radius: 16px; max-width: 100%;" />
          <div class="card">
            <strong>Langkah scan:</strong><br />
            1. Buka WhatsApp di ponsel<br />
            2. Buka menu titik tiga<br />
            3. Pilih <em>Perangkat tertaut</em><br />
            4. Pilih <em>Tautkan perangkat</em><br />
            5. Scan QR di halaman ini
          </div>
        </div>
      </body>
      </html>
    `);
    return;
  }

  res.send(`
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
        <p>Bot sedang menyiapkan sesi WhatsApp. Tunggu beberapa detik sampai QR muncul.</p>
      </div>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🌐 Web server aktif di port ${PORT}`);
});

setInterval(() => {
  console.log(`💓 ${BOT_NAME} masih berjalan...`);
}, 300000);
