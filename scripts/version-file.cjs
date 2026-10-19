// commit-and-tag-version updater for src/version.ts, so APP_VERSION follows package.json.
const PATTERN = /(APP_VERSION = ')([^']*)(')/;

module.exports.readVersion = contents => PATTERN.exec(contents)[2];
module.exports.writeVersion = (contents, version) =>
  contents.replace(PATTERN, `$1${version}$3`);
