import { readFileSync, writeFileSync } from "fs";

let content = readFileSync("tools/taskpad-intake-autoplan.ts", "utf-8");

// Replace all occurrences of the 5-step array with 6-step array
content = content.replace(
  /steps: \[recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep\]/g,
  "steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep]"
);

writeFileSync("tools/taskpad-intake-autoplan.ts", content);
console.log("Updated steps arrays to include markitdownPriorityBriefParityStep");
