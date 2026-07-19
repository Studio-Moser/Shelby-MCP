import { createHash } from "node:crypto";
import { validate as uuidValidate, v5 as uuidv5 } from "uuid";

export type ProjectIdentityState = "local_only" | "pending" | "active" | "collision";
export type ProjectReferenceResolution =
  | { kind: "resolved"; projectId: string; currentSlug: string }
  | { kind: "invalid_project_id" }
  | { kind: "unknown_project_id" }
  | { kind: "unknown_alias" }
  | { kind: "conflicting_project_scope" }
  | { kind: "unresolved" };

const PROJECT_NAMESPACE = "cbe30437-5f4b-55bd-af13-8a1029beeffe";
const PROJECT_NAME_PREFIX = "shelby-project-v1:";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function deriveExistingProjectId(legacySlug: string): string {
  if (!isValidProjectSlug(legacySlug)) throw new Error("invalid_legacy_slug");
  return uuidv5(PROJECT_NAME_PREFIX + legacySlug, PROJECT_NAMESPACE).toLowerCase();
}

export function isCanonicalProjectId(value: string): boolean {
  return value === value.toLowerCase() && uuidValidate(value);
}

export function isValidProjectSlug(value: string): boolean {
  const bytes = Buffer.byteLength(value, "utf8");
  return bytes >= 1 && bytes <= 128 && SLUG.test(value);
}

export function slugClaimRecordName(slug: string): string {
  return `psc-${createHash("sha256").update(slug, "utf8").digest("hex")}`;
}
