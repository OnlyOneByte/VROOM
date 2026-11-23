import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import ProviderFields, {
	fieldConfig,
	fieldErrorsFrom,
	fieldsReady,
	initialFieldValues,
	type ProviderFieldsSpec
} from '../ProviderFields.svelte';
import { ApiError } from '#lib/utils/error-handling.ts';

afterEach(() => cleanup());

const DUMMY: ProviderFieldsSpec = {
	fields: [
		{ key: 'host', label: 'Host', kind: 'url', required: true, placeholder: 'https://dav.local' },
		{ key: 'port', label: 'Port', kind: 'number', required: false, default: 8080 },
		{
			key: 'mode',
			label: 'Mode',
			kind: 'select',
			required: true,
			options: [
				{ value: 'fast', label: 'Fast' },
				{ value: 'safe', label: 'Safe' }
			],
			help: 'How files are written'
		}
	],
	secrets: [{ key: 'token', label: 'Token', required: true, reenterWhenChanged: ['host'] }]
};

describe('ProviderFields', () => {
	test('a descriptor with field kinds no form had before renders without a new component', () => {
		render(ProviderFields, {
			props: {
				idPrefix: 'dummy',
				spec: DUMMY,
				stored: undefined,
				values: initialFieldValues(DUMMY, undefined),
				secretValues: {}
			}
		});
		expect(screen.getByLabelText('Host')).toHaveAttribute('type', 'url');
		expect(screen.getByLabelText('Port')).toHaveValue(8080);
		expect(screen.getByLabelText('Mode')).toHaveTextContent('Choose…');
		expect(screen.getByLabelText('Mode')).toHaveAttribute('aria-required', 'true');
		expect(screen.getByText('How files are written')).toBeInTheDocument();
		expect(screen.getByLabelText('Token')).toHaveAttribute('type', 'password');
	});

	test('readiness follows the required fields, and a stored secret is needed again only when its field changes', () => {
		const filled = { host: 'https://dav.local', port: '8080', mode: 'fast' };
		expect(fieldsReady(DUMMY, { ...filled, mode: '' }, { token: 't' }, undefined)).toBe(false);
		expect(fieldsReady(DUMMY, filled, {}, undefined)).toBe(false);
		expect(fieldsReady(DUMMY, filled, { token: 't' }, undefined)).toBe(true);

		const stored = { host: 'https://dav.local', mode: 'fast' };
		expect(fieldsReady(DUMMY, filled, {}, stored)).toBe(true);
		expect(fieldsReady(DUMMY, { ...filled, host: 'https://other.local' }, {}, stored)).toBe(false);

		const twoKeys: ProviderFieldsSpec = {
			fields: [],
			secrets: [
				{ key: 'id', label: 'Key ID', required: true },
				{ key: 'secret', label: 'Secret', required: true }
			]
		};
		expect(fieldsReady(twoKeys, {}, {}, {})).toBe(true);
		expect(fieldsReady(twoKeys, {}, { id: 'AKIA' }, {})).toBe(false);
		expect(fieldsReady(twoKeys, {}, { id: 'AKIA', secret: 's' }, {})).toBe(true);

		expect(fieldsReady(twoKeys, {}, {}, {}, ['id', 'secret'])).toBe(true);
		expect(fieldsReady(twoKeys, {}, {}, {}, ['id'])).toBe(false);
	});

	test('only a secret the server says is stored offers to keep its saved value', () => {
		render(ProviderFields, {
			props: {
				idPrefix: 'dummy',
				spec: DUMMY,
				stored: { host: 'https://dav.local', mode: 'fast' },
				savedSecrets: [],
				values: { host: 'https://dav.local', port: '', mode: 'fast' },
				secretValues: {}
			}
		});
		expect(screen.getByLabelText('Token')).toHaveAttribute('placeholder', 'Enter Token');
		expect(screen.getByLabelText('Token')).toBeRequired();
	});

	test('typing one stored key asks for the other, in the markup as well as for Save', async () => {
		const keys: ProviderFieldsSpec = {
			fields: [],
			secrets: [
				{ key: 'id', label: 'Key ID', required: true },
				{ key: 'secret', label: 'Secret', required: true }
			]
		};
		render(ProviderFields, {
			props: {
				idPrefix: 'keys',
				spec: keys,
				stored: {},
				savedSecrets: ['id', 'secret'],
				values: {},
				secretValues: {}
			}
		});
		const secret = screen.getByLabelText('Secret');
		expect(secret).toHaveAttribute('placeholder', 'Saved, leave blank to keep');
		expect(secret).not.toBeRequired();

		await fireEvent.input(screen.getByLabelText('Key ID'), { target: { value: 'AKIA-new' } });

		expect(secret).toHaveAttribute('placeholder', 'Enter Secret');
		expect(secret).toBeRequired();
	});

	test('config keeps typed values and drops blanks', () => {
		expect(fieldConfig(DUMMY, { host: ' https://dav.local ', port: '9000', mode: '' })).toEqual({
			host: 'https://dav.local',
			port: 9000
		});
	});

	test('a backend issue for a field shows under that field', () => {
		const error = new ApiError('Invalid', 400, {
			issues: [{ path: ['host'], message: 'Host must use https' }]
		});
		const errors = fieldErrorsFrom(error, DUMMY);
		expect(errors).toEqual({ host: 'Host must use https' });

		render(ProviderFields, {
			props: {
				idPrefix: 'dummy',
				spec: DUMMY,
				stored: undefined,
				values: initialFieldValues(DUMMY, undefined),
				secretValues: {},
				errors
			}
		});
		expect(screen.getByLabelText('Host')).toHaveAttribute('aria-invalid', 'true');
		expect(screen.getByRole('alert')).toHaveTextContent('Host must use https');
	});
});
