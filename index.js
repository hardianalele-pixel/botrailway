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
  '⚠️ *Penting:*',
  '• Kami hanya menyediakan *OTP / nomor virtual*, bukan akun.',
  '• OTP berhasil diterima = transaksi dianggap selesai.',
  '• Banned, suspend, limit, review, verifikasi tambahan, atau kendala akun menjadi tanggung jawab pengguna.',
  '• Refund hanya berlaku jika OTP *tidak diterima sampai masa aktif nomor berakhir* sesuai ketentuan sistem.'
].join('\n');

const KEYWORD_ALIASES = {
  greeting: ['halo', 'hai', 'hi', 'p', 'permisi', 'assalamualaikum', 'selamat pagi', 'selamat siang', 'selamat sore', 'selamat malam'],
  menu: ['menu', 'help', 'bantuan', 'daftar menu', 'list menu', 'menu utama'],
  otp: ['otp', 'nomor otp', 'nomor virtual', 'temporary number', 'temp number', 'jual otp', 'jual akun atau otp', 'akun atau otp', 'ini jual apa'],
  cara_beli: ['cara beli', 'cara order', 'gimana beli', 'bagaimana beli', 'mau beli', 'order otp', 'cara membeli', 'cara pesan'],
  cara_pakai: ['cara pakai', 'cara gunakan', 'gimana pakai', 'bagaimana pakai', 'pakai otp', 'cara menggunakan', 'cara pakainya'],
  refund: ['refund', 'pengembalian', 'saldo balik', 'saldo kembali', 'balikin saldo', 'uang kembali', 'bisa refund', 'refund ga'],
  komplain: ['komplain', 'keluhan', 'otp belum masuk', 'otp ga masuk', 'otp gak masuk', 'sms belum masuk', 'kode belum masuk', 'belum masuk', 'tidak masuk'],
  banned: ['banned', 'suspend', 'limit', 'akun kena limit', 'akun diblokir', 'akun kena banned', 'akun kena suspend', 'akun hilang', 'kehilangan akun'],
  platform: ['platform', 'aplikasi', 'support platform', 'bisa dipakai dimana', 'semua aplikasi', 'semua platform', 'buat aplikasi apa'],
  nomor: ['nomor', 'fresh', 'nomor fresh', 'nomornya fresh', 'nomor bekas', 'nomor baru', 'temporary', 'sementara'],
  privasi: ['privasi', 'data aman', 'keamanan data', 'data saya aman', 'privacy'],
  tos: ['tos', 'syarat', 'ketentuan', 'terms', 'aturan', 'syarat layanan', 'ketentuan layanan'],
  admin: ['admin', 'cs', 'customer service', 'kontak', 'hubungi admin', 'operator'],
  status: ['status', 'status bot', 'cek bot', 'bot aktif', 'online'],
  harga: ['harga', 'price', 'berapa', 'tarif', 'biaya'],
  order_status: ['status order', 'cek order', 'riwayat order', 'detail order'],
  thanks: ['makasih', 'terima kasih', 'thanks', 'thank you']
};

function normalizeText(text = '') {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s:/_-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(text, keywords = []) {
  return keywords.some((keyword) => text.includes(keyword));
}

function pick(list = []) {
  return list[Math.floor(Math.random() * list.length)];
}

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour < 11) return 'Selamat pagi';
  if (hour < 15) return 'Selamat siang';
  if (hour < 18) return 'Selamat sore';
  return 'Selamat malam';
}

