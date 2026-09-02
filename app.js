import { firebaseConfig, AUTH_ALIAS_DOMAIN } from "./firebase-config.js";

import {
  initializeApp,
  deleteApp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const $ = id => document.getElementById(id);

const state = {
  chairs: [],
  barbers: [],
  services: [],
  products: [],
  sales: [],
  appointments: [],
  chargeRequests: [],
  clientAppointments: [],
  bookedSlots: []
};

let app;
let auth;
let db;
let currentRole = null;
let currentBarber = null;
let currentAdmin = null;
const ANY_BARBER = "__ANY__";
let booking = { serviceId: null, barberId: null };
let barberProductCart = [];
let barberServiceViewMode = "cards";
let unsubscribers = [];

function money(v) {
  return new Intl.NumberFormat("es-PA", { style:"currency", currency:"USD" }).format(Number(v || 0));
}

function isoDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function jsDate(v) {
  if (!v) return new Date(0);
  if (typeof v.toDate === "function") return v.toDate();
  return new Date(v);
}

function todayIso(v) {
  return jsDate(v).toISOString().slice(0,10) === isoDay();
}

function fmtDateTime(v) {
  return jsDate(v).toLocaleString("es-PA", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" });
}

function fmtDateOnly(day) {
  const [y,m,d] = String(day).split("-").map(Number);
  return new Date(y,m-1,d).toLocaleDateString("es-PA", { weekday:"short", day:"2-digit", month:"short" });
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
}

function statusLabel(v) {
  return {
    pending:"Pendiente", confirmed:"Confirmada", completed:"Completada", cancelled:"Cancelada",
    approved:"Aprobado", rejected:"Rechazado"
  }[v] || v;
}

function monthKey(value = new Date()) {
  const d = value instanceof Date ? value : jsDate(value);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}

function dayKey(value) {
  const d = jsDate(value);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function monthLabel(key) {
  if (!key) return "";
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month-1, 1).toLocaleDateString("es-PA", { month:"long", year:"numeric" });
}

function shortDayLabel(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month-1, day).toLocaleDateString("es-PA", { day:"2-digit", month:"short", year:"numeric" });
}

function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => node.classList.remove("show"), 2600);
}

function show(id) { const el = $(id); if (el) el.classList.remove("hidden"); }
function hide(id) { const el = $(id); if (el) el.classList.add("hidden"); }
function openModal(id) { const el = $(id); if (el) el.classList.add("show"); }
function closeModal(id) { const el = $(id); if (el) el.classList.remove("show"); }

function bind(id, eventName, handler) {
  const el = $(id);
  if (!el) {
    console.warn(`[Los Mágicos] Elemento opcional no encontrado: #${id}`);
    return;
  }
  el.addEventListener(eventName, handler);
}

function cleanupListeners() {
  for (const unsub of unsubscribers) {
    try { unsub(); } catch {}
  }
  unsubscribers = [];
}

function usernameToEmail(username) {
  const clean = String(username || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return `${clean}@${AUTH_ALIAS_DOMAIN}`;
}

function firebaseErrorMessage(err, fallback = "Ocurrió un error") {
  const code = String(err?.code || "");
  if (code.includes("auth/unauthorized-domain")) {
    return "Este dominio no está autorizado en Firebase. Agrega tu dominio de GitHub Pages en Authentication → Configuración → Dominios autorizados.";
  }
  if (code.includes("auth/invalid-credential") || code.includes("auth/wrong-password") || code.includes("auth/user-not-found")) {
    return "Credenciales incorrectas.";
  }
  if (code.includes("auth/email-already-in-use")) return "Ese usuario ya existe.";
  if (code.includes("auth/weak-password")) return "La contraseña debe tener al menos 6 caracteres.";
  if (code.includes("permission-denied")) return "Firebase rechazó la operación por permisos. Revisa las reglas de Firestore.";
  if (code.includes("failed-precondition")) return "Falta una configuración o índice de Firebase.";
  return fallback;
}

async function initFirebase() {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    await setPersistence(auth, browserLocalPersistence);
    db = getFirestore(app);
    return true;
  } catch (err) {
    console.error(err);
    const alert = $("firebaseAlert");
    alert.textContent = "No se pudo iniciar Firebase. Revisa firebase-config.js.";
    alert.classList.remove("hidden");
    return false;
  }
}

function resetScreens() {
  hide("adminApp");
  hide("barberApp");
  hide("clientApp");
  show("accessScreen");
}

async function logout() {
  cleanupListeners();
  currentRole = null;
  currentBarber = null;
  currentAdmin = null;
  booking = { serviceId:null, barberId:null };
  try {
    if (auth?.currentUser) await signOut(auth);
  } catch {}
  resetScreens();
}

function wireStaticUI() {
  bind("openAdmin", "click", () => openModal("adminLoginModal"));
  bind("openBarber", "click", () => openModal("barberLoginModal"));
  bind("openClient", "click", enterClient);

  document.querySelectorAll("[data-close]").forEach(btn =>
    btn.addEventListener("click", () => closeModal(btn.dataset.close))
  );

  document.querySelectorAll(".modal-backdrop").forEach(modal =>
    modal.addEventListener("click", e => {
      if (e.target === modal) closeModal(modal.id);
    })
  );

  document.querySelectorAll("[data-logout]").forEach(btn =>
    btn.addEventListener("click", logout)
  );

  document.querySelectorAll(".nav-item").forEach(btn =>
    btn.addEventListener("click", () => switchAdminView(btn.dataset.view))
  );

  document.querySelectorAll("[data-go]").forEach(btn =>
    btn.addEventListener("click", () => switchAdminView(btn.dataset.go))
  );

  bind("adminMenuBtn", "click", () => $("adminSidebar").classList.toggle("open"));
  bind("appointmentFilter", "change", renderAppointments);
  bind("saleService", "change", syncSalePrice);
  bind("saleBarber", "change", syncSaleChair);
  bind("clientDate", "change", () => {
    updateSelectedDateSummary();
    renderAvailableTimes();
  });
  bind("clientDate", "input", () => {
    updateSelectedDateSummary();
    renderAvailableTimes();
  });
  bind("clientDatePickerBtn", "click", openClientDatePicker);
  document.querySelectorAll("[data-date-offset]").forEach(btn =>
    btn.addEventListener("click", () => setClientDateOffset(Number(btn.dataset.dateOffset || 0)))
  );

  document.querySelectorAll("[data-password-target]").forEach(btn =>
    btn.addEventListener("click", () => {
      const input = $(btn.dataset.passwordTarget);
      if (!input) return;
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.classList.toggle("showing", !showing);
      btn.setAttribute("aria-label", showing ? "Mostrar contraseña" : "Ocultar contraseña");
    })
  );

  document.querySelectorAll("[data-service-view]").forEach(btn =>
    btn.addEventListener("click", () => setBarberServiceView(btn.dataset.serviceView))
  );

  bind("openTodayAppointmentsBtn", "click", openTodayAppointmentsModal);
  bind("appointmentsTodayBtn", "click", openTodayAppointmentsModal);
  bind("todayAppointmentsCard", "click", openTodayAppointmentsModal);
  bind("todayAppointmentsCard", "keydown", e => {
    if (e.key === "Enter" || e.key === " ") openTodayAppointmentsModal();
  });
  bind("openBarberTodayAppointmentsBtn", "click", openBarberTodayAppointmentsModal);
  $("reportMonth").value = monthKey(new Date());
  bind("reportMonth", "change", renderReports);
  bind("printReportBtn", "click", () => window.print());

  ["quickSaleBtn","heroSaleBtn","newSaleBtn"].forEach(id =>
    $(id).addEventListener("click", () => openModal("saleModal"))
  );

  bind("addBarberBtn", "click", () => openModal("barberModal"));
  bind("addServiceBtn", "click", () => openModal("serviceModal"));
  bind("addProductBtn", "click", () => openModal("productModal"));

  bind("adminLoginForm", "submit", adminLogin);
  bind("barberLoginForm", "submit", barberLogin);
  bind("barberChargeForm", "submit", submitBarberChargeRequest);
  bind("barberChargeService", "change", syncBarberChargePrice);
  bind("barberChargeChair", "change", renderBarberChargePreview);
  bind("barberChargePrice", "input", renderBarberChargePreview);
  bind("barberChargePayment", "change", renderBarberChargePreview);
  bind("barberAddProductBtn", "click", addProductToBarberCharge);
  bind("saleForm", "submit", saveSale);
  bind("barberForm", "submit", createBarber);
  bind("commissionForm", "submit", saveBarberCommissions);
  bind("barberChairForm", "submit", saveBarberFixedChair);
  bind("serviceForm", "submit", createService);
  bind("productForm", "submit", createProduct);
  bind("productStockForm", "submit", saveProductStock);
  bind("clientBookingForm", "submit", createAppointment);
  bind("addChairBtn", "click", createChair);
  bind("barberProfitFilterBtn", "click", () => {
    const modalMonth = $("barberProfitMonth");
    if (modalMonth) modalMonth.value = $("reportMonth")?.value || monthKey(new Date());
    renderBarberProfitFilter();
    openModal("barberProfitModal");
  });
  bind("barberProfitSelect", "change", renderBarberProfitFilter);
  bind("barberProfitMonth", "change", renderBarberProfitFilter);
  bind("exportExcelBtn", "click", exportExcelReport);
}

async function adminLogin(e) {
  e.preventDefault();
  try {
    const email = $("adminEmail").value.trim().toLowerCase();
    const password = $("adminPassword").value;

    const result = await signInWithEmailAndPassword(auth, email, password);
    const profileSnap = await getDoc(doc(db, "users", result.user.uid));

    if (!profileSnap.exists()) {
      await signOut(auth);
      return toast("La cuenta existe en Authentication, pero falta su documento en Firestore /users.");
    }

    const profile = { id:profileSnap.id, ...profileSnap.data() };
    if (profile.role !== "admin" || profile.active === false) {
      await signOut(auth);
      return toast("Esta cuenta no tiene rol de administrador.");
    }

    currentRole = "admin";
    currentAdmin = profile;
    closeModal("adminLoginModal");
    hide("accessScreen");
    show("adminApp");
    $("adminDisplayName").textContent = profile.name || "Administrador";
    await ensureSeedData();
    subscribeAdmin();
    toast("Bienvenido a Los Mágicos");
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err, "No se pudo iniciar sesión."));
  }
}

async function barberLogin(e) {
  e.preventDefault();
  const username = $("barberUsernameLogin").value.trim().toLowerCase();
  const password = $("barberPasswordLogin").value;

  try {
    const result = await signInWithEmailAndPassword(auth, usernameToEmail(username), password);
    const profileSnap = await getDoc(doc(db, "users", result.user.uid));

    if (!profileSnap.exists()) {
      await signOut(auth);
      return toast("El usuario no tiene perfil en Firestore.");
    }

    const profile = { id:profileSnap.id, ...profileSnap.data() };
    if (profile.role !== "barber" || profile.active === false) {
      await signOut(auth);
      return toast("Esta cuenta de barbero no está activa.");
    }

    currentRole = "barber";
    currentBarber = profile;
    closeModal("barberLoginModal");
    hide("accessScreen");
    show("barberApp");
    subscribeBarber(profile.id);
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err, "No se pudo iniciar sesión."));
  }
}

async function enterClient() {
  try {
    cleanupListeners();

    if (auth.currentUser && !auth.currentUser.isAnonymous) await signOut(auth);
    if (!auth.currentUser) await signInAnonymously(auth);

    currentRole = "client";
    hide("accessScreen");
    show("clientApp");
    subscribeClient(auth.currentUser.uid);
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err, "No se pudo abrir el módulo Cliente."));
  }
}

async function ensureSeedData() {
  const [chairsSnap, servicesSnap] = await Promise.all([
    getDocs(collection(db, "chairs")),
    getDocs(collection(db, "services"))
  ]);

  const batch = writeBatch(db);
  let changes = false;

  if (chairsSnap.empty) {
    for (let i=1; i<=4; i++) {
      batch.set(doc(db, "chairs", `puesto-${i}`), {
        name:`Puesto ${i}`, active:true, order:i, createdAt:serverTimestamp()
      });
    }
    changes = true;
  }

  if (servicesSnap.empty) {
    [
      ["corte-clasico","Corte clásico",12,30],
      ["corte-barba","Corte + barba",18,45],
      ["barba-premium","Barba premium",10,30],
      ["corte-infantil","Corte infantil",10,30]
    ].forEach(([id,name,price,duration], i) => {
      batch.set(doc(db, "services", id), {
        name, price, duration, active:true, order:i+1, createdAt:serverTimestamp()
      });
    });
    changes = true;
  }

  if (changes) await batch.commit();
}

function subscribeAdmin() {
  cleanupListeners();

  unsubscribers.push(onSnapshot(collection(db, "chairs"), snap => {
    state.chairs = snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b)=>(a.order||999)-(b.order||999));
    renderAdminAll();
  }));

  unsubscribers.push(onSnapshot(query(collection(db, "users"), where("role","==","barber")), snap => {
    state.barbers = snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b)=>(a.name||"").localeCompare(b.name||""));
    renderAdminAll();
  }));

  unsubscribers.push(onSnapshot(collection(db, "services"), snap => {
    state.services = snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b)=>(a.order||999)-(b.order||999));
    renderAdminAll();
  }));

  unsubscribers.push(onSnapshot(collection(db, "products"), snap => {
    state.products = snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b)=>(a.order||999)-(b.order||999));
    renderAdminAll();
  }));

  unsubscribers.push(onSnapshot(collection(db, "sales"), snap => {
    state.sales = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderAdminAll();
  }));

  unsubscribers.push(onSnapshot(collection(db, "chargeRequests"), snap => {
    state.chargeRequests = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderAdminAll();
  }));

  unsubscribers.push(onSnapshot(collection(db, "appointments"), snap => {
    state.appointments = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderAdminAll();
  }));
}

function subscribeBarber(uid) {
  cleanupListeners();

  unsubscribers.push(onSnapshot(collection(db, "chairs"), snap => {
    state.chairs = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(x => x.active !== false).sort((a,b)=>(a.order||999)-(b.order||999));
    renderBarberPortal();
  }));

  unsubscribers.push(onSnapshot(collection(db, "services"), snap => {
    state.services = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(x => x.active !== false).sort((a,b)=>(a.order||999)-(b.order||999));
    renderBarberPortal();
  }));

  unsubscribers.push(onSnapshot(collection(db, "products"), snap => {
    state.products = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(x => x.active !== false).sort((a,b)=>(a.order||999)-(b.order||999));
    renderBarberPortal();
  }));

  unsubscribers.push(onSnapshot(query(collection(db, "chargeRequests"), where("barberId","==",uid)), snap => {
    state.chargeRequests = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderBarberPortal();
  }));

  unsubscribers.push(onSnapshot(doc(db, "users", uid), snap => {
    if (!snap.exists()) return;
    currentBarber = { id:snap.id, ...snap.data() };
    if (currentBarber.active === false) return logout();
    renderBarberPortal();
  }));

  unsubscribers.push(onSnapshot(query(collection(db, "sales"), where("barberId","==",uid)), snap => {
    state.sales = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderBarberPortal();
  }));

  unsubscribers.push(onSnapshot(query(collection(db, "appointments"), where("barberId","==",uid)), snap => {
    state.appointments = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderBarberPortal();
  }));
}

