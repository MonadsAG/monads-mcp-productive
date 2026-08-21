# Productive.io API Spec – Claude Code Context

Dieses Verzeichnis enthält die **offizielle** OpenAPI 3.1 Spec der Productive.io API,
heruntergeladen von <https://developer.productive.io/reference/download_spec>.
Nicht mehr gescraped — Productive veröffentlicht die Spec selbst.

## Spec aktualisieren

```bash
npm run spec:sync      # Spec laden, splitten, CHANGELOG.md fortschreiben, Guides mitziehen
npm run spec:impact    # prüfen, ob src/api noch zur Spec passt
npm run spec:guides    # nur die Guides neu holen
```

Montags läuft das automatisch (`.github/workflows/api-spec-sync.yml`) und öffnet
bei Änderungen einen PR mit Impact-Analyse.

## API Basics

- **Base URL:** `https://api.productive.io/api/v2/`
- **Spec:** JSON API (https://jsonapi.org/)
- **Auth-Header:** `X-Auth-Token` + `X-Organization-Id` auf jedem Request
- **Content-Type:** `application/vnd.api+json`
- **Bulk Content-Type:** `application/vnd.api+json; ext=bulk`

## Wichtige Konventionen

### Request-Body (JSON API)

```json
{
  "data": {
    "type": "time_entries",
    "attributes": { "date": "2024-01-15", "time": 480 },
    "relationships": {
      "person": { "data": { "type": "people", "id": "123" } },
      "service": { "data": { "type": "services", "id": "456" } }
    }
  }
}
```

### Filtering

```
?filter[person_id]=24
?filter[person_id][not_eq]=24
?filter[after]=2024-01-01
?filter[$op]=or&filter[0][name][eq]=Foo&filter[1][name][eq]=Bar
```

Operatoren: `eq`, `not_eq`, `contains`, `not_contain`, `gt`, `gt_eq`, `lt`, `lt_eq`

**Gültige Filter-Keys stehen im `x-filters`-Block von `resources/{slug}.yaml`** —
pro Key mit Beschreibung und unterstützten Operatoren. Productive antwortet auf
unbekannte Keys mit 422; Filter-Keys heissen oft anders als das gleichnamige
Response-Attribut (`person.is_active` → `filter[status]`).

Beim manuellen Curlen dieser Endpoints `-g`/`--globoff` übergeben — curl interpretiert nackte `[`/`]` in einer URL als eigene Range-Globbing-Syntax und verstümmelt `filter[x]=y` sonst stillschweigend.

### Pagination

```
?page[number]=1&page[size]=200    # max 200
```

### Sorting

```
?sort=date        # aufsteigend
?sort=-date       # absteigend
```

### Rate Limits

- Standard: 100 req/10s, 4000 req/30min
- Reports-Endpoints: 10 req/30s
- Überschreitung: HTTP 429

## Core Resources (Kurzreferenz)

| Resource                | Path                                               | Besonderheiten                                                                                                                                                   |
| ----------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `time_entries`          | `/api/v2/time_entries`                             | Zeit in Minuten (`time: 480` = 8h). Filter: `after`, `before`, `person_id`, `service_id`, `task_id`, `project_id`, `status` (1=approved/2=unapproved/3=rejected) |
| `time_entries` Aktionen | `/{id}/approve`, `/{id}/unapprove`, `/{id}/reject` | PATCH ohne Body                                                                                                                                                  |
| `tasks`                 | `/api/v2/tasks`                                    | Filter: `assignee_id`, `project_id`, `task_list_id`, `workflow_status_id`, `status` (open/closed)                                                                |
| `projects`              | `/api/v2/projects`                                 | Filter: `company_id`, `status`                                                                                                                                   |
| `deals`                 | `/api/v2/deals`                                    | = Budgets. `deal_type_id`: 1=internal, 2=client                                                                                                                  |
| `services`              | `/api/v2/services`                                 | Filter: `deal_id`, `project_id`                                                                                                                                  |
| `people`                | `/api/v2/people`                                   | Filter: `company_id`, `status`                                                                                                                                   |
| `companies`             | `/api/v2/companies`                                |                                                                                                                                                                  |
| `workflow_statuses`     | `/api/v2/workflow_statuses`                        | Filter: `workflow_id`                                                                                                                                            |

## Spec lesen

1. **Index lesen:** `docs/api-spec/resources/_index.yaml` — alle Resources, Beschreibung + Endpoints
2. **Detail lesen:** `docs/api-spec/resources/{resource}.yaml` — eigenständige Spec einer Resource:
   `x-filters` (gültige Filter-Keys), `paths` (Operationen), `components.schemas`
   (`resource_*` = Response-Attribute)
3. **Reports:** `docs/api-spec/resources/reports/{report}.yaml` — der `Reports`-Tag ist zu gross
   für eine Datei und liegt pro Endpoint getrennt
4. **Guides:** `docs/api-spec/guides/{thema}.md` — Productives eigene Anleitungen. Hier stehen
   Regeln, die die Spec nicht kennt: `working-with-custom-fields` (der Hash wird **ersetzt**, nicht
   gemergt), `document-format` (Seiten-Bodies sind Dokumente, kein HTML), `filtering`, `pagination`,
   `rate-limits`, `error-handling`
5. **Vollständige Spec:** `docs/api-spec/productive-openapi.yaml` — nur für Codegen, NICHT direkt lesen
