export interface RegistrationForm {
  firstName: string;
  lastName: string;
  username: string;
  password: string;
  confirmPassword: string;
}

export type RegistrationErrors = Partial<Record<keyof RegistrationForm, string>>;

export const PASSWORD_MIN_LENGTH = 8;
const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/;

/** Usernames are case-insensitive: "Dana" and "dana" are the same account. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function validateUsername(username: string): string | null {
  const u = normalizeUsername(username);
  if (!u) return 'Username is required.';
  if (!USERNAME_PATTERN.test(u)) return 'Use 3–30 letters, numbers, dots, dashes or underscores.';
  return null;
}

function validateName(value: string, label: string): string | null {
  const v = value.trim();
  if (!v) return `${label} is required.`;
  if (v.length > 50) return `${label} must be 50 characters or fewer.`;
  return null;
}

export function validateRegistration(f: RegistrationForm): RegistrationErrors {
  const errors: RegistrationErrors = {};
  const set = (field: keyof RegistrationForm, msg: string | null) => {
    if (msg) errors[field] = msg;
  };
  set('firstName', validateName(f.firstName, 'First name'));
  set('lastName', validateName(f.lastName, 'Last name'));
  set('username', validateUsername(f.username));
  set(
    'password',
    !f.password
      ? 'Password is required.'
      : f.password.length < PASSWORD_MIN_LENGTH
        ? `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
        : null,
  );
  set(
    'confirmPassword',
    !f.confirmPassword ? 'Please confirm your password.' : f.confirmPassword !== f.password ? 'Passwords do not match.' : null,
  );
  return errors;
}
