import fp from 'fastify-plugin'
import swagger from '@fastify/swagger'
import scalar from '@scalar/fastify-api-reference'
import type { FastifyInstance } from 'fastify'

export default fp(async function swaggerPlugin(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Ninja Ops — Control Plane API',
        version: '0.1.0',
        description: 'Proxmox management and deployment platform',
      },
      tags: [
        { name: 'auth', description: 'Authentication' },
        { name: 'nodes', description: 'Proxmox nodes' },
        { name: 'guests', description: 'VMs and LXC containers' },
        { name: 'deploy', description: 'Deploy targets and jobs' },
        { name: 'agents', description: 'Deploy agents' },
        { name: 'webhooks', description: 'External webhooks' },
        { name: 'audit', description: 'Audit log' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  })

  // Scalar picks up the spec automatically from @fastify/swagger
  await app.register(scalar, {
    routePrefix: '/api/docs',
  })
})
