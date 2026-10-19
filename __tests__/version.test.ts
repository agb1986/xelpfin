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
