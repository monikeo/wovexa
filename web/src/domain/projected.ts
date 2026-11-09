/**
 * Projected (cross-seam) layers next to ordinary zone artwork. A projected layer carries the same
 * content and style as a zone layer; only where it sits differs (a projector on the 3D garment
 * instead of a position in a print zone). Pure helpers, no engine imports.
 */
import type { ArtworkLayer, ProjectedLayer, ProjectorSpec, ZoneDesign } from './schema';

/** A projected layer as zone artwork centred at the origin: for rendering its content and for size checks. */
export function projectedAsArtwork(layer: ProjectedLayer, center = { xMm: 0, yMm: 0 }): ArtworkLayer {
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
    transform: { ...layer.transform, centerXmm: center.xMm, centerYmm: center.yMm },
    style: structuredClone(layer.style),
    content: structuredClone(layer.content),
  };
}

/** Zone artwork projected from `projector`, keeping its id, content, style, size, rotation and flips. */
export function artworkAsProjected(layer: ArtworkLayer, projector: ProjectorSpec): ProjectedLayer {
  const { widthMm, heightMm, rotationDeg, flipX, flipY } = layer.transform;
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    locked: false,
    projector: structuredClone(projector),
    transform: { widthMm, heightMm, rotationDeg, flipX, flipY },
    style: structuredClone(layer.style),
    content: structuredClone(layer.content),
  };
}

/** Projected layers in stacking order, bottom first. */
export function projectedLayers(doc: { projections: { orderedLayerIds: string[]; layers: Record<string, ProjectedLayer> } }): ProjectedLayer[] {
  return doc.projections.orderedLayerIds.map((id) => doc.projections.layers[id]).filter(Boolean);
}

/**
 * The projected layers as one zone-shaped list, for code that gathers what a design uses (fonts
 * to load, images to decode) zone by zone. Never drawn as a zone: it has no print area.
 */
export function projectionsAsZone(doc: { projections: { orderedLayerIds: string[]; layers: Record<string, ProjectedLayer> } }): ZoneDesign {
  return {
    zoneId: 'front',
    printMethod: 'SUBLIMATION',
    orderedLayerIds: [...doc.projections.orderedLayerIds],
    layers: Object.fromEntries(projectedLayers(doc).map((l) => [l.id, projectedAsArtwork(l)])),
  };
}
