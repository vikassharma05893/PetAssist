require("dotenv").config();
const express = require("express");
const axios = require("axios");
const logQuery = require("./logger");
const { getRecommendations, extractLocation } = require("./logic");
const getNearbyVets = require("./vets");

const app = express();
const userRepo = {}; // In-memory user data repository

// Function to analyze images using provided parameters
async function analyzeImageFromUrl(mediaUrl, userMessage, isEyeCheckFlow, vet, cost, food) {
    try {
        const { reply, isImageValid } = await analyzeImage({
            mediaUrl,
            userMessage,
            isEyeCheckFlow,
            vet,
            cost,
            food,
        });

        return { reply, isImageValid };
    } catch (error) {
        console.error("Error analyzing the image:", error);
        throw new Error("Unable to analyze the image.");
    }
}

// Function to download image and convert to base64
async function downloadImageAsBase64(url) {
    try {
        const response = await axios.get(url, {
            responseType: "arraybuffer",
            auth: {
                username: process.env.TWILIO_SID,
                password: process.env.TWILIO_AUTH_TOKEN,
            },
        });

        // ✅ Detect actual image type (jpeg/png/webp)
        const contentType = response.headers["content-type"] || "image/jpeg";
        const base64 = Buffer.from(response.data, "binary").toString("base64");

        return `data:${contentType};base64,${base64}`;
    } catch (err) {
        console.log("❌ Image download error:", err.message);
        return null;
    }
}

