require("dotenv").config();

const express = require("express");
const axios = require("axios");
const logQuery = require("./logger");
const { getRecommendations, extractLocation } = require("./logic");
// ❌ Temporarily not using getNearbyVets in WhatsApp route
const getNearbyVets = require("./vets");

const app = express();

// ✅ Needed for Twilio
app.use(express.text({ type: "*/*" }));   // 🔥 MUST BE FIRST
app.use(express.urlencoded({ extended: true }));
app.use(express.json());


// ================= TEST ROUTE =================
app.post("/test", async (req, res) => {
  try {
    const userMessage = req.body.message;

    logQuery(userMessage);

    const { cost, vet, food } = getRecommendations(userMessage);
    const location = extractLocation(userMessage);
    const vets = await getNearbyVets(location);

    const vetList = vets.length > 0
      ? vets.map(v => `• ${v.name} ⭐ ${v.rating}\n📍 ${v.link}`).join("\n\n")
      : "No nearby vets found";

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
You are a pet health assistant.

Format:
🧠 Issue
🚨 Severity
📋 Steps
🏥 Vet
💰 Cost
🍗 Food
⚠️ Warning

Keep it short.
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

    const reply = response.data.choices[0].message.content;

    res.send(reply);

  } catch (error) {
    console.error(error.message);
    res.send("Something went wrong");
  }
});


// ================= WHATSAPP ROUTE (FIXED) =================
app.post("/whatsapp", async (req, res) => {
  try {
    // 🔥 DEBUG LOGS (ADD THIS)
    console.log("BODY TYPE:", typeof req.body);
    console.log("FULL BODY:", req.body);

    let userMessage = "Hi";

    // 🔥 Handle BOTH formats (IMPORTANT)
    if (typeof req.body === "string") {
      const params = new URLSearchParams(req.body);
      userMessage = params.get("Body") || "Hi";
    } else if (req.body && req.body.Body) {
      userMessage = req.body.Body;
    }

    // 🔥 CLEAN FINAL MESSAGE
userMessage = userMessage.trim();

console.log("🔥 FINAL MESSAGE:", userMessage);

// ✅ ONLY ONE text declaration
const text = userMessage.toLowerCase().trim();

console.log("🔥 Incoming:", userMessage);

// ================= WELCOME =================

// 🔥 CLEAN GREETING DETECTION (STRICT)
const greetings = ["hi", "hello", "hey"];

// normalize text
const normalized = text.replace(/\s+/g, " ").trim();

// check exact match only
const isGreeting = greetings.includes(normalized);

if (isGreeting) {
  const welcome = `
🐾 Hi! I'm PetAssist 🐶🐱

Tell me what's wrong with your pet and I’ll help you instantly.

Examples:
• My dog is vomiting
• My cat is not eating
• My dog has fever
`;

  res.set("Content-Type", "text/xml");
  return res.send(`<Response><Message>${welcome}</Message></Response>`);
}

    // ================= NORMAL FLOW =================
    logQuery(userMessage);

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
      console.log("Vet fetch failed:", e.message);
    }

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
You are a pet health assistant.

Give real advice. No placeholders.

🧠 Issue:
🚨 Severity:

📋 What to do:
- Real steps only

🏥 Recommended Vet: ${vet}

🏥 Nearby Vets:
${vetList}

💰 Estimated Cost: ${cost}

🍗 Food Advice: ${food}

⚠️ When to see a vet:
Keep it short.
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

    reply = reply
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    res.set("Content-Type", "text/xml");
    res.send(`<Response><Message>${reply}</Message></Response>`);

  } catch (error) {
    console.error("FINAL ERROR:", error.message);

    res.set("Content-Type", "text/xml");
    res.send(`<Response><Message>⚠️ Something went wrong</Message></Response>`);
  }
});
// ================= ROOT =================
app.get("/", (req, res) => {
  res.send("PetAssist API is running 🚀");
});


// ================= SERVER =================
const PORT = process.env.PORT;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});