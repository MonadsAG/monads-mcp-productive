# Productive.io API Spec – Claude Code Context

Dieses Verzeichnis enthält die OpenAPI 3.0 Spec für die Productive.io API,
generiert aus der offiziellen Dokumentation (https://developer.productive.io).

## Spec generieren / aktualisieren

```bash
cd docs/api-spec
pip install requests beautifulsoup4 pyyaml   # einmalig
python productive_to_openapi.py              # erzeugt productive-openapi.yaml + CHANGELOG.md
```

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
      "person":  { "data": { "type": "people",   "id": "123" } },
      "service": { "data": { "type": "services",  "id": "456" } }
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

| Resource | Path | Besonderheiten |
|----------|------|----------------|
| `time_entries` | `/api/v2/time_entries` | Zeit in Minuten (`time: 480` = 8h). Filter: `after`, `before`, `person_id`, `service_id`, `task_id`, `project_id`, `status` (1=approved/2=unapproved/3=rejected) |
| `time_entries` Aktionen | `/{id}/approve`, `/{id}/unapprove`, `/{id}/reject` | PATCH ohne Body |
| `tasks` | `/api/v2/tasks` | Filter: `assignee_id`, `project_id`, `task_list_id`, `workflow_status_id`, `status` (open/closed) |
| `projects` | `/api/v2/projects` | Filter: `company_id`, `status` |
| `deals` | `/api/v2/deals` | = Budgets. `deal_type_id`: 1=internal, 2=client |
| `services` | `/api/v2/services` | Filter: `deal_id`, `project_id` |
| `people` | `/api/v2/people` | Filter: `company_id`, `status` |
| `companies` | `/api/v2/companies` | |
| `workflow_statuses` | `/api/v2/workflow_statuses` | Filter: `workflow_id` |

## Vollständige Spec

Die vollständige maschinenlesbare Spec liegt nach dem Generieren in:
`docs/api-spec/productive-openapi.yaml`
