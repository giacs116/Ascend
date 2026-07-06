// The Ascend body: a stylized low-poly anatomy figure (front + back) with tappable
// muscle regions, plus tiny stick-figure pictograms for exercise recommendations.

const NS = 'http://www.w3.org/2000/svg';
const CX = 110; // figure center in a 0 0 220 460 viewBox

function sv(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  return el;
}

const poly = (pts, s = 1) =>
  pts.map(([dx, y], i) => `${i ? 'L' : 'M'} ${(CX + s * dx).toFixed(1)} ${y}`).join(' ') + ' Z';

// ── Muscle geometry ──────────────────────────────────────────
// side pieces are mirrored automatically; center pieces span the midline.
const FRONT = {
  sil: {
    center: [
      [[-7, 53], [7, 53], [10, 73], [-10, 73]],                    // neck
      [[-11, 221], [11, 221], [0, 250]],                           // pelvis
    ],
    side: [
      [[53, 203], [65, 198], [69, 223], [57, 228]],                // hands
      [[13, 393], [29, 385], [35, 407], [15, 411]],                // feet
    ],
  },
  muscles: {
    traps: { side: [[[10, 70], [37, 81], [13, 85]]] },
    shoulders: { side: [[[37, 80], [53, 86], [59, 105], [47, 117], [37, 99]]] },
    chest: { side: [[[3, 86], [35, 84], [45, 117], [29, 139], [3, 141]]] },
    biceps: { side: [[[41, 121], [55, 111], [59, 149], [47, 157], [41, 139]]] },
    forearms: { side: [[[47, 159], [59, 151], [65, 197], [53, 201]]] },
    core: {
      center: [[[-16, 145], [16, 145], [14, 209], [8, 219], [-8, 219], [-14, 209]]],
      side: [[[18, 149], [28, 145], [26, 197], [16, 205]]],
    },
    quads: { side: [[[4, 219], [28, 213], [36, 253], [30, 307], [14, 319], [4, 301]]] },
    calves: { side: [[[12, 323], [28, 317], [26, 379], [16, 389], [10, 369]]] },
  },
};

const BACK = {
  sil: {
    center: [
      [[-7, 53], [7, 53], [10, 73], [-10, 73]],
    ],
    side: [
      [[53, 203], [65, 198], [69, 223], [57, 228]],
      [[13, 393], [29, 385], [35, 407], [15, 411]],
    ],
  },
  muscles: {
    traps: { center: [[[0, 60], [27, 83], [0, 127], [-27, 83]]] },
    shoulders: { side: [[[37, 80], [53, 86], [59, 105], [47, 117], [37, 99]]] },
    lats: { side: [[[4, 130], [26, 119], [39, 119], [33, 171], [13, 191], [4, 193]]] },
    triceps: { side: [[[41, 121], [55, 111], [59, 149], [47, 157], [41, 139]]] },
    forearms: { side: [[[47, 159], [59, 151], [65, 197], [53, 201]]] },
    lowerback: { center: [[[0, 187], [14, 197], [0, 225], [-14, 197]]] },
    glutes: { side: [[[3, 227], [27, 221], [35, 249], [29, 277], [3, 281]]] },
    hamstrings: { side: [[[6, 285], [31, 281], [33, 313], [19, 339], [8, 325]]] },
    calves: { side: [[[10, 343], [27, 335], [29, 381], [17, 391], [10, 373]]] },
  },
};

/**
 * Build one view of the body.
 * @param {'front'|'back'} view
 * @param {(key:string)=>'on'|'off'} statusFor
 * @param {{mini?:boolean, onTap?:(key:string)=>void}} opts
 */
export function buildBodySvg(view, statusFor, { mini = false, onTap } = {}) {
  const spec = view === 'back' ? BACK : FRONT;
  const svg = sv('svg', { viewBox: '0 0 220 460', class: `body-svg${mini ? ' body-svg--mini' : ''}` });

  // head is shared
  const head = sv('circle', { cx: CX, cy: 34, r: 19, class: 'body-sil' });
  svg.append(head);

  const addPath = (d, cls, key = null) => {
    const p = sv('path', { d, class: cls });
    if (key) {
      p.dataset.muscle = key;
      if (onTap) p.addEventListener('pointerdown', (e) => { e.stopPropagation(); onTap(key); });
    }
    svg.append(p);
    return p;
  };

  for (const pts of spec.sil.center) addPath(poly(pts), 'body-sil');
  for (const pts of spec.sil.side) { addPath(poly(pts, 1), 'body-sil'); addPath(poly(pts, -1), 'body-sil'); }

  for (const [key, shapes] of Object.entries(spec.muscles)) {
    const cls = `body-m body-m--${statusFor(key)}`;
    for (const pts of shapes.center || []) addPath(poly(pts), cls, key);
    for (const pts of shapes.side || []) { addPath(poly(pts, 1), cls, key); addPath(poly(pts, -1), cls, key); }
  }
  return svg;
}

// Which muscle keys are visible on each view (for the "flip to see" hint)
export const FRONT_KEYS = ['traps', 'shoulders', 'chest', 'biceps', 'forearms', 'core', 'quads', 'calves'];
export const BACK_KEYS = ['traps', 'shoulders', 'lats', 'triceps', 'forearms', 'lowerback', 'glutes', 'hamstrings', 'calves'];

