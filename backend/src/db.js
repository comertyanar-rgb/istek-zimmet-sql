import sql from 'mssql';
import { config } from './config.js';

let poolPromise;
let activePool;
const CONNECTION_ERROR_CODES = new Set(['ECONNCLOSED', 'ENOTOPEN', 'ESOCKET']);

export { sql };

function invalidatePool(pool) {
  if (activePool !== pool) return;
  activePool = undefined;
  poolPromise = undefined;
  void pool.close().catch(() => {});
}

function invalidatePoolForConnectionError(pool, error) {
  if (CONNECTION_ERROR_CODES.has(String(error?.code || ''))) invalidatePool(pool);
}

export function getPool() {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(config.sql);
    pool.on('error', () => {
      invalidatePool(pool);
    });

    const connecting = pool
      .connect()
      .then((connectedPool) => {
        activePool = connectedPool;
        return connectedPool;
      })
      .catch((error) => {
        if (poolPromise === connecting) poolPromise = undefined;
        if (activePool === pool) activePool = undefined;
        void pool.close().catch(() => {});
        throw error;
      });
    poolPromise = connecting;
  }
  return poolPromise;
}

export async function closePool() {
  const currentPoolPromise = poolPromise;
  poolPromise = undefined;
  activePool = undefined;
  if (!currentPoolPromise) return;

  try {
    const pool = await currentPoolPromise;
    await pool.close();
  } catch {
    // Başlatılamamış veya zaten kapanmış havuz için ayrıca hata üretme.
  }
}

export async function query(text, bind = {}) {
  const pool = await getPool();
  try {
    return await executeQuery(pool.request(), text, bind);
  } catch (error) {
    invalidatePoolForConnectionError(pool, error);
    throw error;
  }
}

function executeQuery(request, text, bind = {}) {
  for (const [name, input] of Object.entries(bind)) {
    if (input && typeof input === 'object' && 'type' in input) {
      request.input(name, input.type, input.value);
    } else {
      request.input(name, input);
    }
  }

  return request.query(text);
}

export async function withTransaction(callback, isolationLevel = sql.ISOLATION_LEVEL.READ_COMMITTED) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin(isolationLevel);
  } catch (error) {
    invalidatePoolForConnectionError(pool, error);
    throw error;
  }

  const transactionQuery = (text, bind = {}) =>
    executeQuery(new sql.Request(transaction), text, bind);
  transactionQuery.isTransaction = true;

  try {
    const result = await callback(transactionQuery, transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    invalidatePoolForConnectionError(pool, error);
    throw error;
  }
}
