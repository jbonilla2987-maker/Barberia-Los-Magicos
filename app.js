import { firebaseConfig, AUTH_ALIAS_DOMAIN } from "./firebase-config.js?v=20";

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
  const total = state.sales.reduce((a,s)=>a+Number(s.total||0),0);
  const barber = state.sales.reduce((a,s)=>a+Number(s.barberAmount||0),0);
  const shop = state.sales.reduce((a,s)=>a+Number(s.shopAmount||0),0);

  $("reportTotal").textContent = money(total);
  $("reportBarbers").textContent = money(barber);
  $("reportShop").textContent = money(shop);
  $("reportCount").textContent = state.sales.length;

  $("reportByBarber").innerHTML = state.barbers.map(b => {
    const ss = state.sales.filter(s=>s.barberId===b.id);
    const gross = ss.reduce((a,s)=>a+Number(s.total||0),0);
    const pay = ss.reduce((a,s)=>a+Number(s.barberAmount||0),0);
    return `<div class="list-row"><div><div class="item-title">${escapeHtml(b.name)}</div><div class="item-meta">${ss.length} servicios · comisión ${Number(b.commission ?? 50)}%</div></div><div class="amount">${money(pay)} <span class="item-meta">de ${money(gross)}</span></div></div>`;
  }).join("");
}

function renderBarberPortal() {
  if (currentRole !== "barber" || !currentBarber) return;

  $("barberWelcomeName").textContent = (currentBarber.name || "Barbero").split(" ")[0];
  $("myCommission").textContent = `${Number(currentBarber.commission ?? 50)}%`;

  const mine = state.sales.filter(s => s.barberId === currentBarber.id);
  const today = mine.filter(s => todayIso(s.date));

  $("myTodayGross").textContent = money(today.reduce((a,s)=>a+Number(s.total||0),0));
  $("myTodayPay").textContent = money(today.reduce((a,s)=>a+Number(s.barberAmount||0),0));
  $("myAllPay").textContent = money(mine.reduce((a,s)=>a+Number(s.barberAmount||0),0));
  $("myTodayCount").textContent = `${today.length} servicios`;

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
  const header = ["Fecha","Barbero","Puesto","Servicio","Metodo","Total","Comision","Pago Barbero","Ingreso Barberia"];
  const rows = state.sales.map(s => [
    jsDate(s.date).toLocaleString("es-PA"), s.barberName, s.chairName, s.serviceName,
    s.payment, s.total, s.commission, s.barberAmount, s.shopAmount
  ]);
  const csv = [header,...rows].map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Los_Magicos_Reporte.csv";
  a.click();
  URL.revokeObjectURL(url);
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
