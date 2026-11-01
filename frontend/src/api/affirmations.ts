import client from './client'

/**
 * Typed client for the affirmation cascade signing API.
 *
 * The backend owns a single affirmation per assessment. That
 * affirmation carries a statement, a list of required signatory slots,
 * per slot JSF envelopes, and (once sealed) a platform signed
 * declarations envelope plus a platform signed document envelope. See
 * backend/src/routes/affirmations.ts for the full contract.
 */

export interface AffirmationSlot {
  id: string
  requiredTitle: string
  requiredUserId: string | null
  signatoryId: string | null
  signedAt: string | null
  signedBy: string | null
  canonicalHash: string | null
  signature: unknown
}

export interface Affirmation {
  id: string
  assessmentId: string | null
  projectId: string | null
  entityId: string | null
  statement: string
  sealedAt: string | null
  sealedBy: string | null
  canonicalHash: string | null
  platformKeyFingerprint: string | null
  declarationsSignature: unknown
  documentSignature: unknown
  rescindedAt: string | null
  rescindedBy: string | null
  rescindReason: string | null
  createdAt: string
  updatedAt: string
  signatories: AffirmationSlot[]
}

export interface AffirmationResponse {
  data: Affirmation
}

export interface VerifySlotResult {
  slotId: string
  valid: boolean
  drifted?: boolean
  signatureType?: string
  reasons?: string[]
  reason?: string
}

export interface VerifyResult {
  verified: boolean
  rescinded: boolean
  platformKeyFingerprint: string | null
  slots: VerifySlotResult[]
  declarations: { valid: boolean }
  document: { valid: boolean }
  issues: string[]
}

export interface PrepareSignResult {
  affirmationId: string
  slotId: string
  canonicalPayloadHash: string
  hashAlgorithm: string
}

export async function getAffirmationByAssessment(
  assessmentId: string,
): Promise<Affirmation | null> {
  try {
    const { data } = await client.get<AffirmationResponse>(
      `/affirmations/by-assessment/${encodeURIComponent(assessmentId)}`,
    )
    return data.data
  } catch (err: unknown) {
    const e = err as { response?: { status?: number } }
    if (e.response?.status === 404) return null
    throw err
  }
}

export async function createAffirmation(input: {
  assessmentId: string
  statement: string
}): Promise<Affirmation> {
  const { data } = await client.post<AffirmationResponse>('/affirmations', input)
  return data.data
}

export async function updateAffirmation(
  id: string,
  input: { statement: string },
): Promise<Affirmation> {
  const { data } = await client.put<AffirmationResponse>(
    `/affirmations/${encodeURIComponent(id)}`,
    input,
  )
  return data.data
}

export async function addSlot(
  id: string,
  input: { requiredTitle: string; requiredUserId?: string | null },
): Promise<AffirmationSlot> {
  const { data } = await client.post<{ data: AffirmationSlot }>(
    `/affirmations/${encodeURIComponent(id)}/signatories`,
    input,
  )
  return data.data
}

export async function updateSlot(
  id: string,
  slotId: string,
  input: { requiredTitle?: string; requiredUserId?: string | null },
): Promise<AffirmationSlot> {
  const { data } = await client.put<{ data: AffirmationSlot }>(
    `/affirmations/${encodeURIComponent(id)}/signatories/${encodeURIComponent(slotId)}`,
    input,
  )
  return data.data
}

export async function deleteSlot(id: string, slotId: string): Promise<void> {
  await client.delete(
    `/affirmations/${encodeURIComponent(id)}/signatories/${encodeURIComponent(slotId)}`,
  )
}

export async function prepareSlotSignature(
  id: string,
  slotId: string,
  userSignatureId: string,
): Promise<PrepareSignResult> {
  const { data } = await client.post<PrepareSignResult>(
    `/affirmations/${encodeURIComponent(id)}/signatories/${encodeURIComponent(slotId)}/sign/prepare`,
    { userSignatureId },
  )
  return data
}

export async function signSlot(
  id: string,
  slotId: string,
  input: {
    userSignatureId: string
    signatureValue?: string
    canonicalPayloadHash?: string
  },
): Promise<AffirmationSlot> {
  const { data } = await client.post<{ data: AffirmationSlot }>(
    `/affirmations/${encodeURIComponent(id)}/signatories/${encodeURIComponent(slotId)}/sign`,
    input,
  )
  return data.data
}

export async function sealAffirmation(id: string): Promise<Affirmation> {
  const { data } = await client.post<AffirmationResponse>(
    `/affirmations/${encodeURIComponent(id)}/seal`,
  )
  return data.data
}

export async function verifyAffirmation(id: string): Promise<VerifyResult> {
  const { data } = await client.post<VerifyResult>(
    `/affirmations/${encodeURIComponent(id)}/verify`,
  )
  return data
}

export async function rescindAffirmation(
  id: string,
  reason: string,
): Promise<void> {
  await client.post(`/affirmations/${encodeURIComponent(id)}/rescind`, {
    reason,
  })
}
