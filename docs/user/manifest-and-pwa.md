# Web App Manifest and PWA basics

> **Pre-release:** Fastifest is not published to npm yet. This guide explains the web concepts behind its generated files and the behavior of the current source package.

## What a Web App Manifest does

A Web App Manifest is a JSON document linked from a web page. It gives browsers and platforms metadata about an app, such as its name, icons, preferred launch URL, display mode, colors, shortcuts, and optional screenshots. Browsers decide how much of that metadata they support and where they display it.

The Web App Manifest specification makes its root members optional. Fastifest applies a usability rule requiring at least one of `name` or `short_name`, and it generates the `icons` collection. That is Fastifest behavior, not a claim that the specification makes those root members universally mandatory.

A manifest alone does **not** make a site a complete PWA or guarantee an install button. Install promotion and presentation depend on browser, operating system, hosting security, and other application requirements. Fastifest generates the manifest and image files only. It does not create application code, add a service worker, provide offline behavior, configure HTTPS, or edit your HTML.

## Link and serve the manifest

Add a manifest link inside the HTML document's `<head>`:

```html
<link rel="manifest" href="/manifest.json" />
```

That root URL is an example for a site hosted at the domain root. If your site is deployed under a path such as `/my-app/`, use the correct deployed URL instead. Fastifest writes `manifest.json` directly inside the configured public folder, beside generated icons and screenshots. If the public folder is exposed under a URL prefix, use the correct deployed manifest URL in `href` and ensure relative asset URLs still resolve. If your PWA has multiple HTML documents, include the manifest link in each document's `<head>` so it is available throughout the app; a single-page app usually has one HTML document.

Fastifest writes `manifest.json`. Serve it as JSON (normally `Content-Type: application/json`). The Web Manifest's registered media type is `application/manifest+json`, commonly paired with the `.webmanifest` extension; browsers generally also accept `.json` served as `application/json`. Fastifest does not configure your web server. Check the deployed response in your browser's Network panel.

## Understand URL resolution

Manifest asset URLs are resolved by the browser relative to the **deployed manifest URL**, not the project directory, the HTML page, or the source image. For example, if the manifest is served from `https://example.com/manifest.json`, then:

```json
{ "src": "icons/icon-192.png" }
```

resolves to `https://example.com/icons/icon-192.png`.

With the default layout, this works when `public/icons/icon-192.png` is served at `/icons/icon-192.png` and `manifest.json` is served at `/manifest.json`. If your framework or host serves the public directory under a different URL prefix, make sure the generated relative URLs still resolve to the actual files. Fastifest cannot infer framework-specific deployment mappings.

These members are URL metadata, not filesystem paths:

- `start_url` is resolved relative to the manifest URL. When supplied, Fastifest validates same-origin relationships where they can be determined. If absent, it warns that browsers may fall back to the page that linked the manifest.
- `scope` resolves relative to the manifest URL. When `start_url` is supplied, Fastifest checks same-origin where knowable. It checks containment for origin-root paths; if either URL is path-relative, the deployment prefix can affect the result, so Fastifest warns and asks you to verify containment at the deployed manifest URL. Scope path boundaries are segment-aware (for example, `/app/` does not contain `/application/`).
- `id` is optional, must be same-origin with `start_url` when that relationship can be determined, and need not be within `scope`. Fastifest does not synthesize an ID. Choose a stable identity; changing it can make a browser treat the site as a different installed app. If adding one to an existing PWA, check the browser's computed app ID first.
- Shortcut URLs should stay within the app's scope. Generated icon and screenshot `src` URLs resolve relative to the manifest URL and must match your deployment's asset routing.

If a relative `start_url` is mixed with an absolute `scope` or `id`, the final site origin may be unknown. Fastifest warns rather than inventing a deployment host; check the actual deployed URLs yourself.

## The manifest fields users most often configure

