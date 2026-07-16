// Copyright 2026 Nikolai Shangin <shanginn@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { buildEventIcs, parseEvents, updateEventIcs } from "../src/ics.js";

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
});
