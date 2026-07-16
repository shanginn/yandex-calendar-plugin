// Copyright 2026 Nikolai Shangin <shanginn@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import { YandexCalDavClient } from "./caldav.js";
import { loadConfig } from "./config.js";

const isoDateTime = z
  .string()
  .min(1)
  .describe(
    "Дата и время ISO 8601 с часовым поясом, например 2026-07-16T12:00:00+05:00",
  );
const resourceUrl = z
  .string()
  .url()
  .describe("URL ресурса, полученный из предыдущего вызова инструмента");

const calendarSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  color: z.string().optional(),
});
const eventSchema = z.object({
  uid: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  description: z.string().optional(),
  location: z.string().optional(),
  status: z.string().optional(),
  recurrenceId: z.string().optional(),
  eventUrl: z.string().url(),
  etag: z.string().optional(),
});

function success<T extends Record<string, unknown>>(data: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "yandex-calendar", version: "0.1.2" },
    {
      instructions:
        "Сначала получите URL календаря через list_calendars. Перед изменением или удалением перечитайте событие. delete_event вызывайте только после явного подтверждения пользователя.",
    },
  );

  server.registerTool(
    "list_calendars",
    {
      title: "Список календарей",
      description: "Возвращает доступные календари Яндекса и их CalDAV URL.",
      inputSchema: z.object({}),
      outputSchema: z.object({ calendars: z.array(calendarSchema) }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => {
      try {
        const calendars = await new YandexCalDavClient(
          loadConfig(),
        ).listCalendars();
        return success({ calendars });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "list_events",
    {
      title: "События за период",
      description:
        "Читает события выбранного календаря в диапазоне до 366 дней. calendar_url берётся из list_calendars.",
      inputSchema: z.object({
        calendar_url: resourceUrl,
        start: isoDateTime,
        end: isoDateTime,
      }),
      outputSchema: z.object({ events: z.array(eventSchema) }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ calendar_url, start, end }) => {
      try {
        const events = await new YandexCalDavClient(loadConfig()).listEvents(
          calendar_url,
          start,
          end,
        );
        return success({ events });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "create_event",
    {
      title: "Создать событие",
      description:
        "Создаёт одиночное событие в выбранном календаре. Может запросить ссылку Яндекс Телемоста.",
      inputSchema: z.object({
        calendar_url: resourceUrl,
        title: z.string().trim().min(1).max(500),
        start: isoDateTime,
        end: isoDateTime,
        description: z.string().max(20_000).optional(),
        location: z.string().max(2_000).optional(),
        telemost: z.boolean().optional().default(false),
      }),
      outputSchema: z.object({ event: eventSchema }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({
      calendar_url,
      title,
      start,
      end,
      description,
      location,
      telemost,
    }) => {
      try {
        const event = await new YandexCalDavClient(loadConfig()).createEvent({
          calendarUrl: calendar_url,
          title,
          start,
          end,
          ...(description !== undefined ? { description } : {}),
          ...(location !== undefined ? { location } : {}),
          telemost,
        });
        return success({ event });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "update_event",
    {
      title: "Изменить событие",
      description:
        "Изменяет одиночное событие по event_url из list_events. Для изменения времени передайте и start, и end.",
      inputSchema: z
        .object({
          event_url: resourceUrl,
          expected_etag: z.string().optional(),
          title: z.string().trim().min(1).max(500).optional(),
          start: isoDateTime.optional(),
          end: isoDateTime.optional(),
          description: z.string().max(20_000).nullable().optional(),
          location: z.string().max(2_000).nullable().optional(),
        })
        .refine(
          (value) => (value.start === undefined) === (value.end === undefined),
          {
            message: "start и end нужно передавать вместе",
          },
        ),
      outputSchema: z.object({ event: eventSchema }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({
      event_url,
      expected_etag,
      title,
      start,
      end,
      description,
      location,
    }) => {
      try {
        const event = await new YandexCalDavClient(loadConfig()).updateEvent({
          eventUrl: event_url,
          ...(expected_etag !== undefined
            ? { expectedEtag: expected_etag }
            : {}),
          ...(title !== undefined ? { title } : {}),
          ...(start !== undefined ? { start } : {}),
          ...(end !== undefined ? { end } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(location !== undefined ? { location } : {}),
        });
        return success({ event });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "delete_event",
    {
      title: "Удалить событие",
      description:
        "Безвозвратно удаляет событие по event_url. Требует confirm=true после явного подтверждения пользователя.",
      inputSchema: z.object({
        event_url: resourceUrl,
        expected_etag: z.string().optional(),
        confirm: z.literal(true).describe("Явное подтверждение удаления"),
      }),
      outputSchema: z.object({
        deleted: z.literal(true),
        eventUrl: z.string().url(),
      }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ event_url, expected_etag }) => {
      try {
        return success(
          await new YandexCalDavClient(loadConfig()).deleteEvent({
            eventUrl: event_url,
            ...(expected_etag !== undefined
              ? { expectedEtag: expected_etag }
              : {}),
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Yandex Calendar MCP: ${message}\n`);
  process.exitCode = 1;
});
