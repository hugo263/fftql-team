import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compatibleMigrationSql } from "../database/migration-compat.ts";

const name = "0034_lz4_toast.sql";
const original = readFileSync(new URL("../database/migrations/" + name, import.meta.url), "utf8");

test("TOAST migration supports a PostgreSQL build with only the default codec", () => {
  const result = compatibleMigrationSql(name, original, ["pglz"]);
  assert.match(result, /default_toast_compression = pglz/);
  assert.match(result, /COMPRESSION pglz/);
  assert.doesNotMatch(result, /(?:=|COMPRESSION) lz4/);
});
test("TOAST migration keeps LZ4 where supported and leaves other migrations unchanged", () => {
  assert.equal(compatibleMigrationSql(name, original, ["pglz", "lz4"]), original);
  assert.equal(compatibleMigrationSql("0039_fpl.sql", original, ["pglz"]), original);
  assert.throws(() => compatibleMigrationSql(name, original, []), /supported TOAST/);
});
