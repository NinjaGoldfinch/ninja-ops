import { createRouter } from '@tanstack/react-router'
import { rootRoute } from './root-route'
import { layoutRoute } from './layout-route'
import { loginRoute } from './pages/login'
import { indexRoute } from './pages/index'
import { nodesRoute } from './pages/nodes/index'
import { nodeIdRoute } from './pages/nodes/$nodeId/route'
import { nodeDetailRoute } from './pages/nodes/$nodeId/index'
import { guestDetailRoute } from './pages/nodes/$nodeId/guests/$vmid'
import { deployRoute } from './pages/deploy/index'
import { newTargetRoute } from './pages/deploy/targets/new'
import { deployJobsRoute } from './pages/deploy/jobs/index'
import { jobDetailRoute } from './pages/deploy/jobs/$jobId'
import { agentsRoute } from './pages/agents/index'
import { auditRoute } from './pages/audit/index'
import { settingsRoute } from './pages/settings/index'

const routeTree = rootRoute.addChildren([
  loginRoute,
  layoutRoute.addChildren([
    indexRoute,
    nodesRoute,
    nodeIdRoute.addChildren([nodeDetailRoute, guestDetailRoute]),
    deployRoute,
    newTargetRoute,
    deployJobsRoute,
    jobDetailRoute,
    agentsRoute,
    auditRoute,
    settingsRoute,
  ]),
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
