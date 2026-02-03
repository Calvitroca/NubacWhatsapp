/**
 * Firebase Cloud Functions backend for WhatsApp “Mailchimp-like” sender using Twilio.
 */

const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const twilio = require("twilio");
const { onRequest } = require("firebase-functions/v2/https");

const { MessagingResponse } = require("twilio").twiml;

function replyTwiml(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text);
  res.type("text/xml").send(twiml.toString());
}

const FALLBACK_TEXT =
  "Hola 👋 Soy el asistente.\n\n" +
  "Responde:\n" +
  "1️⃣ para conocer más\n" +
  "2️⃣ para salir\n\n" +
  "Escribe 1 o 2 😊";

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ========= CONFIG =========
const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM;
const DEFAULT_TENANT = process.env.APP_TENANT || "demo";

let twilioClient;

if (TWILIO_SID && TWILIO_TOKEN) {
  twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);
} else {
  console.warn("Twilio env vars missing, running in stub mode");
  twilioClient = {
    messages: {
      create: async () => {
        throw new Error("Twilio not configured");
      },
    },
  };
}

// ========= HELPERS =========
function tenantRef(tenantId) {
  return db.collection("tenants").doc(tenantId);
}

function phoneHash(tenantId, phoneE164) {
  return crypto.createHash("sha256").update(`${tenantId}:${phoneE164}`).digest("hex");
}

