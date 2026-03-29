const MIGRATE_PROMPT = `I'm moving my AI memory to a new system. I need you to export everything you know about me in a structured format.

Go through your memory, conversation history, and any context you have about me. For each distinct piece of information, output it as a block in this exact format:

---
type: [reference | decision | insight | task | note]
summary: [One line, under 100 characters — the key fact]
topics: [comma-separated tags]
people: [comma-separated names, if any]
---
[The full detail about this item. Be specific — include names, dates, tools, and reasoning.]

Use these types:
- **reference** — Facts about me, my role, my team, my projects, my tech stack
- **decision** — Preferences, rules, choices I've made about how I work or how AI should behave
- **insight** — Non-obvious things you've learned about my work or domain
- **task** — Active goals, deadlines, or things I'm working toward
- **note** — Anything else worth remembering that doesn't fit the above

Cover these areas (skip any you don't have information about):
1. **Who I am** — Name, role, company, expertise, background, location, personal interests
2. **What I'm building** — Active projects, goals, tech stack, architecture decisions
3. **Who I work with** — Team members, their roles, key relationships
4. **How I like to work** — Communication preferences, code style, what role I want AI to play
5. **What to avoid** — Anti-patterns, pet peeves, things I've corrected you about
6. **Corrections and behavioral rules** — Things I've repeatedly asked you to do differently, specific instructions I've given about how to respond
7. **Key decisions** — Important choices I've made and why, including things I changed my mind about
8. **Active context** — Current deadlines, blockers, priorities
9. **Learning and growth** — Skills I'm developing, things I'm trying to get better at
10. **Anything else** — Personal context, values, habits, or patterns you've noticed

Be thorough. Include everything you'd want a new AI assistant to know about me on day one. Don't summarize or compress — detail is valuable. Preserve my exact words when possible.

Output ONLY the formatted blocks, no introduction or conclusion.`;

export function printMigrate(): void {
  console.error(
    "Paste this prompt into any AI tool that knows about you (ChatGPT, Claude, Gemini, etc.).\n" +
    "Copy the response and paste it into your ShelbyMCP-connected agent during onboarding.\n" +
    "The onboard skill will parse and import it automatically.\n"
  );
  console.log(MIGRATE_PROMPT);
}
