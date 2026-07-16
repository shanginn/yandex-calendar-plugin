// Copyright 2026 Nikolai Shangin <shanginn@gmail.com>
// SPDX-License-Identifier: Apache-2.0

export interface YandexCalendarConfig {
  username: string;
  appPassword: string;
  baseUrl: URL;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): YandexCalendarConfig {
  const username = env.YANDEX_CALENDAR_USERNAME?.trim();
  const appPassword = env.YANDEX_CALENDAR_APP_PASSWORD?.trim();

  if (!username) {
    throw new Error(
      "Не задана переменная YANDEX_CALENDAR_USERNAME с логином Яндекс Календаря.",
    );
  }
  if (!appPassword) {
    throw new Error(
      "Не задана переменная YANDEX_CALENDAR_APP_PASSWORD с паролем приложения для Календаря.",
    );
  }

  const baseUrl = new URL(
    env.YANDEX_CALDAV_URL?.trim() || "https://caldav.yandex.ru/",
  );
  const insecureLocalhostAllowed =
    env.YANDEX_CALDAV_ALLOW_INSECURE_LOCALHOST === "1" &&
    LOCAL_HOSTS.has(baseUrl.hostname);

  if (baseUrl.protocol !== "https:" && !insecureLocalhostAllowed) {
    throw new Error(
      "YANDEX_CALDAV_URL должен использовать HTTPS. HTTP разрешён только для локальных тестов.",
    );
  }

  if (!baseUrl.pathname.endsWith("/")) {
    baseUrl.pathname += "/";
  }

  return { username, appPassword, baseUrl };
}
