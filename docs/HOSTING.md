# Hosting Scentline for free

| Piece | Host | Cost | Notes |
| --- | --- | --- | --- |
| Website (`frontend/`) | **Vercel** (Hobby) | free | Builds from the private GitHub repo on every push to `main`. |
| Server (`backend/`, Docker + WindNinja) | **this desktop PC**, reached through a Cloudflare quick tunnel | free | Online only while the PC is on and the tunnel is running. No Cloudflare account needed. |

Hugging Face Docker Spaces were the first plan, but free Docker Spaces now require a PRO subscription, so the server runs at home instead.

## Start the server

From the project folder in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1
```

The script:

1. starts Docker Desktop if needed;
2. runs `docker compose up -d` on port **8010** (the container restarts with Docker after a reboot);
3. downloads `cloudflared.exe` into `tools/` the first time (official Cloudflare release; `tools/` is gitignored);
4. opens a quick tunnel and checks `/api/health` through the public `https://….trycloudflare.com` address;
5. writes that address to `frontend/public/server.json`, commits it and pushes. Vercel redeploys in about a minute, and the website then uses the server automatically.

The tunnel address changes every time the tunnel starts, which is why step 5 republishes it. Use `-NoPublish` to skip the commit, or `-Port 8020` for another port.

## Stop the server

```powershell
powershell -ExecutionPolicy Bypass -File scripts\stop-server.ps1
```

This closes the tunnel, stops the container and clears `server.json`, so the website goes back to the offline demo for new areas. `-KeepServer` closes only the tunnel. `-KeepPublished` leaves the address in place.

## After a reboot

The container comes back with Docker Desktop, but the tunnel does not. Run `start-server.ps1` again; it publishes the new address.

## How the website finds the server

The website looks for a server in this order:

1. an address the visitor typed on *Plan a search* (saved in their browser);
2. `server.json`, published by the start script;
3. `VITE_API_BASE`, set at build time in Vercel (optional; leave it empty).

## Notes and risks

- The tunnel address is public. Anyone who finds it can create areas and run WindNinja jobs on this PC (CPU load and downloads, but no access to your files: the server runs in a container that only mounts `backend/cache`, `backend/data` and `frontend/public/demo`). Stop the server when you are not using it.
- Limits that keep the PC usable (values in `backend/app/config.py`, container limits in `docker-compose.yml`):
  - one WindNinja job at a time (`MAX_RUNNING_JOBS`); up to 4 more wait in a queue and see "Server busy", and beyond that the server answers 503;
  - per visitor IP (from `CF-Connecting-IP`): 20 new areas and 10 wind runs per 10 minutes, then 429 with `Retry-After`;
  - overview 3–20 km, detail 1–5 km, wind windows of at most 12 hours;
  - the container gets at most 8 CPUs and 6 GB of memory (`BACKEND_CPUS`, `BACKEND_MEM` in `.env`).
- Quick tunnels are meant for testing and have no uptime guarantee. For a fixed address, create a free Cloudflare account and a named tunnel, then put its URL in `server.json`.
- Website setup (one time): on Vercel, **Add New → Project → Import** the repo with **Root Directory** `frontend`. Netlify and Cloudflare Pages also work (`netlify.toml` is included).