function subscribeClient(uid) {
  cleanupListeners();

  unsubscribers.push(onSnapshot(collection(db, "publicBarbers"), snap => {
    state.barbers = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(x => x.active !== false).sort((a,b)=>(a.name||"").localeCompare(b.name||""));
    renderClientOptions();
  }));

  unsubscribers.push(onSnapshot(collection(db, "services"), snap => {
    state.services = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(x => x.active !== false).sort((a,b)=>(a.order||999)-(b.order||999));
    renderClientOptions();
  }));

  unsubscribers.push(onSnapshot(query(collection(db, "appointments"), where("ownerUid","==",uid)), snap => {
    state.clientAppointments = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderClientAppointments();
  }));

  unsubscribers.push(onSnapshot(query(collection(db, "bookedSlots"), where("date",">=",isoDay())), snap => {
    state.bookedSlots = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderAvailableTimes();
  }));

  $("clientDate").min = isoDay();
  const maxBookingDate = new Date();
  maxBookingDate.setFullYear(maxBookingDate.getFullYear() + 1);
  $("clientDate").max = isoDay(maxBookingDate);
  if (!$("clientDate").value) $("clientDate").value = isoDay();
  updateSelectedDateSummary();
  renderClientOptions();
  renderClientAppointments();
}

function switchAdminView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(v => v.classList.remove("active"));
  $(`view-${name}`).classList.add("active");
  const btn = document.querySelector(`[data-view="${name}"]`);
  if (btn) btn.classList.add("active");

  const titles = {
    dashboard:"Dashboard", sales:"Cobros", appointments:"Citas",
    barbers:"Usuarios / Barberos", chairs:"Puestos", services:"Servicios", products:"Productos", reports:"Reportes"
  };
  $("adminPageTitle").textContent = titles[name] || "Dashboard";
  $("adminSidebar").classList.remove("open");
}

function renderAdminAll() {
  if (currentRole !== "admin") return;
  renderSelectors();
  renderDashboard();
  renderSales();
  renderPendingChargeRequests();
  renderAppointments();
  renderBarbers();
  renderChairs();
  renderServices();
  renderProducts();
  renderReports();
  hydrateBarberChairSelectors();
}

function renderSelectors() {
  const barbers = state.barbers.filter(x => x.active !== false);
  const services = state.services.filter(x => x.active !== false);

  $("saleBarber").innerHTML = barbers.length
    ? barbers.map(x => `<option value="${x.id}">${escapeHtml(x.name)} · ${escapeHtml(x.chairName || "Sin puesto fijo")} · ${Number(x.commission ?? 50)}%</option>`).join("")
    : `<option value="">Sin barberos activos</option>`;

  $("saleService").innerHTML = services.length
    ? services.map(x => `<option value="${x.id}">${escapeHtml(x.name)} · ${money(x.price)}</option>`).join("")
    : `<option value="">Sin servicios</option>`;

  syncSaleChair();
  syncSalePrice();
}

function syncSaleChair() {
  const barber = state.barbers.find(x => x.id === $("saleBarber").value && x.active !== false);
  const chairSelect = $("saleChair");
  if (!chairSelect) return;

  if (!barber || !barber.chairId) {
    chairSelect.innerHTML = `<option value="">Barbero sin puesto fijo</option>`;
    chairSelect.value = "";
    return;
  }

  const chair = state.chairs.find(c => c.id === barber.chairId && c.active !== false);
  if (!chair) {
    chairSelect.innerHTML = `<option value="">Puesto no disponible</option>`;
    chairSelect.value = "";
    return;
  }

  chairSelect.innerHTML = `<option value="${chair.id}">${escapeHtml(chair.name)}</option>`;
  chairSelect.value = chair.id;
}

function syncSalePrice() {
  const service = state.services.find(x => x.id === $("saleService").value);
  if (service) $("salePrice").value = Number(service.price).toFixed(2);
}

function renderDashboard() {
  const ds = state.sales.filter(s => todayIso(s.date));
  const da = state.appointments.filter(a => a.date === isoDay() && !["completed","cancelled"].includes(a.status));

  $("statSales").textContent = money(ds.reduce((a,s)=>a+Number(s.total||0),0));
  $("statBarbers").textContent = money(ds.reduce((a,s)=>a+Number(s.barberAmount||0),0));
  $("statShop").textContent = money(ds.reduce((a,s)=>a+Number(s.shopAmount||0),0));
  $("statSalesCount").textContent = `${ds.length} servicio${ds.length===1?"":"s"}`;
  $("statAppointments").textContent = da.length;
  $("statAppointmentsMeta").textContent = `${da.filter(a=>a.status==="pending").length} pendientes · Ver detalle`;

  // Solo los cinco últimos cobros.
  const recent = [...state.sales]
    .sort((a,b)=>jsDate(b.date)-jsDate(a.date))
    .slice(0,5);

  $("recentSales").innerHTML = recent.length ? recent.map(s => `
    <div class="list-row">
      <div>
        <div class="item-title">${escapeHtml(s.serviceName)}</div>
        <div class="item-meta">${escapeHtml(s.barberName)} · ${fmtDateTime(s.date)}</div>
      </div>
      <div class="amount">${money(s.total)}</div>
    </div>
  `).join("") : `<div class="empty">Aún no hay cobros.</div>`;

  // Vista compacta de citas de hoy; el detalle abre en subventana.
  const todayRows = [...da]
    .sort((a,b)=>(a.time||"").localeCompare(b.time||""))
    .slice(0,4);

  $("upcomingAppointments").innerHTML = todayRows.length ? todayRows.map(a => `
    <button class="list-row dashboard-appt-row" type="button" data-open-today-appts>
      <div>
        <div class="item-title">${a.time} · ${escapeHtml(a.clientName)}</div>
        <div class="item-meta">${escapeHtml(a.serviceName)} · ${escapeHtml(a.barberName || "Por asignar")}</div>
      </div>
      <span class="status ${a.status}">${statusLabel(a.status)}</span>
    </button>
  `).join("") : `<div class="empty">No hay citas para hoy.</div>`;

  document.querySelectorAll("[data-open-today-appts]").forEach(btn =>
    btn.addEventListener("click", openTodayAppointmentsModal)
  );

  renderDashboardChairCards(ds);
  renderTodayAppointmentsModal();
}

function renderDashboardChairCards(todaySales = state.sales.filter(s => todayIso(s.date))) {
  const node = $("dashboardChairCards");
  if (!node) return;

  node.innerHTML = state.chairs.map((chair,index) => {
    const sales = todaySales.filter(s => s.chairId === chair.id);
    const total = sales.reduce((a,s)=>a+Number(s.total||0),0);
    const barberPay = sales.reduce((a,s)=>a+Number(s.barberAmount||0),0);
    const shopPay = sales.reduce((a,s)=>a+Number(s.shopAmount||0),0);
    const assigned = state.barbers.filter(b => b.chairId === chair.id && b.active !== false);

    return `
      <article class="dashboard-chair-card">
        <div class="dashboard-chair-top">
          <div>
            <span class="card-kicker">PUESTO ${String(index+1).padStart(2,"0")}</span>
            <h4>${escapeHtml(chair.name)}</h4>
          </div>
          <div class="dashboard-chair-total"><span>GENERADO HOY</span><strong>${money(total)}</strong></div>
        </div>

        <div class="dashboard-chair-barber ${assigned.length ? "" : "empty-barber"}">
          <span class="dashboard-chair-avatar">${assigned.length ? escapeHtml((assigned[0].name||"B").charAt(0).toUpperCase()) : "—"}</span>
          <div>
            <small>BARBERO ASIGNADO</small>
            <strong>${assigned.length ? assigned.map(b=>escapeHtml(b.name)).join(", ") : "Sin barbero asignado"}</strong>
          </div>
        </div>

        <div class="dashboard-chair-money">
          <div><span>Barbero</span><strong>${money(barberPay)}</strong></div>
          <div><span>Barbería</span><strong>${money(shopPay)}</strong></div>
          <div><span>Servicios</span><strong>${sales.length}</strong></div>
        </div>

        <button class="chair-detail-btn" type="button" data-chair-day-detail="${chair.id}">
          Ver detalle del día →
        </button>
      </article>`;
  }).join("");

  document.querySelectorAll("[data-chair-day-detail]").forEach(btn =>
    btn.addEventListener("click", () => openChairDayDetail(btn.dataset.chairDayDetail))
  );
}

function openChairDayDetail(chairId) {
  const chair = state.chairs.find(c => c.id === chairId);
  if (!chair) return;

  const rows = state.sales
    .filter(s => s.chairId === chairId && todayIso(s.date))
    .sort((a,b)=>jsDate(b.date)-jsDate(a.date));

  const assigned = state.barbers.filter(b => b.chairId === chairId);
  const total = rows.reduce((a,s)=>a+Number(s.total||0),0);
  const barberPay = rows.reduce((a,s)=>a+Number(s.barberAmount||0),0);
  const shopPay = rows.reduce((a,s)=>a+Number(s.shopAmount||0),0);

  $("chairDayDetailTitle").textContent = chair.name;
  $("chairDayDetailSubtitle").textContent = `${assigned.length ? assigned.map(b=>b.name).join(", ") : "Sin barbero asignado"} · ${new Date().toLocaleDateString("es-PA",{weekday:"long",day:"2-digit",month:"long"})}`;
  $("chairDayDetailTotal").textContent = money(total);

  $("chairDayDetailSummary").innerHTML = `
    <div><span>Servicios</span><strong>${rows.length}</strong></div>
    <div><span>Pago barbero</span><strong>${money(barberPay)}</strong></div>
    <div><span>Ingreso barbería</span><strong>${money(shopPay)}</strong></div>
  `;

  $("chairDayDetailRows").innerHTML = rows.length ? rows.map(s => `
    <tr>
      <td>${jsDate(s.date).toLocaleTimeString("es-PA",{hour:"2-digit",minute:"2-digit"})}</td>
      <td>${escapeHtml(s.serviceName || "Servicio")}</td>
      <td>${escapeHtml(s.barberName || "")}</td>
      <td>${escapeHtml(s.payment || "")}</td>
      <td><b>${money(s.total)}</b></td>
      <td class="money-positive">${money(s.barberAmount)}</td>
      <td>${money(s.shopAmount)}</td>
    </tr>
  `).join("") : `<tr><td colspan="7" class="empty">Este puesto todavía no tiene movimientos hoy.</td></tr>`;

  openModal("chairDayDetailModal");
}

function renderSales() {
  const rows = [...state.sales].sort((a,b)=>jsDate(b.date)-jsDate(a.date));
  $("salesTable").innerHTML = rows.length ? rows.map(s => `
    <tr><td>${fmtDateTime(s.date)}</td><td>${escapeHtml(s.barberName)}</td><td>${escapeHtml(s.chairName)}</td><td>${escapeHtml(s.serviceName)}</td><td>${escapeHtml(s.payment)}</td><td><b>${money(s.total)}</b></td><td>${money(s.barberAmount)}</td><td>${money(s.shopAmount)}</td></tr>
  `).join("") : `<tr><td colspan="8" class="empty">No hay cobros registrados.</td></tr>`;
}


function renderPendingChargeRequests() {
  if (currentRole !== "admin") return;

  const pending = state.chargeRequests
    .filter(r => r.status === "pending")
    .sort((a,b) => jsDate(a.requestedAt) - jsDate(b.requestedAt));

  $("pendingCashCount").textContent = pending.length;

  $("pendingChargeRequests").innerHTML = pending.length ? pending.map(r => `
    <article class="cash-request-card">
      <div class="cash-request-top">
        <div class="cash-avatar">${escapeHtml((r.barberName || "B").charAt(0).toUpperCase())}</div>
        <div class="cash-request-person">
          <span class="cash-label">BARBERO</span>
          <h4>${escapeHtml(r.barberName || "Barbero")}</h4>
          <small>${r.requestedAt ? fmtDateTime(r.requestedAt) : "Enviado ahora"}</small>
        </div>
        <span class="request-status pending">POR CONFIRMAR</span>
      </div>

      <div class="cash-request-service">
        <span>Servicio realizado</span>
        <strong>${escapeHtml(r.serviceName || "Servicio")}</strong>
        <small>${escapeHtml(r.chairName || "Sin puesto")}</small>
      </div>

      ${Array.isArray(r.products) && r.products.length ? `
      <div class="cash-request-products">
        <span class="cash-label">PRODUCTOS VENDIDOS</span>
        ${r.products.map(p => `
          <div class="cash-product-row">
            <span>${Number(p.qty || 0)}× ${escapeHtml(p.name || "Producto")}</span>
            <strong>${money(p.subtotal || (Number(p.unitPrice||0)*Number(p.qty||0)))}</strong>
          </div>
        `).join("")}
        <div class="cash-product-subtotal"><span>Subtotal productos</span><strong>${money(r.productTotal || 0)}</strong></div>
      </div>` : ""}

      <div class="cash-request-price">
        <span>TOTAL ENVIADO POR EL BARBERO</span>
        <strong>${money(r.price)}</strong>
        <small>Servicio ${money(r.servicePrice ?? (Number(r.price||0)-Number(r.productTotal||0)))} + productos ${money(r.productTotal||0)}</small>
      </div>

      <div class="cash-confirm-summary">
        <div>
          <span>Método de pago</span>
          <strong>${escapeHtml(r.payment || "No indicado")}</strong>
        </div>
        <div>
          <span>Comisión servicio</span>
          <strong>${Number(r.serviceCommissionPreview ?? r.commissionPreview ?? 50)}%</strong>
        </div>
        <div>
          <span>Comisión productos</span>
          <strong>${Number(r.productCommissionPreview ?? 0)}%</strong>
        </div>
      </div>

      ${r.note ? `<div class="cash-note">“${escapeHtml(r.note)}”</div>` : ""}

      <div class="cash-admin-message">
        <span>✓</span>
        <p>El barbero ya definió el cobro. Solo confirma que el trabajo fue realizado y que el cliente pagó.</p>
      </div>

      <div class="cash-actions cash-actions-full">
        <button class="cash-reject-btn" data-reject-charge="${r.id}" type="button">Rechazar</button>
        <button class="cash-approve-btn" data-approve-charge="${r.id}" type="button">Confirmar trabajo y cobro →</button>
      </div>
    </article>
  `).join("") : `<div class="cash-empty"><span>✓</span><strong>Todo confirmado</strong><p>No hay cobros pendientes enviados por los barberos.</p></div>`;

  document.querySelectorAll("[data-approve-charge]").forEach(btn =>
    btn.addEventListener("click", () => approveChargeRequest(btn.dataset.approveCharge))
  );
  document.querySelectorAll("[data-reject-charge]").forEach(btn =>
    btn.addEventListener("click", () => rejectChargeRequest(btn.dataset.rejectCharge))
  );
}

