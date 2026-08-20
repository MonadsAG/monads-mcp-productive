# Productive.io API Spec

Dieses Verzeichnis enthält die offizielle OpenAPI-Spec der Productive.io REST API
und die daraus erzeugten Per-Resource-Dateien.

Quelle: <https://developer.productive.io/reference/download_spec> (OpenAPI 3.1,
von Productive selbst veröffentlicht). Früher wurde die HTML-Doku gescraped —
das ist hinfällig, seit es die Spec zum Download gibt.

## Verwendung

```bash
npm run spec:sync         # Spec laden, splitten, CHANGELOG.md fortschreiben
npm run spec:impact       # prüfen, ob src/api noch zur Spec passt
npm run spec:changelog    # Daten der offiziellen Changelog-Einträge
```

`spec:sync` schickt den gespeicherten ETag als `If-None-Match` mit. Hat sich
nichts geändert, antwortet Productive mit `304` und der Lauf endet ohne Diff.

## Dateien

| Datei                      | Beschreibung                                                                |
| -------------------------- | --------------------------------------------------------------------------- |
| `productive-openapi.yaml`  | Offizielle Spec, unverändert. Diff-Grundlage + Codegen. Nicht direkt lesen. |
| `resources/_index.yaml`    | Index aller Resources: Datei, Beschreibung, Endpoints                       |
| `resources/{slug}.yaml`    | Eigenständige Spec einer Resource (ein File pro Tag)                        |
| `resources/reports/*.yaml` | `Reports` ist zu gross für ein File — ein File pro Report-Endpoint          |
| `CHANGELOG.md`             | Semantischer Diff je Sync: Paths, Methoden, Filter-Keys, Attribute          |
| `impact-baseline.json`     | Bekannte, akzeptierte Abweichungen zwischen `src/api` und der Spec          |
| `.spec-etag`               | ETag des letzten Downloads (muss eingecheckt bleiben)                       |

## `x-filters`

Die Filter-Schemas der offiziellen Spec wiederholen pro Filter-Property einen
`oneOf`-Block mit allen Operatoren — 61 % des gesamten Schema-Gewichts. In den
Per-Resource-Dateien steht stattdessen ein kompakter Block:

```yaml
x-filters:
  person:
    status:
      description: Filter by person status.
      operators: [contains, eq, not_contain, not_eq]
```

**Das ist die massgebliche Liste gültiger Filter-Keys.** Productive antwortet auf
unbekannte Keys mit 422 (`Filter 'x' is not supported on this endpoint`), und
Filter-Keys heissen oft anders als das gleichnamige Response-Attribut.

## Automatischer Sync

`.github/workflows/api-spec-sync.yml` läuft montags um 06:00 UTC (und manuell per
`workflow_dispatch`). Bei Änderungen öffnet die Action einen PR auf dem festen
Branch `chore/api-spec-sync` — bestehende PRs werden aktualisiert statt dupliziert.
Die PR-Beschreibung enthält die Impact-Analyse; bricht die Spec etwas, das
`src/api` nutzt, wird der Check rot.

Voraussetzung: unter Settings → Actions → General muss
„Allow GitHub Actions to create and approve pull requests" aktiviert sein.

## Codegen (optional)

```bash
kiota generate -l CSharp -d productive-openapi.yaml \
  -n Monads.Productive -o ./src/ProductiveClient
```
