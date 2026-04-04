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

    // 🔥 Robust Twilio parsing
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

Examples:
• My dog is vomiting
• My cat is not eating
• My dog has fever
`;

      res.set("Content-Type", "text/xml");
      return res.send(`<Response><Message>${welcome}</Message></Response>`);
    }

    // ================= LOGIC =================
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
      console.log("Vet fetch failed");
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
You are a smart pet health assistant.

Understand the user's message and give specific advice.

DO NOT give generic answers.

Format:

🧠 Issue:
🚨 Severity:

📋 What to do:
- Clear, real actions

🏥 Recommended Vet: ${vet}

🏥 Nearby Vets:
${vetList}

💰 Estimated Cost: ${cost}

🍗 Food Advice: ${food}

⚠️ When to see a vet:
Short warning
`,
          },
          {
            role: "user",
            content: userMessage,
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

    let reply = response.data.choices[0].message.content;

    // ✅ XML safe
    reply = reply
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    res.set("Content-Type", "text/xml");
    res.send(`<Response><Message>${reply}</Message></Response>`);

  } catch (error) {
    console.error("Error:", error.message);

    res.set("Content-Type", "text/xml");
    res.send(`<Response><Message>⚠️ Error. Try again.</Message></Response>`);
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