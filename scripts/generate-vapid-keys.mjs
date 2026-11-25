#!/usr/bin/env node
/**
 * Prints a fresh VAPID key pair for web push (`pnpm generate:vapid`), ready to paste into .env.
 *
 * VAPID keys are a P-256 (prime256v1) key pair: the public key is the uncompressed point
 * (0x04 || x || y) and the private key is the scalar d, both base64url-encoded. This uses
 * node:crypto, so no extra dependency is needed.
 */
import { generateKeyPairSync } from 'node:crypto'

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const pub = publicKey.export({ format: 'jwk' })
const priv = privateKey.export({ format: 'jwk' })

const point = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(pub.x, 'base64url'),
  Buffer.from(pub.y, 'base64url'),
])

console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${point.toString('base64url')}`)
console.log(`VAPID_PRIVATE_KEY=${priv.d}`)
console.log('VAPID_SUBJECT=mailto:hello@kiln.test')
