import type { Settings, WikiLinkRule } from "../../shared/settings";

type Segment = { text: string; protected: boolean };

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch);

function pushSeg(out: Segment[], text: string, protectedSeg: boolean) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.protected === protectedSeg) last.text += text;
  else out.push({ text, protected: protectedSeg });
}

function consumeFrontmatter(src: string): number {
  let i = 0;
  if (src.startsWith("\uFEFF")) i = 1;
  if (!src.startsWith("---\n", i)) return 0;

  let pos = src.indexOf("\n", i) + 1;
  while (pos > 0 && pos < src.length) {
    const lineEnd = src.indexOf("\n", pos);
    const end = lineEnd === -1 ? src.length : lineEnd;
    const line = src.slice(pos, end).trim();
    if (line === "---" || line === "...") return end === src.length ? end : end + 1;
    if (lineEnd === -1) break;
    pos = lineEnd + 1;
  }
  return src.length; // unclosed frontmatter: protect to EOF
}

function atLineStart(src: string, i: number) {
  return i === 0 || src[i - 1] === "\n";
}

function consumeFencedCode(src: string, i: number): number | null {
  if (!atLineStart(src, i)) return null;

  let j = i;
  while (src[j] === " " && j - i < 3) j++;

  const ch = src[j];
  if (ch !== "`" && ch !== "~") return null;

  let k = j;
  while (src[k] === ch) k++;
  const run = k - j;
  if (run < 3) return null;

  const afterOpen = src.indexOf("\n", k);
  let pos = afterOpen === -1 ? src.length : afterOpen + 1;

  while (pos < src.length) {
    const lineEndIdx = src.indexOf("\n", pos);
    const lineEnd = lineEndIdx === -1 ? src.length : lineEndIdx;
    const line = src.slice(pos, lineEnd);

    const m = line.match(/^( {0,3})([`~]+)/);
    if (m && m[2][0] === ch && m[2].length >= run) {
      return lineEnd === src.length ? lineEnd : lineEnd + 1;
    }

    if (lineEndIdx === -1) break;
    pos = lineEndIdx + 1;
  }

  return src.length;
}

function consumeInlineCode(src: string, i: number): number | null {
  if (src[i] !== "`") return null;
  let j = i;
  while (src[j] === "`") j++;
  const fence = "`".repeat(j - i);
  const close = src.indexOf(fence, j);
  return close === -1 ? src.length : close + fence.length;
}

function consumeWikiLink(src: string, i: number): number | null {
  if (src[i] !== "[" || src[i + 1] !== "[") return null;
  const close = src.indexOf("]]", i + 2);
  return close === -1 ? src.length : close + 2;
}

function findMatching(src: string, i: number, open: string, close: string): number {
  let depth = 0;
  for (let p = i; p < src.length; p++) {
    const ch = src[p];
    if (ch === "\\" && p + 1 < src.length) {
      p++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return p;
    }
  }
  return -1;
}

function consumeMarkdownLink(src: string, i: number): number | null {
  const isImage = src[i] === "!" && src[i + 1] === "[";
  const bracketStart = isImage ? i + 1 : i;
  if (src[bracketStart] !== "[") return null;

  const bracketEnd = findMatching(src, bracketStart, "[", "]");
  if (bracketEnd === -1) return null;

  const next = src[bracketEnd + 1];
  if (next === "(") {
    const parenEnd = findMatching(src, bracketEnd + 1, "(", ")");
    return parenEnd === -1 ? null : parenEnd + 1;
  }
  if (next === "[") {
    const refEnd = src.indexOf("]", bracketEnd + 2);
    return refEnd === -1 ? null : refEnd + 1;
  }
  return null;
}

function splitProtected(src: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;

  const fmEnd = consumeFrontmatter(src);
  if (fmEnd) {
    pushSeg(out, src.slice(0, fmEnd), true);
    i = fmEnd;
  }

  let lastPlain = i;
  while (i < src.length) {
    const end =
      consumeFencedCode(src, i) ??
      consumeWikiLink(src, i) ??
      consumeInlineCode(src, i) ??
      consumeMarkdownLink(src, i);

    if (end != null) {
      pushSeg(out, src.slice(lastPlain, i), false);
      pushSeg(out, src.slice(i, end), true);
      i = end;
      lastPlain = i;
      continue;
    }
    i++;
  }

  pushSeg(out, src.slice(lastPlain), false);
  return out;
}

type CompiledRule = {
  term: string;
  termNorm: string;
  note: string;
  len: number;
  startsWord: boolean;
  endsWord: boolean;
};

function compileRules(settings: Settings): CompiledRule[] {
  const raw = (settings.wikiLinkRules || [])
    .map((r: WikiLinkRule) => ({
      term: (r.term || "").trim(),
      note: (r.note || "").trim()
    }))
    .filter((r) => r.term && r.note)
    .filter(
      (r) => !r.note.includes("]]") && !r.note.includes("|") && !r.note.includes("\n")
    );

  const noteSet = settings.wikiLinkExistingNotesOnly
    ? new Set(
        (settings.wikiLinkNoteIndex || [])
          .map((n) =>
            settings.wikiLinkCaseSensitive ? n.trim() : n.trim().toLowerCase()
          )
          .filter(Boolean)
      )
    : null;

  const filtered = noteSet
    ? raw.filter((r) =>
        noteSet.has(
          settings.wikiLinkCaseSensitive ? r.note : r.note.toLowerCase()
        )
      )
    : raw;

  // Sort by term length descending (prefer longer matches)
  filtered.sort((a, b) => b.term.length - a.term.length);

  return filtered.map((r) => ({
    term: r.term,
    termNorm: settings.wikiLinkCaseSensitive ? r.term : r.term.toLowerCase(),
    note: r.note,
    len: r.term.length,
    startsWord: isWordChar(r.term[0]),
    endsWord: isWordChar(r.term[r.term.length - 1])
  }));
}

function injectInText(
  text: string,
  rules: CompiledRule[],
  settings: Settings,
  counts: number[]
): string {
  const max =
    settings.wikiLinkMaxPerTerm > 0 ? settings.wikiLinkMaxPerTerm : Infinity;
  const lower = settings.wikiLinkCaseSensitive ? "" : text.toLowerCase();

  let out = "";
  let i = 0;

  while (i < text.length) {
    let matched = false;

    for (let r = 0; r < rules.length; r++) {
      if (counts[r] >= max) continue;

      const rule = rules[r];
      if (i + rule.len > text.length) continue;

      const slice = settings.wikiLinkCaseSensitive
        ? text.slice(i, i + rule.len)
        : lower.slice(i, i + rule.len);
      if (slice !== rule.termNorm) continue;

      // Whole word matching
      if (settings.wikiLinkWholeWord) {
        const before = text[i - 1];
        const after = text[i + rule.len];
        if (rule.startsWord && isWordChar(before)) continue;
        if (rule.endsWord && isWordChar(after)) continue;
      }

      const alias = text.slice(i, i + rule.len);
      // Skip if alias contains characters that would break wiki-link syntax
      if (alias.includes("]]") || alias.includes("|") || alias.includes("\n"))
        continue;

      // Generate wiki-link: [[note]] or [[note|alias]]
      out += alias === rule.note ? `[[${rule.note}]]` : `[[${rule.note}|${alias}]]`;
      counts[r] += 1;
      i += rule.len;
      matched = true;
      break;
    }

    if (!matched) out += text[i++];
  }

  return out;
}

/**
 * Inject wiki-links into markdown based on settings rules.
 * Skips frontmatter, code blocks, inline code, existing wiki-links, and markdown links.
 */
export function injectWikiLinks(markdown: string, settings: Settings): string {
  if (!settings.enableWikiLinks) return markdown;

  const rules = compileRules(settings);
  if (!rules.length) return markdown;

  const counts = new Array(rules.length).fill(0) as number[];
  const segments = splitProtected(markdown);

  return segments
    .map((s) => (s.protected ? s.text : injectInText(s.text, rules, settings, counts)))
    .join("");
}
