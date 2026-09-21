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
    return getTransactions().filter(t => idEqual(t.businessId, business.id));
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

  function generateClosingEntries(targetEquityAccountId) {
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

    // Ganti seluruh jurnal penutup lama usaha ini dengan yang baru.
    const others = getClosingEntries().filter(e => !idEqual(e.businessId, business.id));
    saveClosingEntries(others.concat(newEntries));

    return newEntries;
  }

  function clearClosingEntries() {
    const business = getActiveBusiness();
    if (!business) return;
    const others = getClosingEntries().filter(e => !idEqual(e.businessId, business.id));
    saveClosingEntries(others);
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
    { id: "dashboard",         label: "Dashboard",             icon: "📊", href: "index.html",             group: "Utama" },
    { id: "business",          label: "Data Usaha",            icon: "🏢", href: "business.html",          group: "Master Data" },
    { id: "accounts",          label: "Chart of Accounts",     icon: "📋", href: "accounts.html",          group: "Master Data" },
    { id: "transactions",      label: "Transaksi",             icon: "🧾", href: "transactions.html",      group: "Master Data" },
    { id: "journal",           label: "Jurnal Umum",           icon: "📖", href: "journal.html",           group: "Siklus Akuntansi" },
    { id: "ledger",            label: "Buku Besar",            icon: "📚", href: "ledger.html",            group: "Siklus Akuntansi" },
    { id: "trial-balance",     label: "Neraca Saldo",          icon: "🧮", href: "trial-balance.html",     group: "Siklus Akuntansi" },
    { id: "adjusting-journal", label: "Jurnal Penyesuaian",    icon: "🛠️", href: "adjusting-journal.html", group: "Siklus Akuntansi" },
    { id: "financial-statements", label: "Laporan Keuangan",  icon: "📈", href: "financial-statements.html", group: "Siklus Akuntansi" },
    { id: "closing-journal",   label: "Jurnal Penutup",        icon: "🔒", href: "closing-journal.html",   group: "Penutupan Periode" },
    { id: "post-closing-trial-balance", label: "Neraca Saldo Penutup", icon: "✅", href: "post-closing-trial-balance.html", group: "Penutupan Periode" },
    { id: "equity-changes",    label: "Perubahan Ekuitas",     icon: "💹", href: "equity-changes.html",    group: "Penutupan Periode" },
    { id: "cash-flow",         label: "Arus Kas",              icon: "💵", href: "cash-flow.html",         group: "Penutupan Periode" },
    { id: "psak115",           label: "PSAK 115",              icon: "📑", href: "psak115.html",           group: "Modul Khusus" }
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
            <span class="nav-icon">${item.icon}</span>
            <span>${item.label}</span>
          </a>
        `).join("")}
      </div>
    `).join("");

    return `
      <div class="sidebar-brand">
        <span class="brand-icon">🧮</span>
        <div>
          <div class="brand-title">Ilham ERP</div>
          <div class="brand-subtitle">Accounting Learning System</div>
        </div>
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
    if (topbarTitle) topbarTitle.textContent = options.title || "";
    if (topbarSubtitle) topbarSubtitle.textContent = options.subtitle || "";

    updateActiveBadge();

    const overlay = document.getElementById("sidebarOverlay");

    if (menuToggle && appShell) {
      menuToggle.addEventListener("click", () => {
        appShell.classList.toggle("sidebar-open");
      });
    }

    if (overlay && appShell) {
      overlay.addEventListener("click", () => {
        appShell.classList.remove("sidebar-open");
      });
    }

    // Tutup sidebar mobile saat memilih menu.
    document.querySelectorAll(".nav-link").forEach(link => {
      link.addEventListener("click", () => {
        if (appShell) appShell.classList.remove("sidebar-open");
      });
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
    exportToExcel,
    loadAccountDropdowns,
    fillAccountSelect,
    updateActiveBadge,
    initLayout
  };

})();
