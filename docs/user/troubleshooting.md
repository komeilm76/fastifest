# Troubleshooting and safety

> **Pre-release guide:** This page describes planned diagnostics and safety behavior. Exact messages and limits will be documented after implementation.

## No logo found

Fastifest is planned to require exactly one readable logo directly inside the configured `paths.logos` directory. Check that the directory exists and contains a PNG, JPG, JPEG, or SVG file. Filenames are discovered automatically; they do not go in the config.

## More than one logo found

V1 will not guess which logo is primary. Keep one supported logo in the source directory, or configure a directory containing only the intended logo.

## Screenshot warning or no screenshots

Screenshots are optional. A missing or empty configured screenshot directory is expected to produce a warning; the generated manifest omits the `screenshots` member when there are no screenshot files. Add PNG, JPG, or JPEG screenshots if you want them generated.

## Unsupported, corrupt, or oversized image

Supported suffixes are not enough: Fastifest will inspect image data. A corrupt supported file or a mismatch between its extension and actual format is planned to fail generation; it will not be silently skipped. Check that the file opens in an image viewer, that the extension matches its format, and that the format is supported for that input type. SVG inputs are planned only for logos.

Proposed limits are 20 MiB per raster input, 2 MiB per SVG, 40 megapixels and 12,000 pixels per side for decoded raster input, and a 4,096-pixel maximum side for screenshots (which are reduced, not enlarged). If a valid image exceeds the released limit, resize it before retrying. Final values will be stated in the released docs.

## Config or template errors

- Confirm `fastifest.config.ts` is at the project root or pass the intended file using `--config`.
- Check spelling and value types against the [configuration reference](configuration.md).
- A TypeScript config and `manifest.template.ts` execute code. Use only files you trust.
- Do not add generated `icons` or `screenshots` to the template; Fastifest owns those collections.
- A pre-existing template should be preserved, not overwritten. Edit it yourself if its values need to change.

## Output path or overwrite error

The proposed path policy keeps the manifest and generated assets inside the configured public root; `manifest.json` must be directly in that folder. Use paths that do not escape or overlap input/output folders. Symlinked input entries and symlink/reparse-point output components or reserved targets may be rejected; use real directories and files. With overwrite disabled, move or rename conflicting managed outputs yourself before retrying. Fastifest must not recursively delete folders or overwrite files outside its reserved names.

## Sharp installation issue

`sharp` uses platform-specific native binaries. Before release, Fastifest will document the supported operating systems and runtimes based on CI evidence. Check that your package manager has completed installation for your platform, and consult the error output for the failing runtime/platform. Do not assume an untested platform is supported.

## Generation is interrupted or fails during writing

Fastifest is intended to validate and prepare output before updating the manifest. A failed run should leave the previous manifest file in place, but updating several image files cannot be fully atomic across a process crash or power loss. If generation is interrupted, rerun it with the same configuration to restore a consistent output set. Do not delete the entire output folder; unrelated files may be present.

## Manifest URLs do not load

The configured public directory must be served by your web application. Manifest `src` URLs resolve relative to the deployed manifest URL, not to the project directory or HTML page. Confirm that each resolved icon/screenshot URL returns the expected file, that `manifest.json` is linked from your HTML, and that the server returns JSON with an appropriate `Content-Type`. See [Web App Manifest and PWA basics](manifest-and-pwa.md#understand-url-resolution).

## Safety notes

- Treat configs and templates as executable code; load only trusted files.
- Avoid placing private data in public asset directories.
- Generated output cleanup is intended to be limited to reserved Fastifest filenames and never recursive.
- File size, image-dimension, and SVG-processing limits will be stated in the final docs. Fastifest will not claim complete protection against malicious inputs or vulnerabilities in native image libraries. Manifest validation will cover the documented supported fields, but it cannot guarantee identical behavior across browsers or app stores; verify your deployed app in its target environments.
