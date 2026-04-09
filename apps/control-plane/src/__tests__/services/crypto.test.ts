import { describe, it, expect } from 'vitest'
import { CryptoService } from '../../services/crypto.js'

describe('CryptoService', () => {
  const service = new CryptoService()

  it('encrypts and decrypts a plaintext string', () => {
    const plaintext = 'super-secret-token-value'
    const encrypted = service.encrypt(plaintext)
    expect(encrypted).not.toBe(plaintext)
    expect(encrypted.split(':')).toHaveLength(3)

    const decrypted = service.decrypt(encrypted)
    expect(decrypted).toBe(plaintext)
  })

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const plaintext = 'same-input'
    const enc1 = service.encrypt(plaintext)
    const enc2 = service.encrypt(plaintext)
    expect(enc1).not.toBe(enc2)
    expect(service.decrypt(enc1)).toBe(plaintext)
    expect(service.decrypt(enc2)).toBe(plaintext)
  })

  it('throws on tampered ciphertext', () => {
    const encrypted = service.encrypt('original')
    const parts = encrypted.split(':')
    // Corrupt the ciphertext portion
    parts[2] = 'deadbeef'
    const tampered = parts.join(':')
    expect(() => service.decrypt(tampered)).toThrow()
  })

  it('throws on invalid format', () => {
    expect(() => service.decrypt('not-valid')).toThrow('Invalid encrypted value format')
  })
})
