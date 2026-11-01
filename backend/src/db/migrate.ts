import { initializeDatabase, closeDatabase, getDatabase } from './connection.js';
import { logger } from '../utils/logger.js';

// =====================================================================
// Consolidated initial schema.
// =====================================================================
//
// The application is alpha and there is no on disk data to preserve
// across versions. Every fresh install runs this single SQL block to
// stand up the full schema in its current shape. Tables are declared
// in dependency order so foreign keys can sit inline without any
// follow up ALTER TABLE statements. Columns reflect the latest
// design after all sprint level iterations and the PR3 affirmation
// cascade rework. CHECK constraints carry their final value sets.
//
// Permission and role rows are seeded by db/seed.ts on first run.
// This file does not insert any application data.
//
// Do not put a semicolon inside any -- comment. The runner at the
// bottom splits this template on the semicolon character and a
// commented out semicolon will slice the comment in half. Real SQL
// parsers ignore commented out semicolons but this tiny splitter
// does not.

export const SQL = `
-- =====================================================================
-- Authorization core
-- =====================================================================

CREATE TABLE IF NOT EXISTS permission (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS role (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS role_permission (
  role_id UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, permission_id)
);

-- =====================================================================
-- Reference tables (no domain dependencies)
-- =====================================================================

CREATE TABLE IF NOT EXISTS organization (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  country VARCHAR(255),
  region VARCHAR(255),
  locality VARCHAR(255),
  post_office_box_number VARCHAR(255),
  postal_code VARCHAR(20),
  street_address VARCHAR(255),
  website VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contact (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  organization_id UUID REFERENCES organization(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS license (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  text TEXT,
  url VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tag (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE CHECK(name = LOWER(name)),
  color VARCHAR(7) DEFAULT '#6366f1',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Entities are CycloneDX targets. Every assessable thing is an entity:
-- product, product_version, component, service, business_unit, team,
-- organization, or project. The hierarchy is expressed via
-- entity_relationship rows.
CREATE TABLE IF NOT EXISTS entity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  entity_type VARCHAR(50) NOT NULL CHECK(entity_type IN ('organization', 'business_unit', 'team', 'product', 'product_version', 'component', 'service', 'project')),
  state VARCHAR(50) NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'inactive', 'archived')),
  bom_ref VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_entity_type ON entity(entity_type);
CREATE INDEX IF NOT EXISTS idx_entity_state ON entity(state);

CREATE TABLE IF NOT EXISTS entity_relationship (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entity_id UUID NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  target_entity_id UUID NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  relationship_type VARCHAR(50) NOT NULL CHECK(relationship_type IN ('owns', 'supplies', 'depends_on', 'governs', 'contains', 'consumes', 'assesses', 'produces')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_entity_id, target_entity_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_entity_rel_source ON entity_relationship(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_rel_target ON entity_relationship(target_entity_id);

-- Encryption key versions. The active row holds the salt used to
-- derive the application data encryption key. Rotation writes a new
-- row and flips the previous one inactive.
CREATE TABLE IF NOT EXISTS encryption_key_version (
  version INTEGER PRIMARY KEY,
  salt TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  retired_at TIMESTAMP WITH TIME ZONE
);

-- Application configuration values persisted in the database.
-- Used for the auto generated JWT signing secret so first run works
-- with no environment configuration.
CREATE TABLE IF NOT EXISTS app_config (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- App users and the things that depend on them
-- =====================================================================
--
-- failed_login_count, locked_until, last_failed_login_at gate the
-- account lockout policy. failed_login_count resets to zero on a
-- successful authentication. locked_until is non null only while the
-- lockout window is active.
--
-- slack_user_id, teams_user_id, mattermost_username are direct
-- message destinations for the chat notification channels.
--
-- email_notifications is the user level opt out for the email channel.
-- has_completed_onboarding hides the first run welcome dialog.
CREATE TABLE IF NOT EXISTS app_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'assessee' CHECK(role IN ('admin', 'assessor', 'assessee', 'standards_manager', 'standards_approver')),
  role_id UUID REFERENCES role(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  has_completed_onboarding BOOLEAN NOT NULL DEFAULT FALSE,
  slack_user_id VARCHAR(64),
  teams_user_id VARCHAR(128),
  mattermost_username VARCHAR(64),
  email_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMP WITH TIME ZONE,
  last_failed_login_at TIMESTAMP WITH TIME ZONE,
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_user_username ON app_user(username);
CREATE INDEX IF NOT EXISTS idx_app_user_email ON app_user(email);

-- Sessions. Identity is carried by the signed JWT payload (sessionId
-- claim). The server looks up sessions by id only and stores no
-- token hash server side.
CREATE TABLE IF NOT EXISTS session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  ip_address VARCHAR(45),
  user_agent TEXT,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Single use invite tokens issued by an admin. The server stores only
-- the SHA-256 hash of the token. The plaintext is shown once at
-- issuance.
CREATE TABLE IF NOT EXISTS user_invite (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255),
  intended_role VARCHAR(50) NOT NULL DEFAULT 'assessee' CHECK(intended_role IN ('admin', 'assessor', 'assessee', 'standards_manager', 'standards_approver')),
  created_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  consumed_at TIMESTAMP WITH TIME ZONE,
  consumed_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  revoked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_invite_token_hash ON user_invite(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_invite_email ON user_invite(email);

-- Password reset tokens. Issued by POST /auth/forgot-password and
-- consumed by POST /auth/reset-password. The token plaintext is
-- delivered out of band (email) and never persisted in this table.
-- Only sha256 of the token is stored so a DB read cannot replay it.
CREATE TABLE IF NOT EXISTS password_reset_token (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  consumed_at TIMESTAMP WITH TIME ZONE,
  requested_ip VARCHAR(45),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_reset_token_hash ON password_reset_token(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_user_active ON password_reset_token(user_id) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS api_key (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  prefix VARCHAR(8) NOT NULL,
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  expires_at TIMESTAMP WITH TIME ZONE,
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_key_prefix ON api_key(prefix);
CREATE INDEX IF NOT EXISTS idx_api_key_user_id ON api_key(user_id);

-- =====================================================================
-- Standards, requirements, levels
-- =====================================================================
--
-- source_json carries the original or generated CycloneDX JSON so
-- export round trips stay deterministic. authored_by and approved_by
-- gate the draft to published state machine. is_imported flags rows
-- created via the import pipeline rather than authored in app.
CREATE TABLE IF NOT EXISTS standard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  owner VARCHAR(255),
  version VARCHAR(20),
  license_id UUID REFERENCES license(id) ON DELETE SET NULL,
  state VARCHAR(20) NOT NULL DEFAULT 'published' CHECK(state IN ('draft', 'in_review', 'published', 'retired')),
  authored_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  approved_at TIMESTAMP WITH TIME ZONE,
  submitted_at TIMESTAMP WITH TIME ZONE,
  is_imported BOOLEAN NOT NULL DEFAULT FALSE,
  source_json TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- imported_bom_ref preserves the original CycloneDX bom-ref from
-- imported standards on each requirement so the export round trip
-- stays lossless. The writer falls back to a synthesized
-- requirement-uuid bom-ref when this column is null.
CREATE TABLE IF NOT EXISTS requirement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier VARCHAR(255) NOT NULL,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES requirement(id) ON DELETE CASCADE,
  description TEXT,
  open_cre TEXT,
  imported_bom_ref TEXT,
  standard_id UUID NOT NULL REFERENCES standard(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(identifier, standard_id)
);

-- Compliance tiers within a standard, e.g. ASVS L1/L2/L3.
CREATE TABLE IF NOT EXISTS level (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier VARCHAR(255) NOT NULL,
  title VARCHAR(255),
  description TEXT,
  standard_id UUID NOT NULL REFERENCES standard(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(identifier, standard_id)
);

CREATE TABLE IF NOT EXISTS level_requirement (
  level_id UUID NOT NULL REFERENCES level(id) ON DELETE CASCADE,
  requirement_id UUID NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (level_id, requirement_id)
);

-- =====================================================================
-- Projects
-- =====================================================================
--
-- archived_at stamps a project as archived without deleting its rows.
-- start_date and due_date drive timeline displays.
CREATE TABLE IF NOT EXISTS project (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  state VARCHAR(50) NOT NULL DEFAULT 'new' CHECK(state IN ('new', 'in_progress', 'on_hold', 'complete', 'operational', 'retired')),
  workflow_type VARCHAR(50) NOT NULL DEFAULT 'evidence_driven' CHECK(workflow_type IN ('claims_driven', 'evidence_driven')),
  start_date DATE,
  due_date DATE,
  archived_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_standard (
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  standard_id UUID NOT NULL REFERENCES standard(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, standard_id)
);

CREATE TABLE IF NOT EXISTS project_tag (
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, tag_id)
);

-- =====================================================================
-- Signatories and assessors
-- =====================================================================

CREATE TABLE IF NOT EXISTS signatory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  role VARCHAR(255),
  organization_id UUID REFERENCES organization(id) ON DELETE SET NULL,
  external_reference_type VARCHAR(100),
  external_reference_url VARCHAR(2048),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- CycloneDX declarations.assessors[]. Links to an entity (org) and
-- optionally an app_user for internal assessors.
CREATE TABLE IF NOT EXISTS assessor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_ref VARCHAR(255) NOT NULL,
  third_party BOOLEAN NOT NULL DEFAULT TRUE,
  entity_id UUID REFERENCES entity(id) ON DELETE SET NULL,
  user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assessor_entity ON assessor(entity_id);
CREATE INDEX IF NOT EXISTS idx_assessor_user ON assessor(user_id);

-- =====================================================================
-- Evidence (declared before assessment_requirement so the FK is inline)
-- =====================================================================

CREATE TABLE IF NOT EXISTS evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_ref VARCHAR(255),
  name VARCHAR(255) NOT NULL,
  property_name VARCHAR(255),
  description TEXT,
  state VARCHAR(50) NOT NULL DEFAULT 'in_progress' CHECK(state IN ('in_review', 'in_progress', 'claimed', 'expired')),
  author_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  expires_on TIMESTAMP WITH TIME ZONE,
  is_counter_evidence BOOLEAN NOT NULL DEFAULT FALSE,
  classification VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_evidence_state ON evidence(state);

CREATE TABLE IF NOT EXISTS evidence_note (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- storage_provider chooses between database (binary_content) and an
-- external provider like S3 (storage_path). Exactly one of those two
-- columns is set per row.
CREATE TABLE IF NOT EXISTS evidence_attachment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(255) NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_provider TEXT NOT NULL DEFAULT 'database',
  storage_path VARCHAR(255),
  binary_content BYTEA,
  content_hash VARCHAR(64),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS evidence_tag (
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (evidence_id, tag_id)
);

-- =====================================================================
-- Assessments
-- =====================================================================
--
-- An assessment can target either a project (legacy) or an entity
-- (current). Both FKs are nullable so the writer can pick. The
-- standard_id column captures the standard the assessment exercises
-- when it is not derivable from the project_standard junction.
-- conformance_score is a denormalized roll up updated when
-- attestations cascade.
CREATE TABLE IF NOT EXISTS assessment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  project_id UUID REFERENCES project(id) ON DELETE CASCADE,
  entity_id UUID REFERENCES entity(id) ON DELETE SET NULL,
  standard_id UUID REFERENCES standard(id) ON DELETE SET NULL,
  conformance_score DECIMAL(5, 2),
  due_date TIMESTAMP WITH TIME ZONE,
  start_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE,
  state VARCHAR(50) NOT NULL DEFAULT 'new' CHECK(state IN ('new', 'pending', 'in_progress', 'on_hold', 'cancelled', 'complete', 'archived')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assessment_project_id ON assessment(project_id);
CREATE INDEX IF NOT EXISTS idx_assessment_entity_id ON assessment(entity_id);
CREATE INDEX IF NOT EXISTS idx_assessment_standard_id ON assessment(standard_id);

CREATE TABLE IF NOT EXISTS assessment_assessor (
  assessment_id UUID NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (assessment_id, user_id)
);

CREATE TABLE IF NOT EXISTS assessment_assessee (
  assessment_id UUID NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (assessment_id, user_id)
);

CREATE TABLE IF NOT EXISTS assessment_tag (
  assessment_id UUID NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (assessment_id, tag_id)
);

-- assessment_requirement carries the working state during an
-- assessment. evidence_id is the legacy single evidence pointer.
-- The many to many junction is assessment_requirement_evidence
-- below.
CREATE TABLE IF NOT EXISTS assessment_requirement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
  requirement_id UUID NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  evidence_id UUID REFERENCES evidence(id) ON DELETE SET NULL,
  result VARCHAR(50) CHECK(result IN ('yes', 'no', 'partial', 'not_applicable')),
  rationale TEXT,
  owner VARCHAR(255),
  owner_email VARCHAR(255),
  owner_role VARCHAR(255),
  oe_entity VARCHAR(255),
  business_unit VARCHAR(255),
  region VARCHAR(100),
  assessed_by VARCHAR(255),
  assessment_date DATE,
  next_review_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(assessment_id, requirement_id)
);
ALTER TABLE assessment_requirement ADD COLUMN IF NOT EXISTS owner VARCHAR(255);
ALTER TABLE assessment_requirement ADD COLUMN IF NOT EXISTS owner_email VARCHAR(255);
ALTER TABLE assessment_requirement ADD COLUMN IF NOT EXISTS owner_role VARCHAR(255);
ALTER TABLE assessment_requirement ADD COLUMN IF NOT EXISTS oe_entity VARCHAR(255);
ALTER TABLE assessment_requirement ADD COLUMN IF NOT EXISTS business_unit VARCHAR(255);
ALTER TABLE assessment_requirement ADD COLUMN IF NOT EXISTS region VARCHAR(100);
ALTER TABLE assessment_requirement ADD COLUMN IF NOT EXISTS assessed_by VARCHAR(255);
ALTER TABLE assessment_requirement ADD COLUMN IF NOT EXISTS assessment_date DATE;
ALTER TABLE assessment_requirement ADD COLUMN IF NOT EXISTS next_review_date DATE;
ALTER TABLE assessment_requirement ADD COLUMN IF NOT EXISTS conformance_score DECIMAL(3, 2) CHECK(conformance_score >= 0 AND conformance_score <= 1);
ALTER TABLE assessment_requirement ADD COLUMN IF NOT EXISTS conformance_rationale TEXT;
ALTER TABLE assessment_requirement ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(3, 2) CHECK(confidence_score >= 0 AND confidence_score <= 1);
ALTER TABLE assessment_requirement ADD COLUMN IF NOT EXISTS confidence_rationale TEXT;

ALTER TABLE assessment ADD COLUMN IF NOT EXISTS assessment_type VARCHAR(50) DEFAULT 'standards';
ALTER TABLE assessment ADD COLUMN IF NOT EXISTS task_label VARCHAR(25);

CREATE TABLE IF NOT EXISTS assessment_evidence (
  assessment_id UUID NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (assessment_id, evidence_id)
);

ALTER TABLE evidence ADD COLUMN IF NOT EXISTS owner VARCHAR(255);
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS type VARCHAR(50) CHECK(type IN ('proof', 'counter_evidence', 'mitigation_strategy'));
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS evidence_notes TEXT;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS geo_latitude DOUBLE PRECISION;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS geo_longitude DOUBLE PRECISION;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS geo_label VARCHAR(255);
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS display_id SERIAL;

CREATE TABLE IF NOT EXISTS assessment_requirement_evidence (
  assessment_requirement_id UUID NOT NULL REFERENCES assessment_requirement(id) ON DELETE CASCADE,
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (assessment_requirement_id, evidence_id)
);

-- =====================================================================
-- Attestations
-- =====================================================================
--
-- The Sprint 6 per attestation signature columns (signature_type,
-- signed_by, signed_name, signature_image_data, signature_ip,
-- signature_user_agent, signature_jurisdiction,
-- signature_legal_intent, signature_algorithm, signature_value,
-- public_key_pem, certificate_chain, canonical_payload_hash,
-- rescinded_at, rescinded_by, rescind_reason) were folded into the
-- assessment scoped affirmation cascade in PR3.6 and never returned.
-- They are intentionally absent from this table.
--
-- The columns that did return for CycloneDX 1.7 are signature_json
-- (the per attestation JSF envelope), signed_at, and
-- signature_canonical_hash. These live alongside the assessor
-- pointer and the original signatory pointer.
CREATE TABLE IF NOT EXISTS attestation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  summary TEXT,
  assessment_id UUID NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
  signatory_id UUID REFERENCES signatory(id) ON DELETE SET NULL,
  assessor_id UUID REFERENCES assessor(id) ON DELETE SET NULL,
  signature_json JSONB,
  signed_at TIMESTAMP WITH TIME ZONE,
  signature_canonical_hash VARCHAR(128),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attestation_requirement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attestation_id UUID NOT NULL REFERENCES attestation(id) ON DELETE CASCADE,
  requirement_id UUID NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  conformance_score DECIMAL(3, 2) NOT NULL CHECK(conformance_score >= 0 AND conformance_score <= 1),
  conformance_rationale TEXT NOT NULL,
  confidence_score DECIMAL(3, 2) CHECK(confidence_score >= 0 AND confidence_score <= 1),
  confidence_rationale TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(attestation_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS attestation_requirement_mitigation (
  attestation_requirement_id UUID NOT NULL REFERENCES attestation_requirement(id) ON DELETE CASCADE,
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  description TEXT,
  target_completion TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (attestation_requirement_id, evidence_id)
);

-- =====================================================================
-- Claims
-- =====================================================================
--
-- target carries the legacy free text target. target_entity_id is
-- the CycloneDX aligned FK introduced when entities became first
-- class. attestation_id ties a claim to the attestation that asserts
-- it.
CREATE TABLE IF NOT EXISTS claim (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_ref VARCHAR(255),
  name VARCHAR(255) NOT NULL,
  target TEXT NOT NULL,
  target_entity_id UUID REFERENCES entity(id) ON DELETE SET NULL,
  predicate TEXT NOT NULL,
  reasoning TEXT,
  is_counter_claim BOOLEAN NOT NULL DEFAULT FALSE,
  attestation_id UUID REFERENCES attestation(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS claim_evidence (
  claim_id UUID NOT NULL REFERENCES claim(id) ON DELETE CASCADE,
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (claim_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS claim_counter_evidence (
  claim_id UUID NOT NULL REFERENCES claim(id) ON DELETE CASCADE,
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (claim_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS claim_mitigation_strategy (
  claim_id UUID NOT NULL REFERENCES claim(id) ON DELETE CASCADE,
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (claim_id, evidence_id)
);

-- CycloneDX claim.externalReferences[]. The full type list mirrors
-- the spec.
CREATE TABLE IF NOT EXISTS claim_external_reference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES claim(id) ON DELETE CASCADE,
  type VARCHAR(100) NOT NULL CHECK(type IN (
    'vcs', 'issue-tracker', 'website', 'advisories', 'bom', 'mailing-list',
    'social', 'chat', 'documentation', 'support', 'source-distribution',
    'distribution', 'distribution-intake', 'license', 'build-meta',
    'build-system', 'release-notes', 'security-contact', 'model-card',
    'log', 'configuration', 'evidence', 'formulation', 'attestation',
    'threat-model', 'adversary-model', 'risk-assessment',
    'vulnerability-assertion', 'exploitability-statement', 'pentest-report',
    'static-analysis-report', 'dynamic-analysis-report',
    'runtime-analysis-report', 'component-analysis-report',
    'maturity-report', 'certification-report', 'codified-infrastructure',
    'quality-metrics', 'poam', 'electronic-signature', 'digital-signature',
    'rfc-9116', 'patent', 'patent-family', 'patent-assertion', 'citation',
    'other'
  )),
  url VARCHAR(2048) NOT NULL,
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_claim_ext_ref_claim ON claim_external_reference(claim_id);

-- =====================================================================
-- Mitigations
-- =====================================================================
--
-- A mitigation strategy tracks remediation work linked to claims and
-- evidence. status drives the workflow pipeline shown in the UI.
-- effectiveness is set after implementation is verified.

CREATE TABLE IF NOT EXISTS mitigation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mitigation_id VARCHAR(50),
  title VARCHAR(255) NOT NULL,
  type VARCHAR(100) NOT NULL CHECK(type IN ('Technical', 'Process', 'Policy', 'Training', 'Physical')),
  category VARCHAR(100) CHECK(category IN ('Preventive', 'Detective', 'Corrective', 'Compensating')),
  priority VARCHAR(50) NOT NULL CHECK(priority IN ('Critical', 'High', 'Medium', 'Low')),
  status VARCHAR(50) NOT NULL DEFAULT 'Proposed' CHECK(status IN ('Proposed', 'In Progress', 'Implemented', 'Verified', 'Closed')),
  effectiveness VARCHAR(100) CHECK(effectiveness IN ('Effective', 'Partially Effective', 'Not Effective', 'Unknown')),
  description TEXT,
  owner VARCHAR(255),
  notes TEXT,
  created_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mitigation_status ON mitigation(status);
CREATE INDEX IF NOT EXISTS idx_mitigation_priority ON mitigation(priority);

ALTER TABLE claim ADD COLUMN IF NOT EXISTS display_id SERIAL;
ALTER TABLE mitigation ADD COLUMN IF NOT EXISTS display_id SERIAL;

CREATE TABLE IF NOT EXISTS mitigation_claim (
  mitigation_id UUID NOT NULL REFERENCES mitigation(id) ON DELETE CASCADE,
  claim_id UUID NOT NULL REFERENCES claim(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mitigation_id, claim_id)
);

CREATE TABLE IF NOT EXISTS mitigation_evidence (
  mitigation_id UUID NOT NULL REFERENCES mitigation(id) ON DELETE CASCADE,
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mitigation_id, evidence_id)
);

-- CycloneDX attestation.map[].claims[] and counterClaims[].
CREATE TABLE IF NOT EXISTS attestation_requirement_claim (
  attestation_requirement_id UUID NOT NULL REFERENCES attestation_requirement(id) ON DELETE CASCADE,
  claim_id UUID NOT NULL REFERENCES claim(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (attestation_requirement_id, claim_id)
);

CREATE TABLE IF NOT EXISTS attestation_requirement_counter_claim (
  attestation_requirement_id UUID NOT NULL REFERENCES attestation_requirement(id) ON DELETE CASCADE,
  claim_id UUID NOT NULL REFERENCES claim(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (attestation_requirement_id, claim_id)
);

-- =====================================================================
-- Affirmations and the platform signing key
-- =====================================================================
--
-- An affirmation seals the declarations block for an assessment with
-- a pair of platform signatures (one over declarations, one over the
-- full document). Each required signatory signs their JSF envelope
-- first. The platform wraps those into the declarations seal and
-- then seals the full document.
--
-- Slot model (Option B). Affirmation managers declare required slots
-- by title (CISO, COO, CFO etc). A slot can optionally pin a
-- specific user via required_user_id. If unpinned, any user with
-- signing authority may claim the slot by signing it.
CREATE TABLE IF NOT EXISTS affirmation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement TEXT NOT NULL,
  project_id UUID REFERENCES project(id) ON DELETE CASCADE,
  entity_id UUID REFERENCES entity(id) ON DELETE SET NULL,
  assessment_id UUID REFERENCES assessment(id) ON DELETE CASCADE,
  sealed_at TIMESTAMP WITH TIME ZONE,
  sealed_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  canonical_hash VARCHAR(128),
  declarations_signature_json JSONB,
  document_signature_json JSONB,
  platform_key_fingerprint VARCHAR(128),
  rescinded_at TIMESTAMP WITH TIME ZONE,
  rescinded_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  rescind_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_affirmation_assessment_unique ON affirmation(assessment_id) WHERE assessment_id IS NOT NULL;

-- affirmation_signatory carries one slot per required signatory.
-- The earlier two column junction shape is gone. The wider row
-- captures the slot metadata, an optional pinned user, the
-- materialized signatory identity once claimed, and the per
-- signatory JSF envelope.
CREATE TABLE IF NOT EXISTS affirmation_signatory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affirmation_id UUID NOT NULL REFERENCES affirmation(id) ON DELETE CASCADE,
  required_title VARCHAR(255) NOT NULL,
  required_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  signatory_id UUID REFERENCES signatory(id) ON DELETE SET NULL,
  signature_json JSONB,
  canonical_hash VARCHAR(128),
  signed_at TIMESTAMP WITH TIME ZONE,
  signed_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (affirmation_id, required_title)
);

CREATE INDEX IF NOT EXISTS idx_affirmation_signatory_affirmation ON affirmation_signatory(affirmation_id);
CREATE INDEX IF NOT EXISTS idx_affirmation_signatory_required_user ON affirmation_signatory(required_user_id);

-- Platform signing key inventory. Historic rows are retained so
-- signatures generated before a rotation can still be verified
-- using the key that produced them. Only one row has is_active true
-- at a time, enforced by the partial unique index.
CREATE TABLE IF NOT EXISTS platform_signing_key (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint VARCHAR(128) NOT NULL UNIQUE,
  algorithm VARCHAR(32) NOT NULL,
  public_key_pem TEXT NOT NULL,
  private_key_encrypted TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  rotated_at TIMESTAMP WITH TIME ZONE,
  rotated_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_signing_key_active_singleton ON platform_signing_key(is_active) WHERE is_active;

-- =====================================================================
-- Personal signature inventory
-- =====================================================================
--
-- Each user with signing authority can register one or more labeled
-- signatures. The payload is always stored encrypted. See
-- signatures.ts for the per signature_type payload shapes.
CREATE TABLE IF NOT EXISTS user_signature (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  label VARCHAR(255) NOT NULL,
  signature_type VARCHAR(20) NOT NULL CHECK(signature_type IN ('electronic', 'digital')),
  signature_format VARCHAR(20) CHECK(signature_format IS NULL OR signature_format IN ('jsf', 'x509')),
  backend_type VARCHAR(32) NOT NULL DEFAULT 'local' CHECK(backend_type IN ('local', 'hsm', 'signing_server')),
  payload_encrypted TEXT NOT NULL,
  key_fingerprint VARCHAR(128),
  signature_image_filename VARCHAR(512),
  signature_image_content_type VARCHAR(128),
  signature_image_size_bytes BIGINT,
  signature_image_storage_path TEXT,
  signature_image_binary_content BYTEA,
  signature_image_content_hash VARCHAR(128),
  signature_image_storage_provider VARCHAR(32),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, label)
);

CREATE INDEX IF NOT EXISTS idx_user_signature_user ON user_signature(user_id);

-- =====================================================================
-- Work notes, audit, notifications
-- =====================================================================

CREATE TABLE IF NOT EXISTS work_note (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_work_note_assessment ON work_note(assessment_id);

-- audit_log.user_id is nullable so system originated events such as
-- the F15 startup config drift detector can be recorded without
-- inventing a synthetic service account. Application emitted rows
-- always carry the acting user id.
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL CHECK(action IN ('create', 'create_for_other', 'update', 'delete', 'state_change', 'link', 'unlink', 'authz_denied', 'config_change')),
  user_id UUID REFERENCES app_user(id) ON DELETE CASCADE,
  changes JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);

CREATE TABLE IF NOT EXISTS notification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  type VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  link VARCHAR(500),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notification_user ON notification(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_read ON notification(user_id, is_read);

-- =====================================================================
-- Assessment Scheduler
-- =====================================================================
--
-- Stores planned/scheduled assessment events for projects. Each row
-- represents one scheduled occurrence. Recurrence creates child rows
-- (or the UI generates them on-the-fly). The assessor_id references
-- the app_user who is assigned to perform the assessment.

CREATE TABLE IF NOT EXISTS scheduled_assessment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  project_id UUID REFERENCES project(id) ON DELETE CASCADE,
  assessor_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  standard_id UUID REFERENCES standard(id) ON DELETE SET NULL,
  assessment_id UUID REFERENCES assessment(id) ON DELETE SET NULL,
  scheduled_date DATE NOT NULL,
  due_date DATE,
  recurrence VARCHAR(20) NOT NULL DEFAULT 'none' CHECK(recurrence IN ('none', 'weekly', 'monthly', 'quarterly', 'yearly')),
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'in_progress', 'on_hold', 'complete', 'failed', 'warning')),
  notes TEXT,
  created_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scheduled_assessment_project ON scheduled_assessment(project_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_assessment_assessor ON scheduled_assessment(assessor_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_assessment_date ON scheduled_assessment(scheduled_date);

-- The configurable-dashboard table was retired with its API (the
-- dashboard is fixed tabs). Drop it from databases created earlier.
DROP TABLE IF EXISTS dashboard;

-- =====================================================================
-- Webhook and chat notification channels
-- =====================================================================

CREATE TABLE IF NOT EXISTS webhook (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  event_types TEXT[] NOT NULL DEFAULT ARRAY['*'],
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS webhook_delivery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES webhook(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'success', 'failed', 'exhausted')),
  http_status INTEGER,
  attempt INTEGER NOT NULL DEFAULT 1,
  next_retry_at TIMESTAMP WITH TIME ZONE,
  request_body JSONB,
  response_body TEXT,
  error_message TEXT,
  delivered_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_webhook ON webhook_delivery(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_status ON webhook_delivery(status, next_retry_at);

CREATE TABLE IF NOT EXISTS chat_integration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('slack', 'teams', 'mattermost')),
  webhook_url TEXT NOT NULL,
  event_categories TEXT NOT NULL DEFAULT 'assessment,evidence,attestation',
  channel_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_integration_platform ON chat_integration(platform);

CREATE TABLE IF NOT EXISTS chat_delivery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES chat_integration(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'success', 'failed', 'exhausted')),
  http_status INTEGER,
  attempt INTEGER NOT NULL DEFAULT 1,
  next_retry_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  delivered_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_delivery_integration ON chat_delivery(integration_id);
CREATE INDEX IF NOT EXISTS idx_chat_delivery_status ON chat_delivery(status, next_retry_at);

-- =====================================================================
-- Notification rules
-- =====================================================================

CREATE TABLE IF NOT EXISTS notification_rule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  scope VARCHAR(20) NOT NULL CHECK(scope IN ('system', 'user')),
  user_id UUID REFERENCES app_user(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL CHECK(channel IN ('in_app', 'email', 'slack', 'teams', 'mattermost', 'webhook')),
  event_types JSONB NOT NULL DEFAULT '[]',
  filters JSONB NOT NULL DEFAULT '{}',
  destination JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notification_rule_scope ON notification_rule(scope);
CREATE INDEX IF NOT EXISTS idx_notification_rule_user ON notification_rule(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_rule_enabled ON notification_rule(enabled);

-- =====================================================================
-- Entity scoped junctions and policy
-- =====================================================================

CREATE TABLE IF NOT EXISTS entity_tag (
  entity_id UUID NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entity_id, tag_id)
);

CREATE TABLE IF NOT EXISTS entity_standard (
  entity_id UUID NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  standard_id UUID NOT NULL REFERENCES standard(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entity_id, standard_id)
);

CREATE TABLE IF NOT EXISTS compliance_policy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  standard_id UUID NOT NULL REFERENCES standard(id) ON DELETE CASCADE,
  description TEXT,
  is_inherited BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_id, standard_id)
);

-- Retire the requirements.edit permission. Draft requirement CRUD is now
-- gated on standards.edit, matching the level routes and the state==='draft'
-- invariant. The separate permission was vestigial: every functional role
-- that held it also held standards.edit, and any custom role that held only
-- standards.edit silently lost requirement editing in the UI (issue #25).
-- DELETE is naturally idempotent on repeat runs.
DELETE FROM role_permission WHERE permission_id IN (SELECT id FROM permission WHERE key = 'requirements.edit');
DELETE FROM permission WHERE key = 'requirements.edit';

ALTER TABLE mitigation ADD COLUMN IF NOT EXISTS team VARCHAR(255);
ALTER TABLE mitigation ADD COLUMN IF NOT EXISTS reviewer VARCHAR(255);
ALTER TABLE mitigation ADD COLUMN IF NOT EXISTS linked_assessment VARCHAR(100);
ALTER TABLE mitigation ADD COLUMN IF NOT EXISTS target_date DATE;
ALTER TABLE mitigation ADD COLUMN IF NOT EXISTS completion_date DATE;
ALTER TABLE mitigation ADD COLUMN IF NOT EXISTS verified_by VARCHAR(255);
ALTER TABLE mitigation ADD COLUMN IF NOT EXISTS effectiveness_rationale TEXT;

ALTER TABLE claim ADD COLUMN IF NOT EXISTS display_id SERIAL;
ALTER TABLE claim ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'Draft';
ALTER TABLE claim ADD COLUMN IF NOT EXISTS claim_type VARCHAR(100);
ALTER TABLE claim ADD COLUMN IF NOT EXISTS confidence VARCHAR(50);
ALTER TABLE claim ADD COLUMN IF NOT EXISTS project_name VARCHAR(255);
ALTER TABLE claim ADD COLUMN IF NOT EXISTS project_requirement VARCHAR(100);
ALTER TABLE claim ADD COLUMN IF NOT EXISTS framework VARCHAR(255);
ALTER TABLE claim ADD COLUMN IF NOT EXISTS assessor VARCHAR(255);
ALTER TABLE claim ADD COLUMN IF NOT EXISTS claim_date DATE;
ALTER TABLE claim ADD COLUMN IF NOT EXISTS work_notes TEXT;

-- Geolocation fields for entity (organization, business_unit, team, service)
ALTER TABLE entity ADD COLUMN IF NOT EXISTS country VARCHAR(100);
ALTER TABLE entity ADD COLUMN IF NOT EXISTS region VARCHAR(100);
ALTER TABLE entity ADD COLUMN IF NOT EXISTS locality VARCHAR(100);
ALTER TABLE entity ADD COLUMN IF NOT EXISTS timezone VARCHAR(60);

-- Least-privilege scopes: add the projects/claims view_all permissions (their
-- assessments/evidence counterparts already exist) and grant the broad-data
-- view_all set to admin and assessor. Assessors see all data but reach no admin
-- panel, while assessees keep only the base participation-scoped view perms.
-- Idempotent via ON CONFLICT so it is safe on every boot and on existing DBs.
INSERT INTO permission (id, key, name, description, category) VALUES (gen_random_uuid(), 'projects.view_all', 'View All Projects', 'View all projects regardless of assessment participation', 'projects') ON CONFLICT (key) DO NOTHING;
INSERT INTO permission (id, key, name, description, category) VALUES (gen_random_uuid(), 'claims.view_all', 'View All Claims', 'View all claims regardless of assessment participation', 'claims') ON CONFLICT (key) DO NOTHING;
INSERT INTO role_permission (role_id, permission_id) SELECT r.id, p.id FROM role r, permission p WHERE r.key = 'admin' AND p.key IN ('projects.view_all', 'claims.view_all') ON CONFLICT DO NOTHING;
INSERT INTO role_permission (role_id, permission_id) SELECT r.id, p.id FROM role r, permission p WHERE r.key = 'assessor' AND p.key IN ('assessments.view_all', 'evidence.view_all', 'projects.view_all', 'claims.view_all') ON CONFLICT DO NOTHING;

-- API keys always expire (security review A3). Keys created before that rule
-- had no expiry, so they get the default 90 days from the first boot of this
-- version. A no-op once every key has an expiry. (No semicolons in comments:
-- the runner splits this template on them.)
UPDATE api_key SET expires_at = CURRENT_TIMESTAMP + INTERVAL '90 days' WHERE expires_at IS NULL;

-- NOTE soft-delete support (deleted_at columns, the raw-table rename, and the
-- filtered views) is installed by installSoftDeleteViews below, not here. It
-- runs as a guarded post-step because the naive statement splitter used for
-- this template cannot hold a DO block, and because after the first run the
-- public table name (for example assessment) is a VIEW, so an ALTER TABLE
-- against it in this template would fail on every subsequent boot.
`;

