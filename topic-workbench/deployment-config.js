export const deployment = {"public": true, "namespace": "topic-canvas-share-v1", "publishedAt": "2026-10-28T11:59:27.923813+00:00"};
export const storageKey = key => deployment.public ? `${deployment.namespace}:${key}` : key;
