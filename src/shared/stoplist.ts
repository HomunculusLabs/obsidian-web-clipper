/**
 * Comprehensive English stoplist for keyword extraction.
 * Contains common English words that should be excluded from tag suggestions.
 *
 * Sources: Standard stoplist + common web/tech filler words
 */

/**
 * Common English stopwords that don't make good tags.
 * These words are too generic to be useful as content keywords.
 */
export const ENGLISH_STOPLIST = new Set([
  // Articles
  "a", "an", "the",

  // Conjunctions
  "and", "but", "or", "nor", "for", "yet", "so",
  "although", "because", "since", "unless", "while", "whereas",

  // Prepositions
  "about", "above", "across", "after", "against", "along", "among",
  "around", "at", "before", "behind", "below", "beneath", "beside",
  "between", "beyond", "by", "down", "during", "except", "for",
  "from", "in", "inside", "into", "like", "near", "of", "off",
  "on", "onto", "out", "outside", "over", "past", "since", "through",
  "throughout", "till", "to", "toward", "under", "underneath", "until",
  "up", "upon", "with", "within", "without",

  // Pronouns
  "i", "me", "my", "myself", "we", "us", "our", "ours", "ourselves",
  "you", "your", "yours", "yourself", "yourselves",
  "he", "him", "his", "himself", "she", "her", "hers", "herself",
  "it", "its", "itself", "they", "them", "their", "theirs", "themselves",
  "what", "which", "who", "whom", "whose", "this", "that", "these", "those",

  // Auxiliary verbs
  "am", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "having", "do", "does", "did", "doing",
  "will", "would", "shall", "should", "can", "could", "may", "might", "must",

  // Common verbs (too generic)
  "get", "got", "go", "goes", "going", "gone", "went",
  "make", "makes", "made", "making",
  "take", "takes", "took", "taking",
  "come", "comes", "came", "coming",
  "see", "sees", "saw", "seen", "seeing",
  "know", "knows", "knew", "known", "knowing",
  "think", "thinks", "thought", "thinking",
  "want", "wants", "wanted", "wanting",
  "give", "gives", "gave", "given", "giving",
  "use", "uses", "used", "using",
  "find", "finds", "found", "finding",
  "tell", "tells", "told", "telling",
  "ask", "asks", "asked", "asking",
  "work", "works", "worked", "working",
  "seem", "seems", "seemed", "seeming",
  "feel", "feels", "felt", "feeling",
  "try", "tries", "tried", "trying",
  "leave", "leaves", "left", "leaving",
  "call", "calls", "called", "calling",
  "keep", "keeps", "kept", "keeping",
  "let", "lets", "letting",
  "begin", "begins", "began", "begun", "beginning",
  "show", "shows", "showed", "shown", "showing",
  "hear", "hears", "heard", "hearing",
  "play", "plays", "played", "playing",
  "run", "runs", "ran", "running",
  "move", "moves", "moved", "moving",
  "live", "lives", "lived", "living",
  "believe", "believes", "believed", "believing",
  "hold", "holds", "held", "holding",
  "bring", "brings", "brought", "bringing",
  "happen", "happens", "happened", "happening",
  "write", "writes", "wrote", "written", "writing",
  "provide", "provides", "provided", "providing",
  "sit", "sits", "sat", "sitting",
  "stand", "stands", "stood", "standing",
  "set", "sets", "setting",
  "learn", "learns", "learned", "learning",
  "change", "changes", "changed", "changing",
  "lead", "leads", "led", "leading",
  "understand", "understands", "understood", "understanding",
  "watch", "watches", "watched", "watching",
  "follow", "follows", "followed", "following",
  "stop", "stops", "stopped", "stopping",
  "create", "creates", "created", "creating",
  "speak", "speaks", "spoke", "spoken", "speaking",
  "read", "reads", "reading",
  "spend", "spends", "spent", "spending",
  "grow", "grows", "grew", "grown", "growing",
  "open", "opens", "opened", "opening",
  "walk", "walks", "walked", "walking",
  "win", "wins", "won", "winning",
  "offer", "offers", "offered", "offering",
  "remember", "remembers", "remembered", "remembering",
  "love", "loves", "loved", "loving",
  "consider", "considers", "considered", "considering",
  "appear", "appears", "appeared", "appearing",
  "buy", "buys", "bought", "buying",
  "wait", "waits", "waited", "waiting",
  "serve", "serves", "served", "serving",
  "die", "dies", "died", "dying",
  "send", "sends", "sent", "sending",
  "expect", "expects", "expected", "expecting",
  "build", "builds", "built", "building",
  "stay", "stays", "stayed", "staying",
  "fall", "falls", "fell", "fallen", "falling",
  "cut", "cuts", "cutting",
  "reach", "reaches", "reached", "reaching",
  "kill", "kills", "killed", "killing",
  "remain", "remains", "remained", "remaining",
  "suggest", "suggests", "suggested", "suggesting",
  "raise", "raises", "raised", "raising",
  "pass", "passes", "passed", "passing",

  // Adverbs (too generic)
  "very", "too", "quite", "rather", "somewhat", "really", "just",
  "also", "even", "only", "still", "already", "yet", "again",
  "always", "never", "often", "sometimes", "usually", "now", "then",
  "here", "there", "where", "everywhere", "somewhere", "anywhere",
  "how", "why", "maybe", "perhaps", "probably", "certainly",
  "actually", "basically", "essentially", "simply", "actually",
  "especially", "particularly", "specifically", "generally",
  "finally", "initially", "originally", "eventually", "recently",
  "currently", "previously", "previously", "currently",

  // Adjectives (too generic)
  "good", "bad", "great", "best", "better", "worse", "worst",
  "new", "old", "young", "big", "small", "large", "little",
  "long", "short", "high", "low", "full", "empty",
  "right", "wrong", "true", "false", "real", "actual",
  "other", "another", "same", "different", "similar",
  "own", "certain", "such", "own", "main", "major", "minor",
  "first", "second", "third", "last", "next", "previous",
  "many", "much", "more", "most", "few", "several", "some", "any", "all",
  "each", "every", "both", "either", "neither", "whole",
  "important", "possible", "available", "able", "free", "easy",
  "hard", "simple", "complex", "clear", "sure", "ready",

  // Quantifiers
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "hundred", "thousand", "million", "billion",
  "half", "quarter", "third", "double", "single",

  // Common nouns (too generic)
  "thing", "things", "way", "ways", "part", "parts", "place", "places",
  "case", "cases", "point", "points", "fact", "facts",
  "people", "person", "man", "woman", "child", "children",
  "world", "life", "time", "year", "years", "day", "days",
  "month", "months", "week", "weeks", "today", "tomorrow", "yesterday",
  "number", "amount", "kind", "sort", "type", "form", "level",
  "area", "field", "side", "end", "start", "beginning",
  "work", "job", "problem", "issue", "question", "answer", "result",
  "reason", "idea", "example", "instance", "bit", "piece",
  "lot", "bunch", "group", "set", "list", "collection",
  "information", "data", "details", "content", "text", "article",
  "page", "section", "chapter", "paragraph", "line", "word",
  "image", "picture", "photo", "video", "file", "link", "site", "website",
  "home", "house", "room", "door", "window", "wall", "floor",
  "water", "air", "food", "money", "price", "value",

  // Common web/tech filler words
  "click", "button", "menu", "option", "settings", "preferences",
  "login", "logout", "sign", "register", "subscribe", "follow",
  "share", "like", "comment", "post", "reply", "send", "message",
  "email", "address", "phone", "contact", "support", "help",
  "privacy", "policy", "terms", "conditions", "cookie", "cookies",
  "copyright", "rights", "reserved",
  "view", "views", "download", "upload", "print",
  "search", "find", "filter", "sort", "order",
  "add", "remove", "delete", "edit", "update", "save", "cancel",
  "next", "previous", "back", "forward", "continue",
  "index", "default", "error", "success", "warning", "info",
  "enable", "disable", "enabled", "disabled",
  "show", "hide", "visible", "hidden",
  "loading", "loaded", "loading", "please", "wait",

  // Common connectors/transitions
  "however", "therefore", "moreover", "furthermore", "nevertheless",
  "meanwhile", "instead", "otherwise", "thus", "hence",
  "accordingly", "consequently", "besides", "again", "further",
  "then", "once", "here", "there", "when", "where", "why", "how",
  "both", "either", "neither", "not", "only", "also", "as", "if",
  "per", "via", "etc", "etcetera", "like", "plus", "minus",
  "less", "least", "enough", "well", "done",
]);

