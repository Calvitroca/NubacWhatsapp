// ===== Auth + API config =====
const API_BASE = localStorage.getItem("API_BASE") || ""; // ej: https://app-xxxxx-uc.a.run.app

const firebaseConfig = {
    apiKey: "AIzaSyD2ZNznq-2l9hMahVzyT9XwOI2hZjzz7gU",
    authDomain: "nubacwhatsapp.firebaseapp.com",
    projectId: "nubacwhatsapp",
    storageBucket: "nubacwhatsapp.firebasestorage.app",
    messagingSenderId: "378836642199",
    appId: "1:378836642199:web:34241484eb04c75137fcd2",
    measurementId: "G-5096DDYHL2"
  };

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const dbFS = firebase.firestore(); // 👈 PÉGALO AQUÍ
const provider = new firebase.auth.GoogleAuthProvider();

async function fsListContacts() {
  const snap = await contactsRef().orderBy("createdAt", "desc").get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function contactsRef() {
  const u = auth.currentUser;
  if (!u) throw new Error("No hay usuario logueado");
  return dbFS.collection("users").doc(u.uid).collection("contacts");
}


async function fsCreateContact(data) {
  const payload = {
    name: data.name,
    phone: data.phone,
    tags: data.tags || [],
    status: data.status || "active",
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  const ref = await contactsRef().add(payload);
  return ref.id;
}

async function fsUpdateContact(id, patch) {
  await contactsRef().doc(id).set({
    ...patch,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function fsDeleteContact(id) {
  await contactsRef().doc(id).delete();
}

let currentIdToken = null;

async function getIdToken() {
  const u = auth.currentUser;
  if (!u) return null;
  currentIdToken = await u.getIdToken(false);
  return currentIdToken;
}

function setAuthUI(user) {
  const st = document.getElementById("authStatus");
  const btnLogin = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");
  if (!st || !btnLogin || !btnLogout) return;

  if (user) {
    st.textContent = `Sesión: ${user.displayName || user.email}`;
    btnLogin.style.display = "none";
    btnLogout.style.display = "inline-flex";
  } else {
    st.textContent = "Sesión: (no iniciada)";
    btnLogin.style.display = "inline-flex";
    btnLogout.style.display = "none";
  }
}

document.getElementById("btnLogin")?.addEventListener("click", async () => {
  await auth.signInWithPopup(provider);
});

document.getElementById("btnLogout")?.addEventListener("click", async () => {
  await auth.signOut();
});

auth.onAuthStateChanged(async (user) => {
  setAuthUI(user);
  await getIdToken();
  render(); // re-render cuando cambia sesión
});

function requireLoginOrShowGate() {
  if (auth.currentUser) return true;

  viewRoot.innerHTML = `
    <div class="card">
      <div style="font-weight:900">Inicia sesión para continuar</div>
      <div class="muted">Este sistema usa Google Auth. El backend valida tu token.</div>
      <hr />
      <button class="btn ok" id="btnGateLogin">Entrar con Google</button>
    </div>
  `;
  document.getElementById("btnGateLogin")?.addEventListener("click", async () => {
    await auth.signInWithPopup(provider);
  });

  return false;
}
/* WhatsApp Sender — Demo SPA (LocalStorage) */

const DB_KEY = "wa_sender_db_v1";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const modal = $("#modal");
const modalTitle = $("#modalTitle");
const modalBody = $("#modalBody");
const modalActions = $("#modalActions");

const viewRoot = $("#viewRoot");
const viewTitle = $("#viewTitle");
const viewSubtitle = $("#viewSubtitle");

const ROUTES = {
  dashboard: { title: "Dashboard", subtitle: "Resumen de envíos y actividad." },
  contacts: { title: "Contactos", subtitle: "Tu base de datos (demo LocalStorage)." },
  media: { title: "Media", subtitle: "Biblioteca de imágenes/videos (demo)." },
  campaigns: { title: "Campañas", subtitle: "Editor con gancho + detalle + rechazo + error." },
  calendar: { title: "Calendario", subtitle: "Programa campañas por fecha/hora." },
  history: { title: "Historial", subtitle: "Logs de envíos y respuestas simuladas." },
};

function nowISO() {
  return new Date().toISOString();
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
function apiUrl(path) {
  if (!API_BASE) throw new Error("API_BASE no configurado (localStorage)");
  return API_BASE.replace(/\/$/, "") + path;
}

async function apiFetch(path, opts = {}) {
  const token = await getIdToken();
  if (!token) throw new Error("No hay sesión (token null)");

  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
    Authorization: `Bearer ${token}`,
  };

  const res = await fetch(apiUrl(path), { ...opts, headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const msg = (data && data.error) ? data.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/* ---------------- DB ---------------- */

function loadDB() {
  const raw = localStorage.getItem(DB_KEY);
  if (raw) return JSON.parse(raw);

  return {
    meta: { createdAt: nowISO(), seeded: false },
    contacts: [],
    media: [],
    campaigns: [],
    schedules: [],
    userStates: [], // {phone, activeCampaignId, state, invalidCount, updatedAt}
    logs: [],       // {id, ts, type, campaignId, phone, messageType, inboundBody, result}
  };
}

function saveDB(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function getDB() {
  return loadDB();
}

function setDB(mutator) {
  const db = loadDB();
  mutator(db);
  saveDB(db);
  return db;
}

function resetDB() {
  localStorage.removeItem(DB_KEY);
}

/* ---------------- Demo seed ---------------- */

function seedDemo(force = false) {
  const db = getDB();
  if (db.meta.seeded && !force) return;

  const tagsPool = [
    ["distribuidores", "felicat"],
    ["clientes", "grateful"],
    ["colaboradores", "nubac"],
    ["clientes", "shaggy"],
    ["distribuidores", "shaggy"],
    ["clientes", "felicat"],
  ];

  const contacts = Array.from({ length: 12 }).map((_, i) => ({
    id: uid("ct"),
    name: `Asistente ${i + 1}`,
    phone: `+5213312345${String(10 + i)}`,
    tags: tagsPool[i % tagsPool.length],
    status: "active",
    createdAt: nowISO(),
  }));

  const media = [
    { id: uid("m"), type: "image", name: "Promo-1.jpg", url: "demo://promo-1", createdAt: nowISO() },
    { id: uid("m"), type: "image", name: "Promo-2.jpg", url: "demo://promo-2", createdAt: nowISO() },
    { id: uid("m"), type: "video", name: "Clip-1.mp4", url: "demo://clip-1", createdAt: nowISO() },
    { id: uid("m"), type: "image", name: "Logo.png", url: "demo://logo", createdAt: nowISO() },
    { id: uid("m"), type: "video", name: "Story.mp4", url: "demo://story", createdAt: nowISO() },
  ];

  const campaigns = [
    {
      id: uid("cmp"),
      title: "Promo Auditorio — Beneficio",
      teaserText: "🎁 Beneficio exclusivo para asistentes.\n¿Quieres los detalles? Responde 1 (sí) o 2 (no).",
      teaserMediaId: media[0].id,
      detailText: "Perfecto 🙌\nDetalles: 2x1 en registro + acceso preferente.\nResponde 'OK' si lo quieres aplicar.",
      detailMediaId: media[1].id,
      rejectText: "Listo 👍 Gracias por responder. No te enviamos más info de esta promo.",
      errorText: "No te entendí 😅 Responde 1 para detalles o 2 para no recibirlos.",
      createdAt: nowISO(),
    },
    {
      id: uid("cmp"),
      title: "NUBAC — Info Distribuidores",
      teaserText: "📦 Info rápida para distribuidores.\n¿Quieres requisitos y contacto? 1 (sí) / 2 (no).",
      teaserMediaId: null,
      detailText: "Requisitos: compra mínima + datos de ubicación.\nComparte: nombre + ciudad + correo.",
      detailMediaId: null,
      rejectText: "Va 👍 Si luego te interesa, aquí andamos.",
      errorText: "Para esta dinámica responde 1 o 2 🙏",
      createdAt: nowISO(),
    },
    {
      id: uid("cmp"),
      title: "Pilotea — Promo Febrero (demo)",
      teaserText: "🚗 Conductores Uber/Didi: promo activa.\n¿Quieres detalles? 1 / 2",
      teaserMediaId: media[3].id,
      detailText: "Detalles: pago inicial dividido en 2.\nVálido hasta 15 feb.\nResponde 'Quiero' y te contactamos.",
      detailMediaId: media[2].id,
      rejectText: "Perfecto 👍 Gracias por tu respuesta.",
      errorText: "Responde 1 o 2 para continuar 🙂",
      createdAt: nowISO(),
    },
  ];

  setDB((db2) => {
    db2.meta.seeded = true;
    db2.contacts = contacts;
    db2.media = media;
    db2.campaigns = campaigns;
    db2.schedules = [];
    db2.userStates = [];
    db2.logs = [];
  });
}

/* ---------------- State machine helpers ---------------- */

function getUserState(db, phone) {
  return db.userStates.find((s) => s.phone === phone) || null;
}

function upsertUserState(db, phone, patch) {
  const idx = db.userStates.findIndex((s) => s.phone === phone);
  if (idx === -1) {
    db.userStates.push({
      phone,
      activeCampaignId: null,
      state: "IDLE",
      invalidCount: 0,
      updatedAt: nowISO(),
      ...patch,
    });
  } else {
    db.userStates[idx] = { ...db.userStates[idx], ...patch, updatedAt: nowISO() };
  }
}

function addLog(db, log) {
  db.logs.unshift({
    id: uid("log"),
    ts: nowISO(),
    ...log,
  });
}

function getCampaign(db, campaignId) {
  return db.campaigns.find((c) => c.id === campaignId) || null;
}

/* ---------------- UI: modal ---------------- */

function openModal(title, bodyHTML, actions = []) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHTML;
  modalActions.innerHTML = actions.map((a) => a.html).join("");
  modal.showModal();

  actions.forEach((a) => {
    const el = $(`[data-action="${a.key}"]`, modalActions);
    if (el) el.addEventListener("click", (e) => a.onClick(e));
  });
}

/* ---------------- Routing ---------------- */

let currentRoute = "dashboard";

function setActiveNav(route) {
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.route === route));
}

function navigate(route) {
  currentRoute = route;
  const meta = ROUTES[route] || ROUTES.dashboard;
  viewTitle.textContent = meta.title;
  viewSubtitle.textContent = meta.subtitle;
  setActiveNav(route);
  render();
}

function render() {
  if (!requireLoginOrShowGate()) return;

  const db = getDB();
  if (currentRoute === "dashboard") return renderDashboard(db);
  if (currentRoute === "contacts") return renderContacts(db); // puede ser async, ok
  if (currentRoute === "media") return renderMedia(db);
  if (currentRoute === "campaigns") return renderCampaigns(db);
  if (currentRoute === "calendar") return renderCalendar(db);
  if (currentRoute === "history") return renderHistory(db);
  renderDashboard(db);
}

async function renderContacts(db) {
  // 1) lee desde Firestore
  const contacts = await fsListContacts();

  // 2) pinta con el mismo HTML pero usando "contacts"
  const rows = contacts.map((c) => `
    <tr>
      <td><b>${escapeHTML(c.name)}</b><div class="tiny muted">${escapeHTML(c.phone)}</div></td>
      <td>${(c.tags || []).map((t) => `<span class="badge">${escapeHTML(t)}</span>`).join(" ")}</td>
      <td>${escapeHTML(c.status || "active")}</td>
      <td>
        <button class="btn ghost" data-edit="${c.id}">Editar</button>
        <button class="btn danger" data-del="${c.id}">Borrar</button>
      </td>
    </tr>
  `).join("");

  viewRoot.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <div class="row">
        <button class="btn" id="btnNewContact">Nuevo contacto</button>
        <button class="btn ghost" id="btnImportCSV">Importar CSV (demo)</button>
      </div>
      <div class="badge">${contacts.length} contactos</div>
    </div>
    <div style="height:12px"></div>
    <div class="card">
      <table class="table">
        <thead>
          <tr><th>Contacto</th><th>Tags</th><th>Estado</th><th>Acciones</th></tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="4">Sin contactos.</td></tr>`}</tbody>
      </table>
    </div>
  `;

  // botones
  $("#btnNewContact")?.addEventListener("click", () => openContactModal());
  $("#btnImportCSV")?.addEventListener("click", () => importCSVModal());

  $$("[data-edit]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.getAttribute("data-edit");
    // buscamos el contacto en la lista actual
    const c = contacts.find((x) => x.id === id);
    if (c) openContactModal(c);
  }));

  $$("[data-del]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.getAttribute("data-del");
    await contactsRef().doc(id).delete();
    render(); // refresca vista
  }));
}

/* ---------------- Views ---------------- */

function renderDashboard(db) {
  const totalContacts = db.contacts.length;
  const totalCampaigns = db.campaigns.length;
  const scheduled = db.schedules.filter((s) => s.status === "pending").length;
  const logs24h = db.logs.filter((l) => Date.now() - new Date(l.ts).getTime() < 24 * 3600 * 1000).length;

  viewRoot.innerHTML = `
    <div class="grid cols3">
      <div class="card">
        <div class="kpi">${totalContacts}</div>
        <div class="kpi-sub">Contactos</div>
        <hr />
        <span class="badge">Base de datos local</span>
      </div>
      <div class="card">
        <div class="kpi">${totalCampaigns}</div>
        <div class="kpi-sub">Campañas</div>
        <hr />
        <span class="badge">Gancho + Detalle + No + Error</span>
      </div>
      <div class="card">
        <div class="kpi">${scheduled}</div>
        <div class="kpi-sub">Programadas</div>
        <hr />
        <span class="badge">Scheduler demo</span>
      </div>
    </div>

    <div style="height:14px"></div>

    <div class="grid cols2">
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <div>
            <div style="font-weight:800">Actividad (últimas 24h)</div>
            <div class="muted">Eventos simulados en Historial</div>
          </div>
          <div class="badge"><b>${logs24h}</b> logs</div>
        </div>
        <hr />
        <div class="muted">Tip: crea una campaña, envíala a un segmento y mira cómo se registran respuestas 1/2/errores.</div>
      </div>

      <div class="card">
        <div style="font-weight:800">Atajo: Enviar una campaña ya</div>
        <div class="muted">Simulador de envío masivo (cola/rate limit conceptual)</div>
        <hr />
        ${quickSendUI(db)}
      </div>
    </div>
  `;

  $("#qsSend")?.addEventListener("click", () => quickSendAction());
}

function quickSendUI(db) {
  const cmpOptions = db.campaigns.map((c) => `<option value="${c.id}">${escapeHTML(c.title)}</option>`).join("");
  const tags = getAllTags(db);
  const tagOptions = tags.map((t) => `<option value="${t}">${escapeHTML(t)}</option>`).join("");
  return `
    <div class="grid">
      <div class="field">
        <label>Campaña</label>
        <select id="qsCampaign">${cmpOptions}</select>
      </div>
      <div class="field">
        <label>Segmento (tag)</label>
        <select id="qsTag">${tagOptions}</select>
      </div>
      <button class="btn ok" id="qsSend">Enviar ahora (simulación)</button>
      <div class="tiny muted">Esto crea logs y estados por usuario como si fuera Twilio real.</div>
    </div>
  `;
}
function openContactModalFS(contact = null) {
  const isEdit = !!contact;

  openModal(
    isEdit ? "Editar contacto" : "Nuevo contacto",
    `
      <div class="field">
        <label>Nombre</label>
        <input class="input" id="cName" value="${contact ? escapeAttr(contact.name) : ""}" />
      </div>
      <div class="field">
        <label>Teléfono WhatsApp (E.164)</label>
        <input class="input" id="cPhone" placeholder="+52133..." value="${contact ? escapeAttr(contact.phone) : ""}" />
      </div>
      <div class="field">
        <label>Tags (separados por coma)</label>
        <input class="input" id="cTags" placeholder="clientes,felicat" value="${contact ? escapeAttr((contact.tags || []).join(",")) : ""}" />
      </div>
      <div class="field">
        <label>Estado</label>
        <select id="cStatus">
          <option value="active">active</option>
          <option value="inactive">inactive</option>
        </select>
      </div>
    `,
    [
      { key: "cancel", html: `<button class="btn ghost" data-action="cancel" value="cancel">Cancelar</button>`, onClick: () => modal.close() },
      { 
        key: "save",
        html: `<button class="btn ok" data-action="save" value="default">${isEdit ? "Guardar" : "Crear"}</button>`,
        onClick: async () => {
          const name = $("#cName").value.trim();
          const phone = $("#cPhone").value.trim();
          const tags = $("#cTags").value.split(",").map(t => t.trim()).filter(Boolean);
          const status = $("#cStatus").value;

          if (!name || !phone) return alert("Nombre y teléfono son obligatorios.");

          const payload = {
            name,
            phone,
            tags,
            status,
            createdAt: isEdit ? (contact.createdAt || nowISO()) : nowISO(),
            updatedAt: nowISO(),
          };

          try {
            if (isEdit) {
              await contactsRef().doc(contact.id).set(payload, { merge: true });
            } else {
              await contactsRef().add(payload);
            }

            modal.close();
            render();
          } catch (err) {
            console.error(err);
            alert("Error guardando en Firestore: " + (err.message || err));
          }
        }
      },
    ]
  );

  if (contact) $("#cStatus").value = contact.status || "active";
}

function importCSVModalFS() {
  openModal(
    "Importar CSV (demo)",
    `
      <div class="muted">Esto creará 5 contactos extra (Firestore).</div>
      <hr />
      <div class="tiny muted">Formato típico: name,phone,tags</div>
    `,
    [
      { key: "cancel", html: `<button class="btn ghost" data-action="cancel" value="cancel">Cerrar</button>`, onClick: () => modal.close() },
      { key: "do", html: `<button class="btn ok" data-action="do" value="default">Importar (simular)</button>`, onClick: async () => {
          for (let i=0;i<5;i++){
            await fsCreateContact({
              name: `Importado ${i+1}`,
              phone: `+5213311111${String(20+i)}`,
              tags: ["auditorio"],
              status: "active",
            });
          }
          modal.close();
          render();
        }
      },
    ]
  );
}

function renderMedia(db) {
  const cards = db.media.map((m) => `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div>
          <div style="font-weight:800">${escapeHTML(m.name)}</div>
          <div class="tiny muted">${escapeHTML(m.type)} · ${escapeHTML(m.url)}</div>
        </div>
        <span class="badge">${escapeHTML(m.type)}</span>
      </div>
      <hr />
      <div class="row" style="justify-content:flex-end">
        <button class="btn danger" data-del="${m.id}">Borrar</button>
      </div>
    </div>
  `).join("");

  viewRoot.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <div class="row">
        <button class="btn" id="btnNewMedia">Añadir media (demo)</button>
      </div>
      <div class="badge">${db.media.length} items</div>
    </div>
    <div style="height:12px"></div>
    <div class="grid cols2">${cards || `<div class="card">Sin media. Carga demo.</div>`}</div>
  `;

  $("#btnNewMedia")?.addEventListener("click", () => openMediaModal());
  $$("[data-del]").forEach((b) => b.addEventListener("click", () => {
    const id = b.getAttribute("data-del");
    setDB((db2) => { db2.media = db2.media.filter((x) => x.id !== id); });
    render();
  }));
}

function openMediaModal() {
  openModal(
    "Añadir media (demo)",
    `
      <div class="field">
        <label>Tipo</label>
        <select id="mType">
          <option value="image">image</option>
          <option value="video">video</option>
        </select>
      </div>
      <div class="field">
        <label>Nombre</label>
        <input class="input" id="mName" placeholder="Promo.jpg" />
      </div>
      <div class="field">
        <label>URL (demo)</label>
        <input class="input" id="mUrl" placeholder="demo://mi-archivo" />
      </div>
    `,
    [
      { key: "cancel", html: `<button class="btn ghost" data-action="cancel" value="cancel">Cancelar</button>`, onClick: () => modal.close() },
      { key: "save", html: `<button class="btn ok" data-action="save" value="default">Guardar</button>`, onClick: () => {
          const type = $("#mType").value;
          const name = $("#mName").value.trim();
          const url = $("#mUrl").value.trim();
          if (!name || !url) return alert("Nombre y URL son obligatorios.");
          setDB((db) => db.media.push({ id: uid("m"), type, name, url, createdAt: nowISO() }));
          modal.close();
          render();
        } 
      },
    ]
  );
}

function renderCampaigns(db) {
  const list = db.campaigns.map((c) => `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div>
          <div style="font-weight:900">${escapeHTML(c.title)}</div>
          <div class="tiny muted">ID: ${escapeHTML(c.id)}</div>
        </div>
        <div class="row">
          <button class="btn ghost" data-edit="${c.id}">Editar</button>
          <button class="btn danger" data-del="${c.id}">Borrar</button>
        </div>
      </div>
      <hr />
      <div class="grid cols2">
        <div>
          <div class="badge">Gancho</div>
          <div class="tiny muted" style="white-space:pre-wrap">${escapeHTML(c.teaserText).slice(0,220)}${c.teaserText.length>220?"…":""}</div>
        </div>
        <div>
          <div class="badge">Detalle (1)</div>
          <div class="tiny muted" style="white-space:pre-wrap">${escapeHTML(c.detailText).slice(0,220)}${c.detailText.length>220?"…":""}</div>
        </div>
      </div>
      <div style="height:10px"></div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn ok" data-send="${c.id}">Enviar ahora (sim)</button>
      </div>
    </div>
  `).join("");

  viewRoot.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <button class="btn" id="btnNewCampaign">Nueva campaña</button>
      <div class="badge">${db.campaigns.length} campañas</div>
    </div>
    <div style="height:12px"></div>
    <div class="grid">${list || `<div class="card">Sin campañas. Carga demo.</div>`}</div>
  `;

  $("#btnNewCampaign")?.addEventListener("click", () => openCampaignModal(null));

  $$("[data-edit]").forEach((b) => b.addEventListener("click", () => {
    const id = b.getAttribute("data-edit");
    const c = db.campaigns.find((x) => x.id === id);
    openCampaignModal(c);
  }));

  $$("[data-del]").forEach((b) => b.addEventListener("click", () => {
    const id = b.getAttribute("data-del");
    setDB((db2) => { db2.campaigns = db2.campaigns.filter((x) => x.id !== id); });
    render();
  }));

  $$("[data-send]").forEach((b) => b.addEventListener("click", () => {
    const id = b.getAttribute("data-send");
    openSendCampaignModal(id);
  }));
}

function openCampaignModal(campaign = null) {
  const isEdit = !!campaign;
  const db = getDB();
  const mediaOptions = [`<option value="">(sin media)</option>`].concat(
    db.media.map((m) => `<option value="${m.id}">${escapeHTML(m.type)} · ${escapeHTML(m.name)}</option>`)
  ).join("");

  openModal(
    isEdit ? "Editar campaña" : "Nueva campaña",
    `
      <div class="field">
        <label>Título</label>
        <input class="input" id="cmpTitle" value="${campaign ? escapeAttr(campaign.title) : ""}" placeholder="Promo Auditorio..." />
      </div>

      <div class="grid cols2">
        <div class="card" style="box-shadow:none; background:rgba(255,255,255,.02)">
          <div style="font-weight:800">Mensaje Gancho (broadcast)</div>
          <div class="tiny muted">Termina con “Responde 1 / 2”</div>
          <hr />
          <div class="field">
            <label>Texto</label>
            <textarea id="cmpTeaserText">${campaign ? escapeHTML(campaign.teaserText) : ""}</textarea>
          </div>
          <div class="field">
            <label>Media</label>
            <select id="cmpTeaserMedia">${mediaOptions}</select>
          </div>
        </div>

        <div class="card" style="box-shadow:none; background:rgba(255,255,255,.02)">
          <div style="font-weight:800">Mensaje Detallado (si = 1)</div>
          <hr />
          <div class="field">
            <label>Texto</label>
            <textarea id="cmpDetailText">${campaign ? escapeHTML(campaign.detailText) : ""}</textarea>
          </div>
          <div class="field">
            <label>Media</label>
            <select id="cmpDetailMedia">${mediaOptions}</select>
          </div>
        </div>
      </div>

      <div style="height:10px"></div>

      <div class="grid cols2">
        <div class="card" style="box-shadow:none; background:rgba(255,255,255,.02)">
          <div style="font-weight:800">Mensaje Rechazo (si = 2)</div>
          <hr />
          <div class="field">
            <label>Texto</label>
            <textarea id="cmpRejectText">${campaign ? escapeHTML(campaign.rejectText) : ""}</textarea>
          </div>
        </div>

        <div class="card" style="box-shadow:none; background:rgba(255,255,255,.02)">
          <div style="font-weight:800">Mensaje Error (inválido)</div>
          <div class="tiny muted">Para “si”, stickers, audio, etc.</div>
          <hr />
          <div class="field">
            <label>Texto</label>
            <textarea id="cmpErrorText">${campaign ? escapeHTML(campaign.errorText) : ""}</textarea>
          </div>
        </div>
      </div>
    `,
    [
      { key: "cancel", html: `<button class="btn ghost" data-action="cancel" value="cancel">Cancelar</button>`, onClick: () => modal.close() },
      { key: "save", html: `<button class="btn ok" data-action="save" value="default">${isEdit ? "Guardar" : "Crear"}</button>`, onClick: () => {
          const title = $("#cmpTitle").value.trim();
          const teaserText = $("#cmpTeaserText").value.trim();
          const teaserMediaId = $("#cmpTeaserMedia").value || null;

          const detailText = $("#cmpDetailText").value.trim();
          const detailMediaId = $("#cmpDetailMedia").value || null;

          const rejectText = $("#cmpRejectText").value.trim();
          const errorText = $("#cmpErrorText").value.trim();

          if (!title || !teaserText || !detailText || !rejectText || !errorText) {
            return alert("Completa todos los textos (gancho, detalle, rechazo, error).");
          }

          setDB((db2) => {
            if (isEdit) {
              const idx = db2.campaigns.findIndex((x) => x.id === campaign.id);
              db2.campaigns[idx] = {
                ...db2.campaigns[idx],
                title,
                teaserText,
                teaserMediaId,
                detailText,
                detailMediaId,
                rejectText,
                errorText
              };
            } else {
              db2.campaigns.push({
                id: uid("cmp"),
                title,
                teaserText,
                teaserMediaId,
                detailText,
                detailMediaId,
                rejectText,
                errorText,
                createdAt: nowISO()
              });
            }
          });

          modal.close();
          render();
        } 
      },
    ]
  );

  if (campaign) {
    $("#cmpTeaserMedia").value = campaign.teaserMediaId || "";
    $("#cmpDetailMedia").value = campaign.detailMediaId || "";
  }
}

function openSendCampaignModal(campaignId) {
  const db = getDB();
  const tags = getAllTags(db);
  const tagOptions = tags.map((t) => `<option value="${t}">${escapeHTML(t)}</option>`).join("");

  openModal(
    "Enviar campaña (simulación)",
    `
      <div class="muted">Selecciona un tag para segmentar. Se enviará el <b>gancho</b> a todos los contactos con ese tag y se creará estado WAITING_CHOICE por usuario.</div>
      <hr />
      <div class="field">
        <label>Segmento (tag)</label>
        <select id="sendTag">${tagOptions}</select>
      </div>
      <div class="tiny muted">Consejo: usa “auditorio”, “felicat”, “shaggy”, etc.</div>
    `,
    [
      { key: "cancel", html: `<button class="btn ghost" data-action="cancel" value="cancel">Cancelar</button>`, onClick: () => modal.close() },
      { key: "send", html: `<button class="btn ok" data-action="send" value="default">Enviar ahora</button>`, onClick: () => {
          const tag = $("#sendTag").value;
          simulateBroadcast(campaignId, tag);
          modal.close();
          navigate("history");
        } 
      },
    ]
  );
}

function renderCalendar(db) {
  const rows = db.schedules.map((s) => {
    const c = getCampaign(db, s.campaignId);
    return `
      <tr>
        <td><b>${escapeHTML(c ? c.title : s.campaignId)}</b><div class="tiny muted">${escapeHTML(s.id)}</div></td>
        <td>${escapeHTML(s.tag)}</td>
        <td>${escapeHTML(s.sendAt)}</td>
        <td>${escapeHTML(s.status)}</td>
        <td>
          <button class="btn ok" data-run="${s.id}">Run (sim)</button>
          <button class="btn danger" data-del="${s.id}">Borrar</button>
        </td>
      </tr>
    `;
  }).join("");

  const cmpOptions = db.campaigns.map((c) => `<option value="${c.id}">${escapeHTML(c.title)}</option>`).join("");
  const tags = getAllTags(db);
  const tagOptions = tags.map((t) => `<option value="${t}">${escapeHTML(t)}</option>`).join("");

  viewRoot.innerHTML = `
    <div class="grid cols2">
      <div class="card">
        <div style="font-weight:900">Programar campaña</div>
        <div class="tiny muted">Esto crea una fila pending. Puedes “Run” para simular el cron.</div>
        <hr />
        <div class="field">
          <label>Campaña</label>
          <select id="schCampaign">${cmpOptions}</select>
        </div>
        <div class="field">
          <label>Segmento (tag)</label>
          <select id="schTag">${tagOptions}</select>
        </div>
        <div class="field">
          <label>Fecha/Hora (texto libre)</label>
          <input class="input" id="schAt" placeholder="2026-02-01 12:30" />
        </div>
        <button class="btn ok" id="btnCreateSchedule">Crear programación</button>
      </div>

      <div class="card">
        <div style="font-weight:900">Cómo se vería en producción</div>
        <hr />
        <div class="muted">
          Un cron/worker revisa schedules pending y envía por cola (rate limit).
          Aquí lo simulamos manualmente con “Run”.
        </div>
      </div>
    </div>

    <div style="height:14px"></div>

    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div style="font-weight:900">Programaciones</div>
        <div class="badge">${db.schedules.length} total</div>
      </div>
      <hr />
      <table class="table">
        <thead><tr><th>Campaña</th><th>Tag</th><th>SendAt</th><th>Status</th><th>Acciones</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5">Sin programaciones.</td></tr>`}</tbody>
      </table>
    </div>
  `;

  $("#btnCreateSchedule")?.addEventListener("click", () => {
    const campaignId = $("#schCampaign").value;
    const tag = $("#schTag").value;
    const sendAt = $("#schAt").value.trim() || "(sin fecha)";

    setDB((db2) => {
      db2.schedules.push({
        id: uid("sch"),
        campaignId,
        tag,
        sendAt,
        status: "pending",
        createdAt: nowISO(),
      });
    });
    render();
  });

  $$("[data-del]").forEach((b) => b.addEventListener("click", () => {
    const id = b.getAttribute("data-del");
    setDB((db2) => { db2.schedules = db2.schedules.filter((x) => x.id !== id); });
    render();
  }));

  $$("[data-run]").forEach((b) => b.addEventListener("click", () => {
    const id = b.getAttribute("data-run");
    const db2 = getDB();
    const s = db2.schedules.find((x) => x.id === id);
    if (!s) return;
    simulateBroadcast(s.campaignId, s.tag);
    setDB((db3) => {
      const idx = db3.schedules.findIndex((x) => x.id === id);
      db3.schedules[idx].status = "sent";
    });
    navigate("history");
  }));
}

function renderHistory(db) {
  const rows = db.logs.slice(0, 200).map((l) => `
    <tr>
      <td>${escapeHTML(new Date(l.ts).toLocaleString())}</td>
      <td><span class="badge">${escapeHTML(l.type)}</span></td>
      <td class="tiny">${escapeHTML(l.phone || "-")}</td>
      <td class="tiny">${escapeHTML(l.campaignId || "-")}</td>
      <td class="tiny">${escapeHTML(l.messageType || l.inboundBody || "-")}</td>
      <td>${escapeHTML(l.result || "-")}</td>
    </tr>
  `).join("");

  viewRoot.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <div class="row">
        <button class="btn ghost" id="btnSimInbound">Simular inbound random</button>
        <button class="btn danger" id="btnClearLogs">Limpiar logs</button>
      </div>
      <div class="badge">${db.logs.length} logs</div>
    </div>

    <div style="height:12px"></div>

    <div class="card">
      <table class="table">
        <thead>
          <tr><th>Timestamp</th><th>Tipo</th><th>Teléfono</th><th>Campaña</th><th>Evento</th><th>Resultado</th></tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="6">Sin logs.</td></tr>`}</tbody>
      </table>
    </div>
  `;

  $("#btnClearLogs")?.addEventListener("click", () => {
    setDB((db2) => { db2.logs = []; db2.userStates = []; });
    render();
  });

  $("#btnSimInbound")?.addEventListener("click", () => {
    simulateRandomInbound();
    render();
  });
}

/* ---------------- Simulation (send + inbound) ---------------- */

function getAllTags(db) {
  const set = new Set();
  db.contacts.forEach((c) => (c.tags || []).forEach((t) => set.add(t)));
  return Array.from(set).sort();
}

function quickSendAction() {
  const campaignId = $("#qsCampaign").value;
  const tag = $("#qsTag").value;
  simulateBroadcast(campaignId, tag);
  navigate("history");
}

function simulateBroadcast(campaignId, tag) {
  setDB((db) => {
    const campaign = getCampaign(db, campaignId);
    if (!campaign) return;

    const targets = db.contacts.filter((c) => c.status === "active" && (c.tags || []).includes(tag));
    addLog(db, { type: "broadcast", campaignId, result: `Encolados ${targets.length} envíos (tag=${tag})` });

    // Simulamos "cola + rate limit": iteramos pero guardamos logs como si fueran jobs.
    targets.forEach((c) => {
      // Regla: 1 campaña activa por usuario
      const st = getUserState(db, c.phone);
      if (st && st.state === "WAITING_CHOICE") {
        addLog(db, { type: "skip", campaignId, phone: c.phone, messageType: "teaser", result: "Ya tenía campaña activa (WAITING_CHOICE)" });
        return;
      }

      // "Send teaser"
      addLog(db, { type: "send", campaignId, phone: c.phone, messageType: "teaser", result: "OK (sim)" });

      upsertUserState(db, c.phone, {
        activeCampaignId: campaignId,
        state: "WAITING_CHOICE",
        invalidCount: 0,
      });

      // Simulamos algunas respuestas aleatorias para que el demo se vea vivo
      const roll = Math.random();
      if (roll < 0.55) simulateInbound(db, c.phone, "1");
      else if (roll < 0.85) simulateInbound(db, c.phone, "2");
      else simulateInbound(db, c.phone, "asdasd"); // inválida
    });
  });
}

function simulateInbound(db, phone, body) {
  // Idempotencia demo: generamos un "sid" único
  const sid = uid("inb");

  // Guardar inbound
  addLog(db, { type: "inbound", phone, inboundBody: body, result: `sid=${sid}` });

  // Procesar como worker
  processInbound(db, phone, body);
}

function processInbound(db, phone, bodyRaw) {
  const body = String(bodyRaw || "").trim();
  const st = getUserState(db, phone);

  if (!st || st.state !== "WAITING_CHOICE" || !st.activeCampaignId) {
    addLog(db, { type: "reply", phone, messageType: "no_active", result: "No hay campaña activa" });
    return;
  }

  const campaign = getCampaign(db, st.activeCampaignId);
  if (!campaign) {
    addLog(db, { type: "reply", phone, messageType: "no_campaign", result: "Campaña no encontrada" });
    return;
  }

  if (body === "1") {
    addLog(db, { type: "send", campaignId: campaign.id, phone, messageType: "detail", result: "OK (sim)" });
    upsertUserState(db, phone, { state: "DONE" });
    return;
  }

  if (body === "2") {
    addLog(db, { type: "send", campaignId: campaign.id, phone, messageType: "reject", result: "OK (sim)" });
    upsertUserState(db, phone, { state: "DONE" });
    return;
  }

  // inválido
  const invalidCount = (st.invalidCount || 0) + 1;
  addLog(db, { type: "send", campaignId: campaign.id, phone, messageType: "error", result: `Inválido (${invalidCount})` });

  // Opcional: si ya se equivocó mucho, cierras
  if (invalidCount >= 3) {
    upsertUserState(db, phone, { state: "DONE", invalidCount });
    addLog(db, { type: "state", campaignId: campaign.id, phone, result: "Cerrado por demasiados inválidos" });
  } else {
    upsertUserState(db, phone, { state: "WAITING_CHOICE", invalidCount });
  }
}

function simulateRandomInbound() {
  setDB((db) => {
    const waiting = db.userStates.filter((s) => s.state === "WAITING_CHOICE");
    if (!waiting.length) {
      addLog(db, { type: "info", result: "No hay usuarios en WAITING_CHOICE. Envía una campaña primero." });
      return;
    }
    const pick = waiting[Math.floor(Math.random() * waiting.length)];
    const r = Math.random();
    const body = r < 0.45 ? "1" : r < 0.8 ? "2" : "hola";
    simulateInbound(db, pick.phone, body);
  });
}

/* ---------------- Utilities ---------------- */

function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeAttr(s) {
  return escapeHTML(s).replaceAll("\n", " ");
}

/* ---------------- Boot ---------------- */

function bindNav() {
  $("#nav").addEventListener("click", (e) => {
    const btn = e.target.closest(".nav-item");
    if (!btn) return;
    navigate(btn.dataset.route);
  });
}

$("#btnSeedDemo").addEventListener("click", () => { seedDemo(true); render(); });
$("#btnResetDemo").addEventListener("click", () => { resetDB(); seedDemo(true); render(); });
$("#btnSeedDemo").addEventListener("contextmenu", (e) => e.preventDefault());

// auto-seed first time
seedDemo(false);
bindNav();
navigate("dashboard");