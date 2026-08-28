import * as jsonStore from "./store-json.mjs";
import * as postgresStore from "./store-postgres.mjs";

const driver = String(process.env.STORE_DRIVER || "json").toLowerCase();
const selected = driver === "postgres" ? postgresStore : jsonStore;

if (!["json", "postgres"].includes(driver)) {
  throw new Error(`unsupported STORE_DRIVER "${process.env.STORE_DRIVER}"; expected json or postgres`);
}

export const STORE_DRIVER = driver;
export const ensureStore = selected.ensureStore;
export const readDb = selected.readDb;
export const writeDb = selected.writeDb;
export const updateDb = selected.updateDb;
export const appendAudit = selected.appendAudit;
