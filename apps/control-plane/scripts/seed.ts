import postgres from 'postgres'
import bcrypt from 'bcrypt'

const databaseUrl = process.env['DATABASE_URL']
if (!databaseUrl) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const username = process.env['ADMIN_USERNAME'] ?? 'admin'
const password = process.env['ADMIN_PASSWORD'] ?? 'changeme123!'

const sql = postgres(databaseUrl)

async function seed() {
  const hash = await bcrypt.hash(password, 12)

  const existing = await sql<{ id: string }[]>`
    SELECT id FROM users WHERE username = ${username}
  `

  if (existing.length > 0) {
    console.log(`User '${username}' already exists — skipping seed.`)
  } else {
    await sql`
      INSERT INTO users (username, password, role)
      VALUES (${username}, ${hash}, 'admin')
    `
    console.log(`Created admin user: ${username}`)
  }

  await sql.end()
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
