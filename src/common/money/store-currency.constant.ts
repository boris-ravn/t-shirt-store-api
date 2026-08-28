// Single currency, store-wide (docs/database/README.md: "Money is stored in
// minor units (cents). Single currency store-wide."). Not env-configurable —
// this is a fixed domain decision, not a per-deployment setting.
export const STORE_CURRENCY = 'USD';
