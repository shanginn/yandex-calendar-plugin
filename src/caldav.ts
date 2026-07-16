// Copyright 2026 Nikolai Shangin <shanginn@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from "node:crypto";

import type { YandexCalendarConfig } from "./config.js";
import {
  buildEventIcs,
  parseEvents,
  parseEventsInRange,
  updateEventIcs,
  type CalendarEvent,
  type EventPatch,
} from "./ics.js";
import {
  hasCalendarResourceType,
  parseDavResponses,
  textValue,
} from "./xml.js";

export interface CalendarInfo {
  name: string;
  url: string;
  color?: string;
}

export interface EventResource extends CalendarEvent {
  eventUrl: string;
  etag?: string;
}

export interface CreateEventInput {
  calendarUrl: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  telemost?: boolean;
}

export interface UpdateEventInput extends EventPatch {
  eventUrl: string;
  expectedEtag?: string;
}

export interface DeleteEventInput {
  eventUrl: string;
  expectedEtag?: string;
}

class DavHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly method: string,
    public readonly url: string,
  ) {
    const hint =
      status === 401 || status === 403
        ? " Проверьте логин и пароль приложения Яндекс Календаря."
        : status === 412
          ? " Событие изменилось после чтения; перечитайте календарь и повторите действие."
          : "";
    super(`CalDAV вернул HTTP ${status} для ${method} ${url}.${hint}`);
    this.name = "DavHttpError";
  }
}

