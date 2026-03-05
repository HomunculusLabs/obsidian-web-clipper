const line = "### [HIGH] sync-item-1";
const trimmed = line.trim();
const itemHeaderMatch = trimmed.match(/^###\s*\[?(CRITICAL|HIGH|MEDIUM|LOW)\]?\s*(.+)$/i);
console.log("Match result:", itemHeaderMatch);
