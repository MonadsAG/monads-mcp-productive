# Productive.io API Changelog

## 2026-11-02

**Spec:** OpenAPI 3.1.0, 503 paths, 814 operations

### Removed paths

- `/api/v2/boards`
- `/api/v2/boards/copy`
- `/api/v2/boards/{id}`
- `/api/v2/boards/{id}/archive`
- `/api/v2/boards/{id}/move`
- `/api/v2/boards/{id}/reposition`
- `/api/v2/boards/{id}/restore`

### New paths

- `/api/v2/allocations`
- `/api/v2/approval_statuses/approve`
- `/api/v2/aws_policies`
- `/api/v2/bill_items`
- `/api/v2/bill_items/{id}`
- `/api/v2/calendar_events`
- `/api/v2/connections`
- `/api/v2/connections/accept`
- `/api/v2/connections/{id}`
- `/api/v2/contracts/generate`
- `/api/v2/contracts/{id}/recalculate_rolled_over_time`
- `/api/v2/custom_domains/{id}/verify`
- `/api/v2/deals/close`
- `/api/v2/deals/open`
- `/api/v2/email_links`
- `/api/v2/email_links/{id}`
- `/api/v2/expenses/{id}/check_export_status`
- `/api/v2/expenses/{id}/download_datev_files`
- `/api/v2/expenses/{id}/unlink_purchase_order`
- `/api/v2/export_jobs/{id}`
- `/api/v2/filter_preferences`
- `/api/v2/filter_preferences/track`
- `/api/v2/filter_preferences/{id}`
- `/api/v2/filter_preferences/{id}/increment`
- `/api/v2/filters/copy`
- `/api/v2/holiday_calendars/countries`
- `/api/v2/imports`
- `/api/v2/imports/flatfile`
- `/api/v2/imports/harvest_import`
- `/api/v2/imports/{id}`
- `/api/v2/imports/{id}/import`
- `/api/v2/imports/{id}/revert`
- `/api/v2/integrations/{id}/check_dependencies`
- `/api/v2/invoices/credit_note`
- `/api/v2/invoices/{id}/check_export_status`
- `/api/v2/job_role_rate_cards`
- `/api/v2/job_role_rate_cards/{id}`
- `/api/v2/job_role_rate_cards/{id}/archive`
- `/api/v2/job_role_rate_cards/{id}/restore`
- `/api/v2/organization_champions`
- `/api/v2/organization_champions/{id}`
- `/api/v2/organization_invoices`
- `/api/v2/organization_invoices/overdue`
- `/api/v2/organization_invoices/upcoming`
- `/api/v2/organization_invoices/{id}`
- `/api/v2/organization_membership_counts/{id}`
- `/api/v2/organization_subscriptions/{id}/allocate_seats`
- `/api/v2/organization_subscriptions/{id}/cancel_trial`
- `/api/v2/organization_subscriptions/{id}/create_setup_intent`
- `/api/v2/organizations/{id}/disable_scim`
- `/api/v2/organizations/{id}/force_two_factor_login`
- `/api/v2/organizations/{id}/generate_scim_token`
- `/api/v2/organizations/{id}/sample`
- `/api/v2/payment_reminders`
- `/api/v2/payment_reminders/{id}`
- `/api/v2/payment_reminders/{id}/copy`
- `/api/v2/placeholder_usages`
- `/api/v2/placeholder_usages/{id}`
- `/api/v2/placeholders`
- `/api/v2/placeholders/{id}`
- `/api/v2/project_milestones`
- `/api/v2/project_milestones/{id}`
- `/api/v2/projects/{id}/export`
- `/api/v2/projects/{id}/export_update`
- `/api/v2/projects/{project_id}/preferences`
- `/api/v2/proposal_services`
- `/api/v2/proposal_sessions`
- `/api/v2/proposals/{id}/publish`
- `/api/v2/proposals/{id}/send`
- `/api/v2/public/proposals/{uuid}`
- `/api/v2/public/proposals/{uuid}/confirm_identity`
- `/api/v2/public/proposals/{uuid}/decline`
- `/api/v2/public/proposals/{uuid}/file_authorize`
- `/api/v2/public/proposals/{uuid}/file_presign`
- `/api/v2/public/proposals/{uuid}/unlock`
- `/api/v2/reports/balancing_hour_reports`
- `/api/v2/reports/bill_reports`
- `/api/v2/reports/project_milestone_reports`
- `/api/v2/reports/purchase_order_reports`
- `/api/v2/roles/{id}/transfer_people`
- `/api/v2/salaries/set_default`
- `/api/v2/scenario_bookings`
- `/api/v2/scenario_bookings/{id}`
- `/api/v2/scenario_items`
- `/api/v2/scenario_items/{id}`
- `/api/v2/scenario_sections`
- `/api/v2/scenario_sections/{id}`
- `/api/v2/scenario_services`
- `/api/v2/scenario_services/{id}`
- `/api/v2/scenarios`
- `/api/v2/scenarios/copy`
- `/api/v2/scenarios/{id}`
- `/api/v2/scenarios/{id}/overwrite`
- `/api/v2/scenarios/{id}/sync`
- `/api/v2/service_suggestions`
- `/api/v2/service_types/{id}/restore`
- `/api/v2/services/{id}/move`
- `/api/v2/signups`
- `/api/v2/signups/unsubscribe`
- `/api/v2/signups/xero_connect`
- `/api/v2/signups/xero_finalize`
- `/api/v2/signups/{id}/authenticated_finalize`
- `/api/v2/signups/{id}/finalize`
- `/api/v2/signups/{id}/verify`
- `/api/v2/templates/copy`
- `/api/v2/two_factor_authentications`
- `/api/v2/two_factor_authentications/{id}`
- `/api/v2/webhooks/{id}/activate`
- `/api/v2/webhooks/{id}/deactivate`
- `/api/v2/webhooks/{id}/regenerate_signing_secret`
- `/api/v2/webhooks/{id}/test_payload`
- `/api/v2/widgets/{id}/move`
- `/api/v2/workflows/{id}/copy`

