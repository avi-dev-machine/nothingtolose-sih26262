import { Generated, ColumnType } from 'kysely';

export type RoleEnum =
  | 'INSTITUTION'
  | 'SCRUTINY_OFFICER'
  | 'REGIONAL_OFFICER'
  | 'EVC_MEMBER'
  | 'COMMITTEE_MEMBER'
  | 'BUREAU_OFFICER'
  | 'ADMIN';

export type ApplicationStateEnum =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_SCRUTINY'
  | 'DEFICIENCY_RAISED'
  | 'RESUBMITTED'
  | 'SCRUTINY_CLEARED'
  | 'EVC_REQUIRED'
  | 'EVC_SCHEDULED'
  | 'EVC_IN_PROGRESS'
  | 'EVC_COMPLETED'
  | 'COMMITTEE_REVIEW'
  | 'FINAL_DECISION'
  | 'APPROVED'
  | 'APPROVED_WITH_CONDITIONS'
  | 'REJECTED'
  | 'COMPLIANCE_REQUIRED';

export type WorkflowTrackEnum = 'A' | 'B' | 'C' | 'D';
export type ClockOwnerEnum = 'AICTE' | 'INSTITUTION';
export type DocumentStatusEnum = 'UPLOADED' | 'SCANNED_CLEAN' | 'QUARANTINED' | 'VERIFIED' | 'REJECTED';
export type DeficiencyStatusEnum = 'OPEN' | 'RESPONDED' | 'CLOSED' | 'WAIVED';
export type TaskStatusEnum = 'OPEN' | 'DONE' | 'OVERDUE' | 'CANCELLED';
export type EvcVisitStatusEnum = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type ComplianceStatusEnum = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'RENEWED' | 'WAIVED';
export type ComplianceSourceEnum = 'MANUAL' | 'AI_EXTRACTED';
export type NotificationStatusEnum = 'PENDING' | 'SENT' | 'FAILED' | 'READ';
export type AiSuggestionStatusEnum = 'PENDING' | 'ACCEPTED' | 'EDITED' | 'REJECTED';

