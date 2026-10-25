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

  const $ = (id) => document.getElementById(id);

  let supabaseClient;
  let currentUser = null;
  let members = [];
  let selectedUserId = "";
  let monthDate = new Date();
  let entries = new Map();
  let loadingMonth = false;
  let savingReflection = false;

  function showNotice(message) {
    const el = $("setupNotice");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("hidden");
  }

  function hideNotice() {
    $("setupNotice")?.classList.add("hidden");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[ch]);
  }

  function dateKey(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function monthKey() {
    return `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}-01`;
  }

  function monthLabel() {
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
    return entries.get(entryKey(date, prayer)) || {
      status: "pending",
      prayed_at: ""
    };
  }

  function setMessage(id, message, isError = false) {
    const el = $(id);
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("error", isError);
  }

  async function init() {
    if (
      !window.SUPABASE_URL ||
      !window.SUPABASE_ANON_KEY ||
      window.SUPABASE_URL.includes("PASTE_") ||
      window.SUPABASE_ANON_KEY.includes("PASTE_")
    ) {
      showNotice("Sila semak SUPABASE_URL dan SUPABASE_ANON_KEY dalam config.js.");
      return;
    }

    if (!window.supabase?.createClient) {
      showNotice("Pustaka Supabase gagal dimuatkan. Semak internet dan refresh halaman.");
      return;
    }

    supabaseClient = window.supabase.createClient(
      window.SUPABASE_URL,
      window.SUPABASE_ANON_KEY
    );

    $("loginForm").addEventListener("submit", login);
    $("logoutBtn").addEventListener("click", logout);
    $("prevMonth").addEventListener("click", () => changeMonth(-1));
    $("nextMonth").addEventListener("click", () => changeMonth(1));
    $("saveReflection").addEventListener("click", saveReflection);

    const { data, error } = await supabaseClient.auth.getSession();

    if (error) {
      showNotice("Gagal menyemak sesi log masuk: " + error.message);
      $("authCard").classList.remove("hidden");
      return;
    }

    if (data.session?.user) {
      currentUser = data.session.user;
      await enterApp();
    } else {
      $("authCard").classList.remove("hidden");
    }

    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        currentUser = null;
        selectedUserId = "";
        entries.clear();
        $("appView").classList.add("hidden");
        $("authCard").classList.remove("hidden");
        return;
      }

      if (session?.user && !currentUser) {
        currentUser = session.user;
        // Elak operasi Supabase bersarang dalam callback auth.
        Promise.resolve().then(() => enterApp());
      }
    });
  }

  async function login(event) {
    event.preventDefault();

    if (!supabaseClient) {
      setMessage("authMessage", "Supabase belum bersedia. Refresh halaman.", true);
      return;
    }

    const email = $("email").value.trim();
    const password = $("password").value;

    setMessage("authMessage", "Sedang log masuk...");

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      setMessage("authMessage", "Log masuk gagal: " + error.message, true);
      return;
    }

    currentUser = data.user;
    setMessage("authMessage", "Log masuk berjaya.");

    await enterApp();
  }

  async function logout() {
    if (!supabaseClient) return;

    const { error } = await supabaseClient.auth.signOut();

    if (error) {
      showNotice("Gagal log keluar: " + error.message);
      return;
    }

    currentUser = null;
    selectedUserId = "";
    entries.clear();

    $("appView").classList.add("hidden");
    $("authCard").classList.remove("hidden");
    $("password").value = "";
    setMessage("authMessage", "Anda telah log keluar.");
  }

  async function enterApp() {
    if (!currentUser) return;

    hideNotice();
    $("authCard").classList.add("hidden");
    $("appView").classList.remove("hidden");
    $("signedInAs").textContent = currentUser.email || "Akaun berdaftar";

    try {
      await setupUserPicker();
      await loadMonth();
    } catch (error) {
      showNotice("Ralat membuka tracker: " + (error.message || error));
      $("prayerTable").innerHTML =
        '<tr><td colspan="6" class="empty">Tidak dapat memuatkan data. Semak mesej ralat di atas.</td></tr>';
    }
  }

  async function setupUserPicker() {
    let picker = $("recordUser");

    if (!picker) {
      const toolbar = document.querySelector("#appView .toolbar");
      if (!toolbar) {
        throw new Error("Bahagian toolbar tidak ditemui dalam index.html.");
      }

      const wrapper = document.createElement("label");
      wrapper.id = "recordUserWrapper";
      wrapper.className = "member-picker";
      wrapper.innerHTML =
        'Pilih rekod <select id="recordUser"><option value="">Memuatkan...</option></select>';

      toolbar.appendChild(wrapper);
      picker = $("recordUser");
    }

    picker.onchange = async () => {
      selectedUserId = picker.value;
      entries.clear();
      await loadMonth();
    };

    const { data, error } = await supabaseClient
      .from("tracker_members")
      .select("user_id, display_name")
      .not("user_id", "is", null)
      .order("display_name");

    if (error) {
      picker.innerHTML = '<option value="">Senarai pengguna gagal dimuatkan</option>';
      showNotice(
        "Tak dapat membaca tracker_members: " + error.message +
        ". Semak polisi RLS untuk jadual tracker_members."
      );
      return;
    }

    members = (data || []).filter((m) => m.user_id && m.display_name);

    if (!members.length) {
      picker.innerHTML = '<option value="">Tiada pengguna berdaftar</option>';
      showNotice(
        "Tiada ahli dijumpai. Pastikan Ainaa dan Muaz telah ditambah ke tracker_members."
      );
      return;
    }

    const previousId = selectedUserId;
    picker.innerHTML = members.map((m) =>
      `<option value="${escapeHtml(m.user_id)}">${escapeHtml(m.display_name)}</option>`
    ).join("");

    selectedUserId = members.some((m) => m.user_id === previousId)
      ? previousId
      : members[0].user_id;

    picker.value = selectedUserId;
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
    if (!supabaseClient || !selectedUserId || loadingMonth) return;

    loadingMonth = true;
    $("monthLabel").textContent = monthLabel();
    $("prayerTable").innerHTML =
      '<tr><td colspan="6" class="empty">Memuatkan rekod...</td></tr>';

    const first = dateKey(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const last = dateKey(monthDate.getFullYear(), monthDate.getMonth(), daysInMonth());

    try {
      const { data, error } = await supabaseClient
        .from("prayer_entries")
        .select("id,user_id,prayer_date,prayer_name,status,prayed_at")
        .eq("user_id", selectedUserId)
        .gte("prayer_date", first)
        .lte("prayer_date", last);

      if (error) throw error;

      entries = new Map(
        (data || []).map((row) => [
          entryKey(row.prayer_date, row.prayer_name),
          row
        ])
      );

      renderTable();
      renderSummary();
      await loadReflection();
      hideNotice();
    } catch (error) {
      $("prayerTable").innerHTML =
        `<tr><td colspan="6" class="empty">Ralat memuatkan rekod: ${escapeHtml(error.message || error)}</td></tr>`;
      showNotice(
        "Gagal memuatkan rekod solat. Semak akses RLS prayer_entries: " +
        (error.message || error)
      );
    } finally {
      loadingMonth = false;
    }
  }

  function renderTable() {
    const rows = [];

    for (let day = 1; day <= daysInMonth(); day++) {
      const date = dateKey(monthDate.getFullYear(), monthDate.getMonth(), day);
      const dateObj = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
      const dateText = new Intl.DateTimeFormat("ms-MY", {
        day: "numeric",
        month: "short",
        weekday: "short"
      }).format(dateObj);

      rows.push(`<tr>
        <td class="date-cell">${escapeHtml(dateText)}</td>
        ${prayers.map((prayer) => {
          const entry = currentEntry(date, prayer);
          const status = statusOrder.includes(entry.status) ? entry.status : "pending";
          const time = entry.prayed_at || "";

          return `<td class="prayer-cell">
            <button
              type="button"
              class="status-btn status-${status}"
              data-date="${date}"
              data-prayer="${prayer}"
              aria-label="${prayer}: ${statusLabels[status]}"
            >${statusLabels[status]}</button>
            <input
              class="time-input"
              type="time"
              aria-label="Masa ${prayer}, ${date}"
              data-time-date="${date}"
              data-time-prayer="${prayer}"
              value="${escapeHtml(time)}"
            >
          </td>`;
        }).join("")}
      </tr>`);
    }

    $("prayerTable").innerHTML = rows.join("");

    $("prayerTable").querySelectorAll(".status-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        const { date, prayer } = button.dataset;
        const current = currentEntry(date, prayer);
        const index = statusOrder.indexOf(current.status);
        const nextStatus = statusOrder[(index + 1) % statusOrder.length];

        await savePrayer(date, prayer, nextStatus, current.prayed_at || "");
      });
    });

    $("prayerTable").querySelectorAll(".time-input").forEach((input) => {
      input.addEventListener("change", async () => {
        const { timeDate: date, timePrayer: prayer } = input.dataset;
        const current = currentEntry(date, prayer);

        await savePrayer(date, prayer, current.status || "pending", input.value);
      });
    });
  }

  async function savePrayer(date, prayer, status, time) {
    if (!selectedUserId) {
      showNotice("Pilih Ainaa atau Muaz dahulu.");
      return;
    }

    const payload = {
      user_id: selectedUserId,
      prayer_date: date,
      prayer_name: prayer,
      status,
      prayed_at: time || null
    };

    const { data, error } = await supabaseClient
      .from("prayer_entries")
      .upsert(payload, {
        onConflict: "user_id,prayer_date,prayer_name"
      })
      .select("id,user_id,prayer_date,prayer_name,status,prayed_at")
      .single();

    if (error) {
      showNotice("Gagal menyimpan solat: " + error.message);
      return;
    }

    entries.set(entryKey(date, prayer), data);
    renderTable();
    renderSummary();
    hideNotice();
  }

  function renderSummary() {
    const total = daysInMonth() * prayers.length;
    let done = 0;
    let missed = 0;
    let pending = 0;

    for (let day = 1; day <= daysInMonth(); day++) {
      const date = dateKey(monthDate.getFullYear(), monthDate.getMonth(), day);

      for (const prayer of prayers) {
        const status = currentEntry(date, prayer).status;
        if (status === "done") done++;
        else if (status === "missed") missed++;
        else pending++;
      }
    }

    const percent = total ? Math.round((done / total) * 100) : 0;

    $("summary").innerHTML = `
      <div class="summary-card">
        <span class="summary-label">Selesai</span>
        <strong>${done}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">Tertinggal</span>
        <strong>${missed}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">Belum</span>
        <strong>${pending}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">Kemajuan</span>
        <strong>${percent}%</strong>
      </div>
    `;
  }

  async function loadReflection() {
    const notes = $("notes");
    const improvement = $("improvement");
    notes.value = "";
    improvement.value = "";
    setMessage("reflectionMessage", "");

    // Refleksi kekal dikongsi mengikut reka bentuk asal.
    const { data, error } = await supabaseClient
      .from("monthly_reflections")
      .select("*")
      .eq("month_start", monthKey())
      .maybeSingle();

    if (error) {
      setMessage("reflectionMessage", "Gagal memuatkan refleksi: " + error.message, true);
      return;
    }

    if (data) {
      notes.value = data.notes || "";
      improvement.value = data.improvement || "";
    }
  }

  async function saveReflection() {
    if (savingReflection) return;
    savingReflection = true;

    const button = $("saveReflection");
    button.disabled = true;
    setMessage("reflectionMessage", "Sedang menyimpan...");

    try {
      const payload = {
        month_start: monthKey(),
        notes: $("notes").value.trim(),
        improvement: $("improvement").value.trim()
      };

      const { error } = await supabaseClient
        .from("monthly_reflections")
        .upsert(payload, { onConflict: "month_start" });

      if (error) throw error;

      setMessage("reflectionMessage", "Refleksi berjaya disimpan.");
    } catch (error) {
      setMessage(
        "reflectionMessage",
        "Gagal menyimpan refleksi: " + (error.message || error),
        true
      );
    } finally {
      savingReflection = false;
      button.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
```
