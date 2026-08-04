import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomically } from '../storage/snapshot-writer.js';

const TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';

function officialDate(value) {
  const compact = String(value || '').replace(/\D/g, '');
  if (!/^\d{7}$/.test(compact)) return '';
  return `${Number(compact.slice(0, 3)) + 1911}-${compact.slice(3, 5)}-${compact.slice(5, 7)}`;
}

function numberOrNull(value) {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  if (!normalized || normalized === '--') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readJson(filePath, fallback = null) {
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Fund-Pulse-public-close-check/1.0' },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Official Taiwan close endpoint failed (${response.status}).`);
  const payload = await response.json();
  if (!Array.isArray(payload) || !payload.length) throw new Error('Official Taiwan close endpoint returned no rows.');
  return payload;
}

async function walkJson(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkJson(target);
    return entry.isFile() && entry.name.endsWith('.json') ? [target] : [];
  }))).flat();
}

async function latestReferenceSnapshot(root, date) {
  const directory = path.join(root, 'data', 'raw', 'asia', 'tw', date.slice(0, 4), date);
  const candidates = [];
  for (const filePath of await walkJson(directory)) {
    const snapshot = await readJson(filePath);
    const scheduledMs = new Date(snapshot?.scheduledAt || snapshot?.capturedAt || '').getTime();
    if (snapshot?.market !== 'tw' || !Array.isArray(snapshot?.quotes) || !Number.isFinite(scheduledMs)) continue;
    candidates.push({ filePath, snapshot, scheduledMs });
  }
  candidates.sort((left, right) => left.scheduledMs - right.scheduledMs || left.filePath.localeCompare(right.filePath));
  return candidates.at(-1) || null;
}

function officialRowsBySymbol(twseRows, tpexRows) {
  const rows = new Map();
  twseRows.forEach((row) => rows.set(`${row.Code}.TW`, {
    venue: 'TWSE', date: officialDate(row.Date), name: row.Name,
    close: numberOrNull(row.ClosingPrice), tradeVolume: numberOrNull(row.TradeVolume)
  }));
  tpexRows.forEach((row) => rows.set(`${row.SecuritiesCompanyCode}.TWO`, {
    venue: 'TPEx', date: officialDate(row.Date), name: row.CompanyName,
    close: numberOrNull(row.Close), tradeVolume: numberOrNull(row.TradingShares)
  }));
  return rows;
}

async function validateTaiwanOfficialClose({ root, date = '', fetchImpl = fetch, now = new Date() }) {
  const [twseRows, tpexRows, approved, holdingMappings] = await Promise.all([
    fetchJson(TWSE_URL, fetchImpl),
    fetchJson(TPEX_URL, fetchImpl),
    readJson(path.join(root, 'config', 'public-symbols', 'approved-public-tickers.json')),
    readJson(path.join(root, 'config', 'public-holdings', 'approved-holding-symbols.json'), { mappings: [] })
  ]);
  const rows = officialRowsBySymbol(twseRows, tpexRows);
  const sourceDates = Array.from(new Set([...rows.values()].map((row) => row.date).filter(Boolean)));
  if (sourceDates.length !== 1 || (date && sourceDates[0] !== date)) {
    return { status: 'not_available', requestedDate: date || null, officialDates: sourceDates };
  }

  const tradeDate = sourceDates[0];
  const target = path.join(root, 'data', 'official-close', 'tw', tradeDate.slice(0, 4), `${tradeDate}.json`);
  const existing = await readJson(target);
  if (existing) return { status: 'already_verified', date: tradeDate, target, record: existing };

  const expectedSymbols = Array.from(new Set([
    ...(approved?.markets?.tw || []).map(({ symbol }) => String(symbol)),
    ...(holdingMappings?.mappings || [])
      .filter(({ market, symbol }) => market === 'tw' && /\.TWO?$/.test(String(symbol)))
      .map(({ symbol }) => String(symbol))
  ])).sort();
  const reference = await latestReferenceSnapshot(root, tradeDate);
  const referenceQuotes = new Map((reference?.snapshot?.quotes || []).map((quote) => [String(quote.symbol), quote]));
  const symbols = expectedSymbols.map((symbol) => {
    const official = rows.get(symbol) || null;
    const quote = referenceQuotes.get(symbol) || null;
    const officialClose = official?.close ?? null;
    const referenceClose = numberOrNull(quote?.close);
    const difference = officialClose !== null && referenceClose !== null ? referenceClose - officialClose : null;
    return {
      symbol,
      venue: official?.venue || (symbol.endsWith('.TWO') ? 'TPEx' : 'TWSE'),
      name: official?.name || '',
      officialClose,
      officialTradeVolume: official?.tradeVolume ?? null,
      publicReferenceClose: referenceClose,
      publicReferenceQuoteAt: quote?.quoteAt || '',
      difference: difference === null ? null : Number(difference.toFixed(6)),
      matchStatus: officialClose === null ? 'official_missing'
        : referenceClose === null ? 'reference_missing'
          : Math.abs(difference) <= 0.0001 ? 'matched' : 'different'
    };
  });
  const officialCompleteCount = symbols.filter(({ officialClose }) => officialClose !== null).length;
  const comparableCount = symbols.filter(({ matchStatus }) => ['matched', 'different'].includes(matchStatus)).length;
  const matchedCount = symbols.filter(({ matchStatus }) => matchStatus === 'matched').length;
  const record = {
    schemaVersion: '1.0',
    market: 'tw',
    date: tradeDate,
    checkedAt: now.toISOString(),
    source: {
      type: 'official_post_close',
      twse: { name: 'Taiwan Stock Exchange OpenAPI', url: TWSE_URL },
      tpex: { name: 'Taipei Exchange OpenAPI', url: TPEX_URL }
    },
    officialCoverage: {
      complete: expectedSymbols.length > 0 && officialCompleteCount === expectedSymbols.length,
      expectedSymbolCount: expectedSymbols.length,
      availableSymbolCount: officialCompleteCount
    },
    publicReference: reference ? {
      path: path.relative(root, reference.filePath).split(path.sep).join('/'),
      capturedAt: reference.snapshot.capturedAt || '',
      scheduledAt: reference.snapshot.scheduledAt || ''
    } : null,
    comparison: {
      status: !comparableCount ? 'reference_unavailable' : matchedCount === comparableCount ? 'matched' : 'different',
      comparableCount,
      matchedCount,
      differentCount: comparableCount - matchedCount
    },
    symbols
  };
  await writeJsonAtomically(target, record);
  await writeJsonAtomically(path.join(root, 'data', 'status', 'official-close', 'tw.json'), {
    market: 'tw', date: tradeDate, status: record.officialCoverage.complete ? 'verified' : 'partial',
    updatedAt: record.checkedAt, sourceType: record.source.type,
    officialCoverage: record.officialCoverage, comparison: record.comparison,
    archivePath: path.relative(root, target).split(path.sep).join('/')
  });
  return { status: 'verified', date: tradeDate, target, record };
}

export { TPEX_URL, TWSE_URL, officialDate, validateTaiwanOfficialClose };
