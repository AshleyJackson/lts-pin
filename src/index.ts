#!/usr/bin/env node

import axios from 'axios';
import * as semver from 'semver';
import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

// Define interface for package.json structure
interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
}
type VersionInfo = {
  latest: string;
  previous: string;
  orderedVersions: string[];
};

const versionInfoCache = new Map<string, VersionInfo>();

async function getTwoMinorDowngradedVersion(packageName: string): Promise<string | null> {
  const info = await fetchVersionInfo(packageName);
  if (!info) return null;

  const latestSemver = semver.parse(info.latest);
  if (!latestSemver) return null;

  if (latestSemver.major === 0) {
    const latestZeroMajor = info.orderedVersions.find((v) => {
      const parsed = semver.parse(v);
      return parsed && parsed.major === 0;
    });
    return latestZeroMajor ?? info.latest;
  }

  for (const version of info.orderedVersions) {
    const parsed = semver.parse(version);
    if (!parsed) continue;

    if (parsed.major === latestSemver.major && parsed.minor <= latestSemver.minor - 2) {
      return version;
    }
  }

  return info.previous ?? info.latest;
}

async function fetchVersionInfo(packageName: string): Promise<VersionInfo | null> {
  if (versionInfoCache.has(packageName)) {
    return versionInfoCache.get(packageName)!;
  }

  try {
    const response = await axios.get(`https://registry.npmjs.org/${packageName}`);
    const versions: string[] = Object.keys(response.data.versions)
      .filter((v: string) => semver.valid(v) && !semver.prerelease(v))
      .sort(semver.rcompare);

    if (!versions.length) {
      console.warn(`No stable versions found for ${packageName}.`);
      return null;
    }

    const latest: string = versions[0];
    let previous: string = latest;

    if (versions.length < 2) {
      console.warn(`Not enough stable versions for ${packageName}. Using latest: ${latest}`);
    } else {
      for (let i = 1; i < versions.length; i++) {
        const current: string = versions[i];
        if (semver.major(current) < semver.major(latest)) {
          if (semver.major(current) === 0) {
            console.log(`Previous major version for ${packageName} is 0.x, using latest instead: ${latest}`);
            previous = latest;
          } else {
            console.log(`Found previous major version for ${packageName}: ${current}`);
            previous = current;
          }
          break;
        }
      }

      if (previous === latest) {
        console.log(`No previous major version for ${packageName}. Using latest: ${latest}`);
      }
    }

    const info: VersionInfo = { latest, previous, orderedVersions: versions };
    versionInfoCache.set(packageName, info);
    return info;
  } catch (error: unknown) {
    console.error(`Error fetching versions for ${packageName}:`, (error as Error).message);
    return null;
  }
}

// Function to get the previous major or minor version
async function getPreviousVersion(packageName: string): Promise<string | null> {
  const info = await fetchVersionInfo(packageName);
  return info?.previous ?? null;
}

async function getLatestVersion(packageName: string): Promise<string | null> {
  const info = await fetchVersionInfo(packageName);
  return info?.latest ?? null;
}

// List of package manager lockfiles
const packageManagers = [
  'bun.lock',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
];

// Allow Latest major versions for these packages
const whitelistPackages = new Set([
  "@o7/icon",
  "svelte",
  "@sveltejs/vite-plugin-svelte",
  "@sveltejs/kit",
  "tailwindcss",
  "@tailwindcss/vite",
  "ua-parser-js",
  "kysely",
  "kysely-neon",
  "prisma-kysely",
  "@neondatabase/serverless",
  "@sveltejs/adapter-cloudflare",
  "@sveltejs/adapter-netlify",
  "@sveltejs/adapter-node",
  "@sveltejs/adapter-vercel",
  "json-2-csv",
  "ai",
  "esrap",
  "graceful-fs",
  "lru-cache",
])

// Function to detect package manager
async function detectPackageManager(dir: string): Promise<'bun' | 'pnpm' | 'yarn' | 'npm'> {
  for (const manager of packageManagers) {
    try {
      await fs.access(path.join(dir, manager));
      switch (manager) {
        case 'bun.lock':
          return 'bun';
        case 'pnpm-lock.yaml':
          return 'pnpm';
        case 'yarn.lock':
          return 'yarn';
        case 'package-lock.json':
          return 'npm';
        default:
          return 'npm';
      }
    } catch {
      // File doesn't exist, continue to next
    }
  }
  return 'npm';
}

