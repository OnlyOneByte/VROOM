import { Database } from 'bun:sqlite';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.error('web-vitals-seed: set DATABASE_URL to a database made by `bun run db:seed`.');
	process.exit(1);
}

const db = new Database(databaseUrl);
const user = db.query('select id from users order by created_at limit 1').get();
if (!user) {
	console.error('web-vitals-seed: no user found. Run `bun run db:seed` first.');
	process.exit(1);
}

let state = 1405;
function random() {
	state = (state + 0x6d2b79f5) | 0;
	let t = Math.imul(state ^ (state >>> 15), 1 | state);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
let counter = 0;
const id = prefix => `${prefix}${String(++counter).padStart(20 - prefix.length, '0')}`;

const now = Math.floor(Date.now() / 1000);
const span = 8 * 365 * 86400;
const units = JSON.stringify({
	distanceUnit: 'miles',
	volumeUnit: 'gallons_us',
	chargeUnit: 'kwh'
});
const fleet = [
	['Tesla', 'Model 3', 'electric', 0, 1, 'PERF001'],
	['Toyota', 'Prius', 'hybrid', 1, 0, 'PERF002'],
	['Ford', 'F-150', 'gas', 1, 0, 'PERF003']
];
const economy = {
	'Model 3': [3.6, 4.4],
	Prius: [48, 55],
	'F-150': [17, 22],
	Camry: [28, 34],
	Civic: [32, 38]
};
const categories = [
	'fuel',
	'maintenance',
	'fuel',
	'misc',
	'fuel',
	'regulatory',
	'fuel',
	'enhancement',
	'fuel',
	'financial',
	'fuel',
	'maintenance'
];
const otherCategories = categories.filter(c => c !== 'fuel');
const between = ([low, high]) => low + random() * (high - low);
const expensesPerVehicle = 2000;
const odometerPerVehicle = 200;

const insertVehicle = db.prepare(
	`insert into vehicles (id, user_id, make, model, year, vehicle_type, track_fuel, track_charging, license_plate,
	 initial_mileage, purchase_price, purchase_date, unit_preferences, created_at, updated_at)
	 values (?, ?, ?, ?, 2021, ?, ?, ?, ?, 10000, 4000000, ?, ?, ?, ?)`
);
const insertExpense = db.prepare(
	`insert into expenses (id, vehicle_id, category, tags, date, mileage, description, location, created_at, updated_at,
	 expense_amount, volume, fuel_type, charger_type, missed_fillup, user_id, created_by)
	 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
);
const insertOdometer = db.prepare(
	`insert into odometer_entries (id, vehicle_id, user_id, odometer, recorded_at, note, created_at, updated_at)
	 values (?, ?, ?, ?, ?, ?, ?, ?)`
);

db.transaction(() => {
	for (const [make, model, type, trackFuel, trackCharging, plate] of fleet) {
		insertVehicle.run(
			id('veh'),
			user.id,
			make,
			model,
			type,
			trackFuel,
			trackCharging,
			plate,
			now - span,
			units,
			now,
			now
		);
	}
	const vehicles = db
		.query(
			'select id, model, vehicle_type, initial_mileage, purchase_date from vehicles where user_id = ? order by created_at, id'
		)
		.all(user.id);
	for (const vehicle of vehicles) {
		const existing = db
			.query('select count(*) as n from expenses where vehicle_id = ?')
			.get(vehicle.id).n;
		const count = expensesPerVehicle - existing;
		const band = economy[vehicle.model];
		const electric = vehicle.vehicle_type === 'electric';
		const pool = band ? categories : otherCategories;
		const first = db
			.query(
				'select date, mileage, volume from expenses where vehicle_id = ? and mileage is not null order by date limit 1'
			)
			.get(vehicle.id);
		const end = first ? first.date - 86400 : now;
		const endMiles =
			first && band
				? first.mileage - Math.round((first.volume ?? 0) * ((band[0] + band[1]) / 2))
				: null;
		const startMiles = vehicle.initial_mileage ?? 10000;
		const start = Math.max(now - span, vehicle.purchase_date ?? 0);
		const steps = Array.from({ length: count }, () => 0.75 + random() * 0.5);
		const scale =
			(endMiles == null ? count * 60 : endMiles - startMiles) / steps.reduce((a, b) => a + b, 0);
		const dateAt = i => start + Math.floor(((end - start) * i) / count);
		const odometer = [];
		let exact = startMiles;
		let miles = startMiles;
		let lastFill = miles;
		for (let i = 0; i < count; i++) {
			const date = dateAt(i);
			const category = band && i === count - 1 ? 'fuel' : pool[i % pool.length];
			const isFuel = category === 'fuel';
			exact += steps[i] * scale;
			miles = Math.round(exact);
			odometer.push(miles);
			const fast = electric && i % 12 === 0;
			const volume = isFuel ? Math.round(((miles - lastFill) / between(band)) * 1000) / 1000 : null;
			const price = electric
				? fast
					? between([0.38, 0.48])
					: between([0.12, 0.17])
				: between([3.2, 4.2]);
			if (isFuel) lastFill = miles;
			insertExpense.run(
				id('exp'),
				vehicle.id,
				category,
				JSON.stringify([category]),
				date,
				band && (isFuel || i % 3) ? miles : null,
				`Perf ${category} ${i}`,
				i % 5 ? null : 'Main St',
				date,
				date,
				isFuel ? Math.round(volume * price * 100) : 1000 + Math.floor(random() * 9000),
				volume,
				isFuel ? (electric ? (fast ? 'DC Fast Charging' : 'Level 2 (AC)') : '87 (Regular)') : null,
				isFuel && electric ? (fast ? 'dc_fast' : 'home') : null,
				user.id,
				user.id
			);
		}
		if (!band) continue;
		for (let i = 0; i < odometerPerVehicle; i++) {
			const at = Math.floor((count * i) / odometerPerVehicle);
			const date = dateAt(at);
			insertOdometer.run(
				id('odo'),
				vehicle.id,
				user.id,
				odometer[at],
				date,
				i % 4 ? null : 'reading',
				date,
				date
			);
		}
	}
})();

const session = crypto.randomUUID().replaceAll('-', '');
db.query('insert into sessions (id, user_id, expires_at) values (?, ?, ?)').run(
	session,
	user.id,
	now + 86400
);
const vehicle = db
	.query(
		"select id from vehicles where user_id = ? order by coalesce(license_plate, '') like 'PERF%', created_at, license_plate, id limit 1"
	)
	.get(user.id);
console.log(JSON.stringify({ session, vehicleId: vehicle.id }));