export async function runMigrations(): Promise<void> {
  logger.info('Running database migrations...');

  const db = getDatabase();

  // The runner splits the SQL template on the semicolon character and
  // executes each statement individually. CREATE INDEX IF NOT EXISTS
  // and ALTER TABLE ADD COLUMN IF NOT EXISTS keep the bootstrap
  // idempotent for repeat runs against an existing database.
  const statements = SQL.split(';').filter((stmt) => stmt.trim());

  for (const statement of statements) {
    if (statement.trim()) {
      try {
        await db.executeQuery({
          sql: `${statement};`,
          parameters: [],
          // biome-ignore lint/suspicious/noExplicitAny: Kysely executeQuery requires CompiledQuery but we build raw SQL
        } as any);
      } catch (error: unknown) {
        const errorMessage = (error as Record<string, unknown> | null)?.message || '';
        const msg = typeof errorMessage === 'string' ? errorMessage : '';
        // Ignore "already exists" errors from CREATE INDEX / ALTER TABLE
        if (msg.includes('already exists')) {
          continue;
        }
        // Soft-delete idempotency: on the second and later boots the five
        // deletable tables (assessment, evidence, claim, mitigation, entity)
        // have been renamed to *_raw and replaced by a view under the original
        // name. The additive CREATE INDEX / ALTER TABLE ADD COLUMN statements in
        // this template then target a view and raise these errors. They already
        // ran against the base table on the first boot, so skipping them is safe.
        if (
          msg.includes('cannot create index on relation') ||
          msg.includes('ADD COLUMN cannot be performed on relation')
        ) {
          continue;
        }
        // Diagnostic: wrap the error with the offending statement so tests
        // report which statement blew up rather than just "syntax error
        // near 'a'".
        const stmtPreview = statement.trim().slice(0, 400);
        throw new Error(`Migration failed on statement: ${stmtPreview}\n\nOriginal error: ${msg}`);
      }
    }
  }

  // Audit-log append-only enforcement. Lives outside the SQL template
  // because the PL/pgSQL function body contains semicolons that the
  // naive splitter above would shred. UPDATE/DELETE on audit_log raise
  // a SQLSTATE 'AU001' error, which is distinct enough that test
  // helpers can recognise it.
  await installAuditLogImmutabilityTrigger(db);

  // Soft-delete: rename each deletable base table to <t>_raw, add deleted_at,
  // and expose a filtered view under the original name. Runs after all base
  // tables (and their FKs) exist so the rename is FK-safe. Idempotent.
  await installSoftDeleteViews(db);

  logger.info('Database migrations completed');
}

