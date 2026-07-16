// Copyright 2026 Nikolai Shangin <shanginn@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  buildEventIcs,
  parseEvents,
  parseEventsInRange,
  updateEventIcs,
} from "../src/ics.js";

describe("iCalendar", () => {
  it("создаёт и читает событие с Unicode и Телемостом", () => {
    const ics = buildEventIcs({
      uid: "test-uid",
      title: "Встреча: продукт, релиз",
      start: "2026-07-16T12:00:00+05:00",
      end: "2026-07-16T13:00:00+05:00",
      description: "Строка 1\nСтрока 2",
      location: "Екатеринбург",
      telemost: true,
    });

    expect(ics).toContain("X-TELEMOST-REQUIRED:TRUE");
    expect(parseEvents(ics)).toEqual([
      expect.objectContaining({
        uid: "test-uid",
        title: "Встреча: продукт, релиз",
        start: "2026-07-16T07:00:00.000Z",
        end: "2026-07-16T08:00:00.000Z",
        description: "Строка 1\nСтрока 2",
        location: "Екатеринбург",
      }),
    ]);
  });

  it("изменяет поля, удаляет пустые и сохраняет UID", () => {
    const original = buildEventIcs({
      uid: "stable-uid",
      title: "Черновик",
      start: "2026-07-16T10:00:00Z",
      end: "2026-07-16T11:00:00Z",
      description: "Удалить",
    });
    const updated = updateEventIcs(original, {
      title: "Готово",
      description: null,
      location: "Переговорная",
    });

    expect(parseEvents(updated)[0]).toEqual(
      expect.objectContaining({
        uid: "stable-uid",
        title: "Готово",
        location: "Переговорная",
      }),
    );
    expect(parseEvents(updated)[0]).not.toHaveProperty("description");
  });

  it("не принимает обратный диапазон времени", () => {
    expect(() =>
      buildEventIcs({
        uid: "bad",
        title: "Ошибка",
        start: "2026-07-16T12:00:00Z",
        end: "2026-07-16T11:00:00Z",
      }),
    ).toThrow("start должен быть раньше end");
  });

  it("не возвращает orphan overrides вне запрошенного диапазона", () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:7VE5YkT2yandex.ru
SUMMARY:Планерка Методист
RECURRENCE-ID:20230822T063000Z
DTSTART:20230822T064000Z
DTEND:20230822T070000Z
END:VEVENT
BEGIN:VEVENT
UID:7VE5YkT2yandex.ru
SUMMARY:Планерка Методист
RECURRENCE-ID:20231016T063000Z
DTSTART:20231016T070000Z
DTEND:20231016T072000Z
END:VEVENT
END:VCALENDAR`;

    expect(
      parseEventsInRange(
        ics,
        "2026-07-16T00:00:00+05:00",
        "2026-07-17T00:00:00+05:00",
      ),
    ).toEqual([]);
  });

  it("разворачивает recurrence, учитывает EXDATE и применяет override", () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:daily-series
SUMMARY:Обычная планёрка
DTSTART:20260714T063000Z
DTEND:20260714T070000Z
RRULE:FREQ=DAILY;COUNT=5
EXDATE:20260715T063000Z,20260716T063000Z
END:VEVENT
BEGIN:VEVENT
UID:daily-series
RECURRENCE-ID:20260716T063000Z
SUMMARY:Актуальная планёрка
DTSTART:20260716T064000Z
DTEND:20260716T070000Z
END:VEVENT
BEGIN:VEVENT
UID:daily-series
RECURRENCE-ID:20260717T063000Z
STATUS:CANCELLED
SUMMARY:Отменённая планёрка
DTSTART:20260717T063000Z
DTEND:20260717T070000Z
END:VEVENT
END:VCALENDAR`;

    expect(
      parseEventsInRange(
        ics,
        "2026-07-16T00:00:00+05:00",
        "2026-07-17T00:00:00+05:00",
      ),
    ).toEqual([
      expect.objectContaining({
        uid: "daily-series",
        title: "Актуальная планёрка",
        start: "2026-07-16T06:40:00.000Z",
        end: "2026-07-16T07:00:00.000Z",
        recurrenceId: "2026-07-16T06:30:00.000Z",
      }),
    ]);

    expect(
      parseEventsInRange(
        ics,
        "2026-07-15T00:00:00+05:00",
        "2026-07-16T00:00:00+05:00",
      ),
    ).toEqual([]);
    expect(
      parseEventsInRange(
        ics,
        "2026-07-17T00:00:00+05:00",
        "2026-07-18T00:00:00+05:00",
      ),
    ).toEqual([]);
  });

  it("использует полуоткрытый диапазон и возвращает пересекающие его события", () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:ends-at-start
DTSTART:20260715T180000Z
DTEND:20260715T190000Z
END:VEVENT
BEGIN:VEVENT
UID:overlaps-start
DTSTART:20260715T183000Z
DTEND:20260715T193000Z
END:VEVENT
BEGIN:VEVENT
UID:starts-at-end
DTSTART:20260716T190000Z
DTEND:20260716T200000Z
END:VEVENT
END:VCALENDAR`;

    expect(
      parseEventsInRange(
        ics,
        "2026-07-16T00:00:00+05:00",
        "2026-07-17T00:00:00+05:00",
      ).map((event) => event.uid),
    ).toEqual(["overlaps-start"]);
  });
});
