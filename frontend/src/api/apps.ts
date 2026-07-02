import { client } from './client';
import type { App, AppSource } from '../types';

// getting app data from the backend API
export const appsApi = {
  // create a new app with the provided details, returning the app ID and content hash
  create(body: { name: string; description?: string; language: string; source_code: string }) {
    return client
      .post<{ app_id: string; content_hash: string }>('/api/apps', body)
      .then((r) => r.data);
  },

  // retrieve app details by app ID, returning the app object
  get(appId: string) {
    return client.get<App>(`/api/apps/${appId}`).then((r) => r.data);
  },

  // retrieve the source code of an app by app ID, returning the app source object
  source(appId: string) {
    return client.get<AppSource>(`/api/apps/${appId}/source`).then((r) => r.data);
  },
};
