require("dotenv").config();

const express = require("express");
const axios = require("axios");
const logQuery = require("./logger");
const { getRecommendations, extractLocation } = require("./logic");
const getNearbyVets = require("./vets");

const app = express();

// ✅ Needed for Twilio (form data)
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

Always respond in this EXACT format:

🧠 Issue: (short diagnosis)
🚨 Severity: (Low / Medium / High)

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
(short condition)

Rules:
- Keep answers short
- Be practical
- No long paragraphs
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


// ================= WHATSAPP ROUTE =================
app.post("/whatsapp", async (req, res) => {
  try {
    const userMessage = req.body.Body;

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

Always respond in this EXACT format:

🧠 Issue: (short diagnosis)
🚨 Severity: (Low / Medium / High)

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
(short condition)
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

    // ✅ Twilio response format
    res.set("Content-Type", "text/xml");
    res.send(`
<Response>
<Message>${reply}</Message>
</Response>
    `);

  } catch (error) {
    console.error(error.message);

    res.set("Content-Type", "text/xml");
    res.send(`
<Response>
<Message>Something went wrong. Please try again.</Message>
</Response>
    `);
  }
});


// ================= ROOT ROUTE (optional) =================
app.get("/", (req, res) => {
  res.send("PetAssist API is running 🚀");
});


// ✅ IMPORTANT FOR RAILWAY
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});