function getUptime() {
  const total = Math.floor((Date.now() - startTime) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}j ${minutes}m ${seconds}d`;
}

function footerHints() {
  return [
    '',
    'Butuh bantuan lain? Tinggal pilih/ketik:',
    '• *menu*',
    '• *refund*',
    '• *komplain*',
    '• *admin*'
  ].join('\n');
}

function greetingMessage() {
  const openers = [
    `${getTimeGreeting()} kak 👋`,
    `Halo kak 👋`,
    `Hai kak, selamat datang 👋`
  ];

  return [
    pick(openers),
    '',
    `Selamat datang di *${BOT_NAME}* 😊`,
    `${BRAND_NAME} siap bantu kebutuhan *OTP / nomor virtual* untuk berbagai platform.`,
    '',
    'Sebelum lanjut, mohon pahami poin penting berikut ya kak:',
    '• Kami hanya menyediakan *OTP / nomor virtual*, bukan akun',
    '• OTP masuk = transaksi dianggap selesai',
    '• Kendala akun seperti banned/limit bukan tanggung jawab kami',
    '',
    'Silakan pilih menu yang ingin ditanyakan 👇',
    '• *menu* → lihat semua bantuan',
    '• *otp* → info layanan OTP',
    '• *cara beli* → alur order',
    '• *refund* → ketentuan pengembalian saldo',
    '• *admin* → hubungi CS',
    '',
    'Kalau bingung, tinggal tulis pertanyaannya aja ya kak 😊'
  ].join('\n');
}

function menuMessage() {
  return [
    `📋 *Menu Bantuan ${BOT_NAME}*`,
    '',
    'Silakan pilih topik yang ingin ditanyakan:',
    '',
    '1️⃣ *otp* → info layanan OTP',
    '2️⃣ *cara beli* → cara order nomor',
    '3️⃣ *cara pakai* → cara menggunakan OTP',
    '4️⃣ *refund* → aturan refund',
    '5️⃣ *komplain* → OTP belum masuk',
    '6️⃣ *banned* → akun kena limit / suspend',
    '7️⃣ *platform* → dukungan aplikasi',
    '8️⃣ *nomor* → info nomor & masa aktif',
    '9️⃣ *tos* → syarat & ketentuan',
    '🔟 *admin* → hubungi CS',
    '',
    '💬 Contoh pertanyaan:',
    '• "OTP saya belum masuk"',
    '• "Kalau gagal bisa refund?"',
    '• "Ini jual akun atau OTP?"',
    '',
    'Kakak juga bisa langsung *tap tombol menu* kalau muncul di bawah 👍'
  ].join('\n');
}

function otpMessage() {
  return [
    `📩 *Info Layanan OTP ${BRAND_NAME}*`,
    '',
    `${BRAND_NAME} menyediakan *nomor virtual / temporary number* untuk menerima SMS OTP dari platform pihak ketiga.`,
    '',
    '📌 Penegasan penting:',
    '• Kami hanya menyediakan OTP / nomor virtual',
    '• Kami *tidak menjual akun*',
    '• Kami *tidak membuat akun*',
    '• Kami *tidak menjamin* akun akan aman, lolos, tahan lama, atau bebas limit',
    '',
    'Jadi jika OTP sudah berhasil diterima, maka layanan dianggap selesai.',
    '',
    'Nomor bersifat sementara dan bisa dipakai ulang setelah masa aktif berakhir.'
  ].join('\n');
}

function caraBeliMessage() {
  return [
    '🛒 *Cara Beli / Order OTP*',
    '',
    'Berikut alur order yang disarankan:',
    '1. Pilih layanan / platform yang sesuai kebutuhan kakak',
    '2. Pastikan saldo mencukupi',
    '3. Beli nomor untuk layanan tersebut',
    '4. Salin nomor yang didapat, lalu pakai di platform tujuan',
    '5. Tunggu OTP masuk selama masa aktif nomor berjalan',
    '6. Cek notifikasi atau detail order secara berkala',
    '',
    '📌 Tips penting:',
    '• Pastikan layanan yang dipilih sudah benar sebelum membeli',
    '• Salah pilih layanan atau salah penggunaan tidak termasuk refund',
    '• Jika OTP tidak masuk sampai masa aktif habis, refund mengikuti sistem'
  ].join('\n');
}

function caraPakaiMessage() {
  return [
    '📲 *Cara Pakai OTP*',
    '',
    'Supaya proses lebih lancar, ikuti langkah ini:',
    '1. Beli nomor sesuai layanan',
    '2. Salin nomor yang diberikan',
    '3. Masukkan nomor tersebut ke platform tujuan',
    '4. Tunggu OTP masuk selama masa aktif nomor masih berjalan',
    '5. Cek notifikasi / detail transaksi secara berkala',
    '6. Gunakan kode OTP yang diterima',
    '',
    '⚠️ Catatan:',
    '• OTP tidak selalu instan',
    '• Kecepatan masuk bergantung pada sistem platform pihak ketiga',
    '• Jika OTP sudah diterima, transaksi dianggap selesai'
  ].join('\n');
}

function refundMessage() {
  return [
    '💰 *Ketentuan Refund*',
    '',
    '✅ Refund berlaku jika:',
    '• OTP *tidak diterima sampai masa aktif nomor selesai*',
    '',
    '❌ Refund tidak berlaku jika:',
    '• OTP sudah diterima',
    '• Sudah melewati 20 menit sejak pembelian',
    '• Salah beli layanan / salah pilih layanan',
    '• Kesalahan penggunaan dari pihak pengguna',
    '',
    '📌 Penjelasan tambahan:',
    '• Saldo dipotong otomatis saat nomor berhasil dibeli',
    '• Tombol batal akan mengirim pembatalan ke provider',
    '• Saldo kembali jika pembatalan berhasil atau OTP memang tidak masuk sesuai syarat sistem'
  ].join('\n');
}

function komplainMessage() {
  return [
    '🧾 *OTP belum masuk? Tenang dulu ya kak 😊*',
    '',
    'Sebelum komplain, mohon cek langkah ini dulu:',
    '1. Cek notifikasi SMS',
    '2. Cek menu riwayat order',
    '3. Buka detail transaksi / detail order',
    '4. Tunggu sampai masa aktif nomor selesai',
    '',
    '📌 Perlu diketahui:',
    '• OTP tidak selalu masuk instan',
    '• Hal ini bergantung pada sistem, filter, dan kebijakan platform tujuan',
    '',
    '💰 Jika OTP tidak masuk sampai masa aktif berakhir, refund mengikuti sistem.',
    '',
    'Kalau masih bingung, kirim detail kendalanya lalu ketik *admin* agar kami arahkan dengan tepat.'
  ].join('\n');
}

function bannedMessage() {
  return [
    '🚫 *Info Banned / Suspend / Limit Akun*',
    '',
    'Mohon dipahami ya kak:',
    '• Kami hanya menyediakan layanan OTP',
    '• Kami tidak menjual akun',
    '• Kami tidak dapat menjamin akun lolos, aman, atau tahan lama',
    '',
    'Semua risiko seperti:',
    '• banned',
    '• suspend',
    '• review',
    '• limit akun',
    '• pemblokiran',
    '• kehilangan akses akun',
    '',
    'sepenuhnya menjadi tanggung jawab pengguna.'
  ].join('\n');
}

function platformMessage() {
  return [
    '🌐 *Info Dukungan Platform*',
    '',
    'Nomor kami digunakan untuk menerima OTP dari berbagai platform pihak ketiga.',
    '',
    'Namun perlu dipahami:',
    '• Tidak semua nomor akan selalu cocok di semua platform',
    '• Keberhasilan OTP bergantung pada sistem dan filter platform tujuan',
    '• Kami tidak bisa menjamin semua order akan berhasil di semua aplikasi',
    '',
    'Jika OTP tidak diterima sampai masa aktif nomor berakhir, refund mengikuti sistem.'
  ].join('\n');
}

function nomorMessage() {
  return [
    '🔢 *Info Nomor*',
    '',
    'Nomor yang kami sediakan bersifat *sementara / temporary number*.',
    '',
    'Artinya:',
    '• Nomor tidak ditujukan untuk kepemilikan permanen',
    '• Nomor bisa digunakan kembali setelah masa aktif selesai',
    '• Kami tidak dapat menjamin nomor selalu fresh atau selalu cocok untuk semua platform',
    '',
    'Karena itu, gunakan nomor sesuai kebutuhan OTP saja ya kak.'
  ].join('\n');
}

function privasiMessage() {
  return [
    '🔒 *Privasi & Keamanan Data*',
    '',
    'Kami berupaya menjaga privasi pengguna dengan serius.',
    '',
    'Informasi yang diberikan hanya digunakan untuk keperluan operasional layanan.',
    'Kami tidak menjual atau mendistribusikan data pribadi pengguna kepada pihak lain, kecuali jika diwajibkan oleh hukum yang berlaku.'
  ].join('\n');
}

function adminMessage() {
  return [
    '👨‍💼 *Kontak Admin / CS*',
    '',
    `Silakan hubungi admin di: ${ADMIN_CONTACT}`,
    '',
    'Agar penanganan lebih cepat, sebelum menghubungi admin siapkan info berikut:',
    '• layanan yang dibeli',
    '• waktu order',
    '• status di riwayat order',
    '• detail kendala yang dialami',
    '',
    'Dengan data lengkap, CS bisa bantu lebih cepat ya kak 🙏'
  ].join('\n');
}

function tosMessage() {
  return [
    `📜 *Ketentuan Layanan ${BRAND_NAME}*`,
    '',
    '*1. Umum*',
    'Dengan menggunakan layanan ini, pengguna dianggap telah membaca, memahami, dan menyetujui seluruh ketentuan yang berlaku.',
    '',
    '*2. Layanan*',
    `${BRAND_NAME} menyediakan nomor virtual / temporary number untuk menerima SMS OTP dari platform pihak ketiga. Kami bukan operator seluler dan tidak terafiliasi dengan operator mana pun.`,
    '',
    '*3. Pembelian & Refund*',
    'Saldo dipotong saat nomor berhasil dibeli. Refund hanya berlaku jika OTP tidak diterima sampai masa aktif nomor berakhir sesuai sistem. Jika OTP sudah diterima atau sudah melewati 20 menit sejak pembelian, layanan dianggap selesai.',
    '',
    '*4. Tanggung Jawab Pengguna*',
    'Pengguna bertanggung jawab penuh atas penggunaan layanan. Salah beli, salah penggunaan, banned, suspend, limit akun, atau pemblokiran dari platform pihak ketiga menjadi tanggung jawab pengguna.',
    '',
    '*5. Penegasan Utama*',
    'Kami menjual OTP / nomor virtual, *bukan akun*. Jika OTP masuk, layanan dianggap selesai.'
  ].join('\n');
}

function statusMessage() {
  return [
    `🤖 *Status ${BOT_NAME}*`,
    '',
    `• Koneksi WhatsApp: ${isConnected ? 'terhubung' : 'belum terhubung'}`,
    `• Uptime bot: ${getUptime()}`,
    `• Admin: ${ADMIN_CONTACT}`,
    '',
    'Jika butuh bantuan, ketik *menu* ya kak.'
  ].join('\n');
}

function hargaMessage() {
  return [
    '💳 *Info Harga / Tarif*',
    '',
    'Harga bisa berbeda tergantung layanan, negara, dan ketersediaan nomor saat itu.',
    '',
    'Agar akurat, silakan cek langsung di sistem / halaman order sebelum membeli.',
    'Jika ingin konfirmasi lebih lanjut, silakan ketik *admin* ya kak.'
  ].join('\n');
}

function orderStatusMessage() {
  return [
    '📦 *Cek Status Order*',
    '',
    'Untuk mengecek status order, silakan lihat:',
    '• riwayat order',
    '• detail transaksi',
    '• status OTP di halaman detail',
    '',
    'Kalau status masih berjalan, mohon tunggu sampai masa aktif selesai.',
    'Jika OTP tidak masuk hingga masa aktif habis, refund mengikuti sistem.'
  ].join('\n');
}

function thanksMessage() {
  return pick([
    'Sama-sama kak 🙏 Kalau masih ada yang ingin ditanyakan, tinggal ketik *menu* ya.',
    'Siap kak 😊 Kalau butuh bantuan lain, saya siap bantu. Ketik *menu* untuk lihat opsi.',
    'Dengan senang hati kak ✨ Kalau ada kendala lain, langsung tulis aja ya.'
  ]);
}

function defaultMessage() {
  return [
    'Halo kak 😊',
    '',
    'Pesan kakak sudah kami terima.',
    'Supaya kami bantu lebih cepat, silakan kirim kata kunci berikut:',
    '',
    '• *menu*',
    '• *otp*',
    '• *cara beli*',
    '• *refund*',
    '• *komplain*',
    '• *admin*',
    '',
    'Atau kirim pertanyaan yang lebih spesifik ya kak 🙏'
  ].join('\n');
}

const intents = [
  { name: 'greeting', keywords: KEYWORD_ALIASES.greeting, response: greetingMessage, interactive: 'main-menu' },
  { name: 'menu', keywords: KEYWORD_ALIASES.menu, response: menuMessage, interactive: 'main-menu' },
  { name: 'otp', keywords: KEYWORD_ALIASES.otp, response: otpMessage },
  { name: 'cara_beli', keywords: KEYWORD_ALIASES.cara_beli, response: caraBeliMessage },
  { name: 'cara_pakai', keywords: KEYWORD_ALIASES.cara_pakai, response: caraPakaiMessage },
  { name: 'refund', keywords: KEYWORD_ALIASES.refund, response: refundMessage },
  { name: 'komplain', keywords: KEYWORD_ALIASES.komplain, response: komplainMessage, interactive: 'support-menu' },
  { name: 'banned', keywords: KEYWORD_ALIASES.banned, response: bannedMessage },
  { name: 'platform', keywords: KEYWORD_ALIASES.platform, response: platformMessage },
  { name: 'nomor', keywords: KEYWORD_ALIASES.nomor, response: nomorMessage },
  { name: 'privasi', keywords: KEYWORD_ALIASES.privasi, response: privasiMessage },
  { name: 'tos', keywords: KEYWORD_ALIASES.tos, response: tosMessage },
  { name: 'admin', keywords: KEYWORD_ALIASES.admin, response: adminMessage },
  { name: 'status', keywords: KEYWORD_ALIASES.status, response: statusMessage },
  { name: 'harga', keywords: KEYWORD_ALIASES.harga, response: hargaMessage },
  { name: 'order_status', keywords: KEYWORD_ALIASES.order_status, response: orderStatusMessage },
  { name: 'thanks', keywords: KEYWORD_ALIASES.thanks, response: thanksMessage }
];

function resolveIntent(messageText) {
  const normalized = normalizeText(messageText);

  for (const intent of intents) {
    const normalizedKeywords = intent.keywords.map(normalizeText);
    if (includesAny(normalized, normalizedKeywords)) {
      return intent;
    }
  }

  if (normalized.includes('akun') && normalized.includes('otp')) {
    return intents.find((item) => item.name === 'otp');
  }

  if ((normalized.includes('otp') || normalized.includes('kode')) && (normalized.includes('belum') || normalized.includes('ga masuk') || normalized.includes('gak masuk') || normalized.includes('tidak masuk' ))) {
    return intents.find((item) => item.name === 'komplain');
  }

  if (normalized.includes('refund') && normalized.includes('otp')) {
    return intents.find((item) => item.name === 'refund');
  }

  return null;
}

function mapButtonIdToText(buttonId = '') {
  const lookup = {
    'menu:otp': 'otp',
    'menu:buy': 'cara beli',
    'menu:use': 'cara pakai',
    'menu:refund': 'refund',
    'menu:complaint': 'komplain',
    'menu:admin': 'admin',
    'menu:banned': 'banned',
    'menu:tos': 'tos',
    'menu:platform': 'platform',
    'menu:number': 'nomor',
    'support:refund': 'refund',
    'support:admin': 'admin',
    'support:status': 'status order',
    'support:menu': 'menu'
  };
  return lookup[buttonId] || buttonId;
}

function extractIncomingText(message = {}) {
  const m = message.message || {};
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.videoMessage?.caption) return m.videoMessage.caption;
  if (m.buttonsResponseMessage?.selectedDisplayText) return m.buttonsResponseMessage.selectedDisplayText;
  if (m.buttonsResponseMessage?.selectedButtonId) return mapButtonIdToText(m.buttonsResponseMessage.selectedButtonId);
  if (m.templateButtonReplyMessage?.selectedDisplayText) return m.templateButtonReplyMessage.selectedDisplayText;
  if (m.templateButtonReplyMessage?.selectedId) return mapButtonIdToText(m.templateButtonReplyMessage.selectedId);
  if (m.listResponseMessage?.title) return m.listResponseMessage.title;
  if (m.listResponseMessage?.singleSelectReply?.selectedRowId) {
    return mapButtonIdToText(m.listResponseMessage.singleSelectReply.selectedRowId);
  }

  const paramsJson = m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (paramsJson) {
    try {
      const parsed = JSON.parse(paramsJson);
      if (parsed?.id) return mapButtonIdToText(parsed.id);
    } catch (_) {}
  }

  return '';
}

async function sendPlainMenu(sock, jid) {
  await sock.sendMessage(jid, { text: menuMessage() });
}

async function sendMainMenu(sock, jid) {
  const text = [
    `Halo kak 👋 Ini *menu utama ${BOT_NAME}*`,
    '',
    'Silakan pilih kebutuhan kakak lewat tombol di bawah.',
    '',
    'Kalau tombol tidak tampil di perangkat kakak, bot akan kirim menu teks biasa.'
  ].join('\n');

  try {
    await sock.sendMessage(jid, {
      text,
      footer: `${BRAND_NAME} • layanan OTP / nomor virtual`,
      buttons: [
        { buttonId: 'menu:otp', buttonText: { displayText: 'Info OTP' }, type: 1 },
        { buttonId: 'menu:buy', buttonText: { displayText: 'Cara Beli' }, type: 1 },
        { buttonId: 'menu:refund', buttonText: { displayText: 'Refund' }, type: 1 }
      ],
      headerType: 1
    });

    await sock.sendMessage(jid, {
      text: 'Butuh opsi lain?',
      footer: 'Pilih tombol berikut',
      buttons: [
        { buttonId: 'menu:complaint', buttonText: { displayText: 'OTP Belum Masuk' }, type: 1 },
        { buttonId: 'menu:banned', buttonText: { displayText: 'Banned / Limit' }, type: 1 },
        { buttonId: 'menu:admin', buttonText: { displayText: 'Hubungi Admin' }, type: 1 }
      ],
      headerType: 1
    });
  } catch (error) {
    console.warn('Gagal kirim tombol menu, fallback ke teks biasa:', error?.message || error);
    await sendPlainMenu(sock, jid);
  }
}

async function sendSupportMenu(sock, jid) {
  const text = [
    'Kami paham kendala kakak 🙏',
    'Silakan pilih bantuan yang paling sesuai di bawah ini.'
  ].join('\n');

  try {
    await sock.sendMessage(jid, {
      text,
      footer: 'Pilih salah satu',
      buttons: [
        { buttonId: 'support:status', buttonText: { displayText: 'Cek Status Order' }, type: 1 },
        { buttonId: 'support:refund', buttonText: { displayText: 'Info Refund' }, type: 1 },
        { buttonId: 'support:admin', buttonText: { displayText: 'Hubungi Admin' }, type: 1 }
      ],
      headerType: 1
    });
  } catch (error) {
    console.warn('Gagal kirim tombol support, fallback teks:', error?.message || error);
  }
}

async function sendIntentResponse(sock, jid, intent, incomingText) {
  const response = typeof intent.response === 'function' ? intent.response(incomingText) : intent.response;
  await sock.sendMessage(jid, { text: response });

  if (intent.interactive === 'main-menu') {
    await sendMainMenu(sock, jid);
  } else if (intent.interactive === 'support-menu') {
    await sendSupportMenu(sock, jid);
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
      const m = messages?.[0];
      if (!m?.message || m.key.fromMe) return;

      const jid = m.key.remoteJid;
      const messageText = extractIncomingText(m);
      if (!messageText) return;

      const normalized = normalizeText(messageText);
      const last = recentMessages.get(jid);
      if (last && last.text === normalized && Date.now() - last.time < 2000) {
        return;
      }
      recentMessages.set(jid, { text: normalized, time: Date.now() });

      console.log(`📩 Pesan dari ${jid}: ${messageText}`);

      const intent = resolveIntent(messageText);
      if (intent) {
        await sendIntentResponse(sock, jid, intent, messageText);
      } else {
        await sock.sendMessage(jid, { text: defaultMessage() });
      }

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
          <div class="badge ok">Bot terhubung ke WhatsApp ✅</div>
          <p>Bot aktif dan siap membantu membalas pesan pelanggan.</p>
          <div class="grid">
            <div class="card"><strong>Status</strong><br/>Online & siap menerima chat</div>
            <div class="card"><strong>Uptime</strong><br/>${getUptime()}</div>
            <div class="card"><strong>Admin</strong><br/>${ADMIN_CONTACT}</div>
          </div>
          <p class="muted" style="margin-top:18px;">Buka WhatsApp dan kirim pesan seperti “menu”, “refund”, atau “komplain” untuk mengetes respon bot.</p>
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
          <p class="muted">Halaman akan refresh otomatis. Jika QR berganti, cukup scan QR terbaru.</p>
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
