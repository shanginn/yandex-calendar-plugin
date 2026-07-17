// Copyright 2026 Nikolai Shangin <shanginn@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  assertCalendarIsNotDefault,
  CALENDAR_LIST_FRESHNESS_MS,
  captureCalendarList,
  requireFreshCalendarUrl,
  resolveCurrentCalendarForDeletion,
} from "../src/calendar-safety.js";

const primary = {
  name: "Основной",
  url: "https://caldav.yandex.ru/calendars/user/events-primary/",
};
const secondary = {
  name: "Тестовый",
  url: "https://caldav.yandex.ru/calendars/user/events-test/",
};

describe("безопасное удаление календаря", () => {
  it("принимает только точный URL из свежего list_calendars", () => {
    const snapshot = captureCalendarList([primary, secondary], 1_000);

    expect(() =>
      requireFreshCalendarUrl(snapshot, secondary.url, 1_001),
    ).not.toThrow();
    expect(() =>
      requireFreshCalendarUrl(snapshot, `${secondary.url}?other=1`, 1_001),
    ).toThrow("точно совпадать");
    expect(() =>
      requireFreshCalendarUrl(
        snapshot,
        secondary.url,
        1_000 + CALENDAR_LIST_FRESHNESS_MS + 1,
      ),
    ).toThrow("list_calendars");
  });

  it("отличает уже удалённый календарь и блокирует последний", () => {
    expect(() =>
      resolveCurrentCalendarForDeletion([primary, secondary], secondary.url),
    ).not.toThrow();
    expect(() =>
      resolveCurrentCalendarForDeletion([primary], secondary.url),
    ).toThrow("уже удалён");
    expect(() =>
      resolveCurrentCalendarForDeletion([primary], primary.url),
    ).toThrow("последний");
  });

  it("защищает серверный default и отменяет удаление без его URL", () => {
    expect(() => assertCalendarIsNotDefault(primary, primary.url)).toThrow(
      "основной",
    );
    expect(() => assertCalendarIsNotDefault(secondary, undefined)).toThrow(
      "безопасное удаление отменено",
    );
    expect(() =>
      assertCalendarIsNotDefault(secondary, primary.url),
    ).not.toThrow();
  });
});
