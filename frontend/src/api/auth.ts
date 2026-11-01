import client from './client'
import type { User } from '@/types'

export interface LoginResponse {
  user: User
  permissions?: string[]
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const { data } = await client.post('/auth/login', { username, password })
  return data
}

export async function logout(): Promise<void> {
  await client.post('/auth/logout')
}

export async function getCurrentUser(): Promise<User & { permissions?: string[] }> {
  const { data } = await client.get('/auth/me')
  // The /auth/me endpoint returns { user, permissions } as sibling
  // fields. The auth store reads permissions from the returned value,
  // so fold the sibling permissions array into the user-shaped object
  // the caller expects. Dropping this merge silently strips every
  // permission on every /auth/me round trip and causes the sidebar
  // and route guards to treat the user as if they held no role.
  return { ...data.user, permissions: data.permissions }
}

export interface PasswordPolicy {
  minLength: number
  maxLength: number
}

// Public endpoint. Intentionally exposes only the bounds the UI
// needs for placeholder copy and client-side length validation.
// The server keeps the deny list and breach check configuration
// private so an attacker cannot pre filter their guessing corpus.
export async function getPasswordPolicy(): Promise<PasswordPolicy> {
  const { data } = await client.get('/auth/password-policy')
  return data
}

// Public. The server answers the same way whether or not the address
// belongs to an account.
export async function requestPasswordReset(email: string): Promise<void> {
  await client.post('/auth/forgot-password', { email })
}

// Public. The token comes from the emailed link.
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await client.post('/auth/reset-password', { token, newPassword })
}
