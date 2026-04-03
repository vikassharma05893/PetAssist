require("dotenv").config();

const express = require("express");
const axios = require("axios");
const logQuery = require("./logger");
const { getRecommendations, extractLocation } = require("./logic");
const getNearbyVets = require("./vets"); // ✅ real Google API

const app = express();
app.use(express.json());

app.post("/test", async (req, res) => {
  try {
    const userMessage = req.body.message;

    // Log user input
    logQuery(userMessage);

    // Get recommendations
    const { cost, vet, food } = getRecommendations(userMessage);

    // Extract location
    const location = extractLocation(userMessage);

    // ✅ Fetch REAL vets from Google
    const vets = await getNearbyVets(location);

    // ✅ Format clean vet list
    const vetList = vets.length > 0
      ? vets.map(v =>
          `• ${v.name} ⭐ ${v.rating}\n📍 ${v.link}`
        ).join("\n\n")
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

    const reply = response.data.choices[0].message.content;

    res.send(reply);

  } catch (error) {
    console.error(error.message);
    res.send("Something went wrong");
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));