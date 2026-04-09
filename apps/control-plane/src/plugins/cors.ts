import fp from 'fastify-plugin'
import cors from '@fastify/cors'
import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'

export default fp(async function corsPlugin(app: FastifyInstance) {
  const origins = config.CORS_ORIGIN
    ? config.CORS_ORIGIN.split(',').map(o => o.trim())
    : false

  await app.register(cors, {
    origin: origins,
    credentials: true,
  })
})
