import bcrypt from "bcryptjs";

const PIN_COST = 10;

const PIN_PATTERN = /^\d{4,6}$/;

export function isValidPinFormat(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

export function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, PIN_COST);
}

export function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}
