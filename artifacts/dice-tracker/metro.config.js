const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Exclude Jest temp directories (ts-jest compilation artifacts) from Metro's
// file watcher to prevent ENOENT errors when test temp dirs are created/deleted.
if (!config.resolver) config.resolver = {};
const existing = config.resolver.blockList;
config.resolver.blockList = [
  ...(existing ? (Array.isArray(existing) ? existing : [existing]) : []),
  /_tmp_\d+/,
];

module.exports = config;
