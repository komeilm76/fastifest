# Changelog

All notable changes are tracked here. Fastifest has not yet been published; current development changes remain under **Unreleased** until a maintainer authorizes a release.

## Unreleased

### Fixed

- Enforced decoded byte, side, and pixel limits for raster images embedded in SVG logos while retaining support for valid padded and unpadded Base64 data URIs.
- Made overwrite-disabled asset installation race-safe and preserved concurrent files during transaction rollback.
- Rejected template and configuration accessor properties so validation cannot accept one value and later serialize a different one.
- Preserved stale screenshots changed after preflight instead of deleting the updated files during post-commit cleanup.
- Aligned absolute URL classification with URL parser whitespace handling, and deferred path-relative `scope` containment assertions when the deployed manifest URL prefix is unknown.
