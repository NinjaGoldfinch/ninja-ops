// Test setup: configure environment variables for tests before any imports
process.env['DATABASE_URL'] = process.env['DATABASE_URL'] ?? 'postgres://ninja:ninja@localhost:5432/ninja_ops_test'
process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379'
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test_secret_must_be_at_least_32_characters_long_for_validation'
process.env['ENCRYPTION_KEY'] = process.env['ENCRYPTION_KEY'] ?? 'a'.repeat(64)
process.env['AGENT_SECRET'] = process.env['AGENT_SECRET'] ?? 'test_agent_secret_must_be_at_least_32_chars_long'
process.env['GITHUB_WEBHOOK_SECRET'] = process.env['GITHUB_WEBHOOK_SECRET'] ?? 'test_webhook_secret'
