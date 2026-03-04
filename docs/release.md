# Release Process

The release process for `bun-ffi-structs` is automated using GitHub Actions. To create a new release, follow these steps:

## Prerequisites

- Ensure you have write permissions to the repository.
- Ensure all tests pass locally (`bun test`).

## Steps

1. **Update Version**
   Update the version number in `package.json` following [Semantic Versioning](https://semver.org/).

   ```bash
   # Example: Bump patch version
   npm version patch --no-git-tag-version
   ```

2. **Commit Changes**
   Commit the `package.json` change.

   ```bash
   git add package.json
   git commit -m "chore: bump version to x.y.z"
   ```

3. **Create Tag**
   Create a git tag for the new version. The tag **must** start with `v`.

   ```bash
   git tag vx.y.z
   ```

4. **Push Changes**
   Push the commit and the tag to GitHub.
   ```bash
   git push
   git push origin vx.y.z
   ```

## Automation

Once the tag is pushed, the [Publish workflow](.github/workflows/publish.yml) will trigger automatically. It performs the following:

1.  **Verification**: Checks that the git tag matches the `package.json` version.
2.  **Testing**: Runs unit tests and all examples.
3.  **Build**: Compiles the project using `scripts/build.sh`.
4.  **Publish**: Publishes the package to NPM.
5.  **GitHub Release**: Creates a new GitHub Release with auto-generated notes.

## Troubleshooting

- If the workflow fails during the verification step, ensure the tag matches the `package.json` version exactly (e.g., tag `v1.0.1` requires version `"1.0.1"` in `package.json`).
- Check the [Actions tab](https://github.com/sst/bun-ffi-structs/actions) on GitHub for build logs.
