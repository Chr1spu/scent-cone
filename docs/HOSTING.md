# Hosting Scent Cone for free

Two pieces, both on free tiers, no credit card:

| Piece | Host | Free tier | Notes |
| --- | --- | --- | --- |
| Website (`frontend/`) | **Vercel** (Hobby) | free for non-commercial use | Builds from the private GitHub repo on every push. |
| Server (`backend/`, Docker + WindNinja) | **Hugging Face Spaces** (Docker, CPU basic) | free: 2 vCPU, 16 GB RAM | Sleeps after 48 h without visits and wakes on the next request (up to a minute). The Space itself is public, so the server code is visible there; the GitHub repo stays private. |

Do the server first, so you have its address for the website.

## 1. Server on Hugging Face (about 5 minutes, then ~10 minutes of building)

1. Create a free account at <https://huggingface.co/join>.
2. Create an access token: <https://huggingface.co/settings/tokens> → **Create new token** → type **Write** → name it `scent-cone-deploy` → copy it.
3. In a terminal in the project folder, store it as a GitHub secret (it goes straight to GitHub, nobody else sees it):
   ```bash
   gh secret set HF_TOKEN            # paste the token when asked
   gh variable set HF_SPACE --body "YOUR-HF-USERNAME/scent-cone-api"
   ```
4. Start the first deploy (later deploys run automatically when `backend/` changes):
   ```bash
   gh workflow run deploy-backend.yml
   ```
5. Open `https://huggingface.co/spaces/YOUR-HF-USERNAME/scent-cone-api`. The first build compiles WindNinja (~10 minutes). When it says **Running**, check
   `https://YOUR-HF-USERNAME-scent-cone-api.hf.space/api/health` → `{"ok":true,"windninja":true}`.

## 2. Website on Vercel (about 3 minutes)

1. Sign up at <https://vercel.com/signup> with **Continue with GitHub**.
2. **Add New → Project → Import** `scent-cone` (allow Vercel access to the repository when GitHub asks).
3. Settings on the import screen:
   - **Root Directory:** `frontend`
   - **Framework Preset:** Vite (detected)
   - **Environment Variables:** `VITE_API_BASE` = `https://YOUR-HF-USERNAME-scent-cone-api.hf.space`
4. **Deploy.** Your site is at `https://scent-cone-….vercel.app` (you can rename it under Settings → Domains). Every push to `main` redeploys it.

## Notes

- Without step 1 the website still works as the offline demo; *Plan a search* will say no server is reachable.
- Anyone can also point the website at a server they run themselves: `docker compose up`, then enter `http://localhost:8000` as the server address on *Plan a search*.
- Change the server later without touching the code: edit `VITE_API_BASE` in Vercel and redeploy.
- Netlify or Cloudflare Pages work the same way for the website (`netlify.toml` is included).
