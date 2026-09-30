#!/usr/bin/env node

/**
 * Build, package, publish and install the VSIX extension.
 * Output filename: {name}-{version}.vsix
 *
 * Flags:
 *   --install    install the packaged vsix into VS Code
 *   --publish    publish the packaged vsix to the Marketplace
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const flags = new Set(process.argv.slice(2));
const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const { name, version } = pkg;
const vsixName = `${name}-${version}.vsix`;
const buildDir = path.join(root, "build");
const vsixPath = path.join(buildDir, vsixName);

fs.mkdirSync(buildDir, { recursive: true });

// Remove stale packages so build/ only keeps the latest vsix.
for (const file of fs.readdirSync(buildDir)) {
  if (file.endsWith(".vsix")) {
    fs.unlinkSync(path.join(buildDir, file));
    console.log(`Removed old package: ${file}`);
  }
}

console.log("Compiling ...");
execSync("npm run compile", { cwd: root, stdio: "inherit" });

console.log(`\nPackaging ${vsixName} ...`);
execSync(`npx @vscode/vsce package -o "${vsixPath}"`, { cwd: root, stdio: "inherit" });

if (flags.has("--publish")) {
  console.log(`\nPublishing ${vsixName} to Marketplace ...`);
  // --packagePath uploads the freshly built vsix as-is:
  // no second packaging pass, vscode:prepublish does not re-run.
  execSync(`npx @vscode/vsce publish --packagePath "${vsixPath}"`, { cwd: root, stdio: "inherit" });
}

if (flags.has("--install")) {
  console.log(`\nInstalling ${vsixName} ...`);
  execSync(`code --install-extension "${vsixPath}" --force`, { cwd: root, stdio: "inherit" });
}

console.log(`\nDone: ${vsixPath}`);
