require("dotenv").config();
const express = require("express");
const axios = require("axios");
const logQuery = require("./logger");
const { getRecommendations, extractLocation } = require("./logic");
const getNearbyVets = require("./vets");

const app = express();
const userRepo = {}; // In-memory user data repository

// ================= HELPER: SEND TWILIO MESSAGE =================
async function sendTwilioMessage(toNumber, body) {
    await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`,
        new URLSearchParams({
            From: "whatsapp:+14155238886",
            To: toNumber.startsWith("whatsapp:") ? toNumber : `whatsapp:+${toNumber.replace(/^\+/, "")}`,
            Body: body,
        }),
        {
            auth: {
                username: process.env.TWILIO_SID,
                password: process.env.TWILIO_AUTH_TOKEN,
            },
        }
    );
}

// ================= HELPER: DOWNLOAD IMAGE AS BASE64 =================
async function downloadImageAsBase64(url) {
    try {
        const response = await axios.get(url, {
            responseType: "arraybuffer",
            auth: {
                username: process.env.TWILIO_SID,
                password: process.env.TWILIO_AUTH_TOKEN,
            },
        });
        const base64 = Buffer.from(response.data).toString("base64");
        const mimeType = response.headers["content-type"] || "image/jpeg";
        return `data:${mimeType};base64,${base64}`;
    } catch (err) {
        console.log("Image download error:", err.message);
        return null;
    }
}

// ================= HELPER: XML RESPONSE =================
function xmlReply(res, message) {
    res.set("Content-Type", "text/xml");
    return res.send(`<Response><Message>${message}</Message></Response>`);
}

// ================= INIT USER REPO =================
function initUser(fromNumber) {
    if (!userRepo[fromNumber]) {
        userRepo[fromNumber] = {
            role: null, // pet_parent | rescuer | veterinarian
            onboardingStep: "awaiting_role", // Global onboarding step tracker
            interactionHistory: [],

            // Pet Parent Info
            petInfo: {
                name: null,
                age: null,
            },

            // Rescuer Info
            rescuerInfo: {
                name: null,
                organizationName: null,
                location: null,
                contactNumber: null,
                animalTypes: null,
            },

            // Veterinarian Info
            vetInfo: {
                name: null,
                clinicName: null,
                clinicAddress: null,
                phone: null,
                email: null,
                specialization: null,
                clinicHours: null,
            },
        };
    }
}

// ================= TWILIO PARSING =================
app.use(express.text({ type: "*/*" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= WHATSAPP ROUTE =================
app.post("/whatsapp", async (req, res) => {
    try {
        let userMessage = "Hi";
        let mediaUrl = null; // Define mediaUrl here
 
        // 🔥 Extract message
        if (typeof req.body === "string") {
            const match = req.body.match(/Body=([^&]*)/);
            if (match) {
                userMessage = decodeURIComponent(match[1].replace(/\+/g, " "));
            }
            // Extract MediaUrl0
            const mediaMatch = req.body.match(/MediaUrl0=([^&]*)/);
            if (mediaMatch) {
                mediaUrl = decodeURIComponent(mediaMatch[1].replace(/\+/g, " ")).trim();
            }
        } else if (req.body && req.body.Body) {
            userMessage = req.body.Body;
            if (req.body.MediaUrl0) {
                mediaUrl = req.body.MediaUrl0;
            }
        }
 
        userMessage = userMessage.trim();
        const text = userMessage.toLowerCase();

        // ================= USER REPO INIT =================
        let fromNumber = "";

        if (typeof req.body === "string") {
            const fromMatch = req.body.match(/From=([^&]*)/);
            if (fromMatch) {
                fromNumber = decodeURIComponent(fromMatch[1].replace(/\+/g, " ")).trim();
            }
        } else if (req.body && req.body.From) {
            fromNumber = req.body.From;
        }

        console.log("📞 From Number Extracted:", fromNumber); // Debug log

        initUser(fromNumber);

        const userId = fromNumber;
        const user = userRepo[fromNumber];
        logQuery(userId, userMessage);

        // ================= EYE CHECK DETECTION =================
        const isEyeCheckFlow =
            text.includes("eye") ||
            text.includes("pupil") ||
            text.includes("vision");

        // ================= EYE CHECK GUIDE (text only, no image) =================
        if (isEyeCheckFlow && user.onboardingStep === "complete") {
            const eyeGuide = `👁️ *Advanced Eye Check*

1️⃣ *Share a picture of your pet's eyes:*
Upload a clear close-up of both eyes in natural light (no flash)

📸 *Image Capture Parameters:*
• Both eyes visible (front view)
• No flash, good natural lighting
• Sharp focus on pupil/iris
• Include eyelids & discharge area
• Optional: one dim-light shot for pupil dilation

2️⃣ *What we look for:*
• Dilated pupils → stress/pain  
• Unequal pupils → neurological (urgent)  
• Redness/swelling → infection/allergy  
• Yellow/green discharge → bacterial infection  
• Cloudiness → corneal issue/cataract  

3️⃣ *Quick triage:*
🟢 Mild redness → monitor  
🟡 Discharge → vet soon  
🔴 Unequal pupils/cloudy eye → urgent  

📤 Send the eye image when ready and I'll analyze it instantly!`;

            return xmlReply(res, eyeGuide);
        }

        // ================= GREETING → RESET & SHOW ROLE SELECTION =================