async function approveChargeRequest(requestId) {
  const requestRef = doc(db, "chargeRequests", requestId);
  const saleRef = doc(db, "sales", requestId);

  try {
    await runTransaction(db, async transaction => {
      const requestSnap = await transaction.get(requestRef);
      if (!requestSnap.exists()) throw new Error("Solicitud no encontrada");

      const request = requestSnap.data();
      if (request.status !== "pending") throw new Error("Esta solicitud ya fue procesada");

      const barberRef = doc(db, "users", request.barberId);
      const barberSnap = await transaction.get(barberRef);
      if (!barberSnap.exists()) throw new Error("Barbero no encontrado");

      const barber = barberSnap.data();
      if (barber.active === false || barber.role !== "barber") throw new Error("Barbero inactivo");

      const requestedProducts = Array.isArray(request.products) ? request.products : [];
      const productStockUpdates = [];
      for (const item of requestedProducts) {
        const productRef = doc(db, "products", item.productId);
        const productSnap = await transaction.get(productRef);
        if (!productSnap.exists()) throw new Error(`Producto no encontrado: ${item.name || "Producto"}`);
        const productData = productSnap.data();
        const availableStock = Math.max(0, Number(productData.stock || 0));
        const soldQty = Math.max(0, Number(item.qty || 0));
        if (soldQty > availableStock) {
          throw new Error(`STOCK:${productData.name || item.name || "Producto"}:${availableStock}`);
        }
        productStockUpdates.push({ ref:productRef, stock:availableStock - soldQty });
      }

      const servicePrice = Number(
        request.servicePrice ??
        (Number(request.price || 0) - Number(request.productTotal || 0))
      );
      const productTotal = Number(request.productTotal || 0);
      const total = +(servicePrice + productTotal).toFixed(2);

      if (servicePrice <= 0 || total <= 0) throw new Error("Precio inválido");

      const payment = request.payment || "Efectivo";

      // Comisiones independientes configuradas por el administrador.
      const serviceCommission = Number(barber.commission ?? 50);
      const productCommission = Number(barber.productCommission ?? 0);

      const serviceBarberAmount = +(servicePrice * serviceCommission / 100).toFixed(2);
      const productBarberAmount = +(productTotal * productCommission / 100).toFixed(2);
      const barberAmount = +(serviceBarberAmount + productBarberAmount).toFixed(2);

      const serviceShopAmount = +(servicePrice - serviceBarberAmount).toFixed(2);
      const productShopAmount = +(productTotal - productBarberAmount).toFixed(2);
      const shopAmount = +(serviceShopAmount + productShopAmount).toFixed(2);

      productStockUpdates.forEach(item => {
        transaction.update(item.ref, { stock:item.stock, updatedAt:serverTimestamp() });
      });

      transaction.set(saleRef, {
        date:serverTimestamp(),
        barberId:request.barberId,
        barberName:request.barberName || barber.name || "Barbero",
        chairId:request.chairId,
        chairName:request.chairName,

        serviceId:request.serviceId,
        serviceName:request.serviceName,
        servicePrice,

        products:Array.isArray(request.products) ? request.products : [],
        productTotal,

        payment,
        total,

        // Mantener commission por compatibilidad con reportes antiguos:
        commission:serviceCommission,

        serviceCommission,
        productCommission,
        serviceBarberAmount,
        productBarberAmount,
        barberAmount,
        serviceShopAmount,
        productShopAmount,
        shopAmount,

        note:request.note || "",
        createdBy:auth.currentUser.uid,
        source:"barber_request",
        requestId
      });

      transaction.update(requestRef, {
        status:"approved",
        payment,
        serviceCommission,
        productCommission,
        serviceBarberAmount,
        productBarberAmount,
        barberAmount,
        serviceShopAmount,
        productShopAmount,
        shopAmount,
        saleId:saleRef.id,
        approvedBy:auth.currentUser.uid,
        approvedAt:serverTimestamp()
      });
    });

    toast("Cobro confirmado. Las comisiones de servicio y productos fueron calculadas por separado.");
  } catch (err) {
    console.error(err);
    const msg = String(err?.message || "");
    if (msg.startsWith("STOCK:")) {
      const [,product,available] = msg.split(":");
      return toast(`Stock insuficiente de ${product}. Disponible: ${available}.`);
    }
    toast(firebaseErrorMessage(err, err?.message || "No se pudo aprobar el cobro."));
  }
}

async function rejectChargeRequest(requestId) {
  if (!confirm("¿Rechazar este trabajo enviado por el barbero? No se registrará la venta ni se acreditará comisión.")) return;
  try {
    await updateDoc(doc(db, "chargeRequests", requestId), {
      status:"rejected",
      rejectedBy:auth.currentUser.uid,
      rejectedAt:serverTimestamp()
    });
    toast("Cobro rechazado.");
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err, "No se pudo rechazar el cobro."));
  }
}

async function saveSale(e) {
  e.preventDefault();
  const barber = state.barbers.find(x => x.id === $("saleBarber").value);
  const chair = state.chairs.find(x => x.id === $("saleChair").value);
  const service = state.services.find(x => x.id === $("saleService").value);
  const total = Number($("salePrice").value);

  if (!barber || !service || total <= 0) return toast("Revisa los datos del cobro.");
  if (!chair) return toast("Ese barbero no tiene puesto fijo asignado.");

  try {
    const commission = Number(barber.commission ?? 50);
    const barberAmount = +(total * commission / 100).toFixed(2);

    await setDoc(doc(collection(db, "sales")), {
      date:serverTimestamp(),
      barberId:barber.id,
      barberName:barber.name,
      chairId:chair.id,
      chairName:chair.name,
      serviceId:service.id,
      serviceName:service.name,
      payment:$("salePayment").value,
      total,
      commission,
      barberAmount,
      shopAmount:+(total-barberAmount).toFixed(2),
      note:$("saleNote").value.trim(),
      createdBy:auth.currentUser.uid
    });

    closeModal("saleModal");
    e.target.reset();
    toast("Cobro registrado.");
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err, "No se pudo registrar el cobro."));
  }
}


function appointmentNeedsBarber(a) {
  return !a.barberId || a.barberId === "unassigned" || a.needsAssignment === true;
}

function barberIsFreeForAppointment(barberId, appointment) {
  const targetSlotId = slotId(barberId, appointment.date, appointment.time);
  return !state.bookedSlots.some(s =>
    s.id === targetSlotId &&
    s.status !== "cancelled" &&
    s.id !== appointment.slotId
  );
}

function assignmentOptionsForAppointment(appointment) {
  const available = state.barbers.filter(b =>
    b.active !== false && barberIsFreeForAppointment(b.id, appointment)
  );
  return `<option value="">Selecciona barbero...</option>` +
    available.map(b => `<option value="${b.id}">${escapeHtml(b.name)} · ${escapeHtml(b.chairName || "Puesto sin asignar")}</option>`).join("");
}

function openTodayAppointmentsModal() {
  renderTodayAppointmentsModal();
  openModal("todayAppointmentsModal");
}

function renderTodayAppointmentsModal() {
  const node = $("todayAppointmentsModalList");
  if (!node || currentRole !== "admin") return;

  const today = state.appointments
    .filter(a => a.date === isoDay() && !["completed","cancelled"].includes(a.status))
    .sort((a,b)=>(a.time||"").localeCompare(b.time||""));

  $("todayAppointmentsModalCount").textContent = today.length;
  $("todayAppointmentsDateLabel").textContent = new Date().toLocaleDateString("es-PA", {
    weekday:"long", day:"2-digit", month:"long", year:"numeric"
  });

  node.innerHTML = today.length ? today.map(a => `
    <article class="today-appt-card ${appointmentNeedsBarber(a) ? "needs-barber" : ""}">
      <div class="today-appt-time">
        <span>HORA</span><strong>${escapeHtml(a.time || "")}</strong>
      </div>
      <div class="today-appt-main">
        <div class="today-appt-client">
          <span class="status ${a.status}">${statusLabel(a.status)}</span>
          <h4>${escapeHtml(a.clientName || "Cliente")}</h4>
          <small>${escapeHtml(a.clientPhone || "")} · ${escapeHtml(a.serviceName || "")}</small>
        </div>

        ${appointmentNeedsBarber(a) ? `
          <div class="today-assign-box">
            <div><span>BARBERO</span><strong>Por asignar</strong></div>
            <select data-assign-select="${a.id}">${assignmentOptionsForAppointment(a)}</select>
            <button class="primary-btn tiny-assignment-btn" type="button" data-assign-appt="${a.id}">Asignar</button>
          </div>
        ` : `
          <div class="today-assigned-barber">
            <span>BARBERO</span>
            <strong>${escapeHtml(a.barberName || "Barbero")}</strong>
          </div>
        `}
      </div>
      <div class="today-appt-actions">
        ${a.status==="pending" ? `<button class="tiny-btn" data-today-appt="${a.id}" data-status="confirmed" type="button">Confirmar</button>` : ""}
        ${a.status==="confirmed" ? `<button class="tiny-btn" data-today-appt="${a.id}" data-status="completed" type="button">Completar</button>` : ""}
        ${!["completed","cancelled"].includes(a.status) ? `<button class="tiny-btn danger" data-today-appt="${a.id}" data-status="cancelled" type="button">Cancelar</button>` : ""}
      </div>
    </article>
  `).join("") : `<div class="cash-empty"><span>◷</span><strong>Agenda libre</strong><p>No hay citas registradas para hoy.</p></div>`;

  document.querySelectorAll("[data-assign-appt]").forEach(btn =>
    btn.addEventListener("click", () => {
      const select = document.querySelector(`[data-assign-select="${btn.dataset.assignAppt}"]`);
      assignBarberToAppointment(btn.dataset.assignAppt, select?.value || "");
    })
  );

  document.querySelectorAll("[data-today-appt]").forEach(btn =>
    btn.addEventListener("click", () => changeAppointment(btn.dataset.todayAppt, btn.dataset.status))
  );
}

async function assignBarberToAppointment(appointmentId, barberId) {
  if (!barberId) return toast("Selecciona un barbero.");

  const barber = state.barbers.find(b => b.id === barberId && b.active !== false);
  const localAppt = state.appointments.find(a => a.id === appointmentId);
  if (!barber || !localAppt) return toast("No se encontró la cita o el barbero.");

  const newSlotId = slotId(barber.id, localAppt.date, localAppt.time);
  const newSlotRef = doc(db, "bookedSlots", newSlotId);
  const apptRef = doc(db, "appointments", appointmentId);

  try {
    await runTransaction(db, async tx => {
      const apptSnap = await tx.get(apptRef);
      if (!apptSnap.exists()) throw new Error("Cita no encontrada");

      const appt = apptSnap.data();
      const oldSlotId = appt.slotId || appointmentId;
      const oldSlotRef = doc(db, "bookedSlots", oldSlotId);

      const newSlotSnap = await tx.get(newSlotRef);
      if (
        newSlotId !== oldSlotId &&
        newSlotSnap.exists() &&
        newSlotSnap.data().status !== "cancelled"
      ) {
        throw new Error("BARBER_BUSY");
      }

      if (newSlotId !== oldSlotId) {
        tx.delete(oldSlotRef);
        tx.set(newSlotRef, {
          slotId:newSlotId,
          ownerUid:appt.ownerUid,
          barberId:barber.id,
          date:appt.date,
          time:appt.time,
          status:appt.status || "pending",
          createdAt:appt.createdAt || serverTimestamp(),
          updatedAt:serverTimestamp()
        });
      } else {
        tx.set(newSlotRef, {
          barberId:barber.id,
          status:appt.status || "pending",
          updatedAt:serverTimestamp()
        }, { merge:true });
      }

      tx.update(apptRef, {
        barberId:barber.id,
        barberName:barber.name,
        reservedBarberId:barber.id,
        slotId:newSlotId,
        needsAssignment:false,
        assignedBy:auth.currentUser.uid,
        assignedAt:serverTimestamp(),
        updatedAt:serverTimestamp()
      });
    });

    toast(`${barber.name} fue asignado a la cita.`);
  } catch (err) {
    console.error(err);
    if (String(err?.message).includes("BARBER_BUSY")) {
      return toast("Ese barbero ya tiene una cita en ese horario. Selecciona otro.");
    }
    toast(firebaseErrorMessage(err, "No se pudo asignar el barbero."));
  }
}

function renderAppointments() {
  const filter = $("appointmentFilter").value;

  let rows = state.appointments
    .filter(a => !["completed","cancelled"].includes(a.status))
    .sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));

  if (filter !== "all") rows = rows.filter(x => x.status === filter);

  $("appointmentCards").innerHTML = rows.length ? rows.map(a => `
    <article class="appointment-card ${appointmentNeedsBarber(a) ? "appointment-needs-barber" : ""}">
      <div class="appointment-top">
        <div>
          <span class="status ${a.status}">${statusLabel(a.status)}</span>
          <h3>${escapeHtml(a.clientName)}</h3>
          <div class="card-meta">${escapeHtml(a.clientPhone)} · ${escapeHtml(a.serviceName)}</div>
        </div>
        <div class="appt-time">${a.time}</div>
      </div>

      <div class="card-meta" style="margin-top:12px">
        ${fmtDateOnly(a.date)} · ${appointmentNeedsBarber(a) ? "Por asignar" : escapeHtml(a.barberName)} · ${money(a.servicePrice)}
      </div>

      ${appointmentNeedsBarber(a) ? `
        <div class="appointment-assign-admin">
          <div><span>BARBERO PENDIENTE</span><strong>Asigna un barbero disponible</strong></div>
          <select data-full-assign-select="${a.id}">${assignmentOptionsForAppointment(a)}</select>
          <button class="primary-btn tiny-assignment-btn" data-full-assign="${a.id}" type="button">Asignar barbero</button>
        </div>
      ` : ""}

      ${a.note ? `<div class="credential">Nota: ${escapeHtml(a.note)}</div>` : ""}

      <div class="appt-actions">
        ${a.status==="pending" ? `<button class="tiny-btn" data-appt="${a.id}" data-status="confirmed" type="button">Confirmar</button>` : ""}
        ${a.status==="confirmed" ? `<button class="tiny-btn" data-appt="${a.id}" data-status="completed" type="button">Completar</button>` : ""}
        <button class="tiny-btn danger" data-appt="${a.id}" data-status="cancelled" type="button">Cancelar</button>
      </div>
    </article>
  `).join("") : `<div class="empty">No hay citas activas en esta categoría.</div>`;

  const completed = state.appointments
    .filter(a => a.status === "completed")
    .sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));

  const completedNode = $("completedAppointmentsRows");
  if (completedNode) {
    completedNode.innerHTML = completed.length ? completed.map(a => `
      <tr>
        <td>${fmtDateOnly(a.date)}</td>
        <td><b>${escapeHtml(a.time || "")}</b></td>
        <td>${escapeHtml(a.clientName || "Cliente")}</td>
        <td>${escapeHtml(a.serviceName || "Servicio")}</td>
        <td>${escapeHtml(a.barberName || "Barbero")}</td>
        <td>${money(a.servicePrice || 0)}</td>
      </tr>
    `).join("") : `<tr><td colspan="6" class="empty">Todavía no hay citas completadas.</td></tr>`;
  }

  document.querySelectorAll("[data-appt][data-status]").forEach(btn =>
    btn.addEventListener("click", () => changeAppointment(btn.dataset.appt, btn.dataset.status))
  );

  document.querySelectorAll("[data-full-assign]").forEach(btn =>
    btn.addEventListener("click", () => {
      const select = document.querySelector(`[data-full-assign-select="${btn.dataset.fullAssign}"]`);
      assignBarberToAppointment(btn.dataset.fullAssign, select?.value || "");
    })
  );
}

async function changeAppointment(id, status) {
  try {
    const appointment = state.appointments.find(a => a.id === id)
      || state.clientAppointments?.find?.(a => a.id === id);
    const bookedSlotId = appointment?.slotId || id;

    const batch = writeBatch(db);

    if (status === "cancelled") {
      batch.delete(doc(db, "appointments", id));
      batch.delete(doc(db, "bookedSlots", bookedSlotId));
      await batch.commit();
      toast("Cita cancelada y eliminada del sistema.");
      return;
    }

    batch.update(doc(db, "appointments", id), { status, updatedAt:serverTimestamp() });
    batch.update(doc(db, "bookedSlots", bookedSlotId), { status, updatedAt:serverTimestamp() });
    await batch.commit();
    toast(`Cita ${statusLabel(status).toLowerCase()}.`);
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err, "No se pudo actualizar la cita."));
  }
}


function activeChairOptions(selectedId = "") {
  const chairs = state.chairs.filter(c => c.active !== false);
  if (!chairs.length) return `<option value="">No hay puestos activos</option>`;
  return `<option value="">Selecciona un puesto...</option>` + chairs.map(c =>
    `<option value="${c.id}" ${c.id === selectedId ? "selected" : ""}>${escapeHtml(c.name)}</option>`
  ).join("");
}

