import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, watch as fsWatch } from "node:fs";
import { dirname, join } from "node:path";

const PROJECT_ROOT = process.cwd();

type BuildTarget = "chrome" | "firefox" | "firefox-android";

const DEFAULT_TARGET: BuildTarget = "chrome";
let DIST_DIR = join(PROJECT_ROOT, "dist");

function resolveDistDir(target: BuildTarget) {
  switch (target) {
    case "firefox":
      return join(PROJECT_ROOT, "dist-firefox");
    case "firefox-android":
      return join(PROJECT_ROOT, "dist-firefox-android");
    default:
      return join(PROJECT_ROOT, "dist");
  }
}

function parseArgs(argv: string[]) {
  const targetIndex = argv.indexOf("--target");
  const targetValue =
    targetIndex >= 0 && argv[targetIndex + 1]
      ? argv[targetIndex + 1]
      : argv.includes("--firefox")
        ? "firefox"
        : DEFAULT_TARGET;

  const target: BuildTarget =
    targetValue === "firefox"
      ? "firefox"
      : targetValue === "firefox-android"
        ? "firefox-android"
        : "chrome";

  return {
    watch: argv.includes("--watch") || argv.includes("-w"),
    target
  };
}

function resolvePath(relativePath: string) {
  return join(PROJECT_ROOT, relativePath);
}

function pickFirstExisting(candidates: string[]) {
  for (const candidate of candidates) {
    const abs = resolvePath(candidate);
    if (existsSync(abs)) return abs;
  }
  return null;
}

async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

async function cleanDist() {
  await rm(DIST_DIR, { recursive: true, force: true });
}

function printBuildLogs(logs: any[]) {
  for (const log of logs) {
    if (!log) continue;
    const message = typeof log.message === "string" ? log.message : String(log);
    console.error(message);
  }
}

async function bundleEntrypoint(inputFile: string, outSubdir: string, watchMode: boolean, options?: {
  /** Use ESM format with code splitting for lazy loading */
  esm?: boolean;
}) {
  const outdir = join(DIST_DIR, outSubdir);
  await ensureDir(outdir);

  // ESM format enables code splitting for lazy-loaded modules
  const format = options?.esm ? "esm" : "iife";
  const splitting = options?.esm ? true : false;

  const result = await Bun.build({
    entrypoints: [inputFile],
    outdir,
    target: "browser",
    format,
    splitting,
    minify: !watchMode,
    sourcemap: watchMode ? "external" : "none",
    define: {
      // Polyfill import.meta.url for PDF.js (not needed since we use disableWorker)
      "import.meta.url": JSON.stringify("https://localhost/")
    }
  });

  if (!result.success) {
    printBuildLogs(result.logs || []);
    throw new Error("Build failed");
  }

  // Report chunk sizes for code-split builds
  if (splitting && result.outputs) {
    const chunks = result.outputs
      .filter(o => o.path.endsWith('.js'))
      .map(o => `${o.path.split('/').pop()}: ${(o.size / 1024).toFixed(1)}KB`)
      .join(', ');
    console.log(`  Chunks: ${chunks}`);
  }
}

async function copyFileIfExists(srcFile: string | null, destRelative: string) {
  if (!srcFile) return;
  const destFile = join(DIST_DIR, destRelative);
  await ensureDir(dirname(destFile));
  await cp(srcFile, destFile, { force: true });
}

async function copyDirIfExists(srcDir: string | null, destRelativeDir: string) {
  if (!srcDir) return;
  if (!existsSync(srcDir)) return;
  const destDir = join(DIST_DIR, destRelativeDir);
  await ensureDir(dirname(destDir));
  await cp(srcDir, destDir, { recursive: true, force: true });
}

async function manifestReferencesLib(manifestPath: string | null) {
  if (!manifestPath) return false;
  try {
    const text = await readFile(manifestPath, "utf8");
    return text.includes("lib/turndown.js") || text.includes("lib/readability.js") || text.includes("\"lib/") || text.includes("'lib/");
  } catch {
    return false;
  }
}

type ManifestShape = Record<string, unknown> & {
  permissions?: unknown;
  action?: Record<string, unknown>;
  background?: Record<string, unknown>;
  browser_specific_settings?: Record<string, unknown>;
  side_panel?: unknown;
};

