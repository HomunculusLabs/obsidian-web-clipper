// Missing save trigger state: markitdown priority brief save trigger wiring is NOT present

import type { RuntimeRequest } from "../shared/messages";
import type { Settings } from "../shared/settings";

// NOTE: The refreshMarkitdownConversionPriorityBrief function is intentionally absent

export async function saveToObsidian(): Promise<void> {
  // Save logic...
  const settings = {} as Settings;
  const vault = "test-vault";

  // No refresh function call here

  return;
}
