/**
 * Stack Overflow site template for extracting questions and answers.
 * 
 * Handles:
 * - Question pages (stackoverflow.com/questions/...)
 * - Stack Exchange network sites (same structure)
 * 
 * Extracts question title, body, tags, accepted answer, and top answers with votes.
 * Preserves code blocks with language hints from the class attribute.
 */

import type { SiteTemplate } from "../../shared/templates";
import { registerBuiltInTemplates } from "./registry";

/**
 * Main Stack Overflow template for question pages.
 */
export const stackOverflowTemplate: SiteTemplate = {
  domain: "stackoverflow.com",
  name: "Stack Overflow",
  description: "Extract Stack Overflow questions with accepted answer and top answers",
  enabled: true,
  priority: 100,
  urlPattern: "^/questions/\\d+/", // Only match question pages
  selectors: {
    // Question title
    title: ".question-hyperlink, h1 a[href*='/questions/'], [itemprop='name']",
    // Content is the question + answers container
    content: "#mainbar, #question, .question",
    // Question author
    author: ".question .user-details a, [itemprop='author']",
    // Question date
    date: ".question time, [itemprop='dateCreated']",
    // Tags
    tags: ".question .post-tag"
  },
  removeSelectors: [
    // Remove voting controls
    ".js-voting-container",
    ".js-vote-up-btn",
    ".js-vote-down-btn",
    ".js-bookmark-btn",
    // Remove edit/delete/flag buttons
    ".js-edit-post",
    ".js-delete-post",
    ".js-flag-post",
    // Remove comments toggle
    ".js-show-link",
    ".js-add-link",
    // Remove sidebar
    "#sidebar",
    ".s-sidebarwidget",
    // Remove "your answer" form
    "#post-editor",
    ".js-post-editor",
    // Remove related questions
    ".sidebar-related",
    // Remove footer nav
    "#footer"
  ],
  frontmatterExtras: {
    site: "stackoverflow"
  }
};

/**
 * Generic Stack Exchange template for all Stack Exchange sites.
 * Uses the same selectors since they share the same HTML structure.
 */
export const stackExchangeTemplate: SiteTemplate = {
  domain: "*.stackexchange.com",
  name: "Stack Exchange",
  description: "Extract questions from Stack Exchange network sites",
  enabled: true,
  priority: 50,
  urlPattern: "^/questions/\\d+/",
  selectors: {
    title: ".question-hyperlink, h1 a[href*='/questions/'], [itemprop='name']",
    content: "#mainbar, #question, .question",
    author: ".question .user-details a, [itemprop='author']",
    date: ".question time, [itemprop='dateCreated']",
    tags: ".question .post-tag"
  },
  removeSelectors: [
    ".js-voting-container",
    ".js-vote-up-btn",
    ".js-vote-down-btn",
    ".js-bookmark-btn",
    ".js-edit-post",
    ".js-delete-post",
    ".js-flag-post",
    ".js-show-link",
    ".js-add-link",
    "#sidebar",
    ".s-sidebarwidget",
    "#post-editor",
    ".js-post-editor",
    ".sidebar-related",
    "#footer"
  ],
  frontmatterExtras: {
    site: "stackexchange"
  }
};

/**
 * Server Fault template (serverfault.com).
 */
export const serverFaultTemplate: SiteTemplate = {
  domain: "serverfault.com",
  name: "Server Fault",
  description: "Extract Server Fault questions and answers",
  enabled: true,
  priority: 100,
  urlPattern: "^/questions/\\d+/",
  selectors: {
    title: ".question-hyperlink, [itemprop='name']",
    content: "#mainbar, .question",
    author: ".question .user-details a, [itemprop='author']",
    date: ".question time, [itemprop='dateCreated']",
    tags: ".question .post-tag"
  },
  removeSelectors: stackOverflowTemplate.removeSelectors,
  frontmatterExtras: {
    site: "serverfault"
  }
};

/**
 * Super User template (superuser.com).
 */
export const superUserTemplate: SiteTemplate = {
  domain: "superuser.com",
  name: "Super User",
  description: "Extract Super User questions and answers",
  enabled: true,
  priority: 100,
  urlPattern: "^/questions/\\d+/",
  selectors: {
    title: ".question-hyperlink, [itemprop='name']",
    content: "#mainbar, .question",
    author: ".question .user-details a, [itemprop='author']",
    date: ".question time, [itemprop='dateCreated']",
    tags: ".question .post-tag"
  },
  removeSelectors: stackOverflowTemplate.removeSelectors,
  frontmatterExtras: {
    site: "superuser"
  }
};

/**
 * Ask Ubuntu template (askubuntu.com).
 */
