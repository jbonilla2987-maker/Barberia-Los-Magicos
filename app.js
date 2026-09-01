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
  sales: [],
  appointments: [],
  clientAppointments: [],
  bookedSlots: []
};

let app;
let auth;
let db;
let currentRole = null;
let currentBarber = null;
let currentAdmin = null;
let booking = { serviceId: null, barberId: null };
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
  return { pending:"Pendiente", confirmed:"Confirmada", completed:"Completada", cancelled:"Cancelada" }[v] || v;
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

function show(id) { $(id).classList.remove("hidden"); }
function hide(id) { $(id).classList.add("hidden"); }
function openModal(id) { $(id).classList.add("show"); }
function closeModal(id) { $(id).classList.remove("show"); }

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
  $("openAdmin").addEventListener("click", () => openModal("adminLoginModal"));
  $("openBarber").addEventListener("click", () => openModal("barberLoginModal"));
  $("openClient").addEventListener("click", enterClient);

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

  $("adminMenuBtn").addEventListener("click", () => $("adminSidebar").classList.toggle("open"));
  $("appointmentFilter").addEventListener("change", renderAppointments);
  $("saleService").addEventListener("change", syncSalePrice);
  $("clientDate").addEventListener("change", renderAvailableTimes);
  $("reportMonth").value = monthKey(new Date());
  $("reportMonth").addEventListener("change", renderReports);
  $("printReportBtn").addEventListener("click", () => window.print());

  ["quickSaleBtn","heroSaleBtn","newSaleBtn"].forEach(id =>
    $(id).addEventListener("click", () => openModal("saleModal"))
  );

  $("addBarberBtn").addEventListener("click", () => openModal("barberModal"));
  $("addServiceBtn").addEventListener("click", () => openModal("serviceModal"));

  $("adminLoginForm").addEventListener("submit", adminLogin);
  $("barberLoginForm").addEventListener("submit", barberLogin);
  $("saleForm").addEventListener("submit", saveSale);
  $("barberForm").addEventListener("submit", createBarber);
  $("serviceForm").addEventListener("submit", createService);
  $("clientBookingForm").addEventListener("submit", createAppointment);
  $("addChairBtn").addEventListener("click", createChair);
  $("exportBtn").addEventListener("click", exportCsv);
  $("exportExcelBtn").addEventListener("click", exportExcelReport);
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

  unsubscribers.push(onSnapshot(collection(db, "sales"), snap => {
    state.sales = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderAdminAll();
  }));

  unsubscribers.push(onSnapshot(collection(db, "appointments"), snap => {
    state.appointments = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderAdminAll();
  }));
}

function subscribeBarber(uid) {
  cleanupListeners();

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
  if (!$("clientDate").value) $("clientDate").value = isoDay();
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
    barbers:"Usuarios / Barberos", chairs:"Puestos", services:"Servicios", reports:"Reportes"
  };
  $("adminPageTitle").textContent = titles[name] || "Dashboard";
  $("adminSidebar").classList.remove("open");
}

function renderAdminAll() {
  if (currentRole !== "admin") return;
  renderSelectors();
  renderDashboard();
  renderSales();
  renderAppointments();
  renderBarbers();
  renderChairs();
  renderServices();
  renderReports();
}

