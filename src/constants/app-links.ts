/**
 * Where the legal pages and the contact address are. The owner supplies them in the build environment
 * (see .env.example); a row in the settings screen only appears once its value exists, so no dead link is shown.
 */
export const APP_LINKS = {
  termsUrl: process.env.EXPO_PUBLIC_TERMS_URL ?? '',
  privacyUrl: process.env.EXPO_PUBLIC_PRIVACY_URL ?? '',
  contactEmail: process.env.EXPO_PUBLIC_CONTACT_EMAIL ?? '',
} as const;

/** Only http(s) pages are opened from a setting; anything else is ignored. */
export const isWebUrl = (value: string): boolean => /^https:\/\/[^\s]+$/.test(value);
export const isEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
