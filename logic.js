// ================= LOCATION EXTRACTION =================
function extractLocation(message) {
  const text = message.toLowerCase();

  const keywords = [" in ", " at ", " near "];

  for (let key of keywords) {
    if (text.includes(key)) {
      const location = message.split(key)[1];
      return location.trim();
    }
  }

  return "your area";
}


// ================= SMART RECOMMENDATIONS =================
function getRecommendations(message) {
  const text = message.toLowerCase();

  let cost = "₹500–₹1500";
  let vet = "General Vet";
  let food = "Light, easy-to-digest food";

  // 🔴 HIGH severity (critical)
  if (
    text.includes("blood") ||
    text.includes("bleeding") ||
    text.includes("seizure") ||
    text.includes("unconscious") ||
    text.includes("not moving") ||
    text.includes("cannot stand")
  ) {
    return {
      cost: "₹2000–₹8000",
      vet: "Emergency / Critical Care",
      food: "Do not feed — immediate vet attention"
    };
  }

  // 🟠 VOMITING
  if (text.includes("vomit")) {
    return {
      cost: "₹800–₹2500",
      vet: "General Vet / Emergency",
      food: "Fasting 12 hrs → boiled chicken + rice"
    };
  }

  // 🟠 DIARRHEA
  if (text.includes("diarrhea") || text.includes("loose motion")) {
    return {
      cost: "₹700–₹2000",
      vet: "General Vet",
      food: "ORS, rice water, bland diet"
    };
  }

  // 🟠 NOT EATING
  if (text.includes("not eating") || text.includes("loss of appetite")) {
    return {
      cost: "₹500–₹2000",
      vet: "General Vet",
      food: "Soft food like boiled chicken or wet food"
    };
  }

  // 🟠 FEVER
  if (text.includes("fever")) {
    return {
      cost: "₹800–₹3000",
      vet: "General Vet",
      food: "Hydration + light diet"
    };
  }

  // 🟡 URINARY ISSUES
  if (
    text.includes("pee") ||
    text.includes("urine") ||
    text.includes("not peeing") ||
    text.includes("straining")
  ) {
    return {
      cost: "₹1500–₹4000",
      vet: "Internal Medicine Vet",
      food: "Wet food + hydration"
    };
  }

  // 🟢 SKIN
  if (
    text.includes("itching") ||
    text.includes("rash") ||
    text.includes("skin")
  ) {
    return {
      cost: "₹500–₹2500",
      vet: "Dermatology Vet",
      food: "Hypoallergenic diet"
    };
  }

  // 🟢 BEHAVIOR
  if (
    text.includes("aggressive") ||
    text.includes("scared") ||
    text.includes("anxious")
  ) {
    return {
      cost: "₹300–₹1000",
      vet: "Behavior Specialist",
      food: "Regular diet"
    };
  }

  // 🔵 DEFAULT
  return { cost, vet, food };
}


// ================= EXPORT =================
module.exports = {
  getRecommendations,
  extractLocation
};