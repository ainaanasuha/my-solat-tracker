```javascript
(() => {
  "use strict";

  const prayers = ["Subuh", "Zohor", "Asar", "Maghrib", "Isyak"];
  const statusOrder = ["pending", "done", "missed"];
  const statusLabels = {
    pending: "Belum",
    done: "Selesai",
    missed: "Tertinggal"
  };

  const $ = id => document.getElementById(id);

  let supabaseClient;
  let currentUser = null;
  let monthDate = new Date();
  let entries = new Map();
  let members = [];
  let selectedUserId = null;
  let loading = false;

  function showNotice(message) {
    const el = $("setupNotice");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("hidden");
  }

  function dateKey(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function monthKey() {
    return `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}-01`;
  }

  function getMonthLabel() {
    return new Intl.DateTimeFormat("ms-MY", {
      month: "long",
      year: "numeric"
    }).format(monthDate);
  }

  function daysInMonth() {
    return new Date(
      monthDate.getFullYear(),
      monthDate.getMonth() + 1,
      0
    ).getDate();
  }

  function entryKey(date, prayer) {
    return `${date}|${prayer}`;
  }

  function currentEntry(date, prayer) {
    return entries.get(entryKey(date, prayer)) ||
      { status: "pending", prayed_at: "" };
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[ch]);
  }

  async function init() {
    const form = $("loginForm");

    if (
      !window.SUPABASE_URL ||
      !window.SUPABASE_ANON_KEY ||
      window.SUPABASE_URL.includes("PASTE_") ||
      window.SUPABASE_ANON_KEY.includes("PASTE_")
    ) {
      showNotice("Konfigurasi Supabase belum lengkap. Semak fail config.js.");
      $("authCard")?.classList.remove("hidden");
      if ($("authMessage")) {
        $("authMessage").textContent =
          "Masukkan Project URL dan anon/public key yang betul dalam config.js.";
      }
      return;
    }

    if (!window.supabase?.createClient) {
      showNotice("Pustaka Supabase gagal dimuatkan. Semak internet dan muat semula halaman.");
      $("authCard")?.classList.remove("hidden");
      return;
    }

    supabaseClient = window.supabase.createClient(
      window.SUPABASE_URL,
      window.SUPABASE_ANON_KEY
    );

    form?.addEventListener("submit", login);
    $("logoutBtn")?.addEventListener("click", logout);
    $("prevMonth")?.addEventListener("click", () => changeMonth(-1));
    $("nextMonth")?.addEventListener("click", () => changeMonth(1));
    $("saveReflection")?.addEventListener("click", saveReflection);

    $("authCard")?.classList.remove("hidden");
    $("appView")?.classList.add("hidden");

    const { data, error } = await supabaseClient.auth.getSession();

    if (error) {
      setAuthMessage(`Tak dapat menyemak sesi: ${error.message}`);
      return;
    }

    if (data.session) {
      currentUser = data.session.user;
      await enterApp();
    }

    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        currentUser = null;
        selectedUserId = null;
        $("appView")?.classList.add("hidden");
        $("authCard")?.classList.remove("hidden");
      }
    });
  }

  function setAuthMessage(message) {
    if ($("authMessage")) $("authMessage").textContent = message;
  }

  async function login(event) {
    event.preventDefault();

    if (!supabaseClient) {
      setAuthMessage("Supabase belum dikonfigurasi. Semak config.js.");
      return;
    }

    const button = $("loginForm")?.querySelector('button[type="submit"]');
    if (button) button.disabled = true;

    setAuthMessage("Sedang log masuk...");

    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: $("email").value.trim(),
        password: $("password").value
      });

      if (error) {
        setAuthMessage(`Tak berjaya log masuk: ${error.message}`);
        return;
      }

      currentUser = data.user;
      setAuthMessage("Login berjaya.");
      await enterApp();
    } catch (error) {
      setAuthMessage(`Ralat login: ${error.message}`);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function logout() {
    const { error } = await supabaseClient.auth.signOut();

    if (error) {
      alert(`Tak dapat log keluar: ${error.message}`);
      return;
    }

    currentUser = null;
    selectedUserId = null;
    $("appView")?.classList.add("hidden");
    $("authCard")?.classList.remove("hidden");
    $("password").value = "";
    setAuthMessage("Anda telah log keluar.");
  }

  async function enterApp() {
    $("authCard")?.classList.add("hidden");
    $("appView")?.classList.remove("hidden");
    $("signedInAs").textContent = currentUser?.email || "Akaun berdaftar";

    try {
      await loadMembers();
    } catch (error) {
      showNotice(`Tak dapat memuatkan senarai pengguna: ${error.message}`);
    }
  }

  function createMemberPicker() {
    let picker = $("memberPicker");
    if (picker) return picker;

    const toolbar = document.querySelector("#appView .toolbar");
    if (!toolbar) return null;

    const wrapper = document.createElement("div");
    wrapper.className = "member-picker-wrap";
    wrapper.style.marginTop = "12px";

    const label = document.createElement("label");
    label.htmlFor = "memberPicker";
    label.textContent = "Rekod untuk";

    picker = document.createElement("select");
    picker.id = "memberPicker";
    picker.style.display = "block";
    picker.style.width = "100%";
    picker.style.marginTop = "6px";

    wrapper.append(label, picker);
    toolbar.appendChild(wrapper);

    picker.addEventListener("change", async () => {
      selectedUserId = picker.value || null;
      await loadMonth();
    });

    return picker;
  }

  async function loadMembers() {
    const picker = createMemberPicker();

    const { data, error } = await supabaseClient
      .from("tracker_members")
      .select("user_id, display_name")
      .order("display_name");

    if (error) throw error;

    members = data || [];

    if (!members.length) {
      showNotice(
        "Tiada pengguna dalam tracker_members. Tambahkan rekod Ainaa dan Muaz berserta user_id yang betul."
      );
      $("prayerTable").innerHTML =
        '<tr><td colspan="6" class="empty">Senarai pengguna masih kosong.</td></tr>';
      return;
    }

    if (!picker) throw new Error("Ruangan pemilihan pengguna tidak ditemui.");

    picker.innerHTML = "";

    members.forEach(member => {
      const option = document.createElement("option");
      option.value = member.user_id;
      option.textContent = member.display_name;
      picker.appendChild(option);
    });

    if (!members.some(member => member.user_id === selectedUserId)) {
      selectedUserId = members[0].user_id;
    }

    picker.value = selectedUserId;
    await loadMonth();
  }

  function changeMonth(delta) {
    monthDate = new Date(
      monthDate.getFullYear(),
      monthDate.getMonth() + delta,
      1
    );
    loadMonth();
  }

  async function loadMonth() {
    if (!supabaseClient || !selectedUserId || loading) return;

    loading = true;
    $("monthLabel").textContent = getMonthLabel();
    $("prayerTable").innerHTML =
      '<tr><td colspan="6" class="empty">Memuatkan rekod…</td></tr>';

    try {
      const first = dateKey(monthDate.getFullYear(), monthDate.getMonth(), 1);
      const last = dateKey(
        monthDate.getFullYear(),
        monthDate.getMonth(),
        daysInMonth()
      );

      const { data, error } = await supabaseClient
        .from("prayer_entries")
        .select("prayer_date, prayer_name, status, prayed_at")
        .eq("user_id", selectedUserId)
        .gte("prayer_date", first)
        .lte("prayer_date", last);

      if (error) throw error;

      entries = new Map(
        (data || []).map(row => [
          entryKey(row.prayer_date, row.prayer_name),
          row
        ])
      );

      renderTable();
      renderSummary();
      await loadReflection();
    } catch (error) {
      $("prayerTable").innerHTML =
        `<tr><td colspan="6" class="empty">Ralat memuatkan rekod: ${escapeHtml(error.message)}</td></tr>`;
    } finally {
      loading = false;
    }
  }

  function renderTable() {
    const tbody = $("prayerTable");
    tbody.innerHTML = "";

    for (let day = 1; day <= daysInMonth(); day++) {
      const date = dateKey(monthDate.getFullYear(), monthDate.getMonth(), day);
      const tr = document.createElement("tr");
      const tdDate = document.createElement("td");

      tdDate.textContent = new Intl.DateTimeFormat("ms-MY", {
        day: "numeric",
        weekday: "short"
      }).format(new Date(monthDate.getFullYear(), monthDate.getMonth(), day));

      tr.appendChild(tdDate);

      prayers.forEach(prayer => {
        const td = document.createElement("td");
        const entry = currentEntry(date, prayer);

        const btn = document.createElement("button");
        btn.className = `status-btn ${
          entry.status === "done" ? "status-done" :
          entry.status === "missed" ? "status-missed" : ""
        }`;
        btn.textContent = statusLabels[entry.status] || "Belum";
        btn.title = "Tekan untuk tukar status";

        btn.addEventListener("click", async () => {
          const currentIndex = statusOrder.indexOf(entry.status);
          const next = statusOrder[(currentIndex + 1) % statusOrder.length];

          btn.disabled = true;
          const saved = await savePrayer(date, prayer, next, entry.prayed_at || "");
          btn.disabled = false;

          if (saved) {
            entries.set(entryKey(date, prayer), {
              prayer_date: date,
              prayer_name: prayer,
              status: next,
              prayed_at: entry.prayed_at || null
            });
            renderTable();
            renderSummary();
          }
        });

        td.appendChild(btn);

        const time = document.createElement("input");
        time.type = "time";
        time.className = "time-input";
        time.value = (entry.prayed_at || "").slice(0, 5);
        time.setAttribute("aria-label", `Masa ${prayer} ${date}`);

        time.addEventListener("change", async () => {
          const saved = await savePrayer(date, prayer, entry.status, time.value);

          if (saved) {
            entries.set(entryKey(date, prayer), {
              prayer_date: date,
              prayer_name: prayer,
              status: entry.status,
              prayed_at: time.value || null
            });
          }
        });

        td.appendChild(time);
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    }
  }

  async function savePrayer(date, prayer, status, time) {
    if (!selectedUserId) {
      alert("Pilih pengguna terlebih dahulu.");
      return false;
    }

    const row = {
      user_id: selectedUserId,
      prayer_date: date,
      prayer_name: prayer,
      status,
      prayed_at: time || null
    };

    const { error } = await supabaseClient
      .from("prayer_entries")
      .upsert(row, {
        onConflict: "user_id,prayer_date,prayer_name"
      });

    if (error) {
      alert(`Tak dapat simpan rekod: ${error.message}`);
      return false;
    }

    return true;
  }

  function renderSummary() {
    let done = 0;
    let missed = 0;
    let pending = 0;

    for (let day = 1; day <= daysInMonth(); day++) {
      const date = dateKey(monthDate.getFullYear(), monthDate.getMonth(), day);

      prayers.forEach(prayer => {
        const status = currentEntry(date, prayer).status;
        if (status === "done") done++;
        else if (status === "missed") missed++;
        else pending++;
      });
    }

    const summary = $("summary");
    summary.innerHTML = "";

    [["Selesai", done], ["Tertinggal", missed], ["Belum direkod", pending]]
      .forEach(([label, value]) => {
        const div = document.createElement("div");
        div.className = "stat";

        const span = document.createElement("span");
        span.textContent = label;

        const strong = document.createElement("strong");
        strong.textContent = value;

        div.append(span, strong);
        summary.appendChild(div);
      });
  }

  async function loadReflection() {
    $("reflectionMessage").textContent = "";

    const { data, error } = await supabaseClient
      .from("monthly_reflections")
      .select("notes, improvement")
      .eq("month", monthKey())
      .maybeSingle();

    if (error) {
      $("reflectionMessage").textContent =
        `Tak dapat memuatkan refleksi: ${error.message}`;
      return;
    }

    $("notes").value = data?.notes || "";
    $("improvement").value = data?.improvement || "";
  }

  async function saveReflection() {
    const button = $("saveReflection");
    button.disabled = true;
    $("reflectionMessage").textContent = "Menyimpan…";

    try {
      const { error } = await supabaseClient
        .from("monthly_reflections")
        .upsert({
          month: monthKey(),
          notes: $("notes").value,
          improvement: $("improvement").value
        }, {
          onConflict: "month"
        });

      if (error) throw error;

      $("reflectionMessage").textContent =
        "Refleksi berjaya disimpan. 💚";
    } catch (error) {
      $("reflectionMessage").textContent =
        `Tak berjaya simpan refleksi: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
```
