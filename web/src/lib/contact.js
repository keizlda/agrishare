// Contact numbers (farmers, Farmers' Association Presidents, the office):
// a Philippine mobile number, exactly 11 digits starting with 09, e.g.
// 09171234567. The database checks the same rule.
export const CONTACT_PATTERN = /^09\d{9}$/;
export const CONTACT_ERROR = "Enter an 11-digit mobile number starting with 09.";
export const CONTACT_PLACEHOLDER = "09171234567";

// What the field keeps while typing: digits only, at most 11.
export const contactInput = (value) => String(value ?? "").replace(/\D/g, "").slice(0, 11);

export const isValidContact = (value) => CONTACT_PATTERN.test(String(value ?? ""));
