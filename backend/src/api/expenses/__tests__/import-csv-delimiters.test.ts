import { describe, expect, test } from 'bun:test';
import { type CsvDelimiter, csvDelimiter } from '../../../utils/csv-delimiter';
import { calendarDayIn, zonedParts } from '../../../utils/time-zone';
import { parseFuelioExport } from '../fuelio-import';
import { buildImportPlan, type ImportVehicle } from '../import-csv';
import { applyMapping } from '../import-mapping';
import { sampleHeaders } from '../import-mapping-presets';

const VEHICLES: ImportVehicle[] = [
  { id: 'veh-1', make: 'Toyota', model: 'Camry', year: 2020, nickname: 'Camry' },
];
const LOS_ANGELES = 'America/Los_Angeles';

describe('csvDelimiter', () => {
  test.each<[string, CsvDelimiter]>([
    ['date,vehicle,amount', ','],
    ['date;vehicle;amount', ';'],
    ['date\tvehicle\tamount', '\t'],
    ['"Cost, USD";Date;Notes', ';'],
    ['Date;"a;b",c,d', ','],
    ['single', ','],
    ['\n\ndate;amount\n1,5;2', ';'],
  ])('%j uses %j', (text, expected) => {
    expect(csvDelimiter(text)).toBe(expected);
  });
});

describe('semicolon and tab files', () => {
  test('a native export saved with semicolons and decimal commas imports', () => {
    const csv =
      '\uFEFFdate;vehicle;category;amount;mileage;volume\n2024-03-15;Camry;fuel;40,50;12000;35,2';
    const plan = buildImportPlan(csv, VEHICLES);
    expect(plan.errorCount).toBe(0);
    expect(plan.rows[0]?.expense).toMatchObject({
      vehicleId: 'veh-1',
      expenseAmount: 4050,
      mileage: 12000,
      volume: 35.2,
    });
  });

  test('an error in a semicolon file quotes the value as written', () => {
    const csv = 'date;vehicle;category;amount;mileage\n2024-03-15;Camry;misc;10;12,345';
    expect(buildImportPlan(csv, VEHICLES).rows[0]?.message).toBe('Invalid mileage "12,345"');
  });

  test('a native file with tabs imports', () => {
    const csv = 'date\tvehicle\tcategory\tamount\n2024-03-15\tCamry\tmisc\t12.5';
    expect(buildImportPlan(csv, VEHICLES).rows[0]?.expense?.expenseAmount).toBe(1250);
  });

  test('a manually mapped semicolon file keeps its columns apart', () => {
    const csv = 'Datum;Betrag;Notiz\n15.03.2024;40,50;Tanken';
    const { csv: native } = applyMapping(csv, {
      columns: { date: 'Datum', amount: 'Betrag', description: 'Notiz' },
      targetVehicle: 'Camry',
      dateFormat: 'dmy',
      defaultCategory: 'misc',
    });
    const expense = buildImportPlan(native, VEHICLES).rows[0]?.expense;
    expect(expense).toMatchObject({ expenseAmount: 4050, description: 'Tanken' });
  });

  test('preset detection reads semicolon headers', () => {
    expect(sampleHeaders('Date;Odometer;"Total, incl. tax"\n1;2;3')).toEqual([
      'Date',
      'Odometer',
      'Total, incl. tax',
    ]);
  });

  test('a Fuelio export saved with semicolons reads the same as with commas', () => {
    const fuelio = (sep: string) =>
      [
        '"## Vehicle"',
        ['"Name"', '"DistUnit"', '"FuelUnit"'].join(sep),
        ['"Golf"', '"0"', '"0"'].join(sep),
        '',
        `"## Log"${sep}${sep}`,
        ['"Data"', '"Odo (km)"', '"Fuel (litres)"', '"Full"', '"Price (optional)"'].join(sep),
        ['"2024-01-05"', '"45210"', '"42.10"', '"1"', '"68.90"'].join(sep),
      ].join('\n');
    const options = { targetVehicle: 'Camry', targetUnits: {} };
    expect(parseFuelioExport(fuelio(';'), options).csv).toBe(
      parseFuelioExport(fuelio(','), options).csv
    );
  });
});

describe('date-times in a native import', () => {
  const plan = (date: string, timeZone?: string) =>
    buildImportPlan(
      `date,vehicle,category,amount\n${date},Camry,misc,10`,
      VEHICLES,
      new Map(),
      timeZone
    ).rows[0];

  test('a date-time without an offset is read in the chosen time zone', () => {
    const date = plan('2024-03-15T02:00:00', LOS_ANGELES)?.expense?.date as Date;
    expect(calendarDayIn(date, LOS_ANGELES)).toBe('2024-03-15');
    expect(zonedParts(date, LOS_ANGELES)['hour']).toBe(2);
    const spaced = plan('2024-03-15 02:00', LOS_ANGELES)?.expense?.date;
    expect(spaced?.getTime()).toBe(date.getTime());
  });

  test('a date-time with an offset or Z keeps that instant', () => {
    expect(plan('2024-03-15T02:00:00.000Z', LOS_ANGELES)?.expense?.date.toISOString()).toBe(
      '2024-03-15T02:00:00.000Z'
    );
    expect(plan('2024-03-15T02:00:00+02:00')?.expense?.date.toISOString()).toBe(
      '2024-03-15T00:00:00.000Z'
    );
    expect(plan('2024-03-15T02:00:00.123456Z')?.expense?.date.toISOString()).toBe(
      '2024-03-15T02:00:00.123Z'
    );
  });

  test.each([
    '2024-02-31T10:00:00',
    '2024-02-31 10:00',
    '2024-02-31T10:00:00Z',
    '2024-03-15T24:00:00Z',
    '2024-02-30',
    '2024-03-15T25:00',
    '2024-03-15T10:61',
    '15/03/2024',
  ])('%s is rejected instead of rolling over', (date) => {
    expect(plan(date, LOS_ANGELES)).toMatchObject({ status: 'error' });
  });

  test.each(['2024-02-31 10:00', '2024-03-15 10:75'])(
    'a mapped date-time %s on an impossible day or time is rejected',
    (date) => {
      const { csv } = applyMapping(`When,Cost\n${date},10`, {
        columns: { date: 'When', amount: 'Cost' },
        targetVehicle: 'Camry',
        dateFormat: 'iso',
        defaultCategory: 'misc',
      });
      expect(buildImportPlan(csv, VEHICLES).rows[0]).toMatchObject({ status: 'error' });
    }
  );
});
