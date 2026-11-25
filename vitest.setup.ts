// Integration tests never read the developer's .env: tests/helpers/payload.ts sets every
// variable Payload needs (secret, temporary database, temporary media directory).
process.env.PAYLOAD_SECRET ||= 'test-secret-not-for-production'
process.env.SEED_ON_INIT = 'false'
process.env.DISABLE_JOBS_AUTORUN = 'true'