const greetings = ["hi", "hello", "hey"];
if (greetings.some((g) => text.startsWith(g))) {
    // Reset user so they can re-onboard
    delete userRepo[fromNumber]; // Delete existing user before re-initializing
    initUser(fromNumber);
    userRepo[fromNumber].onboardingStep = "awaiting_role";

    const welcome = `🐾 *Woof! Hello there! I'm PetAssist!* 🐶🐱✨

    Your AI-powered pet health companion is here!

    Before we get started, please tell me who you are:

    1️⃣ *Pet Parent* - I have a pet and need health guidance
    2️⃣ *Animal Rescuer* - I rescue and rehabilitate animals
    3️⃣ *Veterinarian* - I am a licensed vet professional

    👉 Please reply with *1*, *2*, or *3* to continue.`;

    return xmlReply(res, welcome);
}


        // ================= ROLE SELECTION =================
        if (user.onboardingStep === "awaiting_role" && ["1", "2", "3"].includes(text)) {
            if (text === "1") {
                user.role = "pet_parent";
                user.onboardingStep = "pet_awaiting_name";
                return xmlReply(res,
                    `🐾 *Welcome, Pet Parent!* 🐶🐱

I'm so excited to help keep your furry friend healthy!

First things first...
🐶 *What's your pet's name?*`
                );
            } else if (text === "2") {
                user.role = "rescuer";
                user.onboardingStep = "rescuer_awaiting_name";
                return xmlReply(res,
                    `🦺 *Welcome, Animal Rescuer!* 🐕🐈

Thank you for the amazing work you do for animals!

Let's get you set up.
👤 *What is your name?*`
                );
            } else if (text === "3") {
                user.role = "veterinarian";
                user.onboardingStep = "vet_awaiting_name";
                return xmlReply(res,
                    `🏥 *Welcome, Veterinarian!* 🩺

Great to have a medical professional on board!

Let's build your profile.
👤 *What is your full name?*`
                );
            }
        }

        // ================= INVALID ROLE INPUT =================
        if (user.onboardingStep === "awaiting_role" && !["1", "2", "3"].includes(text)) {
            return xmlReply(res,
                `⚠️ Please select a valid option:

1️⃣ *Pet Parent*
2️⃣ *Animal Rescuer*
3️⃣ *Veterinarian*

Reply with *1*, *2*, or *3*.`
            );
        }

        // =================================================================
// ================= PET PARENT ONBOARDING FLOW ===================
// =================================================================

// STEP 1: Pet Name
if (user.onboardingStep === "pet_awaiting_name") {
    const petName = userMessage.trim();

    // --- Validation ---
    if (!petName || petName.length < 1) {
        console.log("[STEP 1] Invalid pet name input:", petName);
        return xmlReply(res,
            `⚠️ Hmm, I didn't catch that!

Please tell me your pet's name. (e.g. *Bruno*, *Milo*, *Luna*)`
        );
    }

    console.log("[STEP 1] Pet name received:", petName);

    user.petInfo.name = petName;
    user.onboardingStep = "pet_awaiting_age";

    console.log("[STEP 1] Step updated to pet_awaiting_age for user:", user);

    return xmlReply(res,
        `🐾 *${petName}* — what a fantastic name! 🐾

How old is *${petName}*?
(e.g. 2 years, 6 months)`
    );
}