### Changed methods

- `/api/v2/approval_policy_assignments`: +DELETE
- `/api/v2/approval_workflows`: +GET, +PATCH
- `/api/v2/bills`: +GET
- `/api/v2/custom_domains/{id}`: +PATCH
- `/api/v2/integrations/{id}`: +PATCH
- `/api/v2/invoice_attributions`: +DELETE, +PATCH
- `/api/v2/tasks`: +DELETE, +PATCH
- `/api/v2/users/{id}`: +DELETE
- `/api/v2/webhooks/{id}`: +PATCH

### Filter keys

- **booking**: added `parent_company_id`
- **budget_report**: added `overtime_time`
- **comment**: added `deal_id`
- **deal**: added `overtime_time`
- **deal_report**: added `overtime_time`
- **expense**: added `approved_by_actual_approver_id`, `approved_for_assigned_approver_id`
- **expense_report**: added `approved_by_actual_approver_id`, `approved_for_assigned_approver_id`
- **financial_item_report**: added `total_overtime_time`
- **meeting**: added `guest_id`, `joined_id`, `organizer_id`
- **new_time_report**: removed `role_type`
- **person**: removed `last_seen_at`
- **person_report**: removed `last_seen_at`
- **placeholder_usage**: removed `interval_enabled`
- **resource_request**: added `job_role_id`
- **service**: added `overtime_time`
- **service_report**: added `overtime_time`
- **task**: added `booked_time`, `description`, `future_booked_time`, `left_to_schedule_time`, `net_unplanned_time`
- **task_report**: removed `board_name`
- **time_entry**: added `approved_by_actual_approver_id`, `approved_for_assigned_approver_id`
- **time_entry_report**: added `approved_by_actual_approver_id`, `approved_for_assigned_approver_id`, `billable_approved_time`

### Resource attributes