function renderSelectors() {
  const barbers = state.barbers.filter(x => x.active !== false);
  const chairs = state.chairs.filter(x => x.active !== false);
  const services = state.services.filter(x => x.active !== false);

  $("saleBarber").innerHTML = barbers.length
    ? barbers.map(x => `<option value="${x.id}">${escapeHtml(x.name)} · ${Number(x.commission ?? 50)}%</option>`).join("")
    : `<option value="">Sin barberos activos</option>`;

  $("saleChair").innerHTML = chairs.length
    ? chairs.map(x => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join("")
    : `<option value="">Sin puestos</option>`;

  $("saleService").innerHTML = services.length
    ? services.map(x => `<option value="${x.id}">${escapeHtml(x.name)} · ${money(x.price)}</option>`).join("")
    : `<option value="">Sin servicios</option>`;

  syncSalePrice();
}

function syncSalePrice() {
  const service = state.services.find(x => x.id === $("saleService").value);
  if (service) $("salePrice").value = Number(service.price).toFixed(2);
}

function renderDashboard() {
  const ds = state.sales.filter(s => todayIso(s.date));
  const da = state.appointments.filter(a => a.date === isoDay());

  $("statSales").textContent = money(ds.reduce((a,s)=>a+Number(s.total||0),0));
  $("statBarbers").textContent = money(ds.reduce((a,s)=>a+Number(s.barberAmount||0),0));
  $("statShop").textContent = money(ds.reduce((a,s)=>a+Number(s.shopAmount||0),0));
  $("statSalesCount").textContent = `${ds.length} servicio${ds.length===1?"":"s"}`;
  $("statAppointments").textContent = da.length;
  $("statAppointmentsMeta").textContent = `${da.filter(a=>a.status==="pending").length} pendientes`;

  const recent = [...state.sales].sort((a,b)=>jsDate(b.date)-jsDate(a.date)).slice(0,6);
  $("recentSales").innerHTML = recent.length ? recent.map(s => `
    <div class="list-row"><div><div class="item-title">${escapeHtml(s.serviceName)}</div><div class="item-meta">${escapeHtml(s.barberName)} · ${fmtDateTime(s.date)}</div></div><div class="amount">${money(s.total)}</div></div>
  `).join("") : `<div class="empty">Aún no hay cobros.</div>`;

  const upcoming = state.appointments.filter(a => !["cancelled","completed"].includes(a.status) && a.date >= isoDay()).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).slice(0,6);
  $("upcomingAppointments").innerHTML = upcoming.length ? upcoming.map(a => `
    <div class="list-row"><div><div class="item-title">${escapeHtml(a.clientName)} · ${escapeHtml(a.serviceName)}</div><div class="item-meta">${fmtDateOnly(a.date)} ${a.time} · ${escapeHtml(a.barberName)}</div></div><span class="status ${a.status}">${statusLabel(a.status)}</span></div>
  `).join("") : `<div class="empty">No hay próximas citas.</div>`;
}

function renderSales() {
  const rows = [...state.sales].sort((a,b)=>jsDate(b.date)-jsDate(a.date));
  $("salesTable").innerHTML = rows.length ? rows.map(s => `
    <tr><td>${fmtDateTime(s.date)}</td><td>${escapeHtml(s.barberName)}</td><td>${escapeHtml(s.chairName)}</td><td>${escapeHtml(s.serviceName)}</td><td>${escapeHtml(s.payment)}</td><td><b>${money(s.total)}</b></td><td>${money(s.barberAmount)}</td><td>${money(s.shopAmount)}</td></tr>
  `).join("") : `<tr><td colspan="8" class="empty">No hay cobros registrados.</td></tr>`;
}

