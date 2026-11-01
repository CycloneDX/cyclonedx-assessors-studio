import client from './client'

/**
 * Postal address sub-shape that mirrors the CycloneDX
 * organizationalEntity.address tree.
 */
export interface PostalAddress {
  bomRef?: string
  country?: string
  region?: string
  locality?: string
  postOfficeBoxNumber?: string
  postalCode?: string
  streetAddress?: string
}

export interface OrganizationalContact {
  bomRef?: string
  name?: string
  email?: string
  phone?: string
}

export interface OrganizationalEntity {
  bomRef?: string
  name: string
  address?: PostalAddress
  url?: string[]
  contact?: OrganizationalContact[]
}

/**
 * Electronic (legal affirmation) payload. Mirrors the CycloneDX
 * signatory shape plus optional affirmation context fields.
 */
export interface ElectronicSignaturePayload {
  name: string
  role?: string
  organization: OrganizationalEntity
  signedName?: string
  jurisdiction?: string
  legalIntent?: string
}

/**
 * Digital (document integrity) payload. JSF for CycloneDX 1.x,
 * X.509 for 2.x. publicKeyPem is required; privateKeyPem is never
 * accepted by the server. name and organization mirror the CycloneDX
 * signatory identity fields so a digital stored signature can produce
 * a spec conformant signatory at sign time. role is optional.
 */
export interface DigitalSignaturePayload {
  signatureFormat: 'jsf' | 'x509'
  signatureAlgorithm: string
  publicKeyPem: string
  certificateChain?: string
  name: string
  role?: string
  organization: OrganizationalEntity
}

export interface StoredSignatureImage {
  filename: string
  contentType: string
  sizeBytes: number
  contentHash: string
  storageProvider: string | null
}

export interface StoredSignature {
  id: string
  userId: string
  label: string
  signatureType: 'electronic' | 'digital'
  signatureFormat: 'jsf' | 'x509' | null
  backendType: 'local' | 'hsm' | 'signing_server'
  keyFingerprint: string | null
  payload: ElectronicSignaturePayload | DigitalSignaturePayload | null
  image: StoredSignatureImage | null
  createdAt: string
  updatedAt: string
}

export interface SignatureListResponse {
  data: StoredSignature[]
  warning: string | null
}

export interface CreateElectronicSignatureInput {
  signatureType: 'electronic'
  label: string
  backendType?: 'local' | 'hsm' | 'signing_server'
  payload: ElectronicSignaturePayload
}

export interface CreateDigitalSignatureInput {
  signatureType: 'digital'
  label: string
  backendType?: 'local' | 'hsm' | 'signing_server'
  payload: DigitalSignaturePayload
}

export type CreateSignatureInput =
  | CreateElectronicSignatureInput
  | CreateDigitalSignatureInput

export interface UpdateSignatureInput {
  label?: string
  payload?: Partial<ElectronicSignaturePayload> | Partial<DigitalSignaturePayload>
}

export interface UploadImageInput {
  filename: string
  contentType: string
  binaryContent: string
}

export async function listMySignatures(): Promise<SignatureListResponse> {
  const { data } = await client.get('/me/signatures')
  return data as SignatureListResponse
}

export async function createMySignature(payload: CreateSignatureInput): Promise<StoredSignature> {
  const { data } = await client.post('/me/signatures', payload)
  return data as StoredSignature
}

export async function updateMySignature(
  id: string,
  payload: UpdateSignatureInput,
): Promise<StoredSignature> {
  const { data } = await client.put(`/me/signatures/${encodeURIComponent(id)}`, payload)
  return data as StoredSignature
}

export async function deleteMySignature(id: string): Promise<void> {
  await client.delete(`/me/signatures/${encodeURIComponent(id)}`)
}

export async function uploadMySignatureImage(
  id: string,
  payload: UploadImageInput,
): Promise<void> {
  await client.post(`/me/signatures/${encodeURIComponent(id)}/image`, payload)
}

export async function deleteMySignatureImage(id: string): Promise<void> {
  await client.delete(`/me/signatures/${encodeURIComponent(id)}/image`)
}

/**
 * Build the image endpoint URL for an `<img :src>` binding. The URL is
 * served by the backend with cookie auth so no separate fetch is
 * needed in the browser.
 */
export function signatureImageUrl(id: string): string {
  return `/api/v1/me/signatures/${encodeURIComponent(id)}/image`
}
