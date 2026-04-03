const fs = require("fs");

function logQuery(message) {
  let logs = [];

  if (fs.existsSync("logs.json")) {
    const file = fs.readFileSync("logs.json", "utf-8");
    logs = file ? file.split("\n").filter(Boolean).map(JSON.parse) : [];
  }

  logs.push({
    message,
    timestamp: new Date()
  });

  fs.writeFileSync(
    "logs.json",
    logs.map(l => JSON.stringify(l)).join("\n")
  );
}

module.exports = logQuery;