async function saveSale(e) {
  e.preventDefault();
  const barber = state.barbers.find(x => x.id === $("saleBarber").value);
  const chair = state.chairs.find(x => x.id === $("saleChair").value);
  const service = state.services.find(x => x.id === $("saleService").value);
  const total = Number($("salePrice").value);

  if (!barber || !chair || !service || total <= 0) return toast("Revisa los datos del cobro.");

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

function renderAppointments() {
  let rows = [...state.appointments].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const filter = $("appointmentFilter").value;
  if (filter !== "all") rows = rows.filter(x => x.status === filter);

  $("appointmentCards").innerHTML = rows.length ? rows.map(a => `
    <article class="appointment-card">
      <div class="appointment-top"><div><span class="status ${a.status}">${statusLabel(a.status)}</span><h3>${escapeHtml(a.clientName)}</h3><div class="card-meta">${escapeHtml(a.clientPhone)} · ${escapeHtml(a.serviceName)}</div></div><div class="appt-time">${a.time}</div></div>
      <div class="card-meta" style="margin-top:12px">${fmtDateOnly(a.date)} · ${escapeHtml(a.barberName)} · ${money(a.servicePrice)}</div>
      ${a.note ? `<div class="credential">Nota: ${escapeHtml(a.note)}</div>` : ""}
      <div class="appt-actions">
        ${a.status==="pending" ? `<button class="tiny-btn" data-appt="${a.id}" data-status="confirmed" type="button">Confirmar</button>` : ""}
        ${a.status==="confirmed" ? `<button class="tiny-btn" data-appt="${a.id}" data-status="completed" type="button">Completar</button>` : ""}
        ${!["completed","cancelled"].includes(a.status) ? `<button class="tiny-btn" data-appt="${a.id}" data-status="cancelled" type="button">Cancelar</button>` : ""}
      </div>
    </article>
  `).join("") : `<div class="empty">No hay citas en esta categoría.</div>`;

  document.querySelectorAll("[data-appt][data-status]").forEach(btn =>
    btn.addEventListener("click", () => changeAppointment(btn.dataset.appt, btn.dataset.status))
  );
}

async function changeAppointment(id, status) {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "appointments", id), { status, updatedAt:serverTimestamp() });
    batch.update(doc(db, "bookedSlots", id), { status, updatedAt:serverTimestamp() });
    await batch.commit();
    toast(`Cita ${statusLabel(status).toLowerCase()}.`);
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err, "No se pudo actualizar la cita."));
  }
}

function renderBarbers() {
  $("barberCards").innerHTML = state.barbers.length ? state.barbers.map(b => {
    const sales = state.sales.filter(s => s.barberId === b.id);
    const gross = sales.reduce((a,s)=>a+Number(s.total||0),0);
    const pay = sales.reduce((a,s)=>a+Number(s.barberAmount||0),0);

    return `<article class="person-card">
      <span class="card-kicker">USUARIO BARBERO</span>
      <h3>${escapeHtml(b.name)}</h3>
      <div class="card-meta">${b.active===false ? "Cuenta desactivada" : `Comisión ${Number(b.commission ?? 50)}%`}</div>
      <div class="credential">Usuario: <b>${escapeHtml(b.username)}</b><br>Contraseña: protegida por Firebase y no visible.</div>
      <div class="card-numbers"><div class="mini-stat"><span>Ventas</span><strong>${money(gross)}</strong></div><div class="mini-stat"><span>Comisión</span><strong>${money(pay)}</strong></div></div>
      ${b.active!==false ? `<button class="danger-btn" data-disable-barber="${b.id}" type="button">Desactivar usuario</button>` : ""}
    </article>`;
  }).join("") : `<div class="empty">Todavía no has creado barberos.</div>`;

  document.querySelectorAll("[data-disable-barber]").forEach(btn =>
    btn.addEventListener("click", () => deactivateBarber(btn.dataset.disableBarber))
  );
}

async function createBarber(e) {
  e.preventDefault();

  const name = $("barberName").value.trim();
  const username = $("barberUsername").value.trim().toLowerCase();
  const password = $("barberPassword").value;
  const password2 = $("barberPassword2").value;
  const commission = Number($("barberCommission").value);

  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return toast("El usuario debe tener mínimo 3 caracteres, sin espacios.");
  if (password.length < 6) return toast("La contraseña debe tener mínimo 6 caracteres.");
  if (password !== password2) return toast("Las contraseñas no coinciden.");
  if (commission < 0 || commission > 100) return toast("La comisión debe estar entre 0 y 100%.");

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
      active:true,
      createdAt:serverTimestamp(),
      createdBy:auth.currentUser.uid
    });

    await setDoc(doc(db, "publicBarbers", uid), {
      name,
      active:true,
      createdAt:serverTimestamp()
    });

    await signOut(secondaryAuth);
    await deleteApp(secondaryApp);
    secondaryApp = null;

    closeModal("barberModal");
    e.target.reset();
    $("barberCommission").value = 50;
    toast(`Usuario ${username} creado correctamente.`);
  } catch (err) {
    console.error(err);
    if (secondaryApp) {
      try { await deleteApp(secondaryApp); } catch {}
    }
    toast(firebaseErrorMessage(err, "No se pudo crear el usuario."));
  }
}

