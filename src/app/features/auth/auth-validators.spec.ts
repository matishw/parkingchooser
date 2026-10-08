import { describe, expect, it } from 'vitest';
import { normalizeUsername, validateRegistration, validateUsername } from './auth-validators';

const valid = { firstName: 'Dana', lastName: 'Cohen', username: 'dana.c', password: 'secret123', confirmPassword: 'secret123' };

describe('auth validators', () => {
  it('accepts a valid registration', () => {
    expect(validateRegistration(valid)).toEqual({});
  });

  it('requires every field', () => {
    const errors = validateRegistration({ firstName: ' ', lastName: '', username: '', password: '', confirmPassword: '' });
    expect(Object.keys(errors).sort()).toEqual(['confirmPassword', 'firstName', 'lastName', 'password', 'username']);
  });

  it('rejects mismatched passwords', () => {
    expect(validateRegistration({ ...valid, confirmPassword: 'secret124' }).confirmPassword).toBe('Passwords do not match.');
  });

  it('rejects short passwords', () => {
    expect(validateRegistration({ ...valid, password: 'short', confirmPassword: 'short' }).password).toContain('at least 8');
  });

  it('validates usernames', () => {
    expect(validateUsername('ab')).not.toBeNull();
    expect(validateUsername('has space')).not.toBeNull();
    expect(validateUsername('dana@x')).not.toBeNull();
    expect(validateUsername('  Dana_C-1  ')).toBeNull();
    expect(normalizeUsername('  Dana_C ')).toBe('dana_c');
  });
});
