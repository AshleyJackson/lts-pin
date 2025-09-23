# LTS Pin

**LTS Pin** is a CLI tool that automatically pins your project dependencies to the previous major or minor stable versions, helping you maintain long-term support and avoid unexpected breaking changes.

## Features

- Detects your package manager (`bun`, `pnpm`, `yarn`, or `npm`)
- Pins all dependencies, devDependencies, and peerDependencies in your `package.json` to the previous major or minor version (using `~` for minor/patch updates)
- Regenerates your lockfile using your detected package manager

## Installation & Usage

You can run LTS Pin directly without installing globally using tools like `bunx`, `npx`, or similar:

```sh
bunx lts-pin
```

```sh
npx lts-pin
```

Or specify a target directory:

```sh
bunx lts-pin ./path/to/project
# or
npx lts-pin ./path/to/project
```

You can also install globally:

```sh
npm install -g lts-pin
lts-pin
```

## How it works

1. Reads your `package.json` and collects all dependencies.
2. For each dependency, fetches metadata from the npm registry and determines the previous major or minor stable version.
3. Updates your `package.json` to pin each dependency to `~<previous version>`.
4. Detects your package manager and runs the appropriate install command to update your lockfile.

## API

You can also use the main functions programmatically:

- `updateToPreviousVersions`: Updates dependencies in a target directory.
- `getPreviousVersion`: Gets the previous major or minor version for a package.
- `detectPackageManager`: Detects the package manager in a directory.

## Why?

I've had too many issues with newer major releases. An example that annoys me often is eslint's upgrade to Version 9 where they introduced new config layouts. None of the underlying plugins for ESlint were compatible for like 6 months, so I always had to downgrade.

I personally don't think that a new major version for a software is anywhere viable until it hits x.1.1, e.g. `5.1.1` for typescript. The only time you shouldn't run this is when the latest version of the prior major release has a vulnerability.

## License

MIT

---

*Author: Ashley Jackson*