/**
 * Technical/programming terms that are often too generic
 * but might be meaningful in context.
 */
export const TECH_GENERIC_TERMS = new Set([
  "function", "functions", "method", "methods",
  "class", "classes", "object", "objects",
  "variable", "variables", "value", "values",
  "string", "strings", "number", "numbers", "integer", "integers",
  "array", "arrays", "list", "lists", "map", "maps",
  "item", "items", "element", "elements", "entry", "entries",
  "property", "properties", "attribute", "attributes", "field", "fields",
  "parameter", "parameters", "argument", "arguments",
  "return", "returns", "result", "results",
  "input", "output", "response", "request",
  "callback", "handler", "listener", "event", "events",
  "true", "false", "null", "undefined", "none",
  "default", "custom", "local", "global", "public", "private",
  "source", "target", "name", "names", "id", "ids",
  "key", "keys", "code", "codes", "tag", "tags",
  "error", "errors", "exception", "exceptions",
  "log", "logs", "debug", "info", "warn", "warning",
]);

/**
 * Minimum word length to be considered a keyword.
 * Shorter words are rarely meaningful tags.
 */
export const MIN_KEYWORD_LENGTH = 3;

/**
 * Minimum frequency for a word to be considered a keyword.
 */
export const MIN_KEYWORD_FREQUENCY = 2;

/**
 * Maximum number of keywords to extract.
 */
export const MAX_KEYWORDS = 8;

/**
 * Check if a word is a stopword.
 */
export function isStopword(word: string): boolean {
  return ENGLISH_STOPLIST.has(word.toLowerCase());
}

/**
 * Check if a word is a generic tech term.
 */
export function isGenericTechTerm(word: string): boolean {
  return TECH_GENERIC_TERMS.has(word.toLowerCase());
}

/**
 * Check if a word should be excluded from keyword extraction.
 */
export function shouldExcludeWord(word: string): boolean {
  const lower = word.toLowerCase();
  return (
    lower.length < MIN_KEYWORD_LENGTH ||
    ENGLISH_STOPLIST.has(lower) ||
    TECH_GENERIC_TERMS.has(lower) ||
    /^\d+$/.test(lower) // Pure numbers
  );
}
