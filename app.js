import { firebaseConfig, AUTH_ALIAS_DOMAIN } from "./firebase-config.js";

import {
  initializeApp,
  deleteApp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";

import {
  getAuth,
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
  writeBatch
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

let app = null;
let auth = null;
let db = null;
let currentBarber = null;
let currentRole = null;
let booking = { serviceId: null, barberId: null };
let unsubscribers = [];

const firebaseReady = !Object.values(firebaseConfig).some(v =>
  String(v).includes("REEMPLAZAR")
);

function money(v) {
  return new Intl.NumberFormat("es-PA", {
    style: "currency",
    currency: "USD"
  }).format(Number(v || 0));
}

function isoDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function todayIso(iso) {
  if (!iso) return false;
  const value = iso?.toDate ? iso.toDate().toISOString() : String(iso);
  return value.slice(0, 10) === isoDay();
}

function jsDate(value) {
  if (!value) return new Date(0);
  if (value.toDate) return value.toDate();
  return new Date(value);
}

function fmtDateTime(value) {
  const d = jsDate(value);
  return d.toLocaleString("es-PA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function fmtDateOnly(day) {
  const [y,m,d] = String(day).split("-").map(Number);
  return new Date(y,m-1,d).toLocaleDateString("es-PA", {
    weekday: "short",
    day: "2-digit",
    month: "short"
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
}

function statusLabel(s) {
  return {
    pending:"Pendiente",
    confirmed:"Confirmada",
    completed:"Completada",
    cancelled:"Cancelada"
  }[s] || s;
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function show(id) { $(id).classList.remove("hidden"); }
function hide(id) { $(id).classList.add("hidden"); }
function openModal(id) { $(id).classList.add("show"); }
function closeModal(id) { $(id).classList.remove("show"); }

function cleanupListeners() {
  unsubscribers.forEach(fn => {
    try { fn(); } catch {}
  });
  unsubscribers = [];
}

function usernameToEmail(username) {
  const clean = String(username || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
  return `${clean}@${AUTH_ALIAS_DOMAIN}`;
}

function configWarning() {
  toast("Primero completa public/firebase-config.js");
}

function loginPasswordFromPin(pin) {
  return String(pin).trim();
}

if (firebaseReady) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} else {
  console.warn("Firebase no configurado. Completa public/firebase-config.js");
}

document.querySelectorAll("[data-close]").forEach(btn =>
  btn.addEventListener("click", () => closeModal(btn.dataset.close))
);

document.querySelectorAll(".modal-backdrop").forEach(m =>
  m.addEventListener("click", e => {
    if (e.target === m) closeModal(m.id);
  })
);

document.querySelectorAll("[data-access]").forEach(btn =>
  btn.addEventListener("click", async () => {
    if (!firebaseReady) return configWarning();
    const role = btn.dataset.access;
    if (role === "admin") openModal("adminLoginModal");
    if (role === "barber") openModal("barberLoginModal");
    if (role === "client") await enterClient();
  })
);

document.querySelectorAll("[data-logout]").forEach(btn =>
  btn.addEventListener("click", logout)
);

$("adminLoginForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!firebaseReady) return configWarning();

  try {
    const username = $("adminUser").value.trim();
    const password = $("adminPass").value;
    const credential = await signInWithEmailAndPassword(
      auth,
      usernameToEmail(username),
      password
    );

    const profileSnap = await getDoc(doc(db, "users", credential.user.uid));
    if (!profileSnap.exists() || profileSnap.data().role !== "admin") {
      await signOut(auth);
      return toast("Esta cuenta no tiene permisos de administrador");
    }

    currentRole = "admin";
    closeModal("adminLoginModal");
    hide("accessScreen");
    show("adminApp");

    await ensureSeedData();
    subscribeAdmin();
    toast("Bienvenido a Barbería Los Mágicos");
  } catch (err) {
    console.error(err);
    toast("Usuario o contraseña incorrectos");
  }
});

$("barberLoginForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!firebaseReady) return configWarning();

  const username = $("barberUserLogin").value.trim();
  const pin = $("barberPinLogin").value.trim();

  if (!/^\d{6}$/.test(pin)) {
    return toast("El PIN debe tener 6 dígitos");
  }

  try {
    const credential = await signInWithEmailAndPassword(
      auth,
      usernameToEmail(username),
      loginPasswordFromPin(pin)
    );

    const profileSnap = await getDoc(doc(db, "users", credential.user.uid));
    if (!profileSnap.exists()) {
      await signOut(auth);
      return toast("Usuario no configurado");
    }

    const profile = { id: profileSnap.id, ...profileSnap.data() };
    if (profile.role !== "barber" || profile.active === false) {
      await signOut(auth);
      return toast("Esta cuenta de barbero no está activa");
    }

    currentRole = "barber";
    currentBarber = profile;
    closeModal("barberLoginModal");
    hide("accessScreen");
    show("barberApp");
    subscribeBarber(profile.id);
  } catch (err) {
    console.error(err);
    toast("Usuario o PIN incorrectos");
  }
});

async function logout() {
  cleanupListeners();
  currentRole = null;
  currentBarber = null;
  booking = { serviceId: null, barberId: null };

  if (auth?.currentUser) {
    try { await signOut(auth); } catch {}
  }

  hide("adminApp");
  hide("barberApp");
  hide("clientApp");
  show("accessScreen");
}

async function enterClient() {
  cleanupListeners();

  try {
    if (auth.currentUser && !auth.currentUser.isAnonymous) {
      await signOut(auth);
    }
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }
    currentRole = "client";
    hide("accessScreen");
    show("clientApp");
    subscribeClient(auth.currentUser.uid);
  } catch (err) {
    console.error(err);
    toast("No se pudo abrir el módulo de citas");
  }
}

async function ensureSeedData() {
  const chairsSnap = await getDocs(collection(db, "chairs"));
  const servicesSnap = await getDocs(collection(db, "services"));

  const batch = writeBatch(db);
  let hasWrites = false;

  if (chairsSnap.empty) {
    for (let i = 1; i <= 4; i++) {
      batch.set(doc(db, "chairs", `puesto-${i}`), {
        name: `Puesto ${i}`,
        active: true,
        order: i,
        createdAt: serverTimestamp()
      });
      hasWrites = true;
    }
  }

  if (servicesSnap.empty) {
    const services = [
      ["corte-clasico","Corte clásico",12,30],
      ["corte-barba","Corte + barba",18,45],
      ["barba-premium","Barba premium",10,30],
      ["corte-infantil","Corte infantil",10,30]
    ];
    services.forEach(([id,name,price,duration], idx) => {
      batch.set(doc(db, "services", id), {
        name, price, duration,
        active: true,
        order: idx + 1,
        createdAt: serverTimestamp()
      });
    });
    hasWrites = true;
  }

  if (hasWrites) await batch.commit();
}

function subscribeAdmin() {
  cleanupListeners();

  unsubscribers.push(onSnapshot(collection(db, "chairs"), snap => {
    state.chairs = snap.docs.map(d => ({ id:d.id, ...d.data() }))
      .sort((a,b) => (a.order || 999) - (b.order || 999));
    renderAdminAll();
  }));

  unsubscribers.push(onSnapshot(
    query(collection(db, "users"), where("role","==","barber")),
    snap => {
      state.barbers = snap.docs.map(d => ({ id:d.id, ...d.data() }))
        .sort((a,b) => a.name.localeCompare(b.name));
      renderAdminAll();
    }
  ));

  unsubscribers.push(onSnapshot(collection(db, "services"), snap => {
    state.services = snap.docs.map(d => ({ id:d.id, ...d.data() }))
      .sort((a,b) => (a.order || 999) - (b.order || 999));
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
    if (currentBarber.active === false) {
      toast("Tu cuenta fue desactivada");
      logout();
      return;
    }
    renderBarberPortal();
  }));

  unsubscribers.push(onSnapshot(
    query(collection(db, "sales"), where("barberId","==",uid)),
    snap => {
      state.sales = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      renderBarberPortal();
    }
  ));

  unsubscribers.push(onSnapshot(
    query(collection(db, "appointments"), where("barberId","==",uid)),
    snap => {
      state.appointments = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      renderBarberPortal();
    }
  ));
}

function subscribeClient(uid) {
  cleanupListeners();

  unsubscribers.push(onSnapshot(collection(db, "publicBarbers"), snap => {
    state.barbers = snap.docs
      .map(d => ({ id:d.id, ...d.data() }))
      .filter(b => b.active !== false)
      .sort((a,b) => a.name.localeCompare(b.name));
    renderClientBookingOptions();
  }));

  unsubscribers.push(onSnapshot(collection(db, "services"), snap => {
    state.services = snap.docs
      .map(d => ({ id:d.id, ...d.data() }))
      .filter(s => s.active !== false)
      .sort((a,b) => (a.order || 999) - (b.order || 999));
    renderClientBookingOptions();
  }));

  unsubscribers.push(onSnapshot(
    query(collection(db, "appointments"), where("ownerUid","==",uid)),
    snap => {
      state.clientAppointments = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      lookupClientAppointments();
      renderAvailableTimes();
    }
  ));

  unsubscribers.push(onSnapshot(
    query(collection(db, "bookedSlots"), where("date", ">=", isoDay())),
    snap => {
      state.bookedSlots = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      renderAvailableTimes();
    }
  ));

  const min = isoDay();
  $("clientDate").min = min;
  if (!$("clientDate").value) $("clientDate").value = min;
  renderClientBookingOptions();
}

$("adminMenuBtn").addEventListener("click", () =>
  $("adminSidebar").classList.toggle("open")
);

document.querySelectorAll(".nav-item").forEach(btn =>
  btn.addEventListener("click", () => switchAdminView(btn.dataset.view))
);

document.querySelectorAll("[data-go]").forEach(btn =>
  btn.addEventListener("click", () => switchAdminView(btn.dataset.go))
);

function switchAdminView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(v => v.classList.remove("active"));
  $(`view-${name}`).classList.add("active");
  const nav = document.querySelector(`[data-view="${name}"]`);
  if (nav) nav.classList.add("active");

  const titles = {
    dashboard:"Dashboard",
    sales:"Cobros",
    appointments:"Citas",
    barbers:"Barberos",
    chairs:"Puestos",
    services:"Servicios",
    reports:"Reportes"
  };

  $("adminPageTitle").textContent = titles[name] || "Dashboard";
  $("adminSidebar").classList.remove("open");
}

function daySales() {
  return state.sales.filter(s => todayIso(s.date));
}

function dayAppointments() {
  return state.appointments.filter(a => a.date === isoDay());
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
  const activeBarbers = state.barbers.filter(b => b.active !== false);
  const activeChairs = state.chairs.filter(c => c.active !== false);
  const activeServices = state.services.filter(s => s.active !== false);

  $("saleBarber").innerHTML = activeBarbers.length
    ? activeBarbers.map(b => `<option value="${b.id}">${escapeHtml(b.name)} · ${b.commission || 50}%</option>`).join("")
    : `<option value="">Agrega un barbero primero</option>`;

  $("saleChair").innerHTML = activeChairs.length
    ? activeChairs.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")
    : `<option value="">Agrega un puesto primero</option>`;

  $("saleService").innerHTML = activeServices.length
    ? activeServices.map(s => `<option value="${s.id}">${escapeHtml(s.name)} · ${money(s.price)}</option>`).join("")
    : `<option value="">Agrega un servicio primero</option>`;

  syncSalePrice();
}

$("saleService").addEventListener("change", syncSalePrice);

function syncSalePrice() {
  const service = state.services.find(s => s.id === $("saleService").value);
  if (service) $("salePrice").value = Number(service.price).toFixed(2);
}

function renderDashboard() {
  const ds = daySales();
  const da = dayAppointments();
  const total = ds.reduce((a,s) => a + Number(s.total || 0), 0);
  const barber = ds.reduce((a,s) => a + Number(s.barberAmount || 0), 0);
  const shop = ds.reduce((a,s) => a + Number(s.shopAmount || 0), 0);

  $("statSales").textContent = money(total);
  $("statBarbers").textContent = money(barber);
  $("statShop").textContent = money(shop);
  $("statSalesCount").textContent = `${ds.length} servicio${ds.length === 1 ? "" : "s"}`;
  $("statAppointments").textContent = da.length;
  $("statAppointmentsMeta").textContent = `${da.filter(a => a.status === "pending").length} pendientes`;

  const recent = [...state.sales]
    .sort((a,b) => jsDate(b.date) - jsDate(a.date))
    .slice(0,6);

  $("recentSales").innerHTML = recent.length
    ? recent.map(s => `<div class="list-row">
        <div>
          <div class="item-title">${escapeHtml(s.serviceName)}</div>
          <div class="item-meta">${escapeHtml(s.barberName)} · ${fmtDateTime(s.date)}</div>
        </div>
        <div class="amount">${money(s.total)}</div>
      </div>`).join("")
    : `<div class="empty">Aún no hay cobros.</div>`;

  const upcoming = state.appointments
    .filter(a => !["cancelled","completed"].includes(a.status) && a.date >= isoDay())
    .sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time))
    .slice(0,6);

  $("upcomingAppointments").innerHTML = upcoming.length
    ? upcoming.map(a => `<div class="list-row">
        <div>
          <div class="item-title">${escapeHtml(a.clientName)} · ${escapeHtml(a.serviceName)}</div>
          <div class="item-meta">${fmtDateOnly(a.date)} ${a.time} · ${escapeHtml(a.barberName)}</div>
        </div>
        <span class="status ${a.status}">${statusLabel(a.status)}</span>
      </div>`).join("")
    : `<div class="empty">No hay próximas citas.</div>`;
}

