# Productive.io API Changelog

## 2026-11-16

**Spec:** OpenAPI 3.1.0, 519 paths, 842 operations

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
- `/api/v2/expenses/download_datev_files`
- `/api/v2/expenses/export`
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
- `/api/v2/invoices/copy`
- `/api/v2/invoices/credit_note`
- `/api/v2/invoices/download_datev_files`
- `/api/v2/invoices/export`
- `/api/v2/invoices/{id}/check_export_status`
- `/api/v2/invoices/{id}/download_datev_files`
- `/api/v2/invoices/{id}/download_xml`
- `/api/v2/invoices/{id}/export_pdf`
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
- `/api/v2/proposals/bulk_approve`
- `/api/v2/proposals/{id}/approve`
- `/api/v2/proposals/{id}/publish`
- `/api/v2/proposals/{id}/reject`
- `/api/v2/proposals/{id}/send`
- `/api/v2/proposals/{id}/send_approval_mail`
- `/api/v2/proposals/{id}/unapprove`
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
- `/api/v2/time_entries/mark_as_invoiced`
- `/api/v2/time_entries/{id}/start`
- `/api/v2/time_entries/{id}/stop`
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
- `/api/v2/deal_cost_rates`: +DELETE
- `/api/v2/deals`: +DELETE, +PATCH
- `/api/v2/integrations/{id}`: +PATCH
- `/api/v2/invoice_attributions`: +DELETE, +PATCH
- `/api/v2/invoices`: +DELETE, +PATCH
- `/api/v2/payments`: +DELETE, +PATCH
- `/api/v2/service_assignments`: +DELETE
- `/api/v2/services`: +DELETE, +PATCH
- `/api/v2/service_type_assignments`: +DELETE
- `/api/v2/tasks`: +DELETE, +PATCH
- `/api/v2/users/{id}`: +DELETE
- `/api/v2/webhooks/{id}`: +PATCH
- `/api/v2/widgets`: +PATCH

### Filter keys

