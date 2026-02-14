import type { Settings } from "./settings";
import { storageGet, storageSet } from "./chromeAsync";

export type BadgeCounterState = {
  count: number;
  periodStart: string;
  resetInterval: "daily" | "weekly";
};

interface BadgeCounterStorage extends Record<string, unknown> {
  badgeCounterState: BadgeCounterState;
}

const BADGE_COUNTER_KEY = "badgeCounterState";
const BADGE_BACKGROUND_COLOR: chrome.action.ColorArray = [124, 58, 237, 255];

function getPeriodStart(date: Date, resetInterval: "daily" | "weekly"): string {
  if (resetInterval === "daily") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
      .toISOString()
      .slice(0, 10);
  }

  const day = date.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday)
  );
  return monday.toISOString().slice(0, 10);
}

function normalizeState(
  stored: unknown,
  settings: Settings,
  now: Date
): BadgeCounterState {
  const resetInterval = settings.badgeCounterResetInterval === "weekly" ? "weekly" : "daily";
  const expectedPeriodStart = getPeriodStart(now, resetInterval);

  if (!stored || typeof stored !== "object") {
    return {
      count: 0,
      periodStart: expectedPeriodStart,
      resetInterval
    };
  }

  const candidate = stored as Partial<BadgeCounterState>;
  const count = Number.isFinite(candidate.count) ? Math.max(0, Math.floor(candidate.count as number)) : 0;
  const periodStart = typeof candidate.periodStart === "string" ? candidate.periodStart : expectedPeriodStart;
  const storedInterval = candidate.resetInterval === "weekly" ? "weekly" : "daily";

  if (storedInterval !== resetInterval || periodStart !== expectedPeriodStart) {
    return {
      count: 0,
      periodStart: expectedPeriodStart,
      resetInterval
    };
  }

  return {
    count,
    periodStart,
    resetInterval
  };
}

function formatBadgeText(count: number): string {
  if (count <= 0) return "";
  if (count > 999) return "999+";
  return String(count);
}

async function renderBadgeCount(count: number, enabled: boolean): Promise<void> {
  if (!chrome.action) return;

  if (!enabled) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }

  await chrome.action.setBadgeBackgroundColor({ color: BADGE_BACKGROUND_COLOR });
  await chrome.action.setBadgeText({ text: formatBadgeText(count) });
}

async function loadBadgeState(settings: Settings, now: Date): Promise<BadgeCounterState> {
  const stored = await storageGet<BadgeCounterStorage>([BADGE_COUNTER_KEY]);
  return normalizeState(stored[BADGE_COUNTER_KEY], settings, now);
}

export async function refreshBadgeCounter(settings: Settings): Promise<void> {
  const now = new Date();
  const state = await loadBadgeState(settings, now);
  await storageSet<BadgeCounterStorage>({ [BADGE_COUNTER_KEY]: state });
  await renderBadgeCount(state.count, settings.badgeCounterEnabled !== false);
}

export async function incrementBadgeCounter(settings: Settings): Promise<void> {
  const now = new Date();
  const state = await loadBadgeState(settings, now);
  const nextState: BadgeCounterState = {
    ...state,
    count: state.count + 1
  };

  await storageSet<BadgeCounterStorage>({ [BADGE_COUNTER_KEY]: nextState });
  await renderBadgeCount(nextState.count, settings.badgeCounterEnabled !== false);
}