function renderSales() {
  const rows = [...state.sales].sort((a,b) => jsDate(b.date) - jsDate(a.date));

  $("salesTable").innerHTML = rows.length
    ? rows.map(s => `<tr>
        <td>${fmtDateTime(s.date)}</td>
        <td>${escapeHtml(s.barberName)}</td>
        <td>${escapeHtml(s.chairName)}</td>
        <td>${escapeHtml(s.serviceName)}</td>
        <td>${escapeHtml(s.payment)}</td>
        <td><b>${money(s.total)}</b></td>
        <td>${money(s.barberAmount)}</td>
        <td>${money(s.shopAmount)}</td>
      </tr>`).join("")
    : `<tr><td colspan="8" class="empty">No hay cobros registrados.</td></tr>`;
}

$("saleForm").addEventListener("submit", async e => {
  e.preventDefault();

  const barber = state.barbers.find(b => b.id === $("saleBarber").value);
  const chair = state.chairs.find(c => c.id === $("saleChair").value);
  const service = state.services.find(s => s.id === $("saleService").value);
  const total = Number($("salePrice").value);

  if (!barber || !chair || !service || !(total > 0)) {
    return toast("Revisa los datos del cobro");
  }

  try {
    const commission = Number(barber.commission ?? 50);
    const barberAmount = +(total * commission / 100).toFixed(2);
    const saleRef = doc(collection(db, "sales"));

    await setDoc(saleRef, {
      date: serverTimestamp(),
      barberId: barber.id,
      barberName: barber.name,
      chairId: chair.id,
      chairName: chair.name,
      serviceId: service.id,
      serviceName: service.name,
      payment: $("salePayment").value,
      total,
      commission,
      barberAmount,
      shopAmount: +(total - barberAmount).toFixed(2),
      note: $("saleNote").value.trim(),
      createdBy: auth.currentUser.uid
    });

    closeModal("saleModal");
    e.target.reset();
    toast(`Cobro registrado · Barbero ${money(barberAmount)}`);
  } catch (err) {
    console.error(err);
    toast("No se pudo registrar el cobro");
  }
});

