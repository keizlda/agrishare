import { KINDS } from "../../lib/validationInbox.js";

// "Proof of planting" or "Harvest" — the submission type in the inbox.
export default function KindTag({ kind }) {
  return <span className={`agri-kind-tag ${kind}`}>{KINDS[kind]}</span>;
}
