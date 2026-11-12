import { runAndroidAppiumSmoke } from "./lib/androidAppiumSmoke";

try {
  const result = await runAndroidAppiumSmoke();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