["quickSaleBtn","heroSaleBtn","newSaleBtn"].forEach(id =>
  $(id).addEventListener("click", () => openModal("saleModal"))
);

function renderAppointments() {
  const filter = $("appointmentFilter").value;
  let arr = [...state.appointments].sort((a,b) =>
    (a.date+a.time).localeCompare(b.date+b.time)
  );
  if (filter !== "all") arr = arr.filter(a => a.status === filter);

  $("appointmentCards").innerHTML = arr.length
    ? arr.map(a => `<article class="appointment-card">
        <div class="appointment-top">
          <div>
            <span class="status ${a.status}">${statusLabel(a.status)}</span>
            <h3>${escapeHtml(a.clientName)}</h3>
            <div class="card-meta">${escapeHtml(a.clientPhone)} · ${escapeHtml(a.serviceName)}</div>
          </div>
          <div class="appt-time">${a.time}</div>
        </div>
        <div class="card-meta" style="margin-top:12px">
          ${fmtDateOnly(a.date)} · ${escapeHtml(a.barberName)} · ${money(a.servicePrice)}
        </div>
        ${a.note ? `<div class="credential">Nota: ${escapeHtml(a.note)}</div>` : ""}
        <div class="appt-actions">
          ${a.status === "pending" ? `<button class="tiny-btn" data-appt="${a.id}" data-status="confirmed">Confirmar</button>` : ""}
          ${a.status === "confirmed" ? `<button class="tiny-btn" data-appt="${a.id}" data-status="completed">Completar</button>` : ""}
          ${!["completed","cancelled"].includes(a.status) ? `<button class="tiny-btn" data-appt="${a.id}" data-status="cancelled">Cancelar</button>` : ""}
        </div>
      </article>`).join("")
    : `<div class="empty">No hay citas en esta categoría.</div>`;

  document.querySelectorAll("[data-appt][data-status]").forEach(btn =>
    btn.addEventListener("click", () =>
      changeAppointment(btn.dataset.appt, btn.dataset.status)
    )
  );
}

