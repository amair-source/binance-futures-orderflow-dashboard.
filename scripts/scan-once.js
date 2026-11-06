import { config } from '../src/env.js';
import { scanSymbols } from '../src/scanner.js';
import { formatScanReport } from '../src/format.js';

const requested = process.argv
  .slice(2)
  .map((value) => value.toUpperCase())
  .filter(Boolean);

const symbols = requested.length ? requested : config.symbols;

const results = await scanSymbols(symbols);
console.log(formatScanReport(results, { threshold: config.aPlusThreshold }).replace(/<[^>]+>/g, ''));
console.log('\n--- raw verdicts ---');
for (const result of results) {
  if (result.error) {
    console.log(`${result.symbol}: error ${result.error}`);
    continue;
  }
  console.log(
    `${result.symbol}: ${result.side.toUpperCase()} ${result.score}/100 ` +
      `conf=${result.confidence.percent}% aPlus=${result.aPlus} ` +
      `entry=${result.setup.entryType}@${result.setup.entry} rr=${result.setup.rr.toFixed(2)} ` +
      `gates=${JSON.stringify(result.gates)}`,
  );
}