function hydrateBarberChairSelectors() {
  const createSelect = $("barberFixedChair");
  if (createSelect) {
    const current = createSelect.value;
    createSelect.innerHTML = activeChairOptions(current);
    if (current && state.chairs.some(c => c.id === current && c.active !== false)) {
      createSelect.value = current;
    }
  }

  const editSelect = $("barberChairEditorSelect");
  if (editSelect && $("barberChairEditorId")?.value) {
    const barber = state.barbers.find(b => b.id === $("barberChairEditorId").value);
    editSelect.innerHTML = activeChairOptions(barber?.chairId || "");
  }
}

function openBarberChairEditor(barberId) {
  const barber = state.barbers.find(b => b.id === barberId);
  if (!barber) return;

  $("barberChairEditorId").value = barber.id;
  $("barberChairEditorName").textContent = barber.name || "Barbero";
  $("barberChairEditorSelect").innerHTML = activeChairOptions(barber.chairId || "");
  if (barber.chairId && state.chairs.some(c => c.id === barber.chairId && c.active !== false)) {
    $("barberChairEditorSelect").value = barber.chairId;
  }
  openModal("barberChairModal");
}

async function saveBarberFixedChair(e) {
  e.preventDefault();

  const barberId = $("barberChairEditorId").value;
  const chairId = $("barberChairEditorSelect").value;
  const chair = state.chairs.find(c => c.id === chairId && c.active !== false);

  if (!barberId || !chair) return toast("Selecciona un puesto activo.");

  const barber = state.barbers.find(b => b.id === barberId);
  if (!barber) return;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "users", barberId), {
      chairId:chair.id,
      chairName:chair.name,
      updatedAt:serverTimestamp()
    }, { merge:true });

    batch.set(doc(db, "publicBarbers", barberId), {
      name:barber.name || "Barbero",
      active:barber.active !== false,
      chairId:chair.id,
      chairName:chair.name,
      updatedAt:serverTimestamp()
    }, { merge:true });

    await batch.commit();
    closeModal("barberChairModal");
    toast(`${barber.name} ahora tiene ${chair.name} como puesto fijo.`);
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err, `No se pudo asignar el puesto. ${err?.code || ""}`));
  }
}

function renderBarbers() {
  const orderedBarbers = [...state.barbers].sort((a,b) => {
    const aActive = a.active !== false ? 0 : 1;
    const bActive = b.active !== false ? 0 : 1;
    return aActive - bActive || (a.name || "").localeCompare(b.name || "");
  });

  $("barberCards").innerHTML = orderedBarbers.length ? orderedBarbers.map(b => {
    const active = b.active !== false;

    return `<article class="person-card barber-admin-card ${active ? "" : "is-disabled"}">
      <div class="barber-admin-top">
        <div class="barber-admin-avatar">${escapeHtml((b.name || "B").charAt(0).toUpperCase())}</div>
        <span class="barber-state ${active ? "active" : "inactive"}">${active ? "ACTIVO" : "DESHABILITADO"}</span>
      </div>

      <span class="card-kicker">USUARIO BARBERO</span>
      <h3>${escapeHtml(b.name)}</h3>
      <div class="card-meta">${active
        ? `Comisiones configuradas por separado`
        : "Acceso suspendido temporalmente"}</div>

      <div class="barber-commission-pills">
        <div><span>Servicios</span><strong>${Number(b.commission ?? 50)}%</strong></div>
        <div><span>Productos</span><strong>${Number(b.productCommission ?? 0)}%</strong></div>
      </div>

      <div class="barber-fixed-chair-card ${b.chairId ? "assigned" : "unassigned"}">
        <span class="barber-fixed-chair-icon">⌖</span>
        <div>
          <small>PUESTO FIJO</small>
          <strong>${escapeHtml(b.chairName || "Sin asignar")}</strong>
        </div>
      </div>

      <button class="barber-edit-chair-btn"
        data-edit-chair="${b.id}"
        type="button">${b.chairId ? "⌖ Cambiar puesto" : "+ Asignar puesto"}</button>

      <div class="credential">
        <span>Usuario</span>
        <b>${escapeHtml(b.username || "")}</b>
        <small>Conserva su misma contraseña e historial</small>
      </div>

      <button class="barber-edit-commission-btn"
        data-edit-commission="${b.id}"
        type="button">⚙ Editar comisiones</button>

      ${active ? `
        <div class="barber-account-status status-active-box">
          <span>✓</span>
          <div><b>Cuenta habilitada</b><small>Puede ingresar y recibir citas.</small></div>
        </div>
        <button class="barber-toggle-btn disable"
          data-toggle-barber="${b.id}"
          data-next-active="false"
          type="button">
          <span>⊘</span> Deshabilitar usuario
        </button>
      ` : `
        <div class="barber-account-status status-disabled-box">
          <span>!</span>
          <div><b>Cuenta deshabilitada</b><small>No puede ingresar ni aparecer para clientes.</small></div>
        </div>
        <button class="barber-toggle-btn enable"
          data-toggle-barber="${b.id}"
          data-next-active="true"
          type="button">
          <span>✓</span> Habilitar usuario
        </button>
      `}

      <div class="barber-toggle-help">${active
        ? "Puedes deshabilitarlo temporalmente sin eliminar sus datos."
        : "Al habilitarlo recuperará inmediatamente su acceso con el mismo usuario y contraseña."}</div>
    </article>`;
  }).join("") : `<div class="empty">Todavía no has creado barberos.</div>`;

  document.querySelectorAll("[data-toggle-barber]").forEach(btn =>
    btn.addEventListener("click", () =>
      toggleBarberStatus(
        btn.dataset.toggleBarber,
        btn.dataset.nextActive === "true"
      )
    )
  );

  document.querySelectorAll("[data-edit-commission]").forEach(btn =>
    btn.addEventListener("click", () => openCommissionEditor(btn.dataset.editCommission))
  );

  document.querySelectorAll("[data-edit-chair]").forEach(btn =>
    btn.addEventListener("click", () => openBarberChairEditor(btn.dataset.editChair))
  );
}


function openCommissionEditor(barberId) {
  const barber = state.barbers.find(b => b.id === barberId);
  if (!barber) return;

  $("commissionBarberId").value = barber.id;
  $("commissionBarberName").textContent = barber.name || "Barbero";
  $("editServiceCommission").value = Number(barber.commission ?? 50);
  $("editProductCommission").value = Number(barber.productCommission ?? 0);
  openModal("commissionModal");
}

async function saveBarberCommissions(e) {
  e.preventDefault();

  const barberId = $("commissionBarberId").value;
  const serviceCommission = Number($("editServiceCommission").value);
  const productCommission = Number($("editProductCommission").value);

  if (!barberId) return;
  if (serviceCommission < 0 || serviceCommission > 100) {
    return toast("La comisión de servicios debe estar entre 0 y 100%.");
  }
  if (productCommission < 0 || productCommission > 100) {
    return toast("La comisión de productos debe estar entre 0 y 100%.");
  }

  try {
    await updateDoc(doc(db, "users", barberId), {
      commission:serviceCommission,
      productCommission,
      updatedAt:serverTimestamp()
    });
    closeModal("commissionModal");
    toast("Comisiones actualizadas.");
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err, "No se pudieron actualizar las comisiones."));
  }
}

async function createBarber(e) {
  e.preventDefault();

  const name = $("barberName").value.trim();
  const username = $("barberUsername").value.trim().toLowerCase();
  const password = $("barberPassword").value;
  const password2 = $("barberPassword2").value;
  const commission = Number($("barberCommission").value);
  const productCommission = Number($("barberProductCommission").value);
  const chairId = $("barberFixedChair").value;
  const fixedChair = state.chairs.find(c => c.id === chairId && c.active !== false);

  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return toast("El usuario debe tener mínimo 3 caracteres, sin espacios.");
  if (password.length < 6) return toast("La contraseña debe tener mínimo 6 caracteres.");
  if (password !== password2) return toast("Las contraseñas no coinciden.");
  if (commission < 0 || commission > 100) return toast("La comisión de servicios debe estar entre 0 y 100%.");
  if (productCommission < 0 || productCommission > 100) return toast("La comisión de productos debe estar entre 0 y 100%.");
  if (!fixedChair) return toast("Selecciona el puesto fijo del barbero.");

  let secondaryApp = null;
  try {
    secondaryApp = initializeApp(firebaseConfig, `create-user-${Date.now()}`);
    const secondaryAuth = getAuth(secondaryApp);

    const result = await createUserWithEmailAndPassword(
      secondaryAuth,
      usernameToEmail(username),
      password
    );

    const uid = result.user.uid;

    await setDoc(doc(db, "users", uid), {
      role:"barber",
      name,
      username,
      emailAlias:usernameToEmail(username),
      commission,
      productCommission,
      chairId:fixedChair.id,
      chairName:fixedChair.name,
      active:true,
      createdAt:serverTimestamp(),
      createdBy:auth.currentUser.uid
    });

    await setDoc(doc(db, "publicBarbers", uid), {
      name,
      active:true,
      chairId:fixedChair.id,
      chairName:fixedChair.name,
      createdAt:serverTimestamp()
    });

    await signOut(secondaryAuth);
    await deleteApp(secondaryApp);
    secondaryApp = null;

    closeModal("barberModal");
    e.target.reset();
    $("barberCommission").value = 50;
    $("barberProductCommission").value = 0;
    hydrateBarberChairSelectors();
    toast(`Usuario ${username} creado en ${fixedChair.name}.`);
  } catch (err) {
    console.error(err);
    if (secondaryApp) {
      try { await deleteApp(secondaryApp); } catch {}
    }
    toast(firebaseErrorMessage(err, "No se pudo crear el usuario."));
  }
}

async function toggleBarberStatus(uid, nextActive) {
  const barber = state.barbers.find(b => b.id === uid);
  if (!barber) return;

  const action = nextActive ? "habilitar" : "deshabilitar";
  const message = nextActive
    ? `¿Habilitar nuevamente a ${barber.name}? Recuperará su acceso con el mismo usuario y contraseña.`
    : `¿Deshabilitar temporalmente a ${barber.name}? No podrá ingresar ni aparecer disponible para clientes.`;

  if (!confirm(message)) return;

  try {
    const batch = writeBatch(db);

    // Perfil privado del usuario.
    batch.update(doc(db, "users", uid), {
      active:nextActive,
      updatedAt:serverTimestamp()
    });

    // set + merge funciona incluso con barberos creados en versiones anteriores
    // que todavía no tengan documento en publicBarbers.
    batch.set(doc(db, "publicBarbers", uid), {
      name:barber.name || "Barbero",
      active:nextActive,
      updatedAt:serverTimestamp()
    }, { merge:true });

    await batch.commit();

    toast(
      nextActive
        ? `${barber.name} fue habilitado. Ya puede volver a iniciar sesión.`
        : `${barber.name} fue deshabilitado temporalmente.`
    );
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(
      err,
      nextActive
        ? "No se pudo habilitar el usuario."
        : "No se pudo deshabilitar el usuario."
    ));
  }
}

function renderChairs() {
  $("chairCards").innerHTML = state.chairs.map((c,i) => {
    const chairSales = state.sales.filter(s => s.chairId === c.id);
    const chairTotal = chairSales.reduce((sum,s) => sum + Number(s.total || 0), 0);
    const assignedBarbers = state.barbers.filter(b => b.chairId === c.id);

    return `
    <article class="chair-card premium-chair-admin-card">
      <div class="chair-card-head">
        <div>
          <span class="card-kicker">PUESTO ${String(i+1).padStart(2,"0")}</span>
          <h3>${escapeHtml(c.name)}</h3>
          <div class="card-meta">${c.active===false?"Inactivo":"Activo y disponible"}</div>
        </div>

        <div class="chair-total-badge">
          <span>TOTAL GENERADO</span>
          <strong>${money(chairTotal)}</strong>
        </div>
      </div>

      <div class="chair-assigned-barbers">
        <span class="chair-assigned-label">BARBERO ASIGNADO</span>
        ${assignedBarbers.length ? assignedBarbers.map(b => `
          <div class="chair-barber-chip ${b.active===false ? "inactive" : ""}">
            <span class="chair-barber-avatar">${escapeHtml((b.name || "B").charAt(0).toUpperCase())}</span>
            <div>
              <strong>${escapeHtml(b.name || "Barbero")}</strong>
              <small>${b.active===false ? "Usuario deshabilitado" : `Comisión servicios ${Number(b.commission ?? 50)}%`}</small>
            </div>
            <span class="chair-barber-state ${b.active===false ? "inactive" : "active"}">${b.active===false ? "INACTIVO" : "ACTIVO"}</span>
          </div>
        `).join("") : `
          <div class="chair-no-barber">
            <span>⌖</span>
            <div>
              <strong>Sin barbero asignado</strong>
              <small>Asigna un barbero desde Usuarios / Barberos.</small>
            </div>
          </div>
        `}
      </div>

      <div class="card-numbers chair-stats-grid">
        <div class="mini-stat">
          <span>Servicios</span>
          <strong>${chairSales.length}</strong>
        </div>
        <div class="mini-stat">
          <span>Estado</span>
          <strong>${c.active===false?"Inactivo":"Activo"}</strong>
        </div>
      </div>
    </article>`;
  }).join("");
}

async function createChair() {
  try {
    const next = state.chairs.length + 1;
    await setDoc(doc(collection(db, "chairs")), {
      name:`Puesto ${next}`, active:true, order:next, createdAt:serverTimestamp()
    });
    toast(`Puesto ${next} agregado.`);
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err, "No se pudo agregar el puesto."));
  }
}

function renderServices() {
  $("serviceCards").innerHTML = state.services.length ? state.services.map(s => `
    <article class="catalog-compact-card service-compact-card">
      <div class="catalog-compact-head">
        <span class="card-kicker">SERVICIO</span>
        <strong class="catalog-price">${money(s.price)}</strong>
      </div>
      <h3>${escapeHtml(s.name)}</h3>
      <small>${Number(s.duration||30)} min aprox.</small>
    </article>
  `).join("") : `<div class="empty">Todavía no has agregado servicios.</div>`;
}

async function createService(e) {
  e.preventDefault();
  try {
    await setDoc(doc(collection(db, "services")), {
      name:$("serviceName").value.trim(),
      price:Number($("servicePrice").value),
      duration:Number($("serviceDuration").value),
      active:true,
      order:state.services.length+1,
      createdAt:serverTimestamp()
    });
    closeModal("serviceModal");
    e.target.reset();
    toast("Servicio agregado.");
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err, "No se pudo crear el servicio."));
  }
}

function renderProducts() {
  if (currentRole !== "admin") return;

  $("productCards").innerHTML = state.products.length ? state.products.map(p => {
    const active = p.active !== false;
    const stock = Math.max(0, Number(p.stock || 0));

    return `<article class="catalog-compact-card product-compact-card ${active ? "" : "product-disabled"}">
      <div class="catalog-compact-head">
        <span class="product-status ${active ? "active" : "inactive"}">${active ? "ACTIVO" : "DESHABILITADO"}</span>
        <strong class="catalog-price">${money(p.price)}</strong>
      </div>
      <h3>${escapeHtml(p.name)}</h3>
      <div class="product-stock-line ${stock <= 2 ? "low-stock" : ""}">
        <span>Existencia</span><strong>${stock}</strong>
      </div>
      <div class="product-compact-actions">
        <button class="stock-adjust-btn" data-stock-product="${p.id}" type="button">Ajustar cantidad</button>
        <button class="product-toggle-btn ${active ? "disable" : "enable"}"
          data-toggle-product="${p.id}"
          data-product-active="${active ? "false" : "true"}"
          type="button">${active ? "Deshabilitar" : "Habilitar"}</button>
      </div>
    </article>`;
  }).join("") : `<div class="empty">Todavía no has agregado productos al catálogo.</div>`;

  document.querySelectorAll("[data-toggle-product]").forEach(btn =>
    btn.addEventListener("click", () =>
      toggleProductStatus(btn.dataset.toggleProduct, btn.dataset.productActive === "true")
    )
  );
  document.querySelectorAll("[data-stock-product]").forEach(btn =>
    btn.addEventListener("click", () => openProductStockEditor(btn.dataset.stockProduct))
  );
}

