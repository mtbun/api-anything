// Prints the CHANGELOG section for one version, for the GitHub release.
// Usage: node scripts/release-notes.mjs 1.0.0
import { readFileSync } from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: node scripts/release-notes.mjs <version>, e.g. 1.0.0");
  process.exit(1);
}
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const start = changelog.search(new RegExp(`^## \\[${escaped}\\]`, "m"));
if (start === -1) {
  console.error(`CHANGELOG.md has no section for ${version}; move the Unreleased entries under "## [${version}] - <date>" first`);
  process.exit(1);
}
const rest = changelog.slice(start);
const next = rest.slice(1).search(/^## \[/m);
const section = next === -1 ? rest : rest.slice(0, next + 1);
process.stdout.write(section.split("\n").slice(1).join("\n").trim() + "\n");