// Function to update package.json with previous major or minor versions
async function updateToPreviousVersions(targetDir: string = process.cwd()): Promise<void> {
  try {
    const packageJsonPath = path.join(targetDir, 'package.json');
    const packageJson: PackageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    const dependencies: Record<string, string> = packageJson.dependencies || {};
    const devDependencies: Record<string, string> = packageJson.devDependencies || {};
    const peerDependencies: Record<string, string> = packageJson.peerDependencies || {};

    const allPackages: string[] = [
      ...Object.keys(dependencies),
      ...Object.keys(devDependencies),
      ...Object.keys(peerDependencies),
    ];
    const packageManager = await detectPackageManager(targetDir);
    console.log(`Detected ${packageManager} as package manager.`);

    const dependencySections: Array<keyof PackageJson> = [
      'dependencies',
      'devDependencies',
      'peerDependencies',
    ];

    for (const section of dependencySections) {
      const bucket = packageJson[section];
      if (!bucket) continue;

      for (const pkg of Object.keys(bucket)) {
        const isWhitelisted = whitelistPackages.has(pkg);
        const version: string | null = isWhitelisted
          ? await getLatestVersion(pkg)
          : await getPreviousVersion(pkg);

        if (!version) continue;

        const newPin = isWhitelisted ? `>=${version}` : `<${semver.major(version) + 1}`;
        console.log(`${isWhitelisted ? 'Pinning up' : 'Pinning down'} ${pkg} (${section}) to ${newPin}`);
        bucket[pkg] = newPin;
      }
    }

    const installedPackages = await collectInstalledPackages(targetDir);
    const overridesBucket = packageJson.overrides ?? {};
    const directPackageSet = new Set(allPackages);

    for (const pkg of installedPackages) {
      // if (directPackageSet.has(pkg) || overridesBucket[pkg]) continue;

      const isWhitelisted = whitelistPackages.has(pkg);
      const version: string | null = isWhitelisted
        ? await getLatestVersion(pkg)
        : await getTwoMinorDowngradedVersion(pkg);

      if (!version) continue;

      const newPin = isWhitelisted ? `>=${version}` : version;
      console.log(`Pinning transitive ${pkg} (overrides) to ${newPin}`);
      overridesBucket[pkg] = newPin;
    }

    packageJson.overrides = overridesBucket;

    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
    console.log(`Updated ${packageJsonPath}`);

    switch (packageManager) {
      case 'bun':
        execSync('bun install --legacy-peer-deps', { stdio: 'inherit', cwd: targetDir });
        break;
      case 'pnpm':
        execSync('pnpm install --legacy-peer-deps', { stdio: 'inherit', cwd: targetDir });
        break;
      case 'yarn':
        execSync('yarn install --legacy-peer-deps', { stdio: 'inherit', cwd: targetDir });
        break;
      case 'npm':
      default:
        execSync('npm install --legacy-peer-deps', { stdio: 'inherit', cwd: targetDir });
        break;
    }
  } catch (error: unknown) {
    console.error(`Error updating package.json in ${targetDir}:`, (error as Error).message);
    process.exit(1);
  }
}

// Function to collect all installed packages in a project
async function collectInstalledPackages(rootDir: string): Promise<Set<string>> {
  const collected = new Set<string>();
  const rootNodeModules = path.join(rootDir, 'node_modules');

  try {
    await fs.access(rootNodeModules);
  } catch {
    return collected;
  }

  const moduleQueue: string[] = [rootNodeModules];
  const visitedModuleDirs = new Set<string>();
  const visitedPackageDirs = new Set<string>();

  const enqueuePackageDir = async (packageDir: string): Promise<void> => {
    if (!packageDir || visitedPackageDirs.has(packageDir)) return;
    visitedPackageDirs.add(packageDir);

    const packageJsonPath = path.join(packageDir, 'package.json');
    try {
      const raw = await fs.readFile(packageJsonPath, 'utf8');
      const pkg = JSON.parse(raw);
      if (typeof pkg.name === 'string') {
        collected.add(pkg.name);
      }
    } catch {
      // Ignore directories that aren't actual packages
    }

    moduleQueue.push(path.join(packageDir, 'node_modules'));
  };

  while (moduleQueue.length) {
    const modulesDir = moduleQueue.pop()!;
    if (visitedModuleDirs.has(modulesDir)) continue;
    visitedModuleDirs.add(modulesDir);

    let dirents;
    try {
      dirents = await fs.readdir(modulesDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const dirent of dirents) {
      if (dirent.name === '.bin') continue;
      const entryPath = path.join(modulesDir, dirent.name);

      if (dirent.isDirectory()) {
        if (dirent.name.startsWith('@')) {
          let scopedDirents;
          try {
            scopedDirents = await fs.readdir(entryPath, { withFileTypes: true });
          } catch {
            continue;
          }
          for (const scoped of scopedDirents) {
            if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue;
            await enqueuePackageDir(path.join(entryPath, scoped.name));
          }
        } else {
          await enqueuePackageDir(entryPath);
        }
      } else if (dirent.isSymbolicLink()) {
        try {
          const resolved = await fs.realpath(entryPath);
          await enqueuePackageDir(resolved);
        } catch {
          // Skip broken symlinks
        }
      }
    }
  }

  return collected;
}

// CLI entry point
async function main() {
  console.log('Starting LTS Pinning Process...');
  const args = process.argv.slice(2);
  const targetDir = args[0] ? path.resolve(args[0]) : process.cwd();
  await updateToPreviousVersions(targetDir);
}

console.log('Running as CLI');
main()

export { updateToPreviousVersions, getPreviousVersion, detectPackageManager };