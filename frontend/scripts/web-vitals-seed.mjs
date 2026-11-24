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
const categories = [
	'fuel',
	'fuel',
	'fuel',
	'fuel',
	'fuel',
	'fuel',
	'maintenance',
	'maintenance',
	'misc',
	'regulatory',
	'enhancement',
	'financial'
];
const expensesPerVehicle = 2000;
const odometerPerVehicle = 200;

const insertVehicle = db.prepare(
	`insert into vehicles (id, user_id, make, model, year, vehicle_type, track_fuel, track_charging, license_plate,
	 initial_mileage, purchase_price, purchase_date, unit_preferences, created_at, updated_at)
	 values (?, ?, ?, ?, 2021, ?, ?, ?, ?, 10000, 4000000, ?, ?, ?, ?)`
);
const insertExpense = db.prepare(
	`insert into expenses (id, vehicle_id, category, tags, date, mileage, description, location, created_at, updated_at,
	 expense_amount, volume, fuel_type, missed_fillup, user_id, created_by)
	 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
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
	const vehicles = db.query('select id, vehicle_type from vehicles where user_id = ?').all(user.id);
	for (const vehicle of vehicles) {
		const existing = db
			.query('select count(*) as n from expenses where vehicle_id = ?')
			.get(vehicle.id).n;
		const count = expensesPerVehicle - existing;
		let miles = 10000;
		for (let i = 0; i < count; i++) {
			const date = now - span + Math.floor((span * i) / count);
			const category = categories[i % categories.length];
			const isFuel = category === 'fuel';
			miles += 45 + Math.floor(random() * 30);
			const fuelType = isFuel
				? vehicle.vehicle_type === 'electric'
					? 'Level 2 (AC)'
					: 'Regular'
				: null;
			insertExpense.run(
				id('exp'),
				vehicle.id,
				category,
				JSON.stringify([category]),
				date,
				isFuel || i % 3 ? miles : null,
				`Perf ${category} ${i}`,
				i % 5 ? null : 'Main St',
				date,
				date,
				1000 + Math.floor(random() * 9000),
				isFuel ? 8 + random() * 6 : null,
				fuelType,
				user.id,
				user.id
			);
		}
		for (let i = 0; i < odometerPerVehicle; i++) {
			const date = now - span + Math.floor((span * i) / odometerPerVehicle);
			insertOdometer.run(
				id('odo'),
				vehicle.id,
				user.id,
				10000 + i * 600,
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
