/**
 * Secret deny-list applied BEFORE any file is staged into the context
 * manifest. Anything matching the rules below is dropped, even if the
 * file is otherwise relevant. The router has no business asking an
 * external model to look at a `.env` file.
 */

const PATH_DENYLIST: RegExp[] = [
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\.env$/,
  /(^|\/)credentials(\.json|\.yaml|\.yml)?$/i,
  /(^|\/)id_rsa(\.pub)?$/,
  /(^|\/)id_ed25519(\.pub)?$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.netrc$/,
  /(^|\/)\.aws\//,
  /(^|\/)\.ssh\//,
  /(^|\/)\.kube\//,
  /(^|\/)secrets?(\.|\/)/i,
  /\.pem$/,
  /\.p12$/,
  /\.key$/,
  /\.crt$/,
  /\.cer$/,
];

const CONTENT_DENYLIST: RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /sk-[A-Za-z0-9]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /xox[abps]-[A-Za-z0-9-]{10,}/,
];

export function isSecretPath(path: string): boolean {
  return PATH_DENYLIST.some((rx) => rx.test(path));
}

export function containsSecretMaterial(contents: string): boolean {
  return CONTENT_DENYLIST.some((rx) => rx.test(contents));
}
