/**
 * Converts between the FastAPI backend's Timeline/AssetRegistry schema
 * (video-pipeline/editor/backend/app/models/schema.py — seconds, asset_id
 * references) and OpenVideo's own IProject schema (microseconds, clips
 * embedded by id with a direct `src` URL).
 *
 * Scope: video track only (matches what render_adapter.py / concat_render.py
 * currently render — images/graphics/text/music/sfx pass through untouched
 * on save so they aren't lost, they just aren't editable here yet).
 */
import { assetFileUrl } from "./backend-api";

const US = 1_000_000;
const VIDEO_TRACK_ID = "backend_video_track";
const VOICEOVER_TRACK_ID = "backend_voiceover_track";
const GRAPHICS_TRACK_ID = "backend_graphics_track";

// Matches templates/primitives.tsx's "ferrari" palette in the F1 project —
// text_card graphics are only used there today. pal.text is fixed white for
// the headline (the fade-scale Remotion variant never colors the headline
// itself); the item's own `color` is an accent used only for the backdrop.
const TEXT_CARD_BG = "#0a0a0a";
const TEXT_CARD_INK = "#ffffff";

// Mirrors @openvideo/core's ANIMATION_PRESETS.fadeIn — same entrance used by
// the Remotion "fade-scale" KineticTemplate variant this graphic replaces.
const FADE_SCALE_ANIMATION = {
  type: "keyframes",
  options: { duration: 0.5 * US, delay: 0, easing: "easeOutQuad", iterCount: 1 },
  params: { "0%": { opacity: 0, scale: 0.9 }, "100%": { opacity: 1, scale: 1 } },
};

/** Where in the served file (proxy or full source movie) a given in_point
 * lands — shared by initial load and by Replace Clip so both compute the
 * same trim.from render_adapter.py will use at render time. */
export function srcStartFor(asset: any, inPoint: number): number {
  const usingProxy = Boolean(asset?.proxy_path);
  return usingProxy ? inPoint : (asset?.start_time || 0) + inPoint;
}