$("appointmentFilter").addEventListener("change", renderAppointments);

async function changeAppointment(id, status) {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "appointments", id), {
      status,
      updatedAt: serverTimestamp()
    });
    batch.update(doc(db, "bookedSlots", id), {
      status,
      updatedAt: serverTimestamp()
    });
    await batch.commit();
    toast(`Cita ${statusLabel(status).toLowerCase()}`);
  } catch (err) {
    console.error(err);
    toast("No se pudo actualizar la cita");
  }
}

function renderBarbers() {
  $("barberCards").innerHTML = state.barbers.length
    ? state.barbers.map(b => {
        const sales = state.sales.filter(s => s.barberId === b.id);
        const gross = sales.reduce((a,s) => a + Number(s.total || 0), 0);
        const pay = sales.reduce((a,s) => a + Number(s.barberAmount || 0), 0);

        return `<article class="person-card">
          <span class="card-kicker">BARBERO</span>
          <h3>${escapeHtml(b.name)}</h3>
          <div class="card-meta">${b.active === false ? "Cuenta desactivada" : `Comisión ${b.commission || 50}%`}</div>
          <div class="credential">Usuario: <b>${escapeHtml(b.username)}</b> · PIN gestionado por Firebase Auth</div>
          <div class="card-numbers">
            <div class="mini-stat"><span>Ventas</span><strong>${money(gross)}</strong></div>
            <div class="mini-stat"><span>Comisión</span><strong>${money(pay)}</strong></div>
          </div>
          ${b.active !== false ? `<button class="danger-btn" data-disable-barber="${b.id}">Desactivar barbero</button>` : ""}
        </article>`;
      }).join("")
    : `<div class="empty">Aún no hay barberos. Crea el primero.</div>`;

  document.querySelectorAll("[data-disable-barber]").forEach(btn =>
    btn.addEventListener("click", () => deactivateBarber(btn.dataset.disableBarber))
  );
}

