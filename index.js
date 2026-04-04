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
    const userMessage = (req.body && req.body.Body) ? req.body.Body : "Hi";
    const text = userMessage.toLowerCase();

    console.log("🔥 Incoming:", userMessage);

    logQuery(userMessage);

    // ================= WELCOME =================
    if (["hi", "hello", "hey"].includes(text)) {
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

    // ================= EMERGENCY =================
    if (
      text.includes("bleeding") ||
      text.includes("unconscious") ||
      text.includes("not breathing")
    ) {
      const urgent = `
🚨 EMERGENCY 🚨

Please take your pet to the nearest vet IMMEDIATELY.
Do not wait for online advice.
`;

      res.set("Content-Type", "text/xml");
      return res.send(`<Response><Message>${urgent}</Message></Response>`);
    }

    // ================= SMART DATA =================
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

    // ================= AI CALL =================
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
You are a pet health assistant.

Analyze the user's message and give REAL advice.

DO NOT give generic instructions.
DO NOT say "Step 1, Step 2".

Always respond like this:

🧠 Issue: (actual condition)

🚨 Severity: Low / Medium / High

📋 What to do:
- Give real actionable steps
- Example: Keep hydrated, feed bland diet

🏥 Recommended Vet: ${vet}

🏥 Nearby Vets:
${vetList}

💰 Estimated Cost: ${cost}

🍗 Food Advice: ${food}

⚠️ When to see a vet:
Give a real condition like "if symptoms continue >24 hrs"

Keep it short and practical.
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

    // ================= XML SAFE =================
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