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

  // Akun lama (sebelum businessId ada) otomatis dimasukkan ke usaha aktif.
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
    { id: "adjusting-journal", label: "Jurnal Penyesuaian",    icon: "🛠️", href: "adjusting-journal.html", group: "Siklus Akuntansi" }
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
    loadAccountDropdowns,
    fillAccountSelect,
    updateActiveBadge,
    initLayout
  };

})();
