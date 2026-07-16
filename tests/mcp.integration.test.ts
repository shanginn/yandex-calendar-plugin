// Copyright 2026 Nikolai Shangin <shanginn@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildEventIcs } from "../src/ics.js";

const USERNAME = "test@yandex.ru";
const PASSWORD = "calendar-app-password";
const PRINCIPAL = `/principals/users/${USERNAME}/`;
const HOME = `/calendars/${USERNAME}/`;
const CALENDAR = `${HOME}events-default/`;
const EXPECTED_AUTH = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;

function multistatus(responses: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
    <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/">
      ${responses}
    </d:multistatus>`;
}

function propResponse(href: string, props: string): string {
  return `<d:response>
    <d:href>${href}</d:href>
    <d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>`;
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) body += chunk;
  return body;
}

describe("MCP ↔ CalDAV", () => {
  const resources = new Map<string, { ics: string; etag: string }>();
  let etagCounter = 1;
  let baseUrl = "";
  let client: Client;
  let transport: StdioClientTransport;

  const httpServer = createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      if (request.headers.authorization !== EXPECTED_AUTH) {
        response.writeHead(401).end();
        return;
      }
      const path = new URL(request.url ?? "/", baseUrl).pathname;

      if (request.method === "PROPFIND" && path === "/") {
        response.writeHead(207, { "Content-Type": "application/xml" });
        response.end(
          multistatus(
            propResponse(
              "/",
              `<d:current-user-principal><d:href>${PRINCIPAL}</d:href></d:current-user-principal>`,
            ),
          ),
        );
        return;
      }
      if (request.method === "PROPFIND" && path === PRINCIPAL) {
        response.writeHead(207, { "Content-Type": "application/xml" });
        response.end(
          multistatus(
            propResponse(
              PRINCIPAL,
              `<c:calendar-home-set><d:href>${HOME}</d:href></c:calendar-home-set>`,
            ),
          ),
        );
        return;
      }
      if (request.method === "PROPFIND" && path === HOME) {
        response.writeHead(207, { "Content-Type": "application/xml" });
        response.end(
          multistatus(
            propResponse(
              HOME,
              `<d:resourcetype><d:collection/></d:resourcetype>`,
            ) +
              propResponse(
                CALENDAR,
                `<d:displayname>Основной</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><ic:calendar-color>#ffcc00</ic:calendar-color>`,
              ),
          ),
        );
        return;
      }
      if (request.method === "REPORT" && path === CALENDAR) {
        const responses = [...resources.entries()]
          .map(([eventPath, resource]) =>
            propResponse(
              eventPath,
              `<d:getetag>${resource.etag}</d:getetag><c:calendar-data><![CDATA[${resource.ics}]]></c:calendar-data>`,
            ),
          )
          .join("");
        response.writeHead(207, { "Content-Type": "application/xml" });
        response.end(multistatus(responses));
        return;
      }
      if (request.method === "GET" && resources.has(path)) {
        const resource = resources.get(path)!;
        response.writeHead(200, {
          "Content-Type": "text/calendar",
          ETag: resource.etag,
        });
        response.end(resource.ics);
        return;
      }
      if (request.method === "PUT" && path.startsWith(CALENDAR)) {
        const existed = resources.has(path);
        const current = resources.get(path);
        if (
          existed &&
          request.headers["if-match"] &&
          request.headers["if-match"] !== current?.etag
        ) {
          response.writeHead(412).end();
          return;
        }
        const etag = `\"${++etagCounter}\"`;
        resources.set(path, { ics: await readBody(request), etag });
        response.writeHead(existed ? 204 : 201, { ETag: etag }).end();
        return;
      }
      if (request.method === "DELETE" && resources.has(path)) {
        resources.delete(path);
        response.writeHead(204).end();
        return;
      }

      response.writeHead(404).end();
    },
  );

  beforeAll(async () => {
    resources.set(`${CALENDAR}existing.ics`, {
      ics: buildEventIcs({
        uid: "existing",
        title: "Существующая встреча",
        start: "2026-07-16T07:00:00Z",
        end: "2026-07-16T08:00:00Z",
      }),
      etag: `\"${etagCounter}\"`,
    });
    resources.set(`${CALENDAR}orphan-overrides.ics`, {
      ics: `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:old-series\r
SUMMARY:Старая встреча\r
RECURRENCE-ID:20230822T063000Z\r
DTSTART:20230822T064000Z\r
DTEND:20230822T070000Z\r
END:VEVENT\r
END:VCALENDAR\r
`,
      etag: `\"${etagCounter}\"`,
    });

    httpServer.listen(0, "127.0.0.1");
    await once(httpServer, "listening");
    const address = httpServer.address();
    if (!address || typeof address === "string")
      throw new Error("Нет тестового порта");
    baseUrl = `http://127.0.0.1:${address.port}/`;

    const serverPath = fileURLToPath(
      new URL("../plugins/yandex-calendar/dist/server.mjs", import.meta.url),
    );
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: {
        PATH: process.env.PATH ?? "",
        YANDEX_CALENDAR_USERNAME: USERNAME,
        YANDEX_CALENDAR_APP_PASSWORD: PASSWORD,
        YANDEX_CALDAV_URL: baseUrl,
        YANDEX_CALDAV_ALLOW_INSECURE_LOCALHOST: "1",
      },
    });
    client = new Client({ name: "integration-test", version: "0.1.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
    httpServer.close();
    await once(httpServer, "close");
  });

  it("объявляет пять инструментов с корректными safety-аннотациями", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "list_calendars",
      "list_events",
      "create_event",
      "update_event",
      "delete_event",
    ]);
    expect(
      tools.find((tool) => tool.name === "list_events")?.annotations,
    ).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(
      tools.find((tool) => tool.name === "delete_event")?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it("выполняет полный цикл чтения, создания, изменения и удаления", async () => {
    const calendars = await client.callTool({
      name: "list_calendars",
      arguments: {},
    });
    expect(calendars.structuredContent).toEqual({
      calendars: [
        {
          name: "Основной",
          url: `${baseUrl.slice(0, -1)}${CALENDAR}`,
          color: "#ffcc00",
        },
      ],
    });

    const listed = await client.callTool({
      name: "list_events",
      arguments: {
        calendar_url: `${baseUrl.slice(0, -1)}${CALENDAR}`,
        start: "2026-07-01T00:00:00Z",
        end: "2026-08-01T00:00:00Z",
      },
    });
    expect(listed.structuredContent).toEqual({
      events: [
        expect.objectContaining({
          uid: "existing",
          title: "Существующая встреча",
        }),
      ],
    });

    const created = await client.callTool({
      name: "create_event",
      arguments: {
        calendar_url: `${baseUrl.slice(0, -1)}${CALENDAR}`,
        title: "Новая встреча",
        start: "2026-07-17T10:00:00+05:00",
        end: "2026-07-17T11:00:00+05:00",
        location: "Онлайн",
      },
    });
    const createdEvent = (
      created.structuredContent as { event: { eventUrl: string; etag: string } }
    ).event;
    expect(created.structuredContent).toMatchObject({
      event: { title: "Новая встреча" },
    });

    const updated = await client.callTool({
      name: "update_event",
      arguments: {
        event_url: createdEvent.eventUrl,
        expected_etag: createdEvent.etag,
        title: "Обновлённая встреча",
      },
    });
    expect(updated.structuredContent).toMatchObject({
      event: { title: "Обновлённая встреча" },
    });

    const staleUpdate = await client.callTool({
      name: "update_event",
      arguments: {
        event_url: createdEvent.eventUrl,
        expected_etag: createdEvent.etag,
        title: "Это изменение не должно сохраниться",
      },
    });
    expect(staleUpdate.isError).toBe(true);
    expect(staleUpdate.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining("HTTP 412") }),
    ]);

    const deleted = await client.callTool({
      name: "delete_event",
      arguments: { event_url: createdEvent.eventUrl, confirm: true },
    });
    expect(deleted.structuredContent).toEqual({
      deleted: true,
      eventUrl: createdEvent.eventUrl,
    });
    expect(resources.has(new URL(createdEvent.eventUrl).pathname)).toBe(false);
  });

  it("не принимает удаление без явного confirm=true", async () => {
    const result = await client.callTool({
      name: "delete_event",
      arguments: {
        event_url: `${baseUrl.slice(0, -1)}${CALENDAR}existing.ics`,
      },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("confirm"),
      }),
    ]);
  });

  it("блокирует другой origin и слишком широкий диапазон до сетевого запроса", async () => {
    const foreignOrigin = await client.callTool({
      name: "list_events",
      arguments: {
        calendar_url: "https://example.com/private/",
        start: "2026-07-01T00:00:00Z",
        end: "2026-08-01T00:00:00Z",
      },
    });
    expect(foreignOrigin.isError).toBe(true);
    expect(foreignOrigin.content).toEqual([
      expect.objectContaining({
        text: expect.stringContaining("должен принадлежать"),
      }),
    ]);

    const excessiveRange = await client.callTool({
      name: "list_events",
      arguments: {
        calendar_url: `${baseUrl.slice(0, -1)}${CALENDAR}`,
        start: "2025-01-01T00:00:00Z",
        end: "2026-07-16T00:00:00Z",
      },
    });
    expect(excessiveRange.isError).toBe(true);
    expect(excessiveRange.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining("366") }),
    ]);
  });
});
