# infrastructure/ — Ansible Design Document

Ansible playbooks and roles for provisioning all ninja-ops LXC containers on Proxmox VE.
Covers: PostgreSQL, Redis, control-plane, dashboard, and app containers (deploy-agent).

No code changes to any app are required. All services already read connection details
from environment variables. This layer just provisions containers and writes those vars.

---

## 0. Prerequisites (on the control machine — your local workstation)

```bash
pip install ansible ansible-lint
ansible-galaxy collection install community.general community.postgresql
```

Required on every target LXC before Ansible can connect:
- SSH server running (`openssh-server`)
- Python 3 installed (`python3`)
- A user Ansible can SSH in as (root is fine for initial bootstrap)

Proxmox tip: when creating LXCs, use the Debian 12 template and tick
"Start after creation". Ansible will handle everything from that point.

---

## 1. Repository structure

```
infrastructure/
├── ansible.cfg               — Ansible config (inventory path, SSH settings)
├── inventory/
│   └── hosts.yml             — All containers, grouped by role
├── group_vars/
│   ├── all/
│   │   ├── vars.yml          — Non-secret shared variables
│   │   └── vault.yml         — ansible-vault encrypted secrets
│   ├── postgres/
│   │   └── vars.yml
│   ├── redis/
│   │   └── vars.yml
│   ├── control_plane/
│   │   └── vars.yml
│   ├── dashboard/
│   │   └── vars.yml
│   └── apps/
│       └── vars.yml
├── roles/
│   ├── base/
│   ├── postgres/
│   ├── redis/
│   ├── control-plane/
│   ├── dashboard/
│   ├── deploy-agent/
│   └── app/
└── playbooks/
    ├── bootstrap.yml         — Full first-time provisioning
    ├── update-agent.yml      — Update deploy-agent binary only
    ├── update-platform.yml   — Redeploy control-plane + dashboard
    └── verify.yml            — Smoke-test all services are responding
```

---

## 2. `ansible.cfg`

```ini
[defaults]
inventory           = inventory/hosts.yml
remote_user         = root
host_key_checking   = False
stdout_callback     = yaml
callback_whitelist  = profile_tasks

[ssh_connection]
pipelining          = True
ssh_args            = -o ControlMaster=auto -o ControlPersist=60s
```

`pipelining = True` significantly speeds up execution by reducing the number of SSH
connections needed per task.

---

## 3. `inventory/hosts.yml`

```yaml
all:
  vars:
    # Internal bridge network — all containers communicate on this
    internal_network: 10.0.0.0/24

  children:

    # ── Infrastructure services ───────────────────────────────────────────
    infrastructure:
      children:
        postgres:
          hosts:
            postgres-01:
              ansible_host: 10.0.0.10
              vmid: 200
        redis:
          hosts:
            redis-01:
              ansible_host: 10.0.0.11
              vmid: 201

    # ── Platform services ─────────────────────────────────────────────────
    platform:
      children:
        control_plane:
          hosts:
            control-plane-01:
              ansible_host: 10.0.0.20
              vmid: 202
              # Port exposed via reverse proxy
              app_port: 3000
        dashboard:
          hosts:
            dashboard-01:
              ansible_host: 10.0.0.21
              vmid: 203
              # Caddy serves on 80/443
              control_plane_url: http://10.0.0.20:3000

    # ── App containers (each runs deploy-agent + the app itself) ──────────
    apps:
      hosts:
        skyblock-api-01:
          ansible_host: 10.0.0.30
          vmid: 101
          app_repo: NinjaGoldfinch/ninja-skyblock-api
          app_branch: main
          working_dir: /opt/skyblock-api
          restart_command: systemctl restart skyblock-api
          app_port: 8080
```

Add new app containers by appending to the `apps` section. Everything else is automatic.

---

## 4. Variables

### 4.1 `group_vars/all/vars.yml` — non-secret shared config

```yaml
# Node.js version installed on every container that needs it
node_version: "22"

# Service user created on every container
service_user: ninja
service_group: ninja
service_home: /home/ninja

# Postgres connection details (non-secret parts)
postgres_host: 10.0.0.10
postgres_port: 5432
postgres_db: ninja_ops
postgres_user: ninja

# Redis connection details (non-secret parts)
redis_host: 10.0.0.11
redis_port: 6379

# Control plane
control_plane_host: 10.0.0.20
control_plane_port: 3000
control_plane_url: "http://{{ control_plane_host }}:{{ control_plane_port }}"

# GitHub — org/repo for the main platform (not app repos)
platform_repo: NinjaGoldfinch/ninja-ops
platform_branch: main

# Agent JWT expiry
agent_jwt_expiry: 7d
```

