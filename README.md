# FreeTezz demo backend

Minimal Express API to support the FreeTezz frontend dApp using Temple/Beacon.

Features:
- CORS enabled for http://localhost:5173 by default
- Health endpoints (/api/health, /health, /status)
- In-memory jobs
- Escrow deposit/release prepare+confirm flows returning Beacon operationDetails (mocked)

## Quick start

1. Install deps

```powershell
npm install
```

2. Run the API

```powershell
npm start
```

API will listen on http://localhost:4000

3. In the frontend (index.html), set API Base to http://localhost:4000 and click Ping API.

## Environment

Create a `.env` file (optional):

```
PORT=4000
CORS_ORIGINS=http://localhost:5173
ESCROW_ADDRESS=tz1fakeEscrowAddr111111111111111111
```

## API overview

- GET /api/health → { ok: true }
- POST /api/jobs → { title, amountMutez, clientAddress, description? } → { id, job }
- GET /api/jobs/:id → job
- POST /api/jobs/:id/accept → { freelancerPkh }
- POST /api/jobs/:id/deposit/prepare → { fromPkh, amountTez } → { operationDetails: [...] }
- POST /api/jobs/:id/deposit/confirm → { fromPkh, opHash }
- POST /api/jobs/:id/submit → { freelancerPkh, workUrl }
- POST /api/jobs/:id/release/prepare → { clientPkh } → { operationDetails: [...] }
- POST /api/jobs/:id/release/confirm → { clientPkh, opHash }
- POST /api/jobs/:id/dispute → { pkh, reason }

Replace the mocked operationDetails with your contract call.