async function createProduct(e) {
  e.preventDefault();
  try {
    const name = $("productName").value.trim();
    const price = Number($("productPrice").value);
    const stock = Math.max(0, Math.floor(Number($("productStock").value || 0)));
    if (!name || !price || price <= 0) return toast("Revisa nombre y precio del producto.");

    await setDoc(doc(collection(db, "products")), {
      name,
      price:+price.toFixed(2),
      stock,
      active:true,
      order:state.products.length+1,
      createdAt:serverTimestamp()
    });
    closeModal("productModal");
    e.target.reset();
    toast("Producto agregado al catálogo.");
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err, "No se pudo crear el producto."));
  }
}

function openProductStockEditor(productId) {
  const product = state.products.find(p => p.id === productId);
  if (!product) return;
  $("productStockId").value = product.id;
  $("productStockName").textContent = product.name || "Producto";
  $("productStockQty").value = Math.max(0, Number(product.stock || 0));
  openModal("productStockModal");
}

async function saveProductStock(e) {
  e.preventDefault();
  const productId = $("productStockId").value;
  const stock = Math.max(0, Math.floor(Number($("productStockQty").value || 0)));
  if (!productId) return;
  try {
    await updateDoc(doc(db, "products", productId), { stock, updatedAt:serverTimestamp() });
    closeModal("productStockModal");
    toast("Existencia actualizada.");
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err, "No se pudo actualizar el inventario."));
  }
}

async function toggleProductStatus(productId, nextActive) {
  const product = state.products.find(p => p.id === productId);
  if (!product) return;
  if (!confirm(`${nextActive ? "Habilitar" : "Deshabilitar"} ${product.name}?`)) return;

  try {
    await updateDoc(doc(db, "products", productId), {
      active:nextActive,
      updatedAt:serverTimestamp()
    });
    toast(nextActive ? "Producto habilitado." : "Producto deshabilitado.");
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err, "No se pudo actualizar el producto."));
  }
}


function renderReports() {
  if (currentRole !== "admin") return;

  const selectedMonth = $("reportMonth")?.value || monthKey(new Date());
  const monthSales = state.sales.filter(s => monthKey(s.date) === selectedMonth);

  const total = monthSales.reduce((a,s) => a + Number(s.total || 0), 0);
  const barberTotal = monthSales.reduce((a,s) => a + Number(s.barberAmount || 0), 0);
  const shopTotal = monthSales.reduce((a,s) => a + Number(s.shopAmount || 0), 0);

  $("reportTotal").textContent = money(total);
  $("reportBarbers").textContent = money(barberTotal);
  $("reportShop").textContent = money(shopTotal);
  $("reportTotalMeta").textContent = `${monthSales.length} servicio${monthSales.length === 1 ? "" : "s"} en el mes`;
  $("reportPeriodTitle").textContent = `Reporte · ${monthLabel(selectedMonth)}`;
  $("reportGeneratedAt").textContent = `Generado el ${new Date().toLocaleString("es-PA", {dateStyle:"long", timeStyle:"short"})}`;

  const chairRows = state.chairs.map(chair => {
    const sales = monthSales.filter(s => s.chairId === chair.id);
    return {
      chair,
      count: sales.length,
      gross: sales.reduce((a,s)=>a+Number(s.total||0),0),
      barber: sales.reduce((a,s)=>a+Number(s.barberAmount||0),0),
      shop: sales.reduce((a,s)=>a+Number(s.shopAmount||0),0)
    };
  }).sort((a,b) => b.gross - a.gross);

  $("reportByChair").innerHTML = chairRows.length ? chairRows.map((r,index) => {
    const avg = r.count ? r.gross / r.count : 0;
    return `
    <article class="report-chair-card premium-card">
      <div class="report-chair-glow"></div>
      <div class="report-card-top">
        <span class="report-rank">#${String(index+1).padStart(2,"0")}</span>
        <span class="report-pill">${r.count} servicio${r.count===1?"":"s"}</span>
      </div>
      <div class="report-chair-head">
        <div class="report-chair-badge">${String(index+1).padStart(2,"0")}</div>
        <div>
          <span class="report-card-kicker">PUESTO</span>
          <h4>${escapeHtml(r.chair.name)}</h4>
          <div class="report-card-meta">Producción del mes seleccionado</div>
        </div>
      </div>
      <div class="report-highlight">
        <span>Total cobrado</span>
        <strong class="report-card-total">${money(r.gross)}</strong>
        <small>Promedio por servicio: ${money(avg)}</small>
      </div>
      <div class="report-split report-split-3">
        <div><span>Pago a barberos</span><b>${money(r.barber)}</b></div>
        <div><span>Ingreso barbería</span><b>${money(r.shop)}</b></div>
        <div><span>Servicios</span><b>${r.count}</b></div>
      </div>
    </article>
  `}).join("") : `<div class="empty">No hay puestos registrados.</div>`;

  const barberMonthly = state.barbers.map(barber => {
    const sales = monthSales.filter(s => s.barberId === barber.id);
    return {
      barber,
      count: sales.length,
      gross: sales.reduce((a,s)=>a+Number(s.total||0),0),
      pay: sales.reduce((a,s)=>a+Number(s.barberAmount||0),0),
      shop: sales.reduce((a,s)=>a+Number(s.shopAmount||0),0)
    };
  }).sort((a,b) => b.gross - a.gross);

  $("reportBarberMonthly").innerHTML = barberMonthly.length ? barberMonthly.map((r,index) => `
    <article class="report-barber-card premium-card">
      <div class="report-card-top">
        <span class="report-rank">#${String(index+1).padStart(2,"0")}</span>
        <span class="report-pill">Comisión ${Number(r.barber.commission ?? 50)}%</span>
      </div>
      <div class="report-barber-head">
        <div class="report-avatar">${escapeHtml((r.barber.name || "B").charAt(0).toUpperCase())}</div>
        <div><span class="report-card-kicker">BARBERO</span><h4>${escapeHtml(r.barber.name)}</h4><div class="report-card-meta">Resumen del mes seleccionado</div></div>
      </div>
      <div class="report-barber-main">
        <div><span>Venta generada</span><strong>${money(r.gross)}</strong></div>
        <div class="gold-number"><span>Saldo del barbero</span><strong>${money(r.pay)}</strong></div>
      </div>
      <div class="report-split report-split-3">
        <div><span>Servicios</span><b>${r.count}</b></div>
        <div><span>Ingreso barbería</span><b>${money(r.shop)}</b></div>
        <div><span>Promedio por servicio</span><b>${money(r.count ? r.gross / r.count : 0)}</b></div>
      </div>
    </article>
  `).join("") : `<div class="empty">No hay barberos registrados.</div>`;

  $("reportMonthlyBarbersTable").innerHTML = barberMonthly.length ? barberMonthly.map(r => `
    <tr>
      <td><b>${escapeHtml(r.barber.name)}</b></td>
      <td>${r.count}</td>
      <td><b>${money(r.gross)}</b></td>
      <td>${Number(r.barber.commission ?? 50)}%</td>
      <td class="money-positive">${money(r.pay)}</td>
      <td>${money(r.shop)}</td>
    </tr>
  `).join("") : `<tr><td colspan="6" class="empty">No hay movimientos en este mes.</td></tr>`;

  const dailyMap = new Map();
  monthSales.forEach(sale => {
    const date = dayKey(sale.date);
    const key = `${date}__${sale.barberId}`;
    if (!dailyMap.has(key)) {
      dailyMap.set(key, {date, barberId:sale.barberId, barberName:sale.barberName || "Barbero", count:0, gross:0, pay:0, shop:0});
    }
    const row = dailyMap.get(key);
    row.count += 1;
    row.gross += Number(sale.total || 0);
    row.pay += Number(sale.barberAmount || 0);
    row.shop += Number(sale.shopAmount || 0);
  });

  const dailyRows = [...dailyMap.values()].sort((a,b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.barberName.localeCompare(b.barberName);
  });

  $("reportDailyBarbers").innerHTML = dailyRows.length ? dailyRows.map(r => `
    <tr>
      <td>${shortDayLabel(r.date)}</td>
      <td><b>${escapeHtml(r.barberName)}</b></td>
      <td>${r.count}</td>
      <td>${money(r.gross)}</td>
      <td class="money-positive"><b>${money(r.pay)}</b></td>
      <td>${money(r.shop)}</td>
    </tr>
  `).join("") : `<tr><td colspan="6" class="empty">No hay movimientos diarios en este mes.</td></tr>`;

  renderBarberProfitFilter();
}

function renderBarberProfitFilter() {
  if (currentRole !== "admin") return;

  const select = $("barberProfitSelect");
  if (!select) return;

  const selectedMonth = $("barberProfitMonth")?.value || $("reportMonth")?.value || monthKey(new Date());
  const previous = select.value;
  const barbers = [...state.barbers].sort((a,b)=>(a.name||"").localeCompare(b.name||""));

  select.innerHTML = barbers.length
    ? barbers.map(b => `<option value="${b.id}">${escapeHtml(b.name || "Barbero")}</option>`).join("")
    : `<option value="">No hay barberos</option>`;

  if (previous && barbers.some(b => b.id === previous)) select.value = previous;

  const barberId = select.value || barbers[0]?.id || "";
  if (barberId) select.value = barberId;
  const barber = barbers.find(b => b.id === barberId);

  $("barberProfitPeriodLabel").textContent = `${barber?.name || "Barbero"} · ${monthLabel(selectedMonth)}`;

  const sales = state.sales
    .filter(s => monthKey(s.date) === selectedMonth && s.barberId === barberId)
    .sort((a,b)=>jsDate(b.date)-jsDate(a.date));

  const servicePay = sales.reduce((sum,s)=>sum + Number(s.serviceBarberAmount ?? s.barberAmount ?? 0),0);
  const productPay = sales.reduce((sum,s)=>sum + Number(s.productBarberAmount || 0),0);
  const totalPay = sales.reduce((sum,s)=>sum + Number(s.barberAmount || 0),0);

  $("barberProfitTotal").textContent = money(totalPay);
  $("barberProfitServices").textContent = money(servicePay);
  $("barberProfitProducts").textContent = money(productPay);
  $("barberProfitServiceCount").textContent = `${sales.length} servicio${sales.length===1?"":"s"}`;

  $("barberProfitRows").innerHTML = sales.length ? sales.map(s => `
    <tr>
      <td>${fmtDateTime(s.date)}</td>
      <td><b>${escapeHtml(s.serviceName || "Servicio")}</b></td>
      <td>${money(Number(s.serviceBarberAmount ?? s.barberAmount ?? 0))}</td>
      <td>${money(Number(s.productBarberAmount || 0))}</td>
      <td class="money-positive"><b>${money(Number(s.barberAmount || 0))}</b></td>
    </tr>
  `).join("") : `<tr><td colspan="5" class="empty">Este barbero no tiene ganancias registradas en el mes seleccionado.</td></tr>`;
}


function renderBarberChargeOptions() {
  if (currentRole !== "barber") return;

  const serviceSelect = $("barberChargeService");
  const chairInput = $("barberChargeChair");
  const productSelect = $("barberChargeProduct");
  const selectedService = serviceSelect.value;
  const selectedProduct = productSelect?.value || "";

  serviceSelect.innerHTML = state.services.length
    ? `<option value="">Selecciona un servicio...</option>` + state.services.map(s =>
        `<option value="${s.id}">${escapeHtml(s.name)} · ${money(s.price)}</option>`
      ).join("")
    : `<option value="">No hay servicios activos</option>`;

  if (productSelect) {
    const availableProducts = state.products.filter(p => Number(p.stock || 0) > 0);
    productSelect.innerHTML = availableProducts.length
      ? `<option value="">Selecciona un producto...</option>` + availableProducts.map(p =>
          `<option value="${p.id}">${escapeHtml(p.name)} · ${money(p.price)} · Stock ${Number(p.stock || 0)}</option>`
        ).join("")
      : `<option value="">No hay productos con existencia</option>`;
  }

  if (selectedService && state.services.some(s => s.id === selectedService)) {
    serviceSelect.value = selectedService;
  }
  if (selectedProduct && state.products.some(p => p.id === selectedProduct)) {
    productSelect.value = selectedProduct;
  }

  const fixedChair = state.chairs.find(c =>
    c.id === currentBarber?.chairId && c.active !== false
  );

  if (chairInput) chairInput.value = fixedChair?.id || "";

  const chairName = $("barberFixedChairName");
  const chairHelp = $("barberFixedChairHelp");
  const chairDisplay = $("barberFixedChairDisplay");

  if (fixedChair) {
    if (chairName) chairName.textContent = fixedChair.name;
    if (chairHelp) chairHelp.textContent = "Asignado por el administrador · se usa automáticamente.";
    chairDisplay?.classList.remove("chair-missing");
    chairDisplay?.classList.add("chair-ready");
  } else {
    if (chairName) chairName.textContent = currentBarber?.chairName || "Sin puesto asignado";
    if (chairHelp) chairHelp.textContent = currentBarber?.chairId
      ? "Tu puesto está inactivo. Solicita al administrador que te reasigne."
      : "El administrador debe asignarte un puesto antes de cobrar.";
    chairDisplay?.classList.remove("chair-ready");
    chairDisplay?.classList.add("chair-missing");
  }

  // Si no hay servicio seleccionado, usar automáticamente el primero del catálogo
  if (!serviceSelect.value && state.services.length) {
    serviceSelect.value = state.services[0].id;
  }

  const chosenService = state.services.find(s => s.id === serviceSelect.value);
  const priceInput = $("barberChargePrice");
  if (priceInput) {
    if (chosenService && (!priceInput.value || Number(priceInput.value) <= 0 || !selectedService)) {
      priceInput.value = Number(chosenService.price || 0).toFixed(2);
    }
  }

  renderBarberProductCart();
  renderBarberChargePreview();
}

function syncBarberChargePrice() {
  const service = state.services.find(s => s.id === $("barberChargeService").value);
  $("barberChargePrice").value = service ? Number(service.price || 0).toFixed(2) : "";
  renderBarberChargePreview();
}


function addProductToBarberCharge() {
  if (currentRole !== "barber") return;

  const productId = $("barberChargeProduct").value;
  const product = state.products.find(p => p.id === productId && p.active !== false);
  const qty = Math.max(1, Math.floor(Number($("barberChargeProductQty").value || 1)));

  if (!product) return toast("Selecciona un producto.");
  const stock = Math.max(0, Number(product.stock || 0));
  if (stock <= 0) return toast("Ese producto no tiene existencia.");

  const existing = barberProductCart.find(item => item.productId === product.id);
  const currentQty = Number(existing?.qty || 0);
  if (currentQty + qty > stock) return toast(`Solo hay ${stock} unidad${stock===1?"":"es"} disponibles.`);
  if (existing) {
    existing.qty += qty;
  } else {
    barberProductCart.push({
      productId:product.id,
      name:product.name,
      unitPrice:Number(product.price || 0),
      qty
    });
  }

  $("barberChargeProductQty").value = 1;
  renderBarberProductCart();
  renderBarberChargePreview();
}

