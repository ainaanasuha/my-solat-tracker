(() => {
  const prayers = ["Subuh", "Zohor", "Asar", "Maghrib", "Isyak"];
  const statusOrder = ["pending", "done", "missed"];
  const statusLabels = { pending: "Belum", done: "Selesai", missed: "Tertinggal" };
  const $ = (id) => document.getElementById(id);
  let supabaseClient, currentUser, monthDate = new Date();
  let entries = new Map();

  function showNotice(message) { $("setupNotice").textContent = message; $("setupNotice").classList.remove("hidden"); }
  function dateKey(year, month, day) { return `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`; }
  function monthKey() { return `${monthDate.getFullYear()}-${String(monthDate.getMonth()+1).padStart(2,"0")}-01`; }
  function monthLabel() { return new Intl.DateTimeFormat("ms-MY", {month:"long",year:"numeric"}).format(monthDate); }
  function daysInMonth() { return new Date(monthDate.getFullYear(), monthDate.getMonth()+1, 0).getDate(); }
  function entryKey(date, prayer) { return `${date}|${prayer}`; }
  function currentEntry(date, prayer) { return entries.get(entryKey(date, prayer)) || {status:"pending", prayed_at:""}; }

  async function init() {
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY || window.SUPABASE_URL.includes("PASTE_") || window.SUPABASE_ANON_KEY.includes("PASTE_")) {
      showNotice("Setup diperlukan: salin config.example.js sebagai config.js dan masukkan Project URL serta anon/public key Supabase.");
      $("authCard").classList.remove("hidden"); $("loginForm").addEventListener("submit", e => {e.preventDefault(); $("authMessage").textContent="Sila lengkapkan config.js dahulu.";});
      return;
    }
    if (!window.supabase || !window.supabase.createClient) { showNotice("Pustaka Supabase tidak dapat dimuatkan. Semak sambungan internet dan muat semula halaman."); return; }
    supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    $("loginForm").addEventListener("submit", login);
    $("logoutBtn").addEventListener("click", logout);
    $("prevMonth").addEventListener("click", () => changeMonth(-1));
    $("nextMonth").addEventListener("click", () => changeMonth(1));
    $("saveReflection").addEventListener("click", saveReflection);
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) { currentUser = session.user; await enterApp(); } else { $("authCard").classList.remove("hidden"); }
    supabaseClient.auth.onAuthStateChange(async (_event, sessionNow) => {
      if (sessionNow && !currentUser) { currentUser = sessionNow.user; await enterApp(); }
      if (!sessionNow) { currentUser = null; $("appView").classList.add("hidden"); $("authCard").classList.remove("hidden"); }
    });
  }
  async function login(event) {
    event.preventDefault(); $("authMessage").textContent = "Sedang log masuk...";
    const { error } = await supabaseClient.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
    $("authMessage").textContent = error ? `Tak berjaya log masuk: ${error.message}` : "Berjaya log masuk.";
  }
  async function logout() { await supabaseClient.auth.signOut(); currentUser = null; $("appView").classList.add("hidden"); $("authCard").classList.remove("hidden"); $("password").value = ""; }
  async function enterApp() {
    $("authCard").classList.add("hidden"); $("appView").classList.remove("hidden");
    $("signedInAs").textContent = currentUser.email || "Akaun berdaftar";
    await loadMonth();
  }
  function changeMonth(delta) { monthDate = new Date(monthDate.getFullYear(), monthDate.getMonth()+delta, 1); loadMonth(); }
  async function loadMonth() {
    $("monthLabel").textContent = monthLabel(); $("prayerTable").innerHTML = '<tr><td colspan="6" class="empty">Memuatkan rekod…</td></tr>';
    const first = dateKey(monthDate.getFullYear(),monthDate.getMonth(),1);
    const last = dateKey(monthDate.getFullYear(),monthDate.getMonth(),daysInMonth());
    const {data,error} = await supabaseClient.from("prayer_entries").select("prayer_date,prayer_name,status,prayed_at").gte("prayer_date",first).lte("prayer_date",last);
    if (error) { $("prayerTable").innerHTML = `<tr><td colspan="6" class="empty">Ralat memuatkan rekod: ${escapeHtml(error.message)}</td></tr>`; return; }
    entries = new Map((data||[]).map(row => [entryKey(row.prayer_date,row.prayer_name), row]));
    renderTable(); renderSummary(); await loadReflection();
  }
  function renderTable() {
    const tbody = $("prayerTable"); tbody.innerHTML = "";
    for (let day=1; day<=daysInMonth(); day++) {
      const date = dateKey(monthDate.getFullYear(),monthDate.getMonth(),day);
      const tr = document.createElement("tr");
      const tdDate = document.createElement("td");
      tdDate.textContent = new Intl.DateTimeFormat("ms-MY",{day:"numeric",weekday:"short"}).format(new Date(monthDate.getFullYear(),monthDate.getMonth(),day));
      tr.appendChild(tdDate);
      prayers.forEach(prayer => {
        const td = document.createElement("td"), entry = currentEntry(date,prayer);
        const btn = document.createElement("button"); btn.className = `status-btn ${entry.status==="done"?"status-done":entry.status==="missed"?"status-missed":""}`; btn.textContent=statusLabels[entry.status]||"Belum";
        btn.title = "Tekan untuk tukar status";
        btn.addEventListener("click", async () => {
          const next = statusOrder[(statusOrder.indexOf(entry.status)+1)%statusOrder.length];
          btn.disabled=true; const result=await savePrayer(date,prayer,next,entry.prayed_at||""); btn.disabled=false;
          if (result) { entries.set(entryKey(date,prayer),{prayer_date:date,prayer_name:prayer,status:next,prayed_at:entry.prayed_at||null}); renderTable(); renderSummary(); }
        });
        td.appendChild(btn);
        const time=document.createElement("input"); time.type="time"; time.className="time-input"; time.value=(entry.prayed_at||"").slice(0,5); time.setAttribute("aria-label",`Masa ${prayer} ${date}`);
        time.addEventListener("change",async()=>{const saved=await savePrayer(date,prayer,entry.status,time.value); if(saved){entries.set(entryKey(date,prayer),{prayer_date:date,prayer_name:prayer,status:entry.status,prayed_at:time.value||null});renderSummary();}});
        td.appendChild(time); tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
  }
  async function savePrayer(date, prayer, status, time) {
    const row={prayer_date:date,prayer_name:prayer,status,prayed_at:time||null};
    const {error}=await supabaseClient.from("prayer_entries").upsert(row,{onConflict:"prayer_date,prayer_name"});
    if(error){alert(`Tak dapat simpan rekod: ${error.message}`);return false;} return true;
  }
  function renderSummary() {
    let done=0,missed=0,pending=0;
    for(let d=1;d<=daysInMonth();d++){const date=dateKey(monthDate.getFullYear(),monthDate.getMonth(),d);for(const p of prayers){const s=currentEntry(date,p).status;if(s==="done")done++;else if(s==="missed")missed++;else pending++;}}
    $("summary").innerHTML="";
    [["Selesai",done],["Tertinggal",missed],["Belum direkod",pending]].forEach(([label,value])=>{const div=document.createElement("div");div.className="stat";const span=document.createElement("span");span.textContent=label;const strong=document.createElement("strong");strong.textContent=value;div.append(span,strong);$("summary").appendChild(div);});
  }
  async function loadReflection() {
    $("reflectionMessage").textContent="";
    const {data,error}=await supabaseClient.from("monthly_reflections").select("notes,improvement").eq("month",monthKey()).maybeSingle();
    if(error){$("reflectionMessage").textContent=`Tak dapat memuatkan refleksi: ${error.message}`;return;}
    $("notes").value=data?.notes||""; $("improvement").value=data?.improvement||"";
  }
  async function saveReflection() {
    $("saveReflection").disabled=true; $("reflectionMessage").textContent="Menyimpan...";
    const {error}=await supabaseClient.from("monthly_reflections").upsert({month:monthKey(),notes:$("notes").value,improvement:$("improvement").value},{onConflict:"month"});
    $("saveReflection").disabled=false; $("reflectionMessage").textContent=error?`Tak berjaya simpan: ${error.message}`:"Refleksi berjaya disimpan untuk dikongsi. 💚";
  }
  function escapeHtml(value){return String(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));}
  document.addEventListener("DOMContentLoaded", init);
})();
