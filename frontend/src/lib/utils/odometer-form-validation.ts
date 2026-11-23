export interface OdometerFormErrors {
	odometer?: string;
	date?: string;
	note?: string;
}

const NOTE_MAX_LENGTH = 500;

function odometerError(odometer: number | undefined): string | undefined {
	if (odometer === undefined || !Number.isFinite(odometer)) return 'Odometer reading is required';
	if (!Number.isSafeInteger(odometer)) return 'Odometer must be a whole number';
	if (odometer < 0) return 'Odometer must be 0 or greater';
	return undefined;
}

export function validateOdometerForm(form: {
	odometer: number | undefined;
	date: string;
	note: string;
}): OdometerFormErrors {
	const errors: OdometerFormErrors = {};
	const odometer = odometerError(form.odometer);
	if (odometer) errors.odometer = odometer;
	if (!form.date) errors.date = 'Date is required';
	if (form.note.length > NOTE_MAX_LENGTH) {
		errors.note = `Note must be ${NOTE_MAX_LENGTH} characters or less`;
	}
	return errors;
}