export function backendTimelineToOpenVideo(
  projectId: string,
  timeline: any,
  assetsById: Record<string, any>,
) {
  const videoItems = [...(timeline.tracks?.video || [])].sort((a, b) => a.start - b.start);

  const clips: Record<string, any> = {};
  const clipIds: string[] = [];

  for (const item of videoItems) {
    const asset = assetsById[item.asset_id];
    // /assets/{id}/file serves proxy_path (a small pre-cut [start_time,end_time]
    // file starting at 0) when present, else the FULL shared source movie —
    // the trim math must match whichever one the server will actually hand
    // back, and must match render_adapter.py's src_start formula (which always
    // uses the full file) or the editor preview and final render will diverge.
    const srcStart = srcStartFor(asset, item.in_point);
    clipIds.push(item.id);
    clips[item.id] = {
      type: "Video",
      id: item.id,
      name: asset?.caption || asset?.asset_id || item.asset_id,
      src: assetFileUrl(projectId, item.asset_id),
      timing: {
        display: {
          from: item.start * US,
          to: (item.start + item.duration) * US,
        },
        trim: {
          from: srcStart * US,
          to: (srcStart + item.duration) * US,
        },
        duration: item.duration * US,
        playbackRate: 1,
      },
      transform: {
        x: 0,
        y: 0,
        width: timeline.width,
        height: timeline.height,
        angle: 0,
        opacity: 1,
        zIndex: 10,
        flip: { x: false, y: false },
      },
      style: {},
      locked: false,
      metadata: {
        asset_id: item.asset_id,
        selection_debug: item.selection_debug || null,
      },
      audio: true,
      volume: 1,
      effects: [],
    };
  }

  const tracks: any[] = [
    {
      id: VIDEO_TRACK_ID,
      name: "Video Track",
      type: "video",
      clipIds,
    },
  ];

  // Voiceover — was previously only saved into the backend Timeline and
  // never actually added to the OpenVideo project, so the editor's own
  // preview played silent even though the final render (which goes through
  // render_adapter.py, a separate path) always had audio.
  const voItems = [...(timeline.tracks?.voiceover || [])].sort((a: any, b: any) => a.start - b.start);
  const voClipIds: string[] = [];
  for (const item of voItems) {
    const asset = assetsById[item.asset_id];
    const srcStart = srcStartFor(asset, item.in_point);
    voClipIds.push(item.id);
    clips[item.id] = {
      type: "Audio",
      id: item.id,
      name: asset?.caption || asset?.asset_id || item.asset_id,
      src: assetFileUrl(projectId, item.asset_id),
      timing: {
        display: { from: item.start * US, to: (item.start + item.duration) * US },
        trim: { from: srcStart * US, to: (srcStart + item.duration) * US },
        duration: item.duration * US,
        playbackRate: 1,
      },
      transform: {
        x: 0, y: 0, width: timeline.width, height: timeline.height,
        angle: 0, opacity: 1, zIndex: 0, flip: { x: false, y: false },
      },
      style: {},
      locked: false,
      metadata: { asset_id: item.asset_id },
      volume: item.volume ?? 1,
    };
  }
  if (voClipIds.length) {
    tracks.push({ id: VOICEOVER_TRACK_ID, name: "Voiceover", type: "audio", clipIds: voClipIds });
  }

  // Live-editable motion graphics (Phase 1: "text_card" only — a single
  // fade-scale headline). Composed from OpenVideo's own Backdrop + Text
  // primitives rather than baked video, so text/color are directly editable
  // here. Render Final re-bakes only scenes whose params drifted from the
  // cached baked clip (see render_adapter.py) — everything else reuses the
  // existing baked file untouched.
  const graphicItems = [...(timeline.tracks?.graphics || [])].sort((a: any, b: any) => a.start - b.start);
  const gfxClipIds: string[] = [];
  for (const item of graphicItems) {
    if (item.kind !== "text_card") continue;
    const p = item.params || {};
    const bgId = `${item.id}_bg`;
    const textId = `${item.id}_headline`;
    const display = { from: item.start * US, to: (item.start + item.duration) * US };
    const timing = { display, trim: { from: 0, to: item.duration * US }, duration: item.duration * US, playbackRate: 1 };

    clips[bgId] = {
      type: "Backdrop",
      id: bgId,
      name: "Background",
      // project.import() drops any non-Text/Caption/Effect/Transition clip
      // with an empty `src` — BackdropClip's own constructor stamps this
      // same `backdrop://<type>` placeholder, so match it rather than
      // leaving it empty.
      src: "backdrop://meshGradient",
      timing,
      transform: { x: 0, y: 0, width: timeline.width, height: timeline.height, angle: 0, opacity: 1, zIndex: 15, flip: { x: false, y: false } },
      style: { backdropType: "meshGradient", colors: [TEXT_CARD_BG, p.color || "#e11d2e", TEXT_CARD_BG], gradientType: "radial" },
      locked: false,
      metadata: { graphic_id: item.id, role: "background" },
    };

    const textWidth = Math.round(timeline.width * 0.8);
    const textHeight = Math.round(timeline.height * 0.4);
    clips[textId] = {
      type: "Text",
      id: textId,
      name: p.headline || "Headline",
      text: p.headline || "",
      timing,
      transform: {
        x: Math.round((timeline.width - textWidth) / 2),
        y: Math.round((timeline.height - textHeight) / 2),
        width: textWidth, height: textHeight,
        angle: 0, opacity: 1, zIndex: 16, flip: { x: false, y: false },
      },
      style: {
        fontSize: Math.min(Math.round(timeline.width * 0.075), 108),
        fontFamily: "Arial, Helvetica, sans-serif",
        fontWeight: 800,
        color: TEXT_CARD_INK,
        align: "center",
        verticalAlign: "center",
        wordWrap: true,
        wordWrapWidth: textWidth,
        textCase: "uppercase",
        letterSpacing: 1,
      },
      locked: false,
      animations: [{ ...FADE_SCALE_ANIMATION, id: `${textId}_fade` }],
      metadata: { graphic_id: item.id, role: "headline", scene_idx: p.scene_idx, baked_asset_id: p.baked_asset_id, baked_hash: p.baked_hash, color: p.color },
    };

    gfxClipIds.push(bgId, textId);
  }
  if (gfxClipIds.length) {
    tracks.push({ id: GRAPHICS_TRACK_ID, name: "Graphics", type: "video", clipIds: gfxClipIds });
  }

  return {
    settings: {
      width: timeline.width,
      height: timeline.height,
      fps: timeline.fps,
      duration: timeline.duration * US,
      backgroundColor: "#000000",
    },
    tracks,
    clips,
  };
}