// Tables
export interface RegionTable {
  id: Generated<string>;
  code: string;
  name: string;
  states?: any;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InstitutionTable {
  id: Generated<string>;
  aicte_id: string;
  code?: string;
  name: string;
  region_id: string;
  state: string;
  district: string;
  city?: string;
  pincode?: string;
  address: any;
  contact: any;
  status: Generated<string>;
  institution_type?: string;
  established_year?: number;
  contact_email?: string;
  contact_phone?: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface UserTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  role: RoleEnum | string;
  institution_id: string | null;
  region_id: string | null;
  full_name: string;
  phone: string | null;
  totp_secret_enc?: string | null;
  totp_secret?: string | null;
  totp_enabled?: Generated<boolean>;
  is_totp_enabled?: boolean;
  locale?: Generated<string>;
  is_active?: Generated<boolean>;
  failed_logins?: Generated<number>;
  locked_until?: Date | null;
  must_change_password?: Generated<boolean>;
  first_login_must_change_pwd: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RefreshTokenTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  family_id: Generated<string>;
  replaced_by_id?: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  user_agent: string | null;
  ip: string | null;
  ip_address?: string | null;
  created_at: Generated<Date>;
}

export interface PermissionTable {
  id: Generated<string>;
  key: string;
  description: string | null;
  created_at: Generated<Date>;
}

export interface RolePermissionTable {
  role: RoleEnum | string;
  permission_key: string;
}

export interface WorkflowDefinitionTable {
  id: Generated<string>;
  track: WorkflowTrackEnum | string;
  version: Generated<number>;
  active: Generated<boolean>;
  definition: any;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface WorkflowTransitionTable {
  id: Generated<string>;
  definition_id: string;
  from_state: ApplicationStateEnum | string;
  to_state: ApplicationStateEnum | string;
  action: string;
  allowed_roles: (RoleEnum | string)[];
  guards: any;
  requires_reason: Generated<boolean>;
  requires_clause: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface SlaPolicyTable {
  id: Generated<string>;
  stage_state: ApplicationStateEnum | string;
  state?: string;
  track?: string;
  application_type: Generated<string>;
  owner_kind: ClockOwnerEnum | string;
  duration_hours: number;
  target_hours?: number;
  critical_hours?: number;
  reminder_pct: Generated<number>;
  grace_hours: Generated<number>;
  business_hours_only: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}


export interface EscalationRuleTable {
  id: Generated<string>;
  owner_kind: ClockOwnerEnum | string;
  level: number;
  trigger_pct: number;
  extra_hours: Generated<number>;
  notify_roles: (RoleEnum | string)[];
  channels: Generated<string[]>;
  action: string;
  created_at: Generated<Date>;
}

export interface BusinessCalendarTable {
  date: Date;
  is_working: Generated<boolean>;
  note: string | null;
}

export interface DocumentTypeTable {
  id: Generated<string>;
  code: string;
  name: string;
  required_for: Generated<any>;
  has_expiry: Generated<boolean>;
  default_alert_days: Generated<number[]>;
  created_at: Generated<Date>;
}

export interface AphClauseTable {
  id: Generated<string>;
  handbook_version: Generated<string>;
  section_no: string;
  clause_number?: string;
  chapter?: string;
  title: string;
  body: string;
  content?: string;
  embedding: string | null;
  keywords?: any;
  tsv: ColumnType<string, never, never>;
  created_at: Generated<Date>;
}

export interface RuleDefinitionTable {
  id: Generated<string>;
  clause_id: string | null;
  key: string;
  expression: any;
  severity: Generated<string>;
  active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ApplicationTable {
  id: Generated<string>;
  ref_no: Generated<string>;
  application_number: Generated<string>;
  institution_id: string;
  region_id: string;
  type: Generated<string>;
  track: WorkflowTrackEnum | string;
  state: Generated<ApplicationStateEnum | string>;
  state_entered_at: Generated<Date>;
  current_owner_id: string | null;
  current_owner_role: Generated<RoleEnum | string>;
  due_at: Date | null;
  priority: Generated<string>;
  risk_score: Generated<number>;
  risk_level: Generated<string>;
  submitted_at: Date | null;
  closed_at: Date | null;
  version: Generated<number>;
  academic_year: Generated<string>;
  programme: Generated<string>;
  courses_data?: any;
  metadata?: any;
  assigned_scrutiny_officer_id?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ApplicationFormTable {
  id: Generated<string>;
  application_id: string;
  version: Generated<number>;
  data: Generated<any>;
  valid: Generated<boolean>;
  validation_report: Generated<any>;
  created_at: Generated<Date>;
}

export interface DocumentTable {
  id: Generated<string>;
  application_id?: string | null;
  institution_id?: string | null;
  document_type_id?: string | null;
  doc_type_id?: string | null;
  storage_key?: string;
  storage_uri?: string;
  file_name?: string;
  original_name?: string;
  mime?: string;
  mime_type?: string;
  size?: number;
  file_size?: number;
  sha256?: string;
  sha256_checksum?: string;
  s3_bucket?: string;
  s3_key?: string;
  classification?: string | null;
  extracted_metadata?: any;
  ocr_text?: string | null;
  version: Generated<number>;
  supersedes_id?: string | null;
  is_duplicate?: Generated<boolean>;
  duplicate_of_id?: string | null;
  status: Generated<DocumentStatusEnum | string>;
  uploaded_by?: string;
  verified_by?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DeficiencyTable {
  id: Generated<string>;
  application_id: string;
  clause_id?: string | null;
  clause_title?: string;
  category: string;
  remarks?: string;
  description?: string;
  required_document_type_id?: string | null;
  required_documents?: any;
  due_at?: Date;
  deadline_at?: Date;
  status: Generated<DeficiencyStatusEnum | string>;
  raised_by?: string | null;
  raised_at?: Generated<Date>;
  response_note?: string | null;
  response_documents?: any;
  responded_at?: Date | null;
  closed_by?: string | null;
  closed_at?: Date | null;
  resolved_by?: string | null;
  resolved_at?: Date | null;
  resolution_remarks?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DeficiencyResponseTable {
  id: Generated<string>;
  deficiency_id: string;
  response_text: string;
  document_ids: Generated<string[]>;
  responded_by: string;
  responded_at: Generated<Date>;
}

export interface TaskTable {
  id: Generated<string>;
  application_id: string;
  kind: string;
  assignee_id: string;
  assignee_role: RoleEnum | string;
  state_ref: ApplicationStateEnum | string;
  due_at: Date;
  status: Generated<TaskStatusEnum | string>;
  sla_policy_id?: string | null;
  reminded_pct?: Generated<number[]>;
  escalation_level?: Generated<number>;
  created_at: Generated<Date>;
  completed_at?: Date | null;
}

export interface ReassignmentTable {
  id: Generated<string>;
  task_id: string;
  from_user: string;
  to_user: string;
  reason: string;
  by_user: string;
  at: Generated<Date>;
}

export interface ClockEventTable {
  id: Generated<string>;
  application_id: string;
  clock?: ClockOwnerEnum | string;
  active_clock?: string;
  event_type?: string;
  started_at?: Generated<Date>;
  stopped_at?: Date | null;
  holder_user_id?: string | null;
  holder_role?: RoleEnum | string;
  state_ref?: ApplicationStateEnum | string;
  reason?: string | null;
  stop_reason?: string | null;
  timestamp: Generated<Date>;
  trigger_source?: string;
  remarks?: string | null;
  created_at: Generated<Date>;
}

export interface EvcVisitTable {
  id: Generated<string>;
  application_id: string;
  scheduled_at?: Date;
  scheduled_date?: Date;
  visit_due_at?: Date;
  report_due_at?: Date;
  lead_member_id?: string;
  members?: any;
  status: Generated<EvcVisitStatusEnum | string>;
  location?: string;
  report_document_id?: string | null;
  geo_latitude?: number | null;
  geo_longitude?: number | null;
  geo_accuracy_meters?: number | null;
  checklist_results?: any;
  findings?: Generated<any>;
  recommendation?: string | null;
  justification?: string | null;
  photo_document_ids?: any;
  report_submitted_at?: Date | null;
  special_instructions?: string | null;
  completed_at?: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface EvcMemberTable {
  visit_id: string;
  user_id: string;
  role_in_visit: Generated<string>;
  accepted_at: Date | null;
}

export interface EvcFindingTable {
  id: Generated<string>;
  visit_id: string;
  section: string;
  observation: string;
  compliant: Generated<boolean>;
  clause_id: string | null;
  photo_document_ids: Generated<string[]>;
  geo: any | null;
  created_at: Generated<Date>;
}

export interface ApprovalConditionTable {
  id: Generated<string>;
  application_id: string;
  text: string;
  due_date: Date;
  status: Generated<string>;
  compliance_item_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ComplianceItemTable {
  id: Generated<string>;
  institution_id: string;
  category: Generated<string>;
  title: Generated<string>;
  issuing_authority: Generated<string>;
  reference_number: Generated<string>;
  application_id?: string | null;
  document_id?: string | null;
  document_type_id?: string;
  issue_date: Generated<Date>;
  issued_date: Generated<Date>;
  expiry_date: Date;
  status: Generated<ComplianceStatusEnum | string>;
  verification_status?: Generated<string>;
  verified_by?: string | null;
  source?: Generated<ComplianceSourceEnum | string>;
  extraction_confidence?: number | null;
  next_alert_at?: Date | null;
  alert_before_days: Generated<number>;
  remarks?: string | null;
  renewal_document_id?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ComplianceAlertTable {
  id: Generated<string>;
  item_id: string;
  threshold_days: number;
  sent_at: Generated<Date>;
  notification_id: string | null;
}

export interface NotificationTemplateTable {
  id: Generated<string>;
  key: string;
  locale: Generated<string>;
  subject: string;
  body_md: string;
  created_at: Generated<Date>;
}

export interface NotificationPrefTable {
  user_id: string;
  channel: string;
  event_key: string;
  enabled: Generated<boolean>;
}

export interface NotificationTable {
  id: Generated<string>;
  user_id?: string;
  recipient_id?: string | null;
  recipient_role?: string | null;
  channel: Generated<string>;
  template_key?: string;
  title?: string;
  message?: string;
  payload?: Generated<any>;
  dedupe_key?: string;
  status: Generated<NotificationStatusEnum | string>;
  attempts?: Generated<number>;
  read?: boolean;
  sent_at?: Date | null;
  read_at?: Date | null;
  error?: string | null;
  metadata?: any;
  created_at: Generated<Date>;
}

export interface DigestTable {
  id: Generated<string>;
  user_id: string;
  date: Date;
  notification_id: string;
  created_at: Generated<Date>;
}

export interface AiSuggestionTable {
  id: Generated<string>;
  kind?: string;
  entity_type?: string;
  entity_id?: string;
  application_id?: string | null;
  document_id?: string | null;
  suggestion_type?: string;
  output?: any;
  payload?: any;
  confidence?: number;
  confidence_score?: number;
  model?: string;
  model_name?: string;
  model_version?: string;
  status?: Generated<AiSuggestionStatusEnum | string>;
  is_overridden?: boolean;
  overridden_by?: string | null;
  override_reason?: string | null;
  decided_by?: string | null;
  decided_at?: Date | null;
  created_at: Generated<Date>;
}

export interface DocumentExtractionTable {
  id: Generated<string>;
  document_id: string;
  ocr_text: string | null;
  doc_type_pred: string | null;
  doc_type_conf: number | null;
  dates: Generated<any>;
  needs_manual_review: Generated<boolean>;
  engine: Generated<string>;
  created_at: Generated<Date>;
}

export interface RiskScoreTable {
  id: Generated<string>;
  application_id: string;
  score: number;
  level: string;
  factors: Generated<any>;
  model_version: string;
  computed_at: Generated<Date>;
}

export interface RagQueryTable {
  id: Generated<string>;
  user_id: string;
  question: string;
  answer: string;
  citations: Generated<any>;
  retrieval_score: number | null;
  created_at: Generated<Date>;
}

export interface AuditLogTable {
  seq: Generated<number>;
  id: Generated<string>;
  ts: Generated<Date>;
  actor_id: string;
  actor_role: string;
  actor_ip: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  application_id: string | null;
  old_state: string | null;
  new_state: string | null;
  payload: Generated<any>;
  ai_assisted: Generated<boolean>;
  prev_hash: Generated<Buffer>;
  hash: Generated<Buffer>;
}

export interface Database {
  regions: RegionTable;
  institutions: InstitutionTable;
  users: UserTable;
  refresh_tokens: RefreshTokenTable;
  permissions: PermissionTable;
  role_permissions: RolePermissionTable;
  workflow_definitions: WorkflowDefinitionTable;
  workflow_transitions: WorkflowTransitionTable;
  workflow_rules: any;
  outbox: any;
  outbox_events: any;
  sla_policies: SlaPolicyTable;
  sla_configs: any;
  escalation_rules: EscalationRuleTable;
  business_calendar: BusinessCalendarTable;
  document_types: DocumentTypeTable;
  aph_clauses: AphClauseTable;
  rule_definitions: RuleDefinitionTable;
  applications: ApplicationTable;
  application_forms: ApplicationFormTable;
  documents: DocumentTable;
  deficiencies: DeficiencyTable;
  deficiency_responses: DeficiencyResponseTable;
  tasks: TaskTable;
  task_assignments: any;
  reassignments: ReassignmentTable;
  clock_events: ClockEventTable;
  evc_visits: EvcVisitTable;
  evc_members: EvcMemberTable;
  evc_findings: EvcFindingTable;
  approval_conditions: ApprovalConditionTable;
  compliance_items: ComplianceItemTable;
  compliance_records: ComplianceItemTable;
  compliance_alerts: ComplianceAlertTable;
  notification_templates: NotificationTemplateTable;
  notification_prefs: NotificationPrefTable;
  notifications: NotificationTable;
  digests: DigestTable;
  ai_suggestions: AiSuggestionTable;
  document_extractions: DocumentExtractionTable;
  risk_scores: RiskScoreTable;
  rag_queries: RagQueryTable;
  audit_log: AuditLogTable;
  audit_ledger: any;
  committee_decisions: any;
}