function removeProductFromBarberCharge(productId) {
  barberProductCart = barberProductCart.filter(item => item.productId !== productId);
  renderBarberProductCart();
  renderBarberChargePreview();
}

function changeBarberProductQty(productId, delta) {
  const item = barberProductCart.find(x => x.productId === productId);
  if (!item) return;
  const product = state.products.find(p => p.id === productId);
  const stock = Math.max(0, Number(product?.stock || 0));
  const nextQty = Math.max(1, Number(item.qty || 1) + delta);
  if (delta > 0 && nextQty > stock) return toast(`Solo hay ${stock} unidad${stock===1?"":"es"} disponibles.`);
  item.qty = nextQty;
  renderBarberProductCart();
  renderBarberChargePreview();
}

function barberProductSubtotal() {
  return barberProductCart.reduce((sum,item) =>
    sum + Number(item.unitPrice || 0) * Number(item.qty || 0), 0
  );
}

function renderBarberProductCart() {
  const node = $("barberChargeProductCart");
  if (!node) return;

  node.innerHTML = barberProductCart.length ? barberProductCart.map(item => `
    <div class="barber-product-line">
      <div class="barber-product-line-info">
        <span class="product-sale-icon">▦</span>
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <small>${money(item.unitPrice)} c/u</small>
        </div>
      </div>
      <div class="product-qty-control">
        <button type="button" data-product-minus="${item.productId}">−</button>
        <b>${item.qty}</b>
        <button type="button" data-product-plus="${item.productId}">+</button>
      </div>
      <strong class="product-line-total">${money(item.unitPrice * item.qty)}</strong>
      <button type="button" class="product-remove-btn" data-product-remove="${item.productId}" aria-label="Eliminar producto">×</button>
    </div>
  `).join("") : `
    <div class="barber-product-empty">
      <span>▦</span>
      <div><strong>Sin productos</strong><small>Puedes enviar solo el servicio o agregar productos vendidos.</small></div>
    </div>`;

  document.querySelectorAll("[data-product-remove]").forEach(btn =>
    btn.addEventListener("click", () => removeProductFromBarberCharge(btn.dataset.productRemove))
  );
  document.querySelectorAll("[data-product-plus]").forEach(btn =>
    btn.addEventListener("click", () => changeBarberProductQty(btn.dataset.productPlus, 1))
  );
  document.querySelectorAll("[data-product-minus]").forEach(btn =>
    btn.addEventListener("click", () => changeBarberProductQty(btn.dataset.productMinus, -1))
  );
}

function renderBarberChargePreview() {
  if (currentRole !== "barber") return;

  const service = state.services.find(s => s.id === $("barberChargeService").value);
  const chair = state.chairs.find(c => c.id === currentBarber?.chairId && c.active !== false);
  const servicePrice = Math.max(0, Number($("barberChargePrice").value || 0));
  const productsTotal = barberProductSubtotal();
  const total = servicePrice + productsTotal;
  const payment = $("barberChargePayment").value || "Efectivo";

  const serviceCommission = Number(currentBarber?.commission ?? 50);
  const productCommission = Number(currentBarber?.productCommission ?? 0);

  const serviceBarberAmount = servicePrice * serviceCommission / 100;
  const productBarberAmount = productsTotal * productCommission / 100;
  const barberAmount = serviceBarberAmount + productBarberAmount;
  const shopAmount = total - barberAmount;

  $("barberChargeServicePreview").textContent = service?.name || "Selecciona un servicio";
  $("barberChargeChairPreview").textContent = chair?.name || "Puesto no asignado";
  $("barberChargeTotalPreview").textContent = money(total);
  $("barberChargePaymentPreview").textContent = payment;

  $("barberChargeBarberPreview").textContent = money(barberAmount);
  $("barberChargeShopPreview").textContent = money(shopAmount);

  const productsSubtotalNode = $("barberChargeProductsSubtotalPreview");
  const productsPreviewNode = $("barberChargeProductsPreview");
  if (productsSubtotalNode) productsSubtotalNode.textContent = money(productsTotal);
  if (productsPreviewNode) {
    productsPreviewNode.innerHTML = barberProductCart.length
      ? barberProductCart.map(item => `<div><span>${item.qty}× ${escapeHtml(item.name)}</span><b>${money(item.unitPrice * item.qty)}</b></div>`).join("")
      : `<small>Sin productos agregados</small>`;
  }
}

async function submitBarberChargeRequest(e) {
  e.preventDefault();
  if (currentRole !== "barber" || !currentBarber) return;

  const service = state.services.find(s => s.id === $("barberChargeService").value);
  const chair = state.chairs.find(c => c.id === currentBarber?.chairId && c.active !== false);
  const servicePrice = Number($("barberChargePrice").value);
  const products = barberProductCart.map(item => ({
    productId:item.productId,
    name:item.name,
    unitPrice:+Number(item.unitPrice || 0).toFixed(2),
    qty:Number(item.qty || 0),
    subtotal:+(Number(item.unitPrice || 0) * Number(item.qty || 0)).toFixed(2)
  }));
  const productTotal = +barberProductSubtotal().toFixed(2);
  const total = +(Number(servicePrice || 0) + productTotal).toFixed(2);
  const payment = $("barberChargePayment").value;
  const note = $("barberChargeNote").value.trim();

  if (!service || !chair || !servicePrice || servicePrice <= 0 || !payment) {
    return toast(!chair ? "No tienes un puesto fijo activo. Solicita al administrador que te asigne uno." : "Revisa servicio, precio y método de pago.");
  }

  try {
    await setDoc(doc(collection(db, "chargeRequests")), {
      barberId:auth.currentUser.uid,
      barberName:currentBarber.name || "Barbero",
      chairId:chair.id,
      chairName:chair.name,
      serviceId:service.id,
      serviceName:service.name,
      servicePrice:+servicePrice.toFixed(2),
      products,
      productTotal,
      price:total,
      payment,
      serviceCommissionPreview:Number(currentBarber.commission ?? 50),
      productCommissionPreview:Number(currentBarber.productCommission ?? 0),
      note,
      status:"pending",
      requestedAt:serverTimestamp(),
      createdBy:auth.currentUser.uid
    });

    e.target.reset();
    barberProductCart = [];
    renderBarberChargeOptions();
    renderBarberProductCart();
    renderBarberChargePreview();
    toast("Cobro con servicio y productos enviado al administrador.");
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err, "No se pudo enviar el cobro al administrador."));
  }
}

function renderMyChargeRequests() {
  if (currentRole !== "barber") return;

  const requests = [...state.chargeRequests].sort((a,b) => jsDate(b.requestedAt) - jsDate(a.requestedAt)).slice(0,12);
  $("myChargeRequests").innerHTML = requests.length ? requests.map(r => {
    const status = r.status || "pending";
    const statusText = statusLabel(status);
    const credited = status === "approved" ? money(r.barberAmount || 0) : "—";
    return `
      <div class="barber-charge-row">
        <div class="barber-charge-icon ${status}">${status === "approved" ? "✓" : status === "rejected" ? "×" : "↗"}</div>
        <div class="barber-charge-info">
          <div class="barber-charge-title">${escapeHtml(r.serviceName || "Servicio")} · ${money(r.price)}</div>
          <div class="item-meta">${escapeHtml(r.chairName || "")} · ${escapeHtml(r.payment || "")} · ${r.requestedAt ? fmtDateTime(r.requestedAt) : "Enviado ahora"}</div>
        </div>
        <div class="barber-charge-credit">
          <span class="request-status ${status}">${statusText}</span>
          <small>${status === "approved" ? `Acreditado: ${credited}` : status === "rejected" ? "No acreditado" : "Esperando confirmación"}</small>
        </div>
      </div>`;
  }).join("") : `<div class="empty">Todavía no has enviado trabajos a Caja.</div>`;
}

function setBarberServiceView(mode) {
  barberServiceViewMode = mode === "table" ? "table" : "cards";
  document.querySelectorAll("[data-service-view]").forEach(btn =>
    btn.classList.toggle("active", btn.dataset.serviceView === barberServiceViewMode)
  );
  if (currentRole === "barber") renderBarberPortal();
}

function renderBarberRecentServices(recent) {
  const node = $("mySales");
  if (!node) return;

  document.querySelectorAll("[data-service-view]").forEach(btn =>
    btn.classList.toggle("active", btn.dataset.serviceView === barberServiceViewMode)
  );

  if (!recent.length) {
    node.className = "premium-service-list";
    node.innerHTML = `
      <div class="premium-empty-state">
        <span>✂</span>
        <strong>Aún no tienes servicios registrados</strong>
        <small>Cuando el administrador confirme tus cobros aparecerán aquí.</small>
      </div>`;
    return;
  }

  if (barberServiceViewMode === "table") {
    node.className = "barber-service-table-wrap";
    node.innerHTML = `
      <div class="table-wrap">
        <table class="premium-report-table barber-service-table">
          <thead>
            <tr>
              <th>Fecha / hora</th>
              <th>Servicio</th>
              <th>Método</th>
              <th>Servicios</th>
              <th>Productos</th>
              <th>Para ti</th>
            </tr>
          </thead>
          <tbody>
            ${recent.map(s => {
              const dt = jsDate(s.date);
              const time = dt.toLocaleTimeString("es-PA", {hour:"2-digit",minute:"2-digit"});
              const day = dt.toLocaleDateString("es-PA", {day:"2-digit",month:"short",year:"numeric"});
              const servicePay = Number(s.serviceBarberAmount ?? s.barberAmount ?? 0);
              const productPay = Number(s.productBarberAmount || 0);
              return `
                <tr>
                  <td><b>${escapeHtml(time)}</b><small class="table-date-sub">${escapeHtml(day)}</small></td>
                  <td><b>${escapeHtml(s.serviceName || "Servicio")}</b><small class="table-status-sub">Acreditado</small></td>
                  <td>${escapeHtml(s.payment || "—")}</td>
                  <td>${money(servicePay)}</td>
                  <td>${money(productPay)}</td>
                  <td class="money-positive"><b>${money(s.barberAmount)}</b></td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
    return;
  }

  node.className = "premium-service-list premium-service-card-grid";
  node.innerHTML = recent.map((s,index) => {
    const dt = jsDate(s.date);
    const time = dt.toLocaleTimeString("es-PA", {hour:"2-digit",minute:"2-digit"});
    const day = dt.toLocaleDateString("es-PA", {day:"2-digit",month:"short"});
    const servicePay = Number(s.serviceBarberAmount ?? s.barberAmount ?? 0);
    const productPay = Number(s.productBarberAmount || 0);
    const productsCount = Array.isArray(s.products)
      ? s.products.reduce((sum,p)=>sum+Number(p.qty||0),0)
      : 0;

    return `
      <article class="barber-service-card">
        <div class="barber-service-card-head">
          <div class="barber-service-time-pill">
            <strong>${escapeHtml(time)}</strong>
            <span>${escapeHtml(day)}</span>
          </div>
          <span class="service-credit-status">ACREDITADO</span>
        </div>

        <div class="barber-service-card-title">
          <span>#${String(index+1).padStart(2,"0")}</span>
          <h4>${escapeHtml(s.serviceName || "Servicio")}</h4>
          <small>${escapeHtml(s.payment || "—")}${productsCount ? ` · ${productsCount} producto${productsCount===1?"":"s"}` : " · Sin productos"}</small>
        </div>

        <div class="barber-service-earnings">
          <div><span>Servicios</span><strong>${money(servicePay)}</strong></div>
          <div><span>Productos</span><strong>${money(productPay)}</strong></div>
        </div>

        <div class="barber-service-total">
          <span>ACREDITADO PARA TI</span>
          <strong>${money(s.barberAmount)}</strong>
        </div>
      </article>`;
  }).join("");
}

function renderBarberPortal() {
  if (currentRole !== "barber" || !currentBarber) return;

  renderBarberChargeOptions();
  renderMyChargeRequests();

  $("barberWelcomeName").textContent = (currentBarber.name || "Barbero").split(" ")[0];
  $("barberWelcomeChair").textContent = currentBarber.chairName || "Puesto sin asignar";

  const mine = state.sales.filter(s => s.barberId === currentBarber.id);
  const today = mine.filter(s => todayIso(s.date));
  const currentMonth = monthKey(new Date());
  const thisMonth = mine.filter(s => monthKey(s.date) === currentMonth);

  const todayServicePay = today.reduce((a,s)=>a+Number(s.serviceBarberAmount ?? s.barberAmount ?? 0),0);
  const todayProductPay = today.reduce((a,s)=>a+Number(s.productBarberAmount || 0),0);
  const todayPay = today.reduce((a,s)=>a+Number(s.barberAmount||0),0);
  const monthPay = thisMonth.reduce((a,s)=>a+Number(s.barberAmount||0),0);

  $("myTodayGross").textContent = money(todayPay);
  $("myTodayPay").textContent = money(todayServicePay);
  $("myMonthGross").textContent = money(todayProductPay);
  $("myMonthPay").textContent = money(monthPay);
  $("myAllPay").textContent = money(mine.reduce((a,s)=>a+Number(s.barberAmount||0),0));
  $("myTodayCount").textContent = `${today.length} servicio${today.length===1?"":"s"} hoy`;
  $("myMonthCount").textContent = `${thisMonth.length} servicio${thisMonth.length===1?"":"s"} este mes`;
  $("myMonthLabel").textContent = monthLabel(currentMonth);

  const daily = new Map();
  thisMonth.forEach(sale => {
    const date = dayKey(sale.date);
    if (!daily.has(date)) daily.set(date, {date, count:0, servicePay:0, productPay:0, pay:0});
    const row = daily.get(date);
    row.count += 1;
    row.servicePay += Number(sale.serviceBarberAmount ?? sale.barberAmount ?? 0);
    row.productPay += Number(sale.productBarberAmount || 0);
    row.pay += Number(sale.barberAmount || 0);
  });

  const dailyRows = [...daily.values()].sort((a,b)=>b.date.localeCompare(a.date));
  $("myDailyBalances").innerHTML = dailyRows.length ? dailyRows.map(r => `
    <tr>
      <td>${shortDayLabel(r.date)}</td>
      <td>${r.count}</td>
      <td>${money(r.servicePay)}</td>
      <td>${money(r.productPay)}</td>
      <td class="money-positive"><b>${money(r.pay)}</b></td>
    </tr>
  `).join("") : `<tr><td colspan="5" class="empty">Aún no tienes servicios este mes.</td></tr>`;

  const appts = state.appointments
    .filter(a => !["cancelled","completed"].includes(a.status) && a.date >= isoDay())
    .sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));

  const todayAppts = appts.filter(a=>a.date===isoDay());
  $("myTodayAppointments").textContent = todayAppts.length;
  renderBarberTodayAppointmentsModal();

  $("myAppointments").innerHTML = appts.length ? appts.map(a => `
    <div class="list-row">
      <div>
        <div class="item-title">${escapeHtml(a.clientName)} · ${escapeHtml(a.serviceName)}</div>
        <div class="item-meta">${fmtDateOnly(a.date)} ${a.time} · ${escapeHtml(a.clientPhone)}</div>
      </div>
      <div class="barber-appt-actions">
        <span class="status ${a.status}">${statusLabel(a.status)}</span>
        ${a.status==="pending"?`<button class="tiny-btn" data-myappt="${a.id}" data-status="confirmed" type="button">Confirmar</button>`:""}
        ${a.status==="confirmed"?`<button class="tiny-btn" data-myappt="${a.id}" data-status="completed" type="button">Completar</button>`:""}
      </div>
    </div>
  `).join("") : `<div class="empty">No tienes citas próximas.</div>`;

  document.querySelectorAll("[data-myappt]").forEach(btn =>
    btn.addEventListener("click", () => changeAppointment(btn.dataset.myappt, btn.dataset.status))
  );

  const recent = [...mine].sort((a,b)=>jsDate(b.date)-jsDate(a.date)).slice(0,8);
  renderBarberRecentServices(recent);
}