function getBrowserSpecificSettings(manifest: ManifestShape) {
  return manifest.browser_specific_settings &&
    typeof manifest.browser_specific_settings === "object"
    ? (manifest.browser_specific_settings as Record<string, unknown>)
    : {};
}

function getNestedSettings(
  source: Record<string, unknown>,
  key: "gecko" | "gecko_android"
) {
  const value = source[key];
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function transformManifestForFirefoxBase(manifest: ManifestShape): ManifestShape {
  const permissions = Array.isArray(manifest.permissions)
    ? manifest.permissions.filter(
        (permission) => permission !== "sidePanel" && permission !== "offscreen"
      )
    : manifest.permissions;

  const browserSpecificSettings = getBrowserSpecificSettings(manifest);
  const geckoSettings = getNestedSettings(browserSpecificSettings, "gecko");
  const background =
    manifest.background && typeof manifest.background === "object"
      ? (manifest.background as Record<string, unknown>)
      : {};

  const serviceWorkerPath =
    typeof background.service_worker === "string"
      ? background.service_worker
      : "background/background.js";

  // The Firefox Android/Desktop builds export the visited page URL and clipped
  // page content into Obsidian, so AMO review/disclosure metadata must account
  // for browsing activity and website content when no explicit override exists.
  const dataCollectionPermissions =
    geckoSettings.data_collection_permissions &&
    typeof geckoSettings.data_collection_permissions === "object"
      ? geckoSettings.data_collection_permissions
      : {
          required: ["browsingActivity", "websiteContent"]
        };

  const { side_panel: _sidePanel, ...rest } = manifest;

  return {
    ...rest,
    permissions,
    background: {
      scripts: [serviceWorkerPath]
    },
    action: {
      ...(manifest.action || {}),
      default_popup: "popup/popup.html"
    },
    browser_specific_settings: {
      ...browserSpecificSettings,
      gecko: {
        ...geckoSettings,
        id: String(geckoSettings.id || "obsidian-web-clipper@t3rpz.local"),
        data_collection_permissions: dataCollectionPermissions
      }
    }
  };
}

function transformManifestForFirefoxAndroid(manifest: ManifestShape): ManifestShape {
  const browserSpecificSettings = getBrowserSpecificSettings(manifest);
  const geckoAndroidSettings = getNestedSettings(browserSpecificSettings, "gecko_android");

  const permissions = Array.isArray(manifest.permissions)
    ? manifest.permissions.filter((permission) => permission !== "nativeMessaging")
    : manifest.permissions;

  return {
    ...manifest,
    permissions,
    browser_specific_settings: {
      ...browserSpecificSettings,
      gecko: {
        ...getNestedSettings(browserSpecificSettings, "gecko"),
        strict_min_version: String(
          getNestedSettings(browserSpecificSettings, "gecko").strict_min_version || "140.0"
        )
      },
      gecko_android: {
        ...geckoAndroidSettings,
        strict_min_version: String(geckoAndroidSettings.strict_min_version || "142.0")
      }
    }
  };
}

function transformManifestForTarget(manifest: ManifestShape, target: BuildTarget): ManifestShape {
  if (target === "chrome") {
    return manifest;
  }

  const firefoxBase = transformManifestForFirefoxBase(manifest);
  return target === "firefox-android"
    ? transformManifestForFirefoxAndroid(firefoxBase)
    : firefoxBase;
}

async function copyPdfWorker() {
  const workerSrc = resolvePath("node_modules/pdfjs-dist/build/pdf.worker.min.js");
  const workerDest = join(DIST_DIR, "pdfjs/pdf.worker.js");
  await ensureDir(dirname(workerDest));
  await cp(workerSrc, workerDest, { force: true });
}

async function copyStaticAssets(target: BuildTarget) {
  const manifestPath = pickFirstExisting(["src/manifest.json", "manifest.json"]);
  if (manifestPath) {
    const manifestText = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestText) as ManifestShape;
    const transformedManifest = transformManifestForTarget(manifest, target);
    const manifestDest = join(DIST_DIR, "manifest.json");
    await ensureDir(dirname(manifestDest));
    await writeFile(manifestDest, `${JSON.stringify(transformedManifest, null, 2)}\n`, "utf8");
  }

  const popupHtml = pickFirstExisting(["src/popup/popup.html", "popup/popup.html"]);
  const popupCss = pickFirstExisting(["src/popup/popup.css", "popup/popup.css"]);
  await copyFileIfExists(popupHtml, "popup/popup.html");
  await copyFileIfExists(popupCss, "popup/popup.css");

  const optionsHtml = pickFirstExisting(["src/options/options.html", "options/options.html"]);
  const optionsCss = pickFirstExisting(["src/options/options.css", "options/options.css"]);
  await copyFileIfExists(optionsHtml, "options/options.html");
  await copyFileIfExists(optionsCss, "options/options.css");

  if (target !== "firefox-android") {
    const offscreenHtml = pickFirstExisting(["src/offscreen/offscreen.html"]);
    await copyFileIfExists(offscreenHtml, "offscreen/offscreen.html");
  }

  const iconsDir = pickFirstExisting(["src/icons", "icons"]);
  await copyDirIfExists(iconsDir, "icons");

  const shouldCopyLib = await manifestReferencesLib(manifestPath);
  if (shouldCopyLib) {
    const libDir = pickFirstExisting(["src/lib", "lib"]);
    await copyDirIfExists(libDir, "lib");
  }
}

