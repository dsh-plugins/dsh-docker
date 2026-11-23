import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const tags = ['alpha', 'next', 'latest'];
const pinPattern = /^ARG DSH_VERSION=(\S+)$/gm;
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const numeric = /^\d+$/;
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function parse(version) {
  const match = typeof version === 'string' && semverPattern.exec(version);
  const prerelease = match?.[4]?.split('.') ?? [];
  if (!match || prerelease.some(part => numeric.test(part) && !/^(0|[1-9]\d*)$/.test(part))) {
    throw new Error(`Invalid SemVer: ${JSON.stringify(version)}`);
  }
  return { core: match.slice(1, 4).map(BigInt), prerelease };
}

export function compareVersions(left, right) {
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < a.core.length; i++) {
    const result = compare(a.core[i], b.core[i]);
    if (result) return result;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return compare(a.prerelease.length === 0, b.prerelease.length === 0);
  }
  for (let i = 0; i < Math.min(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    const xNumber = numeric.test(x);
    const yNumber = numeric.test(y);
    const result = xNumber && yNumber ? compare(BigInt(x), BigInt(y))
      : xNumber !== yNumber ? (xNumber ? -1 : 1) : compare(x, y);
    if (result) return result;
  }
  return compare(a.prerelease.length, b.prerelease.length);
}

function readPin(dockerfile) {
  const matches = [...dockerfile.matchAll(pinPattern)];
  if (matches.length !== 1) throw new Error('Expected one ARG DSH_VERSION in Dockerfile');
  const pin = matches[0][1];
  parse(pin);
  return pin;
}

export function imageTag(version) {
  parse(version);
  // Docker tags reject +; underscore is not a SemVer character, so this is reversible.
  const tag = version.replace('+', '_');
  if (tag.length > 128) throw new Error(`Docker tag is too long: ${tag}`);
  return tag;
}

export function resolveVersion(dockerfile, distTags, bootstrap) {
  const pin = readPin(dockerfile);
  const candidates = tags.map(tag => {
    const version = distTags[tag];
    parse(version);
    return version;
  });
  const upstream = candidates.reduce((best, version) =>
    compareVersions(version, best) > 0 ? version : best);
  const newer = compareVersions(upstream, pin) > 0;
  const version = newer ? upstream : pin;
  return { pin, upstream, version, tag: imageTag(version), newer, build: newer || bootstrap };
}

export function bump(dockerfile, expected, version) {
  const pin = readPin(dockerfile);
  if (pin !== expected || compareVersions(version, pin) <= 0) {
    throw new Error(`Refusing to replace ${pin} with ${version} (expected ${expected})`);
  }
  return dockerfile.replace(pinPattern, () => `ARG DSH_VERSION=${version}`);
}

async function main() {
  const [command, expected, version] = process.argv.slice(2);
  const dockerfile = readFileSync('Dockerfile', 'utf8');
  if (command === 'bump') {
    writeFileSync('Dockerfile', bump(dockerfile, expected, version));
    return;
  }
  if (command !== 'resolve') throw new Error('Expected resolve or bump');
  const response = await fetch('https://registry.npmjs.org/-/package/@deepseek-ai%2Fdsh/dist-tags', {
    headers: { 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`npm dist-tags: HTTP ${response.status}`);
  const distTags = await response.json();
  const result = resolveVersion(dockerfile, distTags, process.env.BOOTSTRAP === 'true');
  const image = `ghcr.io/${process.env.GITHUB_REPOSITORY.toLowerCase()}`;
  const fields = { image, ...result };
  appendFileSync(process.env.GITHUB_OUTPUT,
    Object.entries(fields).map(([key, value]) => `${key}=${value}\n`).join(''));
  const summary = [
    '### DSH version check',
    '',
    ...tags.map(tag => `- npm \`${tag}\`: \`${distTags[tag]}\``),
    `- Dockerfile: \`${result.pin}\``,
    `- ${result.build ? 'Build' : 'Skip (no higher version)'}: \`${image}:${result.tag}\``,
  ].join('\n') + '\n';
  console.log(summary);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
