// Entry point for Wispbyte (set the panel's start file to index.js).
// The TypeScript source is compiled into dist/ automatically when `npm install` runs.

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(
    `Number One needs Node.js 22.13 or newer (this server has ${process.versions.node}). ` +
      "Pick a newer Node.js version in the Wispbyte panel's Startup tab.",
  );
  process.exit(1);
}

// Node prints a one-time "SQLite is experimental" notice; it's expected, so keep the console clean.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
  if (String(warning).includes("SQLite is an experimental feature")) return;
  emitWarning(warning, ...args);
};

await import("./dist/server/index.js");
