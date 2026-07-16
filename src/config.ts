// Copyright 2026 Nikolai Shangin <shanginn@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface YandexCalendarConfig {
  username: string;
  appPassword: string;
  baseUrl: URL;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

interface StoredCredentials {
  username?: string;
  appPassword?: string;
}

function credentialsFilePath(env: NodeJS.ProcessEnv): string {
  const configuredPath = env.YANDEX_CALENDAR_CREDENTIALS_FILE?.trim();
  if (configuredPath) return configuredPath;

  const configHome =
    env.XDG_CONFIG_HOME?.trim() || path.join(homedir(), ".config");
  return path.join(configHome, "yandex-calendar-plugin", "credentials.json");
}

function loadStoredCredentials(env: NodeJS.ProcessEnv): StoredCredentials {
  const filePath = credentialsFilePath(env);
  let metadata;
  try {
    metadata = statSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Не удалось проверить файл учётных данных ${filePath}.`, {
      cause: error,
    });
  }

  if (!metadata.isFile()) {
    throw new Error(`Путь учётных данных не является файлом: ${filePath}.`);
  }
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error(
      `Файл учётных данных ${filePath} должен быть доступен только владельцу (chmod 600).`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Не удалось прочитать файл учётных данных ${filePath}.`, {
      cause: error,
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Некорректный формат файла учётных данных ${filePath}.`);
  }

  const values = parsed as Record<string, unknown>;
  return {
    ...(typeof values.username === "string"
      ? { username: values.username.trim() }
      : {}),
    ...(typeof values.appPassword === "string"
      ? { appPassword: values.appPassword.trim() }
      : {}),
  };
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): YandexCalendarConfig {
  const storedCredentials = loadStoredCredentials(env);
  const username =
    env.YANDEX_CALENDAR_USERNAME?.trim() || storedCredentials.username;
  const appPassword =
    env.YANDEX_CALENDAR_APP_PASSWORD?.trim() || storedCredentials.appPassword;

  if (!username) {
    throw new Error(
      "Не задан логин Яндекс Календаря. Укажите YANDEX_CALENDAR_USERNAME или username в приватном файле учётных данных.",
    );
  }
  if (!appPassword) {
    throw new Error(
      "Не задан пароль приложения для Календаря. Укажите YANDEX_CALENDAR_APP_PASSWORD или appPassword в приватном файле учётных данных.",
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
