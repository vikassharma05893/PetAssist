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
  console.log("🔥 NEW CODE ACTIVE"); // 👈 ADD THIS

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

    // ================= GREETING =================
const isGreeting =
  text.startsWith("hi") ||
  text.startsWith("hello") ||
  text.startsWith("hey");

// ✅ Only trigger for short greetings
if (isGreeting && text.length <= 20) {
  const welcome = `
🐾 Hi! I'm PetAssist 🐶🐱

Tell me what's wrong with your pet and I’ll help you instantly.
`;

  res.set("Content-Type", "text/xml");
  return res.send(`<Response><Message>${welcome}</Message></Response>`);
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
    } catch {}

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

Give specific advice based on user message.

🧠 Issue:
🚨 Severity:

📋 What to do:
- Real actionable steps

🏥 Recommended Vet: ${vet}

🏥 Nearby Vets:
${vetList}

💰 Estimated Cost: ${cost}

🍗 Food Advice: ${food}

⚠️ When to see a vet:
Short warning
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

    // ✅ Make safe for XML
    reply = reply
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    res.set("Content-Type", "text/xml");
    res.send(`<Response><Message>${reply}</Message></Response>`);

  } catch (error) {
    console.error(error.message);

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