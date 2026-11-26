import { csvText } from '#lib/components/analytics/explore/explore-data';
import type { DriverBalances } from '#lib/types/index.ts';
import { formatCurrency, fromMinor, toMinor } from '#lib/utils/formatters.ts';

const amount = (n: number) => String(fromMinor(toMinor(n)));

export function balancesCsv(data: DriverBalances): string {
	const lines = [
		['Driver', 'Owed', 'Paid', 'Balance'],
		...data.drivers.map(d => [csvText(d.name), amount(d.owed), amount(d.paid), amount(d.balance)]),
		[],
		['Pays', 'To', 'Amount'],
		...data.transfers.map(t => [csvText(t.fromName), csvText(t.toName), amount(t.amount)])
	];
	return lines.map(line => line.join(',')).join('\r\n') + '\r\n';
}

export function balancesText(data: DriverBalances, period: string): string {
	if (data.transfers.length === 0) return `Everyone is settled up for ${period}.`;
	return data.transfers
		.map(
			t => `${t.fromName} pays ${t.toName} ${formatCurrency(t.amount, undefined, 2)} for ${period}.`
		)
		.join('\n');
}
