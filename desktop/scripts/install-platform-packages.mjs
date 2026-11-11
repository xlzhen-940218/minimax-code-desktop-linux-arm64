import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument: ${key ?? ""}`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const appDir = path.resolve(args.app ?? "");
const arch = args.arch;
const registry = args.registry ?? "https://registry.npmmirror.com";
const workDir = path.resolve(args.work ?? path.join(os.tmpdir(), "mcode-platform-packages"));

if (!existsSync(appDir) || !arch) {
  console.error(
    "Usage: install-platform-packages.mjs --app <app dir> --arch <arm64|x64> [--registry <url>] [--work <dir>]",
  );
  process.exit(1);
}

const modulesDir = path.join(appDir, "node_modules");
const packagesDir = path.join(workDir, "packages");
const extractDir = path.join(workDir, "extract");
rmSync(packagesDir, { recursive: true, force: true });
rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(packagesDir, { recursive: true });
  mkdirSync(extractDir, { recursive: true });

const suffix = `linux-${arch}`;
const installed = [];

function readPackageJson(directory) {
  const manifest = path.join(directory, "package.json");
  if (!existsSync(manifest)) return undefined;
  try {
    return JSON.parse(readFileSync(manifest, "utf8"));
  } catch {
    // Placeholder or truncated manifests are not installable packages.
    return undefined;
  }
}

function candidatePackages() {
  const results = [];
  for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      const scopeDir = path.join(modulesDir, entry.name);
      for (const child of readdirSync(scopeDir, { withFileTypes: true })) {
        if (!child.isDirectory()) continue;
        const dir = path.join(scopeDir, child.name);
        const manifest = readPackageJson(dir);
        if (manifest) results.push({ dir, manifest });
      }
    } else {
      const dir = path.join(modulesDir, entry.name);
      const manifest = readPackageJson(dir);
      if (manifest) results.push({ dir, manifest });
    }
  }
  return results;
}

function installPackage(name, version) {
  const destination = path.join(modulesDir, name);
  const existing = readPackageJson(destination);
  if (existing?.version === version) {
    console.log(`Already present: ${name}@${version}`);
    return;
  }

  const output = execFileSync(
    "npm",
    ["pack", `${name}@${version}`, "--pack-destination", packagesDir, "--registry", registry],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
  const tarball = path.join(packagesDir, output.split("\n").pop());
  const target = mkdtempSync(path.join(extractDir, "pkg-"));
  execFileSync("tar", ["-xzf", tarball, "-C", target]);

  const manifestPath = path.join(target, "package", "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  rmSync(destination, { recursive: true, force: true });
  cpSync(path.join(target, "package"), destination, { recursive: true });

  for (const bin of Object.values(manifest.bin ?? {})) {
    const binPath = path.join(destination, bin);
    if (existsSync(binPath)) chmodSync(binPath, 0o755);
  }

  installed.push(`${name}@${version}`);
  console.log(`Installed: ${name}@${version}`);
}

for (const { manifest } of candidatePackages()) {
  for (const [name, version] of Object.entries(manifest.optionalDependencies ?? {})) {
    if (name.includes(`-${suffix}-gnu`) || name.endsWith(`-${suffix}`)) {
      installPackage(name, version);
    }
  }
}

if (installed.length === 0) {
  console.log("No platform-specific packages were required.");
} else {
  console.log(`Installed ${installed.length} Linux ${arch} package(s).`);
}
