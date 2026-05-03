require("dotenv").config();
const express = require("express");
const axios = require("axios");
const logQuery = require("./logger");
const { getRecommendations, extractLocation } = require("./logic");
const getNearbyVets = require("./vets");

const app = express();
const userRepo = {};
const fs = require("fs");
const REPO_FILE = "./userRepo.json";

if (fs.existsSync(REPO_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(REPO_FILE, "utf8"));
        Object.assign(userRepo, saved);
        console.log("✅ Sessions restored:", Object.keys(userRepo).length);
    } catch(e) {
        console.log("⚠️ Could not restore sessions:", e.message);
    }
}

function saveRepo() {
    try {
        fs.writeFileSync(REPO_FILE, JSON.stringify(userRepo, null, 2));
    } catch(e) {
        console.log("⚠️ Could not save sessions:", e.message);
    }
}

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

// ================= INIT USER REPO =================
function initUser(fromNumber) {
    if (!userRepo[fromNumber]) {
        userRepo[fromNumber] = {
            role: null,
            onboardingStep: "awaiting_role",
            interactionHistory: [],
            lastActiveAt: null,
            sessionState: "active",

            petInfo: {
                name: null,
                species: null,
                breed: null,
                age: null,
                gender: null,
                neutered: null,
                location: null,
            },

            rescuerInfo: {
                name: null,
                organizationName: null,
                location: null,
                contactNumber: null,
                animalTypes: null,
                rescueHistory: [],
            },

            vetInfo: {
                name: null,
                clinicName: null,
                clinicAddress: null,
                phone: null,
                email: null,
                specialization: null,
                clinicHours: null,
                caseHistory: [],
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

        // ================= GUARD: IGNORE EMPTY MESSAGES =================
        if (!userMessage || userMessage.length === 0) {
            res.set("Content-Type", "text/xml");
            return res.send(`<Response></Response>`);
        }

        // ================= USER REPO INIT =================
        let fromNumber = "";
        if (typeof req.body === "string") {
            const fromMatch = req.body.match(/From=([^&]*)/);
            if (fromMatch) {
                fromNumber = decodeURIComponent(fromMatch[1]).trim();
            }
        } else if (req.body && req.body.From) {
            fromNumber = req.body.From;
        }

        // ================= DEBUG LOG =================
        console.log("📞 fromNumber:", fromNumber);
        console.log("📝 text:", text);
        console.log("📋 userRepo keys:", Object.keys(userRepo));

        // ================= EXIT HANDLER =================
        if (["exit", "quit", "bye", "restart"].includes(text)) {
            if (userRepo[fromNumber] && userRepo[fromNumber].sessionState !== "exit_confirm") {
                userRepo[fromNumber].sessionState = "exit_confirm";
                saveRepo();
                return xmlReply(res,
                    `⚠️ *Are you sure you want to end the chat?*

Your profile and history will be cleared.

Reply *yes* to confirm or *no* to continue.`
                );
            } else if (!userRepo[fromNumber]) {
                return xmlReply(res,
                    `👋 No active session found.

Say *Hi* anytime to start fresh! 🐾`
                );
            }
        }

        // ================= EXIT CONFIRM HANDLER =================
        if (userRepo[fromNumber] && userRepo[fromNumber].sessionState === "exit_confirm") {
            if (text === "yes") {
                delete userRepo[fromNumber];
                saveRepo();
                return xmlReply(res,
                    `👋 *Chat Ended!*

Your session has been cleared.

Say *Hi* anytime to start fresh! 🐾`
                );
            } else if (text === "no") {
                userRepo[fromNumber].sessionState = "active";
                saveRepo();
                return xmlReply(res, `✅ *Glad you're staying!* Just continue where you left off. 🐾`);
            }
        }

        const userId = fromNumber;
        const isNewUser = !userRepo[fromNumber];
initUser(fromNumber);
if (isNewUser) saveRepo();
let user = userRepo[fromNumber];
        try { logQuery(userId, userMessage); } catch(e) { console.log("logQuery error:", e.message); }

        // ================= IDLE DETECTION =================
        const now = Date.now();
        const idleThreshold = 5 * 60 * 1000; // 5 minutes
const isUserIdle = user.onboardingStep === "complete" &&
    user.lastActiveAt && (now - user.lastActiveAt) > idleThreshold;

        if (isUserIdle && !["exit", "quit", "bye", "restart", "hi", "hello", "hey"].includes(text)) {
            user.lastActiveAt = now;
            console.log("🔍 onboardingStep:", user.onboardingStep, "| sessionState:", user.sessionState, "| role:", user.role);

            if (user.onboardingStep === "awaiting_role") {
                return xmlReply(res, `👋 Still there? Just reply *1*, *2*, or *3* to get started with PetAssist! 🐾`);
            }

            if (user.onboardingStep === "pet_awaiting_name") {
                return xmlReply(res, `👋 Still there? I just need your *pet's name* to get started! 🐾`);
            }

            if (user.onboardingStep === "pet_awaiting_age") {
                return xmlReply(res, `👋 Still there? How old is *${user.petInfo.name || "your pet"}*? Just type their age and we're good to go!`);
            }

            if (user.onboardingStep === "pet_awaiting_location") {
                return xmlReply(res, `👋 Still there? Please share your *location* so I can find nearby vets for *${user.petInfo.name || "your pet"}*!\n\nTap 📎 → Location → Send current location.`);
            }

            if (user.onboardingStep === "complete" && user.role === "pet_parent") {
                return xmlReply(res, `👋 Are you still there?\n\n🐾 Is *${user.petInfo.name}* okay? Describe the symptoms or send a photo and I'll help right away!`);
            }

            if (user.onboardingStep === "rescuer_awaiting_name") {
                return xmlReply(res, `👋 Still there? Just share your *name* to complete your rescuer setup! 🦺`);
            }

            if (user.onboardingStep === "rescuer_awaiting_org") {
                return xmlReply(res, `👋 Still there? What's your *rescue organization name*? (Type "Independent" if solo)`);
            }

            if (user.onboardingStep === "rescuer_awaiting_location") {
                return xmlReply(res, `👋 Still there? Which *city or area* do you operate in?`);
            }

            if (user.onboardingStep === "rescuer_awaiting_contact") {
                return xmlReply(res, `👋 Still there? Just need your *contact number* to finish setup!`);
            }

            if (user.onboardingStep === "rescuer_awaiting_animal_types") {
                return xmlReply(res, `👋 Almost done! What *types of animals* do you typically rescue?`);
            }

            if (user.onboardingStep === "complete" && user.role === "rescuer") {
                if (user.sessionState === "rescuer_returning") {
                    return xmlReply(res, `👋 Still there, *${user.rescuerInfo.name}*? Reply *1* for a new case or *2* to view rescue history! 🦺`);
                }
                return xmlReply(res, `👋 Still with us, *${user.rescuerInfo.name}*?\n\n🦺 If you have an animal that needs urgent help, send a photo right away!`);
            }

            if (user.onboardingStep === "vet_awaiting_name") {
                return xmlReply(res, `👋 Still there, Doctor? Just need your *full name* to set up your profile! 🏥`);
            }

            if (user.onboardingStep === "vet_awaiting_clinic_name") {
                return xmlReply(res, `👋 Still there? What's your *clinic or hospital name*?`);
            }

            if (user.onboardingStep === "vet_awaiting_clinic_address") {
                return xmlReply(res, `👋 Still there? What's your *clinic address*?`);
            }

            if (user.onboardingStep === "vet_awaiting_phone") {
                return xmlReply(res, `👋 Still there? Just need your *clinic phone number*!`);
            }

            if (user.onboardingStep === "vet_awaiting_email") {
                return xmlReply(res, `👋 Still there? What's your *professional email address*?`);
            }

            if (user.onboardingStep === "vet_awaiting_specialization") {
                return xmlReply(res, `👋 Still there? What's your *area of specialization*?`);
            }

            if (user.onboardingStep === "vet_awaiting_clinic_hours") {
                return xmlReply(res, `👋 Almost done, Doctor! Just need your *clinic operating hours*!`);
            }

            if (user.onboardingStep === "complete" && user.role === "veterinarian") {
                if (user.sessionState === "vet_dashboard") {
                    return xmlReply(res, `👋 Dr. *${user.vetInfo.name}*, still there? Type *menu* to return to your Clinical Dashboard!`);
                }
                if (user.sessionState === "vet_case_animal_name") {
                    return xmlReply(res, `👋 Still logging the case? What's the *animal's name and species*?`);
                }
                if (user.sessionState === "vet_case_age_weight") {
                    return xmlReply(res, `👋 Still there? What's the *patient's age and weight*?`);
                }
                if (user.sessionState === "vet_case_complaint") {
                    return xmlReply(res, `👋 Still there? What's the *chief complaint and symptoms*?`);
                }
                if (user.sessionState === "vet_case_observations") {
                    return xmlReply(res, `👋 Almost done with the case! Any *clinical observations or vitals*?`);
                }
                if (user.sessionState === "vet_drug_reference") {
                    return xmlReply(res, `👋 Dr. *${user.vetInfo.name}*, still looking up a drug? Type the *drug name or condition*!`);
                }
                if (user.sessionState === "vet_summary_select") {
                    return xmlReply(res, `👋 Still there? Reply with a *case number* to generate the summary!`);
                }
                if (user.sessionState === "vet_returning") {
                    return xmlReply(res, `👋 Dr. *${user.vetInfo.name}*, still there? Reply *1* for a new case or *2* to review case files!`);
                }
                return xmlReply(res, `👋 Dr. *${user.vetInfo.name}*, are you still there? Type *menu* to return to your Clinical Dashboard! 🏥`);
            }
        }

        user.lastActiveAt = now;
        console.log("🔍 onboardingStep:", user.onboardingStep, "| sessionState:", user.sessionState, "| role:", user.role);

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

        // ================= FIND VET COMMAND =================
        if (text === "find vet" && user.onboardingStep === "complete") {
            let location = null;
            if (user.role === "pet_parent" && user.petInfo.location) {
                location = user.petInfo.location.type === "pin"
                    ? `${user.petInfo.location.latitude},${user.petInfo.location.longitude}`
                    : user.petInfo.location.text;
            } else if (user.role === "rescuer" && user.rescuerInfo.location) {
                location = user.rescuerInfo.location;
            }

            if (!location) {
                return xmlReply(res, `📍 Please share your *location* first so I can find nearby vets!\n\nTap 📎 → Location → Send current location.`);
            }

            try {
                const vets = await getNearbyVets(location);
                if (!vets || vets.length === 0) {
                    return xmlReply(res, `⚠️ No nearby vets found for your location. Try typing your city name.`);
                }
                const vetList = vets.slice(0, 5).map((v, i) =>
                    `${i + 1}. 🏥 *${v.name}* (⭐ ${v.rating})\n📍 maps.google.com/?q=${encodeURIComponent(v.name)}`
                ).join("\n\n");
                return xmlReply(res, `🏥 *Nearby Vets:*\n\n${vetList}\n\n_Reply *find vet* anytime to refresh this list._`);
            } catch(e) {
                return xmlReply(res, `⚠️ Could not fetch vets right now. Please try again shortly.`);
            }
        }

        // ================= GREETING → RESET & SHOW ROLE SELECTION =================
        const greetings = ["hi", "hello", "hey"];
        console.log("🔍 greeting check:", greetings.some((g) => text.startsWith(g)), "mediaUrl:", mediaUrl);
        if (greetings.some((g) => text.startsWith(g)) && !mediaUrl) {

            user = userRepo[fromNumber];

            // Returning user — onboarding complete
            if (user && user.onboardingStep === "complete") {
                user.lastActiveAt = Date.now();
                saveRepo();

                if (user.role === "pet_parent") {
                    return xmlReply(res,
                        `🐾 Welcome back! How is *${user.petInfo.name}* doing today?

👇 *What would you like to do?*
━━━━━━━━━━━━━━━
1️⃣ 🩺 Describe symptoms
2️⃣ 📸 Send a photo
3️⃣ 👁️ Eye check
4️⃣ 🏥 Find a vet
━━━━━━━━━━━━━━━`
                    );
                }

                if (user.role === "rescuer") {
                    user.sessionState = "rescuer_returning";
                    saveRepo();
                    return xmlReply(res,
                        `🦺 Welcome back, *${user.rescuerInfo.name}*!

👇 *What would you like to do?*
━━━━━━━━━━━━━━━
1️⃣ 🆕 New rescue case
2️⃣ 📋 View rescue history
3️⃣ 🏥 Find nearest vet
━━━━━━━━━━━━━━━`
                    );
                }

                if (user.role === "veterinarian") {
                    user.sessionState = "vet_returning";
                    saveRepo();
                    return xmlReply(res,
                        `🏥 Welcome back, Dr. *${user.vetInfo.name}*!

👇 *What would you like to do?*
━━━━━━━━━━━━━━━
1️⃣ Start a new patient case
2️⃣ Review an earlier case file
━━━━━━━━━━━━━━━`
                    );
                }
            }

            // Mid onboarding — user said hi
            if (user && user.onboardingStep !== "awaiting_role" && user.onboardingStep !== "complete") {
                user.sessionState = "mid_convo_prompt";
                user.lastActiveAt = Date.now();
                saveRepo();
                return xmlReply(res,
                    `👋 Looks like we were in the middle of setting up your profile!

━━━━━━━━━━━━━━━
1️⃣ ▶️ Continue where I left off
2️⃣ 🔄 Start fresh
━━━━━━━━━━━━━━━`
                );
            }

            // Fresh user or cleared session
            initUser(fromNumber);
            user = userRepo[fromNumber];
            user.onboardingStep = "awaiting_role";
            user.lastActiveAt = Date.now();
            saveRepo();
            return xmlReply(res,
                `🐾 *Woof! Hello there, I'm PetAssist!* 🐶🐱✨

_Your AI-powered pet health companion is here!_

━━━━━━━━━━━━━━━━━━━━
👇 *Tell me who you are:*

1️⃣ 🐾 *Pet Parent*
_I have a pet & need health guidance_

2️⃣ 🦺 *Animal Rescuer*
_I rescue & rehabilitate animals_

3️⃣ 🏥 *Veterinarian*
_I am a licensed vet professional_

━━━━━━━━━━━━━━━━━━━━
👉 _Reply with *1*, *2* or *3* to continue_`
            );
        }


        // ================= MID CONVO PROMPT HANDLER =================
        if (user.sessionState === "mid_convo_prompt" && ["1", "2"].includes(text)) {
            if (text === "1") {
                user.sessionState = "active";
                user.lastActiveAt = Date.now();
                return xmlReply(res,
                    `✅ Continuing where you left off!

Just pick up from where we stopped. 🐾`
                );
            } else {
                user.sessionState = "active";
                user.onboardingStep = "awaiting_role";
                user.role = null;
                user.lastActiveAt = Date.now();
                return xmlReply(res,
                    `🐾 Starting fresh!

Who are you?
1️⃣ Pet Parent
2️⃣ Animal Rescuer
3️⃣ Veterinarian`
                );
            }
        }

        // ================= IDLE PROMPT HANDLER =================
        if (user.sessionState === "idle_prompt" && ["1", "2"].includes(text)) {
            if (text === "1") {
                user.sessionState = "active";
                user.lastActiveAt = Date.now();
                return xmlReply(res,
                    `✅ Continuing your session!

What can I help you with today?`
                );
            } else {
                user.sessionState = "active";
                user.onboardingStep = "awaiting_role";
                user.lastActiveAt = Date.now();
                return xmlReply(res,
                    `🐾 Starting fresh!

Who are you?
1️⃣ Pet Parent
2️⃣ Animal Rescuer
3️⃣ Veterinarian`
                );
            }
        }

        // ================= RESCUER RETURNING HANDLER =================
        if (user.sessionState === "rescuer_returning" && ["1", "2", "3"].includes(text)) {
            user.sessionState = "active";
            user.lastActiveAt = Date.now();

            if (text === "1") {
                return xmlReply(res,
                    `🦺 *New Rescue Case*

Describe the animal's condition or send a photo for instant triage analysis!`
                );
            } else if (text === "2") {
                const history = user.rescuerInfo.rescueHistory;
                if (!history || history.length === 0) {
                    return xmlReply(res, `📋 No earlier rescue cases found yet.

Describe a new case or send a photo to get started!`);
                }
                const caseList = history.slice(-5).reverse().map((c, i) =>
                    `${i + 1}. 🕐 ${new Date(c.timestamp).toLocaleString()}\n📝 ${c.userMessage.substring(0, 60)}...`
                ).join("\n\n");
                return xmlReply(res, `📋 *Your Recent Rescue Cases:*\n\n${caseList}`);
            } else if (text === "3") {
                user.sessionState = "active";
                return xmlReply(res, `🏥 Type *find vet* to locate the nearest emergency vet!`);
            }
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
            user.petInfo.name = userMessage.trim();
            user.onboardingStep = "pet_awaiting_species";
            return xmlReply(res,
                `🐾 *${user.petInfo.name}* — what a fantastic name! 🐾

🐾 *What type of pet is ${user.petInfo.name}?*
━━━━━━━━━━━━━━━
1️⃣ 🐶 Dog
2️⃣ 🐱 Cat
3️⃣ 🐦 Bird
4️⃣ 🐇 Rabbit
5️⃣ 🐾 Other
━━━━━━━━━━━━━━━
_Reply with 1, 2, 3, 4 or 5_`
            );
        }

        // STEP 2: Pet Species
        if (user.onboardingStep === "pet_awaiting_species" && !mediaUrl) {
            const speciesMap = { "1": "Dog", "2": "Cat", "3": "Bird", "4": "Rabbit", "5": "Other" };
            user.petInfo.species = speciesMap[text] || userMessage.trim();

            if (text === "5") {
                user.onboardingStep = "pet_awaiting_species_other";
                return xmlReply(res,
                    `🐾 What animal is *${user.petInfo.name}?*
_(e.g. Hamster, Turtle, Guinea Pig, Snake)_`
                );
            }

            const breedHints = {
                "Dog": "e.g. Labrador, German Shepherd, Indie, Golden Retriever",
                "Cat": "e.g. Persian, Siamese, Indie, Maine Coon",
                "Bird": "e.g. Parrot, Budgie, Cockatiel, Mynah",
                "Rabbit": "e.g. Dutch, Angora, Lionhead",
            };

            user.onboardingStep = "pet_awaiting_breed";
            return xmlReply(res,
                `Got it! *${user.petInfo.species}* 🐾

🦴 *What breed is ${user.petInfo.name}?*
_${breedHints[user.petInfo.species]}_

_Not sure? Just type "Mixed" or "Not sure"_`
            );
        }

        // STEP 2.5: Other Species
        if (user.onboardingStep === "pet_awaiting_species_other" && !mediaUrl) {
            user.petInfo.species = userMessage.trim();
            user.onboardingStep = "pet_awaiting_breed";
            return xmlReply(res,
                `Got it! *${user.petInfo.species}* 🐾

🦴 *What breed is ${user.petInfo.name}?*
_(e.g. Hamster, Turtle, Guinea Pig or type "Not sure")_`
            );
        }

        // STEP 3: Pet Breed
        if (user.onboardingStep === "pet_awaiting_breed" && !mediaUrl) {
            user.petInfo.breed = userMessage.trim();
            user.onboardingStep = "pet_awaiting_age";
            return xmlReply(res,
                `🎂 *How old is ${user.petInfo.name}?*
_(e.g. 2 years, 8 months, 2 years 4 months)_`
            );
        }

        // STEP 4: Pet Age
        if (user.onboardingStep === "pet_awaiting_age" && !mediaUrl) {
            user.petInfo.age = userMessage.trim();
            user.onboardingStep = "pet_awaiting_gender";
            return xmlReply(res,
                `⚧ *What is ${user.petInfo.name}'s gender?*
━━━━━━━━━━━━━━━
1️⃣ 🐾 Male
2️⃣ 🌸 Female
━━━━━━━━━━━━━━━`
            );
        }

        // STEP 5: Pet Gender
        if (user.onboardingStep === "pet_awaiting_gender" && !mediaUrl) {
            user.petInfo.gender = text === "1" ? "Male" : text === "2" ? "Female" : userMessage.trim();
            user.onboardingStep = "pet_awaiting_neutered";
            const neuteredWord = user.petInfo.gender === "Female" ? "Spayed" : "Neutered";
            return xmlReply(res,
                `✂️ *Is ${user.petInfo.name} ${neuteredWord}?*
━━━━━━━━━━━━━━━
1️⃣ ✅ Yes
2️⃣ ❌ No
3️⃣ 🤷 Not Sure
━━━━━━━━━━━━━━━`
            );
        }

        // STEP 6: Neutered/Spayed
        if (user.onboardingStep === "pet_awaiting_neutered" && !mediaUrl) {
            const neuteredMap = { "1": "Yes", "2": "No", "3": "Not Sure" };
            user.petInfo.neutered = neuteredMap[text] || userMessage.trim();
            user.onboardingStep = "pet_awaiting_location";
            return xmlReply(res,
                `📍 *Almost done! Please share your location*
so I can find nearby vets for *${user.petInfo.name}*!

_Tap 📎 → Location → Send current location_
_Or just type your city name_`
            );
        }

        // STEP 7: Pet Location → Complete onboarding
        if (user.onboardingStep === "pet_awaiting_location") {
            let latitude = null;
            let longitude = null;
            let locationText = null;

            if (typeof req.body === "string") {
                const latMatch = req.body.match(/Latitude=([^&]*)/);
                const lonMatch = req.body.match(/Longitude=([^&]*)/);
                if (latMatch && lonMatch) {
                    latitude = decodeURIComponent(latMatch[1]);
                    longitude = decodeURIComponent(lonMatch[1]);
                }
            } else if (req.body && req.body.Latitude) {
                latitude = req.body.Latitude;
                longitude = req.body.Longitude;
            }

            if (!latitude && userMessage.trim().length > 0) {
                locationText = userMessage.trim();
            }

            user.petInfo.location = latitude
                ? { latitude, longitude, type: "pin" }
                : { text: locationText, type: "text" };

            user.onboardingStep = "complete";
            saveRepo();

            const neuteredWord = user.petInfo.gender === "Female" ? "Spayed" : "Neutered";

            return xmlReply(res,
                `✅ *${user.petInfo.name}'s Profile is Ready!*
━━━━━━━━━━━━━━━
🐾 *Name:* ${user.petInfo.name}
🐶 *Species:* ${user.petInfo.species}
🦴 *Breed:* ${user.petInfo.breed}
🎂 *Age:* ${user.petInfo.age}
⚧ *Gender:* ${user.petInfo.gender}
✂️ *${neuteredWord}:* ${user.petInfo.neutered}
📍 *Location:* Saved
━━━━━━━━━━━━━━━

👇 *What would you like to do?*

1️⃣ 🩺 Describe symptoms
2️⃣ 📸 Send a photo
3️⃣ 👁️ Eye check
4️⃣ 🏥 Find a vet`
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
saveRepo();

return xmlReply(res,
    `✅ *Profile Complete, ${user.rescuerInfo.name}!*

👤 ${user.rescuerInfo.name} | 🏢 ${user.rescuerInfo.organizationName}
📍 ${user.rescuerInfo.location} | 🐾 ${user.rescuerInfo.animalTypes}

You're all set! Do you have an animal that needs help right now?

Tell me about your current rescue case:
📝 Describe the animal's condition or injuries
📸 Send a photo for instant triage analysis
👁️ Type *eye check* for eye/wound assessment
🏥 Type *find vet* to locate nearest emergency vet

💬 Type *exit* anytime to end and restart the chat.`
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
saveRepo();
user.vetInfo.activeCase = null;
            user.sessionState = "vet_dashboard";

            return xmlReply(res,
                `✅ *Profile Complete, Dr. ${user.vetInfo.name}!*

🏥 ${user.vetInfo.clinicName} | 🔬 ${user.vetInfo.specialization}

Welcome to your *Clinical Dashboard*. What would you like to do?

1️⃣ Log a new patient case
2️⃣ View & manage case files
3️⃣ Drug & treatment reference
4️⃣ Generate case summary report

💬 Type *exit* anytime to end and restart the chat.`
            );
        }

        // =================================================================
        // ================= MAIN AI ANALYSIS (ALL ROLES) ==================
        // =================================================================

        if (user.onboardingStep !== "complete") {
            return xmlReply(res,
                `⚠️ Please complete your profile setup first to continue.
Reply *Hi* to start over.`
            );
        }

        // ================= VET DASHBOARD HANDLER =================
        if (user.role === "veterinarian") {

            if (user.sessionState === "vet_dashboard" && ["1", "2", "3", "4"].includes(text)) {

                if (text === "1") {
                    user.sessionState = "vet_case_animal_name";
                    user.vetInfo.activeCase = {};
                    return xmlReply(res,
                        `🐾 *New Patient Case*

Step 1/4: What is the *animal's name and species*?
(e.g. Bruno, Dog)`
                    );
                }

                if (text === "2") {
                    const history = user.vetInfo.caseHistory;
                    if (!history || history.length === 0) {
                        return xmlReply(res,
                            `📋 No case files found yet.

Reply *1* to log your first case.`
                        );
                    }
                    const caseList = history.slice(-5).reverse().map((c, i) =>
                        `${i + 1}. 🕐 ${new Date(c.timestamp).toLocaleString()}\n🐾 ${c.animalName || "Unknown"} | ${c.species || ""}\n📝 ${c.complaint || ""}`.substring(0, 150)
                    ).join("\n\n");
                    return xmlReply(res,
                        `📋 *Recent Case Files:*\n\n${caseList}\n\n_Reply *menu* to go back to dashboard._`
                    );
                }

                if (text === "3") {
                    user.sessionState = "vet_drug_reference";
                    return xmlReply(res,
                        `💊 *Drug & Treatment Reference*

Type a *drug name* or *condition* to look up:
- Dosage by species/weight
- Contraindications
- Common treatment protocols

(e.g. "Amoxicillin dog 10kg" or "feline UTI protocol")`
                    );
                }

                if (text === "4") {
                    const history = user.vetInfo.caseHistory;
                    if (!history || history.length === 0) {
                        return xmlReply(res,
                            `📋 No cases found to summarize.

Reply *1* to log your first case.`
                        );
                    }
                    const caseList = history.slice(-5).reverse().map((c, i) =>
                        `${i + 1}. 🐾 ${c.animalName || "Unknown"} | ${new Date(c.timestamp).toLocaleDateString()}`
                    ).join("\n");
                    user.sessionState = "vet_summary_select";
                    return xmlReply(res,
                        `📋 *Select a case to summarize:*\n\n${caseList}\n\nReply with the case number.`
                    );
                }
            }

            if (user.sessionState === "vet_dashboard") {
                return xmlReply(res,
                    `🏥 *Clinical Dashboard*

Please select a valid option:
1️⃣ Log a new patient case
2️⃣ View & manage case files
3️⃣ Drug & treatment reference
4️⃣ Generate case summary report`
                );
            }

            // ================= VET CASE LOGGING FLOW =================

            if (user.sessionState === "vet_case_animal_name") {
                user.vetInfo.activeCase.animalName = userMessage.split(",")[0]?.trim();
                user.vetInfo.activeCase.species = userMessage.split(",")[1]?.trim() || "Unknown";
                user.sessionState = "vet_case_age_weight";
                return xmlReply(res,
                    `Step 2/4: What is the *age and weight* of the patient?
(e.g. 3 years, 12kg)`
                );
            }

            if (user.sessionState === "vet_case_age_weight") {
                user.vetInfo.activeCase.ageWeight = userMessage.trim();
                user.sessionState = "vet_case_complaint";
                return xmlReply(res,
                    `Step 3/4: What is the *chief complaint and symptoms*?`
                );
            }

            if (user.sessionState === "vet_case_complaint") {
                user.vetInfo.activeCase.complaint = userMessage.trim();
                user.sessionState = "vet_case_observations";
                return xmlReply(res,
                    `Step 4/4: Any *clinical observations or vitals*?
(e.g. temp 39.5°C, HR 120, pale mucous membranes)`
                );
            }

            if (user.sessionState === "vet_case_observations") {
                user.vetInfo.activeCase.observations = userMessage.trim();
                user.vetInfo.activeCase.timestamp = new Date();
                user.vetInfo.activeCase.status = "open";

                const caseEntry = { ...user.vetInfo.activeCase };
                user.vetInfo.caseHistory.push(caseEntry);
                user.interactionHistory.push({
                    timestamp: new Date(),
                    userMessage,
                    aiReply: "Case logged",
                    role: user.role,
                    ...caseEntry,
                });
                user.vetInfo.activeCase = null;
                user.sessionState = "vet_dashboard";
                user.lastActiveAt = Date.now();

                return xmlReply(res,
                    `✅ *Case Logged Successfully!*

🐾 Patient: ${caseEntry.animalName} (${caseEntry.species})
⚖️ Age/Weight: ${caseEntry.ageWeight}
📋 Complaint: ${caseEntry.complaint}
🔬 Observations: ${caseEntry.observations}
📅 ${new Date().toLocaleString()}

What would you like to do next?
1️⃣ Log a new patient case
2️⃣ View & manage case files
3️⃣ Drug & treatment reference
4️⃣ Generate case summary report`
                );
            }

            // ================= VET DRUG REFERENCE =================
            if (user.sessionState === "vet_drug_reference") {
                user.lastActiveAt = Date.now();
                res.set("Content-Type", "text/xml");
                res.send(`<Response><Message>💊 Looking up reference...
⏳ Please wait a moment.</Message></Response>`);

                setTimeout(async () => {
                    try {
                        const response = await axios.post(
                            "https://api.openai.com/v1/chat/completions",
                            {
                                model: "gpt-4o",
                                messages: [
                                    {
                                        role: "system",
                                        content: `You are a veterinary pharmacology reference assistant for Dr. ${user.vetInfo.name}, specializing in ${user.vetInfo.specialization}.
                                        
The vet is looking up drug or treatment information. Provide:
- Drug dosage by species and weight if mentioned
- Contraindications
- Common treatment protocols
- Any important warnings

FORMAT:
💊 *Drug/Treatment:* [name]
📏 *Dosage:* [by species/weight]
⚠️ *Contraindications:* [list]
📋 *Protocol:* [steps]
🔬 *Notes:* [clinical notes]

Be precise and clinical. No unnecessary explanations.`
                                    },
                                    {
                                        role: "user",
                                        content: userMessage,
                                    }
                                ],
                            },
                            {
                                headers: {
                                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                                    "Content-Type": "application/json",
                                },
                            }
                        );

                        let drugReply = response.data.choices[0].message.content;
                        if (drugReply.length > 1400) drugReply = drugReply.substring(0, 1400) + "...";
                        drugReply += "\n\n_Reply *menu* to return to dashboard._";
                        drugReply = drugReply.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                        await sendTwilioMessage(fromNumber, drugReply);

                    } catch (err) {
                        console.log("❌ Drug reference error:", err.message);
                    }
                }, 0);
                return;
            }

            // ================= VET SUMMARY GENERATOR =================
            if (user.sessionState === "vet_summary_select") {
                const idx = parseInt(text) - 1;
                const history = user.vetInfo.caseHistory.slice(-5).reverse();
                if (isNaN(idx) || !history[idx]) {
                    return xmlReply(res, `⚠️ Invalid selection. Please reply with a valid case number.`);
                }
                const selectedCase = history[idx];
                user.sessionState = "vet_dashboard";
                user.lastActiveAt = Date.now();
                res.set("Content-Type", "text/xml");
                res.send(`<Response><Message>📋 Generating case summary...
⏳ Please wait.</Message></Response>`);

                setTimeout(async () => {
                    try {
                        const response = await axios.post(
                            "https://api.openai.com/v1/chat/completions",
                            {
                                model: "gpt-4o",
                                messages: [
                                    {
                                        role: "system",
                                        content: `You are a clinical documentation assistant for Dr. ${user.vetInfo.name}. Generate a structured clinical case summary report.

FORMAT:
📋 *Clinical Case Summary*
🐾 Patient: [name, species]
⚖️ Age/Weight: [details]
📅 Date: [date]
📝 Chief Complaint: [complaint]
🔬 Clinical Observations: [observations]
📊 Assessment: [brief structured assessment]
📋 Recommended Follow-up: [next steps]

Be professional and concise.`
                                    },
                                    {
                                        role: "user",
                                        content: JSON.stringify(selectedCase),
                                    }
                                ],
                            },
                            {
                                headers: {
                                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                                    "Content-Type": "application/json",
                                },
                            }
                        );

                        let summaryReply = response.data.choices[0].message.content;
                        if (summaryReply.length > 1400) summaryReply = summaryReply.substring(0, 1400) + "...";
                        summaryReply += "\n\n_Reply *menu* to return to dashboard._";
                        summaryReply = summaryReply.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                        await sendTwilioMessage(fromNumber, summaryReply);

                    } catch (err) {
                        console.log("❌ Summary error:", err.message);
                    }
                }, 0);
                return;
            }

            // ================= VET MENU COMMAND =================
            if (text === "menu") {
                user.sessionState = "vet_dashboard";
                user.lastActiveAt = Date.now();
                return xmlReply(res,
                    `🏥 *Clinical Dashboard*

What would you like to do?
1️⃣ Log a new patient case
2️⃣ View & manage case files
3️⃣ Drug & treatment reference
4️⃣ Generate case summary report`
                );
            }

            // ================= VET RETURNING MENU =================
            if (user.sessionState === "vet_returning" && ["1", "2"].includes(text)) {
                if (text === "1") {
                    user.sessionState = "vet_dashboard";
                    user.lastActiveAt = Date.now();
                    return xmlReply(res,
                        `🏥 *Clinical Dashboard*

What would you like to do?
1️⃣ Log a new patient case
2️⃣ View & manage case files
3️⃣ Drug & treatment reference
4️⃣ Generate case summary report`
                    );
                } else {
                    const history = user.vetInfo.caseHistory;
                    if (!history || history.length === 0) {
                        return xmlReply(res, `📋 No earlier case files found yet.\n\nReply *menu* to go to dashboard.`);
                    }
                    const caseList = history.slice(-5).reverse().map((c, i) =>
                        `${i + 1}. 🕐 ${new Date(c.timestamp).toLocaleString()}\n🐾 ${c.animalName || "Unknown"} | ${c.species || ""}`
                    ).join("\n\n");
                    user.sessionState = "vet_dashboard";
                    return xmlReply(res, `📋 *Your Recent Case Files:*\n\n${caseList}\n\n_Reply *menu* to go to dashboard._`);
                }
            }

            // Fallback for vet — show dashboard
            return xmlReply(res,
                `🏥 *Clinical Dashboard*

What would you like to do?
1️⃣ Log a new patient case
2️⃣ View & manage case files
3️⃣ Drug & treatment reference
4️⃣ Generate case summary report`
            );
        }

        // ================= RESCUER MENU COMMAND =================
        if (text === "menu" && user.role === "rescuer" && user.onboardingStep === "complete") {
            user.sessionState = "rescuer_returning";
            user.lastActiveAt = Date.now();
            saveRepo();
            return xmlReply(res,
                `🦺 *Rescuer Dashboard*

What would you like to do?
━━━━━━━━━━━━━━━
[ 1 ] 🆕 New rescue case
[ 2 ] 📋 View rescue history
[ 3 ] 🏥 Find nearest vet
━━━━━━━━━━━━━━━
_Type *exit* to end session._`
            );
        }

        // ================= UNIVERSAL FALLBACK =================
        if (user.onboardingStep === "complete" && user.role === "pet_parent") {
            // Pet parent said something unrecognized — treat as symptom description
            // falls through to fast ack + AI analysis below
        } else if (user.onboardingStep === "complete" && user.role === "rescuer") {
            // Rescuer said something unrecognized — treat as rescue case
            // falls through to fast ack + AI analysis below
        } else if (user.onboardingStep !== "complete") {
            // Stuck mid onboarding — guide them
            return xmlReply(res,
                `👋 Looks like something went wrong.

Reply *Hi* to start fresh or *1* to continue where you left off.`
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

                // Use stored location from user profile
                let location = null;
                if (user.role === "pet_parent" && user.petInfo.location) {
                    if (user.petInfo.location.type === "pin") {
                        location = `${user.petInfo.location.latitude},${user.petInfo.location.longitude}`;
                    } else {
                        location = user.petInfo.location.text;
                    }
                } else if (user.role === "rescuer" && user.rescuerInfo.location) {
                    location = user.rescuerInfo.location;
                } else {
                    location = extractLocation(userMessage);
                }

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

                // ================= IMAGE PROCESSING =================
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
                const roleContext = user.role === "rescuer"
                    ? `The user is an animal rescuer (${user.rescuerInfo.name}, ${user.rescuerInfo.organizationName}). Focus on first-aid, triage, and emergency guidance.`
                    : `The user is a pet parent. Pet details — Name: ${user.petInfo?.name || "unknown"}, Species: ${user.petInfo?.species || "unknown"}, Breed: ${user.petInfo?.breed || "unknown"}, Age: ${user.petInfo?.age || "unknown"}, Gender: ${user.petInfo?.gender || "unknown"}, Neutered/Spayed: ${user.petInfo?.neutered || "unknown"}. Use simple, friendly language.`;

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
                                    : isImageValid ? `
You are a smart pet health assistant.
${roleContext}

The user has sent an IMAGE. Generate a DETAILED, structured diagnostic report.

FORMAT YOUR RESPONSE EXACTLY LIKE THIS:

🐾 *PetAssist Visual Diagnostic Report*

🔍 *What I Observe:*
- Describe color, texture, shape, size, location of the issue
- Note any swelling, discharge, discoloration, abnormal growths
- Be specific and thorough (3–5 lines)

🧠 *Possible Conditions:*
- List 2–3 possible conditions based on visual signs
- Briefly explain why each is possible

🚨 *Severity Assessment:*
- Rate as: Low / Medium / High / Emergency
- Explain why you gave this rating

📋 *Recommended Action Plan:*
- Step 1: Immediate home care steps
- Step 2: What to monitor over next 24–48 hours
- Step 3: When to visit a vet urgently

💊 *Diet & Care Tips:*
- 2–3 specific food or care suggestions relevant to this condition

⚠️ *Important Warning:*
- One clear warning the pet parent must not ignore

RULES:
- Be thorough and detailed
- No generic answers, be specific to what you see
- Do NOT include vet links or cost estimates
` : `
You are a smart pet health assistant.
${roleContext}

Give SHORT, clear, WhatsApp-friendly responses.

If the user sends ONLY text:
- Respond normally based on symptoms.

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

                // Limit AI response length
                if (isImageValid && aiReply.length > 1400) {
                    aiReply = aiReply.substring(0, 1400) + "...";
                } else if (!isImageValid && aiReply.length > 700) {
                    aiReply = aiReply.substring(0, 700) + "...";
                }

                let reply = aiReply;

                // Update interaction history
                const historyEntry = {
                    timestamp: new Date(),
                    userMessage,
                    aiReply,
                    role: user.role,
                };
                user.interactionHistory.push(historyEntry);
                if (user.interactionHistory.length > 50) {
                    user.interactionHistory = user.interactionHistory.slice(-50);
                }
                user.lastActiveAt = Date.now();

                if (user.role === "rescuer") {
                    user.rescuerInfo.rescueHistory.push(historyEntry);
                    if (user.rescuerInfo.rescueHistory.length > 50) {
                        user.rescuerInfo.rescueHistory = user.rescuerInfo.rescueHistory.slice(-50);
                    }
                }

                // CTA based on whether image was sent
                if (!isImageValid) {
                    reply += "\n\n📸 Want a more accurate diagnosis?\nSend a photo and I'll analyze it instantly.";
                } else {
                    reply += "\n\n👁️ Want a deeper diagnosis?\nReply *eye check* or send a photo of the eyes.";
                }

                // Personalized label based on role
                let subjectLabel = "";
                if (user.role === "pet_parent" && user.petInfo?.name) {
                    subjectLabel = ` for *${user.petInfo.name}*`;
                } else if (user.role === "rescuer") {
                    subjectLabel = ` | *Rescue Case*`;
                }

                const isGreeting = text.startsWith("hi") || text.startsWith("hello") || text.startsWith("hey");
                const isImageWithText = isImageValid &&
                    userMessage &&
                    userMessage.trim().length > 3 &&
                    !["hi", "hello", "hey"].includes(text);

                // Final format
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

                // XML safe
                reply = reply
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");

                await sendTwilioMessage(fromNumber, reply);
                console.log("✅ Reply sent successfully");

            } catch (err) {
                console.log("❌ Background error:", err.response?.data || err.message);
                try {
                    await sendTwilioMessage(fromNumber,
                        `⚠️ *Something went wrong while analyzing your request.*\n\nPlease try again or rephrase your message. 🐾`
                    );
                } catch(e) {
                    console.log("❌ Failed to send error message:", e.message);
                }
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