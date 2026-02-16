const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.GOOGLE_CLOUD_PROJECT || "nubacwhatsapp",
});

const db = admin.firestore();

const GOOGLE_UID = "FvskSxxZYuYD9kEqXa02SYWqp8f1";

async function dumpSnap(label, snap, max = 10) {
  console.log(`\n=== ${label} ===`);
  console.log("count:", snap.size);
  snap.docs.slice(0, max).forEach((d) => {
    const data = d.data();
    console.log("-", d.ref.path, {
      name: data.name,
      title: data.title,
      ownerUid: data.ownerUid,
      uid: data.uid,
      status: data.status,
      createdAt: data.createdAt,
    });
  });
}

(async () => {
  try {
    // 1) campaigns en raíz: /campaigns
    const rootCampaigns = await db.collection("campaigns").limit(50).get();
    await dumpSnap("root collection: campaigns", rootCampaigns);

    // 2) campaigns por user: /users/{uid}/campaigns
    const userSub = await db.collection("users").doc(GOOGLE_UID).collection("campaigns").limit(50).get();
    await dumpSnap(`subcollection: users/${GOOGLE_UID}/campaigns`, userSub);

    // 3) collectionGroup "campaigns" (encuentra campaigns en cualquier subcolección con ese nombre)
    const cg = await db.collectionGroup("campaigns").limit(50).get();
    await dumpSnap("collectionGroup: campaigns", cg);

    // 4) fallback: si las guardaste con otro nombre común
    const cg2 = await db.collectionGroup("campaign").limit(50).get().catch(() => ({ size: 0, docs: [] }));
    await dumpSnap("collectionGroup: campaign (fallback)", cg2);

    process.exit(0);
  } catch (e) {
    console.error("ERROR:", e);
    process.exit(1);
  }
})();