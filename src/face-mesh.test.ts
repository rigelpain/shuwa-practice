import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { describe, expect, it } from 'vitest';
import { FACE_MESH_LINKS, FACE_MESH_POINTS } from './face-mesh';

describe('face mesh', () => {
  it('only links points that are kept', () => {
    for (const links of Object.values(FACE_MESH_LINKS)) {
      expect(links.length).toBeGreaterThan(0);
      for (const [a, b] of links) {
        expect(FACE_MESH_POINTS[a]).toBeDefined();
        expect(FACE_MESH_POINTS[b]).toBeDefined();
      }
    }
  });

  it('matches the outline, brows, eyes, lips and irises of the installed MediaPipe', () => {
    // If this fails after upgrading MediaPipe, keep the stored order and map the new indices onto it.
    const F = FaceLandmarker;
    const library = [
      F.FACE_LANDMARKS_FACE_OVAL,
      F.FACE_LANDMARKS_LEFT_EYEBROW,
      F.FACE_LANDMARKS_RIGHT_EYEBROW,
      F.FACE_LANDMARKS_LEFT_EYE,
      F.FACE_LANDMARKS_RIGHT_EYE,
      F.FACE_LANDMARKS_LIPS,
      F.FACE_LANDMARKS_LEFT_IRIS,
      F.FACE_LANDMARKS_RIGHT_IRIS,
    ]
      .flat()
      .map((c) => [c.start, c.end].sort((x, y) => x - y).join('-'));
    const ours = Object.values(FACE_MESH_LINKS)
      .flat()
      .map(([a, b]) => [FACE_MESH_POINTS[a], FACE_MESH_POINTS[b]].sort((x, y) => x - y).join('-'));
    expect(new Set(ours)).toEqual(new Set(library));
  });
});
