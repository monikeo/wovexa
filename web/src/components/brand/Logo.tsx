/**
 * WOVEXA logo components. Geometry comes from brand/scripts/build-logos.mjs (logo/geometry.json);
 * keep these paths identical to the generated SVG files.
 */
import type { SVGProps } from 'react';

export const SYMBOL_PATH =
  'M20 10L28 10L30.8 17.7L26.8 28.7ZM37.2 35.3L40 43L52 10L60 10L44 54L36 54L33.2 46.3ZM4 10L12 10L24 43L36 10L44 10L28 54L20 54Z';

export const WORDMARK_PATH =
  'M0 0L6 0L17.5 40L11.5 40ZM23 0L29 0L17.5 40L11.5 40ZM23 0L29 0L40.5 40L34.5 40ZM46 0L52 0L40.5 40L34.5 40ZM62 20a20.6 20.6 0 1 1 41.2 0a20.6 20.6 0 1 1 -41.2 0ZM68 20a14.6 14.6 0 1 0 29.2 0a14.6 14.6 0 1 0 -29.2 0ZM112.2 0L118.4 0L132.3 40L126.1 40ZM140 0L146.2 0L132.3 40L126.1 40ZM157.2 0L162.8 0L162.8 40L157.2 40ZM157.2 0L185.2 0L185.2 5.6L157.2 5.6ZM157.2 17.2L182.2 17.2L182.2 22.8L157.2 22.8ZM157.2 34.4L185.2 34.4L185.2 40L157.2 40ZM195.2 0L202.2 0L229.2 40L222.2 40ZM222.2 0L229.2 0L202.2 40L195.2 40ZM251.1 0L257.3 0L242.4 40L236.2 40ZM251.1 0L257.3 0L272.2 40L266 40ZM244.031 24.5L264.369 24.5L264.369 30.1L244.031 30.1Z';

type Props = SVGProps<SVGSVGElement> & { title?: string };

export function WovexaSymbol({ title, ...props }: Props) {
  return (
    <svg viewBox="4 10 56 44" fill="currentColor" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} {...props}>
      {title ? <title>{title}</title> : null}
      <path d={SYMBOL_PATH} />
    </svg>
  );
}

export function WovexaWordmark({ title = 'WOVEXA', ...props }: Props) {
  return (
    <svg viewBox="0 0 272.2 41.2" fill="currentColor" role="img" {...props}>
      <title>{title}</title>
      <path transform="translate(0 0.6)" d={WORDMARK_PATH} />
    </svg>
  );
}

/** Horizontal lockup: symbol height 44, wordmark cap height 22, gap 18 (brand guide). */
export function WovexaLockup({ title = 'WOVEXA', ...props }: Props) {
  return (
    <svg viewBox="0 0 223.71 44" fill="currentColor" role="img" {...props}>
      <title>{title}</title>
      <path transform="translate(-4 -10)" d={SYMBOL_PATH} />
      <path transform="translate(74 11) scale(0.55)" d={WORDMARK_PATH} />
    </svg>
  );
}
