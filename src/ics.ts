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
