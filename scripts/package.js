/**
 * Build a Chrome Web Store–ready ZIP (excludes dev artifacts).
 * Usage: npm run package
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const outZip = path.join(root, "chupads-extension.zip");

const includeDirs = [
  "background",
  "content",
  "popup",
  "options",
  "privacy",
  "welcome",
  "rules",
  "icons",
];
const includeFiles = ["manifest.json"];

const requiredBundled = [
  path.join(root, "rules", "dynamic-rules.json"),
  path.join(root, "rules", "cosmetic-bundle.json"),
];
for (const file of requiredBundled) {
  if (!fs.existsSync(file)) {
    console.error(`Missing ${file} — run: npm run build`);
    process.exit(1);
  }
}

const staging = path.join(root, ".package-staging");
if (fs.existsSync(staging)) {
  fs.rmSync(staging, { recursive: true, force: true });
}
fs.mkdirSync(staging, { recursive: true });

for (const dir of includeDirs) {
  const src = path.join(root, dir);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(staging, dir), { recursive: true });
}
for (const file of includeFiles) {
  const src = path.join(root, file);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(staging, file));
}

if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

const isWin = process.platform === "win32";
if (isWin) {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${staging}\\*' -DestinationPath '${outZip}' -Force"`,
    { stdio: "inherit", cwd: root },
  );
} else {
  execSync(`cd "${staging}" && zip -r "${outZip}" .`, { stdio: "inherit" });
}

fs.rmSync(staging, { recursive: true, force: true });
console.log(`Packaged: ${outZip}`);