$("addBarberBtn").addEventListener("click", () => openModal("barberModal"));

$("barberForm").addEventListener("submit", async e => {
  e.preventDefault();

  const name = $("barberName").value.trim();
  const username = $("barberUsername").value.trim().toLowerCase();
  const pin = $("barberPin").value.trim();
  const commission = Number($("barberCommission").value);

  if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    return toast("Usuario: mínimo 3 caracteres, sin espacios");
  }
  if (!/^\d{6}$/.test(pin)) {
    return toast("El PIN debe tener exactamente 6 dígitos");
  }
  if (!(commission >= 0 && commission <= 100)) {
    return toast("La comisión debe estar entre 0 y 100%");
  }

  let secondaryApp = null;

  try {
    secondaryApp = initializeApp(
      firebaseConfig,
      `barberCreator-${Date.now()}`
    );
    const secondaryAuth = getAuth(secondaryApp);

    const result = await createUserWithEmailAndPassword(
      secondaryAuth,
      usernameToEmail(username),
      loginPasswordFromPin(pin)
    );

    const uid = result.user.uid;

    await setDoc(doc(db, "users", uid), {
      role: "barber",
      name,
      username,
      emailAlias: usernameToEmail(username),
      commission,
      active: true,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser.uid
    });

    await setDoc(doc(db, "publicBarbers", uid), {
      name,
      active: true,
      createdAt: serverTimestamp()
    });

    await signOut(secondaryAuth);
    await deleteApp(secondaryApp);
    secondaryApp = null;

    closeModal("barberModal");
    e.target.reset();
    $("barberCommission").value = 50;
    toast("Barbero y cuenta Firebase creados");
  } catch (err) {
    console.error(err);
    if (secondaryApp) {
      try { await deleteApp(secondaryApp); } catch {}
    }
    if (String(err?.code).includes("email-already-in-use")) {
      toast("Ese usuario ya existe");
    } else {
      toast("No se pudo crear el barbero");
    }
  }
});

async function deactivateBarber(uid) {
  try {
    await updateDoc(doc(db, "users", uid), {
      active: false,
      updatedAt: serverTimestamp()
    });
    await updateDoc(doc(db, "publicBarbers", uid), {
      active: false,
      updatedAt: serverTimestamp()
    });
    toast("Barbero desactivado");
  } catch (err) {
    console.error(err);
    toast("No se pudo desactivar");
  }
}

function renderChairs() {
  $("chairCards").innerHTML = state.chairs.length
    ? state.chairs.map((c,i) => `<article class="chair-card">
        <span class="card-kicker">PUESTO ${String(i+1).padStart(2,"0")}</span>
        <h3>${escapeHtml(c.name)}</h3>
        <div class="card-meta">${c.active === false ? "Inactivo" : "Activo y disponible"}</div>
        <div class="card-numbers">
          <div class="mini-stat"><span>Servicios</span><strong>${state.sales.filter(s => s.chairId === c.id).length}</strong></div>
          <div class="mini-stat"><span>Estado</span><strong>${c.active === false ? "Inactivo" : "Activo"}</strong></div>
        </div>
      </article>`).join("")
    : `<div class="empty">No hay puestos.</div>`;
}

