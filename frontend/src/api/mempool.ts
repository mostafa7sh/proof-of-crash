import { client } from './client';
import type { MempoolPipeline } from '../types';

// getting mempool data from the backend API
export const mempoolApi = {
  // retrieve the current state of the mempool pipeline
  pipeline() {
    return client.get<MempoolPipeline>('/api/mempool').then((r) => r.data);
  },
};
