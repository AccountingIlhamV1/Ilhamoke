/* =====================================================
   ILHAM ERP — SHARED CORE
   Satu sumber logika data & layout untuk semua halaman.
   Sebelumnya setiap halaman punya salinan sendiri-sendiri
   (readArray, getActiveBusiness, dst) yang lama-lama bisa
   saling berbeda. Sekarang semua halaman memakai file ini,
   jadi kalau salah satu bagian diperbaiki, semua halaman
   otomatis ikut benar.
===================================================== */

const ERP = (function () {

  /* ---------- STORAGE KEYS ---------- */
  const BUSINESS_KEY     = "ilhamERP_businesses";
  const ACTIVE_KEY       = "ilhamERP_activeBusiness";
  const ACCOUNT_KEY      = "ilhamERP_accounts";
  const TRANSACTION_KEY  = "ilhamERP_transactions";
  const ADJUSTMENT_KEY   = "ilhamERP_adjustments";
  const CLOSING_KEY      = "ilhamERP_closingEntries";
  const CONTRACT_KEY     = "ilhamERP_revenueContracts";
  const RECOGNITION_KEY  = "ilhamERP_revenueRecognitions";

  /* ---------- KELOMPOK AKUN ----------
     Dipakai bersama oleh Laporan Keuangan, Jurnal Penutup,
     Neraca Saldo Setelah Penutupan, Laporan Perubahan Ekuitas,
     dan Laporan Arus Kas, supaya semua konsisten. */
  const ASSET_GROUPS     = ["Aset Lancar", "Aset Tetap", "Aset Lainnya"];
  const LIABILITY_GROUPS = ["Liabilitas Jangka Pendek", "Liabilitas Jangka Panjang"];
  const EQUITY_GROUPS    = ["Ekuitas"];
  const REVENUE_GROUPS   = ["Pendapatan"];
  const EXPENSE_GROUPS   = ["Beban"];
  const REAL_GROUPS      = ASSET_GROUPS.concat(LIABILITY_GROUPS, EQUITY_GROUPS);
  const NOMINAL_GROUPS   = REVENUE_GROUPS.concat(EXPENSE_GROUPS);

  // Klasifikasi aktivitas Laporan Arus Kas berdasarkan kelompok
  // akun LAWAN dari akun Kas/Bank pada tiap entri jurnal.
  const CASHFLOW_OPERATING = ["Pendapatan", "Beban", "Aset Lancar", "Liabilitas Jangka Pendek"];
  const CASHFLOW_INVESTING = ["Aset Tetap", "Aset Lainnya"];
  const CASHFLOW_FINANCING = ["Liabilitas Jangka Panjang", "Ekuitas"];

  /* ---------- LOW LEVEL HELPERS ---------- */

  function readArray(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error("Gagal membaca localStorage:", key, error);
      return [];
    }
  }

  function writeArray(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  function idEqual(a, b) {
    return String(a) === String(b);
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, function (char) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[char];
    });
  }

  function newId(prefix) {
    const rand = Math.random().toString(36).slice(2, 8);
    return (prefix ? prefix + "_" : "") + Date.now() + "_" + rand;
  }

  function formatMoney(value) {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0
    }).format(Number(value) || 0);
  }

  function formatDate(dateString) {
    if (!dateString) return "-";
    const date = new Date(dateString + "T00:00:00");
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  }

  /* ---------- USAHA (BUSINESS) ---------- */

  function getBusinesses() {
    return readArray(BUSINESS_KEY);
  }

  function saveBusinesses(businesses) {
    writeArray(BUSINESS_KEY, businesses);
  }

  function getActiveBusiness() {
    const businesses = getBusinesses();

    if (businesses.length === 0) {
      localStorage.removeItem(ACTIVE_KEY);
      return null;
    }

    const savedId = localStorage.getItem(ACTIVE_KEY);
    let active = businesses.find(b => idEqual(b.id, savedId));

    // Jika activeBusiness kosong / tidak valid, pakai usaha pertama.
    if (!active) {
      active = businesses[0];
      localStorage.setItem(ACTIVE_KEY, String(active.id));
    }

    return active;
  }

  function setActiveBusiness(id) {
    localStorage.setItem(ACTIVE_KEY, String(id));
  }

  /* ---------- USAHA <-> SUPABASE ----------
     Daftar usaha sekarang disimpan di server (Supabase). Browser
     hanya menyimpan salinan (cache) supaya semua halaman tetap bisa
     membaca usaha secara instan lewat getBusinesses().
     Usaha LAMA yang belum diimpor (id bukan UUID) tetap hidup di
     browser sampai diimpor lewat tombol di halaman Data Usaha.
     COA, transaksi, dsb. masih di browser (dipindah di tahap berikutnya). */

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const LOCAL_DATA_KEYS = [ACCOUNT_KEY, TRANSACTION_KEY, ADJUSTMENT_KEY, CLOSING_KEY, CONTRACT_KEY, RECOGNITION_KEY];

  function isUuid(id) {
    return UUID_RE.test(String(id || ""));
  }

  function getLegacyBusinesses() {
    return getBusinesses().filter(b => !isUuid(b.id));
  }

  function remoteClient() {
    if (!window.ERPAuth || !ERPAuth.client) {
      throw new Error("Layanan login belum termuat. Muat ulang halaman.");
    }
    return ERPAuth.client;
  }

  function friendlyError(error) {
    const message = String((error && error.message) || error || "");
    if (/failed to fetch|network/i.test(message)) {
      return "Tidak bisa terhubung ke server. Periksa koneksi internet lalu coba lagi.";
    }
    if (/uq_transactions_reference/i.test(message)) {
      return "Nomor invoice/referensi ini sudah dipakai transaksi lain di usaha ini. Ganti dengan nomor lain.";
    }
    if (/accounts_business_id_code_key/i.test(message)) {
      return "Kode akun tersebut sudah digunakan pada usaha ini.";
    }
    if (/duplicate key|23505/i.test(message)) {
      return "Data yang sama sudah ada di server (duplikat). Rincian: " + message;
    }
    if (/foreign key|23503/i.test(message)) {
      return "Data ini masih dipakai oleh data lain (misalnya akun yang sudah dipakai transaksi), jadi tidak bisa dihapus. Hapus atau ubah dulu data yang memakainya.";
    }
    if (/row-level security|violates row-level/i.test(message)) {
      return "Kamu tidak punya izin untuk mengubah data ini.";
    }
    if (/column/i.test(message) && /(group_name|is_cash)/i.test(message)) {
      return "Kolom baru di Supabase belum ditambahkan. Jalankan dulu SQL tahap COA, lalu coba lagi.";
    }
    return message || "Terjadi kesalahan.";
  }

  function businessFromRow(row) {
    return {
      id: row.id,
      name: row.name || "",
      address: row.address || "",
      period: row.period || "",
      periodStart: row.period_start_date || "",
      createdAt: row.created_at || ""
    };
  }

  async function fetchRemoteBusinesses() {
    const { data, error } = await remoteClient()
      .from("businesses")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data.map(businessFromRow);
  }

  // Tarik daftar usaha dari server ke cache. Hasil true kalau cache berubah.
  async function syncBusinesses() {
    try {
      const remote = await fetchRemoteBusinesses();
      const merged = getLegacyBusinesses().concat(remote);
      if (JSON.stringify(merged) === JSON.stringify(getBusinesses())) return false;
      saveBusinesses(merged);
      return true;
    } catch (error) {
      console.error("Gagal sinkron usaha:", error);
      return false;
    }
  }

  // Tulis isi usaha ke server (tanpa sinkron ulang).
  async function pushBusinessFields(id, fields) {
    const payload = {
      name: fields.name,
      address: fields.address || null,
      period: fields.period || null,
      period_start_date: fields.periodStart || null
    };
    if (fields.createdAt) payload.created_at = fields.createdAt;

    const { data, error } = await remoteClient()
      .from("businesses")
      .update(payload)
      .eq("id", id)
      .select();
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error("Perubahan ditolak: kamu bukan pemilik usaha ini.");
    }
  }

  async function createBusinessRemote(fields) {
    const { data: newId, error } = await remoteClient().rpc("create_business", {
      p_name: fields.name,
      p_address: fields.address || null
    });
    if (error) throw error;
    await pushBusinessFields(newId, fields);
    await syncBusinesses();
    return newId;
  }

  async function updateBusinessRemote(id, fields) {
    await pushBusinessFields(id, fields);
    await syncBusinesses();
  }

  async function deleteBusinessRemote(id) {
    const { data, error } = await remoteClient()
      .from("businesses")
      .delete()
      .eq("id", id)
      .select();
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error("Usaha tidak bisa dihapus (kamu bukan pemilik, atau sudah terhapus).");
    }
    await syncBusinesses();
    await syncAccounts();
    await syncTransactions();
    await syncOthers();
  }

  /* ---------- IMPOR DATA LAMA ---------- */

  // Unduh salinan semua data ERP di browser ini sebagai file cadangan.
  function downloadBackup() {
    const snapshot = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.indexOf("ilhamERP_") === 0) snapshot[key] = localStorage.getItem(key);
    }
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "ilham-erp-cadangan-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }

  // Ganti id usaha lama -> id baru di semua data lokal yang menempel pada usaha itu.
  function remapBusinessId(oldId, newId) {
    LOCAL_DATA_KEYS.forEach(key => {
      const list = readArray(key);
      let changed = false;
      list.forEach(item => {
        if (item && idEqual(item.businessId, oldId)) {
          item.businessId = newId;
          changed = true;
        }
      });
      if (changed) writeArray(key, list);
    });

    if (idEqual(localStorage.getItem(ACTIVE_KEY), oldId)) {
      localStorage.setItem(ACTIVE_KEY, String(newId));
    }
  }

  // Kirim usaha lama ke akun. Aman diulang: yang sudah berhasil tidak diproses lagi.
  async function importLegacyBusinesses() {
    const legacy = getLegacyBusinesses();
    if (legacy.length === 0) return { imported: 0 };

    const client = remoteClient();
    downloadBackup();

    let remote = await fetchRemoteBusinesses();
    let imported = 0;

    for (const business of legacy) {
      const fields = {
        name: business.name,
        address: business.address,
        period: business.period,
        periodStart: business.periodStart,
        createdAt: business.createdAt && !isNaN(new Date(business.createdAt)) ? business.createdAt : ""
      };

      // Pakai "Usaha Saya" bawaan pendaftaran kalau masih kosong, supaya tidak dobel.
      const placeholder = remote.find(r => r.name === "Usaha Saya" && !r.address && !r.period);
      let newId;

      if (placeholder) {
        newId = placeholder.id;
        remote = remote.filter(r => r.id !== newId);
      } else {
        const { data, error } = await client.rpc("create_business", {
          p_name: fields.name,
          p_address: fields.address || null
        });
        if (error) throw error;
        newId = data;
      }

      await pushBusinessFields(newId, fields);
      remapBusinessId(business.id, newId);
      saveBusinesses(getBusinesses().filter(b => !idEqual(b.id, business.id)));
      imported++;
    }

    await syncBusinesses();
    return { imported };
  }

  /* ---------- COA <-> SUPABASE ----------
     Tabel accounts di server memakai kolom: code, name, category
     (aset/kewajiban/ekuitas/pendapatan/beban), normal_balance
     (debit/kredit huruf kecil), plus dua kolom tambahan: group_name
     (kelompok lengkap ala ERP, mis. "Aset Lancar") dan is_cash.
     Browser hanya menyimpan salinan (cache) supaya semua halaman tetap
     membaca COA instan lewat getAccounts().
     Akun LAMA yang belum diimpor dikenali dari id-nya yang bukan UUID. */

  const DEFAULT_GROUP_OF_CATEGORY = {
    aset: "Aset Lancar",
    kewajiban: "Liabilitas Jangka Pendek",
    ekuitas: "Ekuitas",
    pendapatan: "Pendapatan",
    beban: "Beban"
  };

  function categoryOfGroup(group) {
    if (ASSET_GROUPS.includes(group)) return "aset";
    if (LIABILITY_GROUPS.includes(group)) return "kewajiban";
    if (EQUITY_GROUPS.includes(group)) return "ekuitas";
    if (REVENUE_GROUPS.includes(group)) return "pendapatan";
    if (EXPENSE_GROUPS.includes(group)) return "beban";
    return null;
  }

  function accountFromRow(row) {
    return {
      id: row.id,
      businessId: row.business_id,
      code: row.code,
      name: row.name,
      group: row.group_name || DEFAULT_GROUP_OF_CATEGORY[row.category] || "",
      normalBalance: row.normal_balance === "kredit" ? "Kredit" : "Debit",
      isCash: !!row.is_cash,
      createdAt: row.created_at || ""
    };
  }

  function accountToRow(businessId, account) {
    const category = categoryOfGroup(account.group);
    if (!category) {
      throw new Error('Kelompok akun "' + account.group + '" tidak dikenal (akun ' + account.code + ").");
    }
    return {
      business_id: businessId,
      code: String(account.code),
      name: account.name,
      category: category,
      group_name: account.group,
      normal_balance: account.normalBalance === "Kredit" ? "kredit" : "debit",
      is_cash: !!account.isCash
    };
  }

  function getLegacyAccounts() {
    return getAccounts().filter(a => !isUuid(a.id));
  }

  // Ambil semua akun dari server (per 1000 baris, batas bawaan Supabase).
  async function fetchRemoteAccounts() {
    const client = remoteClient();
    const size = 1000;
    const all = [];
    for (let from = 0; ; from += size) {
      const { data, error } = await client
        .from("accounts")
        .select("*")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + size - 1);
      if (error) throw error;
      all.push.apply(all, data);
      if (data.length < size) break;
    }
    return all.map(accountFromRow);
  }

  function accountsSignature(list) {
    return JSON.stringify(list.slice().sort((a, b) => String(a.id).localeCompare(String(b.id))));
  }

  // Tarik COA dari server ke cache. Hasil true kalau cache berubah.
  async function syncAccounts() {
    try {
      const remote = await fetchRemoteAccounts();
      const merged = getLegacyAccounts().concat(remote);
      if (accountsSignature(merged) === accountsSignature(getAccounts())) return false;
      saveAccounts(merged);
      return true;
    } catch (error) {
      console.error("Gagal sinkron COA:", error);
      return false;
    }
  }

  // Tambah banyak akun sekaligus (dipotong per 200 baris).
  async function createAccountsRemote(businessId, list) {
    const rows = list.map(a => accountToRow(businessId, a));
    const client = remoteClient();
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await client.from("accounts").insert(rows.slice(i, i + 200)).select();
      if (error) {
        await syncAccounts();
        throw error;
      }
    }
    await syncAccounts();
  }

  async function updateAccountRemote(id, fields) {
    const payload = accountToRow("x", fields);
    delete payload.business_id;
    const { data, error } = await remoteClient()
      .from("accounts")
      .update(payload)
      .eq("id", id)
      .select();
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error("Perubahan ditolak: kamu tidak punya izin atau akun sudah terhapus.");
    }
    await syncAccounts();
  }

  async function deleteAccountRemote(id) {
    const { data, error } = await remoteClient()
      .from("accounts")
      .delete()
      .eq("id", id)
      .select();
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error("Akun tidak bisa dihapus (kamu tidak punya izin, atau sudah terhapus).");
    }
    await syncAccounts();
  }

  // Ganti id akun lama -> id baru di semua data lokal yang menyimpan id akun.
  function remapAccountIds(map) {
    const has = (id) => Object.prototype.hasOwnProperty.call(map, String(id));

    [
      [TRANSACTION_KEY, ["debitAccountId", "creditAccountId"]],
      [ADJUSTMENT_KEY,  ["debitAccountId", "creditAccountId"]],
      [CLOSING_KEY,     ["debitAccountId", "creditAccountId"]],
      [CONTRACT_KEY,    ["revenueAccountId", "receivableAccountId"]]
    ].forEach(pair => {
      const list = readArray(pair[0]);
      let changed = false;
      list.forEach(item => {
        if (!item) return;
        pair[1].forEach(field => {
          if (item[field] !== undefined && item[field] !== null && has(item[field])) {
            item[field] = map[String(item[field])];
            changed = true;
          }
        });
      });
      if (changed) writeArray(pair[0], list);
    });

    // Pemetaan akun untuk impor kasir (transactions.html): { idUsaha: { kunci: idAkun } }
    try {
      const raw = localStorage.getItem("ilhamERP_importMap");
      if (raw) {
        const all = JSON.parse(raw);
        let changed = false;
        Object.keys(all).forEach(biz => {
          const m = all[biz];
          if (!m || typeof m !== "object") return;
          Object.keys(m).forEach(k => {
            if (m[k] !== undefined && m[k] !== null && has(m[k])) {
              m[k] = map[String(m[k])];
              changed = true;
            }
          });
        });
        if (changed) localStorage.setItem("ilhamERP_importMap", JSON.stringify(all));
      }
    } catch (error) {
      console.error("Gagal memperbarui pemetaan impor:", error);
    }
  }

  // Kirim akun lama ke server. Hanya akun milik usaha yang SUDAH diimpor
  // (businessId sudah UUID). Aman diulang: akun yang sudah ada di server
  // (usaha + kode sama) dipakai ulang, tidak dibuat dobel.
  async function importLegacyAccounts() {
    const legacy = getLegacyAccounts().filter(a => isUuid(a.businessId));
    if (legacy.length === 0) return { imported: 0, reused: 0 };

    const client = remoteClient();

    // Siapkan semua baris dulu supaya kesalahan data ketahuan sebelum ada yang terkirim.
    const prepared = legacy.map(a => {
      const isCash = a.isCash === undefined ? /\b(kas|bank|cash)\b/i.test(a.name || "") : !!a.isCash;
      const account = { ...a, isCash: isCash };
      return { old: a, row: accountToRow(a.businessId, account) };
    });

    downloadBackup();

    const keyOf = (businessId, code) => String(businessId) + "|" + String(code).toLowerCase();
    const remote = await fetchRemoteAccounts();
    const existing = {};
    remote.forEach(r => { existing[keyOf(r.businessId, r.code)] = r; });

    const map = {};
    const toInsert = [];
    let reused = 0;

    prepared.forEach(item => {
      const hit = existing[keyOf(item.row.business_id, item.row.code)];
      if (hit) {
        map[String(item.old.id)] = hit.id;
        reused++;
      } else {
        toInsert.push(item);
      }
    });

    for (let i = 0; i < toInsert.length; i += 200) {
      const chunk = toInsert.slice(i, i + 200);
      const { data, error } = await client
        .from("accounts")
        .insert(chunk.map(c => c.row))
        .select();
      if (error) throw error;

      data.forEach(row => {
        const item = chunk.find(c => keyOf(c.row.business_id, c.row.code) === keyOf(row.business_id, row.code));
        if (item) map[String(item.old.id)] = row.id;
      });
    }

    const missing = prepared.filter(item => !Object.prototype.hasOwnProperty.call(map, String(item.old.id)));
    if (missing.length > 0) {
      throw new Error(missing.length + " akun belum terbaca dari server. Tekan impor lagi.");
    }

    remapAccountIds(map);

    const doneIds = {};
    prepared.forEach(item => { doneIds[String(item.old.id)] = true; });
    saveAccounts(getAccounts().filter(a => !doneIds[String(a.id)]));

    await syncAccounts();
    return { imported: toInsert.length, reused: reused };
  }

  /* ---------- KEAMANAN SALINAN DATA DI BROWSER ----------
     Data asli ada di server (per akun). Browser hanya menyimpan salinan
     supaya cepat. Salinan itu dibersihkan saat Keluar, dan juga otomatis
     kalau akun yang login berbeda dari pemilik salinan sebelumnya.
     Pemetaan akun impor kasir (ilhamERP_importMap) sengaja dipertahankan:
     isinya hanya preferensi pemetaan, bukan angka keuangan. */

  const CACHE_OWNER_KEY = "ilhamERP_cacheOwner";
  const KEEP_ON_CLEAR = ["ilhamERP_importMap"];

  // Jumlah data lama (id bukan UUID) yang belum dikirim ke server.
  function countLegacyData() {
    return [getBusinesses, getAccounts, getTransactions, getAdjustments,
            getClosingEntries, getContracts, getRecognitions]
      .reduce((n, read) => n + read().filter(x => x && !isUuid(x.id)).length, 0);
  }

  function clearLocalCache() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.indexOf("ilhamERP_") === 0 && KEEP_ON_CLEAR.indexOf(key) === -1) keys.push(key);
    }
    keys.forEach(key => localStorage.removeItem(key));
    try { sessionStorage.removeItem("ilhamERP_syncReloadAt"); } catch (e) {}
  }

  // Dipanggil setelah login terverifikasi. true = salinan milik akun lain sudah dibersihkan.
  function ensureCacheOwner(user) {
    if (!user || !user.id) return false;

    const owner = localStorage.getItem(CACHE_OWNER_KEY);
    if (!owner) {
      // Pertama kali setelah pembaruan: salinan yang ada dianggap milik akun ini.
      localStorage.setItem(CACHE_OWNER_KEY, user.id);
      return false;
    }
    if (owner === user.id) return false;

    // Akun berbeda memakai browser ini: simpan cadangan kalau ada data lama, lalu bersihkan.
    if (countLegacyData() > 0) downloadBackup();
    clearLocalCache();
    localStorage.setItem(CACHE_OWNER_KEY, user.id);
    return true;
  }

  function signOutSafely() {
    const legacy = countLegacyData();
    if (legacy > 0) {
      const ok = confirm(
        "Masih ada " + legacy + " data lama di browser ini yang belum dikirim ke akunmu (usaha, COA, transaksi, dan lainnya).\n\n" +
        "Kalau keluar sekarang, data itu akan dihapus dari browser ini. File cadangan akan diunduh dulu.\n\n" +
        "Tekan OK untuk tetap keluar, atau Batal untuk kembali dan mengimpornya dulu."
      );
      if (!ok) return;
      downloadBackup();
    }
    clearLocalCache();
    ERPAuth.signOut();
  }

  /* ---------- CHART OF ACCOUNTS ---------- */

  function getAccounts() {
    return readArray(ACCOUNT_KEY);
  }

  function saveAccounts(accounts) {
    writeArray(ACCOUNT_KEY, accounts);
  }

  // Akun lama (sebelum businessId / isCash ada) otomatis dilengkapi.
  function migrateLegacyAccounts() {
    const business = getActiveBusiness();
    if (!business) return;

    const accounts = getAccounts();
    let changed = false;

    accounts.forEach(account => {
      if (account.businessId === undefined || account.businessId === null || account.businessId === "") {
        account.businessId = business.id;
        changed = true;
      }

      // Tandai otomatis akun Kas/Bank berdasarkan nama, kalau belum pernah diset manual.
      if (account.isCash === undefined) {
        account.isCash = /\b(kas|bank|cash)\b/i.test(account.name || "");
        changed = true;
      }
    });

    if (changed) saveAccounts(accounts);
  }

  function getActiveAccounts() {
    migrateLegacyAccounts();

    const business = getActiveBusiness();
    if (!business) return [];

    return getAccounts().filter(account => idEqual(account.businessId, business.id));
  }

  function getAccountById(id) {
    return getAccounts().find(account => idEqual(account.id, id)) || null;
  }

  /* ---------- TRANSAKSI ---------- */

  function getTransactions() {
    return readArray(TRANSACTION_KEY);
  }

  function saveTransactions(transactions) {
    writeArray(TRANSACTION_KEY, transactions);
  }

  function getActiveTransactions() {
    const business = getActiveBusiness();
    if (!business) return [];
    // Transaksi lama (tanpa status) dianggap posted. Draft/void tidak ikut laporan.
    return getTransactions().filter(t =>
      idEqual(t.businessId, business.id) && (t.status === undefined || t.status === "posted")
    );
  }

  /* ---------- TRANSAKSI <-> SUPABASE ----------
     Tabel transactions: trx_date, reference_no, description, amount,
     debit_account_id, credit_account_id (wajib akun UUID di tabel accounts),
     status (draft/posted/void), source (erp/telegram), raw_input (JSON).
     Transaksi yang dicatat di ERP masuk sebagai "posted". Penanda impor
     kasir (source "catatin"/"catatin-hpp" + sourceId) disimpan di raw_input.
     Transaksi LAMA yang belum diimpor dikenali dari id yang bukan UUID. */

  const IMPORT_TX_IDS_KEY = "ilhamERP_txImportIds";
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function newUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }

  function transactionFromRow(row) {
    const raw = row.raw_input && typeof row.raw_input === "object" ? row.raw_input : {};
    const t = {
      id: row.id,
      businessId: row.business_id,
      date: row.trx_date,
      invoice: row.reference_no || raw.invoice || "",
      description: row.description || "",
      debitAccountId: row.debit_account_id,
      creditAccountId: row.credit_account_id,
      amount: Number(row.amount) || 0,
      status: row.status,
      createdAt: row.created_at || ""
    };
    if (!row.reference_no && raw.invoice) t.refInRaw = true;
    if (raw.erpSource) t.source = raw.erpSource;
    else if (row.source && row.source !== "erp") t.source = row.source;
    if (raw.sourceId) t.sourceId = raw.sourceId;
    return t;
  }

  function checkTransactionFields(t) {
    if (!DATE_RE.test(String(t.date || ""))) throw new Error("Tanggal transaksi tidak valid.");
    if (!(Number(t.amount) > 0)) throw new Error("Jumlah transaksi harus lebih dari nol.");
    if (!isUuid(t.debitAccountId) || !isUuid(t.creditAccountId)) {
      throw new Error("Akun transaksi harus akun yang sudah ada di server. Impor COA lama dulu di menu Chart of Accounts.");
    }
    if (idEqual(t.debitAccountId, t.creditAccountId)) throw new Error("Akun Debit dan Kredit tidak boleh sama.");
  }

  function transactionToRow(businessId, t) {
    checkTransactionFields(t);

    const row = {
      business_id: businessId,
      trx_date: t.date,
      reference_no: t.invoice ? String(t.invoice) : null,
      description: t.description || "-",
      amount: Number(t.amount),
      debit_account_id: t.debitAccountId,
      credit_account_id: t.creditAccountId,
      status: "posted",
      source: "erp"
    };

    const created = t.createdAt && !isNaN(new Date(t.createdAt).getTime()) ? new Date(t.createdAt).toISOString() : "";
    if (created) row.created_at = created;
    row.posted_at = created || new Date().toISOString();

    if (isUuid(t.id)) row.id = t.id;

    if (t.source || t.sourceId) {
      row.raw_input = {};
      if (t.source) row.raw_input.erpSource = t.source;
      if (t.sourceId) row.raw_input.sourceId = t.sourceId;
    }

    const user = window.ERPAuth && ERPAuth.getUser ? ERPAuth.getUser() : null;
    if (user && user.id) row.created_by = user.id;

    return row;
  }

  // Server mewajibkan (usaha + nomor referensi) unik. Untuk impor massal,
  // nomor yang sudah terpakai disimpan di raw_input.invoice (tetap tampil di
  // ERP) dan kolom reference_no dikosongkan.
  function referenceKey(businessId, ref) {
    return String(businessId) + "|" + String(ref);
  }

  function takenReferences(remoteList) {
    const taken = {};
    remoteList.forEach(t => {
      if (t.invoice && !t.refInRaw) taken[referenceKey(t.businessId, t.invoice)] = true;
    });
    return taken;
  }

  function dedupeRowReferences(rows, taken) {
    rows.forEach(row => {
      const ref = row.reference_no;
      if (!ref) return;
      const key = referenceKey(row.business_id, ref);
      if (taken[key]) {
        row.raw_input = Object.assign({}, row.raw_input || {}, { invoice: ref });
        row.reference_no = null;
      } else {
        taken[key] = true;
      }
    });
  }

  function getLegacyTransactions() {
    return getTransactions().filter(t => !isUuid(t.id));
  }

  async function fetchRemoteTransactions() {
    const client = remoteClient();
    const size = 1000;
    const all = [];
    for (let from = 0; ; from += size) {
      const { data, error } = await client
        .from("transactions")
        .select("*")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + size - 1);
      if (error) throw error;
      all.push.apply(all, data);
      if (data.length < size) break;
    }
    return all.map(transactionFromRow);
  }

  function transactionsSignature(list) {
    return JSON.stringify(list.slice().sort((a, b) => String(a.id).localeCompare(String(b.id))));
  }

  // Tarik transaksi dari server ke cache. Hasil true kalau cache berubah.
  async function syncTransactions() {
    try {
      const remote = await fetchRemoteTransactions();
      const merged = getLegacyTransactions().concat(remote);
      if (transactionsSignature(merged) === transactionsSignature(getTransactions())) return false;
      saveTransactions(merged);
      return true;
    } catch (error) {
      console.error("Gagal sinkron transaksi:", error);
      return false;
    }
  }

  async function insertTransactionRows(rows) {
    const client = remoteClient();
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await client.from("transactions").insert(rows.slice(i, i + 200)).select();
      if (error) throw error;
    }
  }

  // Tambah transaksi baru (bentuk data sama seperti di ERP) sebagai posted.
  async function createTransactionsRemote(businessId, list, options) {
    const rows = list.map(t => transactionToRow(businessId, { ...t, id: null }));
    if (options && options.dedupeReferences) {
      dedupeRowReferences(rows, takenReferences(getTransactions().filter(t => isUuid(t.id))));
    }
    try {
      await insertTransactionRows(rows);
    } catch (error) {
      await syncTransactions();
      throw error;
    }
    await syncTransactions();
  }

  async function updateTransactionRemote(id, fields) {
    checkTransactionFields(fields);
    const cur = getTransactions().find(t => idEqual(t.id, id)) || null;
    const payload = {
      trx_date: fields.date,
      description: fields.description || "-",
      amount: Number(fields.amount),
      debit_account_id: fields.debitAccountId,
      credit_account_id: fields.creditAccountId
    };
    // Nomor yang tersimpan di raw_input (karena kembar) tidak disentuh kalau tidak diubah.
    const keepRawRef = !!(cur && cur.refInRaw && String(fields.invoice || "") === String(cur.invoice || ""));
    if (!keepRawRef) {
      payload.reference_no = fields.invoice ? String(fields.invoice) : null;
      if (cur && cur.refInRaw) {
        const raw = {};
        if (cur.source) raw.erpSource = cur.source;
        if (cur.sourceId) raw.sourceId = cur.sourceId;
        payload.raw_input = Object.keys(raw).length ? raw : null;
      }
    }
    const { data, error } = await remoteClient()
      .from("transactions")
      .update(payload)
      .eq("id", id)
      .select();
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error("Perubahan ditolak: kamu tidak punya izin atau transaksi sudah terhapus.");
    }
    await syncTransactions();
  }

  async function deleteTransactionRemote(id) {
    const { data, error } = await remoteClient()
      .from("transactions")
      .delete()
      .eq("id", id)
      .select();
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error("Transaksi tidak bisa dihapus (kamu tidak punya izin, atau sudah terhapus).");
    }
    await syncTransactions();
  }

  // Pilah transaksi lama: siap diimpor / menunggu usaha-atau-COA diimpor / tidak valid.
  function splitLegacyTransactions() {
    const ready = [], waiting = [], invalid = [];
    const knownAccounts = {};
    getAccounts().forEach(a => { knownAccounts[String(a.id)] = true; });

    getLegacyTransactions().forEach(t => {
      const shapeOk = DATE_RE.test(String(t.date || "")) && Number(t.amount) > 0 &&
        t.debitAccountId && t.creditAccountId && !idEqual(t.debitAccountId, t.creditAccountId);

      // Akun yang tidak ada sama sekali (baik lokal maupun di server) tidak akan pernah bisa diimpor.
      if (!shapeOk || !knownAccounts[String(t.debitAccountId)] || !knownAccounts[String(t.creditAccountId)]) invalid.push(t);
      else if (!isUuid(t.businessId) || !isUuid(t.debitAccountId) || !isUuid(t.creditAccountId)) waiting.push(t);
      else ready.push(t);
    });

    return { ready, waiting, invalid };
  }

  // Kirim transaksi lama ke server. Aman diulang: tiap transaksi diberi id
  // server tetap (disimpan sementara), jadi yang sudah terkirim tidak dobel.
  async function importLegacyTransactions() {
    const split = splitLegacyTransactions();
    const ready = split.ready;
    const result = { imported: 0, reused: 0, waiting: split.waiting.length, invalid: split.invalid.length };
    if (ready.length === 0) return result;

    // Siapkan semua baris dulu supaya data yang salah ketahuan sebelum ada yang terkirim.
    let pending = {};
    try { pending = JSON.parse(localStorage.getItem(IMPORT_TX_IDS_KEY) || "{}") || {}; } catch (e) { pending = {}; }

    const prepared = ready.map(t => {
      if (!pending[String(t.id)]) pending[String(t.id)] = newUuid();
      const row = transactionToRow(t.businessId, { ...t, id: pending[String(t.id)] });
      return { old: t, row: row };
    });
    localStorage.setItem(IMPORT_TX_IDS_KEY, JSON.stringify(pending));

    downloadBackup();

    const remote = await fetchRemoteTransactions();
    const existing = {};
    remote.forEach(r => { existing[String(r.id)] = true; });

    const toInsert = prepared.filter(item => !existing[item.row.id]);
    result.reused = prepared.length - toInsert.length;

    dedupeRowReferences(toInsert.map(item => item.row), takenReferences(remote));

    await insertTransactionRows(toInsert.map(item => item.row));
    result.imported = toInsert.length;

    const doneIds = {};
    prepared.forEach(item => {
      doneIds[String(item.old.id)] = true;
      delete pending[String(item.old.id)];
    });
    saveTransactions(getTransactions().filter(t => !doneIds[String(t.id)]));
    localStorage.setItem(IMPORT_TX_IDS_KEY, JSON.stringify(pending));

    await syncTransactions();
    return result;
  }

  /* ---------- JURNAL PENYESUAIAN / PENUTUP / PSAK 115 <-> SUPABASE ----------
     Empat tabel baru: adjustments, closing_entries, revenue_contracts,
     revenue_recognitions. Pola sama seperti COA dan transaksi: browser hanya
     menyimpan salinan (cache); data lama (id bukan UUID) tetap di browser
     sampai diimpor. Semua akun yang dipakai harus akun UUID di server. */

  function userIdOrNull() {
    const user = window.ERPAuth && ERPAuth.getUser ? ERPAuth.getUser() : null;
    return user && user.id ? user.id : null;
  }

  function commonRowFields(item) {
    const row = {};
    if (isUuid(item.id)) row.id = item.id;
    const created = item.createdAt && !isNaN(new Date(item.createdAt).getTime()) ? new Date(item.createdAt).toISOString() : "";
    if (created) row.created_at = created;
    const uid = userIdOrNull();
    if (uid) row.created_by = uid;
    return row;
  }

  function makeStore(cfg) {
    function all() { return readArray(cfg.key); }
    function save(list) { writeArray(cfg.key, list); }
    function legacy() { return all().filter(x => !isUuid(x.id)); }

    async function fetchAll() {
      const client = remoteClient();
      const size = 1000;
      const out = [];
      for (let from = 0; ; from += size) {
        const { data, error } = await client
          .from(cfg.table)
          .select("*")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + size - 1);
        if (error) throw error;
        out.push.apply(out, data);
        if (data.length < size) break;
      }
      return out.map(cfg.fromRow);
    }

    function signature(list) {
      return JSON.stringify(list.slice().sort((a, b) => String(a.id).localeCompare(String(b.id))));
    }

    async function sync() {
      try {
        const remote = await fetchAll();
        const merged = legacy().concat(remote);
        if (signature(merged) === signature(all())) return false;
        save(merged);
        return true;
      } catch (error) {
        console.error("Gagal sinkron " + cfg.table + ":", error);
        return false;
      }
    }

    async function insertRows(rows) {
      const client = remoteClient();
      const out = [];
      for (let i = 0; i < rows.length; i += 200) {
        const { data, error } = await client.from(cfg.table).insert(rows.slice(i, i + 200)).select();
        if (error) throw error;
        out.push.apply(out, data || []);
      }
      return out;
    }

    async function createMany(businessId, list) {
      const rows = list.map(x => cfg.toRow(businessId, { ...x, id: null }));
      let created;
      try {
        created = await insertRows(rows);
      } catch (error) {
        await sync();
        throw error;
      }
      await sync();
      return created.map(cfg.fromRow);
    }

    async function update(id, fields) {
      const { data, error } = await remoteClient()
        .from(cfg.table)
        .update(cfg.toUpdate(fields))
        .eq("id", id)
        .select();
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Perubahan ditolak: kamu tidak punya izin atau data sudah terhapus.");
      }
      await sync();
    }

    async function remove(id) {
      const { data, error } = await remoteClient()
        .from(cfg.table)
        .delete()
        .eq("id", id)
        .select();
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Data tidak bisa dihapus (kamu tidak punya izin, atau sudah terhapus).");
      }
      await sync();
    }

    async function removeWhere(column, value) {
      const { error } = await remoteClient().from(cfg.table).delete().eq(column, value).select();
      if (error) throw error;
    }

    return { all, save, legacy, fetchAll, sync, insertRows, createMany, update, remove, removeWhere, toRow: cfg.toRow };
  }

  function checkJournalFields(t) {
    if (!DATE_RE.test(String(t.date || ""))) throw new Error("Tanggal tidak valid.");
    if (!(Number(t.amount) > 0)) throw new Error("Nominal harus lebih dari nol.");
    if (!isUuid(t.debitAccountId) || !isUuid(t.creditAccountId)) {
      throw new Error("Akun harus akun yang sudah ada di server. Impor COA lama dulu di menu Chart of Accounts.");
    }
    if (idEqual(t.debitAccountId, t.creditAccountId)) throw new Error("Akun Debit dan Kredit tidak boleh sama.");
  }

  function journalFromRow(dateColumn) {
    return function (row) {
      return {
        id: row.id,
        businessId: row.business_id,
        date: row[dateColumn],
        reference: row.reference_no || "",
        description: row.description || "",
        debitAccountId: row.debit_account_id,
        creditAccountId: row.credit_account_id,
        amount: Number(row.amount) || 0,
        createdAt: row.created_at || ""
      };
    };
  }

  function journalToRow(dateColumn) {
    return function (businessId, t) {
      checkJournalFields(t);
      const row = {
        business_id: businessId,
        reference_no: t.reference ? String(t.reference) : null,
        description: t.description || "-",
        amount: Number(t.amount),
        debit_account_id: t.debitAccountId,
        credit_account_id: t.creditAccountId
      };
      row[dateColumn] = t.date;
      return Object.assign(row, commonRowFields(t));
    };
  }

  function journalToUpdate(dateColumn) {
    return function (t) {
      checkJournalFields(t);
      const payload = {
        reference_no: t.reference ? String(t.reference) : null,
        description: t.description || "-",
        amount: Number(t.amount),
        debit_account_id: t.debitAccountId,
        credit_account_id: t.creditAccountId
      };
      payload[dateColumn] = t.date;
      return payload;
    };
  }

  const adjustmentsStore = makeStore({
    table: "adjustments", key: ADJUSTMENT_KEY,
    fromRow: journalFromRow("adj_date"), toRow: journalToRow("adj_date"), toUpdate: journalToUpdate("adj_date")
  });

  const closingStore = makeStore({
    table: "closing_entries", key: CLOSING_KEY,
    fromRow: journalFromRow("closing_date"), toRow: journalToRow("closing_date"), toUpdate: journalToUpdate("closing_date")
  });

  function checkContractFields(c) {
    if (!c.name) throw new Error("Nama kontrak wajib diisi.");
    if (!(Number(c.totalValue) > 0)) throw new Error("Nilai kontrak harus lebih dari nol.");
    if (c.startDate && !DATE_RE.test(String(c.startDate))) throw new Error("Tanggal mulai tidak valid.");
    if (!isUuid(c.revenueAccountId) || !isUuid(c.receivableAccountId)) {
      throw new Error("Akun harus akun yang sudah ada di server. Impor COA lama dulu di menu Chart of Accounts.");
    }
    if (idEqual(c.revenueAccountId, c.receivableAccountId)) throw new Error("Akun Pendapatan dan Akun Piutang/Aset tidak boleh sama.");
  }

  const contractsStore = makeStore({
    table: "revenue_contracts", key: CONTRACT_KEY,
    fromRow: function (row) {
      return {
        id: row.id,
        businessId: row.business_id,
        name: row.name || "",
        totalValue: Number(row.total_value) || 0,
        revenueAccountId: row.revenue_account_id,
        receivableAccountId: row.receivable_account_id,
        startDate: row.start_date || "",
        createdAt: row.created_at || ""
      };
    },
    toRow: function (businessId, c) {
      checkContractFields(c);
      return Object.assign({
        business_id: businessId,
        name: c.name,
        total_value: Number(c.totalValue),
        revenue_account_id: c.revenueAccountId,
        receivable_account_id: c.receivableAccountId,
        start_date: c.startDate || null
      }, commonRowFields(c));
    },
    toUpdate: function (c) {
      checkContractFields(c);
      return {
        name: c.name,
        total_value: Number(c.totalValue),
        revenue_account_id: c.revenueAccountId,
        receivable_account_id: c.receivableAccountId,
        start_date: c.startDate || null
      };
    }
  });

  const recognitionsStore = makeStore({
    table: "revenue_recognitions", key: RECOGNITION_KEY,
    fromRow: function (row) {
      return {
        id: row.id,
        businessId: row.business_id,
        contractId: row.contract_id,
        date: row.recognition_date,
        percentage: Number(row.percentage).toFixed(2),
        amount: Number(row.amount) || 0,
        createdAt: row.created_at || ""
      };
    },
    toRow: function (businessId, r) {
      if (!isUuid(r.contractId)) throw new Error("Kontrak harus sudah ada di server.");
      if (!DATE_RE.test(String(r.date || ""))) throw new Error("Tanggal pengakuan tidak valid.");
      if (!(Number(r.amount) > 0)) throw new Error("Jumlah pengakuan harus lebih dari nol.");
      return Object.assign({
        business_id: businessId,
        contract_id: r.contractId,
        recognition_date: r.date,
        // Server mewajibkan persen > 0; kenaikan yang sangat kecil dibulatkan ke 0,01 (hanya tampilan).
        percentage: Math.max(Number(r.percentage) || 0, 0.01),
        amount: Number(r.amount)
      }, commonRowFields(r));
    },
    toUpdate: function () { throw new Error("Pengakuan pendapatan tidak bisa diubah."); }
  });

  function syncOthers() {
    return Promise.all([adjustmentsStore.sync(), closingStore.sync(), contractsStore.sync(), recognitionsStore.sync()])
      .then(r => r.some(Boolean));
  }

  // Pilah data lama: siap diimpor / menunggu usaha-atau-COA / tidak valid.
  function splitLegacyJournalData() {
    const known = {};
    getAccounts().forEach(a => { known[String(a.id)] = true; });

    const blank = () => ({ ready: [], waiting: [], invalid: [] });
    const res = { adjustments: blank(), closing: blank(), contracts: blank(), recognitions: blank() };

    function classifyJournal(t, bucket) {
      const shapeOk = DATE_RE.test(String(t.date || "")) && Number(t.amount) > 0 &&
        t.debitAccountId && t.creditAccountId && !idEqual(t.debitAccountId, t.creditAccountId);
      if (!shapeOk || !known[String(t.debitAccountId)] || !known[String(t.creditAccountId)]) bucket.invalid.push(t);
      else if (!isUuid(t.businessId) || !isUuid(t.debitAccountId) || !isUuid(t.creditAccountId)) bucket.waiting.push(t);
      else bucket.ready.push(t);
    }

    adjustmentsStore.legacy().forEach(t => classifyJournal(t, res.adjustments));
    closingStore.legacy().forEach(t => classifyJournal(t, res.closing));

    contractsStore.legacy().forEach(c => {
      const shapeOk = Number(c.totalValue) > 0 && c.name && c.revenueAccountId && c.receivableAccountId &&
        !idEqual(c.revenueAccountId, c.receivableAccountId) && (!c.startDate || DATE_RE.test(String(c.startDate)));
      if (!shapeOk || !known[String(c.revenueAccountId)] || !known[String(c.receivableAccountId)]) res.contracts.invalid.push(c);
      else if (!isUuid(c.businessId) || !isUuid(c.revenueAccountId) || !isUuid(c.receivableAccountId)) res.contracts.waiting.push(c);
      else res.contracts.ready.push(c);
    });

    const allContracts = contractsStore.all();
    const readyContract = {}, waitingContract = {};
    res.contracts.ready.forEach(c => { readyContract[String(c.id)] = true; });
    res.contracts.waiting.forEach(c => { waitingContract[String(c.id)] = true; });

    recognitionsStore.legacy().forEach(r => {
      const shapeOk = DATE_RE.test(String(r.date || "")) && Number(r.amount) > 0;
      const contract = allContracts.find(c => idEqual(c.id, r.contractId));
      if (!shapeOk || !contract) res.recognitions.invalid.push(r);
      else if (!isUuid(r.businessId)) res.recognitions.waiting.push(r);
      else if (isUuid(contract.id) || readyContract[String(contract.id)]) res.recognitions.ready.push(r);
      else if (waitingContract[String(contract.id)]) res.recognitions.waiting.push(r);
      else res.recognitions.invalid.push(r);
    });

    return res;
  }

  const IMPORT_OTHER_IDS_KEY = "ilhamERP_otherImportIds";

  // Kirim semua data lama yang siap ke server. Aman diulang: tiap data diberi
  // id server tetap (disimpan sementara), jadi yang sudah terkirim tidak dobel.
  async function importLegacyJournalData() {
    const split = splitLegacyJournalData();
    const counts = { adjustments: 0, closing: 0, contracts: 0, recognitions: 0, reused: 0 };
    const totalReady = split.adjustments.ready.length + split.closing.ready.length +
      split.contracts.ready.length + split.recognitions.ready.length;
    if (totalReady === 0) return counts;

    let pending = {};
    try { pending = JSON.parse(localStorage.getItem(IMPORT_OTHER_IDS_KEY) || "{}") || {}; } catch (e) { pending = {}; }
    const pid = (kind, oldId) => {
      const k = kind + ":" + oldId;
      if (!pending[k]) pending[k] = newUuid();
      return pending[k];
    };

    // Siapkan semua baris dulu supaya data yang salah ketahuan sebelum ada yang terkirim.
    const plan = [
      { kind: "contracts", store: contractsStore, items: split.contracts.ready },
      { kind: "recognitions", store: recognitionsStore, items: split.recognitions.ready },
      { kind: "adjustments", store: adjustmentsStore, items: split.adjustments.ready },
      { kind: "closing", store: closingStore, items: split.closing.ready }
    ];

    plan.forEach(step => {
      step.prepared = step.items.map(item => {
        const copy = { ...item, id: pid(step.kind, item.id) };
        if (step.kind === "recognitions") {
          copy.contractId = isUuid(item.contractId) ? item.contractId : pid("contracts", item.contractId);
        }
        return { old: item, row: step.store.toRow(item.businessId, copy) };
      });
    });
    localStorage.setItem(IMPORT_OTHER_IDS_KEY, JSON.stringify(pending));

    downloadBackup();

    for (const step of plan) {
      if (step.prepared.length === 0) continue;
      const remote = await step.store.fetchAll();
      const existing = {};
      remote.forEach(r => { existing[String(r.id)] = true; });
      const toInsert = step.prepared.filter(x => !existing[x.row.id]);
      counts.reused += step.prepared.length - toInsert.length;
      await step.store.insertRows(toInsert.map(x => x.row));
      counts[step.kind] = toInsert.length;
    }

    plan.forEach(step => {
      if (step.prepared.length === 0) return;
      const done = {};
      step.prepared.forEach(x => {
        done[String(x.old.id)] = true;
        delete pending[step.kind + ":" + x.old.id];
      });
      step.store.save(step.store.all().filter(x => !done[String(x.id)]));
    });
    localStorage.setItem(IMPORT_OTHER_IDS_KEY, JSON.stringify(pending));

    await syncOthers();
    return counts;
  }

  // Kartu "Data Lama di Perangkat Ini" yang dipasang otomatis di atas halaman.
  function mountLegacyImportCard(onDone) {
    const host = document.querySelector("main.content");
    if (!host) return function () {};

    const card = document.createElement("div");
    card.className = "card";
    card.style.display = "none";
    card.innerHTML =
      '<h2>Data Lama di Perangkat Ini</h2>' +
      '<p class="card-sub" data-role="text"></p>' +
      '<button type="button" class="btn-save" data-role="button">Impor Data Lama ke Akun</button>';
    host.insertBefore(card, host.firstChild);

    const textEl = card.querySelector('[data-role="text"]');
    const button = card.querySelector('[data-role="button"]');

    function refresh() {
      const split = splitLegacyJournalData();
      const labels = [["adjustments", "jurnal penyesuaian"], ["closing", "jurnal penutup"],
                      ["contracts", "kontrak PSAK 115"], ["recognitions", "pengakuan pendapatan"]];
      const ready = labels.filter(l => split[l[0]].ready.length > 0)
        .map(l => split[l[0]].ready.length + " " + l[1]);

      if (ready.length === 0) {
        card.style.display = "none";
        return;
      }

      const waiting = labels.reduce((n, l) => n + split[l[0]].waiting.length, 0);
      const invalid = labels.reduce((n, l) => n + split[l[0]].invalid.length, 0);

      let text = "Masih tersimpan di browser ini saja: " + ready.join(", ") + ". " +
        "Impor ke akunmu supaya tersimpan di server. File cadangan akan terunduh otomatis sebelum impor dimulai.";
      if (waiting > 0) text += " (" + waiting + " data lain menunggu usaha atau COA-nya diimpor dulu.)";
      if (invalid > 0) text += " (" + invalid + " data tidak bisa diimpor karena tidak lengkap atau akunnya sudah tidak ada; tetap aman di browser ini.)";
      textEl.textContent = text;
      card.style.display = "block";
    }

    button.addEventListener("click", async function () {
      const confirmed = confirm("Sebelum mengimpor, file cadangan data ERP akan terunduh otomatis ke perangkatmu.\n\nLanjutkan impor data lama ke akunmu?");
      if (!confirmed) return;

      button.disabled = true;
      button.textContent = "Mengimpor...";
      try {
        const c = await importLegacyJournalData();
        alert("Berhasil: " + c.adjustments + " jurnal penyesuaian, " + c.closing + " jurnal penutup, " +
          c.contracts + " kontrak, " + c.recognitions + " pengakuan pendapatan dikirim ke server" +
          (c.reused ? " (" + c.reused + " sudah ada di server dan dipakai ulang)" : "") + ".");
      } catch (error) {
        alert("Impor belum selesai: " + friendlyError(error) +
          "\n\nData lamamu masih aman. Kamu bisa menekan tombol Impor lagi.");
      } finally {
        button.disabled = false;
        button.textContent = "Impor Data Lama ke Akun";
        refresh();
        if (typeof onDone === "function") onDone();
      }
    });

    refresh();
    return refresh;
  }

  /* ---------- JURNAL PENYESUAIAN ---------- */

  function getAdjustments() {
    return readArray(ADJUSTMENT_KEY);
  }

  function saveAdjustments(adjustments) {
    writeArray(ADJUSTMENT_KEY, adjustments);
  }

  function getActiveAdjustments() {
    const business = getActiveBusiness();
    if (!business) return [];
    return getAdjustments().filter(a => idEqual(a.businessId, business.id));
  }

  /* ---------- PSAK 115: PENGAKUAN PENDAPATAN BERTAHAP ----------
     Kontrak dicatat terpisah dari transaksi biasa. Tiap kali user
     "mengakui" pendapatan (berdasarkan % penyelesaian), tercipta
     satu baris "recognition" yang otomatis ikut masuk sebagai
     jurnal (Debit Piutang Kontrak, Kredit Pendapatan) lewat
     getActiveJournalEntries(), sehingga langsung tercermin di
     Buku Besar, Neraca Saldo, dan Laporan Keuangan. */

  function getContracts() {
    return readArray(CONTRACT_KEY);
  }

  function saveContracts(contracts) {
    writeArray(CONTRACT_KEY, contracts);
  }

  function getActiveContracts() {
    const business = getActiveBusiness();
    if (!business) return [];
    return getContracts().filter(c => idEqual(c.businessId, business.id));
  }

  function getRecognitions() {
    return readArray(RECOGNITION_KEY);
  }

  function saveRecognitions(recognitions) {
    writeArray(RECOGNITION_KEY, recognitions);
  }

  function getActiveRecognitions() {
    const business = getActiveBusiness();
    if (!business) return [];
    return getRecognitions().filter(r => idEqual(r.businessId, business.id));
  }

  function getContractRecognitions(contractId) {
    return getActiveRecognitions()
      .filter(r => idEqual(r.contractId, contractId))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  // Total yang sudah diakui (kumulatif) untuk satu kontrak.
  function getContractRecognizedTotal(contractId) {
    return getContractRecognitions(contractId)
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  }

  /* ---------- GABUNGAN JURNAL (Transaksi + Penyesuaian + PSAK 115) ----------
     Dipakai oleh Buku Besar, Neraca Saldo, dan Laporan Keuangan supaya
     semuanya konsisten mencerminkan saldo SETELAH penyesuaian dan
     pendapatan yang sudah diakui. Jurnal Umum tetap menampilkan
     transaksi harian saja (sesuai siklus akuntansi klasik). Jurnal
     Penutup TIDAK dimasukkan di sini secara sengaja — penutupan baru
     terjadi setelah Laporan Keuangan selesai disusun. */

  function getActiveJournalEntries() {
    const transactions = getActiveTransactions().map(t => ({
      id: t.id,
      date: t.date,
      reference: t.invoice || "-",
      description: t.description,
      debitAccountId: t.debitAccountId,
      creditAccountId: t.creditAccountId,
      amount: Number(t.amount) || 0,
      source: "Transaksi"
    }));

    const adjustments = getActiveAdjustments().map(a => ({
      id: a.id,
      date: a.date,
      reference: a.reference || "-",
      description: a.description,
      debitAccountId: a.debitAccountId,
      creditAccountId: a.creditAccountId,
      amount: Number(a.amount) || 0,
      source: "Penyesuaian"
    }));

    const contracts = getActiveContracts();
    const recognitions = getActiveRecognitions().map(r => {
      const contract = contracts.find(c => idEqual(c.id, r.contractId));
      return {
        id: r.id,
        date: r.date,
        reference: contract ? contract.name : "Kontrak",
        description: `Pengakuan pendapatan ${r.percentage}% - ${contract ? contract.name : "Kontrak"}`,
        debitAccountId: contract ? contract.receivableAccountId : null,
        creditAccountId: contract ? contract.revenueAccountId : null,
        amount: Number(r.amount) || 0,
        source: "PSAK 115"
      };
    }).filter(r => r.debitAccountId && r.creditAccountId);

    return transactions.concat(adjustments, recognitions);
  }

  /* ---------- PERIODE AKUNTANSI BERJALAN ----------
     business.periodStart (opsional, format YYYY-MM-DD) menandai kapan
     periode akuntansi yang sedang berjalan dimulai. Kalau kosong,
     seluruh riwayat dianggap satu periode (perilaku lama, tidak berubah).
     Laporan BERSALDO/KUMULATIF (Neraca Saldo, Buku Besar, Neraca) tetap
     memakai seluruh riwayat — itu benar secara akuntansi. Laporan
     BERJALAN/PERIODE (Laba Rugi, Arus Kas, Perubahan Ekuitas, Jurnal
     Umum, Jurnal Penutup) memakai entri yang sudah difilter lewat
     getCurrentPeriodEntries() / filterEntriesFromDate(). */

  function getPeriodStart(business) {
    if (!business || !business.periodStart) return null;
    return business.periodStart;
  }

  function filterEntriesFromDate(entries, fromDate) {
    if (!fromDate) return entries.slice();
    return entries.filter(e => String(e.date) >= String(fromDate));
  }

  // Entri jurnal (Transaksi + Penyesuaian + PSAK 115) milik periode
  // berjalan usaha aktif saja. Kalau periodStart belum diisi, hasilnya
  // sama seperti getActiveJournalEntries() (seluruh riwayat).
  function getCurrentPeriodEntries() {
    const business = getActiveBusiness();
    return filterEntriesFromDate(getActiveJournalEntries(), getPeriodStart(business));
  }

  // Teks singkat untuk ditampilkan di laporan-laporan periode, supaya
  // jelas rentang data yang sedang dihitung.
  function periodLabel(business) {
    const start = getPeriodStart(business);
    if (!start) return "Menghitung seluruh riwayat transaksi (belum ada tanggal mulai periode yang diatur di Data Usaha).";
    return `Periode berjalan: sejak ${formatDate(start)} sampai hari ini.`;
  }


  /* ---------- JURNAL PENUTUP ----------
     Menutup akun nominal (Pendapatan & Beban) ke akun Ekuitas
     yang dipilih. Karena satu entri di sistem ini hanya berisi
     1 akun Debit + 1 akun Kredit, penutupan dilakukan LANGSUNG
     per akun nominal ke akun Ekuitas (tanpa akun perantara
     "Ikhtisar Laba Rugi"), yang secara matematis menghasilkan
     efek akhir yang sama. Setiap kali dijalankan, seluruh jurnal
     penutup lama untuk usaha aktif diganti dengan yang baru
     (karena sistem ini belum mengenal batas periode yang terkunci). */

  function getClosingEntries() {
    return readArray(CLOSING_KEY);
  }

  function saveClosingEntries(entries) {
    writeArray(CLOSING_KEY, entries);
  }

  function getActiveClosingEntries() {
    const business = getActiveBusiness();
    if (!business) return [];
    return getClosingEntries().filter(e => idEqual(e.businessId, business.id));
  }

  // Hitung jurnal penutup (tidak menyimpan apa pun).
  function buildClosingEntries(targetEquityAccountId) {
    const business = getActiveBusiness();
    if (!business) return [];

    const accounts = getActiveAccounts();
    const entries = getCurrentPeriodEntries();
    const balances = computeAccountBalances(accounts, entries);

    const newEntries = [];
    const nominalAccounts = accounts.filter(a => NOMINAL_GROUPS.includes(a.group));

    nominalAccounts.forEach(account => {
      const balance = balances[String(account.id)] || 0;
      if (Math.abs(balance) < 0.01) return;

      const isRevenue = REVENUE_GROUPS.includes(account.group);

      // Pendapatan (normal Kredit): saldo positif -> Debit akun ini, Kredit Ekuitas.
      // Beban (normal Debit): saldo positif -> Debit Ekuitas, Kredit akun ini.
      // Kalau saldo negatif (kasus tidak umum), arahnya dibalik.
      let debitAccountId, creditAccountId, amount;

      if (isRevenue) {
        if (balance > 0) {
          debitAccountId = account.id; creditAccountId = targetEquityAccountId; amount = balance;
        } else {
          debitAccountId = targetEquityAccountId; creditAccountId = account.id; amount = -balance;
        }
      } else {
        if (balance > 0) {
          debitAccountId = targetEquityAccountId; creditAccountId = account.id; amount = balance;
        } else {
          debitAccountId = account.id; creditAccountId = targetEquityAccountId; amount = -balance;
        }
      }

      newEntries.push({
        id: newId("close"),
        businessId: business.id,
        date: new Date().toISOString().split("T")[0],
        reference: "TUTUP-" + account.code,
        description: `Menutup ${account.code} - ${account.name} ke akun Ekuitas`,
        debitAccountId,
        creditAccountId,
        amount,
        createdAt: new Date().toISOString()
      });
    });

    return newEntries;
  }

  // Versi lokal (browser saja): ganti seluruh jurnal penutup lama usaha ini.
  function generateClosingEntries(targetEquityAccountId) {
    const business = getActiveBusiness();
    if (!business) return [];

    const newEntries = buildClosingEntries(targetEquityAccountId);
    const others = getClosingEntries().filter(e => !idEqual(e.businessId, business.id));
    saveClosingEntries(others.concat(newEntries));

    return newEntries;
  }

  // Versi yang dipakai halaman: ke server kalau usaha dan akunnya sudah di server.
  async function applyClosingEntries(targetEquityAccountId) {
    const business = getActiveBusiness();
    if (!business) return [];

    const entries = buildClosingEntries(targetEquityAccountId);
    const toServer = isUuid(business.id) &&
      entries.every(e => isUuid(e.debitAccountId) && isUuid(e.creditAccountId));

    if (!toServer) {
      const others = getClosingEntries().filter(e => !idEqual(e.businessId, business.id));
      saveClosingEntries(others.concat(entries));
      return entries;
    }

    // Hapus jurnal penutup lama di server, lalu tulis yang baru.
    await closingStore.removeWhere("business_id", business.id);
    saveClosingEntries(getClosingEntries().filter(e => !(idEqual(e.businessId, business.id) && !isUuid(e.id))));
    if (entries.length > 0) {
      await closingStore.createMany(business.id, entries);
    } else {
      await closingStore.sync();
    }
    return entries;
  }

  function clearClosingEntries() {
    const business = getActiveBusiness();
    if (!business) return;
    const others = getClosingEntries().filter(e => !idEqual(e.businessId, business.id));
    saveClosingEntries(others);
  }

  async function clearClosingEntriesAuto() {
    const business = getActiveBusiness();
    if (!business) return;
    if (isUuid(business.id)) await closingStore.removeWhere("business_id", business.id);
    clearClosingEntries();
    if (isUuid(business.id)) await closingStore.sync();
  }

  // Dipakai KHUSUS oleh Neraca Saldo Setelah Penutupan: transaksi +
  // penyesuaian + PSAK 115 + jurnal penutup, sehingga akun nominal
  // otomatis bersaldo nol.
  function getActivePostClosingEntries() {
    const closing = getActiveClosingEntries().map(c => ({
      id: c.id,
      date: c.date,
      reference: c.reference || "-",
      description: c.description,
      debitAccountId: c.debitAccountId,
      creditAccountId: c.creditAccountId,
      amount: Number(c.amount) || 0,
      source: "Penutup"
    }));

    return getActiveJournalEntries().concat(closing);
  }

  /* ---------- SALDO AKUN (dipakai bersama banyak laporan) ---------- */

  function computeAccountBalances(accounts, entries) {
    const raw = {};
    accounts.forEach(account => {
      raw[String(account.id)] = { debit: 0, credit: 0 };
    });

    entries.forEach(entry => {
      const amount = Number(entry.amount) || 0;
      const debitId = String(entry.debitAccountId);
      const creditId = String(entry.creditAccountId);
      if (raw[debitId]) raw[debitId].debit += amount;
      if (raw[creditId]) raw[creditId].credit += amount;
    });

    const net = {};
    accounts.forEach(account => {
      const id = String(account.id);
      const value = raw[id];
      net[id] = account.normalBalance === "Debit"
        ? value.debit - value.credit
        : value.credit - value.debit;
    });

    return net;
  }

  /* ---------- SALDO BERTANDA (akun kontra) ----------
     computeAccountBalances() mengembalikan saldo menurut sisi normal
     akun masing-masing. Untuk menjumlah satu kelompok (mis. Total Aset)
     akun yang sisi normalnya BERLAWANAN dengan kelompoknya (akun kontra,
     contoh: Akumulasi Penyusutan di kelompok Aset, atau Prive di Ekuitas)
     harus MENGURANGI total, bukan menambah.
     positiveSide = sisi normal kelompok: "Debit" untuk Aset & Beban,
     "Kredit" untuk Liabilitas, Ekuitas & Pendapatan. */

  function signedBalance(account, netValue, positiveSide) {
    return account.normalBalance === positiveSide ? netValue : -netValue;
  }

  function positiveSideOfGroup(group) {
    return (ASSET_GROUPS.includes(group) || EXPENSE_GROUPS.includes(group)) ? "Debit" : "Kredit";
  }

  /* ---------- EXPORT EXCEL ----------
     Dipakai oleh tombol "Export Excel" di setiap halaman laporan.
     sheets = [{ name, rows, colWidths? }], rows = array-of-array
     (baris pertama = header). Angka dikirim sebagai number asli
     (bukan string "Rp...") supaya bisa dijumlah langsung di Excel. */

  function exportToExcel(filename, sheets) {
    if (typeof XLSX === "undefined") {
      alert("Gagal export: library Excel belum termuat. Pastikan koneksi internet aktif, lalu coba lagi.");
      return;
    }

    const workbook = XLSX.utils.book_new();
    const usedNames = {};

    sheets.forEach(sheet => {
      const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
      if (sheet.colWidths) {
        worksheet["!cols"] = sheet.colWidths.map(w => ({ wch: w }));
      }
      // Nama sheet Excel maksimal 31 karakter & tidak boleh mengandung : \ / ? * [ ]
      let safeName = String(sheet.name).replace(/[:\\\/\?\*\[\]]/g, "-").slice(0, 31);

      if (usedNames[safeName] !== undefined) {
        usedNames[safeName] += 1;
        const suffix = " (" + usedNames[safeName] + ")";
        safeName = safeName.slice(0, 31 - suffix.length) + suffix;
      } else {
        usedNames[safeName] = 0;
      }

      XLSX.utils.book_append_sheet(workbook, worksheet, safeName);
    });

    XLSX.writeFile(workbook, filename);
  }

  /* ---------- DROPDOWN AKUN (dipakai di form transaksi & penyesuaian) ---------- */

  function fillAccountSelect(selectEl, placeholder, accounts) {
    selectEl.innerHTML = "";

    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = placeholder;
    selectEl.appendChild(emptyOption);

    if (accounts.length === 0) {
      const disabledOption = document.createElement("option");
      disabledOption.value = "";
      disabledOption.disabled = true;
      disabledOption.textContent = "Belum ada akun COA";
      selectEl.appendChild(disabledOption);
      return;
    }

    accounts
      .slice()
      .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }))
      .forEach(account => {
        const option = document.createElement("option");
        option.value = account.id;
        option.textContent = `${account.code} - ${account.name}`;
        selectEl.appendChild(option);
      });
  }

  function loadAccountDropdowns(debitId, creditId) {
    const debitSelect = document.getElementById(debitId);
    const creditSelect = document.getElementById(creditId);
    const accounts = getActiveAccounts();

    if (debitSelect) fillAccountSelect(debitSelect, "-- Pilih Akun Debit --", accounts);
    if (creditSelect) fillAccountSelect(creditSelect, "-- Pilih Akun Kredit --", accounts);
  }

  /* ---------- LAYOUT (SIDEBAR + TOPBAR) ---------- */

  const NAV_ITEMS = [
    { id: "dashboard",         label: "Dashboard",             icon: "dashboard", href: "index.html",             group: "Utama" },
    { id: "business",          label: "Data Usaha",            icon: "building", href: "business.html",          group: "Master Data" },
    { id: "accounts",          label: "Chart of Accounts",     icon: "list", href: "accounts.html",          group: "Master Data" },
    { id: "transactions",      label: "Transaksi",             icon: "receipt", href: "transactions.html",      group: "Master Data" },
    { id: "products",          label: "Bahan & Produk",        icon: "flask", href: "products.html",          group: "Master Data" },
    { id: "setup",             label: "Persiapan Awal",        icon: "flag", href: "setup.html",             group: "Master Data" },
    { id: "telegram",          label: "Kotak Masuk Telegram",  icon: "send", href: "telegram.html",          group: "Master Data" },
    { id: "journal",           label: "Jurnal Umum",           icon: "book-open", href: "journal.html",           group: "Siklus Akuntansi" },
    { id: "ledger",            label: "Buku Besar",            icon: "book", href: "ledger.html",            group: "Siklus Akuntansi" },
    { id: "trial-balance",     label: "Neraca Saldo",          icon: "calculator", href: "trial-balance.html",     group: "Siklus Akuntansi" },
    { id: "adjusting-journal", label: "Jurnal Penyesuaian",    icon: "sliders", href: "adjusting-journal.html", group: "Siklus Akuntansi" },
    { id: "financial-statements", label: "Laporan Keuangan",  icon: "trending-up", href: "financial-statements.html", group: "Siklus Akuntansi" },
    { id: "closing-journal",   label: "Jurnal Penutup",        icon: "lock", href: "closing-journal.html",   group: "Penutupan Periode" },
    { id: "post-closing-trial-balance", label: "Neraca Saldo Penutup", icon: "check-circle", href: "post-closing-trial-balance.html", group: "Penutupan Periode" },
    { id: "equity-changes",    label: "Perubahan Ekuitas",     icon: "pie", href: "equity-changes.html",    group: "Penutupan Periode" },
    { id: "cash-flow",         label: "Arus Kas",              icon: "wallet", href: "cash-flow.html",         group: "Penutupan Periode" },
    { id: "psak115",           label: "PSAK 115",              icon: "file-text", href: "psak115.html",           group: "Modul Khusus" }
  ];

  function buildSidebar(activeId) {
    const groups = [];
    NAV_ITEMS.forEach(item => {
      let group = groups.find(g => g.name === item.group);
      if (!group) {
        group = { name: item.group, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    });

    const groupsHtml = groups.map(group => `
      <div class="nav-group">
        <div class="nav-group-title">${group.name}</div>
        ${group.items.map(item => `
          <a href="${item.href}" class="nav-link${item.id === activeId ? " active" : ""}">
            <span class="nav-icon"><i class="ico-${item.icon}"></i></span>
            <span>${item.label}</span>
          </a>
        `).join("")}
      </div>
    `).join("");

    return `
      <div class="sidebar-brand">
        <span class="brand-icon"><i class="ico-calculator"></i></span>
        <div>
          <div class="brand-title">Ilham ERP</div>
          <div class="brand-subtitle">Sistem Akuntansi UMKM</div>
        </div>
        <button type="button" class="sidebar-close" id="sidebarClose" aria-label="Tutup menu"><i class="ico-close"></i></button>
      </div>
      <nav class="sidebar-nav">${groupsHtml}</nav>
    `;
  }

  function updateActiveBadge() {
    const badge = document.getElementById("activeBusinessBadge");
    if (!badge) return;

    const business = getActiveBusiness();

    if (!business) {
      badge.innerHTML = `
        <span class="badge-dot badge-dot-warn"></span>
        <span>Belum ada usaha aktif</span>
      `;
      badge.classList.add("is-empty");
      return;
    }

    badge.classList.remove("is-empty");
    badge.innerHTML = `
      <span class="badge-dot"></span>
      <span><strong>${escapeHTML(business.name)}</strong> · Tahun Buku ${escapeHTML(business.period)}</span>
    `;
  }

  function initLayout(options) {
    const sidebar = document.getElementById("sidebar");
    const topbarTitle = document.getElementById("topbarTitle");
    const topbarSubtitle = document.getElementById("topbarSubtitle");
    const menuToggle = document.getElementById("menuToggle");
    const appShell = document.querySelector(".app-shell");

    if (sidebar) sidebar.innerHTML = buildSidebar(options.active);

    // Info akun + tombol Keluar (hanya jika modul login dimuat).
    if (sidebar && window.ERPAuth) {
      const userBox = document.createElement("div");
      userBox.className = "sidebar-user";
      userBox.innerHTML = `
        <div class="sidebar-user-email" id="sidebarUserEmail">Memuat akun...</div>
        <button type="button" class="sidebar-logout" id="logoutBtn"><i class="ico-logout"></i>Keluar</button>
      `;
      sidebar.appendChild(userBox);

      document.getElementById("logoutBtn").addEventListener("click", () => signOutSafely());
      ERPAuth.onReady(user => {
        const emailEl = document.getElementById("sidebarUserEmail");
        if (emailEl) emailEl.textContent = user.email || "";
      });
    }
    if (topbarTitle) topbarTitle.textContent = options.title || "";
    if (topbarSubtitle) topbarSubtitle.textContent = options.subtitle || "";

    updateActiveBadge();

    const overlay = document.getElementById("sidebarOverlay");
    const closeBtn = document.getElementById("sidebarClose");

    // Tombol menu tampil dengan ikon garis (bukan karakter teks).
    if (menuToggle) {
      menuToggle.innerHTML = '<i class="ico-menu"></i>';
      menuToggle.setAttribute("aria-controls", "sidebar");
      menuToggle.setAttribute("aria-expanded", "false");
    }

    function setSidebar(open) {
      if (!appShell) return;
      appShell.classList.toggle("sidebar-open", open);
      if (menuToggle) menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
    }

    if (menuToggle && appShell) {
      menuToggle.addEventListener("click", () => {
        setSidebar(!appShell.classList.contains("sidebar-open"));
      });
    }

    if (overlay) overlay.addEventListener("click", () => setSidebar(false));
    if (closeBtn) closeBtn.addEventListener("click", () => setSidebar(false));

    // Tombol Esc menutup menu.
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") setSidebar(false);
    });

    // Menu tertutup lagi setelah memilih salah satu halaman.
    document.querySelectorAll(".nav-link").forEach(link => {
      link.addEventListener("click", () => setSidebar(false));
    });
  }

  return {
    idEqual,
    escapeHTML,
    newId,
    formatMoney,
    formatDate,
    ASSET_GROUPS,
    LIABILITY_GROUPS,
    EQUITY_GROUPS,
    REVENUE_GROUPS,
    EXPENSE_GROUPS,
    REAL_GROUPS,
    NOMINAL_GROUPS,
    CASHFLOW_OPERATING,
    CASHFLOW_INVESTING,
    CASHFLOW_FINANCING,
    getBusinesses,
    isUuid,
    getLegacyBusinesses,
    syncBusinesses,
    createBusinessRemote,
    updateBusinessRemote,
    deleteBusinessRemote,
    importLegacyBusinesses,
    ensureCacheOwner,
    signOutSafely,
    countLegacyData,
    clearLocalCache,
    getLegacyAccounts,
    syncAccounts,
    createAccountsRemote,
    updateAccountRemote,
    deleteAccountRemote,
    importLegacyAccounts,
    getLegacyTransactions,
    splitLegacyTransactions,
    syncTransactions,
    createTransactionsRemote,
    updateTransactionRemote,
    deleteTransactionRemote,
    importLegacyTransactions,
    syncOthers,
    splitLegacyJournalData,
    importLegacyJournalData,
    mountLegacyImportCard,
    createAdjustmentsRemote: (businessId, list) => adjustmentsStore.createMany(businessId, list),
    deleteAdjustmentRemote: (id) => adjustmentsStore.remove(id),
    createContractsRemote: (businessId, list) => contractsStore.createMany(businessId, list),
    updateContractRemote: (id, fields) => contractsStore.update(id, fields),
    deleteContractRemote: async (id) => { await contractsStore.remove(id); await recognitionsStore.sync(); },
    createRecognitionsRemote: (businessId, list) => recognitionsStore.createMany(businessId, list),
    applyClosingEntries,
    clearClosingEntriesAuto,
    friendlyError,
    saveBusinesses,
    getActiveBusiness,
    setActiveBusiness,
    getAccounts,
    saveAccounts,
    migrateLegacyAccounts,
    getActiveAccounts,
    getAccountById,
    getTransactions,
    saveTransactions,
    getActiveTransactions,
    getAdjustments,
    saveAdjustments,
    getActiveAdjustments,
    getContracts,
    saveContracts,
    getActiveContracts,
    getRecognitions,
    saveRecognitions,
    getActiveRecognitions,
    getContractRecognitions,
    getContractRecognizedTotal,
    getActiveJournalEntries,
    getPeriodStart,
    filterEntriesFromDate,
    getCurrentPeriodEntries,
    periodLabel,
    getClosingEntries,
    saveClosingEntries,
    getActiveClosingEntries,
    generateClosingEntries,
    clearClosingEntries,
    getActivePostClosingEntries,
    computeAccountBalances,
    signedBalance,
    positiveSideOfGroup,
    exportToExcel,
    loadAccountDropdowns,
    fillAccountSelect,
    updateActiveBadge,
    initLayout
  };

})();

/* Setelah login terverifikasi: tarik daftar usaha dari server.
   Kalau ada perubahan, muat ulang halaman satu kali supaya tampilan
   memakai data terbaru (pengaman: tidak mengulang dalam 10 detik). */
if (window.ERPAuth) {
  ERPAuth.onReady(function (user) {
    // Salinan data milik akun lain? Bersihkan lalu muat ulang sekali.
    if (ERP.ensureCacheOwner(user)) {
      location.reload();
      return;
    }
    Promise.all([ERP.syncBusinesses(), ERP.syncAccounts(), ERP.syncTransactions(), ERP.syncOthers()]).then(function (results) {
      if (!results.some(Boolean)) return;
      const last = Number(sessionStorage.getItem("ilhamERP_syncReloadAt") || 0);
      if (Date.now() - last < 10000) return;
      sessionStorage.setItem("ilhamERP_syncReloadAt", String(Date.now()));
      location.reload();
    });
  });
}
