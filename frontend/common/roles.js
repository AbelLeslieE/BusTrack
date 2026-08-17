/** The four supported Bus Tracker account roles. */

export const ROLE_ADMIN = "admin";
export const ROLE_DRIVER = "driver";
export const ROLE_USER = "user";
export const ROLE_TECHNICIAN = "technician";

const legacyRoles = {
  admin: ROLE_ADMIN,
  administrator: ROLE_ADMIN,
  "transport admin": ROLE_ADMIN,
  "transport manager": ROLE_ADMIN,
  driver: ROLE_DRIVER,
  student: ROLE_USER,
  user: ROLE_USER,
  dispatcher: ROLE_USER,
  technician: ROLE_TECHNICIAN,
  developer: ROLE_TECHNICIAN,
};

export function canonicalRole(value) {
  return legacyRoles[String(value || "").trim().toLowerCase()] || null;
}

export function roleLabel(value) {
  const role = canonicalRole(value);
  return role ? role[0].toUpperCase() + role.slice(1) : "Unknown";
}
