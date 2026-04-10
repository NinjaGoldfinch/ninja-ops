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
        {
          name: 'auth',
          description:
            'Issue and manage user sessions. `POST /login` returns a signed JWT; include it as ' +
            '`Authorization: Bearer <token>` on every subsequent request. ' +
            'Tokens expire after `JWT_EXPIRY` (default 24 h).',
        },
        {
          name: 'nodes',
          description:
            'Register and manage Proxmox VE nodes. Each node stores the API token used to ' +
            'communicate with Proxmox (token secret is AES-256-GCM encrypted at rest). ' +
            'Requires **admin** role to create, update, or delete; **viewer** can list.',
        },
        {
          name: 'guests',
          description:
            'Inspect and control VMs and LXC containers on a registered node. ' +
            'Supports power actions (start, stop, reboot, suspend, resume), ' +
            'snapshot management, and live metrics via WebSocket subscription.',
        },
        {
          name: 'deploy',
          description:
            'Manage deploy targets and run deployments. A **target** maps a GitHub repository + ' +
            'branch to a specific container on a node. A **job** is a single deploy run — ' +
            'triggered manually, by the CLI, or automatically via the GitHub webhook. ' +
            'Job output is streamed in real time over the `/ws` WebSocket channel.',
        },
        {
          name: 'agents',
          description:
            'View and manage registered deploy agents. An agent runs inside each managed ' +
            'container, authenticates with `AGENT_SECRET`, and receives deploy commands over ' +
            'the `/ws/agent` WebSocket channel. Requires **admin** role.',
        },
        {
          name: 'webhooks',
          description:
            'Inbound webhook endpoints for external services. The GitHub endpoint verifies ' +
            'the `X-Hub-Signature-256` HMAC header, matches the `workflow_run` event to a ' +
            'deploy target by repository + branch, and enqueues a deploy job on success.',
        },
        {
          name: 'audit',
          description:
            'Paginated, immutable log of all significant actions taken through the API — ' +
            'logins, node changes, deploy triggers, power actions, and more. ' +
            'Each entry records the acting user, their IP address, and relevant metadata. ' +
            'Read-only; requires **admin** role.',
        },
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