- **agent**: added `subsidiary_id`
- **approval_policy**: added `subsidiary_id`
- **attachment**: removed `company_id`, `project_id`
- **automation_report**: removed `agent_id`, `automatable_type`, `created_at`, `creator_id`, `enabled`, `exclude_template_projects`, `id`, `name`, `project_id`, `query`, `resolve_on_all_projects`, `survey_id`, `target_id`, `type_id`, `updated_at`
- **backoffice_organization_report**: added `flag_state`
- **booking**: added `absence_type`, `date`, `parent_company_id`, `service_id`, `service_type_id`, `time`
- **booking_report**: added `id`
- **budget_report**: added `budgeted_time_usage`, `current_occurrence`, `deal_value_source`, `estimated_time_usage`, `overtime_time`, `retainer`, `revenue_distribution_base`, `revenue_distribution_end_on`, `revenue_distribution_start_on`, `stage_type`, `time_entry_mandatory_note`, `time_entry_mandatory_task`, `time_entry_requirements`, `time_to_close`
- **comment**: removed `budget_status`, `company_id`, `person_type`, `public_access`, `responsible_id`, `role_id`, `sales_status_id`, `status`, `status_id`; added `artifact_id`, `deal_id`, `id`
- **company**: added `assigned_subsidiary_id`, `email_domain`
- **company_report**: removed `archived_at`, `billing_name`, `company_code`, `company_id`, `created_at`, `custom_fields`, `default_currency`, `default_subsidiary_id`, `default_tax_rate_id`, `due_days`, `exclude_company_and_children`, `full_query`, `fuzzy_dates`, `fuzzy_people`, `has_parent_company`, `id`, `jump_query`, `last_activity_at`, `name`, `parent_company_id`, `payment_terms`, `project_id`, `query`, `status`, `subscriber_id`, `subsidiary_id`, `tags`, `vat`
- **custom_field**: added `id`
- **custom_field_option**: added `id`
- **custom_field_section**: added `id`
- **dashboard**: added `id`
- **deal**: added `budgeted_time_usage`, `current_occurrence`, `deal_value_source`, `estimated_time_usage`, `overtime_time`, `retainer`, `revenue_distribution_base`, `revenue_distribution_end_on`, `revenue_distribution_start_on`, `time_entry_mandatory_note`, `time_entry_mandatory_task`, `time_to_close`
- **deal_cost_rate**: added `id`
- **deal_report**: removed `accessible_by_person`, `actual_rate`, `approval_policy_id`, `billable_time`, `budget_remaining`, `budget_status`, `budget_total`, `budget_usage`, `budget_used`, `budget_warning`, `budgeted_time`, `closed_at`, `color_id`, `company_id`, `contact_id`, `contract_id`, `cost`, `created_at`, `creator_id`, `credited`, `currency`, `custom_fields`, `date`, `days_in_current_stage`, `days_since_created`, `days_since_last_activity`, `deal_status_id`, `deal_type_id`, `deal_value_source`, `delivered_on`, `designated_approver_id`, `discount`, `draft_invoiced`, `end_date`, `estimated_cost`, `estimated_remaining_time`, `estimated_time`, `expense`, `expenses_billable`, `forecasted_billable_time`, `forecasted_budget_usage`, `forecasted_budget_used`, `forecasted_cost`, `forecasted_margin`, `forecasted_profit`, `forecasted_revenue`, `forecasted_time_usage`, `formulas`, `full_query`, `future_booked_time`, `future_budget_used`, `future_cost`, `future_revenue`, `fuzzy_dates`, `fuzzy_people`, `id`, `invoiced`, `invoiced_percentage`, `invoiced_rate`, `jump_query`, `last_activity_at`, `lost_at`, `lost_date`, `lost_reason_id`, `manual_invoicing_status`, `manually_invoiced`, `name`, `needs_closing`, `needs_invoicing`, `next_occurrence_on`, `number`, `origin_deal_id`, `parent_company_id`, `pending_invoicing`, `pipeline_id`, `previous_deal_status_id`, `previous_or_current_deal_status_id`, `previous_probability`, `probability`, `profit`, `profit_margin`, `project_id`, `project_type`, `projected_revenue`, `purchase_order_number`, `query`, `recurring`, `recurring_ends_on`, `recurring_interval_id`, `recurring_starts_on`, `responsible_id`, `retainer`, `retainer_interval`, `revenue`, `revenue_distribution_type`, `sales_closed_at`, `sales_closed_on`, `sales_status_id`, `services_revenue`, `stage_status_id`, `stage_updated_at`, `status`, `status_id`, `subscriber_id`, `subsidiary_id`, `tags`, `template`, `time_approval`, `todo_due_date`, `tracking_type_id`, `type`, `unapproved_time`, `won_at`, `won_date`, `work_cost`, `worked_time`
- **discussion**: added `artifact_id`
- **einvoice_configuration**: added `id`
- **einvoice_identity**: added `id`
- **einvoice_transaction**: added `id`
- **email**: added `created_at`
- **entitlement**: added `description`
- **entitlement_report**: added `description`
- **expense**: added `approved_by_actual_approver_id`, `approved_for_assigned_approver_id`
- **expense_report**: removed `allocation_status`, `amount`, `amount_with_tax`, `approval_status`, `approved_at`, `approver_id`, `assigned_approver_id`, `awaiting_approval_from_approver_id`, `billable_amount`, `company_id`, `created_at`, `creator_id`, `currency`, `custom_fields`, `date`, `date_after`, `date_before`, `deal_id`, `designated_approver_id`, `draft`, `export_status`, `formulas`, `full_query`, `fuzzy_dates`, `fuzzy_people`, `id`, `invoice_id`, `invoiced`, `invoicing_status`, `jump_query`, `name`, `paid_on`, `paid_on_after`, `paid_on_before`, `pay_on`, `pay_on_after`, `pay_on_before`, `person_id`, `profit`, `project_id`, `purchase_order_id`, `quantity`, `query`, `quote_type`, `recognized_revenue`, `reimbursable`, `reimbursed_on`, `reimbursement`, `responsible_id`, `section_name`, `service_id`, `service_type_id`, `stage_type`, `status`, `tax_rate_id`, `updated_at`, `updater_id`, `vendor_id`, `with_draft`
- **filter**: added `description`, `template`
- **financial_item_report**: removed `group`, `locked`; added `total_future_scheduled_time`, `total_overtime_time`
- **holiday**: added `date`, `id`
- **holiday_calendar**: added `subsidiary_id`
- **integration**: added `agent_id`, `agent_owned`, `id`, `person_id`
- **integration_exporter_configuration**: added `id`
- **integration_task_management_configuration**: added `id`
- **invoice**: removed `fuzzy_dates`, `parent_company_id`; added `einvoice_status`, `fiscalization_status`, `tax_rates`
- **invoice_attribution**: added `id`
- **invoice_report**: removed `amount`, `amount_credited`, `amount_credited_with_tax`, `amount_paid`, `amount_tax`, `amount_unpaid`, `amount_with_tax`, `amount_written_off`, `automatically_created`, `company_id`, `created_at`, `creator_id`, `credited`, `currency`, `currency_id`, `custom_fields`, `deal_id`, `delivery_on`, `einvoice_status`, `export_status`, `fiscalization_status`, `formulas`, `full_query`, `fuzzy_dates`, `fuzzy_people`, `id`, `invoice_aging`, `invoice_state`, `invoice_status`, `invoice_type`, `invoiced_on`, `invoicing_method`, `issuer_id`, `jump_query`, `last_activity_at`, `number`, `overdue_status`, `paid_on`, `parent_company_id`, `parent_invoice_id`, `pay_on`, `payment_status`, `payment_terms`, `project_id`, `purchase_order_number`, `query`, `responsible_id`, `sent_on`, `sent_status`, `status`, `subscriber_id`, `subsidiary_id`, `tags`, `tax_rates`
- **line_item**: added `description`
- **line_item_report**: removed `company_id`, `creator_id`, `discount`, `expense_id`, `id`, `invoice_id`, `service_id`, `service_type_id`, `tax_name`, `tax_rate`, `tax_value`, `unit_id`, `updater_id`
- **lost_reason**: added `subsidiary_id`
- **meeting**: removed `calendar_event_id`, `calendar_event_uid`, `calendar_id`, `calendar_provider`; added `guest_id`, `joined_id`, `organizer_id`
- **membership**: added `whiteboard_id`
- **organization**: added `id`
- **organization_membership**: added `id`
- **overhead**: added `id`
- **payment_reminder_sequence**: added `id`
- **payment_report**: removed `amount`, `budget_id`, `company_id`, `external_id`, `formulas`, `id`, `invoice_id`, `number`, `paid_after`, `paid_before`, `paid_on`, `project_id`, `query`, `subsidiary_id`, `written_off_on`
- **person**: removed `last_seen_at`; added `accessible_agent_id`, `accessible_meeting_id`, `collaborate_project_id`
- **person_report**: removed `accessible_deal_id`, `accessible_doc_id`, `accessible_filter_id`, `accessible_project_id`, `agent`, `approval_policy_id`, `approval_workflow_id`, `archived_at`, `autotracking`, `bookings_after`, `bookings_before`, `company_id`, `created_at`, `custom_fields`, `custom_role_id`, `deactivated_at`, `eligible_replacement_managers`, `email`, `first_name`, `full_query`, `fuzzy_dates`, `fuzzy_people`, `holiday_calendar_id`, `hrm_type_id`, `id`, `job_role_id`, `joined_at`, `jump_query`, `last_activity_at`, `last_name`, `last_seen_at`, `manager_id`, `offboarding_status`, `permissions`, `person_type`, `project_id`, `project_watching`, `query`, `role_id`, `schedulable`, `service_id`, `service_type_id`, `shared_seat`, `status`, `subscribable_id`, `subscribable_type`, `subsidiary_id`, `tags`, `team`, `time_tracking_policy_id`, `timesheet_submission_disabled`, `title`, `virtual`
- **pipeline**: added `id`, `subsidiary_id`
- **placeholder_usage**: removed `interval_enabled`; added `id`
- **price_report**: added `query`
- **project**: removed `with_templates`; added `archived_at`, `subsidiary_id`
- **project_relevancy_report**: added `attendee_email`, `meeting_history_period_end`, `meeting_history_period_start`, `title`
- **project_report**: removed `for_tracking`, `with_templates`; added `archived_at`, `subsidiary_id`
- **proposal**: added `approval_status`, `approved_by_actual_approver_id`, `approved_for_assigned_approver_id`, `awaiting_approval_from_approver_id`
- **proposal_report**: added `approval_status`
- **resource_request**: added `job_role_id`
- **role**: added `description`, `principal_type`, `subsidiary_id`
- **salary**: added `ended_on`, `id`, `started_on`
- **service**: added `billing_method`, `future_tentative_booked_time`, `net_unplanned_time`, `overtime_time`, `tentative_booked_time`
- **service_report**: removed `after`, `before`, `billable`, `billable_time`, `billing_type`, `bookable_after`, `bookable_before`, `bookable_date`, `bookable_date_for_period`, `booked_time`, `booking_tracking_enabled`, `budget_cap_enabled`, `budget_custom_fields`, `budget_date`, `budget_id`, `budget_remaining`, `budget_status`, `budget_total`, `budget_used`, `budgeted_time`, `budgets_and_deals`, `company_id`, `contract_id`, `cost`, `custom_fields`, `deal_custom_fields`, `deal_id`, `deal_stage_id`, `deal_status_id`, `discount`, `discount_amount`, `estimated_cost`, `estimated_time`, `expense_cost`, `expense_tracking_enabled`, `explicit_access`, `for_tracking`, `formulas`, `future_booked_time`, `future_budget_used`, `id`, `initial_service_id`, `left_to_schedule_time`, `limitation_type`, `markup`, `markup_amount`, `name`, `origin_deal_id`, `origin_service_id`, `person_id`, `pipeline_id`, `price`, `probability`, `profit`, `profit_margin`, `project_id`, `project_type`, `projected_revenue`, `projectless_budgets`, `quantity`, `query`, `recognized_revenue`, `remaining_scheduled_time`, `responsible_id`, `revamped_unit`, `revenue`, `rolled_over_time`, `sales_status_id`, `section_id`, `service_type_id`, `stage_status_id`, `stage_type`, `subsidiary_id`, `task_id`, `template`, `time_tracking_enabled`, `trackable_by_person_id`, `type`, `unapproved_time`, `unit`, `updated_at`, `with_memberships`, `worked_cost`, `worked_time`
- **service_type**: added `description`, `subsidiary_id`
- **subsidiary**: added `name`
- **task**: removed `board_status`; added `booked_time`, `description`, `future_booked_time`, `left_to_schedule_time`, `net_unplanned_time`
- **task_report**: removed `after`, `assignee_id`, `before`, `billable_time`, `board_name`, `board_status`, `bookable_after`, `bookable_before`, `booked_time`, `closed_after`, `closed_at`, `closed_before`, `company_id`, `created_at`, `creator_id`, `custom_fields`, `date_range`, `dependency_type`, `due_date`, `due_date_after`, `due_date_before`, `due_date_new`, `due_date_on`, `folder_id`, `folder_name`, `folder_status`, `formulas`, `full_query`, `future_booked_time`, `fuzzy_dates`, `fuzzy_people`, `id`, `initial_estimate`, `jump_query`, `last_activity`, `last_activity_after`, `last_activity_before`, `last_actor_id`, `left_to_schedule_time`, `net_unplanned_time`, `overdue_status`, `parent_task_id`, `person_type`, `project_id`, `project_manager_id`, `project_type`, `public_access`, `query`, `query_extended`, `remaining_time`, `repeating`, `service_id`, `start_date`, `start_date_after`, `start_date_before`, `status`, `subscriber_id`, `subtask`, `tags`, `task_list_id`, `task_list_name`, `task_list_status`, `task_number`, `task_type`, `template`, `template_id`, `title`, `trackable_by_person_id`, `type_id`, `updated_at`, `worked_time`, `workflow_id`, `workflow_status_category_id`, `workflow_status_id`
- **team**: added `subsidiary_id`
- **time_entry**: added `approved_by_actual_approver_id`, `approved_for_assigned_approver_id`, `calendar_event_recurring_id`, `only_draft`, `only_latest_per_recurring_series`, `overtime`, `overtime_cost_multiplier`, `with_draft`
- **time_entry_report**: removed `after`, `approval_policy_id`, `approved_at`, `approver_id`, `assigned_approver_id`, `autotracked`, `awaiting_approval_from_approver_id`, `base_cost`, `before`, `billable`, `billable_time`, `billing_type_id`, `booking_id`, `budget_id`, `budget_type_id`, `company_id`, `cost`, `created_after`, `created_at`, `created_before`, `creator_id`, `date`, `deal_id`, `deal_subsidiary_id`, `designated_approver_id`, `ended_at`, `facility_overhead_cost`, `formulas`, `id`, `intercompany_hours`, `internal_overhead_cost`, `invoice_attribution_id`, `invoice_id`, `invoiced`, `invoicing_status`, `jira_issue_id`, `jira_issue_status`, `jira_issue_summary`, `jira_worklog_id`, `last_activity_at`, `last_actor_id`, `note`, `overhead`, `overhead_cost`, `parent_company_id`, `people_custom_fields`, `person_id`, `person_manager_id`, `person_subsidiary_id`, `person_tags`, `project_id`, `project_manager_id`, `project_type_id`, `query`, `responsible_id`, `role_id`, `section_name`, `service_id`, `service_type_id`, `stage_type`, `started_after`, `started_at`, `started_before`, `status`, `task_id`, `task_list_id`, `time`, `track_method_id`, `unit_id`, `updated_at`
- **webhook_log**: added `created_at`
- **workflow**: added `subsidiary_id`

