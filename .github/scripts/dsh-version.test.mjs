import assert from 'node:assert/strict';
import test from 'node:test';
import { bump, compareVersions, imageTag, resolveVersion } from './dsh-version.mjs';

const pinned = 'FROM debian\nARG DSH_VERSION=0.2.2-rc.5\n';
const common = { alpha: '0.2.3-alpha.2', next: '0.2.2-rc.5', latest: '0.2.2-rc.5' };

test('resolve all three npm channels, not channel preference or lexicographic maxima', () => {
  const result = resolveVersion(pinned, common, false);
  assert.equal(result.version, '0.2.3-alpha.2');
  assert.equal(result.tag, '0.2.3-alpha.2');
  assert.equal(result.newer, true);
  assert.equal(result.build, true);
  assert.equal(resolveVersion(pinned, { ...common, next: '0.2.4-rc.1' }, false).version, '0.2.4-rc.1');
  assert.equal(resolveVersion(pinned, { ...common, latest: '0.2.3' }, false).version, '0.2.3');
});

test('compare numeric identifiers, stable releases, core versions and build metadata', () => {
  assert.equal(compareVersions('0.2.3-alpha.10', '0.2.3-alpha.2'), 1);
  assert.equal(compareVersions('0.2.3', '0.2.3-rc.10'), 1);
  assert.equal(compareVersions('0.2.10', '0.2.9'), 1);
  assert.equal(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta'), -1);
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.equal(compareVersions('0.2.3+one', '0.2.3+two'), 0);
  assert.equal(imageTag('0.2.3+one'), '0.2.3_one');
});

test('unchanged or rolled-back npm aliases do not build, or downgrade during bootstrap', () => {
  const updated = bump(pinned, '0.2.2-rc.5', '0.2.3-alpha.2');
  for (const distTags of [common, { ...common, alpha: '0.2.1' }]) {
    assert.equal(resolveVersion(updated, distTags, false).build, false);
    const bootstrap = resolveVersion(updated, distTags, true);
    assert.equal(bootstrap.build, true);
    assert.equal(bootstrap.newer, false);
    assert.equal(bootstrap.version, '0.2.3-alpha.2');
  }
});

test('missing or invalid aliases, changed pins, duplicates and downgrades fail closed', () => {
  assert.throws(() => resolveVersion(pinned, { ...common, next: undefined }, false), /Invalid SemVer/);
  assert.throws(() => resolveVersion(pinned, { ...common, next: '1.0.0-08' }, false), /Invalid SemVer/);
  assert.throws(() => resolveVersion(pinned, { ...common, next: '1.0.0\n' }, false), /Invalid SemVer/);
  assert.throws(() => bump(pinned, '0.2.1', '0.2.3-alpha.2'), /Refusing/);
  assert.throws(() => bump(pinned + pinned, '0.2.2-rc.5', '0.2.3-alpha.2'), /Expected one/);
  assert.throws(() => bump(pinned, '0.2.2-rc.5', '0.2.1'), /Refusing/);
  assert.equal(bump(pinned, '0.2.2-rc.5', '0.2.3-alpha.2'), 'FROM debian\nARG DSH_VERSION=0.2.3-alpha.2\n');
});
