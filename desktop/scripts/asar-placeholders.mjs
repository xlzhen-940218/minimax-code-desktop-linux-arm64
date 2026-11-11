import { readSync, existsSync, mkdirSync, openSync, closeSync } from "node:fs";
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
if (!args.asar || !args.unpacked) {
  console.error("Usage: asar-placeholders.mjs --asar <app.asar> --unpacked <app.asar.unpacked>");
  process.exit(1);
}

const asarPath = path.resolve(args.asar);
const unpackedDir = path.resolve(args.unpacked);
const fd = openSync(asarPath, "r");
const headerSizeBuffer = Buffer.alloc(4);
readSync(fd, headerSizeBuffer, 0, 4, 12);
const headerSize = headerSizeBuffer.readUInt32LE(0);
const headerBuffer = Buffer.alloc(headerSize);
readSync(fd, headerBuffer, 0, headerSize, 16);
closeSync(fd);

const header = JSON.parse(headerBuffer.toString("utf8"));
const created = [];

function walk(node, prefix) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const relative = prefix ? `${prefix}/${name}` : name;
    if (entry.files) {
      walk(entry, relative);
    } else if (entry.unpacked) {
      const target = path.join(unpackedDir, relative);
      if (!existsSync(target)) {
        mkdirSync(path.dirname(target), { recursive: true });
        closeSync(openSync(target, "w"));
        created.push(relative);
      }
    }
  }
}

walk(header, "");
console.log(`Prepared ${created.length} unpacked placeholder(s).`);