async function deactivateBarber(uid) {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "users", uid), { active:false, updatedAt:serverTimestamp() });
    batch.update(doc(db, "publicBarbers", uid), { active:false, updatedAt:serverTimestamp() });
    await batch.commit();
    toast("Usuario desactivado.");
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err, "No se pudo desactivar."));
  }
}

function renderChairs() {
  $("chairCards").innerHTML = state.chairs.map((c,i) => `
    <article class="chair-card"><span class="card-kicker">PUESTO ${String(i+1).padStart(2,"0")}</span><h3>${escapeHtml(c.name)}</h3><div class="card-meta">${c.active===false?"Inactivo":"Activo y disponible"}</div><div class="card-numbers"><div class="mini-stat"><span>Servicios</span><strong>${state.sales.filter(s=>s.chairId===c.id).length}</strong></div><div class="mini-stat"><span>Estado</span><strong>${c.active===false?"Inactivo":"Activo"}</strong></div></div></article>
  `).join("");
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
  $("serviceCards").innerHTML = state.services.map(s => `
    <article class="service-card"><span class="card-kicker">SERVICIO</span><h3>${escapeHtml(s.name)}</h3><div class="card-meta">${Number(s.duration||30)} min aprox.</div><div class="card-numbers"><div class="mini-stat"><span>Precio</span><strong>${money(s.price)}</strong></div><div class="mini-stat"><span>Reservas</span><strong>${state.appointments.filter(a=>a.serviceId===s.id).length}</strong></div></div></article>
  `).join("");
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

function renderReports() {
  if (currentRole !== "admin") return;

  const selectedMonth = $("reportMonth")?.value || monthKey(new Date());
  const monthSales = state.sales.filter(s => monthKey(s.date) === selectedMonth);

  const total = monthSales.reduce((a,s) => a + Number(s.total || 0), 0);
  const barberTotal = monthSales.reduce((a,s) => a + Number(s.barberAmount || 0), 0);
  const shopTotal = monthSales.reduce((a,s) => a + Number(s.shopAmount || 0), 0);
  const average = monthSales.length ? total / monthSales.length : 0;

  $("reportTotal").textContent = money(total);
  $("reportBarbers").textContent = money(barberTotal);
  $("reportShop").textContent = money(shopTotal);
  $("reportAverage").textContent = money(average);
  $("reportCount").textContent = `${monthSales.length} servicios`;
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
}

function renderBarberPortal() {
  if (currentRole !== "barber" || !currentBarber) return;

  $("barberWelcomeName").textContent = (currentBarber.name || "Barbero").split(" ")[0];
  $("myCommission").textContent = `${Number(currentBarber.commission ?? 50)}%`;

  const mine = state.sales.filter(s => s.barberId === currentBarber.id);
  const today = mine.filter(s => todayIso(s.date));
  const currentMonth = monthKey(new Date());
  const thisMonth = mine.filter(s => monthKey(s.date) === currentMonth);

  $("myTodayGross").textContent = money(today.reduce((a,s)=>a+Number(s.total||0),0));
  $("myTodayPay").textContent = money(today.reduce((a,s)=>a+Number(s.barberAmount||0),0));
  $("myMonthGross").textContent = money(thisMonth.reduce((a,s)=>a+Number(s.total||0),0));
  $("myMonthPay").textContent = money(thisMonth.reduce((a,s)=>a+Number(s.barberAmount||0),0));
  $("myAllPay").textContent = money(mine.reduce((a,s)=>a+Number(s.barberAmount||0),0));
  $("myTodayCount").textContent = `${today.length} servicios`;
  $("myMonthCount").textContent = `${thisMonth.length} servicio${thisMonth.length===1?"":"s"} este mes`;
  $("myMonthLabel").textContent = monthLabel(currentMonth);

  const daily = new Map();
  thisMonth.forEach(sale => {
    const date = dayKey(sale.date);
    if (!daily.has(date)) daily.set(date, {date, count:0, gross:0, pay:0});
    const row = daily.get(date);
    row.count += 1;
    row.gross += Number(sale.total || 0);
    row.pay += Number(sale.barberAmount || 0);
  });
  const dailyRows = [...daily.values()].sort((a,b)=>b.date.localeCompare(a.date));
  $("myDailyBalances").innerHTML = dailyRows.length ? dailyRows.map(r => `
    <tr>
      <td>${shortDayLabel(r.date)}</td>
      <td>${r.count}</td>
      <td>${money(r.gross)}</td>
      <td class="money-positive"><b>${money(r.pay)}</b></td>
    </tr>
  `).join("") : `<tr><td colspan="4" class="empty">Aún no tienes servicios este mes.</td></tr>`;

  const appts = state.appointments.filter(a => !["cancelled","completed"].includes(a.status) && a.date >= isoDay()).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  $("myTodayAppointments").textContent = appts.filter(a=>a.date===isoDay()).length;

  $("myAppointments").innerHTML = appts.length ? appts.map(a => `
    <div class="list-row"><div><div class="item-title">${escapeHtml(a.clientName)} · ${escapeHtml(a.serviceName)}</div><div class="item-meta">${fmtDateOnly(a.date)} ${a.time} · ${escapeHtml(a.clientPhone)}</div></div><div class="barber-appt-actions"><span class="status ${a.status}">${statusLabel(a.status)}</span>${a.status==="pending"?`<button class="tiny-btn" data-myappt="${a.id}" data-status="confirmed" type="button">Confirmar</button>`:""}${a.status==="confirmed"?`<button class="tiny-btn" data-myappt="${a.id}" data-status="completed" type="button">Completar</button>`:""}</div></div>
  `).join("") : `<div class="empty">No tienes citas próximas.</div>`;

  document.querySelectorAll("[data-myappt]").forEach(btn =>
    btn.addEventListener("click", () => changeAppointment(btn.dataset.myappt, btn.dataset.status))
  );

  const recent = [...mine].sort((a,b)=>jsDate(b.date)-jsDate(a.date)).slice(0,8);
  $("mySales").innerHTML = recent.length ? recent.map(s => `
    <div class="list-row"><div><div class="item-title">${escapeHtml(s.serviceName)}</div><div class="item-meta">${fmtDateTime(s.date)} · Venta ${money(s.total)}</div></div><div class="amount">${money(s.barberAmount)}</div></div>
  `).join("") : `<div class="empty">Aún no tienes servicios registrados.</div>`;
}

function renderClientOptions() {
  if (currentRole !== "client") return;

  $("clientServiceOptions").innerHTML = state.services.length ? state.services.map(s => `
    <button type="button" class="choice service-choice ${booking.serviceId===s.id?"selected":""}" data-service="${s.id}"><strong>${escapeHtml(s.name)}</strong><small>${money(s.price)} · ${Number(s.duration||30)} min</small></button>
  `).join("") : `<div class="empty">No hay servicios disponibles.</div>`;

  $("clientBarberOptions").innerHTML = state.barbers.length ? state.barbers.map(b => `
    <button type="button" class="choice barber-choice ${booking.barberId===b.id?"selected":""}" data-barber="${b.id}"><strong>${escapeHtml(b.name)}</strong><small>Barbero disponible</small></button>
  `).join("") : `<div class="empty">No hay barberos disponibles.</div>`;

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

function renderAvailableTimes() {
  if (currentRole !== "client") return;

  const day = $("clientDate").value;
  const barberId = booking.barberId;
  const select = $("clientTime");

  if (!day || !barberId) {
    select.innerHTML = `<option value="">Selecciona fecha y barbero</option>`;
    return;
  }

  const occupied = new Set(
    state.bookedSlots
      .filter(s => s.date === day && s.barberId === barberId && s.status !== "cancelled")
      .map(s => s.time)
  );

  const slots = [];
  for (let h=9; h<19; h++) {
    for (const m of [0,30]) {
      const t = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
      if (!occupied.has(t)) slots.push(t);
    }
  }

  select.innerHTML = slots.length
    ? `<option value="">Selecciona una hora</option>${slots.map(t=>`<option value="${t}">${t}</option>`).join("")}`
    : `<option value="">Sin horarios disponibles</option>`;
}

function slotId(barberId, day, time) {
  return `${barberId}_${day}_${time.replace(":","")}`;
}

async function createAppointment(e) {
  e.preventDefault();

  if (!auth.currentUser?.isAnonymous) return toast("Vuelve al inicio y entra nuevamente como Cliente.");

  const service = state.services.find(s => s.id === booking.serviceId);
  const barber = state.barbers.find(b => b.id === booking.barberId);
  const day = $("clientDate").value;
  const time = $("clientTime").value;

  if (!service) return toast("Selecciona un servicio.");
  if (!barber) return toast("Selecciona un barbero.");
  if (!day || !time) return toast("Selecciona fecha y hora.");

  const id = slotId(barber.id, day, time);
  const apptRef = doc(db, "appointments", id);
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
        barberId:barber.id,
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
        barberName:barber.name,
        note:$("clientNote").value.trim()
      });
    });

    e.target.reset();
    booking = { serviceId:null, barberId:null };
    $("clientDate").value = isoDay();
    renderClientOptions();
    toast("¡Cita reservada! Pendiente de confirmación.");
  } catch (err) {
    console.error(err);
    if (String(err?.message).includes("SLOT_TAKEN")) {
      renderAvailableTimes();
      return toast("Ese horario acaba de ser reservado. Elige otro.");
    }
    toast(firebaseErrorMessage(err, "No se pudo reservar la cita."));
  }
}

