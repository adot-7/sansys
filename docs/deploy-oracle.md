# Deploy on Oracle Cloud Always Free

Step-by-step guide to run this app on an existing Oracle Cloud **Always Free**
compute instance. No cost, no pay-as-you-go. The SQLite database (approved
summaries) persists on the instance's disk.

> TL;DR: your existing instance must be in a region that can reach the Sansys
> test server (the path matters more than anything else). Install Node 20, clone,
> build, run via systemd, open port 3001. Only launch a new instance if you need
> a cleaner box — it stays in your home region and on the same network path.

---

## 0. Preflight: can the instance reach the Sansys API?

SSH into the instance and curl the test server directly. The instance's region
matters more than anything else in this guide:

```bash
curl -m 15 -o /dev/null -w '%{http_code} %{time_total}s\n' \
  'http://182.70.249.137:3030/patientHome/load-demographics/PAT123456?userId=1'
```

- **`200` in a couple seconds** → the path works, proceed.
- **timeout / `000`** → that region's path to the server is blocked. The app
  retries (3× per endpoint) so transient blips are fine, but a consistently
  failing region will never load patients. Note: Always Free instances are
  **home-region only**, so launching another instance does *not* change the
  region or network path — if the existing box can't reach it, fall back to the
  Cloudflare Tunnel option in the README instead.

Also confirm you have enough memory — this app wants ~150 MB free:

```bash
free -h
```

---

## Launching a new Always Free instance (billing-safe)

You probably don't need to. **Always Free compute can only be created in your
home region**, so a second instance sits in the *same* region and on the *same*
network path as the one you already have. Launching another only helps when the
current box is short on RAM/disk or you want a clean machine — it never changes
whether the region can reach the Sansys API.

**Billing facts (what stays at $0):**
- Allowed: **2** AMD `VM.Standard.E2.1.Micro` instances (1/8 OCPU, 1 GB RAM
  each). If you already run one, adding the second is still free.
- Allowed: Ampere A1 (ARM) — capped at **2 OCPU / 12 GB total** across all A1
  instances since June 2026. If an existing A1 instance is 4 OCPU / 24 GB,
  resize it to 2 / 12 — Oracle has been enforcing this and can stop over-limit
  instances.
- Storage: boot volumes count toward the **200 GB total**; each boot volume is
  at least 47 GB, so two Micros (~94 GB) leave plenty of room.
- **Free only if:** created in the home region, an "Always Free-eligible" shape
  (console shows a `$0.00` / Always Free label), and total storage ≤ 200 GB.
  Anything else — a paid shape, a non-home region, extra block volumes — is
  billable.
- Idle reclamation: Oracle may reclaim an Always Free instance idle for 7 days
  (CPU and network below 20%; memory too on A1). A server that's actually used
  is fine.

**Console steps:**
1. Menu → **Compute → Instances → Create instance**.
2. **Name** + compartment. **Placement** must be your home region (pick the
   availability domain shown).
3. **Image**: Ubuntu 22.04 or Oracle Linux 8 (both Always Free-eligible).
4. **Shape → Change shape**: find `VM.Standard.E2.1.Micro` (search "Micro", or
   look under *Specialized and legacy*) and confirm it shows
   **Always Free-eligible** / `$0.00`. If you see any price, that's a paid
   shape — don't pick it.
5. **Networking**: your existing VCN, public subnet, and assign a public IPv4.
6. **Boot volume**: leave the default 47 GB.
7. **SSH keys**: add your public key.
8. **Create**. On "out of host capacity" (common for free shapes), try another
   availability domain or retry later, or use an A1 (ARM) instance at 2 OCPU /
   12 GB instead.
9. After launch, grab the public IP and run the preflight curl above — if it
   times out, the home region's path is blocked and a second instance won't
   help; use the Cloudflare Tunnel option in the README.

## 1. Install Node 20