function openBarberTodayAppointmentsModal() {
  renderBarberTodayAppointmentsModal();
  openModal("barberTodayAppointmentsModal");
}

function renderBarberTodayAppointmentsModal() {
  if (currentRole !== "barber") return;
  const node = $("barberTodayAppointmentsList");
  if (!node) return;

  const today = state.appointments
    .filter(a => a.date === isoDay() && !["completed","cancelled"].includes(a.status))
    .sort((a,b)=>(a.time||"").localeCompare(b.time||""));

  $("barberTodayAppointmentsCount").textContent = today.length;
  $("barberTodayAppointmentsDateLabel").textContent = new Date().toLocaleDateString("es-PA", {
    weekday:"long", day:"2-digit", month:"long", year:"numeric"
  });

  node.innerHTML = today.length ? today.map((a,index) => `
    <article class="barber-premium-appt-card ${a.status}">
      <div class="barber-appt-time-block">
        <span>CITA ${String(index+1).padStart(2,"0")}</span>
        <strong>${escapeHtml(a.time || "")}</strong>
      </div>

      <div class="barber-appt-info">
        <div class="barber-appt-info-top">
          <div>
            <span class="barber-appt-client-label">CLIENTE</span>
            <h4>${escapeHtml(a.clientName || "Cliente")}</h4>
          </div>
          <span class="status ${a.status}">${statusLabel(a.status)}</span>
        </div>

        <div class="barber-appt-detail-grid">
          <div>
            <span>Servicio</span>
            <strong>${escapeHtml(a.serviceName || "Servicio")}</strong>
          </div>
          <div>
            <span>Teléfono</span>
            <strong>${escapeHtml(a.clientPhone || "Sin teléfono")}</strong>
          </div>
          <div>
            <span>Puesto</span>
            <strong>${escapeHtml(currentBarber?.chairName || "Puesto asignado")}</strong>
          </div>
        </div>

        ${a.note ? `<div class="barber-appt-note"><span>NOTA</span><p>${escapeHtml(a.note)}</p></div>` : ""}
      </div>

      <div class="barber-appt-modal-actions">
        ${a.status==="pending" ? `<button class="appt-action-primary" data-myapptmodal="${a.id}" data-status="confirmed" type="button">✓ Confirmar cita</button>` : ""}
        ${a.status==="confirmed" ? `<button class="appt-action-primary complete" data-myapptmodal="${a.id}" data-status="completed" type="button">✓ Marcar completada</button>` : ""}
        ${a.status==="completed" ? `<span class="appt-done-chip">SERVICIO COMPLETADO</span>` : ""}
      </div>
    </article>
  `).join("") : `
    <div class="barber-premium-empty-appts">
      <span>◷</span>
      <strong>No tienes citas programadas para hoy</strong>
      <p>Tu agenda del día está libre.</p>
    </div>`;

  document.querySelectorAll("[data-myapptmodal]").forEach(btn =>
    btn.addEventListener("click", () => changeAppointment(btn.dataset.myapptmodal, btn.dataset.status))
  );
}

function renderClientOptions() {
  if (currentRole !== "client") return;

  $("clientServiceOptions").innerHTML = state.services.length ? state.services.map(s => `
    <button type="button" class="choice service-choice ${booking.serviceId===s.id?"selected":""}" data-service="${s.id}">
      <strong>${escapeHtml(s.name)}</strong>
      <small>${money(s.price)} · ${Number(s.duration||30)} min</small>
    </button>
  `).join("") : `<div class="empty">No hay servicios disponibles.</div>`;

  const anyChoice = `
    <button type="button" class="choice barber-choice any-barber-choice ${booking.barberId===ANY_BARBER?"selected":""}" data-barber="${ANY_BARBER}">
      <strong>Sin preferencia</strong>
      <small>El administrador asignará un barbero disponible</small>
    </button>`;

  $("clientBarberOptions").innerHTML = state.barbers.length
    ? anyChoice + state.barbers.map(b => `
        <button type="button" class="choice barber-choice ${booking.barberId===b.id?"selected":""}" data-barber="${b.id}">
          <strong>${escapeHtml(b.name)}</strong>
          <small>${escapeHtml(b.chairName || "Barbero disponible")}</small>
        </button>
      `).join("")
    : `<div class="empty">No hay barberos disponibles.</div>`;

  document.querySelectorAll(".service-choice").forEach(btn =>
    btn.addEventListener("click", () => {
      booking.serviceId = btn.dataset.service;
      renderClientOptions();
    })
  );

  document.querySelectorAll(".barber-choice").forEach(btn =>
    btn.addEventListener("click", () => {
      booking.barberId = btn.dataset.barber;
      renderClientOptions();
      renderAvailableTimes();
    })
  );

  renderAvailableTimes();
}

function openClientDatePicker() {
  const input = $("clientDate");
  if (!input) return;
  try {
    if (typeof input.showPicker === "function") input.showPicker();
    else {
      input.focus();
      input.click();
    }
  } catch (_) {
    input.focus();
    input.click();
  }
}

function setClientDateOffset(offset) {
  const d = new Date();
  d.setHours(12,0,0,0);
  d.setDate(d.getDate() + Number(offset || 0));
  $("clientDate").value = isoDay(d);
  updateSelectedDateSummary();
  renderAvailableTimes();
}

function updateSelectedDateSummary() {
  const input = $("clientDate");
  const box = $("selectedDateSummary");
  if (!input || !box) return;
  if (!input.value) {
    box.textContent = "Selecciona una fecha para ver horarios disponibles.";
    return;
  }
  const [y,m,d] = input.value.split("-").map(Number);
  const selected = new Date(y,m-1,d);
  box.innerHTML = `<span>✓</span><div><b>${selected.toLocaleDateString("es-PA", {weekday:"long", day:"2-digit", month:"long", year:"numeric"})}</b><small>Ahora selecciona un barbero para consultar sus horas disponibles.</small></div>`;
}

function isSlotOccupiedForBarber(barberId, day, time) {
  return state.bookedSlots.some(s =>
    s.date === day &&
    s.time === time &&
    s.barberId === barberId &&
    s.status !== "cancelled"
  );
}

function availableBarbersForSlot(day, time) {
  return state.barbers.filter(b =>
    b.active !== false && !isSlotOccupiedForBarber(b.id, day, time)
  );
}

function renderAvailableTimes() {
  if (currentRole !== "client") return;

  const day = $("clientDate").value;
  const barberId = booking.barberId;
  const select = $("clientTime");

  if (!day || !barberId) {
    select.innerHTML = `<option value="">Selecciona fecha y barbero</option>`;
    return;
  }

  const slots = [];
  const now = new Date();
  const isToday = day === isoDay(now);
  const minMinutesToday = (now.getHours() * 60) + now.getMinutes() + 30;

  for (let h=9; h<19; h++) {
    for (const m of [0,30]) {
      const t = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
      const slotMinutes = (h * 60) + m;
      const isPast = isToday && slotMinutes < minMinutesToday;
      if (isPast) continue;

      const available = barberId === ANY_BARBER
        ? availableBarbersForSlot(day, t).length > 0
        : !isSlotOccupiedForBarber(barberId, day, t);

      if (available) slots.push(t);
    }
  }

  select.innerHTML = slots.length
    ? `<option value="">Selecciona una hora</option>${slots.map(t=>`<option value="${t}">${t}</option>`).join("")}`
    : `<option value="">Sin horarios disponibles para esta fecha</option>`;
}

function slotId(barberId, day, time) {
  return `${barberId}_${day}_${time.replace(":","")}`;
}

async function createAppointment(e) {
  e.preventDefault();

  if (!auth.currentUser?.isAnonymous) return toast("Vuelve al inicio y entra nuevamente como Cliente.");

  const service = state.services.find(s => s.id === booking.serviceId);
  const day = $("clientDate").value;
  const time = $("clientTime").value;
  const wantsAny = booking.barberId === ANY_BARBER;

  if (!service) return toast("Selecciona un servicio.");
  if (!booking.barberId) return toast("Selecciona un barbero o 'Sin preferencia'.");
  if (!day || !time) return toast("Selecciona fecha y hora.");

  const candidates = wantsAny
    ? availableBarbersForSlot(day, time)
    : state.barbers.filter(b => b.id === booking.barberId);

  if (!candidates.length) {
    renderAvailableTimes();
    return toast("No hay barberos disponibles en ese horario.");
  }

  const apptRef = doc(collection(db, "appointments"));
  let reserved = false;

  for (const candidate of candidates) {
    const id = slotId(candidate.id, day, time);
    const slotRef = doc(db, "bookedSlots", id);

    try {
      await runTransaction(db, async tx => {
        const slotSnap = await tx.get(slotRef);
        if (slotSnap.exists() && slotSnap.data().status !== "cancelled") {
          throw new Error("SLOT_TAKEN");
        }

        const baseSlot = {
          slotId:id,
          ownerUid:auth.currentUser.uid,
          barberId:candidate.id,
          date:day,
          time,
          status:"pending",
          createdAt:serverTimestamp(),
          updatedAt:serverTimestamp()
        };

        tx.set(slotRef, baseSlot);
        tx.set(apptRef, {
          ...baseSlot,
          clientName:$("clientName").value.trim(),
          clientPhone:$("clientPhone").value.trim(),
          serviceId:service.id,
          serviceName:service.name,
          servicePrice:Number(service.price),

          // Si el cliente no tiene preferencia, el puesto se reserva
          // internamente para evitar sobreventa, pero el admin decide
          // qué barbero quedará finalmente asignado.
          barberId:wantsAny ? "unassigned" : candidate.id,
          barberName:wantsAny ? "Por asignar" : candidate.name,
          reservedBarberId:candidate.id,
          needsAssignment:wantsAny,

          note:$("clientNote").value.trim()
        });
      });

      reserved = true;
      break;
    } catch (err) {
      if (!String(err?.message).includes("SLOT_TAKEN")) throw err;
    }
  }

  if (!reserved) {
    renderAvailableTimes();
    return toast("Ese horario acaba de llenarse. Elige otro.");
  }

  e.target.reset();
  booking = { serviceId:null, barberId:null };
  $("clientDate").value = isoDay();
  updateSelectedDateSummary();
  renderClientOptions();
  toast(wantsAny
    ? "¡Cita reservada! El administrador asignará tu barbero."
    : "¡Cita reservada! Pendiente de confirmación."
  );
}

function renderClientAppointments() {
  if (currentRole !== "client") return;
  const rows = [...state.clientAppointments].sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
  $("clientAppointments").innerHTML = rows.length ? rows.map(a => `
    <div class="client-appt"><strong>${fmtDateOnly(a.date)} · ${a.time}</strong><small>${escapeHtml(a.serviceName)} · ${appointmentNeedsBarber(a) ? "Barbero por asignar" : `con ${escapeHtml(a.barberName)}`} · ${statusLabel(a.status)}</small></div>
  `).join("") : `<div class="empty">Aún no has creado citas desde este dispositivo.</div>`;
}

