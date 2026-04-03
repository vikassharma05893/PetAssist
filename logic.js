function extractLocation(message) {
  const text = message.toLowerCase();

  const keywords = [" in ", " at ", " near "];

  for (let key of keywords) {
    if (text.includes(key)) {
      return message.split(key)[1];
    }
  }

  return "your area";
}

module.exports.extractLocation = extractLocation;
function getRecommendations(message) {
  const text = message.toLowerCase();

  let cost = "₹300–₹800";
  let vet = "General Vet";
  let food = "Light, easy-to-digest food";

  // 🔴 HIGH severity (critical)
  const highSeverity = [
    "blood", "bleeding", "seizure", "collapsed",
    "not moving", "unconscious", "very weak", "cannot stand"
  ];

  // 🟠 MEDIUM severity
  const mediumSeverity = [
    "vomit", "vomiting", "diarrhea", "loose motion",
    "not eating", "lethargic", "low energy", "infection",
    "fever", "dull", "sick", "not active"
  ];

  // 🟡 URINARY
  const urinary = [
    "pee", "urine", "not peeing", "difficulty peeing",
    "straining", "drops"
  ];

  // 🟢 BEHAVIORAL
  const behavior = [
    "aggressive", "scared", "hiding", "anxious"
  ];

  // 🔴 Check high first
  if (highSeverity.some(k => text.includes(k))) {
    cost = "₹2000–₹8000";
    vet = "Emergency / Critical Care";
  }

  // 🟠 Medium
  else if (mediumSeverity.some(k => text.includes(k))) {
    cost = "₹800–₹2500";
    vet = "General Vet / Internal Medicine";
    food = "Boiled chicken + rice or soft diet";
  }

  // 🟡 Urinary
  else if (urinary.some(k => text.includes(k))) {
    cost = "₹1500–₹4000";
    vet = "Vet (Urinary / Internal)";
  }

  // 🟢 Behavioral
  else if (behavior.some(k => text.includes(k))) {
    cost = "₹300–₹1000";
    vet = "General Vet / Behavior Specialist";
  }

  return { cost, vet, food };
}
module.exports = {
  getRecommendations,
  extractLocation
};
function extractLocation(message) {
  const text = message.toLowerCase();

  // simple keyword-based extraction
  const keywords = ["in ", "at ", "near "];

  for (let key of keywords) {
    if (text.includes(key)) {
      return message.split(key)[1];
    }
  }

  return "your area";
}

module.exports.extractLocation = extractLocation;