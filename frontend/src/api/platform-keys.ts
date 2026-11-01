import client from './client'

/**
 * Admin API for the platform signing keys used by the affirmation
 * seal ceremony. The private half of a key never crosses the wire;
 * responses carry only the public PEM and metadata.
 *
 * Historic keys are retained after rotation so envelopes sealed
 * before the rotation still verify by fingerprint lookup.
 */

export interface PlatformKeyPublic {
  id: string
  fingerprint: string
  algorithm: string
  publicKeyPem: string
  isActive: boolean
  rotatedAt: string | null
  rotatedBy: string | null
  createdAt: string
}

export type PlatformKeyAlgorithm =
  | 'Ed25519'
  | 'Ed448'
  | 'ES256'
  | 'ES384'
  | 'ES512'
  | 'RS256'
  | 'RS384'
  | 'RS512'
  | 'PS256'
  | 'PS384'
  | 'PS512'

export async function listPlatformKeys(): Promise<PlatformKeyPublic[]> {
  const { data } = await client.get<{ data: PlatformKeyPublic[] }>(
    '/admin/platform-keys',
  )
  return data.data
}

export async function rotatePlatformKey(
  algorithm?: PlatformKeyAlgorithm,
): Promise<PlatformKeyPublic> {
  const body = algorithm ? { algorithm } : {}
  const { data } = await client.post<{ data: PlatformKeyPublic }>(
    '/admin/platform-keys/rotate',
    body,
  )
  return data.data
}
