// functions/clone-campaigns.js
const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.GOOGLE_CLOUD_PROJECT || "nubacwhatsapp",
});

const db = admin.firestore();

const FROM_UID = "FvskSxxZYuYD9kEqXa02SYWqp8f1";      // Google
const TO_UID   = "yWTpVzk12iNltGzX0sqzreSvrGy2";      // Admin mail

(async () => {
  const snap = await db.collection("users").doc(FROM_UID).collection("campaigns").get();
  console.log("found:", snap.size);

  for (const doc of snap.docs) {
    const data = doc.data();
    await db.collection("users").doc(TO_UID).collection("campaigns").doc(doc.id).set({
      ...data,
      migratedFromUid: FROM_UID,
      migratedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log("copied:", doc.id);
  }

  process.exit(0);
})();