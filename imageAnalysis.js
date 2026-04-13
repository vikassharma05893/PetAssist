// imageAnalysis.js

const axios = require("axios");

// ================= DOWNLOAD IMAGE AS BASE64 =================
async function downloadImageAsBase64(url) {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      auth: {
        username: process.env.TWILIO_SID,
        password: process.env.TWILIO_AUTH_TOKEN,
      },
    });

    // Detect actual image type (jpeg/png/webp)
    const contentType = response.headers["content-type"] || "image/jpeg";
    const base64 = Buffer.from(response.data, "binary").toString("base64");

    return `data:${contentType};base64,${base64}`;
  } catch (err) {
    console.log("Image download error:", err.message);
    return null;
  }
}

// ================= BUILD IMAGE INPUT FOR OPENAI =================
async function buildImageInput(mediaUrl, userMessage) {
  try {
    const base64Image = await downloadImageAsBase64(mediaUrl);

    if (!base64Image) return null;

    return [
      {
        type: "text",
        text: userMessage || "Analyze this pet condition",
      },
      {
        type: "image_url",
        image_url: {
          url: base64Image,
        },
      },
    ];
  } catch (err) {
    console.log("Build image input error:", err.message);
    return null;
  }
}

// ================= GET AI SYSTEM PROMPT =================
function getImageSystemPrompt(isEyeCheckFlow, vet, cost, food) {
  if (isEyeCheckFlow) {
    return `
You are a veterinary eye specialist.

Analyze pet eye images carefully and logically.

STEP 1: What you SEE
- pupil size (dilated/normal)
- symmetry (equal or unequal)
- redness or swelling
- discharge (color/type)
- cloudiness or opacity

STEP 2: What it MEANS
- Dilated pupils → stress or pain
- Unequal pupils → neurological issue (urgent)
- Redness → infection or allergy
- Discharge → bacterial infection
- Cloudiness → corneal damage or cataract

STEP 3: Respond in this format:

Eye Observation:
(clear, specific description)

What it means:
(connect signs to condition)

Severity:
(Low / Medium / High / Emergency)

What to do:
- 2-3 simple actionable steps

Warning:
(1 short urgent note if needed)

Rules:
- Be precise
- No guessing
- No generic answers
    `;
  }

  return `
You are a smart pet health assistant.

Give SHORT, clear, WhatsApp-friendly responses.

If the user sends ONLY text:
- Respond normally based on symptoms.

If the user sends an image:

STEP 1: Describe what you SEE in the image clearly
- color, texture, shape, abnormal signs
- be specific (e.g. "yellow loose stool", "watery texture")

STEP 2: Explain what it INDICATES
- connect visual signs to possible conditions

STEP 3: Give practical next steps

IMPORTANT:
- Do NOT jump directly to diagnosis
- Always explain reasoning from image to problem
- If unclear, say what is unclear

STRICT RULES:
- Max 8-10 lines
- Keep it concise but insightful

What I see:
(1-2 lines)

What it could mean:

Severity:

What to do:
- 2-4 bullet points

Vet: ${vet}
Cost: ${cost}
Food: ${food}

Warning:
1 short line
  `;
}

// ================= ANALYZE IMAGE WITH OPENAI =================
async function analyzeImage({ mediaUrl, userMessage, isEyeCheckFlow, vet, cost, food }) {
  try {
    // Build image input
    const imageInput = await buildImageInput(mediaUrl, userMessage);
    const isImageValid = imageInput !== null;

    // Get system prompt
    const systemPrompt = getImageSystemPrompt(
      isEyeCheckFlow && isImageValid,
      vet,
      cost,
      food
    );

    // Call OpenAI
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: imageInput || userMessage,
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

    const aiReply = response.data.choices[0].message.content;

    return {
      reply: aiReply,
      isImageValid,
    };
  } catch (err) {
    console.log("Image analysis error:", err.response?.data || err.message);
    return {
      reply: "Sorry, I could not analyze the image. Please try again.",
      isImageValid: false,
    };
  }
}

module.exports = {
  analyzeImage,
  downloadImageAsBase64,
  buildImageInput,
  getImageSystemPrompt,
};


