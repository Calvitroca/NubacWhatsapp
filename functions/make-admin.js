const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.GOOGLE_CLOUD_PROJECT || "nubacwhatsapp",
});

const uid = "yWTpVzk12iNltGzX0sqzreSvrGy2";

(async () => {
  try {
    await admin.auth().setCustomUserClaims(uid, { admin: true });
    console.log("✅ Usuario ahora es admin:", uid);
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
})();