function toIcalUtc(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Граница диапазона должна быть датой и временем ISO 8601.");
  }
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export class YandexCalDavClient {
  readonly #authorization: string;

  constructor(private readonly config: YandexCalendarConfig) {
    this.#authorization = `Basic ${Buffer.from(
      `${config.username}:${config.appPassword}`,
      "utf8",
    ).toString("base64")}`;
  }

  #safeUrl(value: string | URL, base: URL = this.config.baseUrl): URL {
    const url = value instanceof URL ? new URL(value) : new URL(value, base);
    if (url.origin !== this.config.baseUrl.origin) {
      throw new Error(
        `CalDAV URL должен принадлежать ${this.config.baseUrl.origin}.`,
      );
    }
    url.username = "";
    url.password = "";
    return url;
  }

  async #request(
    urlValue: string | URL,
    init: RequestInit,
    expectedStatuses: number[],
  ): Promise<Response> {
    const url = this.#safeUrl(urlValue);
    const headers = new Headers(init.headers);
    headers.set("Authorization", this.#authorization);
    headers.set("User-Agent", "yandex-calendar-mcp/0.1.2");

    const response = await fetch(url, {
      ...init,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!expectedStatuses.includes(response.status)) {
      await response.body?.cancel();
      throw new DavHttpError(
        response.status,
        init.method ?? "GET",
        url.toString(),
      );
    }
    return response;
  }

  async #propfind(url: string | URL, depth: "0" | "1", body: string) {
    const response = await this.#request(
      url,
      {
        method: "PROPFIND",
        headers: {
          Depth: depth,
          "Content-Type": "application/xml; charset=utf-8",
        },
        body,
      },
      [207],
    );
    return parseDavResponses(await response.text());
  }

  async #discoverPrincipalUrl(): Promise<URL> {
    const responses = await this.#propfind(
      this.config.baseUrl,
      "0",
      `<?xml version="1.0" encoding="utf-8"?>
       <d:propfind xmlns:d="DAV:">
         <d:prop><d:current-user-principal/></d:prop>
       </d:propfind>`,
    );
    const href = textValue(
      (
        responses[0]?.prop["current-user-principal"] as
          Record<string, unknown> | undefined
      )?.href,
    );
    if (href) return this.#safeUrl(href);

    return this.#safeUrl(
      `/principals/users/${encodeURIComponent(this.config.username)}/`,
    );
  }

  async #discoverCalendarHome(): Promise<URL> {
    const principalUrl = await this.#discoverPrincipalUrl();
    const responses = await this.#propfind(
      principalUrl,
      "0",
      `<?xml version="1.0" encoding="utf-8"?>
       <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
         <d:prop><c:calendar-home-set/></d:prop>
       </d:propfind>`,
    );
    const href = textValue(
      (
        responses[0]?.prop["calendar-home-set"] as
          Record<string, unknown> | undefined
      )?.href,
    );
    if (!href) {
      throw new Error("CalDAV не вернул адрес хранилища календарей.");
    }
    return this.#safeUrl(href, principalUrl);
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const homeUrl = await this.#discoverCalendarHome();
    const responses = await this.#propfind(
      homeUrl,
      "1",
      `<?xml version="1.0" encoding="utf-8"?>
       <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/">
         <d:prop>
           <d:displayname/>
           <d:resourcetype/>
           <ic:calendar-color/>
         </d:prop>
       </d:propfind>`,
    );

    return responses
      .filter((item) => item.href && hasCalendarResourceType(item.prop))
      .map((item) => {
        const url = this.#safeUrl(item.href, homeUrl).toString();
        const name = textValue(item.prop.displayname) || new URL(url).pathname;
        const color = textValue(item.prop["calendar-color"]);
        return { name, url, ...(color ? { color } : {}) };
      });
  }

  async listEvents(
    calendarUrl: string,
    start: string,
    end: string,
  ): Promise<EventResource[]> {
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new Error("start и end должны быть датами и временем ISO 8601.");
    }
    if (startDate >= endDate) throw new Error("start должен быть раньше end.");
    if (endDate.getTime() - startDate.getTime() > 366 * 24 * 60 * 60 * 1000) {
      throw new Error("Диапазон list_events не должен превышать 366 дней.");
    }

    const calendar = this.#safeUrl(calendarUrl);
    const response = await this.#request(
      calendar,
      {
        method: "REPORT",
        headers: {
          Depth: "1",
          "Content-Type": "application/xml; charset=utf-8",
        },
        body: `<?xml version="1.0" encoding="utf-8"?>
          <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
            <d:prop><d:getetag/><c:calendar-data/></d:prop>
            <c:filter>
              <c:comp-filter name="VCALENDAR">
                <c:comp-filter name="VEVENT">
                  <c:time-range start="${toIcalUtc(start)}" end="${toIcalUtc(end)}"/>
                </c:comp-filter>
              </c:comp-filter>
            </c:filter>
          </c:calendar-query>`,
      },
      [207],
    );

    const resources: EventResource[] = [];
    for (const item of parseDavResponses(await response.text())) {
      const data = textValue(item.prop["calendar-data"]);
      if (!item.href || !data) continue;
      const eventUrl = this.#safeUrl(item.href, calendar).toString();
      const etag = textValue(item.prop.getetag);
      for (const event of parseEventsInRange(data, start, end)) {
        resources.push({ ...event, eventUrl, ...(etag ? { etag } : {}) });
      }
    }
    return resources;
  }

  async createEvent(input: CreateEventInput): Promise<EventResource> {
    const calendarUrl = this.#safeUrl(input.calendarUrl);
    if (!calendarUrl.pathname.endsWith("/")) calendarUrl.pathname += "/";
    const uid = randomUUID();
    const eventUrl = this.#safeUrl(`${uid}.ics`, calendarUrl);
    const ics = buildEventIcs({
      uid,
      title: input.title,
      start: input.start,
      end: input.end,
      ...(input.description ? { description: input.description } : {}),
      ...(input.location ? { location: input.location } : {}),
      ...(input.telemost !== undefined ? { telemost: input.telemost } : {}),
    });

    const response = await this.#request(
      eventUrl,
      {
        method: "PUT",
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "If-None-Match": "*",
        },
        body: ics,
      },
      [201, 204],
    );
    const event = parseEvents(ics)[0];
    if (!event) throw new Error("Не удалось проверить созданное событие.");
    const etag = response.headers.get("etag") ?? undefined;
    return {
      ...event,
      eventUrl: eventUrl.toString(),
      ...(etag ? { etag } : {}),
    };
  }

  async updateEvent(input: UpdateEventInput): Promise<EventResource> {
    const eventUrl = this.#safeUrl(input.eventUrl);
    const current = await this.#request(
      eventUrl,
      { method: "GET", headers: { Accept: "text/calendar" } },
      [200],
    );
    const currentEtag = current.headers.get("etag") ?? undefined;
    const ics = updateEventIcs(await current.text(), {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.start !== undefined ? { start: input.start } : {}),
      ...(input.end !== undefined ? { end: input.end } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
    });
    const ifMatch = input.expectedEtag ?? currentEtag;
    const response = await this.#request(
      eventUrl,
      {
        method: "PUT",
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          ...(ifMatch ? { "If-Match": ifMatch } : {}),
        },
        body: ics,
      },
      [200, 201, 204],
    );
    const event = parseEvents(ics)[0];
    if (!event) throw new Error("Не удалось проверить изменённое событие.");
    const etag = response.headers.get("etag") ?? currentEtag;
    return {
      ...event,
      eventUrl: eventUrl.toString(),
      ...(etag ? { etag } : {}),
    };
  }

  async deleteEvent(
    input: DeleteEventInput,
  ): Promise<{ deleted: true; eventUrl: string }> {
    const eventUrl = this.#safeUrl(input.eventUrl);
    await this.#request(
      eventUrl,
      {
        method: "DELETE",
        headers: input.expectedEtag ? { "If-Match": input.expectedEtag } : {},
      },
      [200, 204],
    );
    return { deleted: true, eventUrl: eventUrl.toString() };
  }
}
