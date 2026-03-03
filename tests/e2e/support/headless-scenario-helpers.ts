/**
 * Shared scenario helpers for headless clip testing.
 *
 * This module provides reusable scenario execution logic that can be used by:
 * - The headless-clip-harness test file for behavioral assertions
 * - The matrix scenario validator for deterministic validation
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";

import { extractWebPageContent } from "../../../src/content/extractors/web";
import { buildFrontmatterFromClip } from "../../../src/shared/buildFrontmatter";
import { buildClipMarkdown } from "../../../src/shared/markdown";
import { DEFAULT_SETTINGS } from "../../../src/shared/settings";
import type { ClipResult } from "../../../src/shared/types";
import type { TestVaultSandbox } from "./test-vault-sandbox";

/**
 * DOM restore function returned by setupDomFromFixture.
 */
export type DomRestoreFn = () => void;

/**
 * Result of executing a headless clip scenario.
 */
export interface ScenarioExecutionResult {
  /** The extracted clip result with metadata and markdown. */
  extracted: ReturnType<typeof extractWebPageContent>;
  /** The built frontmatter with file path and frontmatter data. */
  built: ReturnType<typeof buildFrontmatterFromClip>;
  /** The final markdown with frontmatter and content. */
  clipMarkdown: string;
  /** Function to restore the DOM to its original state. */
  restoreDom: DomRestoreFn;
}

/**
 * Options for scenario execution.
 */
export interface ScenarioExecutionOptions {
  /** Path to the HTML fixture file. */
  fixturePath: string;
  /** The URL to simulate for the clip. */
  simulatedUrl: string;
  /** The page type for frontmatter building. */
  pageType?: "web" | "youtube" | "pdf" | "article" | "video" | "document";
  /** Test vault sandbox instance. */
  sandbox: TestVaultSandbox;
  /** Optional base clip result to use instead of default. */
  baseResult?: Partial<ClipResult>;
  /** Override folder path. */
  overrideFolder?: string;
  /** Override title. */
  overrideTitle?: string;
  /** Override tags. */
  overrideTags?: string;
}

/**
 * Set up a DOM environment from HTML fixture.
 *
 * This creates a Happy-DOM window with the fixture HTML and sets up
 * global globals (document, window, location, etc.) to simulate a browser
 * environment for content extraction.
 *
 * @param html - The HTML content to load into the DOM.
 * @param url - The URL to simulate as the page location.
 * @returns A function that restores the original DOM state.
 */
