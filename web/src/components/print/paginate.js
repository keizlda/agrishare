// Splits a printable report into paper-sized pages, so the on-screen preview
// shows every printed page as its own sheet and printing breaks in exactly
// the same places (each sheet is printed as one page).
//
// The report is first laid out once, hidden, at the paper's content width
// (the "measure" copy). Its flow is cut into atoms — blocks that never split
// (a details grid, a signature block, a title) and table rows — and atoms are
// placed on pages by their measured heights. Rules:
//   - an element with `break-before: page` (e.g. the List of Beneficiaries)
//     starts a new page;
//   - a table continued on a new page repeats its header row, and keeps the
//     same column widths as on the first page;
//   - a section label or title never ends a page alone (it moves with what
//     follows), and a table's Total row never starts a page alone (the row
//     before it moves with it);
//   - an atom taller than a whole page is placed on its own page.
// Each page is then built from clones of the measured elements, inside a
// shallow copy of their containers, so every page has the same styling.

// Elements whose children are laid out one by one (otherwise an element is
// one unbreakable block).
const isContainer = (el) => el.matches("section, .pr-section, [data-pr-container]");
const keepsWithNext = (el) => el.matches(".pr-section-label, .pr-title-block");
// A little room for rounding, so a page never overflows by a pixel.
const SAFETY_PX = 6;

function collectAtoms(root) {
  const atoms = [];
  const walk = (node, breakFirst) => {
    let pendingBreak = breakFirst;
    for (const el of node.children) {
      const breakHere = pendingBreak || getComputedStyle(el).breakBefore === "page" || el.matches("[data-pr-break-before]");
      pendingBreak = false;
      if (el.tagName === "TABLE") {
        const rows = [...el.querySelectorAll(":scope > tbody > tr")];
        rows.forEach((tr, i) => atoms.push({ el: tr, table: el, rowIndex: i, breakBefore: breakHere && i === 0, keepWithPrev: tr.matches(".pr-items-total") }));
        if (rows.length === 0) atoms.push({ el, breakBefore: breakHere });
      } else if (isContainer(el)) {
        const before = atoms.length;
        walk(el, breakHere);
        if (atoms.length === before) atoms.push({ el, breakBefore: breakHere });
      } else {
        atoms.push({ el, breakBefore: breakHere, keepWithNext: keepsWithNext(el) });
      }
    }
  };
  walk(root, false);
  return atoms;
}

// Pages as lists of atoms. `available`: content height of a page below the
// repeated header, in px.
export function planPages(flow, available) {
  const atoms = collectAtoms(flow);
  const origin = flow.getBoundingClientRect().top;
  for (const a of atoms) {
    const r = a.el.getBoundingClientRect();
    a.top = r.top - origin;
    a.bottom = r.bottom - origin;
    if (a.table) {
      const head = a.table.tHead?.getBoundingClientRect();
      a.headTop = (head ? head.top : r.top) - origin;
      a.headHeight = head ? head.height : 0;
    }
  }

  const pages = [];
  let page = null;
  let start = 0;
  let extra = 0;
  const open = (atom, first = false) => {
    page = [];
    pages.push(page);
    if (first) {
      start = 0;
      extra = 0;
    } else if (atom.table && atom.rowIndex === 0) {
      start = atom.headTop;
      extra = 0;
    } else {
      start = atom.top;
      extra = atom.table ? atom.headHeight : 0;
    }
  };
  const fits = (bottom) => bottom - start + extra <= available - SAFETY_PX;

  atoms.forEach((atom, i) => {
    if (!page) open(atom, true);
    else if (atom.breakBefore && page.length > 0) open(atom);
    // A label or title must fit together with what follows it.
    const next = atoms[i + 1];
    const bottom = atom.keepWithNext && next && !next.breakBefore ? Math.max(atom.bottom, next.bottom) : atom.bottom;
    if (!fits(bottom) && page.length > 0) {
      // Keep a Total row with the row before it.
      const prev = page[page.length - 1];
      const carry = atom.keepWithPrev && prev?.table === atom.table && page.length > 1 ? page.pop() : null;
      // Move a trailing label/title along too.
      const carried = [];
      while (page.length > 1 && page[page.length - 1].keepWithNext) carried.unshift(page.pop());
      if (carry) carried.push(carry);
      open(carried[0] ?? atom);
      page.push(...carried);
    }
    page.push(atom);
  });
  return pages;
}

// Fills `target` with page `atoms`: clones of the atoms inside shallow copies
// of their containers (up to `flow`). A table gets its column widths fixed
// to the measured ones and its header row repeated.
export function buildPage(target, flow, atoms) {
  const copies = new Map();
  const flowCopy = flow.cloneNode(false);
  copies.set(flow, flowCopy);
  const copyOf = (el) => {
    if (copies.has(el)) return copies.get(el);
    const parent = copyOf(el.parentElement);
    const copy = el.cloneNode(false);
    if (el.tagName === "TABLE") {
      const widths = [...(el.tHead?.rows[0]?.cells ?? [])].map((c) => c.getBoundingClientRect().width);
      const cols = el.querySelector(":scope > colgroup");
      if (cols) copy.appendChild(cols.cloneNode(true));
      else if (widths.length) {
        const group = document.createElement("colgroup");
        for (const w of widths) {
          const col = document.createElement("col");
          col.style.width = `${w}px`;
          group.appendChild(col);
        }
        copy.appendChild(group);
      }
      copy.style.tableLayout = "fixed";
      if (el.tHead) copy.appendChild(el.tHead.cloneNode(true));
    }
    parent.appendChild(copy);
    copies.set(el, copy);
    return copy;
  };
  for (const atom of atoms) copyOf(atom.el.parentElement).appendChild(atom.el.cloneNode(true));
  target.replaceChildren(flowCopy);
}
