/**
 * Hero illustration: a front technical flat of the classic tee at true proportions
 * (geometry from the garment catalogue), with the print area dimensioned in millimetres.
 * The outline draws in once on load; reduced-motion users see it complete.
 */
const BODY =
  'M-92 0 Q-46 88 0 88 Q46 88 92 0 L228 40.8 L414.2 148.3 L334.2 286.9 L262 259.2 L255.5 720 L-255.5 720 L-262 259.2 L-334.2 286.9 L-414.2 148.3 L-228 40.8 Z';

export function TechFlat() {
  return (
    <svg viewBox="-450 -60 900 840" className="techflat h-auto w-full" role="img" aria-labelledby="techflat-title">
      <title id="techflat-title">Technical flat of a crew-neck tee with a 300 by 400 millimetre front print area</title>
      <style>{`
        .techflat .draw { stroke-dasharray: 3200; stroke-dashoffset: 3200; animation: tf-draw 1600ms cubic-bezier(.2,0,0,1) 150ms forwards; }
        .techflat .late { opacity: 0; animation: tf-fade 500ms ease 1400ms forwards; }
        @keyframes tf-draw { to { stroke-dashoffset: 0; } }
        @keyframes tf-fade { to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .techflat .draw { animation: none; stroke-dashoffset: 0; }
          .techflat .late { animation: none; opacity: 1; }
        }
      `}</style>
      <path d={BODY} fill="var(--surface-panel)" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" className="draw" />
      <path d="M-92 0 Q-46 88 0 88 Q46 88 92 0" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" className="draw" opacity="0.92" />
      <g stroke="currentColor" strokeWidth="1.2" strokeDasharray="6 5" fill="none" className="late" opacity="0.55">
        <path d="M228 40.8 L262 259.2 M-228 40.8 L-262 259.2" />
        <path d="M-255 698 H255 M-255 692 H255" />
      </g>

      <g className="late">
        {/* Print area */}
        <rect x="-150" y="170" width="300" height="400" fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="10 7" />
        <rect x="-140" y="180" width="280" height="380" fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 6" opacity="0.6" />
        {/* Artwork: a striped sun, selected */}
        <defs>
          <clipPath id="tf-sun">
            <circle cx="0" cy="300" r="96" />
          </clipPath>
        </defs>
        <g clipPath="url(#tf-sun)" fill="currentColor">
          <rect x="-100" y="204" width="200" height="74" />
          <rect x="-100" y="290" width="200" height="16" />
          <rect x="-100" y="318" width="200" height="12" />
          <rect x="-100" y="341" width="200" height="9" />
          <rect x="-100" y="361" width="200" height="7" />
          <rect x="-100" y="379" width="200" height="5" />
        </g>
        <rect x="-104" y="200" width="208" height="200" fill="none" stroke="var(--accent)" strokeWidth="2" />
        {[
          [-104, 200],
          [104, 200],
          [-104, 400],
          [104, 400],
        ].map(([x, y]) => (
          <rect key={`${x}${y}`} x={x - 7} y={y - 7} width="14" height="14" fill="var(--surface-panel)" stroke="var(--accent)" strokeWidth="2" />
        ))}

        {/* Dimensions */}
        <g stroke="var(--accent)" strokeWidth="1.5" fill="none">
          <path d="M-150 610 H150 M-150 600 V620 M150 600 V620" />
          <path d="M190 170 V570 M180 170 H200 M180 570 H200" />
          <path d="M-190 0 V170 M-200 0 H-180 M-200 170 H-180" />
        </g>
        <g fill="var(--accent)" fontSize="22" fontWeight="600" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <text x="0" y="646" textAnchor="middle">
            300 mm
          </text>
          <text x="204" y="376" dominantBaseline="middle">
            400
          </text>
          <text x="-204" y="92" textAnchor="end" dominantBaseline="middle">
            170
          </text>
          <text x="0" y="130" textAnchor="middle" fontSize="18" fontWeight="500">
            Front print area
          </text>
        </g>
      </g>
    </svg>
  );
}
