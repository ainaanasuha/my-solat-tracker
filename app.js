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
  let currentUser;
  let members = [];
  let selectedUserId = "";
  let monthDate = new Date();
  let entries = new Map();
  let loading = false;

  function showNotice(message) {
    const notice = $("setupNotice");
    if (!notice) {
      alert(message);
      return;
    }
    notice.textContent = message;
    notice.classList.remove("hidden");
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

  function memberName(member) {
    return member.display_name || member.email || "Pengguna";
  }

  // Tambah pilihan pengguna tanpa perlu mengubah HTML asal.
  function setupUserPicker() {
    let picker = $("recordUser");

    if (!picker) {
      const container = document.createElement("div");
      container.id = "recordUserContainer";
      container.style.cssText = "margin:12px 0;";

      const label = document.createElement("label");
      label.htmlFor = "recordUser";
      label.textContent = "Papar rekod untuk: ";
      label.style.marginRight = "8px";

      picker = document.createElement("select");
      picker.id = "recordUser";
      picker.style.cssText =
        "padding:8px;border-radius:8px;max-width:100%;";

      container.append(label, picker);

      const signedIn = $("signedInAs");
      if (signedIn) {
        signedIn.insertAdjacentElement("afterend", container);
      } else {
        $("appView").prepend(container);
      }
    }

    picker.replaceChildren();

    members.forEach((member) => {
      const option = document.createElement("option");
      option.value = member.user_id;
      option.textContent = memberName(member);
      picker.appendChild(option);
    });

    picker.value = selectedUserId;

    // Elakkan memasang event listener berulang kali.
    if (picker.dataset.listenerAdded !== "true") {
      picker.addEventListener("change", async () => {
        selectedUserId = picker.value;
        await loadMonth();
      });
      picker.dataset.listenerAdded = "true";
    }
  }

  async function init() {
    if (
      !window.SUPABASE_URL ||
      !window.SUPABASE_ANON_KEY ||
      window.SUPABASE_URL.includes("PASTE_") ||
      window.SUPABASE_ANON_KEY.includes("PASTE_")
    ) {
      showNotice(
        "Setup diperlukan: semak config.js dan masukkan Project URL serta anon/public key Supabase."
      );
      $("authCard").classList.remove("hidden");
      $("loginForm").addEventListener("submit", (event) => {
        event.preventDefault();
        $("authMessage").textContent = "Sila lengkapkan config.js dahulu.";
      });
      return;
    }

    if (!window.supabase?.createClient) {
      showNotice(
        "Pustaka Supabase tidak dapat dimuatkan. Semak sambungan internet dan muat semula halaman."
      );
      return;
    }

    supabaseClient = window.supabase.createClient(
      window.SUPABASE_URL,
      window.SUPABASE_ANON_KEY
    );

   $("loginForm").addEventListener("submit", (event) => {
  event.preventDefault();
  $("authMessage").textContent = "Butang ditekan, sedang cuba log masuk...";
  login(event);
});
    $("logoutBtn").addEventListener("click", logout);
    $("prevMonth").addEventListener("click", () => changeMonth(-1));
    $("nextMonth").addEventListener("click", () => changeMonth(1));
    $("saveReflection").addEventListener("click", saveReflection);

    const { data, error } = await supabaseClient.auth.getSession();

    if (error) {
      showNotice(`Gagal menyemak sesi log masuk: ${error.message}`);
      return;
    }

    if (data.session) {
      currentUser = data.session.user;
      await enterApp();
    } else {
      $("authCard").classList.remove("hidden");
    }

    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      if (session && !currentUser) {
        currentUser = session.user;
        await enterApp();
      } else if (!session) {
        currentUser = null;
        selectedUserId = "";
        members = [];
        entries.clear();
        $("appView").classList.add("hidden");
        $("authCard").classList.remove("hidden");
      }
    });
  }

  