### 4.2 `group_vars/all/vault.yml` — encrypted secrets

Create with: `ansible-vault create group_vars/all/vault.yml`
Edit later with: `ansible-vault edit group_vars/all/vault.yml`

```yaml
# Database
vault_postgres_password: "CHANGE_ME_strong_password_here"

# Redis (leave empty string to disable Redis auth — fine on isolated network)
vault_redis_password: ""

# Control plane secrets — generate with:
#   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
vault_jwt_secret: "CHANGE_ME_64_hex_chars"
vault_encryption_key: "CHANGE_ME_32_bytes_as_64_hex_chars"
vault_agent_secret: "CHANGE_ME_64_hex_chars"
vault_github_webhook_secret: "CHANGE_ME_random_string"

# GitHub Personal Access Token (for cloning private repos)
vault_github_token: "ghp_CHANGE_ME"
```

**Never commit the unencrypted vault file. The encrypted version is safe to commit.**

Store the vault password in your password manager. You can also save it to
`.vault_password` (gitignored) and set `vault_password_file = .vault_password` in
`ansible.cfg` so you don't have to type it on every run.

Add `.vault_password` to `.gitignore`:
```
.vault_password
```

---

## 5. Roles

### 5.1 `roles/base/`

Runs on every container. Handles OS hardening and shared tooling.

**Tasks (`tasks/main.yml`):**
```yaml
- name: Update apt cache and upgrade packages
  apt:
    update_cache: yes
    upgrade: safe
    cache_valid_time: 3600

- name: Install common packages
  apt:
    name:
      - curl
      - git
      - ca-certificates
      - gnupg
      - ufw
      - fail2ban
      - logrotate
      - htop
    state: present

- name: Create service user
  user:
    name: "{{ service_user }}"
    group: "{{ service_group }}"
    home: "{{ service_home }}"
    shell: /bin/bash
    system: yes
    create_home: yes

- name: Install Node.js {{ node_version }}
  # Uses NodeSource setup script
  block:
    - name: Add NodeSource GPG key
      apt_key:
        url: https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key
    - name: Add NodeSource repository
      apt_repository:
        repo: "deb https://deb.nodesource.com/node_{{ node_version }}.x nodistro main"
    - name: Install nodejs
      apt:
        name: nodejs
        state: present

- name: Install pnpm globally
  npm:
    name: pnpm
    global: yes
    state: present

- name: Configure UFW — deny all inbound by default
  ufw:
    state: enabled
    policy: deny
    direction: incoming

- name: Configure UFW — allow SSH
  ufw:
    rule: allow
    port: "22"
    proto: tcp

- name: Configure UFW — allow internal network
  ufw:
    rule: allow
    src: "{{ internal_network }}"
```

**Not run** on containers that don't need Node (postgres, redis) — those skip
the Node tasks via a `when: inventory_hostname not in groups['infrastructure']` condition,
or more cleanly by only including base in the playbook for those groups without the node tasks.

### 5.2 `roles/postgres/`

