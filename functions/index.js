/**
 * Firebase Cloud Functions backend for WhatsApp sender using Twilio.
 * users/{uid} structure + schedules target all/tags + 24h window w/ template fallback.
 */

const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const twilio = require("twilio");
const { onRequest } = require("firebase-functions/v2/https");
const { MessagingResponse } = require("twilio").twiml;

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ========= CONFIG =========
const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
let TWILIO_FROM = process.env.TWILIO_FROM; // can be "+52..." or "whatsapp:+52..."
const CRON_SECRET = process.env.CRON_SECRET;

console.log("ENV CHECK:", {
  TWILIO_SID: process.env.TWILIO_SID ? "OK" : "MISSING",
  TWILIO_TOKEN: process.env.TWILIO_TOKEN ? "OK" : "MISSING",
  TWILIO_FROM: process.env.TWILIO_FROM || "MISSING",
  CRON_SECRET: process.env.CRON_SECRET ? "OK" : "MISSING",
});

// Normalize "from" to whatsapp:
function normalizeWa(addr) {
  if (!addr) return addr;
  return addr.startsWith("whatsapp:") ? addr : `whatsapp:${addr}`;
}
TWILIO_FROM = normalizeWa(TWILIO_FROM);

const twilioClient = (TWILIO_SID && TWILIO_TOKEN) ? twilio(TWILIO_SID, TWILIO_TOKEN) : null;

// ========= HELPERS =========
function userRef(uid) {
  return db.collection("users").doc(uid);
}

function phoneHash(uid, phoneE164) {
  return crypto.createHash("sha256").update(`${uid}:${phoneE164}`).digest("hex");
}

async function addLog(uid, payload) {
  await userRef(uid).collection("logs").add({
    ...payload,
    ts: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function getMediaUrl(uid, mediaId) {
  if (!mediaId) return null;
  const doc = await userRef(uid).collection("media").doc(mediaId).get();
  return doc.exists ? doc.data().url : null;
}

function replyTwiml(res, text) {
  const twiml = new MessagingResponse();
  if (text) twiml.message(text);
  res.type("text/xml").send(twiml.toString());
}

async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    return next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function in24hWindow(lastInboundAt, now = Date.now()) {
  if (!lastInboundAt) return false;
  const last = lastInboundAt.toDate ? lastInboundAt.toDate().getTime() : new Date(lastInboundAt).getTime();
  return (now - last) < 24 * 60 * 60 * 1000;
}

// Fetch contacts for a schedule target with pagination cursor.
// Returns { contacts: [{id, ...data}], nextCursor: <docId|null>, totalFetched }
async function fetchContactsForTarget(uid, target, cursorDocId = null, limit = 100) {
  let q = userRef(uid).collection("contacts")
    .where("status", "==", "active")
    .orderBy(admin.firestore.FieldPath.documentId());

  if (cursorDocId) q = q.startAfter(cursorDocId);

  // all
  if (!target || target.type === "all") {
    const snap = await q.limit(limit).get();
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const nextCursor = snap.size === limit ? snap.docs[snap.docs.length - 1].id : null;
    return { contacts: docs, nextCursor, totalFetched: snap.size };
  }

  // tags (array-contains-any max 10)
  if (target.type === "tags") {
    const tags = Array.isArray(target.tags) ? target.tags.filter(Boolean) : [];
    if (tags.length === 0) return { contacts: [], nextCursor: null, totalFetched: 0 };

    // If >10 tags, we chunk and merge (best-effort). Cursor/pagination becomes messy across chunks.
    // Practical approach: limit tags to 10 in UI. Here we just take first 10 to keep it consistent.
    const tagsSafe = tags.slice(0, 10);

    const snap = await q
      .where("tags", "array-contains-any", tagsSafe)
      .limit(limit)
      .get();

    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const nextCursor = snap.size === limit ? snap.docs[snap.docs.length - 1].id : null;
    return { contacts: docs, nextCursor, totalFetched: snap.size };
  }

  return { contacts: [], nextCursor: null, totalFetched: 0 };
}

async function sendTeaserOrTemplate({ uid, contact, campaign, nowMs }) {
  if (!twilioClient) throw new Error("twilio_not_configured");
  if (!TWILIO_FROM) throw new Error("twilio_from_missing");

  const to = normalizeWa(contact.phoneE164);
  const inside = in24hWindow(contact.lastInboundAt, nowMs);

  // Inside 24h: freeform + media
  if (inside) {
    const msgConfig = {
      from: TWILIO_FROM,
      to,
      body: campaign.teaserText || "",
    };

    const mediaUrl = await getMediaUrl(uid, campaign.teaserMediaId);
    if (mediaUrl) msgConfig.mediaUrl = [mediaUrl];

    return await twilioClient.messages.create(msgConfig);
  }

  // Outside 24h: MUST use approved template / contentSid
  if (!campaign.contentSid) {
    throw new Error("outside_24h_no_template");
  }

  const msgConfig = {
    from: TWILIO_FROM,
    to,
    contentSid: campaign.contentSid,
    // Twilio Content variables must be a JSON string. Keys are "1","2",...
    contentVariables: JSON.stringify({
      "1": contact.name || "hola",
    }),
  };

  return await twilioClient.messages.create(msgConfig);
}

// ========= API ENDPOINTS =========
app.get("/api/campaigns", requireAuth, async (req, res) => {
  try {
    const isAdmin = !!req.user.admin;
    const uidParam = req.query.uid;

    // admin + uid → ver campañas de ese usuario
    const targetUid = (isAdmin && uidParam)
      ? uidParam
      : req.user.uid;

    const snap = await db
      .collection("users")
      .doc(targetUid)
      .collection("campaigns")
      .get();

    const campaigns = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
    }));

    return res.json(campaigns);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to list campaigns" });
  }
});

