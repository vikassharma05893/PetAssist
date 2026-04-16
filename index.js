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

// ================= HELPER: XML RESPONSE =================
function xmlReply(res, message) {
    res.set("Content-Type", "text/xml");
    return res.send(`<Response><Message>${message}</Message></Response>`);
}

// ================= ANALYZE IMAGE FROM URL (PRESERVED) =================
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
        const contentType = response.headers["content-type"] || "image/jpeg";
        const base64 = Buffer.from(response.data, "binary").toString("base64");
        return `data:${contentType};base64,${base64}`;
    } catch (err) {
        console.log("❌ Image download error:", err.message);
        return null;
    }
}

// ================= TYPING SIMULATION VIA TWILIO =================
async function sendTypingIndicator(toNumber, fromNumber) {
    try {
        await axios.post(
            `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`,
            new URLSearchParams({
                From: fromNumber,
                To: toNumber.startsWith("whatsapp:") ? toNumber : `whatsapp:+${toNumber.replace(/^\+/, "")}`,
                Body: "🐾 PetAssist is analyzing...\n⏳ Please wait a moment.",
            }),
            {
                auth: {
                    username: process.env.TWILIO_SID,
                    password: process.env.TWILIO_AUTH_TOKEN,
                },
            }
        );
        console.log("✅ Typing indicator sent");
    } catch (err) {
        console.log("❌ Typing indicator error:", err.response?.data || err.message);
    }
}

