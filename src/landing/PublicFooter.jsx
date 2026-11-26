// src/landing/PublicFooter.jsx
// The footer on every signed-out page: the privacy policy, the terms and the
// support address.
import { buildSupportMailto } from "../appMeta";

export const PRIVACY_HREF = "/legal/privacy-policy.html";
export const TERMS_HREF = "/legal/terms-of-service.html";

const footLink = { minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" };

export function PublicFooter() {
  return (
    <footer style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 24px", padding: "8px 16px calc(8px + env(safe-area-inset-bottom, 0px))", borderTop: "1px solid var(--line)" }}>
      <a className="t-s u" style={footLink} href={PRIVACY_HREF}>Privacy</a>
      <a className="t-s u" style={footLink} href={TERMS_HREF}>Terms</a>
      <a className="t-s u" style={footLink} href={buildSupportMailto()}>Email support</a>
    </footer>
  );
}
