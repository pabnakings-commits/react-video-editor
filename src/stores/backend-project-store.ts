import { create } from "zustand";
import { core } from "@/lib/project";
import { useProjectStore } from "@/stores/project-store";
import { useAssetsStore, type ProjectFile } from "@/stores/assets-store";
import { backendApi, assetFileUrl, assetThumbnailUrl } from "@/lib/backend-api";
import { backendTimelineToOpenVideo, openVideoToBackendTimeline } from "@/lib/timeline-adapter";

function projectIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("project");
}

/** Pushes a backend Timeline dict into the live OpenVideo studio. Shared by
 * initial load and by undo/redo, which both hand back a full timeline. */
function applyBackendTimeline(projectId: string, timeline: any, assetsById: Record<string, any>) {
  const ovProject = backendTimelineToOpenVideo(projectId, timeline, assetsById);
  core.project.import(ovProject);
}

/** Feeds the project's real media library into the media panel (Replace Clip
 * browses this) — scoped to video assets that already have a proxy file, so
 * the panel only shows shots that load fast, not all ~1500 in the registry
 * (most of which point at the shared multi-GB source movie). The media panel
 * component (`assets.tsx`) reads its file list from this same localStorage
 * key on mount, keyed by project id — write there too so it survives whatever
 * order that component's own effects run in relative to this load. */
function populateMediaPanel(projectId: string, assetsById: Record<string, any>) {
  const now = new Date().toISOString();
  const files: ProjectFile[] = Object.values(assetsById)
    .filter((a: any) => a.type === "video" && a.proxy_path)
    .map((a: any) => ({
      id: a.asset_id,
      spaceId: projectId,
      name: a.caption || a.asset_id,
      type: "video" as const,
      src: assetFileUrl(projectId, a.asset_id),
      thumbnailSrc: a.thumbnail ? assetThumbnailUrl(projectId, a.asset_id) : null,
      duration: a.duration || undefined,
      createdAt: now,
      updatedAt: now,
    }));
  try {
    localStorage.setItem(`ov_assets_${projectId}`, JSON.stringify(files));
  } catch {
    // localStorage unavailable — in-memory setFiles below still covers this session
  }
  useAssetsStore.getState().setFiles(files);
}

interface BackendProjectState {
  projectId: string | null;
  baseTimeline: any | null;
  assetsById: Record<string, any>;
  status: "idle" | "loading" | "loaded" | "error";
  error: string | null;
  saving: boolean;
  renderJobId: string | null;
  renderStatus: "idle" | "queued" | "running" | "done" | "error";
  renderOutputPath: string | null;
  historyBusy: boolean;
  loadFromBackend: () => Promise<boolean>;
  saveToBackend: () => Promise<void>;
  renderFinal: () => Promise<void>;
  undoBackend: () => Promise<void>;
  redoBackend: () => Promise<void>;
}

export const useBackendProjectStore = create<BackendProjectState>((set, get) => ({
  projectId: null,
  baseTimeline: null,
  assetsById: {},
  status: "idle",
  error: null,
  saving: false,
  renderJobId: null,
  renderStatus: "idle",
  renderOutputPath: null,
  historyBusy: false,

  loadFromBackend: async () => {
    const projectId = projectIdFromUrl();
    if (!projectId) return false;

    set({ status: "loading", error: null, projectId });
    try {
      const [project, timeline, assetsRes] = await Promise.all([
        backendApi.getProject(projectId),
        backendApi.getTimeline(projectId),
        backendApi.listAssets(projectId),
      ]);
      const assetsById: Record<string, any> = {};
      for (const a of assetsRes.assets) assetsById[a.asset_id] = a;

      applyBackendTimeline(projectId, timeline, assetsById);
      populateMediaPanel(projectId, assetsById);
      useProjectStore.getState().setProjectId(projectId);
      useProjectStore.getState().setProjectName(project.name || projectId);
      useProjectStore.getState().setCanvasSize(
        { width: timeline.width, height: timeline.height },
        `${timeline.width}:${timeline.height}`,
      );

      set({ baseTimeline: timeline, assetsById, status: "loaded" });
      return true;
    } catch (err: any) {
      console.error("Failed to load project from backend:", err);
      set({ status: "error", error: String(err?.message || err) });
      return false;
    }
  },

  saveToBackend: async () => {
    const { projectId, baseTimeline, assetsById } = get();
    if (!projectId || !baseTimeline) throw new Error("no backend project loaded");
    set({ saving: true, error: null });
    try {
      const ovProject = core.project.export();
      const timeline = openVideoToBackendTimeline(projectId, ovProject, baseTimeline, assetsById);
      await backendApi.putTimeline(projectId, timeline);
      set({ baseTimeline: timeline, saving: false });
    } catch (err: any) {
      console.error("Failed to save project to backend:", err);
      set({ saving: false, error: String(err?.message || err) });
      throw err;
    }
  },

  renderFinal: async () => {
    const { projectId, saveToBackend } = get();
    if (!projectId) throw new Error("no backend project loaded");
    await saveToBackend();
    set({ renderStatus: "queued", renderOutputPath: null, error: null });
    try {
      const job = await backendApi.startRender(projectId, "final");
      set({ renderJobId: job.job_id, renderStatus: job.status });

      const poll = async () => {
        const cur = get();
        if (!cur.renderJobId || cur.projectId !== projectId) return;
        const status = await backendApi.getRenderStatus(projectId, cur.renderJobId);
        set({ renderStatus: status.status, renderOutputPath: status.output_path || null });
        if (status.status === "queued" || status.status === "running") {
          setTimeout(poll, 2000);
        } else if (status.status === "error") {
          set({ error: (status.log || []).join("\n") });
        }
      };
      setTimeout(poll, 1500);
    } catch (err: any) {
      console.error("Failed to start render:", err);
      set({ renderStatus: "error", error: String(err?.message || err) });
      throw err;
    }
  },

  undoBackend: async () => {
    const { projectId, assetsById } = get();
    if (!projectId) return;
    set({ historyBusy: true, error: null });
    try {
      const timeline = await backendApi.undo(projectId);
      applyBackendTimeline(projectId, timeline, assetsById);
      set({ baseTimeline: timeline, historyBusy: false });
    } catch (err: any) {
      // A 409 here just means the undo stack is empty — not a real error.
      const msg = String(err?.message || err);
      set({ historyBusy: false, error: msg.includes("409") ? null : msg });
    }
  },

  redoBackend: async () => {
    const { projectId, assetsById } = get();
    if (!projectId) return;
    set({ historyBusy: true, error: null });
    try {
      const timeline = await backendApi.redo(projectId);
      applyBackendTimeline(projectId, timeline, assetsById);
      set({ baseTimeline: timeline, historyBusy: false });
    } catch (err: any) {
      const msg = String(err?.message || err);
      set({ historyBusy: false, error: msg.includes("409") ? null : msg });
    }
  },
}));
