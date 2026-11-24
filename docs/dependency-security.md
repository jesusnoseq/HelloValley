# Dependency security

## Installation policy

Use Node.js 26.13+ and npm 11.16.0 or a later npm 11 release. `packageManager` records the 11.16.0 baseline; `devEngines` and strict engine checks reject unsupported npm versions. If needed, bootstrap the baseline with `npm install --global npm@11.16.0 --ignore-scripts`.

From the repository root:

```bash
npm run deps:check
npm ci
```

- Every direct registry dependency has an exact version in its workspace manifest. The lockfile fixes transitive versions and tarball integrity hashes.
- `npm ci` installs the lockfile and fails on manifest drift instead of choosing new versions. Keep `package-lock.json` in version control and review its changes.
- `.npmrc` disables dependency lifecycle scripts, including preinstall/install/postinstall. Explicit commands such as `npm run build` still work. `allowScripts` approves no dependencies, and strict script approval provides a second gate if `ignore-scripts` is turned off.
- New registry resolutions must be at least **seven days old** (`min-release-age=7`, measured in days by npm). This reduces exposure to newly published compromised releases. Existing locked dependencies form the baseline; the age policy is not a retroactive audit of them.
- New dependencies are saved as exact versions. Git and direct URL dependencies are blocked; registry access uses HTTPS with certificate validation.
- Internal `@hellovalley/shared` dependencies use `file:../shared` so npm links the declared workspace instead of resolving a similarly named registry package.
- `npm run deps:check` uses only Node built-ins. It checks manifest/lockfile agreement, exact direct versions, declared local links, npm registry sources, and SHA-512 integrity metadata before dependency code needs to run. npm verifies the actual downloaded tarballs against those hashes during installation.

No dependency install scripts are needed; no exceptions are approved.

## Updating dependencies

1. Review the package identity, maintainers, release notes, and intended version. Run `npm run deps:audit` for known advisories.
2. Change only the intended dependency, using an explicit version, for example `npm install --save-dev typescript@<reviewed-version>` or `npm install <package>@<reviewed-version> -w @hellovalley/client`. Keep the seven-day age policy and disabled scripts enabled.
3. Review every manifest and lockfile change, including new transitive packages, sources, integrity hashes, and install-script metadata. Do not delete the lockfile or run an unreviewed blanket `npm audit fix --force`.
4. Run `npm run deps:check`, `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.

If a future tool needs an install script, review why and what it executes before making a narrow policy change. Do not enable all dependency scripts to work around an installation error. Prefer the repository's installed tools (`npm run …`), rather than downloading and executing unpinned `npx` packages.

## Limits

Exact pins and integrity hashes make installs reproducible; they do not prove that the selected code is benign. Disabled install scripts do not sandbox dependencies invoked by builds, tests, or the server. Release age and a clean vulnerability audit cannot detect every compromise. Manifest and lockfile review remain necessary, and security fixes still need deliberate updates.
