/**
 * Thin client for the FastAPI editing backend (video-pipeline/editor/backend).
 * That backend is the source of truth for a project's timeline + asset
 * registry; the OpenVideo studio only ever holds a converted, in-memory copy.
 */
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8420";

// Same server, different hostname alias. Browsers cap concurrent connections
// per *origin* (scheme+host+port) at ~6 — OpenVideo opens hundreds of asset
// requests on load, which was starving Save/Undo/Redo/Render of a connection
// for a minute or more since they shared BACKEND_URL's pool. Serving assets
// from a second origin gives control-plane calls their own pool so they're
// never stuck behind a thumbnail-fetch burst.
const ASSET_URL = process.env.NEXT_PUBLIC_BACKEND_ASSET_URL || "http://localhost:8420";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init?.method || "GET"} ${path} -> ${res.status}: ${body}`);
  }
  return res.json();
}

export function assetFileUrl(projectId: string, assetId: string) {
  return `${ASSET_URL}/api/projects/${projectId}/assets/${assetId}/file`;
}

export function assetThumbnailUrl(projectId: string, assetId: string) {
  return `${ASSET_URL}/api/projects/${projectId}/assets/${assetId}/thumbnail`;
}

export const backendApi = {
  getProject: (projectId: string) => req<any>(`/api/projects/${projectId}`),
  getTimeline: (projectId: string) => req<any>(`/api/projects/${projectId}/timeline`),
  putTimeline: (projectId: string, timeline: any) =>
    req<{ ok: boolean }>(`/api/projects/${projectId}/timeline`, {
      method: "PUT",
      body: JSON.stringify(timeline),
    }),
  listAssets: (projectId: string) =>
    req<{ count: number; assets: any[] }>(`/api/projects/${projectId}/assets`),
  undo: (projectId: string) =>
    req<any>(`/api/projects/${projectId}/timeline/undo`, { method: "POST" }),
  redo: (projectId: string) =>
    req<any>(`/api/projects/${projectId}/timeline/redo`, { method: "POST" }),
  startRender: (projectId: string, kind: "draft" | "preview" | "final" = "final", grade = "none") =>
    req<any>(`/api/projects/${projectId}/render`, {
      method: "POST",
      body: JSON.stringify({ kind, grade }),
    }),
  getRenderStatus: (projectId: string, jobId: string) =>
    req<any>(`/api/projects/${projectId}/render/${jobId}`),
};
