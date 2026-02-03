/* ==========================================================================
   1. Firebase Config y Auth
   ========================================================================== */
const firebaseConfig = {
    apiKey: "AIzaSyD2ZNznq-2l9hMahVzyT9XwOI2hZjzz7gU",
    authDomain: "nubacwhatsapp.firebaseapp.com",
    projectId: "nubacwhatsapp",
    storageBucket: "nubacwhatsapp.firebasestorage.app",
    messagingSenderId: "378836642199",
    appId: "1:378836642199:web:34241484eb04c75137fcd2",
    measurementId: "G-5096DDYHL2"
};

// Inicialización única
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const dbFS = firebase.firestore();
const provider = new firebase.auth.GoogleAuthProvider();

/* ==========================================================================
   2. Firestore References Centralizadas
   ========================================================================== */
function userDocRef() {
    const u = auth.currentUser;
    if (!u) throw new Error("No hay sesión activa");
    return dbFS.collection("users").doc(u.uid);
}

const contactsRef = () => userDocRef().collection("contacts");
const campaignsRef = () => userDocRef().collection("campaigns");
const schedulesRef = () => userDocRef().collection("schedules");
const logsRef = () => userDocRef().collection("logs");

/* ==========================================================================
   3. Firestore Data Helpers (CRUD Contacts & Campaigns)
   ========================================================================== */

