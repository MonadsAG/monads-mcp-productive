# Productive.io API Changelog

## 2026-08-31

**Spec:** OpenAPI 3.1.0, 396 paths, 654 operations

### New paths

- `/api/v2/pages/apply_template_as_doc`
- `/api/v2/pages/{id}/apply_template_as_target`
- `/api/v2/pages/{id}/apply_template_on_parent`
- `/api/v2/pages/{id}/convert_to_doc`
- `/api/v2/public/pages/{uuid}`
- `/api/v2/reports/automation_reports`

### Filter keys

- **project**: removed `public_access`
- **project_report**: removed `public_access`

### Resource attributes

- **organization_subscription**: removed `active_products`
- **page**: removed `subscriber_ids`; added `target_doc_id`, `template_id`, `updater`
- **person**: added `shared_seat`
- **person_report**: added `shared_seat`
- **project**: removed `public_access`
- **project_report**: removed `public_access`

---

## 2026-08-20

**Spec:** OpenAPI 3.1.0, 390 paths, 648 operations

Migrated to the official OpenAPI spec published at
`https://developer.productive.io/reference/download_spec`. The previous spec was
scraped from the old HTML documentation and is not comparable operation by
operation, so no diff is shown for this entry.

---

## 2026-04-03

**Spec stats:** 354 paths, 581 operations

Initial spec generated.

---
