// Names that carry a user's credentials. Values under these names are kept
// in the private session file and masked in output, never written into the
// OpenAPI document or asked for as parameters.

export const SESSION_HEADER = /^(cookie|authorization)$|csrf|xsrf|token|api[-_]?key|session|auth/i;

export const CREDENTIAL_PARAM = /api[-_]?key|access[-_]?token|^token$|[-_]token$|auth|session|signature|^sig$|secret|password/i;