function renderClientAppointments() {
  if (currentRole !== "client") return;
  const rows = [...state.clientAppointments].sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
  $("clientAppointments").innerHTML = rows.length ? rows.map(a => `
    <div class="client-appt"><strong>${fmtDateOnly(a.date)} · ${a.time}</strong><small>${escapeHtml(a.serviceName)} con ${escapeHtml(a.barberName)} · ${statusLabel(a.status)}</small></div>
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
    const average = monthSales.length ? total / monthSales.length : 0;

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
    ["Fecha","Barbero","Puesto","Servicio","Método","Total cobrado","Comisión %","Saldo barbero","Ingreso barbería"]
      .forEach((h,i)=>salesWs.getCell(6,i+1).value=h);
    styleHeader(salesWs.getRow(6));

    monthSales.forEach((s,idx)=>{
      const row=7+idx;
      salesWs.getCell(row,1).value=jsDate(s.date);
      salesWs.getCell(row,1).numFmt="dd-mmm-yyyy hh:mm";
      salesWs.getCell(row,2).value=s.barberName || "";
      salesWs.getCell(row,3).value=s.chairName || "";
      salesWs.getCell(row,4).value=s.serviceName || "";
      salesWs.getCell(row,5).value=s.payment || "";
      salesWs.getCell(row,6).value=Number(s.total||0);
      salesWs.getCell(row,7).value=Number(s.commission||0)/100;
      salesWs.getCell(row,7).numFmt=pctFmt;
      salesWs.getCell(row,8).value=Number(s.barberAmount||0);
      salesWs.getCell(row,9).value=Number(s.shopAmount||0);
    });
    styleDataRows(salesWs,7,6+monthSales.length,[6,8,9]);
    salesWs.columns=[
      {width:21},{width:26},{width:18},{width:26},{width:18},
      {width:18},{width:15},{width:18},{width:20}
    ];
    salesWs.views=[{state:"frozen",ySplit:6}];
    salesWs.autoFilter={from:"A6",to:"I6"};

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
  $("todayLabel").textContent = new Date().toLocaleDateString("es-PA", { weekday:"long", day:"2-digit", month:"long" });

  const ready = await initFirebase();
  if (!ready) return;

  onAuthStateChanged(auth, restoreSession);
}

main();
