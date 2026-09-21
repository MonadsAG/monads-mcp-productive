# Productive.io API Changelog

## 2026-09-21

**Spec:** OpenAPI 3.1.0, 397 paths, 652 operations

### Removed paths

- `/api/v2/placeholder_usages`
- `/api/v2/placeholder_usages/{id}`
- `/api/v2/placeholders`
- `/api/v2/placeholders/{id}`
- `/api/v2/project_assignments`
- `/api/v2/project_assignments/{id}`

### New paths

- `/api/v2/events/{id}/restore`
- `/api/v2/integrations/{id}/sync`
- `/api/v2/project_preferences`
- `/api/v2/project_preferences/{id}`
- `/api/v2/skills`
- `/api/v2/skills/{id}`

### Filter keys

- **person**: removed `two_factor_auth`
- **person_report**: removed `two_factor_auth`

### Resource attributes

- **company**: added `default_payment_reminder_sequence`, `default_payment_reminder_sequence_id`
- **einvoice_configuration**: added `responsible_person_email`, `verification_status_id`
- **line_item**: added `manual_entry`
- **new_time_report**: removed `role_type`; added `job_role`, `job_role_id`
- **person**: added `job_role`, `job_role_id`
- **person_report**: added `job_role`, `job_role_id`
- **search_quick_result**: added `root_page_id`
- **task**: added `booked_time`, `future_booked_time`
- **task_report**: added `booked_time`, `future_booked_time`, `left_to_schedule_time`, `net_unplanned_time`, `total_booked_time`, `total_future_booked_time`, `total_left_to_schedule_time`, `total_net_unplanned_time`

---

## 2026-09-07

**Spec:** OpenAPI 3.1.0, 397 paths, 655 operations

### New paths

- `/api/v2/proposals/{id}/signed_pdf`

### Filter keys

- **membership**: added `artifact_id`, `skill_id`
- **project_relevancy_report**: added `booked_period_end`, `booked_period_start`

### Resource attributes

- **company**: added `domains`
- **einvoice_transaction**: added `attachments`
- **membership**: added `artifact`, `artifact_id`, `meeting`, `skill_id`
- **price**: added `discount_amount`, `discount_amount_default`, `discount_amount_normalized`, `discount_type`
- **project_relevancy_report**: added `booked_period_end`, `booked_period_start`
- **proposal**: removed `audit_pdf_url`, `original_pdf_url`; added `number`
- **service**: added `discount_type`

---

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
