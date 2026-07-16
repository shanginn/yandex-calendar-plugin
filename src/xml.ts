// Copyright 2026 Nikolai Shangin <shanginn@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  processEntities: false,
  trimValues: true,
});

export interface DavResponse {
  href: string;
  status?: string;
  prop: Record<string, unknown>;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function textValue(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object" && "#text" in value) {
    const text = (value as { "#text"?: unknown })["#text"];
    return typeof text === "string" || typeof text === "number"
      ? String(text)
      : undefined;
  }
  return undefined;
}

export function parseDavResponses(xml: string): DavResponse[] {
  const document = parser.parse(xml) as {
    multistatus?: { response?: unknown | unknown[] };
  };

  return asArray(document.multistatus?.response).map((raw) => {
    const response = raw as {
      href?: unknown;
      status?: unknown;
      propstat?:
        | { status?: unknown; prop?: Record<string, unknown> }
        | Array<{ status?: unknown; prop?: Record<string, unknown> }>;
    };
    const propstats = asArray(response.propstat);
    const successful =
      propstats.find((item) => textValue(item.status)?.includes(" 200 ")) ??
      propstats[0];
    const status = textValue(response.status) || textValue(successful?.status);

    return {
      href: textValue(response.href) ?? "",
      ...(status ? { status } : {}),
      prop: successful?.prop ?? {},
    };
  });
}

export function hasCalendarResourceType(
  prop: Record<string, unknown>,
): boolean {
  const resourceType = prop.resourcetype;
  return Boolean(
    resourceType &&
    typeof resourceType === "object" &&
    "calendar" in resourceType,
  );
}