Ubuntu/Debian:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # v20.x
```

Oracle Linux (dnf):

```bash
sudo dnf module install -y nodejs:20
```

If in doubt, use [nvm](https://github.com/nvm-sh/nvm) — it works on any distro.

## 2. Clone and build

The repo builds the React client into `server/public`, which Express serves.

```bash
git clone git@github.com:adot-7/sansys.git   # or HTTPS with a PAT
cd sansys

cd server && npm ci
cd ../client && npm ci && npm run build      # output lands in server/public
cd ..
```

## 3. Run it once by hand to verify

```bash
cd server
PORT=3001 \
LLM_PROVIDER=google \
GOOGLE_API_KEY=<your-key> \
SANSYS_BASE_URL=http://182.70.249.137:3030 \
npm start
```

In another SSH session:

```bash
curl -s http://localhost:3001/api/specialties            # expect JSON
curl -s http://localhost:3001/api/diag/sansys            # proves reachability from this host
curl -s http://localhost:3001/api/patients/PAT123456 -o /dev/null -w '%{http_code}\n'  # 200
```

Stop it with Ctrl+C when happy.

## 4. Run permanently with systemd

Create `/etc/systemd/system/sansys.service`:

```ini
[Unit]
Description=Sansys discharge summary
After=network.target

[Service]
WorkingDirectory=/home/<your-user>/sansys/server
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
Environment=PORT=3001
Environment=LLM_PROVIDER=google
Environment=GOOGLE_API_KEY=<your-key>
Environment=SANSYS_BASE_URL=http://182.70.249.137:3030

[Install]
WantedBy=multi-user.target
```

Find the Node binary path with `which node` and put that in `ExecStart` if it
isn't `/usr/bin/node` (e.g. under `~/.nvm/...` for nvm installs).

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sansys
sudo systemctl status sansys
sudo journalctl -u sansys -f        # follow logs; you'll see [http]/[sansys] lines
```

## 5. Open port 3001 to the internet

Two layers — the cloud firewall **and** the OS firewall.

**Oracle Cloud Console:**
1. Networking → Virtual Cloud Networks → your VCN → Security Lists → your list
2. Add Ingress Rules:
   - Source CIDR: `0.0.0.0/0` (or better, your own IP for a prototype)
   - IP Protocol: TCP
   - Destination Port: `3001`

**OS firewall** (if enabled):

```bash
# Oracle Linux / RHEL-family:
sudo firewall-cmd --permanent --add-port=3001/tcp && sudo firewall-cmd --reload

# Ubuntu (ufw):
sudo ufw allow 3001/tcp
```

## 6. Verify from the internet

From your laptop:

```bash
curl -s http://<public-ip>:3001/api/specialties
curl -s http://<public-ip>:3001/api/diag/sansys
```

Open `http://<public-ip>:3001` in a browser.

## Maintenance

```bash
cd sansys && git pull
cd client && npm ci && npm run build     # rebuild the UI if it changed
cd ../server && npm ci                   # reinstall deps if they changed
sudo systemctl restart sansys
```

Approved summaries live in `server/data/summaries.db` on the instance disk.
Back it up by copying the file off the box.

## Warnings

- **No authentication.** The app has none (per the brief, it's a sandbox demo).
  Anyone who can reach port 3001 can generate drafts and spend your Google API
  quota. For a demo, restrict the ingress source to your own IP instead of
  `0.0.0.0/0`, or put basic auth in front.
- **HTTPS.** The API key is only used server-side (never sent to the browser),
  so plain HTTP works for a prototype. If you want TLS, terminate it with nginx
  or Caddy in front of port 3001 — Let's Encrypt certs are free.
- **Always Free limits.** The E2.1.Micro has 1 GB RAM — keep other services
  light. ARM Ampere A1 instances (up to 2 OCPUs / 12 GB total as of June 2026)
  are also in the free tier and give more headroom; node works identically on
  both.