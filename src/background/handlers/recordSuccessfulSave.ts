import { incrementBadgeCounter } from "../../shared/badgeCounter";
import type { RuntimeRequest } from "../../shared/messages";
import { showClipSavedNotification } from "../../shared/notifications";
import { loadSettings } from "../../shared/settingsService";

type RecordSuccessfulSaveRequest = Extract<RuntimeRequest, { action: "recordSuccessfulSave" }>;

export async function handleRecordSuccessfulSave(
  request: RecordSuccessfulSaveRequest
): Promise<{ success: true }> {
  const settings = await loadSettings();
  void showClipSavedNotification(settings, request.noteTitle, request.vault);
  void incrementBadgeCounter(settings);
  return { success: true };
}