export const askUbuntuTemplate: SiteTemplate = {
  domain: "askubuntu.com",
  name: "Ask Ubuntu",
  description: "Extract Ask Ubuntu questions and answers",
  enabled: true,
  priority: 100,
  urlPattern: "^/questions/\\d+/",
  selectors: {
    title: ".question-hyperlink, [itemprop='name']",
    content: "#mainbar, .question",
    author: ".question .user-details a, [itemprop='author']",
    date: ".question time, [itemprop='dateCreated']",
    tags: ".question .post-tag"
  },
  removeSelectors: stackOverflowTemplate.removeSelectors,
  frontmatterExtras: {
    site: "askubuntu"
  }
};

/**
 * Extract question ID from URL.
 */
export function extractQuestionId(url: string): string | null {
  const match = url.match(/\/questions\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Extract vote count from an element.
 */
export function extractVoteCount(element: Element): number {
  const voteEl = element.querySelector(".js-vote-count, [itemprop='upvoteCount']");
  if (voteEl) {
    // Try the data-value attribute first (most reliable)
    const dataValue = voteEl.getAttribute("data-value");
    if (dataValue) {
      const num = parseInt(dataValue, 10);
      if (!isNaN(num)) return num;
    }
    // Fall back to text content
    const text = voteEl.textContent?.trim() || "";
    const num = parseInt(text, 10);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

/**
 * Extract the programming language from a code block's class.
 * Stack Overflow uses: <code class="lang-javascript"> or <code class="language-python">
 */
export function extractCodeLanguage(codeEl: Element): string | null {
  const classAttr = codeEl.getAttribute("class") || "";
  
  // Try lang-xxx format
  const langMatch = classAttr.match(/(?:^|\s)lang-(\w+)(?:\s|$)/);
  if (langMatch) {
    return langMatch[1];
  }
  
  // Try language-xxx format
  const languageMatch = classAttr.match(/(?:^|\s)language-(\w+)(?:\s|$)/);
  if (languageMatch) {
    return languageMatch[1];
  }
  
  // Try highlight-source-xxx format (some sites use this)
  const sourceMatch = classAttr.match(/(?:^|\s)highlight-source-(\w+)(?:\s|$)/);
  if (sourceMatch) {
    return sourceMatch[1];
  }
  
  return null;
}

/**
 * Extract code blocks from a post and enhance them with language hints.
 * Returns the HTML with language hints added to code blocks.
 */
export function enhanceCodeBlocks(html: string): string {
  // Create a temporary container to parse the HTML
  const container = document.createElement("div");
  container.innerHTML = html;
  
  // Find all code blocks (pre > code)
  const codeBlocks = container.querySelectorAll("pre > code");
  
  for (const codeEl of Array.from(codeBlocks)) {
    const preEl = codeEl.parentElement;
    if (!preEl) continue;
    
    const lang = extractCodeLanguage(codeEl);
    if (lang) {
      // Add data-language attribute for Turndown to pick up
      preEl.setAttribute("data-language", lang);
    }
  }
  
  return container.innerHTML;
}

/**
 * Check if an answer is accepted.
 */
export function isAcceptedAnswer(answerEl: Element): boolean {
  // Check for accepted-answer class
  if (answerEl.classList.contains("accepted-answer")) {
    return true;
  }
  // Check for data-isaccepted attribute
  if (answerEl.getAttribute("data-isaccepted") === "true") {
    return true;
  }
  // Check for accepted answer indicator
  if (answerEl.querySelector(".js-accepted-answer-indicator, .fa-check")) {
    return true;
  }
  return false;
}

/**
 * Extract the question body from the page.
 */
export function extractQuestionBody(doc: Document): string {
  const questionEl = doc.querySelector("#question, .question");
  if (!questionEl) return "";
  
  // Get the question body (s-prose is the content class)
  const bodyEl = questionEl.querySelector(".s-prose, .post-text");
  if (!bodyEl) return "";
  
  return bodyEl.innerHTML;
}

/**
 * Extract question tags from the page.
 */
export function extractQuestionTags(doc: Document): string[] {
  const questionEl = doc.querySelector("#question, .question");
  if (!questionEl) return [];
  
  const tagEls = questionEl.querySelectorAll(".post-tag");
  return Array.from(tagEls)
    .map((el) => el.textContent?.trim() || "")
    .filter((tag) => tag.length > 0);
}

/**
 * Extract answers from the page.
 */
export function extractAnswers(doc: Document, maxAnswers: number = 5): Array<{
  author: string;
  body: string;
  votes: number;
  isAccepted: boolean;
  date: string;
}> {
  const answers: Array<{
    author: string;
    body: string;
    votes: number;
    isAccepted: boolean;
    date: string;
  }> = [];
  
  // Get all answer elements
  const answerEls = doc.querySelectorAll("#answers .answer, [data-answerid]");
  
  // Sort by: accepted first, then by votes
  const sortedAnswers = Array.from(answerEls).sort((a, b) => {
    const aAccepted = isAcceptedAnswer(a);
    const bAccepted = isAcceptedAnswer(b);
    if (aAccepted !== bAccepted) {
      return aAccepted ? -1 : 1;
    }
    const aVotes = extractVoteCount(a);
    const bVotes = extractVoteCount(b);
    return bVotes - aVotes;
  });
  
  for (const answerEl of sortedAnswers.slice(0, maxAnswers)) {
    // Author
    const authorEl = answerEl.querySelector(".user-details a, [itemprop='author']");
    const author = authorEl?.textContent?.trim() || "Community";
    
    // Body
    const bodyEl = answerEl.querySelector(".s-prose, .answercell .post-text");
    const body = bodyEl?.innerHTML || "";
    
    // Votes
    const votes = extractVoteCount(answerEl);
    
    // Accepted status
    const isAccepted = isAcceptedAnswer(answerEl);
    
    // Date
    const dateEl = answerEl.querySelector("time, [itemprop='dateCreated']");
    const date = dateEl?.getAttribute("datetime") || dateEl?.textContent?.trim() || "";
    
    if (body) {
      answers.push({ author, body, votes, isAccepted, date });
    }
  }
  
  return answers;
}

/**
 * Format a question and its answers as markdown.
 */
export function formatStackOverflowContent(
  questionTitle: string,
  questionBody: string,
  questionTags: string[],
  questionAuthor: string,
  answers: Array<{
    author: string;
    body: string;
    votes: number;
    isAccepted: boolean;
    date: string;
  }>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _questionId: string | null
): string {
  let md = `# ${questionTitle}\n\n`;
  
  // Tags as metadata
  if (questionTags.length > 0) {
    md += `> Tags: ${questionTags.map((t) => `\`${t}\``).join(", ")}\n\n`;
  }
  
  // Question body
  md += `## Question\n\n`;
  md += `<small>by ${questionAuthor}</small>\n\n`;
  md += `${questionBody}\n\n`;
  
  // Answers
  if (answers.length > 0) {
    md += `---\n\n`;
    md += `## ${answers.length === 1 ? "Answer" : "Answers"}\n\n`;
    
    for (const answer of answers) {
      if (answer.isAccepted) {
        md += `### ✅ Accepted Answer`;
      } else {
        md += `### Answer`;
      }
      
      md += ` <small>(↑${answer.votes} votes`;
      if (answer.author) {
        md += `, by ${answer.author}`;
      }
      md += `)</small>\n\n`;
      
      md += `${answer.body}\n\n`;
    }
  }
  
  return md;
}

/**
 * Main extraction function for Stack Overflow pages.
 * Returns structured data about the question and answers.
 */
export function extractStackOverflowQuestion(
  doc: Document,
  url: string
): {
  title: string;
  questionId: string | null;
  questionBody: string;
  questionAuthor: string;
  questionDate: string;
  tags: string[];
  answers: Array<{
    author: string;
    body: string;
    votes: number;
    isAccepted: boolean;
    date: string;
  }>;
  answerCount: number;
} {
  // Title
  const titleEl = doc.querySelector(".question-hyperlink, h1 [itemprop='name'], h1 a");
  const title = titleEl?.textContent?.trim() || doc.title.replace(" - Stack Overflow", "").replace(" - ", " | ");
  
  // Question ID
  const questionId = extractQuestionId(url);
  
  // Question body
  const questionBody = extractQuestionBody(doc);
  
  // Question author
  const questionEl = doc.querySelector("#question, .question");
  const authorEl = questionEl?.querySelector(".user-details a, [itemprop='author']");
  const questionAuthor = authorEl?.textContent?.trim() || "";
  
  // Question date
  const dateEl = questionEl?.querySelector("time, [itemprop='dateCreated']");
  const questionDate = dateEl?.getAttribute("datetime") || dateEl?.textContent?.trim() || "";
  
  // Tags
  const tags = extractQuestionTags(doc);
  
  // Answers
  const answers = extractAnswers(doc, 10);
  
  // Answer count (from header or from actual count)
  let answerCount = answers.length;
  const headerCountEl = doc.querySelector("[data-answercount], #answers h2 .mb8");
  if (headerCountEl) {
    const text = headerCountEl.textContent || "";
    const match = text.match(/(\d+)\s*(?:Answer|answer)/);
    if (match) {
      answerCount = parseInt(match[1], 10);
    }
  }
  
  return {
    title,
    questionId,
    questionBody,
    questionAuthor,
    questionDate,
    tags,
    answers,
    answerCount
  };
}

// Register all Stack Overflow/Exchange templates
registerBuiltInTemplates([
  stackOverflowTemplate,
  stackExchangeTemplate,
  serverFaultTemplate,
  superUserTemplate,
  askUbuntuTemplate
]);
