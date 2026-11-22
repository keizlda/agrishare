import { KINDS } from "../../lib/validationInbox.js";

// "Proof of planting" or "Harvest" — the submission type in the inbox.
// `soft`: the light, borderless version used in the inbox list.
export default function KindTag({ kind, soft = false }) {
  return <span className={`agri-kind-tag${soft ? " soft" : ""} ${kind}`}>{KINDS[kind]}</span>;
}
