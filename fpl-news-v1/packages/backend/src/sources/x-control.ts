import { sql, type Db } from "../db.ts";

export const X_COLLECTION_KEY = "collection.x";
export const X_COLLECTION_LOCK = "collection:x";

export class XCollectionPausedError extends Error {
  readonly statusCode = 400;
  constructor() { super("X 采集总开关已关闭，请在信源管理中开启。"); }
}

export async function xCollectionState(db: Db = sql): Promise<{ enabled: boolean; initialized: boolean }> {
  const [row] = await db<{ value: { enabled?: boolean; initialized?: boolean } }[]>`SELECT value FROM settings WHERE key=${X_COLLECTION_KEY}`;
  return { enabled: row?.value?.enabled === true, initialized: row?.value?.initialized === true };
}

export async function xCollectionEnabled(db: Db = sql): Promise<boolean> {
  return (await xCollectionState(db)).enabled;
}

export async function assertXCollectionEnabled(db: Db = sql): Promise<void> {
  if (!await xCollectionEnabled(db)) throw new XCollectionPausedError();
}
