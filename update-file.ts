const fs = require("fs");
const content = fs.readFileSync("tools/taskpad-intake-autoplan.ts", "utf8");
const updated = content.replace(
  /steps: \[recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep\]/g,
  "steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep, freshnessStep]"
);
fs.writeFileSync("tools/taskpad-intake-autoplan.ts", updated);
console.log("File updated");
