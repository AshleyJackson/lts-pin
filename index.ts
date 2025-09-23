import axios from 'axios';
import * as semver from 'semver';
import { promises as fs } from 'fs';
import { execSync } from 'child_process';

// Define interface for package.json structure
interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

// Function to get the previous minor version
async function getPreviousMinorVersion(packageName: string) {
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
    // Find the previous minor version
    for (let i = 1; i < versions.length; i++) {
      const current: string = versions[i];
      // Check if current version is a previous minor version (same major, lower minor)
      if (semver.major(current) === semver.major(latest) && semver.minor(current) < semver.minor(latest)) {
        return current;
      }
    }

    // Fallback: If no previous minor version exists, warn and use the latest
    console.warn(`No previous minor version found for ${packageName}. Using latest: ${latest}`);
    return latest;
  } catch (error: unknown) {
    console.error(`Error fetching versions for ${packageName}:`, (error as Error).message);
    return null;
  }
}

// Function to update package.json with previous minor versions
async function updateToPreviousMinorVersions(): Promise<void> {
  try {
    // Read package.json
    const packageJson: PackageJson = JSON.parse(await fs.readFile('./testing/package.json', 'utf8'));
    const dependencies: Record<string, string> = packageJson.dependencies || {};
    const devDependencies: Record<string, string> = packageJson.devDependencies || {};

    // Get all package names
    const allPackages: string[] = [...Object.keys(dependencies), ...Object.keys(devDependencies)];

    // Process each package
    for (const pkg of allPackages) {
      const version: string | null = await getPreviousMinorVersion(pkg);
      if (version) {
        console.log(`Pinning ${pkg} to ~${version}`);
        // Update dependencies or devDependencies with ~ to allow patch updates
        if (dependencies[pkg]) {
          dependencies[pkg] = `~${version}`;
        } else if (devDependencies[pkg]) {
          devDependencies[pkg] = `~${version}`;
        }
      }
    }

    // Write updated package.json
    await fs.writeFile('./testing/package.json', JSON.stringify(packageJson, null, 2));
    console.log('Updated package.json');

    // Update dependencies and regenerate package-lock.json
    console.log('Running npm install to update package-lock.json...');
    execSync('npm install', { stdio: 'inherit' });
  } catch (error: unknown) {
    console.error('Error updating package.json:', (error as Error).message);
  }
}

// Run the script
updateToPreviousMinorVersions().catch(console.error);