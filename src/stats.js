const T95 = [
  12.706,
  4.303,
  3.182,
  2.776,
  2.571,
  2.447,
  2.365,
  2.306,
  2.262,
  2.228,
  2.201,
  2.179,
  2.16,
  2.145,
  2.131,
  2.12,
  2.11,
  2.101,
  2.093,
  2.086,
  2.08,
  2.074,
  2.069,
  2.064,
  2.06,
  2.056,
  2.052,
  2.048,
  2.045,
  2.042,
];

export function tokensPerMinute(outputTokens, durationMs) {
  if (!Number.isSafeInteger(outputTokens) || outputTokens <= 0) {
    throw new Error('Output tokens must be a positive integer');
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error('Duration must be positive');
  }
  return (outputTokens * 60_000) / durationMs;
}

export function summarize(values) {
  const sorted = values.filter(Number.isFinite).toSorted((left, right) => left - right);
  if (sorted.length === 0) return null;
  const count = sorted.length;
  const average = sorted.reduce((sum, value) => sum + value, 0) / count;
  const median =
    count % 2 === 1
      ? sorted[Math.floor(count / 2)]
      : (sorted[count / 2 - 1] + sorted[count / 2]) / 2;
  const variance =
    count > 1
      ? sorted.reduce((sum, value) => sum + (value - average) ** 2, 0) / (count - 1)
      : 0;
  const margin =
    count > 1 ? tCritical(count - 1) * (Math.sqrt(variance) / Math.sqrt(count)) : null;
  return {
    count,
    average,
    median,
    min: sorted[0],
    max: sorted.at(-1),
    ci95Low: margin === null ? null : Math.max(0, average - margin),
    ci95High: margin === null ? null : average + margin,
  };
}

function tCritical(degreesOfFreedom) {
  return degreesOfFreedom <= T95.length ? T95[degreesOfFreedom - 1] : 1.96;
}

