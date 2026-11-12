import { describe, expect, test } from "bun:test";
import {
  buildObsidianBaseUri,
  buildObsidianClipboardUri,
  buildObsidianContentUri,
  handoffClipboardToObsidian,
  isContentTooLargeForObsidianUri,
  MAX_OBSIDIAN_URI_CONTENT_CHARS
} from "../../src/shared/obsidianUri";

describe("obsidianUri helpers", () => {
  test("buildObsidianBaseUri encodes vault and file path", () => {
    expect(buildObsidianBaseUri("Main Vault", "Inbox/My Note")).toBe(
      "obsidian://new?vault=Main%20Vault&file=Inbox%2FMy%20Note"
    );
  });

  test("buildObsidianContentUri appends encoded content", () => {
    expect(buildObsidianContentUri("Main Vault", "Inbox/My Note", "# Hello\n\nWorld")).toBe(
      "obsidian://new?vault=Main%20Vault&file=Inbox%2FMy%20Note&content=%23%20Hello%0A%0AWorld"
    );
  });

  test("buildObsidianClipboardUri appends bare clipboard flag", () => {
    expect(buildObsidianClipboardUri("Main Vault", "Inbox/My Note")).toBe(
      "obsidian://new?vault=Main%20Vault&file=Inbox%2FMy%20Note&clipboard"
    );
  });

  test("isContentTooLargeForObsidianUri uses the canonical threshold", () => {
    expect(isContentTooLargeForObsidianUri("x".repeat(MAX_OBSIDIAN_URI_CONTENT_CHARS + 1))).toBe(
      true
    );
    expect(isContentTooLargeForObsidianUri("short note")).toBe(false);
  });
});

describe("handoffClipboardToObsidian", () => {
  test("writes clipboard content and opens Obsidian when possible", async () => {
    const clipboardWrites: string[] = [];
    const openedUris: string[] = [];

    const result = await handoffClipboardToObsidian({
      content: "# Hello",
      vault: "Main Vault",
      filePath: "Inbox/My Note",
      clipboard: {
        writeText: async (text: string) => {
          clipboardWrites.push(text);
        }
      },
      openObsidianUri: async (uri: string) => {
        openedUris.push(uri);
        return { success: true };
      }
    });

    expect(result).toEqual({ success: true, openedObsidian: true });
    expect(clipboardWrites).toEqual(["# Hello"]);
    expect(openedUris).toEqual([
      "obsidian://new?vault=Main%20Vault&file=Inbox%2FMy%20Note&clipboard"
    ]);
  });

  test("returns clipboard success even when the Obsidian launch step fails", async () => {
    const result = await handoffClipboardToObsidian({
      content: "# Hello",
      vault: "Main Vault",
      filePath: "Inbox/My Note",
      clipboard: {
        writeText: async () => {}
      },
      openObsidianUri: async () => ({ success: false, error: "No URI handler" })
    });

    expect(result).toEqual({
      success: true,
      openedObsidian: false,
      error: "No URI handler"
    });
  });

  test("fails when clipboard is unavailable", async () => {
    const result = await handoffClipboardToObsidian({
      content: "# Hello",
      vault: "Main Vault",
      filePath: "Inbox/My Note"
    });

    expect(result).toEqual({
      success: false,
      error: "Clipboard API unavailable in this context"
    });
  });
});
