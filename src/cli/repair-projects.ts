import { ThoughtDatabase } from "../db/database.js";
import { repairProjects, type RepairReport } from "../integrity/project-repair.js";

/**
 * Pure formatter for a RepairReport.  All output logic lives here so it can be
 * unit-tested without touching the filesystem or a real database.
 */
export function formatRepairReport(report: RepairReport, apply: boolean): string {
  const lines: string[] = [];

  if (apply) {
    lines.push("APPLIED — project_identifier back-fill complete");
  } else {
    lines.push("DRY RUN — no changes written (re-run with --apply to write)");
  }

  lines.push("");
  lines.push(`Scanned ${report.scanned} thoughts missing project_identifier`);
  lines.push(`  ${report.highConfidence.length} high-confidence fixes identified`);
  lines.push(`  ${report.flagged.length} flagged for review (low-confidence)`);

  if (apply) {
    lines.push(`  ${report.applied} written`);
    lines.push(`  ${report.flagged.length} flagged for review (marked needs_project_review in metadata)`);
  }

  if (report.highConfidence.length > 0) {
    lines.push("");
    lines.push("High-confidence assignments:");
    // Per-slug tally
    const tally: Record<string, number> = {};
    for (const item of report.highConfidence) {
      const slug = item.suggestedSlug ?? "(unknown)";
      tally[slug] = (tally[slug] ?? 0) + 1;
    }
    for (const [slug, count] of Object.entries(tally)) {
      lines.push(`  ${slug}: ${count} thought${count === 1 ? "" : "s"}`);
    }
  }

  if (report.flagged.length > 0) {
    lines.push("");
    lines.push("Flagged (ambiguous — manual review needed):");
    for (const item of report.flagged) {
      lines.push(`  ${item.id}  reason: ${item.reason}`);
    }
  }

  if (!apply) {
    lines.push("");
    lines.push("Re-run with --apply to write high-confidence assignments.");
  }

  return lines.join("\n");
}

/**
 * CLI entry point.  Opens the DB (same way the MCP server does), runs
 * repairProjects, prints the formatted report to stderr (stdout is the MCP
 * channel), then closes the DB.
 */
export function runRepairProjects(dbPath: string, apply: boolean): void {
  const db = new ThoughtDatabase(dbPath);
  try {
    const report = repairProjects(db.db, { apply });
    const output = formatRepairReport(report, apply);
    console.error(output);
  } finally {
    db.close();
  }
}
