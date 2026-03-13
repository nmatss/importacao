import { vi } from 'vitest';

/**
 * Creates a chainable mock query builder.
 * Each call to createChain() returns a fresh chain that tracks its own
 * terminal resolution value set via `.mockResolvedValue()` or
 * configured via the `resolveWith` helper.
 */
function createChain() {
  const chain: Record<string, any> = {};

  const methods = [
    'insert', 'update', 'delete', 'select',
    'from', 'where', 'set', 'values',
    'limit', 'offset', 'orderBy', 'groupBy',
    'leftJoin', 'innerJoin', 'returning',
  ];

  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }

  // Make the chain thenable so it can be awaited - resolves to empty array by default
  let _resolveValue: any = [];
  chain.then = function (onFulfilled: any, onRejected?: any) {
    return Promise.resolve(_resolveValue).then(onFulfilled, onRejected);
  };
  chain._setResolveValue = (val: any) => {
    _resolveValue = val;
  };

  return chain;
}

/**
 * Creates a mock database with per-call chainable query builders.
 *
 * Usage:
 *   const { mockDb, queryQueue } = createMockDb();
 *   queryQueue.push(createResolvedChain([{ id: 1, status: 'draft' }]));
 *   queryQueue.push(createResolvedChain([{ id: 10, type: 'invoice' }]));
 *   // Each db.select()/insert()/update()/delete() call pops the next chain from the queue.
 */
export function createMockDb() {
  const queryQueue: any[] = [];
  let fallbackChain = createChain();

  function getNextChain() {
    if (queryQueue.length > 0) {
      return queryQueue.shift()!;
    }
    return fallbackChain;
  }

  const mockTx: Record<string, any> = {};
  const txQueue: any[] = [];
  let txFallback = createChain();

  function getNextTxChain() {
    if (txQueue.length > 0) {
      return txQueue.shift()!;
    }
    return txFallback;
  }

  for (const method of ['insert', 'update', 'delete', 'select']) {
    mockTx[method] = vi.fn(() => getNextTxChain());
  }

  const mockDb: Record<string, any> = {};
  for (const method of ['insert', 'update', 'delete', 'select']) {
    mockDb[method] = vi.fn(() => getNextChain());
  }

  mockDb.transaction = vi.fn(async (fn: any) => fn(mockTx));

  return { mockDb, mockTx, queryQueue, txQueue, fallbackChain, txFallback };
}

/**
 * Creates a chain that resolves to the given value when awaited.
 * All chainable methods (from, where, set, etc.) return the same chain.
 */
export function createResolvedChain(resolveValue: any) {
  const chain = createChain();
  chain._setResolveValue(resolveValue);
  return chain;
}
