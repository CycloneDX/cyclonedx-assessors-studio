import { Generated, Insertable, Selectable, Updateable } from 'kysely';

export interface Organization {
  id: Generated<string>;
  name: string;
  country?: string | null;
  region?: string | null;
  locality?: string | null;
  post_office_box_number?: string | null;
  postal_code?: string | null;
  street_address?: string | null;
  website?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Contact {
  id: Generated<string>;
  name: string;
  email: string;
  phone?: string | null;
  organization_id?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface License {
  id: Generated<string>;
  name: string;
  text?: string | null;
  url?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Standard {
  id: Generated<string>;
  identifier: string;
  name: string;
  description?: string | null;
  owner?: string | null;
  version?: string | null;
  license_id?: string | null;
  state: 'draft' | 'in_review' | 'published' | 'retired';
  authored_by?: string | null;
  approved_by?: string | null;
  approved_at?: Date | null;
  submitted_at?: Date | null;
  is_imported: boolean;
  source_json?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Requirement {
  id: Generated<string>;
  identifier: string;
  name: string;
  parent_id?: string | null;
  description?: string | null;
  open_cre?: string | null;
  standard_id: string;
  // Original CycloneDX bom-ref captured at standards import time.
  // Null for legacy rows or hand-typed standards; the writer
  // synthesizes a fallback in that case.
  imported_bom_ref?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Level {
  id: Generated<string>;
  identifier: string;
  title?: string | null;
  description?: string | null;
  standard_id: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface LevelRequirement {
  level_id: string;
  requirement_id: string;
  created_at?: Generated<Date>;
}

export interface Project {
  id: Generated<string>;
  name: string;
  description?: string | null;
  state: 'new' | 'in_progress' | 'on_hold' | 'complete' | 'operational' | 'retired';
  start_date?: Date | null;
  due_date?: Date | null;
  archived_at?: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ProjectStandard {
  project_id: string;
  standard_id: string;
  created_at: Generated<Date>;
}

export interface Permission {
  id: Generated<string>;
  key: string;
  name: string;
  description?: string | null;
  category: string;
  created_at: Generated<Date>;
}

export interface Role {
  id: Generated<string>;
  key: string;
  name: string;
  description?: string | null;
  is_system: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RolePermission {
  role_id: string;
  permission_id: string;
  created_at: Generated<Date>;
}

export interface AppUser {
  id: Generated<string>;
  username: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: 'admin' | 'assessor' | 'assessee' | 'standards_manager' | 'standards_approver';
  role_id?: string | null;
  is_active: boolean;
  has_completed_onboarding: boolean;
  slack_user_id?: string | null;
  teams_user_id?: string | null;
  mattermost_username?: string | null;
  email_notifications?: boolean;
  last_login_at?: Date | null;
  // Account lockout: counter increments on every failed password verification
  // and resets to zero on any successful login. A non-null locked_until that
  // is in the future indicates an active lockout window.
  failed_login_count?: number;
  locked_until?: Date | null;
  last_failed_login_at?: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface NotificationRule {
  id: Generated<string>;
  name: string;
  scope: 'system' | 'user';
  user_id?: string | null;
  channel: 'in_app' | 'email' | 'slack' | 'teams' | 'mattermost' | 'webhook';
  event_types: string[] | null; // JSONB: string[]
  // biome-ignore lint/suspicious/noExplicitAny: JSONB column stores dynamic filter configuration
  filters: Record<string, unknown>;
  // biome-ignore lint/suspicious/noExplicitAny: JSONB column stores channel-specific configuration
  destination: Record<string, unknown>;
  enabled: boolean;
  created_by?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Assessment {
  id: Generated<string>;
  deleted_at: Generated<Date | null>;
  title: string;
  description?: string | null;
  project_id?: string | null;
  entity_id?: string | null;
  standard_id?: string | null;
  conformance_score?: number | null;
  due_date?: Date | null;
  start_date?: Date | null;
  end_date?: Date | null;
  state: 'new' | 'pending' | 'in_progress' | 'on_hold' | 'cancelled' | 'complete' | 'archived';
  assessment_type: 'standards' | 'targeted' | 'tasks';
  task_label?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AssessmentAssessor {
  assessment_id: string;
  user_id: string;
  created_at: Generated<Date>;
}

export interface AssessmentAssessee {
  assessment_id: string;
  user_id: string;
  created_at: Generated<Date>;
}

export interface AssessmentRequirement {
  id: Generated<string>;
  assessment_id: string;
  requirement_id: string;
  evidence_id?: string | null;
  result?: 'yes' | 'no' | 'partial' | 'not_applicable' | null;
  rationale?: string | null;
  owner?: string | null;
  owner_email?: string | null;
  owner_role?: string | null;
  oe_entity?: string | null;
  business_unit?: string | null;
  region?: string | null;
  assessed_by?: string | null;
  assessment_date?: Date | null;
  next_review_date?: Date | null;
  conformance_score?: number | null;
  conformance_rationale?: string | null;
  confidence_score?: number | null;
  confidence_rationale?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Evidence {
  id: Generated<string>;
  deleted_at: Generated<Date | null>;
  display_id: Generated<number>;
  bom_ref?: string | null;
  name: string;
  property_name?: string | null;
  description?: string | null;
  state: 'in_review' | 'in_progress' | 'claimed' | 'expired';
  author_id: string;
  reviewer_id?: string | null;
  expires_on?: Date | null;
  is_counter_evidence: boolean;
  classification?: string | null;
  owner?: string | null;
  type?: 'proof' | 'counter_evidence' | 'mitigation_strategy' | null;
  evidence_notes?: string | null;
  geo_latitude?: number | null;
  geo_longitude?: number | null;
  geo_label?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface EvidenceNote {
  id: Generated<string>;
  evidence_id: string;
  user_id: string;
  content: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface EvidenceAttachment {
  id: Generated<string>;
  evidence_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  storage_path?: string | null;
  binary_content?: Buffer | null;
  content_hash?: string | null;
  storage_provider: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Claim {
  id: Generated<string>;
  deleted_at: Generated<Date | null>;
  display_id: Generated<number>;
  bom_ref?: string | null;
  name: string;
  target: string;
  target_entity_id?: string | null;
  predicate: string;
  reasoning?: string | null;
  is_counter_claim: boolean;
  attestation_id?: string | null;
  status: string;
  claim_type?: string | null;
  confidence?: string | null;
  project_name?: string | null;
  project_requirement?: string | null;
  framework?: string | null;
  assessor?: string | null;
  claim_date?: Date | null;
  work_notes?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ClaimEvidence {
  claim_id: string;
  evidence_id: string;
  created_at: Generated<Date>;
}

export interface ClaimCounterEvidence {
  claim_id: string;
  evidence_id: string;
  created_at: Generated<Date>;
}

export interface ClaimMitigationStrategy {
  claim_id: string;
  evidence_id: string;
  created_at: Generated<Date>;
}

export interface Attestation {
  id: Generated<string>;
  summary?: string | null;
  assessment_id: string;
  signatory_id?: string | null;
  assessor_id?: string | null;
  // PR3.6: signature material (signed_at, signature_type, signed_by,
  // signed_name, signature_image_data, signature_ip, signature_user_agent,
  // signature_jurisdiction, signature_legal_intent, signature_algorithm,
  // signature_value, public_key_pem, certificate_chain,
  // canonical_payload_hash, rescinded_at, rescinded_by, rescind_reason)
  // was dropped from the attestation table. Signing now lives on the
  // assessment-scoped affirmation (see Affirmation below) and cascades
  // through affirmation_signatory slots. Retention lock keys off
  // affirmation.sealed_at + terminal assessment state. See
  // utils/retention.ts.
  //
  // CycloneDX 1.7 brings a per-attestation `signature` property
  // (declarations.attestations[].signature) back into scope as a JSF
  // envelope on each attestation row. This is distinct from the
  // affirmation-scoped seal: the assessor signs each attestation
  // they assert, and that envelope is emitted verbatim by the
  // exporter.
  signature_json?: unknown;
  signed_at?: Date | null;
  signature_canonical_hash?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AttestationRequirement {
  id: Generated<string>;
  attestation_id: string;
  requirement_id: string;
  conformance_score: number;
  conformance_rationale: string;
  confidence_score?: number | null;
  confidence_rationale?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AttestationRequirementMitigation {
  attestation_requirement_id: string;
  evidence_id: string;
  description?: string | null;
  target_completion?: Date | string | null;
  created_at: Generated<Date>;
}

export interface Signatory {
  id: Generated<string>;
  name: string;
  role?: string | null;
  organization_id?: string | null;
  external_reference_type?: string | null;
  external_reference_url?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/**
 * Personal signature inventory. The payload_encrypted column is a
 * base64-encoded envelope (produced by encryption.ts) that decrypts
 * into a JSON document whose shape depends on signature_type:
 *
 *   electronic: { signedName, jurisdiction?, legalIntent?, signatureImageData? }
 *   digital:    { algorithm, publicKeyPem, certificateChain? }
 *
 * No private-key material is ever stored server-side. For digital
 * signatures the user supplies the signature value at sign time,
 * either by pasting or by uploading a file produced by their local
 * signing tool. Future backend_type values ('hsm', 'signing_server')
 * will store connection metadata alongside the public material.
 */
export interface UserSignature {
  id: Generated<string>;
  user_id: string;
  label: string;
  signature_type: 'electronic' | 'digital';
  signature_format?: 'jsf' | 'x509' | null;
  backend_type: 'local' | 'hsm' | 'signing_server';
  payload_encrypted: string;
  key_fingerprint?: string | null;
  // Optional inline signature image stored via the storage provider
  // abstraction. Either binary_content (database provider) or
  // storage_path (S3 provider) is set, never both. Mirrors the
  // evidence_attachment shape so the same upload code paths apply.
  signature_image_filename?: string | null;
  signature_image_content_type?: string | null;
  signature_image_size_bytes?: number | null;
  signature_image_storage_path?: string | null;
  signature_image_binary_content?: Buffer | null;
  signature_image_content_hash?: string | null;
  signature_image_storage_provider?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Affirmation {
  id: Generated<string>;
  statement: string;
  project_id?: string | null;
  entity_id?: string | null;
  assessment_id?: string | null;
  sealed_at?: Date | null;
  sealed_by?: string | null;
  canonical_hash?: string | null;
  declarations_signature_json?: unknown;
  document_signature_json?: unknown;
  platform_key_fingerprint?: string | null;
  rescinded_at?: Date | null;
  rescinded_by?: string | null;
  rescind_reason?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AffirmationSignatory {
  id: Generated<string>;
  affirmation_id: string;
  required_title: string;
  required_user_id?: string | null;
  signatory_id?: string | null;
  signature_json?: unknown;
  canonical_hash?: string | null;
  signed_at?: Date | null;
  signed_by?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PlatformSigningKey {
  id: Generated<string>;
  fingerprint: string;
  algorithm: string;
  public_key_pem: string;
  private_key_encrypted: string;
  is_active: boolean;
  rotated_at?: Date | null;
  rotated_by?: string | null;
  created_at: Generated<Date>;
}

export interface Tag {
  id: Generated<string>;
  name: string;
  color: string;
  created_at: Generated<Date>;
}

export interface ProjectTag {
  project_id: string;
  tag_id: string;
  created_at: Generated<Date>;
}

export interface AssessmentTag {
  assessment_id: string;
  tag_id: string;
  created_at: Generated<Date>;
}

export interface EvidenceTag {
  evidence_id: string;
  tag_id: string;
  created_at: Generated<Date>;
}

export interface AssessmentRequirementEvidence {
  assessment_requirement_id: string;
  evidence_id: string;
  created_at: Generated<Date>;
}

export interface AssessmentEvidence {
  assessment_id: string;
  evidence_id: string;
  created_at: Generated<Date>;
}

export interface WorkNote {
  id: Generated<string>;
  assessment_id: string;
  user_id: string;
  content: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AuditLog {
  id: Generated<string>;
  entity_type: string;
  entity_id: string;
  action: 'create' | 'create_for_other' | 'update' | 'delete' | 'state_change' | 'link' | 'unlink' | 'authz_denied' | 'config_change';
  // Nullable so system-originated events (e.g. F15 startup config drift)
  // can be recorded without a user context. Application code with an
  // authenticated principal should always populate this.
  user_id: string | null;
  // biome-ignore lint/suspicious/noExplicitAny: JSONB column stores dynamic change records
  changes?: Record<string, unknown>;
  created_at: Generated<Date>;
}

export interface Notification {
  id: Generated<string>;
  user_id: string;
  type: string;
  title: string;
  message: string;
  link?: string | null;
  is_read: boolean;
  created_at: Generated<Date>;
}

export interface ApiKey {
  id: Generated<string>;
  name: string;
  prefix: string;
  key_hash: string;
  user_id: string;
  expires_at?: Date | null;
  last_used_at?: Date | null;
  created_at: Generated<Date>;
}

export interface Session {
  id: Generated<string>;
  user_id: string;
  ip_address?: string | null;
  user_agent?: string | null;
  expires_at: Date;
  created_at: Generated<Date>;
}

export interface UserInvite {
  id: Generated<string>;
  token_hash: string;
  email?: string | null;
  intended_role: 'admin' | 'assessor' | 'assessee' | 'standards_manager' | 'standards_approver';
  created_by?: string | null;
  expires_at: Date;
  consumed_at?: Date | null;
  consumed_by?: string | null;
  revoked_at?: Date | null;
  created_at: Generated<Date>;
}

export interface PasswordResetToken {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  consumed_at?: Date | null;
  requested_ip?: string | null;
  created_at: Generated<Date>;
}

export interface Entity {
  id: Generated<string>;
  deleted_at: Generated<Date | null>;
  name: string;
  description?: string | null;
  entity_type: 'organization' | 'business_unit' | 'team' | 'product' | 'product_version' | 'component' | 'service' | 'project';
  state: 'active' | 'inactive' | 'archived';
  bom_ref?: string | null;
  country?: string | null;
  region?: string | null;
  locality?: string | null;
  timezone?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface EntityRelationship {
  id: Generated<string>;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: 'owns' | 'supplies' | 'depends_on' | 'governs' | 'contains' | 'consumes' | 'assesses' | 'produces';
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface EntityTag {
  entity_id: string;
  tag_id: string;
  created_at: Generated<Date>;
}

export interface EntityStandard {
  entity_id: string;
  standard_id: string;
  created_at: Generated<Date>;
}

export interface CompliancePolicy {
  id: Generated<string>;
  entity_id: string;
  standard_id: string;
  description?: string | null;
  is_inherited: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Assessor {
  id: Generated<string>;
  bom_ref: string;
  third_party: boolean;
  entity_id?: string | null;
  user_id?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AttestationRequirementClaim {
  attestation_requirement_id: string;
  claim_id: string;
  created_at: Generated<Date>;
}

export interface AttestationRequirementCounterClaim {
  attestation_requirement_id: string;
  claim_id: string;
  created_at: Generated<Date>;
}

export interface ClaimExternalReference {
  id: Generated<string>;
  claim_id: string;
  type: string;
  url: string;
  comment?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Webhook {
  id: Generated<string>;
  name: string;
  url: string;
  secret: string;
  event_types: string[];
  is_active: Generated<boolean>;
  consecutive_failures: Generated<number>;
  created_by?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface WebhookDelivery {
  id: Generated<string>;
  webhook_id: string;
  event_id: string;
  event_type: string;
  status: Generated<string>;
  http_status?: number | null;
  attempt: Generated<number>;
  next_retry_at?: Date | null;
  // biome-ignore lint/suspicious/noExplicitAny: JSONB column stores webhook request payload
  request_body?: Record<string, unknown> | null;
  response_body?: string | null;
  error_message?: string | null;
  delivered_at?: Date | null;
  created_at: Generated<Date>;
}

export interface ChatIntegration {
  id: Generated<string>;
  name: string;
  platform: 'slack' | 'teams' | 'mattermost';
  webhook_url: string;
  event_categories: string;
  channel_name?: string | null;
  is_active: Generated<boolean>;
  consecutive_failures: Generated<number>;
  created_by?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ChatDelivery {
  id: Generated<string>;
  integration_id: string;
  event_id: string;
  event_type: string;
  status: Generated<string>;
  http_status?: number | null;
  attempt: Generated<number>;
  next_retry_at?: Date | null;
  error_message?: string | null;
  delivered_at?: Date | null;
  created_at: Generated<Date>;
}

export interface EncryptionKeyVersion {
  version: number;
  salt: string;
  is_active: boolean;
  created_at: Generated<Date>;
  retired_at?: Date | null;
}

export interface AppConfig {
  key: string;
  value: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Mitigation {
  id: Generated<string>;
  deleted_at: Generated<Date | null>;
  display_id: Generated<number>;
  mitigation_id?: string | null;
  title: string;
  type: string;
  category?: string | null;
  priority: string;
  status: string;
  effectiveness?: string | null;
  description?: string | null;
  owner?: string | null;
  notes?: string | null;
  team?: string | null;
  reviewer?: string | null;
  linked_assessment?: string | null;
  target_date?: Date | string | null;
  completion_date?: Date | string | null;
  verified_by?: string | null;
  effectiveness_rationale?: string | null;
  created_by?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface MitigationClaim {
  mitigation_id: string;
  claim_id: string;
  created_at: Generated<Date>;
}

export interface MitigationEvidence {
  mitigation_id: string;
  evidence_id: string;
  created_at: Generated<Date>;
}

export interface ScheduledAssessment {
  id: Generated<string>;
  title: string;
  description?: string | null;
  project_id?: string | null;
  assessor_id?: string | null;
  standard_id?: string | null;
  assessment_id?: string | null;
  scheduled_date: Date;
  due_date?: Date | null;
  recurrence: 'none' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  status: 'scheduled' | 'in_progress' | 'on_hold' | 'complete' | 'failed' | 'warning';
  notes?: string | null;
  created_by?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Database {
  permission: Selectable<Permission>;
  permission_insert: Insertable<Permission>;

  role: Selectable<Role>;
  role_insert: Insertable<Role>;
  role_update: Updateable<Role>;

  role_permission: Selectable<RolePermission>;
  role_permission_insert: Insertable<RolePermission>;

  organization: Selectable<Organization>;
  organization_insert: Insertable<Organization>;
  organization_update: Updateable<Organization>;

  contact: Selectable<Contact>;
  contact_insert: Insertable<Contact>;
  contact_update: Updateable<Contact>;

  license: Selectable<License>;
  license_insert: Insertable<License>;
  license_update: Updateable<License>;

  standard: Selectable<Standard>;
  standard_insert: Insertable<Standard>;
  standard_update: Updateable<Standard>;

  requirement: Selectable<Requirement>;
  requirement_insert: Insertable<Requirement>;
  requirement_update: Updateable<Requirement>;

  level: Selectable<Level>;
  level_insert: Insertable<Level>;
  level_update: Updateable<Level>;

  level_requirement: Selectable<LevelRequirement>;
  level_requirement_insert: Insertable<LevelRequirement>;

  project: Selectable<Project>;
  project_insert: Insertable<Project>;
  project_update: Updateable<Project>;

  project_standard: Selectable<ProjectStandard>;
  project_standard_insert: Insertable<ProjectStandard>;

  app_user: Selectable<AppUser>;
  app_user_insert: Insertable<AppUser>;
  app_user_update: Updateable<AppUser>;

  assessment: Selectable<Assessment>;
  assessment_insert: Insertable<Assessment>;
  assessment_update: Updateable<Assessment>;

  // Soft-delete: the public name above is a filtered VIEW; *_raw is the
  // physical table. Restore (set deleted_at=NULL) and purge (hard DELETE of
  // rows past retention) target *_raw because the view hides those rows.
  assessment_raw: Selectable<Assessment>;
  assessment_raw_insert: Insertable<Assessment>;
  assessment_raw_update: Updateable<Assessment>;

  assessment_assessor: Selectable<AssessmentAssessor>;
  assessment_assessor_insert: Insertable<AssessmentAssessor>;

  assessment_assessee: Selectable<AssessmentAssessee>;
  assessment_assessee_insert: Insertable<AssessmentAssessee>;

  assessment_requirement: Selectable<AssessmentRequirement>;
  assessment_requirement_insert: Insertable<AssessmentRequirement>;
  assessment_requirement_update: Updateable<AssessmentRequirement>;

  evidence: Selectable<Evidence>;
  evidence_insert: Insertable<Evidence>;
  evidence_update: Updateable<Evidence>;

  evidence_raw: Selectable<Evidence>;
  evidence_raw_insert: Insertable<Evidence>;
  evidence_raw_update: Updateable<Evidence>;

  evidence_note: Selectable<EvidenceNote>;
  evidence_note_insert: Insertable<EvidenceNote>;

  evidence_attachment: Selectable<EvidenceAttachment>;
  evidence_attachment_insert: Insertable<EvidenceAttachment>;

  claim: Selectable<Claim>;
  claim_insert: Insertable<Claim>;
  claim_update: Updateable<Claim>;

  claim_raw: Selectable<Claim>;
  claim_raw_insert: Insertable<Claim>;
  claim_raw_update: Updateable<Claim>;

  claim_evidence: Selectable<ClaimEvidence>;
  claim_evidence_insert: Insertable<ClaimEvidence>;

  claim_counter_evidence: Selectable<ClaimCounterEvidence>;
  claim_counter_evidence_insert: Insertable<ClaimCounterEvidence>;

  claim_mitigation_strategy: Selectable<ClaimMitigationStrategy>;
  claim_mitigation_strategy_insert: Insertable<ClaimMitigationStrategy>;

  attestation: Selectable<Attestation>;
  attestation_insert: Insertable<Attestation>;
  attestation_update: Updateable<Attestation>;

  attestation_requirement: Selectable<AttestationRequirement>;
  attestation_requirement_insert: Insertable<AttestationRequirement>;
  attestation_requirement_update: Updateable<AttestationRequirement>;

  attestation_requirement_mitigation: Selectable<AttestationRequirementMitigation>;
  attestation_requirement_mitigation_insert: Insertable<AttestationRequirementMitigation>;

  signatory: Selectable<Signatory>;
  signatory_insert: Insertable<Signatory>;
  signatory_update: Updateable<Signatory>;

  user_signature: Selectable<UserSignature>;
  user_signature_insert: Insertable<UserSignature>;
  user_signature_update: Updateable<UserSignature>;

  affirmation: Selectable<Affirmation>;
  affirmation_insert: Insertable<Affirmation>;
  affirmation_update: Updateable<Affirmation>;

  affirmation_signatory: Selectable<AffirmationSignatory>;
  affirmation_signatory_insert: Insertable<AffirmationSignatory>;
  affirmation_signatory_update: Updateable<AffirmationSignatory>;

  platform_signing_key: Selectable<PlatformSigningKey>;
  platform_signing_key_insert: Insertable<PlatformSigningKey>;
  platform_signing_key_update: Updateable<PlatformSigningKey>;

  tag: Selectable<Tag>;
  tag_insert: Insertable<Tag>;

  project_tag: Selectable<ProjectTag>;
  project_tag_insert: Insertable<ProjectTag>;

  assessment_tag: Selectable<AssessmentTag>;
  assessment_tag_insert: Insertable<AssessmentTag>;

  evidence_tag: Selectable<EvidenceTag>;
  evidence_tag_insert: Insertable<EvidenceTag>;

  assessment_requirement_evidence: Selectable<AssessmentRequirementEvidence>;
  assessment_requirement_evidence_insert: Insertable<AssessmentRequirementEvidence>;

  assessment_evidence: Selectable<AssessmentEvidence>;
  assessment_evidence_insert: Insertable<AssessmentEvidence>;

  work_note: Selectable<WorkNote>;
  work_note_insert: Insertable<WorkNote>;

  audit_log: Selectable<AuditLog>;
  audit_log_insert: Insertable<AuditLog>;

  notification: Selectable<Notification>;
  notification_insert: Insertable<Notification>;

  api_key: Selectable<ApiKey>;
  api_key_insert: Insertable<ApiKey>;
  api_key_update: Updateable<ApiKey>;

  session: Selectable<Session>;
  session_insert: Insertable<Session>;
  session_update: Updateable<Session>;

  password_reset_token: Selectable<PasswordResetToken>;
  password_reset_token_insert: Insertable<PasswordResetToken>;
  password_reset_token_update: Updateable<PasswordResetToken>;

  user_invite: Selectable<UserInvite>;
  user_invite_insert: Insertable<UserInvite>;
  user_invite_update: Updateable<UserInvite>;

  entity: Selectable<Entity>;
  entity_insert: Insertable<Entity>;
  entity_update: Updateable<Entity>;

  entity_raw: Selectable<Entity>;
  entity_raw_insert: Insertable<Entity>;
  entity_raw_update: Updateable<Entity>;

  entity_relationship: Selectable<EntityRelationship>;
  entity_relationship_insert: Insertable<EntityRelationship>;
  entity_relationship_update: Updateable<EntityRelationship>;

  entity_tag: Selectable<EntityTag>;
  entity_tag_insert: Insertable<EntityTag>;

  entity_standard: Selectable<EntityStandard>;
  entity_standard_insert: Insertable<EntityStandard>;

  compliance_policy: Selectable<CompliancePolicy>;
  compliance_policy_insert: Insertable<CompliancePolicy>;
  compliance_policy_update: Updateable<CompliancePolicy>;


  assessor: Selectable<Assessor>;
  assessor_insert: Insertable<Assessor>;
  assessor_update: Updateable<Assessor>;

  attestation_requirement_claim: Selectable<AttestationRequirementClaim>;
  attestation_requirement_claim_insert: Insertable<AttestationRequirementClaim>;

  attestation_requirement_counter_claim: Selectable<AttestationRequirementCounterClaim>;
  attestation_requirement_counter_claim_insert: Insertable<AttestationRequirementCounterClaim>;

  claim_external_reference: Selectable<ClaimExternalReference>;
  claim_external_reference_insert: Insertable<ClaimExternalReference>;
  claim_external_reference_update: Updateable<ClaimExternalReference>;

  webhook: Selectable<Webhook>;
  webhook_insert: Insertable<Webhook>;
  webhook_update: Updateable<Webhook>;

  webhook_delivery: Selectable<WebhookDelivery>;
  webhook_delivery_insert: Insertable<WebhookDelivery>;
  webhook_delivery_update: Updateable<WebhookDelivery>;

  chat_integration: Selectable<ChatIntegration>;
  chat_integration_insert: Insertable<ChatIntegration>;
  chat_integration_update: Updateable<ChatIntegration>;

  chat_delivery: Selectable<ChatDelivery>;
  chat_delivery_insert: Insertable<ChatDelivery>;
  chat_delivery_update: Updateable<ChatDelivery>;

  notification_rule: Selectable<NotificationRule>;
  notification_rule_insert: Insertable<NotificationRule>;
  notification_rule_update: Updateable<NotificationRule>;

  encryption_key_version: Selectable<EncryptionKeyVersion>;
  encryption_key_version_insert: Insertable<EncryptionKeyVersion>;
  encryption_key_version_update: Updateable<EncryptionKeyVersion>;

  app_config: Selectable<AppConfig>;
  app_config_insert: Insertable<AppConfig>;
  app_config_update: Updateable<AppConfig>;

  mitigation: Selectable<Mitigation>;
  mitigation_insert: Insertable<Mitigation>;
  mitigation_update: Updateable<Mitigation>;

  mitigation_raw: Selectable<Mitigation>;
  mitigation_raw_insert: Insertable<Mitigation>;
  mitigation_raw_update: Updateable<Mitigation>;

  mitigation_claim: Selectable<MitigationClaim>;
  mitigation_claim_insert: Insertable<MitigationClaim>;

  mitigation_evidence: Selectable<MitigationEvidence>;
  mitigation_evidence_insert: Insertable<MitigationEvidence>;

  scheduled_assessment: Selectable<ScheduledAssessment>;
  scheduled_assessment_insert: Insertable<ScheduledAssessment>;
  scheduled_assessment_update: Updateable<ScheduledAssessment>;
}
