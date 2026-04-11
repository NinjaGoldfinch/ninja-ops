import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { config } from '../config.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const _AUTH_TAG_LENGTH = 16 // AES-256-GCM produces a 16-byte auth tag

function getKey(): Buffer {
  return Buffer.from(config.ENCRYPTION_KEY, 'hex')
}

export class CryptoService {
  encrypt(plaintext: string): string {
    const key = getKey()
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, key, iv)

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()

    // Format: iv_hex:authTag_hex:ciphertext_hex
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
  }

  decrypt(stored: string): string {
    const parts = stored.split(':')
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted value format')
    }
    const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string]

    const key = getKey()
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    const ciphertext = Buffer.from(ciphertextHex, 'hex')

    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    return decipher.update(ciphertext) + decipher.final('utf8')
  }
}

export const cryptoService = new CryptoService()
