// Names that carry a user's credentials. Values under these names are kept
// in the private session file and masked in output, never written into the
// OpenAPI document or asked for as parameters.

export const SESSION_HEADER = /^(cookie|authorization)$|csrf|xsrf|token|api[-_]?key|session|auth/i;

export const CREDENTIAL_PARAM = /api[-_]?key|access[-_]?token|^token$|[-_]token$|auth|session|signature|^sig$|secret|password/i;

// JSON or form fields whose values are secrets: passwords, one-time codes,
// tokens, keys. Their values are never kept as examples and are masked in
// recorded request bodies.
export const CREDENTIAL_FIELD =
  /pass(word|wd|phrase)|^pass$|^pwd$|secret|^otp$|otp[-_]?code|^pin$|^pin[-_]?code$|^mfa|totp|token$|^token|api[-_]?key|private[-_]?key|credential|^session[-_]?id$|^sid$/i;

// A JSON Web Token, wherever it appears.
export const JWT = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./;

export const REDACTED = "[redacted]";