// STEP 2: Pet Age → Complete onboarding
if (user.onboardingStep === "pet_awaiting_age") {
    const petAge = userMessage.trim();
    const petName = user.petInfo?.name;

    console.log("[STEP 2] Entered pet_awaiting_age block");
    console.log("[STEP 2] Raw userMessage:", userMessage);
    console.log("[STEP 2] Trimmed petAge:", petAge);
    console.log("[STEP 2] petName from user.petInfo:", petName);

    // --- Guard: Check petName exists ---
    if (!petName) {
        console.log("[STEP 2] ERROR: petName is missing from user.petInfo");
        return xmlReply(res,
            `⚠️ Something went wrong. Let's start over.

🐶 *What's your pet's name?*`
        );
        user.onboardingStep = "pet_awaiting_name";
    }

    // --- Validation: Check petAge is not empty ---
    if (!petAge || petAge.length < 1) {
        console.log("[STEP 2] Invalid age input - empty or null:", petAge);
        return xmlReply(res,
            `⚠️ I didn't catch that!

How old is *${petName}*?
(e.g. *2 years*, *6 months*)`
        );
    }

    // --- Validation: Check petAge format ---
    const agePattern = /^\d+\s*(years?|months?|weeks?)$/i;
    if (!agePattern.test(petAge)) {
        console.log("[STEP 2] Invalid age format:", petAge);
        return xmlReply(res,
            `⚠️ Please use a simple format like:
- *2 years*
- *6 months*
- *3 weeks*

How old is *${petName}*?`
        );
    }

    // --- All good, complete onboarding ---
    user.petInfo.age = petAge;
    user.onboardingStep = "complete";

    console.log("[STEP 2] Onboarding complete. petInfo:", user.petInfo);
    console.log("[STEP 2] User state after completion:", user);

    return xmlReply(res,
        `🐾 Got it! *${petName}*, ${petAge} old — noted! 🐶💛

I'm all set to help keep *${petName}* healthy and happy!

Here's what I can do:
🔍 Analyze symptoms (text or photo)
👁️ Eye check & diagnosis
🏥 Find nearby vets
💊 Health & food advice

👉 Tell me what's bothering *${petName}*, or send a photo for instant analysis!`
    );
}


        // =================================================================
        // ================= MAIN AI ANALYSIS (ALL ROLES) ==================
        // =================================================================

        // Only proceed to AI analysis if onboarding is complete
        if (user.onboardingStep !== "complete") {
            return xmlReply(res,
                `⚠️ Please complete your profile setup first to continue.
Reply *Hi* to start over.`
            );
        }

        // ================= FAST ACK =================
        res.set("Content-Type", "text/xml");
        res.send(`<Response><Message>🐾 Got your message!
⏳ Analyzing now... please wait a moment.</Message></Response>`);

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

                // ================= AI IMAGE PROCESSING =================
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
                                image_url: { url: base64Image },
                            },
                        ];
                    }
                }

                // ================= OPENAI API CALL =================
                const response = await axios.post(
                    "https://api.openai.com/v1/chat/completions",
                    {
                        model: "gpt-4o",
                        messages: [
                            {
                                role: "system",
                                content: isEyeCheckFlow && isImageValid
                                    ? `You are a veterinary eye specialist. Analyze pet eye images carefully and logically.`
                                    : `You are a smart pet health assistant. Give SHORT, clear, WhatsApp-friendly responses.`,
                            },
                            {
                                role: "user",
                                content: imageInput ? imageInput : userMessage,
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

                let aiReply = response.data.choices[0].message.content;

                // 🔥 LIMIT AI RESPONSE
                if (aiReply.length > 700) {
                    aiReply = aiReply.substring(0, 700) + "...";
                }

                let reply = aiReply;

                // Update interaction history
                user.interactionHistory.push({
                    timestamp: new Date(),
                    userMessage,
                    aiReply,
                    role: user.role,
                });

                // 🔥 CTA LOGIC
                if (!isImageValid) {
                    reply += "\n\n📸 Want a more accurate diagnosis?\nSend a photo and I'll analyze it instantly.";
                } else {
                    reply += "\n\n👁️ Want a deeper diagnosis?\nReply *eye check* or send a photo of the eyes.";
                }

                // 🔥 PERSONALIZED LABEL BASED ON ROLE
                let subjectLabel = "";
                if (user.role === "pet_parent" && user.petInfo?.name) {
                    subjectLabel = ` for *${user.petInfo.name}*`;
                } else if (user.role === "rescuer") {
                    subjectLabel = ` | *Rescue Case*`;
                } else if (user.role === "veterinarian") {
                    subjectLabel = ` | *Clinical Analysis*`;
                }

                // 🔥 FINAL FORMAT LOGIC
                reply = `🐾 *PetAssist Analysis*${subjectLabel}\n\n${reply}\n\n━━━━━━━━━━━━━━━\n🏥 *Nearby Vets:*\n${vetList}\n━━━━━━━━━━━━━━━`;

                // ================= XML SAFE =================
                reply = reply
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");

                // ================= SEND FINAL REPLY =================
                await sendTwilioMessage(fromNumber, reply);
                console.log("✅ Reply sent successfully");

            } catch (err) {
                console.log("❌ Background error:", err.response?.data || err.message);
            }
        }, 0);

    } catch (error) {
        console.error(error.message);
        if (!res.headersSent) {
            res.set("Content-Type", "text/xml");
            res.send(`<Response><Message>⚠️ Oops! Something went wrong. Please try again.</Message></Response>`);
        }
    }
});

// ================= ROOT =================
app.get("/", (req, res) => {
    res.send("PetAssist API is running 🚀");
});

// ================= USER INTERACTION HISTORY ENDPOINT =================
app.get("/history", (req, res) => {
    const userId = req.query.userId;
    if (userRepo[userId]) {
        res.json(userRepo[userId].interactionHistory);
    } else {
        res.status(404).json({ message: "User not found" });
    }
});

// ================= USER PROFILE ENDPOINT =================
app.get("/profile", (req, res) => {
    const userId = req.query.userId;
    if (userRepo[userId]) {
        const user = userRepo[userId];
        res.json({
            role: user.role,
            petInfo: user.role === "pet_parent" ? user.petInfo : undefined,
            rescuerInfo: user.role === "rescuer" ? user.rescuerInfo : undefined,
            vetInfo: user.role === "veterinarian" ? user.vetInfo : undefined,
        });
    } else {
        res.status(404).json({ message: "User not found" });
    }
});

// ================= SERVER =================
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