async function buildAll(watchMode: boolean, target: BuildTarget) {
  const backgroundEntrypoint = pickFirstExisting(["src/background/background.ts", "background.js"]);
  const contentEntrypoint = pickFirstExisting(["src/content/content.ts", "content.js"]);
  const popupEntrypoint = pickFirstExisting(["src/popup/popup.ts", "popup/popup.js"]);
  const optionsEntrypoint = pickFirstExisting(["src/options/options.ts", "options/options.js"]);
  const offscreenEntrypoint = pickFirstExisting(["src/offscreen/offscreen.ts"]);

  const missing: string[] = [];
  if (!backgroundEntrypoint) missing.push("src/background/background.ts (or background.js)");
  if (!contentEntrypoint) missing.push("src/content/content.ts (or content.js)");
  if (!popupEntrypoint) missing.push("src/popup/popup.ts (or popup/popup.js)");
  if (!optionsEntrypoint) missing.push("src/options/options.ts (or options/options.js)");

  if (missing.length !== 0) {
    throw new Error("Missing entrypoints:\n- " + missing.join("\n- "));
  }

  await ensureDir(DIST_DIR);

  await bundleEntrypoint(backgroundEntrypoint!, "background", watchMode);
  // Keep content script as classic IIFE for maximum compatibility across
  // Chrome extension content script loading/injection paths.
  await bundleEntrypoint(contentEntrypoint!, "content", watchMode);
  await bundleEntrypoint(popupEntrypoint!, "popup", watchMode);
  await bundleEntrypoint(optionsEntrypoint!, "options", watchMode);
  if (offscreenEntrypoint && target !== "firefox-android") {
    await bundleEntrypoint(offscreenEntrypoint, "offscreen", watchMode);
  }

  await copyStaticAssets(target);
  if (target !== "firefox-android") {
    await copyPdfWorker();
  }
}

function startWatch(onChange: () => void) {
  const watchTargets: string[] = [];

  const maybeAdd = (relativePath: string) => {
    const abs = resolvePath(relativePath);
    if (existsSync(abs)) watchTargets.push(abs);
  };

  maybeAdd("src");
  maybeAdd("background.js");
  maybeAdd("content.js");
  maybeAdd("popup");
  maybeAdd("options");
  maybeAdd("icons");
  maybeAdd("lib");
  maybeAdd("manifest.json");

  const watchers: ReturnType<typeof fsWatch>[] = [];

  for (const target of watchTargets) {
    try {
      const watcher = fsWatch(target, { recursive: true }, () => onChange());
      watchers.push(watcher);
    } catch (err) {
      console.error("Failed to watch:", target, err);
    }
  }

  return () => {
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {}
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  DIST_DIR = resolveDistDir(args.target);

  if (!args.watch) {
    await cleanDist();
  }

  let building = false;
  let pending = false;
  let debounceTimer: any = null;

  const runBuild = async () => {
    if (building) {
      pending = true;
      return;
    }

    building = true;
    try {
      await buildAll(args.watch, args.target);
      console.log(`Build complete (${args.target}).`);
    } catch (err: any) {
      console.error(err?.message || err);
    } finally {
      building = false;
      if (pending) {
        pending = false;
        await runBuild();
      }
    }
  };

  if (!args.watch) {
    await runBuild();
    return;
  }

  await runBuild();

  const schedule = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      runBuild();
    }, 150);
  };

  startWatch(schedule);
  console.log("Watching for changes...");
}

main();