async function addLog(tenantId, payload) {
  await tenantRef(tenantId).collection("logs").add({
    ...payload,
    ts: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });

    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    req.tenantId = DEFAULT_TENANT;
    return next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ========= CONTACTS =========
app.get("/api/contacts", requireAuth, async (req, res) => {
  const snap = await tenantRef(req.tenantId)
    .collection("contacts")
    .orderBy("createdAt", "desc")
    .limit(1000)
    .get();
  return res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});

app.post("/api/contacts", requireAuth, async (req, res) => {
  const { name, phoneE164, tags = [], status = "active" } = req.body || {};
  if (!name || !phoneE164) return res.status(400).json({ error: "name and phoneE164 required" });

  const doc = await tenantRef(req.tenantId).collection("contacts").add({
    name,
    phoneE164,
    tags,
    status,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return res.json({ id: doc.id });
});

// ========= CAMPAIGNS =========
app.get("/api/campaigns", requireAuth, async (req, res) => {
  const snap = await tenantRef(req.tenantId)
    .collection("campaigns")
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();
  return res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});

app.post("/api/campaigns", requireAuth, async (req, res) => {
  const {
    title,
    teaserText,
    detailText,
    rejectText,
    errorText,
    teaserMediaUrl = null,
    detailMediaUrl = null,
  } = req.body || {};

  if (!title || !teaserText || !detailText || !rejectText || !errorText) {
    return res.status(400).json({ error: "missing required campaign fields" });
  }

  const doc = await tenantRef(req.tenantId).collection("campaigns").add({
    title,
    teaserText,
    detailText,
    rejectText,
    errorText,
    teaserMediaUrl,
    detailMediaUrl,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return res.json({ id: doc.id });
});

// ========= SEND (enqueue jobs in Firestore) =========
app.post("/api/send", requireAuth, async (req, res) => {
  const { campaignId, tag } = req.body || {};
  if (!campaignId || !tag) return res.status(400).json({ error: "campaignId and tag required" });

  const contactsSnap = await tenantRef(req.tenantId)
    .collection("contacts")
    .where("tags", "array-contains", tag)
    .where("status", "==", "active")
    .limit(2000)
    .get();

  const batch = db.batch();
  contactsSnap.docs.forEach((docSnap) => {
    const c = docSnap.data();
    const jobRef = tenantRef(req.tenantId).collection("sendJobs").doc();
    batch.set(jobRef, {
      campaignId,
      phoneE164: c.phoneE164,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();

  await addLog(req.tenantId, {
    type: "broadcast_enqueued",
    campaignId,
    tag,
    count: contactsSnap.size,
  });

  return res.json({ ok: true, enqueued: contactsSnap.size });
});

// ========= WORKER (drain sendJobs in small batches) =========
app.post("/jobs/processSendJobs", async (req, res) => {
  const tenantId = DEFAULT_TENANT;
  const limit = Number(req.query.limit || 25);

  const jobsSnap = await tenantRef(tenantId)
    .collection("sendJobs")
    .where("status", "==", "pending")
    .orderBy("createdAt", "asc")
    .limit(limit)
    .get();

  if (jobsSnap.empty) return res.json({ processed: 0, note: "no pending jobs" });

  const campaignCache = new Map();
  let processed = 0;

  for (const jobDoc of jobsSnap.docs) {
    const job = jobDoc.data();
    const { campaignId, phoneE164 } = job;

    try {
      if (!campaignCache.has(campaignId)) {
        const cdoc = await tenantRef(tenantId).collection("campaigns").doc(campaignId).get();
        if (!cdoc.exists) {
          await jobDoc.ref.update({ status: "failed", error: "campaign_not_found" });
          continue;
        }
        campaignCache.set(campaignId, { id: cdoc.id, ...cdoc.data() });
      }
      const campaign = campaignCache.get(campaignId);

      const ph = phoneHash(tenantId, phoneE164);
      const stateRef = tenantRef(tenantId).collection("userStates").doc(ph);
      const st = await stateRef.get();

      if (st.exists && st.data().state === "WAITING_CHOICE") {
        await jobDoc.ref.update({ status: "skipped", reason: "already_waiting" });
        continue;
      }

      const msg = await twilioClient.messages.create({
        from: TWILIO_FROM,
        to: `whatsapp:${phoneE164}`,
        body: campaign.teaserText,
      });

      await tenantRef(tenantId).collection("outbound").doc(msg.sid).set({
        sid: msg.sid,
        campaignId,
        to: phoneE164,
        type: "teaser",
        status: msg.status || "queued",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await stateRef.set(
        {
          activeCampaignId: campaignId,
          state: "WAITING_CHOICE",
          invalidCount: 0,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      await jobDoc.ref.update({
        status: "sent",
        sid: msg.sid,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      processed++;
    } catch (e) {
      await jobDoc.ref.update({ status: "failed", error: String(e.message || e) });
    }
  }

  return res.json({ processed });
});

// ========= TWILIO WEBHOOK (inbound) =========
app.post("/twilio/inbound", express.urlencoded({ extended: false }), async (req, res) => {
  const tenantId = DEFAULT_TENANT;

  const fromRaw = (req.body.From || "").trim();
  const from = fromRaw.replace("whatsapp:", "").trim();
  const body = (req.body.Body || "").trim();
  const sid = (req.body.MessageSid || "").trim();

  const inboundRef = tenantRef(tenantId).collection("inbound").doc(sid);
  const exist = await inboundRef.get();
  if (exist.exists) return replyTwiml(res, "OK");

  await inboundRef.set({
    sid,
    from,
    body,
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  try {
    const replyText = await processInbound(tenantId, from, body);
    if (replyText) {
      return replyTwiml(res, replyText);
    }
  } catch (e) {
    await addLog(tenantId, { type: "inbound_error", from, error: String(e.message || e) });
    return replyTwiml(res, "Ups, tuvimos un problema. Intenta de nuevo 🙏");
  }

  return replyTwiml(res, "OK");
});

async function processInbound(tenantId, fromPhoneE164, bodyRaw) {
  const body = String(bodyRaw || "").trim();
  const ph = phoneHash(tenantId, fromPhoneE164);

  const stateRef = tenantRef(tenantId).collection("userStates").doc(ph);
  const stSnap = await stateRef.get();

  const stData = stSnap.exists ? stSnap.data() : null;

  // Fallback flow: user is not currently in an active campaign choice.
  if (!stData || stData.state !== "WAITING_CHOICE" || !stData.activeCampaignId) {
    // If we were already waiting on fallback choice, interpret 1/2.
    if (stData && stData.state === "WAITING_FALLBACK_CHOICE") {
      if (body === "1") {
        await stateRef.set(
          {
            state: "FALLBACK_OPTIN",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        await addLog(tenantId, { type: "fallback_optin", phoneHash: ph });
        return "Perfecto ✅ En breve te comparto más info.\n\nSi quieres recibir una campaña, espera un mensaje con opciones 1/2.";
      }
      if (body === "2") {
        await stateRef.set(
          {
            state: "FALLBACK_OPTOUT",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        await addLog(tenantId, { type: "fallback_optout", phoneHash: ph });
        return "Listo 👍 No te mando más info.\n\nSi luego quieres, escribe 1.";
      }
      await addLog(tenantId, { type: "fallback_invalid", phoneHash: ph, inboundBody: body });
      return "No entendí 😅 Responde 1 o 2.";
    }

    // Start fallback choice state for any other inbound.
    await stateRef.set(
      {
        state: "WAITING_FALLBACK_CHOICE",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastInboundBody: body,
      },
      { merge: true }
    );
    await addLog(tenantId, { type: "fallback_prompt", phoneHash: ph, inboundBody: body });
    return FALLBACK_TEXT;
  }

  const { activeCampaignId, invalidCount = 0 } = stData;
  const campSnap = await tenantRef(tenantId).collection("campaigns").doc(activeCampaignId).get();
  if (!campSnap.exists) return null;

  const campaign = campSnap.data();

  let sendText;
  let messageType;
  let newState = "WAITING_CHOICE";
  let newInvalid = invalidCount;

  if (body === "1") {
    sendText = campaign.detailText;
    messageType = "detail";
    newState = "DONE";
  } else if (body === "2") {
    sendText = campaign.rejectText;
    messageType = "reject";
    newState = "DONE";
  } else {
    sendText = campaign.errorText;
    messageType = "error";
    newInvalid = invalidCount + 1;
    if (newInvalid >= 3) newState = "DONE";
  }

  const msg = await twilioClient.messages.create({
    from: TWILIO_FROM,
    to: `whatsapp:${fromPhoneE164}`,
    body: sendText,
  });

  await tenantRef(tenantId).collection("outbound").doc(msg.sid).set({
    sid: msg.sid,
    campaignId: activeCampaignId,
    to: fromPhoneE164,
    type: messageType,
    status: msg.status || "queued",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await stateRef.set(
    {
      state: newState,
      invalidCount: newInvalid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await addLog(tenantId, {
    type: "inbound_processed",
    campaignId: activeCampaignId,
    phoneHash: ph,
    inboundBody: body,
    result: messageType,
  });

  return null;
}

exports.app = onRequest(app);
    