### Resource attributes

- **activity**: added `external_author_name`
- **agent**: added `memberships`
- **agent_config**: added `ai_model`, `reasoning_effort`
- **approval_status**: added `custom_field`, `custom_field_id`
- **approval_workflow**: added `approver_custom_field_ids`, `approver_id`, `subscriber_id`
- **artifact**: added `attachment`, `content_url`, `creator`, `memberships`
- **attachment**: added `meeting_id`, `whiteboard_id`
- **bank_account**: added `local_bank_code`
- **booking**: added `parent_company_id`
- **budget_report**: added `applied_scenario_margin`, `overtime_time`, `total_overtime_time`
- **comment**: added `artifact_id`
- **company**: removed `domain`
- **company_report**: added `category`
- **contact_entry**: added `external_id`
- **contract**: added `generate_until`
- **custom_field**: added `maximum_value`, `minimum_value`, `tag_field`
- **dashboard**: added `memberships`
- **deal**: added `applied_scenario_margin`, `confirm_revenue_distribution_variance`, `contact_ids`, `contacts`, `export_error`, `export_id`, `export_status`, `export_url`, `exported`, `exported_at`, `memberships`, `overtime_time`, `proposal_approval`, `proposal_approval_workflow`
- **deal_report**: added `applied_scenario_margin`, `overtime_time`, `total_overtime_time`
- **discussion**: added `anchor`, `artifact`, `artifact_id`, `creator`
- **einvoice_identity**: added `sdi_code`
- **email**: added `sent_from_mailbox`, `source`, `unique_body`
- **entitlement_report**: added `description`
- **event**: added `external_id`
- **expense**: added `approved_by_actual_approver_id`, `approved_for_assigned_approver_id`, `export_error`, `markup_amount`, `markup_amount_default`, `markup_amount_normalized`
- **expense_report**: added `approved_by_actual_approver_id`, `approved_for_assigned_approver_id`
- **filter**: added `template_object`
- **financial_item_report**: added `total_overtime_time`
- **import**: added `file_names`
- **integration**: removed `force_sso_login`, `sso_metadata`, `sso_metadata_url`, `sso_target_url`, `sso_url`; added `configured_deals_count`, `configured_projects_count`, `expenses_import`, `hubspot_deal_sync_mode`, `hubspot_write_scope`, `netsuite_create_customers_on_export`, `netsuite_import_vendor_bill_expense_line_field_mapping`, `netsuite_import_vendor_bill_field_mapping`, `netsuite_import_vendor_bill_item_line_field_mapping`, `netsuite_invoice_entity_type`, `netsuite_sync_customer_addresses`, `netsuite_time_bill_form_id`, `netsuite_time_entry_field_mapping`, `netsuite_time_entry_fixed_value_mapping`, `netsuite_vendor_bill_form_id`, `quickbooks_ach_payment`, `quickbooks_credit_card_payment`, `use_time_entries_export`
- **integration_task_management_configuration**: added `jira_project_style`
- **invoice**: removed `pay_on_relative`; added `amount_attributed`, `amount_attributed_default`, `amount_attributed_normalized`, `export_error`
- **invoice_report**: added `delivery_method`
- **line_item**: removed `manual_entry`
- **lost_reason**: added `position`
- **meeting**: removed `calendar_event_uid`; added `applies_to`, `attachment_id`, `guest_id`, `joined_id`, `link_applies_to`, `link_set_by`, `meeting_type`, `memberships`, `notetaker_applies_to`, `notetaker_set_by`, `organizer_id`, `public_access`, `public_uuid`, `speakers`
- **meeting_participant**: added `added_as_person`, `calendar_event_id`, `participation`
- **membership**: added `message`, `whiteboard`, `whiteboard_id`
- **new_time_report**: added `overtime_time`, `working_days`
- **notification**: added `agent_session_status`
- **organization**: added `ai_allowed_models`, `ai_instructions`, `create_time_entry_on_timer_start`, `mcp_server_enabled`, `meeting_settings`, `proposal_approvals`, `save_line_item_snapshots`, `task_due_time_enabled`
- **organization_subscription**: added `billing_group_owner_id`, `discounts`, `trial_ends_on`, `trial_plan_ends_on`
- **page**: added `memberships`
- **person**: added `ai_assistant_avatar_url`, `ai_assistant_instructions`, `ai_assistant_name`, `person_session`
- **placeholder_usage**: removed `interval_enabled`
- **project**: added `description`, `export_error`, `export_id`, `export_status`, `export_url`, `exported`, `exported_at`, `external_deal_id`, `memberships`, `project_milestones`
- **project_relevancy_report**: added `attendee_email`, `meeting_history_period_end`, `meeting_history_period_start`, `meeting_history_score`, `project_visible`, `title`, `title_score`
- **proposal**: removed `proposal_version_two`; added `approval_requested_at`, `approval_requester`, `approval_status`, `approval_statuses`, `approved_at`, `approved_by_actual_approver_id`, `approved_for_assigned_approver_id`, `attachment`, `awaiting_approval_from_approver_id`, `identity_confirmation_enabled`, `identity_confirmed_at`, `rejected_at`, `rejected_reason`, `rejecter`, `scenario`, `source`
- **proposal_report**: added `approval_requested_at`, `approval_requested_at_period`, `approval_status`, `approved_at`, `approved_at_period`
- **resource_request**: added `job_role_id`
- **resource_request_report**: added `time`
- **role**: added `access_description`, `best_when_description`
- **search_quick_result**: added `matches_position`
- **service**: added `billing_method`, `overtime_time`
- **service_report**: added `overtime_time`, `total_overtime_time`
- **subsidiary**: added `avatar_url`
- **survey**: added `anonymous_responses`, `memberships`
- **task**: removed `board_id`, `board_name`, `board_position`, `board_status`; added `left_to_schedule_time`, `net_unplanned_time`, `placeholder_usages`, `subtasks`, `task_dependencies`, `todos`
- **task_report**: removed `board_name`, `board_status`
- **template**: added `filter`
- **time_entry**: added `approved_by_actual_approver_id`, `approved_for_assigned_approver_id`
- **time_entry_report**: added `approved_by_actual_approver_id`, `approved_for_assigned_approver_id`, `billable_approved_time`, `designated_approver_report`, `total_billable_approved_time`
- **time_tracking_policy**: removed `note_mandatory`; added `description`, `overtime_cost_multiplier`, `overtime_enabled`
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
