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
const storage = firebase.storage();
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
const mediaRef = () => userDocRef().collection("media");

/* ==========================================================================
   3. Firestore Data Helpers (CRUD Contacts, Campaigns, Media & Schedules)
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

// --- SCHEDULES (Programación) ---
async function fsListSchedules() {
    const snap = await schedulesRef().orderBy("scheduledAt", "asc").get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fsCreateSchedule(data) {
    const payload = {
        ...data,
        status: data.status || "pending",
        processedCount: 0,
        cursor: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    return await schedulesRef().add(payload);
}

async function fsUpdateSchedule(id, data) {
    const payload = {
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    return await schedulesRef().doc(id).set(payload, { merge: true });
}

async function fsCancelSchedule(id) {
    return await fsUpdateSchedule(id, { status: "cancelled" });
}

async function fsDeleteSchedule(id) {
    return await schedulesRef().doc(id).delete();
}

// --- MEDIA (Firestore + Storage) ---
async function fsListMedia() {
    const snap = await mediaRef().orderBy("createdAt", "desc").get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function uploadMediaFile(file, aliasOpt) {
    const u = auth.currentUser;
    if (!u) throw new Error("No auth");

    const docRef = mediaRef().doc(); // ID generado
    const mediaId = docRef.id;
    const fullPath = `users/${u.uid}/media/${mediaId}/${file.name}`;
    const storageRef = storage.ref().child(fullPath);

    // Subir a Storage
    const snapshot = await storageRef.put(file);
    const url = await snapshot.ref.getDownloadURL();

    // Guardar Metadata en Firestore
    const type = file.type.startsWith("video") ? "video" : "image";
    const payload = {
        name: file.name,
        alias: aliasOpt || file.name,
        type: type,
        contentType: file.type,
        size: file.size,
        fullPath: fullPath,
        url: url,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    await docRef.set(payload);
    return mediaId;
}

async function fsDeleteMedia(mediaId) {
    const docSnap = await mediaRef().doc(mediaId).get();
    if (docSnap.exists) {
        const data = docSnap.data();
        if (data.fullPath) {
            try {
                await storage.ref().child(data.fullPath).delete();
            } catch (e) {
                console.warn("Archivo en Storage no encontrado o ya borrado", e);
            }
        }
        await mediaRef().doc(mediaId).delete();
    }
}

// --- HELPERS ADICIONALES ---
function toDatetimeLocal(ts) {
    if (!ts) return "";
    const d = ts.toDate();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function getMediaUrl(mediaId) {
    if (!mediaId) return null;
    try {
        const doc = await mediaRef().doc(mediaId).get();
        return doc.exists ? doc.data().url : null;
    } catch (e) { return null; }
}

// NUEVOS HELPERS API
async function apiFetch(path, options = {}) {
    const token = await getIdToken();
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    return fetch(path, { ...options, headers });
}

async function runSchedulesNow() {
    try {
        const res = await apiFetch('/api/runSchedulesNow', { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            return { success: true, message: data.message || "Procesamiento iniciado." };
        } else {
            return { success: false, message: "Schedule creado. El envío saldrá cuando el cron/worker se ejecute." };
        }
    } catch (e) {
        return { success: false, message: "Schedule creado. El envío saldrá cuando el cron/worker se ejecute." };
    }
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
    modalActions.innerHTML = "";
    
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
    media: { title: "Media", subtitle: "Firebase Storage + Firestore" },
    campaigns: { title: "Campañas", subtitle: "Firestore" },
    calendar: { title: "Calendario", subtitle: "Programación de envíos (Firestore)" },
    history: { title: "Historial", subtitle: "Logs de envíos y respuestas simuladas." },
};

async function render() {
    if (!requireLoginOrShowGate()) return;

    const meta = ROUTES[currentRoute] || ROUTES.dashboard;
    viewTitle.textContent = meta.title;
    viewSubtitle.textContent = meta.subtitle;

    // Activar Nav
    $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.route === currentRoute));

    const dbLocal = getDB();

    switch (currentRoute) {
        case "dashboard": await renderDashboard(); break;
        case "contacts": await renderContactsFS(); break;
        case "campaigns": await renderCampaignsFS(); break; 
        case "media": await renderMediaFS(); break;
        case "calendar": await renderCalendarFS(); break;
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
                <b>Atajo: Envío Rápido</b><hr/>
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

// --- MEDIA ---
async function renderMediaFS() {
    const mediaList = await fsListMedia();
    const cards = mediaList.map(m => {
        const preview = m.type === "video" 
            ? `<video src="${m.url}" style="width:100%; height:120px; object-fit:cover; background:#000;" controls></video>` 
            : `<img src="${m.url}" style="width:100%; height:120px; object-fit:cover; display:block; border-radius:4px;">`;
            
        return `
        <div class="card" style="padding:10px; display:flex; flex-direction:column; gap:8px;">
            ${preview}
            <div>
                <div style="font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHTML(m.alias)}</div>
                <div class="tiny muted">${escapeHTML(m.type)} · ${(m.size / 1024).toFixed(1)} KB</div>
            </div>
            <button class="btn danger small" data-del="${m.id}" style="width:100%">Borrar</button>
        </div>`;
    }).join("");

    viewRoot.innerHTML = `
        <div class="row" style="justify-content:space-between">
            <button class="btn" id="btnUploadMedia">Subir Media</button>
            <div class="badge">${mediaList.length} archivos</div>
        </div>
        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:12px; margin-top:12px;">
            ${cards || '<div class="muted">No hay archivos multimedia.</div>'}
        </div>`;

    $("#btnUploadMedia").onclick = () => openUploadMediaModal();
    $$("[data-del]").forEach(b => b.onclick = async () => {
        if (confirm("¿Borrar archivo permanentemente?")) { await fsDeleteMedia(b.dataset.del); render(); }
    });
}

function openUploadMediaModal() {
    openModal("Subir Multimedia", `
        <div class="field">
            <label>Archivo (Imagen o Video)</label>
            <input type="file" id="uFile" class="input" accept="image/*,video/*" />
        </div>
        <div class="field">
            <label>Alias (Opcional)</label>
            <input type="text" id="uAlias" class="input" placeholder="Ej: Promo Verano" />
        </div>
        <div id="uProgress" class="tiny muted" style="margin-top:5px; display:none;">Subiendo... espera por favor.</div>
    `, [
        { key: "cancel", html: `<button class="btn ghost">Cancelar</button>`, onClick: () => modal.close() },
        { key: "upload", html: `<button class="btn ok">Subir</button>`, onClick: async (e) => {
            const fileInput = $("#uFile");
            const file = fileInput.files[0];
            const alias = $("#uAlias").value.trim();
            if (!file) return alert("Selecciona un archivo.");
            const btn = e.target;
            btn.disabled = true;
            btn.textContent = "Subiendo...";
            $("#uProgress").style.display = "block";
            try {
                await uploadMediaFile(file, alias);
                modal.close();
                render();
            } catch (err) {
                alert("Error al subir: " + err.message);
                btn.disabled = false;
                btn.textContent = "Subir";
                $("#uProgress").style.display = "none";
            }
        }}
    ]);
}

// --- CAMPAIGNS ---
async function renderCampaignsFS() {
    const campaigns = await fsListCampaigns();
    const rows = campaigns.map(c => `
        <tr>
            <td><b>${escapeHTML(c.title)}</b></td>
            <td class="muted">${escapeHTML(c.teaserText).substring(0, 30)}...</td>
            <td>
                <button class="btn ok small" data-sendnow="${c.id}">Enviar ahora</button>
                <button class="btn ok small" data-schedule="${c.id}" style="background:var(--secondary)">Programar</button>
                <button class="btn ghost small" data-edit="${c.id}">Editar</button>
                <button class="btn danger small" data-del="${c.id}">Borrar</button>
            </td>
        </tr>`).join("");

    viewRoot.innerHTML = `
        <div class="row" style="justify-content:space-between">
            <button class="btn" id="btnNewCampaign">Nueva campaña</button>
            <div class="badge">${campaigns.length} campañas</div>
        </div>
        <div class="card" style="margin-top:12px">
            <table class="table">
                <thead><tr><th>Título</th><th>Teaser</th><th>Acciones</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="3">Sin campañas.</td></tr>'}</tbody>
            </table>
        </div>`;

    $("#btnNewCampaign").onclick = () => openCampaignModalFS();
    $$("[data-sendnow]").forEach(b => b.onclick = () => openSendNowModal(campaigns.find(x => x.id === b.dataset.sendnow)));
    $$("[data-schedule]").forEach(b => b.onclick = () => openScheduleModal(campaigns, b.dataset.schedule));
    $$("[data-edit]").forEach(b => b.onclick = () => openCampaignModalFS(campaigns.find(x => x.id === b.dataset.edit)));
    $$("[data-del]").forEach(b => b.onclick = async () => {
        if (confirm("¿Eliminar campaña?")) { await fsDeleteCampaign(b.dataset.del); render(); }
    });
}

function openSendNowModal(campaign) {
    if (!campaign) return;
    openModal(`Enviar ahora: ${campaign.title}`, `
        <div class="field">
            <label>Audiencia</label>
            <select class="input" id="snType">
                <option value="all">Todos los contactos</option>
                <option value="tags">Por etiquetas (tags)</option>
            </select>
        </div>
        <div class="field" id="snDivTags" style="display:none">
            <label>Tags (separados por coma)</label>
            <input class="input" id="snTags" placeholder="vip, cliente, etc" />
        </div>
        <div id="snLoading" class="tiny muted" style="display:none">Procesando envío...</div>
    `, [
        { key: "cancel", html: `<button class="btn ghost">Cancelar</button>`, onClick: () => modal.close() },
        { key: "send", html: `<button class="btn ok">Enviar</button>`, onClick: async (e) => {
            const btn = e.target;
            const type = $("#snType").value;
            const tags = $("#snTags").value.split(",").map(t => t.trim()).filter(Boolean);
            
            if (type === "tags" && tags.length === 0) return alert("Ingresa al menos un tag.");

            btn.disabled = true;
            btn.textContent = "Enviando...";
            $("#snLoading").style.display = "block";

            try {
                // 1. Crear el Schedule con status pending y fecha actual
                await fsCreateSchedule({
                    campaignId: campaign.id,
                    campaignTitle: campaign.title,
                    target: type === "all" ? { type: "all" } : { type: "tags", tags },
                    scheduledAt: firebase.firestore.Timestamp.now(),
                    status: "pending"
                });

                // 2. Intentar disparar el worker
                const result = await runSchedulesNow();
                alert(result.message);
                
                modal.close();
                navigate("calendar");
            } catch (err) {
                alert("Error: " + err.message);
                btn.disabled = false;
                btn.textContent = "Enviar";
            }
        }}
    ]);

    $("#snType").onchange = (e) => $("#snDivTags").style.display = e.target.value === "tags" ? "block" : "none";
}

async function openCampaignModalFS(campaign = null) {
    const isEdit = !!campaign;
    const mediaList = await fsListMedia();
    const mediaOpts = (selId) => {
        return `<option value="">(Sin media)</option>` + 
               mediaList.map(m => `<option value="${m.id}" ${selId === m.id ? "selected" : ""}>${m.type} · ${escapeHTML(m.alias)}</option>`).join("");
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
        <hr/>
        <div class="field">
            <label><input type="checkbox" id="chkSched"> Programar al guardar</label>
            <input type="datetime-local" class="input" id="cmpSchedDate" style="display:none; margin-top:5px;">
        </div>
    `, [
        { key: "cancel", html: `<button class="btn ghost">Cancelar</button>`, onClick: () => modal.close() },
        { key: "save", html: `<button class="btn ok">${isEdit ? "Guardar" : "Crear"}</button>`, onClick: async () => {
            try {
                const data = {
                    title: $("#cmpTitle").value.trim(),
                    teaserText: $("#cmpTeaser").value.trim(),
                    teaserMediaId: $("#cmpTeaserMedia").value || null,
                    detailText: $("#cmpDetail").value.trim(),
                    detailMediaId: $("#cmpDetailMedia").value || null,
                    rejectText: $("#cmpReject").value.trim(),
                    errorText: $("#cmpError").value.trim()
                };
                if (!data.title || !data.teaserText || !data.detailText) return alert("Título, Teaser y Detalle requeridos.");

                let docId = campaign?.id;
                if (isEdit) {
                    await fsUpdateCampaign(docId, data);
                } else {
                    const docRef = await fsCreateCampaign(data);
                    docId = docRef.id;
                }

                if ($("#chkSched").checked) {
                    const dateVal = $("#cmpSchedDate").value;
                    if (!dateVal) throw new Error("Selecciona fecha de programación");
                    await fsCreateSchedule({
                        campaignId: docId,
                        campaignTitle: data.title,
                        target: { type: "all" },
                        scheduledAt: firebase.firestore.Timestamp.fromDate(new Date(dateVal)),
                        status: "pending"
                    });
                    modal.close();
                    navigate("calendar");
                } else {
                    modal.close();
                    render();
                }
            } catch(e) { alert(e.message); }
        }}
    ]);
    $("#chkSched").onchange = (e) => $("#cmpSchedDate").style.display = e.target.checked ? "block" : "none";
}

// --- CALENDAR ---
async function renderCalendarFS() {
    const [schedules, campaigns] = await Promise.all([fsListSchedules(), fsListCampaigns()]);
    
    const previewContainer = `
        <div id="calendarPreview" class="card" style="margin-bottom:20px; border-left: 5px solid var(--primary);">
            <div class="row" style="justify-content:space-between; margin-bottom:10px;">
                <div style="font-weight:bold">Vista previa de campaña</div>
                <select id="previewSelector" class="input" style="width:auto; height:32px; padding:0 10px;">
                    <option value="">-- Selecciona una campaña --</option>
                    ${campaigns.map(c => `<option value="${c.id}">${escapeHTML(c.title)}</option>`).join("")}
                </select>
            </div>
            <div id="previewContent" class="muted">Selecciona una campaña para previsualizar el contenido.</div>
        </div>`;

    const rows = schedules.map(s => {
        const dateStr = s.scheduledAt ? s.scheduledAt.toDate().toLocaleString() : "Sin fecha";
        let audienceStr = s.target?.type === "all" ? "Todos" : (s.target?.tags ? `Tags: ${s.target.tags.join(",")}` : "-");

        return `
        <tr>
            <td><b>${escapeHTML(s.campaignTitle)}</b></td>
            <td>${dateStr}</td>
            <td>${escapeHTML(audienceStr)}</td>
            <td><span class="badge ${s.status === 'pending' ? '' : 'muted'}">${escapeHTML(s.status)}</span></td>
            <td>
                ${s.status === 'pending' ? `<button class="btn ghost small" data-edit-sch="${s.id}">Editar</button>` : ''}
                <button class="btn danger small" data-del="${s.id}">Borrar</button>
            </td>
        </tr>`;
    }).join("");

    viewRoot.innerHTML = `
        <div class="row" style="justify-content:space-between; margin-bottom:12px;">
            <button class="btn" id="btnNewSchedule">Programar campaña</button>
            <div class="badge">${schedules.length} programadas</div>
        </div>
        ${previewContainer}
        <div class="card">
            <table class="table">
                <thead><tr><th>Campaña</th><th>Fecha/Hora</th><th>Audiencia</th><th>Status</th><th>Acciones</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="5">No hay envíos programados.</td></tr>'}</tbody>
            </table>
        </div>`;

    const sel = $("#previewSelector");
    if(sel) sel.onchange = () => updateCampaignPreview(campaigns.find(c => c.id === sel.value));

    $("#btnNewSchedule").onclick = () => openScheduleModal(campaigns);
    $$("[data-edit-sch]").forEach(b => b.onclick = () => openScheduleEditModal(schedules.find(x => x.id === b.dataset.editSch), campaigns));
    $$("[data-del]").forEach(b => b.onclick = async () => {
        if (confirm("¿Borrar registro?")) { try { await fsDeleteSchedule(b.dataset.del); render(); } catch(e){alert(e.message)} }
    });
}

async function updateCampaignPreview(campaign) {
    const container = $("#previewContent");
    if (!campaign) { container.innerHTML = "Selecciona una campaña"; return; }
    container.innerHTML = "Cargando preview...";
    const [teaserUrl, detailUrl] = await Promise.all([getMediaUrl(campaign.teaserMediaId), getMediaUrl(campaign.detailMediaId)]);
    const renderMedia = (url) => {
        if (!url) return "";
        return url.includes(".mp4") || url.includes(".mov") 
            ? `<video src="${url}" style="max-height:100px; display:block; margin:5px 0;" controls></video>`
            : `<img src="${url}" style="max-height:100px; display:block; margin:5px 0; border-radius:4px;">`;
    };
    container.innerHTML = `
        <div class="grid cols2" style="gap:15px; font-size:0.9em;">
            <div style="border-right:1px solid #eee; padding-right:10px;">
                <div class="badge">Teaser</div>
                <div style="margin:5px 0;">${escapeHTML(campaign.teaserText)}</div>
                ${renderMedia(teaserUrl)}
            </div>
            <div>
                <div class="badge">Detalle</div>
                <div style="margin:5px 0;">${escapeHTML(campaign.detailText)}</div>
                ${renderMedia(detailUrl)}
            </div>
        </div>`;
}

async function openScheduleModal(campaigns, preselectId = null) {
    if (campaigns.length === 0) return alert("Primero crea una campaña.");
    const campOptions = campaigns.map(c => `<option value="${c.id}" ${preselectId === c.id ? "selected" : ""}>${escapeHTML(c.title)}</option>`).join("");
    openModal("Programar Envío", `
        <div class="field"><label>Campaña</label><select class="input" id="sCampId">${campOptions}</select></div>
        <div class="field"><label>Fecha y Hora</label><input type="datetime-local" class="input" id="sDate" /></div>
        <div class="field"><label>Audiencia</label><select class="input" id="sType"><option value="all">Todos</option><option value="tags">Tags</option></select></div>
        <div class="field" id="divTags" style="display:none"><label>Tags (comas)</label><input class="input" id="sTags" /></div>
    `, [
        { key: "cancel", html: `<button class="btn ghost">Cancelar</button>`, onClick: () => modal.close() },
        { key: "save", html: `<button class="btn ok">Guardar</button>`, onClick: async () => {
            const cId = $("#sCampId").value;
            const date = $("#sDate").value;
            if (!cId || !date) return alert("Requerido");
            await fsCreateSchedule({
                campaignId: cId,
                campaignTitle: campaigns.find(x => x.id === cId).title,
                target: $("#sType").value === "all" ? { type: "all" } : { type: "tags", tags: $("#sTags").value.split(",").filter(Boolean) },
                scheduledAt: firebase.firestore.Timestamp.fromDate(new Date(date)),
                status: "pending"
            });
            modal.close();
            render();
        }}
    ]);
    $("#sType").onchange = (e) => $("#divTags").style.display = e.target.value === "tags" ? "block" : "none";
}

async function openScheduleEditModal(schedule, campaigns) {
    const campOptions = campaigns.map(c => `<option value="${c.id}" ${schedule.campaignId === c.id ? "selected" : ""}>${escapeHTML(c.title)}</option>`).join("");
    const isTags = schedule.target?.type === "tags";
    openModal("Editar Programación", `
        <div class="field"><label>Campaña</label><select class="input" id="eCampId">${campOptions}</select></div>
        <div class="field"><label>Fecha y Hora</label><input type="datetime-local" class="input" id="eDate" value="${toDatetimeLocal(schedule.scheduledAt)}" /></div>
        <div class="field"><label>Audiencia</label><select class="input" id="eType"><option value="all" ${!isTags ? "selected" : ""}>Todos</option><option value="tags" ${isTags ? "selected" : ""}>Tags</option></select></div>
        <div class="field" id="edivTags" style="display:${isTags ? "block" : "none"}"><label>Tags (comas)</label><input class="input" id="eTags" value="${isTags ? (schedule.target.tags || []).join(",") : ""}" /></div>
        <div class="field"><label>Estado</label><select class="input" id="eStatus"><option value="pending">pending</option><option value="cancelled">cancelled</option></select></div>
    `, [
        { key: "cancel", html: `<button class="btn ghost">Cancelar</button>`, onClick: () => modal.close() },
        { key: "save", html: `<button class="btn ok">Actualizar</button>`, onClick: async () => {
            const cId = $("#eCampId").value;
            await fsUpdateSchedule(schedule.id, {
                campaignId: cId,
                campaignTitle: campaigns.find(x => x.id === cId).title,
                target: $("#eType").value === "all" ? { type: "all" } : { type: "tags", tags: $("#eTags").value.split(",").filter(Boolean) },
                scheduledAt: firebase.firestore.Timestamp.fromDate(new Date($("#eDate").value)),
                status: $("#eStatus").value
            });
            modal.close();
            render();
        }}
    ]);
    $("#eType").onchange = (e) => $("#edivTags").style.display = e.target.value === "tags" ? "block" : "none";
}

function renderHistory(db) { viewRoot.innerHTML = `<div class="card">Historial (Logs de Firestore)</div>`; }
function quickSendUI() { return `<button class="btn ok" id="qsSend">Limpiar caché / Recargar</button>`; }
function quickSendAction() { window.location.reload(); }

/* ==========================================================================
   9. LocalStorage Helpers (Backup)
   ========================================================================== */
const DB_KEY = "wa_sender_db_v1";
function getDB() {
    const raw = localStorage.getItem(DB_KEY);
    return raw ? JSON.parse(raw) : { campaigns: [], schedules: [], logs: [], userStates: [], meta: { seeded: false } };
}

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

bindNav();
navigate("dashboard");