export function setupDomFromFixture(html: string, url: string): DomRestoreFn {
  const window = new Window({ url, width: 1280, height: 900 });
  window.document.write(html);

  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalLocation = globalThis.location;
  const originalNode = (globalThis as { Node?: unknown }).Node;
  const originalHTMLElement = (globalThis as { HTMLElement?: unknown }).HTMLElement;
  const originalHTMLImageElement = (globalThis as { HTMLImageElement?: unknown }).HTMLImageElement;

  (globalThis as { document?: Document }).document = window.document;
  (globalThis as { window?: Window }).window = window as unknown as Window & typeof globalThis;
  (globalThis as { Node?: unknown }).Node = window.Node;
  (globalThis as { HTMLElement?: unknown }).HTMLElement = window.HTMLElement;
  (globalThis as { HTMLImageElement?: unknown }).HTMLImageElement = window.HTMLImageElement;

  Object.defineProperty(globalThis, "location", {
    value: { href: url },
    writable: true,
    configurable: true,
  });

  return () => {
    if (originalDocument !== undefined) {
      (globalThis as { document?: Document }).document = originalDocument;
    } else {
      delete (globalThis as { document?: Document }).document;
    }

    if (originalWindow !== undefined) {
      (globalThis as { window?: Window }).window = originalWindow;
    } else {
      delete (globalThis as { window?: Window }).window;
    }

    if (originalLocation !== undefined) {
      Object.defineProperty(globalThis, "location", {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    } else {
      delete (globalThis as { location?: unknown }).location;
    }

    if (originalNode !== undefined) {
      (globalThis as { Node?: unknown }).Node = originalNode;
    } else {
      delete (globalThis as { Node?: unknown }).Node;
    }

    if (originalHTMLElement !== undefined) {
      (globalThis as { HTMLElement?: unknown }).HTMLElement = originalHTMLElement;
    } else {
      delete (globalThis as { HTMLElement?: unknown }).HTMLElement;
    }

    if (originalHTMLImageElement !== undefined) {
      (globalThis as { HTMLImageElement?: unknown }).HTMLImageElement = window.HTMLImageElement;
    } else {
      delete (globalThis as { HTMLImageElement?: unknown }).HTMLImageElement;
    }
  };
}

/**
 * Execute a headless clip scenario.
 *
 * This function performs the full clip workflow:
 * 1. Loads the HTML fixture
 * 2. Sets up the DOM environment
 * 3. Extracts content using the web extractor
 * 4. Builds frontmatter
 * 5. Generates the final clip markdown
 *
 * The result includes all intermediate outputs and a restore function
 * for cleaning up the DOM.
 *
 * @param options - Scenario execution options.
 * @returns The scenario execution result.
 */
export function executeScenario(options: ScenarioExecutionOptions): ScenarioExecutionResult {
  const {
    fixturePath,
    simulatedUrl,
    pageType = "web",
    sandbox,
    baseResult,
    overrideFolder = "Clips",
    overrideTitle,
    overrideTags,
  } = options;

  // Load fixture HTML
  const fixtureHtml = readFileSync(fixturePath, "utf-8");

  // Set up DOM
  const restoreDom = setupDomFromFixture(fixtureHtml, simulatedUrl);

  try {
    // Extract content
    const defaultBaseResult: ClipResult = {
      url: simulatedUrl,
      title: "Fixture Article",
      markdown: "",
      metadata: {
        url: simulatedUrl,
        title: "Fixture Article",
        type: "article",
      },
    };

    const extracted = extractWebPageContent({
      result: { ...defaultBaseResult, ...baseResult },
      settings: DEFAULT_SETTINGS,
      pageUrl: simulatedUrl,
    });

    // Build frontmatter
    const built = buildFrontmatterFromClip({
      result: extracted,
      settings: DEFAULT_SETTINGS,
      pageType,
      currentTabUrl: simulatedUrl,
      overrideFolder,
      overrideTitle: overrideTitle ?? sandbox.deterministic.nextTitle("scenario"),
      overrideTags,
    });

    // Build clip markdown
    const clipMarkdown = buildClipMarkdown(built.frontmatter, extracted.markdown);

    return {
      extracted,
      built,
      clipMarkdown,
      restoreDom,
    };
  } catch (error) {
    // Restore DOM on error
    restoreDom();
    throw error;
  }
}

/**
 * Execute a scenario with automatic cleanup using a callback.
 *
 * This is a convenience wrapper around `executeScenario` that ensures
 * the DOM is always restored, even if the callback throws an error.
 *
 * Supports both sync and async callbacks.
 *
 * @param options - Scenario execution options.
 * @param callback - Function to execute with the scenario result (can be async).
 * @returns The return value of the callback.
 */
export function withScenario<T>(
  options: ScenarioExecutionOptions,
  callback: (result: Omit<ScenarioExecutionResult, "restoreDom">) => T | Promise<T>,
): T | Promise<T> {
  const result = executeScenario(options);

  const cbResult = callback({
    extracted: result.extracted,
    built: result.built,
    clipMarkdown: result.clipMarkdown,
  });

  // Handle both sync and async callbacks
  if (cbResult instanceof Promise) {
    return cbResult.finally(() => {
      result.restoreDom();
    }) as T | Promise<T>;
  }

  result.restoreDom();
  return cbResult;
}

/**
 * Load fixture HTML for a scenario.
 *
 * @param fixturePath - Path to the fixture file.
 * @returns The HTML content.
 */
export function loadFixtureHtml(fixturePath: string): string {
  return readFileSync(fixturePath, "utf-8");
}