// Twilio parsing
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

        // Check for user ID and initialize user repository if not present
        const fromNumber = req.body.From ? req.body.From : ""; // Extract from Twilio request
        if (!userRepo[fromNumber]) {
            userRepo[fromNumber] = { interactionHistory: [] }; // Initialize repo for new user
        }

        const userId = fromNumber; // Assuming From number is a unique user ID

        // Log the current inquiry
        logQuery(userId, userMessage);

        // ✅ STEP 1: AI EYE CONTEXT DETECTION
        const isEyeCheckFlow =
            text.includes("eye") ||
            text.includes("pupil") ||
            text.includes("vision");

        // ================= EYE CHECK FLOW =================
        if (isEyeCheckFlow) {
            const eyeGuide = `
👁️ *Advanced Eye Check*

1️⃣ Share a picture of your pet’s eyes:
Upload a clear close-up of both eyes in natural light (no flash)

2️⃣ Capture properly:
• Both eyes visible (front view)
• No flash, good lighting
• Sharp focus on pupil/iris
• Include eyelids/discharge
• Optional: one dim-light photo

3️⃣ What we look for:
• Dilated pupils → stress/pain  
• Unequal pupils → neurological (urgent)  
• Redness/swelling → infection/allergy  
• Yellow/green discharge → bacterial infection  
• Cloudiness → corneal issue/cataract  

4️⃣ Quick triage:
🟢 Mild redness → monitor  
🟡 Discharge → vet soon  
🔴 Unequal pupils/cloudy eye → urgent  
`;
            res.set("Content-Type", "text/xml");
            return res.send(`<Response><Message>${eyeGuide}</Message></Response>`);
        }

        // ================= MEDIA URL EXTRACTION =================
        let mediaUrl = null;

        if (typeof req.body === "string") {
            const mediaMatch = req.body.match(/MediaUrl0=([^&]*)/);
            if (mediaMatch) {
                mediaUrl = decodeURIComponent(mediaMatch[1]);
            }
        } else if (req.body) {
            mediaUrl = req.body.MediaUrl0 || null;
        }

        console.log("📸 Media URL:", mediaUrl);

        // ================= GREETING =================
        const greetings = ["hi", "hello", "hey"];
        if (greetings.some((g) => text.startsWith(g))) {
            const welcome = `
🐾 Hi! I'm PetAssist 🐶🐱
Tell me what's wrong with your pet and I’ll help you instantly.
`;
            res.set("Content-Type", "text/xml");
            return res.send(`<Response><Message>${welcome}</Message></Response>`);
        }

    } catch (error) {
        console.error("Error processing WhatsApp request:", error);
        res.status(500).send("Internal Server Error");
    }
});


        // ================= FAST ACK =================
        res.set("Content-Type", "text/xml");
        res.send(`<Response><Message>🐾 Got your message. Working on it...</Message></Response>`);

        // ================= BACKGROUND PROCESS =================
        setTimeout(async () => {
            try {
                // ================= LOGIC =================
                const { cost, vet, food } = getRecommendations(userMessage);
                const location = extractLocation(userMessage);

                let vetList = "No nearby vets found";
                try {
                    const vets = await getNearbyVets(location);
                    if (vets.length > 0) {
                        vetList = vets
                            .slice(0, 3)
                            .map((v, i) =>
                                "🐾 *" + (i + 1) + ". " + v.name + "* (⭐ " + v.rating + ")\n" +
                                "📍 Tap to search → maps.google.com/?q=" + encodeURIComponent(v.name)
                            )
                            .join("\n\n");
                    }
                } catch (e) {
                    console.log("Vet error:", e.message);
                }

                // ================= AI =================
                let imageInput = null;
                let isImageValid = false;

                if (mediaUrl) {
                    const base64Image = await downloadImageAsBase64(mediaUrl);
                    if (base64Image) {
                        isImageValid = true;
                        imageInput = [
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
                    }
                }

                const response = await axios.post(
                    "https://api.openai.com/v1/chat/completions",
                    {
                        model: "gpt-4o",
                        messages: [
                            {
                                role: "system",
                                content: isEyeCheckFlow && isImageValid
                                    ? `
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

👁️ Eye Observation:
(clear, specific description)

🧠 What it means:
(connect signs → condition)

🚨 Severity:
(Low / Medium / High / Emergency)

📋 What to do:
- 2–3 simple actionable steps

⚠️ Warning:
(1 short urgent note if needed)

Rules:
- Be precise
- No guessing
- No generic answers
`
                                    : `
You are a smart pet health assistant.

Give SHORT, clear, WhatsApp-friendly responses.

If the user sends ONLY text:
- Respond normally based on symptoms.

If the user sends an image:

STEP 1: Describe what you SEE in the image clearly
- color, texture, shape, abnormal signs
- be specific (e.g. "yellow loose stool", "watery texture", "mucus visible")

STEP 2: Explain what it INDICATES
- connect visual signs to possible conditions

STEP 3: Give practical next steps

IMPORTANT:
- Do NOT jump directly to diagnosis
- Always explain reasoning from image → problem
- If unclear, say what is unclear

If the user sends BOTH text + image:
- Combine both inputs

STRICT RULES:
- Max 8–10 lines
- Keep it concise but insightful

🔍 What I see:
(1–2 lines)

🧠 What it could mean:

🚨 Severity:

📋 What to do:
- 2–4 bullet points

🏥 Vet: ${vet}
💰 Cost: ${cost}
🍗 Food: ${food}

⚠️ Warning:
1 short line
`,
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

                // ✅ SINGLE declaration (FIXED)
                let aiReply = response.data.choices[0].message.content;

                // 🔥 LIMIT AI RESPONSE
                if (aiReply.length > 700) {
                    aiReply = aiReply.substring(0, 700) + "...";
                }

                // 🔥 BASE REPLY
                let reply = aiReply;

                // Update user interaction history
                userRepo[userId].interactionHistory.push({
                    timestamp: new Date(),
                    userMessage,
                    aiReply,
                });

                // 🔥 CTA LOGIC (CLEAN)
                if (!isImageValid) {
                    reply += "\n\n📸 Want a more accurate diagnosis?\nSend a photo of your pet and I’ll analyze it.";
                } else {
                    reply += "\n\n👁️ Want a deeper diagnosis?\nReply *eye check* or send a photo of your pet’s eyes.";
                }

                // 🔥 DETECT GREETING
                const isGreeting = text.startsWith("hi") || text.startsWith("hello") || text.startsWith("hey");

                // 🔥 DETECT IMAGE + TEXT
                const isImageWithText = isImageValid &&
                    userMessage &&
                    userMessage.trim().length > 3 &&
                    !["hi", "hello", "hey"].includes(text);

                // 🔥 FINAL FORMAT LOGIC
                // ✅ IMAGE + TEXT FIRST MESSAGE → Greeting + Vets
                if (isImageWithText && !isGreeting) {
                    reply = `🐾 Hi! I'm PetAssist 🐶🐱

Here's what I found:

${reply}

━━━━━━━━━━━━━━━
🏥 Nearby Vets:
${vetList}
━━━━━━━━━━━━━━━`;
                }
                // ✅ TEXT ONLY → Analysis + Vets
                else if (!isImageValid) {
                    reply = `🐾 PetAssist Analysis

${reply}

━━━━━━━━━━━━━━━
🏥 Nearby Vets:
${vetList}
━━━━━━━━━━━━━`;
                }
                // ✅ IMAGE ONLY → Analysis only
                else {
                    reply = `🐾 PetAssist Analysis

${reply}`;
                }

                // ================= XML SAFE =================
                reply = reply
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");

                // ================= SEND VIA TWILIO =================
                await axios.post(
                    `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`,
                    new URLSearchParams({
                        From: "whatsapp:+14155238886",
                        To: fromNumber.startsWith("whatsapp:") ? fromNumber : `whatsapp:+${fromNumber.replace(/^\+/, '')}`,

                        Body: reply,
                    }),
                    {
                        auth: {
                            username: process.env.TWILIO_SID,
                            password: process.env.TWILIO_AUTH_TOKEN,
                        },
                    }
                );

                console.log("✅ Reply sent successfully");
            } catch (err) {
                console.log("❌ Background error:", err.response?.data || err.message);
            }
        }, 0);
    } catch (error) {
        console.error(error.message);
        if (!res.headersSent) {
            res.set("Content-Type", "text/xml");
            res.send(`<Response><Message>⚠️ Error</Message></Response>`);
        }
    }
});

// ================= ROOT =================
app.get("/", (req, res) => {
    res.send("PetAssist API is running 🚀");
});

// ================= USER INTERACTION HISTORY ENDPOINT =================
app.get("/history", (req, res) => {
    const userId = req.query.userId; // Expect userId to be passed as a query parameter
    if (userRepo[userId]) {
        res.json(userRepo[userId].interactionHistory);
    } else {
        res.status(404).json({ message: "User not found" });
    }
});

// ================= SERVER =================
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
