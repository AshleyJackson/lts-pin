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
}

// Function to get the previous major or minor version
async function getPreviousVersion(packageName: string): Promise<string | null> {
  try {
    // Fetch package metadata from npm registry
    const response = await axios.get(`https://registry.npmjs.org/${packageName}`);
    const versions: string[] = Object.keys(response.data.versions)
      .filter((v: string) => semver.valid(v) && !semver.prerelease(v)) // Exclude pre-releases
      .sort(semver.rcompare); // Sort in descending order (latest first)

    if (versions.length < 2) {
      console.warn(`Not enough stable versions for ${packageName}. Using latest: ${versions[0]}`);
      return versions[0];
    }

    const latest: string = versions[0];
    // First, try to find the previous major version
    for (let i = 1; i < versions.length; i++) {
      const current: string = versions[i];
      if (semver.major(current) < semver.major(latest)) {
        if (semver.major(current) === 0) {
          console.log(`Previous major version for ${packageName} is 0.x, using latest instead: ${latest}`);
          return latest;
        }
        console.log(`Found previous major version for ${packageName}: ${current}`);
        return current;
      }
    }

    // If no previous major, try to find the previous minor version
    for (let i = 1; i < versions.length; i++) {
      const current: string = versions[i];
      if (
        semver.major(current) === semver.major(latest) &&
        semver.minor(current) < semver.minor(latest)
      ) {
        console.log(`No previous major, using previous minor version for ${packageName}: ${current}`);
        return current;
      }
    }

    // Fallback: If no previous major or minor version exists, use the latest
    console.warn(`No previous major or minor version found for ${packageName}. Using latest: ${latest}`);
    return latest;
  } catch (error: unknown) {
    console.error(`Error fetching versions for ${packageName}:`, (error as Error).message);
    return null;
  }
}

// List of package manager lockfiles
const packageManagers = [
  'bun.lock',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
];

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
    // Resolve package.json path
    const packageJsonPath = path.join(targetDir, 'package.json');
    // Read package.json
    const packageJson: PackageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    const dependencies: Record<string, string> = packageJson.dependencies || {};
    const devDependencies: Record<string, string> = packageJson.devDependencies || {};
    const peerDependencies: Record<string, string> = packageJson.peerDependencies || {};

    // Get all package names
    const allPackages: string[] = [
      ...Object.keys(dependencies),
      ...Object.keys(devDependencies),
      ...Object.keys(peerDependencies),
    ];

    // Process each package
    for (const pkg of allPackages) {
      const version: string | null = await getPreviousVersion(pkg);
      if (version) {
        const newPin = `<${semver.major(version) + 1}`;
        console.log(`Pinning ${pkg} to ${newPin}`);
        if (dependencies[pkg]) {
          // Ping to previous major version e.g. >2, <3
          dependencies[pkg] = newPin;
        } else if (devDependencies[pkg]) {
          devDependencies[pkg] = newPin;
        } else if (peerDependencies[pkg]) {
          peerDependencies[pkg] = newPin;
        }
      }
    }

    // Write updated package.json
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
    console.log(`Updated ${packageJsonPath}`);

    // Update dependencies and regenerate lockfile
    const packageManager = await detectPackageManager(targetDir);
    console.log(`Detected ${packageManager} as package manager.`);
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