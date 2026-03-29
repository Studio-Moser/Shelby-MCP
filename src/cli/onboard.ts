import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function getSkillPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return resolve(dirname(thisFile), "..", "..", "skills", "shelby-onboard", "SKILL.md");
}

export function printOnboard(): void {
  console.error(
    "Paste this into a conversation with your primary AI tool.\n" +
    "It will run an interactive interview and seed your ShelbyMCP memory.\n" +
    "Run once — after that, memories accumulate naturally.\n"
  );

  try {
    const skill = readFileSync(getSkillPath(), "utf-8");
    // Strip YAML frontmatter — agents don't need it when pasted directly
    const body = skill.replace(/^---[\s\S]*?---\n*/, "");
    console.log(body);
  } catch {
    console.error("Could not read skills/shelby-onboard/SKILL.md from the package.");
    console.error("Reinstall: npm install -g shelbymcp");
  }
}
