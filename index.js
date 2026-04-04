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

    // ================= GREETING =================
    const isGreeting =
      text.startsWith("hi") ||
      text.startsWith("hello") ||
      text.startsWith("hey");

    if (isGreeting && text.length <= 20) {
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

🧠 Issue:
🚨 Severity:

📋 What to do:
- Real steps

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

        // XML safe
        reply = reply
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

        // 🔥 SEND VIA TWILIO API
        await axios.post(
          `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`,
          new URLSearchParams({
            From: "whatsapp:+14155238886",
            To: req.body.From,
            Body: reply,
          }),
          {
            auth: {
              username: process.env.TWILIO_SID,
              password: process.env.TWILIO_AUTH_TOKEN,
            },
          }
        );

      } catch (err) {
        console.log("Background error:", err.message);
      }
    }, 0);

  } catch (error) {
    console.error(error.message);

    res.set("Content-Type", "text/xml");
    res.send(`<Response><Message>⚠️ Error</Message></Response>`);
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