**Tasks:**
```yaml
- name: Install PostgreSQL 16
  block:
    - name: Add PostgreSQL apt key
      apt_key:
        url: https://www.postgresql.org/media/keys/ACCC4CF8.asc
    - name: Add PostgreSQL repository
      apt_repository:
        repo: "deb http://apt.postgresql.org/pub/repos/apt {{ ansible_distribution_release }}-pgdg main"
    - name: Install postgresql-16
      apt:
        name: postgresql-16
        state: present

- name: Ensure PostgreSQL is started and enabled
  systemd:
    name: postgresql
    state: started
    enabled: yes

- name: Create ninja_ops database
  become_user: postgres
  community.postgresql.postgresql_db:
    name: "{{ postgres_db }}"
    state: present

- name: Create ninja database user
  become_user: postgres
  community.postgresql.postgresql_user:
    name: "{{ postgres_user }}"
    password: "{{ vault_postgres_password }}"
    db: "{{ postgres_db }}"
    priv: ALL
    state: present

- name: Configure pg_hba.conf — allow ninja user from internal network only
  community.postgresql.postgresql_pg_hba:
    dest: /etc/postgresql/16/main/pg_hba.conf
    contype: host
    databases: "{{ postgres_db }}"
    users: "{{ postgres_user }}"
    source: "{{ internal_network }}"
    method: md5
  notify: restart postgresql

- name: Configure postgresql.conf — listen on internal IP only
  lineinfile:
    path: /etc/postgresql/16/main/postgresql.conf
    regexp: "^#?listen_addresses"
    line: "listen_addresses = '{{ ansible_host }}'"
  notify: restart postgresql

- name: UFW — allow PostgreSQL from internal network
  ufw:
    rule: allow
    port: "5432"
    src: "{{ internal_network }}"
    proto: tcp
```

**Handlers (`handlers/main.yml`):**
```yaml
- name: restart postgresql
  systemd:
    name: postgresql
    state: restarted
```

### 5.3 `roles/redis/`

**Tasks:**
```yaml
- name: Install Redis
  apt:
    name: redis-server
    state: present

- name: Configure Redis — bind to internal IP only
  lineinfile:
    path: /etc/redis/redis.conf
    regexp: "^bind "
    line: "bind 127.0.0.1 {{ ansible_host }}"
  notify: restart redis

- name: Configure Redis — enable AOF persistence
  lineinfile:
    path: /etc/redis/redis.conf
    regexp: "^appendonly "
    line: "appendonly yes"
  notify: restart redis

- name: Configure Redis — set maxmemory policy
  lineinfile:
    path: /etc/redis/redis.conf
    regexp: "^#?maxmemory-policy"
    line: "maxmemory-policy noeviction"
  notify: restart redis

- name: Configure Redis password (if set)
  lineinfile:
    path: /etc/redis/redis.conf
    regexp: "^#?requirepass"
    line: "requirepass {{ vault_redis_password }}"
  when: vault_redis_password | length > 0
  notify: restart redis

- name: Ensure Redis is started and enabled
  systemd:
    name: redis-server
    state: started
    enabled: yes

- name: UFW — allow Redis from internal network
  ufw:
    rule: allow
    port: "6379"
    src: "{{ internal_network }}"
    proto: tcp
```

### 5.4 `roles/control-plane/`

**Templates (`templates/`):**

`env.j2` — rendered into `apps/control-plane/.env`:
```jinja
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info

DATABASE_URL=postgres://{{ postgres_user }}:{{ vault_postgres_password }}@{{ postgres_host }}:{{ postgres_port }}/{{ postgres_db }}
REDIS_URL=redis://:{{ vault_redis_password }}@{{ redis_host }}:{{ redis_port }}

JWT_SECRET={{ vault_jwt_secret }}
JWT_EXPIRY=24h

ENCRYPTION_KEY={{ vault_encryption_key }}

AGENT_SECRET={{ vault_agent_secret }}
AGENT_JWT_EXPIRY={{ agent_jwt_expiry }}

GITHUB_WEBHOOK_SECRET={{ vault_github_webhook_secret }}

CORS_ORIGIN=http://{{ hostvars[groups['dashboard'][0]]['ansible_host'] }}
```

`control-plane.service.j2` — systemd unit:
```jinja
[Unit]
Description=ninja-ops control-plane
After=network.target
Wants=network-online.target

[Service]
Type=simple
User={{ service_user }}
WorkingDirectory={{ service_home }}/ninja-ops/apps/control-plane
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
EnvironmentFile={{ service_home }}/ninja-ops/apps/control-plane/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**Tasks:**
```yaml
- name: Clone ninja-ops repo
  git:
    repo: "https://{{ vault_github_token }}@github.com/{{ platform_repo }}.git"
    dest: "{{ service_home }}/ninja-ops"
    version: "{{ platform_branch }}"
    force: yes
  become_user: "{{ service_user }}"

- name: Install dependencies
  command:
    cmd: pnpm install --frozen-lockfile
    chdir: "{{ service_home }}/ninja-ops"
  become_user: "{{ service_user }}"

