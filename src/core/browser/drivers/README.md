# Browser Driver Resolver

`drivers/` owns the small browser-domain service that resolves a persisted
browser backend selection into a concrete `BrowserDriverFactory`.

This module is intentionally narrow: callers should depend on
`BrowserDriverFactoryService.resolve(...)` when they need the configured backend,
instead of importing a specific backend adapter from runtime/toolkit code.

## Owns

- Mapping `BrowserBackendSelection` to the correct browser driver factory.
- Keeping backend selection at the browser-domain boundary.
- Providing a single place to add future backend choices.

## Does Not Own

- Persisting or validating browser settings. That belongs to
  `settings/BrowserProfileSettingsService`.
- Launching, attaching, or closing browser processes. That belongs to the
  concrete backend driver.
- Browser navigation/action policy. That belongs to `BrowserSessionService` and
  policy services.
- Tool registration or user interface concerns.
- Backend-specific option normalization beyond selecting the factory.

## Maintenance Notes

- Add a backend here only after its profile/settings shape is represented in
  `src/core/browser/types.ts` and validated by browser settings.
- Keep the resolver free of side effects. It should instantiate the factory but
  not start browsers, probe ports, read files, or mutate settings.
- Avoid fallback logic that hides invalid backend state. Invalid persisted
  settings should be rejected or normalized by the settings service before the
  resolver is called.

