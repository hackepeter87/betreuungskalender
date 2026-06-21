# Internationalization and language packs

German remains the default language. The initial internationalization layer is
designed for gradual migration: untranslated UI areas fall back to German
instead of blocking a language pack or changing domain behavior.

## Architecture

- `src/i18n/resources.ts` defines supported locales, typed shared UI keys, and
  the German fallback.
- `src/i18n/I18nProvider.tsx` exposes the active locale and translation helper
  to React components.
- `src/i18n/reportMessages.ts` contains the report and PDF vocabulary.
- `src/lib/date.ts` accepts an optional `Intl` locale for date and time output.
- `src/lib/labels.ts` keeps API and database identifiers stable while mapping
  selected domain labels for display.

The selected language is stored in
`betreuungskalender:ui:locale:v1`. This is a UI preference only; it is not sent
to the API and does not alter SQLite data, backups, or exports.

## Adding a language pack

1. Add the locale to `supportedLocales` and `localeMetadata`.
2. Add shared UI messages to `translationResources`.
3. Add report messages when PDF/report support is intended.
4. Run `npm test`; `getMissingTranslationKeys` makes missing shared keys
   detectable.
5. Keep `data-testid` attributes language-neutral and never derive them from
   translated text.

Technical identifiers, API values, CSV field contracts, and database columns
remain English and must not be translated.

## Current coverage

The application shell, language settings, shared report labels, report view,
and generated PDF support German and English. Other pages continue to use the
German fallback until their strings are migrated incrementally.