$("addChairBtn").addEventListener("click", async () => {
  try {
    const next = state.chairs.length + 1;
    const ref = doc(collection(db, "chairs"));
    await setDoc(ref, {
      name: `Puesto ${next}`,
      active: true,
      order: next,
      createdAt: serverTimestamp()
    });
    toast(`Puesto ${next} agregado`);
  } catch (err) {
    console.error(err);
    toast("No se pudo agregar el puesto");
  }
});

function renderServices() {
  $("serviceCards").innerHTML = state.services.length
    ? state.services.map(s => `<article class="service-card">
        <span class="card-kicker">SERVICIO</span>
        <h3>${escapeHtml(s.name)}</h3>
        <div class="card-meta">${s.duration || 30} min aprox.</div>
        <div class="card-numbers">
          <div class="mini-stat"><span>Precio</span><strong>${money(s.price)}</strong></div>
          <div class="mini-stat"><span>Reservas</span><strong>${state.appointments.filter(a => a.serviceId === s.id).length}</strong></div>
        </div>
      </article>`).join("")
    : `<div class="empty">No hay servicios.</div>`;
}

$("addServiceBtn").addEventListener("click", () => openModal("serviceModal"));

$("serviceForm").addEventListener("submit", async e => {
  e.preventDefault();

  try {
    const ref = doc(collection(db, "services"));
    await setDoc(ref, {
      name: $("serviceName").value.trim(),
      price: Number($("servicePrice").value),
      duration: Number($("serviceDuration").value),
      active: true,
      order: state.services.length + 1,
      createdAt: serverTimestamp()
    });
    closeModal("serviceModal");
    e.target.reset();
    toast("Servicio agregado");
  } catch (err) {
    console.error(err);
    toast("No se pudo agregar el servicio");
  }
});

function renderReports() {
  const total = state.sales.reduce((a,s) => a + Number(s.total || 0), 0);
  const barbers = state.sales.reduce((a,s) => a + Number(s.barberAmount || 0), 0);
  const shop = state.sales.reduce((a,s) => a + Number(s.shopAmount || 0), 0);

  $("reportTotal").textContent = money(total);
  $("reportBarbers").textContent = money(barbers);
  $("reportShop").textContent = money(shop);
  $("reportCount").textContent = state.sales.length;

  $("reportByBarber").innerHTML = state.barbers.length
    ? state.barbers.map(b => {
        const ss = state.sales.filter(s => s.barberId === b.id);
        const gross = ss.reduce((a,s) => a + Number(s.total || 0), 0);
        const pay = ss.reduce((a,s) => a + Number(s.barberAmount || 0), 0);

        return `<div class="list-row">
          <div>
            <div class="item-title">${escapeHtml(b.name)}</div>
            <div class="item-meta">${ss.length} servicios · comisión ${b.commission || 50}%</div>
          </div>
          <div class="amount">${money(pay)} <span class="item-meta">de ${money(gross)}</span></div>
        </div>`;
      }).join("")
    : `<div class="empty">No hay barberos.</div>`;
}

