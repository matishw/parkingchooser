/**
 * Public config — all values are safe to ship to the browser.
 * Access control is enforced by Row Level Security (see supabase/schema.sql).
 */
export const environment = {
  supabaseUrl: 'https://cbhpkjprivvnagkjxtnj.supabase.co',
  supabaseAnonKey: 'sb_publishable_Iy0639GsDEJp624v--_UuQ_gjH7-j9D',
  /** Google Cloud → APIs & Services → Credentials → OAuth 2.0 Client ID (type: Web application). */
  googleClientId: '678078032253-dvtqtfflvgbcrnuo1q0mtpnu6d8d2626.apps.googleusercontent.com',
  /**
   * Supabase Auth needs an email, so usernames are stored as `<username>@<this domain>`.
   * Internal identifier only — no mail is ever sent there. Changing it breaks existing username logins.
   */
  usernameEmailDomain: 'users.parkingapp.com',
};
