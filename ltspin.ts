import axios from 'axios';
import * as semver from 'semver';
import { promises as fs } from 'fs';
import { execSync } from 'child_process';

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

import fs from 'fs/promises';

const packageManagers = [
  'bun.lock',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
]

async function detectPackageManager(): Promise<'bun' | 'pnpm' | 'yarn' | 'npm'> {
  for (const manager of packageManagers) {
    const path = `./${manager}`;
    const exists = await fs.exists(path);

    if (exists) {
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
    }
  }
  return 'npm'
}

// Function to update package.json with previous major or minor versions
async function updateToPreviousVersions(): Promise<void> {
  try {
    // Read package.json from ./package.json
    const packageJson: PackageJson = JSON.parse(await fs.readFile('./package.json', 'utf8'));
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
        console.log(`Pinning ${pkg} to ~${version}`);
        // Update dependencies, devDependencies, or peerDependencies with ~ to allow minor and patch updates
        if (dependencies[pkg]) {
          dependencies[pkg] = `~${version}`;
        } else if (devDependencies[pkg]) {
          devDependencies[pkg] = `~${version}`;
        } else if (peerDependencies[pkg]) {
          peerDependencies[pkg] = `~${version}`;
        }
      }
    }

    // Write updated package.json
    await fs.writeFile('./package.json', JSON.stringify(packageJson, null, 2));
    console.log('Updated ./package.json');

    // Update dependencies and regenerate package-lock.json
    // Detect if Bun, pnpm, yarn, or npm is being used
    const packageManager = await detectPackageManager();

    switch (packageManager) {
      case 'bun':
        console.log('Detected Bun as package manager.');
        execSync('bun install --legacy-peer-deps', { stdio: 'inherit' });
        break;
      case 'pnpm':
        console.log('Detected pnpm as package manager.');
        execSync('pnpm install --legacy-peer-deps', { stdio: 'inherit' });
        break;
      case 'yarn':
        console.log('Detected yarn as package manager.');
        execSync('yarn install --legacy-peer-deps', { stdio: 'inherit' });
        break;
      case 'npm':
      default:
        console.log('Defaulting to npm as package manager.');
        execSync('npm install --legacy-peer-deps', { stdio: 'inherit' });
        break;
    }

    // Default to npm
  } catch (error: unknown) {
    console.error('Error updating package.json:', (error as Error).message);
  }
}

// Run the script
updateToPreviousVersions().catch(console.error);