// Copyright 2026 Nikolai Shangin <shanginn@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import type { CalendarInfo } from "./caldav.js";

export const CALENDAR_LIST_FRESHNESS_MS = 5 * 60 * 1000;

export interface CalendarListSnapshot {
  listedAt: number;
  urls: ReadonlySet<string>;
}

export function captureCalendarList(
  calendars: CalendarInfo[],
  now = Date.now(),
): CalendarListSnapshot {
  return {
    listedAt: now,
    urls: new Set(calendars.map((calendar) => calendar.url)),
  };
}

export function requireFreshCalendarUrl(
  snapshot: CalendarListSnapshot | undefined,
  calendarUrl: string,
  now = Date.now(),
): void {
  if (
    !snapshot ||
    now < snapshot.listedAt ||
    now - snapshot.listedAt > CALENDAR_LIST_FRESHNESS_MS
  ) {
    throw new Error(
      "Перед delete_calendar вызовите list_calendars и используйте URL из его свежего ответа.",
    );
  }
  if (!snapshot.urls.has(calendarUrl)) {
    throw new Error(
      "calendar_url должен точно совпадать с URL из последнего свежего list_calendars.",
    );
  }
}

export function resolveCurrentCalendarForDeletion(
  calendars: CalendarInfo[],
  calendarUrl: string,
): CalendarInfo {
  const calendar = calendars.find((item) => item.url === calendarUrl);
  if (!calendar) {
    throw new Error(
      "Календарь не найден в актуальном списке Яндекса или уже удалён.",
    );
  }
  if (calendars.length <= 1) {
    throw new Error(
      "Нельзя удалить последний календарь аккаунта. Сначала создайте другой календарь.",
    );
  }
  return calendar;
}

export function assertCalendarIsNotDefault(
  calendar: CalendarInfo,
  defaultCalendarUrl: string | undefined,
): void {
  if (!defaultCalendarUrl) {
    throw new Error(
      "Яндекс CalDAV не сообщил URL основного календаря; безопасное удаление отменено.",
    );
  }
  if (calendar.url === defaultCalendarUrl) {
    throw new Error(
      "Нельзя удалить основной календарь. Сначала назначьте другой календарь основным в Яндекс Календаре.",
    );
  }
}
