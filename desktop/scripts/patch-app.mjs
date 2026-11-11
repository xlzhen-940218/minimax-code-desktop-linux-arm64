// Applies the small Linux-only fixes the upstream desktop build does not need.
// Each patch is anchored on the shipped code and stays a no-op when the anchor
// no longer matches, so a new app release builds with a warning instead of
// failing.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const appDirArg = process.argv.find((argument) => argument.startsWith("--app="));
const appDir = path.resolve(appDirArg ? appDirArg.slice("--app=".length) : "");

const trayFile = path.join(appDir, "dist/main/modules/tray/index.js");

const trayAnchor = `    t.setContextMenu(null);
    t.on('click', () => {
        (0, window_1.bringToFront)();
    });
    t.on('right-click', () => {
        t.popUpContextMenu(createContextMenu());
    });
`;

const trayPatch = `${trayAnchor}    if (process.platform === 'linux') {
        // Linux tray hosts (StatusNotifierItem) never deliver click or
        // right-click events, so attach the menu up front instead.
        t.setContextMenu(createContextMenu());
    }
`;

function patch(file, anchor, replacement, marker, description) {
  if (!existsSync(file)) {
    console.warn(`[patch] skipped ${description}: ${file} not found`);
    return "skipped";
  }
  const source = readFileSync(file, "utf8");
  if (source.includes(marker)) {
    console.log(`[patch] ${description} already applied`);
    return "applied";
  }
  if (!source.includes(anchor)) {
    console.warn(`[patch] skipped ${description}: anchor changed in this app release`);
    return "skipped";
  }
  writeFileSync(file, source.replace(anchor, replacement));
  console.log(`[patch] applied ${description}`);
  return "applied";
}

patch(
  trayFile,
  trayAnchor,
  trayPatch,
  "t.setContextMenu(createContextMenu());",
  "Linux tray context menu",
);
