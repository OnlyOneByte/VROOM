import { createMongoAbility, type MongoAbility, type RawRuleOf } from '@casl/ability';
import { type PackRule, unpackRules } from '@casl/ability/extra';

type Ability = MongoAbility<[string, 'all']>;

export type PackedRules = PackRule<RawRuleOf<Ability>>[];

export function can(rules: PackedRules, permission: string, entry?: 'own' | 'other'): boolean {
	if (permission.endsWith('.delete_own') && entry === 'other') return false;
	const ability = createMongoAbility<Ability>(unpackRules(rules) as RawRuleOf<Ability>[]);
	if (ability.can(permission, 'all')) return true;
	return (
		entry === 'own' && permission.endsWith('.delete') && ability.can(`${permission}_own`, 'all')
	);
}
