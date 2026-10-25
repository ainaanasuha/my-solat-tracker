```javascript
(() => {
  "use strict";

  const PRAYERS = ["Subuh", "Zohor", "Asar", "Maghrib", "Isyak"];
  const STATUSES = ["pending", "done", "missed"];
  const LABELS = {
    pending: "Belum",
    done: "Selesai",
    missed: "Tertinggal"
  };

  const $ = id => document.getElementById(id);

  let db = null;
  let user = null;
  let members = [];
  let selectedUserId = "";
  let month = new Date();
  let entries = new Map();
  let loading = false;
  let operation = 0;

  const key = (date, prayer) => `${date}|${prayer}`;

  function dateKey(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function monthKey() {
    return dateKey(month.getFullYear(), month.getMonth(), 1);
  }

  function monthLabel() {
    return new Intl.DateTimeFormat("ms-MY", {
      month: "long",
      year: "numeric"
    }).format(month);
  }

  function daysInMonth() {
    return new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  }

  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  function notice(message) {
    const el = $("setupNotice");
    if (el) {
      el.textContent = message;
      el.classList.remove("hidden");
    }
  }

  function clearNotice() {
    $("setupNotice")?.classList.add("hidden");
  }

  function message(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function currentEntry(date, prayer) {
    return entries.get(key(date, prayer)) || {
      status: "pending",
      prayed_at: ""
    };
  }

  async function init() {
    $("loginForm").addEventListener("submit", login);
    $("logoutBtn").addEventListener("click", logout);
    $("prevMonth").addEventListener("click", () => changeMonth(-1));
    $("nextMonth").addEventListener("click", () => changeMonth(1));
    $("saveReflection").addEventListener("click", saveReflection);

    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
      notice("config.js tidak mempunyai SUPABASE_URL atau SUPABASE_ANON_KEY.");
      return;
    }

    if (!window.supabase || !window.supabase.createClient) {
      notice("Supabase gagal dimuatkan. Semak sambungan internet dan refresh halaman.");
      return;
    }

    try {
      db = window.supabase.createClient(
        window.SUPABASE_URL,
        window.SUPABASE_ANON_KEY
      );

      const { data, error } = await db.auth.getSession();
      if (error) throw error;

      if (data.session?.user) {
        user = data.session.user;
        await openTracker();
      } else {
        $("authCard").classList.remove("hidden");
      }
    } catch (e) {
      notice("Ralat memulakan aplikasi: " + e.message);
      $("authCard").classList.remove("hidden");
    }
  }

  async function login(event) {
    event.preventDefault();

    if (!db) {
      message("authMessage", "Supabase belum tersedia. Refresh halaman.");
      return;
    }

    const button = $("loginForm").querySelector('button[type="submit"]');
    button.disabled = true;
    message("authMessage", "Sedang log masuk...");
    clearNotice();

    try {
      const { data, error } = await db.auth.signInWithPassword({
        email: $("email").value.trim(),
        password: $("password").value
      });

      if (error) throw error;
      if (!data.user) throw new Error("Akaun pengguna tidak ditemui.");

      user = data.user;
      message("authMessage", "Log masuk berjaya.");
      await openTracker();
    } catch (e) {
      message("authMessage", "Log masuk gagal: " + e.message);
    } finally {
      button.disabled = false;
    }
  }

  async function logout() {
    if (!db) return;

    try {
      const { error } = await db.auth.signOut();
      if (error) throw error;

      user = null;
      selectedUserId = "";
      entries.clear();

      $("appView").classList.add("hidden");
      $("authCard").classList.remove("hidden");
      $("password").value = "";
      message("authMessage", "Anda telah log keluar.");
      clearNotice();
    } catch (e) {
      notice("Gagal log keluar: " + e.message);
    }
  }

  async function openTracker() {
    $("authCard").classList.add("hidden");
    $("appView").classList.remove("hidden");
    $("signedInAs").textContent = user?.email || "Akaun berdaftar";

    try {
      await setupMemberPicker();
      if (selectedUserId) await loadMonth();
    } catch (e) {
      notice("Gagal membuka tracker: " + e.message);
    }
  }

  async function setupMemberPicker() {
    let picker = $("recordUser");

    if (!picker) {
      const toolbar = document.querySelector("#appView .toolbar");
      const label = document.createElement("label");
      label.id = "recordUserLabel";
      label.style.display = "block";
      label.style.marginTop = "12px";
      label.innerHTML =
        'Rekod untuk <select id="recordUser"><option value="">Memuatkan ahli...</option></select>';
      toolbar.appendChild(label);
      picker = $("recordUser");
    }

    picker.onchange = async () => {
      selectedUserId = picker.value;
      entries.clear();
      await loadMonth();
    };

    const { data, error } = await db
      .from("tracker_members")
      .select("user_id,display_name")
      .not("user_id", "is", null)
      .order("display_name");

    if (error) {
      throw new Error("Tidak dapat membaca tracker_members: " + error.message);
    }

    members = (data || []).filter(m => m.user_id && m.display_name);

    if (!members.length) {
      picker.innerHTML = '<option value="">Tiada ahli ditemui</option>';
      selectedUserId = "";
      notice("Tambah Ainaa dan Muaz ke tracker_members, termasuk user_id mereka.");
      return;
    }

    picker.innerHTML = members.map(m =>
      `<option value="${escape(m.user_id)}">${escape(m.display_name)}</option>`
    ).join("");

    if (!members.some(m => m.user_id === selectedUserId)) {
      selectedUserId = members[0].user_id;
    }
    picker.value = selectedUserId;
  }

  function changeMonth(delta) {
    month = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    loadMonth();
  }

  async function loadMonth() {
    if (!db || !selectedUserId || loading) return;

    loading = true;
    const thisOperation = ++operation;
    $("monthLabel").textContent = monthLabel();
    $("prayerTable").innerHTML =
      '<tr><td colspan="6" class="empty">Memuatkan rekod...</td></tr>';

    const first = dateKey(month.getFullYear(), month.getMonth(), 1);
    const last = dateKey(month.getFullYear(), month.getMonth(), daysInMonth());

    try {
      const { data, error } = await db
        .from("prayer_entries")
        .select("id,user_id,prayer_date,prayer_name,status,prayed_at")
        .eq("user_id", selectedUserId)
        .gte("prayer_date", first)
        .lte("prayer_date", last);

      if (error) throw error;
      if (thisOperation !== operation) return;

      entries = new Map(
        (data || []).map(row => [
          key(row.prayer_date, row.prayer_name),
          row
        ])
      );

      renderTable();
      renderSummary();
      await loadReflection();
      clearNotice();
    } catch (e) {
      $("prayerTable").innerHTML =
        `<tr><td colspan="6" class="empty">Ralat: ${escape(e.message)}</td></tr>`;
      notice("Gagal memuatkan rekod solat: " + e.message);
    } finally {
      loading = false;
    }
  }

  function renderTable() {
    const html = [];

    for (let day = 1; day <= daysInMonth(); day++) {
      const date = dateKey(month.getFullYear(), month.getMonth(), day);
      const dateText = new Intl.DateTimeFormat("ms-MY", {
        weekday: "short",
        day: "numeric",
        month: "short"
      }).format(new Date(month.getFullYear(), month.getMonth(), day));

      html.push(`<tr>
        <td>${escape(dateText)}</td>
        ${PRAYERS.map(prayer => {
          const entry = currentEntry(date, prayer);
          const status = STATUSES.includes(entry.status) ? entry.status : "pending";
          return `<td>
            <button type="button"
              class="status-btn status-${status}"
              data-date="${date}" data-prayer="${prayer}">
              ${LABELS[status]}
            </button>
            <input type="time" class="time-input"
              aria-label="Masa ${prayer} ${date}"
              data-date="${date}" data-prayer="${prayer}"
              value="${escape(entry.prayed_at || "")}">
          </td>`;
        }).join("")}
      </tr>`);
    }

    $("prayerTable").innerHTML = html.join("");

    $("prayerTable").querySelectorAll(".status-btn").forEach(button => {
      button.addEventListener("click", async () => {
        const { date, prayer } = button.dataset;
        const old = currentEntry(date, prayer);
        const next = STATUSES[(STATUSES.indexOf(old.status) + 1) % STATUSES.length];
        await savePrayer(date, prayer, next, old.prayed_at || "");
      });
    });

    $("prayerTable").querySelectorAll(".time-input").forEach(input => {
      input.addEventListener("change", async () => {
        const { date, prayer } = input.dataset;
        const old = currentEntry(date, prayer);
        await savePrayer(date, prayer, old.status || "pending", input.value);
      });
    });
  }

  async function savePrayer(date, prayer, status, time) {
    if (!selectedUserId) {
      notice("Pilih Ainaa atau Muaz terlebih dahulu.");
      return;
    }

    const payload = {
      user_id: selectedUserId,
      prayer_date: date,
      prayer_name: prayer,
      status,
      prayed_at: time || null
    };

    try {
      const { data, error } = await db
        .from("prayer_entries")
        .upsert(payload, {
          onConflict: "user_id,prayer_date,prayer_name"
        })
        .select("id,user_id,prayer_date,prayer_name,status,prayed_at")
        .single();

      if (error) throw error;

      entries.set(key(date, prayer), data);
      renderTable();
      renderSummary();
      clearNotice();
    } catch (e) {
      notice("Gagal menyimpan solat: " + e.message);
    }
  }

  function renderSummary() {
    let done = 0;
    let missed = 0;
    let pending = 0;

    for (let day = 1; day <= daysInMonth(); day++) {
      const date = dateKey(month.getFullYear(), month.getMonth(), day);

      for (const prayer of PRAYERS) {
        const status = currentEntry(date, prayer).status;
        if (status === "done") done++;
        else if (status === "missed") missed++;
        else pending++;
      }
    }

    const total = daysInMonth() * PRAYERS.length;
    const percent = Math.round((done / total) * 100);

    $("summary").innerHTML = `
      <div class="summary-card"><span>Selesai</span><strong>${done}</strong></div>
      <div class="summary-card"><span>Tertinggal</span><strong>${missed}</strong></div>
      <div class="summary-card"><span>Belum</span><strong>${pending}</strong></div>
      <div class="summary-card"><span>Kemajuan</span><strong>${percent}%</strong></div>`;
  }

  async function loadReflection() {
    $("notes").value = "";
    $("improvement").value = "";
    message("reflectionMessage", "");

    try {
      const { data, error } = await db
        .from("monthly_reflections")
        .select("*")
        .eq("month_start", monthKey())
        .maybeSingle();

      if (error) throw error;

      if (data) {
        $("notes").value = data.notes || "";
        $("improvement").value = data.improvement || "";
      }
    } catch (e) {
      message("reflectionMessage", "Gagal memuat refleksi: " + e.message);
    }
  }

  async function saveReflection() {
    const button = $("saveReflection");
    button.disabled = true;
    message("reflectionMessage", "Sedang menyimpan...");

    try {
      const { error } = await db
        .from("monthly_reflections")
        .upsert({
          month_start: monthKey(),
          notes: $("notes").value.trim(),
          improvement: $("improvement").value.trim()
        }, {
          onConflict: "month_start"
        });

      if (error) throw error;
      message("reflectionMessage", "Refleksi berjaya disimpan.");
    } catch (e) {
      message("reflectionMessage", "Gagal menyimpan refleksi: " + e.message);
    } finally {
      button.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
```
