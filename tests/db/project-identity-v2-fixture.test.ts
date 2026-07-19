import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  deriveExistingProjectId,
  isCanonicalProjectId,
  isValidProjectSlug,
  slugClaimRecordName,
} from "../../src/db/project-identity.js";

type Fixture = {
  uuid_v5: {
    vectors: Array<{ legacy_slug: string; project_id: string }>;
  };
  uuid_validation: {
    cases: Array<{ value: string; expected: boolean }>;
  };
  slug_rules: {
    validation_cases: Array<{ value: string; expected: boolean }>;
  };
  claim_record_names: {
    vectors: Array<{ slug: string; record_name: string }>;
  };
};

const fixturePath = fileURLToPath(new URL("../fixtures/project-identity-v2.json", import.meta.url));
function loadFixture(): Fixture {
  try {
    return JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
  } catch (error) {
    throw new Error(`Invalid project-identity-v2 fixture: ${String(error)}`, { cause: error });
  }
}
const fixture = loadFixture();

describe("project identity v2 primitive fixture", () => {
  it("derives exact legacy project UUIDv5 values", () => {
    for (const vector of fixture.uuid_v5.vectors) {
      expect(deriveExistingProjectId(vector.legacy_slug)).toBe(vector.project_id);
    }
  });

  it("validates only canonical project UUIDs", () => {
    for (const { value, expected } of fixture.uuid_validation.cases) {
      expect(isCanonicalProjectId(value)).toBe(expected);
    }
  });

  it("validates project slugs including UTF-8 byte boundaries", () => {
    for (const { value, expected } of fixture.slug_rules.validation_cases) {
      expect(isValidProjectSlug(value)).toBe(expected);
    }
  });

  it("derives exact SHA-256 slug claim record names", () => {
    for (const { slug, record_name: expectedRecordName } of fixture.claim_record_names.vectors) {
      expect(slugClaimRecordName(slug)).toBe(expectedRecordName);
    }
  });
});