$("exportBtn").addEventListener("click", () => {
  const header = ["Fecha","Barbero","Puesto","Servicio","Metodo","Total","Comision","Pago Barbero","Ingreso Barberia"];
  const rows = state.sales.map(s => [
    jsDate(s.date).toLocaleString("es-PA"),
    s.barberName,
    s.chairName,
    s.serviceName,
    s.payment,
    s.total,
    s.commission,
    s.barberAmount,
    s.shopAmount
  ]);

  const csv = [header,...rows]
    .map(r => r.map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Los_Magicos_Reporte.csv";
  a.click();
  URL.revokeObjectURL(url);
});

function renderBarberPortal() {
  if (currentRole !== "barber" || !currentBarber) return;

  $("barberWelcomeName").textContent = currentBarber.name.split(" ")[0];
  $("myCommission").textContent = `${currentBarber.commission || 50}%`;

  const mine = state.sales.filter(s => s.barberId === currentBarber.id);
  const today = mine.filter(s => todayIso(s.date));
  const todayGross = today.reduce((a,s) => a + Number(s.total || 0), 0);
  const todayPay = today.reduce((a,s) => a + Number(s.barberAmount || 0), 0);
  const allPay = mine.reduce((a,s) => a + Number(s.barberAmount || 0), 0);

  $("myTodayGross").textContent = money(todayGross);
  $("myTodayPay").textContent = money(todayPay);
  $("myAllPay").textContent = money(allPay);
  $("myTodayCount").textContent = `${today.length} servicios`;

  const appts = state.appointments
    .filter(a => !["cancelled","completed"].includes(a.status) && a.date >= isoDay())
    .sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time));

  $("myTodayAppointments").textContent = appts.filter(a => a.date === isoDay()).length;

  $("myAppointments").innerHTML = appts.length
    ? appts.map(a => `<div class="list-row">
        <div>
          <div class="item-title">${escapeHtml(a.clientName)} · ${escapeHtml(a.serviceName)}</div>
          <div class="item-meta">${fmtDateOnly(a.date)} ${a.time} · ${escapeHtml(a.clientPhone)}</div>
        </div>
        <div>
          <span class="status ${a.status}">${statusLabel(a.status)}</span>
          ${a.status === "pending" ? `<button class="tiny-btn barber-appt-btn" data-barber-appt="${a.id}" data-status="confirmed">Confirmar</button>` : ""}
          ${a.status === "confirmed" ? `<button class="tiny-btn barber-appt-btn" data-barber-appt="${a.id}" data-status="completed">Completar</button>` : ""}
        </div>
      </div>`).join("")
    : `<div class="empty">No tienes citas próximas.</div>`;

  document.querySelectorAll(".barber-appt-btn").forEach(btn =>
    btn.addEventListener("click", () =>
      changeAppointment(btn.dataset.barberAppt, btn.dataset.status)
    )
  );

  const recent = [...mine]
    .sort((a,b) => jsDate(b.date) - jsDate(a.date))
    .slice(0,8);

  $("mySales").innerHTML = recent.length
    ? recent.map(s => `<div class="list-row">
        <div>
          <div class="item-title">${escapeHtml(s.serviceName)}</div>
          <div class="item-meta">${fmtDateTime(s.date)} · Venta ${money(s.total)}</div>
        </div>
        <div class="amount">${money(s.barberAmount)}</div>
      </div>`).join("")
    : `<div class="empty">Aún no tienes servicios registrados.</div>`;
}

function renderClientBookingOptions() {
  if (currentRole !== "client") return;

  $("clientServiceOptions").innerHTML = state.services.length
    ? state.services.map(s => `<button type="button" class="choice service-choice ${booking.serviceId === s.id ? "selected" : ""}" data-service="${s.id}">
        <strong>${escapeHtml(s.name)}</strong>
        <small>${money(s.price)} · ${s.duration || 30} min</small>
      </button>`).join("")
    : `<div class="empty">No hay servicios disponibles.</div>`;

  $("clientBarberOptions").innerHTML = state.barbers.length
    ? state.barbers.map(b => `<button type="button" class="choice barber-choice ${booking.barberId === b.id ? "selected" : ""}" data-barber="${b.id}">
        <strong>${escapeHtml(b.name)}</strong>
        <small>Barbero disponible</small>
      </button>`).join("")
    : `<div class="empty">No hay barberos disponibles.</div>`;

  document.querySelectorAll(".service-choice").forEach(btn =>
    btn.addEventListener("click", () => {
      booking.serviceId = btn.dataset.service;
      renderClientBookingOptions();
    })
  );

  document.querySelectorAll(".barber-choice").forEach(btn =>
    btn.addEventListener("click", () => {
      booking.barberId = btn.dataset.barber;
      renderClientBookingOptions();
      renderAvailableTimes();
    })
  );

  renderAvailableTimes();
}

$("clientDate").addEventListener("change", renderAvailableTimes);

function renderAvailableTimes() {
  if (currentRole !== "client") return;

  const select = $("clientTime");
  const day = $("clientDate").value;
  const barberId = booking.barberId;

  if (!day || !barberId) {
    select.innerHTML = `<option value="">Selecciona fecha y barbero</option>`;
    return;
  }

  const occupied = new Set(
    state.bookedSlots
      .filter(s => s.date === day && s.barberId === barberId && s.status !== "cancelled")
      .map(s => s.time)
  );

  // Availability is public only at slot level (barber/date/time/status).
  // Client names and phone numbers remain protected inside appointments.
  const slots = [];
  for (let h = 9; h < 19; h++) {
    for (const m of [0,30]) {
      const time = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
      if (!occupied.has(time)) slots.push(time);
    }
  }

  select.innerHTML = slots.length
    ? `<option value="">Selecciona una hora</option>` +
      slots.map(t => `<option value="${t}">${t}</option>`).join("")
    : `<option value="">Sin horarios disponibles</option>`;
}

