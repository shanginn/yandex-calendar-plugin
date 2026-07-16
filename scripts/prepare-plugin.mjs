// Copyright 2026 Nikolai Shangin <shanginn@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(root, "plugins", "yandex-calendar");
const lock = JSON.parse(
  await readFile(path.join(root, "package-lock.json"), "utf8"),
);

function normalizeNoticeText(value) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd();
}

await mkdir(pluginRoot, { recursive: true });
await copyFile(path.join(root, "LICENSE"), path.join(pluginRoot, "LICENSE"));
await copyFile(path.join(root, "NOTICE"), path.join(pluginRoot, "NOTICE"));

const packages = [];
for (const [relativePath, metadata] of Object.entries(lock.packages ?? {})) {
  if (!relativePath.startsWith("node_modules/") || metadata.dev === true)
    continue;
  const packageDirectory = path.join(root, relativePath);
  let packageJson;
  try {
    packageJson = JSON.parse(
      await readFile(path.join(packageDirectory, "package.json"), "utf8"),
    );
  } catch {
    continue;
  }

  const files = await readdir(packageDirectory);
  const licenseFiles = files.filter((file) =>
    /^(licen[cs]e|copying|notice)(\..*)?$/i.test(file),
  );
  const licenseTexts = [];
  for (const file of licenseFiles.sort()) {
    licenseTexts.push(
      `--- ${file} ---\n${normalizeNoticeText(
        await readFile(path.join(packageDirectory, file), "utf8"),
      )}`,
    );
  }

  packages.push({
    name: packageJson.name ?? relativePath.replace(/^node_modules\//, ""),
    version: packageJson.version ?? metadata.version ?? "unknown",
    license: packageJson.license ?? "SEE PACKAGE",
    text: licenseTexts.join("\n\n") || "Текст лицензии см. в исходном пакете.",
  });
}

packages.sort((a, b) => a.name.localeCompare(b.name));
const header = `THIRD-PARTY SOFTWARE NOTICES

The bundled MCP server includes the packages listed below. Their licenses
apply to the corresponding third-party portions only and do not change the
Apache-2.0 license for the original project code.

The complete corresponding source for bundled MPL-2.0 code is preserved in
dist/server.mjs.map (sourcesContent) and is also identified reproducibly by
package-lock.json in the public source repository.
`;
const body = packages
  .map(
    (item) =>
      `\n================================================================================\n${item.name}@${item.version} — ${item.license}\n================================================================================\n\n${item.text.trim()}\n`,
  )
  .join("");

await writeFile(
  path.join(pluginRoot, "THIRD_PARTY_NOTICES.txt"),
  `${header}${body}`,
  "utf8",
);
