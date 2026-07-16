// Copyright 2026 Nikolai Shangin <shanginn@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import ICAL from "ical.js";

export interface CalendarEvent {
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description?: string;
  location?: string;
  status?: string;
  recurrenceId?: string;
}

export interface NewEventInput {
  uid: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  telemost?: boolean;
}

export interface EventPatch {
  title?: string;
  start?: string;
  end?: string;
  description?: string | null;
  location?: string | null;
}

function parseInstant(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} должен быть датой и временем ISO 8601.`);
  }
  return parsed;
}

function icalTime(value: string, field: string): ICAL.Time {
  return ICAL.Time.fromJSDate(parseInstant(value, field), true);
}

function timeToText(value: unknown): string {
  if (value instanceof ICAL.Time) {
    if (value.isDate) return value.toString();
    return value.toJSDate().toISOString();
  }
  return String(value ?? "");
}

function optionalText(
  component: ICAL.Component,
  property: string,
): string | undefined {
  const value = component.getFirstPropertyValue(property);
  if (value === null || value === undefined || value === "") return undefined;
  return String(value);
}

function serializeEvent(component: ICAL.Component): CalendarEvent {
  const start = component.getFirstPropertyValue("dtstart");
  const end = component.getFirstPropertyValue("dtend");
  const allDay = start instanceof ICAL.Time ? start.isDate : false;
  const uid = optionalText(component, "uid");
  if (!uid || !start || !end) {
    throw new Error(
      "Событие CalDAV не содержит обязательные UID, DTSTART или DTEND.",
    );
  }

  const description = optionalText(component, "description");
  const location = optionalText(component, "location");
  const status = optionalText(component, "status");
  const recurrenceId = component.getFirstPropertyValue("recurrence-id");

  return {
    uid,
    title: optionalText(component, "summary") ?? "Без названия",
    start: timeToText(start),
    end: timeToText(end),
    allDay,
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    ...(status ? { status } : {}),
    ...(recurrenceId ? { recurrenceId: timeToText(recurrenceId) } : {}),
  };
}

export function parseEvents(ics: string): CalendarEvent[] {
  const root = new ICAL.Component(ICAL.parse(ics));
  return root.getAllSubcomponents("vevent").map(serializeEvent);
}

function recurrenceKey(value: ICAL.Time): string {
  return value.isDate
    ? `date:${value.toString()}`
    : `time:${value.toUnixTime()}`;
}

function overlapsRange(
  eventStart: ICAL.Time,
  eventEnd: ICAL.Time,
  rangeStart: Date,
  rangeEnd: Date,
): boolean {
  return (
    eventStart.toJSDate().getTime() < rangeEnd.getTime() &&
    eventEnd.toJSDate().getTime() > rangeStart.getTime()
  );
}

function serializeOccurrence(
  item: ICAL.Event,
  start: ICAL.Time,
  end: ICAL.Time,
  recurrenceId?: ICAL.Time,
): CalendarEvent {
  const component = item.component;
  const uid = optionalText(component, "uid");
  if (!uid) {
    throw new Error("Событие CalDAV не содержит обязательный UID.");
  }

  const description = optionalText(component, "description");
  const location = optionalText(component, "location");
  const status = optionalText(component, "status");

  return {
    uid,
    title: optionalText(component, "summary") ?? "Без названия",
    start: timeToText(start),
    end: timeToText(end),
    allDay: start.isDate,
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    ...(status ? { status } : {}),
    ...(recurrenceId ? { recurrenceId: timeToText(recurrenceId) } : {}),
  };
}

function isCancelled(event: ICAL.Event): boolean {
  return optionalText(event.component, "status")?.toUpperCase() === "CANCELLED";
}

const MAX_RECURRENCE_ITERATIONS = 100_000;

/**
 * Expands recurring VEVENTs and returns only instances intersecting the
 * half-open interval [start, end). EXDATE, RECURRENCE-ID overrides and
 * RANGE=THISANDFUTURE exceptions are handled by ICAL.Event.
 */
export function parseEventsInRange(
  ics: string,
  start: string,
  end: string,
): CalendarEvent[] {
  const rangeStart = parseInstant(start, "start");
  const rangeEnd = parseInstant(end, "end");
  if (rangeStart >= rangeEnd) throw new Error("start должен быть раньше end.");

  const root = new ICAL.Component(ICAL.parse(ics));
  const components = root.getAllSubcomponents("vevent");
  const masters = components.filter(
    (component) => !component.hasProperty("recurrence-id"),
  );
  const overridesByUid = new Map<string, Map<string, ICAL.Component>>();

  for (const component of components) {
    const recurrenceId = component.getFirstPropertyValue("recurrence-id");
    const uid = optionalText(component, "uid");
    if (!(recurrenceId instanceof ICAL.Time) || !uid) continue;
    let overrides = overridesByUid.get(uid);
    if (!overrides) {
      overrides = new Map();
      overridesByUid.set(uid, overrides);
    }
    overrides.set(recurrenceKey(recurrenceId), component);
  }

  const result: CalendarEvent[] = [];
  const relatedOverrideKeys = new Set<string>();

  for (const component of masters) {
    const master = new ICAL.Event(component);
    const overrideComponents = [
      ...(overridesByUid.get(master.uid)?.values() ?? []),
    ];
    const event = new ICAL.Event(component, {
      exceptions: overrideComponents,
      strictExceptions: true,
    });

    if (!event.isRecurring()) {
      if (
        !isCancelled(event) &&
        overlapsRange(event.startDate, event.endDate, rangeStart, rangeEnd)
      ) {
        result.push(serializeOccurrence(event, event.startDate, event.endDate));
      }
      continue;
    }

    let expansionEnd = rangeEnd.getTime();
    for (const overrideComponent of overrideComponents) {
      const override = new ICAL.Event(overrideComponent);
      const recurrenceId = override.recurrenceId;
      if (!(recurrenceId instanceof ICAL.Time)) continue;

      if (
        overlapsRange(
          override.startDate,
          override.endDate,
          rangeStart,
          rangeEnd,
        )
      ) {
        expansionEnd = Math.max(
          expansionEnd,
          recurrenceId.toJSDate().getTime() + 1,
        );
      }
      if (override.modifiesFuture()) {
        const shift =
          override.startDate.toJSDate().getTime() -
          recurrenceId.toJSDate().getTime();
        if (shift < 0)
          expansionEnd = Math.max(expansionEnd, rangeEnd.getTime() - shift);
      }
    }

    const iterator = event.iterator();
    let iterations = 0;
    let occurrence: ICAL.Time | null;
    while ((occurrence = iterator.next())) {
      if (++iterations > MAX_RECURRENCE_ITERATIONS) {
        throw new Error(
          "Серия содержит слишком много повторений для безопасного разворачивания.",
        );
      }
      if (occurrence.toJSDate().getTime() >= expansionEnd) break;

      const details = event.getOccurrenceDetails(occurrence);
      const key = recurrenceKey(details.recurrenceId);
      relatedOverrideKeys.add(`${event.uid}\0${key}`);
      if (
        !isCancelled(details.item) &&
        overlapsRange(details.startDate, details.endDate, rangeStart, rangeEnd)
      ) {
        result.push(
          serializeOccurrence(
            details.item,
            details.startDate,
            details.endDate,
            details.recurrenceId,
          ),
        );
      }
    }

    // Some providers emit an EXDATE together with its RECURRENCE-ID override,
    // or return an override whose original instance lies outside the query.
    // The recurrence iterator skips those, so include a matching override once.
    for (const overrideComponent of overrideComponents) {
      const override = new ICAL.Event(overrideComponent);
      const recurrenceId = override.recurrenceId;
      if (!(recurrenceId instanceof ICAL.Time)) continue;
      const key = recurrenceKey(recurrenceId);
      if (relatedOverrideKeys.has(`${event.uid}\0${key}`)) continue;
      relatedOverrideKeys.add(`${event.uid}\0${key}`);
      if (
        !isCancelled(override) &&
        overlapsRange(
          override.startDate,
          override.endDate,
          rangeStart,
          rangeEnd,
        )
      ) {
        result.push(
          serializeOccurrence(
            override,
            override.startDate,
            override.endDate,
            recurrenceId,
          ),
        );
      }
    }
  }

  const masterUids = new Set(
    masters.map((component) => optionalText(component, "uid")),
  );
  for (const [uid, overrides] of overridesByUid) {
    if (masterUids.has(uid)) continue;
    for (const overrideComponent of overrides.values()) {
      const override = new ICAL.Event(overrideComponent);
      if (
        !isCancelled(override) &&
        overlapsRange(
          override.startDate,
          override.endDate,
          rangeStart,
          rangeEnd,
        )
      ) {
        result.push(
          serializeOccurrence(
            override,
            override.startDate,
            override.endDate,
            override.recurrenceId,
          ),
        );
      }
    }
  }

  return result.sort(
    (left, right) =>
      new Date(left.start).getTime() - new Date(right.start).getTime() ||
      left.uid.localeCompare(right.uid) ||
      (left.recurrenceId ?? "").localeCompare(right.recurrenceId ?? ""),
  );
}

export function buildEventIcs(input: NewEventInput): string {
  const start = parseInstant(input.start, "start");
  const end = parseInstant(input.end, "end");
  if (start >= end) throw new Error("start должен быть раньше end.");

  const calendar = new ICAL.Component("vcalendar");
  calendar.addPropertyWithValue(
    "prodid",
    "-//shanginn//Yandex Calendar MCP//RU",
  );
  calendar.addPropertyWithValue("version", "2.0");
  calendar.addPropertyWithValue("calscale", "GREGORIAN");

  const event = new ICAL.Component("vevent");
  event.addPropertyWithValue("uid", input.uid);
  event.addPropertyWithValue("dtstamp", ICAL.Time.now());
  event.addPropertyWithValue("dtstart", ICAL.Time.fromJSDate(start, true));
  event.addPropertyWithValue("dtend", ICAL.Time.fromJSDate(end, true));
  event.addPropertyWithValue("summary", input.title);
  if (input.description)
    event.addPropertyWithValue("description", input.description);
  if (input.location) event.addPropertyWithValue("location", input.location);
  if (input.telemost) event.addPropertyWithValue("x-telemost-required", "TRUE");
  calendar.addSubcomponent(event);

  return `${calendar.toString()}\r\n`;
}

function replaceOptionalText(
  component: ICAL.Component,
  property: string,
  value: string | null | undefined,
): void {
  if (value === undefined) return;
  component.removeAllProperties(property);
  if (value !== null && value !== "") {
    component.addPropertyWithValue(property, value);
  }
}

export function updateEventIcs(ics: string, patch: EventPatch): string {
  if ((patch.start === undefined) !== (patch.end === undefined)) {
    throw new Error(
      "При изменении времени нужно передать одновременно start и end.",
    );
  }

  const root = new ICAL.Component(ICAL.parse(ics));
  const event = root.getFirstSubcomponent("vevent");
  if (!event) throw new Error("В ресурсе CalDAV не найден VEVENT.");

  replaceOptionalText(event, "summary", patch.title);
  replaceOptionalText(event, "description", patch.description);
  replaceOptionalText(event, "location", patch.location);

  if (patch.start !== undefined && patch.end !== undefined) {
    const start = parseInstant(patch.start, "start");
    const end = parseInstant(patch.end, "end");
    if (start >= end) throw new Error("start должен быть раньше end.");
    event.removeAllProperties("dtstart");
    event.removeAllProperties("dtend");
    event.addPropertyWithValue("dtstart", icalTime(patch.start, "start"));
    event.addPropertyWithValue("dtend", icalTime(patch.end, "end"));
  }

  event.removeAllProperties("dtstamp");
  event.addPropertyWithValue("dtstamp", ICAL.Time.now());
  return `${root.toString()}\r\n`;
}
