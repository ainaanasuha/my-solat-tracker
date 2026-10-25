
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

  let supabaseClient = null;
  let currentUser = null;
  let members = [];
  let selectedUserId = "";
  let monthDate = new Date();
  let entries = new Map();
  let loading = false;

  function showNotice(message) {
    const el = $("setupNotice");
    if (el) {
      el.textContent = message;
      el.classList.remove("hidden");
    } else {
      console.error(message);
    }
  }

  function showAuthMessage(message) {
    const el = $("authMessage");
    if (el) el.textContent = message;
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

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch]));
  }

  async function init() {
    try {
      if (
        !window.SUPABASE_URL ||
        !window.SUPABASE_ANON_KEY ||
        window.SUPABASE_URL.includes("PASTE_") ||
        window.SUPABASE_ANON_KEY.includes("PASTE_")
      ) {
        showNotice("Semak config.js: Project URL dan anon/public key Supabase diperlukan.");
        $("authCard")?.classList.remove("hidden");
        return;
      }

      if (!window.supabase?.createClient) {
        showNotice("Pustaka Supabase gagal dimuatkan. Semak internet dan muat semula halaman.");
        return;
      }

      supabaseClient = window.supabase.createClient(
        window.SUPABASE_URL,
        window.SUPABASE_ANON_KEY
      );

      const loginForm = $("loginForm");
      if (!loginForm) {
        showNotice("Borang loginForm tidak dijumpai dalam HTML.");
        return;
      }

      loginForm.addEventListener("submit", login);

      $("logoutBtn")?.addEventListener("click", logout);
      $("prevMonth")?.addEventListener("click", () => changeMonth(-1));
      $("nextMonth")?.addEventListener("click", () => changeMonth(1));
      $("saveReflection")?.addEventListener("click", saveReflection);

      showAuthMessage("Sedia untuk log masuk.");

      const { data, error } = await supabaseClient.auth.getSession();

      if (error) {
        showAuthMessage(`Gagal menyemak sesi: ${error.message}`);
        return;
      }

      if (data.session) {
        currentUser = data.session.user;
        await enterApp();
      } else {
        $("authCard")?.classList.remove("hidden");
      }

      supabaseClient.auth.onAuthStateChange((_event, session) => {
        setTimeout(async () => {
          try {
            if (session) {
              currentUser = session.user;
              await enterApp();
            } else {
              currentUser = null;
              selectedUserId = "";
              members = [];
              entries.clear();
              $("appView")?.classList.add("hidden");
              $("authCard")?.classList.remove("hidden");
            }
          } catch (error) {
            showNotice(`Ralat sesi: ${error.message}`);
          }
        }, 0);
      });
    } catch (error) {
      showNotice(`Ralat memulakan aplikasi: ${error.message}`);
      console.error(error);
    }
  }

  async function login(event) {
    event.preventDefault();

    const form = $("loginForm");
    const button = form?.querySelector('button[type="submit"]');
    const email = $("email")?.value.trim();
    const password = $("password")?.value;

    if (!supabaseClient) {
      showAuthMessage("Supabase belum disediakan. Semak config.js.");
      return;
    }

    if (!email || !password) {
      showAuthMessage("Masukkan email dan kata laluan.");
      return;
    }

    if (button) button.disabled = true;
    showAuthMessage("Sedang log masuk...");

    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        showAuthMessage(`Tak berjaya log masuk: ${error.message}`);
        return;
      }

      currentUser = data.user;
      showAuthMessage("Berjaya log masuk.");

      await enterApp();
    } catch (error) {
      showAuthMessage(`Ralat log masuk: ${error.message}`);
      console.error("Login error:", error);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function logout() {
    if (!supabaseClient) return;

    const { error } = await supabaseClient.auth.signOut();

    if (error) {
      showNotice(`Gagal log keluar: ${error.message}`);
      return;
    }

    currentUser = null;
    selectedUserId = "";
    members = [];
    entries.clear();

    $("appView")?.classList.add("hidden");
    $("authCard")?.classList.remove("hidden");
    if ($("password")) $("password").value = "";
    showAuthMessage("");
  }

  async function enterApp() {
    $("authCard")?.classList.add("hidden");
    $("appView")?.classList.remove("hidden");

    if ($("signedInAs")) {
      $("signedInAs").textContent = currentUser?.email || "Akaun berdaftar";
    }

    await setupUserPicker();
  }

  async function setupUserPicker() {
    const appView = $("appView");
    if (!appView || !currentUser) return;

    let picker = $("recordUser");

    if (!picker) {
      picker = document.createElement("select");
      picker.id = "recordUser";
      picker.setAttribute("aria-label", "Pilih rekod pengguna");

      const wrapper = document.createElement("div");
      wrapper.className = "panel";
      const label = document.createElement("label");
      label.textContent = "Rekod untuk: ";
      label.appendChild(picker);
      wrapper.appendChild(label);

      appView.prepend(wrapper);
    }

    picker.disabled = true;
    picker.innerHTML = '<option value="">Memuatkan pengguna...</option>';

    const { data, error } = await supabaseClient
      .from("tracker_members")
      .select("user_id, display_name")
      .not("user_id", "is", null)
      .order("display_name");

    if (error) {
      picker.innerHTML = '<option value="">Gagal memuatkan pengguna</option>';
      showNotice(`Tak dapat memuatkan tracker_members: ${error.message}`);
      return;
    }

    members = data || [];
    picker.innerHTML = "";

    if (!members.length) {
      picker.innerHTML = '<option value="">Tiada pengguna tersedia</option>';
      showNotice("Pastikan tracker_members mempunyai nama dan user_id yang betul.");
      return;
    }

    members.forEach((member) => {
      const option = document.createElement("option");
      option.value = member.user_id;
      option.textContent = member.display_name;
      picker.appendChild(option);
    });

    const previousId = selectedUserId;
    selectedUserId = members.some((m) => m.user_id === previousId)
      ? previousId
      : members[0].user_id;

    picker.value = selectedUserId;
    picker.disabled = false;

    picker.onchange = async () => {
      selectedUserId = picker.value;
      entries.clear();
      await loadMonth();
    };

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

    try {
      if ($("monthLabel")) $("monthLabel").textContent = monthLabel();

      const tbody = $("prayerTable");
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty">Memuatkan rekod...</td></tr>';
      }

      const first = dateKey(monthDate.getFullYear(), monthDate.getMonth(), 1);
      const last = dateKey(monthDate.getFullYear(), monthDate.getMonth(), daysInMonth());

      const { data, error } = await supabaseClient
        .from("prayer_entries")
        .select("user_id, prayer_date, prayer_name, status, prayed_at")
        .eq("user_id", selectedUserId)
        .gte("prayer_date", first)
        .lte("prayer_date", last);

      if (error) {
        if (tbody) {
          tbody.innerHTML = `<tr><td colspan="6" class="empty">Ralat memuatkan rekod: ${escapeHtml(error.message)}</td></tr>`;
        }
        return;
      }

      entries = new Map(
        (data || []).map((row) => [
          entryKey(row.prayer_date, row.prayer_name),
          row
        ])
      );

      renderTable();
      renderSummary();
      await loadReflection();
    } catch (error) {
      showNotice(`Ralat memuatkan bulan: ${error.message}`);
      console.error(error);
    } finally {
      loading = false;
    }
  }

  function renderTable() {
    const tbody = $("prayerTable");
    if (!tbody) return;

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

      prayers.forEach((prayer) => {
        const td = document.createElement("td");
        const entry = currentEntry(date, prayer);

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `status-btn ${entry.status === "done" ? "status-done" : entry.status === "missed" ? "status-missed" : ""}`;
        btn.textContent = statusLabels[entry.status] || "Belum";
        btn.title = "Tekan untuk tukar status";

        btn.addEventListener("click", async () => {
          const next = statusOrder[
            (statusOrder.indexOf(entry.status) + 1) % statusOrder.length
          ];

          btn.disabled = true;
          const saved = await savePrayer(date, prayer, next, entry.prayed_at || "");

          if (saved) {
            entries.set(entryKey(date, prayer), {
              user_id: selectedUserId,
              prayer_date: date,
              prayer_name: prayer,
              status: next,
              prayed_at: entry.prayed_at || null
            });
            renderTable();
            renderSummary();
          } else {
            btn.disabled = false;
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
              user_id: selectedUserId,
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
      alert("Pilih pengguna dahulu.");
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

  async function loadReflection() {
    if (!$("reflectionMessage")) return;

    $("reflectionMessage").textContent = "";

    const { data, error } = await supabaseClient
      .from("monthly_reflections")
      .select("notes, improvement")
      .eq("month", monthKey())
      .maybeSingle();

    if (error) {
      $("reflectionMessage").textContent = `Tak dapat memuatkan refleksi: ${error.message}`;
      return;
    }

    if ($("notes")) $("notes").value = data?.notes || "";
    if ($("improvement")) $("improvement").value = data?.improvement || "";
  }

  async function saveReflection() {
    const button = $("saveReflection");
    if (!button) return;

    button.disabled = true;
    if ($("reflectionMessage")) {
      $("reflectionMessage").textContent = "Menyimpan...";
    }

    try {
      const { error } = await supabaseClient
        .from("monthly_reflections")
        .upsert({
          month: monthKey(),
          notes: $("notes")?.value || "",
          improvement: $("improvement")?.value || ""
        }, {
          onConflict: "month"
        });

      if ($("reflectionMessage")) {
        $("reflectionMessage").textContent = error
          ? `Tak berjaya simpan: ${error.message}`
          : "Refleksi berjaya disimpan. 💚";
      }
    } catch (error) {
      if ($("reflectionMessage")) {
        $("reflectionMessage").textContent = `Ralat: ${error.message}`;
      }
    } finally {
      button.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
