import * as fs from "fs";
import * as path from "path";
import { parseEasyList } from "./parser";
import { transformRule } from "./transformer";
import { optimize } from "./optimizer";

const INPUT = process.argv[2];   // path to easylist.txt
const OUTPUT = process.argv[3];  // path to output rules.json
const LIMIT = 25000;              // stay well under Chrome's limit for now

if (!INPUT || !OUTPUT) {
  console.error("Usage: npx ts-node compiler/index.ts <input> <output>");
  process.exit(1);
}

const text = fs.readFileSync(INPUT, "utf-8");
console.log("Parsing...");
const parsed = parseEasyList(text);
console.log(`Parsed: ${parsed.length} raw rules`);

const transformed = parsed
  .map((r, i) => transformRule(r, i + 1))
  .filter(Boolean) as any[];
console.log(`Transformed: ${transformed.length} rules`);

const optimized = optimize(transformed).slice(0, LIMIT);
console.log(`After dedup + limit: ${optimized.length} rules`);

fs.writeFileSync(OUTPUT, JSON.stringify(optimized, null, 2));
console.log(`Written to ${OUTPUT}`);