// ================= INIT USER REPO =================
function initUser(fromNumber) {
    if (!userRepo[fromNumber]) {
        userRepo[fromNumber] = {
            role: null,               // pet_parent | rescuer | veterinarian
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

        // ================= USER REPO INIT =================
        const fromNumber = req.body && req.body.From ? req.body.From : "";
        initUser(fromNumber);

        const userId = fromNumber;
        const user = userRepo[fromNumber];
        logQuery(userId, userMessage);

        // ================= MEDIA URL EXTRACTION =================
        let mediaUrl = null;
        if (typeof req.body === "string") {
            const mediaMatch = req.body.match(/MediaUrl0=([^&]*)/);
            if (mediaMatch) {
                mediaUrl = decodeURIComponent(mediaMatch[1]);
            }
        } else if (req.body) {
            mediaUrl = req.body.MediaUrl0 || req.body.MediaUrl || null;
        }
        console.log("📸 Media URL:", mediaUrl);

        // ================= EYE CHECK DETECTION =================
        const isEyeCheckFlow =
            text.includes("eye") ||
            text.includes("pupil") ||
            text.includes("vision");

        // ================= EYE CHECK GUIDE (text only, no image) =================
        if (isEyeCheckFlow && !mediaUrl && user.onboardingStep === "complete") {
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
        if (greetings.some((g) => text.startsWith(g)) && !mediaUrl) {
            // Reset user so they can re-onboard
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
        if (user.onboardingStep === "pet_awaiting_name" && !mediaUrl) {
            const petName = userMessage.trim();
            user.petInfo.name = petName;
            user.onboardingStep = "pet_awaiting_age";

            return xmlReply(res,
                `🐾 *${petName}* — what a fantastic name! 🐾

How old is *${petName}*?
(e.g. 2 years, 6 months)`
            );
        }

        // STEP 2: Pet Age → Complete onboarding
        if (user.onboardingStep === "pet_awaiting_age" && !mediaUrl) {
            const petAge = userMessage.trim();
            const petName = user.petInfo.name;

            console.log("Received pet age:", petAge);
            
            user.petInfo.age = petAge;
            user.onboardingStep = "complete";

            console.log("Onboarding complete for:", petName);

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
        // ================= ANIMAL RESCUER ONBOARDING FLOW ===============
        // =================================================================

        // STEP 1: Rescuer Name
        if (user.onboardingStep === "rescuer_awaiting_name" && !mediaUrl) {
            user.rescuerInfo.name = userMessage.trim();
            user.onboardingStep = "rescuer_awaiting_org";

            return xmlReply(res,
                `👋 Nice to meet you, *${user.rescuerInfo.name}*!

🏢 What is the name of your *rescue organization*?
(If independent, reply "Independent")`
            );
        }

        // STEP 2: Organization Name
        if (user.onboardingStep === "rescuer_awaiting_org" && !mediaUrl) {
            user.rescuerInfo.organizationName = userMessage.trim();
            user.onboardingStep = "rescuer_awaiting_location";

            return xmlReply(res,
                `Got it! 📍 What *city or area* do you operate in?`
            );
        }

        // STEP 3: Location
        if (user.onboardingStep === "rescuer_awaiting_location" && !mediaUrl) {
            user.rescuerInfo.location = userMessage.trim();
            user.onboardingStep = "rescuer_awaiting_contact";

            return xmlReply(res,
                `📞 Please provide your *contact number* for coordination.`
            );
        }

        // STEP 4: Contact Number
        if (user.onboardingStep === "rescuer_awaiting_contact" && !mediaUrl) {
            user.rescuerInfo.contactNumber = userMessage.trim();
            user.onboardingStep = "rescuer_awaiting_animal_types";

            return xmlReply(res,
                `🐾 What *types of animals* do you typically rescue?
(e.g. Dogs, Cats, Birds, Wild Animals, All)`
            );
        }

        // STEP 5: Animal Types → Complete onboarding
        if (user.onboardingStep === "rescuer_awaiting_animal_types" && !mediaUrl) {
            user.rescuerInfo.animalTypes = userMessage.trim();
            user.onboardingStep = "complete";

            return xmlReply(res,
                `🦺 *Profile Complete, ${user.rescuerInfo.name}!* 🐾

Here's a summary of your profile:
👤 Name: ${user.rescuerInfo.name}
🏢 Organization: ${user.rescuerInfo.organizationName}
📍 Location: ${user.rescuerInfo.location}
📞 Contact: ${user.rescuerInfo.contactNumber}
🐾 Animals: ${user.rescuerInfo.animalTypes}

Here's how I can help you:
🔍 Analyze injured/sick animal photos
🏥 Find nearby emergency vets
💊 First-aid guidance for rescued animals
👁️ Eye & wound assessment

👉 Send a photo or describe the animal's condition to get started!`
            );
        }

        // =================================================================
        // ================= VETERINARIAN ONBOARDING FLOW =================
        // =================================================================

        // STEP 1: Vet Name
        if (user.onboardingStep === "vet_awaiting_name" && !mediaUrl) {
            user.vetInfo.name = userMessage.trim();
            user.onboardingStep = "vet_awaiting_clinic_name";

            return xmlReply(res,
                `🩺 Welcome, Dr. *${user.vetInfo.name}*!

🏥 What is the name of your *clinic or hospital*?`
            );
        }

        // STEP 2: Clinic Name
        if (user.onboardingStep === "vet_awaiting_clinic_name" && !mediaUrl) {
            user.vetInfo.clinicName = userMessage.trim();
            user.onboardingStep = "vet_awaiting_clinic_address";

            return xmlReply(res,
                `📍 What is your *clinic's address*?`
            );
        }

        // STEP 3: Clinic Address
        if (user.onboardingStep === "vet_awaiting_clinic_address" && !mediaUrl) {
            user.vetInfo.clinicAddress = userMessage.trim();
            user.onboardingStep = "vet_awaiting_phone";

            return xmlReply(res,
                `📞 Please provide your *clinic's phone number*.`
            );
        }

        // STEP 4: Phone
        if (user.onboardingStep === "vet_awaiting_phone" && !mediaUrl) {
            user.vetInfo.phone = userMessage.trim();
            user.onboardingStep = "vet_awaiting_email";

            return xmlReply(res,
                `📧 Please provide your *professional email address*.`
            );
        }

        // STEP 5: Email
        if (user.onboardingStep === "vet_awaiting_email" && !mediaUrl) {
            user.vetInfo.email = userMessage.trim();
            user.onboardingStep = "vet_awaiting_specialization";

            return xmlReply(res,
                `🔬 What is your *area of specialization*?
(e.g. General Practice, Surgery, Dermatology, Oncology)`
            );
        }

        // STEP 6: Specialization
        if (user.onboardingStep === "vet_awaiting_specialization" && !mediaUrl) {
            user.vetInfo.specialization = userMessage.trim();
            user.onboardingStep = "vet_awaiting_clinic_hours";

            return xmlReply(res,
                `🕐 What are your *clinic operating hours*?
(e.g. Mon-Fri 9am-6pm, Sat 9am-1pm)`
            );
        }

        // STEP 7: Clinic Hours → Complete onboarding
        if (user.onboardingStep === "vet_awaiting_clinic_hours" && !mediaUrl) {
            user.vetInfo.clinicHours = userMessage.trim();
            user.onboardingStep = "complete";

            return xmlReply(res,
                `🏥 *Profile Complete, Dr. ${user.vetInfo.name}!* 🩺

Here's a summary of your profile:
👤 Name: Dr. ${user.vetInfo.name}
🏥 Clinic: ${user.vetInfo.clinicName}
📍 Address: ${user.vetInfo.clinicAddress}
📞 Phone: ${user.vetInfo.phone}
📧 Email: ${user.vetInfo.email}
🔬 Specialization: ${user.vetInfo.specialization}
🕐 Hours: ${user.vetInfo.clinicHours}

Here's how I can assist you:
🔍 AI-assisted symptom & image analysis
📋 Patient case management
👁️ Eye & wound diagnostics
💊 Drug & treatment reference

👉 Send a patient's photo or describe their symptoms to begin!`
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

                // ================= ROLE-BASED SYSTEM PROMPT =================
                const roleContext = user.role === "veterinarian"
                    ? `The user is a licensed veterinarian (Dr. ${user.vetInfo.name}, specializing in ${user.vetInfo.specialization}). Use technical/clinical language.`
                    : user.role === "rescuer"
                    ? `The user is an animal rescuer (${user.rescuerInfo.name}, ${user.rescuerInfo.organizationName}). Focus on first-aid, triage, and emergency guidance.`
                    : `The user is a pet parent. Their pet's name is ${user.petInfo?.name || "unknown"}, age ${user.petInfo?.age || "unknown"}. Use simple, friendly language.`;

                // ================= OPENAI API CALL =================
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
${roleContext}

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
${roleContext}

Give SHORT, clear, WhatsApp-friendly responses.

If the user sends ONLY text:
- Respond normally based on symptoms.

If the user sends an image:

STEP 1: Describe what you SEE in the image clearly
- color, texture, shape, abnormal signs

STEP 2: Explain what it INDICATES
- connect visual signs to possible conditions

STEP 3: Give practical next steps

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

                // 🔥 DETECT IMAGE + TEXT
                const isGreeting = text.startsWith("hi") || text.startsWith("hello") || text.startsWith("hey");
                const isImageWithText = isImageValid &&
                    userMessage &&
                    userMessage.trim().length > 3 &&
                    !["hi", "hello", "hey"].includes(text);

                // 🔥 FINAL FORMAT LOGIC
                if (isImageWithText && !isGreeting) {
                    reply = `🐾 *PetAssist Analysis*${subjectLabel}

${reply}

━━━━━━━━━━━━━━━
🏥 *Nearby Vets:*
${vetList}
━━━━━━━━━━━━━━━`;
                } else if (!isImageValid) {
                    reply = `🐾 *PetAssist Analysis*${subjectLabel}

${reply}

━━━━━━━━━━━━━━━
🏥 *Nearby Vets:*
${vetList}
━━━━━━━━━━━━━━━`;
                } else {
                    reply = `🐾 *PetAssist Analysis*${subjectLabel}

${reply}`;
                }

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
