/** PostgreSQL builds may omit optional LZ4; preserve the migration and use its default codec. */
export function compatibleMigrationSql(name: string, text: string, compression: readonly string[]): string {
  if (name !== "0034_lz4_toast.sql" || compression.includes("lz4")) return text;
  if (!compression.includes("pglz")) throw new Error("PostgreSQL does not expose a supported TOAST compression codec");
  return text.replace("default_toast_compression = lz4", "default_toast_compression = pglz")
    .replace("COMPRESSION lz4", "COMPRESSION pglz");
}