- name: Build packages/types
  command:
    cmd: pnpm --filter @ninja/types build
    chdir: "{{ service_home }}/ninja-ops"
  become_user: "{{ service_user }}"

- name: Build control-plane
  command:
    cmd: pnpm --filter @ninja/control-plane build
    chdir: "{{ service_home }}/ninja-ops"
  become_user: "{{ service_user }}"

- name: Write .env file
  template:
    src: env.j2
    dest: "{{ service_home }}/ninja-ops/apps/control-plane/.env"
    owner: "{{ service_user }}"
    mode: "0600"

- name: Run database migrations
  command:
    cmd: pnpm --filter @ninja/control-plane db:migrate
    chdir: "{{ service_home }}/ninja-ops"
  environment:
    DATABASE_URL: "postgres://{{ postgres_user }}:{{ vault_postgres_password }}@{{ postgres_host }}:{{ postgres_port }}/{{ postgres_db }}"
  become_user: "{{ service_user }}"

- name: Install systemd service
  template:
    src: control-plane.service.j2
    dest: /etc/systemd/system/control-plane.service
  notify:
    - reload systemd
    - restart control-plane

- name: Enable and start control-plane
  systemd:
    name: control-plane
    state: started
    enabled: yes

- name: UFW — allow control-plane port from internal network
  ufw:
    rule: allow
    port: "{{ app_port }}"
    src: "{{ internal_network }}"
    proto: tcp
