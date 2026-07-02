import { client } from './client';
import type { Leaderboard } from '../types';

// getting leaderboard data from the backend API
export const leaderboardApi = {
  get() {
    return client.get<Leaderboard>('/api/leaderboard').then((r) => r.data);
  },
};