function exportCsv() {
  const selectedMonth = $("reportMonth")?.value || monthKey(new Date());
  const rows = state.sales
    .filter(s => monthKey(s.date) === selectedMonth)
    .sort((a,b)=>jsDate(a.date)-jsDate(b.date));

  const header = ["Fecha","Barbero","Puesto","Servicio","Metodo","Total cobrado","Comision %","Saldo barbero","Ingreso barberia"];
  const data = rows.map(s => [
    jsDate(s.date).toLocaleString("es-PA"),
    s.barberName,
    s.chairName,
    s.serviceName,
    s.payment,
    Number(s.total || 0).toFixed(2),
    Number(s.commission || 0).toFixed(2),
    Number(s.barberAmount || 0).toFixed(2),
    Number(s.shopAmount || 0).toFixed(2)
  ]);

  const csv = [header,...data]
    .map(r => r.map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(","))
    .join("\\n");

  const blob = new Blob(["\\ufeff"+csv], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Los_Magicos_Reporte_${selectedMonth}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}


async function exportExcelReport() {
  if (!window.ExcelJS) {
    return toast("No se pudo cargar el generador de Excel. Revisa tu conexión a Internet.");
  }

  const selectedMonth = $("reportMonth")?.value || monthKey(new Date());
  const monthSales = state.sales
    .filter(s => monthKey(s.date) === selectedMonth)
    .sort((a,b) => jsDate(a.date) - jsDate(b.date));

  if (!monthSales.length) {
    return toast("No hay cobros en el mes seleccionado para exportar.");
  }

  toast("Generando Excel premium...");

  try {
    const ExcelJS = window.ExcelJS;
    const wb = new ExcelJS.Workbook();
    wb.creator = "Barbería Los Mágicos";
    wb.lastModifiedBy = "Barbería Los Mágicos";
    wb.created = new Date();
    wb.modified = new Date();
    wb.subject = `Reporte mensual ${monthLabel(selectedMonth)}`;
    wb.title = `Barbería Los Mágicos - ${monthLabel(selectedMonth)}`;

    const COLORS = {
      black: "FF111114",
      dark: "FF1D1D21",
      gold: "FFD7AD56",
      goldSoft: "FFF4E6C8",
      white: "FFFFFFFF",
      text: "FF171717",
      muted: "FF666666",
      light: "FFF7F7F7",
      border: "FFD9D9D9",
      green: "FF1F7A4D"
    };

    const currencyFmt = '$#,##0.00';
    const pctFmt = '0.00%';

    function setTitle(ws, title, subtitle, endCol = 6) {
      ws.mergeCells(1, 1, 2, endCol);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = "BARBERÍA LOS MÁGICOS";
      titleCell.font = { name:"Aptos Display", size:22, bold:true, color:{argb:COLORS.gold} };
      titleCell.fill = { type:"pattern", pattern:"solid", fgColor:{argb:COLORS.black} };
      titleCell.alignment = { vertical:"middle", horizontal:"left" };

      ws.mergeCells(3, 1, 3, endCol);
      const sub = ws.getCell(3, 1);
      sub.value = title;
      sub.font = { name:"Aptos", size:14, bold:true, color:{argb:COLORS.text} };

      ws.mergeCells(4, 1, 4, endCol);
      const desc = ws.getCell(4, 1);
      desc.value = subtitle;
      desc.font = { name:"Aptos", size:10, color:{argb:COLORS.muted} };

      ws.getRow(1).height = 28;
      ws.getRow(2).height = 28;
      ws.getRow(3).height = 22;
      ws.getRow(4).height = 18;
    }

    function styleHeader(row) {
      row.eachCell(cell => {
        cell.fill = { type:"pattern", pattern:"solid", fgColor:{argb:COLORS.dark} };
        cell.font = { name:"Aptos", size:10, bold:true, color:{argb:COLORS.white} };
        cell.alignment = { vertical:"middle", horizontal:"center" };
        cell.border = {
          top:{style:"thin", color:{argb:COLORS.border}},
          bottom:{style:"thin", color:{argb:COLORS.border}},
          left:{style:"thin", color:{argb:COLORS.border}},
          right:{style:"thin", color:{argb:COLORS.border}}
        };
      });
      row.height = 22;
    }

    function styleDataRows(ws, startRow, endRow, moneyCols = []) {
      for (let r = startRow; r <= endRow; r++) {
        const row = ws.getRow(r);
        row.eachCell(cell => {
          cell.font = { name:"Aptos", size:10, color:{argb:COLORS.text} };
          cell.border = {
            bottom:{style:"hair", color:{argb:"FFE5E5E5"}}
          };
          cell.alignment = { vertical:"middle" };
        });
        moneyCols.forEach(c => {
          row.getCell(c).numFmt = currencyFmt;
        });
      }
    }

    function addKpi(ws, row, col, label, value, gold = false) {
      ws.mergeCells(row, col, row, col + 1);
      const labelCell = ws.getCell(row, col);
      labelCell.value = label;
      labelCell.font = { size:9, bold:true, color:{argb:gold ? COLORS.text : COLORS.muted} };
      labelCell.fill = {
        type:"pattern",
        pattern:"solid",
        fgColor:{argb:gold ? COLORS.goldSoft : COLORS.light}
      };
      labelCell.alignment = { horizontal:"left", vertical:"middle" };

      ws.mergeCells(row + 1, col, row + 2, col + 1);
      const valueCell = ws.getCell(row + 1, col);
      valueCell.value = value;
      valueCell.numFmt = currencyFmt;
      valueCell.font = { size:19, bold:true, color:{argb:gold ? "FF8A611D" : COLORS.text} };
      valueCell.fill = {
        type:"pattern",
        pattern:"solid",
        fgColor:{argb:gold ? COLORS.goldSoft : COLORS.light}
      };
      valueCell.alignment = { horizontal:"left", vertical:"middle" };

      for (let rr = row; rr <= row + 2; rr++) {
        for (let cc = col; cc <= col + 1; cc++) {
          ws.getCell(rr, cc).border = {
            top:{style:"thin", color:{argb:COLORS.border}},
            bottom:{style:"thin", color:{argb:COLORS.border}},
            left:{style:"thin", color:{argb:COLORS.border}},
            right:{style:"thin", color:{argb:COLORS.border}}
          };
        }
      }
    }

    const total = monthSales.reduce((a,s)=>a+Number(s.total||0),0);
    const barberTotal = monthSales.reduce((a,s)=>a+Number(s.barberAmount||0),0);
    const shopTotal = monthSales.reduce((a,s)=>a+Number(s.shopAmount||0),0);
  
    const chairRows = state.chairs.map(chair => {
      const sales = monthSales.filter(s => s.chairId === chair.id);
      return {
        name: chair.name,
        count: sales.length,
        gross: sales.reduce((a,s)=>a+Number(s.total||0),0),
        barber: sales.reduce((a,s)=>a+Number(s.barberAmount||0),0),
        shop: sales.reduce((a,s)=>a+Number(s.shopAmount||0),0)
      };
    }).sort((a,b)=>b.gross-a.gross);

    const barberMonthly = state.barbers.map(barber => {
      const sales = monthSales.filter(s => s.barberId === barber.id);
      return {
        id: barber.id,
        name: barber.name,
        commission: Number(barber.commission ?? 50),
        count: sales.length,
        gross: sales.reduce((a,s)=>a+Number(s.total||0),0),
        pay: sales.reduce((a,s)=>a+Number(s.barberAmount||0),0),
        shop: sales.reduce((a,s)=>a+Number(s.shopAmount||0),0)
      };
    }).sort((a,b)=>b.gross-a.gross);

    const dailyMap = new Map();
    monthSales.forEach(sale => {
      const date = dayKey(sale.date);
      const key = `${date}__${sale.barberId}`;
      if (!dailyMap.has(key)) {
        dailyMap.set(key, {
          date,
          barberName: sale.barberName || "Barbero",
          count:0, gross:0, pay:0, shop:0
        });
      }
      const row = dailyMap.get(key);
      row.count += 1;
      row.gross += Number(sale.total||0);
      row.pay += Number(sale.barberAmount||0);
      row.shop += Number(sale.shopAmount||0);
    });
    const dailyRows = [...dailyMap.values()].sort((a,b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.barberName.localeCompare(b.barberName);
    });

    // =====================================================
    // HOJA 1: RESUMEN
    // =====================================================
    const summary = wb.addWorksheet("Resumen", {
      properties:{ tabColor:{argb:COLORS.gold} },
      pageSetup:{ orientation:"landscape", fitToPage:true, fitToWidth:1, fitToHeight:0 }
    });
    setTitle(
      summary,
      `Reporte mensual · ${monthLabel(selectedMonth)}`,
      `Generado el ${new Date().toLocaleString("es-PA")} · ${monthSales.length} servicios`,
      8
    );

    addKpi(summary, 6, 1, "TOTAL COBRADO", total);
    addKpi(summary, 6, 3, "PAGO A BARBEROS", barberTotal);
    addKpi(summary, 6, 5, "INGRESO BARBERÍA", shopTotal, true);
    addKpi(summary, 6, 7, "TICKET PROMEDIO", average);

    summary.getCell("A11").value = "DETALLE POR PUESTO";
    summary.getCell("A11").font = { size:13, bold:true, color:{argb:COLORS.text} };

    const chairHeaderRow = 12;
    const chairHeaders = ["Puesto","Servicios","Total cobrado","Pago barberos","Ingreso barbería"];
    chairHeaders.forEach((h,i)=>summary.getCell(chairHeaderRow, i+1).value = h);
    styleHeader(summary.getRow(chairHeaderRow));

    chairRows.forEach((r,idx) => {
      const row = chairHeaderRow + 1 + idx;
      summary.getCell(row,1).value = r.name;
      summary.getCell(row,2).value = r.count;
      summary.getCell(row,3).value = r.gross;
      summary.getCell(row,4).value = r.barber;
      summary.getCell(row,5).value = r.shop;
    });
    styleDataRows(summary, chairHeaderRow+1, chairHeaderRow+chairRows.length, [3,4,5]);

    const barberStart = chairHeaderRow + chairRows.length + 3;
    summary.getCell(barberStart,1).value = "RESUMEN MENSUAL POR BARBERO";
    summary.getCell(barberStart,1).font = { size:13, bold:true, color:{argb:COLORS.text} };

    const barberHeader = barberStart + 1;
    ["Barbero","Servicios","Venta generada","Comisión %","Saldo barbero","Ingreso barbería"]
      .forEach((h,i)=>summary.getCell(barberHeader,i+1).value=h);
    styleHeader(summary.getRow(barberHeader));

    barberMonthly.forEach((r,idx) => {
      const row = barberHeader + 1 + idx;
      summary.getCell(row,1).value = r.name;
      summary.getCell(row,2).value = r.count;
      summary.getCell(row,3).value = r.gross;
      summary.getCell(row,4).value = r.commission / 100;
      summary.getCell(row,5).value = r.pay;
      summary.getCell(row,6).value = r.shop;
      summary.getCell(row,4).numFmt = pctFmt;
    });
    styleDataRows(summary, barberHeader+1, barberHeader+barberMonthly.length, [3,5,6]);

    summary.columns = [
      {width:24},{width:13},{width:18},{width:17},
      {width:18},{width:18},{width:16},{width:16}
    ];
    summary.views = [{state:"frozen", ySplit:4}];

    // =====================================================
    // HOJA 2: PUESTOS
    // =====================================================
    const chairsWs = wb.addWorksheet("Puestos", {
      properties:{ tabColor:{argb:"FF8A611D"} },
      pageSetup:{ orientation:"landscape", fitToPage:true, fitToWidth:1 }
    });
    setTitle(chairsWs, `Detalle por puesto · ${monthLabel(selectedMonth)}`, "Producción mensual de cada puesto.", 5);
    const chHeaders = ["Puesto","Servicios","Total cobrado","Pago barberos","Ingreso barbería"];
    chHeaders.forEach((h,i)=>chairsWs.getCell(6,i+1).value=h);
    styleHeader(chairsWs.getRow(6));
    chairRows.forEach((r,idx)=>{
      const row=7+idx;
      chairsWs.getCell(row,1).value=r.name;
      chairsWs.getCell(row,2).value=r.count;
      chairsWs.getCell(row,3).value=r.gross;
      chairsWs.getCell(row,4).value=r.barber;
      chairsWs.getCell(row,5).value=r.shop;
    });
    styleDataRows(chairsWs,7,6+chairRows.length,[3,4,5]);
    chairsWs.columns=[{width:24},{width:14},{width:20},{width:20},{width:20}];
    chairsWs.views=[{state:"frozen",ySplit:6}];

    // =====================================================
    // HOJA 3: BARBEROS MENSUAL
    // =====================================================
    const bm = wb.addWorksheet("Barberos Mensual", {
      properties:{tabColor:{argb:COLORS.gold}}
    });
    setTitle(bm, `Barberos · Total mensual · ${monthLabel(selectedMonth)}`, "Venta generada, comisión y saldo del mes.", 6);
    ["Barbero","Servicios","Venta generada","Comisión %","Saldo barbero","Ingreso barbería"]
      .forEach((h,i)=>bm.getCell(6,i+1).value=h);
    styleHeader(bm.getRow(6));
    barberMonthly.forEach((r,idx)=>{
      const row=7+idx;
      bm.getCell(row,1).value=r.name;
      bm.getCell(row,2).value=r.count;
      bm.getCell(row,3).value=r.gross;
      bm.getCell(row,4).value=r.commission/100;
      bm.getCell(row,5).value=r.pay;
      bm.getCell(row,6).value=r.shop;
      bm.getCell(row,4).numFmt=pctFmt;
    });
    styleDataRows(bm,7,6+barberMonthly.length,[3,5,6]);
    bm.columns=[{width:26},{width:14},{width:20},{width:16},{width:20},{width:20}];
    bm.views=[{state:"frozen",ySplit:6}];

    // =====================================================
    // HOJA 4: BARBEROS DIARIO
    // =====================================================
    const bd = wb.addWorksheet("Barberos Diario", {
      properties:{tabColor:{argb:"FFB88936"}}
    });
    setTitle(bd, `Saldo diario por barbero · ${monthLabel(selectedMonth)}`, "Detalle de cada día trabajado en el mes.", 6);
    ["Fecha","Barbero","Servicios","Total cobrado","Saldo barbero","Ingreso barbería"]
      .forEach((h,i)=>bd.getCell(6,i+1).value=h);
    styleHeader(bd.getRow(6));
    dailyRows.forEach((r,idx)=>{
      const row=7+idx;
      const [y,m,d] = r.date.split("-").map(Number);
      bd.getCell(row,1).value = new Date(y,m-1,d);
      bd.getCell(row,1).numFmt = "dd-mmm-yyyy";
      bd.getCell(row,2).value = r.barberName;
      bd.getCell(row,3).value = r.count;
      bd.getCell(row,4).value = r.gross;
      bd.getCell(row,5).value = r.pay;
      bd.getCell(row,6).value = r.shop;
    });
    styleDataRows(bd,7,6+dailyRows.length,[4,5,6]);
    bd.columns=[{width:16},{width:26},{width:14},{width:20},{width:20},{width:20}];
    bd.views=[{state:"frozen",ySplit:6}];
    bd.autoFilter = { from:"A6", to:"F6" };

    // =====================================================
    // HOJA 5: COBROS
    // =====================================================
    const salesWs = wb.addWorksheet("Cobros", {
      properties:{tabColor:{argb:COLORS.dark}}
    });
    setTitle(salesWs, `Detalle completo de cobros · ${monthLabel(selectedMonth)}`, "Movimientos individuales registrados durante el mes.", 9);
    ["Fecha","Barbero","Puesto","Servicio","Productos","Método","Total cobrado","Comisión servicio %","Comisión productos %","Ganancia servicio","Ganancia productos","Saldo barbero","Ingreso barbería"]
      .forEach((h,i)=>salesWs.getCell(6,i+1).value=h);
    styleHeader(salesWs.getRow(6));

    monthSales.forEach((s,idx)=>{
      const row=7+idx;
      salesWs.getCell(row,1).value=jsDate(s.date);
      salesWs.getCell(row,1).numFmt="dd-mmm-yyyy hh:mm";
      salesWs.getCell(row,2).value=s.barberName || "";
      salesWs.getCell(row,3).value=s.chairName || "";
      salesWs.getCell(row,4).value=s.serviceName || "";
      salesWs.getCell(row,5).value=Array.isArray(s.products) ? s.products.map(p => `${p.qty}x ${p.name}`).join(", ") : "";
      salesWs.getCell(row,6).value=s.payment || "";
      salesWs.getCell(row,7).value=Number(s.total||0);
      salesWs.getCell(row,8).value=Number(s.serviceCommission ?? s.commission ?? 0)/100;
      salesWs.getCell(row,8).numFmt=pctFmt;
      salesWs.getCell(row,9).value=Number(s.productCommission ?? 0)/100;
      salesWs.getCell(row,9).numFmt=pctFmt;
      salesWs.getCell(row,10).value=Number(s.serviceBarberAmount ?? s.barberAmount ?? 0);
      salesWs.getCell(row,11).value=Number(s.productBarberAmount ?? 0);
      salesWs.getCell(row,12).value=Number(s.barberAmount||0);
      salesWs.getCell(row,13).value=Number(s.shopAmount||0);
    });
    styleDataRows(salesWs,7,6+monthSales.length,[7,10,11,12,13]);
    salesWs.columns=[
      {width:21},{width:26},{width:18},{width:26},{width:34},
      {width:18},{width:18},{width:15},{width:18},{width:20}
    ];
    salesWs.views=[{state:"frozen",ySplit:6}];
    salesWs.autoFilter={from:"A6",to:"M6"};

    // Highlight total rows on summary
    const finalSummaryRow = barberHeader + barberMonthly.length + 2;
    summary.getCell(finalSummaryRow,1).value = "CIERRE DEL MES";
    summary.getCell(finalSummaryRow,1).font = {bold:true,color:{argb:COLORS.gold}};
    summary.getCell(finalSummaryRow,3).value = total;
    summary.getCell(finalSummaryRow,3).numFmt = currencyFmt;
    summary.getCell(finalSummaryRow,5).value = barberTotal;
    summary.getCell(finalSummaryRow,5).numFmt = currencyFmt;
    summary.getCell(finalSummaryRow,7).value = shopTotal;
    summary.getCell(finalSummaryRow,7).numFmt = currencyFmt;

    // Download
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob(
      [buffer],
      {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Barberia_Los_Magicos_Reporte_${selectedMonth}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);

    toast("Excel premium generado correctamente.");
  } catch (err) {
    console.error(err);
    toast("No se pudo generar el Excel.");
  }
}

async function restoreSession(user) {
  if (!user || currentRole) return;

  if (user.isAnonymous) return;

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) {
      await signOut(auth);
      return;
    }

    const profile = { id:snap.id, ...snap.data() };

    if (profile.role === "admin" && profile.active !== false) {
      currentRole = "admin";
      currentAdmin = profile;
      hide("accessScreen");
      show("adminApp");
      $("adminDisplayName").textContent = profile.name || "Administrador";
      await ensureSeedData();
      subscribeAdmin();
    } else if (profile.role === "barber" && profile.active !== false) {
      currentRole = "barber";
      currentBarber = profile;
      hide("accessScreen");
      show("barberApp");
      subscribeBarber(profile.id);
    } else {
      await signOut(auth);
    }
  } catch (err) {
    console.error(err);
  }
}

async function main() {
  wireStaticUI();
  const todayLabel = $("todayLabel");
  if (todayLabel) {
    todayLabel.textContent = new Date().toLocaleDateString("es-PA", { weekday:"long", day:"2-digit", month:"long" });
  }

  const ready = await initFirebase();
  if (!ready) return;

  onAuthStateChanged(auth, restoreSession);
}

main().catch(err => {
  console.error("[Los Mágicos] Error de inicialización:", err);
  const alert = $("firebaseAlert");
  if (alert) {
    alert.textContent = "La aplicación no pudo completar la inicialización. Recarga la página con Ctrl + F5.";
    alert.classList.remove("hidden");
  }
});
