// Copyright 2026 Nikolai Shangin <shanginn@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadConfig } from "../src/config.js";

describe("конфигурация", () => {
  it("требует отдельный пароль приложения", () => {
    expect(() =>
      loadConfig({
        YANDEX_CALENDAR_USERNAME: "user@yandex.ru",
        YANDEX_CALENDAR_CREDENTIALS_FILE: path.join(
          tmpdir(),
          "yandex-calendar-plugin-not-configured.json",
        ),
      }),
    ).toThrow("YANDEX_CALENDAR_APP_PASSWORD");
  });

  it("читает приватный файл учётных данных", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "yandex-calendar-"));
    const credentialsFile = path.join(directory, "credentials.json");
    try {
      writeFileSync(
        credentialsFile,
        JSON.stringify({
          username: "stored@yandex.ru",
          appPassword: "stored-secret",
        }),
        { mode: 0o600 },
      );
      const config = loadConfig({
        YANDEX_CALENDAR_CREDENTIALS_FILE: credentialsFile,
      });
      expect(config.username).toBe("stored@yandex.ru");
      expect(config.appPassword).toBe("stored-secret");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== "win32")(
    "отклоняет доступный другим пользователям файл",
    () => {
      const directory = mkdtempSync(path.join(tmpdir(), "yandex-calendar-"));
      const credentialsFile = path.join(directory, "credentials.json");
      try {
        writeFileSync(
          credentialsFile,
          JSON.stringify({ username: "user", appPassword: "secret" }),
        );
        chmodSync(credentialsFile, 0o644);
        expect(() =>
          loadConfig({ YANDEX_CALENDAR_CREDENTIALS_FILE: credentialsFile }),
        ).toThrow("chmod 600");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

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
