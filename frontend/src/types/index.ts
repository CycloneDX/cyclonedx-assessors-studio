// Shared TypeScript types for all entities

export interface User {
  id: string
  username: string
  email: string
  displayName: string
  role: 'admin' | 'assessor' | 'assessee' | 'standards_manager' | 'standards_approver'
  permissions?: string[]
  active: boolean
  hasCompletedOnboarding?: boolean
  lastLogin?: string
  createdAt: string
}

export interface Project {
  id: string
  name: string
  description: string
  state: ProjectState
  standards: Standard[]
  createdAt: string
  updatedAt: string
  createdBy: string
}

export type ProjectState = 'new' | 'in_progress' | 'on_hold' | 'complete' | 'operational' | 'retired'
export type WorkflowType = 'evidence_based' | 'interview_based' | 'mixed'

export interface Standard {
  id: string
  name: string
  version: string
  description: string
  owner: string
  identifier?: string
  state?: 'draft' | 'in_review' | 'published' | 'retired'
  is_imported?: boolean
  authored_by?: string
  approved_by?: string | null
  approved_at?: string | null
  requirementsCount: number
  requirements: Requirement[]
  createdAt: string
}

export interface Requirement {
  id: string
  identifier: string
  name: string
  title?: string
  description: string
  openCre: string | null
  parentId: string | null
  standardId: string
}

export interface Level {
  id: string
  identifier: string
  title: string | null
  description: string | null
  standardId: string
}

export interface Assessment {
  id: string
  title: string
  description: string
  projectId: string
  project?: Project
  entityId?: string | null
  entity?: Entity
  standardId?: string | null
  standard?: Standard
  state: AssessmentState
  startDate: string
  endDate?: string
  dueDate: string
  assessors: User[]
  assessees: User[]
  requirementCount: number
  completedCount: number
  progress: number
  conformanceScore?: number | null
  assessmentType: 'standards' | 'targeted' | 'tasks'
  taskLabel?: string | null
  createdAt: string
}

export type AssessmentState = 'new' | 'pending' | 'in_progress' | 'on_hold' | 'complete' | 'archived' | 'cancelled'

export interface AssessmentRequirement {
  id: string
  assessmentId: string
  requirementId: string
  requirement?: Requirement
  // joined fields from requirement table
  identifier?: string
  name?: string
  title?: string
  description?: string
  result?: 'yes' | 'no' | 'na' | 'partial' | 'not_applicable'
  rationale: string
  evidenceLink?: string
  status: 'pending' | 'assessed' | 'confirmed'
  owner?: string | null
  ownerEmail?: string | null
  ownerRole?: string | null
  oeEntity?: string | null
  businessUnit?: string | null
  region?: string | null
  assessedBy?: string | null
  assessmentDate?: string | null
  nextReviewDate?: string | null
  conformanceScore?: number | null
  conformanceRationale?: string | null
  confidenceScore?: number | null
  confidenceRationale?: string | null
}

export interface Evidence {
  id: string
  displayId?: number
  name: string
  description: string
  evidenceNotes?: string | null
  state: EvidenceState
  classification: string
  author: string
  authorName?: string
  authorId?: string
  reviewer?: string
  reviewerId?: string
  reviewerName?: string
  isCounterEvidence: boolean
  type?: 'proof' | 'counter_evidence' | 'mitigation_strategy' | null
  owner?: string | null
  geoLatitude?: number | null
  geoLongitude?: number | null
  geoLabel?: string | null
  createdAt: string
  updatedAt: string
  expiresAt?: string
  expiresOn?: string
  attachments: Attachment[]
  requirementIds?: string[]
  claimsCount?: number
  assessmentCount?: number
  directLink?: boolean
}

export type EvidenceState = 'draft' | 'submitted' | 'reviewed' | 'approved' | 'archived' | 'claimed' | 'in_progress' | 'in_review' | 'expired'

export interface Attachment {
  id: string
  filename: string
  contentType: string
  size: number
  url: string
  uploadedAt: string
}

