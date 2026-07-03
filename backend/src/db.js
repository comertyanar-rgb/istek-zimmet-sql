import sql from 'mssql';
import { config } from './config.js';

let poolPromise;

export { sql };

export function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(config.sql);
  }
  return poolPromise;
}

export async function query(text, bind = {}) {
  const pool = await getPool();
  const request = pool.request();

  for (const [name, input] of Object.entries(bind)) {
    if (input && typeof input === 'object' && 'type' in input) {
      request.input(name, input.type, input.value);
    } else {
      request.input(name, input);
    }
  }

  return request.query(text);
}
