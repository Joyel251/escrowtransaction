// FreeTezz demo backend (Express)
// - In-memory store
// - Prepares Beacon operationDetails for deposit/release
// - NOT production-ready; replace mocks with real Tezos ops/contracts

require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',');

app.use(cors({
  origin: FRONTEND_ORIGINS.map(o => o.trim()),
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.use(express.json());

// Serve static files (frontend) from workspace root
app.use(express.static(path.join(__dirname)));

// Simple health
app.get(['/api/health', '/health', '/status', '/api/status'], (req, res) => {
  res.json({ ok: true, service: 'freetezz-backend', ts: Date.now() });
});

// Persistent storage using JSON file
const fs = require('fs');
const dbPath = '/tmp/jobs.json';

// Load existing jobs or create empty store
function loadDB() {
  try {
    if (fs.existsSync(dbPath)) {
      const data = fs.readFileSync(dbPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.log('DB load error:', err.message);
  }
  return {};
}

// Save jobs to file
function saveDB(jobs) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(jobs, null, 2));
  } catch (err) {
    console.log('DB save error:', err.message);
  }
}

let jobs = loadDB();

function toMutez(xtz) { return Math.round(Number(xtz || 0) * 1_000_000); }
function now() { return new Date().toISOString(); }

// Create job
app.post('/api/jobs', (req, res) => {
  const { title, amountMutez, clientAddress, description } = req.body || {};
  if (!title || typeof amountMutez !== 'number' || !clientAddress) {
    return res.status(400).json({ message: 'title, amountMutez, clientAddress are required' });
  }
  const id = crypto.randomBytes(4).toString('hex');
  const job = {
    id,
    title,
    description: description || '',
    amountMutez,
    currency: 'XTZ',
    clientAddress,
    freelancerAddress: null,
    status: 'OPEN', // OPEN -> ACCEPTED -> FUNDED -> SUBMITTED -> APPROVED/RELEASED or DISPUTED
    createdAt: now(),
    updatedAt: now(),
    escrow: { deposited: 0, opHashes: [] }
  };
  jobs[id] = job;
  saveDB(jobs);
  return res.json({ id, job });
});

// Get job
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ message: 'Job not found' });
  res.json(job);
});

// Accept job (freelancer)
app.post('/api/jobs/:id/accept', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ message: 'Job not found' });
  const { freelancerPkh } = req.body || {};
  if (!freelancerPkh) return res.status(400).json({ message: 'freelancerPkh is required' });
  if (job.status !== 'OPEN') return res.status(400).json({ message: `Cannot accept job in status ${job.status}` });
  job.freelancerAddress = freelancerPkh;
  job.status = 'ACCEPTED';
  job.updatedAt = now();
  saveDB(jobs);
  res.json({ ok: true, job });
});

// Submit work (freelancer)
app.post('/api/jobs/:id/submit', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ message: 'Job not found' });
  const { freelancerPkh, workUrl } = req.body || {};
  if (!freelancerPkh || !workUrl) return res.status(400).json({ message: 'freelancerPkh and workUrl are required' });
  if (job.freelancerAddress !== freelancerPkh) return res.status(403).json({ message: 'Only assigned freelancer can submit' });
  if (!['ACCEPTED', 'FUNDED'].includes(job.status)) return res.status(400).json({ message: `Cannot submit in status ${job.status}` });
  job.submission = { workUrl, at: now() };
  job.status = 'SUBMITTED';
  job.updatedAt = now();
  saveDB(jobs);
  res.json({ ok: true, job });
});

// Dispute (either party)
app.post('/api/jobs/:id/dispute', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ message: 'Job not found' });
  const { pkh, reason } = req.body || {};
  if (!pkh || !reason) return res.status(400).json({ message: 'pkh and reason are required' });
  job.dispute = { by: pkh, reason, at: now() };
  job.status = 'DISPUTED';
  job.updatedAt = now();
  saveDB(jobs);
  res.json({ ok: true, job });
});

// --- Escrow flows (mocked operationDetails) ---
// Deposit prepare -> client signs -> deposit confirm
app.post('/api/jobs/:id/deposit/prepare', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ message: 'Job not found' });
  const { fromPkh, amountTez } = req.body || {};
  if (!fromPkh || typeof amountTez !== 'number') return res.status(400).json({ message: 'fromPkh and amountTez are required' });
  if (job.clientAddress !== fromPkh) return res.status(403).json({ message: 'Only client can deposit' });
  const amountMutez = toMutez(amountTez);

  // Direct transfer to configured escrow address. Require ESCROW_ADDRESS.
  const ESCROW_ADDRESS = process.env.ESCROW_ADDRESS;
  if (!ESCROW_ADDRESS) {
    return res.status(400).json({ message: 'ESCROW_ADDRESS not configured on server (.env)' });
  }
  const operationDetails = [
    { kind: 'transaction', destination: ESCROW_ADDRESS, amount: String(amountMutez) }
  ];
  res.json({ operationDetails });
});

app.post('/api/jobs/:id/deposit/confirm', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ message: 'Job not found' });
  const { fromPkh, opHash } = req.body || {};
  if (!fromPkh || !opHash) return res.status(400).json({ message: 'fromPkh and opHash are required' });
  if (job.clientAddress !== fromPkh) return res.status(403).json({ message: 'Only client can confirm' });
  job.escrow.deposited = job.amountMutez; // naive: assume full amount deposited
  job.escrow.opHashes.push(opHash);
  job.status = 'FUNDED';
  job.updatedAt = now();
  saveDB(jobs);
  res.json({ ok: true, job });
});

// Release prepare -> client signs -> release confirm
app.post('/api/jobs/:id/release/prepare', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ message: 'Job not found' });
  const { clientPkh } = req.body || {};
  if (!clientPkh) return res.status(400).json({ message: 'clientPkh is required' });
  if (job.clientAddress !== clientPkh) return res.status(403).json({ message: 'Only client can release' });
  if (!job.freelancerAddress) return res.status(400).json({ message: 'No freelancer assigned' });
  if (job.status !== 'SUBMITTED' && job.status !== 'FUNDED') return res.status(400).json({ message: `Cannot release in status ${job.status}` });

  // Mock: pay freelancer from escrow address (replace with contract call)
  const operationDetails = [
    { kind: 'transaction', destination: job.freelancerAddress, amount: String(job.amountMutez) }
  ];
  res.json({ operationDetails });
});

app.post('/api/jobs/:id/release/confirm', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ message: 'Job not found' });
  const { clientPkh, opHash } = req.body || {};
  if (!clientPkh || !opHash) return res.status(400).json({ message: 'clientPkh and opHash are required' });
  if (job.clientAddress !== clientPkh) return res.status(403).json({ message: 'Only client can confirm' });
  job.status = 'RELEASED';
  job.updatedAt = now();
  job.release = { opHash, at: now() };
  saveDB(jobs);
  res.json({ ok: true, job });
});

// Root: serve the frontend index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ✅ Export for Vercel OR run locally
if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`FreeTezz backend listening on http://localhost:${PORT}`);
    console.log('CORS origins:', FRONTEND_ORIGINS);
  });
}
