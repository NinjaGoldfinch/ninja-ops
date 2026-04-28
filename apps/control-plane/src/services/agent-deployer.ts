import { networkInterfaces } from 'os'
import { proxmoxService } from './proxmox.js'
import { childLogger } from '../lib/logger.js'
import { config } from '../config.js'
import { AppError } from '../errors.js'
import { JobLogger } from './job-logger.js'

const agentDeployerLog = childLogger('agent-deployer')

function resolveControlPlaneUrl(): string {
  if (config.CONTROL_PLANE_URL) return config.CONTROL_PLANE_URL

  // Auto-detect: find the first non-loopback IPv4 address on this host
  const nets = networkInterfaces()
  for (const iface of Object.values(nets)) {
    if (!iface) continue
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) {
        return `http://${net.address}:${config.PORT}`
      }
    }
  }

  throw AppError.internal(
    'Cannot determine CONTROL_PLANE_URL — no non-loopback IPv4 address found. Set CONTROL_PLANE_URL explicitly in your env.',
  )
}

interface ProxmoxCfg {
  host: string
  port: number
  tokenId: string
  tokenSecret: string
  nodeName: string
  sshUser?: string
  sshPassword?: string | null
  sshHost?: string | null
}

async function exec(
  cfg: ProxmoxCfg,
  vmid: number,
  command: string[],
  description: string,
  logger?: JobLogger,
): Promise<void> {
  const tag = `[agent-deployer] [${description}]`
  const logInfo = (msg: string) => logger ? logger.info(msg) : agentDeployerLog.info(msg)
  const logError = (msg: string) => logger ? logger.error(msg) : agentDeployerLog.error(msg)

  logInfo(`${tag} start: pct exec ${vmid} -- ${command.join(' ')}`)
  try {
    const exitCode = await proxmoxService.sshPctExecStreaming(
      cfg,
      vmid,
      command,
      (data) => logger ? logger.write('stdout', data) : process.stdout.write(`${tag} stdout: ${data}`),
      (data) => logger ? logger.write('stderr', data) : process.stderr.write(`${tag} stderr: ${data}`),
    )
    if (exitCode !== 0) {
      throw AppError.internal(`pct exec exited ${exitCode}`)
    }
    logInfo(`${tag} done (exit 0)`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError(`${tag} failed: ${msg}`)
    throw AppError.internal(`Agent deployment step failed: ${description} — ${msg}`)
  }
}

export async function deployAgentIntoLxc(
  cfg: ProxmoxCfg,
  vmid: number,
  nodeId: string,
  logger?: JobLogger,
): Promise<void> {
  const controlPlaneUrl = resolveControlPlaneUrl()

  // Step 0 — ensure locale is configured (avoids perl/apt warnings in LXC containers)
  // Non-fatal: locale warnings don't prevent the agent from running
  await exec(
    cfg, vmid,
    ['bash', '-c',
      'apt-get install -y -qq locales 2>/dev/null && ' +
      'locale-gen en_US.UTF-8 2>/dev/null && ' +
      'update-locale LANG=en_US.UTF-8 2>/dev/null || true',
    ],
    'configure locale',
    logger,
  ).catch(() => {
    const warn = '[agent-deployer] locale setup skipped (non-fatal)\n'
    if (logger) { logger.write('stderr', warn) } else { process.stderr.write(warn) }
  })

  // Step 1 — detect Node.js; install if missing
  const hasNode = await exec(cfg, vmid, ['node', '--version'], 'check Node.js', logger).then(() => true).catch(() => false)
  if (!hasNode) {
    await exec(
      cfg, vmid,
      ['bash', '-c',
        'apt-get update -qq && apt-get install -y -qq curl && ' +
        'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && ' +
        'apt-get install -y -qq -o DPkg::Lock::Timeout=60 nodejs',
      ],
      'install Node.js 22',
      logger,
    )
  }

  // Step 2 — create agent directory
  await exec(cfg, vmid, ['mkdir', '-p', '/opt/ninja-agent'], 'create agent directory', logger)

  // Step 3 — download agent archive
  await exec(
    cfg, vmid,
    ['bash', '-c', `curl -fsSL ${controlPlaneUrl}/api/agents/download -o /opt/ninja-agent/agent.tar.gz`],
    'download agent archive',
    logger,
  )

  // Step 4 — extract (bundle is a single index.js at the tarball root)
  await exec(
    cfg, vmid,
    ['bash', '-c', 'tar -xzf /opt/ninja-agent/agent.tar.gz -C /opt/ninja-agent'],
    'extract agent archive',
    logger,
  )

  // Step 5 — write .env
  // Base64-encode content so newlines survive pct exec argument passing
  const envContent = [
    `NODE_ID=${nodeId}`,
    `VMID=${vmid}`,
    `CONTROL_PLANE_URL=${controlPlaneUrl}`,
    `AGENT_SECRET=${config.AGENT_SECRET}`,
  ].join('\n') + '\n'
  const envB64 = Buffer.from(envContent).toString('base64')

  await exec(
    cfg, vmid,
    ['bash', '-c', `echo '${envB64}' | base64 -d > /opt/ninja-agent/.env`],
    'write .env file',
    logger,
  )

  // Step 6 — write systemd unit
  const unitContent = [
    '[Unit]',
    'Description=Ninja Deploy Agent',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    'WorkingDirectory=/opt/ninja-agent',
    'EnvironmentFile=/opt/ninja-agent/.env',
    'ExecStart=/usr/bin/node /opt/ninja-agent/index.js',
    'Restart=always',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
  ].join('\n') + '\n'
  const unitB64 = Buffer.from(unitContent).toString('base64')

  await exec(
    cfg, vmid,
    ['bash', '-c', `echo '${unitB64}' | base64 -d > /etc/systemd/system/ninja-agent.service`],
    'write systemd unit',
    logger,
  )

  // Step 7 — enable and start
  await exec(
    cfg, vmid,
    ['bash', '-c', 'systemctl daemon-reload && systemctl enable ninja-agent && systemctl start ninja-agent'],
    'enable and start agent service',
    logger,
  )
}

export async function deployLogAgentIntoLxc(
  cfg: ProxmoxCfg,
  vmid: number,
  nodeId: string,
  logUnits: string,
  logger?: JobLogger,
): Promise<void> {
  const controlPlaneUrl = resolveControlPlaneUrl()

  // Step 0 — locale (non-fatal, same as deploy-agent)
  await exec(
    cfg, vmid,
    ['bash', '-c',
      'apt-get install -y -qq locales 2>/dev/null && ' +
      'locale-gen en_US.UTF-8 2>/dev/null && ' +
      'update-locale LANG=en_US.UTF-8 2>/dev/null || true',
    ],
    'configure locale',
    logger,
  ).catch(() => {
    const warn = '[log-agent-deployer] locale setup skipped (non-fatal)\n'
    if (logger) { logger.write('stderr', warn) } else { process.stderr.write(warn) }
  })

  // Step 1 — detect Node.js; install if missing
  const hasNode = await exec(cfg, vmid, ['node', '--version'], 'check Node.js', logger).then(() => true).catch(() => false)
  if (!hasNode) {
    await exec(
      cfg, vmid,
      ['bash', '-c',
        'apt-get update -qq && apt-get install -y -qq curl && ' +
        'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && ' +
        'apt-get install -y -qq -o DPkg::Lock::Timeout=60 nodejs',
      ],
      'install Node.js 22',
      logger,
    )
  }

  // Step 2 — create directories
  await exec(cfg, vmid, ['mkdir', '-p', '/opt/ninja-log-agent'], 'create log-agent directory', logger)

  // Step 3 — download log-agent archive
  await exec(
    cfg, vmid,
    ['bash', '-c', `curl -fsSL ${controlPlaneUrl}/api/log-agents/download -o /opt/ninja-log-agent/log-agent.tar.gz`],
    'download log-agent archive',
    logger,
  )

  // Step 4 — extract
  await exec(
    cfg, vmid,
    ['bash', '-c', 'tar -xzf /opt/ninja-log-agent/log-agent.tar.gz -C /opt/ninja-log-agent'],
    'extract log-agent archive',
    logger,
  )

  // Step 5 — write .env
  const envContent = [
    `NODE_ID=${nodeId}`,
    `VMID=${vmid}`,
    `CONTROL_PLANE_URL=${controlPlaneUrl}`,
    `AGENT_SECRET=${config.AGENT_SECRET}`,
    ...(logUnits ? [`LOG_UNITS=${logUnits}`] : []),
  ].join('\n') + '\n'
  const envB64 = Buffer.from(envContent).toString('base64')

  await exec(
    cfg, vmid,
    ['bash', '-c', `echo '${envB64}' | base64 -d > /opt/ninja-log-agent/.env`],
    'write .env file',
    logger,
  )

  // Step 6 — write systemd unit
  const unitContent = [
    '[Unit]',
    'Description=ninja-ops log-agent',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    'WorkingDirectory=/opt/ninja-log-agent',
    'EnvironmentFile=/opt/ninja-log-agent/.env',
    'ExecStart=/usr/bin/node /opt/ninja-log-agent/index.js',
    'Restart=always',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
  ].join('\n') + '\n'
  const unitB64 = Buffer.from(unitContent).toString('base64')

  await exec(
    cfg, vmid,
    ['bash', '-c', `echo '${unitB64}' | base64 -d > /etc/systemd/system/ninja-log-agent.service`],
    'write systemd unit',
    logger,
  )

  // Step 7 — enable and start
  await exec(
    cfg, vmid,
    ['bash', '-c', 'systemctl daemon-reload && systemctl enable ninja-log-agent && systemctl start ninja-log-agent'],
    'enable and start log-agent service',
    logger,
  )
}
