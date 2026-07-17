// Copyright 2026 Nikolai Shangin <shanginn@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const REQUIRED_CONFIRMATION = "create-and-delete-temporary-calendar";
if (process.env.YANDEX_CALENDAR_LIVE_DELETE_TEST !== REQUIRED_CONFIRMATION) {
  throw new Error(
    `Для живого теста задайте YANDEX_CALENDAR_LIVE_DELETE_TEST=${REQUIRED_CONFIRMATION}.`,
  );
}

const credentialsPath =
  process.env.YANDEX_CALENDAR_CREDENTIALS_FILE ||
  path.join(
    process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"),
    "yandex-calendar-plugin",
    "credentials.json",
  );
let stored = {};
try {
  stored = JSON.parse(await readFile(credentialsPath, "utf8"));
} catch (error) {
  if (
    !process.env.YANDEX_CALENDAR_USERNAME ||
    !process.env.YANDEX_CALENDAR_APP_PASSWORD
  ) {
    throw new Error(
      `Не удалось прочитать учётные данные из ${credentialsPath}.`,
      { cause: error },
    );
  }
}

const username =
  process.env.YANDEX_CALENDAR_USERNAME || stored.username?.trim();
const appPassword =
  process.env.YANDEX_CALENDAR_APP_PASSWORD || stored.appPassword?.trim();
const baseUrl = new URL(
  process.env.YANDEX_CALDAV_URL || "https://caldav.yandex.ru/",
);
if (!username || !appPassword) {
  throw new Error("Не заданы логин или пароль приложения Яндекс Календаря.");
}
if (baseUrl.protocol !== "https:") {
  throw new Error("Живой тест разрешён только через HTTPS.");
}

const authorization = `Basic ${Buffer.from(
  `${username}:${appPassword}`,
  "utf8",
).toString("base64")}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(
  root,
  "plugins",
  "yandex-calendar",
  "dist",
  "server.mjs",
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env },
});
const client = new Client({ name: "live-delete-test", version: "0.1.0" });

async function requestCalendar(url, method, body) {
  const target = new URL(url);
  if (target.origin !== baseUrl.origin) {
    throw new Error("Временный календарь вышел за пределы CalDAV origin.");
  }
  return fetch(target, {
    method,
    headers: {
      Authorization: authorization,
      ...(body ? { "Content-Type": "application/xml; charset=utf-8" } : {}),
    },
    ...(body ? { body } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
}

function calendarsFrom(result) {
  const calendars = result.structuredContent?.calendars;
  if (!Array.isArray(calendars)) {
    throw new Error("list_calendars не вернул структурированный список.");
  }
  return calendars;
}

const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const temporaryName = `Codex delete test ${stamp}`;
let homeUrl;
let requestedTemporaryUrl;
let actualTemporaryUrl;
let temporaryCreated = false;

try {
  await client.connect(transport);
  const initial = calendarsFrom(
    await client.callTool({ name: "list_calendars", arguments: {} }),
  );
  if (initial.length === 0) {
    throw new Error("Нельзя определить calendar-home без календарей.");
  }

  homeUrl = new URL("../", initial[0].url);
  requestedTemporaryUrl = new URL(
    `codex-delete-test-${Date.now()}/`,
    homeUrl,
  ).toString();
  if (
    initial.some(
      (calendar) =>
        calendar.url === requestedTemporaryUrl ||
        calendar.name === temporaryName,
    )
  ) {
    throw new Error("Временный календарь уже существует.");
  }

  const created = await requestCalendar(
    requestedTemporaryUrl,
    "MKCALENDAR",
    `<?xml version="1.0" encoding="utf-8"?>
     <c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
       <d:set><d:prop>
         <d:displayname>${temporaryName}</d:displayname>
         <c:supported-calendar-component-set>
           <c:comp name="VEVENT"/>
         </c:supported-calendar-component-set>
       </d:prop></d:set>
     </c:mkcalendar>`,
  );
  if (created.status !== 201) {
    await created.body?.cancel();
    throw new Error(`MKCALENDAR вернул HTTP ${created.status}.`);
  }
  await created.body?.cancel();
  temporaryCreated = true;

  const afterCreate = calendarsFrom(
    await client.callTool({ name: "list_calendars", arguments: {} }),
  );
  const temporaryCalendars = afterCreate.filter(
    (calendar) => calendar.name === temporaryName,
  );
  if (temporaryCalendars.length !== 1) {
    throw new Error("Созданный календарь не появился в list_calendars.");
  }
  const temporaryCalendar = temporaryCalendars[0];
  actualTemporaryUrl = temporaryCalendar.url;
  if (
    new URL(actualTemporaryUrl).origin !== baseUrl.origin ||
    new URL("../", actualTemporaryUrl).toString() !== homeUrl.toString()
  ) {
    throw new Error("Яндекс вернул временный календарь вне calendar-home.");
  }

  const deleted = await client.callTool({
    name: "delete_calendar",
    arguments: { calendar_url: temporaryCalendar.url, confirm: true },
  });
  if (deleted.isError) {
    throw new Error(`delete_calendar завершился ошибкой: ${deleted.content}`);
  }
  if (
    deleted.structuredContent?.deleted !== true ||
    deleted.structuredContent?.calendarUrl !== actualTemporaryUrl ||
    deleted.structuredContent?.name !== temporaryName
  ) {
    throw new Error("delete_calendar вернул неожиданный результат.");
  }
  temporaryCreated = false;

  const afterDelete = calendarsFrom(
    await client.callTool({ name: "list_calendars", arguments: {} }),
  );
  if (afterDelete.some((calendar) => calendar.url === actualTemporaryUrl)) {
    throw new Error("Удалённый тестовый календарь остался в list_calendars.");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        createdStatus: 201,
        deleted: true,
        deletedName: temporaryName,
        absentAfterDelete: true,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (temporaryCreated) {
    try {
      const current = calendarsFrom(
        await client.callTool({ name: "list_calendars", arguments: {} }),
      );
      const matches = current.filter(
        (calendar) =>
          calendar.name === temporaryName &&
          new URL(calendar.url).origin === baseUrl.origin &&
          (!homeUrl ||
            new URL("../", calendar.url).toString() === homeUrl.toString()),
      );
      if (matches.length === 1) {
        const cleanup = await client.callTool({
          name: "delete_calendar",
          arguments: { calendar_url: matches[0].url, confirm: true },
        });
        if (!cleanup.isError) temporaryCreated = false;
      }
    } catch {
      // The exact canonical URL below is the only permitted fallback target.
    }
  }
  await client.close().catch(() => undefined);
  if (temporaryCreated && actualTemporaryUrl) {
    const cleanup = await requestCalendar(actualTemporaryUrl, "DELETE");
    const cleanupStatus = cleanup.status;
    await cleanup.body?.cancel();
    if (![200, 204, 404].includes(cleanupStatus)) {
      throw new Error(
        `Аварийное удаление временного календаря вернуло HTTP ${cleanupStatus}.`,
      );
    }
    temporaryCreated = false;
  }
  if (temporaryCreated) {
    throw new Error(
      "Не удалось определить канонический URL временного календаря для аварийной очистки.",
    );
  }
}
