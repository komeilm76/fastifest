# Changelog

All notable changes are tracked here. Fastifest has not yet been published; current development changes remain under **Unreleased** until a maintainer authorizes a release.

## Unreleased

### Fixed

- Validated manifest templates from own enumerable data properties, ignoring inherited values and rejecting sparse arrays that could otherwise read inherited array entries.
- Hardened configuration validation and path resolution against inherited `Object.prototype` properties and setters by validating own data properties, defining normalized fields safely, and reading only own normalized values.
- Enforced decoded byte, side, and pixel limits for raster images embedded in SVG logos while retaining support for valid padded and unpadded Base64 data URIs.
- Made reserved asset installation atomic when targets are absent, preventing concurrent files from being replaced during commit; preserved concurrent files during rollback.
- Rejected template and configuration accessor properties so validation cannot accept one value and later serialize a different one.
- Rejected template source paths that overlap `manifest.json` or managed output directories, preventing generation from overwriting its own template.
- Preserved stale screenshots changed after preflight instead of deleting the updated files during post-commit cleanup.
- Refused to overwrite generated outputs changed in place during rollback; incomplete rollback errors now identify the preserved prior-output backup.
- Aligned absolute URL classification with URL parser whitespace handling, and deferred path-relative `scope` containment assertions when the deployed manifest URL prefix is unknown.
