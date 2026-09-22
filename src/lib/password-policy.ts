export const NEW_PASSWORD_MIN_LENGTH = 12;
export const NEW_PASSWORD_REQUIREMENT = 'Use at least 12 characters, including at least one special character.';

export function isValidNewPassword(password: string) {
  return password.length >= NEW_PASSWORD_MIN_LENGTH && /[!-/:-@[-`{-~]/.test(password);
}
