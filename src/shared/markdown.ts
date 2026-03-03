import type { ClipMetadata, ClipContentType } from "./types";
import type { RelatedClipsDiagnostics } from "./relatedClipsContract";

export interface FrontmatterInput {
  source: string;
  title: string;
  type: ClipContentType;
  dateClippedISO: string;
  tags: string[];

  author?: string;
  channel?: string;
  duration?: string;
  videoType?: ClipMetadata["videoType"];

  extra?: Record<
    string,
    string | number | boolean | string[] | null | undefined
  >;

  /** Related clips diagnostics for frontmatter */
  relatedClipsDiagnostics?: RelatedClipsDiagnostics;
}

/** Input for building clip markdown with related clips */
export interface ClipMarkdownInput {
  frontmatter: FrontmatterInput;
  bodyMarkdown: string;
  /** Related clips section markdown (empty string if none) */
  relatedClipsSection?: string;
}

function yamlEscapeString(value: string): string {
  const normalized = value
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const escaped = normalized
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");

  return `"${escaped}"`;
}

function sanitizeYamlKey(key: string): string {
  const trimmed = key.trim();
  const replaced = trimmed.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!replaced) return "x";
  if (/^[0-9]/.test(replaced)) return `x_${replaced}`;
  return replaced;
}

function addOptionalString(lines: string[], key: string, value?: string): void {
  const v = value?.trim();
  if (!v) return;
  lines.push(`${key}: ${yamlEscapeString(v)}`);
}

function addOptionalScalar(
  lines: string[],
  key: string,
  value: string | number | boolean | null | undefined
): void {
  if (value === null || value === undefined) return;

  if (typeof value === "string") {
    const v = value.trim();
    if (!v) return;
    lines.push(`${key}: ${yamlEscapeString(v)}`);
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return;
    lines.push(`${key}: ${String(value)}`);
    return;
  }

  if (typeof value === "boolean") {
    lines.push(`${key}: ${value ? "true" : "false"}`);
  }
}

function addStringList(lines: string[], key: string, values: string[]): void {
  const cleaned = values
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (cleaned.length === 0) {
    lines.push(`${key}: []`);
    return;
  }

  lines.push(`${key}:`);
  for (const item of cleaned) {
    lines.push(`  - ${yamlEscapeString(item)}`);
  }
}

export function buildFrontmatterYaml(input: FrontmatterInput): string {
  const lines: string[] = ["---"];

  lines.push(`source: ${yamlEscapeString(input.source || "")}`);
  lines.push(`title: ${yamlEscapeString(input.title || "")}`);

  addOptionalString(lines, "author", input.author);
  addOptionalString(lines, "channel", input.channel);
  addOptionalString(lines, "duration", input.duration);

  if (input.videoType) {
    lines.push(`video_type: ${yamlEscapeString(input.videoType)}`);
  }

  lines.push(`date_clipped: ${yamlEscapeString(input.dateClippedISO)}`);

  addStringList(lines, "tags", input.tags || []);

  lines.push(`type: ${yamlEscapeString(input.type)}`);

  // Add related clips diagnostics if present
  if (input.relatedClipsDiagnostics) {
    lines.push(`related_clips_count: ${input.relatedClipsDiagnostics.related_clips_count}`);
    lines.push(`related_clips_top_score: ${input.relatedClipsDiagnostics.related_clips_top_score}`);
    lines.push(`related_graph_version: ${yamlEscapeString(input.relatedClipsDiagnostics.related_graph_version)}`);
    lines.push(`related_clips_truncated: ${input.relatedClipsDiagnostics.related_clips_truncated}`);
  }

  const reservedKeys = new Set([
    "source",
    "title",
    "author",
    "channel",
    "duration",
    "video_type",
    "date_clipped",
    "tags",
    "type",
    "related_clips_count",
    "related_clips_top_score",
    "related_graph_version",
    "related_clips_truncated"
  ]);

  if (input.extra) {
    const entries = Object.entries(input.extra)
      .map(([k, v]) => [sanitizeYamlKey(k), v] as const)
      .filter(([k]) => !reservedKeys.has(k))
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [key, value] of entries) {
      if (Array.isArray(value)) {
        addStringList(lines, key, value);
      } else {
        addOptionalScalar(lines, key, value);
      }
    }
  }

  lines.push("---");

  return lines.join("\n") + "\n\n";
}

/**
 * Build markdown from legacy frontmatter + body (no related clips)
 * @deprecated Use buildClipMarkdownWithRelated instead
 */
export function buildClipMarkdown(
  frontmatter: FrontmatterInput,
  bodyMarkdown: string
): string {
  const fm = buildFrontmatterYaml(frontmatter);

  const body = (bodyMarkdown || "").replace(/^\s+/, "");
  if (!body) return fm;

  return fm + body + (body.endsWith("\n") ? "" : "\n");
}

/**
 * Build full clip markdown with frontmatter, body, and optional related clips section.
 * This is the primary function for building clip output.
 */
export function buildClipMarkdownWithRelated(
  input: ClipMarkdownInput
): string {
  const fm = buildFrontmatterYaml(input.frontmatter);

  const body = (input.bodyMarkdown || "").replace(/^\s+/, "");
  const normalizedBody = body
    ? body + (body.endsWith("\n") ? "" : "\n")
    : "";

  // Append related clips section if present and non-empty
  const relatedSection = input.relatedClipsSection?.trim()
    ? "\n" + input.relatedClipsSection.trim() + "\n"
    : "";

  return fm + normalizedBody + relatedSection;
}