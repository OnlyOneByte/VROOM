import CATALOG from '../shared-vehicle-catalog.json';

export interface CatalogMake {
  id: string;
  name: string;
  aliases: string[];
}

export interface CatalogModel {
  id: string;
  makeId: string;
  name: string;
  aliases: string[];
}

export const VEHICLE_CATALOG: { makes: CatalogMake[]; models: CatalogModel[] } = CATALOG;

const YEAR_TOKEN = /^(19|20)\d\d$/;

export function catalogTokens(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

export function catalogKey(text: string): string {
  return catalogTokens(text).join('');
}

function keysOf(entry: { name: string; aliases: string[] }): string[] {
  return [entry.name, ...entry.aliases].map(catalogKey);
}

const MODELS_BY_ID = new Map(VEHICLE_CATALOG.models.map((model) => [model.id, model]));
const MAKE_BY_KEY = new Map(
  VEHICLE_CATALOG.makes.flatMap((make) => keysOf(make).map((key) => [key, make.id] as const))
);
const MODELS_BY_MAKE = new Map<string, Map<string, string>>();
for (const model of VEHICLE_CATALOG.models) {
  const byKey = MODELS_BY_MAKE.get(model.makeId) ?? new Map<string, string>();
  for (const key of keysOf(model)) byKey.set(key, model.id);
  MODELS_BY_MAKE.set(model.makeId, byKey);
}

export function isCatalogModel(id: string): boolean {
  return MODELS_BY_ID.has(id);
}

export function catalogModel(id: string): CatalogModel | undefined {
  return MODELS_BY_ID.get(id);
}

function prefixMatches(tokens: string[], index: Map<string, string>) {
  const matches: { id: string; rest: string[] }[] = [];
  for (let length = tokens.length; length > 0; length--) {
    const id = index.get(tokens.slice(0, length).join(''));
    if (id) matches.push({ id, rest: tokens.slice(length) });
  }
  return matches;
}

function yearVariants(tokens: string[]): string[][] {
  return YEAR_TOKEN.test(tokens[0] ?? '') ? [tokens, tokens.slice(1)] : [tokens];
}

function makeCandidates(makeTokens: string[], modelTokens: string[]) {
  if (makeTokens.length === 0) {
    return prefixMatches(modelTokens, MAKE_BY_KEY).map(({ id, rest }) => ({ makeId: id, rest }));
  }
  const givenMake = prefixMatches(makeTokens, MAKE_BY_KEY)[0]?.id;
  if (!givenMake) return [];
  const withoutRepeatedMake = prefixMatches(modelTokens, MAKE_BY_KEY)
    .filter(({ id }) => id === givenMake)
    .map(({ rest }) => ({ makeId: givenMake, rest }));
  return [...withoutRepeatedMake, { makeId: givenMake, rest: modelTokens }];
}

export function catalogModelMatchesMake(modelId: string, make: string): boolean {
  const makeId = prefixMatches(catalogTokens(make), MAKE_BY_KEY)[0]?.id;
  return makeId !== undefined && MODELS_BY_ID.get(modelId)?.makeId === makeId;
}

export function suggestCatalogModel(make: string, model: string): string | null {
  const makeTokens = catalogTokens(make);
  for (const modelTokens of yearVariants(catalogTokens(model))) {
    for (const { makeId, rest } of makeCandidates(makeTokens, modelTokens)) {
      const models = MODELS_BY_MAKE.get(makeId);
      if (!models) continue;
      for (const tokens of yearVariants(rest)) {
        const match = prefixMatches(tokens, models)[0];
        if (match) return match.id;
      }
    }
  }
  return null;
}
