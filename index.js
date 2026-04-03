require("dotenv").config();

const express = require("express");
const axios = require("axios");
const logQuery = require("./logger");
const { getRecommendations, extractLocation } = require("./logic");
// ❌ Temporarily not using getNearbyVets in WhatsApp route
const getNearbyVets = require("./vets");

const app = express();

// ✅ Needed for Twilio
app.use(express.urlencoded({ extended: false }));
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
    const userMessage = req.body.Body || "Hi";

    console.log("Incoming WhatsApp:", userMessage);

    logQuery(userMessage);

    // ✅ TEMP: Avoid crashing Google API
    const vetList = "Find nearby vets:\nhttps://www.google.com/maps/search/veterinary+clinic";

    let aiReply = "Hello! How can I help your pet today?";

    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are a pet health assistant. Keep it short." },
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

      aiReply = response.data.choices[0].message.content;

    } catch (e) {
      console.log("OpenAI error:", e.message);
    }

    const finalReply = `${aiReply}\n\n🏥 ${vetList}`;

    const safeReply = finalReply
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    res.set("Content-Type", "text/xml");
    res.send(`
<Response>
<Message>${safeReply}</Message>
</Response>
    `);

  } catch (error) {
    console.error("FINAL ERROR:", error);

    res.set("Content-Type", "text/xml");
    res.send(`
<Response>
<Message>Server error</Message>
</Response>
    `);
  }
});


// ================= ROOT =================
app.get("/", (req, res) => {
  res.send("PetAssist API is running 🚀");
});


// ================= SERVER =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});