function slotDocumentId(barberId, day, time) {
  return `${barberId}_${day}_${time.replace(":","")}`;
}

$("clientBookingForm").addEventListener("submit", async e => {
  e.preventDefault();

  if (!auth?.currentUser?.isAnonymous) {
    return toast("Vuelve a abrir el módulo Cliente");
  }

  const service = state.services.find(s => s.id === booking.serviceId);
  const barber = state.barbers.find(b => b.id === booking.barberId);
  const day = $("clientDate").value;
  const time = $("clientTime").value;

  if (!service) return toast("Selecciona un servicio");
  if (!barber) return toast("Selecciona un barbero");
  if (!day || !time) return toast("Selecciona fecha y hora");

  const slotId = slotDocumentId(barber.id, day, time);
  const appointmentRef = doc(db, "appointments", slotId);
  const slotRef = doc(db, "bookedSlots", slotId);

  try {
    const existing = await getDoc(slotRef);
    if (existing.exists() && existing.data().status !== "cancelled") {
      renderAvailableTimes();
      return toast("Ese horario ya fue reservado");
    }

    const batch = writeBatch(db);

    batch.set(slotRef, {
      slotId,
      barberId: barber.id,
      date: day,
      time,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    batch.set(appointmentRef, {
      slotId,
      ownerUid: auth.currentUser.uid,
      clientName: $("clientName").value.trim(),
      clientPhone: $("clientPhone").value.trim(),
      serviceId: service.id,
      serviceName: service.name,
      servicePrice: Number(service.price),
      barberId: barber.id,
      barberName: barber.name,
      date: day,
      time,
      note: $("clientNote").value.trim(),
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    await batch.commit();

    $("lookupPhone").value = $("clientPhone").value.trim();
    e.target.reset();
    booking = { serviceId:null, barberId:null };
    $("clientDate").value = isoDay();
    renderClientBookingOptions();
    toast("¡Cita reservada! Pendiente de confirmación.");
  } catch (err) {
    console.error(err);
    if (String(err?.code).includes("permission-denied")) {
      toast("Ese horario ya no está disponible");
    } else {
      toast("No se pudo reservar la cita");
    }
  }
});

$("lookupBtn").addEventListener("click", lookupClientAppointments);

function lookupClientAppointments() {
  if (currentRole !== "client") return;

  const phone = $("lookupPhone").value.trim();
  const arr = [...state.clientAppointments]
    .filter(a => !phone || a.clientPhone === phone)
    .sort((a,b) => (b.date+b.time).localeCompare(a.date+a.time));

  $("clientAppointments").innerHTML = arr.length
    ? arr.map(a => `<div class="client-appt">
        <strong>${fmtDateOnly(a.date)} · ${a.time}</strong>
        <small>${escapeHtml(a.serviceName)} con ${escapeHtml(a.barberName)} · ${statusLabel(a.status)}</small>
      </div>`).join("")
    : `<div class="empty">${phone ? "No encontramos citas de este dispositivo con ese teléfono." : "Aún no tienes citas."}</div>`;
}

$("adminBookBtn").addEventListener("click", () =>
  toast("Las citas se crean desde el módulo Cliente")
);

$("todayLabel").textContent = new Date().toLocaleDateString("es-PA", {
  weekday:"long",
  day:"2-digit",
  month:"long"
});

if (!firebaseReady) {
  const notice = document.createElement("div");
  notice.style.cssText = "margin:0 auto 20px;max-width:1120px;padding:12px 16px;border:1px solid rgba(215,173,86,.35);border-radius:14px;background:rgba(215,173,86,.08);color:#f1d28c;font-size:12px";
  notice.innerHTML = "<b>Firebase pendiente:</b> completa <code>public/firebase-config.js</code> con la configuración de tu Web App.";
  const shell = document.querySelector(".access-shell");
  if (shell) shell.prepend(notice);
}

// Preserve session for admin/barber after refresh.
if (firebaseReady) {
  onAuthStateChanged(auth, async user => {
    if (!user || currentRole) return;
    if (user.isAnonymous) return;

    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists()) return;
      const profile = { id:snap.id, ...snap.data() };

      if (profile.role === "admin") {
        currentRole = "admin";
        hide("accessScreen");
        show("adminApp");
        await ensureSeedData();
        subscribeAdmin();
      } else if (profile.role === "barber" && profile.active !== false) {
        currentRole = "barber";
        currentBarber = profile;
        hide("accessScreen");
        show("barberApp");
        subscribeBarber(profile.id);
      }
    } catch (err) {
      console.error(err);
    }
  });
}
