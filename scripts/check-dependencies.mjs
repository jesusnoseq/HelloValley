import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const json = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const manifest = json("package.json");
const lock = json("package-lock.json");
const errors = [];
const workspaces = new Set(manifest.workspaces);
const manifests = ["", ...workspaces];
const sections = ["dependencies", "devDependencies", "optionalDependencies"];
const exactVersion = /^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/;

for (const path of manifests) {
  const pkg = json(`${path ? `${path}/` : ""}package.json`);
  if (pkg.private !== true) errors.push(`${path || "."}: workspace must stay private`);
  for (const section of sections) {
    const dependencies = pkg[section] ?? {};
    if (JSON.stringify(dependencies) !== JSON.stringify(lock.packages[path]?.[section] ?? {})) {
      errors.push(`${path || "."}: ${section} differs from the lockfile`);
    }
    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version !== "string") { errors.push(`${name}: invalid version`); continue; }
      if (name.startsWith("@hellovalley/")) {
        const target = relative(root, resolve(root, path, version.slice(5))).replaceAll("\\", "/");
        if (!version.startsWith("file:") || !workspaces.has(target) || json(`${target}/package.json`).name !== name) {
          errors.push(`${name}: must reference a declared local workspace`);
        }
      } else if (!exactVersion.test(version)) errors.push(`${name}: requires an exact version, found ${version}`);
    }
  }
}

let registryPackages = 0;
for (const [path, pkg] of Object.entries(lock.packages)) {
  if (manifests.includes(path)) continue;
  if (pkg.link) {
    if (!workspaces.has(pkg.resolved)) errors.push(`${path}: undeclared workspace link`);
    continue;
  }
  registryPackages++;
  try {
    const source = new URL(pkg.resolved);
    if (source.origin !== "https://registry.npmjs.org" || source.username || source.password) {
      errors.push(`${path}: unapproved package source`);
    }
  } catch { errors.push(`${path}: missing or invalid registry source`); }
  if (typeof pkg.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(pkg.integrity)) {
    errors.push(`${path}: missing SHA-512 integrity`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else console.log(`Dependency policy passed: ${manifests.length} manifests, ${registryPackages} integrity-pinned registry packages.`);
