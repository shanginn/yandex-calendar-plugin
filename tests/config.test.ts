// Copyright 2026 Nikolai Shangin <shanginn@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("конфигурация", () => {
  it("требует отдельный пароль приложения", () => {
    expect(() =>
      loadConfig({ YANDEX_CALENDAR_USERNAME: "user@yandex.ru" }),
    ).toThrow("YANDEX_CALENDAR_APP_PASSWORD");
  });

  it("запрещает незашифрованный внешний CalDAV", () => {
    expect(() =>
      loadConfig({
        YANDEX_CALENDAR_USERNAME: "user@yandex.ru",
        YANDEX_CALENDAR_APP_PASSWORD: "secret",
        YANDEX_CALDAV_URL: "http://example.com/",
      }),
    ).toThrow("HTTPS");
  });

  it("разрешает HTTP только для изолированных локальных тестов", () => {
    expect(
      loadConfig({
        YANDEX_CALENDAR_USERNAME: "user@yandex.ru",
        YANDEX_CALENDAR_APP_PASSWORD: "secret",
        YANDEX_CALDAV_URL: "http://127.0.0.1:8765/",
        YANDEX_CALDAV_ALLOW_INSECURE_LOCALHOST: "1",
      }).baseUrl.toString(),
    ).toBe("http://127.0.0.1:8765/");
  });
});
