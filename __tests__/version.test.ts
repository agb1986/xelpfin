import { APP_VERSION } from '../src/version';

const pkg = require('../package.json') as { version: string };
const updater = require('../scripts/version-file.cjs') as {
  readVersion(contents: string): string;
  writeVersion(contents: string, version: string): string;
};

describe('APP_VERSION', () => {
  it('matches package.json', () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('is rewritten by the release updater', () => {
    const src =
      "export const APP_NAME = 'xelpfin';\nexport const APP_VERSION = '0.1.1';\n";
    expect(updater.readVersion(src)).toBe('0.1.1');
    expect(updater.writeVersion(src, '0.2.0')).toBe(
      "export const APP_NAME = 'xelpfin';\nexport const APP_VERSION = '0.2.0';\n",
    );
  });
});

describe('Vega manifest version', () => {
  // No Node types in this project, so type the one call used. Jest runs from the repo root.
  const fs = require('fs') as {
    readFileSync(file: string, encoding: 'utf8'): string;
  };
  const manifest = require('../scripts/manifest-version.cjs') as {
    readVersion(contents: string): string;
    writeVersion(contents: string, version: string): string;
  };
  const toml = fs.readFileSync('vega/manifest.toml', 'utf8');

  it('matches package.json', () => {
    expect(manifest.readVersion(toml)).toBe(pkg.version);
  });

  it('rewrites only the [package] version', () => {
    const src =
      'schema-version = 1\n\n[package]\nid = "x"\nversion = "0.1.1"\n\n[os.version]\nmin = "1.2"\n';
    expect(manifest.writeVersion(src, '0.2.0')).toBe(
      src.replace('version = "0.1.1"', 'version = "0.2.0"'),
    );
  });
});
