import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomically } from '../storage/snapshot-writer.js';

const FUND_ID_PATTERN = /^[A-Z0-9]{2,32}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

function normalizeRegistrationPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Public fund registration payload must be an object.');
  }
  const keys = Object.keys(payload).sort();
  if (keys.length !== 2 || keys[0] !== 'fundId' || keys[1] !== 'name') {
    throw new Error('Public fund registration payload may contain only fundId and name.');
  }

  const fundId = String(payload.fundId || '').trim().toUpperCase();
  const name = String(payload.name || '').trim();
  if (!FUND_ID_PATTERN.test(fundId)) throw new Error('Public fund registration has an invalid fundId.');
  if (!name || name.length > 160 || CONTROL_CHARACTER_PATTERN.test(name)) {
    throw new Error('Public fund registration has an invalid name.');
  }
  return { fundId, name };
}

async function registerPublicFund(root, payload) {
  const fund = normalizeRegistrationPayload(payload);
  const catalogPath = path.join(root, 'config', 'public-funds', 'approved-funds.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  if (!Array.isArray(catalog.funds)) throw new Error('Public fund catalog is missing its funds array.');

  const existing = catalog.funds.find((item) => String(item?.fundId || '').trim().toUpperCase() === fund.fundId);
  if (existing) return { added: false, fund: { fundId: existing.fundId, name: existing.name } };

  await writeJsonAtomically(catalogPath, {
    ...catalog,
    funds: [...catalog.funds, fund]
  });
  return { added: true, fund };
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  const root = process.cwd();
  const payload = JSON.parse(String(process.env.PUBLIC_FUND_REGISTRATION_PAYLOAD || ''));
  const result = await registerPublicFund(root, payload);
  console.log(JSON.stringify({ status: result.added ? 'registered' : 'already_registered', fundId: result.fund.fundId }));
}

export { normalizeRegistrationPayload, registerPublicFund };