app.get("/api/campaigns", requireAuth, async (req, res) => {
  const snap = await userRef(req.uid).collection("campaigns")
    .orderBy("createdAt", "desc").limit(500).get();
  return res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

app.post("/api/campaigns", requireAuth, async (req, res) => {
  const data = req.body || {};
  if (!data.title || !data.teaserText || !data.detailText) {
    return res.status(400).json({ error: "missing required fields: title, teaserText, detailText" });
  }

  const doc = await userRef(req.uid).collection("campaigns").add({
    ...data,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return res.json({ id: doc.id });
});

// --- NEW INSTANT MESSAGING ENDPOINTS ---

// A) Envio inmediato individual
app.post("/api/send/now", requireAuth, async (req, res) => {
  const { to, body, mediaUrl } = req.body || {};
  
  if (!twilioClient) return res.status(500).json({ error: "twilio_not_configured" });
  if (!TWILIO_FROM) return res.status(500).json({ error: "twilio_from_missing" });
  if (!to || !body) return res.status(400).json({ error: "Missing 'to' or 'body'" });

  try {
    const normalizedTo = normalizeWa(to);
    const msgData = {
      from: TWILIO_FROM,
      to: normalizedTo,
      body: body
    };
    if (mediaUrl) msgData.mediaUrl = [mediaUrl];

    const message = await twilioClient.messages.create(msgData);

    await addLog(req.uid, {
      type: "manual_send_now",
      to: normalizedTo,
      sid: message.sid,
      status: message.status
    });

    return res.json({ ok: true, sid: message.sid, status: message.status });
  } catch (e) {
    console.error("SendNow Error:", e);
    await addLog(req.uid, { type: "manual_send_error", error: e.message, to });
    return res.status(500).json({ error: e.message || "Twilio send failed" });
  }
});

// B) Envio broadcast (loop pequeño)
app.post("/api/send/broadcast", requireAuth, async (req, res) => {
  const { recipients, body, mediaUrl, limit = 50 } = req.body || {};

  if (!twilioClient) return res.status(500).json({ error: "twilio_not_configured" });
  if (!TWILIO_FROM) return res.status(500).json({ error: "twilio_from_missing" });
  
  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: "recipients array required" });
  }
  if (!body) return res.status(400).json({ error: "body required" });

  const hardLimit = 200;
  const effectiveLimit = Math.min(Number(limit), hardLimit);
  const targets = recipients.slice(0, effectiveLimit);

  const results = [];
  let sentCount = 0;

  // Secuencial para evitar rate limits agresivos en cuentas estándar
  for (const recipient of targets) {
    const normalizedTo = normalizeWa(recipient);
    try {
      const msgData = {
        from: TWILIO_FROM,
        to: normalizedTo,
        body: body
      };
      if (mediaUrl) msgData.mediaUrl = [mediaUrl];

      const message = await twilioClient.messages.create(msgData);
      results.push({ to: normalizedTo, sid: message.sid, status: message.status });
      sentCount++;
    } catch (e) {
      results.push({ to: normalizedTo, error: e.message });
    }
  }

  await addLog(req.uid, {
    type: "manual_broadcast",
    totalRequested: recipients.length,
    processed: targets.length,
    sent: sentCount
  });

  return res.json({ ok: true, sent: sentCount, results });
});

// C) Test Self
app.post("/api/send/test-self", requireAuth, async (req, res) => {
  const { to } = req.body || {};
  
  if (!twilioClient || !TWILIO_FROM) return res.status(500).json({ error: "twilio_not_configured" });
  
  // Si no mandan "to", intentamos fallar con error claro (o podrías buscar en DB el usuario, 
  // pero "req.uid" es el ID de firebase, y tu colección contacts no necesariamente tiene el teléfono del dueño).
  // Mejor requerimos "to".
  if (!to) return res.status(400).json({ error: "Please provide 'to' phone number for test." });

  try {
    const normalizedTo = normalizeWa(to);
    const message = await twilioClient.messages.create({
      from: TWILIO_FROM,
      to: normalizedTo,
      body: "Prueba Nubac ✅"
    });

    return res.json({ ok: true, sid: message.sid, status: message.status });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ========= DEBUG (temporal) =========

// ========= WORKER: PROCESS SCHEDULES (all/tags) =========
// Call via cron with header x-cron-secret: CRON_SECRET
// (Recomendado) arriba del archivo, una sola vez:
process.on("unhandledRejection", (reason) => console.error("UNHANDLED_REJECTION", reason));
process.on("uncaughtException", (err) => console.error("UNCAUGHT_EXCEPTION", err));

app.post("/jobs/processSchedules", async (req, res) => {
  try {
    const secret = req.headers["x-cron-secret"];
    if (!CRON_SECRET || secret !== CRON_SECRET) return res.status(401).send("Unauthorized");

    const nowTs = admin.firestore.Timestamp.now();
    const nowMs = Date.now();

    console.log("[processSchedules] hit", {
      at: new Date().toISOString(),
      contactLimit: req.query.contactLimit,
    });

    // ✅ OJO: este query puede tirar "missing index" => ahora sí lo cachamos
    const schedulesSnap = await db.collectionGroup("schedules")
      .where("status", "==", "pending")
      .where("scheduledAt", "<=", nowTs)
      .orderBy("scheduledAt", "asc")
      .limit(25)
      .get();

    if (schedulesSnap.empty) {
      return res.json({ processedSchedules: 0, processedMessages: 0 });
    }

    let processedSchedules = 0;
    let processedMessages = 0;

    for (const schDoc of schedulesSnap.docs) {
      const schedule = schDoc.data();

      // ⚠️ Más seguro que parent.parent.id (aunque usualmente funciona)
      const uid = schDoc.ref.path.split("/")[1]; // "users/{uid}/schedules/{id}"

      // Soft-lock schedule
      try {
        await schDoc.ref.update({
          status: "processing",
          processingAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (lockErr) {
        console.warn("[processSchedules] lock_failed", schDoc.ref.path, lockErr?.message || lockErr);
        continue;
      }

      try {
        // Load campaign
        const campSnap = await userRef(uid).collection("campaigns").doc(schedule.campaignId).get();
        if (!campSnap.exists) {
          await schDoc.ref.update({ status: "failed", error: "campaign_not_found" });
          continue;
        }
        const campaign = { id: campSnap.id, ...campSnap.data() };

        const cursor = schedule.cursor || null;
        const perRunLimit = Number(req.query.contactLimit || 50);

        const { contacts, nextCursor } = await fetchContactsForTarget(
          uid,
          schedule.target || { type: "all" },
          cursor,
          perRunLimit
        );

        if (contacts.length === 0) {
          await schDoc.ref.update({
            status: "sent",
            doneAt: admin.firestore.FieldValue.serverTimestamp(),
            cursor: null,
            processedCount: schedule.processedCount || 0,
            note: "no_contacts_or_done",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          processedSchedules++;
          continue;
        }

        for (const contact of contacts) {
          try {
            const msg = await sendTeaserOrTemplate({ uid, contact, campaign, nowMs });
            processedMessages++;

            await userRef(uid).collection("outbound").doc(msg.sid).set({
              sid: msg.sid,
              scheduleId: schDoc.id,
              campaignId: campaign.id,
              to: contact.phoneE164,
              type: "teaser",
              status: msg.status || "queued",
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            const ph = phoneHash(uid, contact.phoneE164);
            await userRef(uid).collection("userStates").doc(ph).set({
              activeCampaignId: campaign.id,
              state: "WAITING_CHOICE",
              invalidCount: 0,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

          } catch (e) {
            await addLog(uid, {
              type: "send_failed",
              scheduleId: schDoc.id,
              campaignId: campaign.id,
              to: contact.phoneE164,
              error: String(e?.message || e),
            });
          }
        }

        const newProcessedCount = (schedule.processedCount || 0) + contacts.length;

        if (nextCursor) {
          await schDoc.ref.update({
            status: "pending",
            cursor: nextCursor,
            processedCount: newProcessedCount,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } else {
          await schDoc.ref.update({
            status: "sent",
            cursor: null,
            processedCount: newProcessedCount,
            doneAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          processedSchedules++;
        }

      } catch (e) {
        await schDoc.ref.update({
          status: "failed",
          error: String(e?.message || e),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    return res.json({ processedSchedules, processedMessages });

  } catch (e) {
    // ✅ aquí caerán: missing index, permisos, bugs antes del loop, etc.
    console.error("[processSchedules] FATAL", e?.stack || e);
    return res.status(500).send("Internal Server Error");
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED_REJECTION", reason);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT_EXCEPTION", err);
});

// ========= TWILIO WEBHOOK (inbound) =========
app.post("/twilio/inbound", express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const fromRaw = String(req.body.From || "").trim(); // "whatsapp:+52..."
    const from = fromRaw.replace("whatsapp:", "").trim();
    const body = String(req.body.Body || "").trim();

    // Find user by contact phone (best-effort; for internal use)
    const contactQuery = await db.collectionGroup("contacts")
      .where("phoneE164", "==", from)
      .limit(1)
      .get();

    if (contactQuery.empty) return replyTwiml(res, "No reconocido.");

    const contactRef = contactQuery.docs[0].ref;
    const uid = contactRef.parent.parent.id;

    // open 24h window
    await contactRef.set({
      lastInboundAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // read state
    const ph = phoneHash(uid, from);
    const stateRef = userRef(uid).collection("userStates").doc(ph);
    const stSnap = await stateRef.get();
    const st = stSnap.exists ? stSnap.data() : null;

    if (!st || st.state !== "WAITING_CHOICE" || !st.activeCampaignId) {
      return replyTwiml(res, "Hola 👋 En breve te contactamos. Si recibes una campaña, responde 1 o 2.");
    }

    // load campaign
    const campSnap = await userRef(uid).collection("campaigns").doc(st.activeCampaignId).get();
    if (!campSnap.exists) return replyTwiml(res, "Campaña no encontrada.");

    const campaign = campSnap.data();

    let replyText = "";
    let mediaId = null;
    let newState = "WAITING_CHOICE";
    let newInvalid = st.invalidCount || 0;

    if (body === "1") {
      replyText = campaign.detailText;
      mediaId = campaign.detailMediaId || null;
      newState = "DONE";
    } else if (body === "2") {
      replyText = campaign.rejectText || "Listo 👍";
      newState = "DONE";
    } else {
      newInvalid++;
      replyText = campaign.errorText || "No entendí 😅 Responde 1 o 2.";
      if (newInvalid >= 3) newState = "DONE";
    }

    // respond via Twilio outbound message (not TwiML body) so we can attach media
    const mediaUrl = await getMediaUrl(uid, mediaId);
    const msgOptions = {
      from: TWILIO_FROM,
      to: normalizeWa(from),
      body: replyText,
    };
    if (mediaUrl) msgOptions.mediaUrl = [mediaUrl];

    if (twilioClient) {
      await twilioClient.messages.create(msgOptions);
    } else {
      await addLog(uid, { type: "inbound_reply_skipped", reason: "twilio_not_configured", from, body });
    }

    await stateRef.set({
      state: newState,
      invalidCount: newInvalid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await addLog(uid, { type: "inbound_processed", from, body, result: newState });

    // empty TwiML response
    return replyTwiml(res, "");
  } catch (e) {
    return replyTwiml(res, "Ups, hubo un error. Intenta de nuevo 🙏");
  }
});

app.get("/debug/env", (req, res) => {
  return res.json({
    twilioConfigured: !!twilioClient,
    from: TWILIO_FROM || null,
    hasSid: !!TWILIO_SID,
    hasToken: !!TWILIO_TOKEN,
  });
});

// ⚠️ TEMPORAL: prueba Twilio sin Auth (protéjelo con secret)
app.post("/debug/send", async (req, res) => {
  try {
    const secret = req.headers["x-debug-secret"];
    if (!process.env.DEBUG_SECRET || secret !== process.env.DEBUG_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { to, body } = req.body || {};
    if (!to || !body) return res.status(400).json({ error: "to and body required" });

    if (!twilioClient) return res.status(500).json({ error: "twilio_not_configured" });
    if (!TWILIO_FROM) return res.status(500).json({ error: "twilio_from_missing" });

    const msg = await twilioClient.messages.create({
      from: TWILIO_FROM,
      to: normalizeWa(to),
      body
    });

    return res.json({ ok: true, sid: msg.sid, status: msg.status });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

exports.app = onRequest(app);