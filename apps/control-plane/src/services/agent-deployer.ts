import { networkInterfaces } from 'os'
import { proxmoxService } from './proxmox.js'
import { config } from '../config.js'
import { AppError } from '../errors.js'

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
}

async function exec(
  cfg: ProxmoxCfg,
  vmid: number,
  command: string[],
  description: string,
): Promise<void> {
  const { upid } = await proxmoxService.execInLxc(cfg, vmid, command)
  await proxmoxService.waitForTask(cfg, upid, { timeoutMs: 120_000 })
    .catch(() => {
      throw AppError.internal(`Agent deployment step failed: ${description}`)
    })
}

export async function deployAgentIntoLxc(
  cfg: ProxmoxCfg,
  vmid: number,
  nodeId: string,
): Promise<void> {
  const controlPlaneUrl = resolveControlPlaneUrl()

  // Step 1 — detect Node.js; install if missing
  const nodeCheck = await proxmoxService.execInLxc(cfg, vmid, ['node', '--version'])
  try {
    await proxmoxService.waitForTask(cfg, nodeCheck.upid, { timeoutMs: 15_000 })
  } catch {
    // Node.js not found — install it
    await exec(
      cfg, vmid,
      ['bash', '-c',
        'apt-get update -qq && apt-get install -y -qq curl && ' +
        'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && ' +
        'apt-get install -y -qq nodejs',
      ],
      'install Node.js 22',
    )
  }

  // Step 2 — create agent directory
  await exec(cfg, vmid, ['mkdir', '-p', '/opt/ninja-agent'], 'create agent directory')

  // Step 3 — download agent archive
  await exec(
    cfg, vmid,
    ['bash', '-c', `curl -fsSL ${controlPlaneUrl}/api/agents/download -o /opt/ninja-agent/agent.tar.gz`],
    'download agent archive',
  )

  // Step 4 — extract
  await exec(
    cfg, vmid,
    ['bash', '-c', 'cd /opt/ninja-agent && tar -xzf agent.tar.gz --strip-components=1'],
    'extract agent archive',
  )

  // Step 5 — write .env
  const envContent = [
    `NODE_ID=${nodeId}`,
    `VMID=${vmid}`,
    `CONTROL_PLANE_URL=${controlPlaneUrl}`,
    `AGENT_SECRET=${config.AGENT_SECRET}`,
  ].join('\n')

  await exec(
    cfg, vmid,
    ['bash', '-c', `cat > /opt/ninja-agent/.env << 'ENVEOF'\n${envContent}\nENVEOF`],
    'write .env file',
  )

  // Step 6 — write systemd unit
  const unit = [
    '[Unit]',
    'Description=Ninja Deploy Agent',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    'WorkingDirectory=/opt/ninja-agent',
    'EnvironmentFile=/opt/ninja-agent/.env',
    'ExecStart=/usr/bin/node /opt/ninja-agent/dist/index.js',
    'Restart=always',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
  ].join('\n')

  await exec(
    cfg, vmid,
    ['bash', '-c', `cat > /etc/systemd/system/ninja-agent.service << 'UNITEOF'\n${unit}\nUNITEOF`],
    'write systemd unit',
  )

  // Step 7 — enable and start
  await exec(
    cfg, vmid,
    ['bash', '-c', 'systemctl daemon-reload && systemctl enable ninja-agent && systemctl start ninja-agent'],
    'enable and start agent service',
  )
}
