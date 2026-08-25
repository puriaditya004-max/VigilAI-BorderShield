import { spawnSync } from "node:child_process";

for (let run = 1; run <= 3; run += 1) {
  console.log(`\n=== Stability run ${run}/3 ===`);
  const result = process.platform === "win32"
    ? spawnSync("npm test", { stdio: "inherit", shell: true })
    : spawnSync("npm", ["test"], { stdio: "inherit" });
  if (result.error) {
    console.error(result.error);
  }
  if (result.status !== 0) {
    console.error(`Stability run ${run} failed.`);
    process.exit(result.status || 1);
  }
}

console.log("\nPASS stable verification: npm test succeeded 3 times");
