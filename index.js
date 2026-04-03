require("dotenv").config();

const express = require("express");
const axios = require("axios");
const logQuery = require("./logger");
const { getRecommendations, extractLocation } = require("./logic");
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
          // ✅ FIXED HERE
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


// ================= WHATSAPP ROUTE =================
app.post("/whatsapp", async (req, res) => {
  try {
    const userMessage = req.body.Body || "Hi";

    console.log("Incoming WhatsApp:", req.body);

    logQuery(userMessage);

    const { cost, vet, food } = getRecommendations(userMessage);
    const location = extractLocation(userMessage);
    const vets = await getNearbyVets(location);

    const vetList = vets.length > 0
      ? vets.map(v => `• ${v.name} ⭐ ${v.rating}\n${v.link}`).join("\n\n")
      : "No nearby vets found";

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a pet health assistant. Keep answers short and helpful.`,
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

    const aiReply = response.data.choices[0].message.content;

    // ✅ XML safe
    const safeReply = aiReply
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
    console.error("WhatsApp Error:", error.message);

    res.set("Content-Type", "text/xml");
    res.send(`
<Response>
<Message>⚠️ Error. Please try again.</Message>
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