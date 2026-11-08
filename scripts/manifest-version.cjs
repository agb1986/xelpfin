// commit-and-tag-version updater for vega/manifest.toml, so the Vega package version follows
// package.json. Only the `version` key of the [package] table is touched.
const PATTERN = /(\[package\][^[]*?\nversion = ")([^"]*)(")/;

module.exports.readVersion = contents => PATTERN.exec(contents)[2];
module.exports.writeVersion = (contents, version) =>
  contents.replace(PATTERN, `$1${version}$3`);
