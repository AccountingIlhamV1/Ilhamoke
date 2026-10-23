/* Ilham-ERP: mesin pembaca transaksi dari kalimat (berbasis aturan, tanpa AI).

   TxParser.parse(teks, daftarAkun, opsi) -> usulan jurnal.
   - Fungsi murni: tidak menyentuh halaman atau server, jadi mudah diuji dan diperbaiki.
   - Hanya MENGUSULKAN. Pengguna tetap mengonfirmasi, dan kode ERP yang memvalidasi.
   - Aturan ada di bagian "DATA ATURAN" di bawah. Memperbaiki mesin = menambah/mengubah baris di sana.

   daftarAkun: [{ id, code, name, group, isCash }]
   opsi: { today: Date, learned: [{ keyword, accountId }] }
   hasil: { ok, kind, label, date, amount, description, debit, credit, status, notes, missing }
     status: "lengkap" | "periksa" | "belum lengkap" */
(function (root) {
  "use strict";

  /* =====================  DATA ATURAN  ===================== */

  // Urutan penting: yang lebih spesifik di atas.
  const KIND_RULES = [
    { id: "modal",          label: "Setor modal",   re: /(setor|setoran|tambah|suntik)\s+modal|modal\s+(awal|masuk|tambahan)/ },
    { id: "prive",          label: "Prive",         re: /\bprive\b|ambil\s+(uang\s+)?pribadi|tarik\s+(uang\s+)?(pribadi|pemilik)|penarikan\s+pemilik/ },
    { id: "bayar_utang",    label: "Bayar utang",   re: /(bayar|membayar|lunasi|melunasi|cicil|mencicil)\s+(utang|hutang)|pelunasan\s+(utang|hutang)/ },
    { id: "terima_piutang", label: "Terima piutang", re: /(terima|diterima|dapat)\s+(pelunasan\s+)?piutang|pelunasan\s+piutang|piutang\s+(lunas|dibayar|masuk)|tagihan\s+(lunas|dibayar)/ },
    { id: "jual",           label: "Penjualan",     re: /\b(jual|menjual|dijual|terjual|penjualan|laku|omzet)\b/ },
    { id: "pemasukan",      label: "Pemasukan",     re: /\b(terima|diterima|dapat|pemasukan|pendapatan|masuk)\b/ },
    { id: "beli",           label: "Pengeluaran",   re: /\b(beli|membeli|belanja|bayar|membayar|biaya|keluar|pengeluaran|isi|topup|servis|service|kulak|kulakan)\b/ }
  ];

  const ON_CREDIT_RE = /\b(utang|hutang|ngutang|kredit|tempo|bon|dicicil|nanti bayar|belum bayar|belum dibayar|belum lunas)\b/;
  const BANK_RE = /\b(transfer|tf|trf|bank|qris|debit|gopay|ovo|dana|shopeepay|linkaja|ewallet|e-wallet|mbanking|m-banking)\b/;

  // Kata -> akun beban/aset yang dituju. names = daftar pola nama akun, dicoba berurutan.
  const EXPENSE_RULES = [
    // Servis/perbaikan didahulukan, supaya "servis motor" tidak dianggap membeli motor.
    { words: ["servis", "service", "perbaikan", "reparasi", "pemeliharaan", "maintenance", "tambal"], names: [/pemeliharaan dan perbaikan/] },
    { words: ["stok", "kulak", "kulakan", "restock", "dagangan", "barang dagang", "persediaan"], names: [/^persediaan barang dagang/, /^persediaan/], group: "aset" },
    { words: ["bahan baku"], names: [/^persediaan bahan baku/, /^persediaan/], group: "aset" },
    { words: ["laptop", "komputer", "pc", "hp", "printer", "router", "cctv", "monitor"], names: [/^komputer dan perangkat it/, /^peralatan kantor/, /^peralatan$/], group: "aset" },
    { words: ["motor", "mobil", "truk", "pickup", "kendaraan"], names: [/^kendaraan$/], group: "aset" },
    { words: ["meja", "kursi", "lemari", "etalase", "rak", "furnitur"], names: [/^furnitur dan perabot/, /^peralatan kantor/, /^peralatan$/], group: "aset" },
    { words: ["gedung", "bangunan", "ruko"], names: [/^gedung$/], group: "aset" },
    { words: ["tanah"], names: [/^tanah$/], group: "aset" },

    { words: ["gaji", "upah", "honor", "lembur", "karyawan", "pegawai"], names: [/^beban gaji/, /^beban upah/] },
    { words: ["bpjs ketenagakerjaan"], names: [/bpjs ketenagakerjaan/] },
    { words: ["bpjs"], names: [/beban bpjs kesehatan/] },
    { words: ["listrik", "pln", "token"], names: [/^beban listrik$/, /^beban listrik, air/, /^beban listrik/] },
    { words: ["makan", "minum", "kopi", "teh", "snack", "camilan", "konsumsi", "rapat", "catering", "nasi", "galon"], names: [/konsumsi dan rapat/, /representasi dan jamuan/] },
    { words: ["air", "pdam"], names: [/^beban air$/, /^beban listrik, air/] },
    { words: ["telepon", "telpon", "pulsa", "internet", "wifi", "paket data", "kuota"], names: [/^beban telepon dan internet/, /^beban listrik, air/] },
    { words: ["sewa", "kontrak tempat", "kos"], names: [/^beban sewa/] },
    { words: ["bensin", "bbm", "solar", "pertalite", "pertamax", "parkir", "tol", "transport", "ojek", "grab", "gojek"], names: [/bahan bakar dan transportasi/, /^beban transportasi/] },
    { words: ["ongkir", "kirim", "pengiriman", "ekspedisi", "jne", "jnt", "sicepat", "kurir"], names: [/^beban pengiriman/, /^beban angkut/, /bahan bakar dan transportasi/] },
    { words: ["iklan", "promosi", "ads", "endorse", "banner", "spanduk", "brosur", "meta ads", "tiktok ads"], names: [/iklan dan promosi/] },
    { words: ["atk", "alat tulis", "kertas", "tinta", "fotokopi", "print", "cetak"], names: [/alat tulis dan percetakan/, /^beban perlengkapan/] },
    { words: ["perlengkapan", "sabun", "sapu", "pel", "plastik", "kantong"], names: [/^beban perlengkapan/] },
    { words: ["jamuan", "traktir", "tamu", "entertain"], names: [/representasi dan jamuan/, /konsumsi dan rapat/] },
    { words: ["asuransi"], names: [/^beban asuransi/] },
    { words: ["pajak", "pbb", "retribusi"], names: [/pajak dan retribusi/] },
    { words: ["izin", "perizinan", "nib", "siup"], names: [/perizinan/] },
    { words: ["kebersihan", "keamanan", "satpam", "sampah", "cleaning"], names: [/kebersihan dan keamanan/] },
    { words: ["admin bank", "biaya admin", "administrasi bank"], names: [/administrasi bank/] },
    { words: ["langganan", "lisensi", "software", "aplikasi", "hosting", "domain", "canva"], names: [/langganan dan lisensi/] },
    { words: ["kemasan", "packaging", "dus", "box", "bubble wrap"], names: [/^beban kemasan/] },
    { words: ["donasi", "sumbangan", "zakat", "infaq", "sedekah"], names: [/donasi dan sumbangan/] },
    { words: ["bunga"], names: [/^beban bunga/] },
    { words: ["pelatihan", "kursus", "training", "seminar", "workshop"], names: [/pelatihan dan pengembangan/] },
    { words: ["konsultan", "notaris", "akuntan", "pengacara", "jasa profesional"], names: [/jasa profesional/] },
    { words: ["komisi"], names: [/komisi penjualan/] },
    { words: ["mesin", "peralatan", "alat"], names: [/^peralatan$/, /^peralatan kantor/, /^mesin dan peralatan pabrik/], group: "aset" }
  ];

  const REVENUE_RULES = [
    { words: ["jasa", "servis", "service", "konsultasi", "les", "desain", "laundry", "fee", "proyek", "project"], names: [/^pendapatan jasa$/, /^pendapatan jasa/] },
    { words: ["sewa"], names: [/^pendapatan sewa/] },
    { words: ["komisi"], names: [/^pendapatan komisi/] },
    { words: ["bunga"], names: [/^pendapatan bunga/] },
    { words: ["langganan", "member"], names: [/^pendapatan langganan/] },
    { words: ["donasi", "hibah"], names: [/hibah dan donasi/] }
  ];
  const REVENUE_DEFAULT = [/^penjualan$/, /^penjualan/, /^pendapatan usaha/, /^pendapatan penjualan/, /^pendapatan jasa$/, /^pendapatan jasa/];

  // Kata yang tidak membantu menebak akun dari kemiripan nama.
  const STOP_WORDS = new Set(["beli", "membeli", "belanja", "bayar", "membayar", "biaya", "untuk", "yang", "dan", "dari", "di", "ke", "ini", "itu", "tadi", "kemarin", "lusa", "hari", "tanggal", "tgl", "cash", "tunai", "transfer", "rp", "ribu", "juta", "utang", "hutang", "kredit", "jual", "terima", "dapat", "keluar", "pengeluaran", "pemasukan", "pendapatan", "lunas", "kas", "bank", "beban", "pada", "buat", "sama", "dengan", "total", "harga"]);

  /* =====================  ALAT BANTU  ===================== */

  function norm(text) {
    return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function hasWord(text, word) {
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z0-9])" + esc + "([^a-z0-9]|$)").test(text);
  }

  function groupOf(a) { return String((a && a.group) || "").toLowerCase(); }
  function nameOf(a) { return String((a && a.name) || "").toLowerCase().replace(/^[-*\s]+/, ""); }

  function isContra(a) { return /akumulasi|cadangan kerugian|diskonto|treasuri/.test(nameOf(a)); }

  function inGroup(a, kind) {
    const g = groupOf(a);
    if (kind === "aset") return g.indexOf("aset") === 0;
    if (kind === "beban") return g.indexOf("beban") === 0;
    if (kind === "pendapatan") return g === "pendapatan";
    if (kind === "liabilitas") return g.indexOf("liabilitas") === 0;
    if (kind === "ekuitas") return g === "ekuitas";
    return true;
  }

  // Cari akun dengan nama cocok pola; kalau banyak, ambil nama terpendek (paling umum).
  function findAccount(accounts, patterns, groupKind) {
    for (let i = 0; i < patterns.length; i++) {
      const hits = accounts.filter(a => !isContra(a) && (!groupKind || inGroup(a, groupKind)) && patterns[i].test(nameOf(a)));
      if (hits.length) {
        hits.sort((x, y) => nameOf(x).length - nameOf(y).length);
        return hits[0];
      }
    }
    return null;
  }

  function pickCash(accounts, wantBank) {
    const cash = accounts.filter(a => a.isCash);
    if (wantBank) {
      const bank = cash.find(a => /bank|dompet digital|e-wallet/.test(nameOf(a)));
      if (bank) return bank;
    } else {
      const kas = cash.find(a => /^kas$/.test(nameOf(a))) || cash.find(a => /^kas\b/.test(nameOf(a)) && !/bank/.test(nameOf(a)));
      if (kas) return kas;
    }
    if (cash.length) return cash[0];
    return findAccount(accounts, [wantBank ? /^bank/ : /^kas$/, /^kas/, /^bank/], "aset");
  }

  /* =====================  NOMINAL  ===================== */

  function parseNumber(numStr, unit) {
    const mult = unit ? ({ juta: 1e6, jt: 1e6, ribu: 1e3, rb: 1e3, k: 1e3 })[unit] : 1;
    let v;
    if (/^\d{1,3}([.,]\d{3})+$/.test(numStr)) v = Number(numStr.replace(/[.,]/g, ""));
    else if (/^\d+[.,]\d+$/.test(numStr)) v = Number(numStr.replace(",", "."));
    else if (/^\d+$/.test(numStr)) v = Number(numStr);
    else return NaN;
    return Math.round(v * mult);
  }

  function stripDates(t) {
    return t
      .replace(/\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/g, " ")
      .replace(/\b(?:tgl|tanggal)\s*\d{1,2}\b/g, " ");
  }

  function extractAmounts(t) {
    const s = stripDates(t);
    const re = /(?:rp\.?\s*)?(\d+(?:[.,]\d+)*)\s*(juta|jt|ribu|rb|k)?(?![a-z0-9])/g;
    const found = [];
    let m;
    while ((m = re.exec(s)) !== null) {
      const unit = m[2] || "";
      const value = parseNumber(m[1], unit);
      if (!isFinite(value) || value <= 0) continue;
      // Angka kecil tanpa satuan (jumlah barang seperti "2 kopi") bukan nominal.
      if (!unit && value < 1000) continue;
      found.push(value);
    }
    return found;
  }

  /* =====================  TANGGAL  ===================== */

  function iso(d) {
    const p = n => (n < 10 ? "0" : "") + n;
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function validYMD(y, m, d) {
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  function parseDate(t, today, notes) {
    const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const shift = days => { const d = new Date(base); d.setDate(d.getDate() - days); return iso(d); };

    let m = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
    if (m) {
      const day = Number(m[1]), mon = Number(m[2]);
      let year = m[3] ? Number(m[3]) : base.getFullYear();
      if (year < 100) year += 2000;
      if (validYMD(year, mon, day)) return iso(new Date(year, mon - 1, day));
      notes.push("Tanggal tidak valid, dipakai hari ini.");
      return iso(base);
    }
    m = t.match(/\b(?:tgl|tanggal)\s*(\d{1,2})\b/);
    if (m) {
      const day = Number(m[1]);
      if (validYMD(base.getFullYear(), base.getMonth() + 1, day)) return iso(new Date(base.getFullYear(), base.getMonth(), day));
      notes.push("Tanggal tidak valid, dipakai hari ini.");
      return iso(base);
    }
    if (/\bkemarin lusa\b|\blusa\b/.test(t)) return shift(2);
    if (/\bkemarin\b/.test(t)) return shift(1);
    return iso(base);
  }

  /* =====================  PENCARIAN AKUN  ===================== */

  function matchRule(text, rules, accounts) {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (!rule.words.some(w => hasWord(text, w))) continue;
      const acc = findAccount(accounts, rule.names, rule.group || null);
      if (acc) return acc;
    }
    return null;
  }

  // Cadangan: tebak dari kemiripan kata di deskripsi dengan nama akun beban.
  function guessByOverlap(text, accounts) {
    const words = (text.match(/[a-z]{4,}/g) || []).filter(w => !STOP_WORDS.has(w));
    if (!words.length) return null;
    let best = null, bestScore = 0;
    accounts.filter(a => !isContra(a) && inGroup(a, "beban")).forEach(a => {
      const parts = nameOf(a).split(/[^a-z]+/).filter(p => p.length >= 4 && !STOP_WORDS.has(p));
      const score = words.filter(w => parts.some(p => p === w || p.indexOf(w) === 0 || w.indexOf(p) === 0)).length;
      if (score > bestScore) { best = a; bestScore = score; }
    });
    return best;
  }

  function learnedAccount(text, accounts, learned) {
    const list = Array.isArray(learned) ? learned : [];
    for (let i = 0; i < list.length; i++) {
      const key = norm(list[i].keyword);
      if (!key || !hasWord(text, key)) continue;
      const acc = accounts.find(a => String(a.id) === String(list[i].accountId));
      if (acc) return acc;
    }
    return null;
  }

  /* =====================  PARSE UTAMA  ===================== */

  function parse(rawText, accounts, options) {
    const opts = options || {};
    const today = opts.today instanceof Date ? opts.today : new Date();
    const list = Array.isArray(accounts) ? accounts : [];
    const text = norm(rawText);
    const notes = [];
    const missing = [];

    const result = {
      ok: false, kind: null, label: "", date: "", amount: 0,
      description: String(rawText || "").trim().slice(0, 140),
      debit: null, credit: null, status: "belum lengkap", notes, missing
    };

    // Jenis transaksi
    const kindRule = KIND_RULES.find(k => k.re.test(text));
    if (kindRule) { result.kind = kindRule.id; result.label = kindRule.label; }
    else missing.push("jenis transaksi");

    // Nominal
    const amounts = extractAmounts(text);
    if (amounts.length === 0) {
      missing.push("nominal");
    } else {
      const distinct = Array.from(new Set(amounts));
      result.amount = Math.max.apply(null, distinct);
      if (distinct.length > 1) notes.push("Ada beberapa angka; dipakai yang terbesar.");
    }

    // Tanggal
    result.date = parseDate(text, today, notes);

    if (!kindRule) {
      result.status = "belum lengkap";
      return result;
    }

    const onCredit = ON_CREDIT_RE.test(text);
    const cash = pickCash(list, BANK_RE.test(text));
    const learned = learnedAccount(text, list, opts.learned);
    const piutang = () => findAccount(list, [/^piutang usaha/, /^piutang dagang/, /^piutang/], "aset");
    const utang = () => findAccount(list, [/^utang usaha/, /^utang dagang/, /^utang/], "liabilitas");

    switch (kindRule.id) {
      case "modal":
        result.debit = cash;
        result.credit = findAccount(list, [/^modal$/, /^modal(?!.*saham)/], "ekuitas");
        break;

      case "prive":
        result.debit = findAccount(list, [/prive/], null);
        result.credit = cash;
        break;

      case "bayar_utang":
        result.debit = utang();
        result.credit = cash;
        break;

      case "terima_piutang":
        result.debit = cash;
        result.credit = piutang();
        break;

      case "jual":
      case "pemasukan": {
        const revenue = learned || matchRule(text, REVENUE_RULES, list) || findAccount(list, REVENUE_DEFAULT, "pendapatan");
        if (!revenue) missing.push("akun pendapatan");
        result.credit = revenue;
        result.debit = onCredit ? piutang() : cash;
        if (list.some(a => /^persediaan/.test(nameOf(a)))) {
          notes.push("Harga pokok (HPP) tidak ikut dicatat. Catat terpisah kalau perlu.");
        }
        break;
      }

      case "beli": {
        let target = learned || matchRule(text, EXPENSE_RULES, list);
        if (!target) {
          target = guessByOverlap(text, list);
          if (target) notes.push("Akun ditebak dari kemiripan nama. Periksa dulu.");
        }
        result.debit = target;
        result.credit = onCredit ? utang() : cash;
        break;
      }
    }

    if (!result.debit) missing.push("akun debit");
    if (!result.credit) missing.push("akun kredit");
    if (result.debit && result.credit && String(result.debit.id) === String(result.credit.id)) {
      notes.push("Akun debit dan kredit sama. Pilih ulang salah satunya.");
      missing.push("akun berbeda");
    }

    result.ok = missing.length === 0;
    result.status = !result.ok ? "belum lengkap" : (notes.length ? "periksa" : "lengkap");
    return result;
  }

  root.TxParser = { parse, extractAmounts, parseDate: (t, today) => parseDate(norm(t), today, []) };
  if (typeof module !== "undefined" && module.exports) module.exports = root.TxParser;
})(typeof window !== "undefined" ? window : globalThis);
