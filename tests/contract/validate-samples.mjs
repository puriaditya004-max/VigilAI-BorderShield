import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, validateContract } from "../../packages/contracts/src/validate-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const cases = [
  ["camera-health", "camera-health.online.json"],
  ["track-event", "track-event.person.json"],
  ["incident-event", "incident-event.virtual-fence.json"],
  ["evidence-manifest", "evidence-manifest.virtual-fence.json"],
  ["audit-event", "audit-event.incident-created.json"]
];

let failed = false;

for (const [schemaName, sampleName] of cases) {
  const schema = readJson(path.join(root, "packages/contracts/schemas", `${schemaName}.schema.json`));
  const sample = readJson(path.join(root, "packages/contracts/samples", sampleName));
  const result = validateContract(schema, sample, sampleName);

  if (!result.valid) {
    failed = true;
    console.error(`FAIL ${sampleName}`);
    for (const error of result.errors) console.error(`  - ${error}`);
  } else {
    console.log(`PASS ${sampleName}`);
  }
}

if (failed) process.exit(1);
