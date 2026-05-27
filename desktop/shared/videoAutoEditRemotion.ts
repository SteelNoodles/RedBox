import { coerceToRedboxAssetUrl } from './localAsset';
import type { VideoEditorV2Project, VideoTimelineClip } from './videoAutoEdit';
import type { RemotionCompositionConfig, RemotionOverlay, RemotionScene } from '../src/components/manuscripts/remotion/types';

export const VIDEO_EDITOR_V2_REMOTION_COMPOSITION_ID = 'RedBoxVideoEditorV2';

function msToFrames(ms: number, fps: number): number {
    return Math.max(1, Math.round((Math.max(0, Number(ms) || 0) / 1000) * fps));
}

function pickAssetSource(project: VideoEditorV2Project, clip: VideoTimelineClip): {
    src: string;
    assetKind: 'video' | 'image' | 'audio' | 'unknown';
    assetId?: string;
} {
    const asset = project.assets.find((item) => item.id === clip.assetId);
    if (!asset) {
        return { src: '', assetKind: 'unknown', assetId: clip.assetId };
    }
    const preferredPath = String(asset.proxyPath || asset.projectPath || asset.sourcePath || '').trim();
    return {
        src: preferredPath ? coerceToRedboxAssetUrl(preferredPath) : '',
        assetKind: asset.kind || 'unknown',
        assetId: asset.id,
    };
}

function buildSubtitleOverlays(project: VideoEditorV2Project, clip: VideoTimelineClip, fps: number): RemotionOverlay[] {
    const subtitleTrack = project.timeline.tracks.find((track) => track.kind === 'subtitle');
    if (!subtitleTrack) return [];
    const clipSegmentIds = new Set(clip.transcriptSegmentIds || []);
    return subtitleTrack.clips
        .filter((item) => !item.disabled)
        .filter((item) => String(item.text || '').trim())
        .filter((item) => {
            if (clipSegmentIds.size === 0) {
                return item.timelineEndMs > clip.timelineStartMs && item.timelineStartMs < clip.timelineEndMs;
            }
            return (item.transcriptSegmentIds || []).some((id) => clipSegmentIds.has(id));
        })
        .map((item) => {
            const startOffsetMs = Math.max(0, item.timelineStartMs - clip.timelineStartMs);
            const durationMs = Math.max(60, item.timelineEndMs - item.timelineStartMs);
            return {
                id: `overlay_${item.id}`,
                text: String(item.text || '').trim(),
                startFrame: msToFrames(startOffsetMs, fps),
                durationInFrames: msToFrames(durationMs, fps),
                position: 'bottom',
                animation: 'fade-up',
                fontSize: 34,
                color: '#ffffff',
                backgroundColor: 'rgba(5, 7, 11, 0.42)',
                align: 'center',
            } satisfies RemotionOverlay;
        });
}

export function buildVideoEditorV2RemotionComposition(project: VideoEditorV2Project): RemotionCompositionConfig | null {
    const fps = Math.max(1, Math.round(Number(project.canvas.fps || 30) || 30));
    const primaryTrack = project.timeline.tracks.find((track) => track.kind === 'primary-video');
    const primaryClips = (primaryTrack?.clips || []).filter((clip) => !clip.disabled);
    if (primaryClips.length === 0) return null;

    const scenes: RemotionScene[] = primaryClips
        .slice()
        .sort((left, right) => left.timelineStartMs - right.timelineStartMs || left.timelineEndMs - right.timelineEndMs)
        .map((clip) => {
            const durationMs = Math.max(60, clip.timelineEndMs - clip.timelineStartMs);
            const source = pickAssetSource(project, clip);
            const title = String(clip.text || '').trim();
            return {
                id: `scene_${clip.id}`,
                clipId: clip.id,
                assetId: source.assetId,
                assetKind: source.assetKind,
                src: source.src,
                startFrame: msToFrames(clip.timelineStartMs, fps),
                durationInFrames: msToFrames(durationMs, fps),
                trimInFrames: msToFrames(clip.sourceStartMs, fps),
                motionPreset: source.assetKind === 'image' ? 'slow-zoom-in' : 'static',
                overlayTitle: !clip.assetId && title ? title : undefined,
                overlays: buildSubtitleOverlays(project, clip, fps),
            };
        });

    const durationInFrames = Math.max(
        msToFrames(project.timeline.durationMs || 0, fps),
        ...scenes.map((scene) => scene.startFrame + scene.durationInFrames),
    );

    return {
        version: 1,
        title: project.title || 'Video Editor V2',
        entryCompositionId: VIDEO_EDITOR_V2_REMOTION_COMPOSITION_ID,
        width: Math.max(1, Math.round(Number(project.canvas.width || 1080) || 1080)),
        height: Math.max(1, Math.round(Number(project.canvas.height || 1920) || 1920)),
        fps,
        durationInFrames,
        backgroundColor: '#05070b',
        renderMode: 'full',
        scenes,
        transitions: [],
        baseMedia: {
            sourceAssetIds: scenes.map((scene) => scene.assetId).filter((value): value is string => Boolean(value)),
            durationMs: Math.max(0, Number(project.timeline.durationMs || 0)),
            width: Math.max(1, Math.round(Number(project.canvas.width || 1080) || 1080)),
            height: Math.max(1, Math.round(Number(project.canvas.height || 1920) || 1920)),
            updatedAt: Date.now(),
        },
        render: {
            defaultOutName: project.title || 'video-editor-v2',
            durationInFrames,
            renderMode: 'full',
            compositionId: VIDEO_EDITOR_V2_REMOTION_COMPOSITION_ID,
            codec: 'h264',
            imageFormat: 'jpeg',
        },
    };
}
