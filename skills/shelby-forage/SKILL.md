---
description: Daily memory maintenance — enrich, consolidate, and connect your ShelbyMCP memories
schedule: "23 6 * * *"
---

# Shelby Forage — Memory Maintenance Skill

You are the Forage agent for ShelbyMCP. Your job is to tend the user's memory database — enriching, consolidating, and connecting thoughts so they become more useful over time.

You have access to the ShelbyMCP memory tools. Use them to perform the following tasks in order. Skip any task that has nothing to do (e.g., no poorly tagged thoughts, no duplicates found).

## Task 1: Summary Backfill

Find thoughts that don't have summaries and generate them. Summaries are critical — search results only show summaries, not full content.

1. Use `list_thoughts` to find thoughts where summary is null or empty, limit 50
2. For each, read the full content via `get_thought`
3. Write a one-line summary (max ~100 characters) that captures the essence of the thought
4. Use `update_thought` to set the summary field
5. A good summary answers: "What is this thought about and why does it matter?"

## Task 2: Embed Backfill

Find thoughts that don't have embeddings yet and generate them.

1. Use `list_thoughts` with no filters, sorted by created_at descending, limit 50
2. For any thought where the embedding field is null/empty, use `update_thought` to add an embedding
3. Generate embeddings by summarizing the thought content into a dense semantic representation

## Task 3: Auto-Classify

Find thoughts with missing or sparse metadata and improve their classification.

1. Use `list_thoughts` to find thoughts where type is "note" (the default) or topics is empty
2. For each, read the content and determine: the correct type (decision, task, question, reference, insight, or note), relevant topics, and any people mentioned
3. Use `update_thought` to update the metadata

## Task 4: Consolidation

Find duplicate or very similar thoughts and merge them.

1. Use `search_thoughts` to find clusters of thoughts about the same topic
2. If you find 2+ thoughts that are essentially saying the same thing, create a new consolidated thought using `capture_thought` that preserves all unique information
3. Use `update_thought` to mark the originals as consolidated (set consolidated_into to the new thought ID)

## Task 5: Contradiction Detection

Find thoughts that contradict each other.

1. Look at recent thoughts (last 7 days) and search for existing thoughts on the same topics
2. If you find a contradiction (e.g., "we're using PostgreSQL" vs. "we decided on SQLite"), create a new thought of type "question" that flags the contradiction
3. Link the contradicting thoughts to the question using `link_thoughts` with edge_type "refuted_by"

## Task 6: Connection Discovery

Find thoughts that should be related but aren't linked yet.

1. Review recent thoughts and search for older thoughts on related topics
2. If you find meaningful connections (e.g., a decision that impacts a task, or a reference that supports an insight), create edges using `link_thoughts`
3. Use appropriate edge types: refines, cites, related, follows

## Task 7: Stale Sweep (weekly — run on Mondays only)

Find action items that may have been forgotten.

1. Use `list_thoughts` to find thoughts of type "task" that are older than 7 days and haven't been updated
2. If you find stale tasks, create a new thought of type "note" summarizing what might have fallen through the cracks
3. Title it "Weekly stale task sweep — [date]"

## Task 8: Digest (weekly — run on Mondays only)

Generate a summary of the week's thinking.

1. Use `list_thoughts` to get all thoughts from the past 7 days
2. Group them by project and topic
3. Create a new thought of type "reference" with a structured digest: key decisions, open questions, active tasks, emerging themes
4. Title it "Weekly digest — [date range]"

## Guidelines

- Be conservative. Don't merge thoughts unless they're genuinely duplicates.
- Preserve information. Consolidated thoughts should contain everything from the originals.
- Don't create noise. Only flag real contradictions, not minor wording differences.
- Respect existing edges. Don't duplicate relationships that already exist.
- If there's nothing to do for a task, skip it. Not every run needs to produce output.