/**
 * Install the soft-delete view layer for the deletable top-level resources.
 *
 * For each table T: add a nullable deleted_at, rename T -> T_raw (FKs follow
 * the table by OID, so children stay intact), add a partial index for the
 * "not deleted" filter, then create a view named T that selects only rows
 * where deleted_at IS NULL. Every existing `selectFrom('T')` and join to T
 * then transparently excludes soft-deleted rows — no per-query filter, and
 * no way for a future query to forget one. Writes pass through the
 * auto-updatable view; restore and purge target T_raw directly.
 *
 * The guard (table_type = 'BASE TABLE') makes this a no-op on every boot
 * after the first, when T is already a view.
 */
export async function installSoftDeleteViews(db: ReturnType<typeof getDatabase>): Promise<void> {
  const tables = ['assessment', 'evidence', 'claim', 'mitigation', 'entity'];
  for (const t of tables) {
    const sqlStmt = `DO $sd$ BEGIN
      IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = '${t}' AND table_type = 'BASE TABLE') THEN
        ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
        ALTER TABLE ${t} RENAME TO ${t}_raw;
        CREATE INDEX IF NOT EXISTS idx_${t}_not_deleted ON ${t}_raw(id) WHERE deleted_at IS NULL;
        CREATE VIEW ${t} AS SELECT * FROM ${t}_raw WHERE deleted_at IS NULL;
      END IF;
    END $sd$;`;
    try {
      await db.executeQuery({
        sql: sqlStmt,
        parameters: [],
        // biome-ignore lint/suspicious/noExplicitAny: Kysely executeQuery requires CompiledQuery
      } as any);
    } catch (error: unknown) {
      const msg = (error as { message?: string } | null)?.message ?? '';
      throw new Error(`Failed to install soft-delete view for '${t}': ${msg}`);
    }
  }
}

