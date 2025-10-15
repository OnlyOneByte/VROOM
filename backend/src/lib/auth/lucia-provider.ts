import type { Lucia } from 'lucia';
import { lucia } from './lucia.js';

// Global Lucia instance provider
let currentLucia: Lucia = lucia;

export function getLucia(): Lucia {
  return currentLucia;
}

export function setLucia(luciaInstance: Lucia): void {
  currentLucia = luciaInstance;
}

export function resetLucia(): void {
  currentLucia = lucia;
}
