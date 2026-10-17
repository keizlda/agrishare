// Props for a table row that opens details when clicked (Farmers,
// Distributions, Commodities, Requests). The row gets the .agri-row-link
// hover/selected styling (theme.css), can be reached with Tab, and Enter or
// Space opens it like a click. Keys pressed on something inside the row
// (the ⋯ button) are left to that element.
// onOpen receives the row element, e.g. to return focus to it later.
export function rowLinkProps(onOpen, { selected = false } = {}) {
  return {
    className: selected ? "agri-row-link selected" : "agri-row-link",
    tabIndex: 0,
    "aria-current": selected ? "true" : undefined,
    onClick: (e) => onOpen(e.currentTarget),
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      onOpen(e.currentTarget);
    },
  };
}

// For the cell holding a row's ⋯ menu: clicks inside it never open the row,
// and hovering it doesn't highlight the row (see .agri-row-actions).
export const rowActionsCellProps = {
  className: "agri-row-actions",
  onClick: (e) => e.stopPropagation(),
};
