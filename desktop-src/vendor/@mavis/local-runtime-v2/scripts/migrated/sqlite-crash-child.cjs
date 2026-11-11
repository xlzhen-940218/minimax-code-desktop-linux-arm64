/**
 * Crash-safety child: opens a WAL sqlite db like the runtime does, commits
 * one batch of rows, reports COMMITTED on stdout, then holds an OPEN
 * transaction with uncommitted rows and spins until the parent SIGKILLs it
 * — simulating a utility-process hard crash mid-write (proposal §2.8).
 */
const path = require('node:path');
const Database = require('better-sqlite3');

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('usage: sqlite-crash-child.cjs <dbPath>');
  process.exit(2);
}

const db = new Database(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS crash_probe (
    id INTEGER PRIMARY KEY,
    phase TEXT NOT NULL
  );
`);

const insert = db.prepare('INSERT INTO crash_probe (phase) VALUES (?)');

// Batch 1: committed — must survive the SIGKILL.
const commitBatch = db.transaction(() => {
  for (let i = 0; i < 10; i += 1) insert.run('committed');
});
commitBatch();

// Batch 2: an open, never-committed transaction — must NOT survive.
db.exec('BEGIN');
for (let i = 0; i < 10; i += 1) insert.run('uncommitted');

console.log('COMMITTED');

// Spin until killed; never COMMIT.
setInterval(() => {}, 1000);
