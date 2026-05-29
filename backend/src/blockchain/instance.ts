import { pool } from '../config/database';
import { CppEngine } from './CppEngine';
import { persistBlockFromEngine, loadBlockDataFromDB } from './persistence';

// ─── Singleton ────────────────────────────────────────────────────────────
// One CppEngine instance per server process.

let engine: CppEngine | null = null;

/** Get the engine singleton. Must call initEngine() first. */
export function getEngine(): CppEngine {
  if (!engine) {
    throw new Error('Engine not initialized. Call initEngine() at startup.');
  }
  return engine;
}

/** Initialize the C++ blockchain engine: spawn process, replay blocks from DB. */
export async function initEngine(): Promise<CppEngine> {
  engine = new CppEngine();
  await engine.spawn();

  // Check if DB has blocks
  const result = await pool.query<{ block_number: string; timestamp: string }>(
    'SELECT block_number, timestamp FROM blocks ORDER BY block_number DESC LIMIT 1'
  );

  if (result.rows.length > 0 && result.rows[0]) {
    const tipHeight = parseInt(result.rows[0].block_number);

    // Get genesis timestamp
    const genesisRow = await pool.query<{ timestamp: string }>(
      'SELECT timestamp FROM blocks WHERE block_number = 0'
    );
    const genesisTs = parseInt(genesisRow.rows[0]?.timestamp ?? '0');
    await engine.initialize(genesisTs);

    // Replay all blocks from DB (skip genesis since initialize created it)
    for (let i = 1; i <= tipHeight; i++) {
      const blockData = await loadBlockDataFromDB(pool, i);
      await engine.loadBlock(blockData);
    }

    console.log(`Engine loaded: replayed ${tipHeight} blocks from DB`);
  } else {
    // Fresh start: C++ creates genesis, Node.js persists it
    const initResult = await engine.initialize();
    if (initResult.genesis_block) {
      await persistBlockFromEngine(pool, initResult.genesis_block, []);
    }
    console.log('Engine initialized with genesis block');
  }

  return engine;
}
