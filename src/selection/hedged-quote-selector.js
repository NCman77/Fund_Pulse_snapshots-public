function toTimestamp(value) {
  const timestamp = new Date(value || '').getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function expectedSymbolNames(symbols = []) {
  return Array.from(new Set(symbols.map((item) => String(item?.symbol || item || '').trim()).filter(Boolean)));
}

function assessQuoteCandidate(candidate, { symbols = [], scheduledAt, deadlineAt, maxQuoteAgeSeconds } = {}) {
  const expectedSymbols = expectedSymbolNames(symbols);
  const quotes = Array.isArray(candidate?.quotes) ? candidate.quotes : [];
  const captured = new Set(quotes.map((quote) => String(quote?.symbol || '').trim()).filter(Boolean));
  const deadlineMs = toTimestamp(deadlineAt);
  const scheduledMs = toTimestamp(scheduledAt);
  const maximumAge = Number(maxQuoteAgeSeconds);
  const capturedAtMs = toTimestamp(candidate?.receivedAt || candidate?.capturedAt);
  const missingSymbols = expectedSymbols.filter((symbol) => !captured.has(symbol));
  const unreliableQuoteAtSymbols = [];
  const quoteAfterDeadlineSymbols = [];
  const staleQuoteSymbols = [];

  for (const quote of quotes) {
    const symbol = String(quote?.symbol || '').trim();
    const quoteAtMs = toTimestamp(quote?.quoteAt);
    if (quoteAtMs === null) unreliableQuoteAtSymbols.push(symbol);
    else if (deadlineMs !== null && quoteAtMs > deadlineMs) quoteAfterDeadlineSymbols.push(symbol);
    else if (scheduledMs !== null && Number.isFinite(maximumAge) && quoteAtMs < scheduledMs - maximumAge * 1_000) staleQuoteSymbols.push(symbol);
  }

  const capturedAfterDeadline = deadlineMs !== null && (capturedAtMs === null || capturedAtMs > deadlineMs);
  return {
    eligible: expectedSymbols.length > 0
      && missingSymbols.length === 0
      && unreliableQuoteAtSymbols.length === 0
      && quoteAfterDeadlineSymbols.length === 0
      && staleQuoteSymbols.length === 0
      && !capturedAfterDeadline,
    expectedSymbolCount: expectedSymbols.length,
    capturedSymbolCount: captured.size,
    missingSymbols,
    unreliableQuoteAtSymbols,
    quoteAfterDeadlineSymbols,
    staleQuoteSymbols,
    capturedAfterDeadline
  };
}

function selectQuoteCandidate({ primary = null, backup = null, symbols = [], scheduledAt, deadlineAt, maxQuoteAgeSeconds } = {}) {
  const options = { symbols, scheduledAt, deadlineAt, maxQuoteAgeSeconds };
  const primaryAssessment = primary ? assessQuoteCandidate(primary, options) : null;
  const backupAssessment = backup ? assessQuoteCandidate(backup, options) : null;
  if (primaryAssessment?.eligible) {
    return { status: 'selected', role: 'primary', candidate: primary, assessment: primaryAssessment, fallbackReason: '' };
  }
  if (backupAssessment?.eligible) {
    return {
      status: 'selected', role: 'backup', candidate: backup, assessment: backupAssessment,
      fallbackReason: primary ? 'primary_failed_completeness_or_timing_validation' : 'primary_unavailable'
    };
  }
  return {
    status: 'unavailable', role: '', candidate: null, assessment: null,
    fallbackReason: 'no_complete_candidate_before_deadline',
    candidates: { primary: primaryAssessment, backup: backupAssessment }
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cancellableDelay(milliseconds) {
  let timer;
  return {
    promise: new Promise((resolve) => { timer = setTimeout(resolve, milliseconds); }),
    cancel: () => clearTimeout(timer)
  };
}

async function collectHedgedQuotes({
  primaryProvider,
  backupProvider = null,
  symbols = [],
  scheduledAt,
  hedgeDelayMilliseconds = 7_000,
  hardDeadlineSeconds = 55,
  maxQuoteAgeSeconds = 300,
  sleep = delay,
  now = Date.now
} = {}) {
  if (!primaryProvider?.collect) throw new Error('Hedged quote collection requires a primary provider.');
  const scheduledMs = toTimestamp(scheduledAt);
  if (scheduledMs === null) throw new Error('Hedged quote collection requires a valid scheduledAt timestamp.');
  const deadlineMs = scheduledMs + (Math.max(1, Number(hardDeadlineSeconds) || 55) * 1_000);
  const deadlineAt = new Date(deadlineMs).toISOString();
  const controller = new AbortController();
  let primaryCandidate = null;
  let backupCandidate = null;

  const runProvider = async (provider, role) => {
    try {
      const result = await provider.collect(symbols, { signal: controller.signal, deadlineAt, role });
      return {
        ...result,
        receivedAt: new Date(now()).toISOString(),
        provider: { id: provider.id, endpointType: provider.endpointType },
        role
      };
    } catch (error) {
      return { error, provider: { id: provider.id, endpointType: provider.endpointType }, role };
    }
  };

  const primaryTask = runProvider(primaryProvider, 'primary').then((outcome) => {
    if (!outcome.error) primaryCandidate = outcome;
    return outcome;
  });

  if (!backupProvider) {
    const deadline = cancellableDelay(Math.max(0, deadlineMs - now()));
    await Promise.race([primaryTask, deadline.promise]);
    deadline.cancel();
    controller.abort();
    return selectQuoteCandidate({ primary: primaryCandidate, symbols, scheduledAt, deadlineAt, maxQuoteAgeSeconds });
  }

  const first = await Promise.race([
    primaryTask.then((outcome) => ({ type: 'primary', outcome })),
    sleep(Math.max(0, Math.min(Number(hedgeDelayMilliseconds) || 0, deadlineMs - now())))
      .then(() => ({ type: 'hedge' }))
  ]);
  if (first.type === 'primary' && !first.outcome.error) {
    const selected = selectQuoteCandidate({ primary: primaryCandidate, symbols, scheduledAt, deadlineAt, maxQuoteAgeSeconds });
    if (selected.status === 'selected') {
      controller.abort();
      return selected;
    }
  }

  const backupTask = runProvider(backupProvider, 'backup').then((outcome) => {
    if (!outcome.error) backupCandidate = outcome;
    return outcome;
  });
  const eligibleAfter = (task) => task.then(() => {
    const selected = selectQuoteCandidate({ primary: primaryCandidate, backup: backupCandidate, symbols, scheduledAt, deadlineAt, maxQuoteAgeSeconds });
    return selected.status === 'selected' ? selected : new Promise(() => {});
  });
  const deadline = cancellableDelay(Math.max(0, deadlineMs - now()));
  const selected = await Promise.race([
    eligibleAfter(primaryTask),
    eligibleAfter(backupTask),
    Promise.all([primaryTask, backupTask]).then(() => (
      selectQuoteCandidate({ primary: primaryCandidate, backup: backupCandidate, symbols, scheduledAt, deadlineAt, maxQuoteAgeSeconds })
    )),
    deadline.promise.then(() => (
      selectQuoteCandidate({ primary: primaryCandidate, backup: backupCandidate, symbols, scheduledAt, deadlineAt, maxQuoteAgeSeconds })
    ))
  ]);
  deadline.cancel();
  controller.abort();
  return selected;
}

export { assessQuoteCandidate, collectHedgedQuotes, selectQuoteCandidate };
