require("dotenv").config();

const express = require("express");
const axios = require("axios");
const logQuery = require("./logger");
const { getRecommendations, extractLocation } = require("./logic");
const getNearbyVets = require("./vets");

const app = express();

// ✅ Twilio parsing
app.use(express.text({ type: "*/*" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());


// ================= WHATSAPP ROUTE =================
app.post("/whatsapp", async (req, res) => {
  try {
    let userMessage = "Hi";

    // 🔥 Extract message
    if (typeof req.body === "string") {
      const match = req.body.match(/Body=([^&]*)/);
      if (match) {
        userMessage = decodeURIComponent(match[1].replace(/\+/g, " "));
      }
    } else if (req.body && req.body.Body) {
      userMessage = req.body.Body;
    }

    userMessage = userMessage.trim();
    const text = userMessage.toLowerCase();
let mediaUrl = null;

if (typeof req.body === "string") {
  const mediaMatch = req.body.match(/MediaUrl0=([^&]*)/);
  if (mediaMatch) {
    mediaUrl = decodeURIComponent(mediaMatch[1]);
  }
} else if (req.body) {
  mediaUrl = req.body.MediaUrl0 || null;
}

console.log("📸 Media URL:", mediaUrl);

    console.log("📩 Message:", userMessage);
logQuery(userMessage);
    // ================= GREETING =================
    const greetings = ["hi", "hello", "hey"];

if (greetings.some(g => text.startsWith(g))) {
  const welcome = `
🐾 Hi! I'm PetAssist 🐶🐱

Tell me what's wrong with your pet and I’ll help you instantly.

📸 Want a more accurate answer? Send a photo of your pet.
`;

  res.set("Content-Type", "text/xml");
  return res.send(`<Response><Message>${welcome}</Message></Response>`);
}

    // ================= FAST ACK =================
    res.set("Content-Type", "text/xml");
    res.send(`<Response><Message>🐾 Got your message. Working on it...</Message></Response>`);

    // ================= BACKGROUND PROCESS =================
    setTimeout(async () => {
  try {
    // ================= EXTRACT FROM NUMBER =================
    let fromNumber = "";

    if (typeof req.body === "string") {
      const match = req.body.match(/From=([^&]*)/);
      if (match) {
        fromNumber = decodeURIComponent(match[1]);
      }
    } else if (req.body && req.body.From) {
      fromNumber = req.body.From;
    }

    console.log("📤 Sending to:", fromNumber);

    // ❌ Safety check
    if (!fromNumber) {
      console.log("❌ No valid From number");
      return;
    }

    // ================= LOGIC =================
    const { cost, vet, food } = getRecommendations(userMessage);
    const location = extractLocation(userMessage);

    let vetList = "No nearby vets found";

    try {
      const vets = await getNearbyVets(location);
      if (vets.length > 0) {
        vetList = vets
  .slice(0, 3)
  .map((v, i) =>
  "🐾 *" + (i + 1) + ". " + v.name + "* (⭐ " + v.rating + ")\n" +
  "📍 Tap to search → maps.google.com/?q=" + encodeURIComponent(v.name)
)
  .join("\n\n");
      }
    } catch (e) {
      console.log("Vet error:", e.message);
    }

    // ================= AI =================
const response = await axios.post(
  "https://api.openai.com/v1/chat/completions",
  {
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `
You are a smart pet health assistant.

Give SHORT, clear, WhatsApp-friendly responses.

If the user sends ONLY text:
- Respond normally based on symptoms.

If the user sends an image:
- Analyze visible symptoms carefully
- Do NOT assume beyond what is visible
- Give practical next steps.

If an image is already provided:
- Do NOT ask for another image
- Give the best possible analysis directly

If the user sends BOTH text + image:
- Combine both inputs for better diagnosis.

STRICT RULES:
- Max 6–8 lines
- Keep it concise but natural
- Avoid robotic formatting

🧠 Issue:
🚨 Severity:

📋 What to do:
- Give 2–4 clear bullet points
- Keep them short and practical
- No numbering like Step 1/2/3

🏥 Vet: ${vet}
💰 Cost: ${cost}
🍗 Food: ${food}

⚠️ Warning:
1 short line only
`,
      },
      {
        role: "user",
        content: mediaUrl
          ? `${userMessage || "Analyze this pet condition"}\n\n[Image attached: analyze possible symptoms carefully]`
          : userMessage,
      },
    ],
  },
  {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
  }
);

// ✅ SINGLE declaration (FIXED)
let aiReply = response.data.choices[0].message.content;

// 🔥 LIMIT AI RESPONSE
if (aiReply.length > 700) {
  aiReply = aiReply.substring(0, 700) + "...";
}

// 🔥 BASE REPLY
let reply = aiReply;

// 🔥 CTA (only if no image)
if (!mediaUrl) {
  reply += "\n\n📸 Want a more accurate diagnosis?\nSend a photo of your pet and I’ll analyze it.";
}

// 🔥 FINAL FORMAT (NO DUPLICATES, NO CRASH)
reply = `🐾 PetAssist Analysis

${reply}

━━━━━━━━━━━━━━━
🏥 Nearby Vets:
${vetList}
━━━━━━━━━━━━━━━`;

    // ================= XML SAFE =================
    reply = reply
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

    // ================= SEND VIA TWILIO =================
    await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`,
      new URLSearchParams({
        From: "whatsapp:+14155238886",
        To: fromNumber.startsWith("whatsapp:")
  ? fromNumber
  : `whatsapp:${fromNumber}`,
        Body: reply,
      }),
      {
        auth: {
          username: process.env.TWILIO_SID,
          password: process.env.TWILIO_AUTH_TOKEN,
        },
      }
    );

    console.log("✅ Reply sent successfully");

  } catch (err) {
    console.log("❌ Background error:", err.response?.data || err.message);
  }
}, 0);

  } catch (error) {
  console.error(error.message);

  if (!res.headersSent) {
    res.set("Content-Type", "text/xml");
    res.send(`<Response><Message>⚠️ Error</Message></Response>`);
  }
}
});


// ================= ROOT =================
app.get("/", (req, res) => {
  res.send("PetAssist API is running 🚀");
});


// ================= SERVER =================
const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});