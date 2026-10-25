# Repository boundaries

- This is one of four independent Haomai repositories. Install, test and build from this repository root; do not introduce mandatory sibling-directory imports or build inputs.
- Keep this endpoint's implementation, prototype and development/deployment instructions under its own docs/. Shared product requirements, architecture, design and protocol rules are maintained in haomai-go/docs and haomai-go/shared, without a separate docs repository.
- Preserve existing user edits and local configuration. Do not print or commit real .env files, initialization passwords, signing keys, build caches or output bundles.
- Do not execute database migrations, create administrators, deploy, publish an extension, or send real messages merely to validate a source change. Keep these operations separate from build/test verification.

# Chrome extension rules

- Use the pinned Yarn 4.18.0, yarn.lock and repository-local src/shared/generated resources. Runtime/production builds do not require a neighboring source repository.
- Preserve existing Git history and user changes. The source repository name is haomai-chrome, independent of the display name in the manifest.
- Unpacked extension identity can depend on the canonical loaded path. Do not silently change manifest keys, reinstall the user's extension, or read browser credentials as part of a directory adjustment.
- The old wa-web-translate path, when present, is a temporary dist deployment compatibility directory, not a source dependency. Sync it only with the explicit tools/sync_legacy_bundle.py command.
- Keep docs/prototype self-contained. Validate with yarn test and yarn build; publishing to a store is a separate operation.