- **`name` / `short_name`** — app names shown in install and launcher surfaces. Fastifest requires at least one; providing both is usually useful.
- **`id`** — optional stable app identity for supporting browsers. If set, it should stay same-origin with `start_url`; it does not have to be inside `scope`. Keep it stable across updates.
- **`start_url`** — the URL opened when the installed app launches. Use a real route on the same origin as the manifest. If omitted or invalid, browsers may fall back to the page that linked the manifest.
- **`scope`** — the URL path range considered part of the app. Keep it same-origin and ensure it contains `start_url`; if omitted, browsers infer a default from the effective start URL.
- **`display`** — preferred presentation, such as `standalone` or `browser`. It is a preference; unsupported modes may fall back and browsers can retain their own UI.
- **`theme_color` / `background_color`** — presentation hints used by some browsers and operating systems. Choose values that match the actual application.

These values belong in `manifest.template.ts`; Fastifest does not guess branding, routes, colors, or app identity. See the [template example](getting-started.md#4-add-manifest-details).

## Icons and maskable icons

Fastifest generates `icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, and `icon-maskable-512.png`. Each manifest icon entry includes its URL, dimensions, PNG MIME type, and purpose. Logos are fitted without stretching or cropping; maskable artwork is fitted within the central circular safe area. Inspect the result in target platforms rather than assuming it looks identical everywhere.

Some platforms also use separate site icons or platform-specific HTML metadata. Fastifest does not generate favicons or Apple touch icons, and its manifest icons are not a replacement for every platform's integration requirements.

## Screenshots

The manifest's `screenshots` member is optional. Supporting browsers and distribution surfaces may use it to enrich an install or listing experience; it does not change the app's runtime behavior and is not universally displayed. Supply real screenshots of your app, not artwork that implies UI the user will not see.

A screenshot can have a `label`, an accessible name recommended for assistive technology, and a `form_factor` such as `narrow` or `wide` when the screenshot genuinely represents that layout. Fastifest does not infer these values from dimensions or filenames. You can provide optional annotations in `screenshots.metadata`, keyed by exact source basename; see the [configuration reference](configuration.md#screenshotsmetadata-optional). If no annotation is supplied, generated screenshot entries omit `label` and `form_factor`. With no screenshots, Fastifest warns and omits the `screenshots` member.

## Installability is browser-specific

Chromium-based browsers have their own installability checks, which can change. Name, icons, a start URL, display preference, and related-application settings may affect install promotion; these are not Web Manifest-wide requirements. Other browsers and operating systems have different installation paths and criteria. Consult current browser guidance for your target platforms.

Fastifest emits non-fatal guidance warnings when `start_url` is missing, when both `display` and `display_override` are missing, or when `prefer_related_applications` is `true`. These members are optional in the Web Manifest, so such advice is not a standards validation failure.

A service worker is commonly used to provide offline behavior and caching, but is a separate application feature. Fastifest neither installs nor configures a service worker. Do not treat a generated manifest as PWA certification or a promise of installability.

## Practical verification checklist

1. Serve the app over HTTPS (or use `localhost` while developing); opening files with `file://` is not a substitute for a deployed site.
2. Confirm the HTML links to the manifest and the manifest returns a successful response with a JSON media type.
3. Open the manifest URL directly and check that it parses as JSON.
4. Request each icon and screenshot URL from the manifest; check for successful responses and correct image dimensions.
5. In Chrome or Edge, inspect **DevTools → Application → Manifest** for parsing, icon, screenshot, and installability diagnostics. Review the maskable safe area visually.
6. Test installation and launch behavior in the browsers and operating systems your users actually use. A passing browser-specific checklist does not establish universal PWA support.

## References

- [W3C Web Application Manifest specification](https://w3c.github.io/manifest/)
- [MDN: Web application manifest](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest)
- [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [MDN: Manifest icons](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons)
- [MDN: Manifest screenshots](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/screenshots)
- [MDN: `start_url`](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/start_url)
- [MDN: `scope`](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/scope)
- [MDN: `id`](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id)
- [Chrome for Developers: Debug Progressive Web Apps in DevTools](https://developer.chrome.com/docs/devtools/progressive-web-apps)
- [Chrome for Developers: PWA manifest identity (`id`)](https://developer.chrome.com/docs/capabilities/pwa-manifest-id)
