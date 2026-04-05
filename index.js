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

    console.log("📩 Message:", userMessage);
logQuery(userMessage);
    // ================= GREETING =================
    const greetings = ["hi", "hello", "hey"];

if (greetings.includes(text)) {
  const welcome = `
🐾 Hi! I'm PetAssist 🐶🐱

Tell me what's wrong with your pet and I’ll help you instantly.
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
          .map(v => `• ${v.name} ⭐ ${v.rating}\n📍 ${v.link}`)
          .join("\n\n");
      }
    } catch (e) {
      console.log("Vet error:", e.message);
    }

    // ================= AI =================
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
You are a pet health assistant.

Give SHORT WhatsApp-friendly responses.

STRICT RULES:
- Max 6 lines
- Each line < 20 words
- No long paragraphs

🧠 Issue:
🚨 Severity:

📋 What to do:
- Step 1
- Step 2
- Step 3

🏥 Vet: ${vet}
💰 Cost: ${cost}
🍗 Food: ${food}

⚠️ Warning:
1 short line only
`,
          },
          { role: "user", content: userMessage },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    let reply = response.data.choices[0].message.content;

// 🔥 LIMIT AI PART ONLY
if (reply.length > 800) {
  reply = reply.substring(0, 800) + "...";
}

// 🔥 APPEND VETS BACK
reply = `
${reply}

🏥 Nearby Vets:
${vetList}
`;

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