async function installAuditLogImmutabilityTrigger(db: ReturnType<typeof getDatabase>): Promise<void> {
  const statements = [
    `CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $audit_log_immutable$
       BEGIN
         RAISE EXCEPTION 'audit_log is append-only (operation %)', TG_OP USING ERRCODE = 'AU001';
       END;
     $audit_log_immutable$ LANGUAGE plpgsql;`,
    `DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;`,
    `CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
       FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();`,
    `DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;`,
    `CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
       FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();`,
  ];
  for (const sqlStmt of statements) {
    try {
      await db.executeQuery({
        sql: sqlStmt,
        parameters: [],
        // biome-ignore lint/suspicious/noExplicitAny: Kysely executeQuery requires CompiledQuery
      } as any);
    } catch (error: unknown) {
      const msg = (error as { message?: string } | null)?.message ?? '';
      // PGlite ships plpgsql; if a runtime ever lacks it the migration
      // surfaces a clear error rather than silently dropping the guard.
      throw new Error(`Failed to install audit_log immutability trigger: ${msg}`);
    }
  }
}

// Allow running as standalone script: npx tsx src/db/migrate.ts
const isMainModule = process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js');
if (isMainModule) {
  (async () => {
    try {
      await initializeDatabase();
      await runMigrations();
      await closeDatabase();
    } catch (error) {
      logger.error('Database migration failed', { error });
      process.exit(1);
    }
  })();
}
