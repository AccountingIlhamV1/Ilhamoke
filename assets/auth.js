/* =====================================================
   ILHAM ERP — AUTH (Supabase)
   Mengurus daftar, masuk, keluar, dan penjaga halaman.
   Dimuat di <head> semua halaman, SETELAH library supabase-js.

   Catatan keamanan:
   - Kunci di bawah adalah "publishable key" — memang dirancang
     untuk dipasang di kode web. Keamanan data dijaga RLS di
     database, bukan oleh kerahasiaan kunci ini.
   - JANGAN PERNAH menaruh "secret key" / "service_role" di sini.
===================================================== */

window.ERPAuth = (function () {

  const SUPABASE_URL = "https://myllpwjzaswhdyhsxhmt.supabase.co";
  const SUPABASE_KEY = "sb_publishable_RWTK0eQXhrdIzppJG_7g8Q_2sz492V8";

  // Supabase menyimpan sesi login di localStorage dengan nama ini.
  const SESSION_KEY = "sb-myllpwjzaswhdyhsxhmt-auth-token";

  const LOGIN_PAGE = "login.html";
  const HOME_PAGE = "index.html";

  let client = null;
  let currentUser = null;
  const readyCallbacks = [];

  try {
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (error) {
    console.error("Gagal memuat Supabase:", error);
  }

  /* ---------- Bantu ---------- */

  function pageName() {
    const name = location.pathname.split("/").pop();
    return name || HOME_PAGE;
  }

  // Hanya terima nama file .html biasa, supaya parameter ?next= tidak
  // bisa dipakai untuk mengarahkan pengguna ke situs lain.
  function safeNext(value) {
    return /^[a-z0-9-]+\.html$/i.test(value || "") ? value : HOME_PAGE;
  }

  function nextFromUrl() {
    return safeNext(new URLSearchParams(location.search).get("next"));
  }

  function hasStoredSession() {
    try {
      return !!localStorage.getItem(SESSION_KEY);
    } catch (error) {
      return false;
    }
  }

  function showPage() {
    document.documentElement.style.visibility = "";
  }

  function goLogin() {
    const name = pageName();
    const next = name === LOGIN_PAGE ? "" : "?next=" + encodeURIComponent(name);
    location.replace(LOGIN_PAGE + next);
  }

  function translateError(error) {
    const message = String((error && error.message) || "").toLowerCase();

    if (message.includes("invalid login credentials")) {
      return "Email atau kata sandi salah.";
    }
    if (message.includes("already registered") || message.includes("already been registered")) {
      return "Email ini sudah terdaftar. Silakan masuk.";
    }
    if (message.includes("password should be at least")) {
      return "Kata sandi minimal 6 karakter.";
    }
    if (message.includes("rate limit")) {
      return "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.";
    }
    if (message.includes("email not confirmed")) {
      return "Email belum diverifikasi. Cek kotak masuk emailmu.";
    }
    if (message.includes("invalid email") || message.includes("unable to validate email")) {
      return "Format email tidak valid.";
    }
    if (message.includes("failed to fetch") || message.includes("network")) {
      return "Tidak bisa terhubung. Periksa koneksi internet lalu coba lagi.";
    }
    return "Terjadi kesalahan: " + ((error && error.message) || "tidak diketahui");
  }

  /* ---------- Aksi login ---------- */

  async function signUp(email, password) {
    if (!client) return { ok: false, message: "Layanan login belum termuat. Muat ulang halaman." };

    const { data, error } = await client.auth.signUp({ email, password });
    if (error) return { ok: false, message: translateError(error) };

    // Kalau "Confirm email" mati, sesi langsung ada. Kalau nyala, perlu verifikasi dulu.
    return { ok: true, needsConfirm: !data.session };
  }

  async function signIn(email, password) {
    if (!client) return { ok: false, message: "Layanan login belum termuat. Muat ulang halaman." };

    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: translateError(error) };

    return { ok: true };
  }

  async function signOut() {
    try {
      if (client) await client.auth.signOut();
    } catch (error) {
      console.error("Gagal keluar:", error);
    }
    location.replace(LOGIN_PAGE);
  }

  async function getSession() {
    if (!client) return null;
    try {
      const { data } = await client.auth.getSession();
      return data && data.session ? data.session : null;
    } catch (error) {
      return null;
    }
  }

  /* ---------- Penjaga halaman ---------- */

  function announceReady(user) {
    currentUser = user;
    readyCallbacks.splice(0).forEach(callback => callback(user));
    document.dispatchEvent(new CustomEvent("erp:auth-ready", { detail: { user } }));
  }

  // Dipanggil otomatis di halaman ERP (bukan halaman login).
  function requireLogin() {
    // Cek cepat: tidak ada tanda sesi sama sekali -> langsung ke halaman login.
    if (!client || !hasStoredSession()) {
      goLogin();
      return;
    }

    // Sembunyikan halaman sampai sesi terverifikasi.
    document.documentElement.style.visibility = "hidden";
    const failsafe = setTimeout(showPage, 6000);

    getSession().then(session => {
      clearTimeout(failsafe);
      if (!session) {
        goLogin();
        return;
      }
      showPage();
      announceReady(session.user);
    });
  }

  // Jalankan fungsi begitu data pengguna siap (atau langsung kalau sudah siap).
  function onReady(callback) {
    if (currentUser) {
      callback(currentUser);
    } else {
      readyCallbacks.push(callback);
    }
  }

  function getUser() {
    return currentUser;
  }

  if (pageName() !== LOGIN_PAGE) {
    requireLogin();
  }

  return {
    client,
    signUp,
    signIn,
    signOut,
    getSession,
    getUser,
    onReady,
    nextFromUrl,
    HOME_PAGE
  };
})();