// --- CONTACTS ---
async function fsListContacts() {
    const snap = await contactsRef().orderBy("createdAt", "desc").get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fsCreateContact(data) {
    const payload = {
        ...data,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    return await contactsRef().add(payload);
}

async function fsUpdateContact(id, data) {
    const payload = {
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    return await contactsRef().doc(id).set(payload, { merge: true });
}

async function fsDeleteContact(id) {
    return await contactsRef().doc(id).delete();
}

// --- CAMPAIGNS ---
async function fsListCampaigns() {
    const snap = await campaignsRef().orderBy("createdAt", "desc").get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fsCreateCampaign(data) {
    const payload = {
        ...data,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    return await campaignsRef().add(payload);
}

async function fsUpdateCampaign(id, data) {
    const payload = {
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    return await campaignsRef().doc(id).set(payload, { merge: true });
}

async function fsDeleteCampaign(id) {
    return await campaignsRef().doc(id).delete();
}

// --- KPI DASHBOARD ---
async function getDashboardKPIsFS() {
    const kpis = { totalContacts: 0, totalCampaigns: 0, scheduledPending: 0, logs24h: 0 };
    try {
        const [cSnap, cmpSnap, schSnap] = await Promise.all([
            contactsRef().get(),
            campaignsRef().get(),
            schedulesRef().where("status", "==", "pending").get()
        ]);
        
        kpis.totalContacts = cSnap.size;
        kpis.totalCampaigns = cmpSnap.size;
        kpis.scheduledPending = schSnap.size;

        // Logs 24h (Asumiendo campo ts ISO string por ahora)
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const lSnap = await logsRef().where("ts", ">=", since).get();
        kpis.logs24h = lSnap.size;
    } catch (e) { console.warn("KPI Fetch Info:", e.message); }
    return kpis;
}

/* ==========================================================================
   4. Auth UI y Login Gate
   ========================================================================== */
async function getIdToken() {
    return auth.currentUser ? await auth.currentUser.getIdToken(false) : null;
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

function requireLoginOrShowGate() {
    if (auth.currentUser) return true;
    viewRoot.innerHTML = `
        <div class="card">
            <div style="font-weight:900">Inicia sesión para continuar</div>
            <div class="muted">Este sistema usa Google Auth. El backend valida tu token.</div>
            <hr />
            <button class="btn ok" id="btnGateLogin">Entrar con Google</button>
        </div>`;
    $("#btnGateLogin")?.addEventListener("click", () => auth.signInWithPopup(provider));
    return false;
}

/* ==========================================================================
   5. DOM Helpers y Utilidades
   ========================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHTML(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeAttr(s) {
    return escapeHTML(s).replace(/\n/g, " ");
}

/* ==========================================================================
   6. Modal System
   ========================================================================== */
const modal = $("#modal");
const modalTitle = $("#modalTitle");
const modalBody = $("#modalBody");
const modalActions = $("#modalActions");

function openModal(title, bodyHTML, actions = []) {
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHTML;
    modalActions.innerHTML = ""; // Limpiar acciones previas
    
    actions.forEach(a => {
        const btn = document.createElement("div");
        btn.innerHTML = a.html;
        const el = btn.firstElementChild;
        el.addEventListener("click", (e) => a.onClick(e));
        modalActions.appendChild(el);
    });
    modal.showModal();
}

/* ==========================================================================
   7. Routing y Render Principal
   ========================================================================== */
let currentRoute = "dashboard";
const viewTitle = $("#viewTitle");
const viewSubtitle = $("#viewSubtitle");
const viewRoot = $("#viewRoot");

const ROUTES = {
    dashboard: { title: "Dashboard", subtitle: "Resumen de envíos y actividad." },
    contacts: { title: "Contactos", subtitle: "Firestore" },
    media: { title: "Media", subtitle: "Biblioteca de imágenes/videos (demo)." },
    campaigns: { title: "Campañas", subtitle: "Firestore" },
    calendar: { title: "Calendario", subtitle: "Programa campañas por fecha/hora." },
    history: { title: "Historial", subtitle: "Logs de envíos y respuestas simuladas." },
};

async function render() {
    if (!requireLoginOrShowGate()) return;

    const meta = ROUTES[currentRoute] || ROUTES.dashboard;
    viewTitle.textContent = meta.title;
    viewSubtitle.textContent = meta.subtitle;

    // Activar Nav
    $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.route === currentRoute));

    // Data local solo para demos (Media/Calendar/History)
    const dbLocal = getDB();

    switch (currentRoute) {
        case "dashboard": await renderDashboard(); break;
        case "contacts": await renderContactsFS(); break;
        case "campaigns": await renderCampaignsFS(); break; 
        case "media": renderMedia(dbLocal); break;
        case "calendar": renderCalendar(dbLocal); break;
        case "history": renderHistory(dbLocal); break;
        default: await renderDashboard();
    }
}

function navigate(route) {
    currentRoute = route;
    render();
}

/* ==========================================================================
   8. Implementación de Vistas
   ========================================================================== */

// --- DASHBOARD ---
async function renderDashboard() {
    const kpi = await getDashboardKPIsFS();
    viewRoot.innerHTML = `
        <div class="grid cols3">
            <div class="card"><div class="kpi">${kpi.totalContacts}</div><div class="kpi-sub">Contactos</div><hr/><span class="badge">Firestore</span></div>
            <div class="card"><div class="kpi">${kpi.totalCampaigns}</div><div class="kpi-sub">Campañas</div><hr/><span class="badge">Firestore</span></div>
            <div class="card"><div class="kpi">${kpi.scheduledPending}</div><div class="kpi-sub">Programadas</div><hr/><span class="badge">Firestore</span></div>
        </div>
        <div style="height:14px"></div>
        <div class="grid cols2">
            <div class="card">
                <div class="row" style="justify-content:space-between">
                    <div><b>Actividad (24h)</b><div class="muted">Logs Firestore</div></div>
                    <div class="badge"><b>${kpi.logs24h}</b> logs</div>
                </div>
                <hr/><div class="muted">Datos actualizados desde la nube.</div>
            </div>
            <div class="card">
                <b>Atajo: Enviar ahora</b><hr/>
                ${quickSendUI()}
            </div>
        </div>`;
    $("#qsSend")?.addEventListener("click", () => quickSendAction());
}

// --- CONTACTS ---
async function renderContactsFS() {
    const contacts = await fsListContacts();
    const rows = contacts.map(c => `
        <tr>
            <td><b>${escapeHTML(c.name)}</b><div class="tiny muted">${escapeHTML(c.phone)}</div></td>
            <td>${(c.tags || []).map(t => `<span class="badge">${escapeHTML(t)}</span>`).join(" ")}</td>
            <td>${escapeHTML(c.status || "active")}</td>
            <td>
                <button class="btn ghost" data-edit="${c.id}">Editar</button>
                <button class="btn danger" data-del="${c.id}">Borrar</button>
            </td>
        </tr>`).join("");

    viewRoot.innerHTML = `
        <div class="row" style="justify-content:space-between">
            <button class="btn" id="btnNewContact">Nuevo contacto</button>
            <div class="badge">${contacts.length} contactos</div>
        </div>
        <div class="card" style="margin-top:12px">
            <table class="table">
                <thead><tr><th>Contacto</th><th>Tags</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="4">Sin contactos.</td></tr>'}</tbody>
            </table>
        </div>`;

    $("#btnNewContact").onclick = () => openContactModalFS();
    $$("[data-edit]").forEach(b => b.onclick = () => openContactModalFS(contacts.find(x => x.id === b.dataset.edit)));
    $$("[data-del]").forEach(b => b.onclick = async () => {
        if (confirm("¿Eliminar contacto?")) { await fsDeleteContact(b.dataset.del); render(); }
    });
}

function openContactModalFS(contact = null) {
    const isEdit = !!contact;
    openModal(isEdit ? "Editar contacto" : "Nuevo contacto", `
        <div class="field"><label>Nombre</label><input class="input" id="cName" value="${contact ? escapeAttr(contact.name) : ""}" /></div>
        <div class="field"><label>Teléfono (E.164)</label><input class="input" id="cPhone" placeholder="+52..." value="${contact ? escapeAttr(contact.phone) : ""}" /></div>
        <div class="field"><label>Tags (comas)</label><input class="input" id="cTags" value="${contact ? escapeAttr((contact.tags || []).join(",")) : ""}" /></div>
        <div class="field"><label>Estado</label><select id="cStatus"><option value="active">active</option><option value="inactive">inactive</option></select></div>
    `, [
        { key: "cancel", html: `<button class="btn ghost">Cancelar</button>`, onClick: () => modal.close() },
        { key: "save", html: `<button class="btn ok">${isEdit ? "Guardar" : "Crear"}</button>`, onClick: async () => {
            const data = {
                name: $("#cName").value.trim(),
                phone: $("#cPhone").value.trim(),
                tags: $("#cTags").value.split(",").map(t => t.trim()).filter(Boolean),
                status: $("#cStatus").value
            };
            if (!data.name || !data.phone) return alert("Nombre y teléfono requeridos.");
            isEdit ? await fsUpdateContact(contact.id, data) : await fsCreateContact(data);
            modal.close();
            render();
        }}
    ]);
    if (contact) $("#cStatus").value = contact.status || "active";
}

// --- CAMPAIGNS ---
async function renderCampaignsFS() {
    const campaigns = await fsListCampaigns();
    const rows = campaigns.map(c => `
        <tr>
            <td><b>${escapeHTML(c.title)}</b></td>
            <td class="muted">${escapeHTML(c.teaserText).substring(0, 30)}...</td>
            <td class="muted">${escapeHTML(c.detailText).substring(0, 30)}...</td>
            <td>
                <button class="btn ghost" data-edit="${c.id}">Editar</button>
                <button class="btn danger" data-del="${c.id}">Borrar</button>
            </td>
        </tr>`).join("");

    viewRoot.innerHTML = `
        <div class="row" style="justify-content:space-between">
            <button class="btn" id="btnNewCampaign">Nueva campaña</button>
            <div class="badge">${campaigns.length} campañas</div>
        </div>
        <div class="card" style="margin-top:12px">
            <table class="table">
                <thead><tr><th>Título</th><th>Teaser</th><th>Detalle</th><th>Acciones</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="4">Sin campañas.</td></tr>'}</tbody>
            </table>
        </div>`;

    $("#btnNewCampaign").onclick = () => openCampaignModalFS();
    $$("[data-edit]").forEach(b => b.onclick = () => openCampaignModalFS(campaigns.find(x => x.id === b.dataset.edit)));
    $$("[data-del]").forEach(b => b.onclick = async () => {
        if (confirm("¿Eliminar campaña?")) { await fsDeleteCampaign(b.dataset.del); render(); }
    });
}

function openCampaignModalFS(campaign = null) {
    const isEdit = !!campaign;
    // Helper para opciones de Media (Local Demo)
    const mediaOpts = (selId) => {
        const list = getDB().media || [];
        return `<option value="">(Sin media)</option>` + 
               list.map(m => `<option value="${m.id}" ${selId === m.id ? "selected" : ""}>${escapeHTML(m.alias)}</option>`).join("");
    };

    openModal(isEdit ? "Editar campaña" : "Nueva campaña", `
        <div class="field"><label>Título Interno</label><input class="input" id="cmpTitle" value="${campaign ? escapeAttr(campaign.title) : ""}" /></div>
        <hr/>
        <div class="field"><label>Teaser Text (Mensaje inicial)</label><textarea class="input" id="cmpTeaser">${campaign ? escapeHTML(campaign.teaserText) : ""}</textarea></div>
        <div class="field"><label>Teaser Media (Img/Video)</label><select class="input" id="cmpTeaserMedia">${mediaOpts(campaign?.teaserMediaId)}</select></div>
        <hr/>
        <div class="field"><label>Detail Text (Respuesta a botón)</label><textarea class="input" id="cmpDetail">${campaign ? escapeHTML(campaign.detailText) : ""}</textarea></div>
        <div class="field"><label>Detail Media (Opcional)</label><select class="input" id="cmpDetailMedia">${mediaOpts(campaign?.detailMediaId)}</select></div>
        <hr/>
        <div class="grid cols2">
            <div class="field"><label>Reject Text</label><input class="input" id="cmpReject" value="${campaign ? escapeAttr(campaign.rejectText) : "Entendido, no enviaremos más."}" /></div>
            <div class="field"><label>Error Text</label><input class="input" id="cmpError" value="${campaign ? escapeAttr(campaign.errorText) : "Ocurrió un error."}" /></div>
        </div>
    `, [
        { key: "cancel", html: `<button class="btn ghost">Cancelar</button>`, onClick: () => modal.close() },
        { key: "save", html: `<button class="btn ok">${isEdit ? "Guardar" : "Crear"}</button>`, onClick: async () => {
            const data = {
                title: $("#cmpTitle").value.trim(),
                teaserText: $("#cmpTeaser").value.trim(),
                teaserMediaId: $("#cmpTeaserMedia").value || null,
                detailText: $("#cmpDetail").value.trim(),
                detailMediaId: $("#cmpDetailMedia").value || null,
                rejectText: $("#cmpReject").value.trim(),
                errorText: $("#cmpError").value.trim()
            };

            if (!data.title || !data.teaserText || !data.detailText) {
                return alert("Título, Teaser y Detalle son obligatorios.");
            }

            isEdit ? await fsUpdateCampaign(campaign.id, data) : await fsCreateCampaign(data);
            modal.close();
            render();
        }}
    ]);
}

// --- VISTAS DEMO (LocalStorage) ---
function renderMedia(db) { viewRoot.innerHTML = `<div class="card">Media items: ${db.media.length} (Modo Demo)</div>`; }
function renderCalendar(db) { viewRoot.innerHTML = `<div class="card">Calendario (Modo Demo)</div>`; }
function renderHistory(db) { viewRoot.innerHTML = `<div class="card">Historial (Modo Demo)</div>`; }

function quickSendUI() {
    return `<button class="btn ok" id="qsSend">Simular Envío Masivo</button>`;
}
function quickSendAction() { alert("Simulación enviada a logs locales (Demo)."); }

/* ==========================================================================
   9. LocalStorage Helpers (Solo para Media/Demo)
   ========================================================================== */
const DB_KEY = "wa_sender_db_v1";
function getDB() {
    const raw = localStorage.getItem(DB_KEY);
    return raw ? JSON.parse(raw) : { media: [], campaigns: [], schedules: [], logs: [], userStates: [], meta: { seeded: false } };
}
function saveDB(db) { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
function setDB(mutator) { const db = getDB(); mutator(db); saveDB(db); return db; }

/* ==========================================================================
   10. Boot / Inicialización
   ========================================================================== */
function bindNav() {
    $("#nav").addEventListener("click", (e) => {
        const btn = e.target.closest(".nav-item");
        if (btn) navigate(btn.dataset.route);
    });
}

auth.onAuthStateChanged(async (user) => {
    setAuthUI(user);
    await render();
});

$("#btnLogin")?.addEventListener("click", () => auth.signInWithPopup(provider));
$("#btnLogout")?.addEventListener("click", () => auth.signOut());

// Boot
bindNav();
navigate("dashboard");