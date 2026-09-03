# Internationalization and language packs

German remains the default language. Every shipped language pack must contain
the complete application key set. The runtime keeps German as a defensive
fallback, but missing translations fail the normal test workflow and cannot be
used to ship an incomplete locale.

## Architecture

- `src/i18n/resources.ts` defines supported locales, typed shared UI keys, and
  the German fallback.
- `src/i18n/catalog.ts` contains the complete page and component catalogs.
  Locale objects are independent and must not spread or inherit the German
  catalog.
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
2. Add every shared UI message to `translationResources` and every page and
   component message to `catalog`.
3. Add report messages when PDF/report support is intended.
4. Keep interpolation placeholders such as `{count}` identical across locales.
5. Run `npm test`. The coverage gate reports the locale and exact missing,
   unknown, inherited, or invalid key.
6. Keep `data-testid` attributes language-neutral and never derive them from
   translated text.

## Adding interface text

- Put new user-facing labels, help text, errors, and status messages in the
  appropriate catalog section. User-entered content, technical identifiers,
  API values, and operator-mounted legal text are not catalog entries.
- Use a string literal for a fixed key.
- Wrap a conditional or generated key with the typed `catalogKey(section,
  key)` marker. This documents the dynamic key family and lets TypeScript
  reject values outside that section.
- Do not spread another locale into a translated locale. Identical terms such
  as product names or technical abbreviations must still be present in each
  locale object.
- Exemptions are supported by the coverage validator only for narrow,
  explicitly reviewed cases. The shipped German and English catalogs use no
  exemptions.

Technical identifiers, API values, CSV field contracts, and database columns
remain English and must not be translated.

## Current coverage

The application shell, pages, dialogs, report view, and generated PDF support
German and English. The coverage gate is part of `npm test` and therefore of
the standard GitHub CI workflow.