async function login(event) {
  event.preventDefault();

  const message = $("authMessage");
  const email = $("email").value.trim();
  const password = $("password").value;

  message.textContent = "Sedang log masuk...";
  const submitButton = $("loginForm").querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;

  try {
    if (!supabaseClient) {
      throw new Error("Supabase belum disediakan. Semak config.js.");
    }

    const result = await Promise.race([
      supabaseClient.auth.signInWithPassword({ email, password }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Sambungan mengambil masa terlalu lama. Semak internet dan tetapan Supabase.")),
          15000
        )
      )
    ]);

    if (result.error) {
      message.textContent = `Tak berjaya log masuk: ${result.error.message}`;
    } else {
      message.textContent = "Berjaya log masuk.";
    }
  } catch (error) {
    message.textContent = `Ralat log masuk: ${error.message}`;
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}


  async function logout() {
    await supabaseClient.auth.signOut();
    currentUser = null;
    selectedUserId = "";
    members = [];
    entries.clear();

    $("appView").classList.add("hidden");
    $("authCard").classList.remove("hidden");
    $("password").value = "";
  }

  async function enterApp() {
    $("authCard").classList.add("hidden");
    $("appView").classList.remove("hidden");
    $("signedInAs").textContent = currentUser.email || "Akaun berdaftar";

    // Ambil senarai nama dan ID pengguna.
    const { data, error } = await supabaseClient
      .from("tracker_members")
      .select("user_id,display_name");

    if (error) {
      showNotice(
        `Tak dapat memuatkan senarai pengguna: ${error.message}. Semak polisi akses tracker_members.`
      );
      return;
    }

    members = (data || []).filter((member) => member.user_id);

    // Pastikan pengguna yang sedang log masuk turut tersedia.
    if (!members.some((member) => member.user_id === currentUser.id)) {
      members.push({
        user_id: currentUser.id,
        display_name: currentUser.email || "Akaun saya"
      });
    }

    // Pilihan awal ialah pengguna yang sedang log masuk.
    selectedUserId = members.some(
      (member) => member.user_id === currentUser.id
    )
      ? currentUser.id
      : members[0]?.user_id || "";

    if (!selectedUserId) {
      showNotice("Tiada pengguna ditemui dalam tracker_members.");
      return;
    }

    setupUserPicker();
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
    if (!selectedUserId || loading) return;
    loading = true;

    $("monthLabel").textContent = monthLabel();
    $("prayerTable").innerHTML =
      '<tr><td colspan="6" class="empty">Memuatkan rekod…</td></tr>';

    const first = dateKey(
      monthDate.getFullYear(),
      monthDate.getMonth(),
      1
    );

    const last = dateKey(
      monthDate.getFullYear(),
      monthDate.getMonth(),
      daysInMonth()
    );

    try {
      const { data, error } = await supabaseClient
        .from("prayer_entries")
        .select("user_id,prayer_date,prayer_name,status,prayed_at")
        .eq("user_id", selectedUserId)
        .gte("prayer_date", first)
        .lte("prayer_date", last);

      if (error) throw error;

      // Data lama dengan user_id NULL tidak akan masuk ke paparan.
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
      const date = dateKey(
        monthDate.getFullYear(),
        monthDate.getMonth(),
        day
      );

      const tr = document.createElement("tr");
      const tdDate = document.createElement("td");

      tdDate.textContent = new Intl.DateTimeFormat("ms-MY", {
        day: "numeric",
        weekday: "short"
      }).format(
        new Date(
          monthDate.getFullYear(),
          monthDate.getMonth(),
          day
        )
      );

      tr.appendChild(tdDate);

      prayers.forEach((prayer) => {
        const td = document.createElement("td");
        const entry = currentEntry(date, prayer);

        const btn = document.createElement("button");
        btn.className =
          `status-btn ${entry.status === "done" ? "status-done" : entry.status === "missed" ? "status-missed" : ""}`;
        btn.textContent = statusLabels[entry.status] || "Belum";
        btn.title = "Tekan untuk tukar status";

        btn.addEventListener("click", async () => {
          const next = statusOrder[
            (statusOrder.indexOf(entry.status) + 1) % statusOrder.length
          ];

          btn.disabled = true;
          const result = await savePrayer(
            date,
            prayer,
            next,
            entry.prayed_at || ""
          );
          btn.disabled = false;

          if (result) {
            entries.set(entryKey(date, prayer), {
              user_id: selectedUserId,
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
          const saved = await savePrayer(
            date,
            prayer,
            entry.status,
            time.value
          );

          if (saved) {
            entries.set(entryKey(date, prayer), {
              user_id: selectedUserId,
              prayer_date: date,
              prayer_name: prayer,
              status: entry.status,
              prayed_at: time.value || null
            });
            renderSummary();
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
      alert("Sila pilih pengguna dahulu.");
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
      const date = dateKey(
        monthDate.getFullYear(),
        monthDate.getMonth(),
        day
      );

      for (const prayer of prayers) {
        const status = currentEntry(date, prayer).status;

        if (status === "done") done++;
        else if (status === "missed") missed++;
        else pending++;
      }
    }

    $("summary").innerHTML = "";

    [
      ["Selesai", done],
      ["Tertinggal", missed],
      ["Belum direkod", pending]
    ].forEach(([label, value]) => {
      const div = document.createElement("div");
      div.className = "stat";

      const span = document.createElement("span");
      span.textContent = label;

      const strong = document.createElement("strong");
      strong.textContent = value;

      div.append(span, strong);
      $("summary").appendChild(div);
    });
  }

  // Refleksi bulanan dikekalkan seperti asal dan masih dikongsi.
  async function loadReflection() {
    $("reflectionMessage").textContent = "";

    const { data, error } = await supabaseClient
      .from("monthly_reflections")
      .select("notes,improvement")
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
    $("saveReflection").disabled = true;
    $("reflectionMessage").textContent = "Menyimpan...";

    const { error } = await supabaseClient
      .from("monthly_reflections")
      .upsert(
        {
          month: monthKey(),
          notes: $("notes").value,
          improvement: $("improvement").value
        },
        { onConflict: "month" }
      );

    $("saveReflection").disabled = false;
    $("reflectionMessage").textContent = error
      ? `Tak berjaya simpan: ${error.message}`
      : "Refleksi berjaya disimpan untuk dikongsi. 💚";
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[ch]);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
```
