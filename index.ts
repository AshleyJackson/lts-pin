const axios = require('axios');
const semver = require('semver');
const fs = require('fs').promises;
const { execSync } = require('child_process');

// Function to get the previous minor version
async function getPreviousMinorVersion(packageName: string) {
  try {
    // Fetch package metadata from npm registry
    const response = await axios.get(`https://registry.npmjs.org/${packageName}`);
    const versions = Object.keys(response.data.versions)
      .filter(v => semver.valid(v) && !semver.prerelease(v)) // Exclude pre-releases (e.g., 0.4.2-beta)
      .sort(semver.rcompare); // Sort in descending order (latest first)

    if (versions.length < 2) {
      console.warn(`Not enough stable versions for ${packageName}. Using latest: ${versions[0]}`);
      return versions[0];
    }

    const latest = versions[0];
    // Find the previous minor version
    for (let i = 1; i < versions.length; i++) {
      const current = versions[i];
      // Check if current version is a previous minor version (same major, lower minor)
      if (semver.major(current) === semver.major(latest) && semver.minor(current) < semver.minor(latest)) {
        return current;
      }
    }

    // Fallback: If no previous minor version exists, warn and use the latest
    console.warn(`No previous minor version found for ${packageName}. Using latest: ${latest}`);
    return latest;
  } catch (error) {
    console.error(`Error fetching versions for ${packageName}:`, error);
    return null;
  }
}

async function updateToPreviousMinorVersions() {
  try {
    const packageJson = JSON.parse(await fs.readFile('./testing/package.json', 'utf8'));
    const dependencies = packageJson.dependencies || {};
    const devDependencies = packageJson.devDependencies || {};

    const allPackages = [...Object.keys(dependencies), ...Object.keys(devDependencies)];

    for (const pkg of allPackages) {
      const version = await getPreviousMinorVersion(pkg);
      if (version) {
        console.log(`Pinning ${pkg} to ~${version}`);
        if (dependencies[pkg]) {
          dependencies[pkg] = `~${version}`;
        } else if (devDependencies[pkg]) {
          devDependencies[pkg] = `~${version}`;
        }
      }
    }

    await fs.writeFile('./testing/package.json', JSON.stringify(packageJson, null, 2));
    console.log('Updated package.json');

    console.log('Running npm install to update package-lock.json...');
    execSync('npm install', { stdio: 'inherit' });
  } catch (error) {
    console.error('Error updating package.json:', error);
  }
}

// Run the script
updateToPreviousMinorVersions().catch(console.error);