```

### 5.5 `roles/dashboard/`

Builds the React app and serves it via Caddy.

**Templates:**

`Caddyfile.j2`:
```jinja
:80 {
    root * {{ service_home }}/ninja-ops/apps/dashboard/dist
    file_server
    try_files {path} /index.html

    # Proxy API and WebSocket to control plane
    handle /api/* {
        reverse_proxy {{ control_plane_url }}
    }
    handle /ws* {
        reverse_proxy {{ control_plane_url }}
    }
}
```

**Tasks:**
```yaml
- name: Install Caddy
  block:
    - apt_key: url=https://dl.cloudsmith.io/public/caddy/stable/gpg.key
    - apt_repository:
        repo: "deb https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main"
    - apt: name=caddy state=present

- name: Clone repo and install dependencies
  # Same git + pnpm install as control-plane role

- name: Build dashboard
  command:
    cmd: pnpm --filter @ninja/dashboard build
    chdir: "{{ service_home }}/ninja-ops"
  environment:
    VITE_API_URL: "{{ control_plane_url }}"
  become_user: "{{ service_user }}"

- name: Write Caddyfile
  template:
    src: Caddyfile.j2
    dest: /etc/caddy/Caddyfile
  notify: reload caddy

- name: Ensure Caddy is started and enabled
  systemd:
    name: caddy
    state: started
    enabled: yes
```

### 5.6 `roles/deploy-agent/`

Installs the deploy-agent on each app container and registers it with the control plane.

**Templates:**

`agent.env.j2`:
```jinja
CONTROL_PLANE_URL={{ control_plane_url }}
AGENT_SECRET={{ vault_agent_secret }}
NODE_ID={{ node_uuid }}
VMID={{ vmid }}
HOSTNAME={{ inventory_hostname }}
```

`deploy-agent.service.j2`:
```jinja
[Unit]
Description=ninja-ops deploy-agent
After=network.target

[Service]
Type=simple
User={{ service_user }}
WorkingDirectory={{ service_home }}/ninja-ops/apps/deploy-agent
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
EnvironmentFile={{ service_home }}/ninja-ops/apps/deploy-agent/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**Tasks:**
```yaml
- name: Clone repo
  git:
    repo: "https://{{ vault_github_token }}@github.com/{{ platform_repo }}.git"
    dest: "{{ service_home }}/ninja-ops"
    version: "{{ platform_branch }}"
  become_user: "{{ service_user }}"

- name: Build deploy-agent
  command:
    cmd: pnpm --filter @ninja/deploy-agent build
    chdir: "{{ service_home }}/ninja-ops"
  become_user: "{{ service_user }}"

# Fetch the node UUID from control plane — the node must already be registered
# in the dashboard before running this playbook against an app container.
# Store it as a fact for use in the env template.
- name: Look up node UUID from control plane
  uri:
    url: "{{ control_plane_url }}/api/nodes"
    headers:
      # Use a pre-generated admin token stored in vault
      Authorization: "Bearer {{ vault_admin_token }}"
    return_content: yes
  register: nodes_response

- name: Set node_uuid fact
  set_fact:
    node_uuid: >-
      {{ (nodes_response.json.data
          | selectattr('host', 'equalto', hostvars[groups['control_plane'][0]]['ansible_host'])
          | first).id }}

- name: Write agent .env
  template:
    src: agent.env.j2
    dest: "{{ service_home }}/ninja-ops/apps/deploy-agent/.env"
    owner: "{{ service_user }}"
    mode: "0600"

- name: Install systemd service
  template:
    src: deploy-agent.service.j2
    dest: /etc/systemd/system/deploy-agent.service
  notify:
    - reload systemd
    - restart deploy-agent

- name: Enable and start deploy-agent
  systemd:
    name: deploy-agent
    state: started
    enabled: yes
```

### 5.7 `roles/app/`

Clones the app repo and sets up its systemd service. Runs after `deploy-agent`.

This role is intentionally minimal — ongoing deploys are handled by the deploy-agent,
not Ansible. Ansible just does the first-time setup.

**Tasks:**
```yaml
- name: Clone app repo
  git:
    repo: "https://{{ vault_github_token }}@github.com/{{ app_repo }}.git"
    dest: "{{ working_dir }}"
    version: "{{ app_branch }}"
  become_user: "{{ service_user }}"

- name: Install app dependencies
  command:
    cmd: pnpm install --frozen-lockfile
    chdir: "{{ working_dir }}"
  become_user: "{{ service_user }}"

# App-specific .env is intentionally NOT managed by Ansible.
# The developer writes it once manually, or a separate vault variable per app
# can be added. The deploy-agent does not overwrite .env on deploys.

- name: Write app systemd service
  template:
    src: app.service.j2
    dest: "/etc/systemd/system/{{ app_service_name | default(inventory_hostname) }}.service"
  notify:
    - reload systemd
    - restart app

- name: Enable and start app service
  systemd:
    name: "{{ app_service_name | default(inventory_hostname) }}"
    state: started
    enabled: yes
```

---

## 6. Playbooks

### 6.1 `playbooks/bootstrap.yml` — full first-time provisioning

```yaml
---
- name: Base setup — all containers
  hosts: all
  roles:
    - base

- name: Provision PostgreSQL
  hosts: postgres
  roles:
    - postgres

- name: Provision Redis
  hosts: redis
  roles:
    - redis

# Platform services depend on postgres + redis being ready
- name: Provision control plane
  hosts: control_plane
  roles:
    - control-plane

- name: Provision dashboard
  hosts: dashboard
  roles:
    - dashboard

# App containers depend on control plane being registered
- name: Provision app containers
  hosts: apps
  roles:
    - deploy-agent
    - app
```

### 6.2 `playbooks/update-platform.yml` — redeploy after a manual platform release

```yaml
---
- name: Update control plane
  hosts: control_plane
  tasks:
    - name: Pull latest code
      git:
        repo: "https://{{ vault_github_token }}@github.com/{{ platform_repo }}.git"
        dest: "{{ service_home }}/ninja-ops"
        version: "{{ platform_branch }}"
        force: yes

    - name: Install dependencies and build
      command: "{{ item }}"
      loop:
        - pnpm install --frozen-lockfile
        - pnpm --filter @ninja/types build
        - pnpm --filter @ninja/control-plane build
      args:
        chdir: "{{ service_home }}/ninja-ops"

    - name: Run migrations
      command: pnpm --filter @ninja/control-plane db:migrate
      args:
        chdir: "{{ service_home }}/ninja-ops"
      environment:
        DATABASE_URL: "postgres://{{ postgres_user }}:{{ vault_postgres_password }}@{{ postgres_host }}:{{ postgres_port }}/{{ postgres_db }}"

    - name: Restart control-plane
      systemd:
        name: control-plane
        state: restarted

- name: Update dashboard
  hosts: dashboard
  tasks:
    - name: Pull and rebuild
      # same pattern as control plane
    - name: Reload Caddy
      systemd:
        name: caddy
        state: reloaded
```

### 6.3 `playbooks/verify.yml` — smoke-test everything is up

```yaml
---
- name: Verify PostgreSQL
  hosts: control_plane
  tasks:
    - name: Check database connectivity
      command: >
        psql postgres://{{ postgres_user }}:{{ vault_postgres_password }}
        @{{ postgres_host }}/{{ postgres_db }} -c "SELECT 1"
      changed_when: false

- name: Verify Redis
  hosts: control_plane
  tasks:
    - name: Ping Redis
      command: redis-cli -h {{ redis_host }} ping
      changed_when: false

- name: Verify control plane
  hosts: localhost
  tasks:
    - name: Health check
      uri:
        url: "http://{{ hostvars[groups['control_plane'][0]]['ansible_host'] }}:3000/healthz"
        status_code: 200

- name: Verify agents
  hosts: apps
  tasks:
    - name: Check deploy-agent service is running
      systemd:
        name: deploy-agent
      register: agent_status
    - assert:
        that: agent_status.status.ActiveState == "active"
```

---

## 7. Typical workflow

### First-time setup

```bash
# 1. Create and encrypt vault
ansible-vault create group_vars/all/vault.yml
# Fill in all vault_ variables

# 2. Create LXCs on Proxmox (Debian 12, set IPs matching hosts.yml)
# 3. Ensure SSH access to all containers

# 4. Run full bootstrap
ansible-playbook playbooks/bootstrap.yml --ask-vault-pass

# 5. Verify everything is up
ansible-playbook playbooks/verify.yml --ask-vault-pass
```

### Adding a new app container

```bash
# 1. Create LXC on Proxmox
# 2. Register the Proxmox node in the dashboard (if not already done)
# 3. Add the container to inventory/hosts.yml under apps
# 4. Create a deploy target in the dashboard pointing at the new vmid
# 5. Run bootstrap against just the new container
ansible-playbook playbooks/bootstrap.yml \
  --limit skyblock-api-02 \
  --ask-vault-pass
```

### Deploying a platform update

```bash
ansible-playbook playbooks/update-platform.yml --ask-vault-pass
```

---

## 8. Code changes required

**None.** The control plane already reads all connection details from environment
variables. The Ansible templates write the correct values into `.env` on each container.

The one thing to add to the ninja-ops repo itself is a `vault_admin_token` variable —
a long-lived admin JWT used by Ansible's `deploy-agent` role to look up node UUIDs from
the control plane API. Generate it once with the existing `gen-token` script and add it
to the vault:

```bash
# From the ninja-ops repo, after control plane is running
pnpm --filter @ninja/control-plane gen-token --role admin --expiry 365d
# Paste the output into vault as vault_admin_token
```

---

## 9. Security notes

- `group_vars/all/vault.yml` encrypted with ansible-vault — safe to commit
- All services bind to the internal bridge IP only, not 0.0.0.0
- UFW blocks all external access except SSH and the Caddy port (80/443)
- Postgres only accepts connections from the internal network via pg_hba.conf
- Redis binds to internal IP only — no auth needed on an isolated network,
  but `vault_redis_password` can be set for defence-in-depth
- The GitHub token in vault has repo read scope only — minimum required to clone
- `.env` files on containers are `chmod 0600`, owned by the service user
- The vault password never touches any container — only your local machine

---

## 10. Implementation checklist

- [ ] Create `infrastructure/` directory at the workspace root (sibling to `apps/`)
- [ ] Write `ansible.cfg`
- [ ] Write `inventory/hosts.yml` with your actual container IPs
- [ ] Write `group_vars/all/vars.yml`
- [ ] Create encrypted `group_vars/all/vault.yml` with all secrets
- [ ] Add `.vault_password` to `.gitignore`
- [ ] Implement `roles/base/`
- [ ] Implement `roles/postgres/`
- [ ] Implement `roles/redis/`
- [ ] Implement `roles/control-plane/` including `env.j2` and service template
- [ ] Implement `roles/dashboard/` including `Caddyfile.j2`
- [ ] Implement `roles/deploy-agent/` (skeleton — deploy-agent app not built yet)
- [ ] Implement `roles/app/`
- [ ] Write `playbooks/bootstrap.yml`
- [ ] Write `playbooks/update-platform.yml`
- [ ] Write `playbooks/verify.yml`
- [ ] Test against a single LXC end-to-end before running against all containers
- [ ] Commit: `feat(infra): ansible provisioning for all containers`