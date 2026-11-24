export interface CatalogEntry {
	id: string;
	name: string;
	aliases: string[];
}

export interface CatalogModel extends CatalogEntry {
	makeId: string;
}

export interface VehicleCatalog {
	makes: CatalogEntry[];
	models: CatalogModel[];
}

const MAX_SUGGESTIONS = 8;

let catalogPromise: Promise<VehicleCatalog> | null = null;

export function loadVehicleCatalog(): Promise<VehicleCatalog> {
	catalogPromise ??= import('#lib/constants/vehicle-catalog.json')
		.then(module => module.default as VehicleCatalog)
		.catch(error => {
			catalogPromise = null;
			throw error;
		});
	return catalogPromise;
}

export function catalogKey(text: string): string {
	return text
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '');
}

function keysOf(entry: CatalogEntry): string[] {
	return [entry.name, ...entry.aliases].map(catalogKey);
}

function rank<T extends CatalogEntry>(entries: T[], text: string): T[] {
	const typed = catalogKey(text);
	if (!typed) return entries.slice(0, MAX_SUGGESTIONS);
	const scored = entries.flatMap(entry => {
		const keys = keysOf(entry);
		if (keys.some(key => key.startsWith(typed))) return [{ entry, score: 0 }];
		if (keys.some(key => key.includes(typed))) return [{ entry, score: 1 }];
		return [];
	});
	return scored
		.sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name))
		.slice(0, MAX_SUGGESTIONS)
		.map(({ entry }) => entry);
}

export function findMake(catalog: VehicleCatalog, makeText: string): CatalogEntry | undefined {
	const typed = catalogKey(makeText);
	if (!typed) return undefined;
	return catalog.makes.find(make => keysOf(make).includes(typed));
}

export function makeSuggestions(catalog: VehicleCatalog, makeText: string): CatalogEntry[] {
	return rank(catalog.makes, makeText);
}

export function modelSuggestions(
	catalog: VehicleCatalog,
	makeText: string,
	modelText: string
): CatalogModel[] {
	const make = findMake(catalog, makeText);
	if (!make) return [];
	return rank(
		catalog.models.filter(model => model.makeId === make.id),
		modelText
	);
}

export function textStillNames(
	catalog: VehicleCatalog,
	modelId: string,
	makeText: string,
	modelText: string
): boolean {
	const model = catalog.models.find(entry => entry.id === modelId);
	if (!model || findMake(catalog, makeText)?.id !== model.makeId) return false;
	return keysOf(model).includes(catalogKey(modelText));
}

export function suggestCatalogModel(
	catalog: VehicleCatalog,
	makeText: string,
	modelText: string
): CatalogModel | undefined {
	const make = findMake(catalog, makeText);
	if (!make) return undefined;
	let typed = catalogKey(modelText);
	const repeatedMake = keysOf(make).find(key => typed.startsWith(key));
	if (repeatedMake) typed = typed.slice(repeatedMake.length);
	let best: { model: CatalogModel; length: number } | undefined;
	for (const model of catalog.models) {
		if (model.makeId !== make.id) continue;
		for (const key of keysOf(model)) {
			if (key && typed.startsWith(key) && key.length > (best?.length ?? 0)) {
				best = { model, length: key.length };
			}
		}
	}
	return best?.model;
}