/**
 * Reverse direction. `baseTimeline` supplies every field this editor doesn't
 * yet round-trip (images/graphics/text/audio tracks, markers) so a save never
 * silently drops them.
 */
export function openVideoToBackendTimeline(
  projectId: string,
  ovProject: any,
  baseTimeline: any,
  assetsById: Record<string, any>,
) {
  const videoTrack = (ovProject.tracks || []).find((t: any) => t.id === VIDEO_TRACK_ID);
  const clipIds: string[] = videoTrack?.clipIds || [];

  const videoItems = clipIds
    .map((id) => ovProject.clips?.[id])
    .filter(Boolean)
    .map((clip: any) => {
      const assetId = clip.metadata?.asset_id;
      const asset = assetsById[assetId];
      // Inverse of the srcStart formula above: when a proxy served this clip,
      // trim.from IS in_point directly; otherwise it's an absolute position
      // in the source movie and asset.start_time must be subtracted back out.
      const usingProxy = Boolean(asset?.proxy_path);
      const srcStart = clip.timing.trim.from / US;
      const inPoint = usingProxy ? Math.max(0, srcStart) : Math.max(0, srcStart - (asset?.start_time || 0));
      return {
        id: clip.id,
        asset_id: assetId,
        start: clip.timing.display.from / US,
        duration: (clip.timing.display.to - clip.timing.display.from) / US,
        in_point: inPoint,
        transition_in: null,
        transition_out: null,
        selection_debug: clip.metadata?.selection_debug || null,
      };
    })
    .sort((a: any, b: any) => a.start - b.start);

  // Graphics: rebuild tracks.graphics from the live Backdrop+Text clip
  // pairs, keyed by the shared `graphic_id` metadata stamped on load. Only
  // headline text and accent color are live-editable here; baked_asset_id
  // and baked_hash are carried through unchanged (frozen at bake time) so
  // render_adapter.py can tell a real edit from a no-op save.
  const graphicsTrack = (ovProject.tracks || []).find((t: any) => t.id === GRAPHICS_TRACK_ID);
  const gfxClipIds: string[] = graphicsTrack?.clipIds || [];
  const byGraphicId: Record<string, any> = {};
  for (const id of gfxClipIds) {
    const clip = ovProject.clips?.[id];
    const gid = clip?.metadata?.graphic_id;
    if (!gid) continue;
    (byGraphicId[gid] ||= {})[clip.metadata.role] = clip;
  }
  const graphicItems = Object.entries(byGraphicId)
    .map(([gid, { headline, background }]: any) => {
      if (!headline) return null;
      return {
        id: gid,
        kind: "text_card",
        start: headline.timing.display.from / US,
        duration: (headline.timing.display.to - headline.timing.display.from) / US,
        params: {
          headline: headline.text ?? "",
          color: headline.metadata?.color ?? background?.style?.colors?.[1] ?? "#e11d2e",
          scene_idx: headline.metadata?.scene_idx ?? null,
          baked_asset_id: headline.metadata?.baked_asset_id ?? null,
          baked_hash: headline.metadata?.baked_hash ?? null,
        },
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.start - b.start);

  const duration = videoItems.length || graphicItems.length
    ? Math.max(
        videoItems.length ? Math.max(...videoItems.map((i: any) => i.start + i.duration)) : 0,
        graphicItems.length ? Math.max(...graphicItems.map((i: any) => i.start + i.duration)) : 0,
      )
    : baseTimeline.duration;

  return {
    ...baseTimeline,
    project_id: projectId,
    duration,
    tracks: {
      ...baseTimeline.tracks,
      video: videoItems,
      graphics: graphicItems,
    },
  };
}