// ── Exercise pictograms (64×64 stroke figures) ───────────────
const PICTO = {
  squat: '<circle cx="30" cy="11" r="4.5"/><path d="M12 20h38"/><path d="M25 20l5 4 6-4"/><path d="M30 24l-2 12"/><path d="M28 36l-8 8 2 12"/><path d="M28 36l8 6-1 14"/><path d="M14 56h10M33 56h10"/>',
  hinge: '<circle cx="41" cy="14" r="4.5"/><path d="M38 18L23 32"/><path d="M23 32l1 14-2 10"/><path d="M23 32l7 12 1 12"/><path d="M39 20l3 24"/><path d="M30 44h20"/><circle cx="52" cy="44" r="3.5"/>',
  lunge: '<circle cx="32" cy="10" r="4.5"/><path d="M32 15v14"/><path d="M32 29l-12 8 0 14"/><path d="M32 29l10 6 6 14"/><path d="M14 56h12M42 56h12"/>',
  bench: '<path d="M8 46h48"/><path d="M14 46v8M50 46v8"/><circle cx="15" cy="40" r="4"/><path d="M20 40h26"/><path d="M34 40V26"/><path d="M20 26h30"/><circle cx="22" cy="26" r="2.5"/><circle cx="48" cy="26" r="2.5"/>',
  ohp: '<circle cx="32" cy="18" r="4.5"/><path d="M14 8h36"/><path d="M25 22l-4-11M39 22l4-11"/><path d="M32 23v16"/><path d="M32 39l-6 16M32 39l6 16"/>',
  pushup: '<path d="M10 42L46 33"/><circle cx="51" cy="31" r="4.5"/><path d="M22 40l-3 12"/><path d="M40 35l1 10 4 6"/><path d="M8 54h48"/>',
  row: '<circle cx="42" cy="12" r="4.5"/><path d="M40 16L26 28"/><path d="M26 28l0 16-3 12"/><path d="M26 28l9 10 2 16"/><path d="M40 18l-2 12 4 8"/><path d="M32 38h18"/><circle cx="52" cy="38" r="3"/>',
  pullup: '<path d="M12 9h40"/><path d="M25 9l4 10M39 9l-4 10"/><circle cx="32" cy="23" r="4.5"/><path d="M32 28v13"/><path d="M32 41l-5 8 1 6"/><path d="M32 41l6 7-2 8"/>',
  curl: '<circle cx="30" cy="11" r="4.5"/><path d="M30 16v22"/><path d="M30 38l-4 16M30 38l6 15"/><path d="M30 21l7 9"/><path d="M37 30l6-9"/><circle cx="44" cy="19" r="3.5"/>',
  triceps: '<circle cx="30" cy="12" r="4.5"/><path d="M30 17v21"/><path d="M30 38l-5 16M30 38l6 15"/><path d="M30 22l8 6"/><path d="M38 28l8 8"/><path d="M42 40l8-8"/>',
  raise: '<circle cx="32" cy="11" r="4.5"/><path d="M32 16v24"/><path d="M32 40l-5 15M32 40l6 15"/><path d="M32 22H13M32 22h19"/><circle cx="11" cy="22" r="2.8"/><circle cx="53" cy="22" r="2.8"/>',
  core: '<path d="M12 40l34-7"/><circle cx="51" cy="31" r="4.5"/><path d="M20 38v10M28 36v12"/><path d="M8 52h48"/>',
  calf: '<circle cx="31" cy="10" r="4.5"/><path d="M31 15l-1 24"/><path d="M30 39l-2 12"/><path d="M30 39l4 11"/><path d="M26 55l10-4"/><path d="M36 51l4-2"/>',
  glutebridge: '<path d="M6 52h52"/><circle cx="12" cy="47" r="4"/><path d="M17 48l16-13"/><path d="M33 35l8 9"/><path d="M41 44l3 8"/>',
  cardio: '<circle cx="35" cy="10" r="4.5"/><path d="M34 15l-6 13"/><path d="M28 28l10 3 4 10"/><path d="M42 41l-2 12"/><path d="M28 28l-4 12-8 6"/><path d="M33 20l10 4"/><path d="M28 22l-10 2"/>',
  generic: '<path d="M16 32h32"/><path d="M20 24v16M44 24v16"/><path d="M14 27v10M50 27v10"/>',
};

const PICTO_RULES = [
  [/calf raise|jump rope/i, 'calf'],
  [/hanging leg raise|plank|crunch|sit-?up|twist|rollout|climber/i, 'core'],
  [/bridge|thrust/i, 'glutebridge'],
  [/lunge|split squat/i, 'lunge'],
  [/squat|leg press|hack|leg extension|pistol/i, 'squat'],
  [/deadlift|swing|nordic|leg curl/i, 'hinge'],
  [/bench|chest press|fly|pec deck/i, 'bench'],
  [/overhead press|shoulder press|arnold|handstand|pike|upright/i, 'ohp'],
  [/push-?up|dip\b/i, 'pushup'],
  [/face pull|row/i, 'row'],
  [/pull-?up|pulldown|chin-?up/i, 'pullup'],
  [/wrist curl|curl/i, 'curl'],
  [/pushdown|extension|skull|close-grip|diamond/i, 'triceps'],
  [/raise|shrug/i, 'raise'],
  [/run|walk|cycl|bike|swim|stair|elliptical|hike|sprint|box|basket|soccer|tennis|volley|martial|yoga|pilates|ski|skate|golf|danc|burpee|bear|climb/i, 'cardio'],
];

export function pictogram(name, size = 44) {
  let key = 'generic';
  for (const [re, k] of PICTO_RULES) if (re.test(name || '')) { key = k; break; }
  const svg = sv('svg', {
    viewBox: '0 0 64 64', width: size, height: size,
    fill: 'none', stroke: 'currentColor', 'stroke-width': 3.2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  svg.innerHTML = PICTO[key];
  return svg;
}
