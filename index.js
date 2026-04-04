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

    console.log("🔥 Incoming:", userMessage);

    logQuery(userMessage);

    // 👉 Get smart data
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

    // 👉 Call AI
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
You are a pet health assistant.

Always respond in this format:

🧠 Issue:
🚨 Severity:

📋 What to do:
- Step 1
- Step 2
- Step 3

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

    // ✅ Make XML safe
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