export interface Claim {
  id: string
  displayId?: number
  name: string
  target: string
  predicate: string
  reasoning?: string
  status: string
  workNotes?: string | null
  evidenceCount?: number
  mitigationCount?: number
  isCounterClaim: boolean
  attestationId?: string
  claimType?: string | null
  confidence?: string | null
  projectName?: string | null
  projectRequirement?: string | null
  framework?: string | null
  assessor?: string | null
  claimDate?: string | null
  linkedMitigations?: { id: string; title: string; status: string; priority: string; type: string; owner?: string | null }[]
  linkedEvidence?: { id: string; name: string; state: string; description?: string }[]
  createdAt?: string
  updatedAt?: string
}

export interface Mitigation {
  id: string
  displayId?: number
  mitigationId?: string
  title: string
  type: string
  category?: string
  priority: string
  status: string
  effectiveness?: string
  description?: string
  owner?: string
  notes?: string
  linkedClaims?: { id: string; name: string; status?: string }[]
  linkedEvidence?: { id: string; name: string; state: string }[]
  team?: string | null
  reviewer?: string | null
  linkedAssessment?: string | null
  targetDate?: string | null
  completionDate?: string | null
  verifiedBy?: string | null
  effectivenessRationale?: string | null
  createdAt: string
  updatedAt: string
}

export interface Attestation {
  id: string
  summary: string
  assessmentId: string
  assessment?: Assessment
  signatories: Signatory[]
  requirementMappings: AttestationRequirement[]
  conformanceScore: number
  confidenceScore: number
  createdAt: string
}

export interface AttestationRequirement {
  id: string
  attestationId: string
  requirementId: string
  requirement?: Requirement
  conformanceScore: number
  confidenceScore: number
  affirmations: Affirmation[]
}

export interface Signatory {
  id: string
  name: string
  title: string
  organization: string
  email: string
  signatureDate?: string
}

export interface Affirmation {
  id: string
  statement: string
  confidenceLevel: 'high' | 'medium' | 'low'
  supportingEvidence: string[]
}

export interface WorkNote {
  id: string
  assessmentId: string
  author: string
  authorDisplayName?: string
  authorUsername?: string
  content: string
  createdAt: string
  updatedAt?: string
}

// Entity types for flexible hierarchy model
export type EntityType = 'organization' | 'business_unit' | 'team' | 'product' | 'product_version' | 'component' | 'service' | 'project'
export type EntityState = 'active' | 'inactive' | 'archived'
export type RelationshipType = 'owns' | 'supplies' | 'depends_on' | 'governs' | 'contains' | 'consumes' | 'assesses' | 'produces'

export interface Entity {
  id: string
  name: string
  description: string | null
  entityType: EntityType
  state: EntityState
  tags?: Tag[]
  standards?: Standard[]
  childCount?: number
  assessmentCount?: number
  parentName?: string | null
  country?: string | null
  region?: string | null
  locality?: string | null
  timezone?: string | null
  createdAt: string
  updatedAt: string
}

export interface EntityRelationship {
  id: string
  sourceEntityId: string
  targetEntityId: string
  relationshipType: RelationshipType
  sourceEntity?: Entity
  targetEntity?: Entity
  createdAt: string
}

export interface CompliancePolicy {
  id: string
  entityId: string
  standardId: string
  description: string | null
  isInherited: boolean
  standard?: Standard
  entity?: Entity
  createdAt: string
}

export interface Tag {
  id: string
  name: string
  color: string
}

export interface AssessmentProgress {
  standardName: string
  standardVersion: string
  assessments: {
    id: string
    title: string
    completedAt: string
    conformanceScore: number | null
    state: AssessmentState
  }[]
}

export interface APIResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type ScheduledAssessmentStatus = 'scheduled' | 'in_progress' | 'on_hold' | 'complete' | 'failed' | 'warning'
export type ScheduledAssessmentRecurrence = 'none' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export interface ScheduledAssessment {
  id: string
  title: string
  description?: string | null
  projectId?: string | null
  projectName?: string | null
  assessorId?: string | null
  assessorName?: string | null
  standardId?: string | null
  standardName?: string | null
  assessmentId?: string | null
  scheduledDate: string
  dueDate?: string | null
  recurrence: ScheduledAssessmentRecurrence
  status: ScheduledAssessmentStatus
  notes?: string | null
  createdBy?: string | null
  createdAt: string
  updatedAt: string
}
