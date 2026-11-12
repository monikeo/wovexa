/** Turning templates into projects in the browser, where fonts can be measured. */
import { allStacks } from '@/domain/areas';
import { newId } from '@/domain/factory';
import { refreshPlacements } from '@/domain/lockups';
import { migrateDesignDocument, type DesignDocument } from '@/domain/schema';
import { documentFromSnapshot, instantiateTemplate, type TemplateDef } from '@/domain/templates';
import { createProjectFromDocument, type ProjectMeta, type StoredTemplate } from './local-db';
import { ensureFonts, textAspect } from './render/zone-renderer';
import { thumbnailWithin } from './thumbnail';

/** Size every text box (in zones and design areas) to its font's real proportions, keeping each box's width and centre. */
export async function fitTextBoxes(doc: DesignDocument): Promise<DesignDocument> {
  await ensureFonts(allStacks(doc));
  const out = structuredClone(doc);
  for (const zone of allStacks(out)) {
    for (const layer of Object.values(zone.layers)) {
      if (layer.content.kind === 'text') layer.transform.heightMm = layer.transform.widthMm / textAspect(layer.content);
    }
  }
  // Lockup placements carry copies of their lockups' layers: give them the fitted ones.
  refreshPlacements(out);
  return out;
}

export async function previewTemplate(def: TemplateDef): Promise<DesignDocument> {
  return fitTextBoxes(instantiateTemplate(def, 'preview'));
}

export async function projectFromTemplate(def: TemplateDef): Promise<ProjectMeta> {
  const doc = await fitTextBoxes(instantiateTemplate(def, newId()));
  return createProjectFromDocument(doc, await thumbnailWithin(doc));
}

export async function projectFromUserTemplate(template: StoredTemplate): Promise<ProjectMeta> {
  const parsed = migrateDesignDocument(template.document);
  if (!parsed.ok) throw new Error('This template was saved in a format this version can’t read.');
  const doc = documentFromSnapshot(parsed.document, newId(), template.name);
  return createProjectFromDocument(doc, template.thumbnail);
}
