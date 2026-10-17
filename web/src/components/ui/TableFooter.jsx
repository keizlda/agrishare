import Pagination from "./Pagination.jsx";

// One-line table footer pinned to the bottom of its card: "Showing X–Y of N
// farmers" on the left, pagination on the right. It keeps the same height
// with or without pagination, so the table area above it never changes size.
// `noun` is [singular, plural].
export default function TableFooter({ page, pageSize, total, totalPages, onPageChange, noun }) {
  const label = total === 1 ? noun[0] : noun[1];
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="agri-table-footer">
      <div className="agri-muted">{total === 0 ? `Showing 0 of 0 ${label}` : `Showing ${start}–${end} of ${total} ${label}`}</div>
      <Pagination page={page} totalPages={totalPages} onChange={onPageChange} />
    </div>
  );
}
