const twilio = require("twilio");

const SID = process.env.TWILIO_SID;
const TOKEN = process.env.TWILIO_TOKEN;
const FROM = process.env.TWILIO_FROM || "whatsapp:+14155238886";
const TO = process.env.TWILIO_TO; // lo pasaremos por env

if (!SID || !TOKEN || !TO) {
  console.error("Faltan env vars:", {
    TWILIO_SID: !!SID,
    TWILIO_TOKEN: !!TOKEN,
    TWILIO_FROM: !!FROM,
    TWILIO_TO: !!TO,
  });
  process.exit(1);
}

const client = twilio(SID, TOKEN);

(async () => {
  try {
    const msg = await client.messages.create({
      from: FROM,
      to: TO,
      body: "🔥 Test manual desde back (twilio-test.js)",
    });
    console.log("OK:", msg.sid);
  } catch (e) {
    console.error("ERROR:", e?.message || e);
    process.exit(1);
  }
})();