- **activity**: added `external_author_name`
- **agent**: added `memberships`
- **agent_config**: added `ai_model`, `reasoning_effort`
- **approval_workflow**: added `approver_id`, `subscriber_id`
- **artifact**: added `attachment`, `content_url`, `creator`, `memberships`
- **attachment**: added `meeting_id`
- **bank_account**: added `local_bank_code`
- **booking**: added `parent_company_id`
- **budget_report**: added `overtime_time`, `total_overtime_time`
- **company**: removed `domain`
- **contact_entry**: added `external_id`
- **contract**: added `generate_until`
- **custom_field**: added `maximum_value`, `minimum_value`, `tag_field`
- **dashboard**: added `memberships`
- **deal**: added `contact_ids`, `contacts`, `export_error`, `export_id`, `export_status`, `export_url`, `exported`, `exported_at`, `memberships`, `overtime_time`
- **deal_report**: added `overtime_time`, `total_overtime_time`
- **einvoice_identity**: added `sdi_code`
- **email**: added `sent_from_mailbox`, `source`
- **entitlement_report**: added `description`
- **event**: added `external_id`
- **expense**: added `approved_by_actual_approver_id`, `approved_for_assigned_approver_id`, `export_error`, `markup_amount`, `markup_amount_default`, `markup_amount_normalized`
- **expense_report**: added `approved_by_actual_approver_id`, `approved_for_assigned_approver_id`
- **filter**: added `template_object`
- **financial_item_report**: added `total_overtime_time`
- **import**: added `file_names`
- **integration**: removed `force_sso_login`, `sso_metadata`, `sso_metadata_url`, `sso_target_url`, `sso_url`; added `configured_deals_count`, `configured_projects_count`, `expenses_import`, `hubspot_deal_sync_mode`, `hubspot_write_scope`, `netsuite_create_customers_on_export`, `netsuite_import_vendor_bill_expense_line_field_mapping`, `netsuite_import_vendor_bill_field_mapping`, `netsuite_import_vendor_bill_item_line_field_mapping`, `netsuite_invoice_entity_type`, `netsuite_sync_customer_addresses`, `netsuite_vendor_bill_form_id`
- **integration_task_management_configuration**: added `jira_project_style`
- **invoice**: removed `pay_on_relative`; added `export_error`
- **invoice_report**: added `delivery_method`
- **line_item**: removed `manual_entry`
- **lost_reason**: added `position`
- **meeting**: added `applies_to`, `guest_id`, `joined_id`, `link_applies_to`, `link_set_by`, `link_suggestions`, `meeting_type`, `memberships`, `notetaker_applies_to`, `notetaker_set_by`, `organizer_id`, `public_access`, `public_uuid`, `suggested_deals`, `suggested_projects`
- **meeting_participant**: added `participation`
- **new_time_report**: added `overtime_time`, `working_days`
- **notification**: added `agent_session_status`
- **organization**: added `ai_allowed_models`, `create_time_entry_on_timer_start`, `mcp_server_enabled`, `meeting_settings`, `task_due_time_enabled`
- **organization_subscription**: added `trial_ends_on`, `trial_plan_ends_on`
- **page**: added `memberships`
- **person**: added `ai_assistant_instructions`, `person_session`
- **placeholder_usage**: removed `interval_enabled`
- **project**: added `description`, `export_error`, `export_id`, `export_status`, `export_url`, `exported`, `exported_at`, `external_deal_id`, `memberships`, `project_milestones`
- **proposal**: removed `proposal_version_two`; added `attachment`, `identity_confirmation_enabled`, `identity_confirmed_at`, `scenario`, `source`
- **resource_request**: added `job_role_id`
- **role**: added `access_description`, `best_when_description`
- **search_quick_result**: added `matches_position`
- **service**: added `overtime_time`
- **service_report**: added `overtime_time`, `total_overtime_time`
- **survey**: added `memberships`
- **task**: removed `board_id`; added `left_to_schedule_time`, `net_unplanned_time`, `placeholder_usages`, `subtasks`, `task_dependencies`, `todos`
- **task_report**: removed `board_name`
- **template**: added `filter`
- **time_entry**: added `approved_by_actual_approver_id`, `approved_for_assigned_approver_id`
- **time_entry_report**: added `approved_by_actual_approver_id`, `approved_for_assigned_approver_id`, `billable_approved_time`, `designated_approver_report`, `total_billable_approved_time`
- **time_tracking_policy**: removed `note_mandatory`
- **user**: added `slack_product_updates`

---

## 2026-09-28

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
