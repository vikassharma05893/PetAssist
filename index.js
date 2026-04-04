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

    // ✅ INSTANT RESPONSE (CRITICAL)
    res.set("Content-Type", "text/xml");
    res.send(`<Response><Message>🐾 Got it! Let me check...</Message></Response>`);

    // ================= BACKGROUND AI =================
    setTimeout(async () => {
      try {
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
        } catch {}

        const response = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `
You are a smart pet health assistant.

Give specific advice.

🧠 Issue:
🚨 Severity:

📋 What to do:
- Real steps

🏥 Recommended Vet: ${vet}

🏥 Nearby Vets:
${vetList}

💰 Estimated Cost: ${cost}

🍗 Food Advice: ${food}
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

        console.log("✅ AI:", response.data.choices[0].message.content);

      } catch (e) {
        console.log("AI Error:", e.message);
      }
    }, 0);

  } catch (error) {
    console.error("Error:", error.message);

    res.set("Content-Type", "text/xml");
    res.send(`<Response><Message>Error</Message></Response>`);
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